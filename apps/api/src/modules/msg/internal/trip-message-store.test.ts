/**
 * US-525 — lecture STRICTE des lignes de la base (0161) : toute forme inattendue est une erreur
 * (fail-closed, 503), jamais un fil deviné ni un succès supposé. Formes tirées des signatures de
 * `core.messaging_thread_read` et `core.messaging_cmd_post_message` (migration 0161).
 */
import { describe, expect, it } from 'vitest';
import { postOf, threadOf, TripMessageStoreError } from './trip-message-store.js';

const TZ = 'Area/City';
const head = {
  outcome: 'DONE',
  viewer_role: 'GUEST',
  counterpart_name: 'María',
  writable: true,
  closes_at: new Date('2035-06-23T15:00:00.000Z'),
  timezone: TZ,
};
const msg = (id: string) => ({
  ...head,
  message_id: id,
  mine: false,
  author_role: 'HOST',
  author_name: 'María',
  body: 'Hola •••',
  masked: true,
  off_platform: false,
  sent_at: new Date('2035-05-02T09:00:00.000Z'),
});
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

describe('threadOf', () => {
  it('fil vide (une ligne d’en-tête) et fil de messages', () => {
    expect(threadOf([{ ...head, message_id: null }])).toMatchObject({
      outcome: 'DONE',
      messages: [],
    });
    const r = threadOf([msg(A), msg(B)]);
    expect(r).toMatchObject({ outcome: 'DONE', viewerRole: 'GUEST', timezone: TZ });
    expect(r.outcome === 'DONE' && r.messages.map((m) => m.id)).toEqual([A, B]);
  });

  it('refus de la base rendus tels quels', () => {
    for (const outcome of ['AUTH_REQUIRED', 'NOT_FOUND', 'REQUEST_INVALID']) {
      expect(threadOf([{ outcome }])).toEqual({ outcome });
    }
  });

  it('forme inattendue : erreur (en-tête incohérent, issue inconnue, rôle inconnu, aucune ligne)', () => {
    for (const rows of [
      [],
      [{ outcome: 'MAYBE' }],
      [{ ...msg(A), viewer_role: 'ADMIN' }],
      [msg(A), { ...msg(B), writable: false }],
      [msg(A), { ...msg(B), timezone: 'Autre/Zone' }],
      [{ ...head, message_id: null }, msg(A)],
      [{ ...msg(A), sent_at: 'hier' }],
      [{ ...msg(A), message_id: 'x' }],
      [{ ...head, timezone: null, message_id: null }],
      [{ outcome: 'NOT_FOUND' }, { outcome: 'NOT_FOUND' }],
    ]) {
      expect(() => threadOf(rows), JSON.stringify(rows)).toThrow(TripMessageStoreError);
    }
  });
});

describe('postOf', () => {
  it('message enregistré et refus', () => {
    expect(
      postOf([
        {
          outcome: 'DONE',
          message_id: A,
          body: 'Hola •••',
          masked: true,
          off_platform: false,
          sent_at: new Date('2035-05-02T09:00:00.000Z'),
        },
      ]),
    ).toMatchObject({ outcome: 'DONE', id: A, masked: true, offPlatform: false });
    for (const outcome of [
      'AUTH_REQUIRED',
      'NOT_FOUND',
      'MESSAGE_THREAD_CLOSED',
      'MESSAGE_INVALID',
      'REQUEST_INVALID',
    ]) {
      expect(postOf([{ outcome }])).toEqual({ outcome });
    }
  });

  it('forme inattendue : erreur', () => {
    for (const rows of [
      [],
      [{ outcome: 'SENT' }],
      [
        {
          outcome: 'DONE',
          message_id: A,
          body: '',
          masked: false,
          off_platform: false,
          sent_at: new Date(),
        },
      ],
      [
        {
          outcome: 'DONE',
          message_id: A,
          body: 'x',
          masked: 'no',
          off_platform: false,
          sent_at: new Date(),
        },
      ],
      [{ outcome: 'NOT_FOUND' }, { outcome: 'NOT_FOUND' }],
    ]) {
      expect(() => postOf(rows), JSON.stringify(rows)).toThrow(TripMessageStoreError);
    }
  });
});
