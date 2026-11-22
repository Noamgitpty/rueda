/**
 * Passe des sinistres entre particuliers (US-318, ADR-198) contre une base simulée et le FAKE de
 * l'assureur partenaire : vol présumé ouvert ou clos trip par trip, chacun dans sa propre
 * transaction sous `payment_command` ; déclarations de vol envoyées seulement quand la base les rend
 * dues (interrupteur du pays lu en base), référence reportée ; aucun port (production) ⇒ rien n'est
 * envoyé ; refacturations exécutées une par transaction, une erreur de la base les repousse (jamais
 * perdues, jamais bloquantes). Les commandes SQL réelles sont prouvées sous les rôles de production
 * par `l0-us318-p2p-claims`.
 */
import { FakeInsurerClaims } from '@rueda/fake-adapters/insurer';
import { describe, expect, it } from 'vitest';
import type { SqlClient, WorkerTransactions } from '../../../bus/index.js';
import { P2pClaimsExecutor } from './executor.js';

interface Call {
  readonly worker: string;
  readonly text: string;
  readonly values: readonly unknown[];
  readonly tx: number;
}

const TRIP_A = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a51';
const TRIP_B = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a52';
const THEFT = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a53';
const CH_OK = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a54';
const CH_BLOCKED = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a55';
const CH_FAIL = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a56';

function fakeDb(o: {
  readonly thefts?: readonly { trip_id: string; action: string }[];
  readonly declarations?: readonly Record<string, string>[];
  readonly charges?: Readonly<Record<string, string | Error>>;
  readonly dueFails?: boolean;
}) {
  const calls: Call[] = [];
  let txNo = 0;
  const transactions: WorkerTransactions = {
    run: async (worker, fn) => {
      txNo += 1;
      const n = txNo;
      const tx: SqlClient = {
        query: <R>(text: string, values: readonly unknown[] = []) => {
          calls.push({ worker, text, values, tx: n });
          const rows = (r: unknown[]) => Promise.resolve({ rows: r as R[], rowCount: r.length });
          if (text.includes('claim_theft_cases_due')) {
            if (o.dueFails === true) return Promise.reject(new Error('panne'));
            return rows([...(o.thefts ?? [])]);
          }
          if (text.includes('claim_cmd_open_theft_case')) return rows([{ r: 'OPENED' }]);
          if (text.includes('claim_cmd_close_theft_case')) return rows([{ r: 'CLOSED' }]);
          if (text.includes('claim_theft_declarations_due'))
            return rows([...(o.declarations ?? [])]);
          if (text.includes('claim_cmd_record_theft_declaration')) return rows([{ r: 'SENT' }]);
          if (text.includes('claim_traffic_charges_due')) {
            return rows(Object.keys(o.charges ?? {}).map((id) => ({ id })));
          }
          if (text.includes('claim_cmd_execute_traffic_charge')) {
            const r = (o.charges ?? {})[String(values[0])];
            if (r instanceof Error) return Promise.reject(r);
            return rows([{ outcome: r ?? 'NOT_FOUND' }]);
          }
          if (text.includes('claim_cmd_defer_traffic_charge')) return rows([{ r: 'DEFERRED' }]);
          return rows([]);
        },
      };
      return fn(tx);
    },
  };
  return { calls, transactions };
}

