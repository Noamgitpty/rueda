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
 *
 * US-701 (ADR-169 ; 08 BR-PAY-06 « Moment de l'évaluation ») : la caution est décidée AVANT le
 * paiement. `payment` rend la vue du voyageur (`deposit` : aucune caution, montant et libération,
 * ou réservation impossible et jours possibles ; jamais les déclencheurs ni l'instantané des
 * paramètres, S-7) ; `pay` applique la porte avant T1 : refus ⇒ `DEPOSIT_RAIL_UNAVAILABLE` ou
 * `DEPOSIT_PARAM_MISSING` sans écriture ni ordre ; sinon la décision est figée (`deposit_hold`),
 * puis le paiement suit.
 */
import { assertMovingLegs, isPaymentError, PAYMENT_METHODS } from '../../../pay/index.js';
import type {
  DepositEnforcement,
  DepositGuestView,
  PaymentMethod,
  PaymentProvider,
} from '../../../pay/index.js';
import { failureFields } from './checkout.service.js';
import { isUuid } from './model.js';
import { PaymentHttpError } from './payment-errors.js';
import type { PaymentHttpCode } from './payment-errors.js';
import { paymentRefusalOf } from './payment-store.js';
import type {
  CheckoutPaymentRow,
  CheckoutPaymentStore,
  PaymentStart,
  RequestStatus,
} from './payment-store.js';

/** Ce que l'API demande au connecteur d'un PSP pour le paiement du checkout. */
export type HostedPaymentProvider = Pick<PaymentProvider, 'createHostedPayment' | 'getOperation'>;

/** Porte de la caution du checkout (PAY, `DepositCheckoutGate`). */
export interface DepositGatePort {
  view(
    proof: Buffer,
    holdId: string,
    evaluate: boolean,
  ): Promise<DepositGuestView | null | 'AUTH_REQUIRED' | 'HOLD_NOT_FOUND'>;
  enforce(proof: Buffer, holdId: string): Promise<DepositEnforcement>;
}

/**
 * Caution vue par le voyageur (S05) : statut, montant (texte d'unités mineures), devise, nature
 * (`HOLD` blocage sur la carte, `CHARGE` débit puis remboursement) et libération au plus tard ; ou
 * réservation impossible et jours entiers possibles (`null` : aucun). Aucun champ [C2].
 */
export type CheckoutDepositView =
  | { readonly status: 'NONE' }
  | {
      readonly status: 'REQUIRED';
      readonly amountMinor: string;
      readonly currency: string;
      readonly kind: 'HOLD' | 'CHARGE';
      readonly releaseAt: string;
    }
  | { readonly status: 'UNAVAILABLE'; readonly maxBookableDays: number | null };

/** Sérialisation de la vue (liste blanche des champs : rien d'autre ne sort). */
export function depositViewOf(v: DepositGuestView): CheckoutDepositView {
  switch (v.status) {
    case 'NONE':
      return { status: 'NONE' };
    case 'REQUIRED':
      return {
        status: 'REQUIRED',
        amountMinor: v.amountMinor.toString(),
        currency: v.currency,
        kind: v.kind,
        releaseAt: v.releaseAt.toISOString(),
      };
    case 'UNAVAILABLE':
      return { status: 'UNAVAILABLE', maxBookableDays: v.maxBookableDays };
  }
}

/**
 * États du paiement rendus au site (PROPOSÉS, ADR-142) :
 * - `PAYABLE` : hold vivant, aucun ordre ; `DECLINED` : hold vivant, dernier ordre refusé ;
 * - `VERIFYING` : ordre en cours ou paiement reçu en attente de preuve (« Pago en verificación ») ;
 * - `INTERRUPTED` : hold en vol dont l'ordre n'a jamais été enregistré (T1 passée, PSP sans réponse
 *   ou en échec avant T2 : opération `PENDING`, donc sans référence) ; le voyageur peut reprendre :
 *   la reprise repasse par T1 (`RETRY_SAME_KEY`) et cherche d'abord l'ordre par NOTRE clé, jamais un
 *   second ordre (N-108) ;
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
  'INTERRUPTED',
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
  /**
   * Demande à l'hôte (US-223c, ADR-146) : état et heure limite de réponse. Champ absent pour une
   * réservation immédiate (forme de 223b inchangée), jamais `null`. Lu par les écrans de la partie
   * 223c-écrans.
   */
  readonly request?: { readonly status: RequestStatus; readonly respondBy: string | null };
  /**
   * Caution (US-701) : champ absent tant qu'elle n'est ni figée ni évaluable (paiement terminé sans
   * décision, devis indisponible).
   */
  readonly deposit?: CheckoutDepositView;
}

/**
 * États d'une demande terminée sans débit (US-223c) : refusée, expirée, capture refusée à
 * l'acceptation, sortie avant l'envoi ; l'autorisation est annulée par VOID total (jamais capturée).
 */
const REQUEST_ENDED: ReadonlySet<RequestStatus> = new Set<RequestStatus>([
  'DECLINED',
  'EXPIRED',
  'CAPTURE_FAILED',
  'ENDED',
]);

