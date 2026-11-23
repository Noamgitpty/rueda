/**
 * US-318 (suite 2) — refacturation des amendes, péages et fourrières : clé canonique du PV, unicité
 * par compte d'hôte du pays, seuil cumulé du trip et revue de l'ops (migration 0183, ADR-203 ;
 * fixtures 9902, 9904, 9906, 9907, 9909, 9300). Correctifs des constats de la passe de porte de la
 * red team du lot 3 F-L3-SIN-03 (le même PV écrit autrement), F-L3-SIN-05 (le même PV refacturé à
 * deux voyageurs du même hôte) et F-L3-SIN-04 (aucun cumul par trip ; ramené à élevé par la revue
 * argent : au-delà, revue de l'ops obligatoire avant tout débit, jamais un refus). Rôles de
 * PRODUCTION seulement (assertion L0-05 par `withRole`), au Panama (USD) et au Paraguay (PYG sans
 * décimale).
 *
 * Attendus (jamais le code testé) :
 * - ADR-203 (exemples de la clé canonique) et rapport de la red team (`docs/team/redteam/L3-porte.md`,
 *   rt-l3-11 : « PV 000123 » / « PV 123 », « PV 100200 » / « PV 1OO2OO », même numéro sur deux
 *   trips du même hôte) ; 08 BR-REIMB-05 (« interdites : […] doublons ») ;
 * - seuil PROPOSÉ `traffic_trip_charge_max_minor` (ADR-203) : 1 000,00 USD, 7 500 000 PYG ; au-delà,
 *   aucun débit sans décision de l'ops (revue argent de la red team) ; décision : débit réservé à
 *   ADMIN (ADR-195, ADR-201) ;
 * - frais de gestion de 5 % de l'oracle `packages/money/test/oracle/traffic_fee_oracle.py`.
 *
 * Années virtuelles propres au fichier : 2067 (mondes) et 2068 (course). Lectures, refus et
 * exécutions du travailleur dans des transactions ANNULÉES, sauf les mondes validés de l'exécution
 * et de la course (deux rôles, deux connexions). Octets de photo tirés au hasard (index
 * d'empreinte unique, 0176). Aucun interrupteur écrit.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { SubjectKeyStore } from '../../src/audit/index.ts';
import { FakeKeyWrapper, withRole, withTestTransaction } from '../../src/testing/index.ts';
import { setActor } from '../support/audit.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { elevated, staff } from '../support/claims.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';
import { openSession, setVirtualNow } from '../support/iam.ts';
import { caught, payTx } from '../support/pay.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;
const uuid = (): string => randomUUID();
const HOUR = 3_600_000;
const plus = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

const START = '2067-02-07T10:00:00.000Z';
const END = '2067-02-10T10:00:00.000Z';
/** Déclaration : une heure après le retour (heure de la base). */
const D = plus(END, HOUR);
/** 08 BR-TT-02 : 48 h pour payer ou contester ; échéance exclue. */
const DUE = plus(D, 48 * HOUR);
/** Course (2068) : deux déclarations du même PV sur deux trips du même hôte. */
const R_START = '2068-06-02T10:00:00.000Z';
const R_END = '2068-06-05T10:00:00.000Z';
const R_AT = plus(R_END, HOUR);

/** Par pays (ordre de COUNTRIES) : amende, loyer, seuil cumulé PROPOSÉ du trip (ADR-203). */
const AMOUNTS: readonly Readonly<Record<string, bigint>>[] = [
  { fine: 1230n, rent: 30000n, tripCap: 100000n },
  { fine: 25010n, rent: 2000000n, tripCap: 7500000n },
];
const amountsOf = (c: CountryCase): Readonly<Record<string, bigint>> =>
  AMOUNTS[COUNTRIES.indexOf(c)]!;

const CAPTURE = 'SELECT * FROM core.trip_cmd_open_photo_capture($1, $2::uuid, $3, $4)';
const ADD = `SELECT * FROM core.trip_cmd_add_inspection_photo($1, $2::uuid, $3, $4::uuid, $5, $6::uuid,
                                                              $7, $8::bigint, $9, $10::timestamptz)`;
const DECLARE = `SELECT outcome, charge_id::text AS charge_id, body
  FROM core.claim_cmd_declare_traffic_charge($1, $2::uuid, $3::uuid, $4, $5::timestamptz, $6::bigint,
                                             $7::uuid, $8, $9)`;
