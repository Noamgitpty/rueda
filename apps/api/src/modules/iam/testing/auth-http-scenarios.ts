/**
 * Scénarios HTTP de US-010 — TESTS SEULEMENT. Exécutés sur le FAKE (test:unit) et sur
 * PostgreSQL sous app_api (test:int, `pg-auth-store.int.test.ts`).
 *
 * Valeurs attendues : 19 US-010 (critères), 16 ACC-001 (anti-énumération, codes), 17 §6.6
 * (cookies HttpOnly / Secure / SameSite=Lax, sessions serveur), ADR-052.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AuthStore } from '../internal/auth-store.js';
import { call, sessionTokenFrom, startAuthApp } from './http-harness.js';
import type { AuthHttpHarness } from './http-harness.js';

export interface StoreHarness {
  readonly store: AuthStore;
  release(): Promise<void>;
}

const PASSWORD = 'Correct-Horse-9';

export function authHttpScenarios(name: string, makeStore: () => Promise<StoreHarness>): void {
  const withApp = async (fn: (h: AuthHttpHarness) => Promise<void>) => {
    const s = await makeStore();
    const h = await startAuthApp(s.store);
    try {
      await fn(h);
    } finally {
      await h.close();
      await s.release();
    }
  };

  const signupAndLogin = async (h: AuthHttpHarness, email = `h-${randomUUID()}@example.test`) => {
    const signup = await call(h.url, 'POST', '/auth/signup', {
      body: {
        email: email.toUpperCase(),
        password: PASSWORD,
        legalFirstName: 'Ana',
        legalLastName: 'Pérez',
        locale: 'en',
        termsAccepted: true,
        acceptedDocuments: [
          { kind: 'TOS_GUEST', version: 1 },
          { kind: 'PRIVACY', version: 1 },
        ],
      },
    });
    expect(signup.status).toBe(202);
    const login = await call(h.url, 'POST', '/auth/login', { body: { email, password: PASSWORD } });
    expect(login.status).toBe(200);
    const token = sessionTokenFrom(login.setCookie);
    expect(token).not.toBeNull();
    return { email, token: token as string, login };
  };

  describe(`routes /auth — ${name}`, () => {
    it('critère 2 : session révoquée (déconnexion) => l’API rappelée répond 401 AUTH_REQUIRED', () =>
      withApp(async (h) => {
        const { token, login } = await signupAndLogin(h);
        // cookie : HttpOnly, Secure, SameSite=Lax, préfixe __Host- (17 §6.6)
        expect(login.setCookie).toHaveLength(1);
        expect(login.setCookie[0]).toMatch(
          /^__Host-session=[A-Za-z0-9_-]{43}; Max-Age=\d+; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
        );
        expect(JSON.stringify(login.body)).not.toContain(token); // jamais de jeton dans un corps
        expect(login.headers.get('cache-control')).toBe('no-store');

        const cookie = `__Host-session=${token}`;
        const before = await call(h.url, 'GET', '/auth/session', { cookie });
        expect(before.status).toBe(200);
        expect(before.body).toMatchObject({ mfaLevel: 'NONE' });

        const logout = await call(h.url, 'POST', '/auth/logout', { cookie });
        expect(logout.status).toBe(204);
        expect(logout.setCookie[0]).toMatch(/^__Host-session=; Max-Age=0; /);

        const after = await call(h.url, 'GET', '/auth/session', { cookie });
        expect(after.status).toBe(401);
        expect(after.body).toEqual({
          code: 'AUTH_REQUIRED',
          messageKey: 'common.auth.sessionRequired',
        });
      }));

    it('sans cookie, cookie forgé ou mal formé : 401 AUTH_REQUIRED', () =>
      withApp(async (h) => {
        for (const cookie of [
          undefined,
          '__Host-session=forge',
          `__Host-session=${'A'.repeat(43)}`,
        ]) {
          const r = await call(
            h.url,
            'GET',
            '/auth/session',
            cookie === undefined ? {} : { cookie },
          );
          expect(r.status, String(cookie)).toBe(401);
          expect(r.body).toMatchObject({ code: 'AUTH_REQUIRED' });
        }
      }));

    it('fixation de session : la connexion émet un jeton NEUF et révoque celui présenté', () =>
      withApp(async (h) => {
        const { email, token: first } = await signupAndLogin(h);
        // l'attaquant a fait porter au navigateur une session (la sienne, ou une ancienne)
        const relog = await call(h.url, 'POST', '/auth/login', {
          body: { email, password: PASSWORD },
          cookie: `__Host-session=${first}`,
        });
        expect(relog.status).toBe(200);
        const second = sessionTokenFrom(relog.setCookie);
        expect(second).not.toBeNull();
        expect(second).not.toBe(first);
        expect(
          (await call(h.url, 'GET', '/auth/session', { cookie: `__Host-session=${first}` })).status,
        ).toBe(401);
        expect(
          (await call(h.url, 'GET', '/auth/session', { cookie: `__Host-session=${second}` }))
            .status,
        ).toBe(200);
      }));

    it('« se déconnecter partout » : toutes les sessions du compte => 401', () =>
      withApp(async (h) => {
        const { email, token: a } = await signupAndLogin(h);
        const other = await call(h.url, 'POST', '/auth/login', {
          body: { email, password: PASSWORD },
        });
        const b = sessionTokenFrom(other.setCookie) as string;
        const all = await call(h.url, 'POST', '/auth/logout-all', {
          cookie: `__Host-session=${b}`,
        });
        expect(all.status).toBe(204);
        for (const t of [a, b]) {
          expect(
            (await call(h.url, 'GET', '/auth/session', { cookie: `__Host-session=${t}` })).status,
          ).toBe(401);
        }
        // sans session valide : 401
        const again = await call(h.url, 'POST', '/auth/logout-all', {
          cookie: `__Host-session=${b}`,
        });
        expect(again.status).toBe(401);
      }));

    it('anti-énumération (ACC-001) : email déjà pris => même réponse ; connexion ratée => même erreur', () =>
      withApp(async (h) => {
        const { email } = await signupAndLogin(h);
        const body = {
          email,
          password: 'Another-Pass-1',
          legalFirstName: 'Eva',
          legalLastName: 'Gómez',
          locale: 'en',
          termsAccepted: true,
          acceptedDocuments: [
            { kind: 'TOS_GUEST', version: 1 },
            { kind: 'PRIVACY', version: 1 },
          ],
        };
        const dup = await call(h.url, 'POST', '/auth/signup', { body });
        const fresh = await call(h.url, 'POST', '/auth/signup', {
          body: { ...body, email: `n-${randomUUID()}@example.test` },
        });
        expect(dup.status).toBe(fresh.status);
        expect(dup.body).toEqual(fresh.body);
        expect(dup.body).toEqual({
          code: 'SIGNUP_ACCEPTED',
          messageKey: 'common.auth.signupAccepted',
        });
        expect(h.notifier.accountExists.map((m) => m.email)).toEqual([email]);

        const wrong = await call(h.url, 'POST', '/auth/login', {
          body: { email, password: 'Wrong-Pass-99' },
        });
        const unknown = await call(h.url, 'POST', '/auth/login', {
          body: { email: `x-${randomUUID()}@example.test`, password: PASSWORD },
        });
        for (const r of [wrong, unknown]) {
          expect(r.status).toBe(401);
          expect(r.body).toEqual({
            code: 'AUTH_INVALID_CREDENTIALS',
            messageKey: 'common.auth.invalidCredentials',
          });
          expect(r.setCookie).toEqual([]);
        }
      }));

    it('vérification d’email : lien à usage unique ; jeton absent du corps et des journaux', () =>
      withApp(async (h) => {
        const { token: session } = await signupAndLogin(h);
        const message = h.notifier.verifications.at(-1);
        expect(message).toBeDefined();
        const token = message?.token as string;
        const ok = await call(h.url, 'POST', '/auth/verify-email', { body: { token } });
        expect(ok.status).toBe(200);
        expect(ok.body).toEqual({
          code: 'EMAIL_VERIFIED',
          messageKey: 'common.auth.emailVerified',
        });
        const again = await call(h.url, 'POST', '/auth/verify-email', { body: { token } });
        expect(again.status).toBe(400);
        expect(again.body).toMatchObject({ code: 'AUTH_LINK_EXPIRED' });
        // la session ouverte avant la vérification est révoquée (pré-détournement de compte)
        const old = await call(h.url, 'GET', '/auth/session', {
          cookie: `__Host-session=${session}`,
        });
        expect(old.status).toBe(401);
        // aucun jeton (session, lien) ni mot de passe dans la sortie de l'application
        const output = h.output();
        for (const secret of [token, session, PASSWORD]) expect(output).not.toContain(secret);
      }));

    it('CSRF : une écriture sans Content-Type JSON est refusée (415) sans effet', () =>
      withApp(async (h) => {
        const { token } = await signupAndLogin(h);
        const cookie = `__Host-session=${token}`;
        const form = await call(h.url, 'POST', '/auth/logout', {
          cookie,
          contentType: 'application/x-www-form-urlencoded',
        });
        expect(form.status).toBe(415);
        expect(form.body).toMatchObject({ code: 'REQUEST_INVALID' });
        expect((await call(h.url, 'GET', '/auth/session', { cookie })).status).toBe(200);
      }));
  });
}
