/**
 * Service de la recherche publique (US-201) : forme de la requête (`model.ts`), sonde de
 * disponibilité limitée par IP (`availability_probe_per_minute`, 17 §2.3, BOARD N-78), puis la
 * base, qui juge le pays, l'instant présent, la durée, le préavis et la disponibilité. Issues de
 * la base vers codes stables (`errors.ts`) ; base ou limiteur indisponibles : 503 (fail-closed).
 */
import { SearchHttpError } from './errors.js';
import { countryOf, parseSearchQuery } from './model.js';
import type { SearchArea, SearchResult, SearchStore } from './store.js';

/**
 * Limite de la sonde de disponibilité, par IP (port satisfait par la garde anti-abus de RISK,
 * câblée par `main.ts` : CAT ne dépend pas de RISK). `null` : sonde admise ; sinon délai de
 * reprise en secondes. Une erreur vaut « indisponible ».
 */
export interface AvailabilityProbeLimiter {
  hit(ip: string, country: string): Promise<number | null>;
}

/** Aucun limiteur fourni : toute recherche avec dates est refusée (503, fail-closed). */
export const UNAVAILABLE_PROBE_LIMITER: AvailabilityProbeLimiter = {
  hit: () => Promise.reject(new Error('limiteur de la sonde indisponible')),
};

export class SearchService {
  constructor(
    private readonly store: SearchStore,
    private readonly probe: AvailabilityProbeLimiter,
  ) {}

  async areas(rawCountry: unknown): Promise<SearchArea[]> {
    const country = rawCountry === undefined ? null : countryOf(rawCountry);
    if (rawCountry !== undefined && country === null) throw new SearchHttpError('REQUEST_INVALID');
    try {
      return await this.store.areas(country);
    } catch {
      throw new SearchHttpError('SEARCH_UNAVAILABLE');
    }
  }

  async search(raw: Readonly<Record<string, unknown>>, ip: string): Promise<SearchResult[]> {
    const parsed = parseSearchQuery(raw);
    if (!parsed.ok) throw new SearchHttpError(parsed.code);
    let retryAfterS: number | null;
    try {
      retryAfterS = await this.probe.hit(ip, parsed.query.country);
    } catch {
      throw new SearchHttpError('SEARCH_UNAVAILABLE');
    }
    if (retryAfterS !== null) throw new SearchHttpError('RATE_LIMITED', Math.max(1, retryAfterS));
    let r;
    try {
      r = await this.store.search(parsed.query);
    } catch {
      throw new SearchHttpError('SEARCH_UNAVAILABLE');
    }
    if (r.outcome !== 'OK') throw new SearchHttpError(r.outcome);
    return [...r.results];
  }
}
