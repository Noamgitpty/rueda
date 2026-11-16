/**
 * Paiement du hold du checkout, parcours du voyageur (US-223 partie 223b, ADR-142 ; 17 §2.5 étapes
 * 3a à 3c ; 16 PAY-034, PAY-006, PAY-019, BKG-014 ; 10b S06, UX-26, UX-27).
 *
 * `pay` : lecture de l'état (hold du voyageur de la session, sinon 404), puis
 *   1. T1 `booking_cmd_checkout_pay` : intention de paiement sur le compte marchand de Kmino du pays,
 *      montant et jambes du devis ENGAGÉ rejoués par la base (le client n'envoie aucun montant) ;
 *      un ordre déjà en cours ⇒ aucun nouvel envoi (UX-27 : « pas de second paiement possible
 *      pendant qu'un ordre est actif ») ;
 *   2. `createHostedPayment` de l'adaptateur du fournisseur de l'opération, avec la clé stockée par
 *      T1 et le montant EXPLICITE de chaque jambe (08 E7 règle 1) ; `RETRY_SAME_KEY` : recherche
 *      par notre clé d'abord (N-108), un ordre trouvé n'est jamais recréé ;
 *   3. T2 `booking_cmd_checkout_record_order` : référence et expiration réelle de l'ordre ; seul
 *      `RECORDED` renvoie le voyageur vers la page hébergée du PSP.
 * Aucun connecteur servi (production jusqu'au lot C : registre vide, C19) ⇒ `PAYMENT_UNAVAILABLE`
 * AVANT T1 : aucun hold n'est mis « en vol » pour rien.
 *
 * `payment` : état pour S05 et S06, dérivé de `hold_status` et du trip né de la conversion. Le
 * voyageur n'est confirmé que si le hold est `CONVERTED` ET qu'un trip existe (preuve par webhook
 * signé, ADR-139) ; le statut brut de l'opération n'est jamais rendu ni lu pour confirmer : il ne
 * sert qu'à distinguer un refus (« payer de nouveau ») d'un paiement non prouvé (« ne paie pas de
 * nouveau, support »).
 */
import { assertMovingLegs, isPaymentError, PAYMENT_METHODS } from '../../../pay/index.js';
import type { PaymentMethod, PaymentProvider } from '../../../pay/index.js';
import { failureFields } from './checkout.service.js';
import { isUuid } from './model.js';
import { PaymentHttpError } from './payment-errors.js';
import type { PaymentHttpCode } from './payment-errors.js';
import { paymentRefusalOf } from './payment-store.js';
import type { CheckoutPaymentRow, CheckoutPaymentStore, PaymentStart } from './payment-store.js';

/** Ce que l'API demande au connecteur d'un PSP pour le paiement du checkout. */
export type HostedPaymentProvider = Pick<PaymentProvider, 'createHostedPayment' | 'getOperation'>;

/**
 * États du paiement rendus au site (PROPOSÉS, ADR-142) :
 * - `PAYABLE` : hold vivant, aucun ordre ; `DECLINED` : hold vivant, dernier ordre refusé ;
 * - `VERIFYING` : ordre en cours ou paiement reçu en attente de preuve (« Pago en verificación ») ;
 * - `CONFIRMED` : hold `CONVERTED` et trip né (seul état « confirmé ») ;
 * - `REFUND_DUE` : payé après la libération du créneau, compensé (remboursement intégral, 10b §3
 *   règle 3) ;
 * - `UNPROVEN` : hold terminé avec un ordre ni refusé ni converti (paiement possible mais non
 *   prouvé : aucun débit confirmé, renvoi au support) ;
 * - `ENDED` : hold terminé sans paiement (aucun débit).
 */
