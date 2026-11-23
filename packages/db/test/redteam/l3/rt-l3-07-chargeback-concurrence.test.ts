/**
 * US-313 — red team du lot 3, suite : chargeback imputé deux fois, DEUX travailleurs (RT-L3-V08,
 * risque L3-PM-40) et contournements logiques du solde négatif (RT-L3-V09, risque L3-PM-42). Rôles de
 * PRODUCTION seulement (`withRole` : assertion L0-05 en tête de chaque test), travailleur
 * `payment_command`, USD (PA) et PYG sans décimale (PY). TESTS SEULEMENT : aucun correctif, aucune
 * migration, aucune fixture. Rapport : docs/team/redteam/L3-donnees-sinistres.md. Horloge virtuelle
 * 2075 (aucune autre preuve ne l'utilise).
 *
 * Course à DEUX connexions (une par client, libérées) : A applique le statut « perdu » d'un chargeback
 * et tient ses verrous (trip, verrou consultatif de (hôte, devise)) jusqu'à ce que B, qui applique en
 * même temps le statut d'un AUTRE chargeback du même trip (scénario 1) ou le MÊME statut du même
 * chargeback (scénario 2, rejeu par un second travailleur), soit OBSERVÉ bloqué (`pg_locks`, verrou non
 * accordé, pid de B lu d'abord) ; A valide, B reprend. Données de la course VALIDÉES (deux rôles
 * séparés : le groupe `l0-redteam` tourne seul, comme `l0-us709-ledger-race`) ; lock_timeout et
 * statement_timeout posés ; connexions libérées dans `finally`.
 *
 * Attendus (jamais le code testé) : 08 E5 et E7 règle 7 (un chargeback perdu se reprend une fois ; le
 * total repris sur un trip ne dépasse jamais ce qui a été encaissé : « une seule reprise au grand
 * livre, jamais 166,85 ») ; pré-mortem L3-PM-40 (« une seule imputation ») ; 17 §2.9 / US-709 (le
 * grand livre de l'hôte est tenu par (compte d'hôte, devise), jamais négatif au-delà de la dette).
 */
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole } from '../../../src/testing/index.ts';
import { COUNTRIES } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { backendPid } from '../../support/concurrency.ts';
import { applySignedStatus, payTx, recordOperation, uuid } from '../../support/pay.ts';
import type { Legs, PayTxOptions } from '../../support/pay.ts';
import { golden } from '../../support/settlement.ts';

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
/** Captures de l'export des oracles par pays (ordre de `COUNTRIES`). */
const CAPTURE_IDS: readonly string[] = ['TJ01', 'TJ08a'];
const NOW = '2075-02-01T12:00:00.000Z';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Opérations du worker `payment_command` dans une transaction VALIDÉE ou annulée. */
const asPayments = <T>(commit: boolean, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) =>
    payTx(
      client,
      { worker: 'payment_command', deploymentEnv: 'test', virtualNow: NOW, commit },
      async (tx) => {
        // jamais d'attente sans fin : un verrou ou une requête qui s'éternise fait échouer la preuve
        await tx.query(`SET LOCAL lock_timeout = '30s'`);
        await tx.query(`SET LOCAL statement_timeout = '60s'`);
        return fn(tx);
      },
    ),
  );

interface Setup {
  readonly trip: string;
  readonly total: bigint;
  readonly first: string;
  readonly second: string;
}

