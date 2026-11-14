/**
 * Objectifs de reprise (US-112, critère 1 ; ADR-121). Attendus : exigence de 17 §6.4 (« RPO ≤ 24 h
 * exigé ; RTO ≤ 8 h ») et scénarios du plan de reprise (A et B rejoués par l'exercice de la CI,
 * US-051) ; jamais une valeur recopiée du code.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  loadRecoveryObjectives,
  parseRecoveryObjectives,
  RECOVERY_OBJECTIVES_FILE,
} from './objectives.ts';

const HOUR = 3600;
const raw = (): Record<string, unknown> =>
  JSON.parse(readFileSync(RECOVERY_OBJECTIVES_FILE, 'utf8')) as Record<string, unknown>;

describe('objectifs de reprise (docs/ops/recovery-objectives.json)', () => {
  it('le fichier du dépôt est valide, PROPOSÉ ; exigence de 17 §6.4 : RPO 24 h, RTO 8 h', () => {
    const o = loadRecoveryObjectives();
    expect(o.status).toBe('PROPOSÉ');
    expect(o.required).toEqual({ rpoS: 24 * HOUR, rtoS: 8 * HOUR });
    // 17 §6.4 « cible ≤ 1 h » pour la base : les scénarios rejoués la tiennent au moins
    for (const s of ['instant', 'latest'] as const) {
      expect(o.scenarios[s].rpoS, s).toBeLessThanOrEqual(HOUR);
      expect(o.scenarios[s].rtoS, s).toBeLessThanOrEqual(8 * HOUR);
    }
    expect(o.scenarios.instant.drill).toBe('A');
    expect(o.scenarios.latest.drill).toBe('B');
    expect(o.scenarios.region.drill).toBeNull();
    expect(o.scenarios.files.drill).toBeNull();
  });

  it('fail-closed : objectif plus lâche que l’exigence, scénario absent ou inconnu, durée non entière, statut inconnu ⇒ refus', () => {
    type Doc = Record<string, unknown> & { scenarios: Record<string, Record<string, unknown>> };
    const at = (o: Doc, name: string): Record<string, unknown> => {
      const s = o.scenarios[name];
      if (s === undefined) throw new Error(name);
      return s;
    };
    const variants: ((o: Doc) => void)[] = [
      (o) => (at(o, 'instant')['rpoS'] = 25 * HOUR),
      (o) => (at(o, 'latest')['rtoS'] = 9 * HOUR),
      (o) => delete o.scenarios['files'],
      (o) => (o.scenarios['other'] = { label: 'x', drill: null, rpoS: 1, rtoS: 1 }),
      (o) => (at(o, 'region')['rpoS'] = 1.5),
      (o) => (at(o, 'region')['rtoS'] = 0),
      (o) => (at(o, 'instant')['drill'] = null),
      (o) => (at(o, 'region')['drill'] = 'A'),
      (o) => (at(o, 'files')['label'] = ' '),
      (o) => (o['status'] = 'TBD'),
      (o) => delete o['required'],
    ];
    for (const [i, mutate] of variants.entries()) {
      const o = raw() as Doc;
      mutate(o);
      expect(() => parseRecoveryObjectives(o), `variante ${i}`).toThrow(/objectifs de reprise/);
    }
    expect(() => parseRecoveryObjectives(null)).toThrow(/objectifs de reprise/);
  });
});
