/**
 * Jours facturables (17 §2.6 ; 16 PRC-025 et TA07 ; 08 BR-BOOK-03 ; OQ-BR-04) :
 *
 *   billable_days = max(1, ceil((fin − début − grace_minutes) / 24 h))
 *
 * **Une seule fonction**, paramétrée par `grace_minutes` du pays (29 tant qu'OQ-BR-04 est ouverte),
 * utilisée partout (devis, modification, retour). Le calcul porte sur des **instants** (millisecondes
 * UTC) et des blocs de 24 h exactes, comme Turo : il ne dépend d'aucun fuseau, donc d'aucun
 * changement d'heure (L2-PM-13). Arithmétique entière en `bigint` : aucun flottant.
 *
 * Le retard (`overdue_detection_minutes`, paramètre distinct) n'est pas calculé ici.
 */
import { QuoteError } from './errors.js';

const MINUTE_MS = 60_000n;
const DAY_MS = 24n * 60n * MINUTE_MS;

function instant(name: string, value: number): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new QuoteError('QUOTE_INPUT_INVALID', `${name} : instant UTC en ms (entier sûr) attendu`);
  }
  return BigInt(value);
}

/** Plafond entier de a / b pour b > 0 (a de signe quelconque). */
function ceilDiv(a: bigint, b: bigint): bigint {
  const q = a / b; // troncature vers 0
  return a % b !== 0n && a > 0n ? q + 1n : q;
}

/**
 * Jours facturables d'une période `[startAtMs ; endAtMs[`. Refuse une fin qui n'est pas strictement
 * postérieure au début (`QUOTE_INPUT_INVALID`) et une tolérance qui n'est pas un entier ≥ 0.
 */
export function billableDays(startAtMs: number, endAtMs: number, graceMinutes: number): number {
  const start = instant('startAtMs', startAtMs);
  const end = instant('endAtMs', endAtMs);
  if (end <= start) {
    throw new QuoteError('QUOTE_INPUT_INVALID', 'la fin doit être postérieure au début');
  }
  if (!Number.isSafeInteger(graceMinutes) || graceMinutes < 0) {
    throw new QuoteError('QUOTE_UNAVAILABLE', 'grace_minutes : entier ≥ 0 attendu');
  }
  const days = ceilDiv(end - start - BigInt(graceMinutes) * MINUTE_MS, DAY_MS);
  return Number(days > 1n ? days : 1n);
}
