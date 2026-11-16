/**
 * Conditions de la fiche S03 (US-205 ; ADR-138) côté SERVEUR du site : lecture défensive de
 * `GET /listings/{id}/conditions` (politique d'annulation du pays, caution de la plateforme,
 * protection de l'assureur partenaire) et des conditions du créneau accepté rendues par
 * `GET /listings/{id}/availability` (`freeUntil` de BR-CXL-01, distance incluse sur la période).
 *
 * Toute réponse mal formée est refusée (`null`) : l'écran n'affiche alors AUCUNE promesse
 * (couverture, annulation gratuite), jamais une donnée partielle ni devinée. Aucun calcul ici :
 * dates, distances et montants viennent de l'API (la base pour `freeUntil` et la protection) ;
 * aucune constante de pays, de devise ni de fuseau.
 */
import type { ApiResult } from './api-client.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MINOR = /^(0|[1-9][0-9]{0,17})$/;
const CURRENCY = /^[A-Z]{3}$/;

/** Niveaux de protection, dans l'ordre de la grille (US-226). */
export const PROTECTION_LEVELS = ['BASICA', 'ESTANDAR', 'TOTAL'] as const;
export type ProtectionLevel = (typeof PROTECTION_LEVELS)[number];
/** Langues des textes de l'assureur (celles du site). */
export const TERMS_LANGUAGES = ['es', 'en', 'fr', 'pt-BR'] as const;
export type TermsLanguage = (typeof TERMS_LANGUAGES)[number];

const minor = (v: unknown): bigint | null =>
  typeof v === 'string' && MINOR.test(v) ? BigInt(v) : null;

/** Annulation du créneau : date limite (UTC), ou dernière minute (fenêtre en minutes). */
export interface SlotCancellationView {
  readonly lastMinute: boolean;
  readonly freeUntil: Date | null;
  readonly windowMinutes: number;
}

/** Distance du créneau : km sur la période (`null` : illimité ou sans devis). */
export interface SlotMileageView {
  readonly mode: 'UNLIMITED' | 'INCLUDED';
  readonly includedKmPerDay: number | null;
  readonly includedKm: number | null;
  readonly extraKmPriceMinor: bigint | null;
}

export interface SlotTermsView {
  readonly cancellation: SlotCancellationView | null;
  readonly mileage: SlotMileageView;
}

function cancellationOf(v: unknown): SlotCancellationView | null | undefined {
  if (v === null) return null;
  if (!isObj(v) || typeof v['lastMinute'] !== 'boolean') return undefined;
  const window = int(v['lastMinuteWindowMinutes']);
  if (window === null || window < 1) return undefined;
  const raw = v['freeUntil'];
  if (v['lastMinute']) {
    if (raw !== null) return undefined;
    return { lastMinute: true, freeUntil: null, windowMinutes: window };
  }
  const iso = str(raw);
  if (iso === null || !INSTANT.test(iso)) return undefined;
  return { lastMinute: false, freeUntil: new Date(iso), windowMinutes: window };
}

function mileageOf(v: unknown): SlotMileageView | undefined {
  if (!isObj(v)) return undefined;
  const mode = v['mode'];
  if (mode === 'UNLIMITED') {
    return { mode, includedKmPerDay: null, includedKm: null, extraKmPriceMinor: null };
  }
  if (mode !== 'INCLUDED') return undefined;
  const perDay = int(v['includedKmPerDay']);
  const total = v['includedKm'] === null ? null : int(v['includedKm']);
  const extra = minor(v['extraKmPriceMinor']);
  if (perDay === null || perDay < 1 || extra === null) return undefined;
  if (v['includedKm'] !== null && (total === null || total < perDay)) return undefined;
  return { mode, includedKmPerDay: perDay, includedKm: total, extraKmPriceMinor: extra };
}

/** Conditions du créneau accepté (`availability`) ; `null` si illisibles (aucune promesse). */
export function slotTermsOf(reply: ApiResult): SlotTermsView | null {
  if (reply.status !== 200 || !isObj(reply.json) || !isObj(reply.json['availability'])) return null;
  const a = reply.json['availability'];
  const cancellation = cancellationOf(a['cancellation']);
  const mileage = mileageOf(a['mileage']);
  if (cancellation === undefined || mileage === undefined) return null;
  return { cancellation, mileage };
}

