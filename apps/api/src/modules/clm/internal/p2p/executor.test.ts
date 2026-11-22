/**
 * Passe des sinistres entre particuliers (US-318, ADR-198) contre une base simulée et le FAKE de
 * l'assureur partenaire : vol présumé ouvert ou clos trip par trip, chacun dans sa propre
 * transaction sous `payment_command` ; déclarations de vol : verrou et interrupteur relus
 * (`claim_cmd_lock_theft_declaration`) AVANT l'appel au port, dans la transaction de
 * l'enregistrement, port appelé seulement si READY ; aucun port (production) ⇒ rien n'est envoyé ;
 * refacturations exécutées une par transaction, une erreur de la base les repousse puis les bloque
 * au 5e essai (décision de la base). Aucune erreur avalée en silence (revue code n° 1, n° 2) :
 * journal par SQLSTATE et alerte `CLAIM_P2P_FAILED` (étiquette étape_SQLSTATE), refacturation
 * BLOCKED ⇒ `CLAIM_TRAFFIC_BLOCKED` ; un canal d'alerte en panne ne lève jamais. Les commandes SQL
 * réelles sont prouvées sous les rôles de production par `l0-us318-p2p-claims`.
 */
import { FakeInsurerClaims } from '@rueda/fake-adapters/insurer';
import { describe, expect, it } from 'vitest';
import type { AlertChannel, OpsAlert, SqlClient, WorkerTransactions } from '../../../bus/index.js';
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
const DECL = {
  id: THEFT,
  country_code: 'XA',
  currency: 'XTA',
  opened_at: '2035-06-11T09:00:00.000Z',
};

/** Erreur de la base simulée : SQLSTATE seulement (comme `pg`). */
const dbError = (code: string): Error => Object.assign(new Error('base'), { code });

function fakeDb(o: {
  readonly thefts?: readonly { trip_id: string; action: string }[];
  readonly openFails?: Error;
  readonly declarations?: readonly Record<string, string>[];
  readonly lock?: string;
  readonly charges?: Readonly<Record<string, string | Error>>;
  readonly defer?: string;
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
            if (o.dueFails === true) return Promise.reject(dbError('57P01'));
            return rows([...(o.thefts ?? [])]);
          }
          if (text.includes('claim_cmd_open_theft_case')) {
            return o.openFails ? Promise.reject(o.openFails) : rows([{ r: 'OPENED' }]);
          }
          if (text.includes('claim_cmd_close_theft_case')) return rows([{ r: 'CLOSED' }]);
          if (text.includes('claim_theft_declarations_due'))
            return rows([...(o.declarations ?? [])]);
          if (text.includes('claim_cmd_lock_theft_declaration'))
            return rows([{ r: o.lock ?? 'READY' }]);
          if (text.includes('claim_cmd_record_theft_declaration')) return rows([{ r: 'SENT' }]);
          if (text.includes('claim_traffic_charges_due')) {
            return rows(Object.keys(o.charges ?? {}).map((id) => ({ id })));
          }
          if (text.includes('claim_cmd_execute_traffic_charge')) {
            const r = (o.charges ?? {})[String(values[0])];
            if (r instanceof Error) return Promise.reject(r);
            return rows([{ outcome: r ?? 'NOT_FOUND' }]);
          }
          if (text.includes('claim_cmd_defer_traffic_charge'))
            return rows([{ r: o.defer ?? 'DEFERRED' }]);
          return rows([]);
        },
      };
      return fn(tx);
    },
  };
  return { calls, transactions };
}

function recorder(fail = false): AlertChannel & { readonly sent: OpsAlert[] } {
  const sent: OpsAlert[] = [];
  return {
    sent,
    send: (a: OpsAlert) => {
      sent.push(a);
      return fail ? Promise.reject(new Error('canal')) : Promise.resolve();
    },
  };
}

