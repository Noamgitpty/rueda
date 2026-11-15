/**
 * Soutien des tests du devis PRC (US-202), hors des sources (exclu du build). Il ne calcule **aucun attendu** : il traduit des
 * **entrées** (trips des vecteurs dorés de `docs/specs/tools/golden_vectors.json`, trips de test de
 * 08 E7 recopiés par `@rueda/money/testing`, configuration pays du dépôt) en entrées du moteur.
 * Aucun code de pays ni de devise n'est écrit ici : ils sont lus des données (ADR-024).
 */
import {
  createCurrencyRegistry,
  money,
  ratio,
  type Currency,
  type Money,
  type Ratio,
  type SettlementLine,
  type SettlementTrip,
} from '@rueda/money';
import { loadGoldenVectors, type GoldenRatio, type GoldenTrip } from '@rueda/money/golden-vectors';
import { CountryConfigService, type CountryConfig } from '../../src/modules/cfg/index.js';
import {
  QUOTE_LINE_TYPES,
  SETTLEMENT_LINE_OF,
  resolveQuoteParams,
  type PricedPeriod,
  type QuoteLineType,
  type QuoteParams,
  type QuoteTaxRule,
  type TripFeeSchedule,
} from '../../src/modules/prc/index.js';

export const golden = loadGoldenVectors();
export const goldenRegistry = createCurrencyRegistry([...golden.currencies.values()]);

/** Configuration pays du dépôt (`apps/api/src/modules/cfg/data/`). */
export const repoConfig: CountryConfig = new CountryConfigService().config;

/** Pays du dépôt dont la devise est `currencyCode` (lu des données, jamais écrit). */
export function countryOfCurrency(currencyCode: string): string {
  const found = [...repoConfig.countries.values()].filter((c) => c.currency.code === currencyCode);
  if (found.length !== 1) throw new Error(`un seul pays attendu pour la devise ${currencyCode}`);
  return found[0]!.code;
}

/** Départ arbitraire des trips de test (seuls les écarts comptent). */
export const T0_MS = Date.UTC(2026, 0, 14, 15, 0, 0);
export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

const QUOTE_LINE_OF = Object.fromEntries(
  QUOTE_LINE_TYPES.map((t) => [SETTLEMENT_LINE_OF[t], t]),
) as Record<SettlementLine, QuoteLineType>;

export const toRatio = (r: GoldenRatio): Ratio => ratio(r.numerator, r.denominator);

/** Instant de lecture de la configuration du dépôt dans les tests. */
export const CONFIG_AT = new Date('2026-12-01T12:00:00.000Z');

/** Barème du trip fee du dépôt (`trip_fee_schedule`) pour le pays de la devise `currency`. */
export function repoTripFeeSchedule(currency: Currency): TripFeeSchedule {
  const country = countryOfCurrency(currency.code);
  const s = resolveQuoteParams(repoConfig, { country, at: CONFIG_AT }).tripFeeSchedule;
  return { tiers: s.tiers, min: money(s.min.amountMinor, currency) };
}

/**
 * Barème de test (US-704) : tranches `[maxDays, rateBps]` et minimum en unités mineures. Une
 * entrée du test, jamais un attendu.
 */
export function testTripFeeSchedule(
  currency: Currency,
  tiers: readonly (readonly [number | null, number])[],
  minMinor: bigint,
): TripFeeSchedule {
  return {
    tiers: tiers.map(([maxDays, bps]) => ({ maxDays, rate: ratio(BigInt(bps), 10_000n) })),
    min: money(minMinor, currency),
  };
}

/** Parts assureur de la configuration de test de 08 E7 (« valeurs de test » : 7/10 et 1/2). */
export const TEST_INSURER = {
  insurerPremiumShare: ratio(7n, 10n),
  insurerRoadsideShare: ratio(1n, 2n),
} as const;

