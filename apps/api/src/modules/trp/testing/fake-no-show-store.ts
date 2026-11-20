/**
 * FAKE du magasin du no-show (US-307) — TESTS SEULEMENT (répertoire `testing`, absent de la
 * compilation de production). Mémoire du processus ; reprend les règles de la base (migration 0171)
 * que les routes exposent : partie de la session (empreinte du jeton), partie absente déduite,
 * fenêtre en heure serveur (grâce du pays pour le voyageur, 30 min pour l'hôte, fin à 72 h), preuve
 * tracée exigée du voyageur, présence, demande vivante, rejeu par requestId. Les règles elles-mêmes
 * sont prouvées sur PostgreSQL (`packages/db/test/l0/l0-us307-no-show.test.ts`) ; ce FAKE ne fait
 * pas foi.
 */
import type {
  NoShowReport,
  NoShowRole,
  NoShowStore,
  NoShowViewRow,
} from '../internal/no-show/store.js';

const MINUTE = 60_000;

export interface FakeNoShowTrip {
  readonly hostProof: string;
  readonly guestProof: string;
  status: string;
  start: Date;
  graceMinutes: number;
  /** Message tracé de la partie présente (hôte ou voyageur). */
  traced: Record<NoShowRole, boolean>;
  present: Record<NoShowRole, boolean>;
  declaration: {
    id: string;
    by: NoShowRole;
    reason: string;
    status: 'AWAITING_REVIEW' | 'PENDING' | 'SETTLED' | 'FIN_REVIEW' | 'FAILED';
    at: Date;
  } | null;
}

export function fakeNoShowTrip(hostProof: string, guestProof: string, start: Date): FakeNoShowTrip {
  return {
    hostProof,
    guestProof,
    status: 'CHECKIN_OPEN',
    start,
    graceMinutes: 60,
    traced: { HOST: false, GUEST: false },
    present: { HOST: false, GUEST: false },
    declaration: null,
  };
}

export class FakeNoShowStore implements NoShowStore {
  readonly trips = new Map<string, FakeNoShowTrip>();
  now: () => Date = () => new Date();

  #party(proof: Buffer, tripId: string): { t: FakeNoShowTrip; role: NoShowRole } | null {
    const t = this.trips.get(tripId);
    if (t === undefined) return null;
    const hex = proof.toString('hex');
    if (hex === t.guestProof) return { t, role: 'GUEST' };
    if (hex === t.hostProof) return { t, role: 'HOST' };
    return null;
  }

  #state(t: FakeNoShowTrip, absent: NoShowRole) {
    const from = new Date(t.start.getTime() + (absent === 'GUEST' ? t.graceMinutes : 30) * MINUTE);
    const until = new Date(t.start.getTime() + 72 * 60 * MINUTE);
    const present: NoShowRole = absent === 'GUEST' ? 'HOST' : 'GUEST';
    const now = this.now();
    const live = t.declaration !== null && t.declaration.status !== 'FAILED';
    const blocker =
      t.status === 'BOOKED'
        ? 'CHECKIN_NOT_OPEN'
        : !['CHECKIN_OPEN', 'START_WINDOW_EXPIRED'].includes(t.status)
          ? 'TRIP_TRANSITION_FORBIDDEN'
          : now < from
            ? 'NO_SHOW_TOO_EARLY'
            : now > until
              ? 'NO_SHOW_WINDOW_CLOSED'
              : t.present[absent]
                ? 'NO_SHOW_PARTY_PRESENT'
                : absent === 'HOST' && !t.traced.GUEST
                  ? 'NO_SHOW_EVIDENCE_REQUIRED'
                  : live
                    ? 'CANCELLATION_PENDING'
                    : null;
    return { from, until, blocker, traced: t.traced[present] };
  }

  view(proof: Buffer, tripId: string): Promise<NoShowViewRow | null> {
    const p = this.#party(proof, tripId);
    if (p === null) return Promise.resolve(null);
    const { t, role } = p;
    const absent: NoShowRole = role === 'HOST' ? 'GUEST' : 'HOST';
    const s = this.#state(t, absent);
    return Promise.resolve({
      viewerRole: role,
      absentParty: absent,
      tripStatus: t.status,
      timezone: 'UTC',
      scheduledStart: t.start,
      declarableFrom: s.from,
      declarableUntil: s.until,
      blocker: s.blocker,
      messageTraced: s.traced,
      declaration:
        t.declaration === null
          ? null
          : {
              id: t.declaration.id,
              requestedReason: t.declaration.reason,
              status: t.declaration.status,
              requestedAt: t.declaration.at,
              mine: t.declaration.by === role,
            },
    });
  }

  report(proof: Buffer, tripId: string, requestId: string): Promise<NoShowReport> {
    const fail = (outcome: string) =>
      Promise.resolve({ outcome, declarationId: null, requestedAt: null, status: null });
    const p = this.#party(proof, tripId);
    if (p === null) return fail('NOT_FOUND');
    const { t, role } = p;
    if (t.declaration?.id === requestId) {
      return t.declaration.by === role
        ? Promise.resolve({
            outcome: 'DONE',
            declarationId: requestId,
            requestedAt: t.declaration.at,
            status: t.declaration.status,
          })
        : fail('REQUEST_INVALID');
    }
    for (const other of this.trips.values()) {
      if (other !== t && other.declaration?.id === requestId) return fail('REQUEST_INVALID');
    }
    const absent: NoShowRole = role === 'HOST' ? 'GUEST' : 'HOST';
    const s = this.#state(t, absent);
    if (s.blocker !== null) return fail(s.blocker);
    const at = this.now();
    t.declaration = {
      id: requestId,
      by: role,
      reason: absent === 'GUEST' ? 'GUEST_NO_SHOW' : 'HOST_NO_SHOW',
      // le signalement du voyageur attend la validation de l'ops (0171, ADR-191)
      status: role === 'GUEST' ? 'AWAITING_REVIEW' : 'PENDING',
      at,
    };
    return Promise.resolve({
      outcome: 'DONE',
      declarationId: requestId,
      requestedAt: at,
      status: t.declaration.status,
    });
  }
}
