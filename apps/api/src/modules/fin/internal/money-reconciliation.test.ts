/**
 * US-047 — contrôles de rapprochement de l'argent, sans base : chaque contrôle détecte son écart, en
 * USD (PA) et en PYG sans décimale (PY), sur des agrégats construits à partir des vecteurs de jambes
 * de l'export des oracles (`@rueda/money/golden-vectors`, US-016) : capture TJ01 / TJ08a, variation
 * TJ02b / TJ08b, retenu = capture + variation (08 E7 règle 3). Jamais du code testé. La preuve sur
 * PostgreSQL réel, sous app_worker, est dans apps/api/test/int/reconciliation.int.test.ts.
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { BusRegistry } from '../../bus/index.js';
import { CountryConfigService } from '../../cfg/index.js';
import type { AlertChannel, OpsAlert, SqlClient, SqlResult } from '../../bus/index.js';
import { assertSafeAlert } from '../../bus/index.js';
import {
  alertOnViolations,
  evaluateMoneyReconciliation,
  INSURER_LEDGER_FACTS_SQL,
  insurerLedgerViolations,
  LEG_BALANCE_AGGREGATES_SQL,
  legBalanceOverdrawn,
  MONEY_RECONCILIATION_CHECKS,
  MONEY_RECONCILIATION_PERIOD_SECONDS,
  MONEY_RECONCILIATION_WORKER,
  MoneyReconciliationContractError,
  parseInsurerLedgerFactRow,
  parseLegBalanceRow,
  parseSettlementRow,
  parseTripLegFactRow,
  reconciliationLogLine,
  RECONCILIATION_CONTEXT_SQL,
  registerMoneyReconciliation,
  runMoneyReconciliation,
  SETTLEMENT_AGGREGATES_SQL,
  settlementViolations,
  TRIP_LEG_FACTS_SQL,
  tripLegViolations,
} from './money-reconciliation.js';
import type {
  InsurerLedgerFact,
  LegBalanceAggregate,
  MoneyReconciliationCheck,
  SettlementAggregate,
  TripLegFact,
} from './money-reconciliation.js';

const golden = loadGoldenVectors();
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;

/**
 * Cas de test : un par vecteur de capture de l'export ; le pays est celui que la configuration
 * (module CFG) associe à la devise du vecteur, jamais une constante du code (ADR-024).
 */
const config = new CountryConfigService().config;
const countryOfCurrency = (currency: string): string => {
  const entry = [...config.countries.values()].find((e) => e.currency.code === currency);
  if (entry === undefined) throw new Error(`aucun pays configuré en ${currency}`);
  return entry.code;
};
const CASES = (
  [
    ['TJ01', 'TJ02b'],
    ['TJ08a', 'TJ08b'],
  ] as const
)
  .map(([capture, variation]) => ({
    country: countryOfCurrency(legVector(golden, capture).currency),
    capture,
    variation,
  }))
  .sort((a, b) => a.country.localeCompare(b.country));
const [FIRST, SECOND] = CASES as [(typeof CASES)[number], (typeof CASES)[number]];

function v1Of(c: (typeof CASES)[number]): SettlementAggregate {
  const capture = legVector(golden, c.capture);
  const variation = legVector(golden, c.variation);
  const kept = Object.fromEntries(
    LEGS.map((l) => [l, capture.legsMinor[l] + variation.legsMinor[l]]),
  ) as Record<(typeof LEGS)[number], bigint>;
  const retainedTtc = LEGS.reduce((a, l) => a + kept[l], 0n);
  return {
    country: c.country,
    version: 1,
    hasPrevious: false,
    previousVersion: null,
    previousSameTrip: null,
    previousRefund: null,
    totalPaid: capture.totalMinor,
    guestRefund: -variation.totalMinor,
    // la répartition retenu / taxe retenue n'entre que par sa somme dans ces contrôles
    retained: retainedTtc,
    retainedTax: 0n,
    hostFromGuest: kept.HOST,
    legs: [...LEGS],
    minKept: LEGS.reduce((m, l) => (kept[l] < m ? kept[l] : m), kept.HOST),
    minAdvance: 0n,
    signedSum: retainedTtc,
    variationSum: variation.totalMinor,
    hostKept: kept.HOST,
  };
}

