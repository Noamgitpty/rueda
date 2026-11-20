/**
 * US-709 (migration 0167, ADR-187) — course à deux connexions : compensation d'un lot ↔ passage en
 * perte d'une créance du MÊME hôte et de la MÊME devise (revue argent / concurrence, MOYEN
 * « interblocage »). Une connexion par client, libérée.
 *
 * Ordre des verrous commun : verrou consultatif `payout.netting:{hôte}:{devise}` PUIS l'avance. Sur
 * le passage en perte (`core.settlement_cmd_approve_finance_action`) comme sur la compensation
 * (`core.payout_refresh_batch`), le second arrivé attend le VERROU CONSULTATIF (observé dans
 * `pg_locks`, type `advisory`), jamais la ligne de l'avance : aucun interblocage (40P01), et
 * l'invariant crédit ≤ dette tient (solde final nul, jamais positif).
 *
 * - (1) la compensation (lot READY, avance recouvrée) tient le verrou ; le passage en perte attend
 *   le verrou consultatif ; la compensation est annulée ; le passage en perte aboutit sur le reste
 *   dû (la créance entière) ;
 * - (2) le passage en perte (validé ensuite) tient le verrou ; la préparation du lot attend le
 *   verrou consultatif ; après la validation, la compensation ne trouve plus de dette (0).
 *
 * `payouts_enabled[pays]` ouvert par la procédure à DEUX personnes d'US-125 dans une fenêtre
 * lointaine refermée (comme `l0-us708-payout-open`) ; les écritures du versement restent dans une
 * transaction ANNULÉE ; la créance (règlement v1 enregistré par la vraie commande, vecteurs T03 /
 * T27) et la décision FINANCE sont VALIDÉES (fichier isolé, `vitest.l0.config.ts`).
 * Sous les rôles de PRODUCTION (L0-05 : withRole), PA / USD et PY / PYG. Créances : 08 TJ18b / TJ18d.
 */
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';
import { goLive, openSwitchWindow } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { applySignedStatus, recordOperation, uuid } from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { staff, staffSessionHash } from '../support/rls.ts';
import {
  golden,
  insertTrip as insertSettlementTrip,
  recordAsSettlementWorker,
  recordOfVector,
} from '../support/settlement.ts';
import { uniqueSerial } from '../support/unique.ts';

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const CAPTURE_REF: Readonly<Record<string, string>> = { USD: 'TJ01', PYG: 'TJ08a' };
const SETTLEMENT_REF: Readonly<Record<string, string>> = { USD: 'T03', PYG: 'T27' };
/** 08 TJ18b / TJ18d : créance de l'hôte née de l'avance de Kmino (règle 3 bis). */
const CLAIM: Readonly<Record<string, bigint>> = { USD: 7_500n, PYG: 518_750n };
const REASON = 'Créance irrécouvrable après épuisement du recouvrement (course)';
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const REQUEST = 'SELECT * FROM core.settlement_cmd_request_finance_action($1, $2, $3, $4, $5)';
const APPROVE = 'SELECT outcome FROM core.settlement_cmd_approve_finance_action($1, $2)';

async function farWindow(client: Tx): Promise<{ from: number; to: number }> {
  const n = await uniqueSerial(client);
  const from = Date.UTC(2950, 0, 1) + Number(n) * 14 * DAY;
  return { from, to: from + 12 * DAY };
}

async function setNow(tx: Tx, at: number): Promise<void> {
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso(at)]);
}

interface Staff {
  readonly financeA: string;
  readonly financeB: string;
}

/** Fenêtre de l'interrupteur ouverte à deux personnes, FINANCE A et B du pays (VALIDÉS). */
async function setup(c: CountryCase): Promise<{ window: { from: number; to: number } } & Staff> {
  return withRole('app_api', async (api) => {
    const made = await withTestTransaction(api, { commit: true }, async (tx) => ({
      admin: await staff(tx, 'ADMIN', [c.country]),
      superadmin: await staff(tx, 'SUPERADMIN', [c.country]),
      financeA: await staff(tx, 'FINANCE', [c.country]),
      financeB: await staff(tx, 'FINANCE', [c.country]),
    }));
    const actor = (id: string): StaffActor =>
      ({
        userId: id,
        hash: Buffer.from(staffSessionHash(id) ?? '', 'hex'),
        scope: [c.country],
      }) as unknown as StaffActor;
    const window = await farWindow(api);
    await openSwitchWindow(
      api,
      actor(made.admin),
      actor(made.superadmin),
      'payouts_enabled',
      c.country,
      iso(window.from),
      iso(window.to),
    );
    return { window, financeA: made.financeA, financeB: made.financeB };
  });
}

