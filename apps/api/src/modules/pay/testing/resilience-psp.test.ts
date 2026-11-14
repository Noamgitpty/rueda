/**
 * US-045 — résilience de PAY face au PSP `FAKE` HOSTILE, au niveau des CONSOMMATEURS
 * (`WebhookIngestService`, `WebhookProcessor.runOnce`, `MoneyCommandSender`), avec le vrai
 * `FakePsp` de `@rueda/fake-adapters` (17 §6.5 point 5 ; ADR-032 ; ADR-066 ; 17 §5 « PSP » :
 * PSP indisponible, webhook perdu ou doublonné ⇒ idempotence, rapprochement).
 *
 * Ce qui est prouvé (attendus tirés de 17 §4.3 points 2 à 4, §4.4 points 2, 3, 6, 7 et du
 * rapprochement de filet, jamais du code testé) :
 * - (a) tempête de webhooks sur une opération (doublons + ordre inversé + retard + rejeux, avant
 *   et après traitement) : un seul statut final, appliqué une seule fois, aucun mouvement de fonds
 *   en plus ;
 * - (b) lecture du PSP (`LOOKUP`) en panne, en délai dépassé ou sans réponse pendant le traitement :
 *   webhook signé reçu dans la fenêtre ⇒ la preuve signée suffit (PAY-034), une seule fois ;
 *   webhook tardif (horodatage hors ± 5 min) ⇒ jamais cru sur parole, rien n'est appliqué, et un
 *   rejeu re-signé ne le blanchit pas ; la lecture revenue, l'état faisant foi est appliqué ;
 * - (c) PSP qui IGNORE l'idempotence : notre côté envoie chaque commande avec une clé stable et ne
 *   renvoie jamais une commande d'issue inconnue sans lecture préalable (aucun second débit) ; le
 *   seul chemin restant (commande encore `PENDING` après un succès non enregistré) produit un
 *   second débit chez un tel PSP : il est DÉTECTABLE par le rapprochement par jambe
 *   (`listLegBalances`), pas par la lecture par clé (limite documentée dans le rapport US-045) ;
 * - (d) panne prolongée (nombreux `UNAVAILABLE`, puis lectures en panne) puis reprise : même clé
 *   d'idempotence à chaque essai, un seul mouvement.
 *
 * Deux pays : vecteurs en USD (PA, 2 décimales) et en PYG (PY, sans décimale). Horloge simulée
 * seulement (`stack.clock.now`), aucune attente réelle.
 */
import { describe, expect, it } from 'vitest';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { FakePspScenario, FakeResponse, FakeWebhookDelivery } from '@rueda/fake-adapters';
import { settlementOperationKey } from '../internal/idempotency.js';
import type { LegAmounts } from '../internal/legs.js';
import { MoneyCommandSender } from '../internal/money-command-sender.js';
import type { MoneyCommand } from '../internal/money-command-sender.js';
import type { MitReason, PaymentProvider } from '../internal/port.js';
import type { OperationStatusStore } from '../internal/stores.js';
import { WebhookIngestService } from '../internal/webhook-ingest.js';
import type { WebhookResponse } from '../internal/webhook-ingest.js';
import { WebhookProcessor } from '../internal/webhook-processor.js';
import { FAKE_PROVIDER } from './fake-payment-provider.js';
import { FAKE_WEBHOOK_SECRET, fakeStack } from './fake-stack.js';
import { MemoryPaymentStore } from './memory-stores.js';

const set = loadGoldenVectors();
const PUBLIC_ID = 'wh_fake_resilience_0001';
/** Tolérance de l'horodatage signé (17 §4.4 point 2) : ± 5 min. */
const TOLERANCE_MS = 5 * 60_000;

/** Vecteurs d'allocation (montants positifs), un par pays : TJ01 en USD (PA), TJ08a en PYG (PY). */
const COUNTRIES = ['TJ01', 'TJ08a'] as const;

// --- montage webhooks ---------------------------------------------------------------------------

