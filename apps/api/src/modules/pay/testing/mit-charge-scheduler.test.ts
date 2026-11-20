/**
 * Ordonnanceur des débits post-trip par MIT (US-703, ADR-189 ; 19 US-703 critère 1 ; 08 E4, T68 ;
 * L3-PM-22, RT-L3-M02) : le PSP est le FAKE de `@rueda/fake-adapters` derrière le connecteur de
 * test (`fakeStack`), compteurs d'appels réels ; le stockage est une mémoire qui suit les règles de
 * la migration 0169 (une instance i1, `attempt_no` + 1 seulement après un refus REÇU, jamais une
 * nouvelle tentative tant qu'une tentative est sans statut, échéancier J0 / J+3 / J+7, dette après
 * un refus « ne pas réessayer » ou la dernière tentative) et une transaction à la fois (verrou du
 * trip de la base).
 *
 * Attendus : contrôles T68 de l'export des oracles (`check_verif12_fixes.py`, `check_t66_68.py` :
 * clés a1, a2, a2, a3 ; débité une fois), jambes TJ02a (USD) et TJ11a (PYG) de l'export ; jamais
 * le code testé. Les règles de la base (consentement, préavis, réseau, délai, SUPPORTS_MIT) sont
 * prouvées par `packages/db/test/l0/l0-us703-mit-charges.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { checksFor, legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenValue } from '@rueda/money/golden-vectors';
import type { FakeResponse } from '@rueda/fake-adapters';
import { describe, expect, it } from 'vitest';
import type { SqlClient, WorkerTransactions } from '../../bus/index.js';
import type { LegAmounts } from '../internal/legs.js';
import { MitChargeScheduler } from '../internal/mit-charge-scheduler.js';
import type {
  DueCharge,
  MitChargeStore,
  MitOrder,
  PlanResult,
  PostTripChargeStatus,
  SettleResult,
} from '../internal/mit-charge-store.js';
import type { PaymentProvider } from '../internal/port.js';
import type { PaymentConnectorRegistry } from '../internal/production.js';
import type { ApplyOutcome, ApplyStatusInput } from '../internal/stores.js';
import { countryCases } from '../../../../test/support/countries.js';
import { fakeStack } from './fake-stack.js';
import type { FakeStackOptions } from './fake-stack.js';
import { MemoryPaymentStore } from './memory-stores.js';

const golden = loadGoldenVectors();
const check = (id: string, label: RegExp): GoldenValue => {
  const c = checksFor(golden, id).find((x) => label.test(x.label));
  if (c === undefined) throw new Error(`contrôle ${id} ${label} absent`);
  return c.expected;
};
/** Dettes de 08 : T29 (jambes TJ02a) et J3 (jambes TJ11a) ; celle de la devise du pays. */
const DEBT_VECTORS = ['TJ02a', 'TJ11a'] as const;
const debtVectorOf = (currency: string): string => {
  const id = DEBT_VECTORS.find((v) => legVector(golden, v).currency === currency);
  if (id === undefined) throw new Error(`aucune dette de 08 en ${currency}`);
  return id;
};
const CURRENCIES = (
  JSON.parse(readFileSync(new URL('../../cfg/data/currencies.json', import.meta.url), 'utf8')) as {
    currencies: { code: string }[];
  }
).currencies.map((c) => c.code);
const CASES = countryCases().filter((c) => CURRENCIES.includes(c.currency));

const DAY = 86_400_000;
const T0 = Date.parse('2035-03-02T15:00:00.000Z');
/** Échéancier de la règle de réseau seedée (EC-28 : J0, J+3, J+7). */
const OFFSETS = [0, 3, 7] as const;

interface Attempt {
  readonly n: number;
  readonly key: string;
  readonly operationId: string;
  settled: 'SUCCEEDED' | 'FAILED' | null;
}

/** Débit post-trip en mémoire, règles de 0169 (sous-ensemble : notifié, consenti, échu). */
class MemoryMitStore implements MitChargeStore {
  readonly payments: MemoryPaymentStore;
  readonly attempts: Attempt[] = [];
  status: PostTripChargeStatus = 'NOTIFIED';
  firstAttemptAt: number | null = null;
  nextCheckAt = 0;
  /** Motif rendu par la base avant toute tentative (préavis…) ; `null` : échu. */
  notDue: string | null = null;
  plans = 0;

