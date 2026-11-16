/**
 * Moteur de devis versionné (US-202 ; 16 PRC-025, PRC-020 ; 17 §2.6 ; 08 BR-PRICE-12, BR-PRICE-13,
 * BR-PRICE-14, BR-MOD-06, E7).
 *
 * Fonction **pure** et versionnée (`QUOTE_ENGINE_VERSION`) : aucune horloge, aucune base, aucune
 * constante de pays. Tout ce qui dépend du pays (devise, tolérance, règles fiscales, parts) arrive
 * dans `QuoteParams` (voir `params.ts`). Toute l'arithmétique passe par `@rueda/money`
 * (`multiplyRoundHalfUp`, `allocHost`, `sum`) : aucun arrondi local.
 *
 * - Prix du trip : `TRIP_PRICE` = prix journalier × jours facturables (`billableDays`).
 * - Trip fee (US-704 ; 08 BR-PRICE-06 ; 16 PRC-012) : `TRIP_FEE` = max(roundHalfUp(P × taux de la
 *   tranche de durée), minimum du pays), barème `trip_fee_schedule[pays]` ; jamais fourni par
 *   l'appelant. Il va entièrement à la jambe `PLATFORM` (complément de 08 E7).
 * - Protection du voyageur (US-226 ; 16 PRC-018, PRT-001, PRT-002, PRT-011 ; 08 BR-PRICE-11, E7) :
 *   quand le pays vend la protection (`protectionGrid`), `PROTECTION` = prix journalier de la
 *   protection × jours facturables, prix journalier = roundHalfUp(prix journalier net × part du
 *   niveau), borné par le plancher et le plafond du niveau ; jamais fourni par l'appelant. Le
 *   niveau est un choix du voyageur (`protectionLevel`), au moins le minimum du pays, refusé à un
 *   conducteur trop jeune ; la prime due (`insurer_premium_share[niveau]`) forme la jambe `INSURER`.
 * - Taxe **par ligne** : `roundHalfUp(ligne × taux du groupe)`, puis somme par groupe fiscal ;
 *   jamais l'arrondi du taux appliqué à la base agrégée (T43 : 0,70 + 0,70 = 1,40).
 * - Total TTC = Σ lignes + Σ taxes (BR-PRICE-13).
 * - Jambes de la capture du total (08 E7 `captureLegs`) par le moteur de règlement unique de
 *   `@rueda/money` : la taxe d'un groupe `third_party` forme la jambe `TAX_THIRD_PARTY`, sinon elle
 *   reste dans `PLATFORM` (BR-PRICE-12). Une jambe négative ⇒ `LEG_AMOUNT_NEGATIVE`.
 */
import {
  computeCaptureLegs,
  isMoneyError,
  isSettlementError,
  max,
  multiplyByInteger,
  multiplyRoundHalfUp,
  sum,
  zero,
  type Currency,
  type Legs,
  type Money,
  type Ratio,
  type RateType,
  type SettlementLine,
  type SettlementTrip,
} from '@rueda/money';
import { TAX_LINE_TYPES, type TaxLineType } from '../../../cfg/index.js';
import { billableDays } from './billable-days.js';
import { QuoteError } from './errors.js';

/** Version du moteur, figée dans chaque devis (une évolution du calcul = nouvelle version). */
export const QUOTE_ENGINE_VERSION = 'prc.quote/3';

/** Lignes typées du devis : énumération `LINES` de 08, mêmes noms que `tax_line_config`. */
export const QUOTE_LINE_TYPES = TAX_LINE_TYPES;
export type QuoteLineType = TaxLineType;

/** Lignes qui peuvent être négatives (promotions, 08 BR-PRICE-16) ; toutes les autres sont ≥ 0. */
const SIGNED_LINES: ReadonlySet<QuoteLineType> = new Set(['PROMO_PLATFORM', 'PROMO_HOST']);

/** Correspondance ligne du devis → ligne du moteur de règlement (08, pseudo-code `LINES`). */
export const SETTLEMENT_LINE_OF: Readonly<Record<QuoteLineType, SettlementLine>> = Object.freeze({
  TRIP_PRICE: 'tripPrice',
  PROMO_PLATFORM: 'promoPlatform',
  PROMO_HOST: 'promoHost',
  TRIP_FEE: 'tripFee',
  PROTECTION: 'protection',
  EXTRAS: 'extras',
  ENHANCED_ROADSIDE: 'enhancedRoadside',
  ADDITIONAL_DRIVER_FEE: 'additionalDriver',
  YOUNG_DRIVER_FEE: 'youngDriver',
  DELIVERY_FEE: 'delivery',
});

