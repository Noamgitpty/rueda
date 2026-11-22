/**
 * US-311 — contrat des routes des vues de la bêta, des exports CSV et du rapprochement assisté
 * (`/console/beta-views/{view}`, `/console/reports/exports`, `/console/reconciliation/…`) sur
 * l'application RÉELLE (ApiModule, gardes globaux, durcissement HTTP ; harnais d'US-043) avec un
 * FAKE du magasin : chaque réponse est confrontée à `openapi.json`, chaque statut déclaré est
 * exercé.
 *
 * Attendus tirés de 19 US-311 (export CSV, aucune donnée personnelle superflue, procédure manuelle
 * bornée), de 16 FIN-005 (RECON_STATEMENT_MISSING, RECON_FORMAT_INVALID) et de 17 §2.3 (permission
 * jugée par la base, pays du rôle), jamais du code testé. La permission, le pays, l'appariement à
 * l'unité mineure et le journal d'accès sont prouvés sur PostgreSQL
 * (`packages/db/test/l0/l0-us311-beta-reconciliation.test.ts`) ; ici, le FAKE rend ce que
 * rendrait la base.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  closeContractApps,
  contract,
  coverageOf,
  FIRST_COUNTRY,
  startContractApp,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import { ReportStoreError } from '../index.js';
import type { BetaView, ReconKind, ReportResult, ReportStore } from '../index.js';

const apps: ContractApp[] = [];
afterAll(closeContractApps);

const REASON = 'Rapprochement mensuel de test (US-311)';
const CHECKLIST = {
  PSP_STATEMENT_COMPLETE: true,
  OPERATIONS_RECONCILED: true,
  LEGS_RECONCILED: true,
  DISCREPANCIES_EXPLAINED_OR_ESCALATED: true,
  THRESHOLD_REVIEWED: true,
};

interface Call {
  readonly op: string;
  readonly hashHex: string;
  readonly args: readonly unknown[];
}

/** Magasin en mémoire : ce que la base rendrait à la session. */
class FakeReportStore implements ReportStore {
  readonly calls: Call[] = [];
  outcome = 'OK';
  body: Record<string, unknown> | null = { rows: [] };
  failing: 'down' | 'invalid' | null = null;

  #go<T>(op: string, hash: Buffer, args: readonly unknown[], value: T): Promise<T> {
    if (this.failing === 'down') return Promise.reject(new ReportStoreError(undefined));
    if (this.failing === 'invalid') return Promise.reject(new ReportStoreError('22023'));
    this.calls.push({ op, hashHex: hash.toString('hex'), args });
    return Promise.resolve(value);
  }
  #result(): ReportResult {
    return { outcome: this.outcome, body: this.outcome === 'OK' ? this.body : null };
  }
  betaView(
    hash: Buffer,
    requestId: string,
    view: BetaView,
    country: string,
    reason: string | null,
  ) {
    return this.#go('betaView', hash, [requestId, view, country, reason], this.#result());
  }
  platformExport(
    hash: Buffer,
    requestId: string,
    country: string,
    month: string,
    kind: ReconKind,
    reason: string,
  ) {
    return this.#go(
      'platformExport',
      hash,
      [requestId, country, month, kind, reason],
      this.#result(),
    );
  }
  record(
    hash: Buffer,
    requestId: string,
    country: string,
    month: string,
    kind: ReconKind,
    lines: readonly unknown[],
    reason: string,
  ) {
    return this.#go('record', hash, [requestId, country, month, kind, lines, reason], {
      outcome: this.outcome === 'OK' ? 'RECORDED' : this.outcome,
      runId: this.outcome === 'OK' || this.outcome === 'ALREADY_RECORDED' ? requestId : null,
    });
  }
  run(hash: Buffer, requestId: string, runId: string, reason: string | null) {
    return this.#go('run', hash, [requestId, runId, reason], this.#result());
  }
  runs(hash: Buffer, country: string) {
    return this.#go('runs', hash, [country], this.#result());
  }
  resolve(hash: Buffer, requestId: string, itemId: string, resolution: string, note: string) {
    return this.#go('resolve', hash, [requestId, itemId, resolution, note], {
      outcome: this.outcome === 'OK' ? 'RESOLVED' : this.outcome,
    });
  }
  sign(
    hash: Buffer,
    requestId: string,
    runId: string,
    checklist: Readonly<Record<string, boolean>>,
  ) {
    return this.#go('sign', hash, [requestId, runId, checklist], {
      outcome: this.outcome === 'OK' ? 'CLOSED' : this.outcome,
      unexplained: this.outcome === 'OK' ? 1 : null,
    });
  }
}

