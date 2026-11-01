import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCATE_OPTIONS, createWebDeviceGeo, mapGeoErrorCode } from './device-geo';

type Success = Parameters<Geolocation['getCurrentPosition']>[0];
type Failure = NonNullable<Parameters<Geolocation['getCurrentPosition']>[1]>;

function fakeGeolocation(
  behaviour: (ok: Success, ko: Failure, options: PositionOptions | undefined) => void,
) {
  return {
    getCurrentPosition: (ok: Success, ko?: Failure | null, options?: PositionOptions) =>
      behaviour(ok, ko!, options),
  };
}

const clock = () => {
  let t = 1000;
  return () => (t += 250);
};

describe('mapGeoErrorCode', () => {
  it('suit les codes W3C', () => {
    expect(mapGeoErrorCode(1)).toBe('denied');
    expect(mapGeoErrorCode(2)).toBe('unavailable');
    expect(mapGeoErrorCode(3)).toBe('timeout');
    expect(mapGeoErrorCode(99)).toBe('unavailable');
  });
});

describe('createWebDeviceGeo', () => {
  it('renvoie la position, la précision et l’heure de l’appareil', async () => {
    let seen: PositionOptions | undefined;
    const geo = createWebDeviceGeo({
      isSecureContext: true,
      nowMs: clock(),
      geolocation: fakeGeolocation((ok, _ko, options) => {
        seen = options;
        ok({
          timestamp: Date.parse('2026-10-31T12:00:00Z'),
          coords: { latitude: 8.98, longitude: -79.52, accuracy: 12 },
        } as GeolocationPosition);
      }),
    });
    const reading = await geo.locate();
    expect(reading).toEqual({
      status: 'ok',
      latitude: 8.98,
      longitude: -79.52,
      accuracyM: 12,
      deviceTimestamp: '2026-10-31T12:00:00.000Z',
      elapsedMs: 250,
    });
    expect(seen).toEqual({
      enableHighAccuracy: DEFAULT_LOCATE_OPTIONS.highAccuracy,
      timeout: DEFAULT_LOCATE_OPTIONS.timeoutMs,
      maximumAge: DEFAULT_LOCATE_OPTIONS.maxAgeMs,
    });
  });

  it('traduit un refus sans lever', async () => {
    const geo = createWebDeviceGeo({
      isSecureContext: true,
      nowMs: clock(),
      geolocation: fakeGeolocation((_ok, ko) =>
        ko({ code: 1, message: 'User denied' } as GeolocationPositionError),
      ),
    });
    expect(await geo.locate()).toMatchObject({ status: 'denied', message: 'User denied' });
  });

  it('signale le contexte non sécurisé sans appeler l’API', async () => {
    const geo = createWebDeviceGeo({
      isSecureContext: false,
      nowMs: clock(),
      geolocation: fakeGeolocation(() => {
        throw new Error('ne doit pas être appelé');
      }),
    });
    expect(await geo.locate()).toMatchObject({ status: 'insecure-context' });
  });

  it('signale l’absence de l’API', async () => {
    const geo = createWebDeviceGeo({
      isSecureContext: true,
      nowMs: clock(),
      geolocation: undefined,
    });
    expect(await geo.locate()).toMatchObject({ status: 'unsupported' });
  });
});