describe('US-318 — passe des sinistres entre particuliers', () => {
  it('vol présumé : un trip par transaction (OPEN, CLOSE), sous payment_command ; aucun port ⇒ aucune déclaration envoyée', async () => {
    const db = fakeDb({
      thefts: [
        { trip_id: TRIP_A, action: 'OPEN' },
        { trip_id: TRIP_B, action: 'CLOSE' },
      ],
      declarations: [DECL],
    });
    const alerts = recorder();
    const pass = await new P2pClaimsExecutor({
      transactions: db.transactions,
      insurer: null,
      alerts,
    }).process();
    expect(pass).toMatchObject({ theftOpened: 1, theftClosed: 1, theftDeclared: 0, failed: 0 });
    expect(alerts.sent).toEqual([]);
    expect(db.calls.every((c) => c.worker === 'payment_command')).toBe(true);
    const open = db.calls.find((c) => c.text.includes('claim_cmd_open_theft_case'))!;
    const close = db.calls.find((c) => c.text.includes('claim_cmd_close_theft_case'))!;
    expect(open.values).toEqual([TRIP_A]);
    expect(close.values).toEqual([TRIP_B]);
    expect(open.tx).not.toBe(close.tx);
    // sans port : la file des déclarations n'est même pas lue
    expect(db.calls.some((c) => c.text.includes('claim_theft_declarations_due'))).toBe(false);
  });

  it('dossier de vol qui ne s’ouvre pas : journalisé (SQLSTATE), compté, alerté CLAIM_P2P_FAILED (THEFT_OPEN_40001) ; les autres trips continuent', async () => {
    const db = fakeDb({
      thefts: [
        { trip_id: TRIP_A, action: 'OPEN' },
        { trip_id: TRIP_B, action: 'CLOSE' },
      ],
      openFails: dbError('40001'),
    });
    const alerts = recorder();
    const lines: string[] = [];
    const pass = await new P2pClaimsExecutor({
      transactions: db.transactions,
      insurer: null,
      alerts,
      log: (l) => lines.push(l),
    }).process();
    expect(pass).toMatchObject({ theftOpened: 0, theftClosed: 1, failed: 1 });
    expect(alerts.sent).toEqual([
      {
        code: 'CLAIM_P2P_FAILED',
        severity: 'P1',
        counts: { failed: 1 },
        labels: { error_code: 'THEFT_OPEN_40001' },
      },
    ]);
    expect(lines.some((l) => l.includes('"error":"THEFT_OPEN_40001"'))).toBe(true);
    for (const l of lines) {
      expect(l).not.toContain(TRIP_A);
      expect(l).not.toContain(TRIP_B);
    }
  });

  it('déclarations de vol : verrou et interrupteur relus AVANT le port, dans la transaction de l’enregistrement ; FAKE de l’assureur (THEFT) ; port jamais appelé hors READY ; assureur injoignable : rien de reporté', async () => {
    const insurer = new FakeInsurerClaims({ env: { RUEDA_ENV: 'test' } });
    const none = fakeDb({ declarations: [] });
    await new P2pClaimsExecutor({ transactions: none.transactions, insurer }).process();
    expect(insurer.received).toEqual([]);

    const due = fakeDb({ declarations: [DECL] });
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
    const lock = due.calls.findIndex((c) => c.text.includes('claim_cmd_lock_theft_declaration'));
    const rec = due.calls.findIndex((c) => c.text.includes('claim_cmd_record_theft_declaration'));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(rec).toBeGreaterThan(lock);
    expect(due.calls[lock]!.tx).toBe(due.calls[rec]!.tx);
    expect(due.calls[rec]!.values[0]).toBe(THEFT);
    expect(String(due.calls[rec]!.values[1])).toMatch(/^fake-insurer:/);

    // interrupteur refermé ou dossier rendu entre la file et l'envoi : le port n'est pas appelé
    for (const state of ['INSURER_CONTRACT_INACTIVE', 'WITHDRAWN', 'NOT_FOUND']) {
      const before = insurer.received.length;
      const closed = fakeDb({ declarations: [DECL], lock: state });
      const p = await new P2pClaimsExecutor({
        transactions: closed.transactions,
        insurer,
      }).process();
      expect(insurer.received.length, state).toBe(before);
      expect(p).toMatchObject({ theftDeclared: 0, insurerUnavailable: 1 });
      expect(closed.calls.some((c) => c.text.includes('claim_cmd_record_theft_declaration'))).toBe(
        false,
      );
    }

    insurer.failNext();
    const down = fakeDb({ declarations: [DECL] });
    const p2 = await new P2pClaimsExecutor({ transactions: down.transactions, insurer }).process();
    expect(p2).toMatchObject({ theftDeclared: 0, insurerUnavailable: 1 });
    expect(down.calls.some((c) => c.text.includes('claim_cmd_record_theft_declaration'))).toBe(
      false,
    );
  });

  it('refacturations : DONE, BLOCKED ; erreur de la base ⇒ alertée et repoussée (EXECUTION_FAILED) sans bloquer les suivantes ; BLOCKED ⇒ CLAIM_TRAFFIC_BLOCKED ; ne lève jamais', async () => {
    const db = fakeDb({
      charges: {
        [CH_FAIL]: dbError('23514'),
        [CH_OK]: 'DONE',
        [CH_BLOCKED]: 'BLOCKED',
      },
    });
    const alerts = recorder();
    const lines: string[] = [];
    const pass = await new P2pClaimsExecutor({
      transactions: db.transactions,
      insurer: null,
      alerts,
      log: (l) => lines.push(l),
    }).process();
    expect(pass).toMatchObject({
      trafficDone: 1,
      trafficBlocked: 1,
      trafficDeferred: 1,
      failed: 1,
    });
    const defer = db.calls.find((c) => c.text.includes('claim_cmd_defer_traffic_charge'))!;
    expect(defer.values).toEqual([CH_FAIL, 'EXECUTION_FAILED']);
    // chaque exécution reçoit son propre identifiant de débit
    const ids = db.calls
      .filter((c) => c.text.includes('claim_cmd_execute_traffic_charge'))
      .map((c) => c.values[1]);
    expect(new Set(ids).size).toBe(3);
    expect(alerts.sent).toEqual([
      {
        code: 'CLAIM_P2P_FAILED',
        severity: 'P1',
        counts: { failed: 1 },
        labels: { error_code: 'TRAFFIC_EXECUTE_23514' },
      },
      { code: 'CLAIM_TRAFFIC_BLOCKED', severity: 'P1', counts: { blocked: 1 } },
    ]);
    // journal : des codes et des comptes seulement, jamais un identifiant
    for (const l of lines) {
      for (const id of [CH_OK, CH_BLOCKED, CH_FAIL, TRIP_A]) expect(l).not.toContain(id);
    }
  });

  it('5e échec : la base rend BLOCKED (RETRY_EXHAUSTED) au report ⇒ compté BLOCKED et alerté', async () => {
    const db = fakeDb({ charges: { [CH_FAIL]: dbError('XX000') }, defer: 'BLOCKED' });
    const alerts = recorder();
    const pass = await new P2pClaimsExecutor({
      transactions: db.transactions,
      insurer: null,
      alerts,
    }).process();
    expect(pass).toMatchObject({ trafficBlocked: 1, trafficDeferred: 0, failed: 1 });
    expect(alerts.sent.map((a) => a.code)).toEqual(['CLAIM_P2P_FAILED', 'CLAIM_TRAFFIC_BLOCKED']);
  });

  it('file du vol illisible (panne) : alertée (THEFT_QUEUE_57P01), la passe continue ; canal d’alerte en panne : jamais d’exception', async () => {
    const db = fakeDb({ dueFails: true, charges: { [CH_OK]: 'DONE' } });
    const lines: string[] = [];
    const pass = await new P2pClaimsExecutor({
      transactions: db.transactions,
      insurer: null,
      alerts: recorder(true),
      log: (l) => lines.push(l),
    }).process();
    expect(pass).toMatchObject({ theftOpened: 0, trafficDone: 1, failed: 1 });
    expect(lines.some((l) => l.includes('THEFT_QUEUE_57P01'))).toBe(true);
    expect(lines.some((l) => l.includes('"sent":false'))).toBe(true);
  });
});
