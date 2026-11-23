/**
 * FAKE du magasin des sinistres d'un trip (US-318) — TESTS SEULEMENT (répertoire `testing`, absent
 * de la compilation de production). Mémoire du processus ; reprend les règles de la base (migration
 * 0178) que les routes exposent : partie de la session (empreinte du jeton), fenêtre du trip,
 * demande d'aide, photos, délai, période du trip, pièce, frais du pays, rejeu par requestId. Les
 * règles elles-mêmes sont prouvées sur PostgreSQL (`packages/db/test/l0/l0-us318-p2p-claims.test.ts`) ;
 * ce FAKE ne fait pas foi (les montants attendus des tests viennent de 08, pas d'ici).
 * Suite (0181, ADR-201) : référence unique par trip, plafond, délai de réponse du voyageur, paiement
 * et contestation (prouvés par l0-us318s-traffic-response).
 */
import { randomUUID } from 'node:crypto';
import { TripClaimStoreError } from '../internal/p2p/store.js';
import type {
  IncidentInput,
  IncidentResult,
  TrafficChargeInput,
  TrafficChargeResult,
  TrafficDisputeInput,
  TripClaimsStore,
} from '../internal/p2p/store.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const refKey = (r: string): string => r.toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface FakeClaimsTrip {
  readonly hostProof: string;
  readonly guestProof: string;
  status: string;
  country: string;
  currency: string;
  start: Date;
  /** Retour effectif ; `null` : trip non rendu. */
  end: Date | null;
  deadlineDays: number | null;
  feeBps: number | null;
  /** Délai du voyageur (h) et plafond du montant (0181) ; `null` : paramètre absent. */
  responseHours: number | null;
  capMinor: bigint | null;
  /** Demandes d'aide vivantes du voyageur. */
  cases: Set<string>;
  incidentPhotos: number;
  /** Pièces de la série TRAFFIC du titulaire. */
  evidence: Map<string, { slot: string; receivedAt: Date }>;
  theft: {
    status: 'THEFT_INVESTIGATION' | 'RETURNED';
    openedAt: Date;
    closedAt: Date | null;
    insurerStatus: 'PENDING' | 'SENT' | 'WITHDRAWN';
  } | null;
}

export function fakeClaimsTrip(hostProof: string, guestProof: string, start: Date): FakeClaimsTrip {
  return {
    hostProof,
    guestProof,
    status: 'IN_PROGRESS',
    country: 'XA',
    currency: 'XTA',
    start,
    end: null,
    deadlineDays: 120,
    feeBps: 500,
    responseHours: 48,
    capMinor: 100_000n,
    cases: new Set(),
    incidentPhotos: 0,
    evidence: new Map(),
    theft: null,
  };
}

interface Incident {
  readonly id: string;
  readonly requestId: string;
  readonly caseId: string;
  readonly proof: string;
  readonly at: Date;
  readonly photos: number;
}

interface Charge {
  readonly id: string;
  readonly tripId: string;
  readonly requestId: string;
  readonly proof: string;
  readonly input: TrafficChargeInput;
  readonly fee: bigint;
  readonly deadline: Date;
  readonly at: Date;
  readonly due: Date;
  guestStatus: 'AWAITING_GUEST' | 'ACCEPTED' | 'DISPUTED';
  disputeReason: string | null;
}

export class FakeTripClaimsStore implements TripClaimsStore {
  readonly trips = new Map<string, FakeClaimsTrip>();
  readonly incidents: Incident[] = [];
  readonly charges: Charge[] = [];
  now: () => Date = () => new Date();

  reportIncident(proof: Buffer, tripId: string, input: IncidentInput): Promise<IncidentResult> {
    const t = this.trips.get(tripId);
    const hex = proof.toString('hex');
    const none = (outcome: string): Promise<IncidentResult> =>
      Promise.resolve({ outcome, incidentId: null, reportedAt: null, photoCount: null });
    if (t === undefined || hex !== t.guestProof) return none('NOT_FOUND');
    const old = this.incidents.find((i) => i.requestId === input.requestId);
    if (old !== undefined) {
      if (old.proof !== hex || old.caseId !== input.caseId) {
        return Promise.reject(new TripClaimStoreError('rejeu', '22023'));
      }
      return Promise.resolve({
        outcome: 'DUPLICATE',
        incidentId: old.id,
        reportedAt: old.at,
        photoCount: old.photos,
      });
    }
    if (t.status !== 'IN_PROGRESS' && t.status !== 'OVERDUE') return none('INCIDENT_NOT_OPEN');
    if (!t.cases.has(input.caseId)) return none('INCIDENT_CASE_REQUIRED');
    const existing = this.incidents.find((i) => i.caseId === input.caseId);
    if (existing !== undefined) {
      return Promise.resolve({
        outcome: 'EXISTS',
        incidentId: existing.id,
        reportedAt: existing.at,
        photoCount: existing.photos,
      });
    }
    if (t.incidentPhotos < 1) return none('INCIDENT_PHOTOS_REQUIRED');
    const i: Incident = {
      id: randomUUID(),
      requestId: input.requestId,
      caseId: input.caseId,
      proof: hex,
      at: this.now(),
      photos: t.incidentPhotos,
    };
    this.incidents.push(i);
    return Promise.resolve({
      outcome: 'REPORTED',
      incidentId: i.id,
      reportedAt: i.at,
      photoCount: i.photos,
    });
  }

