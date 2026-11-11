/**
 * US-102 — contrat des routes /legal sur l'application RÉELLE (ApiModule, gardes globaux,
 * durcissement HTTP ; harnais d'US-043) avec le FAKE du magasin de consentements : chaque réponse
 * est confrontée à `apps/api/openapi/openapi.json`, chaque statut déclaré est exercé.
 *
 * Comportements prouvés (16 ACC-001, LEG-002 ; attendus tirés de la story US-102, jamais du code) :
 * - une version MAJEURE publiée ⇒ `TERMS_REACCEPT_REQUIRED` à la reconnexion, jusqu'à acceptation ;
 * - une version mineure ne demande rien ; une version affichée périmée est refusée (409) ;
 * - communications : accord puis révocation, l'historique garde les deux lignes ;
 * - documents publics : version et mention « brouillon » (OQ-BR-24) dans les quatre langues.
 */
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  closeContractApps,
  contract,
  coverageOf,
  startContractApp,
  textBody,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import { FakeConsentStore } from './fake-consent-store.js';

const LANGUAGES = ['es', 'en', 'fr', 'pt'] as const;

async function app(
  store = new FakeConsentStore(),
): Promise<{ a: ContractApp; store: FakeConsentStore }> {
  const a = await startContractApp({ ctr: { store } });
  const proof = createHash('sha256').update(a.h.sessions.voyageur.token, 'utf8').digest();
  store.bindSession(proof, a.h.sessions.voyageur.userId);
  return { a, store };
}

const apps: ContractApp[] = [];
afterAll(closeContractApps);

