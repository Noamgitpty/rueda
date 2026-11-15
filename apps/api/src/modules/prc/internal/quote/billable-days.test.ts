/**
 * Jours facturables (US-202 critère 3 ; 16 TA07 ; 17 §2.6 ; OQ-BR-04).
 *
 * Attendus : fonction `billed(minutes, tol)` de l'oracle `docs/specs/tools/verif15_ta.py`
 * (TA07), exécutée le 2026-11-14 avec `python -I -X utf8` pour chaque tolérance du tableau
 * (runpy du script, puis `billed(m, tol)`). La tolérance 29 est le défaut de 22 (OQ-BR-04) ;
 * 0 et 120 (option `billing_boundary_minutes` PROPOSÉE, non appliquée) montrent que seul le
 * paramètre change : le test est paramétré.
 */
import { describe, expect, it } from 'vitest';
import { billableDays } from './billable-days.js';
import { resolveQuoteParams } from './params.js';
import { codeOf, repoConfig } from '../../../../../test/support/quote.js';

const MIN = 60_000;
const START = Date.UTC(2026, 2, 1, 15, 0, 0);
const DURATIONS_MIN = [3 * 1440 + 29, 3 * 1440 + 30, 240, 1440, 1440 + 29, 1440 + 30, 29, 1];

// tolérance → attendus de l'oracle, dans l'ordre de DURATIONS_MIN
const ORACLE: readonly (readonly [number, readonly number[]])[] = [
  [29, [3, 4, 1, 1, 1, 2, 1, 1]],
  [0, [4, 4, 1, 1, 2, 2, 1, 1]],
  [120, [3, 3, 1, 1, 1, 1, 1, 1]],
];

describe('TA07 : max(1, ceil((fin − début − tolérance) / 24 h))', () => {
  it('grace_minutes = 29 : 3 j 29 min ⇒ 3 ; 3 j 30 min ⇒ 4 ; 4 h ⇒ 1', () => {
    expect(billableDays(START, START + (3 * 1440 + 29) * MIN, 29)).toBe(3);
    expect(billableDays(START, START + (3 * 1440 + 30) * MIN, 29)).toBe(4);
    expect(billableDays(START, START + 240 * MIN, 29)).toBe(1);
  });

  it.each(ORACLE)('tolérance %i min : attendus de l’oracle', (tol, expected) => {
    expect(DURATIONS_MIN.map((m) => billableDays(START, START + m * MIN, tol))).toEqual(expected);
  });

  it('borne à la milliseconde : 1 j + tolérance ⇒ 1 ; une ms de plus ⇒ 2', () => {
    expect(billableDays(START, START + (1440 + 29) * MIN, 29)).toBe(1);
    expect(billableDays(START, START + (1440 + 29) * MIN + 1, 29)).toBe(2);
  });

  it('instants seulement : même résultat quel que soit le décalage horaire de l’écriture', () => {
    const a = Date.parse('2026-03-01T10:00:00-03:00');
    const b = Date.parse('2026-03-04T10:29:00-03:00');
    const c = Date.parse('2026-03-01T08:00:00-05:00');
    const d = Date.parse('2026-03-04T08:29:00-05:00');
    expect(billableDays(a, b, 29)).toBe(3);
    expect(billableDays(c, d, 29)).toBe(3);
  });

  it('chaque pays du dépôt : grace_minutes lu de la configuration donne TA07', () => {
    for (const country of repoConfig.countries.keys()) {
      const { graceMinutes } = resolveQuoteParams(repoConfig, {
        country,
        at: new Date(START),
      });
      expect(graceMinutes).toBe(29);
      expect(
        [3 * 1440 + 29, 3 * 1440 + 30, 240].map((m) =>
          billableDays(START, START + m * MIN, graceMinutes),
        ),
      ).toEqual([3, 4, 1]);
    }
  });

  it('fin ≤ début, instant non entier ⇒ QUOTE_INPUT_INVALID ; tolérance invalide ⇒ QUOTE_UNAVAILABLE', () => {
    expect(codeOf(() => billableDays(START, START, 29))).toBe('QUOTE_INPUT_INVALID');
    expect(codeOf(() => billableDays(START, START - 1, 29))).toBe('QUOTE_INPUT_INVALID');
    expect(codeOf(() => billableDays(START + 0.5, START + MIN, 29))).toBe('QUOTE_INPUT_INVALID');
    expect(codeOf(() => billableDays(START, START + MIN, -1))).toBe('QUOTE_UNAVAILABLE');
    expect(codeOf(() => billableDays(START, START + MIN, 1.5))).toBe('QUOTE_UNAVAILABLE');
  });
});
