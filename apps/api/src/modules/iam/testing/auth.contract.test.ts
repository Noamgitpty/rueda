/**
 * US-041 — tests de contrat des routes /auth (US-010) sur le FAKE du magasin (sans base) : chaque
 * réponse HTTP réelle est confrontée à `apps/api/openapi/openapi.json` par `ContractClient`
 * (corps, codes d'erreur stables, `Cache-Control`, cookie `__Host-session`). Données fictives
 * (`@example.test`) ; limites de débit abaissées pour exercer les 429.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ContractClient, repositoryContract } from '../../../testing/openapi-contract.js';
import { DEFAULT_AUTH_POLICY } from '../internal/policy.js';
import { FakeAuthStore } from './fake-auth-store.js';
import { sessionTokenFrom, startAuthApp } from './http-harness.js';
import type { AuthHttpHarness } from './http-harness.js';

const PASSWORD = 'Correct-Horse-9';
const LOW_LIMITS = { ...DEFAULT_AUTH_POLICY, signupsPerIp: 3, loginFailuresPerEmail: 2 };

describe('contrat HTTP — /auth', () => {
  const contract = repositoryContract();
  const covered = new Set<string>();
  const harnesses: AuthHttpHarness[] = [];

  async function client(
    policy = DEFAULT_AUTH_POLICY,
  ): Promise<{ api: ContractClient; h: AuthHttpHarness }> {
    const h = await startAuthApp(new FakeAuthStore(), { policy });
    harnesses.push(h);
    return { api: new ContractClient(contract, h.url), h };
  }
  afterEach(async () => {
    for (const h of harnesses.splice(0)) await h.close();
  });
  const record = (api: ContractClient) => {
    for (const c of api.covered) covered.add(c);
  };
  const signupBody = (email: string, over: Record<string, unknown> = {}) => ({
    email,
    password: PASSWORD,
    legalFirstName: 'Ana',
    legalLastName: 'Prueba',
    locale: 'es',
    termsAccepted: true,
    ...over,
  });

  it('parcours : inscription, connexion, session, vérification, déconnexions', async () => {
    const { api, h } = await client();
    const email = `c-${randomUUID()}@example.test`;
    expect((await api.request('POST', '/auth/signup', { body: signupBody(email) })).status).toBe(
      202,
    );
    const login = await api.request('POST', '/auth/login', { body: { email, password: PASSWORD } });
    expect(login.status).toBe(200);
    const cookie = `__Host-session=${sessionTokenFrom(login.headers.getSetCookie()) ?? ''}`;
    const session = await api.request('GET', '/auth/session', { headers: { cookie } });
    expect(session.status).toBe(200);
    expect(session.json).toMatchObject({ mfaLevel: 'NONE', emailVerified: false });

    const token = h.notifier.verifications.at(-1)?.token ?? '';
    expect((await api.request('POST', '/auth/verify-email', { body: { token } })).status).toBe(200);
    expect((await api.request('POST', '/auth/verify-email', { body: { token } })).status).toBe(400);

    const again = await api.request('POST', '/auth/login', { body: { email, password: PASSWORD } });
    const cookie2 = `__Host-session=${sessionTokenFrom(again.headers.getSetCookie()) ?? ''}`;
    expect(
      (await api.request('POST', '/auth/logout-all', { headers: { cookie: cookie2 } })).status,
    ).toBe(204);
    expect(
      (await api.request('POST', '/auth/logout-all', { headers: { cookie: cookie2 } })).status,
    ).toBe(401);
    expect(
      (await api.request('GET', '/auth/session', { headers: { cookie: cookie2 } })).status,
    ).toBe(401);
    expect((await api.request('POST', '/auth/logout')).status).toBe(204);
    record(api);
  });

  it('refus : 400 (champs), 401 (identifiants), 415 (pas de JSON) avec codes stables', async () => {
    const { api } = await client();
    const email = `r-${randomUUID()}@example.test`;
    for (const over of [
      { email: 'pas-un-email' },
      { password: 'court' },
      { termsAccepted: false },
      { locale: 7 },
    ]) {
      const r = await api.request('POST', '/auth/signup', { body: signupBody(email, over) });
      expect(r.status).toBe(400);
    }
    expect((await api.request('POST', '/auth/login', { body: { email } })).status).toBe(400);
    expect(
      (await api.request('POST', '/auth/login', { body: { email, password: 'Mauvais-Mot-9' } }))
        .status,
    ).toBe(401);
    expect((await api.request('POST', '/auth/verify-email', { body: {} })).status).toBe(400);
    const text = { headers: { 'content-type': 'text/plain' } };
    for (const path of [
      '/auth/signup',
      '/auth/login',
      '/auth/logout',
      '/auth/logout-all',
      '/auth/verify-email',
    ]) {
      expect((await api.request('POST', path, text)).status).toBe(415);
    }
    record(api);
  });

  it('débit : 429 RATE_LIMITED à l’inscription et à la connexion', async () => {
    const { api } = await client(LOW_LIMITS);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await api.request('POST', '/auth/signup', {
        body: signupBody(`d-${randomUUID()}@example.test`),
      });
      statuses.push(r.status);
    }
    expect(statuses).toContain(429);
    const email = `l-${randomUUID()}@example.test`;
    const login: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await api.request('POST', '/auth/login', {
        body: { email, password: 'Mauvais-Mot-9' },
      });
      login.push(r.status);
    }
    expect(login).toContain(429);
    record(api);
  });

  it('couverture : chaque statut déclaré pour /auth est exercé', () => {
    const declared = Object.entries(contract.document.paths)
      .filter(([template]) => template.startsWith('/auth'))
      .flatMap(([template, item]) =>
        Object.entries(item).flatMap(([method, op]) =>
          Object.keys(op.responses ?? {}).map((s) => `${method.toUpperCase()} ${template} ${s}`),
        ),
      );
    expect(declared.filter((d) => !covered.has(d))).toEqual([]);
  });
});
