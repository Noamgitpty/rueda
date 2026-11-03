/**
 * Règles de mouvement et de micro-interactions (US-031, 10b UX-67 et UX-69, ADR-069).
 *
 * Le catalogue `rules/motion.rules.json` nomme, pour chaque motif, ses jetons de durée et de
 * courbe : aucune valeur n'est écrite dans un composant. Il est validé au chargement (fail-closed)
 * contre les jetons requis de toutes les palettes. Avec `prefers-reduced-motion: reduce`, rien ne
 * bouge, signatures comprises : la feuille du thème met les durées à `0s` et l'échelle d'appui à
 * `1` (`themeStyleSheet`), les règles de base coupent toute animation et toute transition
 * (`BASE_CSS`), et le lint refuse une animation CSS sans arrêt explicite (`lint/motion.ts`).
 * Pour une animation pilotée en JavaScript (compteur de revenus), `motionDurationMs` rend 0.
 */
import motionRules from '../rules/motion.rules.json' with { type: 'json' };
import { REQUIRED_PATHS } from './build.ts';
import type { Theme } from './build.ts';

/** Media query du mouvement réduit, à utiliser telle quelle (CSS et `matchMedia`). */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export interface MotionPattern {
  readonly id: string;
  readonly use: string;
  readonly properties: readonly string[];
  /** Chemin du jeton de durée (`motion.duration.…`). */
  readonly duration: string;
  readonly easing: string;
  readonly delay?: string;
  readonly scale?: string;
  readonly iterations?: string;
  /** Exception assumée de 10b UX-69 (durée `signature`), une fois par écran au plus. */
  readonly signature?: boolean;
  /** Avec le mouvement réduit : l'état final s'affiche d'emblée. */
  readonly reduced: 'finalState';
}

export interface MotionBudget {
  readonly maxSimultaneous: number;
  readonly maxStaggeredItems: number;
  readonly maxSignaturePerScreen: number;
  readonly loopsAllowed: boolean;
}

export interface MotionRules {
  readonly version: string;
  readonly budget: MotionBudget;
  readonly patterns: readonly MotionPattern[];
}

export class MotionRulesError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`règles de mouvement invalides :\n- ${problems.join('\n- ')}`);
    this.name = 'MotionRulesError';
    this.problems = problems;
  }
}

const TOKEN_PREFIX = {
  duration: 'motion.duration.',
  delay: 'motion.duration.',
  easing: 'motion.easing.',
  scale: 'motion.scale.',
  iterations: 'motion.iterations.',
} as const;

const REQUIRED = new Set<string>(REQUIRED_PATHS);
const SIGNATURE_DURATION = 'motion.duration.signature';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Valide un catalogue de mouvement ; lève `MotionRulesError` avec chaque problème. */
export function validateMotionRules(doc: unknown): MotionRules {
  const problems: string[] = [];
  if (!isRecord(doc) || !isRecord(doc['meta']) || !isRecord(doc['budget']))
    throw new MotionRulesError(['meta et budget requis']);
  const budget = doc['budget'];
  for (const key of ['maxSimultaneous', 'maxStaggeredItems', 'maxSignaturePerScreen']) {
    const n = budget[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1)
      problems.push(`budget.${key} : entier ≥ 1 attendu`);
  }
  if (budget['loopsAllowed'] !== false)
    problems.push('budget.loopsAllowed : aucune boucle infinie (10b UX-69)');
  if (Number(budget['maxSignaturePerScreen']) > 1)
    problems.push('budget.maxSignaturePerScreen : une signature par écran au plus (UX-69)');

  const patterns = Array.isArray(doc['patterns']) ? doc['patterns'] : [];
  if (patterns.length === 0) problems.push('patterns : catalogue vide');
  const ids = new Set<string>();
  for (const [i, p] of patterns.entries()) {
    const where = isRecord(p) && typeof p['id'] === 'string' ? p['id'] : `#${i}`;
    if (!isRecord(p)) {
      problems.push(`${where} : objet attendu`);
      continue;
    }
    if (typeof p['id'] !== 'string' || !/^[a-z][A-Za-z]*$/.test(p['id']))
      problems.push(`${where} : identifiant invalide`);
    else if (ids.has(p['id'])) problems.push(`${where} : identifiant en double`);
    else ids.add(p['id']);
    if (typeof p['use'] !== 'string' || p['use'].trim() === '')
      problems.push(`${where} : usage manquant`);
    if (!Array.isArray(p['properties']) || p['properties'].length === 0)
      problems.push(`${where} : propriétés animées manquantes`);
    for (const [field, prefix] of Object.entries(TOKEN_PREFIX)) {
      const ref = p[field];
      if (ref === undefined && (field === 'delay' || field === 'scale' || field === 'iterations'))
        continue;
      if (typeof ref !== 'string' || !ref.startsWith(prefix) || !REQUIRED.has(ref))
        problems.push(
          `${where} : ${field} doit nommer un jeton requis ${prefix}… (reçu ${String(ref)})`,
        );
    }
    const signature = p['signature'] === true;
    if ((p['duration'] === SIGNATURE_DURATION) !== signature)
      problems.push(`${where} : la durée signature est réservée aux motifs « signature » (UX-69)`);
    if (p['reduced'] !== 'finalState')
      problems.push(`${where} : avec le mouvement réduit, l'état final s'affiche (UX-69)`);
  }
  if (problems.length > 0) throw new MotionRulesError(problems);
  return {
    version: String((doc['meta'] as Record<string, unknown>)['version']),
    budget: budget as unknown as MotionBudget,
    patterns: patterns as MotionPattern[],
  };
}

/** Catalogue publié, validé au chargement du module (fail-closed). */
export const MOTION_RULES: MotionRules = validateMotionRules(motionRules);

/** Motif du catalogue ; lève une erreur si l'identifiant est inconnu. */
export function motionPattern(id: string): MotionPattern {
  const found = MOTION_RULES.patterns.find((p) => p.id === id);
  if (!found) throw new MotionRulesError([`${id} : motif inconnu`]);
  return found;
}

/** Nom de la variable CSS d'un chemin de jeton (`motion.duration.fast` → `--motion-duration-fast`). */
export const cssVariableOf = (path: string): string => `--${path.split('.').join('-')}`;

/**
 * Durée en millisecondes d'un motif, pour une animation pilotée en JavaScript (compteur de
 * revenus). Rend 0 avec le mouvement réduit : la valeur finale s'affiche d'emblée (UX-69).
 */
export function motionDurationMs(theme: Theme, id: string, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  const name = cssVariableOf(motionPattern(id).duration).slice(2);
  const token = theme.tokens.find((t) => t.name === name);
  const m = token ? /^(\d+(?:\.\d+)?)(ms|s)$/.exec(token.light) : null;
  if (!m) throw new MotionRulesError([`${name} : durée introuvable dans le thème ${theme.id}`]);
  return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
}

/**
 * Préférence de l'appareil. Sans `matchMedia` (rendu serveur, navigateur ancien), on suppose le
 * mouvement réduit : en cas de doute, on n'anime pas (fail-closed).
 */
export function prefersReducedMotion(
  matchMedia?: ((query: string) => { readonly matches: boolean }) | undefined,
): boolean {
  if (typeof matchMedia !== 'function') return true;
  try {
    return matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return true;
  }
}
