/**
 * US-307 — lecture défensive de `GET /trips/{id}/no-show` et liens des écrans du no-show (16
 * TRP-015 ; ADR-191). Attendus tirés de 19 US-307 et du contrat OpenAPI (`TripNoShow`), jamais du
 * code testé : une forme inattendue n'est jamais affichée à moitié.
 */
import { CATALOGS } from '@rueda/i18n';
import { describe, expect, it } from 'vitest';
import {
  BLOCKER_KEYS,
  BLOCKERS,
  messagesHref,
  noShowFailureKey,
  noShowHref,
  noShowOffered,
  reasonKey,
  tripNoShowOf,
} from './trip-no-show.ts';

const TRIP = '7c0f3a52-3f1e-4c1c-9a59-2f5f0f2c6b11';
const ORG = '2b8e1c4d-5a6f-4e7b-8c9d-0a1b2c3d4e5f';
const ok = (json: unknown) => ({ status: 200 as const, json, headers: {} }) as never;

const VIEW = {
  tripId: TRIP,
  viewerRole: 'HOST',
  absentParty: 'GUEST',
  tripStatus: 'CHECKIN_OPEN',
  timezone: 'UTC',
  scheduledStart: '2033-04-14T10:00:00.000Z',
  declarableFrom: '2033-04-14T11:00:00.000Z',
  declarableUntil: '2033-04-17T10:00:00.000Z',
  canDeclare: false,
  blocker: 'NO_SHOW_TOO_EARLY',
  messageTraced: false,
  declaration: null,
};

describe('US-307 — vue du no-show (lecture défensive)', () => {
  it('forme du contrat : rendue telle quelle', () => {
    expect(tripNoShowOf(ok(VIEW))).toEqual(VIEW);
    const declared = {
      ...VIEW,
      canDeclare: false,
      blocker: 'CANCELLATION_PENDING',
      declaration: {
        id: ORG,
        requestedReason: 'GUEST_NO_SHOW',
        status: 'PENDING',
        requestedAt: '2033-04-14T11:10:00.000Z',
        mine: true,
      },
    };
    expect(tripNoShowOf(ok(declared))?.declaration?.status).toBe('PENDING');
  });

  it('toute forme inattendue ⇒ null (jamais un état deviné)', () => {
    for (const bad of [
      { ...VIEW, viewerRole: 'STAFF' },
      { ...VIEW, absentParty: 'HOST', viewerRole: 'HOST' },
      { ...VIEW, blocker: 'UNKNOWN_CODE' },
      // incohérence : déclarable alors qu'un obstacle est dit
      { ...VIEW, canDeclare: true },
      { ...VIEW, scheduledStart: '2033-04-14 10:00' },
      { ...VIEW, declaration: { id: 'x', requestedReason: 'GUEST_NO_SHOW', status: 'PENDING' } },
      { ...VIEW, messageTraced: 'yes' },
    ]) {
      expect(tripNoShowOf(ok(bad))).toBeNull();
    }
    expect(tripNoShowOf({ status: 'unavailable' })).toBeNull();
    expect(tripNoShowOf({ status: 404, json: {}, headers: {} } as never)).toBeNull();
  });

  it('chaque obstacle a son texte dans le catalogue ; motifs et refus traduits', () => {
    for (const b of BLOCKERS)
      expect(Object.hasOwn(CATALOGS.es.messages, BLOCKER_KEYS[b])).toBe(true);
    expect(reasonKey('GUEST_NO_SHOW')).toBe('web.noShow.reason.GUEST_NO_SHOW');
    expect(reasonKey('HOST_NO_SHOW')).toBe('web.noShow.reason.HOST_NO_SHOW');
    expect(reasonKey('HOST_CANCELLED')).toBe('web.noShow.reason.other');
    expect(noShowFailureKey({ status: 'unavailable' })).toBe('common.noShow.unavailable');
    expect(
      noShowFailureKey({
        status: 409,
        json: { code: 'NO_SHOW_TOO_EARLY', messageKey: 'common.noShow.tooEarly' },
        headers: {},
      } as never),
    ).toBe('common.noShow.tooEarly');
  });

  it('liens reconstruits (jamais une adresse reçue) ; page proposée en remise ouverte seulement', () => {
    expect(noShowHref('HOST', TRIP, ORG)).toBe(`/host/trips/${TRIP}/no-show?org=${ORG}`);
    expect(noShowHref('HOST', TRIP, 'https://evil.example')).toBe(`/host/trips/${TRIP}/no-show`);
    expect(noShowHref('GUEST', TRIP, ORG)).toBe(`/trips/${TRIP}/no-show`);
    expect(messagesHref('HOST', TRIP, ORG)).toBe(`/host/trips/${TRIP}/messages?org=${ORG}`);
    expect(messagesHref('GUEST', TRIP, null)).toBe(`/trips/${TRIP}/messages`);
    expect(noShowOffered('CHECKIN_OPEN')).toBe(true);
    expect(noShowOffered('START_WINDOW_EXPIRED')).toBe(true);
    for (const s of ['BOOKED', 'IN_PROGRESS', 'NO_SHOW_GUEST', 'CANCELLED_BY_HOST']) {
      expect(noShowOffered(s), s).toBe(false);
    }
  });
});
