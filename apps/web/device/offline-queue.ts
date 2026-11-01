/**
 * Interface `OfflineQueue` (17 §6.2, TRP-057) : file locale **chiffrée**, avec reprise après
 * fermeture de l'application. La logique (ordre, empreinte, chiffrement, vidage) est ici et ne
 * dépend d'aucune API de navigateur hormis WebCrypto ; le stockage est injecté (`QueueStore`) :
 * IndexedDB pour le web (`offline-queue.idb.ts`), mémoire pour les tests, stockage natif plus tard.
 */
import { getSubtle, sha256Hex } from './hash';

export interface QueuedItemMeta {
  readonly id: string;
  /** Ordre d'arrivée, indépendant de l'horloge de l'appareil (qui peut sauter). */
  readonly seq: number;
  readonly kind: string;
  readonly createdAtDevice: string;
  readonly byteLength: number;
  /** Empreinte du contenu en clair, calculée sur l'appareil (TRP-057). */
  readonly sha256Hex: string;
}

export interface StoredRecord {
  readonly meta: QueuedItemMeta;
  readonly iv: Uint8Array<ArrayBuffer>;
  readonly ciphertext: Uint8Array<ArrayBuffer>;
}

export interface QueueStore {
  get(id: string): Promise<StoredRecord | undefined>;
  put(record: StoredRecord): Promise<void>;
  delete(id: string): Promise<void>;
  all(): Promise<StoredRecord[]>;
}

export interface PayloadCipher {
  encrypt(
    plain: Uint8Array<ArrayBuffer>,
  ): Promise<{ iv: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> }>;
  decrypt(
    iv: Uint8Array<ArrayBuffer>,
    ciphertext: Uint8Array<ArrayBuffer>,
  ): Promise<Uint8Array<ArrayBuffer>>;
}

export class QueueIntegrityError extends Error {
  constructor(readonly itemId: string) {
    super(`empreinte différente pour l'élément ${itemId}`);
    this.name = 'QueueIntegrityError';
  }
}

export interface DrainReport {
  readonly sent: readonly string[];
  readonly failed: { readonly id: string; readonly error: string } | null;
  readonly remaining: number;
}

export interface OfflineQueue {
  enqueue(kind: string, payload: Uint8Array<ArrayBuffer>): Promise<QueuedItemMeta>;
  /** Éléments en attente, dans l'ordre d'arrivée. */
  list(): Promise<QueuedItemMeta[]>;
  /** Contenu déchiffré ; lève `QueueIntegrityError` si l'empreinte ne correspond plus. */
  read(id: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
  remove(id: string): Promise<void>;
  /**
   * Envoie dans l'ordre et retire chaque élément envoyé. S'arrête au premier échec pour garder
   * l'ordre ; l'élément fautif reste dans la file.
   */
  drain(
    send: (meta: QueuedItemMeta, payload: Uint8Array<ArrayBuffer>) => Promise<void>,
  ): Promise<DrainReport>;
}

export interface OfflineQueueDeps {
  readonly store: QueueStore;
  readonly cipher: PayloadCipher;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly subtle?: SubtleCrypto;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function createOfflineQueue(deps: OfflineQueueDeps): OfflineQueue {
  const { store, cipher, now, newId, subtle } = deps;

  async function sorted(): Promise<StoredRecord[]> {
    const records = await store.all();
    return records.sort((a, b) => a.meta.seq - b.meta.seq);
  }

  async function read(id: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const record = await store.get(id);
    if (record === undefined) return undefined;
    const plain = await cipher.decrypt(record.iv, record.ciphertext);
    if ((await sha256Hex(plain, subtle)) !== record.meta.sha256Hex) {
      throw new QueueIntegrityError(id);
    }
    return plain;
  }

  return {
    async enqueue(kind, payload) {
      const existing = await store.all();
      const seq = existing.reduce((max, r) => Math.max(max, r.meta.seq), 0) + 1;
      const meta: QueuedItemMeta = {
        id: newId(),
        seq,
        kind,
        createdAtDevice: now().toISOString(),
        byteLength: payload.byteLength,
        sha256Hex: await sha256Hex(payload, subtle),
      };
      const { iv, ciphertext } = await cipher.encrypt(payload);
      await store.put({ meta, iv, ciphertext });
      return meta;
    },
    async list() {
      return (await sorted()).map((r) => r.meta);
    },
    read,
    remove: (id) => store.delete(id),
    async drain(send) {
      const sent: string[] = [];
      const records = await sorted();
      for (const record of records) {
        const id = record.meta.id;
        try {
          const payload = await read(id);
          if (payload === undefined) continue;
          await send(record.meta, payload);
          await store.delete(id);
          sent.push(id);
        } catch (error) {
          return {
            sent,
            failed: { id, error: errorMessage(error) },
            remaining: records.length - sent.length,
          };
        }
      }
      return { sent, failed: null, remaining: records.length - sent.length };
    },
  };
}

/** Stockage en mémoire : tests, et repli explicite (rien ne survit à un rechargement). */
export function createMemoryQueueStore(): QueueStore {
  const records = new Map<string, StoredRecord>();
  return {
    get: async (id) => records.get(id),
    put: async (record) => {
      records.set(record.meta.id, record);
    },
    delete: async (id) => {
      records.delete(id);
    },
    all: async () => [...records.values()],
  };
}

/** Clé AES-GCM 256 non exportable : elle peut être rangée dans IndexedDB sans être lisible. */
export function generateQueueKey(subtle?: SubtleCrypto): Promise<CryptoKey> {
  return getSubtle(subtle).generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export function createAesGcmCipher(
  key: CryptoKey,
  options: {
    readonly subtle?: SubtleCrypto;
    readonly randomBytes?: (n: number) => Uint8Array<ArrayBuffer>;
  } = {},
): PayloadCipher {
  const randomBytes =
    options.randomBytes ?? ((n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n)));
  return {
    async encrypt(plain) {
      const iv = randomBytes(12);
      const ciphertext = new Uint8Array(
        await getSubtle(options.subtle).encrypt({ name: 'AES-GCM', iv }, key, plain),
      );
      return { iv, ciphertext };
    },
    async decrypt(iv, ciphertext) {
      return new Uint8Array(
        await getSubtle(options.subtle).decrypt({ name: 'AES-GCM', iv }, key, ciphertext),
      );
    },
  };
}
