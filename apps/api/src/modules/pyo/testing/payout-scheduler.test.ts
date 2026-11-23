/**
 * Ordonnanceur des versements à l'hôte (US-708, ADR-185 ; 19 US-708 critère 3 ; 08 SM-6,
 * BR-PAYOUT-02 ; 17 §2.8 `releaseLeg`, `payout`) : le PSP est le FAKE de `@rueda/fake-adapters`
 * (compteurs d'appels réels), derrière un connecteur de test minimal ; le stockage est une mémoire
 * qui suit les règles de la migration 0165 (clé `release:{trip}:1:HOST:i{n}`, rang suivant après un
 * refus reçu seulement, versement après les libérations, motifs relus à chaque étape).
 *
 * - variante A, interrupteur ouvert (mémoire seulement) : `releaseLeg` émis UNE fois par item, même
 *   après une réponse perdue et des passages répétés (lecture d'abord), puis `payout` une fois ;
 * - `payouts_enabled` = false (motif de la base) : compteur d'appels `payout` et `releaseLeg` du
 *   FAKE à 0 ; variante B sans `funds_holding_enabled` : 0 appel ; aucun connecteur : rien.
 * - US-709 (ADR-187) : lot compensé (créance de la règle 3 bis, TJ18b / TJ18d) ⇒ `adjustPayout` de
 *   la part compensée UNE fois (clé `adjust:{lot}:r1`), avant le `payout` du net ; réponse perdue ⇒
 *   lecture d'abord ; capacité `SUPPORTS_PAYOUT_ADJUSTMENT` absente ⇒ aucun appel (revue). La
 *   mémoire suit la garde de 0167 (aucune émission d'un lot compensé sans ajustement réussi).
 *
 * - US-319 (ADR-200) : part HOST d'un débit post-trip (amende refacturée) dans le lot SUIVANT du
 *   même trip : `releaseLeg` au rang suivant de la jambe HOST du trip (`i2`), au montant explicite
 *   de la part ; registre du FAKE : jambe HOST du trip encaissée (loyer + part) = libérée ;
 *   préparation des parts par la base, refus ⇒ trip différé. La mémoire suit 0180 (rang du trip,
 *   un ordre vivant par item, item libre de même montant).
 *
 * Attendus : jambe HOST des vecteurs TJ01 (USD) et TJ08a (PYG sans décimale) de l'export des
 * oracles Python (`@rueda/money/golden-vectors`) ; amende de 08 BR-TT-03 / BR-REIMB-04 (100 % à
 * l'hôte) et frais de gestion de 5 % (BR-PRICE-15), calculés à la main ; jamais le code testé.
 */
import { FakePsp, FakePspError } from '@rueda/fake-adapters';
import type { FakeCapability, FakeOperation, FakePspScenario } from '@rueda/fake-adapters';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import type { SqlClient, WorkerTransactions } from '../../bus/index.js';
import { CapabilitySet, PaymentError } from '../../pay/index.js';
import type {
  ApplyOutcome,
  AdjustPayoutRequest,
  ApplyStatusInput,
  OperationStatus,
  PaymentConnectorRegistry,
  PaymentProvider,
  PayoutRequest,
  ProviderOperation,
  ReleaseLegRequest,
} from '../../pay/index.js';
import type {
  AdjustmentOrder,
  BatchCheck,
  ChargeToPrepare,
  DueBatch,
  PayoutBatchStore,
  PayoutOrder,
  PrepareResult,
  RecordReleaseInput,
  ReleaseItem,
} from '../internal/payout-batch-store.js';
import { PayoutScheduler } from '../internal/payout-scheduler.js';

const golden = loadGoldenVectors();
const PROVIDER = 'FAKE';

const v = (capability: string, value: boolean | number): FakeCapability => ({
  capability,
  method: '*',
  value,
  status: 'VALIDATED_SANDBOX',
});
const CAPABILITIES: readonly FakeCapability[] = [
  v('SUPPORTS_PER_LEG_AMOUNTS', true),
  v('SUPPORTS_MULTI_LEG_SPLIT', true),
  v('SUPPORTS_DELAYED_PAYOUT_RELEASE', true),
  v('SUPPORTS_B2C_PAYOUT', true),
  v('SUPPORTS_SUBMERCHANT', true),
  v('SUPPORTS_INDIVIDUAL_SUBMERCHANT', true),
  v('SUPPORTS_LOOKUP_BY_MERCHANT_REF', true),
  v('SUPPORTS_IDEMPOTENCY_HEADER', true),
  v('IDEMPOTENCY_KEY_MAX_LEN', 64),
  v('SUPPORTS_PAYOUT_ADJUSTMENT', true),
];

