/**
 * US-311 (migration 0174, ADR-194) — vues de la bêta (remises du jour, retards, KPI de sortie) et
 * rapprochement par jambe ASSISTÉ : `core.report_staff_beta_view`,
 * `core.finance_staff_reconciliation_export`, `core.finance_staff_record_reconciliation`,
 * `core.finance_staff_reconciliation_run`, `core.finance_staff_reconciliation_runs`,
 * `core.finance_staff_resolve_reconciliation_item`, `core.finance_staff_sign_reconciliation`.
 * Rôles de PRODUCTION seulement (assertion L0-05 par `withRole` / `connectAs`), dans chaque pays
 * configuré (`COUNTRIES` : USD à deux décimales, PYG sans décimale).
 *
 * Attendus tirés de 19 US-311 (« 10 trips et un export PSP de 11 opérations dont une de 128,40 sans
 * trip ⇒ l'écart "opération sans trip" est visible » ; « chaque jambe appariée ou en écart, à
 * l'unité mineure près » ; « KPI calculés depuis les données » ; « procédure MANUELLE bornée :
 * seuil J-ADM-031, checklist signée » ; variante PY), du pré-mortem L3-PM-60 / RT-L3-V11 (aucune
 * tolérance silencieuse ; seuil absent = 0 ; jambe en écart d'une unité mineure ; versement sans
 * jambe), de 16 FIN-005 (RECON_FORMAT_INVALID), de 18 §1.1 (S1 à S4) et de 17 §2.3
 * (`data.export` journalisé, pays du rôle). Montants : vecteurs de l'export des oracles
 * (`@rueda/money/golden-vectors` : TJ01 = Σ TJ15a à TJ15d pour la devise à deux décimales, TJ08a
 * pour la devise sans décimale), jamais le code testé ; soldes du PSP lus par `listLegBalances` du
 * FAKE (`@rueda/fake-adapters/psp`).
 *
 * Isolement des comptages (#281) : aucune assertion ne porte sur un total global. Les éléments
 * vérifiés sont ceux des références créées ici ; les comptes du passage qui ne dépendent que des
 * lignes fournies (appariées, « sans trip ») sont exacts ; les KPI sont comparés avant / après dans
 * UN seul instantané (`REPEATABLE READ`). Transactions ANNULÉES ; aucun interrupteur ni paramètre.
 */
import { randomUUID } from 'node:crypto';
import { FakePsp } from '@rueda/fake-adapters/psp';
import type { FakeLegAmounts, FakeLegBalance } from '@rueda/fake-adapters/psp';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { first } from '../redteam/l1/support-host.ts';
import { byCountry, ops, otherOf, paramValues, rolledBack, uuid } from '../redteam/l1/support.ts';
import type { CountryCase } from '../redteam/l1/support.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const VIEW = 'SELECT * FROM core.report_staff_beta_view($1, $2, $3, $4, $5, $6)';
const EXPORT =
  'SELECT * FROM core.finance_staff_reconciliation_export($1, $2, $3, $4::date, $5, $6)';
const RECORD =
  'SELECT * FROM core.finance_staff_record_reconciliation($1, $2, $3, $4::date, $5, $6::jsonb, $7)';
const RUN = 'SELECT * FROM core.finance_staff_reconciliation_run($1, $2, $3, $4, $5)';
const RUNS = 'SELECT * FROM core.finance_staff_reconciliation_runs($1, $2)';
const RESOLVE = 'SELECT * FROM core.finance_staff_resolve_reconciliation_item($1, $2, $3, $4, $5)';
const SIGN = 'SELECT * FROM core.finance_staff_sign_reconciliation($1, $2, $3, $4::jsonb)';
const REASON = 'Rapprochement mensuel de la bêta (test US-311)';
const LINES = JSON.stringify([{ type: 'TRIP_PRICE', amountMinor: '1000' }]);
const DAY = 86_400_000;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
/** Montant de l'opération « sans trip » de 19 US-311 (128,40), en unités mineures : une ENTRÉE. */
const ORPHAN_MINOR = 12_840n;
const CHECKLIST = {
  PSP_STATEMENT_COMPLETE: true,
  OPERATIONS_RECONCILED: true,
  LEGS_RECONCILED: true,
  DISCREPANCIES_EXPLAINED_OR_ESCALATED: true,
  THRESHOLD_REVIEWED: true,
};

