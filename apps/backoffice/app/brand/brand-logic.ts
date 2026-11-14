/**
 * Écran « Apparence / Marque » (US-120, écran O02 de 10b) : logique pure, sans réseau ni état.
 *
 * - Un brouillon = un document de jetons DTCG complet (format des palettes US-028) : un point de
 *   départ (palette du registre ou version existante) plus les retouches du fondateur (nom,
 *   couleurs, polices, logo). Le document est validé ici par les contrôles d'US-030 eux-mêmes
 *   (`buildTheme`, `checkContrast`, réutilisés, jamais recopiés) pour l'aperçu et l'alerte
 *   avant publication ; l'API refait chaque contrôle et reste seule juge.
 * - Contenus (US-121, BOARD N-46) : le motif d'un refus est expliqué au fondateur dans sa langue
 *   (mot déclencheur d'un texte juridique, caractère ZWJ des émojis composés).
 */
import {
  buildTheme,
  checkContrast,
  logoProblems,
  PALETTE_IDS,
  paletteDocument,
  ThemeFormatError,
} from '@rueda/design-tokens';
import type { ContrastFailure, Mode, SemanticColor, Theme } from '@rueda/design-tokens';
import { codePoints, LEGAL_BLOCK_KEY, richTextProblem } from '@rueda/i18n';
import type { EditableBlock } from '@rueda/i18n';

/** Attribut qui porte l'aperçu (`previewStyleSheet`) : aucune variable n'est posée sur `:root`. */
export const PREVIEW_ATTRIBUTE = 'data-brand-preview';

/** Couleurs retouchables dans la Bêta (SIMPLIFIÉ) ; les autres viennent du point de départ. */
export const EDITABLE_COLORS = [
  'primary',
  'on-primary',
  'accent',
  'on-accent',
  'surface',
  'surface-raised',
  'text',
  'text-muted',
] as const satisfies readonly SemanticColor[];
export type EditableColor = (typeof EDITABLE_COLORS)[number];

/** Couleur saisie : `#RRGGBB` seulement (forme que `buildTheme` accepte sans ambiguïté). */
export const COLOR_INPUT = /^#[0-9A-Fa-f]{6}$/;

export type FontSlot = 'heading' | 'body';
export type LogoSlot = 'logo' | 'logoDark';

export type DraftBase =
  | { readonly kind: 'palette'; readonly id: string }
  | { readonly kind: 'version'; readonly id: string };

export interface DraftEdits {
  readonly base: DraftBase;
  readonly brandName: string;
  /** Valeurs saisies (même invalides : le champ les montre et signale l'erreur). */
  readonly colors: Readonly<Record<Mode, Readonly<Partial<Record<EditableColor, string>>>>>;
  readonly fonts: Readonly<Partial<Record<FontSlot, string>>>;
  readonly logos: Readonly<Partial<Record<LogoSlot, string>>>;
  /** Actifs déjà analysés et enregistrés (POST /console/brand/assets). */
  readonly logoAssetId?: string | undefined;
  readonly faviconAssetId?: string | undefined;
  readonly pwaIconAssetId?: string | undefined;
}

