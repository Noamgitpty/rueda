/**
 * PSP simulé, déterministe (US-019 ; 17 §2.8, §6.5 point 5 ; ADR-032).
 *
 * - **Mode normal** : ordres sur page hébergée, capture, annulation d'autorisation, remboursement,
 *   réaffectation, rollback, débit MIT, réautorisation, lecture d'état ; webhooks signés.
 * - **Mode hostile** (scénario déclaré par le test) : délais dépassés avant ou après succès,
 *   réponses illisibles, panne, refus reçus (dont « ne pas réessayer »), webhooks en double, hors
 *   d'ordre, retardés, perdus (Yappy), rejoués ; idempotence ignorée (second débit sur la même
 *   clé) ; `cancelOrder` répondant « déjà annulé » ou « déjà payé » ; lien réutilisable payé deux
 *   fois ; ordres à durée de vie (`ORDER_TTL_SECONDS`, Yappy 300 s) ; capacités absentes.
 *
 * Contrôles du PSP simulé : Σ jambes = montant et jambes ≥ 0 (réaffectation : Σ = 0), sinon
 * `INVALID_LEGS` sans mouvement ; capacité absente ⇒ `UNSUPPORTED` sans mouvement ; même clé et
 * contenu différent ⇒ `IDEMPOTENCY_CONFLICT` ; même clé et même contenu ⇒ même résultat, sans
 * nouveau mouvement (sauf `ignoreIdempotency`).
 *
 * Identifiants déterministes (`fk_tx_000001`, `fk_evt_000001`) : deux exécutions du même test
 * donnent les mêmes références. Refuse de se construire hors `development` / `test` (C19).
 */
import { assertFakeAllowed } from '../guard.ts';
import { FAKE_SIGNATURE_HEADER } from '../core/webhook.ts';
import { fakeSignature } from './signature.ts';
import { FAKE_LEGS, FAKE_OPERATIONS } from './types.ts';
import type {
  FakeCapability,
  FakeCreateOrderRequest,
  FakeLegAmounts,
  FakeLookup,
  FakeMitRequest,
  FakeMoneyRequest,
  FakeMovement,
  FakeOperation,
  FakePspOptions,
  FakePspScenario,
  FakeReallocateRequest,
  FakeReferenceRequest,
  FakeResponse,
  FakeTransaction,
  FakeTxStatus,
  FakeWebhookDelivery,
} from './types.ts';

export type FakePspErrorKind =
  | 'DECLINED'
  | 'TIMEOUT'
  | 'UNREADABLE'
  | 'UNAVAILABLE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'UNSUPPORTED'
  | 'NOT_FOUND'
  | 'INVALID_LEGS'
  | 'INVALID_REQUEST'
  | 'ORDER_EXPIRED'
  | 'ALREADY_CANCELLED'
  | 'ALREADY_PAID';

export class FakePspError extends Error {
  override readonly name = 'FakePspError';
  readonly kind: FakePspErrorKind;
  readonly declineCode: string | null;
  readonly doNotRetry: boolean;
  constructor(kind: FakePspErrorKind, message: string, declineCode?: string, doNotRetry = false) {
    super(message);
    this.kind = kind;
    this.declineCode = declineCode ?? null;
    this.doNotRetry = doNotRetry;
  }
}

/** Statut normalisé porté par le corps des webhooks simulés. */
export type FakeWebhookStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

interface PendingWebhook {
  readonly eventId: string;
  readonly body: string;
  readonly deliverAtMs: number;
}

interface KeyRecord {
  readonly fingerprint: string;
  readonly reference: string | null;
  readonly error: FakePspError | null;
}

type MutableTx = { -readonly [K in keyof FakeTransaction]: FakeTransaction[K] };

const VALIDATED = new Set(['VALIDATED_SANDBOX', 'VALIDATED_CONTRACT']);

const pad = (n: number): string => String(n).padStart(6, '0');

