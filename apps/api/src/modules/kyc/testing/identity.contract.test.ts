/**
 * US-105 — tests de contrat des routes `/identity` et `/kyc/webhooks/{provider}` sur l'application
 * RÉELLE (ApiModule, harnais d'US-043), le FAKE du magasin (sans base) et le FAKE du fournisseur
 * d'identité (`@rueda/fake-adapters/identity`) : chaque réponse est confrontée à
 * `apps/api/openapi/openapi.json`. Attendus : 19 US-105 et 16 VER-001 / VER-004 (consentement
 * absent ⇒ KYC_BIOMETRIC_CONSENT_MISSING et aucune session chez le fournisseur ; rappel signé
 * reçu deux fois ⇒ une seule décision ; signature invalide ⇒ rejet journalisé ; permis expiré ⇒
 * KYC_LICENSE_EXPIRED ; aucune image) ; 17 §4.4 (corps brut signé). Les règles elles-mêmes sont
 * prouvées sur PostgreSQL (packages/db/test/l0/l0-us105-*). Données fictives.
 */
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeClock, FakeIdentityProvider } from '@rueda/fake-adapters';
import {
  closeContractApps,
  contract,
  COUNTRIES,
  coverageOf,
  FIRST_COUNTRY,
  startContractApp,
  textBody,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import { KYC_SIGNATURE_HEADER } from '../internal/kyc-webhook.controller.js';
import {
  IdentityVerificationService,
  LICENSE_DOCUMENT_KIND,
} from '../internal/identity.service.js';
import { kycCountries } from '../internal/production.js';
import type { KycStatus } from '../internal/identity-store.js';
import { FakeIdentityStore } from './fake-identity-store.js';

const PROVIDER = 'FAKE';
const JSON_HEADERS = { 'content-type': 'application/json' };

interface World {
  readonly app: ContractApp;
  readonly store: FakeIdentityStore;
  readonly kyc: FakeIdentityProvider;
  readonly guest: Record<string, string>;
  readonly guestHash: string;
}

const apps: ContractApp[] = [];

async function world(options: { provider?: boolean; phone?: boolean } = {}): Promise<World> {
  const store = new FakeIdentityStore();
  const kyc = new FakeIdentityProvider({
    clock: new FakeClock(new Date()),
    // pièces acceptées : le permis de chaque pays de la configuration (données CFG)
    documents: COUNTRIES.map((country) => ({ country, kind: LICENSE_DOCUMENT_KIND })),
    webhookSecret: randomBytes(24).toString('hex'),
    sessionTtlMs: 30 * 60_000,
    webhookToleranceSeconds: 300,
    env: { RUEDA_ENV: 'test' },
  });
  const app = await startContractApp({
    kyc: {
      store,
      providers:
        options.provider === false
          ? { active: null, byCode: new Map() }
          : { active: { code: PROVIDER, provider: kyc }, byCode: new Map([[PROVIDER, kyc]]) },
      returnUrl: options.provider === false ? null : 'https://app.example.invalid/verify-identity',
      countries: kycCountries(),
      log: { warn: () => undefined },
    },
  });
  apps.push(app);
  const guestHash = app.hash('voyageur');
  store.addPerson(guestHash, { phoneVerified: options.phone !== false });
  return { app, store, kyc, guest: { ...app.cookie('voyageur'), ...JSON_HEADERS }, guestHash };
}

const LICENCE = (country: string) => ({
  livenessScore: 0.97,
  faceMatchScore: 0.93,
  document: {
    kind: LICENSE_DOCUMENT_KIND,
    country,
    expiresOn: '2031-06-30',
    licenseClass: 'B',
    isPermanent: true,
    providerDocumentRef: 'doc_contract',
  },
});

async function consented(w: World): Promise<void> {
  const r = await w.app.api.request('POST', '/identity/consent', {
    headers: w.guest,
    body: { version: 1, accepted: true, country: FIRST_COUNTRY },
  });
  expect(r.status).toBe(200);
}

async function started(w: World): Promise<string> {
  await consented(w);
  const r = await w.app.api.request('POST', '/identity/verification', {
    headers: w.guest,
    body: { country: FIRST_COUNTRY },
  });
  expect(r.status).toBe(201);
  const hostedUrl = (r.json as { hostedUrl: string }).hostedUrl;
  return hostedUrl.slice(hostedUrl.lastIndexOf('/') + 1);
}

describe('US-105 — GET /identity et consentement biométrique (VER-004)', () => {
  it('état de la personne : statut, texte du consentement, pays de la configuration', async () => {
    const w = await world();
    const r = await w.app.api.request('GET', `/identity?country=${FIRST_COUNTRY}`, {
      headers: w.guest,
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      code: 'KYC_STATE',
      status: 'NOT_STARTED',
      available: true,
      consent: { version: 1, accepted: false },
    });
    expect((r.json as { countries: { code: string }[] }).countries.map((c) => c.code)).toEqual([
      ...COUNTRIES,
    ]);
    expect(
      (await w.app.api.request('GET', '/identity?country=z9', { headers: w.guest })).status,
    ).toBe(400);
    expect((await w.app.api.request('GET', '/identity')).status).toBe(401);
    w.store.failing = true;
    expect((await w.app.api.request('GET', '/identity', { headers: w.guest })).status).toBe(503);
  });

  // US-106 (08 BR-VERIF-03) : jamais le motif brut d'un refus ; seulement la catégorie de reprise
  it('motif rendu au voyageur : catégorie de reprise d’une nouvelle pièce seulement, jamais un refus ni un doublon', async () => {
    const w = await world();
    const reason = async (status: KycStatus, code: string | null) => {
      w.store.setDecision(w.guestHash, status, code);
      const r = await w.app.api.request('GET', '/identity', { headers: w.guest });
      expect(r.status).toBe(200);
      return (r.json as { reasonCode: unknown }).reasonCode;
    };
    expect(await reason('MORE_INFO_REQUIRED', 'LIVENESS_FAILED')).toBe('LIVENESS_FAILED');
    expect(await reason('MORE_INFO_REQUIRED', 'ID_DOCUMENT_REFUSED')).toBe('ID_DOCUMENT_REFUSED');
    expect(await reason('MORE_INFO_REQUIRED', 'LICENSE_NOT_ACCEPTED')).toBe('LICENSE_NOT_ACCEPTED');
    expect(await reason('MORE_INFO_REQUIRED', 'DUPLICATE_ACCOUNT')).toBeNull();
    expect(await reason('MORE_INFO_REQUIRED', 'MORE_INFO_REQUESTED')).toBeNull();
    expect(await reason('REJECTED', 'DUPLICATE_ACCOUNT')).toBeNull();
    expect(await reason('REJECTED', 'LIVENESS_FAILED')).toBeNull();
    expect(await reason('MANUAL_REVIEW', 'PROVIDER_REVIEW')).toBeNull();
    expect(await reason('RECHECK', 'CONSENT_WITHDRAWN')).toBeNull();
  });

  it('acceptation de la version affichée ; version périmée 409 ; retrait ; refus', async () => {
    const w = await world();
    const api = w.app.api;
    const post = (body: unknown) =>
      api.request('POST', '/identity/consent', { headers: w.guest, body });
    expect((await post({ version: 1, accepted: true })).json).toMatchObject({
      code: 'KYC_CONSENT_RECORDED',
      version: 1,
    });
    w.store.currentVersion = 2;
    const stale = await post({ version: 1, accepted: true });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ code: 'KYC_CONSENT_VERSION_CHANGED' });
    expect((await post({ accepted: false })).status).toBe(200);
    expect((await post({ accepted: 'yes' })).status).toBe(400);
    expect((await post({ version: 0, accepted: true })).status).toBe(400);
    expect((await api.request('POST', '/identity/consent', { ...textBody(w.guest) })).status).toBe(
      415,
    );
    expect(
      (await api.request('POST', '/identity/consent', { body: { version: 2, accepted: true } }))
        .status,
    ).toBe(401);
    w.store.consentRefusal = 'NOT_ELIGIBLE';
    expect((await post({ version: 2, accepted: true })).json).toMatchObject({
      code: 'KYC_NOT_ELIGIBLE',
    });
    w.store.consentRefusal = null;
    w.store.failing = true;
    expect((await post({ version: 2, accepted: true })).status).toBe(503);
  });
});