async function webhookWorld(vectorId: string, scenario?: FakePspScenario) {
  const v = legVector(set, vectorId);
  const stack = fakeStack(scenario === undefined ? {} : { scenario });
  const store = new MemoryPaymentStore(() => stack.clock.now);
  store.accounts.push({
    accountId: 'acc-1',
    provider: FAKE_PROVIDER,
    publicWebhookId: PUBLIC_ID,
    webhookSecretRef: 'vault:x',
  });
  const warnings: string[] = [];
  const log = { warn: (m: string) => void warnings.push(m) };
  const ingest = new WebhookIngestService(
    { get: (p) => (p === FAKE_PROVIDER ? stack.provider : undefined) },
    store,
    { resolve: () => Promise.resolve(new TextEncoder().encode(FAKE_WEBHOOK_SECRET)) },
    log,
  );
  const processor = new WebhookProcessor(store, () => stack.provider, log);
  let seq = 0;
  /** Ordre sur page hébergée, opération `SUBMITTED` enregistrée chez nous. */
  const order = async () => {
    seq += 1;
    const key = `hold:h${seq}:CAPTURE:a1`;
    const o = await stack.provider.createHostedPayment({
      idempotencyKey: key,
      currency: v.currency,
      method: 'CARD',
      capture: 'AUTO',
      amountMinor: v.totalMinor,
      legs: { ...v.legsMinor },
    });
    const id = `op-${seq}`;
    store.addOperation({
      id,
      accountId: 'acc-1',
      idemSent: key,
      providerReference: o.providerReference,
      status: 'SUBMITTED',
    });
    return { id, key, ref: o.providerReference };
  };
  const post = async (deliveries: readonly FakeWebhookDelivery[]): Promise<WebhookResponse[]> => {
    const out: WebhookResponse[] = [];
    for (const d of deliveries) {
      out.push(
        await ingest.receive({
          provider: 'FAKE',
          publicWebhookId: PUBLIC_ID,
          headers: d.headers,
          rawBody: new TextEncoder().encode(d.body),
        }),
      );
    }
    return out;
  };
  const status = (id: string) => store.operations.get(id)?.status;
  const applied = () => store.statusEvents.filter((e) => e.outcome === 'APPLIED');
  return { stack, store, processor, warnings, order, post, status, applied };
}

describe.each(COUNTRIES)('(a) tempête de webhooks sur une opération — vecteur %s', (vectorId) => {
  it('doublons + ordre inversé + retard + rejeux mêlés : un seul statut final, appliqué une fois, aucun mouvement en plus', async () => {
    const w = await webhookWorld(vectorId, {
      webhooks: { duplicate: true, reverse: true, delayMs: 90_000 },
    });
    const op = await w.order();
    w.stack.psp.customerPays(op.ref);
    const movements = w.stack.psp.movements().length;

    // retard : rien n'est livré avant l'échéance
    expect(await w.post(w.stack.psp.deliverWebhooks())).toEqual([]);
    expect(w.store.inbox).toEqual([]);
    w.stack.clock.now += 90_000;

    const due = w.stack.psp.deliverWebhooks();
    const eventIds = [...new Set(due.map((d) => d.eventId))];
    // 2 événements distincts (création, paiement), chacun livré deux fois
    expect(eventIds).toHaveLength(2);
    expect(due).toHaveLength(4);
    // rejeux de chaque événement (re-signés à l'heure courante) mêlés à la livraison
    const storm = [
      ...due,
      ...eventIds.flatMap((id) => [w.stack.psp.replayWebhook(id), w.stack.psp.replayWebhook(id)]),
    ];
    const responses = await w.post(storm);
    // 2xx à chaque livraison (le PSP cesse de réessayer) ; une seule ligne par événement
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(responses.filter((r) => r.outcome === 'RECEIVED')).toHaveLength(2);
    expect(responses.filter((r) => r.outcome === 'DUPLICATE')).toHaveLength(storm.length - 2);
    expect(w.store.inbox).toHaveLength(2);

    expect(await w.processor.runOnce()).toMatchObject({
      processed: 2,
      quarantined: 0,
      failed: 0,
      conflicts: 0,
    });

    // rejeux tardifs APRÈS traitement (10 min plus tard, signatures fraîches) : doublons, rien de neuf
    w.stack.clock.now += 10 * 60_000;
    const late = await w.post(eventIds.map((id) => w.stack.psp.replayWebhook(id)));
    expect(late.map((r) => [r.status, r.outcome])).toEqual([
      [200, 'DUPLICATE'],
      [200, 'DUPLICATE'],
    ]);
    expect(await w.processor.runOnce()).toMatchObject({ processed: 0, failed: 0 });

    expect(w.status(op.id)).toBe('SUCCEEDED');
    // appliqué UNE fois ; jamais de conflit ; aucun mouvement de fonds créé par les webhooks
    expect(w.applied().map((e) => [e.operationId, e.status])).toEqual([[op.id, 'SUCCEEDED']]);
    expect(w.store.statusEvents.some((e) => e.outcome === 'CONFLICT')).toBe(false);
    expect(w.stack.psp.movements()).toHaveLength(movements);
    expect(w.stack.psp.pendingWebhookCount()).toBe(0);
  });

  it('l’ancien CREATED (doublé, rejoué) arrive APRÈS le traitement du paiement : le statut final ne recule pas', async () => {
    const w = await webhookWorld(vectorId, { webhooks: { duplicate: true, delayMs: 30_000 } });
    const op = await w.order();
    w.stack.psp.customerPays(op.ref);
    w.stack.clock.now += 30_000;
    const due = w.stack.psp.deliverWebhooks();
    const [createdId, paidId] = [...new Set(due.map((d) => d.eventId))];
    if (createdId === undefined || paidId === undefined) throw new Error('événements attendus');

    // d'abord le seul paiement (deux copies), traité
    await w.post(due.filter((d) => d.eventId === paidId));
    await w.processor.runOnce();
    expect(w.status(op.id)).toBe('SUCCEEDED');

    // puis la création, ses doublons et un rejeu, et un nouveau rejeu du paiement
    await w.post([
      ...due.filter((d) => d.eventId === createdId),
      w.stack.psp.replayWebhook(createdId),
      w.stack.psp.replayWebhook(paidId),
    ]);
    expect(await w.processor.runOnce()).toMatchObject({ processed: 1, conflicts: 0 });

    expect(w.status(op.id)).toBe('SUCCEEDED');
    expect(w.applied().map((e) => e.status)).toEqual(['SUCCEEDED']);
    expect(w.store.inbox).toHaveLength(2);
  });
});

