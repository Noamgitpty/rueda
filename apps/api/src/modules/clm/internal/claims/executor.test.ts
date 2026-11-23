/**
 * Travailleur `claim_decision_executor` (US-309, ADR-195) contre une base simulée et le FAKE de
 * l'assureur partenaire : chaque décision dans sa propre transaction sous `payment_command`, une
 * erreur de la base repousse la décision (jamais perdue, jamais bloquante pour les suivantes),
 * déclarations envoyées seulement quand la base les rend dues (interrupteur du pays lu en base),
 * référence de l'assureur reportée ; aucun port (production) ⇒ rien n'est envoyé. Les commandes
 * SQL réelles sont prouvées sous les rôles de production par `l0-us309-claims`.
 */
import { FakeInsurerClaims } from '@rueda/fake-adapters/insurer';
import { describe, expect, it } from 'vitest';
import { BusRegistry } from '../../../bus/index.js';
import type { OpsAlert, SqlClient, WorkerTransactions } from '../../../bus/index.js';
import {
  CLAIM_DECISION_WORKER,
  CLAIM_PAYMENT_COMMAND_WORKER,
  ClaimDecisionExecutor,
  registerClaimDecisionExecutor,
} from './executor.js';

interface Call {
  readonly worker: string;
  readonly text: string;
  readonly values: readonly unknown[];
}

/** Base simulée : issue d'exécution par décision, déclarations dues, journal des appels. */
function fakeDb(o: {
  readonly outcomes: Readonly<Record<string, string | Error>>;
  readonly due?: readonly Record<string, string>[];
  readonly recorded?: string;
}) {
  const calls: Call[] = [];
  const transactions: WorkerTransactions = {
    run: async (worker, fn) => {
      const tx: SqlClient = {
        query: <R>(text: string, values: readonly unknown[] = []) => {
          calls.push({ worker, text, values });
          if (text.includes('claim_cmd_execute_decision')) {
            const r = o.outcomes[String(values[0])];
            if (r instanceof Error) return Promise.reject(r);
            return Promise.resolve({ rows: [{ outcome: r ?? 'NOT_FOUND' }] as R[], rowCount: 1 });
          }
          if (text.includes('claim_insurer_declarations_due')) {
            return Promise.resolve({ rows: (o.due ?? []) as R[], rowCount: 0 });
          }
          if (text.includes('claim_cmd_record_insurer_declaration')) {
            return Promise.resolve({ rows: [{ r: o.recorded ?? 'SENT' }] as R[], rowCount: 1 });
          }
          return Promise.resolve({ rows: [] as R[], rowCount: 0 });
        },
      };
      return fn(tx);
    },
  };
  return { calls, transactions };
}

const DUE = {
  declaration_id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  kind: 'DAMAGE',
  country_code: 'XA',
  currency: 'XTA',
  repair_cost_minor: '120000',
  reported_at: '2035-06-11T09:00:00.000Z',
};

