/**
 * US-223 partie 223d (ADR-152) : lecture défensive des demandes de l'hôte (routes de 223c,
 * ADR-146 §10). Attendus : le contrat (openapi.json, `HostRequest`, `HostRequestDecision`) et la
 * table des codes de l'API (`HOST_REQUEST_MESSAGES`), jamais le code testé. Montants en unités
 * mineures (`bigint`), devises de test ISO 4217 : XTS (exposant 2) et XXX (sans décimale), aucun pays
 * écrit (ADR-024).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import {
  DECISION_STATUSES,
  decisionOf,
  HOST_REQUEST_STATUSES,
  hostRequestOf,
  hostRequestsOf,
  REQUEST_ERROR_CODES,
  requestErrorKey,
  requestHref,
  requestReference,
} from './host-requests.ts';

const HOLD = '22300000-0000-4000-8000-0000000223d1';
const ORG = '00000000-0000-4000-8000-0000000000a1';
const VEHICLE = '00000000-0000-4000-8000-0000000000b1';
const row = {
  holdId: HOLD,
  status: 'AWAITING_HOST',
  vehicleId: VEHICLE,
  scheduledStart: '2036-12-23T15:00:00.000Z',
  scheduledEnd: '2036-12-26T15:00:00.000Z',
  timezone: 'Etc/GMT+5',
  respondBy: '2036-11-30T19:10:00.000Z',
  currency: 'XTS',
  // TJ01 (08 E7) : total 256,66, jambe HOST 131,25
  totalMinor: '25666',
  hostLegMinor: '13125',
  guest: { firstName: 'Lucía', ageYears: 29, rating: 4.8, verified: true },
};
const ok = (json: unknown) => ({ status: 200, json, session: null }) as const;

describe('US-223d — demandes de l’hôte (site)', () => {
  it('liste et détail bien formés : montants en bigint (exposant 2, puis sans décimale), heure limite de la base', () => {
    const list = hostRequestsOf(ok({ requests: [row] }));
    expect(list).toHaveLength(1);
    expect(list?.[0]).toMatchObject({
      holdId: HOLD,
      status: 'AWAITING_HOST',
      startsAt: row.scheduledStart,
      endsAt: row.scheduledEnd,
      respondBy: row.respondBy,
      totalMinor: 25666n,
      hostLegMinor: 13125n,
      guest: { firstName: 'Lucía', ageYears: 29, rating: 4.8, verified: true },
    });
    // devise sans décimale : montants entiers, jamais un `number`
    const py = hostRequestOf(
      ok({
        request: {
          ...row,
          status: 'CAPTURING',
          timezone: 'Etc/GMT+3',
          currency: 'XXX',
          totalMinor: '1890000',
          hostLegMinor: null,
          guest: { firstName: null, ageYears: null, rating: null, verified: false },
        },
      }),
    );
    expect(py?.totalMinor).toBe(1890000n);
    expect(py?.hostLegMinor).toBeNull();
    expect(py?.status).toBe('CAPTURING');
    expect(hostRequestsOf(ok({ requests: [] }))).toEqual([]);
  });

  it('fail-closed : une ligne mal formée refuse toute la liste ; réponse non 200 ⇒ null', () => {
    for (const bad of [
      { ...row, holdId: 'x' },
      { ...row, status: 'DECLINED' },
      { ...row, respondBy: null },
      { ...row, scheduledEnd: row.scheduledStart },
      { ...row, totalMinor: 25666 },
      { ...row, totalMinor: '-1' },
      { ...row, hostLegMinor: '1.5' },
      { ...row, currency: 'xts' },
      { ...row, timezone: '<script>' },
      { ...row, guest: { ...row.guest, verified: 'yes' } },
      { ...row, guest: { ...row.guest, licenseNumber: undefined, ageYears: 29.5 } },
    ]) {
      expect(hostRequestsOf(ok({ requests: [row, bad] })), JSON.stringify(bad)).toBeNull();
    }
    expect(
      hostRequestsOf({ status: 404, json: { code: 'REQUEST_NOT_FOUND' }, session: null }),
    ).toBeNull();
    expect(hostRequestsOf({ status: 'unavailable' })).toBeNull();
    expect(hostRequestOf(ok({ requests: [row] }))).toBeNull();
  });

  it('états identiques au contrat (openapi.json : HostRequest.status, HostRequestDecision.status)', () => {
    const doc = JSON.parse(
      readFileSync(new URL('../../api/openapi/openapi.json', import.meta.url), 'utf8'),
    ) as {
      components: {
        schemas: {
          HostRequest: { properties: { status: { enum: string[] } } };
          HostRequestDecision: {
            properties: { decision: { properties: { status: { enum: string[] } } } };
          };
        };
      };
    };
    const s = doc.components.schemas;
    expect(s.HostRequest.properties.status.enum).toEqual([...HOST_REQUEST_STATUSES]);
    expect(s.HostRequestDecision.properties.decision.properties.status.enum).toEqual([
      ...DECISION_STATUSES,
    ]);
  });

  it('décision : statut connu de LA demande envoyée seulement', () => {
    expect(decisionOf(ok({ decision: { holdId: HOLD, status: 'CAPTURING' } }), HOLD)).toBe(
      'CAPTURING',
    );
    expect(decisionOf(ok({ decision: { holdId: HOLD, status: 'DECLINED' } }), HOLD)).toBe(
      'DECLINED',
    );
    expect(decisionOf(ok({ decision: { holdId: VEHICLE, status: 'DECLINED' } }), HOLD)).toBeNull();
    expect(decisionOf(ok({ decision: { holdId: HOLD, status: 'BOOKED' } }), HOLD)).toBeNull();
    expect(
      decisionOf({ status: 409, json: { code: 'REQUEST_EXPIRED' }, session: null }, HOLD),
    ).toBeNull();
  });

  it('codes de refus : ceux de l’API (HOST_REQUEST_MESSAGES) ont leur clé ; inconnu ⇒ message générique, jamais « traitée »', () => {
    const api = readFileSync(
      new URL(
        '../../api/src/modules/avl/internal/checkout/host-request-errors.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const block = api.slice(api.indexOf('HOST_REQUEST_MESSAGES = {'), api.indexOf('} as const'));
    const codes = [...block.matchAll(/^\s+([A-Z_]+): \{ status: (\d+), messageKey: '([^']+)'/gm)];
    expect(codes.length).toBeGreaterThan(5);
    for (const [, code, , key] of codes) {
      if (code === 'AUTH_REQUIRED') continue; // session absente : connexion, jamais un message
      expect(REQUEST_ERROR_CODES, code).toContain(code);
      expect(requestErrorKey({ status: 409, json: { code }, session: null }), code).toBe(key);
    }
    expect(requestErrorKey({ status: 500, json: { code: 'BOOM' }, session: null })).toBe(
      'common.request.unavailable',
    );
    expect(requestErrorKey({ status: 'unavailable' })).toBe('common.request.unavailable');
    for (const tag of LOCALE_CONFIG.locales.map((l) => l.tag)) {
      const t = createTranslator(getProfile(LOCALE_CONFIG, tag)).t;
      for (const key of [
        'web.a05.accept',
        'web.a05.decline',
        'web.a05.request.confirmAccept.body',
      ] as const) {
        expect(t(key, { amount: '256,66' }).trim(), `${tag} ${key}`).not.toBe('');
      }
    }
  });

  it('numéro et lien : numéro du voyageur (8 caractères), compte et étape dans la requête seulement', () => {
    expect(requestReference(HOLD)).toBe('22300000');
    expect(requestHref(ORG, HOLD)).toBe(`/host/requests/${HOLD}?org=${ORG}`);
    expect(requestHref(ORG, HOLD, 'decline')).toBe(
      `/host/requests/${HOLD}?org=${ORG}&confirm=decline`,
    );
  });
});