const HOSTILE_LOOKUPS: readonly FakeResponse['kind'][] = [
  'UNAVAILABLE',
  'TIMEOUT_BEFORE',
  'TIMEOUT_AFTER_SUCCESS',
];

describe.each(COUNTRIES)(
  '(b) lecture du PSP hostile pendant le traitement — vecteur %s',
  (vectorId) => {
    describe.each(HOSTILE_LOOKUPS)('LOOKUP = %s', (kind) => {
      const failing = (n: number): FakeResponse[] =>
        Array.from({ length: n }, () => ({ kind }) as FakeResponse);

      it('webhook signé reçu dans la fenêtre : la preuve signée suffit (PAY-034), appliquée une fois, sans source POLL', async () => {
        const w = await webhookWorld(vectorId, { responses: { LOOKUP: failing(2) } });
        const op = await w.order();
        w.stack.psp.customerPays(op.ref);
        await w.post(w.stack.psp.deliverWebhooks());
        expect(await w.processor.runOnce()).toMatchObject({ processed: 2, failed: 0 });
        // chaque événement a tenté la lecture (« lire puis appliquer »), toutes en échec
        expect(w.stack.psp.calls('LOOKUP')).toBe(2);
        expect(w.status(op.id)).toBe('SUCCEEDED');
        expect(w.applied().map((e) => [e.status, e.source])).toEqual([['SUCCEEDED', 'WEBHOOK']]);
        expect(w.store.statusEvents.some((e) => e.source === 'POLL')).toBe(false);
      });

      it('webhook TARDIF (horodatage hors ± 5 min) et lecture impossible : rien n’est appliqué ni blanchi ; lecture revenue, l’état faisant foi est appliqué', async () => {
        const w = await webhookWorld(vectorId, { responses: { LOOKUP: failing(2) } });
        const op1 = await w.order();
        w.stack.psp.customerPays(op1.ref);
        // signés maintenant, reçus 6 min plus tard
        const stale = w.stack.psp.deliverWebhooks();
        w.stack.clock.now += TOLERANCE_MS + 60_000;
        expect((await w.post(stale)).map((r) => r.outcome)).toEqual(['QUARANTINED', 'QUARANTINED']);

        expect(await w.processor.runOnce()).toMatchObject({ processed: 0, failed: 2 });
        expect(w.status(op1.id)).toBe('SUBMITTED');
        expect(w.store.statusEvents).toEqual([]);
        expect(w.store.inbox.map((r) => [r.status, r.error])).toEqual([
          ['FAILED', 'SIGNED_TIMESTAMP_UNVERIFIED'],
          ['FAILED', 'SIGNED_TIMESTAMP_UNVERIFIED'],
        ]);
        expect(w.warnings.filter((m) => m.includes('horodatage'))).toHaveLength(2);

        // un rejeu du même événement, re-signé à l'heure courante, ne le blanchit pas
        const replays = await w.post(stale.map((d) => w.stack.psp.replayWebhook(d.eventId)));
        expect(replays.map((r) => r.outcome)).toEqual(['DUPLICATE', 'DUPLICATE']);
        expect(await w.processor.runOnce()).toMatchObject({ processed: 0, failed: 0 });
        expect(w.status(op1.id)).toBe('SUBMITTED');

        // la lecture est revenue (file scriptée épuisée ⇒ OK) : une autre opération, webhooks
        // tardifs aussi, reçoit l'état FAISANT FOI du PSP (source POLL seulement)
        const op2 = await w.order();
        w.stack.psp.customerPays(op2.ref);
        const stale2 = w.stack.psp.deliverWebhooks();
        w.stack.clock.now += TOLERANCE_MS + 60_000;
        await w.post(stale2);
        expect(await w.processor.runOnce()).toMatchObject({ processed: 2, failed: 0 });
        expect(w.status(op2.id)).toBe('SUCCEEDED');
        expect(new Set(w.store.statusEvents.map((e) => e.source))).toEqual(new Set(['POLL']));
        expect(w.applied().map((e) => [e.operationId, e.status])).toEqual([[op2.id, 'SUCCEEDED']]);

        // op1 reste à lever par le rapprochement, dont la lecture faisant foi est disponible
        expect(w.status(op1.id)).toBe('SUBMITTED');
        expect((await w.stack.provider.getOperation({ merchantReference: op1.key }))?.status).toBe(
          'SUCCEEDED',
        );
      });
    });
  },
);

