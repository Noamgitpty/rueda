/**
 * US-318 — sinistres entre particuliers : vol présumé après la non-restitution, incident ou
 * accident du voyageur, amendes, péages et fourrière refacturés (migration 0178, ADR-198 ; fixture
 * 9906, et 9300, 9909 et celles d’US-708 réutilisées). Rôles de PRODUCTION seulement (assertion L0-05 par
 * `withRole`), au Panama (USD) et au Paraguay (PYG sans décimale).
 *
 * Attendus tirés de 19 US-318 (critère 1 : trip OVERDUE, escalade à l'étape « vol présumé » ⇒
 * déclaration à l'assureur journalisée, jamais envoyée tant que `insurer_contract_active` est
 * faux, jambe HOST retenue ; critère 2 : incident ouvert depuis S17 avec photos et heure serveur ;
 * critère 3 : amende, péage ou fourrière déclarés avec la pièce dans le délai ⇒ débit séparé
 * d'US-703 avec frais de gestion, jambes explicites ; hors délai : refus, bornes exactes), de
 * 16 TRP-038 / CLM-002, de 08 BR-RETURN-04, BR-TT-02 (fin effective + 120 j, [NOUS]), BR-TT-03,
 * BR-TT-04, BR-PRICE-15 (frais de gestion 5 %, [NOUS]), BR-REIMB-04 (100 % à l'hôte, frais au
 * voyageur) et de 22 OQ-BR-17 / OQ-BR-19, jamais du code testé.
 *
 * Montants attendus : sortie de l'oracle Python `packages/money/test/oracle/traffic_fee_oracle.py`
 * (`rhu` de `docs/specs/tools/independent_settlement_check.py`, montant × 500 / 10 000 ; 08
 * BR-PRICE-15 [NOUS] ligne 1692 : 5 % ; BR-PRICE-14 [NOUS] (2) ligne 1686 : half-up par ligne) :
 * USD 1 230 × 0,05 = 61,5 ⇒ 62, total 1 292 ; PYG 25 010 × 0,05 = 1 250,5 ⇒ 1 251, total 26 261.
 *
 * Années virtuelles propres au fichier : 2057 (trips) et 2058 (lots de versement). Aucun
 * interrupteur n'est écrit : `insurer_contract_active` et `payouts_enabled` restent faux.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { SubjectKeyStore } from '../../src/audit/index.ts';
import { FakeKeyWrapper, withRole, withTestTransaction } from '../../src/testing/index.ts';
import { setActor } from '../support/audit.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { goLive } from '../support/golive.ts';
import { openSession } from '../support/iam.ts';
import {
  applySignedStatus,
  caught,
  insertAccount,
  insertTrip,
  payTx,
  recordOperation,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const golden = loadGoldenVectors();
const uuid = (): string => randomUUID();
const HOUR = 3_600_000;
const DAY = 86_400_000;
const plus = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

const START = '2057-04-07T10:00:00.000Z';
const END = '2057-04-10T10:00:00.000Z';
/** 08 BR-TT-02 [NOUS] : fin effective + 120 jours (graine 0178). */
const DEADLINE = plus(END, 120 * DAY);

/** Saisies de l'hôte et frais attendus (oracle `traffic_fee_oracle.py`, voir l'en-tête), par devise. */
const AMOUNTS: Readonly<Record<string, { amount: bigint; fee: bigint; rent: bigint }>> = {
  USD: { amount: 1230n, fee: 62n, rent: 30000n },
  PYG: { amount: 25010n, fee: 1251n, rent: 2000000n },
};

const CAPTURE = 'SELECT * FROM core.trip_cmd_open_photo_capture($1, $2::uuid, $3, $4)';
const ADD = `SELECT * FROM core.trip_cmd_add_inspection_photo($1, $2::uuid, $3, $4::uuid, $5, $6::uuid,
                                                              $7, $8::bigint, $9, $10::timestamptz)`;
const HELP = `SELECT outcome, case_id::text AS case_id
  FROM core.support_cmd_open_help_request($1, $2::uuid, $3::uuid, $4, NULL)`;
const REPORT = `SELECT outcome, incident_id::text AS incident_id, reported_at, photo_count
  FROM core.claim_cmd_report_incident($1, $2::uuid, $3::uuid, $4::uuid, $5, $6)`;
const DECLARE = `SELECT outcome, charge_id::text AS charge_id, body
  FROM core.claim_cmd_declare_traffic_charge($1, $2::uuid, $3::uuid, $4, $5::timestamptz, $6::bigint,
                                             $7::uuid, $8, $9)`;
/**
 * Cas de l'oracle `packages/money/test/oracle/traffic_fee_oracle.py` (sortie recopiée : devise,
 * montant, frais ; `rhu` de docs/specs/tools, 08 BR-PRICE-15 ligne 1692, BR-PRICE-14 ligne 1686),
 * rejoués contre la fonction SQL par le récapitulatif de la déclaration (revues argent n° 3, qa
 * n° 6) : sous la demi-unité (1 ⇒ 0, 9 ⇒ 0), demi-unité exacte vers le haut (10 ⇒ 1, 25 010 ⇒ 1 251).
 */
