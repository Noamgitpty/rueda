/**
 * US-316 — lecture défensive des rendez-vous d'un trip côté site et conversion de l'heure murale
 * du trip en UTC. Attendus : 19 US-316 critère 4, OpenAPI (`TripMeetings`, `TripMeetingProposed`,
 * `TripMeetingAnswered`), ADR-186 ; fuseaux IANA de la base tz, hors des marchés (ADR-024 ; jamais le code testé).
 */
import { describe, expect, it } from 'vitest';
import type { ApiResult } from './api-client.ts';
import {
  answerErrorFromQuery,
  localToUtc,
  meetingDoneFromQuery,
  meetingDoneOf,
  tripMeetingsOf,
} from './trip-meetings.ts';

const TRIP = '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a6f';
const MEETING = '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a70';
const meeting = {
  id: MEETING,
  kind: 'PICKUP',
  place: 'Plaza central, entrada norte',
  meetAt: '2035-06-10T14:00:00.000Z',
  status: 'PROPOSED',
  mine: false,
  createdAt: '2035-05-02T09:00:00.000Z',
  answeredAt: null,
};
const reply = (json: unknown, status = 200): ApiResult => ({ status, json, session: null });
const list = (over: Record<string, unknown> = {}) =>
  reply({
    code: 'TRIP_MEETINGS',
    messageKey: 'common.meetings.list',
    tripId: TRIP,
    viewerRole: 'GUEST',
    canPropose: false,
    timezone: 'Pacific/Honolulu',
    meetings: [meeting],
    ...over,
  });

describe('US-316 — rendez-vous du trip (site)', () => {
  it('lit la liste attendue ; toute autre forme ⇒ null (jamais un rendez-vous deviné)', () => {
    expect(tripMeetingsOf(list(), TRIP)).toEqual({
      viewerRole: 'GUEST',
      canPropose: false,
      timezone: 'Pacific/Honolulu',
      meetings: [
        {
          id: MEETING,
          kind: 'PICKUP',
          place: 'Plaza central, entrada norte',
          meetAt: '2035-06-10T14:00:00.000Z',
          status: 'PROPOSED',
          mine: false,
        },
      ],
    });
    expect(tripMeetingsOf(list(), '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a71')).toBeNull();
    expect(tripMeetingsOf({ status: 'unavailable' }, TRIP)).toBeNull();
    expect(tripMeetingsOf(reply({}, 503), TRIP)).toBeNull();
    for (const bad of [
      { timezone: 'Panama; DROP' },
      { viewerRole: 'ADMIN' },
      { meetings: [{ ...meeting, status: 'SUPERSEDED' }] },
      { meetings: [{ ...meeting, kind: 'ELSEWHERE' }] },
      { meetings: [{ ...meeting, place: '' }] },
      { meetings: [{ ...meeting, meetAt: '10/06/2035' }] },
    ]) {
      expect(tripMeetingsOf(list(bad), TRIP), JSON.stringify(bad)).toBeNull();
    }
  });

  it('issue d’une proposition ou d’une réponse ; requête de la page en liste fermée', () => {
    expect(
      meetingDoneOf(reply({ code: 'MEETING_PROPOSED', meeting: { status: 'PROPOSED' } }, 201)),
    ).toBe('PROPOSED');
    expect(
      meetingDoneOf(reply({ code: 'MEETING_ANSWERED', meeting: { status: 'ACCEPTED' } }, 200)),
    ).toBe('ACCEPTED');
    expect(meetingDoneOf(reply({ code: 'MEETING_ANSWERED', meeting: { status: 'X' } }))).toBeNull();
    expect(meetingDoneOf(reply({ code: 'MEETING_NOT_PENDING' }, 409))).toBeNull();
    expect(meetingDoneOf({ status: 'unavailable' })).toBeNull();
    expect(meetingDoneFromQuery('DECLINED')).toBe('DECLINED');
    expect(meetingDoneFromQuery('SUPERSEDED')).toBeNull();
    expect(answerErrorFromQuery('MEETING_EXPIRED')).toBe('MEETING_EXPIRED');
    expect(answerErrorFromQuery('<script>')).toBeNull();
  });

  it('heure murale du trip ⇒ UTC (fuseaux de la base tz hors des marchés : sans et avec changement d’heure)', () => {
    // Honolulu : UTC−10, sans changement d'heure
    expect(localToUtc('2035-06-10T09:00', 'Pacific/Honolulu')).toBe('2035-06-10T19:00:00.000Z');
    expect(localToUtc('2035-06-10T09:00', 'UTC')).toBe('2035-06-10T09:00:00.000Z');
    // Madrid : UTC+2 l'été, UTC+1 l'hiver (deux passes : décalage relu à l'instant trouvé)
    expect(localToUtc('2035-06-10T09:00', 'Europe/Madrid')).toBe('2035-06-10T07:00:00.000Z');
    expect(localToUtc('2035-01-10T09:00', 'Europe/Madrid')).toBe('2035-01-10T08:00:00.000Z');
    for (const bad of ['2035-06-10', '2035-13-10T09:00', '2035-06-10T25:00', 'demain']) {
      expect(localToUtc(bad, 'Pacific/Honolulu'), bad).toBeNull();
    }
    expect(localToUtc('2035-06-10T09:00', 'Pas/Un_Fuseau')).toBeNull();
  });
});