function balanceOf(c: (typeof CASES)[number]): LegBalanceAggregate {
  const capture = legVector(golden, c.capture);
  return {
    country: c.country,
    captured: capture.legsMinor.HOST,
    refunded: -legVector(golden, c.variation).legsMinor.HOST,
    reallocatedIn: 0n,
    reallocatedOut: 0n,
    released: 0n,
  };
}

describe('US-047 — rapprochement de l’argent : agrégats cohérents', () => {
  it.each(CASES)('$country : version 1 tirée des vecteurs ⇒ aucun écart', (c) => {
    expect(settlementViolations(v1Of(c))).toEqual([]);
    expect(legBalanceOverdrawn(balanceOf(c))).toBe(false);
  });

  it('rapport vide : quatorze contrôles à 0, rien examiné', () => {
    const r = evaluateMoneyReconciliation([], []);
    expect(Object.keys(r.checks)).toEqual([...MONEY_RECONCILIATION_CHECKS]);
    // US-227 : trois contrôles de la jambe assureur s'ajoutent aux onze d'US-047 et d'US-217a
    expect(MONEY_RECONCILIATION_CHECKS).toHaveLength(14);
    expect(r.violations).toBe(0n);
    // US-217a : les faits par trip sont un troisième ensemble examiné ; US-227 : la jambe
    // assureur un quatrième, et les écritures sans contrat sont comptées à part (vides ici)
    expect(r.examined).toEqual({
      settlements: {},
      legBalances: {},
      trips: {},
      insurerTrips: {},
      insurerUnattributed: {},
    });
  });
});

/** Une altération par contrôle (chacune doit faire échouer son contrôle, et lui seul si possible). */
const CORRUPTIONS: readonly [
  string,
  (s: SettlementAggregate) => SettlementAggregate,
  readonly MoneyReconciliationCheck[],
][] = [
  [
    'jambe INSURER absente',
    (s) => ({ ...s, legs: ['HOST', 'TAX_THIRD_PARTY', 'PLATFORM'] }),
    ['SETTLEMENT_LEGS_INCOMPLETE'],
  ],
  [
    'jambe en double',
    (s) => ({ ...s, legs: ['HOST', 'HOST', 'TAX_THIRD_PARTY', 'PLATFORM'] }),
    ['SETTLEMENT_LEGS_INCOMPLETE'],
  ],
  ['jambe retenue négative', (s) => ({ ...s, minKept: -1n }), ['SETTLEMENT_LEG_NEGATIVE']],
  ['avance négative', (s) => ({ ...s, minAdvance: -1n }), ['SETTLEMENT_LEG_NEGATIVE']],
  [
    'Σ jambes ≠ retenu TTC (une unité mineure)',
    (s) => ({ ...s, signedSum: s.signedSum + 1n }),
    ['SETTLEMENT_LEGS_SUM'],
  ],
  [
    'HOST ≠ hostFromGuest',
    (s) => ({ ...s, hostKept: s.hostFromGuest - 1n }),
    ['SETTLEMENT_HOST_LEG'],
  ],
  ['jambe HOST absente du calcul', (s) => ({ ...s, hostKept: null }), ['SETTLEMENT_HOST_LEG']],
  [
    'remboursement + retenu ≠ total payé',
    (s) => ({ ...s, totalPaid: s.totalPaid + 1n }),
    ['SETTLEMENT_REFUND_BALANCE'],
  ],
  [
    'remboursement au-delà du payé',
    (s) => ({
      ...s,
      guestRefund: s.totalPaid + 1n,
      retained: -1n,
      signedSum: -1n,
      variationSum: -(s.totalPaid + 1n),
    }),
    ['SETTLEMENT_REFUND_BALANCE'],
  ],
  [
    'Σ variations ≠ − remboursement',
    (s) => ({ ...s, variationSum: s.variationSum - 1n }),
    ['SETTLEMENT_VARIATIONS_REFUND'],
  ],
  [
    'version 1 avec prédécesseur',
    (s) => ({ ...s, hasPrevious: true, previousVersion: 1, previousSameTrip: true }),
    ['SETTLEMENT_VERSION_CHAIN'],
  ],
];