/** Version telle que la console la reçoit (`GET /console/brand/versions`). */
export interface VersionView {
  readonly id: string;
  readonly versionNo: number;
  readonly status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  readonly brandName: string;
  readonly tokens: Record<string, unknown>;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Lit une réponse de `GET /console/brand/versions` ; formes inattendues écartées. */
export function versionsOf(body: unknown): VersionView[] | null {
  const list = isObject(body) ? body['versions'] : undefined;
  if (!Array.isArray(list)) return null;
  return list.flatMap((v: unknown) => {
    if (
      !isObject(v) ||
      typeof v['id'] !== 'string' ||
      !Number.isSafeInteger(v['versionNo']) ||
      !['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(v['status'] as string) ||
      typeof v['brandName'] !== 'string' ||
      !isObject(v['tokens']) ||
      typeof v['createdAt'] !== 'string' ||
      (v['publishedAt'] !== null && typeof v['publishedAt'] !== 'string')
    ) {
      return [];
    }
    return [
      {
        id: v['id'],
        versionNo: v['versionNo'] as number,
        status: v['status'] as VersionView['status'],
        brandName: v['brandName'],
        tokens: v['tokens'],
        createdAt: v['createdAt'],
        publishedAt: v['publishedAt'] as string | null,
      },
    ];
  });
}

/** Nom de marque inscrit dans le groupe `brand` d'un document, s'il existe. */
function brandNameOf(doc: Record<string, unknown>): string | undefined {
  const brand = doc['brand'];
  const name = isObject(brand) ? brand['name'] : undefined;
  const value = isObject(name) ? name['$value'] : undefined;
  return typeof value === 'string' ? value : undefined;
}

/** Document du point de départ (copie profonde), ou `undefined` si la version est absente. */
export function baseDocument(
  base: DraftBase,
  versions: readonly VersionView[],
): Record<string, unknown> | undefined {
  if (base.kind === 'palette') {
    return PALETTE_IDS.includes(base.id) ? paletteDocument(base.id) : undefined;
  }
  const v = versions.find((x) => x.id === base.id);
  return v === undefined ? undefined : structuredClone(v.tokens);
}

/** Brouillon de départ : version publiée si elle existe, sinon la palette par défaut. */
export function initialDraft(versions: readonly VersionView[], defaultPalette: string): DraftEdits {
  const published = versions.find((v) => v.status === 'PUBLISHED');
  const base: DraftBase =
    published !== undefined
      ? { kind: 'version', id: published.id }
      : { kind: 'palette', id: defaultPalette };
  const doc = baseDocument(base, versions) ?? {};
  return {
    base,
    brandName: published?.brandName ?? brandNameOf(doc) ?? '',
    colors: { light: {}, dark: {} },
    fonts: {},
    logos: {},
  };
}

function setToken(doc: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node = doc;
  for (const part of path.slice(0, -1)) {
    const next = node[part];
    if (!isObject(next)) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  const leaf = path[path.length - 1] as string;
  const current = node[leaf];
  node[leaf] = { ...(isObject(current) ? current : {}), $value: value };
}

/** Pile de polices de la première palette qui nomme cette famille en premier. */
function fontStack(family: string): unknown[] | undefined {
  for (const id of PALETTE_IDS) {
    const doc = paletteDocument(id) as { font?: { family?: Record<string, { $value?: unknown }> } };
    for (const slot of ['heading', 'body'] as const) {
      const stack = doc.font?.family?.[slot]?.$value;
      if (Array.isArray(stack) && stack[0] === family) return stack;
    }
  }
  return undefined;
}

/**
 * Polices proposées : familles nommées des palettes US-028 (au départ, la liste approuvée de
 * l'API est exactement celle-ci, US-034) ; l'API refuse toute autre (`FONT_NOT_APPROVED`).
 */
export function fontChoices(): string[] {
  const names = new Set<string>();
  for (const id of PALETTE_IDS) {
    const doc = paletteDocument(id) as { font?: { family?: Record<string, { $value?: unknown }> } };
    for (const slot of ['heading', 'body'] as const) {
      const first = doc.font?.family?.[slot]?.$value;
      if (Array.isArray(first) && typeof first[0] === 'string') names.add(first[0]);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Document de jetons du brouillon : point de départ + retouches valides. */
export function draftTokens(
  edits: DraftEdits,
  versions: readonly VersionView[],
): Record<string, unknown> | undefined {
  const doc = baseDocument(edits.base, versions);
  if (doc === undefined) return undefined;
  if (edits.brandName.trim() !== '') setToken(doc, ['brand', 'name'], edits.brandName.trim());
  for (const mode of ['light', 'dark'] as const) {
    for (const [name, value] of Object.entries(edits.colors[mode])) {
      if (value !== undefined && COLOR_INPUT.test(value)) {
        setToken(doc, ['color', mode, name], value.toUpperCase());
      }
    }
  }
  for (const [slot, family] of Object.entries(edits.fonts)) {
    const stack = family === undefined ? undefined : fontStack(family);
    if (stack !== undefined) setToken(doc, ['font', 'family', slot], stack);
  }
  for (const [slot, svg] of Object.entries(edits.logos)) {
    if (svg !== undefined) setToken(doc, ['brand', slot], svg);
  }
  return doc;
}

export interface DraftCheck {
  /** Thème compilé (aperçu), absent si le format est invalide. */
  readonly theme?: Theme | undefined;
  readonly formatProblems: readonly string[];
  /** Paires sous WCAG 2.2 AA (contrôle d'US-030) : la publication sera refusée. */
  readonly failures: readonly ContrastFailure[];
  readonly logoInvalid: boolean;
  /** Couleurs saisies hors du format `#RRGGBB` (champ en erreur). */
  readonly invalidColors: readonly `${Mode}:${EditableColor}`[];
}

/** Contrôles du brouillon, pour l'aperçu et l'alerte avant publication. */
export function checkDraft(
  edits: DraftEdits,
  tokens: Record<string, unknown> | undefined,
): DraftCheck {
  const invalidColors = (['light', 'dark'] as const).flatMap((mode) =>
    EDITABLE_COLORS.filter((c) => {
      const v = edits.colors[mode][c];
      return v !== undefined && v !== '' && !COLOR_INPUT.test(v);
    }).map((c) => `${mode}:${c}` as const),
  );
  if (tokens === undefined) {
    return { formatProblems: ['base'], failures: [], logoInvalid: false, invalidColors };
  }
  const logoInvalid = logoProblems(tokens).length > 0;
  try {
    const theme = buildTheme(tokens);
    return {
      theme,
      formatProblems: [],
      failures: checkContrast(theme),
      logoInvalid,
      invalidColors,
    };
  } catch (error) {
    const problems = error instanceof ThemeFormatError ? [...error.problems] : ['format'];
    return { formatProblems: problems, failures: [], logoInvalid, invalidColors };
  }
}

/** Valeur affichée d'une couleur : saisie, sinon valeur compilée du thème. */
export function colorValue(
  edits: DraftEdits,
  theme: Theme | undefined,
  mode: Mode,
  color: EditableColor,
): string {
  return edits.colors[mode][color] ?? theme?.colors[mode][color] ?? '';
}

/** Logo à montrer en image (`data:`), jamais injecté ; `undefined` s'il est absent ou refusé. */
export function logoDataUri(
  tokens: Record<string, unknown> | undefined,
  slot: LogoSlot,
): string | undefined {
  const brand = tokens?.['brand'];
  const token = isObject(brand) ? brand[slot] : undefined;
  const svg = isObject(token) ? token['$value'] : undefined;
  if (typeof svg !== 'string' || logoProblems({ brand: { logo: { $value: svg } } }).length > 0) {
    return undefined;
  }
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Paire de contraste en échec, telle que l'API la rend (`details.failures`) ou le contrôle local. */
export interface FailureView {
  readonly mode: string;
  readonly pair: string;
  readonly ratio: number;
  readonly min: number;
}

/** Paires d'un refus `BRAND_CONTRAST_INSUFFICIENT` (`details.failures`), formes inattendues écartées. */
export function failuresOf(details: unknown): FailureView[] {
  const list = isObject(details) ? details['failures'] : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((f: unknown) =>
    isObject(f) &&
    typeof f['mode'] === 'string' &&
    typeof f['pair'] === 'string' &&
    typeof f['ratio'] === 'number' &&
    typeof f['min'] === 'number'
      ? [{ mode: f['mode'], pair: f['pair'], ratio: f['ratio'], min: f['min'] }]
      : [],
  );
}

// ---- Images de marque ------------------------------------------------------------------------

export const ASSET_KINDS = ['LOGO', 'FAVICON', 'PWA_ICON', 'HERO_IMAGE'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Même borne que `assetMaxBytes` de l'API (`data/brand.json`, US-034) ; l'API reste juge. */
export const ASSET_MAX_BYTES = 65_536;

/** Type réel lu dans les octets (PNG, JPEG, WebP) ; `null` sinon (SVG compris : refusé). */
export function sniffImage(b: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const ascii = (from: number, to: number): string => String.fromCharCode(...b.subarray(from, to));
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && png.every((x, i) => b[i] === x)) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export type AssetPrecheck = 'ok' | 'empty' | 'tooBig' | 'badType';

/** Contrôle avant l'envoi (confort) : taille puis type réel ; l'API refait tout, antivirus compris. */
export function precheckAsset(bytes: Uint8Array): AssetPrecheck {
  if (bytes.length === 0) return 'empty';
  if (bytes.length > ASSET_MAX_BYTES) return 'tooBig';
  return sniffImage(bytes) === null ? 'badType' : 'ok';
}

// ---- Contenus (US-121, N-46) -----------------------------------------------------------------

/**
 * Mot qui fait d'une clé un texte juridique (motif `LEGAL_BLOCK_KEY`, le même qu'à l'API et en
 * base) : cité au fondateur pour qu'il comprenne le refus et renomme la clé. `null` sinon.
 */
export function legalTrigger(key: string): string | null {
  const m = LEGAL_BLOCK_KEY.exec(key);
  if (m === null) return null;
  return m[0].replace(/^[._]+|[._]+$/g, '');
}

/** U+200D (ZWJ) : refusé même entre deux émojis (US-121, ADR-095). */
export const ZWJ = '‍';

export type BodyIssue = 'zwj' | 'blank' | 'tooLong' | 'format';

const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

/**
 * Motif d'un corps refusé par la liste blanche du bloc (`richTextProblem`, le contrôle de l'API),
 * classé pour être expliqué dans la langue du fondateur. `null` = accepté.
 */
export function bodyIssue(body: string, block: EditableBlock): BodyIssue | null {
  if (richTextProblem(body, block.format, block.maxLength) === null) return null;
  if (body.includes(ZWJ)) return 'zwj';
  if (!VISIBLE.test(body)) return 'blank';
  if (codePoints(body) > block.maxLength) return 'tooLong';
  return 'format';
}