/** Règle fiscale d'une ligne (`tax_line_config` du pays, version en vigueur). */
export interface QuoteTaxRule {
  readonly lineType: QuoteLineType;
  readonly taxable: boolean;
  /** Groupe fiscal (ITBMS, IVA…) ; `null` si la ligne n'est pas taxable. */
  readonly group: string | null;
  /** Taux exact du groupe ; `null` si la ligne n'est pas taxable. */
  readonly rate: Ratio | null;
  /** Taxe collectée pour le compte d'un tiers : jambe `TAX_THIRD_PARTY` (défaut `false`). */
  readonly thirdParty: boolean;
}

/**
 * Tranche du barème du trip fee : s'applique aux trips de `maxDays` jours facturables au plus
 * (`null` : sans borne, dernière tranche seulement).
 */
export interface TripFeeTier {
  readonly maxDays: number | null;
  /** Taux exact de la tranche (`rateBps / 10 000`), dans [0 ; 1]. */
  readonly rate: Ratio;
}

/** Barème du trip fee du pays (`trip_fee_schedule`, 08 BR-PRICE-06 ; valeurs PROPOSÉES, OQ-MK-01). */
export interface TripFeeSchedule {
  /** Tranches par durée croissante ; la première dont `maxDays` couvre la durée s'applique. */
  readonly tiers: readonly TripFeeTier[];
  /** Minimum du trip fee, dans la devise du pays. */
  readonly min: Money;
}

/**
 * Conditions d'un niveau de protection du voyageur (grille du pays, `protection_grid`, US-226 ;
 * 16 PRC-018, PRT-002). Valeurs fixées avec l'assureur partenaire (valeurs de test du dépôt).
 */
export interface ProtectionTerms {
  /** Code du niveau (`BASICA`, `ESTANDAR`, `TOTAL`, 10b S05). */
  readonly level: string;
  /** Rang croissant avec la couverture ; le minimum du pays est un rang plancher. */
  readonly rank: number;
  /** Part du prix journalier net (08 BR-PRICE-11 : « % × prix journalier net »). */
  readonly price: Ratio;
  /** Âge minimal du conducteur, `null` : aucun (16 PRT-002). */
  readonly minDriverAge: number | null;
  /** Plancher et plafond du prix journalier de la protection, `null` : aucun. */
  readonly dailyFloor: Money | null;
  readonly dailyCeiling: Money | null;
}

/** Grille des protections du pays : niveaux vendus et minimum imposé (16 PRT-011). */
export interface ProtectionGrid {
  /** `guest_protection_min_level` : aucun niveau de rang inférieur n'est vendu. */
  readonly minLevel: string;
  readonly levels: readonly ProtectionTerms[];
}

/** Paramètres du pays figés dans le devis (instantané, 17 §2.6). */
export interface QuoteParams {
  readonly currency: Currency;
  /** `grace_minutes` (OQ-BR-04 ; 29 par défaut). */
  readonly graceMinutes: number;
  /** `max_trip_days` : au-delà, aucun devis (bêta : un seul segment de 30 j au plus, 17 §2.6). */
  readonly maxTripDays: number;
  /** Barème du trip fee (US-704). Lu par `computeQuote` seulement : `assembleQuote` reçoit F chiffré. */
  readonly tripFeeSchedule: TripFeeSchedule;
  readonly taxRules: readonly QuoteTaxRule[];
  /** Part de l'hôte figée (plan de l'hôte, 08 BR-PROT-06 ; `host_share_pct_frozen`). */
  readonly hostSharePct: Ratio;
  readonly deliverySharePct: Ratio;
  readonly extrasSharePct: Ratio;
  /** Parts de l'assureur figées (08 E7) ; absentes ⇒ aucune ligne de protection ou d'assistance. */
  readonly insurerPremiumShare?: Ratio;
  readonly insurerRoadsideShare?: Ratio;
  /**
   * Grille des protections du pays (US-226). Présente ⇒ la ligne `PROTECTION` est calculée par
   * `computeQuote` et un niveau est exigé ; absente (vecteurs de 08 rejoués ligne à ligne) ⇒ la
   * ligne reste une entrée.
   */
  readonly protectionGrid?: ProtectionGrid;
  /** Parts de l'assureur par niveau (`insurer_premium_share[niveau]`), figées au choix du niveau. */
  readonly insurerPremiumShareByLevel?: Readonly<Record<string, Ratio>>;
  /** Plan de gains de l'hôte retenu (08 BR-PROT-06 ; défaut `host_default_plan`), figé au devis. */
  readonly hostPlan?: string;
}

/**
 * Lignes calculées par le moteur, jamais fournies par l'appelant (L2-PM-03). `PROTECTION` l'est
 * dès que le pays vend la protection (US-226).
 */
export const COMPUTED_LINE_TYPES = Object.freeze(['TRIP_PRICE', 'TRIP_FEE'] as const);
type ComputedLineType = (typeof COMPUTED_LINE_TYPES)[number];

/** Lignes autres que le prix du trip et le trip fee, chiffrées par d'autres stories (US-226…). */
export type QuoteExtraLines = Readonly<
  Partial<Record<Exclude<QuoteLineType, ComputedLineType>, Money>>
