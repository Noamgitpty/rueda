/**
 * Réception d'une photo d'annonce (US-115 ; 16 HST-012 ; ADR-099) : les contrôles (taille, type
 * réel, dimensions, retrait des métadonnées, antivirus fail-closed, ports de dépôt) vivent depuis
 * US-303 dans le socle AUD (`aud/internal/photo-checks.ts`, ADR-179), partagés avec les photos
 * d'état du véhicule de TRP. Ce fichier les réexporte sans rien changer pour CAT.
 */
export {
  DEFAULT_PHOTO_LIMITS,
  isCleanScan,
  PhotoRejectedError,
  preparePhoto,
  sniffPhotoMime,
  UnavailablePhotoScanner,
  UnavailablePhotoStorage,
} from '../../../aud/index.js';
export type {
  CleanPhoto,
  Dimensions,
  PhotoLimits,
  PhotoMime,
  PhotoRejection,
  PhotoScanner,
  PhotoScanResult,
  PhotoStorage,
} from '../../../aud/index.js';
