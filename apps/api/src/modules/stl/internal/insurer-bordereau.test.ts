/**
 * US-227 (ADR-165) — tâche périodique du bordereau de l'assureur, sans base : déclaration (file
 * `bordereau`, 24 h), une passe appelle la seule commande de la base et ne journalise que des comptes ;
 * une issue inconnue est une erreur de contrat (fail-closed). La preuve sur PostgreSQL réel, sous
 * les rôles de production, est `packages/db/test/l0/l0-us227-insurer-ledger.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { BusRegistry } from '../../bus/index.js';
import type { SqlClient, SqlResult } from '../../bus/index.js';
import {
  DRAFT_INSURER_BORDEREAUX_SQL,
  draftCounts,
  INSURER_BORDEREAU_PERIOD_SECONDS,
  INSURER_BORDEREAU_WORKER,
  InsurerBordereauContractError,
  registerInsurerBordereaux,
} from './insurer-bordereau.js';

class ScriptedSql implements SqlClient {
  readonly texts: string[] = [];
  constructor(private readonly rows: Record<string, unknown>[]) {}
  query<R>(text: string): Promise<SqlResult<R>> {
    this.texts.push(text);
    return Promise.resolve({ rows: this.rows as R[], rowCount: this.rows.length });
  }
}

describe('US-227 — tâche du bordereau de l’assureur', () => {
  it('déclarée au registre (file bordereau, 24 h) ; une passe appelle la commande et journalise des comptes', async () => {
    const registry = new BusRegistry();
    const lines: string[] = [];
    registerInsurerBordereaux(registry, (l) => lines.push(l));
    expect(registry.queueNames()).toEqual([INSURER_BORDEREAU_WORKER]);
    expect(INSURER_BORDEREAU_WORKER).toBe('bordereau');
    const task = registry.periodicTasks().find((t) => t.name === INSURER_BORDEREAU_WORKER);
    expect(task?.spec.periodSeconds).toBe(INSURER_BORDEREAU_PERIOD_SECONDS);
    expect(INSURER_BORDEREAU_PERIOD_SECONDS).toBe(86_400);
    const handler = registry.handlerOf(INSURER_BORDEREAU_WORKER);
    if (handler?.kind !== 'timer') throw new Error('minuterie attendue');
    const sql = new ScriptedSql([
      { outcome: 'DRAFTED', country: 'PA' },
      { outcome: 'EMPTY', country: 'PA' },
      { outcome: 'PERIOD_OPEN', country: 'PY' },
    ]);
    await handler.handle({}, sql);
    expect(sql.texts).toEqual([DRAFT_INSURER_BORDEREAUX_SQL]);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      level: 'info',
      worker: 'bordereau',
      drafted: 1,
      exists: 0,
      empty: 1,
      period_open: 1,
    });
    // aucun identifiant ni montant au journal
    expect(lines[0]).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('la requête ne lit aucune horloge et n’écrit rien elle-même (la base décide le mois)', () => {
    expect(DRAFT_INSURER_BORDEREAUX_SQL).not.toMatch(/\b(now|current_timestamp|clock_timestamp)\b/i);
    expect(DRAFT_INSURER_BORDEREAUX_SQL).toMatch(/settlement_cmd_draft_insurer_bordereaux\(NULL\)/);
  });

  it('issue inconnue ⇒ erreur de contrat (fail-closed)', () => {
    expect(draftCounts([{ outcome: 'EXISTS' }])).toEqual({
      DRAFTED: 0,
      EXISTS: 1,
      EMPTY: 0,
      PERIOD_OPEN: 0,
    });
    for (const bad of [{ outcome: 'ISSUED' }, { outcome: null }, { outcome: 1 }]) {
      expect(() => draftCounts([bad])).toThrow(InsurerBordereauContractError);
    }
  });
});