>;

/** Demande de devis. Tous les montants viennent du serveur (annonce, barèmes), jamais du client. */
export interface QuoteRequest {
  /** Début et fin planifiés, instants UTC en ms. */
  readonly startAtMs: number;
  readonly endAtMs: number;
  /** Instant serveur du devis (`platform.now()` lu par l'appelant), devenu instant de réservation. */
  readonly quotedAtMs: number;
  readonly rateType: RateType;
  /** Prix journalier de l'annonce (unités mineures, devise du pays). */
  readonly dailyRate: Money;
  readonly lines?: QuoteExtraLines;
  /** Niveau de protection choisi (US-226) ; exigé quand le pays vend la protection. */
  readonly protectionLevel?: string;
  /** Âge déclaré du conducteur (16 BKG-003 : saisi avant le choix du niveau), années entières. */
  readonly driverAge?: number;
  /**
   * Distance de l'annonce (US-205b ; 16 LST-012 ; 08 BR-MILEAGE-01), figée avec le devis :
   * absente ⇒ le devis ne porte aucune distance (devis antérieurs, compatibles).
   */
  readonly mileage?: QuoteMileageInput;
}

/** Distance de l'annonce au devis : illimitée, ou km par jour et prix du km supplémentaire. */
export type QuoteMileageInput =
  | { readonly mode: 'UNLIMITED' }
  | { readonly mode: 'INCLUDED'; readonly kmPerDay: number; readonly extraKmPrice: Money };

/**
 * Distance figée du devis (US-205b ; 19 US-205 critère 2 : « 600 km incluidos » et le même prix
 * du km sur la fiche, le checkout, le contrat et le reçu) : km par jour × jours facturables.
 */
export type QuoteMileage =
  | { readonly mode: 'UNLIMITED' }
  | {
      readonly mode: 'INCLUDED';
      readonly kmPerDay: number;
      readonly includedKm: number;
      readonly extraKmPrice: Money;
    };

export interface QuoteLine {
  readonly type: QuoteLineType;
  readonly amount: Money;
  /** Groupe fiscal de la ligne, ou `null` si elle n'est pas taxable. */
  readonly taxGroup: string | null;
  /** Taxe de la ligne, arrondie par ligne (`roundHalfUp`). */
  readonly tax: Money;
}

export interface QuoteTaxGroup {
  readonly id: string;
  readonly rate: Ratio;
  readonly lineTypes: readonly QuoteLineType[];
  /** Σ des taxes de ligne arrondies du groupe. */
  readonly tax: Money;
  readonly thirdParty: boolean;
}

export interface Quote {
  readonly engineVersion: string;
  readonly currency: Currency;
  readonly startAtMs: number;
  readonly endAtMs: number;
  readonly quotedAtMs: number;
  readonly rateType: RateType;
  readonly billableDays: number;
  /** Lignes présentes, dans l'ordre de `QUOTE_LINE_TYPES`. */
  readonly lines: readonly QuoteLine[];
  readonly taxGroups: readonly QuoteTaxGroup[];
  /** Σ lignes (hors taxes). */
  readonly subtotal: Money;
  /** Σ taxes, dont `taxThirdParty`. */
  readonly taxTotal: Money;
  readonly taxThirdParty: Money;
  /** Total TTC payé par le voyageur. */
  readonly total: Money;
  /** Jambes de la capture du total (08 E7) : Σ = `total`, chaque jambe ≥ 0. */
  readonly legs: Legs;
  readonly hostSharePct: Ratio;
  readonly deliverySharePct: Ratio;
  readonly extrasSharePct: Ratio;
  readonly insurerPremiumShare?: Ratio;
  readonly insurerRoadsideShare?: Ratio;
  /** Niveau de protection figé (US-226), absent sans grille. */
  readonly protectionLevel?: string;
  /** Plan de gains de l'hôte figé (US-226), absent si l'instantané ne le nomme pas. */
  readonly hostPlan?: string;
  /** Distance figée (US-205b), absente si la demande n'en porte pas. */
  readonly mileage?: QuoteMileage;
}

/** Lignes déjà chiffrées (prix du trip compris) : entrée de `assembleQuote`. */
export interface PricedPeriod {
  readonly startAtMs: number;
  readonly endAtMs: number;
  readonly quotedAtMs: number;
  readonly rateType: RateType;
  readonly billableDays: number;
  readonly lines: Readonly<Partial<Record<QuoteLineType, Money>>>;
  /** Niveau de protection retenu par `computeQuote` (US-226). */
  readonly protectionLevel?: string;
}

function checkAmount(type: string, value: unknown, currency: Currency): Money {
  try {
    // `sum` refuse un faux `Money` et une autre devise (MONEY_CURRENCY_MISMATCH).
    return sum(currency, [value as Money]);
  } catch (cause) {
    throw new QuoteError('QUOTE_INPUT_INVALID', `${type} : montant de la devise du pays attendu`, {
      cause,
    });
  }
}