describe('claim_decision_executor (US-309)', () => {
  it('une décision par transaction sous payment_command ; erreur ⇒ décision repoussée, les suivantes continuent', async () => {
    const db = fakeDb({ outcomes: { a: 'DONE', b: new Error('23000'), c: 'BLOCKED' } });
    const lines: string[] = [];
    const pass = await new ClaimDecisionExecutor({
      transactions: db.transactions,
      insurer: null,
      log: (l) => lines.push(l),
    }).process(['a', 'b', 'c']);
    expect(pass).toEqual({
      due: 3,
      done: 1,
      blocked: 1,
      deferred: 1,
      declared: 0,
      insurerUnavailable: 0,
    });
    expect(db.calls.every((c) => c.worker === CLAIM_PAYMENT_COMMAND_WORKER)).toBe(true);
    const deferred = db.calls.filter((c) => c.text.includes('claim_cmd_defer_decision'));
    expect(deferred.map((c) => c.values)).toEqual([['b', 'EXECUTION_FAILED']]);
    // aucun port d'assureur (production) : la file des déclarations n'est même pas lue
    expect(db.calls.some((c) => c.text.includes('claim_insurer_declarations_due'))).toBe(false);
    // journal : des comptes seulement, aucun identifiant
    expect(lines.join('\n')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('déclaration due ⇒ envoyée au FAKE (aucune donnée personnelle) puis référence reportée ; assureur injoignable ⇒ rien reporté, réessayé au passage suivant', async () => {
    const insurer = new FakeInsurerClaims({ env: { RUEDA_ENV: 'test' } });
    const db = fakeDb({ outcomes: {}, due: [DUE] });
    const executor = new ClaimDecisionExecutor({ transactions: db.transactions, insurer });
    insurer.failNext();
    expect(await executor.declare()).toEqual({ declared: 0, unavailable: 1 });
    expect(db.calls.some((c) => c.text.includes('claim_cmd_record_insurer_declaration'))).toBe(
      false,
    );
    expect(await executor.declare()).toEqual({ declared: 1, unavailable: 0 });
    const recorded = db.calls.filter((c) =>
      c.text.includes('claim_cmd_record_insurer_declaration'),
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.values[0]).toBe(DUE.declaration_id);
    expect(String(recorded[0]?.values[1])).toMatch(/^fake-insurer:/);
    expect(insurer.received.at(-1)).toEqual({
      declarationId: DUE.declaration_id,
      kind: 'DAMAGE',
      country: 'XA',
      currency: 'XTA',
      repairCostMinor: '120000',
      reportedAt: '2035-06-11T09:00:00.000Z',
    });
  });

  it('interrupteur refermé entre la file et l’envoi : la base refuse le report (INSURER_CONTRACT_INACTIVE), rien n’est compté envoyé', async () => {
    const insurer = new FakeInsurerClaims({ env: { RUEDA_ENV: 'test' } });
    const db = fakeDb({ outcomes: {}, due: [DUE], recorded: 'INSURER_CONTRACT_INACTIVE' });
    expect(
      await new ClaimDecisionExecutor({ transactions: db.transactions, insurer }).declare(),
    ).toEqual({ declared: 0, unavailable: 1 });
  });

  it('le FAKE de l’assureur refuse de se construire en production (C19)', () => {
    expect(() => new FakeInsurerClaims({ env: { RUEDA_ENV: 'production' } })).toThrow();
  });

  it('US-318 (revue code n° 3) : la file des décisions en panne ne saute jamais la passe des sinistres entre particuliers ; panne journalisée par SQLSTATE', async () => {
    const texts: string[] = [];
    const transactions: WorkerTransactions = {
      run: async (_worker, fn) =>
        fn({
          query: <R>(text: string) => {
            texts.push(text);
            return Promise.resolve({ rows: [] as R[], rowCount: 0 });
          },
        }),
    };
    const lines: string[] = [];
    const sent: OpsAlert[] = [];
    const registry = new BusRegistry();
    registerClaimDecisionExecutor(registry, transactions, (l) => lines.push(l), null, {
      send: (a) => {
        sent.push(a);
        return Promise.resolve();
      },
    });
    const handler = registry.handlerOf(CLAIM_DECISION_WORKER);
    expect(handler?.kind).toBe('timer');
    // transaction de la tâche : la file des décisions lève (panne de la base)
    const tx: SqlClient = {
      query: <R>(text: string) =>
        text.includes('claim_decisions_due')
          ? Promise.reject(Object.assign(new Error('panne'), { code: '57P01' }))
          : Promise.resolve({ rows: [] as R[], rowCount: 0 }),
    };
    if (handler?.kind !== 'timer') throw new Error('tâche absente');
    await handler.handle({}, tx);
    // la passe d'US-318 a tourné (ses files lues dans leurs propres transactions)
    expect(texts.some((t) => t.includes('claim_theft_cases_due'))).toBe(true);
    expect(texts.some((t) => t.includes('claim_traffic_charges_due'))).toBe(true);
    expect(lines.some((l) => l.includes('"error":"57P01"'))).toBe(true);
    expect(sent).toEqual([]);
  });
});