const ORACLE: Readonly<Record<string, readonly (readonly [bigint, bigint])[]>> = {
  USD: [
    [1230n, 62n],
    [1000n, 50n],
    [1n, 0n],
  ],
  PYG: [
    [25010n, 1251n],
    [150000n, 7500n],
    [9n, 0n],
    [10n, 1n],
  ],
};
const HOST_VIEW = 'SELECT core.claim_host_trip_claims($1, $2::uuid) AS v';

const setNow = (tx: Tx, iso: string) =>
  tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso]);

interface World {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
}

/** Trip du pays (9300) de START à END ; statut forcé (9909). */
async function world(tx: Tx, c: CountryCase, status: string): Promise<World> {
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
    START,
    END,
  ]);
  await tx.query('SELECT test_fixture.us309_set_status($1, $2)', [trip, status]);
  const holder = (
    await tx.query<{ h: string }>('SELECT test_fixture.us309_holder($1)::text AS h', [trip])
  ).rows[0]!.h;
  return { trip, guest, holder };
}

/**
 * Clé USER de la personne (coffre de l'application, sous app_api, contexte de la personne) : une
 * photo est chiffrée par la clé du sujet (`file_asset_enc_key_fk`), comme dans l0-us303.
 */
async function subjectKey(tx: Tx, userId: string): Promise<void> {
  const keys = new SubjectKeyStore(new FakeKeyWrapper());
  await setActor(tx, { kind: 'GUEST', actorId: userId });
  const k = await keys.dekFor(tx, { type: 'USER', id: userId }, 'create');
  if (k.status !== 'OK') throw new Error(`clé du sujet : ${k.status}`);
}

/** Photo prise par la chaîne d'US-303 (jeton de capture puis envoi) : identifiant du fichier. */
async function shoot(tx: Tx, who: Buffer, trip: string, kind: string, slot: string) {
  const cap = (await tx.query<Row>(CAPTURE, [who, trip, kind, slot])).rows[0]!;
  if (cap['outcome'] !== 'DONE') return { outcome: cap['outcome'], fileId: null };
  const body = randomBytes(64);
  const fileId = uuid();
  const r = (
    await tx.query<Row>(ADD, [
      who,
      trip,
      kind,
      cap['capture_id'],
      slot,
      fileId,
      'image/jpeg',
      body.length,
      createHash('sha256').update(body).digest(),
      null,
    ])
  ).rows[0]!;
  return { outcome: r['outcome'], fileId: r['outcome'] === 'DONE' ? fileId : null };
}