/** Trip encaissé (jambes de l'export) et DEUX chargebacks enregistrés (en attente), VALIDÉS. */
async function committedTrip(c: CountryCase): Promise<Setup> {
  const capture: Legs = { ...legVector(golden, CAPTURE_IDS[COUNTRIES.indexOf(c)]!).legsMinor };
  const total = sum(capture);
  return asPayments(true, async (tx) => {
    const acc = await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
      c.country,
    ]);
    const psp = acc.rows[0]!.id;
    const trip = uuid();
    await tx.query('SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
      trip,
      uuid(),
      uuid(),
      uuid(),
      c.country,
      c.currency,
      c.timezone,
      '2075-02-20T10:00:00Z',
      '2075-02-23T10:00:00Z',
    ]);
    const op = await recordOperation(tx, {
      tripId: trip,
      accountId: psp,
      kind: 'CAPTURE',
      amountMinor: total,
      currency: c.currency,
      idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
      legs: capture,
    });
    expect(await applySignedStatus(tx, op.operation_id, 'SUCCEEDED')).toBe('APPLIED');
    await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [op.operation_id]);
    const chargeback = async (amount: bigint): Promise<string> =>
      (
        await recordOperation(tx, {
          tripId: trip,
          accountId: psp,
          kind: 'CHARGEBACK',
          amountMinor: amount,
          currency: c.currency,
          idemPlain: `trip:${trip}:CHARGEBACK:${uuid()}`,
          legs: null,
        })
      ).operation_id;
    // premier : tout le montant encaissé ; second : une unité (autre événement du PSP)
    return { trip, total, first: await chargeback(total), second: await chargeback(1n) };
  });
}

/** Session bloquée sur un verrou non accordé (pid lu d'abord), sans attente à durée fixe. */
async function waitBlocked(observer: Tx, pid: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await observer.query<{ waiting: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_locks WHERE pid = $1 AND NOT granted) AS waiting`,
      [pid],
    );
    if (r.rows[0]?.waiting === true) return;
    if (Date.now() > deadline) throw new Error(`la session ${pid} n'attend aucun verrou`);
    await sleep(5);
  }
}

interface Imputation {
  readonly lost_trip_minor: string;
  readonly currency: string;
}
async function imputationOf(tx: Tx, op: string): Promise<Imputation[]> {
  return (
    await tx.query<Imputation>(
      'SELECT lost_trip_minor, currency FROM test_fixture.us709_imputation($1)',
      [op],
    )
  ).rows;
}

interface Race {
  readonly a: string;
  readonly b: string;
  /** Issue de B (statut appliqué, ou code d'erreur si la commande l'a refusé). */
  readonly resultB: string;
  readonly blocked: boolean;
}

/**
 * A applique le statut de `opA` et le tient ; quand B (statut de `opB`) est vu bloqué, A valide et B
 * reprend. Une transaction par connexion.
 */
async function race(opA: string, opB: string): Promise<Race> {
  return withRole('app_worker', (observer) =>
    withRole('app_worker', (clientA) =>
      withRole('app_worker', async (clientB) => {
        const pidB = await backendPid(clientB);
        let appliedA!: () => void;
        const aApplied = new Promise<void>((r) => (appliedA = r));
        let goA!: () => void;
        const gate = new Promise<void>((r) => (goA = r));
        const opts: PayTxOptions = {
          worker: 'payment_command',
          deploymentEnv: 'test',
          virtualNow: NOW,
          commit: true,
        };
        const a = payTx(clientA, opts, async (tx) => {
          await tx.query(`SET LOCAL lock_timeout = '30s'`);
          await tx.query(`SET LOCAL statement_timeout = '60s'`);
          const out = await applySignedStatus(tx, opA, 'SUCCEEDED');
          appliedA();
          await gate; // A tient ses verrous jusqu'à ce que B soit vu bloqué
          return out;
        });
        let blocked = false;
        let resultB = '';
        try {
          await Promise.race([aApplied, a]);
          const b = payTx(clientB, opts, async (tx) => {
            await tx.query(`SET LOCAL lock_timeout = '30s'`);
            await tx.query(`SET LOCAL statement_timeout = '60s'`);
            return applySignedStatus(tx, opB, 'SUCCEEDED');
          }).then(
            (out) => out,
            (error: unknown) => `ERREUR ${(error as { code?: string }).code ?? 'inconnue'}`,
          );
          await waitBlocked(observer, pidB);
          blocked = true;
          goA();
          resultB = await b;
        } finally {
          goA();
        }
        return { a: await a, b: opB, resultB, blocked };
      }),
    ),
  );
}

