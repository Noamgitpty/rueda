/**
 * Jambes explicites d'un état du règlement (08 E7, US-055) : `HOST`, `INSURER`, `TAX_THIRD_PARTY`,
 * `PLATFORM`. Mêmes `roundHalfUp` et `allocHost` uniques que `settle` ; la plateforme prend le
 * complément, donc Σ jambes = montant exact (règle 8). Jamais de prorata (règle 1).
 */
import { add, multiplyRoundHalfUp, subtract, sum, zero, type Money } from '../money.ts';
import { assertRatio, type Ratio } from '../ratio.ts';
import { SettlementError } from './errors.ts';
import { hostFromGuestOf, line } from './lines.ts';
import {
  LEGS,
  SETTLEMENT_LINES,
  type Leg,
  type Legs,
  type SettlementLine,
  type SettlementTrip,
} from './types.ts';

/** Part assureur exigée dès que la ligne retenue n'est pas nulle ; absente ⇒ refus (jamais 0). */
function insurerPart(amount: Money, share: Ratio | undefined, name: string): Money {
  if (amount.amountMinor === 0n) return amount;
  if (share === undefined) {
    throw new SettlementError(
      'SETTLEMENT_CONFIG_INVALID',
      `${name} absente : part assureur requise (08 E7, erreur de configuration bloquante)`,
    );
  }
  assertRatio(share);
  if (share.num < 0n || share.num > share.den) {
    throw new SettlementError('SETTLEMENT_CONFIG_INVALID', `${name} hors de [0 ; 1]`);
  }
  return multiplyRoundHalfUp(amount, share);
}

/** 08 E7 `legs(trip, retained, retainedTaxByGroup, hostFromGuest)`. */
export function computeLegs(
  trip: SettlementTrip,
  retained: Readonly<Record<SettlementLine, Money>>,
  retainedTaxByGroup: Readonly<Record<string, Money>>,
  hostFromGuest: Money,
): Legs {
  const c = trip.currency;
  const HOST = add(zero(c), hostFromGuest);
  const INSURER = add(
    insurerPart(retained.protection, trip.insurerPremiumShareFrozen, 'insurerPremiumShareFrozen'),
    insurerPart(
      retained.enhancedRoadside,
      trip.insurerRoadsideShareFrozen,
      'insurerRoadsideShareFrozen',
    ),
  );
  const TAX_THIRD_PARTY = sum(
    c,
    trip.taxGroups.filter((g) => g.thirdParty).map((g) => retainedTaxByGroup[g.id] ?? zero(c)),
  );
  const total = add(
    sum(
      c,
      SETTLEMENT_LINES.map((l) => retained[l]),
    ),
    sum(
      c,
      trip.taxGroups.map((g) => retainedTaxByGroup[g.id] ?? zero(c)),
    ),
  );
  const PLATFORM = subtract(subtract(subtract(total, HOST), INSURER), TAX_THIRD_PARTY);
  return Object.freeze({ HOST, INSURER, TAX_THIRD_PARTY, PLATFORM, total });
}

/** `captureLegs(trip)` : toutes les lignes retenues, toute la taxe, hôte éligible (08 E7). */
export function computeCaptureLegs(trip: SettlementTrip): Legs {
  const all = Object.fromEntries(SETTLEMENT_LINES.map((l) => [l, line(trip, l)])) as Record<
    SettlementLine,
    Money
  >;
  const taxes = Object.fromEntries(trip.taxGroups.map((g) => [g.id, g.taxPaid]));
  return computeLegs(trip, all, taxes, hostFromGuestOf(trip, all));
}

/** `variation(v → w)` : variation signée de chaque jambe (ordre de règlement, E7 règle 3). */
export function legVariation(from: Legs, to: Legs): Legs {
  const out = {} as Record<Leg, Money>;
  for (const k of LEGS) out[k] = subtract(to[k], from[k]);
  return Object.freeze({ ...out, total: subtract(to.total, from.total) });
}
