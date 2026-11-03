/**
 * Adaptateur FAKE du port `PaymentProvider` (US-019 ; ADR-032, ADR-059), au-dessus du PSP simulé
 * de `@rueda/fake-adapters/psp`.
 *
 * JAMAIS EN PRODUCTION (C19) : ce répertoire est exclu de `tsconfig.build.json`, n'est exporté par
 * aucun index public, `@rueda/fake-adapters` n'est qu'une dépendance de développement, et la
 * construction refuse tout `RUEDA_ENV` autre que development / test.
 *
 * Comme un connecteur réel, l'adaptateur vérifie AVANT tout appel : jambes (Σ = montant, ≥ 0 ;
 * réaffectation Σ = 0) et capacités requises (inconnue = non) ; il traduit toute erreur du PSP en
 * erreur normalisée (17 §2.8).
 */
import {
  assertFakeAllowed,
  FakePspError,
  verifyFakeSignature,
  FAKE_SIGNATURE_HEADER,
} from '@rueda/fake-adapters';
import type { FakePsp, FakeTransaction } from '@rueda/fake-adapters';
import { CapabilitySet } from '../internal/capabilities.js';
import type { CapabilityRecord } from '../internal/capabilities.js';
import { PaymentError } from '../internal/errors.js';
import { assertMovingLegs, assertReallocationLegs } from '../internal/legs.js';
import type {
  CaptureRequest,
  ChargeMitRequest,
  CreateHostedPaymentRequest,
  HostedPayment,
  NormalizedPaymentEvent,
  OperationLookup,
  OperationResult,
  OperationStatus,
  PaymentProvider,
  ProviderOperation,
  ReallocateRequest,
  ReferenceRequest,
  RefundRequest,
  RollbackRequest,
  WebhookHeaders,
  WebhookVerification,
} from '../internal/port.js';

export const FAKE_PROVIDER = 'FAKE';

/** Statut d'une transaction du PSP simulé, projeté sur le statut d'opération (17 §3.2.7). */
export function fakeStatus(tx: Pick<FakeTransaction, 'status'>): OperationStatus {
  switch (tx.status) {
    case 'CREATED':
      return 'SUBMITTED';
    case 'AUTHORIZED':
    case 'SUCCEEDED':
      return 'SUCCEEDED';
    case 'FAILED':
    case 'EXPIRED':
    case 'CANCELLED':
      return 'FAILED';
  }
}

function translate(error: unknown): never {
  if (!(error instanceof FakePspError)) throw error;
  switch (error.kind) {
    case 'DECLINED':
      throw new PaymentError('DECLINED', error.message, {
        ...(error.declineCode !== null ? { declineCode: error.declineCode } : {}),
        doNotRetry: error.doNotRetry,
      });
    case 'ALREADY_PAID':
      throw new PaymentError('DECLINED', error.message, {
        declineCode: 'ALREADY_PAID',
        doNotRetry: true,
      });
    case 'TIMEOUT':
    case 'UNREADABLE':
      throw new PaymentError('UNKNOWN_OUTCOME', error.message);
    case 'UNAVAILABLE':
      throw new PaymentError('PROVIDER_UNAVAILABLE', error.message);
    case 'IDEMPOTENCY_CONFLICT':
      throw new PaymentError('IDEMPOTENCY_CONFLICT', error.message);
    case 'UNSUPPORTED':
      throw new PaymentError('UNSUPPORTED_CAPABILITY', error.message);
    case 'INVALID_LEGS':
      throw new PaymentError('LEG_SUM_MISMATCH', error.message);
    case 'ALREADY_CANCELLED':
    case 'NOT_FOUND':
    case 'INVALID_REQUEST':
    case 'ORDER_EXPIRED':
      throw new PaymentError('INVALID_REQUEST', error.message);
  }
}

const result = (tx: FakeTransaction): OperationResult => ({
  providerReference: tx.reference,
  status: fakeStatus(tx),
});

