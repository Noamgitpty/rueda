/**
 * Logo de la marque (US-120, écran O02) : un **jeton** texte du groupe `brand` (`brand.logo`,
 * `brand.logoDark`, `brand.logoMono`), un SVG que le site et la console n'affichent **qu'en
 * image** (`<img src="data:image/svg+xml,…">`, US-048), jamais injecté dans la page : un script
 * d'un SVG chargé en image ne s'exécute pas. Défense en profondeur, appliquée par l'API à
 * l'enregistrement d'un brouillon, par la console avant l'envoi et par le site à la lecture : un
 * logo doit être un SVG autonome, borné, sans script, sans gestionnaire d'événement, sans contenu
 * étranger ni ressource externe, sans déclaration DTD (entités).
 *
 * Contrôle par **analyse XML et liste blanche** (US-122, red team F-L1-B-01, ADR-122, PROPOSÉ ;
 * remplace la liste de refus d'ADR-116) : le texte est lu balise par balise, sans tolérance
 * (un blanc avant chaque attribut, valeurs entre guillemets, balises fermées dans l'ordre, une
 * seule racine `<svg>`). Sont refusés : tout élément ou attribut hors de la liste blanche, tout
 * préfixe d'espace de noms (sauf `xlink:href`), tout espace de noms autre que SVG et XLink, tout
 * attribut `on…`, toute déclaration (`<!…`, `<?…`, commentaire, CDATA), toute entité (`&`), et
 * dans une valeur ou un texte : contre-oblique (échappement CSS), `url(` hors `#id`, `image-set`,
 * `@`, `expression(` et les adresses actives. Un SVG hors de ces règles est refusé, jamais
 * « nettoyé ».
 */

/** Chemins DTCG des logos de la marque (groupe `brand`, ignoré par la compilation CSS). */
export const LOGO_TOKEN_PATHS = ['brand.logo', 'brand.logoDark', 'brand.logoMono'] as const;

/** Taille maximale d'un logo, en caractères (même borne que le site, `brand-source.ts`). */
export const LOGO_MAX_LENGTH = 20_000;

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Éléments admis : formes, groupes, dégradés, découpes, texte. Jamais `style`, `a`, `image`… */
const ELEMENTS: ReadonlySet<string> = new Set([
  'svg',
  'g',
  'defs',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'use',
  'symbol',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
]);

/** Éléments dont le contenu peut être du texte. */
const TEXT_ELEMENTS: ReadonlySet<string> = new Set(['title', 'desc', 'text', 'tspan']);

/** Attributs admis (géométrie, présentation, accessibilité) ; `xmlns` et `href` à part. */
const ATTRIBUTES: ReadonlySet<string> = new Set([
  'id',
  'class',
  'version',
  'viewBox',
  'preserveAspectRatio',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'dx',
  'dy',
  'd',
  'points',
  'pathLength',
  'transform',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'color',
  'display',
  'visibility',
  'vector-effect',
  'paint-order',
  'clip-path',
  'clip-rule',
  'clipPathUnits',
  'mask',
  'maskUnits',
  'maskContentUnits',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'style',
  'role',
  'aria-label',
  'aria-hidden',
  'aria-labelledby',
  'focusable',
  'lang',
]);

