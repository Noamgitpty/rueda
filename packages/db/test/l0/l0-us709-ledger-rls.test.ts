/**
 * US-709 (migration 0167, ADR-187) — lectures du grand livre de l'hôte et passage en perte à deux
 * personnes (19 US-709 critères 3 et 4 ; 17 RLS-2, RLS-26, RLS-28 ; 17 §2.9 règle 4 ; pré-mortem
 * L3-PM-42, L3-PM-43 ; red team RT-L3-V09, RT-L3-V10).
 *
 * Sous les rôles de PRODUCTION (assertion L0-05 : withRole / connectAs), contexte posé par
 * `setSessionContext` (asActor), monde d'US-011 (`support/rls.ts` : le MÊME particulier titulaire du
 * compte A dans les deux pays, un co-hôte, l'hôte B, le staff), règlements v1 enregistrés par la
 * vraie commande (vecteurs T03 / T27), créance de la règle 3 bis de A (fixture 9918, forme de 0139)
 * sur le règlement en tête de son trip a1, en USD (PA) et en PYG sans décimale (PY).
 *
 * - RLS-26 : le titulaire lit SA créance dans `host_advance_v` (reste dû après une compensation
 *   partielle), sans identifiant du personnel ; jamais le grand livre, son état ni une imputation.
 * - RLS-28 : le co-hôte à qui le titulaire a donné PAR ERREUR `finance.read_org_statements` lit
 *   0 ligne de `trip_leg_balance` et de `host_advance_v` ; l'hôte B ne lit rien de A.
 * - FINANCE / ADMIN du pays lisent l'état SM-6b, FINANCE d'un autre pays rien.
 * - `WRITE_OFF_RECEIVABLE` : seulement par deux personnes distinctes ; la décision écrit le crédit
 *   `RECEIVABLE_WRITE_OFF` du reste dû au grand livre, dans la devise de la créance (WRITTEN_OFF).
 * Les attendus viennent de 17 §2.3, §2.9 et des vecteurs de l'export, jamais du code testé.
 */
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import {
  asActor,
  buildWorld,
  staff,
  staffSessionHash,
  uuid,
  type CountryWorld,
  type World,
} from '../support/rls.ts';
import {
  captureLegs,
  golden,
  recordAsSettlementWorker,
  recordOfVector,
} from '../support/settlement.ts';

const REF: Readonly<Record<string, { readonly vector: string; readonly capture: string }>> = {
  USD: { vector: 'T03', capture: 'TJ01' },
  PYG: { vector: 'T27', capture: 'TJ08a' },
};
/** 08 TJ18b / TJ18d : créance de l'hôte née de l'avance de Kmino (règle 3 bis). */
const CLAIM: Readonly<Record<string, bigint>> = { USD: 7_500n, PYG: 518_750n };
const REASON = 'Créance irrécouvrable après épuisement du recouvrement (test)';

let world: World;
const advances: string[] = [];
const people = { financeA: '', financeB: '' };

const w = (i: number): CountryWorld => {
  const x = world.countries[i];
  if (!x) throw new Error(`pays ${i}`);
  return x;
};
const claimOf = (i: number): bigint => CLAIM[w(i).c.currency] ?? 0n;
const hashOf = (actor: string): Buffer => Buffer.from(staffSessionHash(actor) ?? '', 'hex');
const api = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> => withRole('app_api', fn);

beforeAll(async () => {
  const client = await connectAs('app_api');
  try {
    world = await buildWorld(client, COUNTRIES);
    await withTestTransaction(client, { commit: true }, async (tx) => {
      people.financeA = await staff(tx, 'FINANCE', [w(0).c.country]);
      people.financeB = await staff(tx, 'FINANCE', [w(0).c.country]);
      for (const x of world.countries) {
        // le titulaire donne PAR ERREUR la permission des relevés de gains à son co-hôte (RLS-28)
        await tx.query('SELECT test_fixture.us062_set_permission_overrides($1, $2, $3::text[])', [
          world.cohost,
          x.orgA,
          ['finance.read_org_statements'],
        ]);
      }
    });
  } finally {
    await releaseClient(client);
  }
  await withRole('app_worker', async (worker) => {
    await withTestTransaction(worker, { commit: true }, async (tx) => {
      for (const x of world.countries) {
        const ref = REF[x.c.currency];
        if (ref === undefined) throw new Error(`aucun vecteur en ${x.c.currency}`);
        await recordAsSettlementWorker(
          tx,
          { tripId: x.trips.a1.id, version: 1 },
          recordOfVector(ref.vector),
        );
      }
    });
    await withTestTransaction(worker, { commit: true }, async (tx) => {
      for (const x of world.countries) {
        const ref = REF[x.c.currency];
        await captureLegs(tx, x.trips.a1.id, legVector(golden, ref?.capture ?? '').legsMinor);
      }
    });
  });
  await api((client) =>
    withTestTransaction(client, { commit: true }, async (tx) => {
      for (const [i, x] of world.countries.entries()) {
        const id = uuid();
        await tx.query('SELECT test_fixture.us709_receivable_on_head($1, $2, $3::bigint)', [
          id,
          x.trips.a1.id,
          claimOf(i).toString(),
        ]);
        advances.push(id);
      }
    }),
  );
}, 240_000);

