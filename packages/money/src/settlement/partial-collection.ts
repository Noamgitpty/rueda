/**
 * Encaissement partiel d'une dette, jambe par jambe (08 E7 règle 4, révisée par US-056 ; US-703,
 * ADR-189). Fonction pure, versionnée (`PARTIAL_COLLECTION_RULE_VERSION`) : la base la rejoue à
 * l'identique (`core.payment_partial_collection_legs`, 0169) et refuse tout autre résultat.
 *
 * Pour une dette de jambes réglées `due` (Σ = `owed`), déjà encaissée à hauteur de `carried` (cumul
 * par jambe, Σ = `c`), un encaissement `a` :
 * 1. remplit, dans l'ordre `HOST` → `INSURER` → `TAX_THIRD_PARTY`,
 *    `max(0, min(⌊due[L] × (c + a) / owed⌋ − carried[L], reste))` (cible cumulative, manque reporté) ;
 * 2. donne à `PLATFORM` `min(reste, due[PLATFORM] − carried[PLATFORM])` (plafond) ;
 * 3. verse l'excédent éventuel aux reports, dans l'ordre `TAX_THIRD_PARTY` → `INSURER` → `HOST`,
 *    dans la limite de ce qui reste dû sur chaque jambe.
 * Aucun incrément n'est négatif, aucune jambe ne reçoit au cumul plus que sa valeur réglée, et le
 * solde (`c + a = owed`) solde chaque jambe exactement, sans réaffectation (TJ07, TJ17, TJ19).
 * Aucun prorata arrondi, aucun `roundHalfUp` : une division entière par défaut (cible de E1).
 */
import type { Currency } from '../currency.ts';
import { add, isNegative, money, subtract, sum, type Money } from '../money.ts';
import { floorDiv } from '../rounding.ts';
import { SettlementError } from './errors.ts';
import { LEGS, type Leg, type Legs } from './types.ts';

/** Version de la règle (08 E7 règle 4 révisée par US-056) ; écrite avec chaque encaissement. */
export const PARTIAL_COLLECTION_RULE_VERSION = 'E7R4-US056';

/** Jambes remplies d'abord, à leur cible cumulative (08 E7 règle 4). */
const TARGET_ORDER = ['HOST', 'INSURER', 'TAX_THIRD_PARTY'] as const satisfies readonly Leg[];
/** Ordre de l'excédent après le plafond de `PLATFORM` (08 E7 règle 4, US-056). */
const SURPLUS_ORDER = ['TAX_THIRD_PARTY', 'INSURER', 'HOST'] as const satisfies readonly Leg[];

const invalid = (message: string): SettlementError =>
  new SettlementError('SETTLEMENT_INPUT_INVALID', message);

/**
 * Incréments de jambe d'un encaissement `amount` (devise `currency`) d'une dette aux jambes `due`, déjà encaissée de
 * `carried`. Refus (`SETTLEMENT_INPUT_INVALID`) : devises différentes, jambe due ou cumul négatif,
 * cumul au-delà du dû d'une jambe, encaissement nul, négatif ou supérieur au reste dû ; dette de
 * jambe négative (`LEG_AMOUNT_NEGATIVE`).
 */
export function partialCollectionLegs(
  currency: Currency,
  due: Legs,
  carried: Legs,
  amount: Money,
): Legs {
  if (amount.currency !== currency.code) {
    throw invalid('devises différentes entre la dette, le cumul et l’encaissement');
  }
  for (const k of LEGS) {
    if (due[k].currency !== currency.code || carried[k].currency !== currency.code) {
      throw invalid('devises différentes entre la dette, le cumul et l’encaissement');
    }
    if (isNegative(due[k])) {
      throw new SettlementError('LEG_AMOUNT_NEGATIVE', `jambe due ${k} négative`);
    }
    if (isNegative(carried[k]) || carried[k].amountMinor > due[k].amountMinor) {
      throw invalid(`cumul encaissé de ${k} hors de [0 ; dû]`);
    }
  }
  const owed = sum(
    currency,
    LEGS.map((k) => due[k]),
  ).amountMinor;
  const c = sum(
    currency,
    LEGS.map((k) => carried[k]),
  ).amountMinor;
  const a = amount.amountMinor;
  if (a <= 0n) throw invalid('encaissement nul ou négatif');
  if (c + a > owed) throw invalid('encaissement supérieur au reste dû');

  const inc: Record<Leg, bigint> = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };
  let rest = a;
  for (const k of TARGET_ORDER) {
    const target = floorDiv(due[k].amountMinor * (c + a), owed);
    const want = target - carried[k].amountMinor;
    const take = want <= 0n ? 0n : want < rest ? want : rest;
    inc[k] = take;
    rest -= take;
  }
  const platformRoom = due.PLATFORM.amountMinor - carried.PLATFORM.amountMinor;
  inc.PLATFORM = rest < platformRoom ? rest : platformRoom;
  rest -= inc.PLATFORM;
  for (const k of SURPLUS_ORDER) {
    const room = due[k].amountMinor - carried[k].amountMinor - inc[k];
    const add_ = rest < room ? rest : room;
    inc[k] += add_;
    rest -= add_;
  }
  // c + a ≤ owed garantit qu'il ne reste rien (chaque jambe a encore de la place)
  if (rest !== 0n) throw invalid('encaissement supérieur au reste dû');
  const out = {} as Record<Leg, Money>;
  for (const k of LEGS) out[k] = money(inc[k], currency);
  return Object.freeze({ ...out, total: amount });
}

/** Cumul par jambe après un encaissement (`carried + increments`). */
export function addLegs(a: Legs, b: Legs): Legs {
  const out = {} as Record<Leg, Money>;
  for (const k of LEGS) out[k] = add(a[k], b[k]);
  return Object.freeze({ ...out, total: add(a.total, b.total) });
}

/** Reste dû par jambe (`due − carried`). */
export function remainingLegs(due: Legs, carried: Legs): Legs {
  const out = {} as Record<Leg, Money>;
  for (const k of LEGS) out[k] = subtract(due[k], carried[k]);
  return Object.freeze({ ...out, total: subtract(due.total, carried.total) });
}