describe('contrat HTTP — /legal (US-102)', () => {
  it('documents publics : versions en vigueur et texte, dans les quatre langues', async () => {
    const { a } = await app();
    apps.push(a);
    for (const locale of LANGUAGES) {
      const list = await a.api.request('GET', `/legal/documents?locale=${locale}`);
      expect(list.status).toBe(200);
      const docs = (list.json as { documents: { kind: string; draft: boolean; locale: string }[] })
        .documents;
      expect(docs.map((d) => d.kind).sort()).toEqual(['MARKETING', 'PRIVACY', 'TOS_GUEST']);
      expect(docs.every((d) => d.draft && d.locale === locale)).toBe(true);
      const tos = await a.api.request('GET', `/legal/documents/TOS_GUEST?locale=${locale}`);
      expect(tos.status).toBe(200);
      expect(tos.json).toMatchObject({ kind: 'TOS_GUEST', version: 1, draft: true });
    }
    const old = await a.api.request('GET', '/legal/documents/PRIVACY?locale=es&version=1');
    expect(old.status).toBe(200);
    expect((await a.api.request('GET', '/legal/documents?locale=xx')).status).toBe(400);
    expect((await a.api.request('GET', '/legal/documents?locale=es&country=zz')).status).toBe(400);
    const unknown = await a.api.request('GET', '/legal/documents?locale=es&country=ZZ');
    expect(unknown.status).toBe(400);
    expect(unknown.json).toMatchObject({ code: 'COUNTRY_UNKNOWN' });
    expect(
      (await a.api.request('GET', '/legal/documents/TOS_GUEST?locale=es&version=0')).status,
    ).toBe(400);
    expect((await a.api.request('GET', '/legal/documents/TOS_HOST?locale=es')).status).toBe(404);
    expect(
      (await a.api.request('GET', '/legal/documents/TOS_GUEST?locale=es&version=9')).status,
    ).toBe(404);
  });

  it('fail-closed : sans CGU ni confidentialité en vigueur, 503', async () => {
    const store = new FakeConsentStore();
    store.versions.splice(0);
    const { a } = await app(store);
    apps.push(a);
    const r = await a.api.request('GET', '/legal/documents?locale=es');
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: 'LEGAL_DOCUMENT_UNAVAILABLE' });
  });

  it('critère 3 : version majeure publiée ⇒ TERMS_REACCEPT_REQUIRED jusqu’à l’acceptation', async () => {
    const { a, store } = await app();
    apps.push(a);
    const user = a.h.sessions.voyageur.userId;
    store.record(user, 'TOS_GUEST', 1);
    store.record(user, 'PRIVACY', 1);
    const cookie = { headers: a.cookie('voyageur') };

    const before = await a.api.request('GET', '/legal/consents', cookie);
    expect(before.status).toBe(200);
    expect(before.json).toMatchObject({ code: 'TERMS_CURRENT', marketingOptIn: false });

    // version mineure : rien n'est exigé
    store.publish('PRIVACY', false);
    const minor = await a.api.request('GET', '/legal/consents', cookie);
    expect(minor.json).toMatchObject({ code: 'TERMS_CURRENT' });

    // version majeure des CGU : réacceptation exigée
    const v2 = store.publish('TOS_GUEST', true);
    const after = await a.api.request('GET', '/legal/consents', cookie);
    expect(after.json).toMatchObject({ code: 'TERMS_REACCEPT_REQUIRED' });
    const tos = (
      after.json as { documents: { kind: string; reacceptRequired: boolean }[] }
    ).documents.find((d) => d.kind === 'TOS_GUEST');
    expect(tos).toMatchObject({ reacceptRequired: true, requiredVersion: v2, acceptedVersion: 1 });

    // version affichée périmée : refus, rien n'est écrit
    const stale = await a.api.request('POST', '/legal/consents/accept', {
      ...cookie,
      body: { documents: [{ kind: 'TOS_GUEST', version: 1 }] },
    });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ code: 'TERMS_VERSION_CHANGED' });

    const ok = await a.api.request('POST', '/legal/consents/accept', {
      ...cookie,
      body: { documents: [{ kind: 'TOS_GUEST', version: v2 }] },
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ code: 'TERMS_CURRENT' });

    for (const bad of [{}, { documents: [] }, { documents: [{ kind: 'MARKETING', version: 1 }] }]) {
      const r = await a.api.request('POST', '/legal/consents/accept', { ...cookie, body: bad });
      expect(r.status).toBe(400);
    }
    expect(
      (await a.api.request('POST', '/legal/consents/accept', textBody(a.cookie('voyageur'))))
        .status,
    ).toBe(415);
    expect(
      (
        await a.api.request('POST', '/legal/consents/accept', {
          body: { documents: [{ kind: 'TOS_GUEST', version: v2 }] },
        })
      ).status,
    ).toBe(401);
    expect((await a.api.request('GET', '/legal/consents')).status).toBe(401);
  });

  it('communications : accord puis révocation, historique conservé', async () => {
    const { a } = await app();
    apps.push(a);
    const cookie = { headers: a.cookie('voyageur') };
    const on = await a.api.request('POST', '/legal/consents/marketing', {
      ...cookie,
      body: { optIn: true },
    });
    expect(on.status).toBe(200);
    expect(on.json).toMatchObject({ code: 'CONSENT_RECORDED', marketingOptIn: true });
    const off = await a.api.request('POST', '/legal/consents/marketing', {
      ...cookie,
      body: { optIn: false },
    });
    expect(off.json).toMatchObject({ marketingOptIn: false });
    const view = await a.api.request('GET', '/legal/consents', cookie);
    const history = (view.json as { history: { kind: string; accepted: boolean }[] }).history;
    expect(history.filter((h) => h.kind === 'MARKETING').map((h) => h.accepted)).toEqual([
      false,
      true,
    ]);
    expect(view.json).toMatchObject({ marketingOptIn: false });
    expect(
      (
        await a.api.request('POST', '/legal/consents/marketing', {
          ...cookie,
          body: { optIn: 'oui' },
        })
      ).status,
    ).toBe(400);
    expect(
      (await a.api.request('POST', '/legal/consents/marketing', textBody(a.cookie('voyageur'))))
        .status,
    ).toBe(415);
    expect(
      (await a.api.request('POST', '/legal/consents/marketing', { body: { optIn: true } })).status,
    ).toBe(401);
  });

  it('fail-closed : plus aucun document en vigueur ⇒ 503, rien n’est écrit', async () => {
    const { a, store } = await app();
    apps.push(a);
    const user = a.h.sessions.voyageur.userId;
    store.record(user, 'TOS_GUEST', 1);
    store.record(user, 'PRIVACY', 1);
    store.versions.splice(0);
    const cookie = { headers: a.cookie('voyageur') };
    const before = store.rows.length;
    const accept = await a.api.request('POST', '/legal/consents/accept', {
      ...cookie,
      body: { documents: [{ kind: 'TOS_GUEST', version: 1 }] },
    });
    expect(accept.status).toBe(503);
    const marketing = await a.api.request('POST', '/legal/consents/marketing', {
      ...cookie,
      body: { optIn: true },
    });
    expect(marketing.status).toBe(503);
    expect(marketing.json).toMatchObject({ code: 'LEGAL_DOCUMENT_UNAVAILABLE' });
    expect(store.rows.length).toBe(before);
  });

  it('réacceptation : un document exigé absent de la demande ⇒ 409, rien n’est écrit', async () => {
    const { a, store } = await app();
    apps.push(a);
    const user = a.h.sessions.voyageur.userId;
    store.record(user, 'TOS_GUEST', 1);
    store.record(user, 'PRIVACY', 1);
    const tos = store.publish('TOS_GUEST', true);
    const privacy = store.publish('PRIVACY', true);
    const before = store.rows.length;
    const partial = await a.api.request('POST', '/legal/consents/accept', {
      headers: a.cookie('voyageur'),
      body: { documents: [{ kind: 'TOS_GUEST', version: tos }] },
    });
    expect(partial.status).toBe(409);
    expect(partial.json).toMatchObject({ code: 'TERMS_VERSION_CHANGED' });
    expect(store.rows.length).toBe(before);
    const both = await a.api.request('POST', '/legal/consents/accept', {
      headers: a.cookie('voyageur'),
      body: {
        documents: [
          { kind: 'TOS_GUEST', version: tos },
          { kind: 'PRIVACY', version: privacy },
        ],
      },
    });
    expect(both.json).toMatchObject({ code: 'TERMS_CURRENT' });
  });

  it('couverture : chaque statut déclaré pour /legal est exercé', () => {
    expect(missingCoverage(contract, '/legal', coverageOf(...apps))).toEqual([]);
  });
});