/** Protection de l'assureur partenaire, recopiée du contrat en vigueur du pays. */
export interface ProtectionView {
  readonly insurerName: string;
  readonly insurerLicenseRef: string | null;
  readonly brokerName: string | null;
  readonly brokerLicenseRef: string | null;
  readonly contractVersion: number;
  readonly rcAmountMinor: bigint;
  readonly deductibles: Readonly<Record<ProtectionLevel, bigint>>;
  readonly exclusions: Readonly<Record<TermsLanguage, string>>;
}

export interface ListingConditionsView {
  readonly currency: string;
  readonly timezone: string;
  readonly cancellation: {
    readonly leadHours: number;
    readonly thresholdHours: number;
    readonly windowMinutes: number;
  } | null;
  readonly depositMinor: bigint | null;
  /** `null` : la base ne promet aucune couverture (véhicule non réservable, 19 US-205 c. 4). */
  readonly protection: ProtectionView | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const nullableText = (v: unknown): string | null | undefined =>
  v === null ? null : (text(v) ?? undefined);

function protectionOf(v: unknown): ProtectionView | null | undefined {
  if (v === null) return null;
  if (!isObj(v) || !isObj(v['deductibles']) || !isObj(v['exclusions'])) return undefined;
  const name = text(v['insurerName']);
  const license = nullableText(v['insurerLicenseRef']);
  const broker = nullableText(v['brokerName']);
  const brokerLicense = nullableText(v['brokerLicenseRef']);
  const version = int(v['contractVersion']);
  const rc = minor(v['rcAmountMinor']);
  if (name === null || license === undefined || broker === undefined) return undefined;
  if (brokerLicense === undefined || version === null || version < 1 || rc === null || rc < 1n) {
    return undefined;
  }
  const d = v['deductibles'];
  const e = v['exclusions'];
  if (Object.keys(d).length !== PROTECTION_LEVELS.length) return undefined;
  if (Object.keys(e).length !== TERMS_LANGUAGES.length) return undefined;
  const deductibles = {} as Record<ProtectionLevel, bigint>;
  for (const level of PROTECTION_LEVELS) {
    const amount = minor(d[level]);
    if (amount === null) return undefined;
    deductibles[level] = amount;
  }
  const exclusions = {} as Record<TermsLanguage, string>;
  for (const lang of TERMS_LANGUAGES) {
    const t = text(e[lang]);
    if (t === null) return undefined;
    exclusions[lang] = t;
  }
  return {
    insurerName: name,
    insurerLicenseRef: license,
    brokerName: broker,
    brokerLicenseRef: brokerLicense,
    contractVersion: version,
    rcAmountMinor: rc,
    deductibles,
    exclusions,
  };
}

/** Conditions de `GET /listings/{id}/conditions` ; `null` si illisibles (aucune promesse). */
export function listingConditionsOf(reply: ApiResult): ListingConditionsView | null {
  if (reply.status !== 200 || !isObj(reply.json) || !isObj(reply.json['conditions'])) return null;
  const c = reply.json['conditions'];
  const currency = str(c['currency']);
  const timezone = text(c['timezone']);
  if (currency === null || !CURRENCY.test(currency) || timezone === null) return null;
  let cancellation: ListingConditionsView['cancellation'] = null;
  if (c['cancellation'] !== null) {
    const x = c['cancellation'];
    if (!isObj(x)) return null;
    const lead = int(x['freeCancelLeadHours']);
    const threshold = int(x['lastMinuteThresholdHours']);
    const window = int(x['lastMinuteWindowMinutes']);
    if (lead === null || lead < 0 || threshold === null || threshold < 0) return null;
    if (window === null || window < 1) return null;
    cancellation = { leadHours: lead, thresholdHours: threshold, windowMinutes: window };
  }
  let depositMinor: bigint | null = null;
  if (c['deposit'] !== null) {
    if (!isObj(c['deposit'])) return null;
    depositMinor = minor(c['deposit']['amountMinor']);
    if (depositMinor === null || depositMinor < 1n) return null;
  }
  const protection = protectionOf(c['protection']);
  if (protection === undefined) return null;
  return { currency, timezone, cancellation, depositMinor, protection };
}

/**
 * Langue des textes de l'assureur pour une locale du site (`es-PA`, `pt-BR`, `fr`…) : la langue
 * de la locale, `pt-BR` pour le portugais ; inconnue : espagnol (langue du contrat de location).
 */
export function termsLanguageOf(localeTag: string): TermsLanguage {
  const lang = localeTag.split('-')[0]?.toLowerCase();
  if (lang === 'en' || lang === 'fr' || lang === 'es') return lang;
  if (lang === 'pt') return 'pt-BR';
  return 'es';
}