const statusOf = (s: string): OperationStatus =>
  s === 'CREATED' ? 'SUBMITTED' : s === 'SUCCEEDED' || s === 'AUTHORIZED' ? 'SUCCEEDED' : 'FAILED';

function translate(error: unknown): never {
  if (error instanceof FakePspError) {
    if (error.kind === 'TIMEOUT' || error.kind === 'UNREADABLE') {
      throw new PaymentError('UNKNOWN_OUTCOME', error.message);
    }
    if (error.kind === 'UNAVAILABLE') throw new PaymentError('PROVIDER_UNAVAILABLE', error.message);
    if (error.kind === 'DECLINED') throw new PaymentError('DECLINED', error.message);
    throw new PaymentError('INVALID_REQUEST', error.message);
  }
  throw error;
}

/** Connecteur de test minimal : les seules méthodes du versement, sur le FAKE. */
function connectorOf(psp: FakePsp, capabilities = CAPABILITIES): PaymentProvider {
  const caps = new CapabilitySet(capabilities);
  const run = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      return translate(error);
    }
  };
  const impl = {
    provider: PROVIDER,
    capabilities: () => caps,
    releaseLeg: (r: ReleaseLegRequest) =>
      Promise.resolve(
        run(() => {
          const tx = psp.releaseLeg({
            merchantReference: r.idempotencyKey,
            tripReference: r.tripReference,
            leg: r.leg,
            amountMinor: r.amountMinor,
            currency: r.currency,
            beneficiaryReference: r.beneficiaryReference,
          });
          return { providerReference: tx.reference, status: statusOf(tx.status) };
        }),
      ),
    payout: (r: PayoutRequest) =>
      Promise.resolve(
        run(() => {
          const tx = psp.payout({
            merchantReference: r.idempotencyKey,
            submerchantReference: r.submerchantReference,
            amountMinor: r.amountMinor,
            currency: r.currency,
          });
          return { providerReference: tx.reference, status: statusOf(tx.status) };
        }),
      ),
    adjustPayout: (r: AdjustPayoutRequest) =>
      Promise.resolve(
        run(() => {
          const tx = psp.adjustPayout({
            merchantReference: r.idempotencyKey,
            submerchantReference: r.submerchantReference,
            amountMinor: r.amountMinor,
            currency: r.currency,
            reason: r.reason,
          });
          return { providerReference: tx.reference, status: statusOf(tx.status) };
        }),
      ),
    getOperation: (lookup: { merchantReference?: string; providerReference?: string }) =>
      Promise.resolve(
        run((): ProviderOperation | null => {
          const tx = psp.lookup(
            lookup.merchantReference !== undefined
              ? { merchantReference: lookup.merchantReference }
              : { reference: lookup.providerReference ?? '' },
          );
          return tx === null
            ? null
            : {
                providerReference: tx.reference,
                merchantReference: tx.merchantReference,
                status: statusOf(tx.status),
                amountMinor: tx.amountMinor,
                currency: tx.currency,
                legs: null,
              };
        }),
      ),
  };
  return impl as unknown as PaymentProvider;
}

interface Trip {
  readonly id: string;
  readonly host: bigint;
}

/** Mémoire des lots : règles de 0165 (motifs, clé et rang de l'item, versement après libération). */
class MemoryStore implements PayoutBatchStore {
  status = 'SCHEDULED';
  holds: string[] = [];
  attempt = 0;
  key: string | null = null;
  providerRef: string | null = null;
  applied = 0;
  /** Part compensée du lot (dette du host_ledger, 0167) et son ajustement. */
  netted = 0n;
  adjusted: 'SUBMITTED' | 'SUCCEEDED' | 'FAILED' | null = null;
  adjustmentRef: string | null = null;
  readonly items: {
    id: string;
    trip: string;
    amount: bigint;
    attempt: number;
    op: string | null;
    applied: boolean;
  }[];
  readonly ops = new Map<
    string,
    { status: OperationStatus; idemSent: string; idemPlain: string; ref: string | null }
  >();
  /** US-319 : rang le plus haut des libérations HOST du trip faites hors de ce lot (lot précédent). */
  readonly ranks = new Map<string, number>();
  /** US-319 : parts de débits post-trip préparées (issue rendue par la base), trips différés. */
  readonly preparedCharges: string[] = [];
  chargeOutcome: string | Error = 'PREPARED';
  readonly deferred: { trip: string; code: string }[] = [];