describe.each(COUNTRIES)('US-318 — sinistres entre particuliers ($country, $currency)', (c) => {
  it('critère 1 : trip OVERDUE à l’étape T24H ⇒ dossier de vol (THEFT_INVESTIGATION), déclaration à l’assureur journalisée PENDING, jamais envoyée tant que insurer_contract_active est faux ; retour ⇒ dossier clos, déclaration retirée ; registres immuables ; travailleur payment_command seul', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: plus(END, 25 * HOUR) }, async (tx) => {
        expect(await goLive(tx, 'insurer_contract_active', c.country)).toBe(false);
        const w = await world(tx, c, 'IN_PROGRESS');
        await tx.query('SELECT test_fixture.us318_overdue_t24h($1)', [w.trip]);
        const early = await world(tx, c, 'OVERDUE'); // OVERDUE sans étape T24H
        const due = async (): Promise<Row[]> =>
          (
            await tx.query<Row>(
              'SELECT trip_id::text AS trip_id, action FROM core.claim_theft_cases_due(100)',
            )
          ).rows.filter((r) => r['trip_id'] === w.trip || r['trip_id'] === early.trip);
        expect(await due()).toEqual([{ trip_id: w.trip, action: 'OPEN' }]);

        const open = (trip: string) =>
          tx.query<{ r: string }>('SELECT core.claim_cmd_open_theft_case($1) AS r', [trip]);
        expect((await open(early.trip)).rows[0]!.r).toBe('NOT_DUE');
        expect(
          (await tx.query('SELECT * FROM test_fixture.us318_theft_case($1)', [early.trip])).rows,
        ).toEqual([]);
        expect((await open(w.trip)).rows[0]!.r).toBe('OPENED');
        expect((await open(w.trip)).rows[0]!.r).toBe('EXISTS');
        const [theft] = (
          await tx.query<Row>('SELECT * FROM test_fixture.us318_theft_case($1)', [w.trip])
        ).rows;
        expect(theft).toMatchObject({
          status: 'THEFT_INVESTIGATION',
          insurer_status: 'PENDING',
          insurer_ref: null,
          closed_at: null,
        });
        expect(new Date(theft!['opened_at'] as string).toISOString()).toBe(plus(END, 25 * HOUR));

        // interrupteur faux (lu en base), preuve par objet (revue qa delta) : la déclaration est
        // verrouillée puis refusée AVANT tout appel au port (revue sécurité delta n° 2 : corps
        // plpgsql, FOR UPDATE sous RLS et droits de colonnes de cmd_money_owner) ; inconnue ⇒
        // NOT_FOUND ; l'envoi est refusé, rien ne change
        const lock = (id: unknown) =>
          tx
            .query<{ r: string }>('SELECT core.claim_cmd_lock_theft_declaration($1) AS r', [id])
            .then((r) => r.rows[0]!.r);
        expect(await lock(theft!['id'])).toBe('INSURER_CONTRACT_INACTIVE');
        expect(await lock(uuid())).toBe('NOT_FOUND');
        const send = (ref: string) =>
          tx.query<{ r: string }>('SELECT core.claim_cmd_record_theft_declaration($1, $2) AS r', [
            theft!['id'],
            ref,
          ]);
        expect((await send('FAKE-INS-1')).rows[0]!.r).toBe('INSURER_CONTRACT_INACTIVE');
        expect(
          (await tx.query<Row>('SELECT * FROM test_fixture.us318_theft_case($1)', [w.trip]))
            .rows[0],
        ).toMatchObject({ insurer_status: 'PENDING', insurer_ref: null });

        // registres immuables, même sous migrator (fixture)
        for (const what of ['THEFT_DELETE']) {
          const e = await caught(tx, () =>
            tx.query('SELECT test_fixture.us318_try_write($1, $2)', [what, theft!['id']]),
          );
          expect(e).toMatchObject({ code: '23000', constraint: 'claim_p2p_record_immutable' });
        }

        // trip encore non rendu : rien à clore ; rendu ⇒ CLOSE, clos, déclaration retirée
        const close = () =>
          tx.query<{ r: string }>('SELECT core.claim_cmd_close_theft_case($1) AS r', [w.trip]);
        expect((await close()).rows[0]!.r).toBe('NOT_DUE');
        await tx.query('SELECT test_fixture.us309_returned($1)', [w.trip]);
        expect(await due()).toEqual([{ trip_id: w.trip, action: 'CLOSE' }]);
        expect((await close()).rows[0]!.r).toBe('CLOSED');
        expect((await close()).rows[0]!.r).toBe('ALREADY_CLOSED');
        expect(
          (await tx.query<Row>('SELECT * FROM test_fixture.us318_theft_case($1)', [w.trip]))
            .rows[0],
        ).toMatchObject({ status: 'RETURNED', insurer_status: 'WITHDRAWN', insurer_ref: null });
        expect((await send('FAKE-INS-2')).rows[0]!.r).toBe('WITHDRAWN');
        expect(await lock(theft!['id'])).toBe('WITHDRAWN');
        const reopen = await caught(tx, () =>
          tx.query('SELECT test_fixture.us318_try_write($1, $2)', ['THEFT_REOPEN', theft!['id']]),
        );
        expect(reopen).toMatchObject({ code: '23000', constraint: 'claim_p2p_record_immutable' });

        // autre travailleur : refus 42501
        await tx.query(`SELECT pg_catalog.set_config('app.worker_name', 'trip_overdue', true)`);
        const other = await caught(tx, () => open(early.trip));
        expect(other).toMatchObject({ code: '42501', constraint: 'claim_p2p_command_forbidden' });
        const otherLock = await caught(tx, () => lock(theft!['id']));
        expect(otherLock).toMatchObject({
          code: '42501',
          constraint: 'claim_p2p_command_forbidden',
        });
      }),
    );
    // app_api n'a aucun droit sur les commandes du travailleur
    await withRole('app_api', (api) =>
      withTestTransaction(api, {}, async (tx) => {
        const e = await caught(tx, () =>
          tx.query('SELECT core.claim_cmd_open_theft_case($1)', [uuid()]),
        );
        expect(e?.code).toBe('42501');
        const l = await caught(tx, () =>
          tx.query('SELECT core.claim_cmd_lock_theft_declaration($1)', [uuid()]),
        );
        expect(l?.code).toBe('42501');
      }),
    );
  });

  it('critère 1 (gel) : dossier de vol ouvert ⇒ lot de l’hôte ON_HOLD CLAIM à la préparation et à la compensation ; clos au retour ⇒ levé, les autres motifs restent', async () => {
    const capture: Legs = {
      ...legVector(golden, c.currency === 'USD' ? 'TJ01' : 'TJ08a').legsMinor,
    };
    const total = (['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const).reduce(
      (s, k) => s + capture[k],
      0n,
    );
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', deploymentEnv: 'test' }, async (tx) => {
        expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(false);
        const psp = await insertAccount(tx, { country: c.country });
        // calendrier propre au test (version épinglée très au-dessus de toute version validée)
        const pinned = await tx.query<{ v: number }>(
          'SELECT test_fixture.us309_pinned_holiday($1, $2::date) AS v',
          [c.country, '2058-01-01'],
        );
        expect(pinned.rows[0]?.v).toBeGreaterThanOrEqual(1_000_000);
        const trip = await insertTrip(tx, c);
        const { operation_id: op } = await recordOperation(tx, {
          tripId: trip,
          accountId: psp,
          kind: 'CAPTURE',
          amountMinor: total,
          currency: c.currency,
          idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
          legs: capture,
        });
        expect(await applySignedStatus(tx, op, 'SUCCEEDED')).toBe('APPLIED');
        await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [op]);
        await tx.query('SELECT test_fixture.us708_verified_account($1, NULL)', [trip]);
        await setNow(tx, '2058-01-16T20:00:00Z');
        await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);
        // vol présumé avant la préparation (dossier posé directement ; l'ouverture est prouvée
        // par le critère 1)
        await tx.query('SELECT test_fixture.us318_insert_theft_case($1)', [trip]);
        const p = (
          await tx.query<Row>(
            'SELECT outcome, batch_id::text AS batch_id, hold_reasons FROM core.payout_cmd_prepare_trip($1)',
            [trip],
          )
        ).rows[0]!;
        expect(p['outcome']).toBe('PREPARED');
        expect(p['hold_reasons']).toEqual(expect.arrayContaining(['CLAIM', 'PAYOUTS_DISABLED']));
        const net = async (): Promise<string[]> =>
          (
            await tx.query<{ hold_reasons: string[] }>(
              'SELECT hold_reasons FROM core.payout_cmd_net_batch($1)',
              [p['batch_id']],
            )
          ).rows[0]?.hold_reasons ?? [];
        await setNow(tx, '2058-02-10T17:00:00Z');
        expect(await net()).toContain('CLAIM');
        // trip rendu (COMPLETED) : le travailleur clôt le dossier, la retenue CLAIM est levée
        expect(
          (await tx.query<{ r: string }>('SELECT core.claim_cmd_close_theft_case($1) AS r', [trip]))
            .rows[0]!.r,
        ).toBe('CLOSED');
        const lifted = await net();
        expect(lifted).not.toContain('CLAIM');
        expect(lifted).toContain('PAYOUTS_DISABLED');
      }),
    );
  });

  it('critère 2 : accident déclaré depuis S17 — demande d’aide ACCIDENT, photos de la série INCIDENT (chaîne d’US-303), incident ouvert à l’heure serveur ; voyageur seul, pendant le trip ; rejeu ; registre immuable', async () => {
    const T = plus(START, 30 * HOUR);
    await withRole('app_api', (api) =>
      withTestTransaction(api, { virtualNow: T }, async (tx) => {
        const w = await world(tx, c, 'IN_PROGRESS');
        const done = await world(tx, c, 'COMPLETED');
        const g = (await openSession(tx, w.guest)).hash;
        const h = (await openSession(tx, w.holder)).hash;
        const stranger = (await openSession(tx, done.guest)).hash;
        await subjectKey(tx, w.guest);

        // sans demande d'aide de ce voyageur : refus, rien d'écrit
        const req = uuid();
        expect(
          (await tx.query<Row>(REPORT, [g, req, w.trip, uuid(), true, false])).rows[0],
        ).toMatchObject({ outcome: 'INCIDENT_CASE_REQUIRED', incident_id: null });
        // demande d'aide du trip (0162, S17) : dossier du support
        const help = (await tx.query<Row>(HELP, [g, uuid(), w.trip, 'ACCIDENT'])).rows[0]!;
        expect(help['outcome']).toBe('OPENED');
        const caseId = String(help['case_id']);
        // sans photo : refus
        expect(
          (await tx.query<Row>(REPORT, [g, uuid(), w.trip, caseId, true, false])).rows[0],
        ).toMatchObject({ outcome: 'INCIDENT_PHOTOS_REQUIRED' });
        // l'hôte et une autre personne n'ont pas de série INCIDENT sur ce trip (même réponse)
        expect((await shoot(tx, h, w.trip, 'INCIDENT', 'DAMAGE_01')).outcome).toBe('NOT_FOUND');
        expect((await shoot(tx, stranger, w.trip, 'INCIDENT', 'DAMAGE_01')).outcome).toBe(
          'NOT_FOUND',
        );
        // photos du voyageur par la chaîne existante (jeton, empreinte, heure serveur)
        const p1 = await shoot(tx, g, w.trip, 'INCIDENT', 'DAMAGE_01');
        const p2 = await shoot(tx, g, w.trip, 'INCIDENT', 'DAMAGE_02');
        expect([p1.outcome, p2.outcome]).toEqual(['DONE', 'DONE']);

        const r = (await tx.query<Row>(REPORT, [g, req, w.trip, caseId, true, false])).rows[0]!;
        expect(r['outcome']).toBe('REPORTED');
        expect(new Date(r['reported_at'] as string).toISOString()).toBe(T);
        expect(r['photo_count']).toBe(2);
        const rows = (
          await tx.query<Row>('SELECT * FROM test_fixture.us318_incidents($1)', [w.trip])
        ).rows;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          case_id: caseId,
          reporter_user_id: w.guest,
          kind: 'ACCIDENT',
          third_party: true,
          police_report: false,
        });
        expect([...(rows[0]!['photo_file_ids'] as string[])].sort()).toEqual(
          [p1.fileId, p2.fileId].sort(),
        );
        // rejeu : même incident ; autre requête sur la même demande : l'incident existant
        expect(
          (await tx.query<Row>(REPORT, [g, req, w.trip, caseId, true, false])).rows[0],
        ).toMatchObject({ outcome: 'DUPLICATE', incident_id: r['incident_id'] });
        expect(
          (await tx.query<Row>(REPORT, [g, uuid(), w.trip, caseId, false, true])).rows[0],
        ).toMatchObject({ outcome: 'EXISTS', incident_id: r['incident_id'] });
        // l'hôte, une autre personne : NOT_FOUND ; trip terminé : hors fenêtre
        expect(
          (await tx.query<Row>(REPORT, [h, uuid(), w.trip, caseId, true, false])).rows[0]![
            'outcome'
          ],
        ).toBe('NOT_FOUND');
        expect(
          (await tx.query<Row>(REPORT, [stranger, uuid(), w.trip, caseId, true, false])).rows[0]![
            'outcome'
          ],
        ).toBe('NOT_FOUND');
        const gDone = (await openSession(tx, done.guest)).hash;
        expect(
          (await tx.query<Row>(REPORT, [gDone, uuid(), done.trip, uuid(), true, false])).rows[0]![
            'outcome'
          ],
        ).toBe('INCIDENT_NOT_OPEN');
        // registre immuable
        const e = await caught(tx, () =>
          tx.query('SELECT test_fixture.us318_try_write($1, $2)', [
            'INCIDENT_UPDATE',
            r['incident_id'],
          ]),
        );
        expect(e).toMatchObject({ code: '23000', constraint: 'claim_p2p_record_immutable' });
      }),
    );
  });

  it('critère 3 (refus) : paramètres du pays absents ⇒ TRAFFIC_WINDOW_UNKNOWN puis TRAFFIC_FEE_UNKNOWN ; fait futur ⇒ TRAFFIC_OUTSIDE_TRIP ; récapitulatif refusé au voyageur, à un autre hôte et pour un autre trip (NOT_FOUND), rien d’écrit', async () => {
    const T = plus(END, DAY);
    await withRole('app_api', (api) =>
      withTestTransaction(api, { virtualNow: plus(END, -HOUR) }, async (tx) => {
        const w = await world(tx, c, 'IN_PROGRESS');
        const o = await world(tx, c, 'IN_PROGRESS');
        await setNow(tx, END);
        await tx.query('SELECT test_fixture.us309_returned($1)', [w.trip]);
        await tx.query('SELECT test_fixture.us309_returned($1)', [o.trip]);
        await setNow(tx, T);
        const h = (await openSession(tx, w.holder)).hash;
        const g = (await openSession(tx, w.guest)).hash;
        const ho = (await openSession(tx, o.holder)).hash;
        const call = async (who: Buffer, trip: string, at: string, preview: boolean) =>
          (
            await tx.query<Row>(DECLARE, [
              who,
              uuid(),
              trip,
              'TOLL',
              at,
              AMOUNTS[c.currency]!.amount.toString(),
              uuid(),
              preview,
              `PV-${uuid().slice(0, 8)}`,
            ])
          ).rows[0]!['outcome'];
        // accès (vraie fonction, revue sécurité delta) : voyageur, autre hôte, autre trip
        expect(await call(g, w.trip, START, true)).toBe('NOT_FOUND');
        expect(await call(ho, w.trip, START, true)).toBe('NOT_FOUND');
        expect(await call(h, o.trip, START, true)).toBe('NOT_FOUND');
        // fait futur (après l'heure de la base) : hors du trip
        expect(await call(h, w.trip, plus(T, HOUR), true)).toBe('TRAFFIC_OUTSIDE_TRIP');
        expect(await call(h, w.trip, plus(T, HOUR), false)).toBe('TRAFFIC_OUTSIDE_TRIP');
        // frais absents (valeur fermée dans la transaction annulée) ⇒ refus fail-closed
        await tx.query('SELECT test_fixture.us318_param_close($1, $2)', [
          'traffic_charge_admin_fee_bps',
          c.country,
        ]);
        await setNow(tx, plus(T, 1000));
        expect(await call(h, w.trip, START, true)).toBe('TRAFFIC_FEE_UNKNOWN');
        expect(await call(h, w.trip, START, false)).toBe('TRAFFIC_FEE_UNKNOWN');
        // délai absent ⇒ refus avant les frais
        await tx.query('SELECT test_fixture.us318_param_close($1, $2)', [
          'traffic_charge_deadline_days',
          c.country,
        ]);
        await setNow(tx, plus(T, 2000));
        expect(await call(h, w.trip, START, false)).toBe('TRAFFIC_WINDOW_UNKNOWN');
        expect(
          (await tx.query('SELECT * FROM test_fixture.us318_traffic_charges($1)', [w.trip])).rows,
        ).toEqual([]);
      }),
    );
  });

  it('critère 3 : amende, péage ou fourrière — pièce de la série TRAFFIC, fin effective + 120 j acceptée, + 1 ms refusée ; fait hors de [début, fin] refusé aux bornes ; frais de gestion de 08 ; titulaire seul ; débit séparé d’US-703 (INCIDENTAL, DELAYED_CHARGES) aux jambes explicites ; sans moyen de carte BLOCKED', async () => {
    const a = AMOUNTS[c.currency]!;
    const ids = await withRole('app_api', (api) =>
      withTestTransaction(api, { virtualNow: plus(END, HOUR), commit: true }, async (tx) => {
        const w = await world(tx, c, 'IN_PROGRESS');
        await setNow(tx, END);
        await tx.query('SELECT test_fixture.us309_returned($1)', [w.trip]);
        await tx.query('SELECT test_fixture.us309_card_rent($1, $2)', [w.trip, a.rent.toString()]);
        const noCard = await world(tx, c, 'IN_PROGRESS');
        await tx.query('SELECT test_fixture.us309_returned($1)', [noCard.trip]);
        const ongoing = await world(tx, c, 'IN_PROGRESS');
        await setNow(tx, plus(END, HOUR));
        let h = (await openSession(tx, w.holder)).hash;
        let hNoCard = (await openSession(tx, noCard.holder)).hash;
        let g = (await openSession(tx, w.guest)).hash;
        let hOngoing = (await openSession(tx, ongoing.holder)).hash;
        // sessions ouvertes à l'instant (virtuel) de la déclaration : une session de la veille du
        // retour aurait expiré 120 jours plus tard (refus NOT_FOUND, sans rapport avec le délai)
        const reopen = async (): Promise<void> => {
          h = (await openSession(tx, w.holder)).hash;
          hNoCard = (await openSession(tx, noCard.holder)).hash;
          g = (await openSession(tx, w.guest)).hash;
          hOngoing = (await openSession(tx, ongoing.holder)).hash;
        };
        await subjectKey(tx, w.holder);
        await subjectKey(tx, noCard.holder);

        // pièces photographiées par le titulaire (chaîne d'US-303, série TRAFFIC) ; le voyageur
        // n'a pas de série TRAFFIC
        const f1 = await shoot(tx, h, w.trip, 'TRAFFIC', 'DAMAGE_01');
        const f2 = await shoot(tx, h, w.trip, 'TRAFFIC', 'DAMAGE_02');
        const f3 = await shoot(tx, h, w.trip, 'TRAFFIC', 'DAMAGE_03');
        const fNo = await shoot(tx, hNoCard, noCard.trip, 'TRAFFIC', 'DAMAGE_01');
        expect([f1.outcome, f2.outcome, f3.outcome, fNo.outcome]).toEqual([
          'DONE',
          'DONE',
          'DONE',
          'DONE',
        ]);
        expect((await shoot(tx, g, w.trip, 'TRAFFIC', 'DAMAGE_04')).outcome).toBe('NOT_FOUND');
        expect((await shoot(tx, hOngoing, ongoing.trip, 'TRAFFIC', 'DAMAGE_01')).outcome).toBe(
          'INSPECTION_NOT_OPEN',
        );

        const declare = (
          who: Buffer,
          trip: string,
          kind: string,
          at: string,
          file: string | null,
          req = uuid(),
          preview = false,
          amount = a.amount,
          // référence obligatoire, unique par trip (0181, F-L3-SIN-01)
          ref = `PV-${uuid().slice(0, 8)}`,
        ) =>
          tx
            .query<Row>(DECLARE, [who, req, trip, kind, at, amount.toString(), file, preview, ref])
            .then((r) => r.rows[0]!);

        // délai : fin effective (retour à END) + 120 j ; + 1 ms : refus, rien d'écrit
        await setNow(tx, plus(DEADLINE, 1));
        await reopen();
        const late = await declare(h, w.trip, 'FINE', plus(START, HOUR), f1.fileId);
        expect(late['outcome']).toBe('TRAFFIC_CHARGE_DEADLINE_PASSED');
        expect(
          (await declare(h, w.trip, 'FINE', plus(START, HOUR), f1.fileId, uuid(), true))['outcome'],
        ).toBe('TRAFFIC_CHARGE_DEADLINE_PASSED');
        expect((late['body'] as Row)['deadlineAt']).toBe(DEADLINE);
        expect(
          (await tx.query('SELECT * FROM test_fixture.us318_traffic_charges($1)', [w.trip])).rows,
        ).toEqual([]);

        await setNow(tx, DEADLINE);
        await reopen();
        // récapitulatif AVANT l'envoi (revue ux n° 1) : calculé par la base, rien n'est écrit,
        // l'identifiant de requête n'est pas consommé ; parité avec l'oracle sur tous ses cas
        for (const [amount, fee] of ORACLE[c.currency]!) {
          const pv = await declare(h, w.trip, 'TOLL', START, f1.fileId, uuid(), true, amount);
          expect(pv['outcome'], `${c.currency} ${amount}`).toBe('PREVIEW');
          expect(pv['charge_id']).toBeNull();
          expect(pv['body']).toMatchObject({
            amountMinor: amount.toString(),
            adminFeeMinor: fee.toString(),
            totalMinor: (amount + fee).toString(),
            currency: c.currency,
            feeBps: 500,
            deadlineAt: DEADLINE,
            legs: {
              HOST: amount.toString(),
              INSURER: '0',
              TAX_THIRD_PARTY: '0',
              PLATFORM: fee.toString(),
            },
          });
        }
        expect(
          (await tx.query('SELECT * FROM test_fixture.us318_traffic_charges($1)', [w.trip])).rows,
        ).toEqual([]);
        // bornes du fait : début − 1 ms et fin + 1 ms refusés ; début et fin acceptés
        expect((await declare(h, w.trip, 'TOLL', plus(START, -1), f1.fileId))['outcome']).toBe(
          'TRAFFIC_OUTSIDE_TRIP',
        );
        expect((await declare(h, w.trip, 'TOLL', plus(END, 1), f1.fileId))['outcome']).toBe(
          'TRAFFIC_OUTSIDE_TRIP',
        );
        // voyageur, autre trip, trip non rendu : même refus que l'inconnu, ou non terminé
        expect((await declare(g, w.trip, 'TOLL', START, f1.fileId))['outcome']).toBe('NOT_FOUND');
        expect((await declare(hOngoing, ongoing.trip, 'TOLL', START, uuid()))['outcome']).toBe(
          'TRAFFIC_TRIP_NOT_ENDED',
        );
        // pièce absente de la série du titulaire de ce trip
        expect((await declare(h, w.trip, 'TOLL', START, fNo.fileId))['outcome']).toBe(
          'TRAFFIC_EVIDENCE_REQUIRED',
        );

        const req = uuid();
        const fineRef = `PV-${uuid().slice(0, 8)}`;
        const fine = await declare(
          h,
          w.trip,
          'FINE',
          START,
          f1.fileId,
          req,
          false,
          a.amount,
          fineRef,
        );
        expect(fine['outcome']).toBe('DECLARED');
        expect(fine['body']).toEqual({
          amountMinor: a.amount.toString(),
          adminFeeMinor: a.fee.toString(),
          totalMinor: (a.amount + a.fee).toString(),
          deadlineAt: DEADLINE,
          // 08 BR-TT-02 : 48 h pour payer ou contester (0181)
          responseDueAt: plus(DEADLINE, 48 * HOUR),
          // 0183 (ADR-203) : sous le seuil cumulé du trip, aucune revue de l'ops
          opsReviewRequired: false,
          legs: {
            HOST: a.amount.toString(),
            INSURER: '0',
            TAX_THIRD_PARTY: '0',
            PLATFORM: a.fee.toString(),
          },
        });
        expect(
          await declare(h, w.trip, 'FINE', START, f1.fileId, req, false, a.amount, fineRef),
        ).toMatchObject({
          outcome: 'DUPLICATE',
          charge_id: fine['charge_id'],
        });
        // une pièce, une refacturation
        expect((await declare(h, w.trip, 'TOLL', END, f1.fileId))['outcome']).toBe(
          'TRAFFIC_EVIDENCE_REQUIRED',
        );
        const toll = await declare(h, w.trip, 'TOLL', END, f2.fileId);
        expect(toll['outcome']).toBe('DECLARED');
        const impound = await declare(
          hNoCard,
          noCard.trip,
          'IMPOUND',
          plus(START, DAY),
          fNo.fileId,
        );
        expect(impound['outcome']).toBe('DECLARED');

        const rows = (
          await tx.query<Row>('SELECT * FROM test_fixture.us318_traffic_charges($1)', [w.trip])
        ).rows;
        expect(rows).toHaveLength(2);
        for (const r of rows) {
          expect(r).toMatchObject({
            declared_by: w.holder,
            amount_minor: a.amount.toString(),
            admin_fee_minor: a.fee.toString(),
            total_minor: (a.amount + a.fee).toString(),
            leg_host_minor: a.amount.toString(),
            leg_insurer_minor: '0',
            leg_tax_third_party_minor: '0',
            leg_platform_minor: a.fee.toString(),
            execution_status: 'PENDING',
          });
        }
        // vue du titulaire : refacturations et pièces utilisées ; le voyageur : rien
        const v = (await tx.query<{ v: Row | null }>(HOST_VIEW, [h, w.trip])).rows[0]!.v!;
        expect(v).toMatchObject({ open: true, deadlineAt: DEADLINE, feeBps: 500, theft: null });
        expect(v['charges'] as Row[]).toHaveLength(2);
        const used = (v['evidence'] as Row[])
          .filter((e) => e['used'] === true)
          .map((e) => e['fileId']);
        expect(used.sort()).toEqual([f1.fileId, f2.fileId].sort());
        expect((await tx.query<{ v: unknown }>(HOST_VIEW, [g, w.trip])).rows[0]!.v).toBeNull();
        // registre figé
        const e = await caught(tx, () =>
          tx.query('SELECT test_fixture.us318_try_write($1, $2)', [
            'TRAFFIC_AMOUNT',
            fine['charge_id'],
          ]),
        );
        expect(e).toMatchObject({ code: '23000', constraint: 'claim_p2p_record_immutable' });
        return {
          fine: String(fine['charge_id']),
          toll: String(toll['charge_id']),
          impound: String(impound['charge_id']),
        };
      }),
    );

    // exécution par Kmino (travailleur payment_command), transaction annulée, à l'échéance du
    // voyageur (déclaration + 48 h, 0181) : sans réponse, la refacturation est due
    await withRole('app_worker', (client) =>
      payTx(
        client,
        { worker: 'payment_command', virtualNow: plus(DEADLINE, 48 * HOUR) },
        async (tx) => {
          // état lu par objet du test (jamais par la file globale, revue qa n° 5)
          const state = async (id: string): Promise<Row> =>
            (await tx.query<Row>('SELECT * FROM test_fixture.us318_traffic_charge($1)', [id]))
              .rows[0]!;
          for (const id of [ids.fine, ids.toll, ids.impound]) {
            expect(await state(id)).toMatchObject({ execution_status: 'PENDING', due: true });
          }
          const exec = (id: string) =>
            tx
              .query<Row>(
                'SELECT outcome, code FROM core.claim_cmd_execute_traffic_charge($1, $2)',
                [id, uuid()],
              )
              .then((r) => r.rows[0]!);
          expect(await exec(ids.fine)).toEqual({ outcome: 'DONE', code: null });
          expect(await exec(ids.fine)).toEqual({ outcome: 'DONE', code: null });
          const charges = (
            await tx.query<Row>('SELECT * FROM test_fixture.us318_post_trip_charges($1)', [
              ids.fine,
            ])
          ).rows;
          expect(charges).toHaveLength(1);
          expect(charges[0]).toMatchObject({
            purpose: 'INCIDENTAL',
            reason: 'DELAYED_CHARGES',
            origin_type: 'TRAFFIC_CHARGE',
            amount_minor: (a.amount + a.fee).toString(),
            leg_host_minor: a.amount.toString(),
            leg_insurer_minor: '0',
            leg_tax_third_party_minor: '0',
            leg_platform_minor: a.fee.toString(),
            guest_agreed: false,
            status: 'NOTIFIED',
          });
          expect(await exec(ids.impound)).toEqual({ outcome: 'BLOCKED', code: 'NO_CARD_TENDER' });
          expect(
            (
              await tx.query('SELECT * FROM test_fixture.us318_post_trip_charges($1)', [
                ids.impound,
              ])
            ).rows,
          ).toEqual([]);
          expect(
            (
              await tx.query<{ r: string }>(
                'SELECT core.claim_cmd_defer_traffic_charge($1, $2) AS r',
                [ids.toll, 'EXECUTION_FAILED'],
              )
            ).rows[0]!.r,
          ).toBe('DEFERRED');
          expect(await state(ids.toll)).toMatchObject({
            execution_status: 'PENDING',
            due: false,
            failed_attempts: 1,
          });
          expect(await state(ids.fine)).toMatchObject({ execution_status: 'DONE', due: false });
          // plafond d'essais (revue code n° 2) : au 5e échec, BLOCKED RETRY_EXHAUSTED, plus jamais dû
          const defer = async (): Promise<string> =>
            (
              await tx.query<{ r: string }>(
                'SELECT core.claim_cmd_defer_traffic_charge($1, $2) AS r',
                [ids.toll, 'EXECUTION_FAILED'],
              )
            ).rows[0]!.r;
          expect([await defer(), await defer(), await defer()]).toEqual([
            'DEFERRED',
            'DEFERRED',
            'DEFERRED',
          ]);
          expect(await defer()).toBe('BLOCKED');
          expect(await state(ids.toll)).toMatchObject({
            execution_status: 'BLOCKED',
            execution_code: 'RETRY_EXHAUSTED',
            failed_attempts: 5,
            due: false,
          });
          expect(await defer()).toBe('NOT_DUE');
        },
      ),
    );
  });
});
