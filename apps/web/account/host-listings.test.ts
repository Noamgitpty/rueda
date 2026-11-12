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
  inputFromMinor,
  listingsOf,
  messageKeyOf,
  minorFromInput,
  priceExample,
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

    it(`${locale.tag} : groupes de milliers à leur place seulement ; saisie ambiguë refusée, jamais lue ×100`, () => {
      expect(minorFromInput(`1${n.group}234${n.decimal}50`, 2, n)).toBe('123450');
      expect(minorFromInput(`1${n.group}234${n.group}567`, 0, n)).toBe('1234567');
      // « 40.50 » là où « . » groupe les milliers (es-PA, pt-BR…) : groupe de 2 chiffres, refusé
      expect(minorFromInput(`40${n.group}50`, 2, n)).toBeNull();
      expect(minorFromInput(`1${n.group}23${n.group}456`, 0, n)).toBeNull();
      expect(minorFromInput(`2${n.group}50${n.decimal}00`, 2, n)).toBeNull();
      // l'exemple affiché à l'hôte est lui-même une saisie valide
      expect(minorFromInput(priceExample(2, n), 2, n)).toBe('123450');
      expect(minorFromInput(priceExample(0, n), 0, n)).toBe('250000');
    });

    it(`${locale.tag} : aller-retour du prix prérempli (devise à centimes et sans décimale)`, () => {
      for (const [minor, exponent] of [
        [4000n, 2],
        [5n, 2],
        [0n, 2],
        [250000n, 0],
        [35000000n, 0],
        [1234567n, 3],
      ] as const) {
        const shown = inputFromMinor(minor, exponent, n);
        expect(minorFromInput(shown, exponent, n), shown).toBe(minor.toString());
      }
      expect(inputFromMinor(250000n, 0, n)).toBe('250000');
      expect(inputFromMinor(4000n, 2, n)).toBe(`40${n.decimal}00`);
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
            extraKmPriceMinor: null,
            photos: 2,
          },
          {
            id: ID,
            vehicleId: ID,
            status: 'DRAFT',
            dailyPriceMinor: '300000',
            currency: 'XXX',
            mileageMode: 'INCLUDED',
            includedKmPerDay: 200,
            extraKmPriceMinor: '2000',
            photos: 0,
          },
        ],
        market: { country: 'XX', currency: 'XXX', currencyExponent: 0 },
        photoUploads: { open: false, maxBytes: 75_000 },
      }),
    );
    expect(ok?.listings[0]?.dailyPriceMinor).toBe(250000n);
    expect(ok?.listings[0]?.extraKmPriceMinor).toBeNull();
    // le prix du km est relu (préremplissage : jamais remis à 0 par un changement de prix)
    expect(ok?.listings[1]?.extraKmPriceMinor).toBe(2000n);
    expect(ok?.market.currencyExponent).toBe(0);
    expect(ok?.photoUploads).toEqual({ open: false, maxBytes: 75_000 });
    // dépôt des photos non annoncé : réponse refusée
    expect(
      listingsOf(
        reply(200, {
          listings: [],
          market: { country: 'XX', currency: 'XXX', currencyExponent: 0 },
        }),
      ),
    ).toBeNull();
    expect(listingsOf(reply(200, { listings: [] }))).toBeNull();
    expect(
      listingsOf(
        reply(200, {
          listings: [{ id: ID, vehicleId: ID, dailyPriceMinor: '1.5' }],
          market: { country: 'XX', currency: 'XXX', currencyExponent: 2 },
          photoUploads: { open: true, maxBytes: 1 },
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
