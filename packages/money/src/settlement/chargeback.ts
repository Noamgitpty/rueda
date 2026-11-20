/**
 * Imputation d'un chargeback perdu (US-709 ; 08 E5 « Reprise », « Chargeback perdu pendant un
 * remboursement bloqué », E7 règle 7 ; vecteurs T53, T54, T55, T67, TJ14a à TJ14c ; ADR-187).
 *
 * Fonction PURE, en unités mineures `bigint`, sans flottant ni prorata ; seuls `roundHalfUp`
 * (conversion du montant perdu au ratio de la capture) et la division entière vers −∞ (`floor`)
 * sont utilisés, comme dans 08. La base (migration 0167, `core.settlement_cmd_impute_chargeback`)
 * recalcule la même chose sur ses propres faits ; les attendus des tests viennent de l'export des
 * oracles Python (`check_t49plus.py`, `check_verif12_fixes.py`, `check_t66_68.py`, `check_legs.py`).
 *
 *   retainedCollected = clamp(collected − refundCommitted, 0, owed)
 *   hostPayable       = owed = 0 ? 0 : floor(hostFromGuest × retainedCollected / owed)
 *   clawback          = max(0, hostPaid − hostPayable_after)        (0 sur un trip réalisé, EC-31)
 *   lostRetained      = retainedCollected_before − retainedCollected_after
 *   guestReceivable   = lost − C − lostRetained                     (double remboursement émis)
 *   lossExpense       = lostRetained − clawback − part hôte non versée annulée
 *
 * Jambes du chargeback (08 E7 règle 7) : `HOST` = − reprise, `INSURER` = 0, `TAX_THIRD_PARTY` = 0,
 * `PLATFORM` = le reste ; Σ = − montant perdu. Aucune écriture entre devises : tout est dans la
 * devise du trip (le montant perdu y est ramené par `lostTripMinor`).
 */
import { ratio } from '../ratio.ts';
import { floorDiv, roundHalfUp } from '../rounding.ts';
import { SettlementError } from './errors.ts';

export interface ChargebackInputs {
  /** Montant perdu, dans la devise du trip (`lostTripMinor` s'il a été débité dans une autre). */
  readonly lostTripMinor: bigint;
  /** Encaissé du segment avant ce chargeback (captures, débits MIT, dette, moins pertes passées). */
  readonly collectedBeforeMinor: bigint;
  /** Remboursements engagés (émis ou bloqués, hors annulés et remplacés). */
  readonly refundCommittedMinor: bigint;
  /** Part des remboursements engagés encore `BLOCKED_CHARGEBACK` (jamais émise). */
  readonly blockedRefundsMinor?: bigint;
  /** Retenue due : total payé − remboursement du règlement. */
  readonly owedMinor: bigint;
  /** Part de l'hôte prélevée sur le voyageur (`hostFromGuest`, E1). */
  readonly hostFromGuestMinor: bigint;
  /** Part de `hostFromGuest` effectivement versée (lots émis), nette des reprises passées. */
  readonly hostPaidMinor: bigint;
  /** `true` : gains d'annulation ou de no-show (E5) ; `false` : trip réalisé, aucune reprise. */
  readonly cancellationEarnings: boolean;
}

export interface ChargebackLegs {
  readonly HOST: bigint;
  readonly INSURER: bigint;
  readonly TAX_THIRD_PARTY: bigint;
  readonly PLATFORM: bigint;
}

export interface ChargebackImputation {
  /** C : remboursements bloqués éteints par les fonds rendus par la banque (T67). */
  readonly cancelledBlockedRefundsMinor: bigint;
  readonly retainedBeforeMinor: bigint;
  readonly retainedAfterMinor: bigint;
  readonly lostRetainedMinor: bigint;
  readonly hostPayableBeforeMinor: bigint;
  readonly hostPayableAfterMinor: bigint;
  /** Reprise sur l'hôte, au débit de son `host_ledger` dans la devise du trip. */
  readonly clawbackMinor: bigint;
  /** Part de l'hôte jamais versée qui n'est plus due (lot non émis recalculé, T54 a, T67 a). */
  readonly hostUnpaidCancelledMinor: bigint;
  /** Double remboursement réellement émis, poursuivi auprès du voyageur (jamais sur l'hôte). */
  readonly guestReceivableMinor: bigint;
  /** Charge de Kmino : part plateforme et taxe retenues perdues. */
  readonly lossExpenseMinor: bigint;
  readonly legs: ChargebackLegs;
}

const clamp = (v: bigint, lo: bigint, hi: bigint): bigint => (v < lo ? lo : v > hi ? hi : v);
const maxOf = (a: bigint, b: bigint): bigint => (a > b ? a : b);
const minOf = (a: bigint, b: bigint): bigint => (a < b ? a : b);

