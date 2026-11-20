/**
 * Service du no-show (US-307 ; 19 US-307 ; 16 TRP-015 ; ADR-191). Toute règle est jugée par la base
 * (partie de la session, délais en heure serveur depuis le début prévu, présence, preuve tracée,
 * demande vivante, rejeu) : le service lit le corps strictement, appelle la commande et traduit
 * l'issue. Le motif (no-show du voyageur ou de l'hôte) est déduit de la partie de la session, jamais
 * reçu. Aucune heure lue du client ; base injoignable ⇒ 503 NO_SHOW_UNAVAILABLE. Journaux : aucun.
 */
import { Inject, Injectable } from '@nestjs/common';
import { UUID } from '../inspection/model.js';
import { TRP_NO_SHOW_STORE } from '../tokens.js';
import { NoShowHttpError, noShowOutcomeCode } from './errors.js';
import { NoShowStoreError } from './store.js';
import type { NoShowStore, NoShowViewRow } from './store.js';

type Body = Readonly<Record<string, unknown>>;

const isoOrNull = (d: Date | null): string | null => (d === null ? null : d.toISOString());

export interface NoShowView {
  readonly tripId: string;
  readonly viewerRole: NoShowViewRow['viewerRole'];
  readonly absentParty: NoShowViewRow['absentParty'];
  readonly tripStatus: string;
  readonly timezone: string;
  readonly scheduledStart: string;
  readonly declarableFrom: string | null;
  readonly declarableUntil: string | null;
  readonly canDeclare: boolean;
  readonly blocker: string | null;
  readonly messageTraced: boolean;
  readonly declaration: {
    readonly id: string;
    readonly requestedReason: string;
    readonly status: string;
    readonly requestedAt: string;
    readonly mine: boolean;
  } | null;
}

/** `POST /trips/{tripId}/no-show` : `{ requestId }` seulement (clé d'idempotence du client). */
export function parseReportRequest(body: Body): { readonly requestId: string } {
  const keys = Object.keys(body);
  const id = body['requestId'];
  if (keys.length !== 1 || keys[0] !== 'requestId' || typeof id !== 'string') {
    throw new NoShowHttpError('REQUEST_INVALID');
  }
  const requestId = id.toLowerCase();
  if (!UUID.test(requestId)) throw new NoShowHttpError('REQUEST_INVALID');
  return { requestId };
}

@Injectable()
export class NoShowService {
  constructor(@Inject(TRP_NO_SHOW_STORE) private readonly store: NoShowStore) {}

  async #call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof NoShowStoreError) throw new NoShowHttpError('NO_SHOW_UNAVAILABLE');
      throw error;
    }
  }

  async view(proof: Buffer, tripId: string): Promise<NoShowView> {
    const v = await this.#call(() => this.store.view(proof, tripId));
    if (v === null) throw new NoShowHttpError('NO_SHOW_NOT_FOUND');
    return {
      tripId,
      viewerRole: v.viewerRole,
      absentParty: v.absentParty,
      tripStatus: v.tripStatus,
      timezone: v.timezone,
      scheduledStart: v.scheduledStart.toISOString(),
      declarableFrom: isoOrNull(v.declarableFrom),
      declarableUntil: isoOrNull(v.declarableUntil),
      canDeclare: v.blocker === null,
      blocker: v.blocker === null ? null : noShowOutcomeCode(v.blocker),
      messageTraced: v.messageTraced,
      declaration:
        v.declaration === null
          ? null
          : {
              id: v.declaration.id,
              requestedReason: v.declaration.requestedReason,
              status: v.declaration.status,
              requestedAt: v.declaration.requestedAt.toISOString(),
              mine: v.declaration.mine,
            },
    };
  }

  async report(proof: Buffer, tripId: string, body: Body) {
    const { requestId } = parseReportRequest(body);
    const r = await this.#call(() => this.store.report(proof, tripId, requestId));
    if (r.outcome !== 'DONE' || r.declarationId === null || r.requestedAt === null) {
      throw new NoShowHttpError(noShowOutcomeCode(r.outcome));
    }
    return {
      declarationId: r.declarationId,
      requestedAt: r.requestedAt.toISOString(),
      status: 'PENDING' as const,
    };
  }
}
