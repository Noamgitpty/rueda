/**
 * Checkout en une page S05 (US-208, partie 208b ; 16 BKG-001 / BKG-006, BKG-002 / BKG-025,
 * BKG-008 / BKG-023 ; ADR-133, ADR-134) côté SERVEUR du site : lecture défensive des réponses des
 * routes `/checkout/…` de l'API et du total TTC de la fiche (`GET /listings/{id}/availability`,
 * champ `price`). Toute réponse mal formée est refusée (`null`) : l'écran affiche son état
 * d'erreur, jamais une donnée partielle ni un montant recalculé. Le site n'envoie JAMAIS de montant
 * à l'API (L2-PM-03) : seulement l'annonce, la période, le conducteur, la case de la boîte
 * manuelle et les versions des documents affichés. Aucune constante de pays, de devise ni de
 * fuseau.
 */
import type { MessageKey } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';
import { codeOf } from './api-client.ts';
import { cancellationViewOf } from './listing-terms.ts';
import type { SlotCancellationView } from './listing-terms.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Instant UTC rendu par l'API (millisecondes facultatives). */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const MINOR = /^-?(0|[1-9][0-9]{0,18})$/;
const CURRENCY = /^[A-Z]{3}$/;
const COUNTRY = /^[A-Z]{2}$/;
const LOCALE = /^[a-z]{2}$/;
/**
 * Lignes du devis que l'écran sait nommer (celles que la base rejoue, N-129) ; `PROTECTION` :
 * protection du voyageur, présente dans tout devis depuis US-226 (ADR-136).
 */
export const QUOTE_LINE_TYPES = ['TRIP_PRICE', 'TRIP_FEE', 'PROTECTION'] as const;
/** Niveau de protection : code de la grille du pays (forme seulement, US-226). */
const PROTECTION_LEVEL = /^[A-Z][A-Z_]{0,31}$/;
export type QuoteLineType = (typeof QUOTE_LINE_TYPES)[number];
/**
 * Documents acceptés au checkout (16 BKG-008, BKG-023), dans l'ordre de l'écran : CGU du
 * voyageur, politique d'annulation, texte géographique.
 */
export const CHECKOUT_DOCUMENT_KINDS = ['TOS_GUEST', 'CANCELLATION_POLICY', 'GEO_TERMS'] as const;
export type CheckoutDocumentKind = (typeof CHECKOUT_DOCUMENT_KINDS)[number];
/** Longueur maximale d'un nom saisi (borne de l'API). */
export const DRIVER_NAME_MAX = 100;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
const minor = (v: unknown): bigint | null =>
  typeof v === 'string' && MINOR.test(v) ? BigInt(v) : null;
const instant = (v: unknown): string | null =>
  typeof v === 'string' && INSTANT.test(v) && Number.isFinite(Date.parse(v)) ? v : null;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Total TTC des dates de la fiche (devis provisoire, le même chiffre que la recherche). */
export interface SlotPriceView {
  readonly totalMinor: bigint;
  readonly currency: string;
  readonly billableDays: number;
}

/**
 * `price` de `GET /listings/{id}/availability` (US-208) : `null` si aucun devis n'est possible ou
 * si le champ est illisible (aucun total affiché, aucun bouton « Reservar »).
 */
export function slotPriceOf(reply: ApiResult): SlotPriceView | null {
  if (reply.status !== 200 || !isObj(reply.json) || !isObj(reply.json['availability'])) return null;
  const p = reply.json['availability']['price'];
  if (!isObj(p)) return null;
  const totalMinor = minor(p['totalMinor']);
  const currency = str(p['currency']);
  const days = int(p['billableDays']);
  if (totalMinor === null || totalMinor < 0n || currency === null || !CURRENCY.test(currency)) {
    return null;
  }
  if (days === null || days < 1) return null;
  return { totalMinor, currency, billableDays: days };
}

export interface QuoteLineView {
  readonly type: QuoteLineType;
  readonly amountMinor: bigint;
  readonly taxMinor: bigint;
}

