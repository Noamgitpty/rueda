/**
 * US-047 — parcours doré de règlement et contrôles de rapprochement, sur PostgreSQL réel, sous le
 * rôle de PRODUCTION `app_worker` (CLAUDE.md point 6 : `withRole` exécute l'assertion L0-05 avant
 * toute requête), en USD (PA) et en PYG sans décimale (PY). Transaction toujours ANNULÉE.
 *
 * Parcours, par pays : trip réservé (fixture) → capture par jambe (`trip_leg_balance`, vecteur
 * TJ01 / TJ08a) → annulation réglée v1 (T03 / T27) ; second trip : v1 (T05 / T41) puis
 * supersession v2 par l'événement de T08 (variation TJ18a / TJ18c), écrites par la seule commande
 * `core.settlement_cmd_record` (travailleur `settlement`). Puis, sur TOUTE la base :
 *   - les contrôles de rapprochement de l'argent (travailleur `reconciliation`, FIN) : 0 écart ;
 *     les lignes lues reflètent exactement le parcours (comptes et sommes par pays, avant / après),
 *     les attendus venant de l'export des oracles (`@rueda/money/golden-vectors`), jamais du code ;
 *   - l'oracle C12 (`core.booking_production_oracle`, travailleur `booking_oracle`) : 0 écart.
 * Un autre travailleur ne lit rien : le contrôle refuse de rendre des zéros trompeurs.
 *
 * Écart injecté : une version en écart, par contrôle, est ajoutée aux SOURCES des requêtes
 * d'agrégat (la base refuserait de l'écrire) ; chacune doit être détectée par son contrôle.
 *
 * Nuit (nightly.yml, job `rapprochement`) : `RUEDA_QA_REPORT_DIR` reçoit le rapport JSON (comptes
 * seulement) publié au tableau de bord QA (scripts/qa/nightly-dashboard.mjs, ADR-087).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '@rueda/db';
import { withRole, withTestTransaction } from '@rueda/db/testing';
import { buildSettlementRecord, settlementRecordPayload } from '@rueda/money';
import type { SettlementRecord } from '@rueda/money';
import { legVector, loadGoldenVectors, settlementVector } from '@rueda/money/golden-vectors';
import { testParams, toEvent, toTrip } from '@rueda/money/testing';
import {
  evaluateMoneyReconciliation,
  LEG_BALANCE_SOURCE,
  legBalanceAggregatesSql,
  MONEY_RECONCILIATION_CHECKS,
  MoneyReconciliationContractError,
  parseLegBalanceRow,
  parseSettlementRow,
  reconciliationReportJson,
  runMoneyReconciliation,
  SETTLEMENT_LEG_SOURCE,
  SETTLEMENT_SOURCE,
  settlementAggregatesSql,
} from '../../src/modules/fin/index.js';
import type {
  MoneyReconciliationCheck,
  MoneyReconciliationReport,
} from '../../src/modules/fin/index.js';
import type { SqlClient } from '../../src/modules/bus/index.js';
import { countryCases } from '../support/countries.js';

const golden = loadGoldenVectors();
const uuid = (): string => randomUUID();

/**
 * Parcours (vecteurs dorés de 08) : la devise est celle des vecteurs, le pays celui que la
 * configuration associe à cette devise (jamais une constante du code, ADR-024).
 */
const JOURNEYS = [
  { a: 'T03', b: 'T05', capture: 'TJ01', variation: 'TJ02b', v2: 'TJ18a' },
  { a: 'T27', b: 'T41', capture: 'TJ08a', variation: 'TJ08b', v2: 'TJ18c' },
] as const;
type Journey = (typeof JOURNEYS)[number];