describe.each(COUNTRIES)(
  'RT-L3 chargeback imputé deux fois, deux travailleurs ($country, $currency)',
  (c) => {
    it('RT-L3-V08 (L3-PM-40) — deux chargebacks perdus du même trip appliqués EN MÊME TEMPS par deux travailleurs : B attend A (observé), une seule imputation, total imputé ≤ encaissé (jamais deux reprises du montant payé)', async () => {
      const s = await committedTrip(c);
      const r = await race(s.first, s.second);
      expect(r.blocked).toBe(true);
      expect(r.a).toBe('APPLIED');
      // aucune des deux issues n'est une erreur de la commande ; le second statut est bien appliqué
      expect(r.resultB).toBe('APPLIED');
      await asPayments(false, async (tx) => {
        const first = await imputationOf(tx, s.first);
        const second = await imputationOf(tx, s.second);
        // A (premier arrivé) impute tout ce qui a été encaissé, une fois ; B ne trouve plus rien à
        // imputer (LOST_EXCEEDS_COLLECTED) : aucune seconde ligne
        expect(first).toEqual([{ lost_trip_minor: s.total.toString(), currency: c.currency }]);
        expect(second).toEqual([]);
        const imputed = [...first, ...second].reduce((t, i) => t + BigInt(i.lost_trip_minor), 0n);
        expect(imputed).toBeLessThanOrEqual(s.total);
      });
    }, 120_000);

    it('RT-L3-V08 (L3-PM-40) — le MÊME chargeback perdu rejoué par un second travailleur pendant que le premier le tient : B attend A (observé), une seule imputation de ce chargeback', async () => {
      const s = await committedTrip(c);
      const r = await race(s.first, s.first);
      expect(r.blocked).toBe(true);
      expect(r.a).toBe('APPLIED');
      // le rejeu n'impute rien de plus : une ligne, du montant encaissé
      await asPayments(false, async (tx) => {
        expect(await imputationOf(tx, s.first)).toEqual([
          { lost_trip_minor: s.total.toString(), currency: c.currency },
        ]);
        // le rejeu ne provoque ni interblocage, ni délai de verrou, ni délai d'instruction
        expect(r.resultB).not.toMatch(/^ERREUR (40P01|55P03|57014)/);
        expect(r.resultB).not.toBe('');
      });
    }, 120_000);

    // -----------------------------------------------------------------------------------------
    it('RT-L3-V09 (L3-PM-42) — le solde de l’hôte est tenu par (compte d’hôte, devise) : un second compte d’hôte du même titulaire dans le même pays est impossible (contrainte), le grand livre et son état n’ont pas d’autre clé ; aucune compensation entre devises ni entre comptes', async () => {
      await withRole('app_api', async (client) => {
        const def = async (sql: string): Promise<string[]> =>
          (await client.query<{ d: string }>(sql)).rows.map((r) => r.d);
        expect(
          await def(
            `SELECT pg_catalog.pg_get_constraintdef(k.oid) AS d FROM pg_catalog.pg_constraint AS k
            WHERE k.conrelid = 'core.iam_organization'::regclass
              AND k.conname = 'organization_country_holder_unique'`,
          ),
        ).toEqual(['UNIQUE (country_code, holder_user_id)']);
        expect(
          await def(
            `SELECT pg_catalog.pg_get_constraintdef(k.oid) AS d FROM pg_catalog.pg_constraint AS k
            WHERE k.conrelid = 'core.settlement_host_ledger_state'::regclass
              AND k.conname = 'settlement_host_ledger_state_pkey'`,
          ),
        ).toEqual(['PRIMARY KEY (org_id, currency)']);
        // jamais de solde positif : le crédit d'effacement sans dette est refusé par la garde du grand livre
        expect(
          await def(
            `SELECT pg_catalog.pg_get_constraintdef(k.oid) AS d FROM pg_catalog.pg_constraint AS k
            WHERE k.conrelid = 'core.settlement_host_ledger_state'::regclass
              AND k.conname = 'host_ledger_state_balance_nonpositive'`,
          ),
        ).toEqual(['CHECK ((balance_minor <= 0))']);
      });
    });
  },
);
