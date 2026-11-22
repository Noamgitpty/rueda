/**
 * Travailleur `incidental_invoice_executor` (US-706, ADR-197) contre une base simulée : chaque frais
 * dans sa propre transaction sous `payment_command`, issue de la base relayée telle quelle (avant
 * l'échéance ou contesté : NOT_DUE, rien n'est débité), une erreur de la base repousse le frais
 * (jamais perdu, jamais bloquant pour les suivants), seuls des comptes journalisés. Les commandes
 * SQL réelles (échéance à l'heure de la base, jambes explicites, jamais la caution) sont prouvées
 * sous les rôles de production par `l0-us706-incidental-fees`.
 */
import { describe, expect, it } from 'vitest';
import type { SqlClient, WorkerTransactions } from '../../../bus/index.js';
import {
  INCIDENTAL_PAYMENT_COMMAND_WORKER,
  INCIDENTAL_WORKER,
  IncidentalInvoiceExecutor,
} from './executor.js';

interface Call {
  readonly worker: string;
  readonly text: string;
  readonly values: readonly unknown[];
}

function fakeDb(outcomes: Readonly<Record<string, string | Error>>) {
  const calls: Call[] = [];
  const transactions: WorkerTransactions = {
    run: async (worker, fn) => {
      const tx: SqlClient = {
        query: <R>(text: string, values: readonly unknown[] = []) => {
          calls.push({ worker, text, values });
          if (text.includes('claim_cmd_charge_incidental')) {
            const r = outcomes[String(values[0])];
            if (r instanceof Error) return Promise.reject(r);
            return Promise.resolve({ rows: [{ outcome: r ?? 'NOT_FOUND' }] as R[], rowCount: 1 });
          }
          return Promise.resolve({ rows: [] as R[], rowCount: 0 });
        },
      };
      return fn(tx);
    },
  };
  return { calls, transactions };
}

describe('incidental_invoice_executor (US-706)', () => {
  it('un frais par transaction sous payment_command ; issues de la base comptées ; erreur ⇒ frais repoussé, les suivants continuent', async () => {
    const db = fakeDb({
      a: 'CHARGED',
      b: 'NOT_DUE',
      c: new Error('23514'),
      d: 'BLOCKED',
      e: 'DONE',
      f: 'NOT_FOUND',
    });
    const lines: string[] = [];
    const pass = await new IncidentalInvoiceExecutor({
      transactions: db.transactions,
      log: (l) => lines.push(l),
    }).process(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(pass).toEqual({ due: 6, charged: 1, notDue: 1, blocked: 1, done: 1, deferred: 2 });
    expect(db.calls.every((c) => c.worker === INCIDENTAL_PAYMENT_COMMAND_WORKER)).toBe(true);
    // un identifiant de débit neuf par tentative (clé de l'ordre d'US-703 rejouée par la base)
    const charges = db.calls.filter((c) => c.text.includes('claim_cmd_charge_incidental'));
    expect(charges).toHaveLength(6);
    expect(new Set(charges.map((c) => String(c.values[1]))).size).toBe(6);
    const deferred = db.calls.filter((c) => c.text.includes('claim_cmd_defer_incidental'));
    expect(deferred.map((c) => c.values)).toEqual([['c', 'EXECUTION_FAILED']]);
    // journal : des comptes seulement, jamais un identifiant
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      level: 'info',
      worker: INCIDENTAL_WORKER,
      due: 6,
      charged: 1,
      notDue: 1,
      blocked: 1,
      done: 1,
      deferred: 2,
    });
    expect(lines[0]).not.toMatch(/"a"|"b"|"c"/);
  });

  it('la file est lue par la base (aucune heure envoyée par le travailleur)', async () => {
    const seen: { text: string; values: readonly unknown[] }[] = [];
    const tx: SqlClient = {
      query: <R>(text: string, values: readonly unknown[] = []) => {
        seen.push({ text, values });
        return Promise.resolve({ rows: [{ id: 'x' }, { id: 'y' }] as R[], rowCount: 2 });
      },
    };
    expect(await IncidentalInvoiceExecutor.due(tx)).toEqual(['x', 'y']);
    expect(seen).toEqual([
      {
        text: 'SELECT invoice_id::text AS id FROM core.claim_incidental_invoices_due($1)',
        values: [50],
      },
    ]);
  });
});
