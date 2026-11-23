/**
 * Service des frais annexes (US-706 ; 19 US-706 ; 16 CLM-021 ; ADR-197). Toute règle est jugée par
 * la base (partie de la session, liste fermée, pièces du trip, délais en heure serveur, plafonds du
 * pays, échéance de réponse, rejeu) : le service lit le corps strictement, appelle la commande et
 * traduit l'issue. Aucune heure ni aucune jambe n'est reçue du client ; le montant saisi par l'hôte
 * est un entier d'unités mineures en texte, plafonné par la base. Une action sur un frais vérifie
 * d'abord qu'il appartient au trip de l'URL et à la partie de la session (sinon 404). Base
 * injoignable ou paramètre du pays absent ⇒ 503 INCIDENTAL_UNAVAILABLE. Journaux : aucun.
 */
import { Inject, Injectable } from '@nestjs/common';
import { UUID } from '../inspection/model.js';
import { TRP_INCIDENTAL_STORE } from '../tokens.js';
import { IncidentalHttpError, incidentalOutcomeCode } from './errors.js';
import { IncidentalStoreError } from './store.js';
import type { IncidentalRole, IncidentalStore, IncidentalViewRow } from './store.js';

type Body = Readonly<Record<string, unknown>>;

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d === null ? null : d.toISOString());
const MINOR = /^[1-9][0-9]{0,14}$/;
const FEE_TYPE = /^[A-Z][A-Z_]{0,31}$/;

export interface IncidentalSubmitRequest {
  readonly requestId: string;
  readonly feeType: string;
  readonly amountMinor: string;
  readonly description: string;
  readonly evidenceFileIds: readonly string[];
}

function invalid(): never {
  throw new IncidentalHttpError('REQUEST_INVALID');
}

function exactKeys(body: Body, keys: readonly string[]): void {
  const got = Object.keys(body).sort();
  const want = [...keys].sort();
  if (got.length !== want.length || got.some((k, i) => k !== want[i])) invalid();
}

function uuids(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 10) invalid();
  return v.map((x) => {
    if (typeof x !== 'string') invalid();
    const id = x.toLowerCase();
    if (!UUID.test(id)) invalid();
    return id;
  });
}

function text(v: unknown, max: number): string {
  if (typeof v !== 'string' || v.length > max) invalid();
  return v;
}

/** `POST /trips/{tripId}/incidental-fees` : saisie de l'hôte, sans heure ni jambe. */
export function parseSubmitRequest(body: Body): IncidentalSubmitRequest {
  exactKeys(body, ['requestId', 'feeType', 'amountMinor', 'description', 'evidenceFileIds']);
  const id = body['requestId'];
  if (typeof id !== 'string' || !UUID.test(id.toLowerCase())) invalid();
  const feeType = body['feeType'];
  if (typeof feeType !== 'string' || !FEE_TYPE.test(feeType)) invalid();
  const amount = body['amountMinor'];
  if (typeof amount !== 'string' || !MINOR.test(amount)) invalid();
  return {
    requestId: id.toLowerCase(),
    feeType,
    amountMinor: amount,
    description: text(body['description'], 500),
    evidenceFileIds: uuids(body['evidenceFileIds']),
  };
}

/** `POST …/dispute` : motif et photos du trip. */
export function parseDisputeRequest(body: Body): {
  readonly reason: string;
  readonly evidenceFileIds: readonly string[];
} {
  exactKeys(body, ['reason', 'evidenceFileIds']);
  return { reason: text(body['reason'], 1000), evidenceFileIds: uuids(body['evidenceFileIds']) };
}

/** `POST …/accept`, `POST …/cancel` : corps vide (aucun montant ni aucune heure). */
export function parseEmptyRequest(body: Body): void {
  exactKeys(body, []);
}

export interface IncidentalView {
  readonly tripId: string;
  readonly viewerRole: IncidentalRole;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly timezone: string;
  readonly endedAt: string | null;
  readonly hostDeadlineAt: string | null;
  readonly canSubmit: boolean;
  readonly caps: Readonly<Record<string, string | null>> | null;
  readonly feeTypes: readonly string[];
  readonly invoices: readonly {
    readonly id: string;
    readonly feeType: string;
    readonly amountMinor: string;
    readonly status: string;
    readonly notifiedAt: string;
    readonly responseDueAt: string;
    readonly windowOpen: boolean;
    readonly description: string;
    readonly evidenceCount: number;
    readonly evidence: readonly (
      | {
          readonly kind: string;
          readonly slotCode: string;
          readonly slotGroup: string;
          readonly takenBy: IncidentalRole;
          readonly receivedAt: string;
        }
      | {
          readonly kind: 'HOST_FILE';
          readonly takenBy: 'HOST';
          readonly mime: string;
          readonly receivedAt: string;
        }
    )[];
    readonly disputeReason: string | null;
    readonly decision: string | null;
    readonly decisionRationale: string | null;
    readonly chargeStatus: string | null;
  }[];
  readonly photos: readonly {
    readonly fileId: string;
    readonly kind: string;
    readonly slotCode: string;
    readonly slotGroup: string;
    readonly takenBy: IncidentalRole;
  }[];
}

