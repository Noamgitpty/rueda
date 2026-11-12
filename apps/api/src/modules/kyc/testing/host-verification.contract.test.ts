/**
 * US-123 — tests de contrat des routes `/host/accounts/{orgId}/verification` sur l'application
 * RÉELLE (ApiModule, harnais d'US-043), le FAKE du magasin (sans base), le FAKE du prestataire de
 * filtrage (`@rueda/fake-adapters/sanctions`) et le FAKE du coffre (`FakeTaxIdSealer`, enveloppe
 * réelle de `@rueda/db/audit`) : chaque réponse est confrontée à `apps/api/openapi/openapi.json`.
 * Attendus : 19 US-123 et 16 HST-049 / FIN-008 / VER-028 (personne morale ⇒
 * HOST_ENTITY_NOT_ALLOWED ; numéro fiscal chiffré, jamais en clair ; correspondance de sanctions ⇒
 * dossier bloqué, motif jamais révélé à l'hôte ; compte d'un autre ⇒ 404). Les règles elles-mêmes
 * (âge, résidence, activation, interrupteurs) sont prouvées sur PostgreSQL
 * (packages/db/test/l0/l0-us123-*). Données fictives.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeClock, FakeSanctionsScreener } from '@rueda/fake-adapters';
import { CountryConfigService } from '../../cfg/index.js';
import {
  closeContractApps,
  contract,
  coverageOf,
  FIRST_COUNTRY,
  startContractApp,
  textBody,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import { FakeHostVerificationStore } from './fake-host-verification-store.js';
import { FakeTaxIdSealer } from './fake-tax-id-sealer.js';

const JSON_HEADERS = { 'content-type': 'application/json' };
const LISTS = { UN: '2026-11-01', OFAC: '2026-11-10' };
/** Types de numéro fiscal du premier pays (données CFG, jamais une constante). */
const TAX_KINDS: readonly string[] =
  new CountryConfigService().config.countries.get(FIRST_COUNTRY)?.hostTaxIdKinds ?? [];
const KIND = TAX_KINDS[0] ?? '';

interface World {
  readonly app: ContractApp;
  readonly store: FakeHostVerificationStore;
  readonly sealer: FakeTaxIdSealer;
  readonly screener: FakeSanctionsScreener;
  readonly headers: Record<string, string>;
  readonly org: string;
  readonly base: string;
}

const apps: ContractApp[] = [];

async function world(
  options: { screener?: boolean; sealer?: boolean; kycApproved?: boolean } = {},
): Promise<World> {
  const store = new FakeHostVerificationStore();
  const sealer = new FakeTaxIdSealer();
  sealer.available = options.sealer !== false;
  const screener = new FakeSanctionsScreener({
    clock: new FakeClock(new Date()),
    listsVersion: LISTS,
    env: { RUEDA_ENV: 'test' },
  });
  const log = { warn: () => undefined };
  const app = await startContractApp({
    kyc: {
      host: {
        store,
        screener: options.screener === false ? null : { code: 'FAKE', screener },
        sealer,
        log,
      },
    },
  });
  apps.push(app);
  const org = randomUUID();
  store.addAccount(app.hash('voyageur'), org, FIRST_COUNTRY, TAX_KINDS, {
    kycApproved: options.kycApproved !== false,
  });
  return {
    app,
    store,
    sealer,
    screener,
    headers: { ...app.cookie('voyageur'), ...JSON_HEADERS },
    org,
    base: `/host/accounts/${org}/verification`,
  };
}

afterAll(async () => {
  await closeContractApps();
});