/** Motifs refusés dans toute valeur d'attribut et dans tout texte. */
const CONTENT_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\\/, 'échappement CSS (contre-oblique)'],
  [/javascript:|vbscript:|data:/i, 'adresse active (javascript:, data:)'],
  [/url\(\s*(?!["']?\s*#[A-Za-z_][\w.-]*\s*["']?\s*\))/i, 'ressource externe (url() hors #)'],
  [/image-set|expression\s*\(|-moz-binding|behavior\s*:/i, 'ressource externe (CSS)'],
  [/@/, 'règle CSS (@import…)'],
];

const ELEMENT_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const CLOSING_TAG = /^<\/([A-Za-z_][A-Za-z0-9_.:-]*)\s*>/;
const TAG_END = /^\s*(\/?)>/;
const ATTRIBUTE = /^\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/;
const LOCAL_REF = /^#[A-Za-z_][\w.-]*$/;

function contentProblem(value: string): string | null {
  for (const [pattern, why] of CONTENT_RULES) if (pattern.test(value)) return why;
  return null;
}

/** Motif du refus d'un élément (motifs d'ADR-116 gardés : journal, tests). */
function elementProblem(name: string): string | null {
  if (name.toLowerCase() === 'script' || name.toLowerCase().endsWith(':script')) return 'script';
  if (name.includes(':')) return "espace de noms d'élément interdit";
  if (name.toLowerCase() === 'foreignobject') return 'contenu étranger (foreignObject)';
  return ELEMENTS.has(name) ? null : 'élément interdit';
}

/** Motif du refus d'un attribut et de sa valeur (`null` = admis). */
function attributeProblem(element: string, name: string, value: string): string | null {
  if (/^on/i.test(name)) return "gestionnaire d'événement (on…=)";
  if (name === 'xmlns') return value === SVG_NS ? null : 'espace de noms inconnu';
  if (name === 'xmlns:xlink') return value === XLINK_NS ? null : 'espace de noms inconnu';
  if (name.startsWith('xmlns')) return 'espace de noms inconnu';
  if (name === 'href' || name === 'xlink:href') {
    return element === 'use' && LOCAL_REF.test(value)
      ? null
      : 'lien ou ressource externe (href hors #)';
  }
  if (name.includes(':')) return "espace de noms d'attribut interdit";
  if (!ATTRIBUTES.has(name)) return `attribut interdit (${name})`;
  return contentProblem(value);
}

/** Texte entre deux balises (`null` = admis). */
function textProblem(text: string, parent: string | undefined): string | null {
  if (text.includes('&')) return 'entité (&…;)';
  if (text.includes('>')) return 'balise mal formée';
  if (text.trim().length === 0) return null;
  if (parent === undefined || !TEXT_ELEMENTS.has(parent)) return 'texte hors des éléments de texte';
  return contentProblem(text);
}

/** Déclaration, commentaire ou instruction (`<!…`, `<?…`) : toujours refusés. */
function declarationProblem(rest: string): string {
  if (rest.startsWith('<?')) return 'instruction de traitement';
  return /^<!(doctype|entity|\[cdata\[)/i.test(rest)
    ? 'déclaration DTD, entité ou CDATA'
    : 'commentaire ou déclaration';
}

/** Balise ouvrante à `start` : rend sa fin, son nom et si elle se ferme elle-même, ou un défaut. */
function openingTag(
  svg: string,
  start: number,
): { problem: string } | { end: number; name: string; selfClosing: boolean } {
  const nameMatch = ELEMENT_NAME.exec(svg.slice(start + 1));
  if (!nameMatch) return { problem: 'balise mal formée' };
  const name = nameMatch[0];
  const bad = elementProblem(name);
  if (bad !== null) return { problem: bad };
  let j = start + 1 + name.length;
  const seen = new Set<string>();
  for (;;) {
    const rest = svg.slice(j);
    const end = TAG_END.exec(rest);
    if (end) return { end: j + end[0].length, name, selfClosing: end[1] === '/' };
    // un blanc au moins avant chaque attribut, valeur entre guillemets, jamais en double
    const attr = ATTRIBUTE.exec(rest);
    if (!attr) return { problem: 'attribut mal formé' };
    const attrName = attr[1] ?? '';
    const value = attr[2] ?? attr[3] ?? '';
    if (seen.has(attrName)) return { problem: 'attribut en double' };
    seen.add(attrName);
    if (value.includes('&')) return { problem: 'entité (&…;)' };
    const why = attributeProblem(name, attrName, value);
    if (why !== null) return { problem: why };
    j += attr[0].length;
  }
}

/** Analyse stricte du SVG : premier défaut, ou `null`. Une seule racine `<svg>`, rien après. */
function parseProblem(svg: string): string | null {
  const stack: string[] = [];
  let i = 0;
  let closedRoot = false;
  while (i < svg.length) {
    const lt = svg.indexOf('<', i);
    const text = lt === -1 ? svg.slice(i) : svg.slice(i, lt);
    if (text.length > 0) {
      if (closedRoot && text.trim().length > 0) return 'un seul élément <svg> attendu';
      const why = textProblem(text, stack.at(-1));
      if (why !== null) return why;
    }
    if (lt === -1) break;
    if (closedRoot) return 'un seul élément <svg> attendu';
    const rest = svg.slice(lt);
    if (rest.startsWith('<!') || rest.startsWith('<?')) return declarationProblem(rest);
    if (rest.startsWith('</')) {
      const m = CLOSING_TAG.exec(rest);
      if (!m || stack.pop() !== m[1]) return 'balise fermante mal formée';
      i = lt + m[0].length;
      closedRoot = stack.length === 0;
      continue;
    }
    const tag = openingTag(svg, lt);
    if ('problem' in tag) return tag.problem;
    if (stack.length === 0 && (tag.name !== 'svg' || lt !== 0)) {
      return 'un seul élément <svg> attendu';
    }
    if (tag.selfClosing) closedRoot = stack.length === 0;
    else stack.push(tag.name);
    i = tag.end;
  }
  if (stack.length > 0) return 'balise non fermée';
  return closedRoot ? null : 'un seul élément <svg> attendu';
}

/** Défaut d'un logo SVG (`null` = conforme). Le texte du motif reste en français (journal). */
export function logoProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'texte SVG attendu';
  if (value.length === 0 || value.length > LOGO_MAX_LENGTH) {
    return `taille : 1 à ${LOGO_MAX_LENGTH} caractères`;
  }
  const svg = value.trim();
  if (!svg.startsWith('<svg')) return 'un seul élément <svg> attendu';
  // eslint-disable-next-line no-control-regex -- caractères de contrôle refusés, voulu
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(svg)) return 'caractère de contrôle';
  return parseProblem(svg);
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