// --- montage commandes monétaires --------------------------------------------------------------

function senderWorld(
  scenario: FakePspScenario,
  wrap: (memory: MemoryPaymentStore) => OperationStatusStore = (memory) => memory,
) {
  const stack = fakeStack({ scenario });
  const memory = new MemoryPaymentStore(() => stack.clock.now);
  const keysSent: string[] = [];
  // espion : clés d'idempotence réellement transmises au PSP (les lectures n'en portent pas)
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
  const sender = new MoneyCommandSender(provider, wrap(memory));
  return { stack, memory, sender, keysSent };
}

const mitKey = (tenderId: string) =>
  settlementOperationKey({
    tripId: 'R',
    segmentId: '1',
    settlementVersion: 1,
    operationType: 'MIT_CHARGE',
    tenderId,
    instanceSeq: 1,
    attemptNo: 1,
  });

function mitCommand(
  w: ReturnType<typeof senderWorld>,
  id: string,
  vectorId: string,
  idem: string,
): MoneyCommand {
  const v = legVector(set, vectorId);
  const op = w.memory.operations.get(id);
  if (op === undefined) throw new Error(`opération ${id} absente`);
  return {
    operationId: id,
    kind: 'MIT_CHARGE',
    status: op.status,
    idemSent: idem,
    amountMinor: v.totalMinor,
    currency: v.currency,
    legs: { ...v.legsMinor } as LegAmounts,
    targetReference: null,
    providerReference: op.providerReference,
    mit: { reason: 'DELAYED_CHARGES' as MitReason, instrumentToken: 'tok_guarantee' },
  };
}

const debits = (w: ReturnType<typeof senderWorld>, key: string) =>
  w.stack.psp
    .movements()
    .filter((m) => m.operation === 'MIT_CHARGE' && m.merchantReference === key);

