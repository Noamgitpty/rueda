'use client';

/**
 * Laboratoire PWA iOS (US-026), prototype jetable. Chaque test passe par les interfaces de
 * `apps/web/device` (CameraCapture, OfflineQueue, DeviceGeo) et produit un résultat JSON copiable.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  DEFAULT_PHOTO_POLICY,
  assessPickedFile,
  createWebCameraCapture,
  createWebDeviceGeo,
  idbGet,
  idbPut,
  openIdb,
  openIdbOfflineQueue,
  type CameraSession,
  type CapturedPhoto,
  type OfflineQueue,
} from '../../../device';
import { LAB_BASE_PATH } from './lab-flag';
import { LAB_TEXT, TEST_TEXT } from './lab-text';
import styles from './lab.module.css';
import {
  LAB_TEST_IDS,
  PURGE_TEST_MIN_DAYS,
  buildReport,
  markerAgeDays,
  parseIosVersion,
  purgeVerdict,
  toPrettyJson,
  type LabResult,
  type LabStatus,
  type LabTestId,
} from './report';
import { LAB_CACHE_NAME } from './sw-script';

const RESULTS_KEY = 'rueda-lab-pwa-ios-results';
const MARKER_KEY = 'rueda-lab-pwa-ios-marker';
const MARKER_DB = 'rueda-lab-pwa-ios-marker';
const MARKER_CACHE_URL = `${LAB_BASE_PATH}/__marker`;
const QUEUE_DB = 'rueda-lab-pwa-ios-queue';
const MARKER_PLACES = ['localStorage', 'indexedDB', 'cacheStorage'] as const;

type Results = Partial<Record<LabTestId, LabResult>>;

function describeError(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { errorName: error.name, errorMessage: error.message }
    : { error: String(error) };
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function randomPayload(bytes: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes);
  for (let offset = 0; offset < bytes; offset += 65_536) {
    crypto.getRandomValues(out.subarray(offset, Math.min(bytes, offset + 65_536)));
  }
  return out;
}

function readStoredResults(): Results {
  try {
    const raw = window.localStorage.getItem(RESULTS_KEY);
    return raw === null ? {} : (JSON.parse(raw) as Results);
  } catch {
    return {};
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text }: { readonly text: string }) {
  const [label, setLabel] = useState<string>(LAB_TEXT.copy);
  return (
    <button
      type="button"
      onClick={async () => setLabel((await copyText(text)) ? LAB_TEXT.copied : LAB_TEXT.copyFailed)}
    >
      {label}
    </button>
  );
}

function TestSection(props: {
  readonly id: LabTestId;
  readonly result: LabResult | undefined;
  readonly children: ReactNode;
}) {
  const text = TEST_TEXT[props.id];
  const json = props.result === undefined ? null : toPrettyJson(props.result);
  return (
    <section className={styles.section} aria-labelledby={`lab-${props.id}`}>
      <h2 id={`lab-${props.id}`}>
        {text.title} {props.result ? `[${props.result.status}]` : ''}
      </h2>
      <p className={styles.hint}>{text.hint}</p>
      <div className={styles.actions}>{props.children}</div>
      {json === null ? (
        <p>{LAB_TEXT.notRun}</p>
      ) : (
        <>
          <pre className={styles.result}>{json}</pre>
          <CopyButton text={json} />
        </>
      )}
    </section>
  );
}

export function LabClient() {
  const [results, setResults] = useState<Results>({});
  const [secure, setSecure] = useState(true);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Vide au rendu serveur : l'agent utilisateur n'est connu qu'après le montage (pas d'écart d'hydratation).
  const [userAgent, setUserAgent] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<CameraSession | null>(null);
  const queueRef = useRef<OfflineQueue | null>(null);

  const record = useCallback(
    (test: LabTestId, status: LabStatus, details: Record<string, unknown>) => {
      setResults((previous) => {
        const next: Results = {
          ...previous,
          [test]: { test, status, at: new Date().toISOString(), details },
        };
        try {
          window.localStorage.setItem(RESULTS_KEY, JSON.stringify(next));
        } catch {
          // Stockage indisponible : les résultats restent affichés, à copier avant de quitter.
        }
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    setResults(readStoredResults());
    setUserAgent(navigator.userAgent);
    setSecure(window.isSecureContext);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (data?.type === 'lab-sync') {
        record('background-sync', 'pass', { syncEventReceived: event.data as unknown });
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      sessionRef.current?.stop();
    };
  }, [record]);

  useEffect(() => {
    if (photo === null) return undefined;
    const url = URL.createObjectURL(photo.blob);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const guarded = (test: LabTestId, fn: () => Promise<void>) => async () => {
    try {
      await fn();
    } catch (error) {
      record(test, 'fail', describeError(error));
    }
  };

  const camera = () =>
    createWebCameraCapture({
      isSecureContext: window.isSecureContext,
      mediaDevices: navigator.mediaDevices,
    });

  const getQueue = async (): Promise<OfflineQueue> => {
    queueRef.current ??= await openIdbOfflineQueue(QUEUE_DB);
    return queueRef.current;
  };

  // 1. Environnement
  const runEnvironment = guarded('environment', async () => {
    const nav = navigator as Navigator & { standalone?: boolean };
    record('environment', window.isSecureContext ? 'pass' : 'warn', {
      isSecureContext: window.isSecureContext,
      origin: window.location.origin,
      standalone: isStandalone(),
      navigatorStandalone: nav.standalone ?? null,
      userAgent: navigator.userAgent,
      iosVersionFromUserAgent: parseIosVersion(navigator.userAgent),
      onLine: navigator.onLine,
      screen: { width: window.screen.width, height: window.screen.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      apis: {
        serviceWorker: 'serviceWorker' in navigator,
        getUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
        geolocation: 'geolocation' in navigator,
        indexedDB: typeof indexedDB !== 'undefined',
        storagePersist: typeof navigator.storage?.persist === 'function',
        storageEstimate: typeof navigator.storage?.estimate === 'function',
        cryptoSubtle: typeof crypto?.subtle !== 'undefined',
        syncManager: 'SyncManager' in window,
        clipboard: typeof navigator.clipboard?.writeText === 'function',
      },
    });
  });

  // 2. Caméra en direct
  const openCamera = guarded('camera-live', async () => {
    const capture = camera();
    const availability = capture.availability();
    if (!availability.available) {
      record('camera-live', 'fail', { adapter: capture.adapter, availability });
      return;
    }
    if (videoRef.current === null) throw new Error('élément vidéo absent');
    sessionRef.current?.stop();
    sessionRef.current = await capture.open(videoRef.current);
    setCameraOpen(true);
    record('camera-live', 'info', {
      adapter: capture.adapter,
      step: 'camera-opened',
      trackSettings: sessionRef.current.trackSettings,
    });
  });

  const takePhoto = guarded('camera-live', async () => {
    const session = sessionRef.current;
    if (session === null) throw new Error('caméra non ouverte');
    const shot = await session.capture();
    setPhoto(shot);
    const { blob: _blob, ...summary } = shot;
    void _blob;
    record('camera-live', shot.overBudget ? 'warn' : 'pass', {
      step: 'photo-taken',
      policy: DEFAULT_PHOTO_POLICY,
      trackSettings: session.trackSettings,
      photo: summary,
      galleryPossible: false,
    });
  });

  const closeCamera = () => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setCameraOpen(false);
  };

  // 3. Entrée fichier « capture »
  const onFilePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file === undefined) {
      record('file-input', 'info', { picked: false });
      return;
    }
    const assessment = assessPickedFile(file, Date.now());
    record('file-input', assessment.likelyFromLibrary ? 'fail' : 'info', {
      picked: true,
      type: file.type,
      size: file.size,
      lastModified: new Date(file.lastModified).toISOString(),
      ...assessment,
      observedLibraryOffered: results['file-input']?.details['observedLibraryOffered'] ?? null,
    });
    event.target.value = '';
  };

  const noteLibraryOffered = (offered: boolean) => {
    const previous = results['file-input'];
    const details = { ...(previous?.details ?? {}), observedLibraryOffered: offered };
    const status: LabStatus =
      offered || previous?.details['likelyFromLibrary'] === true ? 'fail' : 'info';
    record('file-input', status, details);
  };

  // 4. Stockage persistant
  const runPersist = guarded('storage-persist', async () => {
    const storage = navigator.storage;
    if (storage === undefined) {
      record('storage-persist', 'fail', { storageManager: false });
      return;
    }
    const before = typeof storage.persisted === 'function' ? await storage.persisted() : null;
    const granted = typeof storage.persist === 'function' ? await storage.persist() : null;
    const estimate = typeof storage.estimate === 'function' ? await storage.estimate() : null;
    record('storage-persist', granted === true ? 'pass' : 'warn', {
      persistedBefore: before,
      persistGranted: granted,
      quotaBytes: estimate?.quota ?? null,
      usageBytes: estimate?.usage ?? null,
      standalone: isStandalone(),
    });
  });

  // 5. Témoin de purge
  const writeMarker = guarded('storage-marker', async () => {
    const writtenAt = new Date().toISOString();
    const marker = { writtenAt, standalone: isStandalone() };
    const written: string[] = [];
    try {
      window.localStorage.setItem(MARKER_KEY, JSON.stringify(marker));
      written.push('localStorage');
    } catch {
      // indisponible : visible dans le rapport
    }
    try {
      const db = await openIdb(MARKER_DB, ['kv']);
      await idbPut(db, 'kv', 'marker', marker);
      written.push('indexedDB');
    } catch {
      // indisponible
    }
    try {
      const cache = await caches.open(`${LAB_CACHE_NAME}-marker`);
      await cache.put(MARKER_CACHE_URL, new Response(JSON.stringify(marker)));
      written.push('cacheStorage');
    } catch {
      // indisponible (contexte non sécurisé)
    }
    record('storage-marker', 'info', { step: 'written', marker, written });
  });

  const readMarker = guarded('storage-marker', async () => {
    const now = new Date();
    const found: { where: string; writtenAt: string; ageDays: number; standalone: unknown }[] = [];
    const add = (where: string, raw: unknown) => {
      const m = raw as { writtenAt?: string; standalone?: unknown } | undefined;
      if (m?.writtenAt) {
        found.push({
          where,
          writtenAt: m.writtenAt,
          ageDays: markerAgeDays(m.writtenAt, now),
          standalone: m.standalone,
        });
      }
    };
    try {
      const raw = window.localStorage.getItem(MARKER_KEY);
      if (raw !== null) add('localStorage', JSON.parse(raw));
    } catch {
      // absent
    }
    try {
      const db = await openIdb(MARKER_DB, ['kv']);
      add('indexedDB', await idbGet(db, 'kv', 'marker'));
    } catch {
      // absent
    }
    try {
      const hit = await (await caches.open(`${LAB_CACHE_NAME}-marker`)).match(MARKER_CACHE_URL);
      if (hit) add('cacheStorage', await hit.json());
    } catch {
      // absent
    }
    record(
      'storage-marker',
      purgeVerdict({ found, places: MARKER_PLACES, minDays: PURGE_TEST_MIN_DAYS }),
      {
        step: 'read',
        found,
        places: MARKER_PLACES,
        minDays: PURGE_TEST_MIN_DAYS,
        standalone: isStandalone(),
      },
    );
  });

  // 6. File hors ligne
  const enqueue = guarded('offline-queue', async () => {
    const queue = await getQueue();
    const payload = photo
      ? new Uint8Array(await photo.blob.arrayBuffer())
      : randomPayload(256 * 1024);
    const meta = await queue.enqueue(photo ? 'photo' : 'test-bytes', payload);
    const items = await queue.list();
    record('offline-queue', 'info', {
      step: 'enqueued',
      item: meta,
      matchesPhotoHash: photo ? photo.sha256Hex === meta.sha256Hex : null,
      pending: items.length,
    });
  });

  const listQueue = guarded('offline-queue', async () => {
    const queue = await getQueue();
    const items = await queue.list();
    const verified: { id: string; ok: boolean; error?: string }[] = [];
    for (const item of items) {
      try {
        verified.push({ id: item.id, ok: (await queue.read(item.id)) !== undefined });
      } catch (error) {
        verified.push({ id: item.id, ok: false, error: String(error) });
      }
    }
    const allOk = verified.every((v) => v.ok);
    record('offline-queue', items.length > 0 && allOk ? 'pass' : allOk ? 'info' : 'fail', {
      step: 'listed',
      pending: items.length,
      items,
      verified,
      standalone: isStandalone(),
    });
  });

  const drainQueue = guarded('offline-queue', async () => {
    const queue = await getQueue();
    // Envoi simulé : aucun serveur de réception avant US-302 ; on vérifie seulement l'empreinte.
    const report = await queue.drain(async () => undefined);
    record('offline-queue', report.failed === null ? 'pass' : 'fail', {
      step: 'drained-simulated',
      ...report,
    });
  });

  // 7. Géolocalisation
  const locate = guarded('geolocation', async () => {
    const geo = createWebDeviceGeo({
      isSecureContext: window.isSecureContext,
      geolocation: navigator.geolocation,
      nowMs: () => performance.now(),
    });
    const reading = await geo.locate();
    record('geolocation', reading.status === 'ok' ? 'pass' : 'fail', {
      adapter: geo.adapter,
      reading,
    });
  });

  // 8. Service worker
  const registerSw = guarded('service-worker', async () => {
    if (!('serviceWorker' in navigator)) {
      record('service-worker', 'fail', {
        supported: false,
        isSecureContext: window.isSecureContext,
      });
      return;
    }
    const registration = await navigator.serviceWorker.register(`${LAB_BASE_PATH}/sw.js`, {
      scope: LAB_BASE_PATH,
    });
    await navigator.serviceWorker.ready;
    const cache = await caches.open(LAB_CACHE_NAME);
    const cached = (await cache.keys()).map((r) => new URL(r.url).pathname);
    record('service-worker', navigator.serviceWorker.controller ? 'pass' : 'info', {
      supported: true,
      scope: registration.scope,
      controlled: navigator.serviceWorker.controller !== null,
      onLine: navigator.onLine,
      cachedCount: cached.length,
      cachedShell: cached.includes(LAB_BASE_PATH),
      note: 'controlled=false au premier passage : recharger, puis tester en mode avion',
    });
  });

  // 9. Synchronisation en arrière-plan
  const trySync = guarded('background-sync', async () => {
    if (!('serviceWorker' in navigator)) {
      record('background-sync', 'warn', { serviceWorker: false });
      return;
    }
    const registration = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      sync?: { register(tag: string): Promise<void> };
      periodicSync?: unknown;
    };
    if (registration.sync === undefined) {
      record('background-sync', 'warn', {
        syncManager: false,
        periodicSync: registration.periodicSync !== undefined,
        consequence: 'envoi seulement quand l’application est ouverte (au retour du réseau)',
      });
      return;
    }
    await registration.sync.register('lab-test');
    record('background-sync', 'info', { syncManager: true, registered: 'lab-test' });
  });

  // 10. Installation
  const checkInstall = guarded('install', async () => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const manifestResponse = await fetch(`${LAB_BASE_PATH}/manifest.webmanifest`);
    record('install', isStandalone() ? 'pass' : 'info', {
      standalone: isStandalone(),
      displayModeStandalone: window.matchMedia('(display-mode: standalone)').matches,
      navigatorStandalone: nav.standalone ?? null,
      manifestStatus: manifestResponse.status,
    });
  });

  const reportJson =
    userAgent === null ? '' : toPrettyJson(buildReport({ results, userAgent, now: new Date() }));

  const clearAll = () => {
    setResults({});
    try {
      window.localStorage.removeItem(RESULTS_KEY);
    } catch {
      // rien
    }
  };

  return (
    <main className={styles.lab}>
      <h1>{LAB_TEXT.title}</h1>
      <p>{LAB_TEXT.intro}</p>
      {secure ? null : (
        <p role="alert">
          <strong>{LAB_TEXT.insecure}</strong>
        </p>
      )}

      <TestSection id="environment" result={results.environment}>
        <button type="button" onClick={runEnvironment}>
          {LAB_TEXT.run}
        </button>
      </TestSection>

      <TestSection id="camera-live" result={results['camera-live']}>
        <button type="button" onClick={openCamera}>
          Ouvrir la caméra
        </button>
        <button type="button" onClick={takePhoto} disabled={!cameraOpen}>
          Prendre la photo
        </button>
        <button type="button" onClick={closeCamera} disabled={!cameraOpen}>
          Fermer la caméra
        </button>
      </TestSection>
      <video ref={videoRef} className={styles.preview} playsInline muted hidden={!cameraOpen} />
      {photoUrl === null ? null : (
        <img className={styles.preview} src={photoUrl} alt="Dernière photo prise" />
      )}

      <TestSection id="file-input" result={results['file-input']}>
        <label>
          Choisir via l’entrée fichier{' '}
          <input type="file" accept="image/*" capture="environment" onChange={onFilePicked} />
        </label>
        <button type="button" onClick={() => noteLibraryOffered(true)}>
          iOS a proposé la photothèque : oui
        </button>
        <button type="button" onClick={() => noteLibraryOffered(false)}>
          iOS a proposé la photothèque : non
        </button>
      </TestSection>

      <TestSection id="storage-persist" result={results['storage-persist']}>
        <button type="button" onClick={runPersist}>
          {LAB_TEXT.run}
        </button>
      </TestSection>

      <TestSection id="storage-marker" result={results['storage-marker']}>
        <button type="button" onClick={writeMarker}>
          Écrire le témoin (jour 0)
        </button>
        <button type="button" onClick={readMarker}>
          Lire le témoin
        </button>
      </TestSection>

      <TestSection id="offline-queue" result={results['offline-queue']}>
        <button type="button" onClick={enqueue}>
          Ajouter à la file
        </button>
        <button type="button" onClick={listQueue}>
          Lister et vérifier
        </button>
        <button type="button" onClick={drainQueue}>
          Vider (envoi simulé)
        </button>
      </TestSection>

      <TestSection id="geolocation" result={results.geolocation}>
        <button type="button" onClick={locate}>
          {LAB_TEXT.run}
        </button>
      </TestSection>

      <TestSection id="service-worker" result={results['service-worker']}>
        <button type="button" onClick={registerSw}>
          Enregistrer et vérifier
        </button>
      </TestSection>

      <TestSection id="background-sync" result={results['background-sync']}>
        <button type="button" onClick={trySync}>
          {LAB_TEXT.run}
        </button>
      </TestSection>

      <TestSection id="install" result={results.install}>
        <button type="button" onClick={checkInstall}>
          {LAB_TEXT.run}
        </button>
      </TestSection>

      <section className={styles.section} aria-labelledby="lab-report">
        <h2 id="lab-report">Rapport complet ({LAB_TEST_IDS.length} tests)</h2>
        <div className={styles.actions}>
          <CopyButton text={reportJson} />
          <button type="button" onClick={clearAll}>
            {LAB_TEXT.clearAll}
          </button>
        </div>
        <textarea
          className={`${styles.result} ${styles.preview}`}
          readOnly
          rows={12}
          value={reportJson}
          aria-label="Rapport JSON"
        />
      </section>
    </main>
  );
}