export const PAYMENT_STATES = [
  'PAYABLE',
  'DECLINED',
  'VERIFYING',
  'CONFIRMED',
  'REFUND_DUE',
  'UNPROVEN',
  'ENDED',
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export interface CheckoutPayment {
  readonly holdId: string;
  readonly state: PaymentState;
  readonly holdStatus: string;
  /** Trip né de la conversion ; `null` tant qu'aucune preuve n'a converti le hold. */
  readonly tripId: string | null;
  readonly expiresAt: string;
  readonly paymentInFlightUntil: string | null;
}

export interface CheckoutPaymentStarted extends CheckoutPayment {
  /** Page hébergée du PSP ; `null` : aucun ordre créé par cet appel (voir `state`). */
  readonly redirectUrl: string | null;
}

/** État du paiement d'une lecture de la base (fonction pure, prouvée par les unitaires). */
export function paymentStateOf(row: CheckoutPaymentRow): PaymentState {
  const failed = row.operationStatus === 'FAILED';
  switch (row.holdStatus) {
    case 'CONVERTED':
      // jamais « confirmé » sans trip (incohérence : on attend, fail-closed)
      return row.tripId === null ? 'VERIFYING' : 'CONFIRMED';
    case 'PAYMENT_IN_FLIGHT':
      return 'VERIFYING';
    case 'ACTIVE':
      if (row.operationStatus === null) return 'PAYABLE';
      // ordre en cours ou non prouvé sur un hold vivant : ne pas payer de nouveau
      return failed ? 'DECLINED' : 'VERIFYING';
    case 'COMPENSATED':
      return 'REFUND_DUE';
    case 'EXPIRED':
    case 'RELEASED':
      return row.operationStatus === null || failed ? 'ENDED' : 'UNPROVEN';
    default:
      throw new PaymentHttpError('BOOKING_UNAVAILABLE');
  }
}

const viewOf = (holdId: string, row: CheckoutPaymentRow): CheckoutPayment => ({
  holdId,
  state: paymentStateOf(row),
  holdStatus: row.holdStatus,
  tripId: row.tripId,
  expiresAt: row.expiresAt,
  paymentInFlightUntil: row.paymentInFlightUntil,
});

/** Corps de `POST …/payment` : seulement le moyen (défaut `CARD`) ; tout autre champ ⇒ refus. */
export function parsePaymentDemand(body: unknown): PaymentMethod | null {
  if (body === undefined || body === null) return 'CARD';
  if (typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.some((k) => k !== 'method')) return null;
  const method = (body as { method?: unknown }).method;
  if (method === undefined) return 'CARD';
  return (PAYMENT_METHODS as readonly unknown[]).includes(method)
    ? (method as PaymentMethod)
    : null;
}

export type PaymentOperation = 'read' | 'start' | 'provider' | 'lookup' | 'psp' | 'record';

/** Journal d'exploitation : opération, nom de l'erreur, SQLSTATE et code PSP ; aucune valeur. */
export type PaymentFailureLog = (operation: PaymentOperation, error: unknown) => void;

const PSP_CODE = /^[A-Z][A-Z_]{1,39}$/;

export const LOG_PAYMENT_FAILURE: PaymentFailureLog = (operation, error) => {
  const code = isPaymentError(error) && PSP_CODE.test(error.code) ? error.code : null;
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'checkout.payment_failed',
      operation,
      ...failureFields(error),
      pspCode: code,
    }),
  );
};

export class CheckoutPaymentService {
  constructor(
    private readonly store: CheckoutPaymentStore,
    /** Connecteurs servis par cette image, par fournisseur ; vide en production (lot C). */
    private readonly providers: ReadonlyMap<string, HostedPaymentProvider>,
    private readonly logFailure: PaymentFailureLog = LOG_PAYMENT_FAILURE,
  ) {}

