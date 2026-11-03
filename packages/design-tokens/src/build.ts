/**
 * Compilation d'une palette DTCG (docs/design/US-028/tokens-*.json) en thème typé et sûr.
 *
 * Étapes : fusion socle ← palette ← surcharges publiées, résolution des alias `{chemin}`,
 * validation stricte de chaque valeur selon son `$type` (fail-closed : un type inconnu, une valeur
 * hors format ou un jeton requis absent est une erreur), puis mise à plat en variables CSS.
 * Les valeurs validées ne peuvent contenir ni `;`, ni accolade, ni `<` : elles sont injectables
 * telles quelles dans une feuille de style, même quand elles viendront de la base (US-034).
 */
import foundation from '../foundation.tokens.json' with { type: 'json' };

/** Version du format des jetons (`brand_version.tokens_schema_version`, 17 §3.2.13). */
export const TOKENS_SCHEMA_VERSION = 1;

export type Mode = 'light' | 'dark';
export const MODES: readonly Mode[] = ['light', 'dark'];

/** Jetons sémantiques de couleur (10b UX-67) et tons d'avatar (PROPOSITIONS, « Passage à US-030 »). */
export const SEMANTIC_COLORS = [
  'primary',
  'on-primary',
  'surface',
  'surface-raised',
  'surface-sunken',
  'text',
  'text-muted',
  'border',
  'border-strong',
  'accent',
  'on-accent',
  'success',
  'success-soft',
  'danger',
  'danger-soft',
  'warning',
  'warning-soft',
  'focus',
  'avatar-1',
  'on-avatar-1',
  'avatar-2',
  'on-avatar-2',
  'avatar-3',
  'on-avatar-3',
  'avatar-4',
  'on-avatar-4',
] as const;
export type SemanticColor = (typeof SEMANTIC_COLORS)[number];

/**
 * Jetons non colorés que tout thème doit fournir (après fusion avec le socle), pour qu'un
 * composant puisse s'appuyer sur chacun quelle que soit la palette choisie.
 */
export const REQUIRED_PATHS = [
  'font.family.heading',
  'font.family.body',
  'font.family.mono',
  'font.weight.heading',
  'font.weight.body',
  'font.weight.strong',
  'font.size.xs',
  'font.size.sm',
  'font.size.md',
  'font.size.lg',
  'font.size.xl',
  'font.size.2xl',
  'font.size.3xl',
  'font.lineHeight.body',
  'font.lineHeight.heading',
  'font.display.family',
  'font.display.weight',
  'font.display.size',
  'font.display.sizeCompact',
  'font.display.letterSpacing',
  'font.display.lineHeight',
  'space.1',
  'space.2',
  'space.3',
  'space.4',
  'space.5',
  'space.6',
  'space.8',
  'space.10',
  'size.touchTarget',
  'size.actionBar',
  'size.focusRing',
  'size.focusOffset',
  'radius.sm',
  'radius.md',
  'radius.lg',
  'radius.card',
  'radius.pill',
  'shadow.raised',
  'shadow.card',
  'shadow.float',
  'motion.duration.fast',
  'motion.duration.base',
  'motion.duration.slow',
  'motion.duration.enter',
  'motion.duration.page',
  'motion.duration.signature',
  'motion.duration.skeleton',
  'motion.easing.standard',
  'motion.easing.emphasis',
  'motion.iterations.skeleton',
  'glass.opacity',
  'glass.blur',
  'glass.saturate',
  'camino.strokeWidth',
  'camino.dashArray',
] as const;

/** Groupes compilés en CSS ; tout le reste (meta, brand, contrastChecks…) est ignoré. */
const EMITTED_GROUPS = [
  'color',
  'font',
  'space',
  'size',
  'radius',
  'shadow',
  'motion',
  'glass',
  'camino',
];
/** Jetons documentaires (texte libre), jamais compilés. */
const DOC_PATHS = new Set(['font.source', 'motion.reducedMotion']);
/** Gammes de nuances : outil du designer, pas des jetons de composant (UX-67). */
const SKIPPED_PREFIXES = ['color.scale.'];

/** Clé d'extension DTCG portant la valeur sombre d'un jeton non coloré (ombres). */
export const DARK_EXTENSION = 'org.rueda';

export interface ThemeToken {
  /** Chemin DTCG sans le mode, par exemple `color.primary` ou `radius.card`. */
  readonly path: string;
  /** Nom de la variable CSS, sans `--` (`color-primary`, `radius-card`). */
  readonly name: string;
  readonly type: string;
  readonly light: string;
  readonly dark: string;
}

