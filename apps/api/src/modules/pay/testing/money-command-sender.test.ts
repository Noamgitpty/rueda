/**
 * Envoi des commandes monétaires (17 §4.3 points 2 à 4 ; 08 E4) : vecteurs T51, T52, T68.
 * Attendus : contrôles des oracles (`checksFor`) et montants des vecteurs T / TJ de l'export ;
 * le FAKE joue le PSP (délai dépassé après succès, refus reçus, réponse perdue).
 */
import {
  checksFor,
  legVector,
  loadGoldenVectors,
  settlementVector,
} from '@rueda/money/golden-vectors';
import type { GoldenValue } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import type { FakeResponse } from '@rueda/fake-adapters';
import { nextAttemptKey, settlementOperationKey } from '../internal/idempotency.js';
import { debitFromVariation } from '../internal/legs.js';
import type { LegAmounts } from '../internal/legs.js';
import { MoneyCommandSender } from '../internal/money-command-sender.js';
import type { MoneyCommand } from '../internal/money-command-sender.js';
import type { ChargeMitRequest, PaymentProvider } from '../internal/port.js';
import { fakeStack } from './fake-stack.js';
import type { FakeStackOptions } from './fake-stack.js';
import { MemoryPaymentStore } from './memory-stores.js';

const set = loadGoldenVectors();
const check = (id: string, label: RegExp): GoldenValue => {
  const c = checksFor(set, id).find((x) => label.test(x.label));
  if (c === undefined) throw new Error(`contrôle ${id} ${label} absent`);
  return c.expected;
};
const legs = (id: string): LegAmounts => ({ ...legVector(set, id).legsMinor });
const key = (operationType: 'REFUND' | 'MIT_CHARGE', tenderId: string, attemptNo = 1) =>
  settlementOperationKey({
    tripId: 'A',
    segmentId: '1',
    settlementVersion: 1,
    operationType,
    tenderId,
    instanceSeq: 1,
    attemptNo,
  });

function rig(options: FakeStackOptions) {
  const stack = fakeStack(options);
  const store = new MemoryPaymentStore(() => stack.clock.now);
  const keysSent: string[] = [];
  // espion : clés réellement transmises au PSP
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
  const sender = new MoneyCommandSender(provider, store);
  return { stack, store, sender, keysSent };
}

/** Capture du trip A (TJ01) payée sur la page hébergée. */
async function paidTripA(
  r: ReturnType<typeof rig>,
  method: 'CARD' | 'YAPPY' = 'CARD',
): Promise<string> {
  const tj01 = legVector(set, 'TJ01');
  // ordre posé directement chez le PSP simulé : certains tests retirent une capacité bloquante
  // (recherche par clé), qui ferme `createHostedPayment` depuis US-061 (17 §2.8)
  const order = r.stack.psp.createOrder({
    merchantReference: `hold:hA:CAPTURE:a1:${method}`,
    currency: tj01.currency,
    method,
    capture: 'AUTO',
    amountMinor: tj01.totalMinor,
    legs: legs('TJ01'),
  });
  r.stack.psp.customerPays(order.reference);
  return order.reference;
}

function command(
  r: ReturnType<typeof rig>,
  id: string,
  base: Omit<MoneyCommand, 'status' | 'operationId' | 'providerReference'>,
): MoneyCommand {
  const op = r.store.operations.get(id);
  if (op === undefined) throw new Error(`opération ${id} absente`);
  return { ...base, operationId: id, status: op.status, providerReference: op.providerReference };
}

