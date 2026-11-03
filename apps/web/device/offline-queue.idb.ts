/**
 * Adaptateur web de `OfflineQueue` : IndexedDB (éléments chiffrés + clé AES-GCM non exportable).
 * Si iOS purge le stockage du site, la clé et les éléments disparaissent ensemble : c'est
 * précisément ce que mesure le test de purge (US-026).
 */
import { idbDelete, idbGet, idbGetAll, idbPut, openIdb } from './idb';
import {
  createAesGcmCipher,
  createOfflineQueue,
  generateQueueKey,
  type OfflineQueue,
  type QueueStore,
  type StoredRecord,
} from './offline-queue';

const ITEMS = 'items';
const KEYS = 'keys';
const QUEUE_KEY_ID = 'queue-key';

export async function openIdbOfflineQueue(dbName: string): Promise<OfflineQueue> {
  const db = await openIdb(dbName, [ITEMS, KEYS]);
  let key = await idbGet<CryptoKey>(db, KEYS, QUEUE_KEY_ID);
  if (key === undefined) {
    key = await generateQueueKey();
    await idbPut(db, KEYS, QUEUE_KEY_ID, key);
  }
  const store: QueueStore = {
    get: (id) => idbGet<StoredRecord>(db, ITEMS, id),
    put: (record) => idbPut(db, ITEMS, record.meta.id, record),
    delete: (id) => idbDelete(db, ITEMS, id),
    all: () => idbGetAll<StoredRecord>(db, ITEMS),
  };
  return createOfflineQueue({
    store,
    cipher: createAesGcmCipher(key),
    now: () => new Date(),
    newId: () => globalThis.crypto.randomUUID(),
  });
}
