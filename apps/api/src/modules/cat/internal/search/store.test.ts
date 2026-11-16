/**
 * Lecture des lignes de la base par `PgSearchStore` (US-205b, revue de code n° 2) : les montants
 * bigint des conditions arrivent en TEXTE (la requête les convertit) et sont rendus tels quels,
 * même au-delà de 2^53 ; un nombre JSON non sûr (arrondi silencieux) est refusé (503 en amont).
 * Lignes de forme seulement (aucun pays ni aucune devise réels : `XTS`, fuseau `UTC`).
 */
import { describe, expect, it } from 'vitest';
import { PgSearchStore, SearchStoreError } from './store.js';
import type { SqlExecutor } from '../host-listings/store.js';

const LISTING = '00000000-0000-4000-8000-0000000205b1';
/** 2^53 + 1 : le premier entier qu'un nombre JSON ne représente pas exactement. */
const BEYOND = '9007199254740993';

function executor(terms: Record<string, unknown>): SqlExecutor {
  return {
    query: <R extends Record<string, unknown>>() =>
      Promise.resolve({
        rows: [
          {
            outcome: 'OK',
            start_at: '2036-12-10T15:00:00.000Z',
            end_at: '2036-12-13T15:00:00.000Z',
            timezone: 'UTC',
            notice_minutes: null,
            terms,
          },
        ] as unknown as R[],
      }),
  };
}

const TERMS = {
  listing_id: LISTING,
  currency: 'XTS',
  timezone: 'UTC',
  read_at: '2036-12-01T12:00:00+00:00',
  free_cancel_lead_hours: 24,
  last_minute_threshold_hours: 25,
  last_minute: false,
  free_until: '2036-12-09T15:00:00+00:00',
  last_minute_window_minutes: 60,
  mileage_mode: 'INCLUDED',
  included_km_per_day: 200,
  extra_km_price_minor: BEYOND,
  deposit_amount_minor: null,
  protection_offered: false,
  insurer_name: null,
  insurer_license_ref: null,
  broker_name: null,
  broker_license_ref: null,
  contract_version: null,
  rc_amount_minor: null,
  deductibles: null,
  exclusions: null,
};

const slot = (terms: Record<string, unknown>) =>
  new PgSearchStore(executor(terms)).slotCheck({
    listingId: LISTING,
    startLocal: '2036-12-10T15:00',
    endLocal: '2036-12-13T15:00',
  });

describe('PgSearchStore.slotCheck : montants des conditions', () => {
  it('montant en texte au-delà de 2^53 ⇒ rendu exactement', async () => {
    const r = await slot(TERMS);
    expect(r).toMatchObject({ outcome: 'OK', terms: { extraKmPriceMinor: BEYOND } });
    if (r.outcome === 'OK') {
      expect(r.terms?.cancellation).toEqual({
        freeCancelLeadHours: 24,
        lastMinuteThresholdHours: 25,
        lastMinute: false,
        freeUntil: '2036-12-09T15:00:00.000Z',
        lastMinuteWindowMinutes: 60,
      });
    }
  });

  it('nombre JSON hors des entiers sûrs (arrondi) ou montant mal formé ⇒ erreur, jamais un montant faux', async () => {
    for (const bad of [Number(BEYOND), '-1', '1.5']) {
      await expect(slot({ ...TERMS, extra_km_price_minor: bad })).rejects.toBeInstanceOf(
        SearchStoreError,
      );
    }
    // entier sûr rendu par le pilote : accepté, en texte
    await expect(slot({ ...TERMS, extra_km_price_minor: 35 })).resolves.toMatchObject({
      terms: { extraKmPriceMinor: '35' },
    });
  });
});
