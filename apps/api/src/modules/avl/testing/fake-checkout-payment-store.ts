/**
 * Doubles du paiement du checkout (US-223 partie 223b) — TESTS SEULEMENT (contrat HTTP). Les règles
 * (T1 sous verrous, montant et jambes du devis engagé, preuve par webhook signé, conversion) sont
 * prouvées en base (`l0-us223-*`, migration 0116) et par l'adaptateur FAKE dans PAY
 * (`pay/testing/`, jamais importable hors de PAY : C19) ; ces doubles rendent ce qu'on leur impose
 * et retiennent ce que l'API leur transmet.
 */
import { assertMovingLegs, PaymentError } from '../../pay/index.js';
import type {
  CreateHostedPaymentRequest,
  HostedPayment,
  OperationLookup,
  ProviderOperation,
} from '../../pay/index.js';
import type { HostedPaymentProvider } from '../internal/checkout/payment.service.js';
import type {
  CheckoutPaymentRow,
  CheckoutPaymentStore,
  PaymentStartResult,
  RecordOutcome,
} from '../internal/checkout/payment-store.js';

export interface FakeHold {
  row: CheckoutPaymentRow;
  /** Réponse de T1 ; par défaut : refus PAYMENT_UNAVAILABLE. */
  start?: PaymentStartResult;
  /** Issue de T2 ; `RECORDED` met le hold en vol. */
  record?: RecordOutcome;
}

export class FakeCheckoutPaymentStore implements CheckoutPaymentStore {
  /** Holds par empreinte de session (hex) puis identifiant. */
  holds = new Map<string, FakeHold>();
  down = false;
  starts: { proof: string; holdId: string; method: string }[] = [];
  records: {
    holdId: string;
    operationId: string;
    providerReference: string;
    orderExpiresAt: string | null;
  }[] = [];

  #fail(): Promise<never> {
    return Promise.reject(new Error('base indisponible (FAKE)'));
  }

  read(proof: Buffer, holdId: string) {
    if (this.down) return this.#fail();
    const h = this.holds.get(`${proof.toString('hex')}:${holdId}`);
    return Promise.resolve(h === undefined ? ('HOLD_NOT_FOUND' as const) : h.row);
  }

  start(proof: Buffer, holdId: string, method: string): Promise<PaymentStartResult> {
    if (this.down) return this.#fail();
    this.starts.push({ proof: proof.toString('hex'), holdId, method });
    const h = this.holds.get(`${proof.toString('hex')}:${holdId}`);
    if (h === undefined) return Promise.resolve({ kind: 'REFUSED', code: 'HOLD_NOT_FOUND' });
    const r = h.start ?? { kind: 'REFUSED', code: 'PAYMENT_UNAVAILABLE' };
    if (r.kind === 'START') h.row = { ...h.row, holdStatus: 'PAYMENT_IN_FLIGHT' };
    return Promise.resolve(r);
  }

  record(
    proof: Buffer,
    holdId: string,
    operationId: string,
    providerReference: string,
    orderExpiresAt: Date | null,
  ): Promise<RecordOutcome> {
    if (this.down) return this.#fail();
    this.records.push({
      holdId,
      operationId,
      providerReference,
      orderExpiresAt: orderExpiresAt === null ? null : orderExpiresAt.toISOString(),
    });
    const h = this.holds.get(`${proof.toString('hex')}:${holdId}`);
    if (h === undefined) return Promise.resolve('HOLD_NOT_FOUND');
    const outcome = h.record ?? 'RECORDED';
    if (outcome === 'CONVERTED' || outcome === 'COMPENSATED' || outcome === 'EXPIRED') {
      h.row = { ...h.row, holdStatus: outcome };
    }
    return Promise.resolve(outcome);
  }
}

/**
 * Connecteur enregistreur : vérifie la somme des jambes comme tout adaptateur (08 E7 règle 1),
 * retient chaque ordre reçu et rend une page hébergée fictive (`https://psp.fake.invalid/…`).
 */
export class RecordingHostedPayments implements HostedPaymentProvider {
  orders: CreateHostedPaymentRequest[] = [];
  lookups: OperationLookup[] = [];
  /** Ordre rendu par la recherche par clé ; `null` : inconnu du PSP. */
  found: ProviderOperation | null = null;
  failWith: PaymentError | null = null;
  expiresAt: Date | null = new Date('2036-11-30T15:20:00.000Z');

  createHostedPayment(request: CreateHostedPaymentRequest): Promise<HostedPayment> {
    this.orders.push(request);
    if (this.failWith !== null) return Promise.reject(this.failWith);
    assertMovingLegs(request.amountMinor, request.legs);
    const ref = `fake-${this.orders.length}`;
    return Promise.resolve({
      providerReference: ref,
      redirectUrl: `https://psp.fake.invalid/pay/${ref}`,
      expiresAt: this.expiresAt,
    });
  }

  getOperation(lookup: OperationLookup): Promise<ProviderOperation | null> {
    this.lookups.push(lookup);
    return Promise.resolve(this.found);
  }
}

export { PaymentError };
