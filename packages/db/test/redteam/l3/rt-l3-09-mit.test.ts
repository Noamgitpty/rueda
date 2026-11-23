/**
 * US-313 — red team du lot 3, passe de la porte : débits post-trip MIT (US-703, migration 0169 ;
 * pré-mortem du lot 3, RT-L3-M01 à M04, risques L3-PM-21 à L3-PM-24). Rôles de PRODUCTION seulement
 * (`withRole` : assertion L0-05 en tête de chaque test), travailleur `payment_command`, USD (PA) et
 * PYG sans décimale (PY). TESTS SEULEMENT : aucun correctif, aucune migration, aucune fixture
 * nouvelle. Rapport : docs/team/redteam/L3-porte.md. Horloge virtuelle 2076 (aucune autre preuve ne
 * l'utilise). Tout est écrit dans une transaction ANNULÉE : aucune donnée committée.
 *
 * Cette passe REJOUE les cas de `l0-us703-mit-charges` sous un autre angle (variantes d'attaque
 * que cette preuve ne joue pas) : même origine renvoyée avec un accord écrit pour sauter le
 * préavis ; motifs et couples hors liste ; bornes du préavis et du délai par réseau et par motif ;
 * règle inconnue (retenue) ; dette jamais ranimée en débit ; relance avant J+3 et refus « ne pas
 * réessayer » appliqué à un débit déjà encaissé ; encaissements partiels fractionnés au plus fin
 * (une unité mineure) avec invariants par jambe.
 *
 * Attendus (jamais le code testé) : 19 US-703 critères 1 et 2 ; 16 PAY-015 / PAY-037 ; 08 BR-PAY-09 bis
 * (REQ-PAY-DMG-05 : préavis Visa de 20 j, accord écrit Mastercard et Amex ; REQ-PAY-DMG-07 : 30 j
 * Mastercard ; REQ-PAY-DMG-09 et BR-REIMB-02 / 03 : frais annexes 72 h), 08 E4 (`attempt_no` + 1
 * après un refus REÇU seulement), 08 E7 règles 4 et 5 (jamais une jambe négative ni encaissée au-delà
 * de son dû, solde exact) et les vecteurs de l'export des oracles (`@rueda/money/golden-vectors` :
 * jambes TJ02a, TJ11a). Aucun interrupteur n'est écrit.
 */
import { legVector } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { withRole } from '../../../src/testing/index.ts';
import { COUNTRIES } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { applySignedStatus, applyStatus, payTx, recordOperation } from '../../support/pay.ts';
import type { Legs } from '../../support/pay.ts';
import { golden } from '../../support/settlement.ts';
import { failure, setVirtualNow, uuid } from './support-l3.ts';
import type { Row, Tx } from './support-l3.ts';

const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const legsOf = (id: string): Legs => ({ ...legVector(golden, id).legsMinor });
const legsJson = (l: Legs): string =>
  JSON.stringify(Object.fromEntries(LEGS.map((k) => [k, l[k].toString()])));

/** Dette de 08 par devise : jambes TJ02a (USD) et TJ11a (PYG) de l'export des oracles. */
const DEBT_LEGS: readonly string[] = ['TJ02a', 'TJ11a'];
/** Encaissement du loyer par carte : jambes TJ01 (USD) et TJ08a (PYG). */
const CAPTURE_LEGS: readonly string[] = ['TJ01', 'TJ08a'];

const T0 = '2076-03-02T15:00:00.000Z';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const plusMs = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

const asPayments = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) =>
    payTx(client, { worker: 'payment_command', deploymentEnv: 'test', virtualNow: T0 }, fn),
  );

/**
 * Compte PSP FAKE ACTIVE du pays et SUPPORTS_MIT validée pour la carte (une seule fois par transaction).
 * Version en vigueur dès 2076-01-01 : des lignes UNKNOWN validées (committées) d'autres preuves, datées
 * de 2036, masqueraient sinon une version de 2035 à l'horloge virtuelle 2076 (MIT_RAIL_UNAVAILABLE).
 */
async function bench(tx: Tx, c: CountryCase): Promise<string> {
  // compte FAKE ACTIVE partagé du pays (lire ou créer : un seul ACTIVE par pays dans la base)
  const psp = (
    await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [c.country])
  ).rows[0]!.id;
  await tx.query(
    `SELECT test_fixture.us024_set_capability('FAKE', $1, 'CARD', 'SUPPORTS_MIT', 'true'::jsonb,
                                              'VALIDATED_SANDBOX', '2076-01-01T00:00:00Z')`,
    [c.country],
  );
  return psp;
}

