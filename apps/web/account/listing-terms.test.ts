/**
 * Lecture défensive des conditions de la fiche S03 (US-205) : annulation du créneau, distance,
 * politique du pays, caution, protection de l'assureur partenaire. Toute forme inattendue ⇒
 * `null` (aucune promesse de couverture ni d'annulation gratuite). Valeurs de forme seulement.
 */
import { describe, expect, it } from 'vitest';
import { listingConditionsOf, slotTermsOf, termsLanguageOf } from './listing-terms.ts';

const ok = (json: unknown) => ({ status: 200, json, session: null }) as const;
const UNLIMITED = {
  mode: 'UNLIMITED',
  includedKmPerDay: null,
  includedKm: null,
  extraKmPriceMinor: null,
};
const slot = (extra: Record<string, unknown>) =>
  ok({ availability: { cancellation: null, mileage: UNLIMITED, ...extra } });

const PROTECTION = {
  insurerName: 'Aseguradora',
  insurerLicenseRef: 'LIC-1',
  brokerName: null,
  brokerLicenseRef: null,
  contractVersion: 1,
  rcAmountMinor: '10000000',
  deductibles: { BASICA: '150000', ESTANDAR: '50000', TOTAL: '0' },
  exclusions: { es: 'a', en: 'b', fr: 'c', 'pt-BR': 'd' },
};
const conditions = (extra: Record<string, unknown>) =>
  ok({
    conditions: {
      currency: 'XTS',
      timezone: 'UTC',
      cancellation: {
        freeCancelLeadHours: 24,
        lastMinuteThresholdHours: 25,
        lastMinuteWindowMinutes: 60,
      },
      deposit: null,
      protection: PROTECTION,
      ...extra,
    },
  });

describe('slotTermsOf', () => {
  it('date limite rendue par l’API (instant UTC) ; dernière minute sans date ; distance sur la période', () => {
    const x = slotTermsOf(
      slot({
        cancellation: {
          lastMinute: false,
          freeUntil: '2037-01-13T15:00:00.000Z',
          lastMinuteWindowMinutes: 60,
        },
        mileage: {
          mode: 'INCLUDED',
          includedKmPerDay: 200,
          includedKm: 600,
          extraKmPriceMinor: '35',
        },
      }),
    );
    expect(x).toEqual({
      cancellation: {
        lastMinute: false,
        freeUntil: new Date('2037-01-13T15:00:00.000Z'),
        windowMinutes: 60,
      },
      mileage: { mode: 'INCLUDED', includedKmPerDay: 200, includedKm: 600, extraKmPriceMinor: 35n },
    });
    expect(
      slotTermsOf(
        slot({ cancellation: { lastMinute: true, freeUntil: null, lastMinuteWindowMinutes: 60 } }),
      )?.cancellation,
    ).toEqual({ lastMinute: true, freeUntil: null, windowMinutes: 60 });
    expect(slotTermsOf(slot({}))).toEqual({
      cancellation: null,
      mileage: {
        mode: 'UNLIMITED',
        includedKmPerDay: null,
        includedKm: null,
        extraKmPriceMinor: null,
      },
    });
  });

  it('forme inattendue ⇒ null (jamais une date ni une distance devinées)', () => {
    for (const extra of [
      {
        cancellation: {
          lastMinute: true,
          freeUntil: '2037-01-13T15:00:00.000Z',
          lastMinuteWindowMinutes: 60,
        },
      },
      { cancellation: { lastMinute: false, freeUntil: null, lastMinuteWindowMinutes: 60 } },
      { cancellation: { lastMinute: false, freeUntil: '13/01', lastMinuteWindowMinutes: 60 } },
      { cancellation: { lastMinute: 'no', freeUntil: null, lastMinuteWindowMinutes: 60 } },
      { mileage: { mode: 'MILES' } },
      {
        mileage: {
          mode: 'INCLUDED',
          includedKmPerDay: 200,
          includedKm: 100,
          extraKmPriceMinor: '1',
        },
      },
      {
        mileage: {
          mode: 'INCLUDED',
          includedKmPerDay: 200,
          includedKm: 600,
          extraKmPriceMinor: '-1',
        },
      },
      { mileage: undefined },
    ]) {
      expect(slotTermsOf(slot(extra)), JSON.stringify(extra)).toBeNull();
    }
    expect(slotTermsOf({ status: 409, json: {}, session: null })).toBeNull();
  });
});

describe('listingConditionsOf', () => {
  it('politique du pays, caution et protection recopiées telles quelles (montants en bigint)', () => {
    const c = listingConditionsOf(conditions({ deposit: { amountMinor: '25000' } }));
    expect(c).toEqual({
      currency: 'XTS',
      timezone: 'UTC',
      cancellation: { leadHours: 24, thresholdHours: 25, windowMinutes: 60 },
      depositMinor: 25000n,
      protection: {
        ...PROTECTION,
        rcAmountMinor: 10000000n,
        deductibles: { BASICA: 150000n, ESTANDAR: 50000n, TOTAL: 0n },
      },
    });
    expect(listingConditionsOf(conditions({ protection: null }))?.protection).toBeNull();
    expect(listingConditionsOf(conditions({ cancellation: null }))?.cancellation).toBeNull();
  });

  it('protection incomplète ou en trop ⇒ null (aucune promesse de couverture)', () => {
    for (const p of [
      { ...PROTECTION, insurerName: '' },
      { ...PROTECTION, rcAmountMinor: '0' },
      { ...PROTECTION, contractVersion: 0 },
      { ...PROTECTION, deductibles: { BASICA: '1', ESTANDAR: '1' } },
      { ...PROTECTION, deductibles: { BASICA: '1', ESTANDAR: '1', TOTAL: '1', PRO: '1' } },
      { ...PROTECTION, exclusions: { es: 'a', en: 'b', fr: 'c' } },
      { ...PROTECTION, exclusions: { es: 'a', en: 'b', fr: 'c', 'pt-BR': ' ' } },
      { ...PROTECTION, brokerName: '' },
    ]) {
      expect(listingConditionsOf(conditions({ protection: p })), JSON.stringify(p)).toBeNull();
    }
    expect(listingConditionsOf(conditions({ deposit: { amountMinor: '0' } }))).toBeNull();
    expect(listingConditionsOf(conditions({ currency: 'abc' }))).toBeNull();
    expect(listingConditionsOf({ status: 503, json: {}, session: null })).toBeNull();
  });
});

describe('termsLanguageOf', () => {
  it('langue de la locale du site ; portugais ⇒ pt-BR ; inconnue ⇒ espagnol', () => {
    expect(termsLanguageOf('es-419')).toBe('es');
    expect(termsLanguageOf('en')).toBe('en');
    expect(termsLanguageOf('fr-FR')).toBe('fr');
    expect(termsLanguageOf('pt-BR')).toBe('pt-BR');
    expect(termsLanguageOf('de')).toBe('es');
  });
});
