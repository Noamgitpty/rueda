/**
 * Retenue d'une annulation hors fenêtre gratuite au checkout (US-205b ; 08 BR-CXL-01, BR-CXL-06 ;
 * 10b UX-54 ; ADR-140).
 *
 * Attendus : uniquement les oracles Python (`docs/specs/tools/golden_vectors.json`, lus par
 * `@rueda/money/golden-vectors`) : pour chaque vecteur d'annulation VOLONTAIRE hors fenêtre au
 * tarif remboursable, retenue TTC = total payé − remboursement du voyageur de l'oracle, et jours
 * retenus = « j » de la qualification de 08 (1 au-delà de 2 jours, ½ sinon). Jamais une valeur du
 * code testé. Les vecteurs couvrent deux devises (exposant 2 et exposant 0).
 */
import { ratio, type SettlementParams } from '@rueda/money';
import { settlementVectors } from '@rueda/money/golden-vectors';
import { testParams } from '@rueda/money/testing';
import { describe, expect, it } from 'vitest';
import { resolveParam } from '../../../cfg/index.js';
import { lateCancellationOf } from './cancellation.js';
import { resolveCancellationParams } from './params.js';
import { assembleQuote } from './engine.js';
import { isQuoteError } from './errors.js';
import {
  caseOfGoldenTrip,
  CONFIG_AT,
  golden,
  goldenRegistry,
  MINUTE_MS,
  repoConfig,
  T0_MS,
} from '../../../../../test/support/quote.js';

const LATE = /^VOLUNTARY, (partiel, )?j = (1|½)$/;

const vectors = settlementVectors(golden).filter(
  (v) =>
    v.event.reason === 'GUEST_CANCELLED' &&
    v.trip.rate === 'REFUNDABLE' &&
    v.expected.qualifiedReason === 'GUEST_CANCELLED' &&
    LATE.test(v.qualification08),
);

describe('US-205b : retenue hors fenêtre gratuite = moteur de règlement sur le devis (oracle)', () => {
  it('les vecteurs couvrent j = 1 et j = ½, dans deux devises (exposants 2 et 0)', () => {
    expect(new Set(vectors.map((v) => v.currency)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(vectors.map((v) => LATE.exec(v.qualification08)?.[2])).size).toBe(2);
  });

  it.each(vectors.map((v) => [v.id, v.currency, v] as const))(
    '%s (%s) : retenue TTC et jours retenus de l’oracle',
    (_id, _cur, v) => {
      const { period, params } = caseOfGoldenTrip(v.trip);
      const quote = assembleQuote(period, params);
      const late = lateCancellationOf(
        quote,
        testParams(goldenRegistry.get(v.currency)),
        quote.quotedAtMs,
      );
      expect(late).not.toBeNull();
      expect(late?.retained.amountMinor).toBe(v.trip.totalPaidMinor - v.expected.guestRefundMinor);
      expect(late?.refund.amountMinor).toBe(v.expected.guestRefundMinor);
      const j = LATE.exec(v.qualification08)?.[2] === '1' ? ratio(1n, 1n) : ratio(1n, 2n);
      expect(late?.penaltyDays).toEqual(j);
    },
  );

  it('fin de la fenêtre gratuite (BR-CXL-01) : départ − 24 h hors dernière minute ; dernière minute ⇒ min(réservation + 60 min, départ)', () => {
    const v = vectors[0];
    if (v === undefined) throw new Error('aucun vecteur');
    const { period, params } = caseOfGoldenTrip(v.trip);
    const quote = assembleQuote(period, params);
    const p: SettlementParams = testParams(goldenRegistry.get(v.currency));
    // réservée 5 jours avant (14/01 10:00 ⇒ 13/01 10:00 de 19 US-205)
    expect(lateCancellationOf(quote, p, T0_MS - 5 * 1440 * MINUTE_MS)?.freeUntilMs).toBe(
      T0_MS - 24 * 60 * MINUTE_MS,
    );
    // réservée 20 h avant : dernière minute, 1 h après la réservation
    expect(lateCancellationOf(quote, p, T0_MS - 20 * 60 * MINUTE_MS)?.freeUntilMs).toBe(
      T0_MS - 19 * 60 * MINUTE_MS,
    );
    // réservée 30 min avant : jamais après le départ ; la retenue reste celle du départ
    const late = lateCancellationOf(quote, p, T0_MS - 30 * MINUTE_MS);
    expect(late?.freeUntilMs).toBe(T0_MS);
    expect(late?.retained.amountMinor).toBe(v.trip.totalPaidMinor - v.expected.guestRefundMinor);
  });

  it('aucune annulation tardive possible avant le no-show (fenêtre jusqu’au départ, tolérance nulle) ⇒ null ; réservation après le départ ⇒ QUOTE_UNAVAILABLE', () => {
    const v = vectors[0];
    if (v === undefined) throw new Error('aucun vecteur');
    const { period, params } = caseOfGoldenTrip(v.trip);
    const quote = assembleQuote(period, params);
    const p = testParams(goldenRegistry.get(v.currency), { noShowGraceMinutes: 0 });
    expect(lateCancellationOf(quote, p, T0_MS - 30 * MINUTE_MS)).toBeNull();
    let code: string | null = null;
    try {
      lateCancellationOf(quote, p, T0_MS + MINUTE_MS);
    } catch (e) {
      code = isQuoteError(e) ? e.code : null;
    }
    expect(code).toBe('QUOTE_UNAVAILABLE');
  });
});

describe('US-205b (revues argent n° 6, architecture n° 5) : fenêtre de dernière minute du pays = fenêtre du moteur cxl-beta/1', () => {
  // La fiche et S05 affichent `last_minute_free_window_minutes` (graine 0117) ; le moteur de
  // règlement garde sa fenêtre de politique. Ce test échoue dès que la graine d'un pays diffère
  // de la fenêtre que le moteur applique : changer le paramètre exige d'abord une version du
  // moteur qui le lise (suite cxl-beta/2).
  const v = vectors[0];
  const countries = [...repoConfig.countries.keys()];

  it('chaque pays déclaré a une fenêtre', () => {
    expect(countries.length).toBeGreaterThanOrEqual(2);
  });

  it.each(countries)(
    '%s : réservation de dernière minute ⇒ freeUntil du moteur = réservation + fenêtre du pays',
    (country) => {
      if (v === undefined) throw new Error('aucun vecteur');
      const window = resolveParam(repoConfig, 'last_minute_free_window_minutes', {
        country,
        at: CONFIG_AT,
      }).value;
      expect(typeof window).toBe('number');
      const { period, params } = caseOfGoldenTrip(v.trip);
      const quote = assembleQuote(period, params);
      // paramètres d'annulation du pays (seuil de dernière minute, tolérance de no-show) du dépôt
      const p = resolveCancellationParams(repoConfig, { country, at: CONFIG_AT });
      const bookedAt = T0_MS - 20 * 60 * MINUTE_MS; // départ dans 20 h : dernière minute (< 25 h)
      const late = lateCancellationOf(quote, p, bookedAt);
      expect(late?.freeUntilMs).toBe(bookedAt + (window as number) * MINUTE_MS);
    },
  );
});
