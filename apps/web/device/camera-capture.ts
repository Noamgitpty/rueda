/**
 * Interface `CameraCapture` (17 §6.2, ADR-005, ADR-039) : capture **en direct** dans la page,
 * jamais d'import de galerie. L'adaptateur web (`camera-capture.web.ts`) lit le flux de
 * `getUserMedia` et dessine une image dans un canevas : aucun sélecteur de fichier n'est ouvert,
 * donc la photothèque ne peut pas être proposée. Une enveloppe native (Capacitor) ou un terminal
 * fourni remplaceraient seulement l'adaptateur.
 */

/** Politique de photo de TRP-002 : ≈ 1 600 px sur le grand côté, ≤ 500 ko. PROPOSÉ (non paramétré). */
export interface PhotoPolicy {
  readonly maxLongSidePx: number;
  readonly maxBytes: number;
  readonly mimeType: string;
  /** Qualités essayées dans l'ordre jusqu'à passer sous `maxBytes`. */
  readonly qualitySteps: readonly number[];
}

export const DEFAULT_PHOTO_POLICY: PhotoPolicy = {
  maxLongSidePx: 1600,
  maxBytes: 500 * 1000,
  mimeType: 'image/jpeg',
  qualitySteps: [0.85, 0.75, 0.65, 0.55, 0.45],
};

export interface CapturedPhoto {
  readonly source: 'live-camera';
  readonly blob: Blob;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly quality: number;
  readonly overBudget: boolean;
  readonly sha256Hex: string;
  /** Heure de l'appareil, conservée à titre indicatif : l'heure serveur fait foi (17 §6.2). */
  readonly deviceCapturedAt: string;
}

export interface CameraSession {
  /** Réglages réels de la piste vidéo (résolution, caméra arrière…), pour le rapport. */
  readonly trackSettings: Readonly<Record<string, unknown>>;
  capture(): Promise<CapturedPhoto>;
  stop(): void;
}

export type CameraUnavailableReason = 'insecure-context' | 'no-media-devices';

export type CameraAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: CameraUnavailableReason };

export interface CameraCapture {
  readonly adapter: string;
  availability(): CameraAvailability;
  /** Ouvre la caméra arrière et affiche l'aperçu dans `preview`. */
  open(preview: HTMLVideoElement): Promise<CameraSession>;
}

export interface CameraEnvironment {
  readonly isSecureContext: boolean;
  readonly mediaDevices: Pick<MediaDevices, 'getUserMedia'> | undefined;
}

export function cameraAvailability(env: CameraEnvironment): CameraAvailability {
  if (!env.isSecureContext) return { available: false, reason: 'insecure-context' };
  if (env.mediaDevices === undefined || typeof env.mediaDevices.getUserMedia !== 'function') {
    return { available: false, reason: 'no-media-devices' };
  }
  return { available: true };
}

/** Réduit (sans jamais agrandir) pour que le grand côté tienne dans `maxLongSide`. */
export function fitWithin(
  width: number,
  height: number,
  maxLongSide: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) throw new RangeError('dimensions vides');
  const longSide = Math.max(width, height);
  if (longSide <= maxLongSide) return { width, height };
  const ratio = maxLongSide / longSide;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

export interface EncodedPhoto {
  readonly blob: Blob;
  readonly quality: number;
  readonly overBudget: boolean;
}

/**
 * Essaie les qualités de la politique dans l'ordre et garde la première sous le budget. Si aucune
 * ne passe, renvoie la dernière marquée `overBudget` : la décision (refuser, réessayer) revient à
 * l'appelant, le rapport la montre.
 */
export async function encodeUnderBudget(
  encode: (quality: number) => Promise<Blob>,
  policy: PhotoPolicy = DEFAULT_PHOTO_POLICY,
): Promise<EncodedPhoto> {
  if (policy.qualitySteps.length === 0) throw new RangeError('qualitySteps vide');
  let last: EncodedPhoto | undefined;
  for (const quality of policy.qualitySteps) {
    const blob = await encode(quality);
    if (blob.size <= policy.maxBytes) return { blob, quality, overBudget: false };
    last = { blob, quality, overBudget: true };
  }
  return last as EncodedPhoto;
}

/**
 * Contrôle de l'**entrée fichier** `<input type="file" capture>` (le chemin à risque de TRP-056) :
 * une photo prise à l'instant a un `lastModified` récent ; une photo ancienne de la photothèque,
 * non. Heuristique seulement (une capture d'écran récente passerait) : elle sert au test, pas à la
 * preuve.
 */
export const FRESH_FILE_MAX_AGE_MS = 120_000;

export function assessPickedFile(
  file: { readonly lastModified: number; readonly size: number; readonly type: string },
  nowMs: number,
): { ageMs: number; likelyFromLibrary: boolean } {
  const ageMs = nowMs - file.lastModified;
  return { ageMs, likelyFromLibrary: ageMs > FRESH_FILE_MAX_AGE_MS };
}