function invalid(message: string): never {
  throw new SettlementError('SETTLEMENT_INPUT_INVALID', message);
}

function requireNonNegative(name: string, value: bigint): void {
  if (typeof value !== 'bigint' || value < 0n) invalid(`${name} : entier ≥ 0 attendu`);
}

/**
 * Montant perdu ramené dans la devise du trip au ratio de la capture d'origine, sans taux de marché
 * (08 E5) : `min(capture, roundHalfUp(perdu × capture / capture débitée))` ; l'écart avec ce que le
 * PSP débite réellement va au compte `fx_difference` de la plateforme, jamais à l'hôte.
 */
export function lostTripMinor(
  lostChargedMinor: bigint,
  captureTripMinor: bigint,
  captureChargedMinor: bigint,
): bigint {
  requireNonNegative('lostChargedMinor', lostChargedMinor);
  requireNonNegative('captureTripMinor', captureTripMinor);
  if (typeof captureChargedMinor !== 'bigint' || captureChargedMinor <= 0n) {
    invalid('captureChargedMinor : entier > 0 attendu');
  }
  return minOf(
    captureTripMinor,
    roundHalfUp(ratio(lostChargedMinor * captureTripMinor, captureChargedMinor)),
  );
}

const hostPayable = (hostFromGuest: bigint, retained: bigint, owed: bigint): bigint =>
  owed === 0n ? 0n : floorDiv(hostFromGuest * retained, owed);

/** Imputation d'un chargeback perdu (formule cumulative de 08 E5, ventilation de E7 règle 7). */
export function chargebackImputation(i: ChargebackInputs): ChargebackImputation {
  const blocked = i.blockedRefundsMinor ?? 0n;
  requireNonNegative('lostTripMinor', i.lostTripMinor);
  requireNonNegative('collectedBeforeMinor', i.collectedBeforeMinor);
  requireNonNegative('refundCommittedMinor', i.refundCommittedMinor);
  requireNonNegative('blockedRefundsMinor', blocked);
  requireNonNegative('owedMinor', i.owedMinor);
  requireNonNegative('hostFromGuestMinor', i.hostFromGuestMinor);
  requireNonNegative('hostPaidMinor', i.hostPaidMinor);
  if (i.lostTripMinor === 0n) invalid('montant perdu nul');
  if (i.lostTripMinor > i.collectedBeforeMinor) invalid('montant perdu au-delà de l’encaissé');
  if (blocked > i.refundCommittedMinor) invalid('remboursements bloqués au-delà des engagés');
  if (i.cancellationEarnings && i.hostFromGuestMinor > i.owedMinor) {
    invalid('part de l’hôte au-delà de la retenue');
  }

  const cancelled = minOf(i.lostTripMinor, blocked);
  const retainedBefore = clamp(i.collectedBeforeMinor - i.refundCommittedMinor, 0n, i.owedMinor);
  const collectedAfter = i.collectedBeforeMinor - i.lostTripMinor;
  const retainedAfter = clamp(
    collectedAfter - (i.refundCommittedMinor - cancelled),
    0n,
    i.owedMinor,
  );
  const lostRetained = retainedBefore - retainedAfter;
  const payableBefore = hostPayable(i.hostFromGuestMinor, retainedBefore, i.owedMinor);
  const payableAfter = hostPayable(i.hostFromGuestMinor, retainedAfter, i.owedMinor);
  const paid = i.cancellationEarnings ? i.hostPaidMinor : 0n;
  const clawback = i.cancellationEarnings ? maxOf(0n, paid - payableAfter) : 0n;
  const unpaidCancelled = i.cancellationEarnings
    ? maxOf(0n, payableBefore - paid) - maxOf(0n, payableAfter - paid)
    : 0n;
  // jamais négatif : la retenue perdue ne dépasse pas le perdu non couvert par C
  const guestReceivable = i.lostTripMinor - cancelled - lostRetained;
  const loss = lostRetained - clawback - unpaidCancelled;
  if (loss < 0n) {
    invalid('faits incohérents : versé au-delà de la part payable (revue FIN)');
  }
  return Object.freeze({
    cancelledBlockedRefundsMinor: cancelled,
    retainedBeforeMinor: retainedBefore,
    retainedAfterMinor: retainedAfter,
    lostRetainedMinor: lostRetained,
    hostPayableBeforeMinor: payableBefore,
    hostPayableAfterMinor: payableAfter,
    clawbackMinor: clawback,
    hostUnpaidCancelledMinor: unpaidCancelled,
    guestReceivableMinor: guestReceivable,
    lossExpenseMinor: loss,
    legs: Object.freeze({
      HOST: -clawback,
      INSURER: 0n,
      TAX_THIRD_PARTY: 0n,
      PLATFORM: -(i.lostTripMinor - clawback),
    }),
  });
}