/** Fuseau du pays, lu dans les données de configuration (jamais une constante du code). */
const timeZoneOf = (country: string): string => {
  const data = JSON.parse(
    readFileSync(new URL('../../src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
  ) as { countries: { code: string; timeZone: string }[] };
  const tz = data.countries.find((c) => c.code === country)?.timeZone;
  if (tz === undefined) throw new Error(`fuseau inconnu : ${country}`);
  return tz;
};

const CASES = JOURNEYS.map((j) => {
  const currency = settlementVector(golden, j.a).trip.currency;
  const c = countryCases().find((x) => x.currency === currency);
  if (c === undefined) throw new Error(`aucun pays configuré en ${currency}`);
  return { country: c.country, currency, journey: j as Journey };
});

const sqlOf = (client: pg.ClientBase): SqlClient => ({
  query: async <R>(text: string, params?: readonly unknown[]) => {
    const r = await client.query(text, params as unknown[] | undefined);
    return { rows: r.rows as R[], rowCount: r.rowCount };
  },
});

async function asWorker(tx: pg.ClientBase, workerName: string): Promise<void> {
  await setSessionContext(tx, { kind: 'WORKER', workerName });
}

const recordOf = (id: string, previous?: SettlementRecord): SettlementRecord => {
  const v = settlementVector(golden, id);
  const trip = toTrip(v.trip);
  return buildSettlementRecord(trip, toEvent(v.event), testParams(trip.currency), previous);
};

async function insertTrip(
  tx: pg.ClientBase,
  c: { readonly country: string; readonly currency: string },
  day: number,
): Promise<string> {
  const id = uuid();
  const at = (d: number): string => new Date(Date.UTC(2033, 0, 1) + d * 86_400_000).toISOString();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    id,
    uuid(),
    uuid(),
    uuid(),
    c.country,
    c.currency,
    timeZoneOf(c.country),
    at(day),
    at(day + 2),
  ]);
  return id;
}

async function captureLegs(tx: pg.ClientBase, tripId: string, vector: string): Promise<void> {
  for (const [leg, captured] of Object.entries(legVector(golden, vector).legsMinor)) {
    await tx.query(
      `SELECT test_fixture.settlement_insert_leg_balance($1, 1, $2, $3::bigint, 0::bigint)`,
      [tripId, leg, captured.toString()],
    );
  }
}

async function record(
  tx: pg.ClientBase,
  tripId: string,
  rec: SettlementRecord,
  version: number,
  supersedesId: string | null = null,
): Promise<string> {
  await asWorker(tx, 'settlement');
  const id = uuid();
  await tx.query(`SELECT core.settlement_cmd_record($1, $2, 1, $3, $4, 0, $5::jsonb)`, [
    id,
    tripId,
    version,
    supersedesId,
    JSON.stringify(settlementRecordPayload(rec)),
  ]);
  return id;
}

interface Sums {
  readonly settlements: number;
  readonly balances: number;
  readonly totalPaid: bigint;
  readonly guestRefund: bigint;
  readonly variation: bigint;
}

/** Comptes et sommes par pays des lignes lues par le contrôle (mêmes requêtes que la tâche). */
async function sumsOf(tx: pg.ClientBase, country: string): Promise<Sums> {
  await asWorker(tx, 'reconciliation');
  const { rows } = await tx.query<{
    n: string;
    paid: string;
    refund: string;
    variation: string;
  }>(
    `SELECT pg_catalog.count(*)::text AS n,
            COALESCE(pg_catalog.sum(s.total_paid_minor), 0)::text AS paid,
            COALESCE(pg_catalog.sum(s.guest_refund_minor), 0)::text AS refund,
            COALESCE(pg_catalog.sum((SELECT pg_catalog.sum(l.variation_minor)
                                       FROM core.settlement_settlement_leg AS l
                                      WHERE l.settlement_id = s.id)), 0)::text AS variation
       FROM core.settlement_settlement AS s WHERE s.country_code = $1`,
    [country],
  );
  const b = await tx.query<{ n: string }>(
    `SELECT pg_catalog.count(*)::text AS n FROM core.settlement_trip_leg_balance
      WHERE country_code = $1`,
    [country],
  );
  const r = rows[0];
  if (r === undefined) throw new Error('aucune ligne');
  return {
    settlements: Number(r.n),
    balances: Number(b.rows[0]?.n ?? Number.NaN),
    totalPaid: BigInt(r.paid),
    guestRefund: BigInt(r.refund),
    variation: BigInt(r.variation),
  };
}

const qaReport: Record<string, unknown> = {};
function publish(key: string, value: unknown): void {
  qaReport[key] = value;
  const dir = process.env.RUEDA_QA_REPORT_DIR;
  if (dir === undefined || dir === '') return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'rapprochement.json'), `${JSON.stringify(qaReport, null, 2)}\n`);
}

