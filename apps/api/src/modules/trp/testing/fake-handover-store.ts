/**
 * FAKE du magasin de la remise et du retour (US-315) — TESTS SEULEMENT (répertoire `testing`,
 * absent de la compilation de production). Mémoire du processus ; reprend les règles de la base
 * (migration 0163) que les routes exposent : partie de la session (empreinte du jeton), ouverture
 * et conditions, six points du permis par l'hôte, série validée de la partie, relevés, remise en
 * personne, seconde validation qui fait la transition, idempotence. Les règles elles-mêmes sont
 * prouvées sur PostgreSQL (`packages/db/test/l0/l0-us315-handover.test.ts`) ; ce FAKE ne fait pas
 * foi.
 */
import type { HandoverKind, HandoverMethod, Subreason } from '../internal/handover/model.js';
import type {
  HandoverRole,
  HandoverStore,
  HandoverViewRow,
  SeriesStatus,
} from '../internal/handover/store.js';

const POINTS = ['face', 'name', 'birthYear', 'valid', 'provisional', 'restrictions'] as const;

export interface FakeHandoverTrip {
  readonly hostProof: string;
  readonly guestProof: string;
  status: string;
  opensAt: Date;
  blockers: string[];
  identity: { status: 'TRIP_ID_OK' | 'TRIP_ID_FAILED'; at: Date } | null;
  photos: Record<HandoverKind, Record<HandoverRole, SeriesStatus>>;
  validations: Record<
    HandoverKind,
    Partial<Record<HandoverRole, { at: Date; odometerKm: number; fuelEighths: number }>>
  >;
  startedAt: Date | null;
  returnedAt: Date | null;
}

export function fakeTrip(hostProof: string, guestProof: string, opensAt: Date): FakeHandoverTrip {
  return {
    hostProof,
    guestProof,
    status: 'BOOKED',
    opensAt,
    blockers: [],
    identity: null,
    photos: {
      CHECKIN: { HOST: 'NONE', GUEST: 'NONE' },
      CHECKOUT: { HOST: 'NONE', GUEST: 'NONE' },
    },
    validations: { CHECKIN: {}, CHECKOUT: {} },
    startedAt: null,
    returnedAt: null,
  };
}

export class FakeHandoverStore implements HandoverStore {
  readonly trips = new Map<string, FakeHandoverTrip>();
  now: () => Date = () => new Date();