function checkRatio(name: string, value: Ratio | undefined): void {
  if (value === undefined) return;
  if (value.num < 0n || value.num > value.den) {
    throw new QuoteError('QUOTE_UNAVAILABLE', `${name} hors de [0 ; 1]`);
  }
}

/** Index des règles fiscales, contrôlé fail-closed (16 PRC-020 : configuration absente ⇒ refus). */
function taxRuleIndex(rules: readonly QuoteTaxRule[]): ReadonlyMap<QuoteLineType, QuoteTaxRule> {
  const byLine = new Map<QuoteLineType, QuoteTaxRule>();
  const groups = new Map<string, QuoteTaxRule>();
  for (const rule of rules) {
    if (!QUOTE_LINE_TYPES.includes(rule.lineType)) {
      throw new QuoteError('TAX_CONFIG_MISSING', `type de ligne inconnu « ${rule.lineType} »`);
    }
    if (byLine.has(rule.lineType)) {
      throw new QuoteError('TAX_CONFIG_MISSING', `règle en double pour ${rule.lineType}`);
    }
    if (rule.taxable) {
      if (rule.group === null || rule.group === '' || rule.rate === null) {
        throw new QuoteError('TAX_CONFIG_MISSING', `${rule.lineType} : groupe et taux requis`);
      }
      if (rule.rate.num < 0n || rule.rate.den <= 0n) {
        throw new QuoteError('TAX_CONFIG_MISSING', `${rule.lineType} : taux négatif ou invalide`);
      }
      const first = groups.get(rule.group);
      if (
        first !== undefined &&
        (first.rate === null ||
          first.rate.num * rule.rate.den !== rule.rate.num * first.rate.den ||
          first.thirdParty !== rule.thirdParty)
      ) {
        throw new QuoteError(
          'TAX_CONFIG_MISSING',
          `groupe ${rule.group} : taux ou third_party différents selon la ligne`,
        );
      }
      if (first === undefined) groups.set(rule.group, rule);
    } else if (rule.thirdParty) {
      throw new QuoteError('TAX_CONFIG_MISSING', `${rule.lineType} non taxable mais third_party`);
    }
    byLine.set(rule.lineType, rule);
  }
  return byLine;
}

/**
 * Assemble un devis à partir de lignes déjà chiffrées : taxe par ligne, groupes, total, jambes.
 * Exposée pour rejouer les vecteurs de 08 (lignes données) ; le parcours normal est `computeQuote`.
 */
export function assembleQuote(period: PricedPeriod, params: QuoteParams): Quote {
  const c = params.currency;
  checkRatio('hostSharePct', params.hostSharePct);
  checkRatio('deliverySharePct', params.deliverySharePct);
  checkRatio('extrasSharePct', params.extrasSharePct);
  checkRatio('insurerPremiumShare', params.insurerPremiumShare);
  checkRatio('insurerRoadsideShare', params.insurerRoadsideShare);
  if (!Number.isSafeInteger(period.billableDays) || period.billableDays < 1) {
    throw new QuoteError('QUOTE_INPUT_INVALID', 'jours facturables : entier ≥ 1 attendu');
  }
  for (const name of Object.keys(period.lines)) {
    if (!QUOTE_LINE_TYPES.includes(name as QuoteLineType)) {
      throw new QuoteError('QUOTE_INPUT_INVALID', `ligne inconnue « ${name} »`);
    }
  }
  const rules = taxRuleIndex(params.taxRules);

  const lines: QuoteLine[] = [];
  for (const type of QUOTE_LINE_TYPES) {
    const raw = period.lines[type];
    if (raw === undefined) continue;
    const amount = checkAmount(type, raw, c);
    if (amount.amountMinor < 0n && !SIGNED_LINES.has(type)) {
      throw new QuoteError('QUOTE_INPUT_INVALID', `${type} : montant négatif refusé`);
    }
    if (amount.amountMinor === 0n) continue;
    const rule = rules.get(type);
    if (rule === undefined) {
      throw new QuoteError('TAX_CONFIG_MISSING', `aucune règle fiscale pour ${type}`);
    }
    const tax =
      rule.taxable && rule.rate !== null ? multiplyRoundHalfUp(amount, rule.rate) : zero(c);
    lines.push(Object.freeze({ type, amount, taxGroup: rule.taxable ? rule.group : null, tax }));
  }
  const tripPrice = lines.find((l) => l.type === 'TRIP_PRICE');
  if (tripPrice === undefined || tripPrice.amount.amountMinor <= 0n) {
    throw new QuoteError('QUOTE_INPUT_INVALID', 'TRIP_PRICE : montant strictement positif requis');
  }

  const groupIds = [...new Set(lines.flatMap((l) => (l.taxGroup === null ? [] : [l.taxGroup])))];
  const taxGroups: QuoteTaxGroup[] = groupIds.map((id) => {
    const members = lines.filter((l) => l.taxGroup === id);
    const rule = rules.get(members[0]!.type)!;
    return Object.freeze({
      id,
      rate: rule.rate!,
      lineTypes: Object.freeze(members.map((l) => l.type)),
      tax: sum(
        c,
        members.map((l) => l.tax),
      ),
      thirdParty: rule.thirdParty,
    });
  });

  const subtotal = sum(
    c,
    lines.map((l) => l.amount),
  );
  const taxTotal = sum(
    c,
    taxGroups.map((g) => g.tax),
  );
  const taxThirdParty = sum(
    c,
    taxGroups.filter((g) => g.thirdParty).map((g) => g.tax),
  );
  const total = sum(c, [subtotal, taxTotal]);
  if (total.amountMinor <= 0n) {
    throw new QuoteError('QUOTE_INPUT_INVALID', 'total TTC : montant strictement positif requis');
  }

  const base = {
    engineVersion: QUOTE_ENGINE_VERSION,
    currency: c,
    startAtMs: period.startAtMs,
    endAtMs: period.endAtMs,
    quotedAtMs: period.quotedAtMs,
    rateType: period.rateType,
    billableDays: period.billableDays,
    lines: Object.freeze(lines),
    taxGroups: Object.freeze(taxGroups),
    subtotal,
    taxTotal,
    taxThirdParty,
    total,
    hostSharePct: params.hostSharePct,
    deliverySharePct: params.deliverySharePct,
    extrasSharePct: params.extrasSharePct,
    ...(params.insurerPremiumShare === undefined
      ? {}
      : { insurerPremiumShare: params.insurerPremiumShare }),
    ...(params.insurerRoadsideShare === undefined
      ? {}
      : { insurerRoadsideShare: params.insurerRoadsideShare }),
    ...(period.protectionLevel === undefined ? {} : { protectionLevel: period.protectionLevel }),
    ...(params.hostPlan === undefined ? {} : { hostPlan: params.hostPlan }),
  };
  const legs = captureLegsOf(base);
  return Object.freeze({ ...base, legs });
}

