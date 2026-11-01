/**
 * Vecteurs dorés T40, T42, T43 (08, « Jeux de tests complémentaires T28–T48 ») et TA06 (16 A.8.1),
 * rejoués avec les seules primitives du paquet. Ce n'est PAS le moteur de règlement (US-016) :
 * chaque étape est la formule écrite dans la colonne « Détail » de 08 / « Résultat attendu » de 16.
 *
 * Toutes les valeurs attendues sont recopiées de 08 / 16 et confirmées par les oracles, exécutés
 * le 2026-10-31 avec `python -I -X utf8` depuis `docs/specs/tools/` :
 * - `independent_settlement_check.py` : T40 (1000368, 75033, 268750, 131417, 0),
 *   T42 (3335, 91, 3095, 1538, 0), T43 (1613, 105, 188, 314, 0) — « 48 / 48, 0 écart » ;
 * - `verif11_settlement.py` : « Vecteurs executes: 48 | ecarts: 0 » ;
 * - `verif15_ta.py` : TA06 {total 4816, tax 315, retained 2251, refund 2407, reftax 157,
 *   kept 2409, comm 270, balance True}.
 * Aucune valeur n'est tirée du code testé.
 */
import { describe, expect, it } from 'vitest';
import {
  add,
  allocHost,
  money,
  multiplyRatios,
  multiplyRoundHalfUp,
  ratio,
  ratioOf,
  subtract,
  sum,
  taxByLine,
  type Currency,
  type Money,
  type Ratio,
} from '../src/index.ts';
import { PYG, USD } from './fixtures.ts';

const minor = (value: Money): bigint => value.amountMinor;

/** Configuration de test de 08 : parts hôte 75 % (« Mêmes conventions que T01–T27 »). */
const HOST_SHARE = ratio(3n, 4n);
const DELIVERY_SHARE = ratio(3n, 4n);

/** retenu(l) = roundHalfUp(l × j / days) (08 pseudo-code `computeCancellationSettlement`). */
function retainedPerDay(line: Money, j: Ratio, days: bigint): Money {
  return multiplyRoundHalfUp(line, multiplyRatios(j, ratio(1n, days)));
}

/** taxe remboursée = roundHalfUp(taxePayée × base remboursée / base payée) (08 `settle`). */
function taxRefund(taxPaid: Money, refundedBase: Money, paidBase: Money): Money {
  return multiplyRoundHalfUp(taxPaid, ratioOf(refundedBase, paidBase));
}

interface Lines {
  readonly currency: Currency;
  readonly days: bigint;
  readonly tripPrice: Money;
  readonly tripFee: Money;
  readonly protection: Money;
  readonly deliveryFee: Money;
  readonly taxRate: Ratio;
}

/**
 * Annulation à tarif remboursable avec retenue j (08 pseudo-code) : P et F retenus au prorata,
 * D à moitié, protection remboursée ; taxe sur P et F (configuration de test des trips D2, G, H).
 */
function replay(trip: Lines, j: Ratio) {
  const { currency } = trip;
  const retainedP = retainedPerDay(trip.tripPrice, j, trip.days);
  const retainedF = retainedPerDay(trip.tripFee, j, trip.days);
  const retainedD = multiplyRoundHalfUp(trip.deliveryFee, ratio(1n, 2n));
  const retained = sum(currency, [retainedP, retainedF, retainedD]);
  const linesTotal = sum(currency, [
    trip.tripPrice,
    trip.tripFee,
    trip.protection,
    trip.deliveryFee,
  ]);
  const refundHT = subtract(linesTotal, retained);
  const taxableLines = [trip.tripPrice, trip.tripFee];
  const taxPaid = taxByLine(currency, taxableLines, trip.taxRate);
  const paidBase = sum(currency, taxableLines);
  const refundedBase = sum(currency, [
    subtract(trip.tripPrice, retainedP),
    subtract(trip.tripFee, retainedF),
  ]);
  const refundedTax = taxRefund(taxPaid, refundedBase, paidBase);
  const guestRefund = add(refundHT, refundedTax);
  const hostP = allocHost(retainedP, HOST_SHARE);
  const hostD = allocHost(retainedD, DELIVERY_SHARE);
  const hostEarnings = add(hostP, hostD);
  const platformNet = subtract(retained, hostEarnings);
  const retainedTax = subtract(taxPaid, refundedTax);
  const total = add(linesTotal, taxPaid);
  return {
    retainedP,
    retainedF,
    retainedD,
    retained,
    refundHT,
    taxPaid,
    paidBase,
    refundedBase,
    refundedTax,
    guestRefund,
    hostP,
    hostD,
    hostEarnings,
    platformNet,
    retainedTax,
    total,
  };
}