/** Créance VALIDÉE du compte d'hôte `org` sur un règlement v1 enregistré par la vraie commande. */
async function committedClaim(
  c: CountryCase,
  org: string,
  slot: number,
): Promise<{ advance: string; trip: string }> {
  const advance = uuid();
  const trip = await withRole('app_worker', async (worker) => {
    const trip = await withTestTransaction(worker, { commit: true }, async (tx) => {
      const t = await insertSettlementTrip(tx, c, slot, org);
      await recordAsSettlementWorker(
        tx,
        { tripId: t.id, version: 1 },
        recordOfVector(SETTLEMENT_REF[c.currency] ?? ''),
      );
      return t.id;
    });
    await withTestTransaction(worker, { commit: true }, async (tx) => {
      await tx.query('SELECT test_fixture.us709_receivable_on_head($1, $2, $3::bigint)', [
        advance,
        trip,
        (CLAIM[c.currency] ?? 0n).toString(),
      ]);
    });
    return trip;
  });
  return { advance, trip };
}

/** Demande WRITE_OFF_RECEIVABLE de FINANCE A (validée) ; rend l'identifiant de la demande. */
async function requestWriteOff(c: CountryCase, s: Staff, advance: string): Promise<string> {
  return withRole('app_api', (api) =>
    withTestTransaction(api, { commit: true }, async (tx) => {
      const token = Buffer.from(staffSessionHash(s.financeA) ?? '', 'hex');
      await setSessionContext(tx, {
        kind: 'STAFF',
        actorId: s.financeA,
        countryScope: [c.country],
        sessionTokenHash: token.toString('hex'),
      });
      const { rows } = await tx.query<{ outcome: string; approval_id: string }>(REQUEST, [
        token,
        uuid(),
        'WRITE_OFF_RECEIVABLE',
        advance,
        REASON,
      ]);
      expect(rows[0]?.outcome).toBe('REQUESTED');
      return rows[0]?.approval_id ?? '';
    }),
  );
}

/** Approbation de FINANCE B dans une transaction OUVERTE de `api` (validée par l'appelant). */
async function approveIn(api: Tx, c: CountryCase, s: Staff, approval: string): Promise<string> {
  const token = Buffer.from(staffSessionHash(s.financeB) ?? '', 'hex');
  await setSessionContext(api, {
    kind: 'STAFF',
    actorId: s.financeB,
    countryScope: [c.country],
    sessionTokenHash: token.toString('hex'),
  });
  const { rows } = await api.query<{ outcome: string }>(APPROVE, [token, approval]);
  return rows[0]?.outcome ?? '';
}

/**
 * Lot du compte d'hôte `org` dans la transaction OUVERTE `tx` (travailleur payment_command, fenêtre
 * ouverte) : trip encaissé, conditions du versement posées, terminé, préparé ; rend le lot et
 * l'échéance.
 */
async function preparedBatch(
  tx: Tx,
  c: CountryCase,
  org: string,
  window: { from: number; to: number },
): Promise<{ batch: string; payoutAt: number; host: bigint }> {
  const capture: Legs = { ...legVector(golden, CAPTURE_REF[c.currency] ?? '').legsMinor };
  await setNow(tx, window.from + 60_000);
  expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(true);
  await tx.query(`SELECT pg_catalog.set_config('app.test_deployment_env', 'test', true)`);
  // compte PSP FAKE ACTIVE partagé du pays (fixture 9800 : un seul compte ACTIVE par pays)
  const account = await tx.query<{ id: string }>(
    'SELECT test_fixture.us024_psp_account($1) AS id',
    [c.country],
  );
  const psp = account.rows[0]?.id ?? '';
  await tx.query(`SELECT test_fixture.us708_validate_blocking_capabilities('FAKE', $1)`, [
    c.country,
  ]);
  const trip = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    uuid(),
    org,
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    '2034-12-01T10:00:00Z',
    '2034-12-04T10:00:00Z',
  ]);
  const { operation_id: op } = await recordOperation(tx, {
    tripId: trip,
    accountId: psp,
    kind: 'CAPTURE',
    amountMinor: LEGS.reduce((s, k) => s + capture[k], 0n),
    currency: c.currency,
    idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
    legs: capture,
  });
  expect(await applySignedStatus(tx, op, 'SUCCEEDED')).toBe('APPLIED');
  await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [op]);
  for (const y of new Set([
    new Date(window.from).getUTCFullYear(),
    new Date(window.to).getUTCFullYear(),
  ])) {
    await tx.query('SELECT test_fixture.us708_holiday($1, make_date($2::integer, 1, 1))', [
      c.country,
      y,
    ]);
  }
  await tx.query('SELECT test_fixture.us708_verified_account($1, NULL)', [trip]);
  await tx.query('SELECT test_fixture.us049_activate_submerchant($1, $2)', [psp, trip]);
  await setNow(tx, window.from + DAY);
  await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);
  const { rows } = await tx.query<{ outcome: string; batch_id: string; payout_at: string }>(
    `SELECT outcome, batch_id, payout_at::text AS payout_at FROM core.payout_cmd_prepare_trip($1)`,
    [trip],
  );
  expect(rows[0]?.outcome).toBe('PREPARED');
  return {
    batch: rows[0]?.batch_id ?? '',
    payoutAt: Date.parse(rows[0]?.payout_at ?? ''),
    host: capture.HOST,
  };
}

