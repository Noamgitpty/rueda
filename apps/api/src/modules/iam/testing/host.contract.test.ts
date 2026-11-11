/**
 * US-107 — tests de contrat de la route /host/accounts (ouverture du compte d'hôte) et des rôles
 * de `GET /auth/session`, sur le FAKE du magasin (sans base) : chaque réponse HTTP réelle est
 * confrontée à `apps/api/openapi/openapi.json` (corps, codes stables, `Cache-Control`). Attendus :
 * 19 US-107 (une personne, un compte d'hôte par pays ; personne physique seulement ; rôle
 * P2P_HOST en plus de GUEST à la reconnexion ; nom affiché = prénom), 16 A.8. Données fictives.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CountryConfigService } from '../../cfg/index.js';
import { ContractClient, repositoryContract } from '../../../testing/openapi-contract.js';
import type { HolderKind, HostAccountOutcome } from '../internal/auth-store.js';
import { FakeAuthStore } from './fake-auth-store.js';
import { sessionTokenFrom, startAuthApp } from './http-harness.js';
import type { AuthHttpHarness } from './http-harness.js';

const PASSWORD = 'Correct-Horse-9';
/** Pays configurés (données de configuration, jamais une constante du code). */
const COUNTRIES = [...new CountryConfigService().config.countries.keys()].sort();
const COUNTRY = COUNTRIES[0] ?? '';

/** FAKE dont l'issue de la base est imposée (âge, paramètre absent : non modélisés). */
class ForcedOutcomeStore extends FakeAuthStore {
  forced: HostAccountOutcome | null = null;
  override async openHostAccount(tokenHash: Buffer, country: string, kind: HolderKind) {
    if (this.forced !== null) return { outcome: this.forced, orgId: null };
    return super.openHostAccount(tokenHash, country, kind);
  }
}