interface HostAdvance {
  readonly id: string;
  readonly status: string;
  readonly amount_minor: string;
  readonly outstanding_minor: string;
}
async function hostAdvances(tx: pg.ClientBase): Promise<HostAdvance[]> {
  const { rows } = await tx.query<HostAdvance>(
    `SELECT id, status, amount_minor::text, outstanding_minor::text
       FROM core.settlement_host_advance_v WHERE id = ANY ($1::uuid[]) ORDER BY id`,
    [advances],
  );
  return rows;
}
async function count(tx: pg.ClientBase, sql: string, params: readonly unknown[]): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `SELECT pg_catalog.count(*)::int AS n FROM ${sql}`,
    [...params],
  );
  return rows[0]?.n ?? -1;
}

describe.each([0, 1])('US-709 — lectures du grand livre de l’hôte — pays n° %i', (i) => {
  it('RLS-26 : le titulaire lit SA créance dans host_advance_v (reste dû après compensation partielle), sans identifiant du personnel ; jamais le grand livre, l’état ni une imputation', async () => {
    const x = w(i);
    const claim = claimOf(i);
    const part = claim / 3n;
    await api((client) =>
      asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: x.orgA }, async (tx) => {
        const own = (await hostAdvances(tx)).filter((r) => r.id === advances[i]);
        expect(own).toEqual([
          {
            id: advances[i],
            status: 'OPEN',
            amount_minor: claim.toString(),
            outstanding_minor: claim.toString(),
          },
        ]);
        // compensation partielle (état laissé par un lot compensé, fixture 9918) : reste dû lu
        await tx.query('SELECT test_fixture.us709_recover($1, $2::bigint)', [
          advances[i],
          part.toString(),
        ]);
        expect((await hostAdvances(tx)).filter((r) => r.id === advances[i])).toEqual([
          {
            id: advances[i],
            status: 'RECOVERING',
            amount_minor: claim.toString(),
            outstanding_minor: (claim - part).toString(),
          },
        ]);
        // aucune créance d'un autre pays ni d'un autre hôte
        expect((await hostAdvances(tx)).map((r) => r.id)).toEqual([advances[i]]);
        const cols = await tx.query<{ col: string }>(
          `SELECT a.attname::text AS col FROM pg_catalog.pg_attribute a
            WHERE a.attrelid = 'core.settlement_host_advance_v'::regclass AND a.attnum > 0
              AND NOT a.attisdropped ORDER BY 1`,
        );
        for (const staffColumn of ['decided_by', 'decision_second_by', 'written_off_by']) {
          expect(cols.rows.map((r) => r.col)).not.toContain(staffColumn);
        }
        for (const table of [
          'core.settlement_host_ledger_entry',
          'core.settlement_host_ledger_state',
          'core.settlement_chargeback_imputation',
        ]) {
          expect(await count(tx, `${table} WHERE org_id = $1`, [x.orgA]), table).toBe(0);
        }
      }),
    );
    await api(async (client) => {
      await expect(
        asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: x.orgA }, (tx) =>
          tx.query('SELECT decided_by FROM core.settlement_platform_advance'),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('RLS-28 : co-hôte muni PAR ERREUR de finance.read_org_statements ⇒ 0 ligne de trip_leg_balance et de host_advance_v ; hôte B : rien de A', async () => {
    const x = w(i);
    await api(async (client) => {
      await asActor(client, { kind: 'HOST', actorId: world.cohost, orgId: x.orgA }, async (tx) => {
        const { rows } = await tx.query<{ perm: boolean; holder: boolean }>(
          `SELECT app.has_permission('finance.read_org_statements') AS perm,
                  app.is_org_holder() AS holder`,
        );
        expect(rows[0]).toEqual({ perm: true, holder: false });
        expect(
          await count(tx, 'core.settlement_trip_leg_balance WHERE trip_id = $1', [x.trips.a1.id]),
        ).toBe(0);
        expect(await hostAdvances(tx)).toEqual([]);
      });
      // témoin : le titulaire, lui, lit la jambe HOST de son trip (RLS-2)
      await asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: x.orgA }, async (tx) => {
        const { rows } = await tx.query<{ leg: string }>(
          'SELECT leg FROM core.settlement_trip_leg_balance WHERE trip_id = $1 ORDER BY leg',
          [x.trips.a1.id],
        );
        expect(rows.map((r) => r.leg)).toEqual(['HOST']);
      });
      await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgB }, async (tx) => {
        expect(await hostAdvances(tx)).toEqual([]);
        expect(
          await count(tx, 'core.settlement_trip_leg_balance WHERE trip_id = $1', [x.trips.a1.id]),
        ).toBe(0);
      });
    });
  });

  it('FINANCE / ADMIN du pays lisent l’état SM-6b de A (NEGATIVE) ; FINANCE d’un autre pays : rien', async () => {
    const x = w(i);
    await api(async (client) => {
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: [x.c.country] },
        async (tx) => {
          const { rows } = await tx.query<{ state: string; balance_minor: string }>(
            `SELECT state, balance_minor::text FROM core.settlement_host_ledger_state
              WHERE org_id = $1`,
            [x.orgA],
          );
          expect(rows).toEqual([{ state: 'NEGATIVE', balance_minor: (-claimOf(i)).toString() }]);
        },
      );
      // FINANCE de portée {premier pays} : rien du second
      if (i === 1) {
        await asActor(
          client,
          { kind: 'STAFF', actorId: people.financeA, countryScope: [w(0).c.country] },
          async (tx) => {
            expect(
              await count(tx, 'core.settlement_host_ledger_state WHERE org_id = $1', [x.orgA]),
            ).toBe(0);
          },
        );
      }
    });
  });
});