describe('T40 — trip D2 (PYG), GUEST_CANCELLED à T−10 h, VOLUNTARY j = 1 (08)', () => {
  // 08, trip D2 : remboursable, 3 j, P 1 000 002, F 125 500, protection 150 000, D 50 000,
  // taxe 100 000 + 12 550 = 112 550, total 1 438 052.
  const r = replay(
    {
      currency: PYG,
      days: 3n,
      tripPrice: money(1000002n, PYG),
      tripFee: money(125500n, PYG),
      protection: money(150000n, PYG),
      deliveryFee: money(50000n, PYG),
      taxRate: ratio(1n, 10n),
    },
    ratio(1n, 1n),
  );

  it('lignes et taxe payée du trip D2', () => {
    expect(minor(r.taxPaid)).toBe(112550n);
    expect(minor(r.total)).toBe(1438052n);
  });

  it('retenues : P 333 334 (exact), F 41 833, D 25 000 → 400 167', () => {
    expect(minor(r.retainedP)).toBe(333334n);
    expect(minor(r.retainedF)).toBe(41833n);
    expect(minor(r.retainedD)).toBe(25000n);
    expect(minor(r.retained)).toBe(400167n);
  });

  it('remboursement HT 925 335 ; taxe 112 550 × 750 335 / 1 125 502 → 75 033', () => {
    expect(minor(r.refundHT)).toBe(925335n);
    expect(minor(r.refundedBase)).toBe(750335n);
    expect(minor(r.paidBase)).toBe(1125502n);
    expect(minor(r.refundedTax)).toBe(75033n);
  });

  it('remboursement guest 1 000 368', () => {
    expect(minor(r.guestRefund)).toBe(1000368n);
  });

  it('hôte : 0,75 × 333 334 = 250 000,5 → égalité exacte, 250 000 ; + 18 750 = 268 750', () => {
    expect(minor(r.hostP)).toBe(250000n);
    expect(minor(r.hostD)).toBe(18750n);
    expect(minor(r.hostEarnings)).toBe(268750n);
  });

  it('net plateforme 131 417 ; équilibre 1 000 368 + 400 167 + 37 517 = 1 438 052', () => {
    expect(minor(r.platformNet)).toBe(131417n);
    expect(minor(r.retainedTax)).toBe(37517n);
    expect(minor(sum(PYG, [r.guestRefund, r.retained, r.retainedTax]))).toBe(1438052n);
  });
});

describe('T42 — trip H (USD, 1 jour, centimes impairs), GUEST_NO_SHOW, j = ¾ (08)', () => {
  // 08, trip H : remboursable, 1 j, P 45,01, F 6,75, protection 12,00, D 15,01,
  // taxe 3,15 + 0,47 = 3,62, total 82,39.
  const r = replay(
    {
      currency: USD,
      days: 1n,
      tripPrice: money(4501n, USD),
      tripFee: money(675n, USD),
      protection: money(1200n, USD),
      deliveryFee: money(1501n, USD),
      taxRate: ratio(7n, 100n),
    },
    ratio(3n, 4n),
  );

  it('taxe payée par ligne 3,15 + 0,47 = 3,62 ; total 82,39', () => {
    expect(minor(r.taxPaid)).toBe(362n);
    expect(minor(r.total)).toBe(8239n);
  });

  it('retenues : P 33,7575 → 33,76 ; F 5,0625 → 5,06 ; D 7,505 → 7,51 → 46,33', () => {
    expect(minor(r.retainedP)).toBe(3376n);
    expect(minor(r.retainedF)).toBe(506n);
    expect(minor(r.retainedD)).toBe(751n);
    expect(minor(r.retained)).toBe(4633n);
  });

  it('remb. HT 32,44 ; taxe 362 × 1 294 / 5 176 = 90,5 → 91 (demi vers le haut)', () => {
    expect(minor(r.refundHT)).toBe(3244n);
    expect(minor(r.refundedBase)).toBe(1294n);
    expect(minor(r.paidBase)).toBe(5176n);
    expect(minor(r.refundedTax)).toBe(91n);
  });

  it('remboursement guest 33,35', () => {
    expect(minor(r.guestRefund)).toBe(3335n);
  });

  it('hôte : 0,75 × 33,76 = 25,32 + 0,75 × 7,51 = 5,6325 → 5,63 ; total 30,95', () => {
    expect(minor(r.hostP)).toBe(2532n);
    expect(minor(r.hostD)).toBe(563n);
    expect(minor(r.hostEarnings)).toBe(3095n);
  });

  it('net plateforme 15,38 ; équilibre 33,35 + 46,33 + 2,71 = 82,39', () => {
    expect(minor(r.platformNet)).toBe(1538n);
    expect(minor(r.retainedTax)).toBe(271n);
    expect(minor(sum(USD, [r.guestRefund, r.retained, r.retainedTax]))).toBe(8239n);
  });
});

