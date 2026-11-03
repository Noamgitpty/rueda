/**
 * Point d'entrée HTTP réel des webhooks (revue qa n° 6) : application Nest sur un port éphémère,
 * `rawBody: true` comme main.ts, `WebhookController` + `WebhookIngestService` + FAKE + magasin en
 * mémoire. Prouve que la signature porte sur les OCTETS reçus (corps JSON à espaces non canoniques
 * accepté ; un JSON ré-sérialisé échouerait), et les réponses 200 / 401 / 404 / 413.
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_SIGNATURE_HEADER } from '@rueda/fake-adapters';
import { PayWebhookModule } from '../internal/pay-webhook.module.js';
import type { WebhookVerifierRegistry } from '../internal/webhook-ingest.js';
import { FAKE_PROVIDER } from './fake-payment-provider.js';
import { FAKE_WEBHOOK_SECRET, fakeStack } from './fake-stack.js';
import { MemoryPaymentStore } from './memory-stores.js';

const PUBLIC_ID = 'wh_fake_http_0123456789ab';
const opened: INestApplication[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.close();
});

async function start(registry?: WebhookVerifierRegistry) {
  const stack = fakeStack();
  stack.clock.now = Date.now();
  const store = new MemoryPaymentStore(() => Date.now());
  store.accounts.push({
    accountId: 'acc-http',
    provider: FAKE_PROVIDER,
    publicWebhookId: PUBLIC_ID,
    webhookSecretRef: 'vault:psp/fake/webhook',
  });
  const app = await NestFactory.create(
    PayWebhookModule.register({
      registry: registry ?? { get: (p) => (p === FAKE_PROVIDER ? stack.provider : undefined) },
      store,
      secrets: { resolve: () => Promise.resolve(new TextEncoder().encode(FAKE_WEBHOOK_SECRET)) },
      log: { warn: () => undefined },
    }),
    { rawBody: true, logger: false },
  );
  opened.push(app);
  await app.listen(0, '127.0.0.1');
  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return { stack, store, url };
}

/** Corps JSON volontairement NON canonique (espaces, ordre), signé tel quel. */
const body = (eventId: string) =>
  `{ "type" : "payment.captured",  "id":"${eventId}", "reference": "fk_tx_000042", ` +
  `"status":"SUCCEEDED", "occurred_at": "2031-07-01T08:00:00.000Z" }`;

async function post(url: string, raw: string, signature: string | null, provider = 'fake') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers[FAKE_SIGNATURE_HEADER] = signature;
  return fetch(`${url}/webhooks/${provider}/${PUBLIC_ID}`, { method: 'POST', headers, body: raw });
}

describe('POST /webhooks/{provider}/{public_webhook_id} (HTTP réel)', () => {
  it('corps signé à espaces non canoniques ⇒ 200 RECEIVED (les octets bruts sont lus), no-store', async () => {
    const { stack, store, url } = await start();
    const raw = body('evt_http_1');
    const res = await post(url, raw, stack.psp.signRaw(raw, Math.floor(Date.now() / 1000)));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(store.inbox.map((r) => [r.status, r.events[0]?.providerReference])).toEqual([
      ['RECEIVED', 'fk_tx_000042'],
    ]);
  });

  it('corps altéré après signature ⇒ 401 REJECTED_SIGNATURE ; sans en-tête ⇒ 401', async () => {
    const { stack, store, url } = await start();
    const raw = body('evt_http_2');
    const sig = stack.psp.signRaw(raw, Math.floor(Date.now() / 1000));
    expect((await post(url, raw.replace('SUCCEEDED', 'FAILED'), sig)).status).toBe(401);
    expect((await post(url, raw, null)).status).toBe(401);
    expect(store.inbox.map((r) => r.status)).toEqual(['REJECTED_SIGNATURE', 'REJECTED_SIGNATURE']);
  });

  it('doublon ⇒ 200 sans nouvelle ligne', async () => {
    const { stack, store, url } = await start();
    const raw = body('evt_http_3');
    const sig = stack.psp.signRaw(raw, Math.floor(Date.now() / 1000));
    expect((await post(url, raw, sig)).status).toBe(200);
    expect((await post(url, raw, sig)).status).toBe(200);
    expect(store.inbox).toHaveLength(1);
  });

  it('horodatage signé hors de la fenêtre de ± 5 min ⇒ 200, ligne QUARANTINED', async () => {
    const { stack, store, url } = await start();
    const raw = body('evt_http_4');
    const res = await post(url, raw, stack.psp.signRaw(raw, Math.floor(Date.now() / 1000) - 600));
    expect(res.status).toBe(200);
    expect(store.inbox.map((r) => r.status)).toEqual(['QUARANTINED']);
  });

  it('registre de production (aucun FAKE) ⇒ 404, aucun accès au magasin', async () => {
    const { stack, store, url } = await start({ get: () => undefined });
    const raw = body('evt_http_5');
    const res = await post(url, raw, stack.psp.signRaw(raw, Math.floor(Date.now() / 1000)));
    expect(res.status).toBe(404);
    expect(store.calls).toEqual({ resolveAccount: 0, receive: 0 });
  });

  it('corps de plus de 256 ko ⇒ 413, aucune ligne', async () => {
    const { store, url } = await start();
    const big = JSON.stringify({ pad: 'x'.repeat(256 * 1024 + 1) });
    expect((await post(url, big, 't=1,v1=' + '0'.repeat(64))).status).toBe(413);
    expect(store.inbox).toEqual([]);
  });
});
