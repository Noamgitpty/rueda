/**
 * US-309 — courses à deux connexions sur les déclarations, les décisions et leur exécution
 * (migration 0175, ADR-195 ; fixture 9909 ; revues qa n° 2, code n° 3, argent n° 2 et n° 3).
 * Rôles de PRODUCTION seulement (`withRole`, assertion L0-05), au Panama (USD) et au Paraguay (PYG).
 *
 * Chaque course : le pid de la seconde session est lu AVANT son appel ; `lock_timeout` et
 * `statement_timeout` bornés ; l'attente est observée dans `pg_locks` par une troisième session ;
 * `finally` annule toute transaction restée ouverte. Attendus tirés de 19 US-309 et de 08 (une seule
 * décision par déclaration, plafond de la franchise acceptée pour le trip, un seul débit séparé, une
 * seule franchise de l'hôte, verrou de la compensation `payout.netting:{hôte}:{devise}` d'US-708 /
 * US-709), jamais du code testé. Données du monde VALIDÉES (deux rôles) ; aucun compte PSP ACTIVE ;
 * aucun interrupteur écrit.
 */
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  amountsOf,
  BEFORE_END,
  claimCase,
  coveredDamage,
  decide,
  elevated,
  END,
  EXECUTE,
  HOUR,
  plusMs,
  record,
  staff,
  uuid,
  world,
} from '../support/claims.ts';
import type { Row, Staff, Tx } from '../support/claims.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';
import { setVirtualNow } from '../support/iam.ts';

const RACE_AT = plusMs(END, 2 * HOUR);

/** Transaction ouverte à la main, bornée, à l'heure de la course. */
async function begin(client: Tx): Promise<void> {
  await client.query('BEGIN');
  await setVirtualNow(client, RACE_AT);
  await client.query(`SET LOCAL lock_timeout = '15s'`);
  await client.query(`SET LOCAL statement_timeout = '30s'`);
}

async function worker(client: Tx): Promise<void> {
  await begin(client);
  await setSessionContext(client, { kind: 'WORKER', workerName: 'payment_command' });
}

interface Setup {
  readonly a: Staff;
  readonly b: Staff;
  /** Trip aux trois déclarations (hôte dommage, voyageur incident, hôte incident). */
  readonly trip: string;
  readonly claims: readonly [string, string, string];
  /** Trip sans déclaration, et son dossier CLAIM (course de déclarations). */
  readonly fresh: { readonly trip: string; readonly caseId: string };
  /** Décisions validées à exécuter (course d'exécution ; verrou de la compensation). */
  readonly decision: string;
  readonly nettingDecision: string;
  readonly nettingTrip: string;
}

async function setup(c: CountryCase): Promise<Setup> {
  return withRole('app_api', (api) =>
    withTestTransaction(api, { virtualNow: BEFORE_END, commit: true }, async (tx) => {
      const ops = await staff(tx, 'OPS_AGENT', [c.country]);
      const a = await staff(tx, 'ADMIN', [c.country]);
      const b = await staff(tx, 'ADMIN', [c.country]);
      const w = await world(tx, c);
      const f = await world(tx, c);
      const x = await world(tx, c);
      const n = await world(tx, c);
      const k = await claimCase(tx, c, w.trip, ops.id);
      const kf = await claimCase(tx, c, f.trip, a.id);
      const kx = await claimCase(tx, c, x.trip, ops.id);
      const kn = await claimCase(tx, c, n.trip, ops.id);
      await setVirtualNow(tx, plusMs(END, HOUR));
      let hash = await elevated(tx, ops);
      const id = async (r: Promise<Row>): Promise<string> => String((await r)['claim_id']);
      const claims = [
        await id(record(tx, hash, w.trip, k, 'HOST', 'DAMAGE')),
        await id(record(tx, hash, w.trip, k, 'GUEST', 'INCIDENT')),
        await id(record(tx, hash, w.trip, k, 'HOST', 'INCIDENT')),
      ] as const;
      const cx = await id(record(tx, hash, x.trip, kx));
      const cn = await id(record(tx, hash, n.trip, kn));
      hash = await elevated(tx, a);
      const dx = await decide(tx, hash, cx, coveredDamage(c));
      const dn = await decide(tx, hash, cn, coveredDamage(c));
      expect([dx['outcome'], dn['outcome']]).toEqual(['DECIDED', 'DECIDED']);
      return {
        a,
        b,
        trip: w.trip,
        claims,
        fresh: { trip: f.trip, caseId: kf },
        decision: String(dx['decision_id']),
        nettingDecision: String(dn['decision_id']),
        nettingTrip: n.trip,
      };
    }),
  );
}