describe('US-047 — chaque contrôle détecte son écart (chaque pays configuré)', () => {
  for (const c of CASES) {
    it.each(CORRUPTIONS)(`${c.country} : %s`, (_label, corrupt, expected) => {
      const bad = corrupt(v1Of(c));
      expect(settlementViolations(bad)).toEqual(expected);
      const r = evaluateMoneyReconciliation([v1Of(c), bad], []);
      for (const check of expected) {
        expect(r.checks[check]).toEqual({ total: 1n, byCountry: { [c.country]: 1n } });
      }
      expect(r.violations).toBe(BigInt(expected.length));
      expect(r.examined.settlements).toEqual({ [c.country]: 2 });
    });
  }

  it.each(CASES)('$country : jambe à découvert ⇒ LEG_BALANCE_OVERDRAWN', (c) => {
    const ok = balanceOf(c);
    const bad = { ...ok, released: ok.captured - ok.refunded + 1n };
    expect(legBalanceOverdrawn(bad)).toBe(true);
    // réaffectation entrante : couvre exactement le surplus
    expect(legBalanceOverdrawn({ ...bad, reallocatedIn: 1n })).toBe(false);
    const r = evaluateMoneyReconciliation([], [ok, bad]);
    expect(r.checks.LEG_BALANCE_OVERDRAWN).toEqual({ total: 1n, byCountry: { [c.country]: 1n } });
    expect(r.examined.legBalances).toEqual({ [c.country]: 2 });
  });
});

describe('US-047 — versions n+1 (08 E4) : chaîne et écart de remboursement', () => {
  const c = FIRST;
  const v2 = (s: SettlementAggregate, refundDelta: bigint): SettlementAggregate => ({
    ...s,
    version: 2,
    hasPrevious: true,
    previousVersion: 1,
    previousSameTrip: true,
    previousRefund: s.guestRefund,
    guestRefund: s.guestRefund + refundDelta,
    retained: s.retained - refundDelta,
    signedSum: s.signedSum - refundDelta,
    variationSum: -refundDelta,
  });

  it('v2 cohérente : variation = − écart de remboursement depuis v1', () => {
    expect(settlementViolations(v2(v1Of(c), 100n))).toEqual([]);
    expect(settlementViolations(v2(v1Of(c), 0n))).toEqual([]);
  });

  it('v2 dont la variation reprend tout le remboursement (au lieu de l’écart) ⇒ écart', () => {
    const s = v2(v1Of(c), 100n);
    expect(settlementViolations({ ...s, variationSum: -s.guestRefund })).toEqual([
      'SETTLEMENT_VARIATIONS_REFUND',
    ]);
  });

  it.each([
    ['sans prédécesseur', { hasPrevious: false, previousVersion: null, previousRefund: null }],
    ['remplace la version 2 au lieu de 1', { previousVersion: 2 }],
    ['remplace la version d’un autre trip', { previousSameTrip: false }],
    ['prédécesseur illisible', { previousVersion: null, previousRefund: null }],
  ] as const)('v2 %s ⇒ SETTLEMENT_VERSION_CHAIN', (_l, patch) => {
    const s = { ...v2(v1Of(c), 100n), ...patch };
    expect(settlementViolations(s)).toContain('SETTLEMENT_VERSION_CHAIN');
  });
});

describe('US-047 — lecture des lignes : fail-closed', () => {
  const row = {
    country: FIRST.country,
    version: 1,
    has_previous: false,
    previous_version: null,
    previous_same_trip: null,
    previous_refund: null,
    total_paid: '19345',
    guest_refund: '13845',
    retained: '5500',
    retained_tax: '0',
    host_from_guest: '0',
    legs: ['HOST', 'INSURER', 'PLATFORM', 'TAX_THIRD_PARTY'],
    min_kept: '0',
    min_advance: '0',
    signed_sum: '5500',
    variation_sum: '-13845',
    host_kept: '0',
  };

  it('ligne bien formée : montants en bigint exacts, au-delà de 2^53', () => {
    const big = '9223372036854775807';
    const s = parseSettlementRow({ ...row, total_paid: big });
    expect(s.totalPaid).toBe(9_223_372_036_854_775_807n);
    expect(s.legs).toHaveLength(4);
  });

  it.each([
    ['montant en nombre JavaScript', { total_paid: 19345 }],
    ['montant décimal', { guest_refund: '1.5' }],
    ['pays absent', { country: null }],
    ['pays mal formé', { country: 'pan' }],
    ['version nulle', { version: 0 }],
    ['jambes en texte', { legs: '{HOST}' }],
    ['booléen en texte', { has_previous: 'false' }],
  ] as const)('%s ⇒ erreur de contrat', (_l, patch) => {
    expect(() => parseSettlementRow({ ...row, ...patch })).toThrow(
      MoneyReconciliationContractError,
    );
  });

  it('solde : montant illisible ⇒ erreur de contrat', () => {
    const b = {
      country: SECOND.country,
      captured: '1',
      refunded: '0',
      reallocated_in: '0',
      reallocated_out: '0',
      released: '0',
    };
    expect(parseLegBalanceRow(b).captured).toBe(1n);
    expect(() => parseLegBalanceRow({ ...b, released: undefined })).toThrow(
      MoneyReconciliationContractError,
    );
  });
});

