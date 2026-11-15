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
export const QUOTE_ENGINE_VERSION = 'prc.quote/2';

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
}

/** Lignes calculées par le moteur, jamais fournies par l'appelant (L2-PM-03). */
export const COMPUTED_LINE_TYPES = Object.freeze(['TRIP_PRICE', 'TRIP_FEE'] as const);
type ComputedLineType = (typeof COMPUTED_LINE_TYPES)[number];

/** Lignes autres que le prix du trip et le trip fee, chiffrées par d'autres stories (US-226…). */
export type QuoteExtraLines = Readonly<Partial<Record<Exclude<QuoteLineType, ComputedLineType>, Money>>>;

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
}

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
}

/** Lignes déjà chiffrées (prix du trip compris) : entrée de `assembleQuote`. */
export interface PricedPeriod {
  readonly startAtMs: number;
  readonly endAtMs: number;
  readonly quotedAtMs: number;
  readonly rateType: RateType;
  readonly billableDays: number;
  readonly lines: Readonly<Partial<Record<QuoteLineType, Money>>>;
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
  const tripPrice = multiplyByInteger(dailyRate, BigInt(days));
  return assembleQuote(
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
      },
    },
    params,
  );
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
    throw new QuoteError('QUOTE_UNAVAILABLE', 'trip_fee_schedule : minimum de la devise du pays attendu', {
      cause,
    });
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
