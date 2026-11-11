/**
 * US-115 — lecture des réponses de l'espace de l'hôte et saisie du prix (unités mineures, aucun
 * flottant ; exposant de la devise du compte : 2 pour une devise à centimes, 0 sans décimale).
 * Séparateurs tirés de la configuration des locales, jamais écrits ici.
 */
import { describe, expect, it } from 'vitest';
import { getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import {
  fieldsOf,
  hostAccountsOf,
  listingsOf,
  messageKeyOf,
  minorFromInput,
  publicListingOf,
} from './host-listings.ts';

const ID = '00000000-0000-4000-8000-000000000001';
const reply = (status: number, json: unknown) => ({ status, json, session: null });

describe('saisie du prix (PRC-001, BR-PRICE-01)', () => {
  for (const locale of LOCALE_CONFIG.locales) {
    const n = getProfile(LOCALE_CONFIG, locale.tag).number;
    it(`${locale.tag} : séparateurs de la locale, au plus l'exposant en décimales`, () => {
      expect(minorFromInput(`40${n.decimal}00`, 2, n)).toBe('4000');
      expect(minorFromInput(`40${n.decimal}5`, 2, n)).toBe('4050');
      expect(minorFromInput('40', 2, n)).toBe('4000');
      expect(minorFromInput(`250${n.group}000`, 0, n)).toBe('250000');
      expect(minorFromInput(`250${n.decimal}5`, 0, n)).toBeNull();
      expect(minorFromInput(`1${n.decimal}234`, 2, n)).toBeNull();
      for (const bad of ['', 'abc', '-5', '1e3', `${n.decimal}5`, `5${n.decimal}`]) {
        expect(minorFromInput(bad, 2, n), bad).toBeNull();
      }
    });
  }
});

describe('lecture défensive des réponses', () => {
  it('comptes d’hôte de la session ; réponse illisible : null', () => {
    expect(
      hostAccountsOf(
        reply(200, { hostAccounts: [{ orgId: ID, country: 'XX', status: 'ACTIVE' }] }),
      ),
    ).toEqual([{ orgId: ID, country: 'XX', status: 'ACTIVE' }]);
    expect(
      hostAccountsOf(reply(200, { hostAccounts: [{ orgId: 'x', country: 'XX' }] })),
    ).toBeNull();
    expect(hostAccountsOf({ status: 'unavailable' })).toBeNull();
  });

  it('annonces et marché du compte ; prix en bigint ; marché absent : null', () => {
    const ok = listingsOf(
      reply(200, {
        listings: [
          {
            id: ID,
            vehicleId: ID,
            status: 'DRAFT',
            dailyPriceMinor: '250000',
            currency: 'XXX',
            mileageMode: 'UNLIMITED',
            includedKmPerDay: null,
            photos: 2,
          },
        ],
        market: { country: 'XX', currency: 'XXX', currencyExponent: 0 },
      }),
    );
    expect(ok?.listings[0]?.dailyPriceMinor).toBe(250000n);
    expect(ok?.market.currencyExponent).toBe(0);
    expect(listingsOf(reply(200, { listings: [] }))).toBeNull();
    expect(
      listingsOf(
        reply(200, {
          listings: [{ id: ID, vehicleId: ID, dailyPriceMinor: '1.5' }],
          market: { country: 'XX', currency: 'XXX', currencyExponent: 2 },
        }),
      ),
    ).toBeNull();
  });

  it('fiche publique : colonnes attendues seulement, montant en bigint', () => {
    const l = publicListingOf(
      reply(200, {
        listing: {
          id: ID,
          dailyPriceMinor: '4000',
          currency: 'XXX',
          currencyExponent: 2,
          mileageMode: 'INCLUDED',
          includedKmPerDay: 250,
          instantBook: true,
          makeName: 'Marca',
          modelName: 'Modelo',
          year: 2021,
          transmission: 'AUTOMATIC',
          seats: 5,
          fuelType: 'GASOLINE',
          city: 'Ciudad',
          areaLabel: 'Zona',
        },
      }),
    );
    expect(l).toMatchObject({ dailyPriceMinor: 4000n, city: 'Ciudad', areaLabel: 'Zona' });
    expect(publicListingOf(reply(404, { code: 'LISTING_NOT_FOUND' }))).toBeNull();
  });

  it('clé de message de l’API seulement si elle est au catalogue ; champs refusés sans valeur', () => {
    expect(messageKeyOf(reply(409, { messageKey: 'common.listing.plateDuplicate' }))).toBe(
      'common.listing.plateDuplicate',
    );
    expect(messageKeyOf(reply(409, { messageKey: 'common.inconnue' }))).toBeNull();
    expect(fieldsOf(reply(400, { fields: [{ field: 'plate', reason: 'INVALID' }, 3] }))).toEqual([
      { field: 'plate', reason: 'INVALID' },
    ]);
  });
});
