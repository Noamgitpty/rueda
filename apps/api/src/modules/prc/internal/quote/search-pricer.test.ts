/**
 * Total TTC des résultats de la recherche (US-203 ; 19 US-203 critères 1 et 4 ; 16 SRC-042,
 * PRC-025 ; ADR-131) : l'adaptateur `searchQuotePricer` rend le total du devis provisoire du
 * moteur `prc.quote/3`, le même que la fiche et le checkout.
 *
 * Attendus : uniquement l'export des oracles Python (`docs/specs/tools/golden_vectors.json`, lu
 * par `@rueda/money/golden-vectors`) et 16 A.8.1 (TA01) — jamais une valeur produite par le code
 * testé :
 * - TA01 (configuration « PA1 » : ITBMS 7 % sur le loyer seul, ni trip fee ni protection) :
 *   40,00 × 3 jours ⇒ 128,40 (« refund » de TA01 = total, remboursement intégral) ;
 * - variante sans décimale (VERIF_19-m9) : trip D2 de 08 (T40, PYG, taxe de 10 % sur P et F) sans
 *   ses lignes non taxées (protection, livraison : hors du groupe fiscal de D2) ⇒ total de
 *   l'oracle moins ces lignes ;
 * - configuration pays du dépôt : trip A (T01) sans ses lignes non taxées ⇒ total de l'oracle
 *   moins ces lignes (F de A = barème du dépôt, US-704), plus la protection minimale du dépôt
 *   (US-226, N-141 : BASICA, 30,00 du trip A).
 * Aucun code de pays ni de devise n'est écrit ici : ils sont lus des données (ADR-024).
 */
import { ratio } from '@rueda/money';
import { checksFor, settlementVector } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import type { QuoteParams } from './engine.js';
import { QuoteError } from './errors.js';
import { resolveQuoteParams } from './params.js';
import { searchQuotePricer } from './search-pricer.js';
import {
  CONFIG_AT,
  DAY_MS,
  T0_MS,
  caseOfGoldenTrip,
  countryOfCurrency,
  golden,
  goldenRegistry,
  repoConfig,
  rulesOf,
  testTripFeeSchedule,
} from '../../../../../test/support/quote.js';

const iso = (ms: number): string => new Date(ms).toISOString();

/** Lignes d'un trip doré hors du prix du trip et du trip fee (non taxées dans son groupe). */
function untaxedExtras(t: { linesMinor: Readonly<Record<string, bigint>> }): bigint {
  return Object.entries(t.linesMinor)
    .filter(([name]) => name !== 'tripPrice' && name !== 'tripFee')
    .reduce((sum, [, v]) => sum + v, 0n);
}

describe('US-203 critère 1 : TA01 cherché ⇒ 128,40 (devis provisoire, configuration PA1)', () => {
  const t01 = settlementVector(golden, 'T01'); // trip A : seule source normative du loyer 120,00
  const cur = goldenRegistry.get(t01.currency);
  // « PA1 » : ITBMS 7 % sur le loyer seul, ni trip fee ni protection (16 A.8.1)
  const pa1: QuoteParams = {
    currency: cur,
    graceMinutes: 29,
    maxTripDays: 30,
    tripFeeSchedule: testTripFeeSchedule(cur, [[null, 0]], 0n),
    taxRules: rulesOf([{ id: 'g', rate: ratio(7n, 100n), lines: ['tripPrice'] }]),
    hostSharePct: ratio(3n, 4n),
    deliverySharePct: ratio(3n, 4n),
    extrasSharePct: ratio(3n, 4n),
  };
  const input = {
    listingId: '00000000-0000-4000-8000-0000000000a1',
    country: 'ZZ',
    currency: cur.code,
    dailyPriceMinor: '4000',
    startAt: iso(T0_MS),
    endAt: iso(T0_MS + 3 * DAY_MS),
    quotedAt: iso(T0_MS - 5 * DAY_MS),
  };

  it('40,00 × 3 jours ⇒ 128,40, 3 jours facturés ; les paramètres sont lus au pays et à l’instant de la base', () => {
    const asked: { country: string; at: string }[] = [];
    const pricer = searchQuotePricer((ctx) => {
      asked.push({ country: ctx.country, at: ctx.at.toISOString() });
      return pa1;
    });
    // « TA01 refund » : remboursement intégral = total payé (16 A.8.1)
    const refund = checksFor(golden, 'TA01').find((c) => c.label === 'TA01 refund')?.expected;
    expect(typeof refund).toBe('bigint');
    expect(pricer.price(input)).toEqual({ totalMinor: String(refund), billableDays: 3 });
    // 16 A.8.1 TA01 : « total 128,40 » (lu tel quel dans la spécification)
    expect(pricer.price(input)?.totalMinor).toBe('12840');
    expect(asked[0]).toEqual({ country: 'ZZ', at: input.quotedAt });
  });

  it('tolérance de 29 min (OQ-BR-04) : 3 jours et 29 min facturés 3 jours, même total ; 30 min : 4 jours', () => {
    const pricer = searchQuotePricer(() => pa1);
    const plus = (min: number) => ({ ...input, endAt: iso(T0_MS + 3 * DAY_MS + min * 60_000) });
    expect(pricer.price(plus(29))).toEqual(pricer.price(input));
    expect(pricer.price(plus(30))?.billableDays).toBe(4);
  });

  it('devis impossible ⇒ null (annonce exclue) : devise différente de celle du pays, paramètre manquant, durée au-delà de max_trip_days', () => {
    expect(searchQuotePricer(() => pa1).price({ ...input, currency: 'XTS' })).toBeNull();
    const missing = searchQuotePricer(() => {
      throw new QuoteError('QUOTE_UNAVAILABLE', 'trip_fee_schedule absent');
    });
    expect(missing.price(input)).toBeNull();
    expect(searchQuotePricer(() => ({ ...pa1, maxTripDays: 2 })).price(input)).toBeNull();
  });

  it('autre erreur (configuration illisible, entrée corrompue) : remonte (503), jamais un total inventé', () => {
    const broken = searchQuotePricer(() => {
      throw new Error('configuration illisible');
    });
    expect(() => broken.price(input)).toThrow('configuration illisible');
    const pricer = searchQuotePricer(() => pa1);
    expect(() => pricer.price({ ...input, dailyPriceMinor: '-1' })).toThrow();
    expect(() => pricer.price({ ...input, quotedAt: 'hier' })).toThrow();
  });
});