/**
 * US-217a (ADR-161) — faits de l'invariant par jambe d'un trip : trip capturé (TJ01 / TJ08a, sans
 * règlement) et trip réglé (version 1 : jambe HOST retenue = capture + variation TJ02b / TJ08b).
 */
function capturedFactOf(c: (typeof CASES)[number]): TripLegFact {
  const capture = legVector(golden, c.capture);
  return {
    country: c.country,
    captured: capture.totalMinor,
    collected: capture.totalMinor,
    collectedLegs: LEGS.reduce((a, l) => a + capture.legsMinor[l], 0n),
    headTotalPaid: null,
    expectedHost: capture.legsMinor.HOST,
    statementHost: capture.legsMinor.HOST,
  };
}
function settledFactOf(c: (typeof CASES)[number]): TripLegFact {
  const kept = v1Of(c).hostKept;
  return {
    ...capturedFactOf(c),
    headTotalPaid: legVector(golden, c.capture).totalMinor,
    expectedHost: kept,
    statementHost: kept,
  };
}

const TRIP_CORRUPTIONS: readonly [
  string,
  (f: TripLegFact) => TripLegFact,
  readonly MoneyReconciliationCheck[],
][] = [
  [
    'Σ capturé des soldes ≠ Σ des encaissements (une unité mineure)',
    (f) => ({ ...f, captured: f.captured + 1n }),
    ['TRIP_CAPTURE_LEGS'],
  ],
  [
    'Σ des jambes de l’encaissement ≠ son montant',
    (f) => ({ ...f, collectedLegs: (f.collectedLegs ?? 0n) - 1n }),
    ['TRIP_CAPTURE_LEGS'],
  ],
  [
    'total payé de la version en tête ≠ encaissé',
    (f) => ({ ...f, headTotalPaid: (f.headTotalPaid ?? 0n) + 1n }),
    ['TRIP_SETTLED_TOTAL'],
  ],
  [
    'jambe HOST du relevé ≠ jambe HOST attendue (une unité mineure)',
    (f) => ({ ...f, statementHost: (f.statementHost ?? 0n) + 1n }),
    ['STATEMENT_HOST_LEG'],
  ],
  ['jambe HOST absente du relevé', (f) => ({ ...f, statementHost: null }), ['STATEMENT_HOST_LEG']],
  ['jambe HOST attendue absente', (f) => ({ ...f, expectedHost: null }), ['STATEMENT_HOST_LEG']],
];