export class FakePsp {
  readonly #secret: string;
  readonly #clock: () => number;
  readonly #capabilities: readonly FakeCapability[];
  readonly #scenario: FakePspScenario;
  readonly #responses = new Map<FakeOperation, FakeResponse[]>();
  readonly #transactions = new Map<string, MutableTx>();
  readonly #keys = new Map<string, KeyRecord>();
  readonly #movements: FakeMovement[] = [];
  readonly #pending: PendingWebhook[] = [];
  readonly #emitted = new Map<string, string>();
  readonly #calls = new Map<FakeOperation, number>();
  #txSeq = 0;
  #eventSeq = 0;

  constructor(options: FakePspOptions) {
    assertFakeAllowed('FakePsp', options.env);
    this.#secret = options.secret;
    this.#clock = options.clock;
    this.#capabilities = options.capabilities;
    this.#scenario = options.scenario ?? {};
    for (const op of FAKE_OPERATIONS) {
      this.#responses.set(op, [...(this.#scenario.responses?.[op] ?? [])]);
      this.#calls.set(op, 0);
    }
  }

  // --- capacités simulées (inconnue = non, 17 §2.8) -------------------------------------------

  /** Valeur d'une capacité pour un moyen ; seule une ligne `VALIDATED_*` compte. */
  capability(name: string, method: string): boolean | number | string | null {
    const rows = this.#capabilities.filter((c) => c.capability === name && VALIDATED.has(c.status));
    const row = rows.find((c) => c.method === method) ?? rows.find((c) => c.method === '*');
    return row === undefined ? null : row.value;
  }

  supports(name: string, method: string): boolean {
    return this.capability(name, method) === true;
  }