describe.each(COUNTRIES)('(c) PSP qui ignore l’idempotence — vecteur %s', (vectorId) => {
  const v = legVector(set, vectorId);

  it('délai dépassé APRÈS succès : lecture par notre clé avant tout renvoi, aucun second débit', async () => {
    const w = senderWorld({
      ignoreIdempotency: true,
      responses: { MIT_CHARGE: [{ kind: 'TIMEOUT_AFTER_SUCCESS' }] },
    });
    const k = mitKey('card');
    w.memory.addOperation({ id: 'm1', accountId: 'acc', idemSent: k, providerReference: null });
    expect(await w.sender.send(mitCommand(w, 'm1', vectorId, k))).toEqual({ outcome: 'UNKNOWN' });
    expect(await w.sender.send(mitCommand(w, 'm1', vectorId, k))).toMatchObject({
      outcome: 'SUCCEEDED',
    });
    expect(await w.sender.send(mitCommand(w, 'm1', vectorId, k))).toEqual({
      outcome: 'ALREADY_FINAL',
    });
    expect(w.keysSent).toEqual([k]);
    expect(w.stack.psp.calls('MIT_CHARGE')).toBe(1);
    expect(w.stack.psp.calls('LOOKUP')).toBe(1);
    expect(debits(w, k).map((m) => m.amountMinor)).toEqual([v.totalMinor]);
  });

  it('réponse illisible après succès : même règle (lecture d’abord), un seul débit', async () => {
    const w = senderWorld({
      ignoreIdempotency: true,
      responses: { MIT_CHARGE: [{ kind: 'UNREADABLE_AFTER_SUCCESS' }] },
    });
    const k = mitKey('card');
    w.memory.addOperation({ id: 'm1', accountId: 'acc', idemSent: k, providerReference: null });
    expect(await w.sender.send(mitCommand(w, 'm1', vectorId, k))).toEqual({ outcome: 'UNKNOWN' });
    expect(await w.sender.send(mitCommand(w, 'm1', vectorId, k))).toMatchObject({
      outcome: 'SUCCEEDED',
    });
    expect(w.keysSent).toEqual([k]);
    expect(debits(w, k)).toHaveLength(1);
  });

  it('délai dépassé AVANT traitement : lecture (inconnue du PSP) puis renvoi de la MÊME clé, un seul débit', async () => {
    const w = senderWorld({
      ignoreIdempotency: true,
      responses: { MIT_CHARGE: [{ kind: 'TIMEOUT_BEFORE' }] },
    });
    const k = mitKey('card');
    w.memory.addOperation({ id: 'm1', accountId: 'acc', idemSent: k, providerReference: null });
    expect(await w.sender.send(mitCommand(w, 'm1', vectorId, k))).toEqual({ outcome: 'UNKNOWN' });
    expect(await w.sender.send(mitCommand(w, 'm1', vectorId, k))).toMatchObject({
      outcome: 'SUCCEEDED',
    });
    expect(w.keysSent).toEqual([k, k]);
    expect(w.stack.psp.calls('LOOKUP')).toBe(1);
    expect(debits(w, k)).toHaveLength(1);
  });

  it('succès chez le PSP non enregistré chez nous (base en panne) : PSP honnête ⇒ un seul débit ; PSP sans idempotence ⇒ second débit DÉTECTABLE par le rapprochement par jambe, invisible à la lecture par clé', async () => {
    // notre écriture du statut échoue une fois juste après le succès du PSP : la commande reste
    // PENDING et le travailleur la rejoue (17 §4.3 point 2 : même clé, sans lecture préalable)
    const flaky = (memory: MemoryPaymentStore): OperationStatusStore => {
      let fail = true;
      return {
        apply: (input) => {
          if (fail) {
            fail = false;
            return Promise.reject(new Error('base indisponible'));
          }
          return memory.apply(input);
        },
      };
    };
    const run = async (ignoreIdempotency: boolean) => {
      const w = senderWorld({ ignoreIdempotency }, flaky);
      const k = mitKey('card');
      w.memory.addOperation({ id: 'm1', accountId: 'acc', idemSent: k, providerReference: null });
      const cmd = (): MoneyCommand => mitCommand(w, 'm1', vectorId, k);
      await expect(w.sender.send(cmd())).rejects.toThrow('base indisponible');
      expect(w.memory.operations.get('m1')?.status).toBe('PENDING');
      expect(await w.sender.send(cmd())).toMatchObject({ outcome: 'SUCCEEDED' });
      expect(w.memory.operations.get('m1')?.status).toBe('SUCCEEDED');
      // clé stable à chaque envoi
      expect(w.keysSent).toEqual([k, k]);
      return { w, k };
    };

    const honest = await run(false);
    expect(debits(honest.w, honest.k)).toHaveLength(1);

    const hostile = await run(true);
    const twice = debits(hostile.w, hostile.k);
    // le PSP hostile a débité deux fois la même clé (17 §6.5 point 5)
    expect(twice).toHaveLength(2);
    // la lecture par clé ne voit qu'UNE transaction : elle ne détecte rien
    const byKey = await hostile.w.stack.provider.getOperation({ merchantReference: hostile.k });
    expect(byKey).toMatchObject({ status: 'SUCCEEDED', amountMinor: v.totalMinor });
    // le rapprochement par jambe (17 §4.4 « rapprochement de filet », listLegBalances) voit,
    // jambe par jambe, exactement un débit de plus que notre unique opération SUCCEEDED
    const balances = await hostile.w.stack.provider.listLegBalances({});
    for (const leg of ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const) {
      const captured = balances
        .filter((b) => b.leg === leg)
        .reduce((s, b) => s + b.capturedMinor, 0n);
      expect(captured - v.legsMinor[leg]).toBe(v.legsMinor[leg]);
    }
  });
});