function captureLegsOf(quote: Omit<Quote, 'legs'>): Legs {
  let legs: Legs;
  try {
    legs = computeCaptureLegs(quoteSettlementTrip(quote));
  } catch (cause) {
    if (isSettlementError(cause) || isMoneyError(cause)) {
      throw new QuoteError('QUOTE_UNAVAILABLE', `jambes impossibles : ${cause.message}`, { cause });
    }
    throw cause;
  }
  for (const leg of ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const) {
    if (legs[leg].amountMinor < 0n) {
      throw new QuoteError('LEG_AMOUNT_NEGATIVE', `jambe ${leg} négative`);
    }
  }
  if (legs.total.amountMinor !== quote.total.amountMinor) {
    throw new QuoteError('QUOTE_UNAVAILABLE', 'Σ jambes ≠ total du devis');
  }
  return legs;
}

/**
 * Trip du moteur de règlement tiré du devis figé (08, segment unique ≤ 30 j) : le règlement d'une
 * annulation, les remboursements et les jambes partent de ce devis (16 PRC-025).
 */
export function quoteSettlementTrip(quote: Omit<Quote, 'legs'>): SettlementTrip {
  const c = quote.currency;
  const lines: Partial<Record<SettlementLine, Money>> = {};
  for (const l of quote.lines) lines[SETTLEMENT_LINE_OF[l.type]] = l.amount;
  return {
    currency: c,
    days: quote.billableDays,
    rateType: quote.rateType,
    startAtMs: quote.startAtMs,
    bookedAtMs: quote.quotedAtMs,
    lines,
    taxGroups: quote.taxGroups.map((g) => ({
      id: g.id,
      lines: g.lineTypes.map((t) => SETTLEMENT_LINE_OF[t]),
      taxPaid: g.tax,
      thirdParty: g.thirdParty,
    })),
    totalPaid: quote.total,
    hostSharePctFrozen: quote.hostSharePct,
    deliverySharePct: quote.deliverySharePct,
    extrasSharePct: quote.extrasSharePct,
    ...(quote.insurerPremiumShare === undefined
      ? {}
      : { insurerPremiumShareFrozen: quote.insurerPremiumShare }),
    ...(quote.insurerRoadsideShare === undefined
      ? {}
      : { insurerRoadsideShareFrozen: quote.insurerRoadsideShare }),
  };
}