interface Outcome {
  readonly outcome: string;
  readonly approval_id: string | null;
}
async function finance(
  client: pg.ClientBase,
  actor: string,
  sql: string,
  params: readonly unknown[],
): Promise<Outcome> {
  const token = hashOf(actor);
  return withTestTransaction(client, { commit: true }, async (tx) => {
    await setSessionContext(tx, {
      kind: 'STAFF',
      actorId: actor,
      countryScope: [w(0).c.country],
      sessionTokenHash: token.toString('hex'),
    });
    const { rows } = await tx.query<Outcome>(sql, [token, ...params]);
    return rows[0] ?? { outcome: '', approval_id: null };
  });
}
const REQUEST = 'SELECT * FROM core.settlement_cmd_request_finance_action($1, $2, $3, $4, $5)';
const APPROVE = 'SELECT * FROM core.settlement_cmd_approve_finance_action($1, $2)';

describe('US-709 — passage en perte par deux personnes (WRITE_OFF_RECEIVABLE)', () => {
  it('FINANCE A demande, A n’approuve pas sa propre demande, B approuve ⇒ crédit RECEIVABLE_WRITE_OFF du reste dû au grand livre, état WRITTEN_OFF, avance WRITTEN_OFF lue par l’hôte', async () => {
    const x = w(0);
    const advance = advances[0] ?? '';
    await api(async (client) => {
      const req = await finance(client, people.financeA, REQUEST, [
        uuid(),
        'WRITE_OFF_RECEIVABLE',
        advance,
        REASON,
      ]);
      expect(req.outcome).toBe('REQUESTED');
      const self = await finance(client, people.financeA, APPROVE, [req.approval_id]);
      expect(self.outcome).toBe('SELF_APPROVAL');
      const ledgerBefore = await client.query<{ reason: string }>(
        'SELECT reason FROM test_fixture.us709_ledger($1)',
        [x.trips.a1.id],
      );
      expect(ledgerBefore.rows.map((r) => r.reason)).not.toContain('RECEIVABLE_WRITE_OFF');

      const ok = await finance(client, people.financeB, APPROVE, [req.approval_id]);
      expect(ok.outcome).toBe('APPROVED');
      const ledger = await client.query<{
        reason: string;
        amount_minor: string;
        currency: string;
        write_off_approval_id: string | null;
      }>(
        `SELECT reason, amount_minor, currency, write_off_approval_id
           FROM test_fixture.us709_ledger($1)`,
        [x.trips.a1.id],
      );
      expect(ledger.rows.filter((r) => r.reason === 'RECEIVABLE_WRITE_OFF')).toEqual([
        {
          reason: 'RECEIVABLE_WRITE_OFF',
          amount_minor: claimOf(0).toString(),
          currency: x.c.currency,
          write_off_approval_id: req.approval_id,
        },
      ]);
      const state = await client.query<{ state: string; balance_minor: string }>(
        'SELECT state, balance_minor FROM test_fixture.us709_state($1)',
        [x.trips.a1.id],
      );
      expect(state.rows).toEqual([{ state: 'WRITTEN_OFF', balance_minor: '0' }]);
      await asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: x.orgA }, async (tx) => {
        expect((await hostAdvances(tx)).map((r) => [r.id, r.status])).toEqual([
          [advance, 'WRITTEN_OFF'],
        ]);
      });
      // la créance de l'autre pays n'est pas touchée (aucune écriture entre devises ni pays)
      const other = await client.query<{ reason: string }>(
        'SELECT reason FROM test_fixture.us709_ledger($1)',
        [w(1).trips.a1.id],
      );
      expect(other.rows.map((r) => r.reason)).toEqual(['RELEASED_LEG_ADVANCE']);
    });
  });
});
