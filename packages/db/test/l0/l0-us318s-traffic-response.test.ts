/**
 * US-318 (suite) — refacturation des amendes, péages et fourrières : référence unique par trip,
 * délai de réponse du voyageur, contestation, décision de l'ops, plafond du pays (migration 0181,
 * ADR-201 ; fixtures 9904, 9906, 9907, 9909, 9300, 9650). Correctifs des constats de la red team du
 * lot 3 F-L3-SIN-01 (débit en double) et F-L3-SIN-02 (débit sans réponse ni recours). Rôles de
 * PRODUCTION seulement (assertion L0-05 par `withRole`), au Panama (USD) et au Paraguay (PYG sans
 * décimale).
 *
 * Attendus (jamais le code testé) :
 * - 08 BR-REIMB-05 (« interdites : […] doublons, montant non justifié ») et rapport de la red team
 *   (F-L3-SIN-01 : deux photos du même PV, heure + 1 s, montant + 1, autre nature) : une seule
 *   refacturation par référence d'avis ou de PV sur un trip ;
 * - 08 BR-TT-02 (« 48 h pour payer/contester »), BR-TT-03 (mêmes délais), BR-REIMB-02 / 03
 *   (fenêtre jamais rouverte, contestation, décision de l'ops) ; ADR-195 (débit décidé réservé à
 *   ADMIN, motif, jamais « définitif ») ; ADR-122 (séparation des tâches) ;
 * - plafond PROPOSÉ `traffic_guest_charge_max_minor` (ADR-201) : 1 000,00 USD, 7 500 000 PYG ;
 *   les montants « absurdes » de la red team (50 000,00 USD, 500 000 000 PYG) sont refusés ;
 * - frais de gestion de 5 % de l'oracle `packages/money/test/oracle/traffic_fee_oracle.py`
 *   (USD 1 230 ⇒ 62, PYG 25 010 ⇒ 1 251 ; voir l0-us318-p2p-claims).
 *
 * Années virtuelles propres au fichier : 2066. Données des mondes VALIDÉES (déclarations, réponses
 * et décisions sont des commandes de l'API, l'exécution une commande du travailleur : deux rôles) ;
 * exécutions du travailleur, lectures et écritures interdites dans des transactions ANNULÉES.
 * Octets de photo tirés au hasard (index d'empreinte unique, 0176). Aucun interrupteur écrit.
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
import type { Staff } from '../support/claims.ts';
import { openSession } from '../support/iam.ts';
import { caught, payTx } from '../support/pay.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;
const uuid = (): string => randomUUID();
const HOUR = 3_600_000;
const plus = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

const START = '2066-05-04T10:00:00.000Z';
const END = '2066-05-07T10:00:00.000Z';
/** Déclaration : une heure après le retour (heure de la base). */
const D = plus(END, HOUR);
/** 08 BR-TT-02 : 48 h pour payer ou contester ; échéance exclue. */
const DUE = plus(D, 48 * HOUR);

/** Par pays (ordre de COUNTRIES) : amende, frais de l'oracle, loyer, plafond PROPOSÉ, absurde. */
const AMOUNTS: readonly Readonly<Record<string, bigint>>[] = [
  { fine: 1230n, fee: 62n, rent: 30000n, cap: 100000n, absurd: 5_000_000n },
  { fine: 25010n, fee: 1251n, rent: 2000000n, cap: 7500000n, absurd: 500_000_000n },
];
const amountsOf = (c: CountryCase): Readonly<Record<string, bigint>> =>
  AMOUNTS[COUNTRIES.indexOf(c)]!;

const CAPTURE = 'SELECT * FROM core.trip_cmd_open_photo_capture($1, $2::uuid, $3, $4)';
const ADD = `SELECT * FROM core.trip_cmd_add_inspection_photo($1, $2::uuid, $3, $4::uuid, $5, $6::uuid,
                                                              $7, $8::bigint, $9, $10::timestamptz)`;