  #party(proof: Buffer, tripId: string): { t: FakeHandoverTrip; role: HandoverRole } | null {
    const t = this.trips.get(tripId);
    if (t === undefined) return null;
    const hex = proof.toString('hex');
    if (hex === t.guestProof) return { t, role: 'GUEST' };
    if (hex === t.hostProof) return { t, role: 'HOST' };
    return null;
  }

  view(proof: Buffer, tripId: string, kind: HandoverKind): Promise<HandoverViewRow | null> {
    const p = this.#party(proof, tripId);
    if (p === null) return Promise.resolve(null);
    const { t, role } = p;
    const other: HandoverRole = role === 'HOST' ? 'GUEST' : 'HOST';
    const v = (r: HandoverRole) => {
      const x = t.validations[kind][r];
      return x === undefined
        ? null
        : { validatedAt: x.at, odometerKm: x.odometerKm, fuelEighths: x.fuelEighths };
    };
    const checkin = kind === 'CHECKIN';
    return Promise.resolve({
      viewerRole: role,
      tripStatus: t.status,
      timezone: 'UTC',
      opensAt: checkin ? t.opensAt : null,
      open: checkin
        ? ['CHECKIN_OPEN', 'START_WINDOW_EXPIRED'].includes(t.status)
        : ['IN_PROGRESS', 'OVERDUE'].includes(t.status),
      canOpen:
        checkin && t.status === 'BOOKED' && this.now() >= t.opensAt && t.blockers.length === 0,
      blockers: checkin ? t.blockers : [],
      identityCheck: checkin
        ? {
            status:
              t.identity === null
                ? 'PENDING'
                : t.identity.status === 'TRIP_ID_OK'
                  ? 'OK'
                  : 'FAILED',
            checkedAt: t.identity?.at ?? null,
          }
        : null,
      guest:
        checkin && role === 'HOST' ? { firstName: 'Ana', lastInitial: 'P', birthYear: 1990 } : null,
      photos: { mine: t.photos[kind][role], other: t.photos[kind][other] },
      validations: { mine: v(role), other: v(other) },
      contactlessOffered: false,
      completedAt: checkin ? t.startedAt : t.returnedAt,
    });
  }

  open(proof: Buffer, tripId: string): Promise<{ outcome: string; openedAt: Date | null }> {
    const p = this.#party(proof, tripId);
    const done = (outcome: string, openedAt: Date | null = null) =>
      Promise.resolve({ outcome, openedAt });
    if (p === null) return done('NOT_FOUND');
    const { t } = p;
    if (t.status === 'CHECKIN_OPEN') return done('ALREADY_OPEN', t.opensAt);
    if (t.status !== 'BOOKED' || this.now() < t.opensAt) return done('CHECKIN_NOT_OPEN');
    if (t.blockers.length > 0) return done(t.blockers[0] as string);
    t.status = 'CHECKIN_OPEN';
    return done('DONE', this.now());
  }

  identity(
    proof: Buffer,
    tripId: string,
    checklist: Readonly<Record<string, unknown>>,
    subreason: Subreason | null,
  ): Promise<{ outcome: string; status: string | null; checkedAt: Date | null }> {
    const p = this.#party(proof, tripId);
    const done = (outcome: string, status: string | null = null, at: Date | null = null) =>
      Promise.resolve({ outcome, status, checkedAt: at });
    if (p === null) return done('NOT_FOUND');
    if (p.role !== 'HOST') return done('HOST_ONLY');
    const { t } = p;
    if (t.identity !== null) return done('ALREADY_CHECKED', t.identity.status, t.identity.at);
    if (t.status !== 'CHECKIN_OPEN') return done('CHECKIN_NOT_OPEN');
    const keys = Object.keys(checklist);
    if (keys.length !== POINTS.length || !POINTS.every((k) => typeof checklist[k] === 'boolean')) {
      return done('CHECKIN_LICENSE_CHECK_INCOMPLETE');
    }
    const ok = POINTS.every((k) => checklist[k] === true);
    if (ok && subreason !== null) return done('REQUEST_INVALID');
    t.identity = { status: ok ? 'TRIP_ID_OK' : 'TRIP_ID_FAILED', at: this.now() };
    return done('DONE', t.identity.status, t.identity.at);
  }

  validate(
    proof: Buffer,
    tripId: string,
    kind: HandoverKind,
    reading: { readonly odometerKm: number; readonly fuelEighths: number },
    method: HandoverMethod,
  ): Promise<{
    outcome: string;
    validatedAt: Date | null;
    completedAt: Date | null;
    tripStatus: string | null;
  }> {
    const p = this.#party(proof, tripId);
    const fail = (outcome: string) =>
      Promise.resolve({ outcome, validatedAt: null, completedAt: null, tripStatus: null });
    if (p === null) return fail('NOT_FOUND');
    const { t, role } = p;
    const other: HandoverRole = role === 'HOST' ? 'GUEST' : 'HOST';
    const completed = () => (kind === 'CHECKIN' ? t.startedAt : t.returnedAt);
    const mine = t.validations[kind][role];
    if (mine !== undefined) {
      return Promise.resolve({
        outcome: 'ALREADY_VALIDATED',
        validatedAt: mine.at,
        completedAt: completed(),
        tripStatus: t.status,
      });
    }
    if (method !== 'IN_PERSON') return fail('CONTACTLESS_UNAVAILABLE');
    if (kind === 'CHECKIN' && t.status !== 'CHECKIN_OPEN') return fail('CHECKIN_NOT_OPEN');
    if (kind === 'CHECKOUT' && !['IN_PROGRESS', 'OVERDUE'].includes(t.status)) {
      return fail('CHECKOUT_NOT_OPEN');
    }
    if (
      reading.odometerKm < 0 ||
      reading.odometerKm > 9_999_999 ||
      reading.fuelEighths < 0 ||
      reading.fuelEighths > 8
    ) {
      return fail('READING_INVALID');
    }
    if (t.photos[kind][role] !== 'SUBMITTED') {
      return fail(kind === 'CHECKIN' ? 'CHECKIN_STEP_INCOMPLETE' : 'CHECKOUT_STEP_INCOMPLETE');
    }
    if (kind === 'CHECKIN') {
      if (t.blockers.length > 0) return fail(t.blockers[0] as string);
      if (t.identity?.status === 'TRIP_ID_FAILED') return fail('IDENTITY_CHECK_FAILED');
      if (role === 'HOST' && t.identity?.status !== 'TRIP_ID_OK') {
        return fail('CHECKIN_LICENSE_CHECK_INCOMPLETE');
      }
    }
    const at = this.now();
    t.validations[kind][role] = { at, ...reading };
    if (t.validations[kind][other] !== undefined) {
      if (kind === 'CHECKIN') {
        t.status = 'IN_PROGRESS';
        t.startedAt = at;
      } else {
        t.status = 'RETURNED';
        t.returnedAt = at;
      }
    }
    return Promise.resolve({
      outcome: 'DONE',
      validatedAt: at,
      completedAt: completed(),
      tripStatus: t.status,
    });
  }
}