describe('contrat HTTP — /host', () => {
  const contract = repositoryContract();
  const covered = new Set<string>();
  const harnesses: AuthHttpHarness[] = [];
  afterEach(async () => {
    for (const h of harnesses.splice(0)) await h.close();
  });
  const record = (api: ContractClient) => {
    for (const c of api.covered) covered.add(c);
  };

  /** Personne inscrite (prénom « Ana María »), e-mail vérifié sauf demande, connectée. */
  async function person(
    api: ContractClient,
    h: AuthHttpHarness,
    options: { verified?: boolean } = {},
  ): Promise<string> {
    const email = `h-${randomUUID()}@example.test`;
    const signup = await api.request('POST', '/auth/signup', {
      body: {
        email,
        password: PASSWORD,
        legalFirstName: 'Ana María',
        legalLastName: 'Prueba Gómez',
        locale: 'es',
        termsAccepted: true,
        acceptedDocuments: [
          { kind: 'TOS_GUEST', version: 1 },
          { kind: 'PRIVACY', version: 1 },
        ],
      },
    });
    expect(signup.status).toBe(202);
    if (options.verified !== false) {
      const token = h.notifier.verifications.at(-1)?.token ?? '';
      expect((await api.request('POST', '/auth/verify-email', { body: { token } })).status).toBe(
        200,
      );
    }
    const login = await api.request('POST', '/auth/login', { body: { email, password: PASSWORD } });
    expect(login.status).toBe(200);
    return `__Host-session=${sessionTokenFrom(login.headers.getSetCookie()) ?? ''}`;
  }

  async function app(store = new ForcedOutcomeStore()) {
    const h = await startAuthApp(store);
    harnesses.push(h);
    return { api: new ContractClient(contract, h.url), h, store };
  }

  it('critère 4 : ouverture (201), rôle P2P_HOST en plus de GUEST à la reconnexion, nom affiché = prénom ; critère 1 : seconde demande 409', async () => {
    const { api, h } = await app();
    const cookie = await person(api, h);
    const before = await api.request('GET', '/auth/session', { headers: { cookie } });
    expect(before.json).toMatchObject({ roles: ['GUEST'], hostAccounts: [] });
    const opened = await api.request('POST', '/host/accounts', {
      headers: { cookie },
      body: { country: COUNTRY, holderKind: 'INDIVIDUAL' },
    });
    expect(opened.status).toBe(201);
    expect(opened.json).toMatchObject({ code: 'HOST_ACCOUNT_OPENED' });
    const orgId = (opened.json as { orgId: string }).orgId;
    const again = await api.request('POST', '/host/accounts', {
      headers: { cookie },
      body: { country: COUNTRY, holderKind: 'INDIVIDUAL' },
    });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ code: 'HOST_ACCOUNT_EXISTS' });
    const session = await api.request('GET', '/auth/session', { headers: { cookie } });
    expect(session.json).toMatchObject({
      roles: ['GUEST', 'P2P_HOST'],
      hostAccounts: [
        {
          orgId,
          country: COUNTRY,
          role: 'P2P_HOST',
          status: 'ONBOARDING',
          displayName: 'Ana María',
        },
      ],
    });
    // jamais le nom de famille dans ce que voit le voyageur
    expect(JSON.stringify(session.json)).not.toContain('Gómez');
    record(api);
  });

  it('critère 2 : personne morale (holderKind ou raison sociale, nom commercial, numéro fiscal d’entreprise) => 422 HOST_ENTITY_NOT_ALLOWED, aucun compte', async () => {
    const { api, h, store } = await app();
    const cookie = await person(api, h);
    for (const body of [
      { country: COUNTRY, holderKind: 'LEGAL_ENTITY' },
      { country: COUNTRY, holderKind: 'INDIVIDUAL', legalName: 'Autos del Istmo S.A.' },
      { country: COUNTRY, holderKind: 'INDIVIDUAL', tradeName: 'Rent Express' },
      { country: COUNTRY, holderKind: 'INDIVIDUAL', companyTaxId: '80012345-6' },
    ]) {
      const r = await api.request('POST', '/host/accounts', { headers: { cookie }, body });
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect(r.json).toMatchObject({ code: 'HOST_ENTITY_NOT_ALLOWED' });
    }
    expect(store.hostOrgs).toEqual([]);
    record(api);
  });

  it('refus : 400 (corps, pays inconnu), 401 (sans session), 403 (e-mail non vérifié), 415 (pas de JSON), 422 (âge), 503 (paramètre absent)', async () => {
    const { api, h, store } = await app();
    const verified = await person(api, h);
    for (const body of [
      {},
      { country: COUNTRY },
      { country: COUNTRY.toLowerCase(), holderKind: 'INDIVIDUAL' },
      { country: COUNTRY, holderKind: 'PERSON' },
      { country: COUNTRY, holderKind: 'INDIVIDUAL', displayName: 'Otro nombre' },
    ]) {
      const r = await api.request('POST', '/host/accounts', {
        headers: { cookie: verified },
        body,
      });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    const unknown = await api.request('POST', '/host/accounts', {
      headers: { cookie: verified },
      body: { country: 'ZZ', holderKind: 'INDIVIDUAL' },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.json).toMatchObject({ code: 'COUNTRY_UNKNOWN' });
    const anonymous = await api.request('POST', '/host/accounts', {
      body: { country: COUNTRY, holderKind: 'INDIVIDUAL' },
    });
    expect(anonymous.status).toBe(401);
    const pending = await person(api, h, { verified: false });
    const notEligible = await api.request('POST', '/host/accounts', {
      headers: { cookie: pending },
      body: { country: COUNTRY, holderKind: 'INDIVIDUAL' },
    });
    expect(notEligible.status).toBe(403);
    expect(notEligible.json).toMatchObject({ code: 'HOST_ACCOUNT_NOT_ELIGIBLE' });
    expect(
      (
        await api.request('POST', '/host/accounts', {
          headers: { cookie: verified, 'content-type': 'text/plain' },
        })
      ).status,
    ).toBe(415);
    store.forced = 'HOST_UNDER_AGE';
    const young = await api.request('POST', '/host/accounts', {
      headers: { cookie: verified },
      body: { country: COUNTRY, holderKind: 'INDIVIDUAL' },
    });
    expect(young.status).toBe(422);
    expect(young.json).toMatchObject({ code: 'HOST_UNDER_AGE' });
    store.forced = 'PARAM_MISSING';
    const missing = await api.request('POST', '/host/accounts', {
      headers: { cookie: verified },
      body: { country: COUNTRY, holderKind: 'INDIVIDUAL' },
    });
    expect(missing.status).toBe(503);
    expect(missing.json).toMatchObject({ code: 'HOST_ACCOUNT_UNAVAILABLE' });
    expect(store.hostOrgs).toEqual([]);
    record(api);
  });

  it('IDOR : la personne B ne voit jamais le compte d’hôte de A ; un compte par pays configuré', async () => {
    const { api, h } = await app();
    const a = await person(api, h);
    const b = await person(api, h);
    for (const country of COUNTRIES) {
      const r = await api.request('POST', '/host/accounts', {
        headers: { cookie: a },
        body: { country, holderKind: 'INDIVIDUAL' },
      });
      expect(r.status, country).toBe(201);
    }
    const sa = await api.request('GET', '/auth/session', { headers: { cookie: a } });
    expect(
      (sa.json as { hostAccounts: { country: string }[] }).hostAccounts.map((x) => x.country),
    ).toEqual(COUNTRIES);
    const sb = await api.request('GET', '/auth/session', { headers: { cookie: b } });
    expect(sb.json).toMatchObject({ roles: ['GUEST'], hostAccounts: [] });
    record(api);
  });

  it('couverture : chaque statut déclaré pour /host est exercé', () => {
    const declared = Object.entries(contract.document.paths)
      .filter(([template]) => template.startsWith('/host'))
      .flatMap(([template, item]) =>
        Object.entries(item).flatMap(([method, op]) =>
          Object.keys(op.responses ?? {}).map((s) => `${method.toUpperCase()} ${template} ${s}`),
        ),
      );
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((d) => !covered.has(d))).toEqual([]);
  });
});
