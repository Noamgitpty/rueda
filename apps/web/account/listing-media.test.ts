/**
 * Relais des photos d'annonce par le site (US-204) : clé fermée, base du bucket de
 * l'environnement, type réel limité aux images du dépôt, aucune redirection ; tout écart : 404.
 */
import { describe, expect, it } from 'vitest';
import { mediaUrl, relayListingPhoto } from './listing-media.ts';

const L = '00000000-0000-4000-8000-0000000204a1';
const P = '00000000-0000-4000-8000-0000000204b1';
const env = { WEB_MEDIA_URL: 'http://127.0.0.1:9/bucket' };
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe('mediaUrl', () => {
  it('http(s) sans identifiants ; sinon absente', () => {
    expect(mediaUrl(env)?.href).toBe('http://127.0.0.1:9/bucket');
    expect(mediaUrl({})).toBeUndefined();
    expect(mediaUrl({ WEB_MEDIA_URL: 'ftp://x' })).toBeUndefined();
    expect(mediaUrl({ WEB_MEDIA_URL: 'https://u:p@x' })).toBeUndefined();
    expect(mediaUrl({ WEB_MEDIA_URL: 'pas une url' })).toBeUndefined();
  });
});

describe('relayListingPhoto', () => {
  it('relaie l’objet listing/<annonce>/<photo> du bucket, sans suivre de redirection', async () => {
    const calls: [string, RequestInit][] = [];
    const r = await relayListingPhoto(L, P, {
      env,
      fetcher: (url, init) => {
        calls.push([url, init]);
        return Promise.resolve(new Response(png, { headers: { 'content-type': 'image/png' } }));
      },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(png);
    expect(calls[0]?.[0]).toBe(`http://127.0.0.1:9/bucket/listing/${L}/${P}`);
    expect(calls[0]?.[1].redirect).toBe('error');
  });

  it('404 sans base, identifiant hors forme, objet absent, type non image ou panne', async () => {
    const never = () => Promise.reject(new Error('jamais appelé'));
    expect((await relayListingPhoto(L, P, { env: {}, fetcher: never })).status).toBe(404);
    expect((await relayListingPhoto('../x', P, { env, fetcher: never })).status).toBe(404);
    expect((await relayListingPhoto(L, `${P}/..`, { env, fetcher: never })).status).toBe(404);
    const reply = (body: BodyInit | null, init: ResponseInit) => () =>
      Promise.resolve(new Response(body, init));
    expect(
      (await relayListingPhoto(L, P, { env, fetcher: reply(null, { status: 404 }) })).status,
    ).toBe(404);
    expect(
      (
        await relayListingPhoto(L, P, {
          env,
          fetcher: reply('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
        })
      ).status,
    ).toBe(404);
    expect((await relayListingPhoto(L, P, { env, fetcher: never })).status).toBe(404);
  });
});