/**
 * Niveau de protection proposé sur S05 (US-226 ; 16 BKG-003, PRT-001 / PRT-002) : prix par jour et
 * pour la période calculés par l'API (jamais par le site) ; niveau refusé à l'âge déclaré grisé
 * avec sa raison (`DRIVER_AGE`, âge minimal du niveau).
 */
export interface ProtectionOptionView {
  readonly level: string;
  readonly eligible: boolean;
  readonly reason: 'DRIVER_AGE' | null;
  readonly minDriverAge: number | null;
  readonly dailyMinor: bigint;
  readonly lineMinor: bigint;
  readonly selected: boolean;
}

/** Âge déclaré accepté par l'écran (années entières ; la base juge l'éligibilité). */
export const DRIVER_AGE_MIN = 16;
export const DRIVER_AGE_MAX = 99;
/** Message d'un âge illisible ou hors bornes (valeurs `min`, `max`). */
export const AGE_INVALID_MESSAGE = 'web.s05.age.invalid' as const;

export interface CheckoutDocumentView {
  readonly kind: CheckoutDocumentKind;
  readonly version: number;
  readonly locale: string;
  readonly title: string;
}

/** Devis figé du voyageur, tel que la base l'a rejoué (`GET|POST /checkout/quotes…`). */
export interface CheckoutQuoteView {
  readonly quoteId: string;
  readonly listingId: string;
  readonly country: string;
  readonly currency: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly billableDays: number;
  readonly lines: readonly QuoteLineView[];
  readonly totalMinor: bigint;
  readonly expiresAt: string | null;
  /** Niveau de protection figé (US-226) ; `null` : devis sans protection (jamais réservable). */
  readonly protectionLevel: string | null;
  /** Âge déclaré figé dans le devis (US-226) ; `null` : non saisi. */
  readonly driverAge: number | null;
  /** `insurer_contract_active` du pays (16 PRT-001) ; `false` : aucune réservation possible. */
  readonly insurerContractActive: boolean;
  /** Niveaux vendus, par rang croissant, avec leur prix pour la période (US-226b, S05). */
  readonly protectionOptions: readonly ProtectionOptionView[];
  readonly expired: boolean;
  readonly manualTransmission: boolean;
  readonly instantBook: boolean;
  /** Documents à accepter, dans l'ordre de l'écran ; un genre absent : aucun texte publié. */
  readonly documents: readonly CheckoutDocumentView[];
  /** Distance figée dans le devis (US-205b) ; `null` : aucune distance promise ou illisible. */
  readonly mileage: QuoteMileageView | null;
  /** Annulation gratuite si la réservation a lieu maintenant (base) ; `null` : aucune promesse. */
  readonly cancellation: SlotCancellationView | null;
  /** Retenue hors fenêtre gratuite (moteur de règlement) ; `null` : non calculée. */
  readonly lateCancellation: LateCancellationView | null;
}

/** Distance figée du devis (16 LST-012) : km inclus sur la période et prix du km supplémentaire. */
export type QuoteMileageView =
  | { readonly mode: 'UNLIMITED' }
  | { readonly mode: 'INCLUDED'; readonly includedKm: number; readonly extraKmPriceMinor: bigint };

/** Retenue d'une annulation hors fenêtre (08 BR-CXL-06) : jour entier ou demi-journée, montant. */
export interface LateCancellationView {
  readonly penaltyDays: 'ONE' | 'HALF';
  readonly retainedMinor: bigint;
}

/** Distance du devis ; forme inattendue ⇒ `null` (aucune distance affichée, jamais devinée). */
function quoteMileageOf(v: unknown): QuoteMileageView | null {
  if (!isObj(v)) return null;
  if (v['mode'] === 'UNLIMITED') {
    return v['includedKm'] === null && v['extraKmPriceMinor'] === null
      ? { mode: 'UNLIMITED' }
      : null;
  }
  if (v['mode'] !== 'INCLUDED') return null;
  const km = int(v['includedKm']);
  const extra = minor(v['extraKmPriceMinor']);
  if (km === null || km < 1 || extra === null || extra < 0n) return null;
  return { mode: 'INCLUDED', includedKm: km, extraKmPriceMinor: extra };
}

