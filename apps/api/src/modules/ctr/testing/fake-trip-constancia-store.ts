/**
 * FAKE du magasin de la constancia d'arrendamiento (US-212) — TESTS SEULEMENT (exclu de la
 * compilation de production). Règles reprises d'ADR-162 et de 16 LEG-026, jamais du code de
 * production : lecture par le voyageur du trip ou le titulaire de son compte d'hôte, toute autre
 * personne ⇒ NOT_FOUND ; issue posée par le test (NOT_AVAILABLE, NOT_GENERATED, ERASED) ;
 * recherche : trips de l'hôte de la session dont la plaque (sans casse ni séparateurs) et la
 * période locale (jusqu'au lendemain de la fin) couvrent la date. Les vraies règles sont prouvées
 * sur PostgreSQL (`packages/db/test/l0/l0-us212-constancia.test.ts`).
 */
import type {
  ConstanciaReadResult,
  ConstanciaSearchResult,
  TripConstanciaStore,
} from '../internal/constancia/constancia.store.js';
import { ConstanciaStoreError } from '../internal/constancia/constancia.store.js';

interface Trip {
  readonly guest: string;
  readonly host: string;
  outcome: 'OK' | 'NOT_AVAILABLE' | 'NOT_GENERATED' | 'ERASED';
  /** Ligne de la base telle que `core.booking_trip_constancia` la rend (hors rôle et langue). */
  row: Record<string, unknown>;
  readonly locales: { readonly guest: string | null; readonly host: string | null };
}

const norm = (plate: string): string => plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

export class FakeTripConstanciaStore implements TripConstanciaStore {
  readonly #trips = new Map<string, Trip>();
  /** Base indisponible : toute opération échoue (SQLSTATE fictif). */
  failing = false;

  addTrip(
    tripId: string,
    guestProof: string,
    hostProof: string,
    row: Record<string, unknown>,
    locales: { guest: string | null; host: string | null } = { guest: 'es', host: 'es' },
  ): void {
    this.#trips.set(tripId, { guest: guestProof, host: hostProof, outcome: 'OK', row, locales });
  }

  setOutcome(tripId: string, outcome: Trip['outcome']): void {
    const t = this.#trips.get(tripId);
    if (t !== undefined) t.outcome = outcome;
  }

  setRow(tripId: string, row: Record<string, unknown>): void {
    const t = this.#trips.get(tripId);
    if (t !== undefined) t.row = row;
  }

  read(proof: Buffer, tripId: string): Promise<ConstanciaReadResult> {
    if (this.failing) return Promise.reject(new ConstanciaStoreError('fake', '08006'));
    const t = this.#trips.get(tripId);
    const p = proof.toString('hex');
    const role = t === undefined ? null : p === t.guest ? 'GUEST' : p === t.host ? 'HOST' : null;
    if (t === undefined || role === null) return Promise.resolve({ outcome: 'NOT_FOUND' });
    if (t.outcome !== 'OK') return Promise.resolve({ outcome: t.outcome });
    return Promise.resolve({
      outcome: 'OK',
      row: {
        ...t.row,
        outcome: 'OK',
        viewer_role: role,
        viewer_locale: role === 'GUEST' ? t.locales.guest : t.locales.host,
      },
    });
  }

  search(proof: Buffer, plate: string, date: string): Promise<ConstanciaSearchResult> {
    if (this.failing) return Promise.reject(new ConstanciaStoreError('fake', '08006'));
    const wanted = norm(plate);
    if (wanted.length < 2 || wanted.length > 12) {
      return Promise.resolve({ outcome: 'REQUEST_INVALID' });
    }
    const p = proof.toString('hex');
    const day = Date.parse(`${date}T00:00:00.000Z`);
    const trips = [...this.#trips.entries()]
      .filter(([, t]) => t.host === p && t.outcome === 'OK')
      .filter(([, t]) => norm(String(t.row['plate'])) === wanted)
      .filter(([, t]) => {
        const terms = t.row['terms'] as Record<string, string>;
        const start = Date.parse(`${terms['startLocal']!.slice(0, 10)}T00:00:00.000Z`);
        const end = Date.parse(`${terms['endLocal']!.slice(0, 10)}T00:00:00.000Z`) + 86_400_000;
        return day >= start && day <= end;
      })
      .map(([id, t]) => {
        const terms = t.row['terms'] as Record<string, string>;
        return {
          tripId: id,
          tripRef: terms['tripRef']!,
          status: String(t.row['trip_status']),
          startLocal: terms['startLocal']!,
          endLocal: terms['endLocal']!,
        };
      });
    return Promise.resolve({ outcome: 'DONE', trips });
  }
}