describe('US-047 — parcours doré de règlement puis rapprochement, dans chaque pays configuré', () => {
  it('chaque pays configuré a son parcours (CLAUDE.md point 3 : deux devises, dont une sans décimale)', async () => {
    // L0-05 : même un test sans requête commence par l'assertion de rôle
    await withRole('app_worker', () => Promise.resolve());
    expect(CASES.map((c) => c.country).sort()).toEqual(
      countryCases()
        .map((c) => c.country)
        .sort(),
    );
    expect(new Set(CASES.map((c) => c.currency)).size).toBe(CASES.length);
  });

  it.each(CASES)(
    '$country ($currency) : v1, v1 + v2 ⇒ 0 écart ; le contrôle voit exactement le parcours',
    async (c) => {
      const j = c.journey;
      const a = settlementVector(golden, j.a);
      const b = settlementVector(golden, j.b);
      expect(a.trip.currency).toBe(c.currency);
      expect(b.trip.currency).toBe(c.currency);
      const v2Variation = legVector(golden, j.v2).totalMinor;

      await withRole('app_worker', (client) =>
        withTestTransaction(client, {}, async (tx) => {
          const before = await sumsOf(tx, c.country);

          const tripA = await insertTrip(tx, c, 0);
          await captureLegs(tx, tripA, j.capture);
          await record(tx, tripA, recordOf(j.a), 1);

          const tripB = await insertTrip(tx, c, 3);
          await captureLegs(tx, tripB, j.capture);
          const rb1 = recordOf(j.b);
          const vb1 = await record(tx, tripB, rb1, 1);
          const t08 = settlementVector(golden, 'T08');
          const rb2 = buildSettlementRecord(
            toTrip(b.trip),
            toEvent(t08.event),
            testParams(toTrip(b.trip).currency),
            rb1,
          );
          await record(tx, tripB, rb2, 2, vb1);

          // contrôles de rapprochement sur toute la base
          await asWorker(tx, 'reconciliation');
          const report: MoneyReconciliationReport = await runMoneyReconciliation(sqlOf(tx));
          const json = reconciliationReportJson(report);
          publish(`argent_${c.country}`, json);
          expect(json.violations, JSON.stringify(json.checks)).toBe('0');
          expect(Object.keys(report.checks)).toEqual([...MONEY_RECONCILIATION_CHECKS]);

          // ce que le contrôle a lu = le parcours (attendus : export des oracles, 08)
          const after = await sumsOf(tx, c.country);
          expect(after.settlements - before.settlements).toBe(3);
          expect(report.examined.settlements[c.country]).toBe(after.settlements);
          expect(after.balances - before.balances).toBe(8);
          expect(report.examined.legBalances[c.country]).toBe(after.balances);
          expect(after.totalPaid - before.totalPaid).toBe(
            a.trip.totalPaidMinor + 2n * b.trip.totalPaidMinor,
          );
          const refunds =
            a.expected.guestRefundMinor + b.expected.guestRefundMinor * 2n - v2Variation;
          expect(after.guestRefund - before.guestRefund).toBe(refunds);
          // Σ variations = − remboursement (v1) et − écart de remboursement (v2) : 08 E7 règle 3
          expect(after.variation - before.variation).toBe(
            -a.expected.guestRefundMinor - b.expected.guestRefundMinor + v2Variation,
          );

          // oracle C12 (17 §2.5) sur la même base : 0 écart
          await asWorker(tx, 'booking_oracle');
          const c12 = await tx.query<{ check_code: string; violations: string }>(
            `SELECT check_code, violations::text AS violations
               FROM core.booking_production_oracle()`,
          );
          publish(
            `c12_${c.country}`,
            Object.fromEntries(c12.rows.map((r) => [r.check_code, r.violations])),
          );
          expect(c12.rows).toHaveLength(5);
          for (const r of c12.rows) expect(r.violations, r.check_code).toBe('0');
        }),
      );
    },
  );

  it('sous un autre travailleur, le contrôle refuse de rendre des zéros trompeurs', async () => {
    await withRole('app_worker', (client) =>
      withTestTransaction(client, {}, async (tx) => {
        await asWorker(tx, 'settlement');
        await expect(runMoneyReconciliation(sqlOf(tx))).rejects.toThrow(
          MoneyReconciliationContractError,
        );
      }),
    );
  });

  it('sous app_api (personnel), le contrôle refuse aussi', async () => {
    await withRole('app_api', (client) =>
      withTestTransaction(client, {}, async (tx) => {
        await expect(runMoneyReconciliation(sqlOf(tx))).rejects.toThrow(
          MoneyReconciliationContractError,
        );
      }),
    );
  });
});

// --- Écart injecté (revues code et qa US-047) ---------------------------------------------------
// La base refuse d'écrire un règlement ou un solde en écart (contraintes, trigger différé, 0027) :
// on ajoute donc la ligne en écart aux SOURCES des requêtes d'agrégat (`UNION ALL`, paramètres
// liés), à côté des vraies tables, et on vérifie que l'agrégat SQL de la tâche la détecte, sur
// PostgreSQL réel, sous app_worker. La ligne de départ est la version 1 du vecteur de 08 (T03 en
// USD, T27 en PYG) : en-tête de l'export, jambes retenues = capture + variation (TJ01 + TJ02b,
// TJ08a + TJ08b ; 08 E7 règle 3).

