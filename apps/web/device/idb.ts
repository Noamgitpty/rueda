/**
 * Aide minimale autour d'IndexedDB (promesses). Navigateur seulement ; non testée en unitaire
 * (pas d'IndexedDB dans Node) : elle est exercée par la page de laboratoire sur l'appareil.
 */
function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('erreur IndexedDB'));
  });
}

export function openIdb(name: string, storeNames: readonly string[]): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB indisponible'));
  const request = indexedDB.open(name, 1);
  request.onupgradeneeded = () => {
    for (const storeName of storeNames) {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    }
  };
  return promisify(request);
}

export function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return promisify(db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<
    T | undefined
  >;
}

export async function idbPut(
  db: IDBDatabase,
  store: string,
  key: string,
  value: unknown,
): Promise<void> {
  await promisify(db.transaction(store, 'readwrite').objectStore(store).put(value, key));
}

export async function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  await promisify(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

export function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return promisify(db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>;
}
