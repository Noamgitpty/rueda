/**
 * FAKE du magasin de la recherche publique (US-201) — TESTS SEULEMENT (contrat HTTP). Les règles
 * (hôte activable, disponibilité, préavis, fuseau, durée, instant présent) sont prouvées en base
 * (packages/db/test/l0/l0-us201-public-search.test.ts) ; ce double rend ce qu'on lui impose et
 * retient la dernière requête reçue, pour vérifier ce que l'API transmet à la base.
 */
import type { SearchQuery } from '../internal/search/model.js';
import type {
  SearchArea,
  SearchOutcome,
  SearchResult,
  SearchStore,
} from '../internal/search/store.js';

export class FakeSearchStore implements SearchStore {
  areaRows: SearchArea[] = [];
  outcome: SearchOutcome = { outcome: 'OK', results: [] };
  /** Panne simulée de la base : toute lecture échoue. */
  down = false;
  lastQuery: SearchQuery | null = null;
  lastAreasCountry: string | null | undefined = undefined;

  areas(country: string | null): Promise<SearchArea[]> {
    if (this.down) return Promise.reject(new Error('base indisponible (FAKE)'));
    this.lastAreasCountry = country;
    return Promise.resolve(this.areaRows.filter((a) => country === null || a.country === country));
  }

  search(query: SearchQuery): Promise<SearchOutcome> {
    if (this.down) return Promise.reject(new Error('base indisponible (FAKE)'));
    this.lastQuery = query;
    return Promise.resolve(this.outcome);
  }
}

/** Résultat C0 de test (valeurs de forme seulement). */
export function fakeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: '00000000-0000-4000-8000-0000000000c1',
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
    areaLabel: 'Barrio Norte',
    approximatePoint: { lat: 8.99, lng: -79.51 },
    timezone: 'UTC',
    startAt: '2036-12-10T15:00:00.000Z',
    endAt: '2036-12-12T15:00:00.000Z',
    ...overrides,
  };
}
