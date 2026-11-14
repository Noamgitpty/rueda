/**
 * Objectifs de reprise (RPO / RTO) PROPOSÉS par scénario (US-112, ADR-121 ; 16 ADM-035 ; 17 §6.4) :
 * lecture et contrôle de `docs/ops/recovery-objectives.json`, source unique de l'exercice de
 * restauration (job « reprise ») et du plan de reprise (`docs/ops/DISASTER_RECOVERY.md`).
 *
 * Contrôle fail-closed : un fichier mal formé, un scénario manquant ou un objectif plus lâche que
 * l'exigence de 17 §6.4 (`required`) fait échouer la lecture (et donc l'exercice).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../paths.ts';

/** Fichier des objectifs, à la racine du dépôt. */
export const RECOVERY_OBJECTIVES_FILE: string = join(
  PACKAGE_ROOT,
  '..',
  '..',
  'docs',
  'ops',
  'recovery-objectives.json',
);

/** Scénarios du plan de reprise ; `instant` et `latest` sont rejoués par l'exercice (A, B). */
export const RECOVERY_SCENARIOS = ['instant', 'latest', 'region', 'files'] as const;
export type RecoveryScenario = (typeof RECOVERY_SCENARIOS)[number];
const DRILLED: Readonly<Partial<Record<RecoveryScenario, string>>> = { instant: 'A', latest: 'B' };

export interface RecoveryObjective {
  readonly label: string;
  readonly drill: string | null;
  readonly rpoS: number;
  readonly rtoS: number;
}

export interface RecoveryObjectives {
  readonly status: string;
  readonly required: { readonly rpoS: number; readonly rtoS: number };
  readonly scenarios: Readonly<Record<RecoveryScenario, RecoveryObjective>>;
}

export class RecoveryObjectivesError extends Error {
  constructor(reason: string) {
    super(`objectifs de reprise invalides : ${reason}`);
    this.name = 'RecoveryObjectivesError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const seconds = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

/** Contrôle la forme et les bornes ; rend les objectifs typés ou lève. */
export function parseRecoveryObjectives(input: unknown): RecoveryObjectives {
  if (!isRecord(input)) throw new RecoveryObjectivesError('objet attendu');
  const { status, required, scenarios } = input;
  if (typeof status !== 'string' || !['PROPOSÉ', 'DÉCIDÉ'].includes(status)) {
    throw new RecoveryObjectivesError('statut PROPOSÉ ou DÉCIDÉ attendu');
  }
  if (!isRecord(required) || !seconds(required['rpoS']) || !seconds(required['rtoS'])) {
    throw new RecoveryObjectivesError('exigence (required) : rpoS et rtoS en secondes');
  }
  const req = { rpoS: required['rpoS'], rtoS: required['rtoS'] };
  if (!isRecord(scenarios)) throw new RecoveryObjectivesError('scénarios attendus');
  const extra = Object.keys(scenarios).filter(
    (k) => !(RECOVERY_SCENARIOS as readonly string[]).includes(k),
  );
  if (extra.length > 0) throw new RecoveryObjectivesError(`scénario inconnu : ${extra.join(', ')}`);
  const out = {} as Record<RecoveryScenario, RecoveryObjective>;
  for (const name of RECOVERY_SCENARIOS) {
    const s = scenarios[name];
    if (!isRecord(s)) throw new RecoveryObjectivesError(`scénario ${name} absent`);
    const { label, drill, rpoS, rtoS } = s;
    if (typeof label !== 'string' || label.trim() === '') {
      throw new RecoveryObjectivesError(`${name} : libellé attendu`);
    }
    if (!seconds(rpoS) || !seconds(rtoS)) {
      throw new RecoveryObjectivesError(`${name} : rpoS et rtoS en secondes`);
    }
    // un objectif n'est jamais plus lâche que l'exigence de 17 §6.4
    if (rpoS > req.rpoS || rtoS > req.rtoS) {
      throw new RecoveryObjectivesError(`${name} : objectif au-delà de l'exigence`);
    }
    if ((drill ?? null) !== (DRILLED[name] ?? null)) {
      throw new RecoveryObjectivesError(
        `${name} : scénario d'exercice ${DRILLED[name] ?? 'aucun'}`,
      );
    }
    out[name] = { label, drill: DRILLED[name] ?? null, rpoS, rtoS };
  }
  return { status, required: req, scenarios: out };
}

/** Lit et contrôle le fichier des objectifs (défaut : celui du dépôt). */
export function loadRecoveryObjectives(
  path: string = RECOVERY_OBJECTIVES_FILE,
): RecoveryObjectives {
  return parseRecoveryObjectives(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
