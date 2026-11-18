/**
 * US-217 partie 217b — lecture défensive de `GET /host/accounts/{orgId}/earnings/{month}` (A08).
 * Attendus : contrat OpenAPI de la route (ADR-161, ADR-167) et 08 TJ01 / T03 / T14 (jambe HOST
 * 131,25 ; retenue 45,00 ; pénalité −25,00) ; jamais le code testé.
 */
import { describe, expect, it } from 'vitest';
import { hostEarningsOf, monthOf, shiftMonth } from './host-earnings.ts';

const ORG = '00000000-0000-4000-8000-0000000217b2';
const TRIP_A = '00000000-0000-4000-8000-0000000217a1';
const TRIP_B = '00000000-0000-4000-8000-0000000217a2';
const AT = '2034-05-20T15:00:00.000Z';
const earning = {
  kind: 'EARNING',
  tripId: TRIP_A,
  tripStatus: 'BOOKED',
  source: 'CAPTURE',
  settlementVersion: null,
  reason: null,
  eventAt: AT,
  amountMinor: '13125',
  shareBaseMinor: '17500',
  kminoFeeMinor: '4375',
  hostPlanCode: 'ESTÁNDAR',
  hostSharePct: '3/4',
};
const cxl = {
  ...earning,
  kind: 'CXL_EARNING',
  tripId: TRIP_B,
  tripStatus: 'CANCELLED_BY_HOST',
  source: 'SETTLEMENT',
  settlementVersion: 1,
  amountMinor: '0',
  shareBaseMinor: '0',
  kminoFeeMinor: '0',
};
const penalty = {
  ...cxl,
  kind: 'ADJUSTMENT',
  source: 'HOST_LEDGER',
  reason: 'HOST_CANCELLATION_PENALTY',
  amountMinor: '-2500',
  shareBaseMinor: null,
  kminoFeeMinor: null,
  hostPlanCode: null,
  hostSharePct: null,
};
const statement = {
  currency: 'XTS',
  currencyExponent: 2,
  tripsCount: 2,
  hostLegMinor: '13125',
  adjustmentsMinor: '-2500',
  netMinor: '10625',
  earnedMinor: '-2500',
  pendingMinor: '13125',
  lines: [earning, cxl, penalty],
};
const body = { orgId: ORG, month: '2034-05', country: 'XA', statements: [statement] };
const ok = (json: unknown) => ({ status: 200, json, session: null });

describe('hostEarningsOf', () => {
  it('relevé lu tel quel : acquis et à venir rendus par l’API, pénalité en ligne séparée', () => {
    const v = hostEarningsOf(ok(body));
    expect(v).toMatchObject({ orgId: ORG, month: '2034-05', country: 'XA' });
    const s = v!.statements[0]!;
    expect(s).toMatchObject({ earnedMinor: -2500n, pendingMinor: 13125n, tripsCount: 2 });
    expect(s.lines.map((l) => [l.kind, l.amountMinor])).toEqual([
      ['EARNING', 13125n],
      ['CXL_EARNING', 0n],
      ['ADJUSTMENT', -2500n],
    ]);
    expect(s.lines[0]).toMatchObject({ kminoFeeMinor: 4375n, shareBaseMinor: 17500n });
    expect(hostEarningsOf(ok({ ...body, statements: [] }))?.statements).toEqual([]);
  });

  it('toute forme inattendue ⇒ null (jamais un relevé partiel ou deviné)', () => {
    for (const bad of [
      { ...body, orgId: 'x' },
      { ...body, month: '2034-13' },
      { ...body, country: 'xa' },
      { ...body, statements: 'x' },
      { ...body, statements: [{ ...statement, earnedMinor: undefined }] },
      { ...body, statements: [{ ...statement, pendingMinor: '-1' }] },
      { ...body, statements: [{ ...statement, currencyExponent: 9 }] },
      { ...body, statements: [{ ...statement, lines: [{ ...earning, amountMinor: '-1' }] }] },
      { ...body, statements: [{ ...statement, lines: [{ ...earning, kind: 'COMMISSION' }] }] },
      { ...body, statements: [{ ...statement, lines: [{ ...penalty, reason: null }] }] },
      { ...body, statements: [{ ...statement, lines: [{ ...penalty, reason: 'OTHER' }] }] },
      { ...body, statements: [{ ...statement, lines: [{ ...penalty, source: 'CAPTURE' }] }] },
      { ...body, statements: [{ ...statement, lines: [{ ...earning, hostSharePct: '75%' }] }] },
    ]) {
      expect(hostEarningsOf(ok(bad)), JSON.stringify(bad)).toBeNull();
    }
    expect(hostEarningsOf({ status: 404, json: {}, session: null })).toBeNull();
  });

  it('mois : navigation et mois par défaut', () => {
    expect(shiftMonth('2034-01', -1)).toBe('2033-12');
    expect(shiftMonth('2034-12', 1)).toBe('2035-01');
    expect(shiftMonth('2034-05', 1)).toBe('2034-06');
    expect(monthOf('2034-05', new Date('2036-01-01T00:00:00Z'))).toBe('2034-05');
    expect(monthOf('2034-5', new Date('2036-01-31T23:00:00Z'))).toBe('2036-01');
    expect(monthOf(undefined, new Date('2036-02-01T00:00:00Z'))).toBe('2036-02');
  });
});
