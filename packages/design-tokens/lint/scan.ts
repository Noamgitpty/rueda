/**
 * Lint des styles codés en dur (US-030, 19 §1.2 point 7, 10b UX-67) : toute couleur, police,
 * taille de texte, graisse, espacement, rayon, ombre ou durée doit venir d'un jeton (`var(--…)`).
 * Analyse par motifs, sans dépendance, de trois sortes de sources :
 *
 * - `css` (.css, .scss, .sass, .less) : toutes les déclarations ;
 * - `ts` (.ts, .tsx, .js…) : clés de style (nues, entre guillemets, camelCase ou kebab-case),
 *   attributs `style="…"`, `fill="…"`, `stroke="…"`…, et CSS écrit dans une chaîne ou un gabarit ;
 * - `markup` (.html, .svg) : attributs et blocs `<style>`.
 *
 * Fermetures volontaires (revue code US-030) : le repli d'un `var(--x, repli)` est jugé comme
 * une valeur ; une variable locale `--x` ne peut contenir que des `var()`, des nombres sans unité
 * et des mots neutres ; les noms de propriétés sont comparés sans casse ; le raccourci `font` est
 * jugé. Valeurs permises : `var(--…)` sans repli, `calc()` / `min()` / `max()` / `clamp()` /
 * `color-mix()` de variables, `0`, `auto`, `none`, `inherit`, `initial`, `unset`, `revert`,
 * `currentColor`, `transparent`, et `50%` pour un rayon. Il n'y a pas de liste blanche de
 * valeurs : un faux positif se corrige dans ce fichier, par une revue design.
 */

export type StyleRule =
  | 'hex-color'
  | 'color-function'
  | 'named-color'
  | 'font-family'
  | 'font-size'
  | 'font-weight'
  | 'spacing'
  | 'radius'
  | 'shadow'
  | 'duration'
  | 'local-variable';

export type SourceKind = 'css' | 'ts' | 'markup';

export interface StyleFinding {
  readonly line: number;
  readonly column: number;
  readonly rule: StyleRule;
  readonly text: string;
  readonly message: string;
}

const MESSAGES: Record<StyleRule, string> = {
  'hex-color': 'couleur hexadécimale codée en dur : utiliser un jeton var(--color-…)',
  'color-function':
    'couleur codée en dur (rgb, hsl, oklch, dégradé…) : utiliser un jeton var(--color-…)',
  'named-color': 'couleur nommée ou système codée en dur : utiliser un jeton var(--color-…)',
  'font-family':
    'police codée en dur : utiliser var(--font-family-…) ou var(--font-display-family)',
  'font-size': 'taille de texte codée en dur : utiliser var(--font-size-…)',
  'font-weight': 'graisse codée en dur : utiliser var(--font-weight-…)',
  spacing: 'espacement codé en dur : utiliser var(--space-…)',
  radius: 'rayon codé en dur : utiliser var(--radius-…)',
  shadow: 'ombre ou effet codé en dur : utiliser var(--shadow-…) ou var(--glass-…)',
  duration: 'durée codée en dur : utiliser var(--motion-duration-…)',
  'local-variable':
    "variable locale à valeur codée en dur : une variable de composant ne peut qu'aliaser des jetons",
};

/** Couleurs nommées CSS et couleurs système (CSS Color 4). */
const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown ' +
    'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan ' +
    'darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid ' +
    'darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
    'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ' +
    'ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow ' +
    'lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine ' +
    'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen ' +
    'mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace ' +
    'olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred ' +
    'papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue ' +
    'saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey ' +
    'snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
    'yellowgreen accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas ' +
    'canvastext field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem ' +
    'selecteditemtext visitedtext'
  ).split(' '),
);

const SAFE_KEYWORDS = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'currentcolor',
  'transparent',
  'none',
  'auto',
  '0',
]);

/** Mots neutres admis dans une variable locale, en plus des `var()` et des nombres sans unité. */
const LOCAL_VARIABLE_WORDS = new Set([
  ...SAFE_KEYWORDS,
  'calc',
  'min',
  'max',
  'clamp',
  'color-mix',
  'in',
  'srgb',
  'srgb-linear',
  'oklab',
  'display-p3',
]);

/** Propriétés dont la valeur est un identifiant (aucune couleur possible). */
const IDENTIFIER_PROPS =
  /^(animation-name|transition-property|grid-area|grid-template-areas|grid-row(-start|-end)?|grid-column(-start|-end)?|content|counter-(reset|increment|set)|will-change|list-style-type|container(-name)?|view-transition-name|font-feature-settings|font-variation-settings|quotes|page|anchor-name|position-anchor)$/;

/** Propriétés de style reconnues dans du TS (pour ne pas juger `{ title: 'Rojo' }`). */
const STYLE_PROPS =
  /^(color|background(-.*)?|border(-.*)?|outline(-.*)?|fill(-.*)?|stroke(-.*)?|stop-color|flood-color|lighting-color|caret-color|accent-color|scrollbar-color|text-decoration(-.*)?|text-emphasis(-.*)?|text-shadow|box-shadow|column-rule(-.*)?|-webkit-.*|-moz-.*|filter|backdrop-filter|mask(-.*)?|font(-.*)?|margin(-.*)?|padding(-.*)?|gap|row-gap|column-gap|inset(-.*)?|transition(-.*)?|animation(-.*)?)$/;

