/**
 * Forme de la requête de recherche (US-201) : attendus de 19 US-201 critère 1 (« début 10:00 et
 * fin 09:30 le même jour ⇒ SEARCH_DATES_INVALID »), de 16 SRC-001 (`SEARCH_LOCATION_REQUIRED`) et
 * de 08 BR-BOOK-03 (pas de 30 min), jamais du code testé.
 */
import { describe, expect, it } from 'vitest';
import { localSlot, parseSearchQuery } from './model.js';

const BASE = { country: 'ZZ', city: 'Ciudad', start: '2036-12-10T10:00', end: '2036-12-12T10:00' };

describe('US-201 — requête de recherche', () => {
  it('requête valide : pays, ville, zone facultative, heures locales', () => {
    expect(parseSearchQuery({ ...BASE, area: ' Barrio Norte ' })).toEqual({
      ok: true,
      query: {
        country: 'ZZ',
        city: 'Ciudad',
        area: 'Barrio Norte',
        startLocal: '2036-12-10T10:00',
        endLocal: '2036-12-12T10:00',
        limit: null,
      },
    });
    expect(parseSearchQuery({ ...BASE, area: '', limit: '20' })).toMatchObject({
      ok: true,
      query: { area: null, limit: 20 },
    });
  });

  it('critère 1 : fin 09:30 avant un début 10:00 le même jour, ou égale ⇒ SEARCH_DATES_INVALID', () => {
    for (const end of ['2036-12-10T09:30', '2036-12-10T10:00', '2036-12-09T23:30']) {
      expect(parseSearchQuery({ ...BASE, end })).toEqual({
        ok: false,
        code: 'SEARCH_DATES_INVALID',
      });
    }
  });

  it('pas de 30 min, calendrier réel, format sans fuseau ⇒ sinon SEARCH_DATES_INVALID', () => {
    expect(localSlot('2036-12-10T10:30')).toBe('2036-12-10T10:30');
    expect(localSlot('2036-02-29T00:00')).toBe('2036-02-29T00:00');
    for (const bad of [
      '2036-12-10T10:15',
      '2036-12-10T10:01',
      '2035-02-29T10:00',
      '2036-13-01T10:00',
      '2036-12-10T24:00',
      '2036-12-10T10:00:00',
      '2036-12-10T10:00Z',
      '2036-12-10',
      ['2036-12-10T10:00'],
      undefined,
    ]) {
      expect(localSlot(bad), String(bad)).toBeNull();
      expect(parseSearchQuery({ ...BASE, start: bad })).toEqual({
        ok: false,
        code: 'SEARCH_DATES_INVALID',
      });
    }
  });

  it('lieu : pays au format de la configuration et ville non vide exigés ⇒ sinon SEARCH_LOCATION_REQUIRED', () => {
    for (const p of [
      { ...BASE, country: undefined },
      { ...BASE, country: 'zz' },
      { ...BASE, country: 'ZZZ' },
      { ...BASE, city: '' },
      { ...BASE, city: '  ' },
      { ...BASE, city: 'x'.repeat(121) },
      { ...BASE, area: 'x'.repeat(121) },
      { ...BASE, city: ['Ciudad'] },
    ]) {
      expect(parseSearchQuery(p)).toEqual({ ok: false, code: 'SEARCH_LOCATION_REQUIRED' });
    }
  });

  it('nombre de résultats de 1 à 50 ⇒ sinon REQUEST_INVALID', () => {
    for (const limit of ['0', '51', '-1', '1.5', 'abc', '']) {
      expect(parseSearchQuery({ ...BASE, limit })).toEqual({ ok: false, code: 'REQUEST_INVALID' });
    }
    expect(parseSearchQuery({ ...BASE, limit: '50' })).toMatchObject({ ok: true });
  });
});
