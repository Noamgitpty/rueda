/**
 * Lint des styles codés en dur (US-030, 19 §1.2 point 7, 10b UX-67) : dans un composant, toute
 * couleur, police, taille de texte, graisse, espacement, rayon, ombre ou durée doit venir d'un
 * jeton (`var(--…)`). Analyse par motifs, sans dépendance : CSS (et modules CSS), TS et TSX.
 *
 * Valeurs toujours permises : `var(...)`, `calc()` / `color-mix()` ne combinant que des variables,
 * `0`, `auto`, `none`, `inherit`, `initial`, `unset`, `currentColor`, `transparent`, et `50%` pour
 * un rayon (cercle). Il n'y a pas de liste blanche : un faux positif se corrige dans ce fichier,
 * par une revue design.
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

export interface StyleFinding {
  readonly line: number;
  readonly column: number;
  readonly rule: StyleRule;
  readonly text: string;
  readonly message: string;
}

const MESSAGES: Record<StyleRule, string> = {
  'hex-color': 'couleur hexadécimale codée en dur : utiliser un jeton var(--color-…)',
  'color-function': 'couleur codée en dur (rgb, hsl, oklch…) : utiliser un jeton var(--color-…)',
  'named-color': 'couleur nommée ou système codée en dur : utiliser un jeton var(--color-…)',
  'font-family':
    'police codée en dur : utiliser var(--font-family-…) ou var(--font-display-family)',
  'font-size': 'taille de texte codée en dur : utiliser var(--font-size-…)',
  'font-weight': 'graisse codée en dur : utiliser var(--font-weight-…)',
  spacing: 'espacement codé en dur : utiliser var(--space-…)',
  radius: 'rayon codé en dur : utiliser var(--radius-…)',
  shadow: 'ombre codée en dur : utiliser var(--shadow-…)',
  duration: 'durée codée en dur : utiliser var(--motion-duration-…)',
  'local-variable':
    "variable locale à valeur codée en dur : une variable de composant ne peut qu'aliaser un jeton",
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
  'currentcolor',
  'transparent',
  'none',
  'auto',
  '0',
]);

/** Propriétés (CSS en kebab, styles React en camel) et règle appliquée à leur valeur. */
const PROPERTY_RULES: readonly { readonly re: RegExp; readonly rule: StyleRule }[] = [
  {
    re: /^(color|background|background-color|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|fill|stroke|caret-color|accent-color|text-decoration-color|column-rule-color)$/,
    rule: 'named-color',
  },
  { re: /^font-family$/, rule: 'font-family' },
  { re: /^font-size$/, rule: 'font-size' },
  { re: /^font-weight$/, rule: 'font-weight' },
  {
    re: /^(margin|padding)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$|^(row-|column-)?gap$|^inset(-(block|inline)(-(start|end))?)?$/,
    rule: 'spacing',
  },
  { re: /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/, rule: 'radius' },
  { re: /^(box|text)-shadow$/, rule: 'shadow' },
  { re: /^(transition|animation)(-(duration|delay))?$/, rule: 'duration' },
];

const kebab = (s: string): string => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

const HEX = /(?<![\w&/.-])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w-])/g;
const COLOR_FN = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g;
const LENGTH = /(?<![\w-])-?\d*\.?\d+(px|rem|em|ex|ch|vh|vw|vmin|vmax|pt)\b/;
const TIME = /(?<![\w-])\d*\.?\d+m?s\b/;

/** Retire les commentaires en gardant les positions (remplacés par des espaces). */
function stripComments(text: string, kind: 'css' | 'ts'): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ');
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (kind === 'ts')
    out = out.replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p: string) => p + blank(m.slice(p.length)));
  return out;
}

/** Retire `var(...)` (fallbacks compris) : seule la partie « en dur » de la valeur est jugée. */
const withoutVars = (value: string): string => {
  let v = value;
  let prev = '';
  while (prev !== v) {
    prev = v;
    v = v.replace(/var\([^()]*\)/g, ' ');
  }
  return v;
};