const LEG_NAMES = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
type LegName = (typeof LEG_NAMES)[number];

interface InjectedSettlement {
  readonly version: number;
  readonly supersedesId: string | null;
  readonly totalPaid: bigint;
  readonly guestRefund: bigint;
  readonly retained: bigint;
  readonly retainedTax: bigint;
  readonly hostFromGuest: bigint;
  readonly legs: Partial<Record<LegName, { readonly kept: bigint; readonly variation: bigint }>>;
}

function v1FromVectors(j: Journey): InjectedSettlement {
  const v = settlementVector(golden, j.a);
  const capture = legVector(golden, j.capture);
  const variation = legVector(golden, j.variation);
  const legs = Object.fromEntries(
    LEG_NAMES.map((l) => [
      l,
      {
        kept: capture.legsMinor[l] + variation.legsMinor[l],
        variation: variation.legsMinor[l],
      },
    ]),
  ) as Record<LegName, { kept: bigint; variation: bigint }>;
  return {
    version: 1,
    supersedesId: null,
    totalPaid: v.trip.totalPaidMinor,
    guestRefund: v.expected.guestRefundMinor,
    retained: v.expected.retainedMinor,
    retainedTax: v.expected.retainedTaxMinor,
    hostFromGuest: v.expected.hostFromGuestMinor,
    legs,
  };
}

const keptOf = (s: InjectedSettlement, leg: LegName): bigint => s.legs[leg]?.kept ?? 0n;

const withLeg = (
  s: InjectedSettlement,
  leg: LegName,
  patch: Partial<{ kept: bigint; variation: bigint }>,
): InjectedSettlement => {
  const cur = s.legs[leg];
  if (cur === undefined) throw new Error(`jambe ${leg} absente`);
  return { ...s, legs: { ...s.legs, [leg]: { ...cur, ...patch } } };
};

const withoutLeg = (s: InjectedSettlement, leg: LegName): InjectedSettlement => ({
  ...s,
  legs: Object.fromEntries(Object.entries(s.legs).filter(([l]) => l !== leg)),
});

/** Rapport de la tâche sur les vraies tables PLUS une version (et un solde) injectés. */
async function reportWithInjected(
  tx: pg.ClientBase,
  country: string,
  s: InjectedSettlement,
  balance?: { readonly captured: bigint; readonly released: bigint },
): Promise<MoneyReconciliationReport> {
  await asWorker(tx, 'reconciliation');
  const params: unknown[] = [];
  const p = (value: unknown, type: string): string => {
    params.push(typeof value === 'bigint' ? value.toString() : value);
    return `$${String(params.length)}::${type}`;
  };
  const id = uuid();
  const header = [
    p(id, 'uuid'),
    p(uuid(), 'uuid'),
    '1',
    p(s.version, 'integer'),
    p(s.supersedesId, 'uuid'),
    p(country, 'text'),
    p(s.totalPaid, 'bigint'),
    p(s.guestRefund, 'bigint'),
    p(s.retained, 'bigint'),
    p(s.retainedTax, 'bigint'),
    p(s.hostFromGuest, 'bigint'),
  ];
  const settlements = `${SETTLEMENT_SOURCE}
    UNION ALL SELECT * FROM (VALUES (${header.join(', ')}))
      AS v(id, trip_id, segment_no, version, supersedes_id, country_code, total_paid_minor,
           guest_refund_minor, retained_minor, retained_tax_minor, host_from_guest_minor)`;
  const legRows = Object.entries(s.legs).map(([leg, l]) => {
    const row = [
      p(id, 'uuid'),
      p(leg, 'text'),
      p(l.kept, 'bigint'),
      '0::bigint',
      p(l.variation, 'bigint'),
    ];
    return `(${row.join(', ')})`;
  });
  const legs = `${SETTLEMENT_LEG_SOURCE}
    UNION ALL SELECT * FROM (VALUES ${legRows.join(', ')})
      AS v(settlement_id, leg, kept_minor, advance_minor, variation_minor)`;
  const settlementRows = await tx.query<Record<string, unknown>>(
    settlementAggregatesSql(settlements, legs),
    params,
  );
  const balanceParams =
    balance === undefined
      ? []
      : [country, balance.captured.toString(), balance.released.toString()];
  const balances =
    balance === undefined
      ? LEG_BALANCE_SOURCE
      : `${LEG_BALANCE_SOURCE}
    UNION ALL SELECT * FROM (VALUES ($1::text, $2::bigint, 0::bigint, 0::bigint, 0::bigint, $3::bigint))
      AS v(country_code, captured_minor, refunded_minor, reallocated_in_minor,
           reallocated_out_minor, released_minor)`;
  const balanceRows = await tx.query<Record<string, unknown>>(
    legBalanceAggregatesSql(balances),
    balanceParams,
  );
  return evaluateMoneyReconciliation(
    settlementRows.rows.map(parseSettlementRow),
    balanceRows.rows.map(parseLegBalanceRow),
  );
}