const SPACING_PROPS =
  /^((margin|padding|scroll-margin|scroll-padding)(-(top|right|bottom|left|block|inline)(-(start|end))?)?|(row-|column-)?gap|grid-(row-|column-)?gap|inset(-(block|inline)(-(start|end))?)?)$/;
const RADIUS_PROPS = /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/;
const SHADOW_PROPS = /^(box-shadow|text-shadow|-webkit-box-shadow)$/;
const FILTER_PROPS = /^(-webkit-)?(filter|backdrop-filter)$/;
const DURATION_PROPS = /^(-webkit-)?(transition|animation)(-(duration|delay))?$/;

const UNITS =
  'px|r?em|ex|r?ch|r?lh|cap|ic|vh|vw|vi|vb|vmin|vmax|[sdl]v(h|w|i|b|min|max)|cq(w|h|i|b|min|max)|cm|mm|q|in|pt|pc|%';
const LENGTH = new RegExp(`(?<![\\w#.-])[-+]?(\\d+\\.?\\d*|\\.\\d+)(${UNITS})(?![\\w-])`, 'i');
const TIME = /(?<![\w#.-])(\d+\.?\d*|\.\d+)m?s(?![\w-])/i;
const HEX = /(?<![\w&/.-])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w-])/g;
const COLOR_FN =
  /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|(repeating-)?(linear|radial|conic)-gradient|light-dark)\(/gi;

const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/**
 * Retire les `var(--x)` sans repli ; un `var(--x, repli)` est remplacé par son repli, qui est
 * donc jugé comme une valeur écrite en dur.
 */
export function unwrapVars(value: string): string {
  let v = value;
  let prev = '';
  while (prev !== v) {
    prev = v;
    v = v.replace(/var\(\s*--[\w-]+\s*\)/gi, ' ').replace(/var\(\s*--[\w-]+\s*,/gi, '(');
  }
  return v;
}

/** Règles enfreintes par une déclaration `prop: valeur`. */
export function judgeDeclaration(rawProp: string, rawValue: string): StyleRule[] {
  const prop = rawProp.trim().toLowerCase();
  const value = unwrapVars(rawValue)
    .replace(/!important/gi, ' ')
    .trim()
    .toLowerCase();
  if (value === '' || SAFE_KEYWORDS.has(value)) return [];

  if (prop.startsWith('--')) {
    const rest = value
      .split(/[\s,()*/+]+/)
      .filter((w) => w !== '' && !LOCAL_VARIABLE_WORDS.has(w) && !/^-?(\d+\.?\d*|\.\d+)$/.test(w));
    return rest.length > 0 ? ['local-variable'] : [];
  }

  const out: StyleRule[] = [];
  const bareNumber = /^-?\d+(\.\d+)?$/.test(value);
  const words = value.split(/[\s,()/]+/);
  if (!IDENTIFIER_PROPS.test(prop) && words.some((w) => NAMED_COLORS.has(w)))
    out.push('named-color');

  if (prop === 'font') out.push('font-family');
  if (prop === 'font-family' && /[a-z]/.test(value)) out.push('font-family');
  if (
    prop === 'font-size' &&
    (bareNumber ||
      LENGTH.test(value) ||
      /\b(xx?-small|small|medium|large|xx?-large|xxx-large|larger|smaller)\b/.test(value))
  )
    out.push('font-size');
  if (
    prop === 'font-weight' &&
    (bareNumber || /\b\d{3}\b|\b(bold|bolder|lighter|normal)\b/.test(value))
  )
    out.push('font-weight');
  if (SPACING_PROPS.test(prop) && (bareNumber || LENGTH.test(value))) out.push('spacing');
  if (RADIUS_PROPS.test(prop) && value !== '50%' && (bareNumber || LENGTH.test(value)))
    out.push('radius');
  if (SHADOW_PROPS.test(prop) && /\d/.test(value)) out.push('shadow');
  if (FILTER_PROPS.test(prop) && (LENGTH.test(value) || /drop-shadow|\d/.test(value)))
    out.push('shadow');
  if (DURATION_PROPS.test(prop) && (TIME.test(value) || (bareNumber && prop.endsWith('duration'))))
    out.push('duration');
  return out;
}

function position(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  return { line: before.split('\n').length, column: index - before.lastIndexOf('\n') };
}

/** Retire les commentaires en gardant les positions (remplacés par des espaces). */
function stripComments(text: string, kind: SourceKind): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ');
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (kind === 'markup') out = out.replace(/<!--[\s\S]*?-->/g, blank);
  if (kind === 'ts')
    out = out.replace(/(^|[^:\\'"`])\/\/[^\n]*/g, (m, p: string) => p + blank(m.slice(p.length)));
  return out;
}

interface Decl {
  readonly prop: string;
  readonly value: string;
  readonly index: number;
}

/** Déclarations CSS d'un fragment (feuille, bloc `<style>`, attribut `style`, chaîne). */
function* cssDeclarations(text: string, offset: number): Generator<Decl> {
  const re = /(?<![\w-])(--[\w-]+|-?[a-z][a-z-]*)\s*:\s*([^;{}]+)/gi;
  for (const m of text.matchAll(re)) {
    const after = text.slice((m.index ?? 0) + m[0].length).trimStart();
    // `a:hover {` ou `@media (max-width: 400px) {` : sélecteur ou condition, pas une déclaration.
    if (after.startsWith('{')) continue;
    yield { prop: m[1] as string, value: m[2] as string, index: offset + (m.index ?? 0) };
  }
}

/** Clés d'objet de style (nues, entre guillemets) suivies d'une chaîne, d'un gabarit ou d'un nombre. */
function* objectDeclarations(text: string): Generator<Decl> {
  const re =
    /(?:(?<![\w$.])([A-Za-z_$][\w$]*)|(['"])(-{0,2}[A-Za-z][\w-]*)\2)\s*:\s*(?:(['"`])((?:(?!\4)[^\\]|\\.)*)\4|(-?\d+(?:\.\d+)?)(?![\w.]))/g;
  for (const m of text.matchAll(re)) {
    const prop = m[1] !== undefined ? kebab(m[1]) : (m[3] as string);
    yield { prop, value: (m[5] ?? m[6]) as string, index: m.index ?? 0 };
  }
}

/** Attributs HTML / JSX : `style="…"` (CSS) et attributs de couleur (`fill`, `stroke`…). */
function* attributeDeclarations(text: string): Generator<Decl> {
  for (const m of text.matchAll(/\bstyle\s*=\s*\{?\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
    const start = (m.index ?? 0) + m[0].indexOf(m[2] as string);
    yield* cssDeclarations(m[2] as string, start);
  }
  const colorAttr =
    /\b(fill|stroke|color|stop-?color|stopColor|flood-?color|floodColor|lighting-?color|lightingColor|bgcolor)\s*=\s*\{?\s*(['"`])((?:(?!\2)[^\\]|\\.)*)\2/g;
  for (const m of text.matchAll(colorAttr)) {
    yield { prop: 'color', value: m[3] as string, index: m.index ?? 0 };
  }
}

/** Contenu des chaînes et gabarits d'un fichier TS : du CSS peut y être écrit. */
function* stringContents(text: string): Generator<{ body: string; offset: number }> {
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const m of text.matchAll(re)) {
    yield { body: (m[1] ?? m[2] ?? m[3]) as string, offset: (m.index ?? 0) + 1 };
  }
}

/** Constats d'un fichier source. */
export function scanStyleSource(source: string, kind: SourceKind): StyleFinding[] {
  const text = stripComments(source, kind);
  const found = new Map<string, StyleFinding>();
  const push = (rule: StyleRule, index: number, snippet: string): void => {
    const pos = position(text, index);
    const key = `${pos.line}:${rule}`;
    if (!found.has(key))
      found.set(key, {
        ...pos,
        rule,
        text: snippet.replace(/\s+/g, ' ').trim().slice(0, 80),
        message: MESSAGES[rule],
      });
  };
  const judge = (d: Decl, onlyStyleProps: boolean): void => {
    const prop = d.prop.toLowerCase();
    if (onlyStyleProps && !prop.startsWith('--') && !STYLE_PROPS.test(prop)) return;
    for (const rule of judgeDeclaration(prop, d.value))
      push(rule, d.index, `${d.prop}: ${d.value}`);
  };

  for (const m of text.matchAll(HEX)) {
    const start = m.index ?? 0;
    const head = text.slice(text.lastIndexOf('\n', start) + 1, start);
    const tail = text.slice(start + m[0].length);
    // Ancres et sélecteurs d'identifiant (`href="#add"`, `#app {`) ne sont pas des couleurs.
    if (/(href|id|to|hash|for|xlink:href)\s*=\s*\{?\s*['"`]$/.test(head)) continue;
    if (kind === 'css' && /^[^;{}]*\{/.test(tail)) continue;
    push('hex-color', start, m[0]);
  }
  for (const m of text.matchAll(COLOR_FN)) push('color-function', m.index ?? 0, m[0]);

  if (kind === 'css') {
    for (const d of cssDeclarations(text, 0)) judge(d, false);
    return [...found.values()].sort((a, b) => a.line - b.line || a.column - b.column);
  }
  for (const d of attributeDeclarations(text)) judge(d, false);
  if (kind === 'markup') {
    for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      const start = (m.index ?? 0) + m[0].indexOf('>') + 1;
      for (const d of cssDeclarations(m[1] as string, start)) judge(d, false);
    }
  } else {
    for (const d of objectDeclarations(text)) judge(d, true);
    for (const s of stringContents(text)) {
      for (const d of cssDeclarations(s.body, s.offset)) judge(d, true);
    }
  }
  return [...found.values()].sort((a, b) => a.line - b.line || a.column - b.column);
}