/** Retenue hors fenêtre ; forme inattendue ⇒ `null` (renvoi à la politique publiée). */
function lateCancellationOf(v: unknown): LateCancellationView | null {
  if (!isObj(v)) return null;
  const amount = minor(v['retainedMinor']);
  if (amount === null || amount < 1n) return null;
  if (v['penaltyDays'] === '1') return { penaltyDays: 'ONE', retainedMinor: amount };
  if (v['penaltyDays'] === '1/2') return { penaltyDays: 'HALF', retainedMinor: amount };
  return null;
}

function linesOf(v: unknown): QuoteLineView[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 10) return null;
  const out: QuoteLineView[] = [];
  for (const l of v as unknown[]) {
    if (!isObj(l)) return null;
    const type = str(l['type']);
    const amount = minor(l['amountMinor']);
    const tax = minor(l['taxMinor']);
    // ligne inconnue de l'écran : jamais affichée à moitié (fail-closed)
    if (type === null || !(QUOTE_LINE_TYPES as readonly string[]).includes(type)) return null;
    if (amount === null || tax === null || tax < 0n) return null;
    out.push({ type: type as QuoteLineType, amountMinor: amount, taxMinor: tax });
  }
  return out;
}

/**
 * Niveaux proposés (`protectionOptions`) : absents d'une réponse antérieure ⇒ aucun ; un niveau
 * mal formé, en double, ou plus d'un niveau sélectionné ⇒ réponse refusée (fail-closed).
 */
function optionsOf(v: unknown): ProtectionOptionView[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 10) return null;
  const out: ProtectionOptionView[] = [];
  for (const o of v as unknown[]) {
    if (!isObj(o)) return null;
    const level = str(o['level']);
    const daily = minor(o['dailyMinor']);
    const line = minor(o['lineMinor']);
    const age = o['minDriverAge'] === null ? null : int(o['minDriverAge']);
    const reason = o['reason'];
    if (level === null || !PROTECTION_LEVEL.test(level) || out.some((x) => x.level === level)) {
      return null;
    }
    if (daily === null || daily < 0n || line === null || line < 0n) return null;
    if (typeof o['eligible'] !== 'boolean' || typeof o['selected'] !== 'boolean') return null;
    if (o['minDriverAge'] !== null && (age === null || age < 1)) return null;
    if (reason !== null && reason !== 'DRIVER_AGE') return null;
    // un niveau refusé porte sa raison, un niveau permis n'en porte aucune
    if ((reason === null) !== (o['eligible'] === true)) return null;
    out.push({
      level,
      eligible: o['eligible'] === true,
      reason: reason === null ? null : 'DRIVER_AGE',
      minDriverAge: age,
      dailyMinor: daily,
      lineMinor: line,
      selected: o['selected'] === true,
    });
  }
  if (out.filter((o) => o.selected).length > 1) return null;
  return out;
}