/** Devis d'une période : jours facturables, prix du trip = prix journalier × jours, puis assemblage. */
export function computeQuote(request: QuoteRequest, params: QuoteParams): Quote {
  if (!Number.isSafeInteger(request.quotedAtMs)) {
    throw new QuoteError('QUOTE_INPUT_INVALID', 'quotedAtMs : instant UTC en ms attendu');
  }
  if (request.rateType !== 'REFUNDABLE' && request.rateType !== 'NON_REFUNDABLE') {
    throw new QuoteError('QUOTE_INPUT_INVALID', 'rateType inconnu');
  }
  if (!Number.isSafeInteger(params.maxTripDays) || params.maxTripDays < 1) {
    throw new QuoteError('QUOTE_UNAVAILABLE', 'max_trip_days : entier ≥ 1 attendu');
  }
  const days = billableDays(request.startAtMs, request.endAtMs, params.graceMinutes);
  if (days > params.maxTripDays) {
    throw new QuoteError(
      'QUOTE_UNAVAILABLE',
      `durée de ${days} j au-delà de max_trip_days (${params.maxTripDays})`,
    );
  }
  const dailyRate = checkAmount('dailyRate', request.dailyRate, params.currency);
  if (dailyRate.amountMinor <= 0n) {
    throw new QuoteError('QUOTE_INPUT_INVALID', 'dailyRate : montant strictement positif requis');
  }
  const extra = request.lines ?? {};
  for (const type of COMPUTED_LINE_TYPES) {
    if (Object.prototype.hasOwnProperty.call(extra, type)) {
      throw new QuoteError('QUOTE_INPUT_INVALID', `${type} est calculé, jamais fourni`);
    }
  }
  if (
    params.protectionGrid !== undefined &&
    Object.prototype.hasOwnProperty.call(extra, 'PROTECTION')
  ) {
    throw new QuoteError('QUOTE_INPUT_INVALID', 'PROTECTION est calculée, jamais fournie');
  }
  const tripPrice = multiplyByInteger(dailyRate, BigInt(days));
  const protection = protectionOf(request, params, dailyRate, days);
  const mileage =
    request.mileage === undefined ? undefined : mileageOf(request.mileage, days, params.currency);
  const quote = assembleQuote(
    {
      startAtMs: request.startAtMs,
      endAtMs: request.endAtMs,
      quotedAtMs: request.quotedAtMs,
      rateType: request.rateType,
      billableDays: days,
      lines: {
        ...extra,
        TRIP_PRICE: tripPrice,
        TRIP_FEE: tripFeeOf(tripPrice, days, params.tripFeeSchedule, params.currency),
        ...(protection === null ? {} : { PROTECTION: protection.line }),
      },
      ...(protection === null ? {} : { protectionLevel: protection.terms.level }),
    },
    protection === null ? params : withLevelShare(params, protection.terms.level),
  );
  return mileage === undefined ? quote : { ...quote, mileage };
}

/** Plus grand nombre de km par jour d'une annonce (contrainte de `catalog_listing`, 0067). */
const MAX_KM_PER_DAY = 10_000;

/**
 * Distance figée (US-205b ; 16 LST-012) : km inclus = km par jour × jours facturables (les mêmes
 * que le prix du trip) ; prix du km supplémentaire de l'hôte, dans la devise du pays. Forme
 * inattendue ⇒ `QUOTE_INPUT_INVALID` (jamais une distance devinée).
 */
export function mileageOf(
  input: QuoteMileageInput,
  days: number,
  currency: Currency,
): QuoteMileage {
  if (input.mode === 'UNLIMITED') return { mode: 'UNLIMITED' };
  if (input.mode !== 'INCLUDED') {
    throw new QuoteError('QUOTE_INPUT_INVALID', 'mileage.mode : UNLIMITED ou INCLUDED attendu');
  }
  if (
    !Number.isSafeInteger(input.kmPerDay) ||
    input.kmPerDay < 1 ||
    input.kmPerDay > MAX_KM_PER_DAY
  ) {
    throw new QuoteError('QUOTE_INPUT_INVALID', 'mileage.kmPerDay : entier de 1 à 10 000 attendu');
  }
  const extra = checkAmount('mileage.extraKmPrice', input.extraKmPrice, currency);
  if (extra.amountMinor < 0n) {
    throw new QuoteError('QUOTE_INPUT_INVALID', 'mileage.extraKmPrice : montant ≥ 0 attendu');
  }
  return {
    mode: 'INCLUDED',
    kmPerDay: input.kmPerDay,
    includedKm: input.kmPerDay * days,
    extraKmPrice: extra,
  };
}

/**
 * Instantané avec la part de l'assureur du niveau choisi (`insurer_premium_share[niveau]`, 08
 * E7) : seule la part du niveau compte ; absente ⇒ aucune part, la ligne de protection est alors
 * refusée par les jambes (`QUOTE_UNAVAILABLE`, jamais une prime nulle).
 */
function withLevelShare(params: QuoteParams, level: string): QuoteParams {
  const share = params.insurerPremiumShareByLevel?.[level];
  const next: { -readonly [K in keyof QuoteParams]: QuoteParams[K] } = { ...params };
  delete next.insurerPremiumShare;
  if (share !== undefined) next.insurerPremiumShare = share;
  return next;
}