describe('US-105 — POST /identity/verification (critère 2 et parcours hébergé)', () => {
  it('sans consentement : KYC_BIOMETRIC_CONSENT_MISSING et AUCUNE session chez le fournisseur', async () => {
    const w = await world();
    const r = await w.app.api.request('POST', '/identity/verification', {
      headers: w.guest,
      body: { country: FIRST_COUNTRY },
    });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ code: 'KYC_BIOMETRIC_CONSENT_MISSING' });
    // aucune session créée : la première session du FAKE n'existe pas
    expect(await w.kyc.getStatus('fk_idv_000001')).toEqual({
      status: 'REFUSED',
      reason: 'UNKNOWN_SESSION',
    });
  });

  it('session hébergée ouverte (201), reprise (200) ; adresse sans donnée du sujet', async () => {
    const w = await world();
    await consented(w);
    const api = w.app.api;
    const first = await api.request('POST', '/identity/verification', {
      headers: w.guest,
      body: { country: FIRST_COUNTRY },
    });
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ code: 'KYC_SESSION_STARTED' });
    const url = (first.json as { hostedUrl: string }).hostedUrl;
    expect(url).toMatch(/^https:\/\/identity\.fake\.invalid\/session\/fk_idv_\d{6}$/);
    expect(w.store.statusOf(w.guestHash)).toBe('DOCS_SUBMITTED');
    const again = await api.request('POST', '/identity/verification', {
      headers: w.guest,
      body: { country: FIRST_COUNTRY },
    });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ code: 'KYC_SESSION_IN_PROGRESS', hostedUrl: url });
  });

  it('refus : requête, session, téléphone, revue, pièce, fournisseur', async () => {
    const api = (w: World) => (body: unknown) =>
      w.app.api.request('POST', '/identity/verification', { headers: w.guest, body });
    const w = await world();
    expect((await api(w)({})).status).toBe(400);
    expect((await api(w)({ country: 'XX' })).status).toBe(400);
    expect(
      (
        await w.app.api.request('POST', '/identity/verification', {
          body: { country: FIRST_COUNTRY },
        })
      ).status,
    ).toBe(401);
    expect(
      (await w.app.api.request('POST', '/identity/verification', { ...textBody(w.guest) })).status,
    ).toBe(415);

    const noPhone = await world({ phone: false });
    await consented(noPhone);
    const phone = await api(noPhone)({ country: FIRST_COUNTRY });
    expect(phone.status).toBe(403);
    expect(phone.json).toMatchObject({ code: 'PHONE_NOT_VERIFIED' });

    // revue en cours : 409
    const review = await world();
    const sessionId = await started(review);
    review.kyc.decide(sessionId, 'REVIEW', [], LICENCE(FIRST_COUNTRY));
    for (const d of review.kyc.takeDeliveries()) {
      await review.app.api.request('POST', `/kyc/webhooks/${PROVIDER}`, {
        headers: { ...JSON_HEADERS, [KYC_SIGNATURE_HEADER]: d.signature },
        raw: d.body,
      });
    }
    const inReview = await api(review)({ country: FIRST_COUNTRY });
    expect(inReview.status).toBe(409);
    expect(inReview.json).toMatchObject({ code: 'KYC_IN_REVIEW' });

    // pièce non prise en charge (capacité inconnue = « non ») : 422, aucune session
    const narrow = await world();
    await consented(narrow);
    const unsupported = new FakeIdentityProvider({
      clock: new FakeClock(new Date()),
      documents: [],
      webhookSecret: randomBytes(24).toString('hex'),
      sessionTtlMs: 60_000,
      webhookToleranceSeconds: 300,
      env: { RUEDA_ENV: 'test' },
    });
    const svc = new IdentityVerificationService({
      store: narrow.store,
      providers: { active: { code: PROVIDER, provider: unsupported }, byCode: new Map() },
      returnUrl: 'https://app.example.invalid/verify-identity',
      countries: kycCountries(),
      log: { warn: () => undefined },
    });
    await expect(
      svc.start(Buffer.from(narrow.guestHash, 'hex'), { country: FIRST_COUNTRY }, 'es'),
    ).rejects.toMatchObject({ code: 'KYC_DOCUMENT_UNSUPPORTED' });
    narrow.kyc.runtime.script.script('start', { kind: 'REFUSE', reason: 'UNSUPPORTED_DOCUMENT' });
    const refused = await api(narrow)({ country: FIRST_COUNTRY });
    expect(refused.status).toBe(422);

    // panne ou issue inconnue du fournisseur : 503 (même clé rejouée ensuite) ; refus : 502
    const flaky = await world();
    await consented(flaky);
    flaky.kyc.runtime.script.script('start', { kind: 'UNAVAILABLE' });
    expect((await api(flaky)({ country: FIRST_COUNTRY })).status).toBe(503);
    // refus quelconque du fournisseur (autre que la pièce) : 502
    flaky.kyc.runtime.script.script('start', { kind: 'REFUSE', reason: 'UNKNOWN_SESSION' });
    const failed = await api(flaky)({ country: FIRST_COUNTRY });
    expect(failed.status).toBe(502);
    expect(failed.json).toMatchObject({ code: 'KYC_SESSION_FAILED' });

    // aucun fournisseur (production tant qu'OQ-MK-09 est ouverte) : 503, rien n'est écrit
    const off = await world({ provider: false });
    await consented(off);
    const unavailable = await api(off)({ country: FIRST_COUNTRY });
    expect(unavailable.status).toBe(503);
    expect(unavailable.json).toMatchObject({ code: 'KYC_PROVIDER_UNAVAILABLE' });
    expect(off.store.statusOf(off.guestHash)).toBeNull();
  });

  it('dossier déjà approuvé : 409 KYC_ALREADY_APPROVED', async () => {
    const w = await world();
    const sessionId = await started(w);
    w.kyc.decide(sessionId, 'APPROVED', [], LICENCE(FIRST_COUNTRY));
    const [d] = w.kyc.takeDeliveries();
    if (d === undefined) throw new Error('rappel attendu');
    await w.app.api.request('POST', `/kyc/webhooks/${PROVIDER}`, {
      headers: { ...JSON_HEADERS, [KYC_SIGNATURE_HEADER]: d.signature },
      raw: d.body,
    });
    const r = await w.app.api.request('POST', '/identity/verification', {
      headers: w.guest,
      body: { country: FIRST_COUNTRY },
    });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'KYC_ALREADY_APPROVED' });
  });
});