describe('T51 — rejeu de l’outbox après un délai dépassé : aucun second remboursement', () => {
  const t03 = settlementVector(set, 'T03');
  const expected = check('T51', /rejeu/) as GoldenValue[];

  it('UNKNOWN puis lecture par notre clé : SUCCEEDED, même clé, une seule opération REFUND', async () => {
    const r = rig({ scenario: { responses: { REFUND: [{ kind: 'TIMEOUT_AFTER_SUCCESS' }] } } });
    const parent = await paidTripA(r);
    const refundLegs = debitFromVariation(legs('TJ02b'));
    const idem = key('REFUND', 'card');
    r.store.addOperation({
      id: 'op-r1',
      accountId: 'acc',
      idemSent: idem,
      providerReference: null,
    });
    const base = {
      kind: 'REFUND' as const,
      idemSent: idem,
      amountMinor: t03.expected.guestRefundMinor,
      currency: t03.currency,
      legs: refundLegs,
      targetReference: parent,
    };
    expect(await r.sender.send(command(r, 'op-r1', base))).toEqual({ outcome: 'UNKNOWN' });
    expect(r.store.operations.get('op-r1')?.status).toBe('UNKNOWN');
    // l'outbox rejoue l'exécution
    expect(await r.sender.send(command(r, 'op-r1', base))).toMatchObject({ outcome: 'SUCCEEDED' });
    expect(r.store.operations.get('op-r1')?.status).toBe('SUCCEEDED');
    const refunds = r.stack.psp.movements().filter((m) => m.operation === 'REFUND');
    // [nouveaux remboursements, débits, clé renvoyée, opérations REFUND au registre]
    expect([
      BigInt(refunds.length - 1),
      BigInt(r.stack.psp.movements().filter((m) => m.operation === 'MIT_CHARGE').length),
      r.keysSent.filter((k) => k === idem)[0],
      BigInt(refunds.length),
    ]).toEqual([expected[0], expected[1], expected[2], expected[3]]);
    expect(r.stack.psp.calls('REFUND')).toBe(1);
    // le rejeu suivant ne fait plus rien
    expect(await r.sender.send(command(r, 'op-r1', base))).toEqual({ outcome: 'ALREADY_FINAL' });
  });

  it('sans recherche par clé ni référence PSP : aucun renvoi, escalade ops (17 §2.8, VERIF_14-F11)', async () => {
    const r = rig({
      without: ['SUPPORTS_LOOKUP_BY_MERCHANT_REF'],
      scenario: { responses: { REFUND: [{ kind: 'TIMEOUT_AFTER_SUCCESS' }] } },
    });
    const parent = await paidTripA(r);
    const idem = key('REFUND', 'card');
    r.store.addOperation({
      id: 'op-r1',
      accountId: 'acc',
      idemSent: idem,
      providerReference: null,
    });
    const base = {
      kind: 'REFUND' as const,
      idemSent: idem,
      amountMinor: t03.expected.guestRefundMinor,
      currency: t03.currency,
      legs: debitFromVariation(legs('TJ02b')),
      targetReference: parent,
    };
    await r.sender.send(command(r, 'op-r1', base));
    expect(await r.sender.send(command(r, 'op-r1', base))).toEqual({
      outcome: 'ESCALATE',
      reason: 'NO_LOOKUP_POSSIBLE',
    });
    expect(r.stack.psp.calls('REFUND')).toBe(1);
  });
});

describe('T52 — échec reçu : même instance, attempt_no = 2, aucune nouvelle instance', () => {
  it('a1 refusé (retour bancaire), a2 accepté ; engagé = 187,44 tout du long', async () => {
    const r = rig({
      scenario: { responses: { REFUND: [{ kind: 'DECLINE', code: 'bank_return' }] } },
    });
    const parent = await paidTripA(r, 'YAPPY');
    const tj16a = legVector(set, 'TJ16a');
    const tj16b = legVector(set, 'TJ16b');
    const committed = -(tj16a.totalMinor + tj16b.totalMinor);
    expect(committed).toBe(check('T52', /engage pendant FAILED/));
    const a1 = key('REFUND', 'yappy', 1);
    r.store.addOperation({ id: 'op-a1', accountId: 'acc', idemSent: a1, providerReference: null });
    const base = {
      kind: 'REFUND' as const,
      amountMinor: -tj16b.totalMinor,
      currency: tj16b.currency,
      legs: debitFromVariation(legs('TJ16b')),
      targetReference: parent,
    };
    expect(await r.sender.send(command(r, 'op-a1', { ...base, idemSent: a1 }))).toMatchObject({
      outcome: 'FAILED',
      declineCode: 'bank_return',
      doNotRetry: false,
    });
    const a2 = nextAttemptKey(a1);
    r.store.addOperation({ id: 'op-a2', accountId: 'acc', idemSent: a2, providerReference: null });
    expect(await r.sender.send(command(r, 'op-a2', { ...base, idemSent: a2 }))).toMatchObject({
      outcome: 'SUCCEEDED',
    });
    const [expectedKey, newRefunds, expectedCommitted] = check('T52', /cle a2/) as GoldenValue[];
    expect(a2).toBe(expectedKey);
    expect(BigInt(r.stack.psp.movements().filter((m) => m.operation === 'REFUND').length - 1)).toBe(
      newRefunds,
    );
    expect(committed).toBe(expectedCommitted);
  });
});

