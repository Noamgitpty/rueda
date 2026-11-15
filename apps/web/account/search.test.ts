/**
 * Recherche publique côté site (US-201) : lecture défensive des réponses de l'API (une réponse
 * mal formée est refusée en bloc) et saisie du formulaire de S01. Attendus tirés de 19 US-201
 * (critère 1 : « début 10:00 et fin 09:30 le même jour ⇒ SEARCH_DATES_INVALID » ; critère 2 :
 * dates reprises sur la fiche ; critère 3 : heures dans le fuseau du véhicule) et de 16 SRC-001
 * (pas de 30 min), jamais du code testé. Pays et fuseau fictifs (`ZZ`, `UTC`).
 */
import { describe, expect, it } from 'vitest';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import {
  listingDatesOf,
  listingHref,
  placeOf,
  placeValue,
  searchApiPath,
  searchAreasOf,
  searchErrorKey,
  searchHref,
  searchInputOf,
  searchResultsOf,
  TIME_SLOTS,
  wallClock,
} from './search.ts';

const ID = '20100000-0000-4000-8000-000000000001';
const reply = (json: unknown, status = 200) => ({ status, json, session: null });
const RESULT = {
  id: ID,
  dailyPriceMinor: '4000',
  currency: 'XTS',
  currencyExponent: 2,
  instantBook: true,
  makeName: 'Marca',
  modelName: 'Modelo',
  year: 2021,
  transmission: 'AUTOMATIC',
  seats: 5,
  fuelType: 'GASOLINE',
  locationKind: 'HOME',
  city: 'Ciudad',
  areaLabel: 'Barrio',
  approximatePoint: { lat: 8.99, lng: -79.51 },
  timezone: 'UTC',
  startAt: '2036-12-10T10:00:00.000Z',
  endAt: '2036-12-12T10:00:00.000Z',
};
const PLACE = placeValue({ country: 'ZZ', city: 'Ciudad', area: 'Barrio' });
const FORM = {
  place: PLACE,
  startDate: '2036-12-10',
  startTime: '10:00',
  endDate: '2036-12-12',
  endTime: '10:00',
};