const set = loadGoldenVectors();
/** État des jambes d'un trip payé, par devise (vecteurs de l'oracle). */
const STATES: readonly GoldenLegVector[] = [legVector(set, 'TJ01'), legVector(set, 'TJ08a')];
/** Encaissements successifs (08 E7 règle 10) : TJ15a à TJ15d pour la devise de TJ01. */
const CASCADE: readonly GoldenLegVector[] = ['TJ15a', 'TJ15b', 'TJ15c', 'TJ15d'].map((id) =>
  legVector(set, id),
);

const stateOf = (c: CountryCase): GoldenLegVector => {
  const v = STATES.find((s) => s.currency === c.currency);
  if (v === undefined) throw new Error(`aucun vecteur de jambes pour ${c.currency}`);
  return v;
};
/** Encaissements du trip : la cascade TJ15 si elle est dans la devise, sinon un seul (l'état). */
const operationsOf = (c: CountryCase): readonly GoldenLegVector[] => {
  const cascade = CASCADE.filter((v) => v.currency === c.currency);
  return cascade.length > 0 ? cascade : [stateOf(c)];
};
const fakeLegs = (v: GoldenLegVector): FakeLegAmounts => ({
  HOST: v.legsMinor.HOST,
  INSURER: v.legsMinor.INSURER,
  TAX_THIRD_PARTY: v.legsMinor.TAX_THIRD_PARTY,
  PLATFORM: v.legsMinor.PLATFORM,
});