  constructor(
    readonly batchId: string,
    readonly currency: string,
    readonly submerchant: string,
    trips: readonly Trip[],
  ) {
    this.items = trips.map((t, i) => ({
      id: `item-${i}`,
      trip: t.id,
      amount: t.host,
      attempt: 0,
      op: null,
      applied: false,
    }));
  }

  get net(): bigint {
    return this.items.reduce((s, i) => s + i.amount, 0n) - this.netted;
  }

  tripsToPrepare(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
  prepareTrip(): Promise<PrepareResult> {
    return Promise.resolve({
      outcome: 'ALREADY_PREPARED',
      batchId: null,
      status: null,
      holdReasons: [],
    });
  }
  deferTrip(trip: string, code: string): Promise<void> {
    this.deferred.push({ trip, code });
    return Promise.resolve();
  }
  chargesToPrepare(): Promise<readonly ChargeToPrepare[]> {
    return Promise.resolve([]);
  }
  prepareCharge(chargeId: string): Promise<PrepareResult> {
    if (this.chargeOutcome instanceof Error) return Promise.reject(this.chargeOutcome);
    this.preparedCharges.push(chargeId);
    return Promise.resolve({
      outcome: this.chargeOutcome,
      batchId: this.batchId,
      status: 'SCHEDULED',
      holdReasons: [],
    });
  }
  /** Rang suivant de la jambe HOST d'un trip (0180) : 1 + plus haut rang déjà utilisé. */
  rank(trip: string): number {
    return (
      1 +
      Math.max(
        this.ranks.get(trip) ?? 0,
        ...this.items.filter((i) => i.trip === trip).map((i) => i.attempt),
      )
    );
  }
  dueBatches(): Promise<readonly DueBatch[]> {
    return Promise.resolve([]);
  }
  netBatch(): Promise<BatchCheck> {
    this.status = this.holds.length > 0 ? 'ON_HOLD' : 'READY';
    return Promise.resolve({ outcome: this.status, holdReasons: [...this.holds] });
  }
  recheckBatch(): Promise<BatchCheck> {
    if (this.status !== 'READY' && this.status !== 'ON_HOLD') {
      return Promise.resolve({ outcome: this.status, holdReasons: [] });
    }
    this.status = this.holds.length > 0 ? 'ON_HOLD' : 'READY';
    return Promise.resolve({ outcome: this.status, holdReasons: [...this.holds] });
  }
  releaseItems(): Promise<readonly ReleaseItem[]> {
    if (this.status !== 'READY') return Promise.resolve([]);
    return Promise.resolve(
      this.items.map((i) => {
        const op = i.op === null ? undefined : this.ops.get(i.op);
        return {
          itemId: i.id,
          tripId: i.trip,
          amountMinor: i.amount,
          currency: this.currency,
          pspAccountId: 'acc',
          nextAttempt: this.rank(i.trip),
          nextKey: `release:${i.trip}:1:HOST:i${this.rank(i.trip)}`,
          operationId: i.op,
          operationStatus: op?.status ?? null,
          idemSent: op?.idemSent ?? null,
          providerReference: op?.ref ?? null,
          applied: i.applied,
          beneficiaryReference: this.submerchant,
        };
      }),
    );
  }
  recordRelease(input: RecordReleaseInput): Promise<string> {
    // garde de 0165 / 0180 : lot READY, item libre du trip de même montant, rang suivant du trip
    const item = this.items.find(
      (i) =>
        i.trip === input.tripId &&
        i.amount === input.amountMinor &&
        (i.op === null || this.ops.get(i.op)?.status === 'FAILED'),
    );
    const n = this.rank(input.tripId);
    if (
      item === undefined ||
      this.status !== 'READY' ||
      input.idemPlain !== `release:${item.trip}:1:HOST:i${n}` ||
      input.attemptNo !== n
    ) {
      throw Object.assign(new Error('payout_release_item_mismatch'), { code: '55000' });
    }
    this.ops.set(input.operationId, {
      status: 'PENDING',
      idemSent: input.idemSent,
      idemPlain: input.idemPlain,
      ref: null,
    });
    item.op = input.operationId;
    item.attempt = n;
    return Promise.resolve(input.operationId);
  }
  applyRelease(operationId: string): Promise<string> {
    const item = this.items.find((i) => i.op === operationId);
    if (item === undefined || this.ops.get(operationId)?.status !== 'SUCCEEDED') {
      throw new Error('report sans preuve');
    }
    item.applied = true;
    this.applied += 1;
    return Promise.resolve('APPLIED');
  }
  adjustment(): Promise<AdjustmentOrder> {
    const order = (outcome: string): AdjustmentOrder => ({
      outcome,
      idempotencyKey: this.adjusted === null ? null : `adjust:${this.batchId}:r1`,
      amountMinor: this.netted,
      currency: this.currency,
      submerchantReference: this.submerchant,
      providerRef: this.adjustmentRef,
      holdReasons: [...this.holds],
    });
    if (this.status !== 'READY') return Promise.resolve(order(this.status));
    if (this.netted === 0n) return Promise.resolve(order('NONE'));
    if (this.adjusted === 'SUCCEEDED') return Promise.resolve(order('DONE'));
    if (this.adjusted === 'FAILED') return Promise.resolve(order('FAILED'));
    if (this.items.some((i) => !i.applied)) return Promise.resolve(order('RELEASE_PENDING'));
    if (this.holds.length > 0) {
      this.status = 'ON_HOLD';
      return Promise.resolve(order('ON_HOLD'));
    }
    if (this.adjusted === 'SUBMITTED') return Promise.resolve(order('REPLAY'));
    this.adjusted = 'SUBMITTED';
    return Promise.resolve(order('ADJUST'));
  }
  recordAdjustment(_b: string, status: OperationStatus, ref: string | null): Promise<string> {
    if (this.adjusted === 'SUBMITTED' && (status === 'SUCCEEDED' || status === 'FAILED')) {
      this.adjusted = status;
      this.adjustmentRef = ref ?? this.adjustmentRef;
    }
    return Promise.resolve(this.adjusted ?? 'NONE');
  }
  initiate(): Promise<PayoutOrder> {
    const order = (outcome: string): PayoutOrder => ({
      outcome,
      idempotencyKey: this.key,
      amountMinor: this.net,
      currency: this.currency,
      submerchantReference: this.submerchant,
      providerRef: this.providerRef,
      holdReasons: [...this.holds],
    });
    if (this.status === 'INITIATED' || this.status === 'IN_TRANSIT') {
      return Promise.resolve(order('REPLAY'));
    }
    if (this.status !== 'READY') return Promise.resolve(order(this.status));
    if (this.items.some((i) => !i.applied)) return Promise.resolve(order('RELEASE_PENDING'));
    if (this.holds.length > 0) {
      this.status = 'ON_HOLD';
      return Promise.resolve(order('ON_HOLD'));
    }
    // garde de 0167 : aucune émission d'un lot compensé sans ajustement réussi
    if (this.netted > 0n && this.adjusted !== 'SUCCEEDED') {
      throw Object.assign(new Error('payout_batch_adjustment_required'), { code: '55000' });
    }
    this.attempt += 1;
    this.key = `payout:${this.batchId}:r${this.attempt}`;
    this.status = 'INITIATED';
    return Promise.resolve(order('INITIATED'));
  }
  recordPayoutResult(_b: string, status: OperationStatus, ref: string | null): Promise<string> {
    if (this.status !== 'INITIATED' && this.status !== 'IN_TRANSIT') {
      return Promise.resolve(this.status);
    }
    if (status === 'UNKNOWN') return Promise.resolve(this.status);
    this.status = status === 'SUCCEEDED' ? 'PAID' : status === 'FAILED' ? 'FAILED' : 'IN_TRANSIT';
    this.providerRef = ref ?? this.providerRef;
    return Promise.resolve(this.status);
  }
  apply(input: ApplyStatusInput): Promise<ApplyOutcome> {
    const op = this.ops.get(input.operationId);
    if (op === undefined) return Promise.resolve('NOT_FOUND');
    if (op.status === 'SUCCEEDED' || op.status === 'FAILED') return Promise.resolve('DUPLICATE');
    op.status = input.status;
    op.ref = input.providerReference ?? op.ref;
    return Promise.resolve('APPLIED');
  }
}

const transactions: WorkerTransactions = {
  run: <T>(_worker: string, fn: (tx: SqlClient) => Promise<T>): Promise<T> =>
    fn({ query: () => Promise.reject(new Error('aucune base')) } as unknown as SqlClient),
};

function rig(
  currency: string,
  hosts: readonly bigint[],
  scenario?: FakePspScenario,
  capabilities: readonly FakeCapability[] = CAPABILITIES,
) {
  let now = Date.parse('2032-01-20T15:00:00.000Z');
  const psp = new FakePsp({
    secret: 'whsec_fake_test_only',
    clock: () => now,
    capabilities,
    ...(scenario !== undefined ? { scenario } : {}),
  });
  const sm = psp.registerSubmerchant({
    merchantReference: 'submerchant:org-1:a1',
    hostReference: 'org-1',
    individual: true,
    country: 'XA',
    payoutCurrency: currency,
  });
  const trips = hosts.map((host, i) => {
    const id = `00000000-0000-4000-8000-00000000000${i}`;
    // encaissement du trip chez le PSP : la jambe HOST y est tenue (08 E7 règle 6)
    const order = psp.createOrder({
      merchantReference: `trip:${id}:CAPTURE:a1`,
      tripReference: id,
      method: 'CARD',
      capture: 'AUTO',
      currency,
      amountMinor: host,
      legs: { HOST: host, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n },
    });
    psp.customerPays(order.reference);
    return { id, host };
  });
  now += 60_000;
  const store = new MemoryStore(
    '11111111-1111-4111-8111-111111111111',
    currency,
    sm.reference,
    trips,
  );
  const connector = connectorOf(psp, capabilities);
  const connectors: PaymentConnectorRegistry = {
    get: (p) => (p === PROVIDER ? connector : undefined),
  };
  let n = 0;
  const scheduler = new PayoutScheduler({
    transactions,
    connectors,
    storeOf: () => store,
    newId: () => `op-${(n += 1)}`,
  });
  const due = (step: DueBatch['step']): DueBatch => ({
    batchId: store.batchId,
    step,
    status: store.status,
    country: 'XA',
    currency,
    provider: PROVIDER,
  });
  const calls = (op: FakeOperation) => psp.calls(op);
  return { psp, store, scheduler, due, calls, trips };
}

const CASES = [
  { vector: 'TJ01', label: 'unités mineures à deux décimales' },
  { vector: 'TJ08a', label: 'devise sans décimale' },
] as const;

describe.each(CASES)('US-708 — ordonnanceur des versements ($label, $vector)', ({ vector }) => {
  const tj = legVector(golden, vector);
  const host = tj.legsMinor.HOST;

  it('variante A : releaseLeg une fois par item (clé release:{trip}:1:HOST:i1), puis payout une fois ; les passages suivants n’appellent plus rien', async () => {
    const r = rig(tj.currency, [host, host]);
    expect(await r.scheduler.process(r.due('NET'))).toBe('NETTED');
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('PAID');
    expect(r.calls('RELEASE_LEG')).toBe(2);
    expect(r.calls('PAYOUT')).toBe(1);
    const releases = r.psp.movements().filter((m) => m.operation === 'RELEASE_LEG');
    expect(releases.map((m) => m.merchantReference).sort()).toEqual(
      r.trips.map((t) => `release:${t.id}:1:HOST:i1`).sort(),
    );
    expect(r.psp.submerchant(r.store.submerchant)?.paidOutMinor).toBe(host * 2n);
    // rejeu du lot (deux travailleurs, outbox) : aucun nouvel appel
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('IDLE');
    expect(await r.scheduler.process(r.due('PAYOUT'))).toBe('IDLE');
    expect(r.calls('RELEASE_LEG')).toBe(2);
    expect(r.calls('PAYOUT')).toBe(1);
  });

  it('réponse perdue (délai dépassé après succès) : lecture d’abord, aucune seconde libération ni second versement (T51)', async () => {
    const r = rig(tj.currency, [host], {
      responses: {
        RELEASE_LEG: [{ kind: 'TIMEOUT_AFTER_SUCCESS' }],
        PAYOUT: [{ kind: 'TIMEOUT_AFTER_SUCCESS' }],
      },
    });
    await r.scheduler.process(r.due('NET'));
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('RELEASING');
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('WAITING');
    expect(r.store.status).toBe('INITIATED');
    expect(await r.scheduler.process(r.due('PAYOUT'))).toBe('PAID');
    expect(r.calls('RELEASE_LEG')).toBe(1);
    expect(r.calls('PAYOUT')).toBe(1);
    expect(r.psp.movements().filter((m) => m.operation === 'RELEASE_LEG')).toHaveLength(1);
    expect(r.store.applied).toBe(1);
  });

  it('arrêt d’urgence : interrupteur fermé APRÈS l’émission (réponse perdue avant le PSP) ⇒ lot relu, jamais renvoyé ; compteur payout du FAKE inchangé', async () => {
    const r = rig(tj.currency, [host], { responses: { PAYOUT: [{ kind: 'TIMEOUT_BEFORE' }] } });
    await r.scheduler.process(r.due('NET'));
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('WAITING');
    expect(r.store.status).toBe('INITIATED');
    const before = r.calls('PAYOUT');
    // l'interrupteur est refermé : la base relit le motif sur le lot émis (REPLAY)
    r.store.holds = ['PAYOUTS_DISABLED'];
    expect(await r.scheduler.process(r.due('PAYOUT'))).toBe('ON_HOLD');
    expect(await r.scheduler.process(r.due('PAYOUT'))).toBe('ON_HOLD');
    expect(r.calls('PAYOUT')).toBe(before);
    expect(r.calls('LOOKUP')).toBeGreaterThan(0);
    expect(r.psp.submerchant(r.store.submerchant)?.paidOutMinor).toBe(0n);
    // rouvert : la même clé part, une fois
    r.store.holds = [];
    expect(await r.scheduler.process(r.due('PAYOUT'))).toBe('PAID');
    expect(r.calls('PAYOUT')).toBe(before + 1);
    expect(r.psp.submerchant(r.store.submerchant)?.paidOutMinor).toBe(host);
  });

  it('RT-L3-V01 : payouts_enabled = false (motif lu par la base) ⇒ lot ON_HOLD, compteur d’appels payout et releaseLeg du FAKE = 0', async () => {
    const r = rig(tj.currency, [host]);
    r.store.holds = ['PAYOUTS_DISABLED'];
    expect(await r.scheduler.process(r.due('NET'))).toBe('ON_HOLD');
    // envoi direct, même sur un lot qu'on prétendrait prêt : motifs relus avant tout appel
    r.store.status = 'READY';
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('ON_HOLD');
    expect(await r.scheduler.process(r.due('PAYOUT'))).toBe('ON_HOLD');
    expect(r.calls('RELEASE_LEG')).toBe(0);
    expect(r.calls('PAYOUT')).toBe(0);
    expect(r.store.ops.size).toBe(0);
  });

  it('RT-L3-V02 : variante B sans funds_holding_enabled ⇒ refus avant tout appel', async () => {
    const r = rig(tj.currency, [host]);
    r.store.holds = ['FUNDS_HOLDING_DISABLED', 'VARIANT_B_UNAVAILABLE'];
    expect(await r.scheduler.process(r.due('NET'))).toBe('ON_HOLD');
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('ON_HOLD');
    expect(r.calls('RELEASE_LEG') + r.calls('PAYOUT') + r.calls('LOOKUP')).toBe(0);
  });

  it('gel posé entre la compensation et l’envoi (chargeback) : relu à l’envoi, aucun appel', async () => {
    const r = rig(tj.currency, [host]);
    expect(await r.scheduler.process(r.due('NET'))).toBe('NETTED');
    r.store.holds = ['CHARGEBACK'];
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('ON_HOLD');
    expect(r.calls('RELEASE_LEG')).toBe(0);
  });

  it('aucun connecteur pour le fournisseur (production avant le lot C) : rien n’est lu ni envoyé', async () => {
    const r = rig(tj.currency, [host]);
    await r.scheduler.process(r.due('NET'));
    expect(await r.scheduler.process({ ...r.due('RELEASE'), provider: 'TILOPAY' })).toBe(
      'NO_CONNECTOR',
    );
    expect(r.calls('RELEASE_LEG') + r.calls('PAYOUT')).toBe(0);
    expect(r.store.status).toBe('READY');
  });
});

/**
 * US-709 (ADR-187 ; 08 E7 règle 7 ; SM-6b) : la créance de la règle 3 bis de l'hôte (08 TJ18b :
 * « créance de 75,00 au host_ledger[hôte][USD] » ; TJ18d : « créance de 518 750 au
 * host_ledger[hôte][PYG] ») est compensée sur le lot suivant (jambe HOST de TJ01 / TJ08a).
 */
const CLAIMS = [
  { vector: 'TJ01', claim: 7500n, label: 'TJ18b, deux décimales' },
  { vector: 'TJ08a', claim: 518_750n, label: 'TJ18d, sans décimale' },
] as const;

describe.each(CLAIMS)('US-709 — ajustement de la part compensée ($label)', ({ vector, claim }) => {
  const tj = legVector(golden, vector);
  const host = tj.legsMinor.HOST;

  it('lot compensé : adjustPayout de la part compensée une fois (adjust:{lot}:r1), puis payout du net une fois ; aucun rappel ensuite', async () => {
    const r = rig(tj.currency, [host]);
    r.store.netted = claim;
    expect(await r.scheduler.process(r.due('NET'))).toBe('NETTED');
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('PAID');
    expect(r.calls('ADJUST_PAYOUT')).toBe(1);
    expect(r.calls('PAYOUT')).toBe(1);
    expect(r.psp.lookup({ merchantReference: `adjust:${r.store.batchId}:r1` })?.amountMinor).toBe(
      claim,
    );
    const sm = r.psp.submerchant(r.store.submerchant);
    expect(sm?.adjustedMinor).toBe(claim);
    expect(sm?.paidOutMinor).toBe(host - claim);
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('IDLE');
    expect(await r.scheduler.process(r.due('PAYOUT'))).toBe('IDLE');
    expect(r.calls('ADJUST_PAYOUT')).toBe(1);
    expect(r.calls('PAYOUT')).toBe(1);
  });

  it('réponse perdue après l’ajustement : lecture d’abord, aucun second ajustement ; le versement part une fois', async () => {
    const r = rig(tj.currency, [host], {
      responses: { ADJUST_PAYOUT: [{ kind: 'TIMEOUT_AFTER_SUCCESS' }] },
    });
    r.store.netted = claim;
    await r.scheduler.process(r.due('NET'));
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('WAITING');
    expect(r.store.adjusted).toBe('SUBMITTED');
    expect(r.calls('PAYOUT')).toBe(0);
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('PAID');
    expect(r.calls('ADJUST_PAYOUT')).toBe(1);
    expect(r.calls('PAYOUT')).toBe(1);
    expect(r.psp.submerchant(r.store.submerchant)?.adjustedMinor).toBe(claim);
  });

  it('SUPPORTS_PAYOUT_ADJUSTMENT absente (inconnue = non) : aucun ajustement ni versement, revue', async () => {
    const r = rig(
      tj.currency,
      [host],
      undefined,
      CAPABILITIES.filter((c) => c.capability !== 'SUPPORTS_PAYOUT_ADJUSTMENT'),
    );
    r.store.netted = claim;
    await r.scheduler.process(r.due('NET'));
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('ATTENTION');
    expect(r.calls('ADJUST_PAYOUT') + r.calls('PAYOUT')).toBe(0);
    expect(r.store.status).toBe('READY');
  });

  it('ajustement refusé par le PSP : jamais renvoyé, aucun versement (revue FIN)', async () => {
    const r = rig(tj.currency, [host], {
      responses: { ADJUST_PAYOUT: [{ kind: 'DECLINE', code: 'do_not_honor' }] },
    });
    r.store.netted = claim;
    await r.scheduler.process(r.due('NET'));
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('ATTENTION');
    expect(await r.scheduler.process(r.due('RELEASE'))).toBe('ATTENTION');
    expect(r.calls('ADJUST_PAYOUT')).toBe(1);
    expect(r.calls('PAYOUT')).toBe(0);
    expect(r.store.adjusted).toBe('FAILED');
  });
});

/**
 * Amende refacturée (08 BR-TT-03, BR-REIMB-04 : 100 % à l'hôte ; BR-PRICE-15 : 5 %, à la main), par
 * vecteur du loyer : 12,30 à deux décimales (frais 0,62) ; 25 010 sans décimale (frais 1 251).
 */
const FINES: Readonly<Record<string, { host: bigint; fee: bigint }>> = {
  TJ01: { host: 1230n, fee: 62n },
  TJ08a: { host: 25010n, fee: 1251n },
};

describe.each(CASES)(
  'US-319 — part HOST d’un débit post-trip versée ($label, $vector)',
  ({ vector }) => {
    const tj = legVector(golden, vector);
    const host = tj.legsMinor.HOST;
    const fine = FINES[vector] ?? { host: 0n, fee: 0n };

    it('lot du trip (i1) puis lot suivant de la part (i2, montant explicite) ; registre du FAKE : jambe HOST du trip encaissée = libérée, payout = loyer + part', async () => {
      const caps = [...CAPABILITIES, v('SUPPORTS_MIT', true)];
      const r = rig(tj.currency, [host], undefined, caps);
      const trip = r.trips[0]?.id ?? '';
      expect(await r.scheduler.process(r.due('NET'))).toBe('NETTED');
      expect(await r.scheduler.process(r.due('RELEASE'))).toBe('PAID');
      // débit MIT de l'amende, réparti à la source sur les jambes du trip (aucun fonds détenu)
      r.psp.chargeMit({
        merchantReference: `${trip}:1:v0-TRAFFIC_CHARGE-x:MIT_CHARGE:t:i1:a1`,
        tripReference: trip,
        instrumentToken: 'tok_us319',
        reason: 'DELAYED_CHARGES',
        amountMinor: fine.host + fine.fee,
        currency: tj.currency,
        legs: { HOST: fine.host, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: fine.fee },
      });
      // lot suivant : un item de débits post-trip du même trip, rang suivant de sa jambe HOST
      const next = new MemoryStore(
        '22222222-2222-4222-8222-222222222222',
        tj.currency,
        r.store.submerchant,
        [{ id: trip, host: fine.host }],
      );
      next.ranks.set(trip, 1);
      let n = 100;
      const connector = connectorOf(r.psp, caps);
      const scheduler = new PayoutScheduler({
        transactions,
        connectors: { get: (p) => (p === PROVIDER ? connector : undefined) },
        storeOf: () => next,
        newId: () => `op-${(n += 1)}`,
      });
      const due = (step: DueBatch['step']): DueBatch => ({
        batchId: next.batchId,
        step,
        status: next.status,
        country: 'XA',
        currency: tj.currency,
        provider: PROVIDER,
      });
      expect(await scheduler.process(due('NET'))).toBe('NETTED');
      expect(await scheduler.process(due('RELEASE'))).toBe('PAID');
      const releases = r.psp.movements().filter((m) => m.operation === 'RELEASE_LEG');
      expect(releases.map((m) => [m.merchantReference, m.amountMinor])).toEqual([
        [`release:${trip}:1:HOST:i1`, host],
        [`release:${trip}:1:HOST:i2`, fine.host],
      ]);
      const legs = r.psp.listLegBalances({ tripReference: trip });
      const hostLeg = legs.find((l) => l.leg === 'HOST');
      expect(hostLeg?.capturedMinor).toBe(host + fine.host);
      expect(hostLeg?.releasedMinor).toBe(host + fine.host);
      const platform = legs.find((l) => l.leg === 'PLATFORM');
      expect(platform?.capturedMinor).toBe(fine.fee);
      expect(platform?.releasedMinor).toBe(0n);
      expect(r.psp.submerchant(r.store.submerchant)?.paidOutMinor).toBe(host + fine.host);
      expect(r.calls('PAYOUT')).toBe(2);
      // rejeu : aucun nouvel appel
      expect(await scheduler.process(due('RELEASE'))).toBe('IDLE');
      expect(r.calls('RELEASE_LEG')).toBe(2);
    });

    it('préparation d’une part : issue de la base rendue ; refus de la base ⇒ trip différé avec le seul code', async () => {
      const r = rig(tj.currency, [host]);
      const charge = { chargeId: 'charge-1', tripId: r.trips[0]?.id ?? '' };
      expect(await r.scheduler.prepareCharge(charge)).toBe('PREPARED');
      expect(r.store.preparedCharges).toEqual(['charge-1']);
      r.store.chargeOutcome = 'TRIP_NOT_NETTED';
      expect(await r.scheduler.prepareCharge(charge)).toBe('TRIP_NOT_NETTED');
      r.store.chargeOutcome = Object.assign(new Error('payout_item_charge_mismatch'), {
        code: '23000',
        constraint: 'payout_item_charge_mismatch',
      });
      expect(await r.scheduler.prepareCharge(charge)).toBe('ERROR');
      expect(r.store.deferred).toEqual([{ trip: charge.tripId, code: expect.any(String) }]);
    });
  },
);
