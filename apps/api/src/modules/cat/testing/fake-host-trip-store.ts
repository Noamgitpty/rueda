/**
 * FAKE des trips de l'hôte (US-219) — TESTS SEULEMENT (absent de la compilation de production).
 * Reproduit les issues de `core.booking_host_trips` (0100) que les tests de contrat HTTP observent,
 * sur les comptes du FAKE d'US-115 : FORBIDDEN pour un compte qui n'est pas celui de la session,
 * filtres par onglet, véhicule et trip. Les règles elles-mêmes (session, compte titulaire,
 * minimisation, période locale, ordre, jambe HOST) sont prouvées sur PostgreSQL
 * (packages/db/test/l0/l0-us219-host-trips.test.ts).
 */
import { HostListingStoreError } from '../internal/host-listings/store.js';
import type {
  HostTripRow,
  HostTripStore,
  HostTripsResult,
  TripQuery,
} from '../internal/host-trips/store.js';
import type { FakeHostListingStore } from './fake-host-listing-store.js';

export class FakeHostTripStore implements HostTripStore {
  /** Trips par compte d'hôte (données de test). */
  readonly byOrg = new Map<string, HostTripRow[]>();

  constructor(private readonly listings: FakeHostListingStore) {}

  add(orgId: string, row: HostTripRow): void {
    this.byOrg.set(orgId, [...(this.byOrg.get(orgId) ?? []), row]);
  }

  trips(proof: Buffer, orgId: string, q: TripQuery): Promise<HostTripsResult> {
    if (this.listings.failing) {
      return Promise.reject(new HostListingStoreError('panne', '08006'));
    }
    const mine = this.listings.hosts.get(proof.toString('hex'))?.some((h) => h.orgId === orgId);
    if (mine !== true) return Promise.resolve({ outcome: 'FORBIDDEN', rows: [] });
    const rows = (this.byOrg.get(orgId) ?? [])
      .filter((r) => q.tab === null || r.tab === q.tab)
      .filter((r) => q.vehicleId === null || r.vehicleId === q.vehicleId)
      .filter((r) => q.tripId === null || r.tripId === q.tripId)
      .slice(0, q.limit);
    return Promise.resolve({ outcome: 'DONE', rows });
  }
}