const DECLARE = `SELECT outcome, charge_id::text AS charge_id, body
  FROM core.claim_cmd_declare_traffic_charge($1, $2::uuid, $3::uuid, $4, $5::timestamptz, $6::bigint,
                                             $7::uuid, $8, $9)`;
const DECLARE_V1 = `SELECT outcome, charge_id::text AS charge_id, body
  FROM core.claim_cmd_declare_traffic_charge($1, $2::uuid, $3::uuid, $4, $5::timestamptz, $6::bigint,
                                             $7::uuid, $8)`;
const ACCEPT = 'SELECT core.claim_cmd_accept_traffic_charge($1, $2::uuid) AS r';
const DISPUTE = 'SELECT core.claim_cmd_dispute_traffic_charge($1, $2::uuid, $3, $4::uuid[]) AS r';
const GUEST_VIEW = 'SELECT core.claim_traffic_guest_view($1, $2::uuid) AS v';
const HOST_VIEW = 'SELECT core.claim_host_trip_claims($1, $2::uuid) AS v';
const DECIDE = `SELECT outcome, body
  FROM core.support_staff_decide_traffic_charge($1, $2::uuid, $3::uuid, $4, $5)`;
const STAFF_VIEW =
  'SELECT outcome, body FROM core.support_staff_traffic_charge($1, $2::uuid, $3::uuid)';
const REVIEW = 'SELECT outcome, body FROM core.support_staff_traffic_review($1, $2::uuid)';
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