describe('US-318 — passe des sinistres entre particuliers', () => {
  it('vol présumé : un trip par transaction (OPEN, CLOSE), sous payment_command ; aucun port ⇒ aucune déclaration envoyée', async () => {
    const db = fakeDb({
      thefts: [
        { trip_id: TRIP_A, action: 'OPEN' },
        { trip_id: TRIP_B, action: 'CLOSE' },
      ],
      declarations: [
        { id: THEFT, country_code: 'XA', currency: 'XTA', opened_at: '2035-06-11T09:00:00.000Z' },
      ],
    });
    const pass = await new P2pClaimsExecutor({
      transactions: db.transactions,
      insurer: null,
    }).process();
    expect(pass).toMatchObject({ theftOpened: 1, theftClosed: 1, theftDeclared: 0 });
    expect(db.calls.every((c) => c.worker === 'payment_command')).toBe(true);
    const open = db.calls.find((c) => c.text.includes('claim_cmd_open_theft_case'))!;
    const close = db.calls.find((c) => c.text.includes('claim_cmd_close_theft_case'))!;
    expect(open.values).toEqual([TRIP_A]);
    expect(close.values).toEqual([TRIP_B]);
    expect(open.tx).not.toBe(close.tx);
    // sans port : la file des déclarations n'est même pas lue
    expect(db.calls.some((c) => c.text.includes('claim_theft_declarations_due'))).toBe(false);
  });

  it('déclarations de vol : seulement celles que la base rend dues ; FAKE de l’assureur (THEFT, aucune donnée nominative) ; référence reportée ; assureur injoignable : rien de reporté', async () => {
    const insurer = new FakeInsurerClaims({ env: { RUEDA_ENV: 'test' } });
    const none = fakeDb({ declarations: [] });
    await new P2pClaimsExecutor({ transactions: none.transactions, insurer }).process();
    expect(insurer.received).toEqual([]);

    const due = fakeDb({
      declarations: [
        { id: THEFT, country_code: 'XA', currency: 'XTA', opened_at: '2035-06-11T09:00:00.000Z' },
      ],
    });
    const pass = await new P2pClaimsExecutor({ transactions: due.transactions, insurer }).process();
    expect(pass.theftDeclared).toBe(1);
    expect(insurer.received).toEqual([
      {
        declarationId: THEFT,
        kind: 'THEFT',
        country: 'XA',
        currency: 'XTA',
        repairCostMinor: '0',
        reportedAt: '2035-06-11T09:00:00.000Z',
      },
    ]);
    const rec = due.calls.find((c) => c.text.includes('claim_cmd_record_theft_declaration'))!;
    expect(rec.values[0]).toBe(THEFT);
    expect(String(rec.values[1])).toMatch(/^fake-insurer:/);

    insurer.failNext();
    const down = fakeDb({
      declarations: [
        { id: THEFT, country_code: 'XA', currency: 'XTA', opened_at: '2035-06-11T09:00:00.000Z' },
      ],
    });
    const p2 = await new P2pClaimsExecutor({ transactions: down.transactions, insurer }).process();
    expect(p2).toMatchObject({ theftDeclared: 0, insurerUnavailable: 1 });
    expect(down.calls.some((c) => c.text.includes('claim_cmd_record_theft_declaration'))).toBe(
      false,
    );
  });

  it('refacturations : DONE, BLOCKED ; erreur de la base ⇒ repoussée (EXECUTION_FAILED) sans bloquer les suivantes ; ne lève jamais', async () => {
    const db = fakeDb({
      charges: { [CH_FAIL]: new Error('invariant'), [CH_OK]: 'DONE', [CH_BLOCKED]: 'BLOCKED' },
    });
    const lines: string[] = [];
    const pass = await new P2pClaimsExecutor({
      transactions: db.transactions,
      insurer: null,
      log: (l) => lines.push(l),
    }).process();
    expect(pass).toMatchObject({ trafficDone: 1, trafficBlocked: 1, trafficDeferred: 1 });
    const defer = db.calls.find((c) => c.text.includes('claim_cmd_defer_traffic_charge'))!;
    expect(defer.values).toEqual([CH_FAIL, 'EXECUTION_FAILED']);
    // chaque exécution reçoit son propre identifiant de débit
    const ids = db.calls
      .filter((c) => c.text.includes('claim_cmd_execute_traffic_charge'))
      .map((c) => c.values[1]);
    expect(new Set(ids).size).toBe(3);
    // journal : des comptes seulement, jamais un identifiant
    expect(lines).toHaveLength(1);
    for (const id of [CH_OK, CH_BLOCKED, CH_FAIL, TRIP_A]) expect(lines[0]).not.toContain(id);
  });

  it('file du vol illisible (panne) : la passe continue', async () => {
    const db = fakeDb({ dueFails: true, charges: { [CH_OK]: 'DONE' } });
    const pass = await new P2pClaimsExecutor({
      transactions: db.transactions,
      insurer: null,
    }).process();
    expect(pass).toMatchObject({ theftOpened: 0, trafficDone: 1 });
  });
});