async function world(): Promise<{ app: ContractApp; store: FakeReportStore }> {
  const store = new FakeReportStore();
  const app = await startContractApp({ report: store });
  apps.push(app);
  return { app, store };
}

type Method = 'GET' | 'POST';
interface Route {
  readonly method: Method;
  readonly path: string;
  readonly body?: unknown;
  /** Corps OK rendu par la base pour cette route. */
  readonly ok: Record<string, unknown>;
  readonly okStatus: number;
  /** Requête mal formée (400). */
  readonly bad: { readonly path: string; readonly body?: unknown };
}

const RUN = randomUUID();
const ITEM = randomUUID();
const ROUTES: readonly Route[] = [
  {
    method: 'GET',
    path: `/console/beta-views/overdue?country=${FIRST_COUNTRY}`,
    ok: { view: 'OVERDUE', country: FIRST_COUNTRY, at: '2026-11-20T10:00:00+00:00', rows: [] },
    okStatus: 200,
    bad: { path: `/console/beta-views/everything?country=${FIRST_COUNTRY}` },
  },
  {
    method: 'POST',
    path: '/console/reports/exports',
    body: { source: 'OVERDUE', country: FIRST_COUNTRY, reason: REASON },
    ok: { rows: [] },
    okStatus: 200,
    bad: { path: '/console/reports/exports', body: { source: 'OVERDUE', country: FIRST_COUNTRY } },
  },
  {
    method: 'POST',
    path: '/console/reconciliation/runs',
    body: {
      requestId: RUN,
      country: FIRST_COUNTRY,
      month: '2026-11',
      kind: 'OPERATIONS',
      reason: REASON,
      lines: [{ reference: 'psp-1', amountMinor: '12840', currency: 'XTS' }],
    },
    ok: {},
    okStatus: 201,
    bad: {
      path: '/console/reconciliation/runs',
      body: { requestId: 'x', country: FIRST_COUNTRY, month: '2026-13', kind: 'OPERATIONS' },
    },
  },
  {
    method: 'GET',
    path: `/console/reconciliation/runs?country=${FIRST_COUNTRY}`,
    ok: {
      country: FIRST_COUNTRY,
      runs: [],
      months: [],
      dailyReconciliationRequired: false,
      previousMonthsClosed: 0,
    },
    okStatus: 200,
    bad: { path: '/console/reconciliation/runs?country=xx' },
  },
  {
    method: 'GET',
    path: `/console/reconciliation/runs/${RUN}`,
    ok: {
      runId: RUN,
      country: FIRST_COUNTRY,
      kind: 'OPERATIONS',
      month: '2026-11',
      status: 'DISCREPANCIES',
      items: [],
    },
    okStatus: 200,
    bad: { path: '/console/reconciliation/runs/not-a-uuid' },
  },
  {
    method: 'POST',
    path: `/console/reconciliation/items/${ITEM}/resolution`,
    body: { requestId: randomUUID(), resolution: 'TIMING', note: 'Décalage de date du PSP' },
    ok: {},
    okStatus: 200,
    bad: {
      path: `/console/reconciliation/items/${ITEM}/resolution`,
      body: { requestId: randomUUID(), resolution: 'FREE_TEXT', note: 'Décalage de date du PSP' },
    },
  },
  {
    method: 'POST',
    path: `/console/reconciliation/runs/${RUN}/signature`,
    body: { requestId: randomUUID(), checklist: CHECKLIST },
    ok: {},
    okStatus: 200,
    bad: {
      path: `/console/reconciliation/runs/${RUN}/signature`,
      body: { requestId: randomUUID(), checklist: { SIGNED: true } },
    },
  },
];

