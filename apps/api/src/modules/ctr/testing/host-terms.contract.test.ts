/**
 * US-126 — contrat des routes des CGU de l'hôte (`/host/accounts/{orgId}/terms`) sur l'application
 * RÉELLE (ApiModule, gardes globaux, durcissement HTTP ; harnais d'US-043) avec le FAKE du magasin
 * de consentements : chaque réponse est confrontée à `apps/api/openapi/openapi.json`, chaque statut
 * déclaré est exercé.
 *
 * Comportements prouvés (attendus tirés de 19 US-126 et de 16 LEG-001, jamais du code) :
 * - CGU de l'hôte jamais acceptées ⇒ `TERMS_REACCEPT_REQUIRED` ; servies avec version, date,
 *   langue et marqueur BROUILLON ; acceptation de la version affichée ⇒ `TERMS_CURRENT` ;
 * - version MAJEURE publiée ⇒ réacceptation ; version affichée périmée refusée (409), rien d'écrit ;
 * - compte d'hôte d'un autre ⇒ 404 (IDOR), rien d'écrit ; aucun document ⇒ 503 (fail-closed).
 * La garde de la soumission d'une annonce et la portée par pays sont prouvées sur PostgreSQL
 * (`packages/db/test/l0/l0-us126-host-terms.test.ts`).
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
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
import { FakeConsentStore } from './fake-consent-store.js';

const LANGUAGES = ['es', 'en', 'fr', 'pt'] as const;

async function app(store = new FakeConsentStore()): Promise<{
  a: ContractApp;
  store: FakeConsentStore;
  org: string;
  base: string;
}> {
  const a = await startContractApp({ ctr: { store } });
  const proof = createHash('sha256').update(a.h.sessions.voyageur.token, 'utf8').digest();
  const user = a.h.sessions.voyageur.userId;
  store.bindSession(proof, user);
  const org = randomUUID();
  store.bindHostAccount(org, user, FIRST_COUNTRY);
  return { a, store, org, base: `/host/accounts/${org}/terms` };
}

const apps: ContractApp[] = [];
afterAll(closeContractApps);

describe('contrat HTTP — /host/accounts/{orgId}/terms (US-126)', () => {
  it('critères 1 à 3 : jamais acceptées ⇒ TERMS_REACCEPT_REQUIRED ; version, date, langue, BROUILLON ; acceptation ⇒ TERMS_CURRENT', async () => {
    const { a, store, base } = await app();
    apps.push(a);
    const cookie = { headers: a.cookie('voyageur') };
    for (const locale of LANGUAGES) {
      const r = await a.api.request('GET', `${base}?locale=${locale}`, cookie);
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({
        code: 'TERMS_REACCEPT_REQUIRED',
        country: FIRST_COUNTRY,
        document: { kind: 'TOS_HOST', version: 1, locale, draft: true },
        requiredVersion: 1,
        acceptedVersion: null,
        acceptedAt: null,
        reacceptRequired: true,
      });
      expect((r.json as { document: { validFrom: string } }).document.validFrom).toMatch(
        /^\d{4}-\d{2}-\d{2}T/,
      );
    }
    const ok = await a.api.request('POST', `${base}/accept`, {
      ...cookie,
      body: { version: 1, locale: 'fr' },
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({
      code: 'TERMS_CURRENT',
      acceptedVersion: 1,
      reacceptRequired: false,
      document: { locale: 'fr' },
    });
    expect(store.rows.filter((r) => r.kind === 'TOS_HOST')).toMatchObject([
      { version: 1, accepted: true, context: 'HOST_ONBOARDING' },
    ]);

    // version majeure : réacceptation ; version affichée périmée refusée, rien n'est écrit
    const v2 = store.publish('TOS_HOST', true);
    const after = await a.api.request('GET', `${base}?locale=es`, cookie);
    expect(after.json).toMatchObject({
      code: 'TERMS_REACCEPT_REQUIRED',
      requiredVersion: v2,
      acceptedVersion: 1,
    });
    const before = store.rows.length;
    const stale = await a.api.request('POST', `${base}/accept`, {
      ...cookie,
      body: { version: 1, locale: 'es' },
    });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ code: 'TERMS_VERSION_CHANGED' });
    expect(store.rows.length).toBe(before);
    const again = await a.api.request('POST', `${base}/accept`, {
      ...cookie,
      body: { version: v2, locale: `es-${FIRST_COUNTRY}` },
    });
    expect(again.json).toMatchObject({ code: 'TERMS_CURRENT', acceptedVersion: v2 });
    expect(store.rows.at(-1)).toMatchObject({ kind: 'TOS_HOST', context: 'REACCEPT' });
  });

  it('demandes invalides (400, 415), sans session (401), compte d’un autre (404) : rien n’est écrit', async () => {
    const { a, store, base } = await app();
    apps.push(a);
    const cookie = { headers: a.cookie('voyageur') };
    expect((await a.api.request('GET', `${base}?locale=xx`, cookie)).status).toBe(400);
    expect((await a.api.request('GET', base, cookie)).status).toBe(400);
    for (const bad of [
      {},
      { version: 0, locale: 'es' },
      { version: 1.5, locale: 'es' },
      { version: '1', locale: 'es' },
      { version: 1, locale: 'de' },
      { version: 1 },
    ]) {
      const r = await a.api.request('POST', `${base}/accept`, { ...cookie, body: bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    expect(
      (await a.api.request('POST', `${base}/accept`, textBody(a.cookie('voyageur')))).status,
    ).toBe(415);
    expect((await a.api.request('GET', `${base}?locale=es`)).status).toBe(401);
    expect(
      (await a.api.request('POST', `${base}/accept`, { body: { version: 1, locale: 'es' } }))
        .status,
    ).toBe(401);
    // compte d'hôte d'un autre (ou inconnu, ou mal formé) : 404, comme un compte inconnu
    const other = randomUUID();
    store.bindHostAccount(other, randomUUID(), FIRST_COUNTRY);
    for (const org of [other, randomUUID(), 'pas-un-uuid']) {
      const get = await a.api.request('GET', `/host/accounts/${org}/terms?locale=es`, cookie);
      expect(get.status).toBe(404);
      expect(get.json).toMatchObject({ code: 'HOST_ACCOUNT_NOT_FOUND' });
      const post = await a.api.request('POST', `/host/accounts/${org}/terms/accept`, {
        ...cookie,
        body: { version: 1, locale: 'es' },
      });
      expect(post.status).toBe(404);
    }
    expect(store.rows).toEqual([]);
  });

  it('fail-closed : aucune CGU de l’hôte en vigueur ⇒ 503, rien n’est écrit', async () => {
    const store = new FakeConsentStore();
    store.versions.splice(
      store.versions.findIndex((v) => v.kind === 'TOS_HOST'),
      1,
    );
    const { a, base } = await app(store);
    apps.push(a);
    const cookie = { headers: a.cookie('voyageur') };
    const get = await a.api.request('GET', `${base}?locale=es`, cookie);
    expect(get.status).toBe(503);
    expect(get.json).toMatchObject({ code: 'LEGAL_DOCUMENT_UNAVAILABLE' });
    const post = await a.api.request('POST', `${base}/accept`, {
      ...cookie,
      body: { version: 1, locale: 'es' },
    });
    expect(post.status).toBe(503);
    expect(store.rows).toEqual([]);
  });

  it('couverture : chaque statut déclaré pour /host/accounts/{orgId}/terms est exercé', () => {
    expect(missingCoverage(contract, '/host/accounts/{orgId}/terms', coverageOf(...apps))).toEqual(
      [],
    );
  });
});
