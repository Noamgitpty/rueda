/**
 * Service des trips de l'hôte (US-219 ; 16 HDB-001 / HDB-002 ; écrans A02 et A05 ; ADR-127).
 * Valide la requête (onglet, véhicule, dates locales), lit la base (qui juge la session, le compte
 * titulaire, filtre et minimise) et joint à chaque trip le libellé du véhicule et du lieu de remise
 * lus par les lectures existantes de l'hôte (US-115). Aucun montant n'est calculé ici : la jambe
 * HOST est relue telle quelle, avec l'exposant de la devise du pays (PYG sans décimale).
 *
 * Un compte d'un autre hôte rend 404 HOST_ACCOUNT_NOT_FOUND ; un trip d'un autre hôte, 404
 * TRIP_NOT_FOUND, comme un identifiant inconnu (17 §2.3 point 5, L2-PM-10).
 */
import { HostListingHttpError, outcomeCode } from '../host-listings/errors.js';
import { isUuid } from '../host-listings/model.js';
import { HostListingStoreError } from '../host-listings/store.js';
import type { HostListingStore, HostMarket } from '../host-listings/store.js';
import { TRIP_TABS } from './store.js';
import type { HostTripRow, HostTripStore, TripQuery, TripTab } from './store.js';

/** Plafond de lignes d'une page (borne de la base : 200). */
export const HOST_TRIPS_PAGE = 200;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Date calendaire réelle `AAAA-MM-JJ` (2026-02-30 refusée). */
function isDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Requête `?tab=&vehicleId=&from=&to=` ; toute autre clé ou valeur : REQUEST_INVALID. */
export function parseTripQuery(query: Readonly<Record<string, unknown>>): TripQuery {
  const fields: { field: string; reason: 'INVALID' }[] = [];
  const one = (key: string): string | null => {
    const v = query[key];
    if (v === undefined || v === '') return null;
    if (typeof v !== 'string') {
      fields.push({ field: key, reason: 'INVALID' });
      return null;
    }
    return v;
  };
  for (const key of Object.keys(query)) {
    if (!['tab', 'vehicleId', 'from', 'to'].includes(key)) {
      fields.push({ field: key, reason: 'INVALID' });
    }
  }
  const tab = one('tab');
  const vehicleId = one('vehicleId');
  const from = one('from');
  const to = one('to');
  if (tab !== null && !(TRIP_TABS as readonly string[]).includes(tab)) {
    fields.push({ field: 'tab', reason: 'INVALID' });
  }
  if (vehicleId !== null && !isUuid(vehicleId))
    fields.push({ field: 'vehicleId', reason: 'INVALID' });
  if (from !== null && !isDate(from)) fields.push({ field: 'from', reason: 'INVALID' });
  if (to !== null && !isDate(to)) fields.push({ field: 'to', reason: 'INVALID' });
  if (fields.length === 0 && from !== null && to !== null && to < from) {
    fields.push({ field: 'to', reason: 'INVALID' });
  }
  if (fields.length > 0) throw new HostListingHttpError('REQUEST_INVALID', fields);
  return {
    tab: tab as TripTab | null,
    vehicleId: vehicleId === null ? null : vehicleId.toLowerCase(),
    from,
    to,
    tripId: null,
    limit: HOST_TRIPS_PAGE,
  };
}

/** Trip tel que servi à l'hôte : véhicule et lieu de remise joints, montant non recalculé. */
export interface HostTripView extends Omit<HostTripRow, 'vehicleId'> {
  readonly vehicle: {
    readonly id: string;
    readonly makeText: string | null;
    readonly modelText: string | null;
    readonly year: number | null;
    readonly plate: string | null;
  };
  readonly handoverPlace: string | null;
}

export interface HostTripsReply {
  readonly market: { readonly currency: string; readonly currencyExponent: number };
  readonly trips: readonly HostTripView[];
}

export class HostTripsService {
  constructor(
    private readonly trips: HostTripStore,
    private readonly listings: HostListingStore,
  ) {}

  async #call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof HostListingStoreError) {
        throw new HostListingHttpError('HOST_TRIPS_UNAVAILABLE');
      }
      throw error;
    }
  }

  async #read(proof: Buffer, orgId: string, query: TripQuery): Promise<HostTripsReply> {
    const r = await this.#call(() => this.trips.trips(proof, orgId, query));
    if (r.outcome !== 'DONE') throw new HostListingHttpError(outcomeCode(r.outcome));
    const [market, vehicles, locations] = await this.#call(() =>
      Promise.all([
        this.listings.hostMarket(proof, orgId),
        this.listings.vehicles(proof, orgId),
        this.listings.locations(proof, orgId),
      ]),
    );
    if (market === null) throw new HostListingHttpError('HOST_ACCOUNT_NOT_FOUND');
    return {
      market: marketOf(market),
      trips: r.rows.map(({ vehicleId, ...row }) => {
        const v = vehicles.find((x) => x.id === vehicleId);
        const place = v === undefined ? undefined : locations.find((l) => l.id === v.locationId);
        return {
          ...row,
          vehicle: {
            id: vehicleId,
            makeText: v?.makeText ?? null,
            modelText: v?.modelText ?? null,
            year: v?.year ?? null,
            plate: v?.plate ?? null,
          },
          handoverPlace: place?.label ?? null,
        };
      }),
    };
  }

  list(proof: Buffer, orgId: string, query: Readonly<Record<string, unknown>>) {
    return this.#read(proof, orgId, parseTripQuery(query));
  }

  async one(proof: Buffer, orgId: string, tripId: string) {
    const r = await this.#read(proof, orgId, {
      tab: null,
      vehicleId: null,
      from: null,
      to: null,
      tripId,
      limit: 1,
    });
    const trip = r.trips[0];
    if (trip === undefined) throw new HostListingHttpError('TRIP_NOT_FOUND');
    return { market: r.market, trip };
  }
}

const marketOf = (m: HostMarket) => ({
  currency: m.currency,
  currencyExponent: m.currencyExponent,
});
