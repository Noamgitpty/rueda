/**
 * US-115 — validation des saisies de l'hôte (16 HST-011, HST-033, PRC-001 ; UX-50 : erreur liée au
 * champ). Attendus tirés de 16 et de 17 §3.2.3 ; la base revérifie tout (l0-us115).
 */
import { describe, expect, it } from 'vitest';
import {
  FieldValidationError,
  normalizePlate,
  normalizeVin,
  parseListing,
  parseLocation,
  parsePricing,
  parseVehicle,
} from './model.js';

const fieldsOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof FieldValidationError) return error.problems.map((p) => p.field).sort();
    throw error;
  }
  return [];
};

const LOC = '00000000-0000-4000-8000-000000000001';

describe('plaque et VIN (critère 1, L1-PM-20)', () => {
  it('casse, espaces, points et tirets normalisés ; caractère étranger refusé, jamais retiré', () => {
    expect(normalizePlate(' ab-12.3 ')).toBe('AB123');
    expect(normalizePlate('8AB 1234')).toBe('8AB1234');
    expect(normalizePlate('АB123')).toBeNull(); // « А » cyrillique
    expect(normalizePlate('AB_123')).toBeNull();
    expect(normalizePlate('-')).toBeNull();
  });

  it('VIN ISO 3779 (17, ni I, O ni Q) ; 5 à 17 avant 1981', () => {
    expect(normalizeVin('1hgcm 82633a00435-2', 2021)).toBe('1HGCM82633A004352');
    expect(normalizeVin('1hgcm82633a004352', 2021)).toBe('1HGCM82633A004352');
    expect(normalizeVin('IOQ45678901234567', 2021)).toBeNull();
    expect(normalizeVin('AB123', 1975)).toBe('AB123');
    expect(normalizeVin('AB123', 1985)).toBeNull();
  });
});

describe('véhicule (16 HST-011)', () => {
  const base = {
    locationId: LOC,
    plate: 'ab-123',
    makeText: 'Marca',
    modelText: 'Modelo',
    year: 2021,
    transmission: 'MANUAL',
    seats: 5,
    fuelType: 'DIESEL',
  };
  it('saisie complète : plaque normalisée, repli marque / modèle', () => {
    expect(parseVehicle(base)).toMatchObject({
      plate: 'AB123',
      variantId: null,
      makeText: 'Marca',
    });
  });
  it('champs obligatoires et invalides liés au champ ; jamais la valeur', () => {
    expect(fieldsOf(() => parseVehicle({}))).toEqual(
      [
        'fuelType',
        'locationId',
        'makeText',
        'modelText',
        'plate',
        'seats',
        'transmission',
        'year',
      ].sort(),
    );
    expect(
      fieldsOf(() => parseVehicle({ ...base, seats: 0, year: 1800, fuelType: 'LPG' })),
    ).toEqual(['fuelType', 'seats', 'year']);
    // variante ET repli : refusé (17 §3.2.3, repli seulement sans variante)
    expect(fieldsOf(() => parseVehicle({ ...base, variantId: LOC }))).toEqual(['makeText']);
    expect(fieldsOf(() => parseVehicle({ ...base, companyName: 'Rent SA' }))).toEqual([
      'companyName',
    ]);
  });
});

describe('lieu de remise (OQ-P2P-05)', () => {
  const base = { label: 'Casa', addressLine: 'Calle 1', city: 'Ciudad' };
  it('épingle facultative, jamais à moitié posée ; arrondie au micro-degré', () => {
    expect(parseLocation(base)).toMatchObject({ kind: 'HOME', lat: null, lng: null });
    expect(parseLocation({ ...base, lat: 8.98371234, lng: -79.5198431 })).toMatchObject({
      lat: 8.983712,
      lng: -79.519843,
    });
    expect(fieldsOf(() => parseLocation({ ...base, lat: 8.9 }))).toEqual(['lng']);
    expect(fieldsOf(() => parseLocation({ ...base, lat: 91, lng: 0 }))).toEqual(['lat']);
    expect(fieldsOf(() => parseLocation({ ...base, kind: 'COUNTER' }))).toEqual(['kind']);
  });
});

describe('tarif (PRC-001, HST-033)', () => {
  it('unités mineures en chaîne d’entier, jamais un nombre ni une décimale', () => {
    expect(parsePricing({ dailyPriceMinor: '250000' }).dailyPriceMinor).toBe(250000n);
    for (const v of ['2505.5', 2500, '-1', '0', '01', ''])
      expect(
        fieldsOf(() => parsePricing({ dailyPriceMinor: v })),
        String(v),
      ).toEqual(['dailyPriceMinor']);
  });
  it('distance incluse : km par jour et prix du km exigés ; illimité : aucun des deux', () => {
    expect(
      parsePricing({
        dailyPriceMinor: '1',
        mileageMode: 'INCLUDED',
        includedKmPerDay: 250,
        extraKmPriceMinor: '0',
      }),
    ).toMatchObject({ includedKmPerDay: 250, extraKmPriceMinor: 0n });
    expect(fieldsOf(() => parsePricing({ dailyPriceMinor: '1', mileageMode: 'INCLUDED' }))).toEqual(
      ['extraKmPriceMinor', 'includedKmPerDay'],
    );
    expect(fieldsOf(() => parsePricing({ dailyPriceMinor: '1', includedKmPerDay: 10 }))).toEqual([
      'mileageMode',
    ]);
  });
  it('annonce : INSTANT par défaut (OQ-P2P-10) ; véhicule exigé', () => {
    expect(parseListing({ vehicleId: LOC, dailyPriceMinor: '1' })).toMatchObject({
      instantBook: true,
    });
    expect(fieldsOf(() => parseListing({ dailyPriceMinor: '1' }))).toEqual(['vehicleId']);
  });
});
