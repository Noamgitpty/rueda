/**
 * Contrôles d'une version de marque et d'un bloc de contenu, AVANT tout appel à la base (US-034).
 *
 * - Jetons : `buildTheme` et `checkContrast` de `@rueda/design-tokens` — EXACTEMENT le contrôle
 *   d'US-030 (mêmes paires `CONTRAST_RULES`, même verre au pire cas), réutilisé et non recopié.
 *   Une paire en échec refuse la publication et est nommée (`BRAND_CONTRAST_INSUFFICIENT`).
 * - Polices : toute famille nommée doit figurer dans la liste approuvée (`FONT_NOT_APPROVED`).
 * - Contenu : clé hors `legal.*`, trois langues (es, en, fr) non vides, Markdown restreint (aucune
 *   balise, liens internes seulement) — mêmes règles que la base (0042), avec un message précis.
 *   US-121 (ADR-095) : la clé doit figurer au registre des blocs éditables de `@rueda/i18n`
 *   (`CONTENT_KEY_NOT_EDITABLE` sinon) ; un texte juridique (motif `LEGAL_BLOCK_KEY`, recopié par
 *   la base en 0060) est refusé (`CONTENT_KEY_FORBIDDEN`) ; chaque corps passe la liste blanche
 *   du format du bloc (`richTextProblem` : `plain` sur une ligne, `rich` bornée).
 */
import {
  buildTheme,
  checkContrast,
  themeFontFamilies,
  ThemeFormatError,
  TOKENS_SCHEMA_VERSION,
} from '@rueda/design-tokens';
import type { ContrastFailure, Theme } from '@rueda/design-tokens';
import { BLOCK_KEY_PATTERN, editableBlock, isLegalBlockKey, richTextProblem } from '@rueda/i18n';
import type { EditableBlock, EditableBlocks } from '@rueda/i18n';
import { BrandError } from './errors.js';
import type { BrandParams } from './params.js';

/** Identifiant du contrôle consigné dans `brand_version.contrast_check.checker`. */
export const CONTRAST_CHECKER = '@rueda/design-tokens checkContrast (US-030, WCAG 2.2 AA)';

export interface ContrastReport {
  readonly checker: string;
  readonly tokensSchemaVersion: number;
  /**
   * Empreinte SHA-256 (hex) des jetons de la version contrôlée, telle que la base la calcule
   * (`core.cfg_brand_tokens_sha256`) : la commande refuse un rapport d'une autre version.
   */
  readonly tokensSha256: string;
  readonly passed: boolean;
  readonly failures: readonly ContrastFailure[];
}

/** Thème validé (format) ou `BRAND_TOKENS_INVALID` avec la liste des défauts. */
export function themeOf(tokens: unknown): Theme {
  try {
    return buildTheme(tokens);
  } catch (error) {
    if (error instanceof ThemeFormatError) {
      throw new BrandError('BRAND_TOKENS_INVALID', { problems: [...error.problems] });
    }
    throw error;
  }
}

/** Polices nommées hors de la liste approuvée (vide = conforme). */
export function unapprovedFonts(theme: Theme, params: BrandParams): string[] {
  const approved = new Set(params.approvedFonts.map((f) => f.family));
  return themeFontFamilies(theme).filter((f) => !approved.has(f));
}

export function assertFontsApproved(theme: Theme, params: BrandParams): void {
  const fonts = unapprovedFonts(theme, params);
  if (fonts.length > 0) throw new BrandError('FONT_NOT_APPROVED', { fonts });
}

/** Rapport de contraste du contrôle d'US-030 (passé = aucune paire en échec). */
export function contrastReport(theme: Theme, tokensSha256: string): ContrastReport {
  const failures = checkContrast(theme);
  return {
    checker: CONTRAST_CHECKER,
    tokensSchemaVersion: TOKENS_SCHEMA_VERSION,
    tokensSha256,
    passed: failures.length === 0,
    failures,
  };
}

/** Paires en échec, lisibles : « [light] text-muted / surface 2.8:1 < 4.5:1 ». */
export function describeFailures(failures: readonly ContrastFailure[]): string[] {
  return failures.map((f) => `[${f.mode}] ${f.pair} ${f.ratio}:1 < ${f.min}:1`);
}

// ---- Marque : nom ----------------------------------------------------------------------------
const BRAND_NAME = /^[^\p{Cc}<>{}]{1,60}$/u;