describe('US-123 — liste de tâches de l’hôte (A07)', () => {
  it('GET : état de son compte d’hôte, sans date de naissance ni numéro ; types de numéro du pays', async () => {
    const w = await world();
    const r = await w.app.api.request('GET', w.base, { headers: w.headers });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toMatchObject({
      code: 'HOST_VERIFICATION_STATE',
      country: FIRST_COUNTRY,
      orgStatus: 'ONBOARDING',
      verificationStatus: null,
      taxKinds: TAX_KINDS,
      taxSaved: false,
    });
    expect((r.json as { blockers: string[] }).blockers).toContain('INSURER_CONTRACT_INACTIVE');
    expect(JSON.stringify(r.json)).not.toMatch(/dateOfBirth|birth/i);
  });

  it('401 sans session ; 404 pour le compte d’un autre, inconnu ou mal formé ; 503 base indisponible', async () => {
    const w = await world();
    expect((await w.app.api.request('GET', w.base)).status).toBe(401);
    expect((await w.app.api.request('POST', w.base, { body: {} })).status).toBe(401);
    expect(
      (await w.app.api.request('POST', `${w.base}/tax-profile`, { body: { kind: KIND } })).status,
    ).toBe(401);
    const other = randomUUID();
    w.store.addAccount('autre-hote', other, FIRST_COUNTRY, TAX_KINDS);
    for (const org of [other, randomUUID(), 'pas-un-uuid']) {
      const base = `/host/accounts/${org}/verification`;
      const get = await w.app.api.request('GET', base, { headers: w.headers });
      expect(get.status).toBe(404);
      expect(get.json).toMatchObject({ code: 'HOST_ACCOUNT_NOT_FOUND' });
      expect((await w.app.api.request('POST', base, { headers: w.headers, body: {} })).status).toBe(
        404,
      );
      const tax = await w.app.api.request('POST', `${base}/tax-profile`, {
        headers: w.headers,
        body: { kind: KIND, taxId: '1234567-8' },
      });
      expect(tax.status).toBe(404);
    }
    expect(w.store.taxOf(other)).toBeNull();
    w.store.failing = true;
    for (const [method, path, body] of [
      ['GET', w.base, undefined],
      ['POST', w.base, {}],
      ['POST', `${w.base}/tax-profile`, { kind: KIND, taxId: '1234567-8' }],
    ] as const) {
      const r = await w.app.api.request(method, path, {
        headers: w.headers,
        ...(body === undefined ? {} : { body }),
      });
      expect(r.status).toBe(503);
      expect(r.json).toMatchObject({ code: 'HOST_VERIFICATION_UNAVAILABLE' });
    }
  });
});

describe('US-123 — profil fiscal (FIN-008)', () => {
  it('numéro chiffré par la clé du compte d’hôte avant l’écriture, jamais en clair', async () => {
    const w = await world();
    const r = await w.app.api.request('POST', `${w.base}/tax-profile`, {
      headers: w.headers,
      body: { kind: KIND, taxId: ' 1234567-8 ', regime: 'GENERAL' },
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ code: 'HOST_TAX_PROFILE_SAVED', taxSaved: true, taxKind: KIND });
    expect(JSON.stringify(r.json)).not.toContain('1234567');
    const saved = w.store.taxOf(w.org);
    if (saved === null) throw new Error('profil absent');
    expect(saved.envelope.includes(Buffer.from('1234567-8'))).toBe(false);
    expect(w.sealer.openFor(w.org, saved.envelope)).toBe('1234567-8');
    expect(saved).toMatchObject({ kind: KIND, regime: 'GENERAL' });
  });

  it('personne morale ⇒ 422 HOST_ENTITY_NOT_ALLOWED ; numéro ou type invalides ⇒ 422 ; corps invalide ⇒ 400 ; texte ⇒ 415', async () => {
    const w = await world();
    const post = (body: unknown) =>
      w.app.api.request('POST', `${w.base}/tax-profile`, { headers: w.headers, body });
    for (const body of [
      { kind: KIND, taxId: '1234567-8', taxpayerKind: 'LEGAL_ENTITY' },
      { kind: KIND, taxId: '1234567-8', companyName: 'Autos S.A.' },
    ]) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect(r.json).toMatchObject({ code: 'HOST_ENTITY_NOT_ALLOWED' });
    }
    const badId = await post({ kind: KIND, taxId: '12' });
    expect(badId.status).toBe(422);
    expect(badId.json).toMatchObject({ code: 'HOST_TAX_ID_INVALID' });
    const badKind = await post({ kind: 'NOT_A_KIND', taxId: '1234567-8' });
    expect(badKind.status).toBe(422);
    expect(badKind.json).toMatchObject({ code: 'HOST_TAX_ID_KIND_INVALID' });
    for (const body of [{ taxId: '1234567-8' }, { kind: KIND, taxId: '1', extra: true }, []]) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    expect(
      (await w.app.api.request('POST', `${w.base}/tax-profile`, textBody(w.app.cookie('voyageur'))))
        .status,
    ).toBe(415);
    expect(w.store.taxOf(w.org)).toBeNull();
  });

  it('coffre indisponible ⇒ 503 HOST_TAX_VAULT_UNAVAILABLE, rien n’est écrit', async () => {
    const w = await world({ sealer: false });
    const r = await w.app.api.request('POST', `${w.base}/tax-profile`, {
      headers: w.headers,
      body: { kind: KIND, taxId: '1234567-8' },
    });
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: 'HOST_TAX_VAULT_UNAVAILABLE' });
    expect(w.store.taxOf(w.org)).toBeNull();
  });
});

