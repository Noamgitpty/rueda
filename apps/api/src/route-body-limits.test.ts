/**
 * US-311 — parité du plafond d'un relevé du PSP et limite de corps propre de la route de dépôt
 * (ADR-194) : même plafond dans le code, l'OpenAPI (`maxItems`) et la base (0174) ; 400 lignes LEGS
 * au pire cas tiennent dans la limite de la route ; code et clé du 413 alignés sur RPT ; la limite
 * globale de 100 Kio n'est pas relâchée.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_BODY_LIMIT_BYTES } from './http-hardening.js';
import { REPORT_MESSAGES, RECON_LINES_WARNING, RECON_MAX_LINES } from './modules/rpt/index.js';
import { RECON_STATEMENT_BODY_LIMIT_BYTES, ROUTE_BODY_LIMITS } from './route-body-limits.js';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** Ligne LEGS au pire cas : UUID, jambe la plus longue, cinq montants de 18 chiffres. */
const worstLine = {
  tripReference: '00000000-0000-4000-8000-000000000000',
  leg: 'TAX_THIRD_PARTY',
  currency: 'XTS',
  capturedMinor: '9'.repeat(18),
  refundedMinor: '9'.repeat(18),
  reallocatedInMinor: '9'.repeat(18),
  reallocatedOutMinor: '9'.repeat(18),
  releasedMinor: '9'.repeat(18),
};

describe('plafond d’un relevé du PSP (US-311)', () => {
  it('même plafond dans le code, l’OpenAPI et la base', () => {
    const doc = JSON.parse(read('../openapi/openapi.json')) as {
      paths: Record<
        string,
        Record<
          string,
          {
            requestBody: {
              content: Record<string, { schema: { properties: { lines: { maxItems: number } } } }>;
            };
          }
        >
      >;
    };
    const schema =
      doc.paths['/console/reconciliation/runs']!['post']!.requestBody.content['application/json']!
        .schema;
    expect(schema.properties.lines.maxItems).toBe(RECON_MAX_LINES);
    const sql = read('../../../packages/db/migrations/0174_report_beta_views_reconciliation.sql');
    expect(sql).toContain(`jsonb_array_length(p_lines) NOT BETWEEN 1 AND ${RECON_MAX_LINES}`);
    expect(RECON_LINES_WARNING).toBeLessThan(RECON_MAX_LINES);
  });

  it('limite propre de la route : 400 lignes LEGS au pire cas tiennent ; la limite globale reste 100 Kio', () => {
    const body = JSON.stringify({
      requestId: '00000000-0000-4000-8000-000000000001',
      country: 'ZZ',
      month: '2026-11',
      kind: 'LEGS',
      reason: 'x'.repeat(500),
      lines: Array.from({ length: RECON_MAX_LINES }, () => worstLine),
    });
    expect(Buffer.byteLength(body)).toBeGreaterThan(API_BODY_LIMIT_BYTES);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(RECON_STATEMENT_BODY_LIMIT_BYTES);
    expect(API_BODY_LIMIT_BYTES).toBe(100 * 1024);
    expect(ROUTE_BODY_LIMITS.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /console/reconciliation/runs',
    ]);
  });

  it('413 de la route : code et clé du catalogue de RPT', () => {
    const route = ROUTE_BODY_LIMITS[0]!;
    expect(route.tooLarge).toEqual({
      code: 'RECON_STATEMENT_TOO_LARGE',
      messageKey: REPORT_MESSAGES.RECON_STATEMENT_TOO_LARGE.messageKey,
    });
    expect(REPORT_MESSAGES.RECON_STATEMENT_TOO_LARGE.status).toBe(413);
  });
});