describe.each(COUNTRIES)('(d) panne prolongée puis reprise — vecteur %s', (vectorId) => {
  const v = legVector(set, vectorId);

  it('12 refus de connexion consécutifs puis reprise : rien d’appliqué pendant la panne, même clé, un seul débit', async () => {
    const outage: FakeResponse[] = Array.from({ length: 12 }, () => ({ kind: 'UNAVAILABLE' }));
    // même un PSP sans idempotence ne débite qu'une fois : rien n'est exécuté pendant la panne
    const w = senderWorld({ ignoreIdempotency: true, responses: { MIT_CHARGE: outage } });
    const k = mitKey('card');
    w.memory.addOperation({ id: 'm1', accountId: 'acc', idemSent: k, providerReference: null });
    for (let i = 0; i < 12; i += 1) {
      w.stack.clock.now += 60_000;
      expect(await w.sender.send(mitCommand(w, 'm1', vectorId, k))).toEqual({
        outcome: 'NOT_SENT',
      });
      expect(w.memory.operations.get('m1')?.status).toBe('PENDING');
    }
    expect(w.memory.statusEvents).toEqual([]);
    expect(w.stack.psp.movements()).toEqual([]);
    expect(await w.sender.send(mitCommand(w, 'm1', vectorId, k))).toMatchObject({
      outcome: 'SUCCEEDED',
    });
    expect(w.keysSent).toEqual(Array.from({ length: 13 }, () => k));
    expect(debits(w, k).map((m) => m.amountMinor)).toEqual([v.totalMinor]);
  });

  it('succès perdu dans la panne, puis lectures en panne : jamais de renvoi tant que la lecture échoue, puis l’état faisant foi', async () => {
    const w = senderWorld({
      ignoreIdempotency: true,
      responses: {
        MIT_CHARGE: [
          { kind: 'UNAVAILABLE' },
          { kind: 'UNAVAILABLE' },
          { kind: 'UNAVAILABLE' },
          { kind: 'TIMEOUT_AFTER_SUCCESS' },
        ],
        LOOKUP: [
          { kind: 'UNAVAILABLE' },
          { kind: 'TIMEOUT_BEFORE' },
          { kind: 'UNAVAILABLE' },
          { kind: 'TIMEOUT_AFTER_SUCCESS' },
          { kind: 'UNAVAILABLE' },
        ],
      },
    });
    const k = mitKey('card');
    w.memory.addOperation({ id: 'm1', accountId: 'acc', idemSent: k, providerReference: null });
    const send = () => w.sender.send(mitCommand(w, 'm1', vectorId, k));
    for (let i = 0; i < 3; i += 1) expect(await send()).toEqual({ outcome: 'NOT_SENT' });
    // le PSP débite, la réponse se perd
    expect(await send()).toEqual({ outcome: 'UNKNOWN' });
    // cinq rejeux pendant la panne de lecture : aucun renvoi
    for (let i = 0; i < 5; i += 1) {
      w.stack.clock.now += 5 * 60_000;
      expect(await send()).toEqual({ outcome: 'UNKNOWN' });
      expect(w.memory.operations.get('m1')?.status).toBe('UNKNOWN');
    }
    expect(w.stack.psp.calls('MIT_CHARGE')).toBe(4);
    // lecture revenue : l'état faisant foi est appliqué (POLL), sans renvoi
    expect(await send()).toMatchObject({ outcome: 'SUCCEEDED' });
    expect(w.stack.psp.calls('MIT_CHARGE')).toBe(4);
    expect(w.stack.psp.calls('LOOKUP')).toBe(6);
    expect(w.keysSent).toEqual([k, k, k, k]);
    expect(debits(w, k)).toHaveLength(1);
    expect(w.memory.statusEvents.map((e) => [e.status, e.source, e.outcome])).toEqual([
      ['UNKNOWN', 'API_RESPONSE', 'APPLIED'],
      ['SUCCEEDED', 'POLL', 'APPLIED'],
    ]);
  });
});