describe('US-105 — POST /kyc/webhooks/{provider} (critère 1, corps brut signé)', () => {
  it('« approved » livré deux fois : une seule décision appliquée, l’autre rejouée', async () => {
    const w = await world();
    const sessionId = await started(w);
    w.kyc.runtime.script.script('webhook', { kind: 'DUPLICATE' });
    w.kyc.decide(sessionId, 'APPROVED', [], LICENCE(FIRST_COUNTRY), {
      selfieUrl: 'https://identity.fake.invalid/selfie.jpg',
    });
    const deliveries = w.kyc.takeDeliveries();
    expect(deliveries).toHaveLength(2);
    for (const d of deliveries) {
      const r = await w.app.api.request('POST', `/kyc/webhooks/${PROVIDER}`, {
        headers: { ...JSON_HEADERS, [KYC_SIGNATURE_HEADER]: d.signature },
        raw: d.body,
      });
      expect(r.status).toBe(200);
      expect(r.text).toBe('');
    }
    expect(w.store.decisions.map((d) => d.outcome)).toEqual(['APPLIED', 'DUPLICATE']);
    expect(w.store.statusOf(w.guestHash)).toBe('APPROVED');
  });

  it('signature invalide : 401 et rejet journalisé (empreinte du corps, jamais le corps)', async () => {
    const w = await world();
    const sessionId = await started(w);
    w.kyc.decide(sessionId, 'APPROVED', [], LICENCE(FIRST_COUNTRY));
    const [d] = w.kyc.takeDeliveries();
    if (d === undefined) throw new Error('rappel attendu');
    const forged = d.body.replace('"decision":"APPROVED"', '"decision":"DECLINED"');
    const r = await w.app.api.request('POST', `/kyc/webhooks/${PROVIDER}`, {
      headers: { ...JSON_HEADERS, [KYC_SIGNATURE_HEADER]: d.signature },
      raw: forged,
    });
    expect(r.status).toBe(401);
    const missing = await w.app.api.request('POST', `/kyc/webhooks/${PROVIDER}`, {
      headers: JSON_HEADERS,
      raw: d.body,
    });
    expect(missing.status).toBe(401);
    expect(w.store.rejections).toEqual([
      {
        provider: PROVIDER,
        reason: 'BAD_SIGNATURE',
        sha256: createHash('sha256').update(forged, 'utf8').digest('hex'),
        length: Buffer.byteLength(forged),
      },
      {
        provider: PROVIDER,
        reason: 'BAD_SIGNATURE',
        sha256: createHash('sha256').update(d.body, 'utf8').digest('hex'),
        length: Buffer.byteLength(d.body),
      },
    ]);
    expect(w.store.decisions).toEqual([]);
    expect(w.store.statusOf(w.guestHash)).toBe('DOCS_SUBMITTED');
  });

  it('fournisseur inconnu : 404 sans écriture ; base indisponible : 503', async () => {
    const w = await world();
    const r = await w.app.api.request('POST', '/kyc/webhooks/OTHER', {
      headers: JSON_HEADERS,
      raw: '{}',
    });
    expect(r.status).toBe(404);
    expect(w.store.rejections).toEqual([]);
    const sessionId = await started(w);
    w.kyc.decide(sessionId, 'APPROVED', [], LICENCE(FIRST_COUNTRY));
    const [d] = w.kyc.takeDeliveries();
    if (d === undefined) throw new Error('rappel attendu');
    w.store.failing = true;
    const down = await w.app.api.request('POST', `/kyc/webhooks/${PROVIDER}`, {
      headers: { ...JSON_HEADERS, [KYC_SIGNATURE_HEADER]: d.signature },
      raw: d.body,
    });
    expect(down.status).toBe(503);
  });
});