const ACCEPT = 'SELECT core.claim_cmd_accept_traffic_charge($1, $2::uuid) AS r';
const DISPUTE = 'SELECT core.claim_cmd_dispute_traffic_charge($1, $2::uuid, $3, $4::uuid[]) AS r';
const DECIDE = `SELECT outcome, body
  FROM core.support_staff_decide_traffic_charge($1, $2::uuid, $3::uuid, $4, $5)`;
const EXECUTE = 'SELECT outcome, code FROM core.claim_cmd_execute_traffic_charge($1, $2)';

const DISPUTE_REASON = 'Je n’étais pas sur cette route ce jour-là, voir le relevé du trajet.';
const RATIONALE = 'Avis officiel de la police lu : plaque et heure dans le trip, débit justifié.';

const setNow = (tx: Tx, iso: string) =>
  tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso]);
const keys = new SubjectKeyStore(new FakeKeyWrapper());

/** Session neuve de la personne à l'heure (virtuelle) de la transaction. */
async function session(tx: Tx, user: string): Promise<Buffer> {
  await setActor(tx, { kind: 'NONE' });
  return (await openSession(tx, user)).hash;
}

interface World {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
}

/** Trip du pays rendu, loyer par carte ; `org` : compte d'hôte (partagé si donné). */
async function world(
  tx: Tx,
  c: CountryCase,
  org: string = uuid(),
  start: string = START,
  end: string = END,
): Promise<World> {
  const trip = uuid();
  const guest = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    guest,
    org,
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    start,
    end,
  ]);
  await tx.query('SELECT test_fixture.us309_set_status($1, $2)', [trip, 'IN_PROGRESS']);
  await setNow(tx, end);
  await tx.query('SELECT test_fixture.us309_returned($1)', [trip]);
  await tx.query('SELECT test_fixture.us309_card_rent($1, $2)', [
    trip,
    amountsOf(c)['rent']!.toString(),
  ]);
  const holder = (
    await tx.query<{ h: string }>('SELECT test_fixture.us309_holder($1)::text AS h', [trip])
  ).rows[0]!.h;
  await setActor(tx, { kind: 'GUEST', actorId: holder });
  const k = await keys.dekFor(tx, { type: 'USER', id: holder }, 'create');
  if (k.status !== 'OK') throw new Error(`clé du sujet : ${k.status}`);
  return { trip, guest, holder };
}

/** Photo de la série TRAFFIC du titulaire (chaîne d'US-303), octets tirés au hasard. */
async function shoot(tx: Tx, who: Buffer, trip: string, slot: string): Promise<string> {
  const cap = (await tx.query<Row>(CAPTURE, [who, trip, 'TRAFFIC', slot])).rows[0]!;
  expect(cap['outcome'], slot).toBe('DONE');
  const body = randomBytes(64);
  const fileId = uuid();
  const r = (
    await tx.query<Row>(ADD, [
      who,
      trip,
      'TRAFFIC',
      cap['capture_id'],
      slot,
      fileId,
      'image/jpeg',
      body.length,
      createHash('sha256').update(body).digest(),
      null,
    ])
  ).rows[0]!;
  expect(r['outcome'], slot).toBe('DONE');
  return fileId;
}

async function declare(
  tx: Tx,
  who: Buffer,
  trip: string,
  o: {
    readonly kind?: string;
    readonly amount: bigint;
    readonly file: string;
    readonly ref: string;
    readonly preview?: boolean;
    readonly at?: string;
  },
): Promise<Row> {
  return (
    await tx.query<Row>(DECLARE, [
      who,
      uuid(),
      trip,
      o.kind ?? 'FINE',
      o.at ?? plus(START, HOUR),
      o.amount.toString(),
      o.file,
      o.preview ?? false,
      o.ref,
    ])
  ).rows[0]!;
}

const charges = async (tx: Tx, trip: string): Promise<Row[]> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us318t_charges($1)', [trip])).rows;
const debits = async (tx: Tx, id: string): Promise<Row[]> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us318_post_trip_charges($1)', [id])).rows;
const asWorker = <T>(virtualNow: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) => payTx(client, { worker: 'payment_command', virtualNow }, fn));
const asApi = (virtualNow: string, body: (tx: Tx) => Promise<void>): Promise<void> =>
  withRole('app_api', (api) => withTestTransaction(api, { virtualNow }, body));

