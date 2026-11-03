/**
 * Traitement asynchrone (17 §4.4 points 5 à 8) avec le FAKE hostile : webhooks en double, hors
 * d'ordre (SUCCEEDED avant CREATED), retardés, perdus ; opération inconnue en quarantaine.
 * Le statut final ne dépend jamais de l'ordre de livraison.
 */
import { describe, expect, it } from 'vitest';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { FakePspScenario } from '@rueda/fake-adapters';
import { WebhookIngestService } from '../internal/webhook-ingest.js';
import { WebhookProcessor } from '../internal/webhook-processor.js';
import { FAKE_PROVIDER } from './fake-payment-provider.js';
import { FAKE_T0, FAKE_WEBHOOK_SECRET, fakeStack } from './fake-stack.js';
import type { FakeStackOptions } from './fake-stack.js';
import { MemoryPaymentStore } from './memory-stores.js';

const set = loadGoldenVectors();
const PUBLIC_ID = 'wh_fake_0123456789abcdef';
const KEY = 'hold:h1:CAPTURE:a1';

async function scenario(
  options: FakeStackOptions & { scenario?: FakePspScenario },
  vectorId = 'TJ01',
) {
  const v = legVector(set, vectorId);
  const stack = fakeStack(options);
  const store = new MemoryPaymentStore(() => stack.clock.now);
  store.accounts.push({
    accountId: 'acc-1',
    provider: FAKE_PROVIDER,
    publicWebhookId: PUBLIC_ID,
    webhookSecretRef: 'vault:x',
  });
  const log = { warn: () => undefined };
  const ingest = new WebhookIngestService(
    { get: (p) => (p === FAKE_PROVIDER ? stack.provider : undefined) },
    store,
    { resolve: () => Promise.resolve(new TextEncoder().encode(FAKE_WEBHOOK_SECRET)) },
    log,
  );
  const processor = new WebhookProcessor(store, () => stack.provider, log);
  const order = await stack.provider.createHostedPayment({
    idempotencyKey: KEY,
    currency: v.currency,
    method: 'CARD',
    capture: 'AUTO',
    amountMinor: v.totalMinor,
    legs: { ...v.legsMinor },
  });
  store.addOperation({
    id: 'op-1',
    accountId: 'acc-1',
    idemSent: KEY,
    providerReference: order.providerReference,
    status: 'SUBMITTED',
  });
  const deliver = async () => {
    for (const d of stack.psp.deliverWebhooks()) {
      await ingest.receive({
        provider: 'FAKE',
        publicWebhookId: PUBLIC_ID,
        headers: d.headers,
        rawBody: new TextEncoder().encode(d.body),
      });
    }
  };
  return { stack, store, processor, order, deliver };
}

describe.each(['TJ01', 'TJ08a'])('ordre et doublons des webhooks (%s)', (vectorId) => {
  it('doublons et ordre inversé : statut final SUCCEEDED, le CREATED tardif est ignoré', async () => {
    const s = await scenario(
      { scenario: { webhooks: { duplicate: true, reverse: true } } },
      vectorId,
    );
    s.stack.psp.customerPays(s.order.providerReference);
    await s.deliver();
    // 4 livraisons, 2 événements distincts : 2 doublons écartés à la réception
    expect(s.store.inbox).toHaveLength(2);
    const report = await s.processor.runOnce();
    expect(report).toMatchObject({ processed: 2, quarantined: 0, failed: 0, conflicts: 0 });
    expect(s.store.operations.get('op-1')?.status).toBe('SUCCEEDED');
    expect(s.store.statusEvents.map((e) => [e.status, e.source, e.outcome])).toEqual([
      ['SUCCEEDED', 'WEBHOOK', 'APPLIED'],
      // « lire puis appliquer » : le CREATED tardif est remplacé par l'état faisant foi
      ['SUCCEEDED', 'POLL', 'DUPLICATE'],
    ]);
  });

  it('sans lecture possible chez le PSP : le CREATED tardif est STALE (rang inférieur, ignoré)', async () => {
    const s = await scenario({ scenario: { webhooks: { reverse: true } } }, vectorId);
    s.stack.psp.customerPays(s.order.providerReference);
    await s.deliver();
    const blind = new WebhookProcessor(s.store, () => undefined, { warn: () => undefined });
    await blind.runOnce();
    expect(s.store.operations.get('op-1')?.status).toBe('SUCCEEDED');
    expect(s.store.statusEvents.map((e) => e.outcome)).toEqual(['APPLIED', 'STALE']);
  });

  it('webhook retardé : rien avant le délai, traitement après', async () => {
    const s = await scenario({ scenario: { webhooks: { delayMs: 120_000 } } }, vectorId);
    s.stack.psp.customerPays(s.order.providerReference);
    await s.deliver();
    expect(s.store.inbox).toEqual([]);
    s.stack.clock.now = FAKE_T0 + 120_000;
    await s.deliver();
    await s.processor.runOnce();
    expect(s.store.operations.get('op-1')?.status).toBe('SUCCEEDED');
  });

  it('IPN perdu (Yappy) : aucune preuve par webhook ; la lecture du PSP reste possible', async () => {
    const s = await scenario({ scenario: { webhooks: { loseMethods: ['CARD'] } } }, vectorId);
    s.stack.psp.customerPays(s.order.providerReference);
    await s.deliver();
    expect(s.store.inbox).toEqual([]);
    expect((await s.stack.provider.getOperation({ merchantReference: KEY }))?.status).toBe(
      'SUCCEEDED',
    );
  });
});

describe('rattachement (17 §4.4 point 6)', () => {
  it('opération inconnue : QUARANTINED, puis FAILED et alerte après 15 min', async () => {
    const s = await scenario({});
    s.store.operations.clear();
    s.stack.psp.customerPays(s.order.providerReference);
    await s.deliver();
    expect(await s.processor.runOnce()).toMatchObject({ quarantined: 2 });
    expect(s.store.inbox.map((r) => r.status)).toEqual(['QUARANTINED', 'QUARANTINED']);
    s.stack.clock.now = FAKE_T0 + 15 * 60_000 + 1;
    expect(await s.processor.runOnce()).toMatchObject({ failed: 2 });
  });

  it('opération rattachée par notre clé quand le PSP la renvoie (référence encore inconnue)', async () => {
    const s = await scenario({});
    s.store.operations.clear();
    s.store.addOperation({
      id: 'op-2',
      accountId: 'acc-1',
      idemSent: KEY,
      providerReference: null,
      status: 'UNKNOWN',
    });
    s.stack.psp.customerPays(s.order.providerReference);
    await s.deliver();
    await s.processor.runOnce();
    expect(s.store.operations.get('op-2')).toMatchObject({
      status: 'SUCCEEDED',
      providerReference: s.order.providerReference,
    });
  });

  it('terminal contradictoire (FAILED puis SUCCEEDED) : CONFLICT, rien ne change, file ops', async () => {
    const s = await scenario({});
    const op = s.store.operations.get('op-1');
    if (op === undefined) throw new Error('opération absente');
    op.status = 'FAILED';
    s.stack.psp.customerPays(s.order.providerReference);
    await s.deliver();
    const report = await s.processor.runOnce();
    expect(report.conflicts).toBeGreaterThan(0);
    expect(s.store.operations.get('op-1')?.status).toBe('FAILED');
  });
});