/** Âge déclaré : entier sûr de 0 à 150, sinon entrée invalide. */
function checkDriverAge(age: number | undefined): void {
  if (age === undefined) return;
  if (!Number.isSafeInteger(age) || age < 0 || age > 150) {
    throw new QuoteError('QUOTE_INPUT_INVALID', 'driverAge : entier de 0 à 150 attendu');
  }
}

/** Grille cohérente (rangs distincts, parts et bornes valides, minimum connu), sinon BLOCK. */
function checkGrid(grid: ProtectionGrid, currency: Currency): ProtectionTerms {
  const ranks = new Set<number>();
  for (const t of grid.levels) {
    if (
      !Number.isSafeInteger(t.rank) ||
      t.rank < 1 ||
      ranks.has(t.rank) ||
      t.price.den <= 0n ||
      t.price.num < 0n ||
      t.price.num > t.price.den ||
      (t.minDriverAge !== null && !Number.isSafeInteger(t.minDriverAge))
    ) {
      throw new QuoteError('QUOTE_UNAVAILABLE', `protection_grid : niveau ${t.level} invalide`);
    }
    ranks.add(t.rank);
    for (const bound of [t.dailyFloor, t.dailyCeiling]) {
      if (bound === null) continue;
      const b = checkAmount(`protection_grid ${t.level}`, bound, currency);
      if (b.amountMinor < 0n) {
        throw new QuoteError('QUOTE_UNAVAILABLE', `protection_grid : borne négative (${t.level})`);
      }
    }
    if (
      t.dailyFloor !== null &&
      t.dailyCeiling !== null &&
      t.dailyFloor.amountMinor > t.dailyCeiling.amountMinor
    ) {
      throw new QuoteError(
        'QUOTE_UNAVAILABLE',
        `protection_grid : plancher > plafond (${t.level})`,
      );
    }
  }
  const min = grid.levels.find((t) => t.level === grid.minLevel);
  if (min === undefined) {
    throw new QuoteError('QUOTE_UNAVAILABLE', 'guest_protection_min_level absent de la grille');
  }
  return min;
}

/**
 * Conditions du niveau demandé (16 PRT-001, PRT-002, PRT-011) : grille cohérente (sinon
 * `QUOTE_UNAVAILABLE`), niveau connu, au moins le minimum du pays et permis à l'âge déclaré (sinon
 * `PROTECTION_LEVEL_NOT_ELIGIBLE`). Âge absent : un niveau qui exige un âge est refusé.
 */
export function protectionTermsOf(
  grid: ProtectionGrid,
  level: string,
  driverAge: number | undefined,
  currency: Currency,
): ProtectionTerms {
  checkDriverAge(driverAge);
  const min = checkGrid(grid, currency);
  const terms = grid.levels.find((t) => t.level === level);
  if (terms === undefined || terms.rank < min.rank) {
    throw new QuoteError('PROTECTION_LEVEL_NOT_ELIGIBLE', `niveau ${level} non vendu`);
  }
  if (terms.minDriverAge !== null && (driverAge === undefined || driverAge < terms.minDriverAge)) {
    throw new QuoteError('PROTECTION_LEVEL_NOT_ELIGIBLE', `niveau ${level} : âge du conducteur`);
  }
  return terms;
}

/**
 * Prix journalier de la protection (16 PRC-018 ; 08 BR-PRICE-11) : roundHalfUp(prix journalier net
 * × part du niveau), borné par le plancher puis le plafond du niveau.
 */
export function protectionDailyPrice(dailyRate: Money, terms: ProtectionTerms): Money {
  let daily = multiplyRoundHalfUp(dailyRate, terms.price);
  if (terms.dailyFloor !== null) daily = max(daily, terms.dailyFloor);
  if (terms.dailyCeiling !== null && daily.amountMinor > terms.dailyCeiling.amountMinor) {
    daily = terms.dailyCeiling;
  }
  return daily;
}

/** Ligne `PROTECTION` du devis (US-226), `null` si le pays ne vend pas la protection. */
function protectionOf(
  request: QuoteRequest,
  params: QuoteParams,
  dailyRate: Money,
  days: number,
): { readonly terms: ProtectionTerms; readonly line: Money } | null {
  const grid = params.protectionGrid;
  if (grid === undefined) {
    if (request.protectionLevel !== undefined || request.driverAge !== undefined) {
      throw new QuoteError('QUOTE_UNAVAILABLE', 'protection demandée, aucune grille du pays');
    }
    return null;
  }
  if (typeof request.protectionLevel !== 'string' || request.protectionLevel === '') {
    throw new QuoteError('PROTECTION_LEVEL_REQUIRED', 'niveau de protection requis');
  }
  const terms = protectionTermsOf(
    grid,
    request.protectionLevel,
    request.driverAge,
    params.currency,
  );
  return { terms, line: multiplyByInteger(protectionDailyPrice(dailyRate, terms), BigInt(days)) };
}

