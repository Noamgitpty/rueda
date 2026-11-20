/**
 * US-314 (revue de #284) — parité des listes fermées des versements : API = contrat OpenAPI
 * (schéma `HostPayouts`) ; le site est comparé au même contrat par
 * `apps/web/account/host-payouts.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOLD_REASONS, PAYOUT_KINDS, PAYOUT_STATUSES } from './host-payouts.js';

type Prop = { enum?: string[]; items?: { enum?: string[] } };

describe('US-314 — parité API / contrat des versements', () => {
  it('motifs de retenue, états et types de lot = enums du schéma HostPayouts', () => {
    const doc = JSON.parse(
      readFileSync(new URL('../../../../openapi/openapi.json', import.meta.url), 'utf8'),
    ) as { components: { schemas: Record<string, { properties: Record<string, unknown> }> } };
    const item = (
      doc.components.schemas['HostPayouts']?.properties['payouts'] as {
        items: { properties: Record<string, Prop> };
      }
    ).items.properties;
    expect(item['holdReasons']?.items?.enum).toEqual([...HOLD_REASONS]);
    expect(item['status']?.enum).toEqual([...PAYOUT_STATUSES]);
    expect(item['kind']?.enum).toEqual([...PAYOUT_KINDS]);
  });
});