describe.each(COUNTRIES)('US-309 — courses à deux connexions ($country, $currency)', (c) => {
  it('décisions et déclarations simultanées : même déclaration ⇒ la seconde CLAIM_ALREADY_DECIDED ; deux déclarations du même trip ⇒ la seconde attend le verrou du trip et voit le plafond consommé (DAMAGE_ABOVE_ACCEPTED_AMOUNT) ; même déclarant ⇒ CLAIM_ALREADY_OPEN', async () => {
    const s = await setup(c);
    const a = amountsOf(c);
    const first = a['host']! + a['fee']! + a['feeTax']!;
    const rest = a['cap']! - first;
    const only = (n: bigint): Row => ({
      ...coveredDamage(c),
      amountMinor: n.toString(),
      lines: [{ category: 'REPAIR', amountMinor: n.toString() }],
      hostDeductibleMinor: '0',
    });
    await withRole('app_worker', (observer) =>
      withRole('app_api', (one) =>
        withRole('app_api', async (two) => {
          // (1) même déclaration : la seconde attend la ligne, puis voit la décision validée
          try {
            await begin(one);
            const h1 = await elevated(one, s.a);
            expect((await decide(one, h1, s.claims[0], coveredDamage(c)))['outcome']).toBe(
              'DECIDED',
            );
            const pid = await backendPid(two);
            await begin(two);
            const h2 = await elevated(two, s.b);
            const pending = decide(two, h2, s.claims[0], coveredDamage(c));
            await waitUntilBlocked(observer, pid, 'transactionid');
            await one.query('COMMIT');
            expect((await pending)['outcome']).toBe('CLAIM_ALREADY_DECIDED');
            await two.query('ROLLBACK');
          } finally {
            await one.query('ROLLBACK').catch(() => undefined);
            await two.query('ROLLBACK').catch(() => undefined);
          }
          // (2) deux déclarations du même trip : verrou du trip, plafond relu après la première
          try {
            await begin(one);
            const h1 = await elevated(one, s.a);
            expect((await decide(one, h1, s.claims[1], only(rest)))['outcome']).toBe('DECIDED');
            const pid = await backendPid(two);
            await begin(two);
            const h2 = await elevated(two, s.b);
            const pending = decide(two, h2, s.claims[2], only(1n));
            await waitUntilBlocked(observer, pid, 'advisory');
            await one.query('COMMIT');
            expect((await pending)['outcome']).toBe('DAMAGE_ABOVE_ACCEPTED_AMOUNT');
            await two.query('ROLLBACK');
          } finally {
            await one.query('ROLLBACK').catch(() => undefined);
            await two.query('ROLLBACK').catch(() => undefined);
          }
          // (3) même déclaration enregistrée deux fois en même temps : une seule vivante
          try {
            await begin(one);
            const h1 = await elevated(one, s.a);
            expect((await record(one, h1, s.fresh.trip, s.fresh.caseId))['outcome']).toBe(
              'RECORDED',
            );
            const pid = await backendPid(two);
            await begin(two);
            const h2 = await elevated(two, s.a);
            const pending = record(two, h2, s.fresh.trip, s.fresh.caseId);
            await waitUntilBlocked(observer, pid, 'advisory');
            await one.query('COMMIT');
            expect((await pending)['outcome']).toBe('CLAIM_ALREADY_OPEN');
            await two.query('ROLLBACK');
          } finally {
            await one.query('ROLLBACK').catch(() => undefined);
            await two.query('ROLLBACK').catch(() => undefined);
          }
          const claims = await observer.query<Row>('SELECT * FROM test_fixture.us309_claims($1)', [
            s.fresh.trip,
          ]);
          expect(claims.rows).toHaveLength(1);
        }),
      ),
    );
  }, 120_000);

  it('exécutions simultanées de la même décision : la seconde attend le verrou du trip, puis rend DONE sans rien écrire ; un seul débit séparé, une seule franchise de l’hôte', async () => {
    const s = await setup(c);
    await withRole('app_worker', (observer) =>
      withRole('app_worker', (one) =>
        withRole('app_worker', async (two) => {
          try {
            await worker(one);
            expect((await one.query<Row>(EXECUTE, [s.decision, uuid()])).rows[0]).toEqual({
              outcome: 'DONE',
              code: null,
            });
            const pid = await backendPid(two);
            await worker(two);
            const pending = two.query<Row>(EXECUTE, [s.decision, uuid()]);
            await waitUntilBlocked(observer, pid, 'transactionid');
            await one.query('COMMIT');
            expect((await pending).rows[0]).toEqual({ outcome: 'DONE', code: null });
            await two.query('COMMIT');
          } finally {
            await one.query('ROLLBACK').catch(() => undefined);
            await two.query('ROLLBACK').catch(() => undefined);
          }
          expect(
            (await observer.query('SELECT * FROM test_fixture.us309_charges($1)', [s.decision]))
              .rows,
          ).toHaveLength(1);
          expect(
            (await observer.query('SELECT * FROM test_fixture.us309_ledger($1)', [s.decision]))
              .rows,
          ).toHaveLength(1);
        }),
      ),
    );
  }, 120_000);

  it('franchise de l’hôte : l’exécution prend le verrou de la compensation payout.netting:{hôte}:{devise} (même clé qu’US-708 / US-709) et l’attend tant qu’un autre écrivain le tient', async () => {
    const s = await setup(c);
    await withRole('app_worker', (observer) =>
      withRole('app_worker', (one) =>
        withRole('app_worker', async (two) => {
          const org = (
            await observer.query<{ o: string }>(
              'SELECT test_fixture.us309_trip_org($1)::text AS o',
              [s.nettingTrip],
            )
          ).rows[0]!.o;
          try {
            await worker(one);
            await one.query(
              `SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))`,
              [`payout.netting:${org}:${c.currency}`],
            );
            const pid = await backendPid(two);
            await worker(two);
            const pending = two.query<Row>(EXECUTE, [s.nettingDecision, uuid()]);
            await waitUntilBlocked(observer, pid, 'advisory');
            await one.query('ROLLBACK');
            expect((await pending).rows[0]).toEqual({ outcome: 'DONE', code: null });
            expect(
              (await two.query('SELECT * FROM test_fixture.us309_ledger($1)', [s.nettingDecision]))
                .rows,
            ).toHaveLength(1);
          } finally {
            await one.query('ROLLBACK').catch(() => undefined);
            await two.query('ROLLBACK').catch(() => undefined);
          }
        }),
      ),
    );
  }, 120_000);
});