export interface Theme {
  readonly id: string;
  readonly version: string;
  readonly schemaVersion: number;
  readonly colors: Readonly<Record<Mode, Readonly<Record<SemanticColor, string>>>>;
  readonly glassOpacity: number;
  readonly tokens: readonly ThemeToken[];
}

export class ThemeFormatError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`thème invalide :\n- ${problems.join('\n- ')}`);
    this.problems = problems;
    this.name = 'ThemeFormatError';
  }
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const isObject = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Fusion profonde : `top` gagne ; un jeton (objet avec `$value`) est remplacé en entier. */
export function deepMerge(base: Json, top: Json): Json {
  if (!isObject(base) || !isObject(top) || '$value' in top) return structuredClone(top);
  const out: JsonObject = structuredClone(base);
  for (const [k, v] of Object.entries(top))
    out[k] = k in out ? deepMerge(out[k] as Json, v) : structuredClone(v);
  return out;
}

const ALIAS = /^\{([A-Za-z0-9_.-]+)\}$/;
const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function lookup(tree: JsonObject, path: string): JsonObject | undefined {
  let node: Json | undefined = tree;
  for (const part of path.split('.')) node = isObject(node) ? node[part] : undefined;
  return isObject(node) && '$value' in node ? node : undefined;
}

/** Valeur brute d'un jeton après résolution des alias (cycles et alias morts refusés). */
function resolve(tree: JsonObject, value: Json, from: string, seen: string[] = []): Json {
  if (typeof value !== 'string') return value;
  const m = ALIAS.exec(value);
  if (!m?.[1]) return value;
  const target = m[1];
  if (seen.includes(target)) throw new Error(`alias circulaire : ${[...seen, target].join(' → ')}`);
  const token = lookup(tree, target);
  if (!token) throw new Error(`${from} : alias vers un jeton absent {${target}}`);
  return resolve(tree, token['$value'] as Json, from, [...seen, target]);
}

const DIMENSION = /^-?\d+(\.\d+)?(px|rem|em|%)$/;
const DURATION = /^\d+(\.\d+)?(ms|s)$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const FONT_NAME = /^[A-Za-z0-9 -]+$/;
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'system-ui',
  'ui-monospace',
  'ui-sans-serif',
  'ui-serif',
  'cursive',
]);
const SHADOW = /^(none|[0-9a-z.,()%\s-]+)$/i;

/** Valeur CSS d'un jeton, ou erreur si elle ne respecte pas son type. */
function toCss(type: string, path: string, value: Json): string {
  const bad = (expected: string): never => {
    throw new Error(`${path} : ${JSON.stringify(value)} n'est pas ${expected}`);
  };
  if (path.startsWith('shadow.')) {
    if (typeof value !== 'string' || !SHADOW.test(value)) bad('une ombre CSS simple');
    return value as string;
  }
  switch (type) {
    case 'color':
      if (typeof value !== 'string' || !COLOR.test(value)) bad('une couleur #RRGGBB');
      return (value as string).toUpperCase();
    case 'dimension':
      if (typeof value !== 'string' || !DIMENSION.test(value))
        bad('une dimension (px, rem, em, %)');
      return value as string;
    case 'duration':
      if (typeof value !== 'string' || !DURATION.test(value)) bad('une durée (ms, s)');
      return value as string;
    case 'cubicBezier': {
      const ok =
        Array.isArray(value) &&
        value.length === 4 &&
        value.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
        [value[0], value[2]].every((x) => (x as number) >= 0 && (x as number) <= 1);
      if (!ok) bad('une courbe de Bézier [x1, y1, x2, y2] (x dans [0, 1])');
      return `cubic-bezier(${(value as number[]).join(', ')})`;
    }
    case 'fontFamily': {
      const list = Array.isArray(value) ? value : [value];
      if (list.length === 0 || !list.every((f) => typeof f === 'string' && FONT_NAME.test(f)))
        bad('une liste de familles de polices');
      return (list as string[]).map((f) => (GENERIC_FAMILIES.has(f) ? f : `"${f}"`)).join(', ');
    }
    case 'fontWeight':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 100 || value > 900)
        bad('une graisse entière entre 100 et 900');
      return String(value);
    case 'number': {
      const list = Array.isArray(value) ? value : [value];
      if (
        list.length === 0 ||
        !list.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
      )
        bad('un nombre positif ou une liste de nombres positifs');
      return (list as number[]).join(' ');
    }
    default:
      return bad(`d'un type connu (type ${JSON.stringify(type)} refusé)`);
  }
}