interface World {
  readonly trip: string;
  readonly guest: string;
  readonly psp: string;
  readonly tender: string;
}

interface WorldOptions {
  readonly network?: 'VISA' | 'MASTERCARD' | 'AMEX';
  /** `false` : aucune carte ni consentement. */
  readonly consent?: boolean;
}

/** Trip rendu (fin effective à l'heure courante), loyer encaissé par carte, carte et consentement. */
async function world(tx: Tx, c: CountryCase, psp: string, o: WorldOptions = {}): Promise<World> {
  const trip = uuid();
  const guest = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    guest,
    uuid(),
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    '2076-02-20T10:00:00Z',
    '2076-02-23T10:00:00Z',
  ]);
  const capture = legsOf(CAPTURE_LEGS[COUNTRIES.indexOf(c)] ?? '');
  const { operation_id: tender } = await recordOperation(tx, {
    tripId: trip,
    accountId: psp,
    kind: 'CAPTURE',
    amountMinor: sum(capture),
    currency: c.currency,
    idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
    legs: capture,
  });
  expect(await applySignedStatus(tx, tender, 'SUCCEEDED')).toBe('APPLIED');
  if (o.consent !== false) {
    const card = (
      await tx.query<{ id: string }>('SELECT test_fixture.us703_card($1, $2, $3, $4) AS id', [
        guest,
        psp,
        o.network ?? 'VISA',
        `tok_rt_l3_${uuid()}`,
      ])
    ).rows[0]?.id;
    await tx.query('SELECT test_fixture.us703_consent($1, $2, $3::text[], $4)', [
      trip,
      card,
      ['DELAYED_CHARGES', 'NO_SHOW', 'DAMAGE_SEPARATE', 'REAUTHORIZATION'],
      true,
    ]);
  }
  await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);
  return { trip, guest, psp, tender };
}

interface ChargeInput {
  readonly origin?: string;
  readonly purpose: string;
  readonly reason: string;
  readonly legs: Legs;
  readonly agreed?: boolean;
  readonly originType?: string;
  readonly settlementVersion?: number;
}

const NOTIFY = `SELECT outcome, charge_id::text AS charge_id
  FROM core.payment_cmd_notify_post_trip_charge($1::uuid, $2::uuid, $3, $4, $5, $6::uuid,
                                                $11::integer, $7::uuid, $8::bigint, $9::jsonb,
                                                $10)`;
const notifyArgs = (w: World, i: ChargeInput): unknown[] => [
  uuid(),
  w.trip,
  i.purpose,
  i.reason,
  i.originType ?? 'RT_ORIGIN',
  i.origin ?? uuid(),
  w.tender,
  sum(i.legs).toString(),
  legsJson(i.legs),
  i.agreed === true,
  i.settlementVersion ?? null,
];

async function notify(tx: Tx, w: World, i: ChargeInput): Promise<{ id: string; origin: string }> {
  const origin = i.origin ?? uuid();
  const args = notifyArgs(w, { ...i, origin });
  const { rows } = await tx.query<{ outcome: string; charge_id: string }>(NOTIFY, args);
  expect(rows[0]?.outcome).toBe('NOTIFIED');
  return { id: rows[0]?.charge_id ?? '', origin };
}