export class FakePaymentProvider implements PaymentProvider {
  readonly provider = FAKE_PROVIDER;
  readonly #psp: FakePsp;
  readonly #caps: CapabilitySet;

  constructor(
    psp: FakePsp,
    capabilities: readonly CapabilityRecord[],
    env?: Readonly<Record<string, string | undefined>>,
  ) {
    assertFakeAllowed('FakePaymentProvider', env);
    this.#psp = psp;
    this.#caps = new CapabilitySet(capabilities);
  }

  capabilities(): CapabilitySet {
    return this.#caps;
  }

  #call<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      throw translateSafe(error);
    }
  }

  async createHostedPayment(req: CreateHostedPaymentRequest): Promise<HostedPayment> {
    assertMovingLegs(req.amountMinor, req.legs);
    this.#caps.require('SUPPORTS_PER_LEG_AMOUNTS');
    if (req.capture === 'MANUAL') this.#caps.require('SUPPORTS_PREAUTH', req.method);
    return this.#call(() => {
      const tx = this.#psp.createOrder({
        merchantReference: req.idempotencyKey,
        method: req.method,
        amountMinor: req.amountMinor,
        currency: req.currency,
        legs: req.legs,
        capture: req.capture,
      });
      return {
        providerReference: tx.reference,
        redirectUrl: `https://fake-psp.test/pay/${tx.reference}`,
        expiresAt:
          this.#caps.bool('ORDER_EXPIRY_RETURNED', req.method) && tx.expiresAtMs !== null
            ? new Date(tx.expiresAtMs)
            : null,
      };
    });
  }

  async cancelOrder(req: ReferenceRequest): Promise<OperationResult> {
    this.#caps.require('SUPPORTS_ORDER_CANCEL');
    return this.#call(() => {
      try {
        return result(
          this.#psp.cancelOrder({
            merchantReference: req.idempotencyKey,
            reference: req.providerReference,
          }),
        );
      } catch (error) {
        // « déjà annulé » : l'effet voulu est acquis (17 §6.5 point 5)
        if (error instanceof FakePspError && error.kind === 'ALREADY_CANCELLED') {
          return { providerReference: req.providerReference, status: 'SUCCEEDED' as const };
        }
        throw error;
      }
    });
  }

  async capture(req: CaptureRequest): Promise<OperationResult> {
    assertMovingLegs(req.amountMinor, req.legs);
    this.#caps.require('SUPPORTS_PER_LEG_AMOUNTS');
    return this.#call(() =>
      result(
        this.#psp.capture({
          merchantReference: req.idempotencyKey,
          reference: req.providerReference,
          amountMinor: req.amountMinor,
          currency: req.currency,
          legs: req.legs,
        }),
      ),
    );
  }

  async void(req: ReferenceRequest): Promise<OperationResult> {
    this.#caps.require('SUPPORTS_VOID');
    return this.#call(() =>
      result(
        this.#psp.void({ merchantReference: req.idempotencyKey, reference: req.providerReference }),
      ),
    );
  }

  async refund(req: RefundRequest): Promise<OperationResult> {
    assertMovingLegs(req.amountMinor, req.legs);
    this.#caps.require('SUPPORTS_PER_LEG_AMOUNTS');
    this.#caps.require('SUPPORTS_REFUND');
    return this.#call(() =>
      result(
        this.#psp.refund({
          merchantReference: req.idempotencyKey,
          reference: req.providerReference,
          amountMinor: req.amountMinor,
          currency: req.currency,
          legs: req.legs,
        }),
      ),
    );
  }

  async reallocate(req: ReallocateRequest): Promise<OperationResult> {
    assertReallocationLegs(req.legs);
    this.#caps.require('SUPPORTS_PER_LEG_AMOUNTS');
    this.#caps.require('SUPPORTS_PAYOUT_ADJUSTMENT');
    return this.#call(() =>
      result(
        this.#psp.reallocate({
          merchantReference: req.idempotencyKey,
          reference: req.providerReference,
          currency: req.currency,
          legs: req.legs,
        }),
      ),
    );
  }

  async rollback(req: RollbackRequest): Promise<OperationResult> {
    assertMovingLegs(req.amountMinor, req.legs);
    this.#caps.require('SUPPORTS_PER_LEG_AMOUNTS');
    this.#caps.require('ROLLBACK_WINDOW_HOURS');
    return this.#call(() =>
      result(
        this.#psp.rollback({
          merchantReference: req.idempotencyKey,
          reference: req.providerReference,
          amountMinor: req.amountMinor,
          currency: req.currency,
          legs: req.legs,
        }),
      ),
    );
  }

  async chargeMIT(req: ChargeMitRequest): Promise<OperationResult> {
    assertMovingLegs(req.amountMinor, req.legs);
    this.#caps.require('SUPPORTS_PER_LEG_AMOUNTS');
    this.#caps.require('SUPPORTS_MIT');
    return this.#call(() =>
      result(
        this.#psp.chargeMit({
          merchantReference: req.idempotencyKey,
          instrumentToken: req.instrumentToken,
          reason: req.reason,
          amountMinor: req.amountMinor,
          currency: req.currency,
          legs: req.legs,
        }),
      ),
    );
  }

  async reauthorize(req: ReferenceRequest): Promise<OperationResult> {
    this.#caps.require('SUPPORTS_REAUTH');
    return this.#call(() =>
      result(
        this.#psp.reauthorize({
          merchantReference: req.idempotencyKey,
          reference: req.providerReference,
        }),
      ),
    );
  }

  async getOperation(lookup: OperationLookup): Promise<ProviderOperation | null> {
    if (lookup.merchantReference !== undefined)
      this.#caps.require('SUPPORTS_LOOKUP_BY_MERCHANT_REF');
    return this.#call(() => {
      const tx =
        lookup.merchantReference !== undefined
          ? this.#psp.lookup({ merchantReference: lookup.merchantReference })
          : this.#psp.lookup({ reference: lookup.providerReference });
      return tx === null
        ? null
        : {
            providerReference: tx.reference,
            merchantReference: tx.merchantReference,
            status: fakeStatus(tx),
            amountMinor: tx.amountMinor,
            currency: tx.currency,
            legs: tx.legs,
          };
    });
  }

  verifyAndParseWebhook(
    raw: Uint8Array,
    headers: WebhookHeaders,
    secret: Uint8Array,
  ): WebhookVerification {
    const check = verifyFakeSignature(secret, headers[FAKE_SIGNATURE_HEADER], raw);
    if (!check.valid || check.timestampS === null) {
      return { signatureValid: false, signedAt: null, providerEventId: null, events: [] };
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as Record<
        string,
        unknown
      >;
    } catch {
      return { signatureValid: false, signedAt: null, providerEventId: null, events: [] };
    }
    const status =
      body['status'] === 'SUCCEEDED'
        ? 'SUCCEEDED'
        : body['status'] === 'FAILED'
          ? 'FAILED'
          : 'SUBMITTED';
    const events: NormalizedPaymentEvent[] =
      typeof body['reference'] === 'string' && typeof body['type'] === 'string'
        ? [
            {
              type: body['type'],
              providerReference: body['reference'],
              merchantReference:
                this.#caps.bool('ECHOES_MERCHANT_REF_IN_WEBHOOK') &&
                typeof body['merchant_reference'] === 'string'
                  ? body['merchant_reference']
                  : null,
              status,
              occurredAt: typeof body['occurred_at'] === 'string' ? body['occurred_at'] : '',
            },
          ]
        : [];
    return {
      signatureValid: true,
      signedAt: new Date(check.timestampS * 1000),
      providerEventId: typeof body['id'] === 'string' ? body['id'] : null,
      events,
    };
  }
}

function translateSafe(error: unknown): unknown {
  try {
    return translate(error);
  } catch (translated) {
    return translated;
  }
}