  #intCapability(name: string, method: string): number {
    const v = this.capability(name, method);
    return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0;
  }

  // --- API du PSP --------------------------------------------------------------------------------

  createOrder(req: FakeCreateOrderRequest): FakeTransaction {
    return this.#execute('CREATE_ORDER', req.merchantReference, req, () => {
      this.#checkLegs(req.amountMinor, req.legs, false);
      if (req.capture === 'MANUAL') this.#require('SUPPORTS_PREAUTH', req.method);
      const ttl = this.#intCapability('ORDER_TTL_SECONDS', req.method);
      const now = this.#clock();
      return () => {
        const tx = this.#newTx({
          merchantReference: req.merchantReference,
          operation: 'CREATE_ORDER',
          method: req.method,
          amountMinor: req.amountMinor,
          currency: req.currency,
          legs: req.legs,
          parentReference: null,
          captureMode: req.capture,
          expiresAtMs: ttl > 0 ? now + ttl * 1000 : null,
          status: 'CREATED',
        });
        this.#emit('order.created', tx, 'PENDING');
        return tx;
      };
    });
  }

  cancelOrder(req: FakeReferenceRequest): FakeTransaction {
    const order = this.#order(req.reference);
    return this.#execute('CANCEL_ORDER', req.merchantReference, req, (response) => {
      this.#require('SUPPORTS_ORDER_CANCEL', order.method);
      if (response?.kind === 'ALREADY_CANCELLED' || order.status === 'CANCELLED') {
        throw new FakePspError('ALREADY_CANCELLED', `ordre ${order.reference} déjà annulé`);
      }
      if (response?.kind === 'ALREADY_PAID' || order.paidCount > 0) {
        throw new FakePspError('ALREADY_PAID', `ordre ${order.reference} déjà payé`);
      }
      if (order.status !== 'CREATED') {
        throw new FakePspError('INVALID_REQUEST', `ordre ${order.reference} : ${order.status}`);
      }
      return () => {
        order.status = 'CANCELLED';
        this.#emit('order.cancelled', order, 'FAILED');
        return this.#childTx('CANCEL_ORDER', req.merchantReference, order, 0n, null);
      };
    });
  }

  capture(req: FakeMoneyRequest): FakeTransaction {
    const order = this.#order(req.reference);
    return this.#execute('CAPTURE', req.merchantReference, req, () => {
      this.#checkLegs(req.amountMinor, req.legs, false);
      this.#checkCurrency(order, req.currency);
      if (order.status !== 'AUTHORIZED' || order.voided) {
        throw new FakePspError('INVALID_REQUEST', `capture impossible : ${order.status}`);
      }
      const remaining = order.amountMinor - order.capturedMinor;
      if (req.amountMinor > remaining) {
        throw new FakePspError('INVALID_REQUEST', 'capture au-delà de l’autorisation');
      }
      if (req.amountMinor < order.amountMinor) {
        this.#require('SUPPORTS_PARTIAL_CAPTURE', order.method);
      }
      return () => {
        order.capturedMinor += req.amountMinor;
        const tx = this.#childTx(
          'CAPTURE',
          req.merchantReference,
          order,
          req.amountMinor,
          req.legs,
        );
        this.#move(tx);
        this.#emit('payment.captured', tx, 'SUCCEEDED');
        return tx;
      };
    });
  }

  void(req: FakeReferenceRequest): FakeTransaction {
    const order = this.#order(req.reference);
    return this.#execute('VOID', req.merchantReference, req, () => {
      this.#require('SUPPORTS_VOID', order.method);
      if (order.status !== 'AUTHORIZED' || order.capturedMinor > 0n || order.voided) {
        throw new FakePspError('INVALID_REQUEST', `annulation impossible : ${order.status}`);
      }
      return () => {
        order.voided = true;
        const tx = this.#childTx('VOID', req.merchantReference, order, 0n, null);
        this.#emit('payment.voided', tx, 'SUCCEEDED');
        return tx;
      };
    });
  }

  refund(req: FakeMoneyRequest): FakeTransaction {
    const parent = this.#tx(req.reference);
    return this.#execute('REFUND', req.merchantReference, req, () => {
      this.#checkLegs(req.amountMinor, req.legs, false);
      this.#checkCurrency(parent, req.currency);
      this.#require('SUPPORTS_REFUND', parent.method);
      const collected = this.#collected(parent);
      if (req.amountMinor > collected - parent.refundedMinor) {
        throw new FakePspError('INVALID_REQUEST', 'remboursement au-delà de l’encaissé');
      }
      if (req.amountMinor < collected) this.#require('SUPPORTS_PARTIAL_REFUND', parent.method);
      return () => {
        parent.refundedMinor += req.amountMinor;
        const tx = this.#childTx(
          'REFUND',
          req.merchantReference,
          parent,
          req.amountMinor,
          req.legs,
        );
        this.#move(tx);
        this.#emit('refund.succeeded', tx, 'SUCCEEDED');
        return tx;
      };
    });
  }

  reallocate(req: FakeReallocateRequest): FakeTransaction {
    const parent = this.#tx(req.reference);
    return this.#execute('REALLOCATE', req.merchantReference, req, () => {
      this.#checkLegs(0n, req.legs, true);
      this.#checkCurrency(parent, req.currency);
      this.#require('SUPPORTS_PAYOUT_ADJUSTMENT', parent.method);
      const moved = FAKE_LEGS.reduce((s, l) => (req.legs[l] > 0n ? s + req.legs[l] : s), 0n);
      return () => {
        const tx = this.#childTx('REALLOCATE', req.merchantReference, parent, moved, req.legs);
        this.#move(tx);
        this.#emit('legs.reallocated', tx, 'SUCCEEDED');
        return tx;
      };
    });
  }

  rollback(req: FakeMoneyRequest): FakeTransaction {
    const parent = this.#tx(req.reference);
    return this.#execute('ROLLBACK', req.merchantReference, req, () => {
      this.#checkLegs(req.amountMinor, req.legs, false);
      this.#checkCurrency(parent, req.currency);
      const windowH = this.#intCapability('ROLLBACK_WINDOW_HOURS', parent.method);
      if (windowH === 0) {
        throw new FakePspError('UNSUPPORTED', 'ROLLBACK_WINDOW_HOURS inconnue : rail interdit');
      }
      if (this.#clock() > parent.createdAtMs + windowH * 3_600_000) {
        throw new FakePspError('INVALID_REQUEST', 'fenêtre de rollback dépassée');
      }
      if (req.amountMinor !== this.#collected(parent) - parent.refundedMinor) {
        throw new FakePspError('INVALID_REQUEST', 'un rollback annule le débit en entier');
      }
      return () => {
        parent.refundedMinor += req.amountMinor;
        const tx = this.#childTx(
          'ROLLBACK',
          req.merchantReference,
          parent,
          req.amountMinor,
          req.legs,
        );
        this.#move(tx);
        this.#emit('payment.rolled_back', tx, 'SUCCEEDED');
        return tx;
      };
    });
  }

  chargeMit(req: FakeMitRequest): FakeTransaction {
    return this.#execute('MIT_CHARGE', req.merchantReference, req, () => {
      this.#checkLegs(req.amountMinor, req.legs, false);
      this.#require('SUPPORTS_MIT', 'CARD');
      if (req.instrumentToken === '') {
        throw new FakePspError('INVALID_REQUEST', 'jeton d’instrument absent');
      }
      return () => {
        const tx = this.#newTx({
          merchantReference: req.merchantReference,
          operation: 'MIT_CHARGE',
          method: 'CARD',
          amountMinor: req.amountMinor,
          currency: req.currency,
          legs: req.legs,
          parentReference: null,
          captureMode: 'AUTO',
          expiresAtMs: null,
          status: 'SUCCEEDED',
        });
        tx.capturedMinor = req.amountMinor;
        this.#move(tx);
        this.#emit('payment.captured', tx, 'SUCCEEDED');
        return tx;
      };
    });
  }

  reauthorize(req: FakeReferenceRequest): FakeTransaction {
    const order = this.#order(req.reference);
    return this.#execute('REAUTHORIZE', req.merchantReference, req, () => {
      this.#require('SUPPORTS_REAUTH', order.method);
      if (order.status !== 'AUTHORIZED' || order.voided) {
        throw new FakePspError('INVALID_REQUEST', `réautorisation impossible : ${order.status}`);
      }
      return () => {
        const tx = this.#childTx('REAUTHORIZE', req.merchantReference, order, 0n, null);
        this.#emit('payment.reauthorized', tx, 'SUCCEEDED');
        return tx;
      };
    });
  }

  /**
   * État faisant foi (17 §2.8 `getOperation`). Par clé du marchand seulement si
   * `SUPPORTS_LOOKUP_BY_MERCHANT_REF` est validée, sinon par référence du PSP.
   */
  lookup(query: FakeLookup): FakeTransaction | null {
    this.#calls.set('LOOKUP', (this.#calls.get('LOOKUP') ?? 0) + 1);
    const response = this.#nextResponse('LOOKUP');
    if (response.kind === 'UNAVAILABLE') throw new FakePspError('UNAVAILABLE', 'PSP indisponible');
    if (response.kind === 'TIMEOUT_BEFORE' || response.kind === 'TIMEOUT_AFTER_SUCCESS') {
      throw new FakePspError('TIMEOUT', 'délai dépassé');
    }
    if (query.reference !== undefined) {
      const tx = this.#transactions.get(query.reference);
      return tx === undefined ? null : { ...tx };
    }
    if (query.merchantReference !== undefined) {
      if (!this.supports('SUPPORTS_LOOKUP_BY_MERCHANT_REF', '*')) {
        throw new FakePspError('UNSUPPORTED', 'recherche par clé du marchand non supportée');
      }
      const key = this.#keys.get(query.merchantReference);
      if (key === undefined || key.reference === null) return null;
      const tx = this.#transactions.get(key.reference);
      return tx === undefined ? null : { ...tx };
    }
    throw new FakePspError('INVALID_REQUEST', 'référence ou clé requise');
  }

  // --- actions du client sur la page hébergée --------------------------------------------------

  /** Le client paie l'ordre (page hébergée, 3-D Secure réussi). */
  customerPays(reference: string): FakeTransaction {
    const order = this.#order(reference);
    const now = this.#clock();
    if (order.expiresAtMs !== null && now >= order.expiresAtMs) {
      this.#expire(order);
      throw new FakePspError('ORDER_EXPIRED', `ordre ${reference} expiré`);
    }
    if (order.status === 'CANCELLED' || order.status === 'EXPIRED' || order.status === 'FAILED') {
      throw new FakePspError('INVALID_REQUEST', `ordre ${reference} : ${order.status}`);
    }
    if (order.paidCount > 0) {
      if (this.supports('SUPPORTS_SINGLE_USE_ORDER', order.method)) {
        throw new FakePspError('ALREADY_PAID', `ordre ${reference} déjà payé (usage unique)`);
      }
      // lien réutilisable payé une seconde fois (17 §2.5 étape 4, test C14)
      order.paidCount += 1;
      const second = this.#childTx(
        'CREATE_ORDER',
        `${order.merchantReference}#paid${order.paidCount}`,
        order,
        order.amountMinor,
        order.legs,
      );
      second.status = order.captureMode === 'MANUAL' ? 'AUTHORIZED' : 'SUCCEEDED';
      second.capturedMinor = order.captureMode === 'MANUAL' ? 0n : order.amountMinor;
      if (order.captureMode !== 'MANUAL') this.#move(second);
      this.#emit(
        order.captureMode === 'MANUAL' ? 'payment.authorized' : 'payment.captured',
        second,
        'SUCCEEDED',
      );
      return { ...second };
    }
    order.paidCount = 1;
    if (order.captureMode === 'MANUAL') {
      order.status = 'AUTHORIZED';
      this.#emit('payment.authorized', order, 'SUCCEEDED');
    } else {
      order.status = 'SUCCEEDED';
      order.capturedMinor = order.amountMinor;
      this.#move(order);
      this.#emit('payment.captured', order, 'SUCCEEDED');
    }
    return { ...order };
  }

  /** Le client échoue (refus de la banque, 3-D Secure abandonné). */
  customerDeclines(reference: string, code: string): FakeTransaction {
    const order = this.#order(reference);
    if (order.status !== 'CREATED') {
      throw new FakePspError('INVALID_REQUEST', `ordre ${reference} : ${order.status}`);
    }
    order.status = 'FAILED';
    order.declineCode = code;
    this.#emit('payment.failed', order, 'FAILED');
    return { ...order };
  }

  /** Fait expirer les ordres échus à l'heure simulée (webhook `order.expired`). */
  tick(): void {
    const now = this.#clock();
    for (const tx of this.#transactions.values()) {
      if (
        tx.operation === 'CREATE_ORDER' &&
        tx.status === 'CREATED' &&
        tx.expiresAtMs !== null &&
        now >= tx.expiresAtMs
      ) {
        this.#expire(tx);
      }
    }
  }

  // --- webhooks --------------------------------------------------------------------------------

  /**
   * Webhooks dus à l'heure simulée, signés, selon le scénario (doublons, hors d'ordre, pertes).
   * Chaque appel les retire de la file.
   */
  deliverWebhooks(): FakeWebhookDelivery[] {
    const now = this.#clock();
    const due = this.#pending.filter((w) => w.deliverAtMs <= now);
    for (const w of due) this.#pending.splice(this.#pending.indexOf(w), 1);
    const ordered = this.#scenario.webhooks?.reverse === true ? [...due].reverse() : due;
    const out: FakeWebhookDelivery[] = [];
    const times = this.#scenario.webhooks?.duplicate === true ? 2 : 1;
    for (let i = 0; i < times; i++) {
      for (const w of ordered) out.push(this.#sign(w.eventId, w.body));
    }
    return out;
  }

  /** Rejoue un webhook déjà livré (événement ancien, signé à l'heure courante). */
  replayWebhook(eventId: string): FakeWebhookDelivery {
    const body = this.#emitted.get(eventId);
    if (body === undefined) throw new FakePspError('NOT_FOUND', `événement ${eventId} inconnu`);
    return this.#sign(eventId, body);
  }

  /** Signe un corps arbitraire avec le secret du compte (tests de signature). */
  signRaw(body: string, timestampS: number): string {
    return fakeSignature(this.#secret, timestampS, body);
  }

  // --- inspection (tests) ------------------------------------------------------------------------

  calls(operation: FakeOperation): number {
    return this.#calls.get(operation) ?? 0;
  }

  totalCalls(): number {
    return [...this.#calls.values()].reduce((a, b) => a + b, 0);
  }

  transactions(): FakeTransaction[] {
    return [...this.#transactions.values()].map((t) => ({ ...t }));
  }

  movements(): FakeMovement[] {
    return [...this.#movements];
  }

  pendingWebhookCount(): number {
    return this.#pending.length;
  }

  // --- mécanique interne -----------------------------------------------------------------------

  #nextResponse(op: FakeOperation): FakeResponse {
    return this.#responses.get(op)?.shift() ?? { kind: 'OK' };
  }

  /**
   * Exécute un appel : réponse réseau scriptée, validation (`prepare`), idempotence, refus scripté,
   * effet (`commit`), puis perte éventuelle de la réponse.
   */
  #execute(
    op: Exclude<FakeOperation, 'LOOKUP'>,
    merchantReference: string,
    request: object,
    prepare: (response: FakeResponse | null) => () => MutableTx,
  ): FakeTransaction {
    this.#calls.set(op, (this.#calls.get(op) ?? 0) + 1);
    const response = this.#nextResponse(op);
    if (response.kind === 'UNAVAILABLE') throw new FakePspError('UNAVAILABLE', 'PSP indisponible');
    if (response.kind === 'TIMEOUT_BEFORE') throw new FakePspError('TIMEOUT', 'délai dépassé');
    if (merchantReference === '' || merchantReference.length > 255) {
      throw new FakePspError('INVALID_REQUEST', 'clé d’idempotence invalide');
    }
    const fingerprint = `${op}|${stringify(request)}`;
    const previous = this.#keys.get(merchantReference);
    if (previous !== undefined && this.#scenario.ignoreIdempotency !== true) {
      if (previous.fingerprint !== fingerprint) {
        throw new FakePspError('IDEMPOTENCY_CONFLICT', 'même clé, contenu différent');
      }
      if (previous.error !== null) throw previous.error;
      const tx =
        previous.reference === null ? undefined : this.#transactions.get(previous.reference);
      if (tx === undefined) throw new FakePspError('NOT_FOUND', 'transaction perdue');
      this.#afterSuccess(response);
      return { ...tx };
    }
    const commit = prepare(
      response.kind === 'ALREADY_CANCELLED' || response.kind === 'ALREADY_PAID' ? response : null,
    );
    if (response.kind === 'DECLINE') {
      const error = new FakePspError(
        'DECLINED',
        `refus ${response.code}`,
        response.code,
        response.doNotRetry === true,
      );
      this.#keys.set(merchantReference, { fingerprint, reference: null, error });
      throw error;
    }
    const tx = commit();
    this.#keys.set(merchantReference, { fingerprint, reference: tx.reference, error: null });
    this.#afterSuccess(response);
    return { ...tx };
  }

  #afterSuccess(response: FakeResponse): void {
    if (response.kind === 'TIMEOUT_AFTER_SUCCESS') {
      throw new FakePspError('TIMEOUT', 'délai dépassé après traitement');
    }
    if (response.kind === 'UNREADABLE_AFTER_SUCCESS') {
      throw new FakePspError('UNREADABLE', 'réponse illisible');
    }
  }

  #require(capability: string, method: string): void {
    if (!this.supports(capability, method)) {
      throw new FakePspError('UNSUPPORTED', `${capability} non validée pour ${method}`);
    }
  }

  #checkLegs(amountMinor: bigint, legs: FakeLegAmounts, reallocation: boolean): void {
    let sum = 0n;
    for (const leg of FAKE_LEGS) {
      const v = legs[leg];
      if (typeof v !== 'bigint') throw new FakePspError('INVALID_LEGS', `jambe ${leg} absente`);
      if (!reallocation && v < 0n) throw new FakePspError('INVALID_LEGS', `jambe ${leg} négative`);
      sum += v;
    }
    if (sum !== amountMinor) {
      throw new FakePspError('INVALID_LEGS', `Σ jambes ${sum} ≠ montant ${amountMinor}`);
    }
    if (!reallocation && amountMinor <= 0n) {
      throw new FakePspError('INVALID_REQUEST', 'montant strictement positif attendu');
    }
  }

  #checkCurrency(parent: MutableTx, currency: string): void {
    if (parent.currency !== currency) {
      throw new FakePspError('INVALID_REQUEST', `devise ${currency} ≠ ${parent.currency}`);
    }
  }

  #collected(parent: MutableTx): bigint {
    if (parent.operation === 'CREATE_ORDER' || parent.operation === 'MIT_CHARGE') {
      return parent.capturedMinor;
    }
    if (parent.operation === 'CAPTURE') return parent.amountMinor;
    throw new FakePspError('INVALID_REQUEST', `${parent.operation} n'encaisse rien`);
  }

  #tx(reference: string): MutableTx {
    const tx = this.#transactions.get(reference);
    if (tx === undefined) throw new FakePspError('NOT_FOUND', `transaction ${reference} inconnue`);
    return tx;
  }

  #order(reference: string): MutableTx {
    const tx = this.#tx(reference);
    if (tx.operation !== 'CREATE_ORDER') {
      throw new FakePspError('INVALID_REQUEST', `${reference} n'est pas un ordre`);
    }
    return tx;
  }

  #newTx(init: {
    merchantReference: string;
    operation: FakeTransaction['operation'];
    method: string;
    amountMinor: bigint;
    currency: string;
    legs: FakeLegAmounts | null;
    parentReference: string | null;
    captureMode: FakeTransaction['captureMode'];
    expiresAtMs: number | null;
    status: FakeTxStatus;
  }): MutableTx {
    this.#txSeq += 1;
    const tx: MutableTx = {
      ...init,
      reference: `fk_tx_${pad(this.#txSeq)}`,
      createdAtMs: this.#clock(),
      declineCode: null,
      capturedMinor: 0n,
      refundedMinor: 0n,
      voided: false,
      paidCount: 0,
    };
    this.#transactions.set(tx.reference, tx);
    return tx;
  }

  #childTx(
    operation: FakeTransaction['operation'],
    merchantReference: string,
    parent: MutableTx,
    amountMinor: bigint,
    legs: FakeLegAmounts | null,
  ): MutableTx {
    return this.#newTx({
      merchantReference,
      operation,
      method: parent.method,
      amountMinor,
      currency: parent.currency,
      legs,
      parentReference: parent.reference,
      captureMode: null,
      expiresAtMs: null,
      status: 'SUCCEEDED',
    });
  }

  #move(tx: MutableTx): void {
    this.#movements.push({
      reference: tx.reference,
      merchantReference: tx.merchantReference,
      operation: tx.operation,
      amountMinor: tx.amountMinor,
      legs: tx.legs,
    });
  }

  #expire(order: MutableTx): void {
    if (order.status !== 'CREATED') return;
    order.status = 'EXPIRED';
    this.#emit('order.expired', order, 'FAILED');
  }

  #emit(type: string, tx: MutableTx, status: FakeWebhookStatus): void {
    this.#eventSeq += 1;
    const eventId = `fk_evt_${pad(this.#eventSeq)}`;
    const now = this.#clock();
    const body = JSON.stringify({
      id: eventId,
      type,
      reference: tx.reference,
      merchant_reference: tx.merchantReference,
      status,
      amount_minor: tx.amountMinor.toString(),
      currency: tx.currency,
      method: tx.method,
      occurred_at: new Date(now).toISOString(),
    });
    this.#emitted.set(eventId, body);
    if (this.#scenario.webhooks?.loseMethods?.includes(tx.method) === true) return; // IPN perdu
    this.#pending.push({
      eventId,
      body,
      deliverAtMs: now + (this.#scenario.webhooks?.delayMs ?? 0),
    });
  }

  #sign(eventId: string, body: string): FakeWebhookDelivery {
    const timestampS = Math.floor(this.#clock() / 1000);
    return {
      eventId,
      body,
      headers: {
        'content-type': 'application/json',
        [FAKE_SIGNATURE_HEADER]: fakeSignature(this.#secret, timestampS, body),
      },
    };
  }
}

/** Sérialisation stable d'une requête (empreinte d'idempotence) : `bigint` en texte. */
function stringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'bigint'
      ? `${v}n`
      : v !== null && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
          )
        : v,
  );
}
