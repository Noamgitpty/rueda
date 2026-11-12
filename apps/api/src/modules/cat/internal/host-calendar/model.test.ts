/**
 * Saisie du calendrier de l'hôte (US-119) : attendus de 16 CAL-002 (« blocage du 10 au 12 »,
 * jour ou heure), de 08 BR-BOOK-03 (pas de 30 min) et de 16 CAL-003 / 08 BR-BOOK-04 (préavis de
 * l'hôte ; bornes PROPOSÉES comme Turo : 1 h à 7 jours), jamais du code testé.
 */
import { describe, expect, it } from 'vitest';
import { FieldValidationError } from '../host-listings/model.js';
import { parseBlock, parseNotice } from './model.js';

const problems = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    if (error instanceof FieldValidationError) return error.problems;
    throw error;
  }
  return null;
};

describe('parseBlock', () => {
  it('jours inclus : du 10 au 12 ⇒ [10 00:00, 13 00:00) ; un seul jour ; fin de mois et d’année', () => {
    expect(parseBlock({ from: '2036-12-10', to: '2036-12-12' })).toEqual({
      startLocal: '2036-12-10T00:00',
      endLocal: '2036-12-13T00:00',
    });
    expect(parseBlock({ from: '2036-12-10', to: '2036-12-10' })).toEqual({
      startLocal: '2036-12-10T00:00',
      endLocal: '2036-12-11T00:00',
    });
    expect(parseBlock({ from: '2036-12-31', to: '2036-12-31' }).endLocal).toBe('2037-01-01T00:00');
    expect(parseBlock({ from: '2036-02-28', to: '2036-02-29' }).endLocal).toBe('2036-03-01T00:00');
  });

  it('heures au pas de 30 min, fin exclue', () => {
    expect(parseBlock({ start: '2036-12-14T08:30', end: '2036-12-14T12:00' })).toEqual({
      startLocal: '2036-12-14T08:30',
      endLocal: '2036-12-14T12:00',
    });
  });

  it('refus champ par champ : jour impossible, hors pas, fin non postérieure, mélange, vide', () => {
    expect(problems(() => parseBlock({ from: '2035-02-29', to: '2035-03-01' }))).toEqual([
      { field: 'from', reason: 'INVALID' },
    ]);
    expect(problems(() => parseBlock({ from: '2036-12-12', to: '2036-12-10' }))).toEqual([
      { field: 'to', reason: 'INVALID' },
    ]);
    expect(
      problems(() => parseBlock({ start: '2036-12-14T08:15', end: '2036-12-14T24:00' })),
    ).toEqual([
      { field: 'start', reason: 'INVALID' },
      { field: 'end', reason: 'INVALID' },
    ]);
    expect(
      problems(() => parseBlock({ start: '2036-12-14T12:00', end: '2036-12-14T12:00' })),
    ).toEqual([{ field: 'end', reason: 'INVALID' }]);
    expect(problems(() => parseBlock({ from: '2036-12-10', end: '2036-12-14T12:00' }))).toEqual([
      { field: 'from', reason: 'REQUIRED' },
    ]);
    expect(problems(() => parseBlock({}))).toEqual([{ field: 'from', reason: 'REQUIRED' }]);
    expect(problems(() => parseBlock({ from: 20361210, to: '2036-12-12' }))).toEqual([
      { field: 'from', reason: 'INVALID' },
    ]);
  });
});

describe('parseNotice', () => {
  it('60 à 10 080 min au pas de 30, ou null (défaut du pays)', () => {
    expect(parseNotice({ minutes: 180 })).toBe(180);
    expect(parseNotice({ minutes: 60 })).toBe(60);
    expect(parseNotice({ minutes: 10_080 })).toBe(10_080);
    expect(parseNotice({ minutes: null })).toBeNull();
  });

  it('refus : sous le minimum, au-delà, hors pas, non entier, texte, champ manquant ou en trop', () => {
    for (const minutes of [0, 30, 45, 10_110, 90.5, '180', true]) {
      expect(
        problems(() => parseNotice({ minutes })),
        String(minutes),
      ).toEqual([{ field: 'minutes', reason: 'INVALID' }]);
    }
    expect(problems(() => parseNotice({}))).toEqual([{ field: 'minutes', reason: 'REQUIRED' }]);
    expect(problems(() => parseNotice({ minutes: 180, extra: 1 }))).toEqual([
      { field: 'minutes', reason: 'REQUIRED' },
    ]);
  });
});
