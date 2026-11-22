/**
 * US-706 — frais annexes : demande de l'hôte, délai de réponse du voyageur (payer ou contester avec
 * preuves), décision de l'ops après contestation, débit séparé par Kmino (migration 0177, ADR-197 ;
 * fixture 9907, et 9300, 9909, 9948, 9650 réutilisées). Rôles de PRODUCTION seulement (assertion
 * L0-05 par `withRole`), au Panama (USD) et au Paraguay (PYG sans décimale).
 *
 * Attendus tirés de 19 US-706 (critère 1 : frais validé par l'hôte et notifié à J0 10:00,
 * `invoice_guest_response_h` = 72, à J+3 09:59 aucun débit `GUEST_RESPONSE_WINDOW_OPEN` ;
 * contestation avec preuves ⇒ `DISPUTED` et décision de l'ops ; critère 2 : frais hors de la liste
 * fermée de BR-REIMB refusé), de 16 CLM-021 (à J+3 10:00 Kmino peut trancher, ordre de débit aux
 * jambes dont la somme égale le frais ; demande sans preuve refusée avant notification :
 * `CLAIM_EVIDENCE_MISSING`), de 19 US-315 critère 5 (carburant ou nettoyage refusés selon BR-FUEL-02,
 * BR-FUEL-03, BR-RETURN-05 ; frais sans photo impossible), de 08 (BR-REIMB-01 R09 : demande au plus
 * tard fin effective + 72 h ; BR-REIMB-02 : `invoice_guest_response_h` = 72, fenêtre jamais
 * rouverte ; BR-PROT-08 et « Jambes des frais annexes » : part de l'hôte 100 % ; vecteur T69 :
 * carburant 12,00 ⇒ HOST 12,00, PLATFORM 0,00, aucune caution) et des oracles Python
 * (`docs/specs/tools/check_t49plus.py`, ligne T69 ; `check_legs.alloc_host(m, 1)` = m pour
 * m = 1 200, 4 500, 90 000 et 300 000, `python -I -X utf8`, 2026-11-22), jamais du code testé. Le
 * pré-mortem du lot 3 (L3-PM-24, 25, 26, 28) et la red team (RT-L3-S01, RT-L3-S02 « frais saisi
 * sans preuve », débit à J+3 09:59, contestation à J+3 09:58, frais DISPUTED envoyé au débit ;
 * RT-L3-M04, H09) fixent les cas hostiles ; RT-L3-S02 référence le test « RT-L3-S02 ».
 *
 * Années virtuelles 2097 (libres). Données de préparation VALIDÉES (deux rôles : app_api pour les
 * parties et la console, app_worker pour le débit) ; aucun paramètre ni interrupteur n'est validé :
 * les versions de paramètres ne vivent que dans des transactions ANNULÉES. Aucun compte PSP ACTIVE
 * n'est validé : le moyen débité est l'opération de carte du loyer sur le compte FAKE de fixture.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { setActor } from '../support/audit.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { openSession } from '../support/iam.ts';
import { caught, payTx } from '../support/pay.ts';
import { elevated, staff, uuid } from '../support/claims.ts';
import type { Staff } from '../support/claims.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const at = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

/** Trip du 7 au 10 mars 2097, rendu à 08:00 ; demande notifiée à J0 10:00 (heure de la base). */
const START = '2097-03-07T08:00:00.000Z';
const END = '2097-03-10T08:00:00.000Z';
const J0 = '2097-03-10T10:00:00.000Z';
/** J0 + `invoice_guest_response_h` (72 h, 08 BR-REIMB-02) : J+3 10:00. */
const DUE = '2097-03-13T10:00:00.000Z';

/**
 * Montants par devise (unités mineures) : nettoyage demandé, sous le plafond PROPOSÉ
 * `incidental_cleaning_max_minor` ; carburant de T69 (12,00 USD) et son équivalent PYG ; plafond
 * de carburant posé par le test (`fuel_refill_max` est « à fixer », 0009). PYG sans décimale.
 */
const AMOUNTS: Readonly<Record<string, Readonly<Record<string, bigint>>>> = {
  USD: { cleaning: 4500n, cleaningCap: 15000n, fuel: 1200n, fuelCap: 10000n, rent: 30000n },
  PYG: {
    cleaning: 300000n,
    cleaningCap: 1125000n,
    fuel: 90000n,
    fuelCap: 750000n,
    rent: 2000000n,
  },
};
const amountsOf = (c: CountryCase): Readonly<Record<string, bigint>> => AMOUNTS[c.currency] ?? {};

const SUBMIT = `SELECT outcome, invoice_id::text AS invoice_id, response_due_at
  FROM core.claim_cmd_submit_incidental($1, $2::uuid, $3::uuid, $4, $5::bigint, $6, $7::uuid[])`;
const ACCEPT = 'SELECT core.claim_cmd_accept_incidental($1, $2::uuid) AS r';
const DISPUTE = 'SELECT core.claim_cmd_dispute_incidental($1, $2::uuid, $3, $4::uuid[]) AS r';
const CANCEL = 'SELECT core.claim_cmd_cancel_incidental($1, $2::uuid) AS r';
const VIEW = 'SELECT core.claim_incidental_view($1, $2::uuid) AS v';
const DECIDE = `SELECT outcome, body
  FROM core.support_staff_decide_incidental($1, $2::uuid, $3::uuid, $4, $5)`;
