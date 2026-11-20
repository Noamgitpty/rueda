/**
 * US-709 — propriétés de l'imputation d'un chargeback perdu (fast-check) : invariants de 08 E5 et
 * E7 règle 7, vérifiés sur des faits cohérents quelconques (part versée ≤ part payable avant le
 * chargeback, part de l'hôte ≤ retenue), sans réimplémenter la formule :
 *   - retenue encaissée avant = min(retenue due, max(0, encaissé − engagé)) ; après ≤ avant ;
 *   - reprise ≤ versé (« jamais plus que versé ») ; 0 sur un trip réalisé (EC-31) ;
 *   - perdu = créance du voyageur + perte de Kmino + reprise + part hôte non versée annulée +
 *     remboursements bloqués éteints (C) ;
 *   - jambes : Σ = − perdu, `INSURER` = `TAX_THIRD_PARTY` = 0, `HOST` = − reprise ;
 *   - part payable de l'hôte après ≤ avant ≤ part de l'hôte.
 * Et les refus d'entrée (fail-closed), avec le nom du champ fautif.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  chargebackImputation,
  isSettlementError,
  lostTripMinor,
  type ChargebackInputs,
} from '../../src/index.ts';

const facts = fc
  .record({
    owed: fc.bigInt({ min: 0n, max: 2_000_000n }),
    hostShare: fc.bigInt({ min: 0n, max: 1_000_000n }),
    collected: fc.bigInt({ min: 1n, max: 4_000_000n }),
    committedShare: fc.bigInt({ min: 0n, max: 1_000_000n }),
    lostShare: fc.bigInt({ min: 1n, max: 1_000_000n }),
    blockedShare: fc.bigInt({ min: 0n, max: 1_000_000n }),
    paidShare: fc.bigInt({ min: 0n, max: 1_000_000n }),
    cancellation: fc.boolean(),
  })
  .map((r): ChargebackInputs => {
    const hostFromGuest = (r.owed * r.hostShare) / 1_000_000n;
    const committed = (r.collected * 2n * r.committedShare) / 1_000_000n;
    const lost = 1n + ((r.collected - 1n) * r.lostShare) / 1_000_000n;
    const blocked = (committed * r.blockedShare) / 1_000_000n;
    const retained = (() => {
      const v = r.collected - committed;
      return v < 0n ? 0n : v > r.owed ? r.owed : v;
    })();
    const payable = r.owed === 0n ? 0n : (hostFromGuest * retained) / r.owed;
    return {
      lostTripMinor: lost,
      collectedBeforeMinor: r.collected,
      refundCommittedMinor: committed,
      blockedRefundsMinor: blocked,
      owedMinor: r.owed,
      hostFromGuestMinor: hostFromGuest,
      hostPaidMinor: (payable * r.paidShare) / 1_000_000n,
      cancellationEarnings: r.cancellation,
    };
  });

describe('08 E5 — propriétés de l’imputation d’un chargeback perdu', () => {
  it('retenue, reprise plafonnée au versé, ventilation exacte, jambes de E7 règle 7', () => {
    fc.assert(
      fc.property(facts, (i) => {
        const r = chargebackImputation(i);
        const net = i.collectedBeforeMinor - i.refundCommittedMinor;
        const floor = net > 0n ? net : 0n;
        expect(r.retainedBeforeMinor).toBe(floor < i.owedMinor ? floor : i.owedMinor);
        expect(r.retainedAfterMinor >= 0n).toBe(true);
        expect(r.retainedAfterMinor <= r.retainedBeforeMinor).toBe(true);
        expect(r.lostRetainedMinor).toBe(r.retainedBeforeMinor - r.retainedAfterMinor);
        expect(r.clawbackMinor <= i.hostPaidMinor).toBe(true);
        expect(r.clawbackMinor >= 0n).toBe(true);
        if (!i.cancellationEarnings) {
          expect(r.clawbackMinor).toBe(0n);
          expect(r.hostUnpaidCancelledMinor).toBe(0n);
        }
        expect(
          r.guestReceivableMinor +
            r.lossExpenseMinor +
            r.clawbackMinor +
            r.hostUnpaidCancelledMinor +
            r.cancelledBlockedRefundsMinor,
        ).toBe(i.lostTripMinor);
        expect(r.guestReceivableMinor >= 0n && r.lossExpenseMinor >= 0n).toBe(true);
        expect(r.legs.INSURER).toBe(0n);
        expect(r.legs.TAX_THIRD_PARTY).toBe(0n);
        expect(r.legs.HOST).toBe(-r.clawbackMinor);
        expect(r.legs.HOST + r.legs.INSURER + r.legs.TAX_THIRD_PARTY + r.legs.PLATFORM).toBe(
          -i.lostTripMinor,
        );
        expect(r.hostPayableAfterMinor <= r.hostPayableBeforeMinor).toBe(true);
        expect(r.hostPayableBeforeMinor <= i.hostFromGuestMinor).toBe(true);
        const blocked = i.blockedRefundsMinor ?? 0n;
        expect(r.cancelledBlockedRefundsMinor).toBe(
          blocked < i.lostTripMinor ? blocked : i.lostTripMinor,
        );
      }),
      { numRuns: 500 },
    );
  });
});

describe('refus d’entrée (fail-closed) : SETTLEMENT_INPUT_INVALID et le champ fautif', () => {
  const ok: ChargebackInputs = {
    lostTripMinor: 100n,
    collectedBeforeMinor: 100n,
    refundCommittedMinor: 0n,
    owedMinor: 100n,
    hostFromGuestMinor: 50n,
    hostPaidMinor: 0n,
    cancellationEarnings: true,
  };
  const failure = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e) {
      return isSettlementError(e) ? `${e.code} ${e.message}` : 'AUTRE';
    }
    return 'AUCUNE';
  };

  it.each([
    'lostTripMinor',
    'collectedBeforeMinor',
    'refundCommittedMinor',
    'blockedRefundsMinor',
    'owedMinor',
    'hostFromGuestMinor',
    'hostPaidMinor',
  ] as const)('%s négatif, ou non bigint ⇒ refus nommé', (field) => {
    expect(failure(() => chargebackImputation({ ...ok, [field]: -1n }))).toMatch(
      new RegExp(`^SETTLEMENT_INPUT_INVALID .*${field}`),
    );
    expect(failure(() => chargebackImputation({ ...ok, [field]: 1 as unknown as bigint }))).toMatch(
      new RegExp(`^SETTLEMENT_INPUT_INVALID .*${field}`),
    );
  });

  it('part de l’hôte au-delà de la retenue : refusée sur des gains d’annulation, admise à égalité et sur un trip réalisé', () => {
    expect(failure(() => chargebackImputation({ ...ok, hostFromGuestMinor: 101n }))).toMatch(
      /^SETTLEMENT_INPUT_INVALID/,
    );
    expect(failure(() => chargebackImputation({ ...ok, hostFromGuestMinor: 100n }))).toBe('AUCUNE');
    expect(
      failure(() =>
        chargebackImputation({ ...ok, hostFromGuestMinor: 101n, cancellationEarnings: false }),
      ),
    ).toBe('AUCUNE');
  });

  it('lostTripMinor : perdu ou capture négatifs, capture débitée nulle ou non bigint ⇒ refus nommé ; plafond à la capture', () => {
    expect(failure(() => lostTripMinor(-1n, 1n, 1n))).toMatch(/lostChargedMinor/);
    expect(failure(() => lostTripMinor(1n, -1n, 1n))).toMatch(/captureTripMinor/);
    expect(failure(() => lostTripMinor(1n, 1n, 0n))).toMatch(/captureChargedMinor/);
    expect(failure(() => lostTripMinor(1n, 1n, 1 as unknown as bigint))).toMatch(
      /captureChargedMinor/,
    );
    // perdu débité au-delà de la capture débitée : jamais plus que la capture dans la devise du trip
    expect(lostTripMinor(30n, 100n, 20n)).toBe(100n);
    expect(lostTripMinor(10n, 100n, 20n)).toBe(50n);
  });
});
