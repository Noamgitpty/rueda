/**
 * Service du calendrier de l'hôte (US-119 ; 16 CAL-001 / CAL-002, CAL-003 ; ADR-100). Valide la
 * saisie (jours ou heures au pas de 30 min, préavis), appelle le magasin (la base juge la session,
 * le compte, le véhicule, le fuseau, l'occupation) et traduit chaque issue en code stable.
 *
 * Un compte d'un autre hôte rend 404 HOST_ACCOUNT_NOT_FOUND ; un véhicule, un lieu ou un blocage
 * d'un autre hôte, 404 comme un identifiant inconnu (17 §2.3 point 5, L1-PM-11). Un créneau pris
 * rend 409 VEHICLE_UNAVAILABLE sans rien dire de l'occupation en cause (L1-PM-22).
 */
import { HostListingHttpError, outcomeCode } from '../host-listings/errors.js';
import type { HostListingCode } from '../host-listings/errors.js';
import { FieldValidationError } from '../host-listings/model.js';
import { HostListingStoreError } from '../host-listings/store.js';
import { parseBlock, parseNotice } from './model.js';
import type { CalendarEntry, HostCalendarStore } from './store.js';

export interface VehicleCalendar {
  readonly vehicle: {
    readonly id: string;
    readonly timezone: string;
    readonly listed: boolean;
    readonly locationId: string;
    readonly noticeMinutes: number | null;
    readonly effectiveNoticeMinutes: number | null;
  };
  readonly entries: CalendarEntry[];
}

export class HostCalendarService {
  constructor(private readonly store: HostCalendarStore) {}

  async #call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof HostListingStoreError) {
        throw new HostListingHttpError('LISTING_UNAVAILABLE');
      }
      throw error;
    }
  }

  #fields<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof FieldValidationError) {
        throw new HostListingHttpError('REQUEST_INVALID', error.problems);
      }
      throw error;
    }
  }

  #done(outcome: string, success: HostListingCode): { code: HostListingCode } {
    if (outcome === 'DONE') return { code: success };
    throw new HostListingHttpError(outcomeCode(outcome));
  }

  async calendar(proof: Buffer, orgId: string, vehicleId: string): Promise<VehicleCalendar> {
    const h = await this.#call(() => this.store.header(proof, orgId, vehicleId));
    if (h.outcome !== 'DONE' || h.timezone === null || h.locationId === null) {
      throw new HostListingHttpError(outcomeCode(h.outcome));
    }
    const entries = await this.#call(() => this.store.entries(proof, orgId, vehicleId));
    return {
      vehicle: {
        id: vehicleId,
        timezone: h.timezone,
        listed: h.listed,
        locationId: h.locationId,
        noticeMinutes: h.noticeMinutes,
        effectiveNoticeMinutes: h.effectiveNoticeMinutes,
      },
      entries,
    };
  }

  async placeBlock(proof: Buffer, orgId: string, vehicleId: string, body: Record<string, unknown>) {
    const period = this.#fields(() => parseBlock(body));
    const r = await this.#call(() => this.store.placeBlock(proof, orgId, vehicleId, period));
    return { ...this.#done(r.outcome, 'BLOCK_CREATED'), blockId: r.id as string };
  }

  async removeBlock(proof: Buffer, orgId: string, vehicleId: string, blockId: string) {
    const r = await this.#call(() => this.store.removeBlock(proof, orgId, vehicleId, blockId));
    return this.#done(r.outcome, 'BLOCK_REMOVED');
  }

  async setNotice(proof: Buffer, orgId: string, locationId: string, body: Record<string, unknown>) {
    const minutes = this.#fields(() => parseNotice(body));
    const r = await this.#call(() => this.store.setNotice(proof, orgId, locationId, minutes));
    return this.#done(r.outcome, 'NOTICE_SAVED');
  }
}