interface Leaf {
  readonly path: string;
  readonly token: JsonObject;
}

function leaves(node: Json, path: string[], out: Leaf[]): Leaf[] {
  if (!isObject(node)) return out;
  if ('$value' in node) {
    out.push({ path: path.join('.'), token: node });
    return out;
  }
  for (const [k, v] of Object.entries(node)) if (!k.startsWith('$')) leaves(v, [...path, k], out);
  return out;
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Construit un thème à partir d'une palette brute et de surcharges facultatives (par exemple les
 * jetons d'une version publiée, US-034). Ne contrôle pas le contraste : voir `loadTheme`.
 */
export function buildTheme(palette: unknown, overrides?: unknown): Theme {
  const problems: string[] = [];
  if (!isObject(palette)) throw new ThemeFormatError(['la palette doit être un objet JSON']);
  if (overrides !== undefined && !isObject(overrides))
    throw new ThemeFormatError(['les surcharges doivent être un objet JSON']);

  const meta = isObject(palette['meta']) ? palette['meta'] : {};
  const id = meta['direction'];
  const version = meta['version'];
  if (typeof id !== 'string' || !ID.test(id))
    problems.push('meta.direction : identifiant absent ou invalide');
  if (typeof version !== 'string' || !SEMVER.test(version))
    problems.push('meta.version : version x.y.z absente');

  let tree = deepMerge(foundation as Json, palette as Json);
  if (overrides !== undefined) tree = deepMerge(tree, overrides as Json);
  const root = tree as JsonObject;

  const byPath = new Map<string, { type: string; light?: string; dark?: string }>();
  for (const group of EMITTED_GROUPS) {
    for (const { path, token } of leaves(root[group] ?? null, [group], [])) {
      if (DOC_PATHS.has(path) || SKIPPED_PREFIXES.some((p) => path.startsWith(p))) continue;
      try {
        const type = String(token['$type'] ?? '');
        const modeMatch = /^color\.(light|dark)\.(.+)$/.exec(path);
        if (group === 'color' && !modeMatch)
          throw new Error(`${path} : couleur hors des modes light / dark`);
        const key = modeMatch ? `color.${modeMatch[2]}` : path;
        if (modeMatch && type !== 'color') throw new Error(`${path} : $type "color" attendu`);
        const value = toCss(type, path, resolve(root, token['$value'] as Json, path));
        const entry = byPath.get(key) ?? { type };
        if (modeMatch) {
          entry[modeMatch[1] as Mode] = value;
        } else {
          const ext = token['$extensions'];
          const darkRaw =
            isObject(ext) && isObject(ext[DARK_EXTENSION])
              ? ext[DARK_EXTENSION]['dark']
              : undefined;
          entry.light = value;
          entry.dark =
            darkRaw === undefined ? value : toCss(type, path, resolve(root, darkRaw, path));
        }
        byPath.set(key, entry);
      } catch (error) {
        problems.push((error as Error).message);
      }
    }
  }

  for (const name of SEMANTIC_COLORS) {
    for (const mode of MODES) {
      if (!byPath.get(`color.${name}`)?.[mode])
        problems.push(`color.${mode}.${name} : jeton requis absent`);
    }
  }
  for (const path of REQUIRED_PATHS)
    if (!byPath.has(path)) problems.push(`${path} : jeton requis absent`);
  for (const [path, entry] of byPath) {
    if (path.startsWith('color.') && (!entry.light || !entry.dark))
      problems.push(`${path} : valeur claire et sombre requises`);
  }
  const glassOpacity = Number(byPath.get('glass.opacity')?.light);
  if (byPath.has('glass.opacity') && !(glassOpacity > 0 && glassOpacity <= 1))
    problems.push('glass.opacity : opacité attendue dans ]0, 1]');

  if (problems.length > 0) throw new ThemeFormatError(problems);

  const colors = Object.fromEntries(
    MODES.map((mode) => [
      mode,
      Object.fromEntries(
        SEMANTIC_COLORS.map((c) => [c, byPath.get(`color.${c}`)?.[mode] as string]),
      ),
    ]),
  ) as unknown as Theme['colors'];

  const tokens: ThemeToken[] = [...byPath.entries()]
    .map(([path, e]) => ({
      path,
      name: path.split('.').map(kebab).join('-'),
      type: e.type,
      light: e.light as string,
      dark: e.dark as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    id: id as string,
    version: version as string,
    schemaVersion: TOKENS_SCHEMA_VERSION,
    colors,
    glassOpacity,
    tokens,
  };
}