describe('US-217a — invariant par jambe : chaque contrôle détecte son écart (chaque pays configuré)', () => {
  it.each(CASES)('$country : trip capturé et trip réglé tirés des vecteurs ⇒ aucun écart', (c) => {
    expect(tripLegViolations(capturedFactOf(c))).toEqual([]);
    expect(tripLegViolations(settledFactOf(c))).toEqual([]);
    const r = evaluateMoneyReconciliation([], [], [capturedFactOf(c), settledFactOf(c)]);
    expect(r.violations).toBe(0n);
    expect(r.examined.trips).toEqual({ [c.country]: 2 });
  });

  for (const c of CASES) {
    it.each(TRIP_CORRUPTIONS)(`${c.country} : %s`, (_label, corrupt, expected) => {
      const bad = corrupt(settledFactOf(c));
      expect(tripLegViolations(bad)).toEqual(expected);
      const r = evaluateMoneyReconciliation([], [], [settledFactOf(c), bad]);
      for (const check of expected) {
        expect(r.checks[check]).toEqual({ total: 1n, byCountry: { [c.country]: 1n } });
      }
      expect(r.violations).toBe(BigInt(expected.length));
    });
  }

  it.each(CASES)(
    '$country : solde posé sans encaissement porté ⇒ seule la jambe HOST est comparée',
    (c) => {
      const f = { ...settledFactOf(c), collected: null, collectedLegs: null, captured: 0n };
      expect(tripLegViolations(f)).toEqual([]);
      expect(tripLegViolations({ ...f, statementHost: (f.statementHost ?? 0n) + 1n })).toEqual([
        'STATEMENT_HOST_LEG',
      ]);
    },
  );

  it('lecture fail-closed : montant illisible ou pays invalide ⇒ erreur de contrat', () => {
    const row = {
      country: FIRST.country,
      captured: '25666',
      collected: '25666',
      collected_legs: '25666',
      head_total_paid: null,
      expected_host: '13125',
      statement_host: '13125',
    };
    expect(parseTripLegFactRow(row)).toEqual({
      country: FIRST.country,
      captured: 25666n,
      collected: 25666n,
      collectedLegs: 25666n,
      headTotalPaid: null,
      expectedHost: 13125n,
      statementHost: 13125n,
    });
    for (const bad of [
      { ...row, captured: 25666 },
      { ...row, statement_host: '1.5' },
      { ...row, country: FIRST.country.toLowerCase() },
      { ...row, captured: null },
    ]) {
      expect(() => parseTripLegFactRow(bad)).toThrow(MoneyReconciliationContractError);
    }
  });
});

/**
 * Jambe assureur d'un trip (US-227) tirée des vecteurs : capture TJ01 / TJ08a (jambe INSURER de
 * l'encaissement porté), variation TJ02b / TJ08b de la version 1 ; prime due = capture + variation.
 */
function insurerFactOf(c: (typeof CASES)[number]): InsurerLedgerFact {
  const collected = legVector(golden, c.capture).legsMinor.INSURER;
  const varied = legVector(golden, c.variation).legsMinor.INSURER;
  return {
    country: c.country,
    collectedEntries: collected,
    collectedLegs: collected,
    settledEntries: varied,
    settledVariations: varied,
    billed: 0n,
    due: collected + varied,
    unattributed: false,
  };
}

/** Trip terminé sans règlement, porté en entier par un bordereau émis. */
function billedFactOf(c: (typeof CASES)[number]): InsurerLedgerFact {
  const collected = legVector(golden, c.capture).legsMinor.INSURER;
  return {
    ...insurerFactOf(c),
    settledEntries: 0n,
    settledVariations: 0n,
    billed: collected,
    due: collected,
  };
}

const INSURER_CORRUPTIONS: readonly [
  string,
  (f: InsurerLedgerFact) => InsurerLedgerFact,
  readonly MoneyReconciliationCheck[],
][] = [
  [
    'écriture d’encaissement ≠ jambe INSURER portée (une unité mineure)',
    (f) => ({ ...f, collectedEntries: f.collectedEntries + 1n }),
    ['INSURER_LEDGER_COLLECTION'],
  ],
  [
    'variation INSURER stockée sans son écriture de règlement (une unité mineure)',
    (f) => ({ ...f, settledVariations: f.settledVariations - 1n }),
    ['INSURER_LEDGER_SETTLEMENT'],
  ],
  [
    'bordereau émis au-delà de la prime due (une unité mineure)',
    (f) => ({ ...f, billed: f.due + 1n }),
    ['INSURER_BORDEREAU_OVERBILLED'],
  ],
];