interface Plan {
  readonly outcome: string;
  readonly code: string | null;
  readonly operation_id: string | null;
  readonly attempt: number | null;
}
async function plan(tx: Tx, charge: string): Promise<Plan> {
  const { rows } = await tx.query<Plan>('SELECT * FROM core.payment_cmd_plan_mit_attempt($1, $2)', [
    charge,
    uuid(),
  ]);
  return rows[0] as Plan;
}
async function settle(tx: Tx, charge: string, doNotRetry = false): Promise<Row> {
  const { rows } = await tx.query<Row>(
    'SELECT * FROM core.payment_cmd_settle_mit_attempt($1, $2)',
    [charge, doNotRetry],
  );
  return rows[0] ?? {};
}
const chargeOf = async (tx: Tx, charge: string): Promise<Row> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us703_charge($1)', [charge])).rows[0] ?? {};
const attemptsOf = async (tx: Tx, charge: string): Promise<Row[]> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us703_attempts($1)', [charge])).rows;
const debtOf = async (tx: Tx, charge: string): Promise<Row | null> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us703_debt($1)', [charge])).rows[0] ?? null;
async function mitOps(tx: Tx, trip: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM core.payment_payment_operation
      WHERE trip_id = $1 AND kind = 'MIT_CHARGE'`,
    [trip],
  );
  return rows[0]?.n ?? -1;
}
async function unpaid(tx: Tx, user: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    'SELECT test_fixture.us703_unpaid_restrictions($1) AS n',
    [user],
  );
  return rows[0]?.n ?? -1;
}
async function chargesOnTrip(tx: Tx, trip: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    'SELECT test_fixture.us706_trip_charges($1) AS n',
    [trip],
  );
  return rows[0]?.n ?? -1;
}

describe.each(COUNTRIES)('RT-L3 débits MIT, passe de la porte ($country, $currency)', (c) => {
  const damage = legsOf(DEBT_LEGS[COUNTRIES.indexOf(c)] ?? '');

  // -----------------------------------------------------------------------------------------
  // RT-L3-M01 — un accord écrit « ajouté après coup » ne saute pas le préavis
  it('RT-L3-M01 (L3-PM-21) : la même origine renvoyée avec un accord écrit (ou un autre montant, d’autres jambes, un autre motif) ⇒ conflit de contenu, le préavis de 20 j (Visa) court toujours, aucun ordre ; le même contenu ⇒ REPLAYED', async () => {
    await asPayments(async (tx) => {
      const w = await world(tx, c, await bench(tx, c));
      const first = await notify(tx, w, {
        purpose: 'DAMAGE',
        reason: 'DAMAGE_SEPARATE',
        legs: damage,
        agreed: false,
      });
      const swapped: Legs = { ...damage, HOST: damage.PLATFORM, PLATFORM: damage.HOST };
      const bigger: Legs = { ...damage, HOST: damage.HOST + 1n };
      const hostile: [string, ChargeInput][] = [
        [
          'accord écrit ajouté',
          {
            origin: first.origin,
            purpose: 'DAMAGE',
            reason: 'DAMAGE_SEPARATE',
            legs: damage,
            agreed: true,
          },
        ],
        [
          'montant + 1',
          { origin: first.origin, purpose: 'DAMAGE', reason: 'DAMAGE_SEPARATE', legs: bigger },
        ],
        [
          'jambes permutées, même total',
          { origin: first.origin, purpose: 'DAMAGE', reason: 'DAMAGE_SEPARATE', legs: swapped },
        ],
        [
          'autre motif (frais annexe, 72 h)',
          { origin: first.origin, purpose: 'INCIDENTAL', reason: 'DELAYED_CHARGES', legs: damage },
        ],
      ];
      // les jambes permutées d'un vecteur dont HOST = PLATFORM ne changent rien : le cas n'a de sens
      // que si elles diffèrent (témoin de population : jamais un test vide), affirmé sans condition
      expect(damage.HOST === damage.PLATFORM).toBe(false);
      for (const [label, input] of hostile) {
        expect(await failure(tx, NOTIFY, notifyArgs(w, input)), label).toMatchObject({
          constraint: 'mit_charge_conflict',
        });
      }
      // le contenu d'origine, renvoyé, rend la même demande
      const again = (
        await tx.query<Row>(
          NOTIFY,
          notifyArgs(w, {
            origin: first.origin,
            purpose: 'DAMAGE',
            reason: 'DAMAGE_SEPARATE',
            legs: damage,
          }),
        )
      ).rows[0];
      expect(again).toEqual({ outcome: 'REPLAYED', charge_id: first.id });
      // le préavis court : refus à J+19 j 23 h 59, aucun ordre ; accepté à J+20 j
      await setVirtualNow(tx, plusMs(T0, 20 * DAY_MS - 1));
      expect(await plan(tx, first.id)).toMatchObject({
        outcome: 'NOT_DUE',
        code: 'MIT_NOTICE_PERIOD_NOT_ELAPSED',
        operation_id: null,
      });
      expect(await mitOps(tx, w.trip)).toBe(0);
      expect(await chargeOf(tx, first.id)).toMatchObject({ status: 'NOTIFIED', attempt_no: 0 });
      // une seule demande sur le trip : aucune des tentatives hostiles n'a écrit
      expect(await chargesOnTrip(tx, w.trip)).toBe(1);
    });
  });

  it('RT-L3-M01 / M04 (L3-PM-21, L3-PM-24) : motif hors liste, couple motif × but interdit, but inconnu (la caution, le loyer) et origine mal formée ⇒ refus de la base, rien d’écrit', async () => {
    await asPayments(async (tx) => {
      const w = await world(tx, c, await bench(tx, c));
      const cases: readonly [string, ChargeInput, string][] = [
        [
          'motif « caution »',
          { purpose: 'INCIDENTAL', reason: 'DEPOSIT_CAPTURE', legs: damage },
          'post_trip_charge_reason_valid',
        ],
        [
          'motif « loyer »',
          { purpose: 'RENT_SHORTFALL', reason: 'RENT', legs: damage },
          'post_trip_charge_reason_valid',
        ],
        [
          'but « caution »',
          { purpose: 'DEPOSIT', reason: 'DELAYED_CHARGES', legs: damage },
          'post_trip_charge_purpose_valid',
        ],
        [
          'dommage étiqueté frais annexe (contourne l’accord écrit Mastercard)',
          { purpose: 'DAMAGE', reason: 'DELAYED_CHARGES', legs: damage },
          'post_trip_charge_reason_purpose',
        ],
        [
          'frais annexe étiqueté dommage',
          { purpose: 'INCIDENTAL', reason: 'DAMAGE_SEPARATE', legs: damage },
          'post_trip_charge_reason_purpose',
        ],
        [
          'dommage étiqueté retenue de no-show',
          { purpose: 'DAMAGE', reason: 'NO_SHOW', legs: damage },
          'post_trip_charge_reason_purpose',
        ],
        [
          'retenue étiquetée frais annexe',
          { purpose: 'NO_SHOW_RETENTION', reason: 'DELAYED_CHARGES', legs: damage },
          'post_trip_charge_reason_purpose',
        ],
        [
          'manque à gagner étiqueté dommage',
          { purpose: 'RENT_SHORTFALL', reason: 'DAMAGE_SEPARATE', legs: damage },
          'post_trip_charge_reason_purpose',
        ],
        [
          'origine en minuscules',
          {
            purpose: 'INCIDENTAL',
            reason: 'DELAYED_CHARGES',
            legs: damage,
            originType: 'rt_origin',
          },
          'post_trip_charge_origin_format',
        ],
        [
          'origine vide de sens (un seul caractère)',
          { purpose: 'INCIDENTAL', reason: 'DELAYED_CHARGES', legs: damage, originType: 'X' },
          'post_trip_charge_origin_format',
        ],
      ];
      for (const [label, input, constraint] of cases) {
        expect(await failure(tx, NOTIFY, notifyArgs(w, input)), label).toMatchObject({
          constraint,
        });
      }
      expect(await chargesOnTrip(tx, w.trip)).toBe(0);
      expect(await mitOps(tx, w.trip)).toBe(0);
      // témoin : un couple permis est accepté sur ce même trip
      await notify(tx, w, { purpose: 'INCIDENTAL', reason: 'DELAYED_CHARGES', legs: damage });
      expect(await chargesOnTrip(tx, w.trip)).toBe(1);
    });
  });

  it('RT-L3-M01 (L3-PM-21) : bornes à la milliseconde des frais annexes (72 h Visa, 72 h puis 30 j depuis la notification Mastercard) ; aucune retenue de no-show n’est débitée, quel que soit le réseau (règle inconnue ⇒ dette)', async () => {
    await asPayments(async (tx) => {
      const psp = await bench(tx, c);
      const visa = await world(tx, c, psp, { network: 'VISA' });
      const master = await world(tx, c, psp, { network: 'MASTERCARD' });
      const masterLate = await world(tx, c, psp, { network: 'MASTERCARD' });
      const fee = { purpose: 'INCIDENTAL', reason: 'DELAYED_CHARGES', legs: damage } as const;
      const v = await notify(tx, visa, fee);
      const m = await notify(tx, master, fee);
      const ml = await notify(tx, masterLate, fee);
      const ml2 = await notify(tx, masterLate, {
        ...fee,
        legs: { ...damage, HOST: damage.HOST + 1n },
      });
      // 72 h moins une milliseconde : refus, aucun ordre
      await setVirtualNow(tx, plusMs(T0, 72 * HOUR_MS - 1));
      for (const [w, ch] of [
        [visa, v],
        [master, m],
      ] as const) {
        expect(await plan(tx, ch.id)).toMatchObject({
          outcome: 'NOT_DUE',
          code: 'MIT_NOTICE_PERIOD_NOT_ELAPSED',
          operation_id: null,
        });
        expect(await mitOps(tx, w.trip)).toBe(0);
      }
      // 72 h : le débit est planifié (tentative a1) pour les deux réseaux
      await setVirtualNow(tx, plusMs(T0, 72 * HOUR_MS));
      for (const [w, ch] of [
        [visa, v],
        [master, m],
      ] as const) {
        expect(await plan(tx, ch.id)).toMatchObject({ outcome: 'PLANNED', attempt: 1 });
        expect(await mitOps(tx, w.trip)).toBe(1);
      }
      // Mastercard : 30 j depuis la notification, borne exacte ; une milliseconde de plus ⇒ dette
      await setVirtualNow(tx, plusMs(T0, 30 * DAY_MS));
      expect(await plan(tx, ml.id)).toMatchObject({ outcome: 'PLANNED', attempt: 1 });
      await setVirtualNow(tx, plusMs(T0, 30 * DAY_MS + 1));
      expect(await plan(tx, ml2.id)).toMatchObject({
        outcome: 'DEBT',
        code: 'MIT_DEADLINE_PASSED',
      });
      expect(await mitOps(tx, masterLate.trip)).toBe(1);
      // retenue de no-show : la règle des réseaux n'a aucun délai (OQ-BR-43), aucun débit
      for (const network of ['VISA', 'MASTERCARD', 'AMEX'] as const) {
        await setVirtualNow(tx, T0);
        const w = await world(tx, c, psp, { network });
        const ch = await notify(tx, w, {
          purpose: 'NO_SHOW_RETENTION',
          reason: 'NO_SHOW',
          legs: damage,
        });
        await setVirtualNow(tx, plusMs(T0, 4 * DAY_MS));
        expect(await plan(tx, ch.id), network).toMatchObject({
          outcome: 'DEBT',
          code: 'MIT_RULE_UNKNOWN',
        });
        expect(await mitOps(tx, w.trip), network).toBe(0);
        expect(await unpaid(tx, w.guest), network).toBe(1);
      }
    });
  });

  // -----------------------------------------------------------------------------------------
  // RT-L3-M02 — une dette ouverte n'est jamais ranimée en débit ; relances et rejeux
  it('RT-L3-M02 (L3-PM-22) : une dette ouverte (consentement absent) ne redevient jamais un débit — carte et consentement rétablis ensuite, horloge avancée, même origine renvoyée : aucun ordre, la restriction reste', async () => {
    await asPayments(async (tx) => {
      const psp = await bench(tx, c);
      const w = await world(tx, c, psp, { consent: false });
      const ch = await notify(tx, w, {
        purpose: 'INCIDENTAL',
        reason: 'DELAYED_CHARGES',
        legs: damage,
      });
      await setVirtualNow(tx, plusMs(T0, 4 * DAY_MS));
      expect(await plan(tx, ch.id)).toMatchObject({ outcome: 'DEBT', code: 'MIT_CONSENT_MISSING' });
      expect(await unpaid(tx, w.guest)).toBe(1);
      // le voyageur « régularise » : carte ACTIVE et consentement complet liés au trip
      const card = (
        await tx.query<{ id: string }>('SELECT test_fixture.us703_card($1, $2, $3, $4) AS id', [
          w.guest,
          psp,
          'VISA',
          `tok_rt_l3_${uuid()}`,
        ])
      ).rows[0]?.id;
      await tx.query('SELECT test_fixture.us703_consent($1, $2, $3::text[], $4)', [
        w.trip,
        card,
        ['DELAYED_CHARGES', 'NO_SHOW', 'DAMAGE_SEPARATE', 'REAUTHORIZATION'],
        true,
      ]);
      await setVirtualNow(tx, plusMs(T0, 9 * DAY_MS));
      expect(await plan(tx, ch.id)).toMatchObject({ outcome: 'DONE', code: 'UNPAID' });
      expect(await mitOps(tx, w.trip)).toBe(0);
      expect(await attemptsOf(tx, ch.id)).toEqual([]);
      // la même origine renvoyée rend la même demande, pas une seconde
      const again = (
        await tx.query<Row>(
          NOTIFY,
          notifyArgs(w, {
            origin: ch.origin,
            purpose: 'INCIDENTAL',
            reason: 'DELAYED_CHARGES',
            legs: damage,
          }),
        )
      ).rows[0];
      expect(again).toEqual({ outcome: 'REPLAYED', charge_id: ch.id });
      expect(await chargesOnTrip(tx, w.trip)).toBe(1);
      expect(await unpaid(tx, w.guest)).toBe(1);
      expect(await debtOf(tx, ch.id)).toMatchObject({ status: 'OPEN' });
    });
  });

  it('RT-L3-M02 (L3-PM-22) : relance avant J+3 refusée à la milliseconde, plusieurs reports du même refus sans nouvelle tentative, une seule tentative en vol ; un refus « ne pas réessayer » appliqué à un débit déjà ENCAISSÉ ne le met pas en dette', async () => {
    await asPayments(async (tx) => {
      const psp = await bench(tx, c);
      // accord écrit : débit tout de suite (tentative a1 à T0)
      const w = await world(tx, c, psp);
      const ch = await notify(tx, w, {
        purpose: 'INCIDENTAL',
        reason: 'DELAYED_CHARGES',
        legs: damage,
        agreed: true,
      });
      const a1 = await plan(tx, ch.id);
      expect(a1).toMatchObject({ outcome: 'PLANNED', attempt: 1 });
      expect(await applyStatus(tx, a1.operation_id ?? '', 'FAILED', 'API_RESPONSE')).toBe(
        'APPLIED',
      );
      for (let i = 0; i < 3; i += 1) {
        // reports répétés du même refus : jamais une tentative de plus
        await settle(tx, ch.id);
      }
      expect(await attemptsOf(tx, ch.id)).toHaveLength(1);
      expect(await mitOps(tx, w.trip)).toBe(1);
      await setVirtualNow(tx, plusMs(T0, 3 * DAY_MS - 1));
      expect(await plan(tx, ch.id)).toMatchObject({
        outcome: 'NOT_DUE',
        code: 'MIT_RETRY_NOT_DUE',
      });
      expect(await mitOps(tx, w.trip)).toBe(1);
      await setVirtualNow(tx, plusMs(T0, 3 * DAY_MS));
      const a2 = await plan(tx, ch.id);
      expect(a2).toMatchObject({ outcome: 'PLANNED', attempt: 2 });
      // second appel immédiat : la MÊME tentative (sans statut), jamais une troisième
      expect(await plan(tx, ch.id)).toMatchObject({
        outcome: 'IN_FLIGHT',
        operation_id: a2.operation_id,
        attempt: 2,
      });
      expect(await mitOps(tx, w.trip)).toBe(2);

      // débit encaissé (preuve signée) puis ordre « ne pas réessayer » reçu en retard
      const w2 = await world(tx, c, psp);
      const paid = await notify(tx, w2, {
        purpose: 'INCIDENTAL',
        reason: 'DELAYED_CHARGES',
        legs: damage,
        agreed: true,
      });
      const op = await plan(tx, paid.id);
      expect(op.outcome).toBe('PLANNED');
      expect(await applySignedStatus(tx, op.operation_id ?? '', 'SUCCEEDED')).toBe('APPLIED');
      expect(await settle(tx, paid.id, true)).toMatchObject({ outcome: 'CHARGED' });
      expect(await chargeOf(tx, paid.id)).toMatchObject({ status: 'CHARGED' });
      expect(await debtOf(tx, paid.id)).toBeNull();
      expect(await unpaid(tx, w2.guest)).toBe(0);
    });
  });

  // -----------------------------------------------------------------------------------------
  // RT-L3-M03 — encaissements partiels fractionnés au plus fin : invariants par jambe
  it('RT-L3-M03 (L3-PM-23) : une dette payée en douze encaissements croissants dont trois d’UNE unité mineure ⇒ aucune jambe négative, aucune jambe au-delà de son dû, Σ des incréments = montant à chaque pas, jambes cumulées = jambes dues au solde ; un montant nul, négatif ou au-delà du reste est refusé sans écriture', async () => {
    await asPayments(async (tx) => {
      const w = await world(tx, c, await bench(tx, c), { consent: false });
      const ch = await notify(tx, w, {
        purpose: 'RENT_SHORTFALL',
        reason: 'NO_SHOW',
        legs: damage,
        settlementVersion: 1,
      });
      await setVirtualNow(tx, plusMs(T0, 4 * DAY_MS));
      expect(await plan(tx, ch.id)).toMatchObject({ outcome: 'DEBT' });
      const debt = await debtOf(tx, ch.id);
      const debtId = String(debt?.['id']);
      const total = sum(damage);
      const due = {
        HOST: damage.HOST,
        INSURER: damage.INSURER,
        TAX_THIRD_PARTY: damage.TAX_THIRD_PARTY,
        PLATFORM: damage.PLATFORM,
      };
      const PLAN = 'SELECT * FROM core.payment_cmd_plan_debt_collection($1, $2, $3, $4::bigint)';
      const paidOf = async (): Promise<Record<(typeof LEGS)[number], bigint>> => {
        const d = await debtOf(tx, ch.id);
        return {
          HOST: BigInt(String(d?.['paid_host_minor'])),
          INSURER: BigInt(String(d?.['paid_insurer_minor'])),
          TAX_THIRD_PARTY: BigInt(String(d?.['paid_tax_third_party_minor'])),
          PLATFORM: BigInt(String(d?.['paid_platform_minor'])),
        };
      };
      // montants : 1, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, puis le reste (douzième)
      const steps = [1n, 1n, 1n, 2n, 3n, 5n, 8n, 13n, 21n, 34n, 55n];
      let collected = 0n;
      let before = await paidOf();
      for (const [i, amount] of steps.entries()) {
        const r = (await tx.query<Row>(PLAN, [debtId, uuid(), uuid(), amount.toString()])).rows[0]!;
        expect(r['outcome'], `pas ${i}`).toBe('PLANNED');
        const inc = r['legs'] as Record<string, string>;
        let s = 0n;
        for (const k of LEGS) {
          const v = BigInt(inc[k] ?? '-1');
          expect(v >= 0n, `pas ${i} ${k} jamais négatif`).toBe(true);
          s += v;
        }
        expect(s, `pas ${i} somme des incréments`).toBe(amount);
        expect(await applySignedStatus(tx, String(r['operation_id']), 'SUCCEEDED')).toBe('APPLIED');
        expect(
          (
            await tx.query<Row>('SELECT * FROM core.payment_cmd_settle_debt_collection($1)', [
              r['collection_id'],
            ])
          ).rows[0],
        ).toMatchObject({ outcome: 'COLLECTED', debt_status: 'PARTIALLY_PAID' });
        collected += amount;
        const after = await paidOf();
        for (const k of LEGS) {
          expect(after[k] - before[k], `pas ${i} ${k} cumul = ancien + incrément`).toBe(
            BigInt(inc[k] ?? '-1'),
          );
          expect(after[k] <= due[k], `pas ${i} ${k} jamais au-delà du dû`).toBe(true);
        }
        before = after;
      }
      expect(collected < total).toBe(true);
      // hors bornes : montant nul, négatif, reste + 1 ⇒ AMOUNT_INVALID, aucune écriture
      const seqBefore = (await debtOf(tx, ch.id))?.['collection_seq'];
      for (const bad of ['0', '-1', (total - collected + 1n).toString()]) {
        const r = (await tx.query<Row>(PLAN, [debtId, uuid(), uuid(), bad])).rows[0]!;
        expect(r['outcome'], bad).toBe('AMOUNT_INVALID');
      }
      expect((await debtOf(tx, ch.id))?.['collection_seq']).toBe(seqBefore);
      // douzième encaissement : le reste exact ⇒ dette payée, jambes cumulées = jambes dues
      const rest = total - collected;
      const last = (await tx.query<Row>(PLAN, [debtId, uuid(), uuid(), rest.toString()])).rows[0]!;
      expect(last['outcome']).toBe('PLANNED');
      expect(await applySignedStatus(tx, String(last['operation_id']), 'SUCCEEDED')).toBe(
        'APPLIED',
      );
      expect(
        (
          await tx.query<Row>('SELECT * FROM core.payment_cmd_settle_debt_collection($1)', [
            last['collection_id'],
          ])
        ).rows[0],
      ).toMatchObject({ outcome: 'COLLECTED', debt_status: 'PAID' });
      expect(await paidOf()).toEqual(due);
      expect(await unpaid(tx, w.guest)).toBe(0);
      // dette payée : plus aucun encaissement
      expect((await tx.query<Row>(PLAN, [debtId, uuid(), uuid(), '1'])).rows[0]?.['outcome']).toBe(
        'PAID',
      );
    });
  });
});
