/**
 * Interface `DeviceGeo` (17 §6.2, TRP-004 : géolocalisation jointe à la photo). L'adaptateur web
 * enveloppe `navigator.geolocation` ; il ne lève jamais : chaque issue est un résultat typé, pour
 * que l'écran puisse dire à l'agent quoi faire (autoriser, sortir, réessayer).
 */

export type GeoFailureStatus =
  'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'insecure-context';

export type GeoReading =
  | {
      readonly status: 'ok';
      readonly latitude: number;
      readonly longitude: number;
      readonly accuracyM: number;
      readonly deviceTimestamp: string;
      readonly elapsedMs: number;
    }
  | { readonly status: GeoFailureStatus; readonly message: string; readonly elapsedMs: number };

export interface LocateOptions {
  readonly highAccuracy: boolean;
  readonly timeoutMs: number;
  readonly maxAgeMs: number;
}

export const DEFAULT_LOCATE_OPTIONS: LocateOptions = {
  highAccuracy: true,
  timeoutMs: 15_000,
  maxAgeMs: 0,
};

export interface DeviceGeo {
  readonly adapter: string;
  locate(options?: LocateOptions): Promise<GeoReading>;
}

/** Codes de `GeolocationPositionError` (W3C) : 1 refus, 2 indisponible, 3 délai. */
export function mapGeoErrorCode(code: number): GeoFailureStatus {
  switch (code) {
    case 1:
      return 'denied';
    case 3:
      return 'timeout';
    default:
      return 'unavailable';
  }
}

export interface GeoEnvironment {
  readonly isSecureContext: boolean;
  readonly geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined;
  readonly nowMs: () => number;
}

export function createWebDeviceGeo(env: GeoEnvironment): DeviceGeo {
  return {
    adapter: 'web-geolocation',
    locate(options = DEFAULT_LOCATE_OPTIONS) {
      const started = env.nowMs();
      const elapsed = () => env.nowMs() - started;
      if (!env.isSecureContext) {
        return Promise.resolve({
          status: 'insecure-context',
          message: 'HTTPS requis',
          elapsedMs: elapsed(),
        });
      }
      const geolocation = env.geolocation;
      if (geolocation === undefined) {
        return Promise.resolve({
          status: 'unsupported',
          message: 'navigator.geolocation absent',
          elapsedMs: elapsed(),
        });
      }
      return new Promise<GeoReading>((resolve) => {
        geolocation.getCurrentPosition(
          (position) =>
            resolve({
              status: 'ok',
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracyM: position.coords.accuracy,
              deviceTimestamp: new Date(position.timestamp).toISOString(),
              elapsedMs: elapsed(),
            }),
          (error) =>
            resolve({
              status: mapGeoErrorCode(error.code),
              message: error.message,
              elapsedMs: elapsed(),
            }),
          {
            enableHighAccuracy: options.highAccuracy,
            timeout: options.timeoutMs,
            maximumAge: options.maxAgeMs,
          },
        );
      });
    },
  };
}
