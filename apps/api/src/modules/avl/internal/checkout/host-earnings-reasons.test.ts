/**
 * US-314 (revue de #284) — relevé des gains de l'hôte avec chaque motif du host_ledger (0129, 0139,
 * 0167) : avant le correctif, une seule écriture d'avance, de reprise de chargeback ou de passage
 * en perte rendait le relevé en 503. Montants des formes de 08 (pénalité T14 −25,00 ; avance TJ18b
 * −75,00 ; reprise T53 −45,00 ; passage en perte +75,00). Parité des listes : API = contrat OpenAPI
 * (le site est comparé au même contrat par `apps/web/account/host-earnings.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HostEarningsService } from './host-earnings.js';
import type { HostEarningsRow } from './host-earnings.js';
import { ADJUSTMENT_REASONS } from './trip-receipt.js';

const ORG = '00000000-0000-4000-8000-000000000314';
const TRIP = '00000000-0000-4000-8000-0000000003a1';
const AT = '2034-05-20T15:00:00.000Z';
const AMOUNTS: Readonly<Record<string, string>> = {
  HOST_CANCELLATION_PENALTY: '-2500',
  RELEASED_LEG_ADVANCE: '-7500',
  CHARGEBACK_CLAWBACK: '-4500',
  RECEIVABLE_WRITE_OFF: '7500',
};

const adjustment = (reason: string) => ({
  kind: 'ADJUSTMENT',
  tripId: TRIP,
  tripStatus: 'CANCELLED_BY_HOST',
  source: 'HOST_LEDGER',
  settlementVersion: 1,
  reason,
  eventAt: AT,
  amountMinor: AMOUNTS[reason] ?? '0',
  shareBaseMinor: null,
  kminoFeeMinor: null,
  hostPlanCode: null,
  hostSharePct: null,
});

function rowWith(reasons: readonly string[]): HostEarningsRow {
  const total = reasons.reduce((s, r) => s + BigInt(AMOUNTS[r] ?? '0'), 0n).toString();
  return {
    outcome: 'OK',
    country: 'XA',
    exponents: { XTS: 2 },
    statements: [
      {
        currency: 'XTS',
        tripsCount: 1,
        hostLegMinor: '0',
        adjustmentsMinor: total,
        netMinor: total,
        earnedMinor: total,
        pendingMinor: '0',
        lines: reasons.map(adjustment),
      },
    ],
  };
}

const service = (row: HostEarningsRow) =>
  new HostEarningsService({ read: () => Promise.resolve(row) });

describe('US-314 — relevé des gains : chaque motif du host_ledger est lisible', () => {
  it.each(Object.keys(AMOUNTS))(
    '%s ⇒ relevé servi (et non 503), motif et montant conservés',
    async (reason) => {
      const view = await service(rowWith([reason])).read(Buffer.from('x'), ORG, '2034-05');
      const line = view.statements[0]?.lines[0];
      expect(line).toMatchObject({ kind: 'ADJUSTMENT', reason, amountMinor: AMOUNTS[reason] });
    },
  );

  it('les quatre motifs dans le même relevé', async () => {
    const view = await service(rowWith(Object.keys(AMOUNTS))).read(
      Buffer.from('x'),
      ORG,
      '2034-05',
    );
    expect(view.statements[0]?.lines.map((l) => l.reason)).toEqual(Object.keys(AMOUNTS));
  });

  it('motif inconnu ⇒ 503 (fail-closed, inchangé)', async () => {
    await expect(
      service(rowWith(['NOT_A_REASON'])).read(Buffer.from('x'), ORG, '2034-05'),
    ).rejects.toMatchObject({ code: 'EARNINGS_UNAVAILABLE' });
  });

  it('parité : motifs de l’API = enum du contrat OpenAPI (relevé et reçu)', () => {
    const openapi = readFileSync(
      new URL('../../../../../openapi/openapi.json', import.meta.url),
      'utf8',
    );
    const enums = [...openapi.matchAll(/"enum": \[\s*("HOST_CANCELLATION_PENALTY"[^\]]*)\]/g)].map(
      (m) => (JSON.parse(`[${m[1] ?? ''}]`) as (string | null)[]).filter((x) => x !== null),
    );
    expect(enums.length).toBeGreaterThanOrEqual(2);
    for (const e of enums) expect(e).toEqual([...ADJUSTMENT_REASONS]);
  });
});