describe('US-318 suite 2 — clé canonique de la référence (ADR-203)', () => {
  it('F-L3-SIN-03 : casse, séparateurs, zéros de tête et lettres O / I / L dans un numéro (même en tête : revue sécurité et argent de cde5b982) donnent la même clé ; préfixe et zéros après un séparateur restent distincts (limites assumées d’ADR-203)', async () => {
    await asApi(D, async (tx) => {
      const key = async (r: string): Promise<string> =>
        (await tx.query<{ k: string }>('SELECT test_fixture.us318t_reference_key($1) AS k', [r]))
          .rows[0]!.k;
      for (const [ref, expected] of [
        ['PV 000123', 'PV123'],
        ['PV 123', 'PV123'],
        ['pv-0123', 'PV123'],
        ['PV 100200', 'PV100200'],
        ['PV 1OO2OO', 'PV100200'],
        ['pv 1oo2oo', 'PV100200'],
        ['PV-100-200', 'PV100200'],
        ['PV 1I23', 'PV1123'],
        ['PV 1l23', 'PV1123'],
        ['PV 000', 'PV0'],
        ['PV 2066-0042', 'PV20660042'],
        // lettre confondue EN TÊTE du numéro (revue sécurité et argent de cde5b982)
        ['PV I00200', 'PV100200'],
        ['PV L00200', 'PV100200'],
        ['pv i00200', 'PV100200'],
        ['PV O123', 'PV123'],
        ['PV O00200', 'PV200'],
        ['PV 000200', 'PV200'],
        ['PV OI23', 'PV123'],
        ['PV20660042', 'PV20660042'],
        // limites assumées (observation) : aucune équivalence de texte libre prétendue
        ['A-77-4410', 'A774410'],
        ['77-4410', '774410'],
        ['BOL 2024', 'B12024'],
        ['PV OIL', 'PVOIL'],
        ['PV 12-0034', 'PV120034'],
        ['PV 12-34', 'PV1234'],
      ] as const) {
        expect(await key(ref), ref).toBe(expected);
      }
    });
  });
});