function documentsOf(v: unknown): CheckoutDocumentView[] | null {
  if (!Array.isArray(v) || v.length > CHECKOUT_DOCUMENT_KINDS.length) return null;
  const found = new Map<CheckoutDocumentKind, CheckoutDocumentView>();
  for (const d of v as unknown[]) {
    if (!isObj(d)) return null;
    const kind = str(d['kind']);
    const version = int(d['version']);
    const locale = str(d['locale']);
    const title = str(d['title']);
    if (kind === null || !(CHECKOUT_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
      return null;
    }
    if (version === null || version < 1 || locale === null || !LOCALE.test(locale)) return null;
    if (title === null || title.trim() === '' || title.length > 200) return null;
    const k = kind as CheckoutDocumentKind;
    if (found.has(k)) return null;
    found.set(k, { kind: k, version, locale, title });
  }
  return CHECKOUT_DOCUMENT_KINDS.flatMap((k) => {
    const d = found.get(k);
    return d === undefined ? [] : [d];
  });
}

/** Devis de `{ quote: … }` ; `null` si illisible ou incohérent (somme des lignes ≠ total). */
export function checkoutQuoteOf(reply: ApiResult): CheckoutQuoteView | null {
  if (reply.status !== 200 && reply.status !== 201) return null;
  if (!isObj(reply.json) || !isObj(reply.json['quote'])) return null;
  const q = reply.json['quote'];
  const quoteId = str(q['quoteId']);
  const listingId = str(q['listingId']);
  const country = str(q['country']);
  const currency = str(q['currency']);
  const startAt = instant(q['startAt']);
  const endAt = instant(q['endAt']);
  const days = int(q['billableDays']);
  const lines = linesOf(q['lines']);
  const total = minor(q['totalMinor']);
  const expiresAt = q['expiresAt'] === null ? null : instant(q['expiresAt']);
  const documents = documentsOf(q['documents']);
  if (!isUuid(quoteId) || !isUuid(listingId)) return null;
  if (country === null || !COUNTRY.test(country) || currency === null || !CURRENCY.test(currency)) {
    return null;
  }
  if (startAt === null || endAt === null || Date.parse(endAt) <= Date.parse(startAt)) return null;
  if (days === null || days < 1 || lines === null || total === null || documents === null) {
    return null;
  }
  if (q['expiresAt'] !== null && expiresAt === null) return null;
  // US-226 : niveau de protection du devis (absent d'une réponse antérieure : aucun)
  const level = q['protectionLevel'];
  if (level !== undefined && level !== null) {
    if (typeof level !== 'string' || !PROTECTION_LEVEL.test(level)) return null;
  }
  const protectionLevel = typeof level === 'string' ? level : null;
  // une ligne de protection sans niveau, ou l'inverse : incohérent, jamais affiché
  if ((protectionLevel !== null) !== lines.some((l) => l.type === 'PROTECTION')) return null;
  const options = optionsOf(q['protectionOptions']);
  if (options === null) return null;
  // le niveau sélectionné est celui du devis ; sa ligne de la période est la ligne du devis
  const chosen = options.find((o) => o.selected);
  if (chosen !== undefined) {
    const line = lines.find((l) => l.type === 'PROTECTION');
    if (chosen.level !== protectionLevel || line?.amountMinor !== chosen.lineMinor) return null;
  }
  const rawAge = q['driverAge'];
  const driverAge = rawAge === undefined || rawAge === null ? null : int(rawAge);
  // borne du schéma OpenAPI de la réponse (0 à 150 ; la requête exige au moins 1)
  if (rawAge !== undefined && rawAge !== null) {
    if (driverAge === null || driverAge < 0 || driverAge > 150) return null;
  }
  const contract = q['insurerContractActive'];
  if (contract !== undefined && typeof contract !== 'boolean') return null;
  for (const flag of ['expired', 'manualTransmission', 'instantBook']) {
    if (typeof q[flag] !== 'boolean') return null;
  }
  // 08 BR-PRICE-13 : total = Σ lignes + Σ taxes ; un écart n'est jamais affiché (aucun recalcul)
  const sum = lines.reduce((a, l) => a + l.amountMinor + l.taxMinor, 0n);
  if (sum !== total) return null;
  const late = lateCancellationOf(q['lateCancellation']);
  return {
    quoteId,
    listingId,
    country,
    currency,
    startAt,
    endAt,
    billableDays: days,
    lines,
    totalMinor: total,
    expiresAt,
    protectionLevel,
    driverAge,
    // absent d'une réponse antérieure à US-226 : aucune fermeture annoncée par le pays
    insurerContractActive: contract !== false,
    protectionOptions: options,
    expired: q['expired'] === true,
    manualTransmission: q['manualTransmission'] === true,
    instantBook: q['instantBook'] === true,
    documents,
    // US-205b : conditions affichées seulement si lisibles ; jamais une retenue au-delà du total
    mileage: quoteMileageOf(q['mileage']),
    cancellation: cancellationViewOf(q['cancellation'] ?? null) ?? null,
    lateCancellation: late !== null && late.retainedMinor <= total ? late : null,
  };
}

/** Hold de checkout posé (`POST …/hold`, `GET /checkout/holds/{id}`). */
export interface CheckoutHoldView {
  readonly holdId: string;
  readonly status: string;
  readonly expiresAt: string;
  readonly quoteId: string;
  readonly listingId: string;
  readonly currency: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly totalMinor: bigint;
  readonly manualConfirmed: boolean;
  /**
   * État de revue (US-209 partie 209c, ADR-144 ; N-203) : `PENDING` = revue avant le débit en
   * cours, aucun bouton « Pagar » ; `APPROVED` = revu, payable jusqu'à `expiresAt` ; `REJECTED` =
   * libéré par la revue ; `NONE` = aucune revue avant le débit.
   */
  readonly reviewState: CheckoutReviewState;
  readonly documents: readonly { readonly kind: string; readonly version: number }[];
}

/** États de revue rendus par l'API (`GET /checkout/holds/{id}`, ADR-144). */
export const CHECKOUT_REVIEW_STATES = ['NONE', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type CheckoutReviewState = (typeof CHECKOUT_REVIEW_STATES)[number];

/** Le hold peut-il être payé depuis S05 ? Jamais pendant une revue ni après un refus (N-203). */
export const holdPayable = (h: Pick<CheckoutHoldView, 'status' | 'reviewState'>): boolean =>
  h.status === 'ACTIVE' && (h.reviewState === 'NONE' || h.reviewState === 'APPROVED');

export function checkoutHoldOf(reply: ApiResult): CheckoutHoldView | null {
  if (reply.status !== 200 && reply.status !== 201) return null;
  if (!isObj(reply.json) || !isObj(reply.json['hold'])) return null;
  const h = reply.json['hold'];
  const holdId = str(h['holdId']);
  const quoteId = str(h['quoteId']);
  const listingId = str(h['listingId']);
  const status = str(h['status']);
  const expiresAt = instant(h['expiresAt']);
  const currency = str(h['currency']);
  const startAt = instant(h['startAt']);
  const endAt = instant(h['endAt']);
  const total = minor(h['totalMinor']);
  if (!isUuid(holdId) || !isUuid(quoteId) || !isUuid(listingId)) return null;
  if (status === null || !/^[A-Z_]{1,40}$/.test(status) || expiresAt === null) return null;
  if (currency === null || !CURRENCY.test(currency) || startAt === null || endAt === null) {
    return null;
  }
  if (total === null || total < 0n || typeof h['manualConfirmed'] !== 'boolean') return null;
  // état de revue absent ou inconnu : réponse refusée (jamais un hold présenté comme payable)
  const review = str(h['reviewState']);
  if (review === null || !(CHECKOUT_REVIEW_STATES as readonly string[]).includes(review)) {
    return null;
  }
  if (!Array.isArray(h['documents'])) return null;
  const documents: { kind: string; version: number }[] = [];
  for (const d of h['documents'] as unknown[]) {
    if (!isObj(d)) return null;
    const kind = str(d['kind']);
    const version = int(d['version']);
    if (kind === null || !(CHECKOUT_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
      return null;
    }
    if (version === null || version < 1) return null;
    documents.push({ kind, version });
  }
  return {
    holdId,
    status,
    expiresAt,
    quoteId,
    listingId,
    currency,
    startAt,
    endAt,
    totalMinor: total,
    manualConfirmed: h['manualConfirmed'] === true,
    reviewState: review as CheckoutReviewState,
    documents,
  };
}

/** Champs du formulaire de S05 (identifiants stables : récapitulatif d'erreurs, e2e). */
export const S05_FIELD = {
  form: 's05-form',
  firstName: 's05-driver-first',
  lastName: 's05-driver-last',
  manual: 's05-manual',
  document: (kind: CheckoutDocumentKind): string => `s05-doc-${kind}`,
} as const;

/** Saisie de S05 lue d'un `FormData` (bornée ; aucun montant). */
export interface CheckoutInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly manualConfirmed: boolean;
  /** Versions affichées ET cochées, dans l'ordre de l'écran. */
  readonly accepted: readonly { readonly kind: CheckoutDocumentKind; readonly version: number }[];
  /** Genres affichés et non cochés. */
  readonly unchecked: readonly CheckoutDocumentKind[];
}

const field = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.slice(0, max) : '';
};

/**
 * Lecture du formulaire : version affichée de chaque document (`version.<genre>`, champ caché) et
 * case cochée (`accept.<genre>` = `on`). Une version illisible vaut « non affiché ».
 */
export function checkoutInputOf(form: FormData): CheckoutInput {
  const accepted: { kind: CheckoutDocumentKind; version: number }[] = [];
  const unchecked: CheckoutDocumentKind[] = [];
  for (const kind of CHECKOUT_DOCUMENT_KINDS) {
    const raw = field(form, `version.${kind}`, 6);
    if (!/^[1-9][0-9]{0,5}$/.test(raw)) continue;
    if (form.get(`accept.${kind}`) === 'on') accepted.push({ kind, version: Number(raw) });
    else unchecked.push(kind);
  }
  return {
    firstName: field(form, 'firstName', DRIVER_NAME_MAX),
    lastName: field(form, 'lastName', DRIVER_NAME_MAX),
    manualConfirmed: form.get('manual') === 'on',
    accepted,
    unchecked,
  };
}

/** Erreur d'un champ de S05 (`s05-form` : le formulaire entier). */
export interface CheckoutFieldError {
  readonly fieldId: string;
  readonly key: MessageKey;
}

/**
 * Contrôles de forme AVANT l'envoi (la base juge le reste) : nom et prénom saisis, case de la boîte
 * manuelle si l'auto en a une, chaque document affiché coché (bouton inactif sinon, 19 US-208
 * critère 3 : `TERMS_NOT_ACCEPTED`).
 */
export function checkoutInputErrors(
  input: CheckoutInput,
  manualRequired: boolean,
): CheckoutFieldError[] {
  const errors: CheckoutFieldError[] = [];
  if (input.firstName.trim() === '') {
    errors.push({ fieldId: S05_FIELD.firstName, key: 'web.s05.driver.firstRequired' });
  }
  if (input.lastName.trim() === '') {
    errors.push({ fieldId: S05_FIELD.lastName, key: 'web.s05.driver.lastRequired' });
  }
  if (manualRequired && !input.manualConfirmed) {
    errors.push({ fieldId: S05_FIELD.manual, key: 'common.checkout.manualNotConfirmed' });
  }
  for (const kind of input.unchecked) {
    errors.push({ fieldId: S05_FIELD.document(kind), key: 'common.checkout.termsNotAccepted' });
  }
  return errors;
}

/** Champs du choix de la protection (S05, US-226b). */
export const S05_PROTECTION_FIELD = {
  form: 's05-protection',
  age: 's05-driver-age',
  levels: 's05-protection-levels',
  level: (level: string): string => `s05-protection-${level}`,
} as const;

/** Choix de la protection lu d'un `FormData` : niveau de la grille et âge déclaré (aucun montant). */
export interface ProtectionInput {
  readonly level: string | null;
  /** `undefined` : âge non saisi ; `null` : saisie illisible ou hors bornes. */
  readonly driverAge: number | null | undefined;
}

export function protectionInputOf(form: FormData): ProtectionInput {
  const level = form.get('protectionLevel');
  const raw = form.get('driverAge');
  const text = typeof raw === 'string' ? raw.trim().slice(0, 4) : '';
  let driverAge: number | null | undefined;
  if (text === '') driverAge = undefined;
  else if (/^[0-9]{1,3}$/.test(text)) {
    const n = Number(text);
    driverAge = n >= DRIVER_AGE_MIN && n <= DRIVER_AGE_MAX ? n : null;
  } else driverAge = null;
  return {
    level: typeof level === 'string' && PROTECTION_LEVEL.test(level) ? level : null,
    driverAge,
  };
}

/** Contrôles de forme du choix de la protection (la base juge l'éligibilité et le prix). */
export function protectionInputErrors(input: ProtectionInput): CheckoutFieldError[] {
  const errors: CheckoutFieldError[] = [];
  if (input.driverAge === null) {
    errors.push({ fieldId: S05_PROTECTION_FIELD.age, key: AGE_INVALID_MESSAGE });
  }
  if (input.level === null) {
    errors.push({ fieldId: S05_PROTECTION_FIELD.levels, key: 'common.quote.protectionRequired' });
  }
  return errors;
}

/**
 * Le choix change-t-il le devis ? Même niveau et même âge : aucun nouveau devis figé (chaque gel
 * compte dans `quote_freezes_per_guest_hour`, ADR-136, ADR-137).
 */
export function protectionChanged(
  quote: Pick<CheckoutQuoteView, 'protectionLevel' | 'driverAge'>,
  input: ProtectionInput,
): boolean {
  return input.level !== quote.protectionLevel || (input.driverAge ?? null) !== quote.driverAge;
}

/** Protection à reprendre dans un nouveau devis (US-226b) ; absente : minimum du pays au gel. */
export interface ProtectionChoice {
  readonly protectionLevel: string;
  readonly driverAge?: number;
}

/**
 * Choix de protection d'un devis lu, repris quand son prix est redemandé (ADR-137 : un prix
 * redemandé ne retire jamais un choix) ; devis sans protection : aucun choix (minimum du pays).
 */
export function protectionChoiceOf(quote: {
  readonly protectionLevel: string | null;
  readonly driverAge: number | null;
}): ProtectionChoice | undefined {
  if (quote.protectionLevel === null) return undefined;
  return {
    protectionLevel: quote.protectionLevel,
    ...(quote.driverAge === null ? {} : { driverAge: quote.driverAge }),
  };
}

/** Corps de `POST /checkout/quotes/{id}/hold` : jamais un montant (L2-PM-03). */
export function holdRequestOf(input: CheckoutInput): {
  readonly driver: { readonly firstName: string; readonly lastName: string };
  readonly manualTransmissionConfirmed: boolean;
  readonly acceptedDocuments: readonly { readonly kind: string; readonly version: number }[];
} {
  return {
    driver: { firstName: input.firstName, lastName: input.lastName },
    manualTransmissionConfirmed: input.manualConfirmed,
    acceptedDocuments: input.accepted.map((d) => ({ kind: d.kind, version: d.version })),
  };
}

/**
 * Codes stables des routes du checkout (ADR-133) → clé du catalogue (es, en, fr, pt-BR). Un code
 * inconnu ou une API injoignable donne un message générique (fail-closed).
 */
const CHECKOUT_KEYS: Readonly<Record<string, MessageKey>> = {
  REQUEST_INVALID: 'common.auth.requestInvalid',
  QUOTE_INPUT_INVALID: 'common.quote.datesInvalid',
  QUOTE_UNAVAILABLE: 'common.quote.unavailable',
  QUOTE_MISMATCH: 'common.quote.changed',
  QUOTE_NOT_FOUND: 'common.quote.notFound',
  QUOTE_RATE_LIMITED: 'common.quote.rateLimited',
  QUOTE_EXPIRED: 'common.quote.expired',
  QUOTE_ALREADY_USED: 'common.checkout.quoteAlreadyUsed',
  QUOTE_LINE_NOT_SUPPORTED: 'common.quote.lineNotSupported',
  // US-226 : protection du voyageur (ADR-136)
  PROTECTION_LEVEL_REQUIRED: 'common.quote.protectionRequired',
  PROTECTION_LEVEL_NOT_ELIGIBLE: 'common.quote.protectionNotEligible',
  INSURER_CONTRACT_INACTIVE: 'common.quote.insurerContractInactive',
  LISTING_NOT_FOUND: 'web.listing.notFound',
  LISTING_UNAVAILABLE: 'common.checkout.listingUnavailable',
  REQUEST_MODE_UNAVAILABLE: 'common.checkout.requestModeUnavailable',
  MANUAL_TRANSMISSION_NOT_CONFIRMED: 'common.checkout.manualNotConfirmed',
  DRIVER_MUST_BE_ACCOUNT_HOLDER: 'common.checkout.driverMustBeAccountHolder',
  TERMS_NOT_ACCEPTED: 'common.checkout.termsNotAccepted',
  TERMS_VERSION_CHANGED: 'common.legal.versionChanged',
  TERMS_UNAVAILABLE: 'common.legal.unavailable',
  TERMS_REACCEPT_REQUIRED: 'common.legal.reacceptRequired',
  DATES_UNAVAILABLE: 'common.listing.datesUnavailable',
  DATES_NOTICE_TOO_SHORT: 'common.checkout.noticeTooShort',
  GUEST_OVERLAP: 'common.checkout.guestOverlap',
  HOLD_ALREADY_LIVE: 'common.checkout.holdAlreadyLive',
  HOLD_LIMIT_REACHED: 'common.checkout.holdLimit',
  HOLD_RATE_LIMITED: 'common.checkout.holdRateLimited',
  HOLD_NOT_FOUND: 'common.checkout.holdNotFound',
  SELF_BOOKING_FORBIDDEN: 'common.booking.selfBookingForbidden.body',
  ACCOUNT_RESTRICTED: 'common.checkout.accountRestricted',
  // US-209 (ADR-135, 16 BKG-012) : refus définitifs du conducteur, jamais « réessaie plus tard »
  KYC_NOT_APPROVED: 'common.kyc.notApproved',
  KYC_BIOMETRIC_CONSENT_MISSING: 'common.kyc.consentMissing',
  KYC_LICENSE_EXPIRED: 'common.kyc.licenseExpired',
  AGE_CLASS_MISMATCH: 'common.checkout.ageClassMismatch',
  BOOKING_UNAVAILABLE: 'common.checkout.unavailable',
  RATE_LIMITED: 'common.rateLimit.retryLater',
};

export function checkoutErrorKey(reply: ApiResult): MessageKey {
  const code = codeOf(reply);
  const key = code === null ? undefined : CHECKOUT_KEYS[code];
  // inconnu ou injoignable : message générique sans emplacement (jamais « {code} » ni un détail)
  return key ?? 'common.checkout.unavailable';
}

/** Codes connus (tests) ; chacun a sa clé dans les quatre catalogues (typecheck). */
export const CHECKOUT_ERROR_CODES: readonly string[] = Object.keys(CHECKOUT_KEYS);

/**
 * Refus du conducteur qui se lèvent depuis la vérification d'identité (S04) : identité non
 * approuvée, consentement biométrique absent ou retiré, permis échu avant la fin du trip (16
 * BKG-012 ; 10b UXQ-12, US-209 partie 209c). Leur message s'accompagne d'un lien vers S04.
 */
export const IDENTITY_REFUSAL_KEYS: ReadonlySet<MessageKey> = new Set<MessageKey>([
  'common.kyc.notApproved',
  'common.kyc.consentMissing',
  'common.kyc.licenseExpired',
]);

/** S04, vérification d'identité (lien des refus du conducteur). */
export const IDENTITY_HREF = '/verify-identity';

/** Page du document affiché par la case de S05 (`target=_blank`, version exacte, retour au devis). */
export function checkoutDocumentHref(
  doc: { readonly kind: string; readonly version: number },
  country: string,
  quoteId: string,
): string {
  const q = new URLSearchParams({
    country,
    version: String(doc.version),
    from: 'checkout',
    quote: quoteId,
  });
  return `/legal/${doc.kind}?${q.toString()}`;
}