describe('US-227 — jambe assureur : le registre est le miroir des jambes INSURER stockées (chaque pays configuré)', () => {
  it.each(CASES)(
    '$country : trip annulé (TJ02b / TJ08b) et trip porté par un bordereau ⇒ aucun écart',
    (c) => {
      expect(insurerFactOf(c).due).toBe(0n);
      expect(insurerLedgerViolations(insurerFactOf(c))).toEqual([]);
      expect(insurerLedgerViolations(billedFactOf(c))).toEqual([]);
      const r = evaluateMoneyReconciliation([], [], [], [insurerFactOf(c), billedFactOf(c)]);
      expect(r.violations).toBe(0n);
      expect(r.examined.insurerTrips).toEqual({ [c.country]: 2 });
      expect(r.examined.insurerUnattributed).toEqual({});
    },
  );

  for (const c of CASES) {
    it.each(INSURER_CORRUPTIONS)(`${c.country} : %s`, (_label, corrupt, expected) => {
      const bad = corrupt(billedFactOf(c));
      expect(insurerLedgerViolations(bad)).toEqual(expected);
      const r = evaluateMoneyReconciliation([], [], [], [billedFactOf(c), bad]);
      for (const check of expected) {
        expect(r.checks[check]).toEqual({ total: 1n, byCountry: { [c.country]: 1n } });
      }
      expect(r.violations).toBe(BigInt(expected.length));
    });
  }

  it.each(CASES)('$country : écriture sans contrat d’assureur ⇒ comptée, pas un écart', (c) => {
    const r = evaluateMoneyReconciliation(
      [],
      [],
      [],
      [{ ...insurerFactOf(c), unattributed: true }],
    );
    expect(r.violations).toBe(0n);
    expect(r.examined.insurerUnattributed).toEqual({ [c.country]: 1 });
  });

  it('lecture fail-closed : montant illisible, booléen ou pays invalide ⇒ erreur de contrat', () => {
    const row = {
      country: FIRST.country,
      collected_entries: '2550',
      collected_legs: '2550',
      settled_entries: '-2550',
      settled_variations: '-2550',
      billed: '0',
      due: '0',
      unattributed: false,
    };
    expect(parseInsurerLedgerFactRow(row)).toEqual({
      country: FIRST.country,
      collectedEntries: 2550n,
      collectedLegs: 2550n,
      settledEntries: -2550n,
      settledVariations: -2550n,
      billed: 0n,
      due: 0n,
      unattributed: false,
    });
    for (const bad of [
      { ...row, collected_entries: 2550 },
      { ...row, due: '1.5' },
      { ...row, unattributed: 'false' },
      { ...row, country: FIRST.country.toLowerCase() },
      { ...row, billed: null },
    ]) {
      expect(() => parseInsurerLedgerFactRow(bad)).toThrow(MoneyReconciliationContractError);
    }
  });
});

/** Transaction programmée : contexte, puis lignes de règlement et de solde. */
class ScriptedSql implements SqlClient {
  readonly texts: string[] = [];
  constructor(
    private readonly context: Record<string, unknown>,
    private readonly settlements: Record<string, unknown>[] = [],
    private readonly balances: Record<string, unknown>[] = [],
  ) {}
  query<R>(text: string): Promise<SqlResult<R>> {
    this.texts.push(text);
    const rows =
      text === RECONCILIATION_CONTEXT_SQL
        ? [this.context]
        : text === SETTLEMENT_AGGREGATES_SQL
          ? this.settlements
          : text === LEG_BALANCE_AGGREGATES_SQL
            ? this.balances
            : [];
    return Promise.resolve({ rows: rows as R[], rowCount: rows.length });
  }
}

class RecordingChannel implements AlertChannel {
  readonly sent: OpsAlert[] = [];
  send(alert: OpsAlert): Promise<void> {
    assertSafeAlert(alert);
    this.sent.push(alert);
    return Promise.resolve();
  }
}