describe('US-105 — contrôle bloquant du paiement (critère 3, service exporté pour US-209)', () => {
  it('permis expirant avant la fin du trip : KYC_LICENSE_EXPIRED (403)', async () => {
    const store = new FakeIdentityStore();
    const hash = randomBytes(32);
    store.addPerson(hash.toString('hex'));
    const svc = new IdentityVerificationService({
      store,
      providers: { active: null, byCode: new Map() },
      returnUrl: null,
      countries: kycCountries(),
      log: { warn: () => undefined },
    });
    const end = new Date(Date.now() + 86_400_000);
    store.eligibilityOutcome = 'KYC_LICENSE_EXPIRED';
    await expect(svc.assertDriverEligible(hash, end, FIRST_COUNTRY)).rejects.toMatchObject({
      code: 'KYC_LICENSE_EXPIRED',
      status: 403,
    });
    store.eligibilityOutcome = 'KYC_NOT_APPROVED';
    await expect(svc.assertDriverEligible(hash, end, FIRST_COUNTRY)).rejects.toMatchObject({
      code: 'KYC_NOT_APPROVED',
    });
    store.eligibilityOutcome = 'ELIGIBLE';
    await expect(svc.assertDriverEligible(hash, end, FIRST_COUNTRY)).resolves.toBeUndefined();
    await expect(svc.assertDriverEligible(null, end, FIRST_COUNTRY)).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    store.failing = true;
    await expect(svc.assertDriverEligible(hash, end, FIRST_COUNTRY)).rejects.toMatchObject({
      code: 'KYC_PROVIDER_UNAVAILABLE',
    });
  });
});