/** Mois courant au fuseau du pays (oracle : Intl, donnée de test), premier jour `YYYY-MM-01`. */
function monthOf(timeZone: string, at = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts['year']}-${parts['month']}-01`;
}
function dayOf(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

async function tripOf(tx: Tx, c: CountryCase, start: Date, end: Date): Promise<string> {
  const r = await first<{ trip_id: string }>(
    tx,
    `SELECT * FROM test_fixture.us214_trip($1, $2, 'Ana', 'Pérez', 'María', 'Gómez', $3, $4,
                                           $5::jsonb)`,
    [c.country, uuid(), start.toISOString(), end.toISOString(), LINES],
  );
  return r.trip_id;
}
const futureTrip = (tx: Tx, c: CountryCase): Promise<string> =>
  tripOf(tx, c, new Date(Date.now() + 5 * DAY), new Date(Date.now() + 8 * DAY));

/** Soldes de la plateforme pour les jambes d'un vecteur (fixture de 9400 : capturé, rien libéré). */
async function platformLegs(tx: Tx, trip: string, v: GoldenLegVector): Promise<void> {
  for (const leg of LEGS) {
    await tx.query('SELECT test_fixture.settlement_insert_leg_balance($1, 1, $2, $3, 0)', [
      trip,
      leg,
      v.legsMinor[leg].toString(),
    ]);
  }
}

function fakePsp(): FakePsp {
  return new FakePsp({
    secret: 'whsec_test_only_us311',
    clock: () => Date.now(),
    capabilities: [],
    env: { RUEDA_ENV: 'test' },
  });
}
/** Encaissements au PSP FAKE (un ordre par vecteur, jambes explicites, payé). */
function fakeCaptures(
  psp: FakePsp,
  trip: string,
  currency: string,
  vs: readonly GoldenLegVector[],
) {
  vs.forEach((v, n) => {
    const order = psp.createOrder({
      merchantReference: `${trip}:CAPTURE:a${n + 1}`,
      tripReference: trip,
      method: 'CARD',
      amountMinor: v.totalMinor,
      currency,
      legs: fakeLegs(v),
      capture: 'AUTO',
    });
    psp.customerPays(order.reference);
  });
}
const lineOf = (b: FakeLegBalance) => ({
  tripReference: b.tripReference,
  leg: b.leg,
  currency: b.currency,
  capturedMinor: b.capturedMinor.toString(),
  refundedMinor: b.refundedMinor.toString(),
  reallocatedInMinor: b.reallocatedInMinor.toString(),
  reallocatedOutMinor: b.reallocatedOutMinor.toString(),
  releasedMinor: b.releasedMinor.toString(),
});

async function record(
  tx: Tx,
  hash: Buffer,
  c: CountryCase,
  kind: 'OPERATIONS' | 'LEGS',
  lines: readonly unknown[],
  requestId: string = uuid(),
): Promise<{ outcome: string; run_id: string | null }> {
  return first(tx, RECORD, [
    hash,
    requestId,
    c.country,
    monthOf(c.timezone),
    kind,
    JSON.stringify(lines),
    REASON,
  ]);
}
async function runOf(tx: Tx, hash: Buffer, run: string): Promise<Row> {
  const r = await first<{ outcome: string; body: Row }>(tx, RUN, [hash, uuid(), run, false, null]);
  expect(r.outcome).toBe('OK');
  return r.body;
}
const itemsOf = (body: Row): Row[] => body['items'] as Row[];

/** Rejet SQLSTATE attendu, sans abandonner la transaction du test. */
async function rejects(tx: Tx, sql: string, values: readonly unknown[], code: string) {
  await tx.query('SAVEPOINT us311');
  await expect(tx.query(sql, values as unknown[])).rejects.toMatchObject({ code });
  await tx.query('ROLLBACK TO SAVEPOINT us311');
}

/** Transaction annulée en REPEATABLE READ : un seul instantané (correction #281). */
async function inSnapshot<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withRole('app_api', async (client) => {
    await client.query(`SET default_transaction_isolation = 'repeatable read'`);
    try {
      return await withTestTransaction(client, {}, async (tx) => {
        const { rows } = await tx.query<{ level: string }>(
          `SELECT pg_catalog.current_setting('transaction_isolation') AS level`,
        );
        if (rows[0]?.level !== 'repeatable read') throw new Error('isolement attendu');
        return fn(tx);
      });
    } finally {
      await client.query('RESET default_transaction_isolation');
    }
  });
}

/** Seuil J-ADM-031 : absent des données du pays (fail-closed, 0) tant que le fondateur ne l'a pas fixé. */
const thresholdAbsent = (c: CountryCase): boolean =>
  !(c.country in paramValues('reconciliation_delta_threshold_bps'));

describe.each(byCountry)('US-311 — rapprochement par jambe assisté (%s, %s)', (_k, _cur, c) => {
  it('10 trips, export PSP de 11 opérations dont une de 128,40 sans trip : l’écart « opération sans trip » est visible ; une opération absente du PSP aussi ; seuil absent = 0', async () => {
    await rolledBack(async (tx) => {
      const fin = await ops(tx, 'FINANCE', [c.country]);
      const state = stateOf(c);
      const refs: string[] = [];
      for (let n = 0; n < 10; n += 1) {
        const trip = await futureTrip(tx, c);
        const ref = `us311-${randomUUID()}`;
        await tx.query('SELECT test_fixture.us311_operation($1, $2, $3)', [
          trip,
          state.totalMinor.toString(),
          ref,
        ]);
        refs.push(ref);
      }
      // onzième opération de la plateforme, absente de l'export du PSP
      const extraTrip = await futureTrip(tx, c);
      const extraRef = `us311-${randomUUID()}`;
      await tx.query('SELECT test_fixture.us311_operation($1, $2, $3)', [
        extraTrip,
        state.totalMinor.toString(),
        extraRef,
      ]);
      const orphanRef = `us311-${randomUUID()}`;
      const psp = [
        ...refs.map((reference) => ({
          reference,
          amountMinor: state.totalMinor.toString(),
          currency: c.currency,
        })),
        { reference: orphanRef, amountMinor: ORPHAN_MINOR.toString(), currency: c.currency },
      ];
      expect(psp).toHaveLength(11);

      const r = await record(tx, fin.hash, c, 'OPERATIONS', psp);
      expect(r.outcome).toBe('RECORDED');
      const body = await runOf(tx, fin.hash, r.run_id!);
      // comptes qui ne dépendent que des lignes fournies : exacts
      expect(body).toMatchObject({
        kind: 'OPERATIONS',
        country: c.country,
        currency: c.currency,
        status: 'DISCREPANCIES',
        pspLines: 11,
        matched: 10,
        unmatchedPsp: 1,
        amountMismatches: 0,
        exceedsThreshold: true,
      });
      if (thresholdAbsent(c)) {
        expect(body).toMatchObject({ thresholdBps: 0, thresholdSource: 'ABSENT_ZERO' });
      }
      expect(typeof body['treatBy']).toBe('string');
      const items = itemsOf(body);
      const orphan = items.find((i) => i['ref'] === orphanRef);
      expect(orphan).toMatchObject({
        side: 'PSP',
        status: 'MISSING_PLATFORM',
        finding: 'OPERATION_WITHOUT_TRIP',
        expectedMinor: null,
        observedMinor: ORPHAN_MINOR.toString(),
        deltaMinor: ORPHAN_MINOR.toString(),
        resolution: null,
      });
      for (const ref of refs) {
        expect(items.find((i) => i['ref'] === ref)).toMatchObject({
          status: 'MATCHED',
          expectedMinor: state.totalMinor.toString(),
          observedMinor: state.totalMinor.toString(),
          deltaMinor: '0',
          finding: null,
        });
      }
      expect(items.find((i) => i['ref'] === extraRef)).toMatchObject({
        side: 'PLATFORM',
        status: 'MISSING_PSP',
        finding: 'OPERATION_NOT_IN_PSP',
        deltaMinor: state.totalMinor.toString(),
      });
      // les écarts viennent en tête (lecture du comptable)
      expect(items[0]?.['status']).not.toBe('MATCHED');
      // aucune donnée personnelle dans un élément
      expect(Object.keys(orphan ?? {}).sort()).toEqual(
        [
          'component',
          'deltaMinor',
          'expectedMinor',
          'finding',
          'itemId',
          'leg',
          'observedMinor',
          'ref',
          'resolution',
          'resolvedAt',
          'side',
          'status',
        ].sort(),
      );
      // rejeu de la même requête : même passage, rien de plus
      const replayId = uuid();
      const a = await record(tx, fin.hash, c, 'OPERATIONS', psp, replayId);
      const b = await record(tx, fin.hash, c, 'OPERATIONS', psp, replayId);
      expect(b).toEqual({ outcome: 'ALREADY_RECORDED', run_id: a.run_id });
      // audit chaîné, montants agrégés seulement
      const rec = (
        await first<{ r: Row }>(tx, 'SELECT test_fixture.us311_records($1) AS r', [r.run_id])
      ).r;
      expect(rec['audit']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: 'RECONCILIATION_RUN_RECORDED', role: 'FINANCE' }),
        ]),
      );
    });
  });

  it('jambes d’un trip et listLegBalances du FAKE : chaque jambe appariée (cascade TJ15 = TJ01), écart d’une unité mineure, versement sans jambe et trip inconnu visibles', async () => {
    await rolledBack(async (tx) => {
      const fin = await ops(tx, 'FINANCE', [c.country]);
      const state = stateOf(c);
      const opsOf = operationsOf(c);
      // oracle : Σ des encaissements = état, jambe par jambe (08 E7 règle 10)
      for (const leg of LEGS) {
        expect(opsOf.reduce((s, v) => s + v.legsMinor[leg], 0n)).toBe(state.legsMinor[leg]);
      }
      const psp = fakePsp();
      const exact = await futureTrip(tx, c);
      await platformLegs(tx, exact, state);
      fakeCaptures(psp, exact, c.currency, opsOf);
      // trip dont le PSP a crédité une unité mineure de plus à l'hôte
      const plusOne = await futureTrip(tx, c);
      await platformLegs(tx, plusOne, state);
      const bumped: GoldenLegVector = {
        ...state,
        legsMinor: { ...state.legsMinor, HOST: state.legsMinor.HOST + 1n },
        totalMinor: state.totalMinor + 1n,
      };
      fakeCaptures(psp, plusOne, c.currency, [bumped]);
      // trip dont le PSP a versé la jambe HOST alors que la plateforme n'a rien libéré
      const paidOut = await futureTrip(tx, c);
      await platformLegs(tx, paidOut, state);
      fakeCaptures(psp, paidOut, c.currency, [state]);
      // trip inconnu de la plateforme
      const unknown = randomUUID();
      fakeCaptures(psp, unknown, c.currency, [state]);

      const lines = psp.listLegBalances().map(lineOf);
      const released = lines.map((l) =>
        l.tripReference === paidOut && l.leg === 'HOST'
          ? { ...l, releasedMinor: state.legsMinor.HOST.toString() }
          : l,
      );
      expect(released).toHaveLength(16);

      const r = await record(tx, fin.hash, c, 'LEGS', released);
      expect(r.outcome).toBe('RECORDED');
      const body = await runOf(tx, fin.hash, r.run_id!);
      expect(body).toMatchObject({
        kind: 'LEGS',
        status: 'DISCREPANCIES',
        pspLines: 16,
        matched: 4 + 3 + 3,
        unmatchedPsp: 4,
        amountMismatches: 2,
        exceedsThreshold: true,
      });
      const items = itemsOf(body);
      const of = (trip: string, leg: string) =>
        items.find((i) => i['ref'] === trip && i['leg'] === leg && i['side'] === 'PSP');
      for (const leg of LEGS) {
        expect(of(exact, leg)).toMatchObject({ status: 'MATCHED', deltaMinor: '0' });
        expect(of(unknown, leg)).toMatchObject({
          status: 'MISSING_PLATFORM',
          finding: 'LEG_WITHOUT_TRIP',
        });
      }
      expect(of(plusOne, 'HOST')).toMatchObject({
        status: 'AMOUNT_MISMATCH',
        finding: 'AMOUNT',
        component: 'CAPTURED',
        expectedMinor: state.legsMinor.HOST.toString(),
        observedMinor: (state.legsMinor.HOST + 1n).toString(),
        deltaMinor: '1',
      });
      expect(of(plusOne, 'INSURER')).toMatchObject({ status: 'MATCHED' });
      expect(of(paidOut, 'HOST')).toMatchObject({
        status: 'AMOUNT_MISMATCH',
        component: 'RELEASED',
        expectedMinor: '0',
        observedMinor: state.legsMinor.HOST.toString(),
        deltaMinor: state.legsMinor.HOST.toString(),
      });
      // l'écart chiffré du passage couvre au moins nos écarts (jamais absorbés)
      expect(BigInt(body['deltaMinor'] as string)).toBeGreaterThanOrEqual(
        1n + state.legsMinor.HOST + state.totalMinor,
      );
    });
  });

  it('procédure mensuelle : résolution motivée, checklist incomplète refusée, clôture signée (écarts inexpliqués comptés), registre figé', async () => {
    await rolledBack(async (tx) => {
      const fin = await ops(tx, 'FINANCE', [c.country]);
      const orphanRef = `us311-${randomUUID()}`;
      const second = `us311-${randomUUID()}`;
      const r = await record(tx, fin.hash, c, 'OPERATIONS', [
        { reference: orphanRef, amountMinor: ORPHAN_MINOR.toString(), currency: c.currency },
        { reference: second, amountMinor: '1', currency: c.currency },
      ]);
      const run = r.run_id!;
      const items = itemsOf(await runOf(tx, fin.hash, run));
      const orphan = items.find((i) => i['ref'] === orphanRef)!;
      // résolution : code fermé et note ; une seule fois
      expect(
        await first(tx, RESOLVE, [
          fin.hash,
          uuid(),
          orphan['itemId'],
          'PSP_ERROR',
          'Opération créditée par erreur au compte de la plateforme',
        ]),
      ).toEqual({ outcome: 'RESOLVED' });
      expect(
        await first(tx, RESOLVE, [
          fin.hash,
          uuid(),
          orphan['itemId'],
          'OTHER',
          'Seconde tentative de résolution',
        ]),
      ).toEqual({ outcome: 'ALREADY_RESOLVED' });
      await rejects(tx, RESOLVE, [fin.hash, uuid(), orphan['itemId'], 'FREE_TEXT', 'x'], '22023');
      // checklist incomplète : refusée, rien n'est écrit
      expect(
        await first(tx, SIGN, [
          fin.hash,
          uuid(),
          run,
          JSON.stringify({ ...CHECKLIST, LEGS_RECONCILED: false }),
        ]),
      ).toEqual({ outcome: 'CHECKLIST_INCOMPLETE', unexplained: null });
      await rejects(tx, SIGN, [fin.hash, uuid(), run, JSON.stringify({ SIGNED: true })], '22023');
      // clôture : les écarts non expliqués restent comptés (notre second élément, plus les lignes
      // de la plateforme du mois absentes de ce relevé : lues dans le passage, jamais un total global)
      const open = itemsOf(await runOf(tx, fin.hash, run)).filter(
        (i) => i['status'] !== 'MATCHED' && i['resolution'] === null,
      );
      expect(open.map((i) => i['ref'])).toContain(second);
      expect(open.map((i) => i['ref'])).not.toContain(orphanRef);
      expect(await first(tx, SIGN, [fin.hash, uuid(), run, JSON.stringify(CHECKLIST)])).toEqual({
        outcome: 'CLOSED',
        unexplained: open.length,
      });
      expect(await first(tx, SIGN, [fin.hash, uuid(), run, JSON.stringify(CHECKLIST)])).toEqual({
        outcome: 'ALREADY_CLOSED',
        unexplained: null,
      });
      const secondItem = items.find((i) => i['ref'] === second)!;
      expect(
        await first(tx, RESOLVE, [
          fin.hash,
          uuid(),
          secondItem['itemId'],
          'TIMING',
          'Décalage de date entre le PSP et la plateforme',
        ]),
      ).toEqual({ outcome: 'CLOSED' });
      const closed = await runOf(tx, fin.hash, run);
      expect(closed).toMatchObject({
        status: 'CLOSED',
        unexplainedAtClose: open.length,
        checklist: CHECKLIST,
      });
      // liste du pays : le passage y figure, et l'état des mois est rendu
      const list = await first<{ outcome: string; body: Row }>(tx, RUNS, [fin.hash, c.country]);
      expect(list.outcome).toBe('OK');
      expect((list.body['runs'] as Row[]).some((x) => x['runId'] === run)).toBe(true);
      expect(typeof list.body['dailyReconciliationRequired']).toBe('boolean');
      // registre figé sous iam_staff_owner (garde, RLS) : ni réécriture ni suppression
      await rejects(tx, 'SELECT test_fixture.us311_probe($1, $2)', [run, 'RUN_DELETE'], '42501');
      await rejects(tx, 'SELECT test_fixture.us311_probe($1, $2)', [run, 'ITEM_DELETE'], '42501');
      // montant d'un passage (clôturé ou non) : aucun droit sur la colonne
      await rejects(tx, 'SELECT test_fixture.us311_probe($1, $2)', [run, 'RUN_DELTA'], '42501');
      // élément apparié : jamais « résolu » pour masquer (politique UPDATE : 0 ligne)
      const matchedTrip = await futureTrip(tx, c);
      const matchedRef = `us311-${randomUUID()}`;
      await tx.query('SELECT test_fixture.us311_operation($1, $2, $3)', [
        matchedTrip,
        '7',
        matchedRef,
      ]);
      const m = await record(tx, fin.hash, c, 'OPERATIONS', [
        { reference: matchedRef, amountMinor: '7', currency: c.currency },
      ]);
      expect(
        itemsOf(await runOf(tx, fin.hash, m.run_id!)).find((i) => i['ref'] === matchedRef),
      ).toMatchObject({ status: 'MATCHED' });
      expect(
        (
          await first<Row>(tx, 'SELECT test_fixture.us311_probe($1, $2) AS n', [
            m.run_id,
            'ITEM_MATCH',
          ])
        )['n'],
      ).toBe(0);
      await rejects(
        tx,
        'SELECT test_fixture.us311_probe($1, $2)',
        [m.run_id, 'RUN_DELTA'],
        '42501',
      );
    });
  });

  it('accès : FINANCE / ADMIN du pays ; OPS, autre pays, sans TOTP ou sans session refusés ; relevé mal formé = 22023 ; export journalisé BULK_EXPORT', async () => {
    await rolledBack(async (tx) => {
      const fin = await ops(tx, 'FINANCE', [c.country]);
      const admin = await ops(tx, 'ADMIN', [c.country]);
      const opsAgent = await ops(tx, 'OPS_AGENT', [c.country]);
      const foreign = await ops(tx, 'FINANCE', [otherOf(c).country]);
      const line = [{ reference: `us311-${randomUUID()}`, amountMinor: '5', currency: c.currency }];
      expect((await record(tx, opsAgent.hash, c, 'OPERATIONS', line)).outcome).toBe('FORBIDDEN');
      expect((await record(tx, foreign.hash, c, 'OPERATIONS', line)).outcome).toBe('FORBIDDEN');
      expect((await record(tx, Buffer.alloc(32), c, 'OPERATIONS', line)).outcome).toBe(
        'AUTH_REQUIRED',
      );
      const ok = await record(tx, admin.hash, c, 'OPERATIONS', line);
      expect(ok.outcome).toBe('RECORDED');
      // passage d'un autre pays : même issue qu'un passage inconnu (aucun oracle d'existence)
      expect(
        (await first<Row>(tx, RUN, [foreign.hash, uuid(), ok.run_id, false, null]))['outcome'],
      ).toBe('FORBIDDEN');
      expect((await first<Row>(tx, RUN, [fin.hash, uuid(), uuid(), false, null]))['outcome']).toBe(
        'FORBIDDEN',
      );
      expect(
        (await first<Row>(tx, SIGN, [foreign.hash, uuid(), ok.run_id, JSON.stringify(CHECKLIST)]))[
          'outcome'
        ],
      ).toBe('FORBIDDEN');
      // RECON_FORMAT_INVALID : autre devise, doublon, montant non entier ; RECON_STATEMENT_MISSING
      const month = monthOf(c.timezone);
      const bad = [
        [{ reference: 'us311-a', amountMinor: '5', currency: otherOf(c).currency }],
        [
          { reference: 'us311-b', amountMinor: '5', currency: c.currency },
          { reference: 'us311-b', amountMinor: '6', currency: c.currency },
        ],
        [{ reference: 'us311-c', amountMinor: '5.5', currency: c.currency }],
        [],
      ];
      for (const lines of bad) {
        await rejects(
          tx,
          RECORD,
          [fin.hash, uuid(), c.country, month, 'OPERATIONS', JSON.stringify(lines), REASON],
          '22023',
        );
      }
      // export de la plateforme : motif obligatoire, journal d'accès BULK_EXPORT et audit
      await rejects(tx, EXPORT, [fin.hash, uuid(), c.country, month, 'LEGS', 'court'], '22023');
      const trip = await futureTrip(tx, c);
      await platformLegs(tx, trip, stateOf(c));
      const req = uuid();
      const ex = await first<{ outcome: string; body: Row }>(tx, EXPORT, [
        fin.hash,
        req,
        c.country,
        month,
        'LEGS',
        REASON,
      ]);
      expect(ex.outcome).toBe('OK');
      const rows = (ex.body['rows'] as Row[]).filter((x) => x['tripId'] === trip);
      expect(rows.map((x) => [x['leg'], x['capturedMinor']]).sort()).toEqual(
        LEGS.map((l) => [l, stateOf(c).legsMinor[l].toString()]).sort(),
      );
      // aucune donnée personnelle : identifiants techniques, référence publique, montants
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
        [
          'capturedMinor',
          'currency',
          'frozen',
          'leg',
          'reallocatedInMinor',
          'reallocatedOutMinor',
          'refundedMinor',
          'releasedMinor',
          'tripId',
          'tripRef',
        ].sort(),
      );
      const log = (await first<{ r: Row }>(tx, 'SELECT test_fixture.us311_access($1) AS r', [req]))
        .r;
      expect(log['access']).toEqual([
        {
          kind: 'BULK_EXPORT',
          role: 'FINANCE',
          subjectType: 'RECONCILIATION',
          field: `reconciliation:legs:${c.country}:${month.slice(0, 7)}`,
          purpose: REASON,
        },
      ]);
      expect(log['audit']).toEqual([
        expect.objectContaining({ action: 'STAFF_DATA_ACCESS', role: 'FINANCE' }),
      ]);
      // OPS : l'export financier est refusé et journalisé
      const denied = uuid();
      expect(
        (await first<Row>(tx, EXPORT, [opsAgent.hash, denied, c.country, month, 'LEGS', REASON]))[
          'outcome'
        ],
      ).toBe('FORBIDDEN');
      const deniedLog = (
        await first<{ r: Row }>(tx, 'SELECT test_fixture.us311_access($1) AS r', [denied])
      ).r;
      expect(deniedLog['access']).toEqual([]);
      expect(deniedLog['audit']).toEqual([
        expect.objectContaining({ action: 'STAFF_FORBIDDEN', role: 'STAFF' }),
      ]);
    });
  });
});

describe.each(byCountry)('US-311 — vues de la bêta (%s, %s)', (_k, _cur, c) => {
  it('remises du jour et retards : OPS / ADMIN du pays, sans donnée personnelle ; FINANCE et autre pays refusés ; export journalisé', async () => {
    await rolledBack(async (tx) => {
      const opsAgent = await ops(tx, 'OPS_AGENT', [c.country]);
      const fin = await ops(tx, 'FINANCE', [c.country]);
      const foreign = await ops(tx, 'OPS_AGENT', [otherOf(c).country]);
      const now = new Date();
      const start = new Date(now.getTime() - 60_000);
      const today = await tripOf(tx, c, start, new Date(now.getTime() + 3 * DAY));
      await tx.query('SELECT test_fixture.us311_state($1, $2)', [today, 'KEYS_OUT']);
      const late = await tripOf(
        tx,
        c,
        new Date(now.getTime() - 3 * DAY),
        new Date(now.getTime() - 2 * 3_600_000),
      );
      await tx.query('SELECT test_fixture.us311_state($1, $2)', [late, 'OVERDUE']);

      const hv = await first<{ outcome: string; body: Row }>(tx, VIEW, [
        opsAgent.hash,
        uuid(),
        'HANDOVERS_TODAY',
        c.country,
        false,
        null,
      ]);
      expect(hv.outcome).toBe('OK');
      const mine = (hv.body['rows'] as Row[]).filter((x) => x['tripId'] === today);
      // oracle : jour local du départ = jour local de l'instant (Intl), donnée de test
      if (dayOf(c.timezone, start) === dayOf(c.timezone, now)) {
        expect(mine).toEqual([
          expect.objectContaining({
            kind: 'CHECKIN',
            status: 'IN_PROGRESS',
            hostValidated: false,
            guestValidated: false,
          }),
        ]);
        expect(mine[0]?.['keysAt']).not.toBeNull();
        expect(Object.keys(mine[0] ?? {}).sort()).toEqual(
          [
            'guestValidated',
            'hostValidated',
            'keysAt',
            'kind',
            'orgId',
            'plannedAt',
            'status',
            'tripId',
            'tripRef',
            'vehicleId',
          ].sort(),
        );
      }
      expect(JSON.stringify(hv.body)).not.toMatch(/Pérez|Gómez|fixture\.test/);

      const ov = await first<{ outcome: string; body: Row }>(tx, VIEW, [
        opsAgent.hash,
        uuid(),
        'OVERDUE',
        c.country,
        false,
        null,
      ]);
      const lateRow = (ov.body['rows'] as Row[]).find((x) => x['tripId'] === late);
      expect(lateRow).toMatchObject({ status: 'OVERDUE', stage: 'T30M', bounded: false });
      expect(Number(lateRow?.['minutesLate'])).toBeGreaterThanOrEqual(119);
      expect(JSON.stringify(ov.body)).not.toMatch(/Pérez|Gómez|fixture\.test/);

      // FINANCE : vues de l'ops refusées ; autre pays refusé ; sans session
      for (const hash of [fin.hash, foreign.hash]) {
        expect(
          (await first<Row>(tx, VIEW, [hash, uuid(), 'OVERDUE', c.country, false, null]))[
            'outcome'
          ],
        ).toBe('FORBIDDEN');
      }
      expect(
        (await first<Row>(tx, VIEW, [Buffer.alloc(32), uuid(), 'OVERDUE', c.country, false, null]))[
          'outcome'
        ],
      ).toBe('AUTH_REQUIRED');
      // export : motif obligatoire ; journal d'accès BULK_EXPORT
      await rejects(tx, VIEW, [opsAgent.hash, uuid(), 'OVERDUE', c.country, true, null], '22023');
      const req = uuid();
      expect(
        (await first<Row>(tx, VIEW, [opsAgent.hash, req, 'OVERDUE', c.country, true, REASON]))[
          'outcome'
        ],
      ).toBe('OK');
      const log = (await first<{ r: Row }>(tx, 'SELECT test_fixture.us311_access($1) AS r', [req]))
        .r;
      expect(log['access']).toEqual([
        {
          kind: 'BULK_EXPORT',
          role: 'OPS_AGENT',
          subjectType: 'REPORT',
          field: `report:overdue:${c.country}`,
          purpose: REASON,
        },
      ]);
    });
  });

  it('KPI de sortie : calculés depuis les données (un trip terminé et des clés sans paiement prouvé changent S2, dans un seul instantané) ; S3 non mesurable ; aucune saisie', async () => {
    await inSnapshot(async (tx) => {
      const fin = await ops(tx, 'FINANCE', [c.country]);
      const read = async (): Promise<Row[]> => {
        const r = await first<{ outcome: string; body: Row }>(tx, VIEW, [
          fin.hash,
          uuid(),
          'EXIT_KPI',
          c.country,
          false,
          null,
        ]);
        expect(r.outcome).toBe('OK');
        return r.body['rows'] as Row[];
      };
      const before = await read();
      expect(before.map((k) => k['code'])).toEqual(['S1', 'S2', 'S3', 'S4']);
      const s2 = (rows: Row[]) => rows.find((k) => k['code'] === 'S2')!;
      const done = await futureTrip(tx, c);
      await tx.query('SELECT test_fixture.us311_state($1, $2)', [done, 'COMPLETED']);
      const keys = await futureTrip(tx, c);
      await tx.query('SELECT test_fixture.us311_state($1, $2)', [keys, 'KEYS_OUT']);
      const after = await read();
      expect(Number(s2(after)['value'])).toBe(Number(s2(before)['value']) + 1);
      expect(Number(s2(after)['keysWithoutPayment'])).toBe(
        Number(s2(before)['keysWithoutPayment']) + 1,
      );
      expect(s2(after)['met']).toBe(false);
      expect(after.find((k) => k['code'] === 'S3')).toEqual({
        code: 'S3',
        measurable: false,
        value: null,
        threshold: 100,
        met: null,
      });
      expect(after.find((k) => k['code'] === 'S1')).toMatchObject({ threshold: null, met: null });
      expect(after.find((k) => k['code'] === 'S4')).toMatchObject({ threshold: 0 });
    });
  });
});
