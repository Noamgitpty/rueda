/**
 * FAKE du magasin de la recherche publique (US-201, US-203) — TESTS SEULEMENT (contrat HTTP). Les
 * règles (hôte activable, disponibilité, préavis, fuseau, durée, instant présent, caution) sont
 * prouvées en base (packages/db/test/l0/l0-us201-public-search.test.ts,
 * l0-us203-search-cards.test.ts) ; ce double rend ce qu'on lui impose et retient la dernière
 * requête reçue, pour vérifier ce que l'API transmet à la base. Doubles du prix et des notes : ils
 * rendent ce qu'on leur impose (le moteur de devis est prouvé dans PRC, `search-pricer.test.ts`).
 */
import type {
  SearchPrice,
  SearchPriceInput,
  SearchPricer,
  SearchRating,
  SearchRatings,
} from '../internal/search/cards.js';
import type { SearchQuery } from '../internal/search/model.js';
import type {
  SearchArea,
  SearchOutcome,
  SearchResult,
  SearchStore,
  SlotOutcome,
  SlotQuery,
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

  // ---- dates de la fiche (US-204) ----------------------------------------------------------
  /** Pays par annonce publiée ; une annonce absente est inconnue ou non publiée. */
  listingCountries = new Map<string, string>();
  slotOutcome: SlotOutcome = {
    outcome: 'OK',
    startAt: '2036-12-10T15:00:00.000Z',
    endAt: '2036-12-12T15:00:00.000Z',
    timezone: 'UTC',
  };
  lastSlot: SlotQuery | null = null;

  listingCountry(listingId: string): Promise<string | null> {
    if (this.down) return Promise.reject(new Error('base indisponible (FAKE)'));
    return Promise.resolve(this.listingCountries.get(listingId) ?? null);
  }

  slotCheck(query: SlotQuery): Promise<SlotOutcome> {
    if (this.down) return Promise.reject(new Error('base indisponible (FAKE)'));
    this.lastSlot = query;
    return Promise.resolve(this.slotOutcome);
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
    depositAmountMinor: null,
    quotedAt: '2036-12-01T12:00:00.000Z',
    ...overrides,
  };
}

/** Prix imposés par annonce ; une annonce absente : devis impossible (`null`). */
export class FakeSearchPricer implements SearchPricer {
  prices = new Map<string, SearchPrice>();
  inputs: SearchPriceInput[] = [];
  /** Panne simulée : toute demande lève. */
  down = false;

  price(input: SearchPriceInput): SearchPrice | null {
    if (this.down) throw new Error('prix indisponible (FAKE)');
    this.inputs.push(input);
    return this.prices.get(input.listingId) ?? null;
  }
}

/** Notes imposées par annonce ; `down` : panne simulée. */
export class FakeSearchRatings implements SearchRatings {
  rows = new Map<string, SearchRating>();
  down = false;
  asked: string[][] = [];

  ratings(listingIds: readonly string[]): Promise<ReadonlyMap<string, SearchRating>> {
    if (this.down) return Promise.reject(new Error('notes indisponibles (FAKE)'));
    this.asked.push([...listingIds]);
    return Promise.resolve(new Map([...this.rows].filter(([id]) => listingIds.includes(id))));
  }
}
