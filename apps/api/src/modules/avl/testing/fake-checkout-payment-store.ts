/**
 * Doubles du paiement du checkout (US-223 partie 223b) — TESTS SEULEMENT (contrat HTTP). Les règles
 * (T1 sous verrous, montant et jambes du devis engagé, preuve par webhook signé, conversion) sont
 * prouvées en base (`l0-us223-*`, migration 0116) et par l'adaptateur FAKE dans PAY
 * (`pay/testing/`, jamais importable hors de PAY : C19) ; ces doubles rendent ce qu'on leur impose
 * et retiennent ce que l'API leur transmet.
 */
import { assertMovingLegs, PaymentError } from '../../pay/index.js';
import type { MitConsentOutcome, MitConsentPort, MitReminderOutcome } from '../../pay/index.js';
import type {
  CreateHostedPaymentRequest,
  DepositEnforcement,
  DepositGuestView,
  HostedPayment,
  OperationLookup,
  ProviderOperation,
} from '../../pay/index.js';
import type {
  DepositGatePort,
  HostedPaymentProvider,
} from '../internal/checkout/payment.service.js';
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
    // comme la base (T1 sous verrous) : un hold déjà en vol ne rend jamais NEW_ORDER
    if (r.kind === 'START' && r.start.outcome === 'NEW_ORDER' && h.row.holdStatus !== 'ACTIVE') {
      return Promise.resolve({ kind: 'IN_FLIGHT' });
    }
    // opération PENDING sans référence jusqu'à T2
    if (r.kind === 'START') {
      h.row = { ...h.row, holdStatus: 'PAYMENT_IN_FLIGHT', operationStatus: 'PENDING' };
    }
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
    if (outcome === 'RECORDED') h.row = { ...h.row, operationStatus: 'SUBMITTED' };
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

/**
 * Porte de la caution imposée (US-701) — TESTS SEULEMENT. Par défaut, AUCUNE vue (champ `deposit`
 * absent, forme de 223b inchangée) et décision « aucune caution » : les contrats d'US-223 ne
 * portent pas sur la caution. Les règles (déclencheurs, montant, rail, écriture unique) sont
 * prouvées par PAY (`deposit-checkout.test.ts`) et en base (`l0-us701-deposit-hold`).
 */
export class FakeDepositGate implements DepositGatePort {
  /** Vue rendue à la lecture ; `null` : champ `deposit` absent. */
  shown: DepositGuestView | null = null;
  enforcement: DepositEnforcement = { kind: 'ACCEPTED', view: { status: 'NONE' } };
  down = false;
  /** Appels de `view` (évaluation demandée ou non) et de `enforce`. */
  views: boolean[] = [];
  enforced: string[] = [];

  view(_proof: Buffer, _holdId: string, evaluate: boolean): Promise<DepositGuestView | null> {
    this.views.push(evaluate);
    if (this.down) return Promise.reject(new Error('base indisponible'));
    return Promise.resolve(this.shown);
  }

  enforce(_proof: Buffer, holdId: string): Promise<DepositEnforcement> {
    this.enforced.push(holdId);
    if (this.down) return Promise.reject(new Error('base indisponible'));
    return Promise.resolve(this.enforcement);
  }
}

/**
 * Consentement MIT du checkout imposé (US-703) — TESTS SEULEMENT. Par défaut, chaque consentement
 * est ACCEPTÉ (puis ALREADY_ACCEPTED) ; la règle (hold du voyageur, hold payable, une fois) est
 * prouvée en base (`l0-us703-mit-charges`).
 */
export class FakeMitConsents implements MitConsentPort {
  readonly accepted: { readonly holdId: string; readonly locale: string }[] = [];
  readonly reminded: { readonly tripId: string; readonly locale: string }[] = [];
  outcome: MitConsentOutcome | null = null;
  down = false;

  accept(_proof: Buffer, holdId: string, locale: string): Promise<MitConsentOutcome> {
    if (this.down) return Promise.reject(new Error('base indisponible'));
    if (this.outcome !== null) return Promise.resolve(this.outcome);
    const again = this.accepted.some((a) => a.holdId === holdId);
    this.accepted.push({ holdId, locale });
    return Promise.resolve(again ? 'ALREADY_ACCEPTED' : 'ACCEPTED');
  }

  acknowledgeReminder(_proof: Buffer, tripId: string, locale: string): Promise<MitReminderOutcome> {
    if (this.down) return Promise.reject(new Error('base indisponible'));
    this.reminded.push({ tripId, locale });
    return Promise.resolve('ACKNOWLEDGED');
  }
}