describe('US-105 — retrait du consentement biométrique (VER-004, RISKS L1-PM-39)', () => {
  const withdraw = (w: World) =>
    w.app.api.request('POST', '/identity/consent', { headers: w.guest, body: { accepted: false } });

  it('après ouverture de session : RECHECK, effacement demandé et attesté, rappel tardif sans effet', async () => {
    const w = await world();
    const sessionId = await started(w);
    // le fournisseur a décidé, mais son rappel arrive après le retrait
    w.kyc.decide(sessionId, 'APPROVED', [], LICENCE(FIRST_COUNTRY));
    const r = await withdraw(w);
    expect(r.status).toBe(200);
    expect(w.store.statusOf(w.guestHash)).toBe('RECHECK');
    expect(w.kyc.erased.has(sessionId)).toBe(true);
    expect(w.store.erasures).toMatchObject([
      {
        sessionRef: sessionId,
        status: 'DONE',
        attestationRef: expect.stringMatching(/^fk_idv_erase_/) as string,
      },
    ]);
    // rappel signé de la session effacée : 200, rien n'est décidé
    for (const d of w.kyc.takeDeliveries()) {
      const hook = await w.app.api.request('POST', `/kyc/webhooks/${PROVIDER}`, {
        headers: { ...JSON_HEADERS, [KYC_SIGNATURE_HEADER]: d.signature },
        raw: d.body,
      });
      expect(hook.status).toBe(200);
    }
    expect(w.store.decisions.map((d) => d.outcome)).toEqual(['UNKNOWN_SESSION']);
    expect(w.store.statusOf(w.guestHash)).toBe('RECHECK');
    // une nouvelle vérification exige un nouveau consentement
    const again = await w.app.api.request('POST', '/identity/verification', {
      headers: w.guest,
      body: { country: FIRST_COUNTRY },
    });
    expect(again.status).toBe(403);
    expect(again.json).toMatchObject({ code: 'KYC_BIOMETRIC_CONSENT_MISSING' });
  });

  it('après approbation : RECHECK et effacement ; fournisseur en panne : demande laissée en attente', async () => {
    const w = await world();
    const sessionId = await started(w);
    w.kyc.decide(sessionId, 'APPROVED', [], LICENCE(FIRST_COUNTRY));
    const [d] = w.kyc.takeDeliveries();
    if (d === undefined) throw new Error('rappel attendu');
    await w.app.api.request('POST', `/kyc/webhooks/${PROVIDER}`, {
      headers: { ...JSON_HEADERS, [KYC_SIGNATURE_HEADER]: d.signature },
      raw: d.body,
    });
    expect(w.store.statusOf(w.guestHash)).toBe('APPROVED');
    w.kyc.runtime.script.script('erase', { kind: 'UNAVAILABLE' });
    expect((await withdraw(w)).status).toBe(200);
    expect(w.store.statusOf(w.guestHash)).toBe('RECHECK');
    expect(w.store.erasures).toMatchObject([{ sessionRef: sessionId, status: 'PENDING' }]);
    expect(w.kyc.erased.has(sessionId)).toBe(false);
  });
});