async function netBatch(tx: Tx, batch: string, payoutAt: number) {
  await setNow(tx, payoutAt + 60_000);
  const { rows } = await tx.query<{ outcome: string; netted: string }>(
    'SELECT outcome, netted_minor::text AS netted FROM core.payout_cmd_net_batch($1)',
    [batch],
  );
  return rows[0];
}

interface Entry {
  readonly reason: string;
  readonly amount_minor: string;
}
async function ledgerOfAdvance(observer: Tx, trip: string): Promise<Entry[]> {
  const { rows } = await observer.query<Entry>(
    'SELECT reason, amount_minor FROM test_fixture.us709_ledger($1)',
    [trip],
  );
  return rows;
}

describe.each(COUNTRIES)(
  'US-709 — compensation ↔ passage en perte, même hôte et même devise — $country ($currency)',
  (c) => {
    it('(1) la compensation tient le verrou : le passage en perte attend le verrou consultatif (jamais l’avance), puis aboutit ; aucun 40P01 ; solde final nul', async () => {
      const s = await setup(c);
      const org = uuid();
      const { advance, trip } = await committedClaim(c, org, 41);
      const approval = await requestWriteOff(c, s, advance);
      const claim = CLAIM[c.currency] ?? 0n;
      await withRole('app_worker', (observer) =>
        withRole('app_worker', (worker) =>
          withRole('app_api', async (api) => {
            await worker.query('BEGIN');
            try {
              await setSessionContext(worker, { kind: 'WORKER', workerName: 'payment_command' });
              const b = await preparedBatch(worker, c, org, s.window);
              const net = await netBatch(worker, b.batch, b.payoutAt);
              expect(net).toEqual({ outcome: 'READY', netted: claim.toString() });
              const pid = await backendPid(api);
              await api.query('BEGIN');
              const pending = approveIn(api, c, s, approval);
              await waitUntilBlocked(observer, pid, 'advisory');
              await worker.query('ROLLBACK');
              expect(await pending).toBe('APPROVED');
              await api.query('COMMIT');
            } finally {
              await worker.query('ROLLBACK').catch(() => undefined);
              await api.query('ROLLBACK').catch(() => undefined);
            }
            const ledger = await ledgerOfAdvance(observer, trip);
            expect(ledger.map((e) => [e.reason, e.amount_minor])).toEqual([
              ['RELEASED_LEG_ADVANCE', (-claim).toString()],
              ['RECEIVABLE_WRITE_OFF', claim.toString()],
            ]);
            const state = await observer.query<{ state: string; balance_minor: string }>(
              'SELECT state, balance_minor FROM test_fixture.us709_state($1)',
              [trip],
            );
            expect(state.rows).toEqual([{ state: 'WRITTEN_OFF', balance_minor: '0' }]);
          }),
        ),
      );
    }, 120_000);

    it('(2) le passage en perte tient le verrou : la préparation du lot attend le verrou consultatif, puis la compensation ne trouve plus de dette ; crédit ≤ dette', async () => {
      const s = await setup(c);
      const org = uuid();
      const { advance, trip } = await committedClaim(c, org, 42);
      const approval = await requestWriteOff(c, s, advance);
      const claim = CLAIM[c.currency] ?? 0n;
      await withRole('app_worker', (observer) =>
        withRole('app_worker', (worker) =>
          withRole('app_api', async (api) => {
            await api.query('BEGIN');
            await worker.query('BEGIN');
            try {
              expect(await approveIn(api, c, s, approval)).toBe('APPROVED');
              await setSessionContext(worker, { kind: 'WORKER', workerName: 'payment_command' });
              const pid = await backendPid(worker);
              const pending = preparedBatch(worker, c, org, s.window);
              await waitUntilBlocked(observer, pid, 'advisory');
              await api.query('COMMIT');
              const b = await pending;
              const net = await netBatch(worker, b.batch, b.payoutAt);
              expect(net).toEqual({ outcome: 'READY', netted: '0' });
              const ledger = await ledgerOfAdvance(worker, trip);
              expect(ledger.map((e) => e.reason)).not.toContain('PAYOUT_NETTING');
              const sum = ledger.reduce((t, e) => t + BigInt(e.amount_minor), 0n);
              expect(sum).toBe(0n);
              expect(claim).toBeGreaterThan(0n);
            } finally {
              await worker.query('ROLLBACK').catch(() => undefined);
              await api.query('ROLLBACK').catch(() => undefined);
            }
          }),
        ),
      );
    }, 120_000);
  },
);