describe('US-047 — tâche du travailleur reconciliation', () => {
  const ctx = { actor_kind: 'WORKER', worker_name: MONEY_RECONCILIATION_WORKER };

  it('contexte vérifié avant toute lecture ; un autre travailleur ⇒ erreur, aucune lecture', async () => {
    for (const bad of [
      { actor_kind: 'WORKER', worker_name: 'settlement' },
      { actor_kind: 'STAFF', worker_name: MONEY_RECONCILIATION_WORKER },
      { actor_kind: null, worker_name: null },
    ]) {
      const sql = new ScriptedSql(bad);
      await expect(runMoneyReconciliation(sql)).rejects.toThrow(MoneyReconciliationContractError);
      expect(sql.texts).toEqual([RECONCILIATION_CONTEXT_SQL]);
    }
  });

  it('écart ⇒ une alerte P1 par pays, comptes seulement (assertSafeAlert) ; journal sans identifiant', async () => {
    const pa = v1Of(FIRST);
    const py = v1Of(SECOND);
    const r = evaluateMoneyReconciliation(
      [pa, { ...pa, signedSum: pa.signedSum + 1n }, { ...py, variationSum: 0n }],
      [{ ...balanceOf(SECOND), released: 10n ** 12n }],
    );
    const channel = new RecordingChannel();
    expect(await alertOnViolations(r, channel)).toBe(2);
    expect(channel.sent).toEqual([
      {
        code: 'FIN_MONEY_RECONCILIATION',
        severity: 'P1',
        counts: { settlement_legs_sum: 1 },
        labels: { country: FIRST.country },
      },
      {
        code: 'FIN_MONEY_RECONCILIATION',
        severity: 'P1',
        counts: { settlement_variations_refund: 1, leg_balance_overdrawn: 1 },
        labels: { country: SECOND.country },
      },
    ]);
    const line = JSON.parse(reconciliationLogLine(r)) as Record<string, unknown>;
    expect(line.level).toBe('error');
    expect(line.violations).toBe('3');
    expect(reconciliationLogLine(r)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('aucun écart ⇒ aucune alerte, journal « info »', async () => {
    const channel = new RecordingChannel();
    const r = evaluateMoneyReconciliation([v1Of(FIRST)], []);
    expect(await alertOnViolations(r, channel)).toBe(0);
    expect(JSON.parse(reconciliationLogLine(r))).toMatchObject({ level: 'info', violations: '0' });
  });

  it('déclarée au registre (file reconciliation, 24 h) ; une passe lit, journalise, alerte', async () => {
    const registry = new BusRegistry();
    const lines: string[] = [];
    const channel = new RecordingChannel();
    registerMoneyReconciliation(registry, channel, (l) => lines.push(l));
    const task = registry.periodicTasks().find((t) => t.name === MONEY_RECONCILIATION_WORKER);
    expect(task?.spec.periodSeconds).toBe(MONEY_RECONCILIATION_PERIOD_SECONDS);
    expect(MONEY_RECONCILIATION_PERIOD_SECONDS).toBe(86_400);
    expect(registry.queueNames()).toEqual([MONEY_RECONCILIATION_WORKER]);
    const handler = registry.handlerOf(MONEY_RECONCILIATION_WORKER);
    if (handler?.kind !== 'timer') throw new Error('minuterie attendue');
    const pa = v1Of(FIRST);
    const settlementRow = {
      country: pa.country,
      version: 1,
      has_previous: false,
      previous_version: null,
      previous_same_trip: null,
      previous_refund: null,
      total_paid: pa.totalPaid.toString(),
      guest_refund: pa.guestRefund.toString(),
      retained: pa.retained.toString(),
      retained_tax: '0',
      host_from_guest: pa.hostFromGuest.toString(),
      legs: [...pa.legs],
      min_kept: String(pa.minKept),
      min_advance: '0',
      // une unité mineure de trop sur la somme des jambes
      signed_sum: (pa.signedSum + 1n).toString(),
      variation_sum: pa.variationSum.toString(),
      host_kept: String(pa.hostKept),
    };
    const sql = new ScriptedSql(ctx, [settlementRow]);
    await handler.handle({}, sql);
    expect(sql.texts).toEqual([
      RECONCILIATION_CONTEXT_SQL,
      SETTLEMENT_AGGREGATES_SQL,
      LEG_BALANCE_AGGREGATES_SQL,
      TRIP_LEG_FACTS_SQL,
      INSURER_LEDGER_FACTS_SQL,
    ]);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ level: 'error', violations: '1' });
    expect(channel.sent).toEqual([
      {
        code: 'FIN_MONEY_RECONCILIATION',
        severity: 'P1',
        counts: { settlement_legs_sum: 1 },
        labels: { country: FIRST.country },
      },
    ]);
  });

  it('les requêtes ne lisent ni horloge ni identifiant rendu (lecture seule)', () => {
    for (const q of [
      SETTLEMENT_AGGREGATES_SQL,
      LEG_BALANCE_AGGREGATES_SQL,
      TRIP_LEG_FACTS_SQL,
      INSURER_LEDGER_FACTS_SQL,
    ]) {
      expect(q).not.toMatch(/\b(now|current_timestamp|clock_timestamp)\b/i);
      expect(q).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/);
      // seules colonnes rendues : pays, versions, drapeaux et montants
      expect(q).not.toMatch(/\bAS (id|trip_id|org_id|settlement_id)\b/);
    }
  });
});