describe('T43 — trip G (USD, taxe par ligne ≠ agrégée), GUEST_CANCELLED à T−10 h, j = ½ (08)', () => {
  // 08, trip G : remboursable, 2 j, P 10,05, F 10,05, taxe 0,70 + 0,70 = 1,40 (agrégé : 1,41),
  // total 21,50.
  const r = replay(
    {
      currency: USD,
      days: 2n,
      tripPrice: money(1005n, USD),
      tripFee: money(1005n, USD),
      protection: money(0n, USD),
      deliveryFee: money(0n, USD),
      taxRate: ratio(7n, 100n),
    },
    ratio(1n, 2n),
  );

  it('taxe payée 1,40 (et non 1,41) ; total 21,50', () => {
    expect(minor(r.taxPaid)).toBe(140n);
    expect(minor(multiplyRoundHalfUp(r.paidBase, ratio(7n, 100n)))).toBe(141n);
    expect(minor(r.total)).toBe(2150n);
  });

  it('retenues : P 10,05 × ½ / 2 = 2,5125 → 2,51 ; F 2,51 → 5,02', () => {
    expect(minor(r.retainedP)).toBe(251n);
    expect(minor(r.retainedF)).toBe(251n);
    expect(minor(r.retained)).toBe(502n);
  });

  it('remb. HT 15,08 ; taxe 140 × 1 508 / 2 010 = 105,03 → 1,05 ; remboursement 16,13', () => {
    expect(minor(r.refundHT)).toBe(1508n);
    expect(minor(r.refundedTax)).toBe(105n);
    expect(minor(r.guestRefund)).toBe(1613n);
  });

  it('hôte 0,75 × 2,51 = 1,8825 → 1,88 ; net plateforme 3,14', () => {
    expect(minor(r.hostEarnings)).toBe(188n);
    expect(minor(r.platformNet)).toBe(314n);
  });

  it('équilibre 16,13 + 5,02 + 0,35 = 21,50', () => {
    expect(minor(r.retainedTax)).toBe(35n);
    expect(minor(sum(USD, [r.guestRefund, r.retained, r.retainedTax]))).toBe(2150n);
  });
});

describe('TA06 — trip PA3 (USD, P0-A), annulation guest à T−10 h, j = ½ (16 A.8.1)', () => {
  // 16 A.8.1 : 1 j, loyer 45,01, ITBMS 7 % sur le loyer seul, commission 12 % sur la part HT
  // conservée par l'agence ; pas de frais guest ni de protection.
  const rent = money(4501n, USD);
  const itbms = ratio(7n, 100n);
  const commissionRate = ratio(12n, 100n);
  const tax = taxByLine(USD, [rent], itbms);
  const total = add(rent, tax);
  const retained = retainedPerDay(rent, ratio(1n, 2n), 1n);
  const refundedRent = subtract(rent, retained);
  const refundedTax = taxRefund(tax, refundedRent, rent);
  const refund = add(refundedRent, refundedTax);
  const kept = subtract(total, refund);
  const commission = multiplyRoundHalfUp(retained, commissionRate);

  it('ITBMS roundHalfUp(315,07) = 3,15 ; total 48,16', () => {
    expect(minor(tax)).toBe(315n);
    expect(minor(total)).toBe(4816n);
  });

  it('retenu roundHalfUp(2 250,5) = 22,51', () => {
    expect(minor(retained)).toBe(2251n);
  });

  it('ITBMS remboursé roundHalfUp(315 × 2 250 / 4 501 = 157,46) = 1,57 ; remboursement 24,07', () => {
    expect(minor(refundedRent)).toBe(2250n);
    expect(minor(refundedTax)).toBe(157n);
    expect(minor(refund)).toBe(2407n);
  });

  it('conservé 24,09 ; commission roundHalfUp(270,12) = 2,70', () => {
    expect(minor(kept)).toBe(2409n);
    expect(minor(commission)).toBe(270n);
  });
});
