/**
 * Adaptateur web de `CameraCapture` : `getUserMedia` + canevas. Jamais de `<input type="file">`.
 * Sur iOS, la vidéo doit être `playsinline` et muette pour démarrer sans plein écran.
 */
import {
  DEFAULT_PHOTO_POLICY,
  cameraAvailability,
  encodeUnderBudget,
  fitWithin,
  type CameraCapture,
  type CameraEnvironment,
  type CameraSession,
  type PhotoPolicy,
} from './camera-capture';
import { sha256Hex } from './hash';

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error('toBlob a renvoyé null')) : resolve(blob)),
      type,
      quality,
    );
  });
}

export function createWebCameraCapture(
  env: CameraEnvironment,
  options: { readonly policy?: PhotoPolicy; readonly now?: () => Date } = {},
): CameraCapture {
  const policy = options.policy ?? DEFAULT_PHOTO_POLICY;
  const now = options.now ?? (() => new Date());
  return {
    adapter: 'web-getusermedia',
    availability: () => cameraAvailability(env),
    async open(preview: HTMLVideoElement): Promise<CameraSession> {
      const availability = cameraAvailability(env);
      if (!availability.available || env.mediaDevices === undefined) {
        throw new Error(
          `caméra indisponible : ${availability.available ? '' : availability.reason}`,
        );
      }
      const stream = await env.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      preview.setAttribute('playsinline', '');
      preview.muted = true;
      preview.srcObject = stream;
      await preview.play();
      const track = stream.getVideoTracks()[0];
      const trackSettings: Record<string, unknown> = track ? { ...track.getSettings() } : {};

      return {
        trackSettings,
        async capture() {
          const size = fitWithin(preview.videoWidth, preview.videoHeight, policy.maxLongSidePx);
          const canvas = document.createElement('canvas');
          canvas.width = size.width;
          canvas.height = size.height;
          const context = canvas.getContext('2d');
          if (context === null) throw new Error('canevas 2D indisponible');
          context.drawImage(preview, 0, 0, size.width, size.height);
          const capturedAt = now();
          const encoded = await encodeUnderBudget(
            (quality) => canvasToBlob(canvas, policy.mimeType, quality),
            policy,
          );
          const bytes = new Uint8Array(await encoded.blob.arrayBuffer());
          return {
            source: 'live-camera',
            blob: encoded.blob,
            mimeType: encoded.blob.type || policy.mimeType,
            width: size.width,
            height: size.height,
            byteLength: encoded.blob.size,
            quality: encoded.quality,
            overBudget: encoded.overBudget,
            sha256Hex: await sha256Hex(bytes),
            deviceCapturedAt: capturedAt.toISOString(),
          };
        },
        stop() {
          for (const t of stream.getTracks()) t.stop();
          preview.srcObject = null;
        },
      };
    },
  };
}
