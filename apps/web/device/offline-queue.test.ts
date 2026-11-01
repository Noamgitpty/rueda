import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  QueueIntegrityError,
  createAesGcmCipher,
  createMemoryQueueStore,
  createOfflineQueue,
  generateQueueKey,
  type QueueStore,
} from './offline-queue';

// Oracle indépendant : l'empreinte attendue vient de node:crypto, pas du code testé (WebCrypto).
const oracleSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function makeQueue(store: QueueStore = createMemoryQueueStore()) {
  let n = 0;
  const key = await generateQueueKey();
  const queue = createOfflineQueue({
    store,
    cipher: createAesGcmCipher(key),
    now: () => new Date('2026-10-31T12:00:00.000Z'),
    newId: () => `id-${++n}`,
  });
  return { queue, store };
}

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('OfflineQueue', () => {
  it('met en file avec empreinte SHA-256 du contenu en clair et heure appareil', async () => {
    const { queue } = await makeQueue();
    const payload = bytes(1, 2, 3, 4);
    const meta = await queue.enqueue('photo', payload);
    expect(meta).toEqual({
      id: 'id-1',
      seq: 1,
      kind: 'photo',
      createdAtDevice: '2026-10-31T12:00:00.000Z',
      byteLength: 4,
      sha256Hex: oracleSha256(payload),
    });
  });

  it('chiffre au repos : le stockage ne contient pas le clair', async () => {
    const { queue, store } = await makeQueue();
    const payload = new TextEncoder().encode('photo-de-preuve-en-clair');
    const meta = await queue.enqueue('photo', payload);
    const stored = await store.get(meta.id);
    expect(stored?.iv.byteLength).toBe(12);
    expect(Buffer.from(stored!.ciphertext).includes(Buffer.from(payload))).toBe(false);
    expect(await queue.read(meta.id)).toEqual(payload);
  });

  it('liste dans l’ordre d’arrivée, quel que soit l’ordre du stockage', async () => {
    const memory = createMemoryQueueStore();
    const reversed: QueueStore = { ...memory, all: async () => (await memory.all()).reverse() };
    const { queue } = await makeQueue(reversed);
    await queue.enqueue('a', bytes(1));
    await queue.enqueue('b', bytes(2));
    await queue.enqueue('c', bytes(3));
    expect((await queue.list()).map((m) => m.kind)).toEqual(['a', 'b', 'c']);
  });

  it('reprise : une nouvelle instance sur le même stockage retrouve les éléments', async () => {
    const store = createMemoryQueueStore();
    const key = await generateQueueKey();
    const make = () =>
      createOfflineQueue({
        store,
        cipher: createAesGcmCipher(key),
        now: () => new Date(),
        newId: () => crypto.randomUUID(),
      });
    const meta = await make().enqueue('photo', bytes(9, 9));
    const reopened = make();
    expect((await reopened.list()).map((m) => m.id)).toEqual([meta.id]);
    expect(await reopened.read(meta.id)).toEqual(bytes(9, 9));
  });

  it('détecte une altération (empreinte différente)', async () => {
    const { queue, store } = await makeQueue();
    const meta = await queue.enqueue('photo', bytes(1, 2, 3));
    const record = (await store.get(meta.id))!;
    await store.put({ ...record, meta: { ...record.meta, sha256Hex: oracleSha256(bytes(0)) } });
    await expect(queue.read(meta.id)).rejects.toBeInstanceOf(QueueIntegrityError);
  });

  it('rejette un chiffré modifié (AES-GCM authentifié)', async () => {
    const { queue, store } = await makeQueue();
    const meta = await queue.enqueue('photo', bytes(1, 2, 3));
    const record = (await store.get(meta.id))!;
    const tampered = new Uint8Array(record.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    await store.put({ ...record, ciphertext: tampered });
    await expect(queue.read(meta.id)).rejects.toThrow();
  });

  it('read renvoie undefined pour un identifiant inconnu', async () => {
    const { queue } = await makeQueue();
    expect(await queue.read('absent')).toBeUndefined();
  });

  it('drain envoie dans l’ordre et retire les éléments envoyés', async () => {
    const { queue } = await makeQueue();
    await queue.enqueue('a', bytes(1));
    await queue.enqueue('b', bytes(2));
    const received: string[] = [];
    const report = await queue.drain(async (meta, payload) => {
      expect(oracleSha256(payload)).toBe(meta.sha256Hex);
      received.push(meta.kind);
    });
    expect(received).toEqual(['a', 'b']);
    expect(report).toEqual({ sent: ['id-1', 'id-2'], failed: null, remaining: 0 });
    expect(await queue.list()).toEqual([]);
  });

  it('drain s’arrête au premier échec et garde l’élément fautif et les suivants', async () => {
    const { queue } = await makeQueue();
    await queue.enqueue('a', bytes(1));
    await queue.enqueue('b', bytes(2));
    await queue.enqueue('c', bytes(3));
    const report = await queue.drain(async (meta) => {
      if (meta.kind === 'b') throw new Error('réseau coupé');
    });
    expect(report.sent).toEqual(['id-1']);
    expect(report.failed).toEqual({ id: 'id-2', error: 'Error: réseau coupé' });
    expect(report.remaining).toBe(2);
    expect((await queue.list()).map((m) => m.kind)).toEqual(['b', 'c']);
  });

  it('seq continue après un retrait (pas de réutilisation d’un rang plus petit)', async () => {
    const { queue } = await makeQueue();
    const a = await queue.enqueue('a', bytes(1));
    const b = await queue.enqueue('b', bytes(2));
    await queue.remove(a.id);
    const c = await queue.enqueue('c', bytes(3));
    expect(c.seq).toBeGreaterThan(b.seq);
  });
});

describe('createAesGcmCipher', () => {
  it('utilise un IV neuf à chaque chiffrement', async () => {
    const cipher = createAesGcmCipher(await generateQueueKey());
    const one = await cipher.encrypt(bytes(1, 2));
    const two = await cipher.encrypt(bytes(1, 2));
    expect(Buffer.from(one.iv).equals(Buffer.from(two.iv))).toBe(false);
  });

  it('génère une clé non exportable', async () => {
    const key = await generateQueueKey();
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
  });
});