  constructor(
    readonly now: () => number,
    readonly chargeId: string,
    readonly tripId: string,
    readonly tenderId: string,
    readonly amountMinor: bigint,
    readonly currency: string,
    readonly legs: LegAmounts,
  ) {
    this.payments = new MemoryPaymentStore(now);
  }

  due(): Promise<readonly DueCharge[]> {
    return Promise.resolve([
      { chargeId: this.chargeId, status: this.status, provider: 'FAKE', country: 'XX' },
    ]);
  }

  #current(): Attempt | undefined {
    return this.attempts[this.attempts.length - 1];
  }

  #opStatus(a: Attempt): string {
    return this.payments.operations.get(a.operationId)?.status ?? 'PENDING';
  }

  plan(_chargeId: string, operationId: string): Promise<PlanResult> {
    this.plans += 1;
    const none = { code: null, operationId: null, attempt: null } as const;
    if (this.status === 'CHARGED' || this.status === 'UNPAID') {
      return Promise.resolve({ ...none, outcome: 'DONE', code: this.status });
    }
    const a = this.#current();
    if (a !== undefined && a.settled === null) {
      const s = this.#opStatus(a);
      return Promise.resolve({
        outcome: s === 'SUCCEEDED' || s === 'FAILED' ? 'SETTLE' : 'IN_FLIGHT',
        code: s,
        operationId: a.operationId,
        attempt: a.n,
      });
    }
    if (this.notDue !== null)
      return Promise.resolve({ ...none, outcome: 'NOT_DUE', code: this.notDue });
    const n = this.attempts.length + 1;
    if (n > 1) {
      const dueAt = (this.firstAttemptAt ?? 0) + (OFFSETS[n - 1] ?? 0) * DAY;
      if (this.now() < dueAt) {
        return Promise.resolve({ ...none, outcome: 'NOT_DUE', code: 'MIT_RETRY_NOT_DUE' });
      }
    }
    const key = `${this.tripId}:1:v1:MIT_CHARGE:${this.tenderId}:i1:a${n}`;
    this.attempts.push({ n, key, operationId, settled: null });
    this.payments.addOperation({
      id: operationId,
      accountId: 'acc',
      idemSent: key,
      providerReference: null,
    });
    this.firstAttemptAt ??= this.now();
    this.status = 'CHARGING';
    return Promise.resolve({ outcome: 'PLANNED', code: null, operationId, attempt: n });
  }

  orderForSend(): Promise<MitOrder> {
    const a = this.#current();
    const op = a === undefined ? undefined : this.payments.operations.get(a.operationId);
    const sendable =
      this.status === 'CHARGING' &&
      a !== undefined &&
      a.settled === null &&
      op !== undefined &&
      op.status !== 'SUCCEEDED' &&
      op.status !== 'FAILED';
    return Promise.resolve({
      sendable,
      operationId: a?.operationId ?? null,
      status: op?.status ?? null,
      idemSent: sendable ? (a?.key ?? null) : null,
      amountMinor: sendable ? this.amountMinor : null,
      currency: sendable ? this.currency : null,
      legs: sendable ? this.legs : null,
      providerReference: op?.providerReference ?? null,
      instrumentToken: sendable ? 'tok_us703_card' : null,
      reason: sendable ? 'NO_SHOW' : null,
      attempt: a?.n ?? null,
    });
  }

  settle(_chargeId: string, doNotRetry: boolean): Promise<SettleResult> {
    if (this.status === 'CHARGED') return Promise.resolve({ outcome: 'CHARGED', code: null });
    if (this.status === 'UNPAID') return Promise.resolve({ outcome: 'DONE', code: null });
    const a = this.#current();
    if (a === undefined) return Promise.resolve({ outcome: 'NOT_FOUND', code: null });
    const s = this.#opStatus(a);
    if (a.settled !== null || (s !== 'SUCCEEDED' && s !== 'FAILED')) {
      return Promise.resolve({ outcome: 'IN_FLIGHT', code: s });
    }
    a.settled = s;
    if (s === 'SUCCEEDED') {
      this.status = 'CHARGED';
      return Promise.resolve({ outcome: 'CHARGED', code: null });
    }
    if (doNotRetry || a.n >= OFFSETS.length) {
      this.status = 'UNPAID';
      return Promise.resolve({
        outcome: 'DEBT',
        code: doNotRetry ? 'MIT_DO_NOT_RETRY' : 'MIT_DECLINED',
      });
    }
    this.status = 'RETRY_DUE';
    return Promise.resolve({ outcome: 'RETRY_DUE', code: null });
  }

  apply(input: ApplyStatusInput): Promise<ApplyOutcome> {
    return this.payments.apply(input);
  }
}