/** Règles fiscales : chaque ligne d'un groupe est taxable à son taux ; les autres ne le sont pas. */
export function rulesOf(
  groups: readonly {
    readonly id: string;
    readonly rate: Ratio;
    readonly lines: readonly SettlementLine[];
    readonly thirdParty?: boolean;
  }[],
): QuoteTaxRule[] {
  return QUOTE_LINE_TYPES.map((lineType) => {
    const g = groups.find((x) => x.lines.includes(SETTLEMENT_LINE_OF[lineType]));
    return g === undefined
      ? { lineType, taxable: false, group: null, rate: null, thirdParty: false }
      : { lineType, taxable: true, group: g.id, rate: g.rate, thirdParty: g.thirdParty ?? false };
  });
}

export interface QuoteCase {
  readonly period: PricedPeriod;
  readonly params: QuoteParams;
}

function linesOf(lines: Readonly<Partial<Record<SettlementLine, Money>>>) {
  const out: Partial<Record<QuoteLineType, Money>> = {};
  for (const [name, amount] of Object.entries(lines)) {
    if (amount !== undefined) out[QUOTE_LINE_OF[name as SettlementLine]] = amount;
  }
  return out;
}

/** Trip d'un vecteur doré de règlement → entrées du moteur de devis. */
export function caseOfGoldenTrip(t: GoldenTrip): QuoteCase {
  const currency: Currency = goldenRegistry.get(t.currency);
  const lines: Partial<Record<SettlementLine, Money>> = {};
  for (const [name, amount] of Object.entries(t.linesMinor)) {
    lines[name as SettlementLine] = money(amount, currency);
  }
  return {
    period: {
      startAtMs: T0_MS,
      endAtMs: T0_MS + t.days * DAY_MS,
      quotedAtMs: T0_MS + t.bookedAtMinutes * MINUTE_MS,
      rateType: t.rate,
      billableDays: t.days,
      lines: linesOf(lines),
    },
    params: {
      currency,
      graceMinutes: 29,
      maxTripDays: 30,
      // F des vecteurs est une ligne donnée (assembleQuote) ; barème du dépôt pour computeQuote
      tripFeeSchedule: repoTripFeeSchedule(currency),
      taxRules: rulesOf(
        t.taxGroups.map((g) => ({ id: g.id, rate: toRatio(g.rate), lines: g.lines })),
      ),
      hostSharePct: toRatio(t.hostSharePct),
      deliverySharePct: toRatio(t.deliverySharePct),
      extrasSharePct: toRatio(t.extrasSharePct),
      ...TEST_INSURER,
    },
  };
}

/**
 * Trip de test de 08 E7 (`@rueda/money/testing`) → entrées du moteur. Ces trips ne portent pas le
 * taux de leurs groupes : il est donné par l'appelant (taux de l'entrée de 08 citée).
 */
export function caseOfSettlementTrip(
  trip: SettlementTrip,
  rates: Readonly<Record<string, Ratio>>,
): QuoteCase {
  return {
    period: {
      startAtMs: trip.startAtMs,
      endAtMs: trip.startAtMs + trip.days * DAY_MS,
      quotedAtMs: trip.bookedAtMs,
      rateType: trip.rateType,
      billableDays: trip.days,
      lines: linesOf(trip.lines),
    },
    params: {
      currency: trip.currency,
      graceMinutes: 29,
      maxTripDays: 30,
      tripFeeSchedule: repoTripFeeSchedule(trip.currency),
      taxRules: rulesOf(
        trip.taxGroups.map((g) => {
          const rate = rates[g.id];
          if (rate === undefined) throw new Error(`taux du groupe ${g.id} non donné`);
          return { id: g.id, rate, lines: g.lines, thirdParty: g.thirdParty };
        }),
      ),
      hostSharePct: trip.hostSharePctFrozen,
      deliverySharePct: trip.deliverySharePct,
      extrasSharePct: trip.extrasSharePct,
      ...(trip.insurerPremiumShareFrozen === undefined
        ? {}
        : { insurerPremiumShare: trip.insurerPremiumShareFrozen }),
      ...(trip.insurerRoadsideShareFrozen === undefined
        ? {}
        : { insurerRoadsideShare: trip.insurerRoadsideShareFrozen }),
    },
  };
}

/** Code d'une `QuoteError` (ou autre erreur) levée par `fn`, `OK` sinon. */
export function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
  return 'OK';
}
