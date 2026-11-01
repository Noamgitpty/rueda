import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { LAB_BASE_PATH, LAB_PWA_IOS_FLAG, isPwaIosLabEnabled, labNotFound } from './lab-flag';
import { buildLabManifest } from './manifest-data';
import { solidPng } from './png';
import {
  LAB_TEST_IDS,
  REPORT_SCHEMA,
  buildReport,
  markerAgeDays,
  parseIosVersion,
  purgeVerdict,
} from './report';
import { buildServiceWorkerScript } from './sw-script';

describe('drapeau WEB_LAB_PWA_IOS_ENABLED', () => {
  it('est désactivé par défaut', () => {
    expect(isPwaIosLabEnabled({})).toBe(false);
  });

  it.each(['1', 'TRUE', 'yes', ' true', 'enabled', ''])('refuse la valeur %j', (value) => {
    expect(isPwaIosLabEnabled({ [LAB_PWA_IOS_FLAG]: value })).toBe(false);
  });

  it('ne s’active qu’avec exactement « true »', () => {
    expect(isPwaIosLabEnabled({ [LAB_PWA_IOS_FLAG]: 'true' })).toBe(true);
  });

  it('la réponse coupée est un 404 non indexable', () => {
    const response = labNotFound();
    expect(response.status).toBe(404);
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
  });
});

describe('parseIosVersion', () => {
  it('lit la version d’un iPhone', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    expect(parseIosVersion(ua)).toBe('17.4.1');
  });

  it('lit une version à deux composantes', () => {
    expect(parseIosVersion('Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X)')).toBe('16.7');
  });

  it('renvoie null hors iOS', () => {
    expect(parseIosVersion('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130')).toBeNull();
  });
});

describe('buildReport', () => {
  it('résume chaque test, « not-run » pour ceux qui manquent', () => {
    const report = buildReport({
      results: {
        geolocation: { test: 'geolocation', status: 'pass', at: 'x', details: {} },
      },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      now: new Date('2026-10-31T12:00:00Z'),
    });
    expect(report.schema).toBe(REPORT_SCHEMA);
    expect(report.iosVersionFromUserAgent).toBe('18.0');
    expect(Object.keys(report.summary)).toEqual([...LAB_TEST_IDS]);
    expect(report.summary.geolocation).toBe('pass');
    expect(report.summary['camera-live']).toBe('not-run');
    expect(report.results).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe('test de purge', () => {
  const places = ['localStorage', 'indexedDB', 'cacheStorage'];

  it('âge en jours', () => {
    expect(markerAgeDays('2026-10-20T12:00:00Z', new Date('2026-10-31T12:00:00Z'))).toBe(11);
    expect(() => markerAgeDays('pas une date', new Date())).toThrow(RangeError);
  });

  it('tous les témoins présents après 8 jours : réussite', () => {
    const found = places.map((where) => ({ where, ageDays: 9 }));
    expect(purgeVerdict({ found, places, minDays: 8 })).toBe('pass');
  });

  it('trop tôt pour conclure', () => {
    const found = places.map((where) => ({ where, ageDays: 2 }));
    expect(purgeVerdict({ found, places, minDays: 8 })).toBe('info');
  });

  it('purge partielle : échec', () => {
    expect(
      purgeVerdict({ found: [{ where: 'localStorage', ageDays: 9 }], places, minDays: 8 }),
    ).toBe('fail');
  });

  it('aucun témoin : à confronter à la date notée au jour 0', () => {
    expect(purgeVerdict({ found: [], places, minDays: 8 })).toBe('warn');
  });
});

describe('manifeste et service worker', () => {
  it('le manifeste reste dans la portée du laboratoire', () => {
    const manifest = buildLabManifest();
    expect(manifest).toMatchObject({
      start_url: LAB_BASE_PATH,
      scope: LAB_BASE_PATH,
      display: 'standalone',
    });
    expect(String(manifest['start_url']).startsWith(String(manifest['scope']))).toBe(true);
    const sizes = (manifest['icons'] as { sizes: string }[]).map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  it('le script du service worker est du JavaScript valide', () => {
    const script = buildServiceWorkerScript();
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain(JSON.stringify(LAB_BASE_PATH));
  });
});

describe('solidPng', () => {
  it('produit un PNG RVB de la bonne taille et de la bonne couleur', () => {
    const png = solidPng(4, [10, 20, 30]);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect(view.getUint32(16)).toBe(4);
    expect(view.getUint32(20)).toBe(4);
    const idatLength = view.getUint32(33);
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect(raw.length).toBe(4 * (1 + 4 * 3));
    expect([...raw.subarray(0, 4)]).toEqual([0, 10, 20, 30]);
  });

  it('rejette une taille invalide', () => {
    expect(() => solidPng(0, [0, 0, 0])).toThrow(RangeError);
  });
});
