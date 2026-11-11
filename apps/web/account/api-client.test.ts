/**
 * US-102 — accès du site à l'API des comptes, côté serveur : URL fail-closed, cookie de session
 * relu sans autre attribut, corps JSON seulement (aucune donnée personnelle dans l'URL), en-têtes
 * transmis, lecture défensive des documents, pays du parcours sans constante.
 */
import { describe, expect, it } from 'vitest';
import { apiUrl, callApi, codeOf, documentsOf, sessionFromSetCookie } from './api-client.ts';
import { journeyCountry } from './request.ts';

const TOKEN = 'A'.repeat(43);
const ctx = { forwardedFor: '198.51.100.7', userAgent: 'vitest', sessionToken: TOKEN };

describe('apiUrl', () => {
  it('http(s) sans identifiants ; sinon indisponible (fail-closed)', () => {
    expect(apiUrl({})).toBeUndefined();
    expect(apiUrl({ WEB_API_URL: '' })).toBeUndefined();
    expect(apiUrl({ WEB_API_URL: 'ftp://api.test' })).toBeUndefined();
    expect(apiUrl({ WEB_API_URL: 'http://u:p@api.test' })).toBeUndefined();
    expect(apiUrl({ WEB_API_URL: 'pas une url' })).toBeUndefined();
    expect(apiUrl({ WEB_API_URL: 'https://api.test/v1' })?.href).toBe('https://api.test/v1');
  });
});

describe('callApi', () => {
  it('sans URL : indisponible, aucun appel', async () => {
    let called = false;
    const r = await callApi('GET', '/legal/documents', ctx, undefined, {
      env: {},
      fetcher: () => {
        called = true;
        return Promise.resolve(new Response('{}'));
      },
    });
    expect(r).toEqual({ status: 'unavailable' });
    expect(called).toBe(false);
  });

  it('corps JSON, cookie de session, adresse et navigateur transmis ; cookie émis relu', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const r = await callApi(
      'POST',
      '/auth/login',
      ctx,
      { email: 'ana@example.test' },
      {
        env: { WEB_API_URL: 'http://api.test:3001' },
        fetcher: (url, init) => {
          seen = { url, init };
          return Promise.resolve(
            new Response('{"expiresAt":"2031-01-01T00:00:00.000Z"}', {
              status: 200,
              headers: {
                'set-cookie': `__Host-session=${'b'.repeat(43)}; Max-Age=1209600; Path=/; HttpOnly; Secure; SameSite=Lax`,
              },
            }),
          );
        },
      },
    );
    expect(seen?.url).toBe('http://api.test:3001/auth/login');
    expect(seen?.url).not.toContain('example.test');
    const headers = seen?.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['cookie']).toBe(`__Host-session=${TOKEN}`);
    expect(headers['x-forwarded-for']).toBe('198.51.100.7');
    expect(seen?.init.body).toBe('{"email":"ana@example.test"}');
    expect(r).toMatchObject({ status: 200, session: { token: 'b'.repeat(43), maxAgeS: 1209600 } });
  });

  it('erreur réseau ⇒ indisponible ; code stable lu dans le corps', async () => {
    const down = await callApi('GET', '/x', ctx, undefined, {
      env: { WEB_API_URL: 'http://api.test' },
      fetcher: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    expect(down).toEqual({ status: 'unavailable' });
    expect(codeOf(down)).toBeNull();
    expect(codeOf({ status: 400, json: { code: 'AUTH_TERMS_NOT_ACCEPTED' }, session: null })).toBe(
      'AUTH_TERMS_NOT_ACCEPTED',
    );
    expect(codeOf({ status: 400, json: { code: '<script>' }, session: null })).toBeNull();
  });
});

describe('sessionFromSetCookie et documentsOf', () => {
  it('seul un jeton bien formé du cookie __Host-session est retenu', () => {
    expect(sessionFromSetCookie(['autre=1; Path=/'])).toBeNull();
    expect(sessionFromSetCookie(['__Host-session=court; Path=/'])).toBeNull();
    expect(sessionFromSetCookie([`__Host-session=${TOKEN}; Max-Age=60; Path=/`])).toEqual({
      token: TOKEN,
      maxAgeS: 60,
    });
  });

  it('documents : forme exacte exigée, sinon aucun (le formulaire ne s’affiche pas)', () => {
    const ok = {
      status: 200,
      session: null,
      json: {
        documents: [
          { kind: 'TOS_GUEST', version: 2, isMajor: true, locale: 'fr', title: 'T', draft: true },
        ],
      },
    } as const;
    expect(documentsOf(ok)?.[0]).toMatchObject({ kind: 'TOS_GUEST', version: 2, draft: true });
    expect(documentsOf({ ...ok, status: 503 })).toBeNull();
    expect(
      documentsOf({ status: 200, session: null, json: { documents: [{ kind: 'X' }] } }),
    ).toBeNull();
    expect(documentsOf({ status: 'unavailable' })).toBeNull();
  });
});

describe('journeyCountry', () => {
  it('pays explicite du lien profond, sinon région de la locale, sinon aucun (documents communs)', () => {
    expect(journeyCountry('ZZ', 'en')).toBe('ZZ');
    expect(journeyCountry('zz', 'en')).toBeNull();
    expect(journeyCountry(undefined, 'es-ZZ')).toBe('ZZ');
    expect(journeyCountry(undefined, 'fr')).toBeNull();
  });
});