  declareTrafficCharge(
    proof: Buffer,
    tripId: string,
    input: TrafficChargeInput,
    preview = false,
  ): Promise<TrafficChargeResult> {
    const t = this.trips.get(tripId);
    const hex = proof.toString('hex');
    const none = (outcome: string, body: Record<string, unknown> | null = null) =>
      Promise.resolve({ outcome, chargeId: null, body });
    if (t === undefined || hex !== t.hostProof) return none('NOT_FOUND');
    const body = (c: Charge): Record<string, unknown> => ({
      amountMinor: c.input.amountMinor.toString(),
      adminFeeMinor: c.fee.toString(),
      totalMinor: (c.input.amountMinor + c.fee).toString(),
      deadlineAt: c.deadline.toISOString(),
      responseDueAt: c.due.toISOString(),
    });
    const old = this.charges.find((c) => c.requestId === input.requestId);
    // un récapitulatif ne lit ni ne consomme l'identifiant de requête (rien n'est écrit)
    if (old !== undefined && !preview) {
      if (old.proof !== hex || old.tripId !== tripId || old.input.fileId !== input.fileId) {
        return Promise.reject(new TripClaimStoreError('rejeu', '22023'));
      }
      return Promise.resolve({ outcome: 'DUPLICATE', chargeId: old.id, body: body(old) });
    }
    if (t.end === null) return none('TRAFFIC_TRIP_NOT_ENDED');
    if (t.deadlineDays === null) return none('TRAFFIC_WINDOW_UNKNOWN');
    if (t.feeBps === null) return none('TRAFFIC_FEE_UNKNOWN');
    if (t.responseHours === null) return none('TRAFFIC_RESPONSE_WINDOW_UNKNOWN');
    if (t.capMinor === null) return none('TRAFFIC_CAP_UNKNOWN');
    const deadline = new Date(t.end.getTime() + t.deadlineDays * DAY);
    const now = this.now();
    if (now > deadline) {
      return none('TRAFFIC_CHARGE_DEADLINE_PASSED', { deadlineAt: deadline.toISOString() });
    }
    if (input.occurredAt < t.start || input.occurredAt > t.end || input.occurredAt > now) {
      return none('TRAFFIC_OUTSIDE_TRIP');
    }
    if (input.amountMinor > t.capMinor) {
      return none('TRAFFIC_AMOUNT_ABOVE_CAP', {
        capMinor: t.capMinor.toString(),
        currency: t.currency,
      });
    }
    const dup = this.charges.find(
      (c) => c.tripId === tripId && refKey(c.input.reference) === refKey(input.reference),
    );
    if (dup !== undefined) return none('TRAFFIC_DUPLICATE', { chargeId: dup.id });
    if (
      !t.evidence.has(input.fileId) ||
      this.charges.some((c) => c.input.fileId === input.fileId)
    ) {
      return none('TRAFFIC_EVIDENCE_REQUIRED');
    }
    const bps = BigInt(t.feeBps);
    const fee = (2n * input.amountMinor * bps + 10_000n) / 20_000n;
    if (preview) {
      return Promise.resolve({
        outcome: 'PREVIEW',
        chargeId: null,
        body: {
          amountMinor: input.amountMinor.toString(),
          adminFeeMinor: fee.toString(),
          totalMinor: (input.amountMinor + fee).toString(),
          currency: t.currency,
          feeBps: t.feeBps,
          reference: input.reference,
          responseHours: t.responseHours,
          capMinor: t.capMinor.toString(),
          deadlineAt: deadline.toISOString(),
          legs: {
            HOST: input.amountMinor.toString(),
            INSURER: '0',
            TAX_THIRD_PARTY: '0',
            PLATFORM: fee.toString(),
          },
        },
      });
    }
    const c: Charge = {
      id: randomUUID(),
      tripId,
      requestId: input.requestId,
      proof: hex,
      input,
      fee,
      deadline,
      at: now,
      due: new Date(now.getTime() + t.responseHours * HOUR),
      guestStatus: 'AWAITING_GUEST',
      disputeReason: null,
    };
    this.charges.push(c);
    return Promise.resolve({ outcome: 'DECLARED', chargeId: c.id, body: body(c) });
  }

