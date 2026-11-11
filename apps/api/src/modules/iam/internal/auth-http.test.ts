/**
 * Routes /auth sur le FAKE (test:unit) : scénarios communs (aussi joués sur PostgreSQL en
 * test:int) + cas qui demandent une horloge pilotée (expiration) ou des réglages (débit).
 */
import { describe, expect, it } from 'vitest';
import { authHttpScenarios } from '../testing/auth-http-scenarios.js';
import { FakeAuthStore } from '../testing/fake-auth-store.js';
import { call, sessionTokenFrom, startAuthApp } from '../testing/http-harness.js';
import { DEFAULT_AUTH_POLICY } from './policy.js';

authHttpScenarios('FAKE', async () => ({ store: new FakeAuthStore(), release: async () => {} }));

const signup = (url: string, overrides: Record<string, unknown> = {}) =>
  call(url, 'POST', '/auth/signup', {
    body: {
      email: 'ana@example.test',
      password: 'Correct-Horse-9',
      legalFirstName: 'Ana',
      legalLastName: 'Pérez',
      locale: 'fr',
      termsAccepted: true,
      acceptedDocuments: [
        { kind: 'TOS_GUEST', version: 1 },
        { kind: 'PRIVACY', version: 1 },
      ],
      ...overrides,
    },
  });

describe('routes /auth — FAKE, horloge et réglages pilotés', () => {
  it('session expirée (horloge de la base) => 401 ; Max-Age du cookie = durée restante', async () => {
    let now = Date.parse('2031-03-10T14:00:00Z');
    const store = new FakeAuthStore(() => now);
    const h = await startAuthApp(store, { clock: () => now });
    try {
      await signup(h.url);
      const login = await call(h.url, 'POST', '/auth/login', {
        body: { email: 'ana@example.test', password: 'Correct-Horse-9' },
      });
      expect(login.setCookie[0]).toContain(`Max-Age=${DEFAULT_AUTH_POLICY.sessionTtlS};`);
      const cookie = `__Host-session=${sessionTokenFrom(login.setCookie)}`;
      now += (DEFAULT_AUTH_POLICY.sessionTtlS - 1) * 1000;
      expect((await call(h.url, 'GET', '/auth/session', { cookie })).status).toBe(200);
      now += 1000;
      expect((await call(h.url, 'GET', '/auth/session', { cookie })).status).toBe(401);
    } finally {
      await h.close();
    }
  });

  it('compte fermé ou banni : sessions refusées (401) et connexion refusée sans le dire', async () => {
    const store = new FakeAuthStore();
    const h = await startAuthApp(store);
    try {
      await signup(h.url);
      const login = await call(h.url, 'POST', '/auth/login', {
        body: { email: 'ana@example.test', password: 'Correct-Horse-9' },
      });
      const cookie = `__Host-session=${sessionTokenFrom(login.setCookie)}`;
      const userId = (await store.findCredentials('ana@example.test'))?.userId as string;
      store.setStatus(userId, 'BANNED');
      expect((await call(h.url, 'GET', '/auth/session', { cookie })).status).toBe(401);
      const again = await call(h.url, 'POST', '/auth/login', {
        body: { email: 'ana@example.test', password: 'Correct-Horse-9' },
      });
      expect(again.status).toBe(401);
      expect(again.body).toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    } finally {
      await h.close();
    }
  });

  it('inscription : codes de 16 ACC-001 ; aucun compte créé en cas d’erreur', async () => {
    const store = new FakeAuthStore();
    const h = await startAuthApp(store);
    try {
      const cases: [Record<string, unknown>, number, string][] = [
        [{ termsAccepted: false }, 400, 'AUTH_TERMS_NOT_ACCEPTED'],
        [{ termsAccepted: 'true' }, 400, 'AUTH_TERMS_NOT_ACCEPTED'],
        [{ email: 'pas-un-email' }, 400, 'AUTH_EMAIL_INVALID'],
        [{ password: 'court-9' }, 400, 'AUTH_PASSWORD_WEAK'],
        [{ password: 'x'.repeat(1025) }, 400, 'REQUEST_INVALID'],
        [{ legalFirstName: '   ' }, 400, 'REQUEST_INVALID'],
        [{ locale: 'xx_YY' }, 400, 'REQUEST_INVALID'],
      ];
      for (const [overrides, status, code] of cases) {
        const r = await signup(h.url, overrides);
        expect(r.status, code).toBe(status);
        expect(r.body).toMatchObject({ code });
      }
      const weak = await signup(h.url, { password: 'court-9' });
      expect(weak.body).toEqual({
        code: 'AUTH_PASSWORD_WEAK',
        messageKey: 'common.auth.passwordWeak',
        values: { min: 10 },
      });
      expect(store.accounts.size).toBe(0);
      const form = await call(h.url, 'POST', '/auth/signup', { contentType: 'text/plain' });
      expect(form.status).toBe(415);
    } finally {
      await h.close();
    }
  });

  it('débit : au-delà de N échecs pour un email, 429 RATE_LIMITED même avec le bon mot de passe', async () => {
    const store = new FakeAuthStore();
    const h = await startAuthApp(store, {
      policy: { ...DEFAULT_AUTH_POLICY, loginFailuresPerEmail: 3 },
    });
    try {
      await signup(h.url);
      for (let i = 0; i < 3; i++) {
        const r = await call(h.url, 'POST', '/auth/login', {
          body: { email: 'ana@example.test', password: `Wrong-Pass-${i}0` },
        });
        expect(r.status).toBe(401);
      }
      const blocked = await call(h.url, 'POST', '/auth/login', {
        body: { email: 'ana@example.test', password: 'Correct-Horse-9' },
      });
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual({ code: 'RATE_LIMITED', messageKey: 'common.auth.rateLimited' });
      expect(blocked.setCookie).toEqual([]);
    } finally {
      await h.close();
    }
  });
});
