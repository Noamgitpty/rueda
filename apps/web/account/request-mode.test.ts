/**
 * US-223 (ouverture du mode sur demande, ADR-175 ; BOARD N-246, N-286) — lecture fail-closed du
 * mode sur demande rendu par l'API et issue d'une décision de l'hôte portée par un cookie, jamais
 * par l'URL. Attendus tirés de 19 US-223 DoR 2 (mode fermé : une annonce sur demande n'est jamais
 * réservable) et de l'OpenAPI (`RequestModeTerms` : `enabled`, `expiryHours` entier ≥ 1 ou `null`).
 */
import { describe, expect, it } from 'vitest';
import { publicListingOf } from './host-listings.ts';
import {
  DECISION_COOKIE,
  DECISION_COOKIE_MAX_AGE_S,
  decisionCookieValue,
  decisionFromCookie,
} from './host-requests.ts';
import { requestHoursOf } from './request-mode.ts';

const ID = '00000000-0000-4000-8000-000000000001';
const HOLD = '00000000-0000-4000-8000-0000000000a1';
const reply = (status: number, json: unknown) => ({ status, json, session: null });

describe('US-223 — mode sur demande (site)', () => {
  it('ouvert seulement si l’API dit `enabled: true` avec un délai entier ≥ 1 ; toute autre forme : fermé', () => {
    expect(requestHoursOf({ enabled: true, expiryHours: 4 })).toBe(4);
    for (const closed of [
      undefined,
      null,
      'OPEN',
      [],
      {},
      { enabled: false, expiryHours: 4 },
      { enabled: true, expiryHours: null },
      { enabled: true, expiryHours: 0 },
      { enabled: true, expiryHours: -1 },
      { enabled: true, expiryHours: 2.5 },
      { enabled: true, expiryHours: '4' },
      { enabled: 'true', expiryHours: 4 },
      { enabled: true, expiryHours: 10_000 },
    ]) {
      expect(requestHoursOf(closed), JSON.stringify(closed)).toBeNull();
    }
  });

  it('fiche publique : délai lu dans `requestMode` ; réponse sans `requestMode` (API N-1) : fermé', () => {
    const listing = {
      id: ID,
      country: 'XX',
      dailyPriceMinor: '4000',
      currency: 'XXX',
      currencyExponent: 2,
      instantBook: false,
      makeName: 'Marca',
      modelName: 'Modelo',
      year: 2021,
      seats: 5,
      city: 'Ciudad',
    };
    expect(publicListingOf(reply(200, { listing }))?.requestHours).toBeNull();
    expect(
      publicListingOf(
        reply(200, { listing: { ...listing, requestMode: { enabled: true, expiryHours: 4 } } }),
      )?.requestHours,
    ).toBe(4);
  });

  it('N-286 : issue de la décision dans un cookie `<hold>.<issue>` ; une valeur forgée ou modifiée ne montre rien', () => {
    expect(DECISION_COOKIE).toMatch(/^[a-z0-9_]+$/);
    expect(DECISION_COOKIE_MAX_AGE_S).toBeGreaterThan(0);
    for (const status of ['CAPTURING', 'ACCEPTED', 'DECLINED'] as const) {
      const value = decisionCookieValue(HOLD, status);
      expect(value).toBe(`${HOLD}.${status}`);
      expect(decisionFromCookie(value ?? undefined)).toBe(status);
    }
    expect(decisionCookieValue('pas-un-uuid', 'ACCEPTED')).toBeNull();
    for (const bad of [
      undefined,
      '',
      'ACCEPTED',
      `${HOLD}.OK`,
      `${HOLD}.ACCEPTED.x`,
      `x.ACCEPTED`,
      `${HOLD.toUpperCase()}.ACCEPTED`,
    ]) {
      expect(decisionFromCookie(bad), String(bad)).toBeNull();
    }
  });
});