/** Offre d'un niveau de protection pour une période (écran S05, US-226 ; 16 BKG-003). */
export interface ProtectionOption {
  readonly level: string;
  readonly rank: number;
  /** `false` : niveau refusé à l'âge déclaré (grisé avec sa raison, 16 PRT-001). */
  readonly eligible: boolean;
  readonly reason: 'DRIVER_AGE' | null;
  readonly minDriverAge: number | null;
  readonly daily: Money;
  /** Ligne `PROTECTION` du devis avec ce niveau (prix journalier × jours facturables). */
  readonly line: Money;
}

/**
 * Niveaux vendus (au moins le minimum du pays), par rang croissant, avec leur prix pour la
 * période ; un niveau refusé à l'âge déclaré reste listé, inéligible (16 PRT-001, BKG-003).
 * Sans grille : aucun niveau.
 */
export function protectionOptions(
  params: QuoteParams,
  dailyRate: Money,
  billableDayCount: number,
  driverAge: number | undefined,
): readonly ProtectionOption[] {
  const grid = params.protectionGrid;
  if (grid === undefined) return [];
  checkDriverAge(driverAge);
  if (!Number.isSafeInteger(billableDayCount) || billableDayCount < 1) {
    throw new QuoteError('QUOTE_INPUT_INVALID', 'jours facturables : entier ≥ 1 attendu');
  }
  const rate = checkAmount('dailyRate', dailyRate, params.currency);
  const min = checkGrid(grid, params.currency);
  return [...grid.levels]
    .filter((t) => t.rank >= min.rank)
    .sort((a, b) => a.rank - b.rank)
    .map((t) => {
      const eligible =
        t.minDriverAge === null || (driverAge !== undefined && driverAge >= t.minDriverAge);
      const daily = protectionDailyPrice(rate, t);
      return Object.freeze({
        level: t.level,
        rank: t.rank,
        eligible,
        reason: eligible ? null : ('DRIVER_AGE' as const),
        minDriverAge: t.minDriverAge,
        daily,
        line: multiplyByInteger(daily, BigInt(billableDayCount)),
      });
    });
}

/**
 * Trip fee du voyageur (US-704 ; 08 BR-PRICE-06, recommandation [NOUS] appliquée telle quelle,
 * Q-004 ; 16 PRC-012) : `max(roundHalfUp(P × taux), minimum)`, le taux étant celui de la première
 * tranche dont `maxDays` couvre les jours facturables. P est le prix du trip après remises (08 :
 * « le trip fee est calculé après les remises, sur le prix net P ») ; les lignes promotionnelles
 * n'en changent pas l'assiette. Barème incohérent (aucune tranche, bornes non croissantes, taux
 * hors de [0 ; 1], minimum négatif ou d'une autre devise, durée non couverte) ⇒ `QUOTE_UNAVAILABLE`
 * (fail-closed : `failMode` BLOCK du paramètre).
 */
export function tripFeeOf(
  tripPrice: Money,
  days: number,
  schedule: TripFeeSchedule | undefined,
  currency: Currency,
): Money {
  if (schedule === undefined || !Array.isArray(schedule.tiers) || schedule.tiers.length === 0) {
    throw new QuoteError('QUOTE_UNAVAILABLE', 'trip_fee_schedule : barème absent');
  }
  let min: Money;
  try {
    min = sum(currency, [schedule.min]);
  } catch (cause) {
    throw new QuoteError(
      'QUOTE_UNAVAILABLE',
      'trip_fee_schedule : minimum de la devise du pays attendu',
      {
        cause,
      },
    );
  }
  if (min.amountMinor < 0n) {
    throw new QuoteError('QUOTE_UNAVAILABLE', 'trip_fee_schedule : minimum négatif');
  }
  let previous = 0;
  let chosen: TripFeeTier | undefined;
  schedule.tiers.forEach((tier, i) => {
    const last = i === schedule.tiers.length - 1;
    const bounded = tier.maxDays !== null;
    if (
      (bounded && (!Number.isSafeInteger(tier.maxDays) || tier.maxDays! <= previous)) ||
      (!bounded && !last) ||
      tier.rate.num < 0n ||
      tier.rate.den <= 0n ||
      tier.rate.num > tier.rate.den
    ) {
      throw new QuoteError('QUOTE_UNAVAILABLE', `trip_fee_schedule : tranche ${i + 1} invalide`);
    }
    if (bounded) previous = tier.maxDays!;
    if (chosen === undefined && (!bounded || days <= tier.maxDays!)) chosen = tier;
  });
  if (chosen === undefined) {
    throw new QuoteError('QUOTE_UNAVAILABLE', `trip_fee_schedule : aucune tranche pour ${days} j`);
  }
  return max(multiplyRoundHalfUp(tripPrice, chosen.rate), min);
}
