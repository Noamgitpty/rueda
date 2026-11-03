/**
 * Réception des webhooks (17 §4.4 points 1 à 4 ; 19 US-019 critères 2 et 3 ; C19) avec le FAKE et
 * un magasin en mémoire. La commande SQL `core.payment_cmd_receive_webhook` est prouvée sous les
 * rôles de production par `packages/db/test/l0/l0-pay-port.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import { containsPan } from '../internal/pan.js';
import { WEBHOOK_MAX_BODY_BYTES, WebhookIngestService } from '../internal/webhook-ingest.js';
import type { PaymentLogger, WebhookVerifierRegistry } from '../internal/webhook-ingest.js';
import { PRODUCTION_PROVIDERS } from '../internal/production.js';
import { FAKE_PROVIDER } from './fake-payment-provider.js';
import { FAKE_T0, FAKE_WEBHOOK_SECRET, fakeStack } from './fake-stack.js';
import type { FakeStack } from './fake-stack.js';
import { MemoryPaymentStore } from './memory-stores.js';

const set = loadGoldenVectors();
const tj01 = legVector(set, 'TJ01');
const PUBLIC_ID = 'wh_fake_0123456789abcdef';
const SECRET_REF = 'vault:psp/fake/webhook';
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

interface Rig {
  readonly stack: FakeStack;
  readonly store: MemoryPaymentStore;
  readonly service: WebhookIngestService;
  readonly warnings: string[];
}

function rig(
  options: { registry?: WebhookVerifierRegistry; secret?: Uint8Array | null } = {},
): Rig {
  const stack = fakeStack();
  const store = new MemoryPaymentStore(() => stack.clock.now);
  store.accounts.push({
    accountId: 'acc-1',
    provider: FAKE_PROVIDER,
    publicWebhookId: PUBLIC_ID,
    webhookSecretRef: SECRET_REF,
  });
  const warnings: string[] = [];
  const log: PaymentLogger = { warn: (m) => warnings.push(m) };
  const registry = options.registry ?? {
    get: (p: string) => (p === FAKE_PROVIDER ? stack.provider : undefined),
  };
  const secret = options.secret === undefined ? enc(FAKE_WEBHOOK_SECRET) : options.secret;
  const service = new WebhookIngestService(
    registry,
    store,
    { resolve: (ref) => Promise.resolve(ref === SECRET_REF ? secret : null) },
    log,
  );
  return { stack, store, service, warnings };
}

async function paidOrder(r: Rig): Promise<string> {
  const order = await r.stack.provider.createHostedPayment({
    idempotencyKey: 'hold:h1:CAPTURE:a1',
    currency: tj01.currency,
    method: 'CARD',
    capture: 'AUTO',
    amountMinor: tj01.totalMinor,
    legs: { ...tj01.legsMinor },
  });
  r.stack.psp.customerPays(order.providerReference);
  return order.providerReference;
}

const post = (
  r: Rig,
  body: string,
  headers: Record<string, string>,
  provider = 'fake',
  id = PUBLIC_ID,
) => r.service.receive({ provider, publicWebhookId: id, headers, rawBody: enc(body) });

describe('réception des webhooks', () => {
  it('signature valide ⇒ RECEIVED, 200 ; événements normalisés stockés', async () => {
    const r = rig();
    const ref = await paidOrder(r);
    const [created, captured] = r.stack.psp.deliverWebhooks();
    for (const d of [created, captured]) {
      const res = await post(r, d?.body ?? '', { ...d?.headers });
      expect(res).toEqual({ status: 200, outcome: 'RECEIVED' });
    }
    expect(
      r.store.inbox.map((x) => [x.status, x.events[0]?.status, x.events[0]?.providerReference]),
    ).toEqual([
      ['RECEIVED', 'SUBMITTED', ref],
      ['RECEIVED', 'SUCCEEDED', ref],
    ]);
  });

  it('doublon (même événement livré deux fois) ⇒ 200 sans traitement, une seule ligne', async () => {
    const r = rig();
    await paidOrder(r);
    const [d] = r.stack.psp.deliverWebhooks();
    expect(await post(r, d?.body ?? '', { ...d?.headers })).toMatchObject({ outcome: 'RECEIVED' });
    // rejeu plus tard : signé à une autre heure, même identifiant d'événement
    r.stack.clock.now = FAKE_T0 + 60_000;
    const again = r.stack.psp.replayWebhook(JSON.parse(d?.body ?? '{}').id);
    expect(await post(r, again.body, { ...again.headers })).toEqual({
      status: 200,
      outcome: 'DUPLICATE',
    });
    expect(r.store.inbox).toHaveLength(1);
  });

  it('signature invalide ⇒ REJECTED_SIGNATURE, 401, journalisé, aucun événement ; un faux n’occupe pas l’identifiant légitime', async () => {
    const r = rig();
    await paidOrder(r);
    const [d] = r.stack.psp.deliverWebhooks();
    const forged = await post(r, d?.body ?? '', {
      'fake-signature': `t=${Math.floor(FAKE_T0 / 1000)},v1=${'0'.repeat(64)}`,
    });
    expect(forged).toEqual({ status: 401, outcome: 'REJECTED_SIGNATURE' });
    expect(r.warnings.some((w) => /REJECTED_SIGNATURE/.test(w))).toBe(true);
    expect(r.store.inbox[0]).toMatchObject({
      status: 'REJECTED_SIGNATURE',
      events: [],
      providerEventId: null,
    });
    // le vrai webhook, même identifiant d'événement, reste reçu
    expect(await post(r, d?.body ?? '', { ...d?.headers })).toMatchObject({ outcome: 'RECEIVED' });
  });

  it('horodatage signé hors tolérance (± 5 min, heure de la base) ⇒ QUARANTINED, 200', async () => {
    const r = rig();
    await paidOrder(r);
    const [d] = r.stack.psp.deliverWebhooks();
    r.stack.clock.now = FAKE_T0 + 5 * 60_000 + 1_000;
    expect(await post(r, d?.body ?? '', { ...d?.headers })).toEqual({
      status: 200,
      outcome: 'QUARANTINED',
    });
  });

  it('PAN accidentel dans un en-tête : masqué avant stockage, alerte', async () => {
    const r = rig();
    await paidOrder(r);
    const [d] = r.stack.psp.deliverWebhooks();
    await post(r, d?.body ?? '', {
      ...d?.headers,
      'x-debug': 'card 4111111111111111',
      authorization: 'Bearer s',
    });
    const row = r.store.inbox[0];
    expect(containsPan(JSON.stringify(row))).toBe(false);
    expect(row?.headers['x-debug']).toBe('card 411111******1111');
    expect(row?.headers['authorization']).toBeUndefined();
    expect(r.warnings.some((w) => /PAN/.test(w))).toBe(true);
  });

  it('C19 : registre de production (aucun FAKE) ⇒ 404 sans aucun accès à la base', async () => {
    expect(PRODUCTION_PROVIDERS).toEqual([]);
    const r = rig({ registry: { get: () => undefined } });
    await paidOrder(r);
    const [d] = r.stack.psp.deliverWebhooks();
    expect(await post(r, d?.body ?? '', { ...d?.headers })).toEqual({
      status: 404,
      outcome: 'UNKNOWN_PROVIDER',
    });
    expect(r.store.calls).toEqual({ resolveAccount: 0, receive: 0 });
    expect(r.store.inbox).toEqual([]);
  });

  it('C19 : base en production ⇒ compte FAKE introuvable, 404 sans écriture', async () => {
    const r = rig();
    r.store.productionDatabase = true;
    await paidOrder(r);
    const [d] = r.stack.psp.deliverWebhooks();
    expect(await post(r, d?.body ?? '', { ...d?.headers })).toEqual({
      status: 404,
      outcome: 'NOT_FOUND',
    });
    expect(r.store.calls.receive).toBe(0);
    expect(r.store.inbox).toEqual([]);
  });

  it('compte ou identifiant inconnu ⇒ 404 ; corps > 256 ko ⇒ 413 ; secret introuvable ⇒ 503 ; rien n’est écrit', async () => {
    const r = rig();
    expect(await post(r, '{}', {}, 'fake', 'wh_unknown_000000000000')).toMatchObject({
      status: 404,
    });
    expect(await post(r, '{}', {}, 'fake', 'court')).toMatchObject({ status: 404 });
    expect(await post(r, '{}', {}, '../x')).toMatchObject({ status: 404 });
    const big = 'x'.repeat(WEBHOOK_MAX_BODY_BYTES + 1);
    expect(await post(r, big, {})).toEqual({ status: 413, outcome: 'TOO_LARGE' });
    const noSecret = rig({ secret: null });
    expect(await post(noSecret, '{}', {})).toEqual({ status: 503, outcome: 'SECRET_UNAVAILABLE' });
    expect([...r.store.inbox, ...noSecret.store.inbox]).toEqual([]);
  });
});
