/**
 * US-307 (ADR-191) — moteur `cxl-beta/2` : ligne n° 8 de la table de décision de 08
 * (`CLEANLINESS_SAFETY_VALID`, refus du véhicule validé au départ, BR-CXL-04 ; pénalité de
 * propreté / sécurité BR-CSP-03, hors jambes, 08 E7 règle 7).
 *
 * Attendus : aucun vecteur exporté ne porte ce motif ; ils viennent de l'oracle indépendant
 * `docs/specs/tools/independent_settlement_check.py` (`compute(A | D, reason =
 * 'CLEANLINESS_SAFETY_VALID', req = 10)`, `python -I -X utf8`, 2026-11-20) et, pour les jambes, de
 * `docs/specs/tools/check_legs.py` (`capture_and(…, 'FULL')` ; en USD c'est TJ06 de l'export) ;
 * jamais du moteur :
 *   - A (USD, PA) : remboursement 256,66, taxe 9,66, gains 0, net 0, pénalité 50,00 ;
 *   - D (PYG, PY) : remboursement 1 438 050, taxe 112 550, gains 0, net 0, pénalité 400 000 ;
 *     variation HOST −787 500, INSURER −105 000, TAX_THIRD_PARTY 0, PLATFORM −545 550.
 */
import { describe, expect, it } from 'vitest';
import { legVector, loadGoldenVectors, settlementVector } from '../../src/golden-vectors/index.ts';
import {
  CANCELLATION_ENGINE_VERSION,
  LEGS,
  computeCancellationSettlement,
  isSettlementError,
} from '../../src/index.ts';
import { at, testParams, toTrip } from './adapter.ts';

const set = loadGoldenVectors();

const variation = (s: ReturnType<typeof computeCancellationSettlement>) =>
  Object.fromEntries(LEGS.map((l) => [l, s.legVariation[l].amountMinor]));

describe('US-307 — cxl-beta/2 : refus du véhicule validé (ligne n° 8 de 08)', () => {
  it('version écrite dans le test', () => {
    expect(CANCELLATION_ENGINE_VERSION).toBe('cxl-beta/2');
  });

  it('A (PA, USD) : remboursement intégral, gains 0, pénalité cleanliness, REFUSED_AT_PICKUP, TJ06', () => {
    const trip = toTrip(settlementVector(set, 'T14').trip);
    const s = computeCancellationSettlement(
      trip,
      { reason: 'CLEANLINESS_SAFETY_VALID', requestedAtMs: at(10), subReason: 'CLEANLINESS' },
      testParams(trip.currency),
    );
    expect(s.engineVersion).toBe('cxl-beta/2');
    expect(s.reason).toBe('CLEANLINESS_SAFETY_VALID');
    expect(s.qualification).toBe('FULL');
    expect(s.targetState).toBe('REFUSED_AT_PICKUP');
    expect(s.hostEligible).toBe(false);
    expect(s.guestRefund.amountMinor).toBe(25_666n);
    expect(s.taxRefund.amountMinor).toBe(966n);
    expect(s.hostEarnings.amountMinor).toBe(0n);
    expect(s.platformNet.amountMinor).toBe(0n);
    expect(s.hostPenalty.amountMinor).toBe(5_000n);
    const tj06 = legVector(set, 'TJ06').legsMinor;
    expect(variation(s)).toEqual(Object.fromEntries(LEGS.map((l) => [l, BigInt(tj06[l])])));
  });

  it('D (PY, PYG sans décimale) : mêmes règles, attendus de l’oracle à l’unité près', () => {
    const trip = toTrip(settlementVector(set, 'T27').trip);
    const s = computeCancellationSettlement(
      trip,
      { reason: 'CLEANLINESS_SAFETY_VALID', requestedAtMs: at(10), subReason: 'SAFETY' },
      testParams(trip.currency),
    );
    expect(s.currency).toBe('PYG');
    expect(s.targetState).toBe('REFUSED_AT_PICKUP');
    expect(s.guestRefund.amountMinor).toBe(1_438_050n);
    expect(s.taxRefund.amountMinor).toBe(112_550n);
    expect(s.hostEarnings.amountMinor).toBe(0n);
    expect(s.platformNet.amountMinor).toBe(0n);
    expect(s.hostPenalty.amountMinor).toBe(400_000n);
    expect(variation(s)).toEqual({
      HOST: -787_500n,
      INSURER: -105_000n,
      TAX_THIRD_PARTY: 0n,
      PLATFORM: -545_550n,
    });
  });

  it('barème absent ⇒ refus explicite (jamais 0) ; exemption ⇒ 0', () => {
    const trip = toTrip(settlementVector(set, 'T14').trip);
    const base = testParams(trip.currency);
    const withoutPenalty = Object.fromEntries(
      Object.entries(base).filter(([k]) => k !== 'hostPenalty'),
    ) as typeof base;
    expect(() =>
      computeCancellationSettlement(
        trip,
        { reason: 'CLEANLINESS_SAFETY_VALID', requestedAtMs: at(10) },
        withoutPenalty,
      ),
    ).toThrow(expect.objectContaining({ code: 'SETTLEMENT_CONFIG_INVALID' }));
    const waived = computeCancellationSettlement(
      trip,
      { reason: 'CLEANLINESS_SAFETY_VALID', requestedAtMs: at(10), hostPenaltyWaived: true },
      base,
    );
    expect(waived.hostPenalty.amountMinor).toBe(0n);
  });

  it('un motif hors sous-ensemble reste refusé (moteur complet : US-518)', () => {
    const trip = toTrip(settlementVector(set, 'T14').trip);
    try {
      computeCancellationSettlement(
        trip,
        { reason: 'MUTUAL_AGREEMENT_PROVEN', requestedAtMs: at(10) },
        testParams(trip.currency),
      );
      expect.unreachable();
    } catch (error) {
      expect(isSettlementError(error, 'SETTLEMENT_REASON_NOT_SUPPORTED')).toBe(true);
    }
  });
});
