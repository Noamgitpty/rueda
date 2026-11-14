/**
 * Logo de la marque (US-120, écran O02) : un **jeton** texte du groupe `brand` (`brand.logo`,
 * `brand.logoDark`, `brand.logoMono`), un SVG que le site et la console n'affichent **qu'en
 * image** (`<img src="data:image/svg+xml,…">`, US-048), jamais injecté dans la page : un script
 * d'un SVG chargé en image ne s'exécute pas. Défense en profondeur, appliquée à l'API à
 * l'enregistrement d'un brouillon et par la console avant l'envoi : un logo doit être un SVG
 * autonome, borné, sans script, sans gestionnaire d'événement, sans contenu étranger ni
 * ressource externe, sans déclaration DTD (entités). Liste de refus documentée, PROPOSÉ
 * (ADR-116) ; un SVG hors de ces règles est refusé, jamais « nettoyé ».
 */

/** Chemins DTCG des logos de la marque (groupe `brand`, ignoré par la compilation CSS). */
export const LOGO_TOKEN_PATHS = ['brand.logo', 'brand.logoDark', 'brand.logoMono'] as const;

/** Taille maximale d'un logo, en caractères (même borne que le site, `brand-source.ts`). */
export const LOGO_MAX_LENGTH = 20_000;

/** Motifs refusés dans un logo SVG, avec le motif du refus. */
const LOGO_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/<script\b/i, 'script'],
  [/<foreignobject\b/i, 'contenu étranger (foreignObject)'],
  [/<!(doctype|entity|\[cdata\[)/i, 'déclaration DTD, entité ou CDATA'],
  [/<\?/, 'instruction de traitement'],
  [/\son[a-z]+\s*=/i, "gestionnaire d'événement (on…=)"],
  [/javascript:|vbscript:|data:/i, 'adresse active (javascript:, data:)'],
  [/\b(xlink:)?href\s*=\s*(?!["']?\s*#)/i, 'lien ou ressource externe (href hors #)'],
  [/url\(\s*(?!["']?\s*#)/i, 'ressource externe (url() hors #)'],
  [/@import\b/i, 'feuille externe (@import)'],
  [/<(iframe|embed|object|audio|video|image|animate|set)\b/i, 'élément interdit'],
];

/** Défaut d'un logo SVG (`null` = conforme). Le texte du motif reste en français (journal). */
export function logoProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'texte SVG attendu';
  if (value.length === 0 || value.length > LOGO_MAX_LENGTH) {
    return `taille : 1 à ${LOGO_MAX_LENGTH} caractères`;
  }
  const svg = value.trim();
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>$/i.test(svg)) {
    return 'un seul élément <svg> attendu';
  }
  // eslint-disable-next-line no-control-regex -- caractères de contrôle refusés, voulu
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(svg)) return 'caractère de contrôle';
  for (const [pattern, why] of LOGO_RULES) if (pattern.test(svg)) return why;
  return null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Valeur `$value` du jeton au chemin `a.b`, ou `undefined` s'il est absent. */
function tokenAt(doc: unknown, path: string): { found: boolean; value: unknown } {
  let node: unknown = doc;
  for (const part of path.split('.')) {
    if (!isObject(node) || !Object.hasOwn(node, part)) return { found: false, value: undefined };
    node = node[part];
  }
  return isObject(node) && Object.hasOwn(node, '$value')
    ? { found: true, value: node['$value'] }
    : { found: true, value: node };
}

/** Défauts des logos présents dans un document de jetons (`[]` = conformes ou absents). */
export function logoProblems(tokens: unknown): string[] {
  return LOGO_TOKEN_PATHS.flatMap((path) => {
    const { found, value } = tokenAt(tokens, path);
    if (!found) return [];
    const problem = logoProblem(value);
    return problem === null ? [] : [`${path} : ${problem}`];
  });
}
