/**
 * Ordonnanceur des versements à l'hôte (US-708, ADR-185 ; 19 US-708 critère 3 ; 08 SM-6,
 * BR-PAYOUT-02 ; 17 §2.8 `releaseLeg`, `payout`) : le PSP est le FAKE de `@rueda/fake-adapters`
 * (compteurs d'appels réels), derrière un connecteur de test minimal ; le stockage est une mémoire
 * qui suit les règles de la migration 0166 (clé `release:{trip}:1:HOST:i{n}`, rang suivant après un
 * refus reçu seulement, versement après les libérations, motifs relus à chaque étape).
 *
 * - variante A, interrupteur ouvert (mémoire seulement) : `releaseLeg` émis UNE fois par item, même
 *   après une réponse perdue et des passages répétés (lecture d'abord), puis `payout` une fois ;
 * - `payouts_enabled` = false (motif de la base) : compteur d'appels `payout` et `releaseLeg` du
 *   FAKE à 0 ; variante B sans `funds_holding_enabled` : 0 appel ; aucun connecteur : rien.
 *
 * Attendus : jambe HOST des vecteurs TJ01 (USD) et TJ08a (PYG sans décimale) de l'export des
 * oracles Python (`@rueda/money/golden-vectors`) ; jamais le code testé.
 */
import { FakePsp, FakePspError } from '@rueda/fake-adapters';
import type { FakeCapability, FakeOperation, FakePspScenario } from '@rueda/fake-adapters';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import type { SqlClient, WorkerTransactions } from '../../bus/index.js';
import { CapabilitySet, PaymentError } from '../../pay/index.js';
import type {
  ApplyOutcome,
  ApplyStatusInput,
  OperationStatus,
  PaymentConnectorRegistry,
  PaymentProvider,
  PayoutRequest,
  ProviderOperation,
  ReleaseLegRequest,
} from '../../pay/index.js';
import type {
  BatchCheck,
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
function connectorOf(psp: FakePsp): PaymentProvider {
  const caps = new CapabilitySet(CAPABILITIES);
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

/** Mémoire des lots : règles de 0166 (motifs, clé et rang de l'item, versement après libération). */
class MemoryStore implements PayoutBatchStore {
  status = 'SCHEDULED';
  holds: string[] = [];
  attempt = 0;
  key: string | null = null;
  providerRef: string | null = null;
  applied = 0;
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
    return this.items.reduce((s, i) => s + i.amount, 0n);
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
          nextAttempt: i.attempt + 1,
          nextKey: `release:${i.trip}:1:HOST:i${i.attempt + 1}`,
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
    const item = this.items.find((i) => i.trip === input.tripId);
    const live = item?.op === null || item?.op === undefined ? undefined : this.ops.get(item.op);
    // garde de 0166 : lot READY, clé, rang et montant de l'item, aucun ordre vivant
    if (
      item === undefined ||
      this.status !== 'READY' ||
      input.idemPlain !== `release:${item.trip}:1:HOST:i${item.attempt + 1}` ||
      input.attemptNo !== item.attempt + 1 ||
      input.amountMinor !== item.amount ||
      (live !== undefined && live.status !== 'FAILED')
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
    item.attempt += 1;
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

function rig(currency: string, hosts: readonly bigint[], scenario?: FakePspScenario) {
  let now = Date.parse('2032-01-20T15:00:00.000Z');
  const psp = new FakePsp({
    secret: 'whsec_fake_test_only',
    clock: () => now,
    capabilities: CAPABILITIES,
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
  const connector = connectorOf(psp);
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