describe.each(COUNTRIES)('US-318 suite 2 — refacturations ($country, $currency)', (c) => {
  const a = amountsOf(c);

  it('F-L3-SIN-03 : le même PV écrit autrement (zéros de tête, O pour 0, casse, séparateurs) sur le même trip ⇒ TRAFFIC_DUPLICATE (identifiant de la première), au récapitulatif aussi ; une refacturation par PV', async () => {
    await asApi(START, async (tx) => {
      const w = await world(tx, c);
      await setNow(tx, D);
      const h = await session(tx, w.holder);
      const files: string[] = [];
      for (const slot of ['DAMAGE_01', 'DAMAGE_02', 'DAMAGE_03']) {
        files.push(await shoot(tx, h, w.trip, slot));
      }
      const first = await declare(tx, h, w.trip, {
        amount: a['fine']!,
        file: files[0]!,
        ref: 'PV 000123',
      });
      expect(first['outcome']).toBe('DECLARED');
      const second = await declare(tx, h, w.trip, {
        amount: a['fine']!,
        file: files[1]!,
        ref: 'PV 100200',
      });
      expect(second['outcome']).toBe('DECLARED');
      for (const [ref, id] of [
        ['PV 123', first['charge_id']],
        ['pv-0123', first['charge_id']],
        ['PV 1OO2OO', second['charge_id']],
        ['pv 1oo2oo', second['charge_id']],
        ['PV-100-200', second['charge_id']],
        // lettre confondue en tête du numéro (revue sécurité et argent de cde5b982)
        ['PV O123', first['charge_id']],
        ['PV OO0123', first['charge_id']],
        ['PV I00200', second['charge_id']],
        ['PV L00200', second['charge_id']],
      ] as const) {
        for (const preview of [true, false]) {
          expect(
            await declare(tx, h, w.trip, {
              amount: a['fine']! + 1n,
              kind: 'TOLL',
              file: files[2]!,
              ref,
              preview,
            }),
            `${ref} ${String(preview)}`,
          ).toMatchObject({
            outcome: 'TRAFFIC_DUPLICATE',
            charge_id: null,
            body: { chargeId: id },
          });
        }
      }
      const rows = await charges(tx, w.trip);
      expect(rows.map((r) => r['reference_canonical_key']).sort()).toEqual(['PV100200', 'PV123']);
      // clé de 0181 inchangée (lue par la version N)
      expect(rows.map((r) => r['reference_key']).sort()).toEqual(['PV000123', 'PV100200']);
    });
  });

  it('F-L3-SIN-05 : le même PV sur deux trips du MÊME compte d’hôte ⇒ TRAFFIC_DUPLICATE (refacturé à un seul voyageur) ; un autre compte d’hôte n’est pas gêné (portée par hôte, jamais globale)', async () => {
    await asApi(START, async (tx) => {
      const org = uuid();
      const wa = await world(tx, c, org);
      const wb = await world(tx, c, org);
      const other = await world(tx, c);
      expect(wb.holder).toBe(wa.holder);
      await setNow(tx, D);
      const h = await session(tx, wa.holder);
      const ho = await session(tx, other.holder);
      const fa = await shoot(tx, h, wa.trip, 'DAMAGE_01');
      const fb = await shoot(tx, h, wb.trip, 'DAMAGE_01');
      const fo = await shoot(tx, ho, other.trip, 'DAMAGE_01');
      // numéro tout numérique commençant par 1 : la variante change son premier caractère
      const digits = `1${String(randomBytes(4).readUInt32BE(0) % 100000).padStart(5, '0')}`;
      const ref = `PV-${digits}`;
      const first = await declare(tx, h, wa.trip, { amount: a['fine']!, file: fa, ref });
      expect(first['outcome']).toBe('DECLARED');
      for (const spelled of [
        ref,
        ref.toLowerCase().replace('-', ' '),
        `PV I${digits.slice(1)}`,
        `pv l${digits.slice(1)}`,
        `PV 0${digits}`,
      ]) {
        for (const preview of [true, false]) {
          expect(
            await declare(tx, h, wb.trip, { amount: a['fine']!, file: fb, ref: spelled, preview }),
            spelled,
          ).toMatchObject({
            outcome: 'TRAFFIC_DUPLICATE',
            body: { chargeId: first['charge_id'] },
          });
        }
      }
      expect(await charges(tx, wb.trip)).toEqual([]);
      expect(
        (await declare(tx, ho, other.trip, { amount: a['fine']!, file: fo, ref }))['outcome'],
      ).toBe('DECLARED');
    });
  });

  it('F-L3-SIN-04 : au-delà du seuil cumulé du trip, la refacturation est enregistrée et marquée « revue de l’ops » (récapitulatif, déclaration) ; somme égale au seuil : pas de revue ; revue figée ; seuil absent ⇒ TRAFFIC_CAP_UNKNOWN', async () => {
    await asApi(START, async (tx) => {
      const w = await world(tx, c);
      const edge = await world(tx, c);
      await setNow(tx, D);
      const h = await session(tx, w.holder);
      const he = await session(tx, edge.holder);
      const sixty = (a['tripCap']! * 6n) / 10n;
      const forty = a['tripCap']! - sixty;
      const f1 = await shoot(tx, h, w.trip, 'DAMAGE_01');
      const f2 = await shoot(tx, h, w.trip, 'DAMAGE_02');
      const p1 = await declare(tx, h, w.trip, {
        amount: sixty,
        file: f1,
        ref: 'RT-A1',
        preview: true,
      });
      expect(p1).toMatchObject({
        outcome: 'PREVIEW',
        body: { opsReviewRequired: false, tripCapMinor: a['tripCap']!.toString() },
      });
      const d1 = await declare(tx, h, w.trip, { amount: sixty, file: f1, ref: 'RT-A1' });
      expect(d1).toMatchObject({ outcome: 'DECLARED', body: { opsReviewRequired: false } });
      const p2 = await declare(tx, h, w.trip, {
        amount: sixty,
        kind: 'IMPOUND',
        file: f2,
        ref: 'RT-A2',
        preview: true,
      });
      expect(p2).toMatchObject({
        outcome: 'PREVIEW',
        body: { opsReviewRequired: true, tripChargedMinor: sixty.toString() },
      });
      const d2 = await declare(tx, h, w.trip, {
        amount: sixty,
        kind: 'IMPOUND',
        file: f2,
        ref: 'RT-A2',
      });
      expect(d2).toMatchObject({ outcome: 'DECLARED', body: { opsReviewRequired: true } });
      expect((await charges(tx, w.trip)).map((r) => r['ops_review_required']).sort()).toEqual([
        false,
        true,
      ]);
      // borne : somme ÉGALE au seuil sans revue, + 1 unité mineure avec revue
      const e1 = await shoot(tx, he, edge.trip, 'DAMAGE_01');
      const e2 = await shoot(tx, he, edge.trip, 'DAMAGE_02');
      const e3 = await shoot(tx, he, edge.trip, 'DAMAGE_03');
      for (const [amount, file, ref, review] of [
        [sixty, e1, 'RT-E1', false],
        [forty, e2, 'RT-E2', false],
        [1n, e3, 'RT-E3', true],
      ] as const) {
        expect(await declare(tx, he, edge.trip, { amount, file, ref }), ref).toMatchObject({
          outcome: 'DECLARED',
          body: { opsReviewRequired: review },
        });
      }
      // la revue ne se retire pas, même sous migrator
      const e = await caught(tx, () =>
        tx.query('SELECT test_fixture.us318t_try_write($1, $2)', ['CLEAR_REVIEW', d2['charge_id']]),
      );
      expect(e).toMatchObject({ code: '23000', constraint: 'claim_p2p_record_immutable' });
      // seuil absent (fermé dans la transaction annulée) : fail-closed, rien d'écrit
      await setNow(tx, plus(D, 1000));
      await tx.query('SELECT test_fixture.us318t_param_close($1)', [c.country]);
      await setNow(tx, plus(D, 2000));
      const h2 = await session(tx, w.holder);
      const f3 = await shoot(tx, h2, w.trip, 'DAMAGE_03');
      expect(
        (await declare(tx, h2, w.trip, { amount: a['fine']!, file: f3, ref: 'RT-A3' }))['outcome'],
      ).toBe('TRAFFIC_CAP_UNKNOWN');
      expect(await charges(tx, w.trip)).toHaveLength(2);
    });
  });

  it('F-L3-SIN-04 (exécution) : une refacturation à revoir n’est jamais débitée sans décision de l’ops — payée ou sans réponse ⇒ BLOCKED TRAFFIC_OPS_REVIEW_REQUIRED, aucun débit ; contestée puis décidée par ADMIN ⇒ débitée (OPS_DECISION) ; rejetée par l’ops ⇒ VOID et hors du cumul', async () => {
    const ids = await withRole('app_api', (api) =>
      withTestTransaction(api, { virtualNow: START, commit: true }, async (tx) => {
        const admin = await staff(tx, 'ADMIN', [c.country]);
        const w = await world(tx, c);
        await setNow(tx, D);
        const h = await session(tx, w.holder);
        const out: Record<string, string> = {};
        // la première remplit le seuil (rejetée ensuite) ; les suivantes sont à revoir
        for (const [name, slot, amount] of [
          ['rejected', 'DAMAGE_01', a['tripCap']!],
          ['paid', 'DAMAGE_02', a['fine']!],
          ['silent', 'DAMAGE_03', a['fine']!],
          ['disputed', 'DAMAGE_04', a['fine']!],
        ] as const) {
          const f = await shoot(tx, h, w.trip, slot);
          const r = await declare(tx, h, w.trip, {
            amount,
            file: f,
            ref: `PV-${name}-${uuid().slice(0, 6)}`,
          });
          expect(r, name).toMatchObject({
            outcome: 'DECLARED',
            body: { opsReviewRequired: name !== 'rejected' },
          });
          out[name] = String(r['charge_id']);
        }
        await setNow(tx, plus(D, HOUR));
        const g = await session(tx, w.guest);
        expect((await tx.query<{ r: string }>(ACCEPT, [g, out['paid']])).rows[0]!.r).toBe(
          'ACCEPTED',
        );
        for (const name of ['disputed', 'rejected']) {
          expect(
            (await tx.query<{ r: string }>(DISPUTE, [g, out[name], DISPUTE_REASON, []])).rows[0]!.r,
            name,
          ).toBe('DISPUTED');
        }
        await setNow(tx, plus(D, 2 * HOUR));
        for (const [name, outcome] of [
          ['disputed', 'CHARGE'],
          ['rejected', 'REJECT'],
        ] as const) {
          const hash = await elevated(tx, admin);
          const r = (await tx.query<Row>(DECIDE, [hash, uuid(), out[name], outcome, RATIONALE]))
            .rows[0]!;
          expect(r['outcome'], name).toBe('DECIDED');
        }
        // rejetée : hors du cumul ; somme des autres + ce montant = le seuil exactement ⇒ pas de revue
        const f6 = await shoot(tx, h, w.trip, 'DAMAGE_06');
        const after = await declare(tx, h, w.trip, {
          amount: a['tripCap']! - 3n * a['fine']!,
          file: f6,
          ref: `PV-after-${uuid().slice(0, 6)}`,
        });
        expect(after).toMatchObject({ outcome: 'DECLARED', body: { opsReviewRequired: false } });
        out['after'] = String(after['charge_id']);
        out['trip'] = w.trip;
        return out;
      }),
    );
    // payée : jamais débitée sans l'ops, même tout de suite
    await asWorker(plus(D, 3 * HOUR), async (tx) => {
      expect((await tx.query<Row>(EXECUTE, [ids['paid'], uuid()])).rows[0]).toEqual({
        outcome: 'BLOCKED',
        code: 'TRAFFIC_OPS_REVIEW_REQUIRED',
      });
      expect(await debits(tx, ids['paid']!)).toEqual([]);
    });
    await asWorker(DUE, async (tx) => {
      for (const name of ['silent']) {
        expect((await tx.query<Row>(EXECUTE, [ids[name], uuid()])).rows[0], name).toEqual({
          outcome: 'BLOCKED',
          code: 'TRAFFIC_OPS_REVIEW_REQUIRED',
        });
        expect(await debits(tx, ids[name]!), name).toEqual([]);
      }
      // contestée puis décidée par ADMIN : débitée sur décision de l'ops
      expect((await tx.query<Row>(EXECUTE, [ids['disputed'], uuid()])).rows[0]).toEqual({
        outcome: 'DONE',
        code: null,
      });
      expect(await debits(tx, ids['disputed']!)).toHaveLength(1);
      expect((await tx.query<Row>(EXECUTE, [ids['rejected'], uuid()])).rows[0]).toMatchObject({
        outcome: 'VOID',
      });
      const rows = await charges(tx, ids['trip']!);
      const byId = new Map(rows.map((r) => [String(r['id']), r]));
      expect(byId.get(ids['disputed']!)).toMatchObject({
        ops_review_required: true,
        charge_basis: 'OPS_DECISION',
      });
      // en revue : payée et silencieuse sans débit, contestée débitée sur décision de l'ops
      const reviewed = rows.filter((r) => r['ops_review_required'] === true);
      expect(reviewed).toHaveLength(3);
      expect(new Map(reviewed.map((r) => [String(r['id']), r['charge_basis']]))).toEqual(
        new Map([
          [ids['paid']!, null],
          [ids['silent']!, null],
          [ids['disputed']!, 'OPS_DECISION'],
        ]),
      );
    });
    // sous le seuil (après le rejet) : la règle d'US-318 suite, échéance passée sans réponse ⇒ débitée
    await asWorker(plus(DUE, 3 * HOUR), async (tx) => {
      expect((await tx.query<Row>(EXECUTE, [ids['after'], uuid()])).rows[0]).toEqual({
        outcome: 'DONE',
        code: null,
      });
      expect(await debits(tx, ids['after']!)).toHaveLength(1);
    });
  });

  it('F-L3-SIN-05 (course) : le même PV déclaré EN MÊME TEMPS sur deux trips du même hôte — la seconde attend le verrou de l’hôte puis TRAFFIC_DUPLICATE ; un seul voyageur refacturé', async () => {
    const s = await withRole('app_api', (api) =>
      withTestTransaction(api, { virtualNow: R_START, commit: true }, async (tx) => {
        const org = uuid();
        const wa = await world(tx, c, org, R_START, R_END);
        const wb = await world(tx, c, org, R_START, R_END);
        await setNow(tx, plus(R_END, 1000));
        const h = await session(tx, wa.holder);
        return {
          h,
          tripA: wa.trip,
          tripB: wb.trip,
          fa: await shoot(tx, h, wa.trip, 'DAMAGE_01'),
          fb: await shoot(tx, h, wb.trip, 'DAMAGE_01'),
        };
      }),
    );
    const ref = `PV ${uuid().slice(0, 8)}`;
    const call = (trip: string, file: string, spelled: string): unknown[] => [
      s.h,
      uuid(),
      trip,
      'FINE',
      plus(R_START, HOUR),
      a['fine']!.toString(),
      file,
      false,
      spelled,
    ];
    const begin = async (client: Tx): Promise<void> => {
      await client.query('BEGIN');
      await setVirtualNow(client, R_AT);
      await client.query(`SET LOCAL lock_timeout = '15s'`);
      await client.query(`SET LOCAL statement_timeout = '30s'`);
    };
    await withRole('app_worker', (observer) =>
      withRole('app_api', (one) =>
        withRole('app_api', async (two) => {
          try {
            await begin(one);
            const first = (await one.query<Row>(DECLARE, call(s.tripA, s.fa, ref))).rows[0]!;
            expect(first['outcome']).toBe('DECLARED');
            const pid = await backendPid(two);
            const holder = await backendPid(one);
            await begin(two);
            const pending = two.query<Row>(
              DECLARE,
              call(s.tripB, s.fb, ref.toLowerCase().replace(' ', '-')),
            );
            await waitUntilBlocked(observer, pid, 'advisory');
            const b = await observer.query<{ b: number[] }>(
              'SELECT pg_catalog.pg_blocking_pids($1) AS b',
              [pid],
            );
            expect(b.rows[0]?.b).toContain(holder);
            await one.query('COMMIT');
            const second = (await pending).rows[0]!;
            expect(second).toMatchObject({
              outcome: 'TRAFFIC_DUPLICATE',
              charge_id: null,
              body: { chargeId: first['charge_id'] },
            });
            expect(await charges(two, s.tripB)).toEqual([]);
            expect((await charges(two, s.tripA)).map((r) => r['id'])).toEqual([first['charge_id']]);
            await two.query('ROLLBACK');
          } finally {
            await one.query('ROLLBACK').catch(() => undefined);
            await two.query('ROLLBACK').catch(() => undefined);
          }
        }),
      ),
    );
  });

  it('F-L3-SIN-04 (course) : deux déclarations SIMULTANÉES sur le même trip, chacune à 60 % du seuil cumulé — la seconde attend le verrou puis relit la somme : une seule échappe à la revue de l’ops', async () => {
    const s = await withRole('app_api', (api) =>
      withTestTransaction(api, { virtualNow: R_START, commit: true }, async (tx) => {
        const w = await world(tx, c, uuid(), R_START, R_END);
        await setNow(tx, plus(R_END, 1000));
        const h = await session(tx, w.holder);
        return {
          h,
          trip: w.trip,
          f1: await shoot(tx, h, w.trip, 'DAMAGE_01'),
          f2: await shoot(tx, h, w.trip, 'DAMAGE_02'),
        };
      }),
    );
    const sixty = (a['tripCap']! * 6n) / 10n;
    const call = (file: string, kind: string): unknown[] => [
      s.h,
      uuid(),
      s.trip,
      kind,
      plus(R_START, HOUR),
      sixty.toString(),
      file,
      false,
      `RT-${uuid().slice(0, 8)}`,
    ];
    const begin = async (client: Tx): Promise<void> => {
      await client.query('BEGIN');
      await setVirtualNow(client, R_AT);
      await client.query(`SET LOCAL lock_timeout = '15s'`);
      await client.query(`SET LOCAL statement_timeout = '30s'`);
    };
    await withRole('app_worker', (observer) =>
      withRole('app_api', (one) =>
        withRole('app_api', async (two) => {
          try {
            await begin(one);
            const first = (await one.query<Row>(DECLARE, call(s.f1, 'FINE'))).rows[0]!;
            expect(first).toMatchObject({
              outcome: 'DECLARED',
              body: { opsReviewRequired: false },
            });
            const pid = await backendPid(two);
            const holder = await backendPid(one);
            await begin(two);
            const pending = two.query<Row>(DECLARE, call(s.f2, 'IMPOUND'));
            await waitUntilBlocked(observer, pid, 'advisory');
            const b = await observer.query<{ b: number[] }>(
              'SELECT pg_catalog.pg_blocking_pids($1) AS b',
              [pid],
            );
            expect(b.rows[0]?.b).toContain(holder);
            await one.query('COMMIT');
            const second = (await pending).rows[0]!;
            expect(second).toMatchObject({
              outcome: 'DECLARED',
              body: { opsReviewRequired: true },
            });
            const rows = await charges(two, s.trip);
            expect(rows).toHaveLength(2);
            expect(rows.filter((r) => r['ops_review_required'] !== true)).toHaveLength(1);
            await two.query('ROLLBACK');
          } finally {
            await one.query('ROLLBACK').catch(() => undefined);
            await two.query('ROLLBACK').catch(() => undefined);
          }
        }),
      ),
    );
  });
});
