/**
 * Demandes de réservation de l'hôte (US-223 partie 223c, ADR-146 ; 17 §2.5 « Hold de demande
 * REQUEST » ; 16 HDB-002 ; 19 US-219 critères 4 à 6, US-223 critères US-060). Comme Turo : le
 * voyageur autorise le paiement à l'envoi, l'hôte accepte ou refuse avant l'heure limite, rien
 * n'est capturé avant l'acceptation.
 *
 * `accept` :
 *   1. aucun connecteur de capture servi par cette image (production jusqu'au lot C) ⇒
 *      `PAYMENT_UNAVAILABLE` AVANT la base : la demande reste en attente, rien n'est écrit ;
 *   2. acceptation en base (`core.booking_cmd_accept_booking_request`) : AWAITING_HOST →
 *      PAYMENT_IN_FLIGHT avant l'heure limite, opération CAPTURE au montant du devis engagé et au
 *      montant EXPLICITE de chaque jambe (Σ jambes = total ≤ autorisation, sinon LEG_SUM_MISMATCH) ;
 *   3. `capture(amount, legs)` chez le PSP, clé stockée par la base, référence de l'autorisation ;
 *      `RETRY_SAME_KEY` (capture jamais enregistrée) : recherche par NOTRE clé d'abord (N-108),
 *      une capture trouvée n'est jamais renvoyée ;
 *   4. affinage (`core.booking_cmd_request_record_capture`) : référence du PSP. La preuve est le
 *      webhook signé ; la conversion (travailleur booking_conversion) crée le trip BOOKED.
 * Une panne du PSP laisse la capture `PENDING` (aucun débit connu) : l'hôte réessaie, la reprise
 * passe par la même clé.
 *
 * `decline` : RELEASED (REQUEST_DECLINED), créneau libéré, VOID total par la boîte d'envoi ; aucun
 * débit, aucun appel au PSP depuis l'API.
 */
import { assertMovingLegs, isPaymentError } from '../../../pay/index.js';
import type { PaymentProvider } from '../../../pay/index.js';
import { failureFields } from './checkout.service.js';
import { HostRequestHttpError } from './host-request-errors.js';
import type { HostRequestHttpCode } from './host-request-errors.js';
import type {
  HostRequestRow,
  HostRequestStore,
  RequestCapture,
  RequestRefusal,
} from './host-requests-store.js';
import { isUuid } from './model.js';

/** Ce que l'API demande au connecteur d'un PSP pour capturer une demande acceptée. */
export type RequestCaptureProvider = Pick<PaymentProvider, 'capture' | 'getOperation'>;

export type HostRequestOperation = 'list' | 'accept' | 'provider' | 'lookup' | 'psp' | 'record';

/** Journal d'exploitation : opération, nom de l'erreur, SQLSTATE, code PSP ; aucune valeur. */
export type HostRequestFailureLog = (operation: HostRequestOperation, error: unknown) => void;

const PSP_CODE = /^[A-Z][A-Z_]{1,39}$/;

export const LOG_HOST_REQUEST_FAILURE: HostRequestFailureLog = (operation, error) => {
  const code = isPaymentError(error) && PSP_CODE.test(error.code) ? error.code : null;
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'host.request_failed',
      operation,
      ...failureFields(error),
      pspCode: code,
    }),
  );
};

/** Réponse d'une décision de l'hôte : état de la demande après l'appel. */
export interface HostRequestDecision {
  readonly holdId: string;
  /** `CAPTURING` : acceptée, paiement en cours ; `ACCEPTED` : trip né ; `DECLINED`. */
  readonly status: 'CAPTURING' | 'ACCEPTED' | 'DECLINED';
}

const REFUSAL_HTTP: Readonly<Record<RequestRefusal, HostRequestHttpCode>> = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  // IDOR : la base rend FORBIDDEN (journalisé) ; l'API, 404 comme une demande inconnue
  FORBIDDEN: 'REQUEST_NOT_FOUND',
  REQUEST_EXPIRED: 'REQUEST_EXPIRED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  TERMS_REACCEPT_REQUIRED: 'TERMS_REACCEPT_REQUIRED',
  GUEST_NOT_ELIGIBLE: 'GUEST_NOT_ELIGIBLE',
  START_PASSED: 'START_PASSED',
  LEG_SUM_MISMATCH: 'LEG_SUM_MISMATCH',
  PARAM_MISSING: 'BOOKING_UNAVAILABLE',
};

export class HostRequestService {
  constructor(
    private readonly store: HostRequestStore,
    /** Connecteurs de capture par fournisseur ; vide en production (lot C). */
    private readonly providers: ReadonlyMap<string, RequestCaptureProvider>,
    private readonly logFailure: HostRequestFailureLog = LOG_HOST_REQUEST_FAILURE,
  ) {}