describe('T68 — relances d’un débit MIT : a1 refusé, a2 sans statut puis refusé au rejeu, a3 accepté', () => {
  const tj02a = legVector(set, 'TJ02a');
  const mitBase = (idem: string) => ({
    kind: 'MIT_CHARGE' as const,
    idemSent: idem,
    amountMinor: tj02a.totalMinor,
    currency: tj02a.currency,
    legs: legs('TJ02a'),
    targetReference: null,
    mit: {
      reason: 'DELAYED_CHARGES' as ChargeMitRequest['reason'],
      instrumentToken: 'tok_guarantee',
    },
  });

  it('clés a1, a2, a2, a3 ; 69,22 débités une fois ; hôte payable 45,00', async () => {
    const responses: FakeResponse[] = [
      { kind: 'DECLINE', code: 'insufficient_funds' }, // J0
      { kind: 'TIMEOUT_BEFORE' }, // J+3 : délai dépassé, rien d'exécuté
      { kind: 'DECLINE', code: 'insufficient_funds' }, // J+3, rejeu de a2 : refus confirmé
      { kind: 'OK' }, // J+7
    ];
    const r = rig({ scenario: { responses: { MIT_CHARGE: responses } } });
    const a1 = key('MIT_CHARGE', 'card', 1);
    r.store.addOperation({ id: 'a1', accountId: 'acc', idemSent: a1, providerReference: null });
    expect(await r.sender.send(command(r, 'a1', mitBase(a1)))).toMatchObject({
      outcome: 'FAILED',
      doNotRetry: false,
    });

    const a2 = nextAttemptKey(a1); // refus REÇU : attempt_no + 1
    r.store.addOperation({ id: 'a2', accountId: 'acc', idemSent: a2, providerReference: null });
    expect(await r.sender.send(command(r, 'a2', mitBase(a2)))).toEqual({ outcome: 'UNKNOWN' });
    // rejeu : lecture (inconnue du PSP), puis renvoi de la MÊME clé, refus confirmé
    expect(await r.sender.send(command(r, 'a2', mitBase(a2)))).toMatchObject({ outcome: 'FAILED' });

    const a3 = nextAttemptKey(a2);
    r.store.addOperation({ id: 'a3', accountId: 'acc', idemSent: a3, providerReference: null });
    expect(await r.sender.send(command(r, 'a3', mitBase(a3)))).toMatchObject({
      outcome: 'SUCCEEDED',
    });

    expect(r.keysSent).toEqual(check('T68', /^T68 cles$/));
    const debits = r.stack.psp.movements().filter((m) => m.operation === 'MIT_CHARGE');
    expect(debits).toHaveLength(1);
    expect(debits[0]?.amountMinor).toBe(check('T68', /debite une fois/));
    expect(debits[0]?.legs?.HOST).toBe(check('T68', /hote payable/));
  });

  it('refus « ne pas réessayer » : aucune relance', async () => {
    const r = rig({
      scenario: {
        responses: { MIT_CHARGE: [{ kind: 'DECLINE', code: 'stolen_card', doNotRetry: true }] },
      },
    });
    const a1 = key('MIT_CHARGE', 'card', 1);
    r.store.addOperation({ id: 'a1', accountId: 'acc', idemSent: a1, providerReference: null });
    const out = await r.sender.send(command(r, 'a1', mitBase(a1)));
    expect(out).toMatchObject({ outcome: 'FAILED', doNotRetry: true });
    const [attempts, retries] = check('T68', /ne pas reessayer/) as GoldenValue[];
    expect([BigInt(r.stack.psp.calls('MIT_CHARGE')), 0n]).toEqual([attempts, retries]);
  });

  it('PSP injoignable : rien n’est appliqué, la même clé sera rejouée', async () => {
    const r = rig({ scenario: { responses: { MIT_CHARGE: [{ kind: 'UNAVAILABLE' }] } } });
    const a1 = key('MIT_CHARGE', 'card', 1);
    r.store.addOperation({ id: 'a1', accountId: 'acc', idemSent: a1, providerReference: null });
    expect(await r.sender.send(command(r, 'a1', mitBase(a1)))).toEqual({ outcome: 'NOT_SENT' });
    expect(r.store.operations.get('a1')?.status).toBe('PENDING');
    expect(await r.sender.send(command(r, 'a1', mitBase(a1)))).toMatchObject({
      outcome: 'SUCCEEDED',
    });
    expect(r.keysSent).toEqual([a1, a1]);
  });

  it('jambes falsifiées entre l’enregistrement et l’envoi : LEG_SUM_MISMATCH, aucun appel', async () => {
    const r = rig({});
    const a1 = key('MIT_CHARGE', 'card', 1);
    r.store.addOperation({ id: 'a1', accountId: 'acc', idemSent: a1, providerReference: null });
    const bad = {
      ...mitBase(a1),
      legs: { ...legs('TJ02a'), PLATFORM: legs('TJ02a').PLATFORM + 1n },
    };
    await expect(r.sender.send(command(r, 'a1', bad))).rejects.toMatchObject({
      code: 'LEG_SUM_MISMATCH',
    });
    expect(r.stack.psp.totalCalls()).toBe(0);
  });
});
