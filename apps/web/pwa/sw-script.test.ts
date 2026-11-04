import { describe, expect, it } from 'vitest';
import { buildShellServiceWorker, OFFLINE_PATH, shellCacheName } from './sw-script.ts';

const ORIGIN = 'https://app.test';

/** Caches en mémoire, clés = URL absolues (comme l'API Cache Storage). */
class FakeCaches {
  readonly stores = new Map<string, Map<string, Response>>();
  open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    const store = this.stores.get(name)!;
    const key = (r: string | Request) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
    return Promise.resolve({
      put: async (r: string | Request, res: Response) => void store.set(key(r), res),
      match: async (r: string | Request) => store.get(key(r))?.clone(),
      add: async (r: string) => void store.set(key(r), new Response(`asset ${r}`)),
    });
  }
  async match(r: string | Request) {
    const href = new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
    for (const store of this.stores.values()) if (store.has(href)) return store.get(href)!.clone();
    return undefined;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
}

type Handler = (event: Record<string, unknown>) => void;

function boot(brandVersion: string, network: (url: string) => Promise<Response>) {
  const handlers = new Map<string, Handler>();
  const caches = new FakeCaches();
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, h: Handler) => handlers.set(type, h),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const fetch = (input: string | { url: string }) =>
    network(new URL(typeof input === 'string' ? input : input.url, ORIGIN).href);
  new Function('self', 'caches', 'fetch', buildShellServiceWorker(brandVersion))(
    self,
    caches,
    fetch,
  );
  const fire = async (type: string, extra: Record<string, unknown> = {}) => {
    let waited: Promise<unknown> | undefined;
    let responded: Promise<Response> | undefined;
    handlers.get(type)?.({
      ...extra,
      waitUntil: (p: Promise<unknown>) => (waited = p),
      respondWith: (p: Promise<Response>) => (responded = p),
    });
    await waited;
    return responded;
  };
  return { caches, fire };
}

const OFFLINE_HTML =
  '<html lang="es"><link rel="stylesheet" href="/_next/static/chunks/a.css"/><script src="/_next/static/chunks/b.js"></script><h1>Sin conexión</h1></html>';

function online(url: string): Promise<Response> {
  if (url.endsWith(OFFLINE_PATH)) return Promise.resolve(new Response(OFFLINE_HTML));
  return Promise.resolve(new Response(`page ${url}`));
}
const offline = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));

// `new Request(…, { mode: 'navigate' })` est interdit hors navigateur : requête simulée.
const navigate = (path: string) => ({
  request: { method: 'GET', mode: 'navigate', url: ORIGIN + path },
});

describe('service worker de la coquille (US-048)', () => {
  it('le script est du JavaScript valide et porte la version de la marque', () => {
    expect(() => new Function(buildShellServiceWorker('brand-3'))).not.toThrow();
    expect(buildShellServiceWorker('brand-3')).toContain(JSON.stringify(shellCacheName('brand-3')));
    expect(shellCacheName('brand-3')).not.toBe(shellCacheName('brand-4'));
  });

  it('installation : pré-charge l’écran hors ligne et les fichiers qu’il cite', async () => {
    const sw = boot('v1', online);
    await sw.fire('install');
    const store = sw.caches.stores.get(shellCacheName('v1'))!;
    expect([...store.keys()].sort()).toEqual(
      [
        `${ORIGIN}/__shell/offline-lang`,
        `${ORIGIN}/_next/static/chunks/a.css`,
        `${ORIGIN}/_next/static/chunks/b.js`,
        `${ORIGIN}${OFFLINE_PATH}`,
      ].sort(),
    );
  });

  it('une installation sans réseau n’échoue pas (pré-cache au mieux)', async () => {
    const sw = boot('v1', offline);
    await expect(sw.fire('install')).resolves.toBeUndefined();
  });

  it('page ouverte sans réseau : l’écran « Sin conexión » est rendu à sa place', async () => {
    let network = online;
    const sw = boot('v1', (u) => network(u));
    await sw.fire('install');
    network = offline;
    const response = await sw.fire('fetch', navigate('/viajes/123'));
    expect(await response!.text()).toContain('Sin conexión');
  });

  it('en ligne, les pages viennent du réseau et ne sont jamais mises en cache', async () => {
    const sw = boot('v1', online);
    const response = await sw.fire('fetch', navigate('/viajes/123'));
    expect(await response!.text()).toBe(`page ${ORIGIN}/viajes/123`);
    const keys = [...(sw.caches.stores.get(shellCacheName('v1'))?.keys() ?? [])];
    expect(keys.some((k) => k.includes('/viajes'))).toBe(false);
  });

  it('ignore les requêtes non GET et celles d’une autre origine', async () => {
    const sw = boot('v1', online);
    expect(
      await sw.fire('fetch', { request: new Request(`${ORIGIN}/locale`, { method: 'POST' }) }),
    ).toBeUndefined();
    expect(
      await sw.fire('fetch', { request: new Request('https://api.test/brand') }),
    ).toBeUndefined();
  });

  it('ressources de build : cache d’abord, puis mémorisées', async () => {
    let calls = 0;
    const sw = boot('v1', async (u) => {
      calls += 1;
      return new Response(`asset ${u}`);
    });
    const req = { request: new Request(`${ORIGIN}/_next/static/chunks/c.js`) };
    await sw.fire('fetch', req);
    await new Promise((r) => setTimeout(r, 0));
    await sw.fire('fetch', { request: new Request(`${ORIGIN}/_next/static/chunks/c.js`) });
    expect(calls).toBe(1);
  });

  it('activation : supprime les anciens caches de la coquille, pas les autres', async () => {
    const sw = boot('v2', online);
    await sw.caches.open(shellCacheName('v1'));
    await sw.caches.open('rueda-lab-pwa-ios-v1');
    await sw.caches.open(shellCacheName('v2'));
    await sw.fire('activate');
    expect(await sw.caches.keys()).toEqual(['rueda-lab-pwa-ios-v1', shellCacheName('v2')]);
  });

  it('langue changée : l’écran hors ligne est rechargé ; même langue : rien', async () => {
    let fetches = 0;
    const sw = boot('v1', (u) => {
      if (u.endsWith(OFFLINE_PATH)) fetches += 1;
      return online(u);
    });
    await sw.fire('install');
    await sw.fire('message', { data: { type: 'shell-locale', lang: 'fr' } });
    await sw.fire('message', { data: { type: 'shell-locale', lang: 'fr' } });
    await sw.fire('message', { data: { type: 'autre' } });
    expect(fetches).toBe(2);
  });
});
