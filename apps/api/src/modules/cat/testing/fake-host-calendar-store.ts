/**
 * FAKE du calendrier de l'hôte (US-119) — TESTS SEULEMENT (absent de la compilation de
 * production). Reproduit les issues des commandes `core.catalog_*` de 0070 que les tests de
 * contrat HTTP observent, sur les comptes, lieux, véhicules et annonces du FAKE d'US-115 ; les
 * règles elles-mêmes (session, propriété, fuseau, exclusion GiST, préavis) sont prouvées sur
 * PostgreSQL (packages/db/test/l0/l0-us119-host-calendar.test.ts). Le FAKE compare les heures
 * locales comme des chaînes (même fuseau pour un véhicule) : aucune conversion de fuseau ici.
 */
import { randomUUID } from 'node:crypto';
import { HostListingStoreError } from '../internal/host-listings/store.js';
import type { Outcome } from '../internal/host-listings/store.js';
import type { LocalPeriod } from '../internal/host-calendar/model.js';
import type {
  CalendarEntry,
  CalendarHeader,
  HostCalendarStore,
} from '../internal/host-calendar/store.js';
import type { FakeHostListingStore } from './fake-host-listing-store.js';

interface FakeBlock {
  readonly id: string;
  readonly vehicleId: string;
  readonly period: LocalPeriod;
  active: boolean;
}

export class FakeHostCalendarStore implements HostCalendarStore {
  readonly blocks = new Map<string, FakeBlock>();
  readonly notices = new Map<string, number | null>();
  /** Fuseau des véhicules du FAKE (donnée de test). */
  timezone = 'UTC';
  /** Préavis du pays (donnée de test, 17 §7.2). */
  countryNotice = 180;

  constructor(private readonly listings: FakeHostListingStore) {}

  #host(proof: Buffer, orgId: string): { status: string } | 'FORBIDDEN' {
    if (this.listings.failing) throw new HostListingStoreError('panne', '08006');
    return (
      this.listings.hosts.get(proof.toString('hex'))?.find((h) => h.orgId === orgId) ?? 'FORBIDDEN'
    );
  }

  #write(proof: Buffer, orgId: string): Outcome | null {
    const h = this.#host(proof, orgId);
    if (h === 'FORBIDDEN') return { outcome: 'FORBIDDEN', id: null };
    if (!['ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE'].includes(h.status)) {
      return { outcome: 'HOST_ACCOUNT_SUSPENDED', id: null };
    }
    return null;
  }

  #vehicle(orgId: string, vehicleId: string): { locationId: string } | null {
    const v = this.listings.vehiclesById.get(vehicleId);
    return v === undefined || v.orgId !== orgId ? null : { locationId: v.input.locationId };
  }

  #listed(vehicleId: string): boolean {
    return [...this.listings.listingsById.values()].some(
      (l) => l.vehicleId === vehicleId && l.status === 'LISTED',
    );
  }

  header(proof: Buffer, orgId: string, vehicleId: string): Promise<CalendarHeader> {
    const none = {
      timezone: null,
      listed: false,
      locationId: null,
      noticeMinutes: null,
      effectiveNoticeMinutes: null,
    };
    const h = this.#host(proof, orgId);
    if (h === 'FORBIDDEN') return Promise.resolve({ outcome: 'FORBIDDEN', ...none });
    const v = this.#vehicle(orgId, vehicleId);
    if (v === null) return Promise.resolve({ outcome: 'VEHICLE_NOT_FOUND', ...none });
    const notice = this.notices.get(v.locationId) ?? null;
    return Promise.resolve({
      outcome: 'DONE',
      timezone: this.timezone,
      listed: this.#listed(vehicleId),
      locationId: v.locationId,
      noticeMinutes: notice,
      effectiveNoticeMinutes: notice ?? this.countryNotice,
    });
  }

  entries(proof: Buffer, orgId: string, vehicleId: string): Promise<CalendarEntry[]> {
    if (this.#host(proof, orgId) === 'FORBIDDEN' || this.#vehicle(orgId, vehicleId) === null) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      [...this.blocks.values()]
        .filter((b) => b.active && b.vehicleId === vehicleId)
        .sort((a, b) => (a.period.startLocal < b.period.startLocal ? -1 : 1))
        .map((b) => ({
          id: b.id,
          kind: 'HOST_BLOCK' as const,
          startsAt: `${b.period.startLocal}:00.000Z`,
          endsAt: `${b.period.endLocal}:00.000Z`,
          startLocal: b.period.startLocal,
          endLocal: b.period.endLocal,
          removable: true,
        })),
    );
  }

  placeBlock(
    proof: Buffer,
    orgId: string,
    vehicleId: string,
    period: LocalPeriod,
  ): Promise<Outcome> {
    const refused = this.#write(proof, orgId);
    if (refused !== null) return Promise.resolve(refused);
    if (this.#vehicle(orgId, vehicleId) === null) {
      return Promise.resolve({ outcome: 'VEHICLE_NOT_FOUND', id: null });
    }
    if (!this.#listed(vehicleId))
      return Promise.resolve({ outcome: 'VEHICLE_NOT_LISTED', id: null });
    // fin déjà écoulée (la base compare à platform.now() dans le fuseau du véhicule)
    if (period.endLocal <= new Date().toISOString().slice(0, 16)) {
      return Promise.resolve({ outcome: 'INVALID_PERIOD', id: null });
    }
    const taken = [...this.blocks.values()].some(
      (b) =>
        b.active &&
        b.vehicleId === vehicleId &&
        b.period.startLocal < period.endLocal &&
        period.startLocal < b.period.endLocal,
    );
    if (taken) return Promise.resolve({ outcome: 'VEHICLE_UNAVAILABLE', id: null });
    const id = randomUUID();
    this.blocks.set(id, { id, vehicleId, period, active: true });
    return Promise.resolve({ outcome: 'DONE', id });
  }

  removeBlock(proof: Buffer, orgId: string, vehicleId: string, blockId: string): Promise<Outcome> {
    const refused = this.#write(proof, orgId);
    if (refused !== null) return Promise.resolve(refused);
    if (this.#vehicle(orgId, vehicleId) === null) {
      return Promise.resolve({ outcome: 'VEHICLE_NOT_FOUND', id: null });
    }
    const b = this.blocks.get(blockId);
    if (b === undefined || !b.active || b.vehicleId !== vehicleId) {
      return Promise.resolve({ outcome: 'BLOCK_NOT_FOUND', id: null });
    }
    b.active = false;
    return Promise.resolve({ outcome: 'DONE', id: blockId });
  }

  setNotice(
    proof: Buffer,
    orgId: string,
    locationId: string,
    minutes: number | null,
  ): Promise<Outcome> {
    const refused = this.#write(proof, orgId);
    if (refused !== null) return Promise.resolve(refused);
    if (this.listings.locationsById.get(locationId)?.orgId !== orgId) {
      return Promise.resolve({ outcome: 'LOCATION_NOT_FOUND', id: null });
    }
    this.notices.set(locationId, minutes);
    return Promise.resolve({ outcome: 'DONE', id: locationId });
  }
}