describe('US-203 critère 4 : variante sans décimale (oracle US-016, VERIF_19-m9)', () => {
  it('D2 (T40) : 333 334 × 3 jours, taxe de 10 % sur P et F ⇒ total de l’oracle sans la protection ni la livraison, à l’unité près', () => {
    const v = settlementVector(golden, 'T40');
    const { params: base } = caseOfGoldenTrip(v.trip);
    const c = base.currency;
    expect(c.exponent).toBe(0);
    // F de D2 (125 500) donné par 08 : barème de TEST à 12,55 % (entrée, pas un attendu)
    const params: QuoteParams = {
      ...base,
      tripFeeSchedule: testTripFeeSchedule(c, [[null, 1255]], 0n),
    };
    const pricer = searchQuotePricer(() => params);
    const got = pricer.price({
      listingId: '00000000-0000-4000-8000-0000000000a2',
      country: 'ZZ',
      currency: c.code,
      dailyPriceMinor: '333334', // P = 1 000 002 de D2 (08), divisible par 3
      startAt: iso(T0_MS),
      endAt: iso(T0_MS + 3 * DAY_MS),
      quotedAt: iso(T0_MS - DAY_MS),
    });
    // groupe fiscal de D2 : prix du trip et trip fee seulement ; la protection et la livraison,
    // non taxées, ne sont pas dans le devis de la recherche (aucune option facultative)
    expect(v.trip.taxGroups.every((g) => !g.lines.includes('protection'))).toBe(true);
    expect(v.trip.taxGroups.every((g) => !g.lines.includes('delivery'))).toBe(true);
    expect(got).toEqual({
      totalMinor: String(v.trip.totalPaidMinor - untaxedExtras(v.trip)),
      billableDays: 3,
    });
  });
});

describe('US-203 : configuration pays du dépôt (même moteur que la fiche et le checkout)', () => {
  it('trip A (T01) : 40,00 × 3 jours, trip fee du barème du dépôt, taxe de 7 % sur P et F ⇒ total de l’oracle sans ses lignes non taxées', () => {
    const v = settlementVector(golden, 'T01');
    const country = countryOfCurrency(v.currency);
    const pricer = searchQuotePricer((ctx) => resolveQuoteParams(repoConfig, ctx));
    const got = pricer.price({
      listingId: '00000000-0000-4000-8000-0000000000a3',
      country,
      currency: v.currency,
      dailyPriceMinor: String(v.trip.linesMinor.tripPrice / BigInt(v.trip.days)),
      startAt: iso(CONFIG_AT.getTime() + DAY_MS),
      endAt: iso(CONFIG_AT.getTime() + (1 + v.trip.days) * DAY_MS),
      quotedAt: CONFIG_AT.toISOString(),
    });
    expect(got).toEqual({
      // US-226 (N-141) : protection minimale BASICA du dépôt (1/4 de 40,00 × 3 j = 30,00, la
      // protection du trip A de 08, non taxée) comprise dans le total
      totalMinor: String(
        v.trip.totalPaidMinor - untaxedExtras(v.trip) + v.trip.linesMinor.protection,
      ),
      billableDays: v.trip.days,
    });
  });
});