function judge(rule: StyleRule, rawValue: string): boolean {
  const value = withoutVars(rawValue).trim().toLowerCase();
  if (value === '' || SAFE_KEYWORDS.has(value)) return false;
  // Nombre nu d'un style React (`padding: 16`, `fontWeight: 600`) : React ajoute `px` au besoin.
  if (/^\d+(\.\d+)?$/.test(value)) return rule !== 'named-color' && rule !== 'font-family';
  switch (rule) {
    case 'named-color':
      return value.split(/[\s,()/]+/).some((word) => NAMED_COLORS.has(word));
    case 'font-family':
      return /[a-z]/.test(value.replace(/\b(calc|inherit|initial|unset)\b/g, ''));
    case 'font-size':
      return (
        LENGTH.test(value) ||
        /\b(xx?-small|small|medium|large|xx?-large|larger|smaller)\b|\d%/.test(value)
      );
    case 'font-weight':
      return /\b\d{3}\b|\b(bold|bolder|lighter|normal)\b/.test(value);
    case 'spacing':
      return LENGTH.test(value);
    case 'radius':
      return value !== '50%' && (LENGTH.test(value) || /\d%/.test(value));
    case 'shadow':
      return LENGTH.test(value) || /\d/.test(value);
    case 'duration':
      return TIME.test(value);
    case 'local-variable':
      return LENGTH.test(value) || TIME.test(value);
    default:
      return false;
  }
}

function position(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  return { line, column: index - before.lastIndexOf('\n') };
}

/**
 * Déclarations `propriété: valeur` : en CSS jusqu'au `;` ou `}` ; en TS / TSX, propriété de style
 * React (camelCase) suivie d'une chaîne ou d'un nombre.
 */
function* declarations(
  text: string,
  kind: 'css' | 'ts',
): Generator<{ prop: string; value: string; index: number }> {
  if (kind === 'css') {
    const re = /(?<![\w-])(--[a-z0-9-]+|-?[a-z][a-z-]*)\s*:\s*([^;{}]+)/gi;
    for (const m of text.matchAll(re)) {
      const after = text.slice((m.index ?? 0) + m[0].length).trimStart();
      // `a:hover {` est un sélecteur, pas une déclaration.
      if (after.startsWith('{')) continue;
      yield { prop: m[1] as string, value: m[2] as string, index: m.index ?? 0 };
    }
    return;
  }
  const re =
    /\b([a-zA-Z]+)\s*:\s*(['"`])((?:(?!\2)[^\\\n]|\\.)*)\2|\b([a-zA-Z]+)\s*:\s*(\d+(?:\.\d+)?)\b/g;
  for (const m of text.matchAll(re)) {
    const prop = (m[1] ?? m[4]) as string;
    const value = (m[3] ?? m[5]) as string;
    yield { prop: kebab(prop), value, index: m.index ?? 0 };
  }
}

/** Constats d'un fichier source. `kind` : `css` pour .css / .scss, `ts` pour .ts / .tsx. */
export function scanStyleSource(source: string, kind: 'css' | 'ts'): StyleFinding[] {
  const text = stripComments(source, kind);
  const findings: StyleFinding[] = [];
  const push = (rule: StyleRule, index: number, snippet: string): void => {
    findings.push({
      ...position(text, index),
      rule,
      text: snippet.trim().slice(0, 80),
      message: MESSAGES[rule],
    });
  };

  for (const m of text.matchAll(HEX)) {
    const start = m.index ?? 0;
    const head = text.slice(text.lastIndexOf('\n', start) + 1, start);
    const tail = text.slice(start + m[0].length);
    // Ancres et sélecteurs d'identifiant (`href="#add"`, `#app {`) ne sont pas des couleurs.
    if (/(href|id|to|hash)\s*=\s*\{?\s*['"`]$/.test(head)) continue;
    if (kind === 'css' && /^[^;{}]*\{/.test(tail)) continue;
    push('hex-color', start, m[0]);
  }
  for (const m of text.matchAll(COLOR_FN)) push('color-function', m.index ?? 0, m[0]);

  for (const d of declarations(text, kind)) {
    // Variable locale (`--x: …`) : elle ne peut qu'aliaser des jetons (sinon contournement).
    if (d.prop.startsWith('--')) {
      if (judge('local-variable', d.value))
        push('local-variable', d.index, `${d.prop}: ${d.value}`);
      continue;
    }
    for (const { re, rule } of PROPERTY_RULES) {
      if (re.test(d.prop) && judge(rule, d.value)) push(rule, d.index, `${d.prop}: ${d.value}`);
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}
