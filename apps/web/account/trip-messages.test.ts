/**
 * US-525 — lecture défensive du fil S16 et des rappels (formes tirées du contrat OpenAPI
 * `TripMessages` / `TripMessageSent`) : toute forme inattendue ⇒ `null` (fail-closed).
 */
import { describe, expect, it } from 'vitest';
import { noticesFromQuery, sentNoticesOf, threadPath, tripThreadOf } from './trip-messages.ts';

const TRIP = '00000000-0000-4000-8000-0000000000a1';
const MSG = '00000000-0000-4000-8000-0000000000b1';
const reply = (json: unknown, status = 200) => ({ status, json, session: null }) as const;
const thread = (over: Record<string, unknown> = {}) => ({
  code: 'TRIP_MESSAGES',
  messageKey: 'common.messages.thread',
  tripId: TRIP,
  viewerRole: 'GUEST',
  counterpartName: 'María',
  writable: true,
  closesAt: '2035-06-23T15:00:00.000Z',
  timezone: 'Area/City',
  messages: [
    {
      id: MSG,
      mine: true,
      authorRole: 'GUEST',
      authorName: 'Ana',
      body: 'Hola •••',
      masked: true,
      offPlatform: false,
      sentAt: '2035-05-02T09:00:00.000Z',
      purged: false,
    },
  ],
  ...over,
});

describe('tripThreadOf', () => {
  it('fil conforme', () => {
    const t = tripThreadOf(reply(thread()), TRIP);
    expect(t).toMatchObject({ viewerRole: 'GUEST', counterpartName: 'María', writable: true });
    expect(t?.messages[0]).toMatchObject({ id: MSG, body: 'Hola •••', masked: true });
    // fuseau sans région (« UTC ») : accepté
    expect(tripThreadOf(reply(thread({ timezone: 'UTC' })), TRIP)?.timezone).toBe('UTC');
  });

  it('forme inattendue, autre trip ou autre statut : null', () => {
    for (const r of [
      reply(thread(), 404),
      reply({ status: 'unavailable' }),
      reply(thread({ tripId: MSG })),
      reply(thread({ viewerRole: 'ADMIN' })),
      reply(thread({ closesAt: 'demain' })),
      reply(thread({ timezone: 'pas une zone' })),
      reply(thread({ messages: [{ id: MSG }] })),
      reply(thread({ messages: null })),
    ]) {
      expect(tripThreadOf(r, TRIP), JSON.stringify(r.json)).toBeNull();
    }
    expect(tripThreadOf({ status: 'unavailable' }, TRIP)).toBeNull();
  });
});

describe('rappels', () => {
  it('réponse 201 : rappels connus, sans doublon ; sinon null', () => {
    const ok = { code: 'MESSAGE_SENT', notices: ['CONTACT_MASKED', 'OFF_PLATFORM_PAYMENT'] };
    expect(sentNoticesOf(reply(ok, 201))).toEqual(['CONTACT_MASKED', 'OFF_PLATFORM_PAYMENT']);
    expect(sentNoticesOf(reply({ ...ok, notices: [] }, 201))).toEqual([]);
    expect(sentNoticesOf(reply({ ...ok, notices: ['X'] }, 201))).toBeNull();
    expect(sentNoticesOf(reply(ok, 200))).toBeNull();
  });

  it('requête de la page : rappels connus seulement', () => {
    expect(noticesFromQuery('OFF_PLATFORM_PAYMENT.CONTACT_MASKED')).toEqual([
      'CONTACT_MASKED',
      'OFF_PLATFORM_PAYMENT',
    ]);
    expect(noticesFromQuery('<script>')).toEqual([]);
    expect(noticesFromQuery(['CONTACT_MASKED'])).toEqual([]);
    expect(noticesFromQuery(undefined)).toEqual([]);
  });

  it('chemin de l’écran : jamais hors des deux formes connues', () => {
    expect(threadPath('guest', TRIP)).toBe(`/trips/${TRIP}/messages`);
    expect(threadPath('host', TRIP)).toBe(`/host/trips/${TRIP}/messages`);
    expect(threadPath('guest', '//evil.example')).toBeNull();
  });
});