@Injectable()
export class IncidentalService {
  constructor(@Inject(TRP_INCIDENTAL_STORE) private readonly store: IncidentalStore) {}

  async #call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof IncidentalStoreError) {
        throw new IncidentalHttpError('INCIDENTAL_UNAVAILABLE');
      }
      throw error;
    }
  }

  async #row(proof: Buffer, tripId: string): Promise<IncidentalViewRow> {
    const v = await this.#call(() => this.store.view(proof, tripId));
    if (v === null) throw new IncidentalHttpError('INCIDENTAL_NOT_FOUND');
    return v;
  }

  async view(proof: Buffer, tripId: string): Promise<IncidentalView> {
    const v = await this.#row(proof, tripId);
    return {
      tripId,
      viewerRole: v.viewerRole,
      currency: v.currency,
      currencyExponent: v.currencyExponent,
      timezone: v.timezone,
      endedAt: isoOrNull(v.endedAt),
      hostDeadlineAt: isoOrNull(v.hostDeadlineAt),
      canSubmit: v.canSubmit,
      caps: v.caps,
      feeTypes: v.feeTypes,
      invoices: v.invoices.map((i) => ({
        id: i.id,
        feeType: i.feeType,
        amountMinor: i.amountMinor,
        status: i.status,
        notifiedAt: iso(i.notifiedAt),
        responseDueAt: iso(i.responseDueAt),
        windowOpen: i.windowOpen,
        description: i.description,
        evidenceCount: i.evidenceCount,
        evidence: i.evidence.map((e) => ({ ...e, receivedAt: iso(e.receivedAt) })),
        disputeReason: i.disputeReason,
        decision: i.decision,
        decisionRationale: i.decisionRationale,
        chargeStatus: i.chargeStatus,
      })),
      photos: v.photos.map((p) => ({ ...p })),
    };
  }

  async submit(proof: Buffer, tripId: string, body: Body) {
    const input = parseSubmitRequest(body);
    const r = await this.#call(() => this.store.submit(proof, tripId, input));
    if (
      (r.outcome !== 'SUBMITTED' && r.outcome !== 'ALREADY_SUBMITTED') ||
      r.invoiceId === null ||
      r.responseDueAt === null
    ) {
      throw new IncidentalHttpError(incidentalOutcomeCode(r.outcome));
    }
    return {
      invoiceId: r.invoiceId,
      responseDueAt: r.responseDueAt.toISOString(),
      status: 'AWAITING_GUEST' as const,
    };
  }

  /** Le frais doit être un frais du trip de l'URL, vu par la partie attendue (sinon 404). */
  async #own(proof: Buffer, tripId: string, invoiceId: string, role: IncidentalRole) {
    const v = await this.#row(proof, tripId);
    if (v.viewerRole !== role || !v.invoices.some((i) => i.id === invoiceId)) {
      throw new IncidentalHttpError('INCIDENTAL_NOT_FOUND');
    }
  }

  async #act(
    run: () => Promise<string>,
    ok: string,
    replay: string,
    status: 'ACCEPTED' | 'DISPUTED' | 'CANCELLED_BY_HOST',
    invoiceId: string,
  ) {
    const r = await this.#call(run);
    if (r !== ok && r !== replay) throw new IncidentalHttpError(incidentalOutcomeCode(r));
    return { invoiceId, status };
  }

  async accept(proof: Buffer, tripId: string, invoiceId: string, body: Body) {
    parseEmptyRequest(body);
    await this.#own(proof, tripId, invoiceId, 'GUEST');
    return this.#act(
      () => this.store.accept(proof, invoiceId),
      'ACCEPTED',
      'ALREADY_ACCEPTED',
      'ACCEPTED',
      invoiceId,
    );
  }

  async dispute(proof: Buffer, tripId: string, invoiceId: string, body: Body) {
    const { reason, evidenceFileIds } = parseDisputeRequest(body);
    await this.#own(proof, tripId, invoiceId, 'GUEST');
    return this.#act(
      () => this.store.dispute(proof, invoiceId, reason, evidenceFileIds),
      'DISPUTED',
      'ALREADY_DISPUTED',
      'DISPUTED',
      invoiceId,
    );
  }

  async cancel(proof: Buffer, tripId: string, invoiceId: string, body: Body) {
    parseEmptyRequest(body);
    await this.#own(proof, tripId, invoiceId, 'HOST');
    return this.#act(
      () => this.store.cancel(proof, invoiceId),
      'CANCELLED',
      'ALREADY_CANCELLED',
      'CANCELLED_BY_HOST',
      invoiceId,
    );
  }
}