export interface CheckoutPaymentStarted extends CheckoutPayment {
  /** Page hébergée du PSP ; `null` : aucun ordre créé par cet appel (voir `state`). */
  readonly redirectUrl: string | null;
}

/** État du paiement d'une lecture de la base (fonction pure, prouvée par les unitaires). */
export function paymentStateOf(row: CheckoutPaymentRow): PaymentState {
  const failed = row.operationStatus === 'FAILED';
  // US-223c : demande terminée sans capture (autorisation annulée, aucun débit)
  if (row.request !== null && REQUEST_ENDED.has(row.request.status)) return 'ENDED';
  switch (row.holdStatus) {
    // US-223c : autorisation prouvée, la demande attend l'hôte (aucun nouveau paiement ; état
    // dédié des écrans : partie 223c-écrans, ADR-146)
    case 'AWAITING_HOST':
      return 'VERIFYING';
    case 'CONVERTED':
      // jamais « confirmé » sans trip (incohérence : on attend, fail-closed)
      return row.tripId === null ? 'VERIFYING' : 'CONFIRMED';
    case 'PAYMENT_IN_FLIGHT':
      // PENDING = T2 jamais passée : aucun ordre enregistré, reprise possible par la clé
      return row.operationStatus === 'PENDING' ? 'INTERRUPTED' : 'VERIFYING';
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

/** États où un paiement est possible : la caution y est évaluée (sans écriture) pour S05. */
const PAYABLE_STATES: ReadonlySet<PaymentState> = new Set<PaymentState>([
  'PAYABLE',
  'DECLINED',
  'INTERRUPTED',
]);

const viewOf = (holdId: string, row: CheckoutPaymentRow): CheckoutPayment => ({
  holdId,
  state: paymentStateOf(row),
  holdStatus: row.holdStatus,
  tripId: row.tripId,
  expiresAt: row.expiresAt,
  paymentInFlightUntil: row.paymentInFlightUntil,
  ...(row.request === null ? {} : { request: row.request }),
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

export type PaymentOperation =
  'read' | 'start' | 'provider' | 'lookup' | 'psp' | 'record' | 'deposit';

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
    /** Porte de la caution (US-701) ; sans base, elle échoue (503), jamais un paiement sans elle. */
    private readonly deposits: DepositGatePort,
    private readonly logFailure: PaymentFailureLog = LOG_PAYMENT_FAILURE,
  ) {}

  /** État du paiement du hold du voyageur de la session ; inconnu ou d'un autre ⇒ 404. */
  async payment(proof: Buffer, holdId: string): Promise<CheckoutPayment> {
    if (!isUuid(holdId)) throw new PaymentHttpError('HOLD_NOT_FOUND');
    const id = holdId.toLowerCase();
    return this.#withDeposit(proof, viewOf(id, await this.#read(proof, id)));
  }

  /**
   * Vue de la caution ajoutée à l'état : décision figée, ou évaluée SANS écriture tant qu'un
   * paiement est possible (S05 l'affiche avant le paiement, 08 BR-PAY-06).
   */
  async #withDeposit<T extends CheckoutPayment>(proof: Buffer, view: T): Promise<T> {
    const evaluate = PAYABLE_STATES.has(view.state);
    const deposit = await this.#guard('deposit', () =>
      this.deposits.view(proof, view.holdId, evaluate),
    );
    if (deposit === 'AUTH_REQUIRED' || deposit === 'HOLD_NOT_FOUND') {
      throw new PaymentHttpError(deposit);
    }
    return deposit === null ? view : { ...view, deposit: depositViewOf(deposit) };
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
    // INTERRUPTED : T1 rend RETRY_SAME_KEY (recherche par clé puis même clé) ou un état à vérifier
    if (
      before.state !== 'PAYABLE' &&
      before.state !== 'DECLINED' &&
      before.state !== 'INTERRUPTED'
    ) {
      const view = await this.#withDeposit(proof, before);
      return { created: false, payment: { ...view, redirectUrl: null } };
    }
    // US-701 : caution décidée AVANT le paiement ; refus sans écriture ni ordre (08 BR-PAY-06)
    const gate = await this.#guard('deposit', () => this.deposits.enforce(proof, id));
    switch (gate.kind) {
      case 'ACCEPTED':
        break;
      case 'REFUSED':
        throw new PaymentHttpError(
          gate.view.code === 'PARAM_MISSING' ? 'DEPOSIT_PARAM_MISSING' : 'DEPOSIT_RAIL_UNAVAILABLE',
        );
      case 'HOLD_NOT_PAYABLE':
        // hold devenu terminal entre la lecture et la décision : l'état fait foi
        return this.#current(proof, id, null);
      default:
        throw new PaymentHttpError(gate.kind);
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
        // US-223c : MANUAL pour une demande (autorisation ; capture par l'hôte à l'acceptation)
        capture: start.capture,
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
    const view = await this.#withDeposit(proof, viewOf(holdId, await this.#read(proof, holdId)));
    // une redirection n'a de sens que tant que le paiement est en cours
    const url = view.state === 'VERIFYING' || view.state === 'INTERRUPTED' ? redirectUrl : null;
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