/** Une transaction à la fois (le verrou du trip de la base sérialise deux travailleurs). */
function serialized(): WorkerTransactions {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(_worker: string, fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      const next = tail.then(() => fn({} as SqlClient));
      tail = next.catch(() => undefined);
      return next;
    },
  };
}

function rig(c: (typeof CASES)[number], options: FakeStackOptions = {}) {
  const stack = fakeStack(options);
  const v = legVector(golden, debtVectorOf(c.currency));
  const store = new MemoryMitStore(
    () => stack.clock.now,
    'charge-1',
    'A',
    'card',
    v.totalMinor,
    v.currency,
    { ...v.legsMinor },
  );
  const keysSent: string[] = [];
  const provider: PaymentProvider = new Proxy(stack.provider, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const first = args[0] as { idempotencyKey?: string } | undefined;
        if (first?.idempotencyKey !== undefined) keysSent.push(first.idempotencyKey);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  const connectors: PaymentConnectorRegistry = {
    get: (p) => (p === 'FAKE' ? provider : undefined),
  };
  const transactions = serialized();
  let id = 0;
  const scheduler = () =>
    new MitChargeScheduler({
      transactions,
      connectors,
      storeOf: () => store,
      newId: () => `op-${++id}`,
    });
  const debits = () => stack.psp.movements().filter((m) => m.operation === 'MIT_CHARGE');
  const pass = async (s = scheduler()) => s.process((await store.due())[0] as DueCharge);
  stack.clock.now = T0;
  return { stack, store, keysSent, scheduler, debits, pass, total: v.totalMinor, vector: v.id };
}

describe.each(CASES)('US-703 — ordonnanceur des débits MIT — $country ($currency)', (c) => {
  it('T68 : refus à J0, timeout à J+3 puis refus confirmé au rejeu de la MÊME clé, accepté à J+7 ⇒ clés a1, a2, a2, a3, débité une fois', async () => {
    const responses: FakeResponse[] = [
      { kind: 'DECLINE', code: 'insufficient_funds' },
      { kind: 'TIMEOUT_BEFORE' },
      { kind: 'DECLINE', code: 'insufficient_funds' },
      { kind: 'OK' },
    ];
    const r = rig(c, { scenario: { responses: { MIT_CHARGE: responses } } });
    expect(await r.pass()).toMatchObject({ step: 'RETRY_DUE' });
    r.stack.clock.now = T0 + 1 * DAY;
    expect(await r.pass()).toMatchObject({ step: 'NOT_DUE', code: 'MIT_RETRY_NOT_DUE' });
    r.stack.clock.now = T0 + 3 * DAY;
    expect(await r.pass()).toMatchObject({ step: 'WAITING' });
    // tentative a2 sans statut : rejouée (lecture d'abord, puis la MÊME clé), jamais a3
    expect(await r.pass()).toMatchObject({ step: 'RETRY_DUE' });
    r.stack.clock.now = T0 + 7 * DAY;
    expect(await r.pass()).toMatchObject({ step: 'CHARGED' });
    // passage suivant : rien n'est renvoyé (débit déjà fait)
    expect(await r.pass()).toMatchObject({ step: 'CHARGED' });
    expect(r.keysSent).toEqual(check('T68', /^T68 cles$/));
    expect(r.store.attempts.map((a) => a.key.slice(-2))).toEqual(
      check('T68', /^T68 clés de tentative$/),
    );
    const debits = r.debits();
    expect(debits).toHaveLength(1);
    // T68 porte sur la dette de T29 (jambes TJ02a) : montant de l'oracle
    if (r.vector === 'TJ02a') {
      expect(debits[0]?.amountMinor).toBe(check('T68', /débité une fois/));
    }
    expect(debits[0]?.amountMinor).toBe(r.total);
  });

  it('RT-L3-M02 : deux travailleurs traitent le même débit ⇒ un seul appel chargeMIT, un seul débit', async () => {
    const r = rig(c, { scenario: { responses: { MIT_CHARGE: [{ kind: 'OK' }] } } });
    const [a, b] = await Promise.all([r.pass(r.scheduler()), r.pass(r.scheduler())]);
    // le second attend le premier (verrou du trip), lit la tentative déjà débitée, n'envoie rien
    expect([a.step, b.step]).toEqual(['CHARGED', 'CHARGED']);
    expect(r.stack.psp.calls('MIT_CHARGE')).toBe(1);
    expect(r.debits()).toHaveLength(1);
    expect(r.store.attempts).toHaveLength(1);
  });

  it('réponse perdue après le débit : relue par notre clé au passage suivant, aucun second débit', async () => {
    const r = rig(c, {
      scenario: { responses: { MIT_CHARGE: [{ kind: 'TIMEOUT_AFTER_SUCCESS' }] } },
    });
    expect(await r.pass()).toMatchObject({ step: 'WAITING' });
    expect(await r.pass()).toMatchObject({ step: 'CHARGED' });
    expect(r.stack.psp.calls('MIT_CHARGE')).toBe(1);
    expect(r.debits()).toHaveLength(1);
    expect(r.store.attempts).toHaveLength(1);
  });

  it('PSP injoignable : rien n’est parti, la MÊME clé est envoyée au passage suivant', async () => {
    const r = rig(c, { scenario: { responses: { MIT_CHARGE: [{ kind: 'UNAVAILABLE' }] } } });
    expect(await r.pass()).toMatchObject({ step: 'WAITING', code: 'NOT_SENT' });
    expect(await r.pass()).toMatchObject({ step: 'CHARGED' });
    expect(new Set(r.keysSent).size).toBe(1);
    expect(r.debits()).toHaveLength(1);
  });

  it('refus « ne pas réessayer » ⇒ dette directe, aucune relance (T68, 08 E4)', async () => {
    const r = rig(c, {
      scenario: {
        responses: { MIT_CHARGE: [{ kind: 'DECLINE', code: 'stolen_card', doNotRetry: true }] },
      },
    });
    expect(await r.pass()).toMatchObject({ step: 'DEBT', code: 'MIT_DO_NOT_RETRY' });
    r.stack.clock.now = T0 + 7 * DAY;
    expect(await r.pass()).toMatchObject({ step: 'DONE' });
    const [attempts, retries] = check('T68', /ne pas reessayer/) as GoldenValue[];
    expect([BigInt(r.stack.psp.calls('MIT_CHARGE')), 0n]).toEqual([attempts, retries]);
  });

  it('préavis non écoulé (MIT_NOTICE_PERIOD_NOT_ELAPSED, jugé par la base) ⇒ aucun appel au PSP', async () => {
    const r = rig(c);
    r.store.notDue = 'MIT_NOTICE_PERIOD_NOT_ELAPSED';
    expect(await r.pass()).toEqual({ step: 'NOT_DUE', code: 'MIT_NOTICE_PERIOD_NOT_ELAPSED' });
    expect(r.stack.psp.calls('MIT_CHARGE')).toBe(0);
  });

  it('aucun connecteur (production avant le lot C, C19) ⇒ rien n’est planifié ni envoyé', async () => {
    const r = rig(c);
    const s = new MitChargeScheduler({
      transactions: serialized(),
      connectors: { get: () => undefined },
      storeOf: () => r.store,
    });
    expect(await s.process((await r.store.due())[0] as DueCharge)).toEqual({
      step: 'NO_CONNECTOR',
      code: null,
    });
    expect(r.store.plans).toBe(0);
    expect(r.stack.psp.calls('MIT_CHARGE')).toBe(0);
  });
});
