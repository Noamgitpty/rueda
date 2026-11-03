/**
 * Rendu d'un gabarit (16 NTF-001 « rendu » ; 10b §3.13 UX-59 à UX-61 ; 17 §1.4 « chaque gabarit
 * existe dans toutes les locales actives et est testé avec toutes ses variables »).
 *
 * - Textes : `@rueda/i18n` (clés `ntf.<slug>.<canal>.<partie>`), dans la langue du profil choisi.
 * - Variables formatées par type : instant au fuseau du pays (`dateTime`), montant par
 *   `formatMoney` (exposant de la devise lu dans CFG), référence courte, texte.
 * - Toute variable manquante, et tout motif résiduel `{…}`, `{{…}}`, `%s`, `undefined`, `null`,
 *   `NaN`, lève `TemplateRenderError` (`TEMPLATE_VARIABLE_MISSING`, 16 NTF-001) : jamais de
 *   « {6} » envoyé (EV-0014).
 *
 * Le texte rendu ne quitte ce module que vers le port `MessagingChannel` ; il n'est ni journalisé
 * ni stocké (seule son empreinte SHA-256 l'est, `rendered_hash`).
 */
import { createHash } from 'node:crypto';
import { CATALOGS, createTranslator } from '@rueda/i18n';
import type { LocaleProfile, MessageKey, MessageValues } from '@rueda/i18n';
import type { TemplateSpec, VariableSource } from './catalog.js';
import { messageKeyOf } from './catalog.js';
import type { MessageChannelKind } from './messaging-channel.port.js';

export type RenderErrorCode = 'TEMPLATE_VARIABLE_MISSING' | 'TEMPLATE_UNKNOWN';

export class TemplateRenderError extends Error {
  override readonly name = 'TemplateRenderError';
  readonly code: RenderErrorCode;
  constructor(code: RenderErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Valeur stockée d'une variable de charge utile (`notification_dispatch.variables`). */
export type StoredVariable = string | { readonly amount_minor: string; readonly currency: string };

export interface RenderContext {
  readonly profile: LocaleProfile;
  /** Fuseau du pays de l'événement (CFG) ; `null` si l'événement n'a pas de pays. */
  readonly timeZone: string | null;
  /** Exposant d'une devise (CFG) ; `undefined` si inconnue. */
  readonly exponentOf: (currency: string) => number | undefined;
  readonly brand: string;
  readonly firstName: string;
  readonly variables: Readonly<Record<string, StoredVariable>>;
}

export interface RenderedMessage {
  readonly subject: string | null;
  readonly body: string;
}

/** Motifs interdits dans un texte rendu (10b UX-60). */
const RESIDUAL = /\{|\}|%s|\bundefined\b|\bnull\b|\bNaN\b/;

/** Référence courte lisible d'un identifiant UUID (8 derniers chiffres hexadécimaux, majuscules). */
export function shortRef(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new TemplateRenderError('TEMPLATE_VARIABLE_MISSING', 'référence : UUID attendu');
  }
  return id.slice(-8).toUpperCase();
}

function missing(name: string): never {
  throw new TemplateRenderError('TEMPLATE_VARIABLE_MISSING', `variable « ${name} » absente`);
}

function formatVariable(
  name: string,
  source: VariableSource,
  ctx: RenderContext,
  t: ReturnType<typeof createTranslator>,
): string {
  if (source.from === 'brand') return ctx.brand.trim() === '' ? missing(name) : ctx.brand;
  if (source.from === 'recipient_first_name') {
    return ctx.firstName.trim() === '' ? missing(name) : ctx.firstName;
  }
  const stored = ctx.variables[name];
  if (stored === undefined) return missing(name);
  switch (source.type) {
    case 'ref':
      return typeof stored === 'string' ? stored : missing(name);
    case 'instant':
      if (typeof stored !== 'string' || ctx.timeZone === null) return missing(name);
      return t.dateTime(stored, ctx.timeZone);
    case 'money': {
      if (typeof stored === 'string' || !/^-?[0-9]{1,30}$/.test(stored.amount_minor)) {
        return missing(name);
      }
      const exponent = ctx.exponentOf(stored.currency);
      if (exponent === undefined) return missing(name);
      return t.money({
        amountMinor: BigInt(stored.amount_minor),
        currency: stored.currency,
        exponent,
      });
    }
  }
}

/** Rend le gabarit sur un canal, dans la langue de `ctx.profile`. */
export function renderTemplate(
  template: TemplateSpec,
  channel: MessageChannelKind,
  ctx: RenderContext,
): RenderedMessage {
  const t = createTranslator(ctx.profile);
  const values: Record<string, string> = {};
  try {
    for (const [name, source] of Object.entries(template.variables)) {
      values[name] = formatVariable(name, source, ctx, t);
    }
  } catch (error) {
    if (error instanceof TemplateRenderError) throw error;
    // instant mal formé, fuseau ou devise refusés par @rueda/i18n
    throw new TemplateRenderError('TEMPLATE_VARIABLE_MISSING', 'variable invalide');
  }
  const part = (which: 'subject' | 'body'): string => {
    const key = messageKeyOf(template, channel, which);
    if (!Object.hasOwn(CATALOGS[ctx.profile.language].messages, key)) {
      throw new TemplateRenderError('TEMPLATE_UNKNOWN', `clé absente : ${key}`);
    }
    let text: string;
    try {
      text = t.t(key as MessageKey, values as MessageValues);
    } catch {
      throw new TemplateRenderError('TEMPLATE_VARIABLE_MISSING', `rendu impossible : ${key}`);
    }
    if (RESIDUAL.test(text)) {
      throw new TemplateRenderError('TEMPLATE_VARIABLE_MISSING', `motif résiduel : ${key}`);
    }
    return text;
  };
  return { subject: channel === 'EMAIL' ? part('subject') : null, body: part('body') };
}

/** Empreinte SHA-256 du message rendu (preuve, 10b UX-62) ; le texte n'est jamais stocké. */
export function renderedHash(message: RenderedMessage): Buffer {
  return createHash('sha256')
    .update(JSON.stringify([message.subject, message.body]), 'utf8')
    .digest();
}

/** Alphabet GSM 03.38 de base (et sa table d'extension, 2 septets) : 10b UX-61. */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€\f';

/**
 * Segments d'un SMS selon l'encodage réel (10b UX-61) : GSM-7 (160 / 153 septets) si tous les
 * caractères sont dans l'alphabet, sinon UCS-2 (70 / 67 unités) — un seul « á » suffit.
 */
export function smsSegments(text: string): { encoding: 'GSM-7' | 'UCS-2'; segments: number } {
  let septets = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) septets += 1;
    else if (GSM7_EXTENDED.includes(ch)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) return { encoding: 'GSM-7', segments: septets <= 160 ? 1 : Math.ceil(septets / 153) };
  const units = text.length; // UTF-16
  return { encoding: 'UCS-2', segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}