describe('US-311 — vues de la bêta, exports et rapprochement (console)', () => {
  it.each(ROUTES)(
    '$method $path : succès, 400, 401, 403 (sans TOTP, refus de la base), 503',
    async (route) => {
      const w = await world();
      const staff = w.app.cookie('staff');
      w.store.body = route.ok;
      const ok = await w.app.api.request(route.method, route.path, {
        headers: staff,
        body: route.body,
      });
      expect(ok.status).toBe(route.okStatus);
      expect(ok.headers.get('cache-control')).toBe('no-store');
      // la preuve de possession transmise est l'empreinte de la session, jamais le jeton
      expect(w.store.calls.at(-1)?.hashHex).toBe(w.app.hash('staff'));
      const bad = await w.app.api.request(route.method, route.bad.path, {
        headers: staff,
        body: route.bad.body,
      });
      expect(bad.status).toBe(400);
      expect((await w.app.api.request(route.method, route.path, { body: route.body })).status).toBe(
        401,
      );
      expect(
        (
          await w.app.api.request(route.method, route.path, {
            headers: w.app.cookie('staff_sans_mfa'),
            body: route.body,
          })
        ).status,
      ).toBe(403);
      w.store.outcome = 'FORBIDDEN';
      const refused = await w.app.api.request(route.method, route.path, {
        headers: staff,
        body: route.body,
      });
      expect(refused.status).toBe(403);
      expect(refused.json).toMatchObject({ code: 'FORBIDDEN' });
      w.store.outcome = 'OK';
      w.store.failing = 'down';
      const down = await w.app.api.request(route.method, route.path, {
        headers: staff,
        body: route.body,
      });
      expect(down.status).toBe(503);
      expect(down.json).toMatchObject({ code: 'REPORT_UNAVAILABLE' });
    },
  );

  it('export CSV : en-têtes stables, cellule de formule neutralisée, fichier en pièce jointe ; aucune donnée personnelle ajoutée', async () => {
    const w = await world();
    w.store.body = {
      rows: [
        {
          tripRef: '=HYPERLINK("x")',
          tripId: randomUUID(),
          orgId: randomUUID(),
          vehicleId: randomUUID(),
          status: 'OVERDUE',
          stage: 'T30M',
          scheduledEnd: '2026-11-20T10:00:00+00:00',
          detectedAt: '2026-11-20T10:30:00+00:00',
          minutesLate: 45,
          useUntil: '2026-11-20T11:30:00+00:00',
          bounded: false,
          nextTripId: null,
        },
      ],
    };
    const r = await w.app.api.request('POST', '/console/reports/exports', {
      headers: w.app.cookie('staff'),
      body: { source: 'OVERDUE', country: FIRST_COUNTRY, reason: REASON },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(r.headers.get('content-disposition')).toBe(
      `attachment; filename="overdue-${FIRST_COUNTRY}.csv"`,
    );
    const [header, line] = r.text.split('\r\n');
    expect(header).toBe(
      'tripRef,tripId,orgId,vehicleId,status,stage,scheduledEnd,detectedAt,minutesLate,useUntil,bounded,nextTripId',
    );
    expect(line?.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
    // le motif est transmis à la base (journal d'accès BULK_EXPORT), jamais rendu
    expect(w.store.calls.at(-1)).toMatchObject({
      op: 'betaView',
      args: [expect.any(String), 'OVERDUE', FIRST_COUNTRY, REASON],
    });
    expect(r.text).not.toContain(REASON);
  });

  it('rapprochement : relevé absent ou mal formé (400 RECON_*), rejeu 200, issues 409', async () => {
    const w = await world();
    const staff = w.app.cookie('staff');
    const base = {
      requestId: randomUUID(),
      country: FIRST_COUNTRY,
      month: '2026-11',
      kind: 'LEGS',
      reason: REASON,
    };
    const empty = await w.app.api.request('POST', '/console/reconciliation/runs', {
      headers: staff,
      body: { ...base, lines: [] },
    });
    expect(empty.status).toBe(400);
    expect(empty.json).toMatchObject({ code: 'RECON_STATEMENT_MISSING' });
    w.store.failing = 'invalid';
    const invalid = await w.app.api.request('POST', '/console/reconciliation/runs', {
      headers: staff,
      body: { ...base, lines: [{ tripReference: 'x' }] },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.json).toMatchObject({ code: 'RECON_FORMAT_INVALID' });
    // 400 lignes au plus (un relevé tient dans le corps de 100 Kio) : 401 refusées avant la base
    w.store.failing = null;
    const before = w.store.calls.length;
    const tooMany = await w.app.api.request('POST', '/console/reconciliation/runs', {
      headers: staff,
      body: {
        ...base,
        kind: 'OPERATIONS',
        lines: Array.from({ length: 401 }, (_, n) => ({
          reference: `p${n}`,
          amountMinor: '1',
          currency: 'XTS',
        })),
      },
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.json).toMatchObject({ code: 'RECON_FORMAT_INVALID' });
    expect(w.store.calls.length).toBe(before);
    w.store.outcome = 'ALREADY_RECORDED';
    const replay = await w.app.api.request('POST', '/console/reconciliation/runs', {
      headers: staff,
      body: { ...base, lines: [{ tripReference: 'x' }] },
    });
    expect(replay.status).toBe(200);
    expect(replay.json).toEqual({ runId: base.requestId });

    const cases: readonly [string, string, unknown, string][] = [
      [
        `/console/reconciliation/items/${ITEM}/resolution`,
        'ALREADY_RESOLVED',
        { requestId: randomUUID(), resolution: 'OTHER', note: 'Écart déjà expliqué' },
        'RECON_ITEM_SETTLED',
      ],
      [
        `/console/reconciliation/items/${ITEM}/resolution`,
        'CLOSED',
        { requestId: randomUUID(), resolution: 'OTHER', note: 'Passage déjà clôturé' },
        'RECON_RUN_CLOSED',
      ],
      [
        `/console/reconciliation/runs/${RUN}/signature`,
        'CHECKLIST_INCOMPLETE',
        { requestId: randomUUID(), checklist: { ...CHECKLIST, LEGS_RECONCILED: false } },
        'RECON_CHECKLIST_INCOMPLETE',
      ],
      [
        `/console/reconciliation/runs/${RUN}/signature`,
        'ALREADY_CLOSED',
        { requestId: randomUUID(), checklist: CHECKLIST },
        'RECON_RUN_CLOSED',
      ],
    ];
    for (const [path, outcome, body, code] of cases) {
      w.store.outcome = outcome;
      const r = await w.app.api.request('POST', path, { headers: staff, body });
      expect(r.status, outcome).toBe(409);
      expect(r.json).toMatchObject({ code });
    }
  });
});

describe('US-311 — taille du relevé : limite de corps propre de la route, avertissement', () => {
  const worst = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      tripReference: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      leg: 'TAX_THIRD_PARTY',
      currency: 'XTS',
      capturedMinor: '9'.repeat(18),
      refundedMinor: '9'.repeat(18),
      reallocatedInMinor: '9'.repeat(18),
      reallocatedOutMinor: '9'.repeat(18),
      releasedMinor: '9'.repeat(18),
    }));
  const body = (lines: unknown[]) => ({
    requestId: randomUUID(),
    country: FIRST_COUNTRY,
    month: '2026-11',
    kind: 'LEGS',
    reason: 'x'.repeat(500),
    lines,
  });

  it('400 lignes LEGS au pire cas (plus de 100 Kio) : admises par la route, avertissement RECON_STATEMENT_NEAR_LIMIT', async () => {
    const w = await world();
    const payload = body(worst(400));
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(100 * 1024);
    const r = await w.app.api.request('POST', '/console/reconciliation/runs', {
      headers: w.app.cookie('staff'),
      body: payload,
    });
    expect(r.status).toBe(201);
    expect(r.json).toEqual({
      runId: payload.requestId,
      warnings: [
        {
          code: 'RECON_STATEMENT_NEAR_LIMIT',
          messageKey: 'common.reconciliation.statementNearLimit',
          values: { lines: 400, max: 400 },
        },
      ],
    });
    // au plus 300 lignes : aucun avertissement
    const quiet = await w.app.api.request('POST', '/console/reconciliation/runs', {
      headers: w.app.cookie('staff'),
      body: body(worst(300)),
    });
    expect(quiet.status).toBe(201);
    expect(quiet.json).not.toHaveProperty('warnings');
  });

  it('corps au-delà de la limite de la route (128 Kio) : 413 RECON_STATEMENT_TOO_LARGE, rien n’est lu ; une autre route garde 100 Kio', async () => {
    const w = await world();
    const payload = body(worst(500));
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(128 * 1024);
    const r = await w.app.api.request('POST', '/console/reconciliation/runs', {
      headers: w.app.cookie('staff'),
      body: payload,
    });
    expect(r.status).toBe(413);
    expect(r.json).toEqual({
      code: 'RECON_STATEMENT_TOO_LARGE',
      messageKey: 'common.reconciliation.statementTooLarge',
    });
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(w.store.calls).toEqual([]);
    // la limite globale n'est pas relâchée : 110 Kio sur une autre route du rapprochement ⇒ 413
    const other = await w.app.api.request('POST', `/console/reconciliation/runs/${RUN}/signature`, {
      headers: w.app.cookie('staff'),
      body: { requestId: randomUUID(), checklist: CHECKLIST, pad: 'x'.repeat(110 * 1024) },
    });
    expect(other.status).toBe(413);
    expect(other.json).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
});

describe('US-311 — couverture du contrat', () => {
  // 429 (limite de débit de la console) : exercé par la suite /console sur chaque route /console
  it('couverture : chaque statut déclaré pour /console/beta-views est exercé', () => {
    expect(
      missingCoverage(contract, '/console/beta-views', coverageOf(...apps)).filter(
        (d) => !d.endsWith(' 429'),
      ),
    ).toEqual([]);
  });
  it('couverture : chaque statut déclaré pour /console/reports est exercé', () => {
    expect(
      missingCoverage(contract, '/console/reports', coverageOf(...apps)).filter(
        (d) => !d.endsWith(' 429'),
      ),
    ).toEqual([]);
  });
  it('couverture : chaque statut déclaré pour /console/reconciliation est exercé', () => {
    expect(
      missingCoverage(contract, '/console/reconciliation', coverageOf(...apps)).filter(
        (d) => !d.endsWith(' 429'),
      ),
    ).toEqual([]);
  });
});