/** Une altération par contrôle ; chacune doit être détectée par SON contrôle, dans le bon pays. */
const INJECTIONS: readonly [
  string,
  MoneyReconciliationCheck,
  (s: InjectedSettlement) => InjectedSettlement,
][] = [
  [
    'Σ jambes = retenu TTC + 1',
    'SETTLEMENT_LEGS_SUM',
    (s) => withLeg(s, 'PLATFORM', { kept: keptOf(s, 'PLATFORM') + 1n }),
  ],
  ['jambe INSURER absente', 'SETTLEMENT_LEGS_INCOMPLETE', (s) => withoutLeg(s, 'INSURER')],
  [
    'HOST + 1, PLATFORM − 1 (somme intacte)',
    'SETTLEMENT_HOST_LEG',
    (s) =>
      withLeg(withLeg(s, 'HOST', { kept: keptOf(s, 'HOST') + 1n }), 'PLATFORM', {
        kept: keptOf(s, 'PLATFORM') - 1n,
      }),
  ],
  [
    'jambe TAX_THIRD_PARTY négative (PLATFORM compense)',
    'SETTLEMENT_LEG_NEGATIVE',
    (s) =>
      withLeg(withLeg(s, 'TAX_THIRD_PARTY', { kept: -1n }), 'PLATFORM', {
        kept: keptOf(s, 'PLATFORM') + 1n + keptOf(s, 'TAX_THIRD_PARTY'),
      }),
  ],
  ['total payé + 1', 'SETTLEMENT_REFUND_BALANCE', (s) => ({ ...s, totalPaid: s.totalPaid + 1n })],
  [
    'Σ variations ≠ − remboursement',
    'SETTLEMENT_VARIATIONS_REFUND',
    (s) => withLeg(s, 'PLATFORM', { variation: (s.legs.PLATFORM?.variation ?? 0n) + 1n }),
  ],
  [
    'version 2 qui remplace une version inexistante',
    'SETTLEMENT_VERSION_CHAIN',
    (s) => ({ ...s, version: 2, supersedesId: uuid() }),
  ],
];

describe('US-047 — un écart injecté est détecté par l’agrégat SQL (PostgreSQL réel, app_worker)', () => {
  it.each(CASES)('$country ($currency) : version de départ cohérente ⇒ 0 écart', async (c) => {
    await withRole('app_worker', (client) =>
      withTestTransaction(client, {}, async (tx) => {
        await asWorker(tx, 'reconciliation');
        const baseline = await runMoneyReconciliation(sqlOf(tx));
        expect(baseline.violations).toBe(0n);
        const r = await reportWithInjected(tx, c.country, v1FromVectors(c.journey), {
          captured: 10n,
          released: 10n,
        });
        expect(reconciliationReportJson(r).violations).toBe('0');
        expect(r.examined.settlements[c.country]).toBe(
          (baseline.examined.settlements[c.country] ?? 0) + 1,
        );
      }),
    );
  });

  for (const c of CASES) {
    it.each(INJECTIONS)(`${c.country} : %s ⇒ %s`, async (_label, check, corrupt) => {
      await withRole('app_worker', (client) =>
        withTestTransaction(client, {}, async (tx) => {
          const r = await reportWithInjected(tx, c.country, corrupt(v1FromVectors(c.journey)));
          expect(
            r.checks[check].byCountry[c.country],
            JSON.stringify(reconciliationReportJson(r)),
          ).toBe(1n);
          expect(r.violations).toBeGreaterThanOrEqual(1n);
        }),
      );
    });

    it(`${c.country} : solde de jambe à découvert (libéré > capturé) ⇒ LEG_BALANCE_OVERDRAWN`, async () => {
      await withRole('app_worker', (client) =>
        withTestTransaction(client, {}, async (tx) => {
          const captured = legVector(golden, c.journey.capture).legsMinor.HOST;
          const r = await reportWithInjected(tx, c.country, v1FromVectors(c.journey), {
            captured,
            released: captured + 1n,
          });
          expect(r.checks.LEG_BALANCE_OVERDRAWN.byCountry[c.country]).toBe(1n);
          expect(r.violations).toBe(1n);
        }),
      );
    });
  }
});