const STAFF_VIEW =
  'SELECT outcome, body FROM core.support_staff_incidental($1, $2::uuid, $3::uuid)';
const CHARGE = 'SELECT outcome, code FROM core.claim_cmd_charge_incidental($1::uuid, $2::uuid)';
const DUE_LIST = 'SELECT invoice_id::text AS id FROM core.claim_incidental_invoices_due(100)';
const DESCRIPTION = 'Sièges arrière couverts de sable et de boue au retour';
const DISPUTE_REASON = 'Le véhicule a été rendu propre, voir ma photo de l’intérieur au retour.';
const RATIONALE = 'Photos de retour de l’hôte : sable visible sur la banquette ; frais justifié.';

interface World {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
  readonly rent: string | null;
  /** Photos des séries : départ jauge (hôte), retour jauge (hôte), retour intérieur (hôte et
   * voyageur), retour extérieur (hôte). */
  readonly fuelOut: string;
  readonly fuelIn: string;
  readonly inner: string;
  readonly guestInner: string;
  readonly outer: string;
}

interface WorldOptions {
  readonly rent?: boolean;
  /** Niveaux de carburant (huitièmes) : départ, retour (les deux parties). */
  readonly fuel?: readonly [number, number];
  readonly returned?: boolean;
  readonly terminatedEarly?: boolean;
  /** Trip avec devis et Extra vendu (fixture 9948, ligne EXTRAS). */
  readonly extras?: boolean;
  readonly guest?: string;
}

async function photo(tx: Tx, trip: string, kind: string, slot: string, role = 'HOST') {
  return (
    await tx.query<{ id: string }>('SELECT test_fixture.us706_photo($1, $2, $3, $4)::text AS id', [
      trip,
      kind,
      slot,
      role,
    ])
  ).rows[0]!.id;
}

/** Trip rendu à END (heure de la base), photos des deux séries, validations, loyer par carte. */
async function world(tx: Tx, c: CountryCase, o: WorldOptions = {}): Promise<World> {
  let trip = uuid();
  const guest = o.guest ?? uuid();
  if (o.extras === true) {
    trip = (
      await tx.query<{ trip_id: string }>(
        `SELECT trip_id::text AS trip_id FROM test_fixture.us214_trip($1, $2, 'Ana', 'Ruiz',
                'Luis', 'Paz', $3::timestamptz, $4::timestamptz, $5::jsonb)`,
        [
          c.country,
          guest,
          START,
          END,
          JSON.stringify([
            { type: 'TRIP_PRICE', amountMinor: '20000' },
            { type: 'EXTRAS', amountMinor: '1000' },
          ]),
        ],
      )
    ).rows[0]!.trip_id;
  } else {
    await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      trip,
      guest,
      uuid(),
      uuid(),
      c.country,
      c.currency,
      c.timezone,
      START,
      END,
    ]);
  }
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [START]);
  const fuelOut = await photo(tx, trip, 'CHECKIN', 'FUEL');
  const [out, back] = o.fuel ?? [8, 5];
  for (const role of ['HOST', 'GUEST']) {
    await tx.query('SELECT test_fixture.us706_validation($1, $2, $3, $4::smallint)', [
      trip,
      'CHECKIN',
      role,
      out,
    ]);
  }
  if (o.terminatedEarly === true) {
    await tx.query('SELECT test_fixture.us706_terminated_early($1)', [trip]);
  }
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [END]);
  const fuelIn = await photo(tx, trip, 'CHECKOUT', 'FUEL');
  const inner = await photo(tx, trip, 'CHECKOUT', 'INT_01');
  const guestInner = await photo(tx, trip, 'CHECKOUT', 'INT_02', 'GUEST');
  const outer = await photo(tx, trip, 'CHECKOUT', 'EXT_01');
  for (const role of ['HOST', 'GUEST']) {
    await tx.query('SELECT test_fixture.us706_validation($1, $2, $3, $4::smallint)', [
      trip,
      'CHECKOUT',
      role,
      back,
    ]);
  }
  if (o.returned !== false) await tx.query('SELECT test_fixture.us309_returned($1)', [trip]);
  let rent: string | null = null;
  if (o.rent !== false) {
    rent =
      (
        await tx.query<{ id: string }>('SELECT test_fixture.us309_card_rent($1, $2)::text AS id', [
          trip,
          amountsOf(c)['rent']!.toString(),
        ])
      ).rows[0]?.id ?? null;
  }
  const holder = (
    await tx.query<{ h: string }>('SELECT test_fixture.us309_holder($1)::text AS h', [trip])
  ).rows[0]!.h;
  return { trip, guest, holder, rent, fuelOut, fuelIn, inner, guestInner, outer };
}

async function now(tx: Tx, iso: string): Promise<void> {
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso]);
}

async function session(tx: Tx, user: string): Promise<Buffer> {
  await setActor(tx, { kind: 'NONE' });
  return (await openSession(tx, user)).hash;
}

