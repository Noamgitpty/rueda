import { describe, expect, it } from 'vitest';
import { countryCases } from './doubles.test-support.js';
import type { NewDomainEvent } from './envelope.js';
import {
  EnvelopeError,
  envelopeToEvent,
  errorCode,
  rowToEnvelope,
  validateNewEvent,
} from './envelope.js';

// Pays configurés (données CFG) : USD et PYG sans décimale (CLAUDE.md point 3).
const CASES = countryCases();

const base = (country: string, currency: string, amountMinor: string): NewDomainEvent => ({
  type: 'booking.trip.booked',
  schemaVersion: 1,
  aggregateType: 'trip',
  aggregateId: '0190a5c4-1111-7000-8000-000000000001',
  aggregateVersion: 3n,
  countryCode: country,
  actor: 'SYSTEM',
  correlationId: '0190a5c4-2222-7000-8000-000000000002',
  payload: { trip_id: '0190a5c4-1111-7000-8000-000000000001', currency, amount_minor: amountMinor },
});

describe.each(CASES)(
  'enveloppe 17 §4.1 — $country ($currency)',
  ({ country, currency, amountMinor }) => {
    it('accepte un événement conforme', () => {
      expect(() => {
        validateNewEvent(base(country, currency, amountMinor));
      }).not.toThrow();
    });

    it('aller-retour ligne → JSON → événement : bigint, acteur, heure de la base conservés', () => {
      const row = {
        id: '0190a5c4-3333-7000-8000-000000000003',
        type: 'payment.received',
        schema_version: 2,
        occurred_at: new Date('2031-07-01T08:00:00.000Z'),
        aggregate_type: 'hold',
        aggregate_id: '0190a5c4-4444-7000-8000-000000000004',
        aggregate_version: '9007199254740993', // > 2^53 : jamais un number
        country_code: country,
        actor_user_id: '0190a5c4-5555-7000-8000-000000000005',
        actor_role: 'GUEST',
        correlation_id: '0190a5c4-6666-7000-8000-000000000006',
        causation_id: null,
        payload: { currency, amount_minor: amountMinor },
        partition_key: '0190a5c4-4444-7000-8000-000000000004',
      };
      const json = rowToEnvelope(row);
      expect(json).toMatchObject({
        event_id: row.id,
        occurred_at: '2031-07-01T08:00:00.000Z',
        aggregate_version: '9007199254740993',
        actor: { user_id: row.actor_user_id, role: 'GUEST' },
      });
      const event = envelopeToEvent(JSON.parse(JSON.stringify(json)) as typeof json);
      expect(event.aggregateVersion).toBe(9007199254740993n);
      expect(event.payload).toEqual({ currency, amount_minor: amountMinor });
      expect(event.actor).toEqual({ userId: row.actor_user_id, role: 'GUEST' });
      expect(event.partitionKey).toBe(row.partition_key);
    });
  },
);

describe('validateNewEvent : refus', () => {
  const first = CASES[0] as (typeof CASES)[number];
  const ok = base(first.country, first.currency, first.amountMinor);
  it.each([
    ['type sans verbe', { ...ok, type: 'booking' }],
    ['type en majuscules', { ...ok, type: 'Booking.Trip.Booked' }],
    ['schemaVersion 0', { ...ok, schemaVersion: 0 }],
    ['aggregateVersion négative', { ...ok, aggregateVersion: -1n }],
    ['aggregateVersion number', { ...ok, aggregateVersion: 3 as unknown as bigint }],
    ['pays mal formé', { ...ok, countryCode: 'pan' }],
    [
      'acteur rôle SYSTEM avec utilisateur',
      { ...ok, actor: { userId: ok.aggregateId, role: 'SYSTEM' } },
    ],
    ['corrélation non UUID', { ...ok, correlationId: 'req-1' }],
    ['payload tableau', { ...ok, payload: [] as unknown as NewDomainEvent['payload'] }],
    [
      'montant bigint dans le payload',
      { ...ok, payload: { amount_minor: 1n } as unknown as NewDomainEvent['payload'] },
    ],
    ['nombre non fini', { ...ok, payload: { x: Number.NaN } }],
    [
      'date dans le payload',
      { ...ok, payload: { at: new Date() } as unknown as NewDomainEvent['payload'] },
    ],
    ['partitionKey vide', { ...ok, partitionKey: '' }],
  ])('%s', (_label, event) => {
    expect(() => {
      validateNewEvent(event as NewDomainEvent);
    }).toThrow(EnvelopeError);
  });

  it('accepte un type à deux segments du catalogue (payment.received)', () => {
    expect(() => {
      validateNewEvent({ ...ok, type: 'payment.received' });
    }).not.toThrow();
  });
});

describe('errorCode : jamais le message', () => {
  it('SQLSTATE si présent', () => {
    expect(
      errorCode(Object.assign(new Error('clé (email)=(a@b.c) existe'), { code: '23505' })),
    ).toBe('SQLSTATE_23505');
  });
  it('nom de classe sinon, sans le message', () => {
    class PspTimeout extends Error {
      override readonly name = 'PspTimeout';
    }
    const code = errorCode(new PspTimeout('carte 4111 refusée pour Juan Pérez'));
    expect(code).toBe('PspTimeout');
  });
  it('repli Error pour une valeur quelconque', () => {
    expect(errorCode('texte libre')).toBe('Error');
    expect(errorCode({ name: 'nom avec espaces et données' })).toBe('Error');
  });
});