  /** État du paiement du hold du voyageur de la session ; inconnu ou d'un autre ⇒ 404. */
  async payment(proof: Buffer, holdId: string): Promise<CheckoutPayment> {
    if (!isUuid(holdId)) throw new PaymentHttpError('HOLD_NOT_FOUND');
    const id = holdId.toLowerCase();
    return viewOf(id, await this.#read(proof, id));
  }

  /**
   * Démarre ou reprend le paiement. `created` : un ordre a été créé ou repris chez le PSP et le
   * voyageur doit y être renvoyé (`redirectUrl`) ; sinon l'état fait foi (aucun nouvel ordre).
   */
  async pay(
    proof: Buffer,
    holdId: string,
    body: unknown,
  ): Promise<{ readonly created: boolean; readonly payment: CheckoutPaymentStarted }> {
    if (!isUuid(holdId)) throw new PaymentHttpError('HOLD_NOT_FOUND');
    const id = holdId.toLowerCase();
    const method = parsePaymentDemand(body);
    if (method === null) throw new PaymentHttpError('REQUEST_INVALID');
    const before = viewOf(id, await this.#read(proof, id));
    if (before.state !== 'PAYABLE' && before.state !== 'DECLINED') {
      return { created: false, payment: { ...before, redirectUrl: null } };
    }
    // aucun connecteur dans cette image : refus AVANT T1 (le hold n'est pas mis en vol)
    if (this.providers.size === 0) throw new PaymentHttpError('PAYMENT_UNAVAILABLE');
    const started = await this.#guard('start', () => this.store.start(proof, id, method));
    if (started.kind === 'REFUSED') throw new PaymentHttpError(started.code);
    if (started.kind === 'IN_FLIGHT') return this.#current(proof, id, null);
    const redirectUrl = await this.#order(proof, id, started.start);
    return this.#current(proof, id, redirectUrl);
  }

  /**
   * Ordre chez le PSP puis T2. Rend l'adresse de la page hébergée si le voyageur doit y aller ;
   * `null` si l'ordre existait déjà (recherche par clé) ou si le hold a changé entre-temps.
   */
  async #order(proof: Buffer, holdId: string, start: PaymentStart): Promise<string | null> {
    const provider = this.providers.get(start.provider);
    if (provider === undefined) {
      this.logFailure('provider', new Error('fournisseur non servi par cette image'));
      throw new PaymentHttpError('PAYMENT_UNAVAILABLE');
    }
    try {
      // 08 E7 règle 1 : la somme des jambes vaut le montant, avant tout appel au PSP
      assertMovingLegs(start.amountMinor, start.legs);
    } catch (error) {
      this.logFailure('start', error);
      throw new PaymentHttpError('PAYMENT_UNAVAILABLE');
    }
    if (start.outcome === 'RETRY_SAME_KEY') {
      // N-108 : l'ordre a peut-être été créé par un appel précédent sans réponse ; un ordre trouvé
      // n'est JAMAIS recréé (le voyageur attend la preuve) ; lecture impossible ⇒ aucun envoi
      const found = await this.#psp('lookup', () =>
        provider.getOperation({ merchantReference: start.idemSent }),
      );
      if (found !== null) {
        await this.#record(proof, holdId, start.operationId, found.providerReference, null);
        return null;
      }
    }
    const hosted = await this.#psp('psp', () =>
      provider.createHostedPayment({
        idempotencyKey: start.idemSent,
        amountMinor: start.amountMinor,
        currency: start.currency,
        legs: start.legs,
        method: start.method as PaymentMethod,
        capture: 'AUTO',
        tripReference: holdId,
      }),
    );
    const recorded = await this.#record(
      proof,
      holdId,
      start.operationId,
      hosted.providerReference,
      hosted.expiresAt,
    );
    return recorded ? hosted.redirectUrl : null;
  }

  /** T2 ; `true` : ordre enregistré sur un hold en vol (redirection vers le PSP). */
  async #record(
    proof: Buffer,
    holdId: string,
    operationId: string,
    providerReference: string,
    expiresAt: Date | null,
  ): Promise<boolean> {
    const outcome = await this.#guard('record', () =>
      this.store.record(proof, holdId, operationId, providerReference, expiresAt),
    );
    switch (outcome) {
      case 'RECORDED':
        return true;
      // preuve arrivée avant T2 : l'état fait foi, aucune redirection
      case 'CONVERTED':
      case 'COMPENSATED':
        return false;
      // hold échu entre T1 et T2 : le voyageur n'est pas renvoyé payer (17 §2.5 étape 3c)
      case 'EXPIRED':
        throw new PaymentHttpError('HOLD_EXPIRED');
      default:
        throw new PaymentHttpError(outcome);
    }
  }

  async #current(
    proof: Buffer,
    holdId: string,
    redirectUrl: string | null,
  ): Promise<{ readonly created: boolean; readonly payment: CheckoutPaymentStarted }> {
    const view = viewOf(holdId, await this.#read(proof, holdId));
    // une redirection n'a de sens que tant que le paiement est en cours
    const url = view.state === 'VERIFYING' ? redirectUrl : null;
    return { created: url !== null, payment: { ...view, redirectUrl: url } };
  }

  async #read(proof: Buffer, holdId: string): Promise<CheckoutPaymentRow> {
    const row = await this.#guard('read', () => this.store.read(proof, holdId));
    if (row === 'AUTH_REQUIRED' || row === 'HOLD_NOT_FOUND') throw new PaymentHttpError(row);
    return row;
  }

  /** Appel au PSP : toute erreur ⇒ 503 journalisé ; capacité bloquante manquante ⇒ son code. */
  async #psp<T>(operation: PaymentOperation, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logFailure(operation, error);
      if (isPaymentError(error, 'HOST_PAYOUT_RAIL_UNAVAILABLE')) {
        throw new PaymentHttpError('HOST_PAYOUT_RAIL_UNAVAILABLE');
      }
      throw new PaymentHttpError('PAYMENT_UNAVAILABLE');
    }
  }

  /** Base : refus connu ⇒ son code ; toute autre panne ⇒ 503 journalisé, jamais un succès. */
  async #guard<T>(operation: PaymentOperation, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof PaymentHttpError) throw error;
      const code: PaymentHttpCode | null = paymentRefusalOf(error);
      if (code !== null) throw new PaymentHttpError(code);
      this.logFailure(operation, error);
      throw new PaymentHttpError('BOOKING_UNAVAILABLE');
    }
  }
}
