/**
 * US-102, critère 3 (16 ACC-001) : « Given une version majeure des CGU publiée, When le guest se
 * reconnecte, Then TERMS_REACCEPT_REQUIRED avant toute réservation ». `TermsGuard` est la garde que
 * les routes de réservation (US-2xx) posent après `SessionGuard` : prouvée ici sur le FAKE du
 * magasin (la sémantique en base est prouvée par l0-ctr-consents).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { FakeConsentStore } from '../testing/fake-consent-store.js';
import { LegalHttpError } from './errors.js';
import { LegalService, countryOf, documentVersions, languageOf } from './legal.service.js';
import { TermsGuard } from './terms.guard.js';

function contextFor(token: string | null): ExecutionContext {
  const request = { headers: token === null ? {} : { cookie: `__Host-session=${token}` } };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function setup() {
  const store = new FakeConsentStore();
  const token = randomBytes(32).toString('base64url');
  const user = randomUUID();
  store.bindSession(createHash('sha256').update(token, 'utf8').digest(), user);
  store.record(user, 'TOS_GUEST', 1);
  store.record(user, 'PRIVACY', 1);
  return { store, token, user, guard: new TermsGuard(new LegalService(store)) };
}

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'PASSED';
  } catch (e) {
    return e instanceof LegalHttpError ? e.code : 'OTHER';
  }
};

describe('TermsGuard — CGU à jour avant toute réservation (US-102)', () => {
  it('CGU acceptées : la réservation passe', async () => {
    const { guard, token } = setup();
    expect(await guard.canActivate(contextFor(token))).toBe(true);
  });

  it('version majeure publiée : TERMS_REACCEPT_REQUIRED, puis passage après acceptation', async () => {
    const { guard, token, store } = setup();
    const v2 = store.publish('TOS_GUEST', true);
    expect(await codeOf(guard.canActivate(contextFor(token)))).toBe('TERMS_REACCEPT_REQUIRED');
    const proof = createHash('sha256').update(token, 'utf8').digest();
    await store.accept(proof, [{ kind: 'TOS_GUEST', version: v2 }]);
    expect(await guard.canActivate(contextFor(token))).toBe(true);
  });

  it('version majeure de la confidentialité : même règle ; version mineure : rien', async () => {
    const { guard, token, store } = setup();
    store.publish('TOS_GUEST', false);
    expect(await guard.canActivate(contextFor(token))).toBe(true);
    store.publish('PRIVACY', true);
    expect(await codeOf(guard.canActivate(contextFor(token)))).toBe('TERMS_REACCEPT_REQUIRED');
  });

  it('les communications ne bloquent jamais une réservation (opt-in facultatif)', async () => {
    const { guard, token, store } = setup();
    store.publish('MARKETING', true);
    expect(await guard.canActivate(contextFor(token))).toBe(true);
  });

  it('fail-closed : sans session, ou session inconnue de la base, 401', async () => {
    const { guard } = setup();
    expect(await codeOf(guard.canActivate(contextFor(null)))).toBe('AUTH_REQUIRED');
    const other = randomBytes(32).toString('base64url');
    expect(await codeOf(guard.canActivate(contextFor(other)))).toBe('AUTH_REQUIRED');
  });

  it('fail-closed : magasin en panne ⇒ erreur, jamais un passage', async () => {
    const { token, store } = setup();
    store.status = () => Promise.reject(new Error('base indisponible'));
    const guard = new TermsGuard(new LegalService(store));
    expect(await codeOf(guard.canActivate(contextFor(token)))).toBe('OTHER');
  });
});

describe('analyse des paramètres', () => {
  it('langue du catalogue et pays facultatif, sans constante pays', () => {
    expect(['es', 'en', 'fr', 'pt'].map((l) => languageOf(l))).toEqual(['es', 'en', 'fr', 'pt']);
    expect(languageOf('de')).toBeNull();
    expect(languageOf(7)).toBeNull();
    expect(countryOf(undefined)).toBeNull();
    expect(countryOf('zz')).toBeUndefined();
    expect(countryOf('ZZ')).toBe('ZZ');
  });

  it('versions demandées : 1 ou 2 documents requis distincts, versions entières positives', () => {
    expect(documentVersions([{ kind: 'TOS_GUEST', version: 2 }])).toEqual([
      { kind: 'TOS_GUEST', version: 2 },
    ]);
    for (const bad of [
      [],
      [{ kind: 'MARKETING', version: 1 }],
      [{ kind: 'TOS_GUEST', version: 1.5 }],
      [{ kind: 'TOS_GUEST', version: 0 }],
      [
        { kind: 'TOS_GUEST', version: 1 },
        { kind: 'TOS_GUEST', version: 1 },
      ],
      'x',
    ]) {
      expect(documentVersions(bad)).toBeNull();
    }
  });
});