afterAll(async () => {
  await closeContractApps();
});

// US-103 (16 ACC-006 ; 19 US-103 critère 1) : les règles (verrou, RECHECK, rapprochement) sont
// prouvées sur PostgreSQL (packages/db/test/l0/l0-us103-legal-name.test.ts) ; ici, le contrat HTTP.
describe('US-103 — POST /identity/legal-name (nom légal identique au permis)', () => {
  const NAME = { legalFirstName: 'José Luis', legalLastName: 'Núñez de la Cruz' };

  it('dossier approuvé : nom enregistré, RECHECK ; même nom : rien ne change', async () => {
    const w = await world();
    const post = (body: unknown) =>
      w.app.api.request('POST', '/identity/legal-name', { headers: w.guest, body });
    w.store.setDecision(w.guestHash, 'APPROVED', null);
    const r = await post({ legalFirstName: '  José   Luis ', legalLastName: 'Núñez de la Cruz' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ code: 'LEGAL_NAME_UPDATED', status: 'RECHECK' });
    expect(w.store.legalNameOf(w.guestHash)).toEqual({
      first: 'José Luis',
      last: 'Núñez de la Cruz',
    });
    expect(w.store.statusOf(w.guestHash)).toBe('RECHECK');
    const same = await post(NAME);
    expect(same.status).toBe(200);
    expect(same.json).toMatchObject({ code: 'LEGAL_NAME_UNCHANGED', status: 'RECHECK' });
  });

  it('refus : corps, nom vide, session, compte, décision en cours, base', async () => {
    const w = await world();
    const api = w.app.api;
    const post = (body: unknown) =>
      api.request('POST', '/identity/legal-name', { headers: w.guest, body });
    expect((await post({ legalFirstName: 'Ana' })).json).toMatchObject({ code: 'REQUEST_INVALID' });
    expect((await post({ legalFirstName: 1, legalLastName: 'Pérez' })).status).toBe(400);
    const blank = await post({ legalFirstName: '   ', legalLastName: 'Pérez' });
    expect(blank.status).toBe(400);
    expect(blank.json).toMatchObject({ code: 'PROFILE_NAME_REQUIRED' });
    expect(
      (await post({ legalFirstName: 'Ana', legalLastName: 'x'.repeat(401) })).json,
    ).toMatchObject({ code: 'PROFILE_NAME_REQUIRED' });
    expect(
      (await api.request('POST', '/identity/legal-name', { ...textBody(w.guest) })).status,
    ).toBe(415);
    expect((await api.request('POST', '/identity/legal-name', { body: NAME })).status).toBe(401);
    w.store.setDecision(w.guestHash, 'MANUAL_REVIEW', 'LEGAL_NAME_MISMATCH');
    const locked = await post(NAME);
    expect(locked.status).toBe(409);
    expect(locked.json).toMatchObject({ code: 'PROFILE_NAME_LOCKED_PENDING_REVIEW' });
    expect(w.store.legalNameOf(w.guestHash)).toEqual({ first: 'Ana', last: 'Pérez' });
    w.store.failing = true;
    expect((await post(NAME)).status).toBe(503);
  });

  it('compte non éligible (issue de la base) : 403 KYC_NOT_ELIGIBLE', async () => {
    const w = await world();
    w.store.legalNameRefusal = 'NOT_ELIGIBLE';
    const r = await w.app.api.request('POST', '/identity/legal-name', {
      headers: w.guest,
      body: NAME,
    });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ code: 'KYC_NOT_ELIGIBLE' });
  });
});

describe('US-105 — couverture du contrat', () => {
  it('chaque statut déclaré pour /identity est exercé', () => {
    expect(missingCoverage(contract, '/identity', coverageOf(...apps))).toEqual([]);
  });

  it('chaque statut déclaré pour /kyc/webhooks est exercé', () => {
    expect(missingCoverage(contract, '/kyc/webhooks', coverageOf(...apps))).toEqual([]);
  });
});
