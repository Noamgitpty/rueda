/**
 * FAKE du magasin des frais annexes (US-706) — TESTS SEULEMENT (répertoire `testing`, absent de la
 * compilation de production). Mémoire du processus ; reprend les règles de la base (migration 0177)
 * que les routes exposent : partie de la session (empreinte du jeton), liste fermée, pièces = photos
 * du trip, délai de l'hôte et échéance de réponse en heure serveur, plafond, doublon, rejeu par
 * requestId, transitions de SM-5. Les règles elles-mêmes sont prouvées sur PostgreSQL
 * (`packages/db/test/l0/l0-us706-incidental-fees.test.ts`) ; ce FAKE ne fait pas foi.
 */
import type {
  IncidentalFeeType,
  IncidentalInvoiceRow,
  IncidentalPhotoRow,
  IncidentalRole,
  IncidentalStatus,
  IncidentalStore,
  IncidentalSubmitInput,
  IncidentalSubmitResult,
  IncidentalViewRow,
} from '../internal/incidental/store.js';

const HOUR = 3_600_000;
const LIST = [
  'FUEL',
  'CLEANING',
  'SMOKING',
  'EV_CHARGE',
  'MILEAGE',
  'TOLL',
  'TICKET',
  'LATE_RETURN',
];
const HANDLED: readonly string[] = ['FUEL', 'CLEANING', 'SMOKING'];

interface FakeInvoice {
  id: string;
  requestId: string;
  feeType: IncidentalFeeType;
  amountMinor: string;
  status: IncidentalStatus;
  notifiedAt: Date;
  responseDueAt: Date;
  description: string;
  evidence: string[];
  disputeReason: string | null;
}

export interface FakeIncidentalTrip {
  readonly hostProof: string;
  readonly guestProof: string;
  readonly currency: string;
  endedAt: Date | null;
  windowHours: number;
  responseHours: number;
  capMinor: bigint | null;
  photos: IncidentalPhotoRow[];
  invoices: FakeInvoice[];
}

export function fakeIncidentalTrip(
  hostProof: string,
  guestProof: string,
  endedAt: Date,
  photos: IncidentalPhotoRow[],
): FakeIncidentalTrip {
  return {
    hostProof,
    guestProof,
    currency: 'XTS',
    endedAt,
    windowHours: 72,
    responseHours: 72,
    capMinor: 15000n,
    photos,
    invoices: [],
  };
}

export class FakeIncidentalStore implements IncidentalStore {
  readonly trips = new Map<string, FakeIncidentalTrip>();
  now: () => Date = () => new Date();
  #seq = 0;

