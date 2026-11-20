/**
 * US-314 — lecture défensive de `GET /host/accounts/{orgId}/payouts` (A08). Attendus : contrat
 * OpenAPI de la route (ADR-192) ; montants des formes de 08 (jambe HOST de TJ01 131,25, pénalité de
 * T14 25,00 compensée) ; jamais le code testé.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOLD_REASONS, PAYOUT_STATUSES, hostPayoutsOf, localTimeOf } from './host-payouts.ts';

const ORG = '00000000-0000-4000-8000-000000000314';
const TRIP = '00000000-0000-4000-8000-0000000003a1';
const paid = {
  batchId: '00000000-0000-4000-8000-0000000003b1',
  kind: 'FINAL',
  status: 'PAID',
  scheduledFor: '2036-12-05T10:00:00.000Z',
  firstPayout: true,
  grossMinor: '13125',
  nettedMinor: '2500',
  netMinor: '10625',
  holdReasons: [],
  initiatedAt: '2036-12-05T10:01:00.000Z',
  paidAt: '2036-12-06T10:00:00.000Z',
  trips: [{ tripId: TRIP, amountMinor: '13125' }],
};
const held = {
  ...paid,
  batchId: '00000000-0000-4000-8000-0000000003b2',
  status: 'ON_HOLD',
  firstPayout: false,
  nettedMinor: '0',
  netMinor: '13125',
  holdReasons: ['CLAIM', 'PAYOUTS_DISABLED'],
  initiatedAt: null,
  paidAt: null,
};
const body = {
  orgId: ORG,
  country: 'XA',
  currency: 'XTS',
  currencyExponent: 2,
  schedule: {
    businessDayOffset: 2,
    firstPayoutBusinessDay: 5,
    localTimeMinutes: 600,
    timeZone: 'America/Somewhere',
  },
  payouts: [held, paid],
};
const reply = (json: unknown) => ({ status: 200, json, session: null });

describe('US-314 — versements de l’hôte (A08)', () => {
  it('forme du contrat : calendrier, lots, montants en bigint, motifs', () => {
    const v = hostPayoutsOf(reply(body));
    expect(v).not.toBeNull();
    expect(v?.schedule).toEqual(body.schedule);
    expect(v?.payouts.map((p) => p.status)).toEqual(['ON_HOLD', 'PAID']);
    expect(v?.payouts[1]).toMatchObject({
      grossMinor: 13125n,
      nettedMinor: 2500n,
      netMinor: 10625n,
      firstPayout: true,
      tripIds: [TRIP],
    });
    expect(v?.payouts[0]?.holdReasons).toEqual(['CLAIM', 'PAYOUTS_DISABLED']);
  });

  it('calendrier non publié : paramètres null admis', () => {
    const v = hostPayoutsOf(
      reply({
        ...body,
        schedule: {
          businessDayOffset: null,
          firstPayoutBusinessDay: null,
          localTimeMinutes: null,
          timeZone: null,
        },
        payouts: [],
      }),
    );
    expect(v?.schedule.businessDayOffset).toBeNull();
    expect(v?.payouts).toEqual([]);
  });

  it('toute forme inattendue ⇒ null (jamais un versement deviné)', () => {
    for (const bad of [
      { ...body, orgId: 'x' },
      { ...body, currencyExponent: 9 },
      { ...body, schedule: { ...body.schedule, localTimeMinutes: 1440 } },
      { ...body, payouts: [{ ...paid, status: 'SENT' }] },
      { ...body, payouts: [{ ...paid, netMinor: '-1' }] },
      { ...body, payouts: [{ ...held, holdReasons: ['NOT_A_REASON'] }] },
      { ...body, payouts: [{ ...paid, paidAt: 'hier' }] },
      { ...body, payouts: [{ ...paid, trips: [{ tripId: 'x', amountMinor: '1' }] }] },
    ]) {
      expect(hostPayoutsOf(reply(bad))).toBeNull();
    }
    expect(hostPayoutsOf({ status: 404, json: {}, session: null })).toBeNull();
    expect(hostPayoutsOf({ status: 'unavailable' })).toBeNull();
  });

  it('parité : motifs de retenue et états du site = contrat OpenAPI (schéma HostPayouts)', () => {
    const doc = JSON.parse(
      readFileSync(new URL('../../api/openapi/openapi.json', import.meta.url), 'utf8'),
    ) as {
      components: { schemas: Record<string, { properties: Record<string, unknown> }> };
    };
    const item = (
      doc.components.schemas['HostPayouts']?.properties['payouts'] as {
        items: { properties: Record<string, { enum?: string[]; items?: { enum: string[] } }> };
      }
    ).items.properties;
    expect(item['holdReasons']?.items?.enum).toEqual([...HOLD_REASONS]);
    expect(item['status']?.enum).toEqual([...PAYOUT_STATUSES]);
  });

  it('heure locale du lot (minutes après minuit)', () => {
    expect(localTimeOf(600)).toBe('10:00');
    expect(localTimeOf(0)).toBe('00:00');
    expect(localTimeOf(1439)).toBe('23:59');
  });
});