describe('US-201 — recherche côté site', () => {
  it('créneaux du sélecteur : 48, de 00:00 à 23:30 au pas de 30 min', () => {
    expect(TIME_SLOTS).toHaveLength(48);
    expect(TIME_SLOTS[0]).toBe('00:00');
    expect(TIME_SLOTS[1]).toBe('00:30');
    expect(TIME_SLOTS[47]).toBe('23:30');
  });

  it('zones : réponse lue ; forme inattendue refusée en bloc', () => {
    const areas = [
      { country: 'ZZ', city: 'Ciudad', area: null, timezone: 'UTC' },
      { country: 'ZZ', city: 'Ciudad', area: 'Barrio', timezone: 'UTC' },
    ];
    expect(searchAreasOf(reply({ areas }))).toEqual(areas);
    expect(searchAreasOf(reply({ areas: [] }))).toEqual([]);
    for (const bad of [
      { areas: [{ ...areas[0], country: 'zz' }] },
      { areas: [{ ...areas[0], city: '' }] },
      { areas: [{ ...areas[0], area: 3 }] },
      { areas: [{ ...areas[0], timezone: null }] },
      { areas: 'x' },
      null,
    ]) {
      expect(searchAreasOf(reply(bad))).toBeNull();
    }
    expect(searchAreasOf(reply({ areas }, 503))).toBeNull();
    expect(searchAreasOf({ status: 'unavailable' })).toBeNull();
  });

  it('résultats : C0 lus (prix en bigint, instants UTC) ; forme inattendue refusée en bloc', () => {
    const [r] = searchResultsOf(reply({ results: [RESULT] })) ?? [];
    expect(r).toMatchObject({
      id: ID,
      dailyPriceMinor: 4000n,
      timezone: 'UTC',
      areaLabel: 'Barrio',
    });
    expect(searchResultsOf(reply({ results: [] }))).toEqual([]);
    for (const bad of [
      { ...RESULT, id: 'x' },
      { ...RESULT, dailyPriceMinor: 40 },
      { ...RESULT, currency: 'xts' },
      { ...RESULT, startAt: '2036-12-10T10:00' },
      { ...RESULT, timezone: '' },
    ]) {
      expect(searchResultsOf(reply({ results: [bad] }))).toBeNull();
    }
    expect(searchResultsOf(reply({ code: 'SEARCH_DATES_INVALID' }, 422))).toBeNull();
  });

  it('lieu : valeur d’option aller-retour, zone nulle = toute la ville ; valeur forgée refusée', () => {
    expect(placeOf(PLACE)).toEqual({ country: 'ZZ', city: 'Ciudad', area: 'Barrio' });
    expect(placeOf(placeValue({ country: 'ZZ', city: 'Ciudad', area: null }))).toMatchObject({
      area: null,
    });
    for (const bad of [
      '',
      'x',
      '["zz","Ciudad",null]',
      '["ZZ","",null]',
      '["ZZ","Ciudad",""]',
      '["ZZ","Ciudad"]',
      `["ZZ","${'x'.repeat(121)}",null]`,
      undefined,
    ]) {
      expect(placeOf(bad)).toBeNull();
    }
  });

  it('critère 1 : début 10:00 et fin 09:30 le même jour ⇒ SEARCH_DATES_INVALID ; lieu absent ⇒ SEARCH_LOCATION_REQUIRED', () => {
    expect(
      searchInputOf({ ...FORM, endDate: '2036-12-10', endTime: '09:30', startTime: '10:00' }),
    ).toEqual({ ok: false, code: 'SEARCH_DATES_INVALID' });
    expect(searchInputOf({ ...FORM, endDate: '2036-12-10' })).toEqual({
      ok: false,
      code: 'SEARCH_DATES_INVALID',
    });
    expect(searchInputOf({ ...FORM, startTime: '10:15' })).toEqual({
      ok: false,
      code: 'SEARCH_DATES_INVALID',
    });
    expect(searchInputOf({ ...FORM, place: '' })).toEqual({
      ok: false,
      code: 'SEARCH_LOCATION_REQUIRED',
    });
    expect(searchErrorKey('SEARCH_DATES_INVALID')).toBe('common.search.datesInvalid');
    expect(searchErrorKey(reply({ code: 'SEARCH_DURATION_EXCEEDED' }, 422))).toBe(
      'common.search.durationExceeded',
    );
    expect(searchErrorKey({ status: 'unavailable' })).toBe('common.search.unavailable');
  });

  it('recherche valide : chemin de l’API ; lien vers la fiche avec les dates reprises (critère 2) ; retour à la recherche', () => {
    const parsed = searchInputOf(FORM);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const params = new URLSearchParams(searchApiPath(parsed.input).split('?')[1]);
    expect(Object.fromEntries(params)).toEqual({
      country: 'ZZ',
      city: 'Ciudad',
      area: 'Barrio',
      start: '2036-12-10T10:00',
      end: '2036-12-12T10:00',
    });
    const href = listingHref(ID, parsed.input);
    expect(href.startsWith(`/listings/${ID}?`)).toBe(true);
    const dates = listingDatesOf(Object.fromEntries(new URLSearchParams(href.split('?')[1])));
    expect(dates).toEqual({ start: '2036-12-10T10:00', end: '2036-12-12T10:00' });
    const back = Object.fromEntries(new URLSearchParams(searchHref(parsed.input).split('?')[1]));
    expect(searchInputOf(back)).toEqual(parsed);
    expect(listingDatesOf({ start: '2036-12-12T10:00', end: '2036-12-10T10:00' })).toBeNull();
    expect(listingDatesOf({ start: '2036-12-10T10:15', end: '2036-12-12T10:00' })).toBeNull();
    expect(listingDatesOf({})).toBeNull();
  });

  it('critère 3 : un instant rendu par l’API s’affiche dans le fuseau du véhicule ; l’heure locale saisie s’affiche telle quelle', () => {
    const i18n = createTranslator(getProfile(LOCALE_CONFIG, LOCALE_CONFIG.defaultLocale));
    // 13:00 UTC = 10:00 à UTC−3 (fuseau IANA fourni par l'API ; `Etc/GMT+3` = UTC−3)
    expect(i18n.time('2036-12-10T13:00:00.000Z', 'Etc/GMT+3')).toBe(
      i18n.time(wallClock('2036-12-10T10:00'), 'UTC'),
    );
  });
});
