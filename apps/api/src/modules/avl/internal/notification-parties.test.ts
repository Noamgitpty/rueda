/**
 * Adaptateur `postgresNotificationParties` (US-213, ADR-157) : lecture de
 * `core.booking_notification_parties` (0133) et validation de la réponse. Une réponse mal formée
 * est une erreur (la tâche du dispatcher échoue, puis lettre morte avec alerte), jamais un
 * destinataire deviné. Preuve sur PostgreSQL réel : packages/db/test/l0/l0-us213-notification-parties.test.ts
 * et apps/api/test/int/ntf.int.test.ts.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SqlClient, SqlResult } from '../../bus/index.js';
import {
  NotificationPartiesError,
  parseBookingParties,
  postgresNotificationParties,
} from './notification-parties.js';

const guest = randomUUID();
const host = randomUUID();

function client(value: unknown): { tx: SqlClient; calls: [string, readonly unknown[]][] } {
  const calls: [string, readonly unknown[]][] = [];
  const tx: SqlClient = {
    query: <R>(text: string, params?: readonly unknown[]): Promise<SqlResult<R>> => {
      calls.push([text, params ?? []]);
      return Promise.resolve({ rows: [{ p: value }] as R[], rowCount: 1 });
    },
  };
  return { tx, calls };
}

describe('parties d’une réservation (0133)', () => {
  it('trip : voyageur et titulaire du compte d’hôte, requête paramétrée', async () => {
    const { tx, calls } = client({ guestUserId: guest.toUpperCase(), hostUserId: host });
    const id = randomUUID();
    expect(await postgresNotificationParties.partiesOf(tx, 'TRIP', id)).toEqual({
      guestUserId: guest,
      hostUserId: host,
      holdKind: null,
      holdStatus: null,
      releaseReason: null,
      requestAuthorized: null,
    });
    expect(calls).toEqual([
      ['SELECT core.booking_notification_parties($1::text, $2::uuid) AS p', ['TRIP', id]],
    ]);
  });

  it('hold : type, statut, motif et demande autorisée', () => {
    expect(
      parseBookingParties('HOLD', {
        guestUserId: guest,
        hostUserId: host,
        holdKind: 'REQUEST',
        holdStatus: 'RELEASED',
        releaseReason: 'PAYMENT_DECLINED',
        requestAuthorized: true,
      }),
    ).toEqual({
      guestUserId: guest,
      hostUserId: host,
      holdKind: 'REQUEST',
      holdStatus: 'RELEASED',
      releaseReason: 'PAYMENT_DECLINED',
      requestAuthorized: true,
    });
    expect(
      parseBookingParties('HOLD', {
        guestUserId: guest,
        hostUserId: host,
        holdKind: 'CHECKOUT',
        holdStatus: 'ACTIVE',
        releaseReason: null,
        requestAuthorized: false,
      })?.releaseReason,
    ).toBeNull();
  });

  it('sujet inconnu : null', async () => {
    expect(await postgresNotificationParties.partiesOf(client(null).tx, 'HOLD', guest)).toBeNull();
  });

  it.each([
    ['pas un objet', 'x'],
    ['tableau', []],
    ['voyageur absent', { hostUserId: host }],
    ['hôte mal formé', { guestUserId: guest, hostUserId: 'h' }],
  ])('réponse mal formée (%s) : erreur', (_n, raw) => {
    expect(() => parseBookingParties('TRIP', raw)).toThrow(NotificationPartiesError);
  });

  it.each([
    ['demande autorisée absente', { holdKind: 'REQUEST', holdStatus: 'ACTIVE' }],
    ['statut absent', { holdKind: 'REQUEST', requestAuthorized: true }],
    [
      'motif mal formé',
      {
        holdKind: 'REQUEST',
        holdStatus: 'RELEASED',
        releaseReason: 'x y',
        requestAuthorized: true,
      },
    ],
  ])('hold mal formé (%s) : erreur', (_n, extra) => {
    expect(() =>
      parseBookingParties('HOLD', { guestUserId: guest, hostUserId: host, ...extra }),
    ).toThrow(NotificationPartiesError);
  });
});