  #party(proof: Buffer, tripId: string): { t: FakeIncidentalTrip; role: IncidentalRole } | null {
    const t = this.trips.get(tripId);
    if (t === undefined) return null;
    const hex = proof.toString('hex');
    if (hex === t.guestProof) return { t, role: 'GUEST' };
    if (hex === t.hostProof) return { t, role: 'HOST' };
    return null;
  }

  #invoice(proof: Buffer, invoiceId: string) {
    for (const [tripId, t] of this.trips) {
      const i = t.invoices.find((x) => x.id === invoiceId);
      if (i !== undefined) {
        const p = this.#party(proof, tripId);
        return p === null ? null : { ...p, i };
      }
    }
    return null;
  }

  #known(t: FakeIncidentalTrip, ids: readonly string[]): boolean {
    return ids.length > 0 && ids.every((id) => t.photos.some((p) => p.fileId === id));
  }

  view(proof: Buffer, tripId: string): Promise<IncidentalViewRow | null> {
    const p = this.#party(proof, tripId);
    if (p === null) return Promise.resolve(null);
    const now = this.now();
    const { t } = p;
    const deadline =
      t.endedAt === null ? null : new Date(t.endedAt.getTime() + t.windowHours * HOUR);
    const invoices: IncidentalInvoiceRow[] = t.invoices.map((i) => ({
      id: i.id,
      feeType: i.feeType,
      amountMinor: i.amountMinor,
      status: i.status,
      notifiedAt: i.notifiedAt,
      responseDueAt: i.responseDueAt,
      windowOpen: i.status === 'AWAITING_GUEST' && now < i.responseDueAt,
      description: i.description,
      evidenceCount: i.evidence.length,
      disputeReason: i.disputeReason,
      decision: null,
      decisionRationale: null,
      chargeStatus: null,
    }));
    return Promise.resolve({
      viewerRole: p.role,
      currency: t.currency,
      currencyExponent: 2,
      timezone: 'Etc/UTC',
      endedAt: t.endedAt,
      hostDeadlineAt: deadline,
      canSubmit: p.role === 'HOST' && deadline !== null && now <= deadline,
      feeTypes: ['FUEL', 'CLEANING', 'SMOKING'],
      invoices,
      photos: t.photos,
    });
  }

  submit(
    proof: Buffer,
    tripId: string,
    input: IncidentalSubmitInput,
  ): Promise<IncidentalSubmitResult> {
    const out = (outcome: string, i?: FakeInvoice): Promise<IncidentalSubmitResult> =>
      Promise.resolve({
        outcome,
        invoiceId: i?.id ?? null,
        responseDueAt: i?.responseDueAt ?? null,
      });
    const p = this.#party(proof, tripId);
    if (p === null || p.role !== 'HOST') return out('NOT_FOUND');
    const { t } = p;
    for (const x of this.trips.values()) {
      const old = x.invoices.find((i) => i.requestId === input.requestId);
      if (old !== undefined) {
        return x === t ? out('ALREADY_SUBMITTED', old) : out('REQUEST_INVALID');
      }
    }
    if (!LIST.includes(input.feeType)) return out('INCIDENTAL_TYPE_NOT_ALLOWED');
    if (!HANDLED.includes(input.feeType)) return out('INCIDENTAL_TYPE_NOT_SUPPORTED');
    if (input.description.trim().length < 10) return out('REQUEST_INVALID');
    if (t.endedAt === null) return out('INCIDENTAL_TRIP_NOT_ENDED');
    const now = this.now();
    if (now.getTime() > t.endedAt.getTime() + t.windowHours * HOUR) {
      return out('INCIDENTAL_WINDOW_CLOSED');
    }
    if (!this.#known(t, input.evidenceFileIds)) return out('CLAIM_EVIDENCE_MISSING');
    if (t.capMinor === null) return out('PARAM_MISSING');
    if (BigInt(input.amountMinor) > t.capMinor) return out('INCIDENTAL_AMOUNT_ABOVE_CAP');
    if (
      t.invoices.some(
        (i) =>
          i.feeType === input.feeType &&
          i.status !== 'REJECTED' &&
          i.status !== 'CANCELLED_BY_HOST',
      )
    ) {
      return out('INCIDENTAL_DUPLICATE');
    }
    this.#seq += 1;
    const i: FakeInvoice = {
      id: `0190a1b2-c3d4-7e5f-8a9b-${this.#seq.toString(16).padStart(12, '0')}`,
      requestId: input.requestId,
      feeType: input.feeType as IncidentalFeeType,
      amountMinor: input.amountMinor,
      status: 'AWAITING_GUEST',
      notifiedAt: now,
      responseDueAt: new Date(now.getTime() + t.responseHours * HOUR),
      description: input.description.trim(),
      evidence: [...input.evidenceFileIds],
      disputeReason: null,
    };
    t.invoices.push(i);
    return out('SUBMITTED', i);
  }

  cancel(proof: Buffer, invoiceId: string): Promise<string> {
    const f = this.#invoice(proof, invoiceId);
    if (f === null || f.role !== 'HOST') return Promise.resolve('NOT_FOUND');
    if (f.i.status === 'CANCELLED_BY_HOST') return Promise.resolve('ALREADY_CANCELLED');
    if (f.i.status !== 'AWAITING_GUEST' && f.i.status !== 'DISPUTED') {
      return Promise.resolve('INCIDENTAL_NOT_CANCELLABLE');
    }
    f.i.status = 'CANCELLED_BY_HOST';
    return Promise.resolve('CANCELLED');
  }

  #open(f: { i: FakeInvoice }): string | null {
    if (f.i.status !== 'AWAITING_GUEST') return 'INCIDENTAL_NOT_OPEN';
    if (this.now() >= f.i.responseDueAt) return 'GUEST_RESPONSE_WINDOW_CLOSED';
    return null;
  }

  accept(proof: Buffer, invoiceId: string): Promise<string> {
    const f = this.#invoice(proof, invoiceId);
    if (f === null || f.role !== 'GUEST') return Promise.resolve('NOT_FOUND');
    if (f.i.status === 'ACCEPTED') return Promise.resolve('ALREADY_ACCEPTED');
    const blocked = this.#open(f);
    if (blocked !== null) return Promise.resolve(blocked);
    f.i.status = 'ACCEPTED';
    return Promise.resolve('ACCEPTED');
  }

  dispute(
    proof: Buffer,
    invoiceId: string,
    reason: string,
    evidenceFileIds: readonly string[],
  ): Promise<string> {
    const f = this.#invoice(proof, invoiceId);
    if (f === null || f.role !== 'GUEST') return Promise.resolve('NOT_FOUND');
    if (f.i.status === 'DISPUTED') return Promise.resolve('ALREADY_DISPUTED');
    const blocked = this.#open(f);
    if (blocked !== null) return Promise.resolve(blocked);
    if (reason.trim().length < 20) return Promise.resolve('INCIDENTAL_DISPUTE_REASON_REQUIRED');
    if (!this.#known(f.t, evidenceFileIds)) return Promise.resolve('CLAIM_EVIDENCE_MISSING');
    f.i.status = 'DISPUTED';
    f.i.disputeReason = reason.trim();
    return Promise.resolve('DISPUTED');
  }
}