  hostClaims(proof: Buffer, tripId: string): Promise<Readonly<Record<string, unknown>> | null> {
    const t = this.trips.get(tripId);
    if (t === undefined || proof.toString('hex') !== t.hostProof) return Promise.resolve(null);
    const deadline =
      t.end !== null && t.deadlineDays !== null
        ? new Date(t.end.getTime() + t.deadlineDays * DAY)
        : null;
    const used = new Set(
      this.charges.filter((c) => c.tripId === tripId).map((c) => c.input.fileId),
    );
    return Promise.resolve({
      tripId,
      country: t.country,
      currency: t.currency,
      open: deadline !== null && t.feeBps !== null && this.now() <= deadline,
      tripStartAt: t.start.toISOString(),
      tripEndAt: t.end?.toISOString() ?? null,
      deadlineAt: deadline?.toISOString() ?? null,
      feeBps: t.feeBps,
      responseHours: t.responseHours,
      capMinor: t.capMinor?.toString() ?? null,
      theft:
        t.theft === null
          ? null
          : {
              status: t.theft.status,
              openedAt: t.theft.openedAt.toISOString(),
              closedAt: t.theft.closedAt?.toISOString() ?? null,
              insurerStatus: t.theft.insurerStatus,
            },
      charges: this.charges
        .filter((c) => c.tripId === tripId)
        .map((c) => ({
          id: c.id,
          kind: c.input.kind,
          occurredAt: c.input.occurredAt.toISOString(),
          amountMinor: c.input.amountMinor.toString(),
          adminFeeMinor: c.fee.toString(),
          totalMinor: (c.input.amountMinor + c.fee).toString(),
          declaredAt: c.at.toISOString(),
          reference: c.input.reference,
          responseDueAt: c.due.toISOString(),
          guestStatus: c.guestStatus,
          status: 'PENDING',
        })),
      evidence: [...t.evidence].map(([fileId, e]) => ({
        fileId,
        slot: e.slot,
        receivedAt: e.receivedAt.toISOString(),
        used: used.has(fileId),
      })),
    });
  }

  guestCharges(proof: Buffer, tripId: string): Promise<Readonly<Record<string, unknown>> | null> {
    const t = this.trips.get(tripId);
    if (t === undefined || proof.toString('hex') !== t.guestProof) return Promise.resolve(null);
    const now = this.now();
    return Promise.resolve({
      tripId,
      currency: t.currency,
      charges: this.charges
        .filter((c) => c.tripId === tripId)
        .map((c) => ({
          id: c.id,
          kind: c.input.kind,
          occurredAt: c.input.occurredAt.toISOString(),
          reference: c.input.reference,
          amountMinor: c.input.amountMinor.toString(),
          adminFeeMinor: c.fee.toString(),
          totalMinor: (c.input.amountMinor + c.fee).toString(),
          declaredAt: c.at.toISOString(),
          responseDueAt: c.due.toISOString(),
          status: c.guestStatus,
          executionStatus: 'PENDING',
          canRespond: c.guestStatus === 'AWAITING_GUEST' && now < c.due,
          disputeReason: c.disputeReason,
          decidedAt: null,
          decisionRationale: null,
        })),
      photos: [],
    });
  }

  #guestCharge(proof: Buffer, chargeId: string): Charge | null {
    const c = this.charges.find((x) => x.id === chargeId);
    const t = c === undefined ? undefined : this.trips.get(c.tripId);
    return c !== undefined && t !== undefined && proof.toString('hex') === t.guestProof ? c : null;
  }

  acceptTrafficCharge(proof: Buffer, chargeId: string): Promise<string> {
    const c = this.#guestCharge(proof, chargeId);
    if (c === null) return Promise.resolve('NOT_FOUND');
    if (c.guestStatus === 'ACCEPTED') return Promise.resolve('ALREADY_ACCEPTED');
    if (c.guestStatus !== 'AWAITING_GUEST') return Promise.resolve('TRAFFIC_NOT_OPEN');
    if (this.now() >= c.due) return Promise.resolve('GUEST_RESPONSE_WINDOW_CLOSED');
    c.guestStatus = 'ACCEPTED';
    return Promise.resolve('ACCEPTED');
  }

  disputeTrafficCharge(
    proof: Buffer,
    chargeId: string,
    input: TrafficDisputeInput,
  ): Promise<string> {
    const c = this.#guestCharge(proof, chargeId);
    if (c === null) return Promise.resolve('NOT_FOUND');
    if (c.guestStatus === 'DISPUTED') return Promise.resolve('ALREADY_DISPUTED');
    if (c.guestStatus !== 'AWAITING_GUEST') return Promise.resolve('TRAFFIC_NOT_OPEN');
    if (this.now() >= c.due) return Promise.resolve('GUEST_RESPONSE_WINDOW_CLOSED');
    const reason = input.reason.trim();
    if (reason.length < 20) return Promise.resolve('INCIDENTAL_DISPUTE_REASON_REQUIRED');
    if (input.evidence.length > 0) return Promise.resolve('CLAIM_EVIDENCE_MISSING');
    c.guestStatus = 'DISPUTED';
    c.disputeReason = reason;
    return Promise.resolve('DISPUTED');
  }
}