async function submit(
  tx: Tx,
  hash: Buffer,
  trip: string,
  feeType: string,
  amount: bigint,
  evidence: readonly string[],
  requestId = uuid(),
): Promise<Row> {
  return (
    await tx.query<Row>(SUBMIT, [
      hash,
      trip,
      requestId,
      feeType,
      amount.toString(),
      DESCRIPTION,
      evidence,
    ])
  ).rows[0]!;
}

async function invoices(tx: Tx, trip: string): Promise<Row[]> {
  return (await tx.query<Row>('SELECT * FROM test_fixture.us706_invoices($1)', [trip])).rows;
}

async function charges(tx: Tx, invoice: string): Promise<Row[]> {
  return (await tx.query<Row>('SELECT * FROM test_fixture.us706_charges($1)', [invoice])).rows;
}

async function param(tx: Tx, key: string, country: string, value: unknown): Promise<void> {
  await tx.query('SELECT test_fixture.us706_param_version($1, $2, $3::jsonb)', [
    key,
    country,
    JSON.stringify(value),
  ]);
}

async function decide(
  tx: Tx,
  who: Staff,
  invoice: string,
  outcome: string,
  rationale = RATIONALE,
  requestId = uuid(),
): Promise<Row> {
  const hash = await elevated(tx, who);
  return (await tx.query<Row>(DECIDE, [hash, requestId, invoice, outcome, rationale])).rows[0]!;
}

