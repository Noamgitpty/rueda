/**
 * Point d'entrée public des interfaces d'appareil du comptoir (17 §6.2, ADR-005, ADR-039).
 * Le reste de l'application n'accède à la caméra, au stockage hors ligne et à la position que par
 * ces trois interfaces ; changer de technique (PWA, enveloppe native, terminal fourni) ne remplace
 * que les adaptateurs `*.web.ts` / `*.idb.ts`.
 */
export {
  DEFAULT_PHOTO_POLICY,
  FRESH_FILE_MAX_AGE_MS,
  assessPickedFile,
  cameraAvailability,
  encodeUnderBudget,
  fitWithin,
  type CameraAvailability,
  type CameraCapture,
  type CameraEnvironment,
  type CameraSession,
  type CapturedPhoto,
  type PhotoPolicy,
} from './camera-capture';
export { createWebCameraCapture } from './camera-capture.web';
export {
  QueueIntegrityError,
  createAesGcmCipher,
  createMemoryQueueStore,
  createOfflineQueue,
  generateQueueKey,
  type DrainReport,
  type OfflineQueue,
  type PayloadCipher,
  type QueueStore,
  type QueuedItemMeta,
  type StoredRecord,
} from './offline-queue';
export { openIdbOfflineQueue } from './offline-queue.idb';
export {
  DEFAULT_LOCATE_OPTIONS,
  createWebDeviceGeo,
  mapGeoErrorCode,
  type DeviceGeo,
  type GeoReading,
  type LocateOptions,
} from './device-geo';
export { sha256Hex, SubtleCryptoUnavailableError } from './hash';
export { idbGet, idbPut, openIdb } from './idb';