  /** Demandes en attente ou en capture du compte ; compte d'un autre ⇒ 404 (même réponse). */
  async list(proof: Buffer, orgId: string): Promise<readonly HostRequestRow[]> {
    if (!isUuid(orgId)) throw new HostRequestHttpError('REQUEST_NOT_FOUND');
    const rows = await this.#guard('list', () => this.store.list(proof, orgId.toLowerCase(), null));
    if (rows === 'FORBIDDEN') throw new HostRequestHttpError('REQUEST_NOT_FOUND');
    return rows;
  }

  /** Une demande du compte ; inconnue ou d'un autre ⇒ 404. */
  async one(proof: Buffer, orgId: string, holdId: string): Promise<HostRequestRow> {
    if (!isUuid(orgId) || !isUuid(holdId)) throw new HostRequestHttpError('REQUEST_NOT_FOUND');
    const rows = await this.#guard('list', () =>
      this.store.list(proof, orgId.toLowerCase(), holdId.toLowerCase()),
    );
    if (rows === 'FORBIDDEN' || rows[0] === undefined) {
      throw new HostRequestHttpError('REQUEST_NOT_FOUND');
    }
    return rows[0];
  }

  async accept(proof: Buffer, orgId: string, holdId: string): Promise<HostRequestDecision> {
    if (!isUuid(orgId) || !isUuid(holdId)) throw new HostRequestHttpError('REQUEST_NOT_FOUND');
    const org = orgId.toLowerCase();
    const id = holdId.toLowerCase();
    // aucun connecteur dans cette image : refus AVANT la base (la demande reste en attente)
    if (this.providers.size === 0) throw new HostRequestHttpError('PAYMENT_UNAVAILABLE');
    const r = await this.#guard('accept', () => this.store.accept(proof, org, id));
    if (r.kind === 'REFUSED') throw new HostRequestHttpError(REFUSAL_HTTP[r.code]);
    if (r.kind === 'DONE') return { holdId: id, status: r.outcome };
    await this.#capture(proof, org, id, r.capture);
    return { holdId: id, status: 'CAPTURING' };
  }

  async decline(proof: Buffer, orgId: string, holdId: string): Promise<HostRequestDecision> {
    if (!isUuid(orgId) || !isUuid(holdId)) throw new HostRequestHttpError('REQUEST_NOT_FOUND');
    const id = holdId.toLowerCase();
    const r = await this.#guard('accept', () => this.store.decline(proof, orgId.toLowerCase(), id));
    if (r.kind === 'REFUSED') throw new HostRequestHttpError(REFUSAL_HTTP[r.code]);
    return { holdId: id, status: 'DECLINED' };
  }

  /** Capture chez le PSP puis affinage ; jamais une seconde capture d'une même clé trouvée. */
  async #capture(proof: Buffer, org: string, holdId: string, c: RequestCapture): Promise<void> {
    const provider = this.providers.get(c.provider);
    if (provider === undefined) {
      this.logFailure('provider', new Error('fournisseur non servi par cette image'));
      throw new HostRequestHttpError('PAYMENT_UNAVAILABLE');
    }
    try {
      // 08 E7 règle 1 : la somme des jambes vaut le montant, avant tout appel au PSP
      assertMovingLegs(c.amountMinor, c.legs);
    } catch (error) {
      this.logFailure('accept', error);
      throw new HostRequestHttpError('LEG_SUM_MISMATCH');
    }
    if (c.outcome === 'RETRY_SAME_KEY') {
      const found = await this.#psp('lookup', () =>
        provider.getOperation({ merchantReference: c.idemSent }),
      );
      if (found !== null) {
        await this.#record(proof, org, holdId, c.operationId, found.providerReference);
        return;
      }
    }
    const result = await this.#psp('psp', () =>
      provider.capture({
        idempotencyKey: c.idemSent,
        amountMinor: c.amountMinor,
        currency: c.currency,
        legs: c.legs,
        providerReference: c.authorizationReference,
      }),
    );
    await this.#record(proof, org, holdId, c.operationId, result.providerReference);
  }

  async #record(
    proof: Buffer,
    org: string,
    holdId: string,
    operationId: string,
    providerReference: string,
  ): Promise<void> {
    const outcome = await this.#guard('record', () =>
      this.store.recordCapture(proof, org, holdId, operationId, providerReference),
    );
    if (outcome !== 'RECORDED') throw new HostRequestHttpError(REFUSAL_HTTP[outcome]);
  }

  /** Appel au PSP : toute erreur ⇒ 503 journalisé (la capture reste PENDING, reprise par la clé). */
  async #psp<T>(operation: HostRequestOperation, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logFailure(operation, error);
      throw new HostRequestHttpError('PAYMENT_UNAVAILABLE');
    }
  }

  /** Base : toute panne ⇒ 503 journalisé, jamais un succès. */
  async #guard<T>(operation: HostRequestOperation, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof HostRequestHttpError) throw error;
      this.logFailure(operation, error);
      throw new HostRequestHttpError('BOOKING_UNAVAILABLE');
    }
  }
}