/** Trip du pays de START à END, rendu à END, loyer par carte ; voyageur imposé si donné. */
async function world(tx: Tx, c: CountryCase, guest: string = uuid()): Promise<World> {
  const trip = uuid();
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
  await tx.query('SELECT test_fixture.us309_set_status($1, $2)', [trip, 'IN_PROGRESS']);
  await setNow(tx, END);
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
    readonly at?: string;
    readonly amount: bigint;
    readonly file: string;
    readonly ref: string | null;
    readonly preview?: boolean;
    readonly req?: string;
  },
): Promise<Row> {
  return (
    await tx.query<Row>(DECLARE, [
      who,
      o.req ?? uuid(),
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

const state = async (tx: Tx, id: string): Promise<Row> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us318s_state($1)', [id])).rows[0]!;
const debits = async (tx: Tx, id: string): Promise<Row[]> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us318_post_trip_charges($1)', [id])).rows;
const asWorker = <T>(virtualNow: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) => payTx(client, { worker: 'payment_command', virtualNow }, fn));

async function decide(
  tx: Tx,
  who: Staff,
  id: string,
  outcome: string,
  rationale = RATIONALE,
  requestId = uuid(),
): Promise<Row> {
  const hash = await elevated(tx, who);
  return (await tx.query<Row>(DECIDE, [hash, requestId, id, outcome, rationale])).rows[0]!;
}

describe.each(COUNTRIES)('US-318 suite — refacturations ($country, $currency)', (c) => {
  const a = amountsOf(c);

  it('F-L3-SIN-01 : une refacturation par référence de PV sur un trip — deux photos du même PV, heure + 1 s, montant + 1, autre nature, référence saisie autrement : TRAFFIC_DUPLICATE (déclaration et récapitulatif), rien d’écrit ; sans référence (y compris l’ancienne signature) : TRAFFIC_REFERENCE_REQUIRED ; référence mal formée : 22023 ; une autre référence passe', async () => {
    await withRole('app_api', (api) =>
      withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c);
        await setNow(tx, D);
        const h = await session(tx, w.holder);
        const files: string[] = [];
        for (const slot of ['DAMAGE_01', 'DAMAGE_02', 'DAMAGE_03', 'DAMAGE_04', 'DAMAGE_05']) {
          files.push(await shoot(tx, h, w.trip, slot));
        }
        const first = await declare(tx, h, w.trip, {
          amount: a['fine']!,
          file: files[0]!,
          ref: 'PV 2066-0042',
        });
        expect(first['outcome']).toBe('DECLARED');
        expect(first['body']).toMatchObject({
          totalMinor: (a['fine']! + a['fee']!).toString(),
          responseDueAt: DUE,
        });
        // le même PV photographié à nouveau, saisi avec des variantes
        const variants = [
          { amount: a['fine']!, ref: 'PV 2066-0042' },
          { amount: a['fine']!, ref: 'pv-2066/0042', at: plus(START, HOUR + 1000) },
          { amount: a['fine']! + 1n, ref: 'PV.2066.0042' },
          { amount: a['fine']!, ref: 'PV20660042', kind: 'TOLL' },
          { amount: a['fine']!, ref: 'PV 2066 0042', kind: 'IMPOUND' },
        ];
        for (const [i, v] of variants.entries()) {
          for (const preview of [true, false]) {
            const r = await declare(tx, h, w.trip, { ...v, file: files[1 + (i % 4)]!, preview });
            expect(r, `${v.ref} ${preview}`).toMatchObject({
              outcome: 'TRAFFIC_DUPLICATE',
              charge_id: null,
              body: { chargeId: first['charge_id'] },
            });
          }
        }
        // sans référence : refus explicite (nouvelle et ancienne signature)
        for (const ref of [null, '', '   ']) {
          expect(
            (await declare(tx, h, w.trip, { amount: a['fine']!, file: files[1]!, ref }))['outcome'],
          ).toBe('TRAFFIC_REFERENCE_REQUIRED');
        }
        const v1 = (
          await tx.query<Row>(DECLARE_V1, [
            h,
            uuid(),
            w.trip,
            'FINE',
            plus(START, HOUR),
            a['fine']!.toString(),
            files[1],
            false,
          ])
        ).rows[0]!;
        expect(v1).toMatchObject({ outcome: 'TRAFFIC_REFERENCE_REQUIRED', charge_id: null });
        // le voyageur ne déclare pas (même réponse qu'un inconnu, avant la référence)
        expect(
          (
            await declare(tx, await session(tx, w.guest), w.trip, {
              amount: a['fine']!,
              file: files[1]!,
              ref: null,
            })
          )['outcome'],
        ).toBe('NOT_FOUND');
        const charges = (
          await tx.query<Row>('SELECT * FROM test_fixture.us318s_charges($1)', [w.trip])
        ).rows;
        expect(charges).toEqual([
          expect.objectContaining({ id: first['charge_id'], reference_key: 'PV20660042' }),
        ]);
        // une autre référence (autre PV) passe, avec une autre pièce
        const h2 = await session(tx, w.holder);
        const other = await declare(tx, h2, w.trip, {
          kind: 'TOLL',
          amount: a['fine']!,
          file: files[1]!,
          ref: 'PEAJE-77',
        });
        expect(other['outcome']).toBe('DECLARED');
        // un avis au voyageur par refacturation (EVT_INVOICE_TO_GUEST, US-706)
        for (const id of [first['charge_id'], other['charge_id']]) {
          const ev = (await tx.query<Row>('SELECT * FROM test_fixture.us318s_events($1)', [id]))
            .rows;
          expect(ev).toHaveLength(1);
          expect(ev[0]).toMatchObject({
            type: 'invoice.status_changed',
            aggregate_type: 'traffic_charge',
            actor_role: 'HOST',
            actor_user_id: w.holder,
            country_code: c.country,
            payload: {
              invoice_id: id,
              trip_id: w.trip,
              status: 'AWAITING_GUEST',
              currency: c.currency,
              amount_minor: (a['fine']! + a['fee']!).toString(),
              response_due_at: DUE,
            },
          });
        }
        // référence mal formée (courriel, trop courte, caractères hors liste) : entrée invalide
        for (const ref of ['ana@correo.com', 'P-1', 'PV#12345', `PV${'9'.repeat(40)}`]) {
          const e = await caught(tx, () =>
            declare(tx, h2, w.trip, { amount: a['fine']!, file: files[2]!, ref }),
          );
          expect(e, ref).toMatchObject({ code: '22023' });
        }
        // registre figé : référence et échéance ne se réécrivent pas, même sous migrator
        for (const what of ['REFERENCE', 'REOPEN_WINDOW']) {
          const e = await caught(tx, () =>
            tx.query('SELECT test_fixture.us318s_try_write($1, $2)', [what, first['charge_id']]),
          );
          expect(e, what).toMatchObject({
            code: '23000',
            constraint: 'claim_p2p_record_immutable',
          });
        }
      }),
    );
  });

  it('F-L3-SIN-02 (plafond) : montant au plafond du pays accepté, plafond + 1 et montant absurde de la red team refusés TRAFFIC_AMOUNT_ABOVE_CAP (capMinor rendu), rien d’écrit ; délai du voyageur ou plafond illisibles : TRAFFIC_RESPONSE_WINDOW_UNKNOWN / TRAFFIC_CAP_UNKNOWN', async () => {
    await withRole('app_api', (api) =>
      withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c);
        await setNow(tx, D);
        const h = await session(tx, w.holder);
        const f = await shoot(tx, h, w.trip, 'DAMAGE_01');
        const ref = (): string => `PV-${uuid().slice(0, 8)}`;
        const atCap = await declare(tx, h, w.trip, {
          amount: a['cap']!,
          file: f,
          ref: ref(),
          preview: true,
        });
        expect(atCap['outcome']).toBe('PREVIEW');
        expect(atCap['body']).toMatchObject({
          amountMinor: a['cap']!.toString(),
          capMinor: a['cap']!.toString(),
          responseHours: 48,
        });
        for (const amount of [a['cap']! + 1n, a['absurd']!]) {
          for (const preview of [true, false]) {
            const r = await declare(tx, h, w.trip, { amount, file: f, ref: ref(), preview });
            expect(r, `${amount}`).toMatchObject({
              outcome: 'TRAFFIC_AMOUNT_ABOVE_CAP',
              charge_id: null,
              body: { capMinor: a['cap']!.toString(), currency: c.currency },
            });
          }
        }
        expect(
          (await tx.query('SELECT * FROM test_fixture.us318s_charges($1)', [w.trip])).rows,
        ).toEqual([]);
        // paramètres illisibles (nouvelle version dans la transaction annulée) : fail-closed
        await setNow(tx, plus(D, 1000));
        await tx.query('SELECT test_fixture.us318s_param_version($1, $2, $3::jsonb)', [
          'traffic_guest_charge_max_minor',
          c.country,
          JSON.stringify('beaucoup'),
        ]);
        await setNow(tx, plus(D, 2000));
        const h2 = await session(tx, w.holder);
        expect(
          (await declare(tx, h2, w.trip, { amount: a['fine']!, file: f, ref: ref() }))['outcome'],
        ).toBe('TRAFFIC_CAP_UNKNOWN');
        await tx.query('SELECT test_fixture.us318s_param_version($1, $2, $3::jsonb)', [
          'traffic_guest_response_h',
          c.country,
          '0',
        ]);
        await setNow(tx, plus(D, 3000));
        const h3 = await session(tx, w.holder);
        expect(
          (await declare(tx, h3, w.trip, { amount: a['fine']!, file: f, ref: ref() }))['outcome'],
        ).toBe('TRAFFIC_RESPONSE_WINDOW_UNKNOWN');
        expect((await tx.query<{ v: Row }>(HOST_VIEW, [h3, w.trip])).rows[0]!.v).toMatchObject({
          open: false,
          responseHours: null,
          capMinor: null,
        });
        expect(
          (await tx.query('SELECT * FROM test_fixture.us318s_charges($1)', [w.trip])).rows,
        ).toEqual([]);
      }),
    );
  });

  it('F-L3-SIN-02 (délai, contestation, décision) : aucun débit à la déclaration ni à DUE − 1 ms ; payée ⇒ débitée (accord écrit) ; sans réponse ⇒ débitée à DUE ; contestée ⇒ jamais débitée avant la décision, ADMIN seul débite, rejet ⇒ VOID ; fenêtre jamais rouverte ; ADR-122 ; vues du voyageur, de l’hôte et de la console', async () => {
    const ids = await withRole('app_api', (api) =>
      withTestTransaction(api, { virtualNow: START, commit: true }, async (tx) => {
        const ops = await staff(tx, 'OPS_AGENT', [c.country]);
        const admin = await staff(tx, 'ADMIN', [c.country]);
        const party = await staff(tx, 'ADMIN', [c.country]);
        const w = await world(tx, c);
        const self = await world(tx, c, party.id);
        await setNow(tx, D);
        const h = await session(tx, w.holder);
        const hs = await session(tx, self.holder);
        const out: Record<string, string> = { trip: w.trip };
        for (const [name, slot] of [
          ['silent', 'DAMAGE_01'],
          ['paid', 'DAMAGE_02'],
          ['disputed', 'DAMAGE_03'],
          ['rejected', 'DAMAGE_04'],
          ['late', 'DAMAGE_05'],
        ] as const) {
          const f = await shoot(tx, h, w.trip, slot);
          const r = await declare(tx, h, w.trip, {
            amount: a['fine']!,
            file: f,
            ref: `PV-${name}-${uuid().slice(0, 6)}`,
          });
          expect(r['outcome'], name).toBe('DECLARED');
          out[name] = String(r['charge_id']);
        }
        const fs = await shoot(tx, hs, self.trip, 'DAMAGE_01');
        const rs = await declare(tx, hs, self.trip, {
          amount: a['fine']!,
          file: fs,
          ref: `PV-self-${uuid().slice(0, 6)}`,
        });
        expect(rs['outcome']).toBe('DECLARED');
        out['self'] = String(rs['charge_id']);
        for (const name of ['silent', 'paid', 'disputed', 'rejected', 'late', 'self']) {
          expect(await state(tx, out[name]!), name).toMatchObject({
            rules_version: 2,
            guest_status: 'AWAITING_GUEST',
            execution_status: 'PENDING',
            response_hours: 48,
            response_due_at: new Date(DUE),
            due: false,
          });
        }

        // vue du voyageur : montants, échéance, réponse possible ; l'hôte et un tiers : rien
        const g = await session(tx, w.guest);
        const view = (await tx.query<{ v: Row }>(GUEST_VIEW, [g, w.trip])).rows[0]!.v;
        expect(view).toMatchObject({ tripId: w.trip, currency: c.currency });
        expect(view['charges'] as Row[]).toHaveLength(5);
        expect((view['charges'] as Row[]).find((x) => x['id'] === out['paid'])).toMatchObject({
          kind: 'FINE',
          amountMinor: a['fine']!.toString(),
          adminFeeMinor: a['fee']!.toString(),
          totalMinor: (a['fine']! + a['fee']!).toString(),
          responseDueAt: DUE,
          status: 'AWAITING_GUEST',
          canRespond: true,
        });
        expect((await tx.query<{ v: unknown }>(GUEST_VIEW, [h, w.trip])).rows[0]!.v).toBeNull();
        expect(
          (await tx.query<{ v: unknown }>(GUEST_VIEW, [await session(tx, self.guest), w.trip]))
            .rows[0]!.v,
        ).toBeNull();

        // réponses : l'hôte et un tiers ne répondent pas ; le voyageur paie ou conteste
        expect((await tx.query<{ r: string }>(ACCEPT, [h, out['paid']])).rows[0]!.r).toBe(
          'NOT_FOUND',
        );
        expect(
          (await tx.query<{ r: string }>(ACCEPT, [await session(tx, self.guest), out['paid']]))
            .rows[0]!.r,
        ).toBe('NOT_FOUND');
        await setNow(tx, plus(D, HOUR));
        const g3 = await session(tx, w.guest);
        expect((await tx.query<{ r: string }>(ACCEPT, [g3, out['paid']])).rows[0]!.r).toBe(
          'ACCEPTED',
        );
        expect((await tx.query<{ r: string }>(ACCEPT, [g3, out['paid']])).rows[0]!.r).toBe(
          'ALREADY_ACCEPTED',
        );
        expect(
          (await tx.query<{ r: string }>(DISPUTE, [g3, out['paid'], DISPUTE_REASON, []])).rows[0]!
            .r,
        ).toBe('TRAFFIC_NOT_OPEN');
        // contestation à DUE − 1 ms : motif exigé, pièce étrangère refusée, sans pièce acceptée
        await setNow(tx, plus(DUE, -1));
        const g4 = await session(tx, w.guest);
        expect(
          (await tx.query<{ r: string }>(DISPUTE, [g4, out['disputed'], 'trop court', []])).rows[0]!
            .r,
        ).toBe('INCIDENTAL_DISPUTE_REASON_REQUIRED');
        expect(
          (await tx.query<{ r: string }>(DISPUTE, [g4, out['disputed'], DISPUTE_REASON, [uuid()]]))
            .rows[0]!.r,
        ).toBe('CLAIM_EVIDENCE_MISSING');
        const inner = (
          await tx.query<{ id: string }>(
            'SELECT test_fixture.us706_photo($1, $2, $3, $4)::text AS id',
            [w.trip, 'CHECKOUT', 'INT_02', 'GUEST'],
          )
        ).rows[0]!.id;
        await setNow(tx, plus(DUE, -1));
        expect(
          (await tx.query<{ r: string }>(DISPUTE, [g4, out['disputed'], DISPUTE_REASON, [inner]]))
            .rows[0]!.r,
        ).toBe('DISPUTED');
        expect(
          (await tx.query<{ r: string }>(DISPUTE, [g4, out['disputed'], DISPUTE_REASON, []]))
            .rows[0]!.r,
        ).toBe('ALREADY_DISPUTED');
        for (const name of ['rejected', 'self'] as const) {
          const who = name === 'self' ? await session(tx, self.guest) : g4;
          expect(
            (await tx.query<{ r: string }>(DISPUTE, [who, out[name], DISPUTE_REASON, []])).rows[0]!
              .r,
            name,
          ).toBe('DISPUTED');
        }
        expect(await state(tx, out['disputed']!)).toMatchObject({
          guest_status: 'DISPUTED',
          dispute_reason: DISPUTE_REASON,
          dispute_evidence_file_ids: [inner],
          due: false,
        });
        // la contestation ne se défait pas, même sous migrator
        expect(
          await caught(tx, () =>
            tx.query('SELECT test_fixture.us318s_try_write($1, $2)', [
              'UNDISPUTE',
              out['disputed'],
            ]),
          ),
        ).toMatchObject({ code: '23000', constraint: 'claim_p2p_record_immutable' });
        // à DUE exactement : fenêtre close, jamais rouverte
        await setNow(tx, DUE);
        const g5 = await session(tx, w.guest);
        expect((await tx.query<{ r: string }>(ACCEPT, [g5, out['late']])).rows[0]!.r).toBe(
          'GUEST_RESPONSE_WINDOW_CLOSED',
        );
        expect(
          (await tx.query<{ r: string }>(DISPUTE, [g5, out['late'], DISPUTE_REASON, []])).rows[0]!
            .r,
        ).toBe('GUEST_RESPONSE_WINDOW_CLOSED');
        expect(await state(tx, out['late']!)).toMatchObject({
          guest_status: 'AWAITING_GUEST',
          due: true,
        });

        // vue de l'hôte : réponse du voyageur par refacturation
        const hv = (await tx.query<{ v: Row }>(HOST_VIEW, [await session(tx, w.holder), w.trip]))
          .rows[0]!.v;
        expect(hv).toMatchObject({ responseHours: 48, capMinor: a['cap']!.toString() });
        expect((hv['charges'] as Row[]).find((x) => x['id'] === out['disputed'])).toMatchObject({
          guestStatus: 'DISPUTED',
          responseDueAt: DUE,
          status: 'PENDING',
        });

        // console : liste « à revoir » (contestées) ; l'agent partie au trip n'y voit pas le sien
        await setNow(tx, plus(DUE, HOUR));
        const list = async (who: Staff): Promise<Row[]> => {
          const r = (await tx.query<Row>(REVIEW, [await elevated(tx, who), uuid()])).rows[0]!;
          expect(r['outcome']).toBe('OK');
          return (r['body'] as Row)['charges'] as Row[];
        };
        const seen = (await list(ops)).map((x) => x['id']);
        expect(seen).toEqual(
          expect.arrayContaining([out['disputed'], out['rejected'], out['self']]),
        );
        expect(seen).not.toContain(out['paid']);
        expect(seen).not.toContain(out['late']);
        expect((await list(party)).map((x) => x['id'])).not.toContain(out['self']);

        // décision : non contestée refusée ; OPS ne débite pas ; motif ; jamais « définitive » ;
        // ADR-122 ; ADMIN débite ; OPS rejette
        expect((await decide(tx, admin, out['late']!, 'CHARGE'))['outcome']).toBe(
          'TRAFFIC_NOT_DISPUTED',
        );
        expect((await decide(tx, ops, out['disputed']!, 'CHARGE'))['outcome']).toBe(
          'DECISION_ADMIN_REQUIRED',
        );
        expect((await decide(tx, admin, out['disputed']!, 'CHARGE', 'court'))['outcome']).toBe(
          'DECISION_RATIONALE_REQUIRED',
        );
        expect(
          (
            await decide(
              tx,
              admin,
              out['disputed']!,
              'CHARGE',
              'Decisión definitiva tras revisar el aviso oficial de la multa.',
            )
          )['outcome'],
        ).toBe('DECISION_FINALITY_FORBIDDEN');
        expect((await decide(tx, party, out['self']!, 'CHARGE'))['outcome']).toBe('SELF_FORBIDDEN');
        expect(
          (await tx.query<Row>(STAFF_VIEW, [await elevated(tx, party), uuid(), out['self']]))
            .rows[0]!['outcome'],
        ).toBe('SELF_FORBIDDEN');
        const req = uuid();
        const ok = await decide(tx, admin, out['disputed']!, 'CHARGE', RATIONALE, req);
        expect(ok['outcome']).toBe('DECIDED');
        expect(ok['body']).toMatchObject({
          status: 'DECIDED_CHARGE',
          decision: { outcome: 'CHARGE', role: 'ADMIN', rationale: RATIONALE },
          disputeReason: DISPUTE_REASON,
          legs: {
            HOST: a['fine']!.toString(),
            INSURER: '0',
            TAX_THIRD_PARTY: '0',
            PLATFORM: a['fee']!.toString(),
          },
        });
        expect(
          (await decide(tx, admin, out['disputed']!, 'CHARGE', RATIONALE, req))['outcome'],
        ).toBe('ALREADY_DECIDED');
        expect((await decide(tx, ops, out['rejected']!, 'REJECT'))['outcome']).toBe('DECIDED');
        expect(await state(tx, out['rejected']!)).toMatchObject({
          guest_status: 'REJECTED',
          execution_status: 'VOID',
          decided_role: 'OPS_AGENT',
          due: false,
        });
        expect(
          await caught(tx, () =>
            tx.query('SELECT test_fixture.us318s_try_write($1, $2)', ['REDECIDE', out['disputed']]),
          ),
        ).toMatchObject({ code: '23000', constraint: 'claim_p2p_record_immutable' });
        return out;
      }),
    );

    // à la déclaration et à DUE − 1 ms : aucun débit (sauf la refacturation payée)
    for (const at of [D, plus(DUE, -1)]) {
      await asWorker(at, async (tx) => {
        for (const name of ['silent', 'late']) {
          expect(
            (await tx.query<Row>(EXECUTE, [ids[name], uuid()])).rows[0],
            `${name} ${at}`,
          ).toEqual({ outcome: 'NOT_DUE', code: 'GUEST_RESPONSE_WINDOW_OPEN' });
          expect(await debits(tx, ids[name]!)).toEqual([]);
          expect(await state(tx, ids[name]!)).toMatchObject({ execution_status: 'PENDING' });
        }
      });
    }
    // payée : débitée tout de suite, accord écrit du voyageur
    await asWorker(plus(D, 2 * HOUR), async (tx) => {
      expect(await state(tx, ids['paid']!)).toMatchObject({ guest_status: 'ACCEPTED', due: true });
      expect((await tx.query<Row>(EXECUTE, [ids['paid'], uuid()])).rows[0]).toEqual({
        outcome: 'DONE',
        code: null,
      });
      expect(await debits(tx, ids['paid']!)).toEqual([
        expect.objectContaining({
          purpose: 'INCIDENTAL',
          reason: 'DELAYED_CHARGES',
          origin_type: 'TRAFFIC_CHARGE',
          amount_minor: (a['fine']! + a['fee']!).toString(),
          leg_host_minor: a['fine']!.toString(),
          leg_platform_minor: a['fee']!.toString(),
          guest_agreed: true,
        }),
      ]);
      expect(await state(tx, ids['paid']!)).toMatchObject({ charge_basis: 'GUEST_ACCEPTED' });
    });
    // après l'échéance : sans réponse ⇒ débitée ; contestée et décidée ⇒ débitée (ADMIN) ;
    // contestée sans décision ⇒ jamais ; rejetée ⇒ VOID, jamais
    await asWorker(plus(DUE, 2 * HOUR), async (tx) => {
      expect((await tx.query<Row>(EXECUTE, [ids['silent'], uuid()])).rows[0]).toEqual({
        outcome: 'DONE',
        code: null,
      });
      expect(await debits(tx, ids['silent']!)).toEqual([
        expect.objectContaining({
          amount_minor: (a['fine']! + a['fee']!).toString(),
          guest_agreed: false,
          status: 'NOTIFIED',
        }),
      ]);
      expect(await state(tx, ids['silent']!)).toMatchObject({ charge_basis: 'NO_RESPONSE' });
      expect((await tx.query<Row>(EXECUTE, [ids['self'], uuid()])).rows[0]).toEqual({
        outcome: 'NOT_DUE',
        code: 'TRAFFIC_DISPUTED',
      });
      expect(await debits(tx, ids['self']!)).toEqual([]);
      expect(await state(tx, ids['self']!)).toMatchObject({ due: false });
      expect((await tx.query<Row>(EXECUTE, [ids['rejected'], uuid()])).rows[0]).toEqual({
        outcome: 'VOID',
        code: null,
      });
      expect(await debits(tx, ids['rejected']!)).toEqual([]);
      expect(await state(tx, ids['disputed']!)).toMatchObject({ due: true });
      expect((await tx.query<Row>(EXECUTE, [ids['disputed'], uuid()])).rows[0]).toEqual({
        outcome: 'DONE',
        code: null,
      });
      expect(await state(tx, ids['disputed']!)).toMatchObject({ charge_basis: 'OPS_DECISION' });
      expect(await debits(tx, ids['disputed']!)).toHaveLength(1);
    });
  });
});