export function assertBrandName(name: unknown): string {
  if (typeof name !== 'string' || !BRAND_NAME.test(name.trim()) || name.trim().length === 0) {
    throw new BrandError('REQUEST_INVALID');
  }
  return name.trim();
}

// ---- Contenus ---------------------------------------------------------------------------------
/**
 * Langues d'un bloc : toujours les quatre (US-060 ; DEC-FONDATEUR-17 et 18 : es, en, fr, pt-BR).
 * Même liste que `CATALOG_LANGUAGES` de `@rueda/i18n` (test de parité) et que les CHECK de la
 * base (migration 0044).
 */
export const CONTENT_LOCALES = ['es', 'en', 'fr', 'pt'] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

const BODY_MAX = 20_000;

/** Règles du Markdown restreint (mêmes que `core.cfg_brand_body_allowed`, 0042). */
const BODY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/<[A-Za-z!/?]/, 'balise HTML'],
  [/[a-z][a-z0-9+.-]*:[/\\]/i, 'URL absolue'],
  [/(^|[^a-z0-9])www\./i, 'URL nue'],
  [/\]\(\s*(\/\/|[^/#\s)])/, 'lien hors du site'],
  [/\]\s*\[[^\]]*\]/, 'lien par référence'],
  [/(^|\n)\s*\[[^\]]+\]:/, 'définition de lien'],
];

/** Format de la clé (même motif que la base) ; `REQUEST_INVALID` sinon. */
function assertKeyFormat(key: unknown): string {
  if (typeof key !== 'string' || key.length > 120 || !BLOCK_KEY_PATTERN.test(key)) {
    throw new BrandError('REQUEST_INVALID');
  }
  return key;
}

/**
 * Clé d'une publication ou d'un retour arrière : format, puis texte juridique refusé
 * (`CONTENT_KEY_FORBIDDEN` ; 17 §3.2.13 : les textes juridiques sont des `document_template`).
 */
export function assertBlockKey(key: unknown): string {
  const k = assertKeyFormat(key);
  if (isLegalBlockKey(k)) throw new BrandError('CONTENT_KEY_FORBIDDEN', { key: k });
  return k;
}

export type BlockKeyClass =
  | { readonly kind: 'legal'; readonly key: string }
  | { readonly kind: 'unknown'; readonly key: string }
  | { readonly kind: 'editable'; readonly key: string; readonly block: EditableBlock };

/**
 * Clé d'un brouillon (US-121) : texte juridique (refus journalisé par la base), clé hors du
 * registre (refus `CONTENT_KEY_NOT_EDITABLE`) ou bloc éditable avec son format.
 */
export function classifyBlockKey(key: unknown, registry: EditableBlocks): BlockKeyClass {
  const k = assertKeyFormat(key);
  if (isLegalBlockKey(k)) return { kind: 'legal', key: k };
  const block = editableBlock(k, registry);
  return block === undefined ? { kind: 'unknown', key: k } : { kind: 'editable', key: k, block };
}

/** Problème du corps, ou `null` s'il respecte les règles (base, puis format du bloc). */
export function bodyProblem(body: string, block?: EditableBlock): string | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 'vide';
  if ([...trimmed].length > BODY_MAX) return 'trop long';
  for (const [rule, label] of BODY_RULES) if (rule.test(body)) return label;
  return block === undefined ? null : richTextProblem(body, block.format, block.maxLength);
}

/** Quatre langues présentes et conformes ; rend les corps dans l'ordre es, en, fr, pt. */
export function assertBodies(raw: unknown, block?: EditableBlock): Record<ContentLocale, string> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BrandError('REQUEST_INVALID');
  }
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => !(CONTENT_LOCALES as readonly string[]).includes(k))) {
    throw new BrandError('REQUEST_INVALID');
  }
  const missing = CONTENT_LOCALES.filter(
    (l) => typeof r[l] !== 'string' || (r[l] as string).trim().length === 0,
  );
  if (missing.length > 0) {
    throw new BrandError('CONTENT_BLOCK_REQUIRED_MISSING', { locales: missing });
  }
  const problems = CONTENT_LOCALES.flatMap((l) => {
    const p = bodyProblem(r[l] as string, block);
    return p === null ? [] : [`${l} : ${p}`];
  });
  if (problems.length > 0) throw new BrandError('CONTENT_MARKDOWN_FORBIDDEN', { problems });
  return {
    es: r['es'] as string,
    en: r['en'] as string,
    fr: r['fr'] as string,
    pt: r['pt'] as string,
  };
}