describe('US-123 — soumission du dossier et filtrage des sanctions (VER-028)', () => {
  it('soumission complète : filtrage CLEAR consigné, dossier en revue ; le prestataire ne reçoit aucune donnée personnelle', async () => {
    const w = await world();
    await w.app.api.request('POST', `${w.base}/tax-profile`, {
      headers: w.headers,
      body: { kind: KIND, taxId: '1234567-8' },
    });
    const r = await w.app.api.request('POST', w.base, { headers: w.headers, body: {} });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      code: 'HOST_VERIFICATION_SUBMITTED',
      verificationStatus: 'IN_REVIEW',
      missing: [],
      screeningDone: true,
    });
    expect(w.store.screeningOf(w.org)).toMatchObject({
      provider: 'FAKE',
      result: 'CLEAR',
      listsVersion: LISTS,
      matchRef: null,
    });
    expect(w.screener.received).toHaveLength(1);
    expect(Object.keys(w.screener.received[0] ?? {}).sort()).toEqual([
      'country',
      'idempotencyKey',
      'identityProvider',
      'identitySessionRef',
    ]);
  });

  it('correspondance ⇒ dossier bloqué, aucun motif révélé ; profil fiscal ensuite verrouillé (409)', async () => {
    const w = await world();
    w.screener.flag(`fk_idv_${w.org.slice(0, 8)}`, 'POTENTIAL_MATCH');
    const r = await w.app.api.request('POST', w.base, { headers: w.headers, body: {} });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ verificationStatus: 'BLOCKED' });
    expect(JSON.stringify(r.json)).not.toMatch(/SANCTION|MATCH|fk_aml/);
    const tax = await w.app.api.request('POST', `${w.base}/tax-profile`, {
      headers: w.headers,
      body: { kind: KIND, taxId: '1234567-8' },
    });
    expect(tax.status).toBe(409);
    expect(tax.json).toMatchObject({ code: 'HOST_VERIFICATION_LOCKED' });
  });

  it('sans prestataire de filtrage (production) : dossier incomplet, HOST_SCREENING_MISSING', async () => {
    const w = await world({ screener: false });
    const r = await w.app.api.request('POST', w.base, { headers: w.headers, body: {} });
    expect(r.status).toBe(200);
    expect((r.json as { missing: string[] }).missing).toContain('HOST_SCREENING_MISSING');
    expect(r.json).toMatchObject({ verificationStatus: 'DOCS_PENDING', screeningDone: false });
  });

  it('refus jugés en base : 403 identité non vérifiée ; 409 compte non éligible ; 415 texte', async () => {
    const w = await world({ kycApproved: false });
    const r = await w.app.api.request('POST', w.base, { headers: w.headers, body: {} });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ code: 'HOST_KYC_REQUIRED' });
    w.store.submitRefusal = 'HOST_ACCOUNT_NOT_ELIGIBLE';
    const n = await w.app.api.request('POST', w.base, { headers: w.headers, body: {} });
    expect(n.status).toBe(409);
    expect(n.json).toMatchObject({ code: 'HOST_ACCOUNT_NOT_ELIGIBLE' });
    for (const refusal of [
      'HOST_UNDER_AGE',
      'HOST_AGE_UNVERIFIED',
      'HOST_RESIDENCE_MISMATCH',
    ] as const) {
      w.store.submitRefusal = refusal;
      const x = await w.app.api.request('POST', w.base, { headers: w.headers, body: {} });
      expect(x.status).toBe(403);
      expect(x.json).toMatchObject({ code: refusal });
    }
    expect(
      (await w.app.api.request('POST', w.base, textBody(w.app.cookie('voyageur')))).status,
    ).toBe(415);
  });

  it('couverture : chaque statut déclaré pour /host/accounts/{orgId}/verification est exercé', () => {
    expect(
      missingCoverage(contract, '/host/accounts/{orgId}/verification', coverageOf(...apps)),
    ).toEqual([]);
  });
});
