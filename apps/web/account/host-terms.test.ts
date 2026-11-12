/**
 * US-126 — lecture défensive des CGU de l'hôte : une réponse mal formée ne vaut jamais acceptation.
 */
import { describe, expect, it } from 'vitest';
import { hostTermsOf } from './host-terms.ts';

const reply = (status: number, json: unknown) => ({ status, json, session: null });
const OK = {
  code: 'TERMS_REACCEPT_REQUIRED',
  messageKey: 'common.legal.reacceptRequired',
  country: 'XX',
  timeZone: 'Etc/UTC',
  document: {
    kind: 'TOS_HOST',
    version: 2,
    isMajor: true,
    locale: 'fr',
    title: 'Conditions de l’hôte (BROUILLON)',
    contentHash: 'a'.repeat(64),
    draft: true,
    validFrom: '2000-01-01T00:00:00.000Z',
  },
  requiredVersion: 2,
  acceptedVersion: 1,
  acceptedAt: '2031-06-02T09:30:00.000Z',
  reacceptRequired: true,
};

describe('CGU de l’hôte (US-126)', () => {
  it('réponse conforme : version, date, langue, brouillon, acceptation', () => {
    expect(hostTermsOf(reply(200, OK))).toEqual({
      reacceptRequired: true,
      timeZone: 'Etc/UTC',
      title: 'Conditions de l’hôte (BROUILLON)',
      version: 2,
      locale: 'fr',
      draft: true,
      validFrom: '2000-01-01T00:00:00.000Z',
      acceptedVersion: 1,
      acceptedAt: '2031-06-02T09:30:00.000Z',
    });
    expect(
      hostTermsOf(reply(200, { ...OK, acceptedVersion: null, acceptedAt: null }))?.acceptedVersion,
    ).toBeNull();
  });

  it('réponse illisible, autre genre, statut d’erreur ou API injoignable : null', () => {
    for (const bad of [
      { ...OK, reacceptRequired: 'false' },
      { ...OK, document: { ...OK.document, kind: 'TOS_GUEST' } },
      { ...OK, document: { ...OK.document, version: 0 } },
      { ...OK, document: { ...OK.document, locale: 'de' } },
      { ...OK, document: { ...OK.document, validFrom: 'hier' } },
      { ...OK, acceptedAt: 'hier' },
      { ...OK, timeZone: '' },
      { ...OK, document: null },
    ]) {
      expect(hostTermsOf(reply(200, bad))).toBeNull();
    }
    expect(hostTermsOf(reply(503, OK))).toBeNull();
    expect(hostTermsOf({ status: 'unavailable' })).toBeNull();
  });
});