const asPayments = <T>(virtualNow: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withRole('app_worker', (worker) => payTx(worker, { worker: 'payment_command', virtualNow }, fn));

describe.each(COUNTRIES)('US-706 — frais annexes ($country, $currency)', (c: CountryCase) => {
  const a = amountsOf(c);

  it('critère 1 : notifié à J0 10:00, invoice_guest_response_h = 72 — à J+3 09:59 aucun débit (GUEST_RESPONSE_WINDOW_OPEN), à J+3 10:00 Kmino tranche : débit séparé d’US-703 aux jambes explicites (HOST 100 %, T69), jamais la caution ; rejeu sans second débit', async () => {
    const ids = await withRole('app_api', async (api) =>
      withTestTransaction(api, { virtualNow: START, commit: true }, async (tx) => {
        const w = await world(tx, c);
        await now(tx, J0);
        const hash = await session(tx, w.holder);
        const r = await submit(tx, hash, w.trip, 'CLEANING', a['cleaning']!, [w.inner, w.outer]);
        expect(r['outcome']).toBe('SUBMITTED');
        // échéance = notification + 72 h, à l'heure de la base (jamais l'heure du client)
        expect((r['response_due_at'] as Date).toISOString()).toBe(DUE);
        const rows = await invoices(tx, w.trip);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          fee_type: 'CLEANING',
          status: 'AWAITING_GUEST',
          amount_minor: a['cleaning']!.toString(),
          // BR-PROT-08, T69 : part de l'hôte 100 % (alloc_host(m, 1) = m), PLATFORM 0
          leg_host_minor: a['cleaning']!.toString(),
          leg_insurer_minor: '0',
          leg_tax_third_party_minor: '0',
          leg_platform_minor: '0',
          host_user_id: w.holder,
          guest_user_id: w.guest,
          charge_id: null,
        });
        expect((rows[0]!['notified_at'] as Date).toISOString()).toBe(J0);
        // BR-REIMB-01 R09 : délai de l'hôte = fin effective + 72 h
        expect((rows[0]!['host_deadline_at'] as Date).toISOString()).toBe(at(END, 72 * HOUR));
        return { trip: w.trip, rent: w.rent, invoice: String(r['invoice_id']) };
      }),
    );

    // J+3 09:59 (une minute avant l'échéance) : aucun débit, rien n'est écrit
    await asPayments(at(DUE, -MINUTE), async (tx) => {
      expect((await tx.query<{ id: string }>(DUE_LIST)).rows.map((x) => x.id)).not.toContain(
        ids.invoice,
      );
      expect((await tx.query<Row>(CHARGE, [ids.invoice, uuid()])).rows[0]).toEqual({
        outcome: 'NOT_DUE',
        code: 'GUEST_RESPONSE_WINDOW_OPEN',
      });
      expect(await charges(tx, ids.invoice)).toEqual([]);
      expect((await invoices(tx, ids.trip))[0]).toMatchObject({ status: 'AWAITING_GUEST' });
    });
    // borne exacte : 1 ms avant l'échéance, toujours ouvert
    await asPayments(at(DUE, -1), async (tx) => {
      expect((await tx.query<Row>(CHARGE, [ids.invoice, uuid()])).rows[0]).toEqual({
        outcome: 'NOT_DUE',
        code: 'GUEST_RESPONSE_WINDOW_OPEN',
      });
    });

    // J+3 10:00 : échéance passée sans réponse ⇒ ordre de débit d'US-703, jambes explicites
    await asPayments(DUE, async (tx) => {
      expect((await tx.query<{ id: string }>(DUE_LIST)).rows.map((x) => x.id)).toContain(
        ids.invoice,
      );
      const chargeId = uuid();
      expect((await tx.query<Row>(CHARGE, [ids.invoice, chargeId])).rows[0]).toEqual({
        outcome: 'CHARGED',
        code: 'NO_RESPONSE',
      });
      // rejeu : même issue, aucun second débit
      expect((await tx.query<Row>(CHARGE, [ids.invoice, uuid()])).rows[0]).toEqual({
        outcome: 'CHARGED',
        code: 'NO_RESPONSE',
      });
      const list = await charges(tx, ids.invoice);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: chargeId,
        purpose: 'INCIDENTAL',
        reason: 'DELAYED_CHARGES',
        amount_minor: a['cleaning']!.toString(),
        leg_host_minor: a['cleaning']!.toString(),
        leg_insurer_minor: '0',
        leg_tax_third_party_minor: '0',
        leg_platform_minor: '0',
        guest_agreed: false,
        status: 'NOTIFIED',
        tender_operation_id: ids.rent,
      });
      const inv = (await invoices(tx, ids.trip))[0]!;
      expect(inv).toMatchObject({
        status: 'CHARGED',
        charge_basis: 'NO_RESPONSE',
        charge_id: chargeId,
      });
      expect((inv['charged_at'] as Date).toISOString()).toBe(DUE);
      // jamais la caution (L3-PM-24, RT-L3-M04) : aucune opération DEPOSIT_* sur le trip
      expect(
        (
          await tx.query<{ n: number }>('SELECT test_fixture.us309_deposit_operations($1) AS n', [
            ids.trip,
          ])
        ).rows[0]!.n,
      ).toBe(0);
      expect(
        (
          await tx.query<{ n: number }>('SELECT test_fixture.us706_trip_charges($1) AS n', [
            ids.trip,
          ])
        ).rows[0]!.n,
      ).toBe(1);
    });
  });

  it('RT-L3-S02 : contestation à J+3 09:58 acceptée (DISPUTED), à J+3 10:00 refusée (fenêtre jamais rouverte) ; frais DISPUTED jamais débité avant la décision de l’ops ; décision motivée, débit réservé à ADMIN, garde ADR-122', async () => {
    const ids = await withRole('app_api', async (api) =>
      withTestTransaction(api, { virtualNow: START, commit: true }, async (tx) => {
        const ops = await staff(tx, 'OPS_AGENT', [c.country]);
        const admin = await staff(tx, 'ADMIN', [c.country]);
        const party = await staff(tx, 'ADMIN', [c.country]);
        const w = await world(tx, c);
        const late = await world(tx, c);
        const rejected = await world(tx, c);
        const self = await world(tx, c, { guest: party.id });
        await now(tx, J0);
        const ids: Record<string, string> = {};
        for (const [name, x] of [
          ['disputed', w],
          ['late', late],
          ['rejected', rejected],
          ['self', self],
        ] as const) {
          const r = await submit(
            tx,
            await session(tx, x.holder),
            x.trip,
            'CLEANING',
            a['cleaning']!,
            [x.inner],
          );
          expect(r['outcome']).toBe('SUBMITTED');
          ids[name] = String(r['invoice_id']);
        }

        // J+3 09:58 : contestation sans motif, sans pièce, pièce étrangère : refusées
        await now(tx, at(DUE, -2 * MINUTE));
        let g = await session(tx, w.guest);
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              g,
              ids['disputed'],
              'trop court',
              [w.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('INCIDENTAL_DISPUTE_REASON_REQUIRED');
        expect(
          (await tx.query<{ r: string }>(DISPUTE, [g, ids['disputed'], DISPUTE_REASON, []]))
            .rows[0]!.r,
        ).toBe('CLAIM_EVIDENCE_MISSING');
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              g,
              ids['disputed'],
              DISPUTE_REASON,
              [late.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('CLAIM_EVIDENCE_MISSING');
        // l'hôte ne conteste pas ; une autre personne : même réponse qu'un frais inconnu
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              await session(tx, w.holder),
              ids['disputed'],
              DISPUTE_REASON,
              [w.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('NOT_FOUND');
        g = await session(tx, w.guest);
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              g,
              ids['disputed'],
              DISPUTE_REASON,
              [w.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('DISPUTED');
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              g,
              ids['disputed'],
              DISPUTE_REASON,
              [w.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('ALREADY_DISPUTED');
        // contesté : le paiement n'est plus possible
        expect((await tx.query<{ r: string }>(ACCEPT, [g, ids['disputed']])).rows[0]!.r).toBe(
          'INCIDENTAL_NOT_OPEN',
        );
        for (const name of ['rejected', 'self'] as const) {
          const x = name === 'rejected' ? rejected : self;
          expect(
            (
              await tx.query<{ r: string }>(DISPUTE, [
                await session(tx, x.guest),
                ids[name],
                DISPUTE_REASON,
                [x.guestInner],
              ])
            ).rows[0]!.r,
          ).toBe('DISPUTED');
        }

        // J+3 10:00 exactement : la fenêtre est close, ni contestation ni paiement
        await now(tx, DUE);
        const gl = await session(tx, late.guest);
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              gl,
              ids['late'],
              DISPUTE_REASON,
              [late.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('GUEST_RESPONSE_WINDOW_CLOSED');
        expect((await tx.query<{ r: string }>(ACCEPT, [gl, ids['late']])).rows[0]!.r).toBe(
          'GUEST_RESPONSE_WINDOW_CLOSED',
        );
        expect((await invoices(tx, w.trip))[0]).toMatchObject({ status: 'DISPUTED' });
        const view = (await tx.query<{ v: Row }>(VIEW, [g, w.trip])).rows[0]!.v;
        expect(view).toMatchObject({ outcome: 'OK', viewerRole: 'GUEST' });
        expect((view['invoices'] as Row[])[0]).toMatchObject({
          status: 'DISPUTED',
          windowOpen: false,
          disputeReason: DISPUTE_REASON,
          chargeStatus: null,
        });

        // décision de l'ops (US-309) : motif obligatoire, jamais « définitive », débit = ADMIN
        await now(tx, at(DUE, HOUR));
        expect((await decide(tx, ops, ids['disputed']!, 'CHARGE'))['outcome']).toBe(
          'DECISION_ADMIN_REQUIRED',
        );
        expect((await decide(tx, admin, ids['disputed']!, 'CHARGE', 'court'))['outcome']).toBe(
          'DECISION_RATIONALE_REQUIRED',
        );
        expect(
          (
            await decide(
              tx,
              admin,
              ids['disputed']!,
              'CHARGE',
              'Decisión definitiva tras revisar las fotos del retorno.',
            )
          )['outcome'],
        ).toBe('DECISION_FINALITY_FORBIDDEN');
        // séparation des tâches (ADR-122, RT-L3-H09) : l'agent voyageur du trip ne décide pas
        expect((await decide(tx, party, ids['self']!, 'REJECT'))['outcome']).toBe('SELF_FORBIDDEN');
        const hashParty = await elevated(tx, party);
        expect(
          (await tx.query<Row>(STAFF_VIEW, [hashParty, uuid(), ids['self']])).rows[0]!['outcome'],
        ).toBe('SELF_FORBIDDEN');
        // un frais non contesté n'est pas décidé par l'ops
        expect((await decide(tx, admin, ids['late']!, 'CHARGE'))['outcome']).toBe(
          'INCIDENTAL_NOT_DISPUTED',
        );
        const requestId = uuid();
        const ok = await decide(tx, admin, ids['disputed']!, 'CHARGE', RATIONALE, requestId);
        expect(ok['outcome']).toBe('DECIDED');
        expect(ok['body']).toMatchObject({ status: 'DECIDED_CHARGE', decidedRole: 'ADMIN' });
        expect(
          (await decide(tx, admin, ids['disputed']!, 'CHARGE', RATIONALE, requestId))['outcome'],
        ).toBe('ALREADY_DECIDED');
        expect((await decide(tx, ops, ids['rejected']!, 'REJECT'))['outcome']).toBe('DECIDED');
        const hashOps = await elevated(tx, ops);
        const read = (await tx.query<Row>(STAFF_VIEW, [hashOps, uuid(), ids['rejected']])).rows[0]!;
        expect(read['outcome']).toBe('OK');
        expect(read['body']).toMatchObject({
          status: 'REJECTED',
          feeType: 'CLEANING',
          amountMinor: a['cleaning']!.toString(),
          disputeReason: DISPUTE_REASON,
          legs: {
            HOST: a['cleaning']!.toString(),
            INSURER: '0',
            TAX_THIRD_PARTY: '0',
            PLATFORM: '0',
          },
        });
        const out: Record<string, string> = { ...ids, trip: w.trip, rent: w.rent ?? '' };
        return out;
      }),
    );

    // débit : la demande décidée (ADMIN) part ; la rejetée et celle contestée sans décision, jamais
    await asPayments(at(DUE, 2 * HOUR), async (tx) => {
      expect((await tx.query<Row>(CHARGE, [ids['self'], uuid()])).rows[0]).toEqual({
        outcome: 'NOT_DUE',
        code: 'INCIDENTAL_DISPUTED',
      });
      expect(await charges(tx, ids['self']!)).toEqual([]);
      expect((await tx.query<Row>(CHARGE, [ids['rejected'], uuid()])).rows[0]).toEqual({
        outcome: 'DONE',
        code: 'REJECTED',
      });
      expect(await charges(tx, ids['rejected']!)).toEqual([]);
      const chargeId = uuid();
      expect((await tx.query<Row>(CHARGE, [ids['disputed'], chargeId])).rows[0]).toEqual({
        outcome: 'CHARGED',
        code: 'OPS_DECISION',
      });
      expect(await charges(tx, ids['disputed']!)).toEqual([
        expect.objectContaining({
          id: chargeId,
          purpose: 'INCIDENTAL',
          reason: 'DELAYED_CHARGES',
          amount_minor: a['cleaning']!.toString(),
          leg_host_minor: a['cleaning']!.toString(),
          leg_platform_minor: '0',
          guest_agreed: false,
          tender_operation_id: ids['rent'],
        }),
      ]);
      // sans réponse du voyageur avant l'échéance : débité à l'échéance (base NO_RESPONSE)
      expect((await tx.query<Row>(CHARGE, [ids['late'], uuid()])).rows[0]).toEqual({
        outcome: 'CHARGED',
        code: 'NO_RESPONSE',
      });
    });
  });

  it('payer (ACCEPTED) : accord écrit du voyageur avant l’échéance ⇒ débit dès la passe suivante (guest_agreed) ; annulation par l’hôte ⇒ plus aucun débit ; vue de l’hôte et du voyageur', async () => {
    const ids = await withRole('app_api', async (api) =>
      withTestTransaction(api, { virtualNow: START, commit: true }, async (tx) => {
        const paid = await world(tx, c);
        const cancelled = await world(tx, c);
        await now(tx, J0);
        const p = await submit(
          tx,
          await session(tx, paid.holder),
          paid.trip,
          'SMOKING',
          a['cleaning']!,
          [paid.inner],
        );
        const hc = await session(tx, cancelled.holder);
        const k = await submit(tx, hc, cancelled.trip, 'CLEANING', a['cleaning']!, [
          cancelled.inner,
        ]);
        expect([p['outcome'], k['outcome']]).toEqual(['SUBMITTED', 'SUBMITTED']);
        await now(tx, at(J0, HOUR));
        const g = await session(tx, paid.guest);
        // l'hôte ne paie pas à la place du voyageur
        expect(
          (await tx.query<{ r: string }>(ACCEPT, [await session(tx, paid.holder), p['invoice_id']]))
            .rows[0]!.r,
        ).toBe('NOT_FOUND');
        expect((await tx.query<{ r: string }>(ACCEPT, [g, p['invoice_id']])).rows[0]!.r).toBe(
          'ACCEPTED',
        );
        expect((await tx.query<{ r: string }>(ACCEPT, [g, p['invoice_id']])).rows[0]!.r).toBe(
          'ALREADY_ACCEPTED',
        );
        // annulation : par l'hôte qui l'a demandée, avant toute décision et tout débit
        const hc2 = await session(tx, cancelled.holder);
        expect(
          (
            await tx.query<{ r: string }>(CANCEL, [
              await session(tx, cancelled.guest),
              k['invoice_id'],
            ])
          ).rows[0]!.r,
        ).toBe('NOT_FOUND');
        expect((await tx.query<{ r: string }>(CANCEL, [hc2, k['invoice_id']])).rows[0]!.r).toBe(
          'CANCELLED',
        );
        expect((await tx.query<{ r: string }>(CANCEL, [hc2, k['invoice_id']])).rows[0]!.r).toBe(
          'ALREADY_CANCELLED',
        );
        // vue de l'hôte : demandes et photos utilisables ; d'un inconnu : NOT_FOUND
        const hv = (await tx.query<{ v: Row }>(VIEW, [hc2, cancelled.trip])).rows[0]!.v;
        expect(hv).toMatchObject({
          outcome: 'OK',
          viewerRole: 'HOST',
          currency: c.currency,
          canSubmit: true,
          feeTypes: ['FUEL', 'CLEANING', 'SMOKING'],
        });
        expect((hv['invoices'] as Row[])[0]).toMatchObject({ status: 'CANCELLED_BY_HOST' });
        expect((hv['photos'] as Row[]).map((x) => x['fileId'])).toEqual(
          expect.arrayContaining([cancelled.fuelOut, cancelled.fuelIn, cancelled.inner]),
        );
        const stranger = (
          await tx.query<{ v: Row }>(VIEW, [await session(tx, paid.guest), cancelled.trip])
        ).rows[0]!.v;
        expect(stranger).toEqual({ outcome: 'NOT_FOUND' });
        return {
          paid: String(p['invoice_id']),
          cancelled: String(k['invoice_id']),
          trip: paid.trip,
        };
      }),
    );

    await asPayments(at(J0, 2 * HOUR), async (tx) => {
      expect((await tx.query<Row>(CHARGE, [ids.paid, uuid()])).rows[0]).toEqual({
        outcome: 'CHARGED',
        code: 'GUEST_ACCEPTED',
      });
      // accord écrit postérieur à la demande (REQ-PAY-DMG-05) : marqué sur l'ordre de débit
      expect(await charges(tx, ids.paid)).toEqual([
        expect.objectContaining({ purpose: 'INCIDENTAL', guest_agreed: true }),
      ]);
      expect((await tx.query<Row>(CHARGE, [ids.cancelled, uuid()])).rows[0]).toEqual({
        outcome: 'DONE',
        code: 'CANCELLED_BY_HOST',
      });
      expect(await charges(tx, ids.cancelled)).toEqual([]);
    });
  });

  it('critère 2 : frais hors de la liste fermée de BR-REIMB refusé (INCIDENTAL_TYPE_NOT_ALLOWED) ; types de la liste traités ailleurs refusés (INCIDENTAL_TYPE_NOT_SUPPORTED) ; aucune écriture', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c);
        await now(tx, J0);
        const h = await session(tx, w.holder);
        for (const t of ['WEAR_AND_TEAR', 'PARKING_RECOVERY', 'LOST_KEY', 'fuel', '']) {
          expect((await submit(tx, h, w.trip, t, a['cleaning']!, [w.inner]))['outcome']).toBe(
            'INCIDENTAL_TYPE_NOT_ALLOWED',
          );
        }
        for (const t of ['MILEAGE', 'LATE_RETURN', 'TOLL', 'TICKET', 'EV_CHARGE']) {
          expect((await submit(tx, h, w.trip, t, a['cleaning']!, [w.inner]))['outcome']).toBe(
            'INCIDENTAL_TYPE_NOT_SUPPORTED',
          );
        }
        expect(await invoices(tx, w.trip)).toEqual([]);
      });
    });
  });

  it('RT-L3-S02 (« frais saisi sans preuve », RT-L3-S01) : sans pièce justificative, pièce étrangère au trip ou carburant sans jauge de départ ⇒ CLAIM_EVIDENCE_MISSING, rien n’est écrit ni notifié', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c);
        const other = await world(tx, c);
        await param(tx, 'fuel_refill_max', c.country, a['fuelCap']!.toString());
        await now(tx, J0);
        const loose = (
          await tx.query<{ id: string }>('SELECT test_fixture.us706_loose_file($1)::text AS id', [
            w.holder,
          ])
        ).rows[0]!.id;
        const h = await session(tx, w.holder);
        for (const evidence of [[], [loose], [other.inner], [uuid()], [w.inner, loose]]) {
          expect(
            (await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, evidence))['outcome'],
          ).toBe('CLAIM_EVIDENCE_MISSING');
        }
        // carburant : jauge au départ ET au retour (BR-FUEL-01)
        for (const evidence of [[w.fuelIn], [w.fuelOut], [w.inner, w.outer]]) {
          expect((await submit(tx, h, w.trip, 'FUEL', a['fuel']!, evidence))['outcome']).toBe(
            'CLAIM_EVIDENCE_MISSING',
          );
        }
        expect(await invoices(tx, w.trip)).toEqual([]);
        // avec les deux jauges : demande acceptée, jambes de T69 (HOST = montant, PLATFORM 0)
        const ok = await submit(tx, h, w.trip, 'FUEL', a['fuel']!, [w.fuelOut, w.fuelIn]);
        expect(ok['outcome']).toBe('SUBMITTED');
        expect((await invoices(tx, w.trip))[0]).toMatchObject({
          fee_type: 'FUEL',
          amount_minor: a['fuel']!.toString(),
          leg_host_minor: a['fuel']!.toString(),
          leg_platform_minor: '0',
        });
      });
    });
  });

  it('US-315 critère 5 : refus avec le motif de la règle — Extra vendu (BR-FUEL-02), fin anticipée (BR-FUEL-03), même niveau de carburant (BR-FUEL-01), véhicule rangé sans photo de l’intérieur (BR-RETURN-05) ; plafond du pays, plafond absent (PARAM_MISSING), délai de l’hôte aux bornes, doublon, rejeu, trip non rendu', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c);
        const prepaid = await world(tx, c, { extras: true });
        const early = await world(tx, c, { terminatedEarly: true });
        const same = await world(tx, c, { fuel: [6, 6] });
        const ongoing = await world(tx, c, { returned: false });
        await now(tx, J0);
        // plafond du carburant « à fixer » (0009) : aucune demande tant qu'il est absent
        let h = await session(tx, w.holder);
        expect(
          (await submit(tx, h, w.trip, 'FUEL', a['fuel']!, [w.fuelOut, w.fuelIn]))['outcome'],
        ).toBe('PARAM_MISSING');
        await param(tx, 'fuel_refill_max', c.country, a['fuelCap']!.toString());
        h = await session(tx, prepaid.holder);
        expect(
          (
            await submit(tx, h, prepaid.trip, 'FUEL', a['fuel']!, [prepaid.fuelOut, prepaid.fuelIn])
          )['outcome'],
        ).toBe('INCIDENTAL_FUEL_PREPAID');
        h = await session(tx, early.holder);
        expect(
          (await submit(tx, h, early.trip, 'FUEL', a['fuel']!, [early.fuelOut, early.fuelIn]))[
            'outcome'
          ],
        ).toBe('INCIDENTAL_NOT_BILLABLE');
        h = await session(tx, same.holder);
        expect(
          (await submit(tx, h, same.trip, 'FUEL', a['fuel']!, [same.fuelOut, same.fuelIn]))[
            'outcome'
          ],
        ).toBe('INCIDENTAL_NOT_BILLABLE');
        h = await session(tx, ongoing.holder);
        expect(
          (await submit(tx, h, ongoing.trip, 'CLEANING', a['cleaning']!, [ongoing.inner]))[
            'outcome'
          ],
        ).toBe('INCIDENTAL_TRIP_NOT_ENDED');
        h = await session(tx, w.holder);
        // nettoyage d'un véhicule seulement non lavé (photo de l'extérieur) : non facturable
        expect(
          (await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, [w.outer]))['outcome'],
        ).toBe('INCIDENTAL_NOT_BILLABLE');
        // plafonds du pays (montant saisi, jamais libre au-delà)
        expect(
          (await submit(tx, h, w.trip, 'CLEANING', a['cleaningCap']! + 1n, [w.inner]))['outcome'],
        ).toBe('INCIDENTAL_AMOUNT_ABOVE_CAP');
        expect(
          (await submit(tx, h, w.trip, 'FUEL', a['fuelCap']! + 1n, [w.fuelOut, w.fuelIn]))[
            'outcome'
          ],
        ).toBe('INCIDENTAL_AMOUNT_ABOVE_CAP');
        expect((await submit(tx, h, w.trip, 'CLEANING', 0n, [w.inner]))['outcome']).toBe(
          'REQUEST_INVALID',
        );
        // le voyageur ne demande pas de frais ; une autre personne : NOT_FOUND
        expect(
          (
            await submit(tx, await session(tx, w.guest), w.trip, 'CLEANING', a['cleaning']!, [
              w.inner,
            ])
          )['outcome'],
        ).toBe('NOT_FOUND');
        expect(await invoices(tx, w.trip)).toEqual([]);

        // délai de l'hôte : fin effective + 72 h acceptée, + 72 h + 1 ms refusée (heure de la base)
        await now(tx, at(END, 72 * HOUR + 1));
        h = await session(tx, w.holder);
        expect(
          (await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, [w.inner]))['outcome'],
        ).toBe('INCIDENTAL_WINDOW_CLOSED');
        await now(tx, at(END, 72 * HOUR));
        h = await session(tx, w.holder);
        const requestId = uuid();
        const ok = await submit(tx, h, w.trip, 'CLEANING', a['cleaningCap']!, [w.inner], requestId);
        expect(ok['outcome']).toBe('SUBMITTED');
        // rejeu de la même requête : la même demande ; doublon du même type : refusé
        expect(await submit(tx, h, w.trip, 'CLEANING', 1n, [w.inner], requestId)).toMatchObject({
          outcome: 'ALREADY_SUBMITTED',
          invoice_id: ok['invoice_id'],
        });
        expect(
          (await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, [w.inner]))['outcome'],
        ).toBe('INCIDENTAL_DUPLICATE');
        expect(await invoices(tx, w.trip)).toHaveLength(1);
      });
    });
  });

  it('délai du voyageur en paramètre du pays : invoice_guest_response_h relu à la demande (24 h ⇒ échéance J0 + 24 h) ; valeur hors bornes ⇒ PARAM_MISSING', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c);
        await param(tx, 'invoice_guest_response_h', c.country, 24);
        await now(tx, J0);
        const r = await submit(
          tx,
          await session(tx, w.holder),
          w.trip,
          'CLEANING',
          a['cleaning']!,
          [w.inner],
        );
        expect(r['outcome']).toBe('SUBMITTED');
        expect((r['response_due_at'] as Date).toISOString()).toBe(at(J0, 24 * HOUR));
        // valeur nulle (hors de 1 à 720 h) : aucune demande (fail-closed)
        const v = await world(tx, c);
        await param(tx, 'invoice_guest_response_h', c.country, 0);
        await now(tx, at(J0, MINUTE));
        expect(
          (
            await submit(tx, await session(tx, v.holder), v.trip, 'CLEANING', a['cleaning']!, [
              v.inner,
            ])
          )['outcome'],
        ).toBe('PARAM_MISSING');
      });
    });
  });

  it('RLS et garde : aucun droit applicatif sur la table ; montant figé, réouverture et suppression refusées ; commandes du travailleur et de la décision réservées', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c);
        await now(tx, J0);
        const r = await submit(
          tx,
          await session(tx, w.holder),
          w.trip,
          'CLEANING',
          a['cleaning']!,
          [w.inner],
        );
        const id = String(r['invoice_id']);
        for (const sql of [
          'SELECT 1 FROM core.claim_incidental_invoice',
          `UPDATE core.claim_incidental_invoice SET status = 'CHARGED'`,
          'DELETE FROM core.claim_incidental_invoice',
        ]) {
          expect((await caught(tx, () => tx.query(sql)))?.code).toBe('42501');
        }
        for (const what of ['AMOUNT', 'DELETE']) {
          const e = await caught(tx, () =>
            tx.query('SELECT test_fixture.us706_try_write($1, $2)', [what, id]),
          );
          expect(e).toMatchObject({ code: '23000', constraint: 'claim_incidental_immutable' });
        }
        // sous app_api : ni le débit ni la file du travailleur ni la décision sans la porte
        for (const sql of [
          'SELECT * FROM core.claim_cmd_charge_incidental($1::uuid, $1::uuid)',
          'SELECT * FROM core.claim_cmd_decide_incidental($1::uuid, $1::uuid, $$ADMIN$$, $1::uuid, $$CHARGE$$, $$x$$)',
        ]) {
          expect((await caught(tx, () => tx.query(sql, [id])))?.code).toBe('42501');
        }
      });
    });
    await asPayments(DUE, async (tx) => {
      // le travailleur ne lit ni n'écrit la table directement
      expect(
        (await caught(tx, () => tx.query('SELECT 1 FROM core.claim_incidental_invoice')))?.code,
      ).toBe('42501');
    });
  });
});
