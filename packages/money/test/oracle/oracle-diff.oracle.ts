/**
 * US-042 — comparaison différentielle du moteur aux oracles Python de 08 (critère 1 de 19).
 *
 * 1. fast-check génère les **entrées** (graine fixe ou `RUEDA_MONEY_ORACLE_SEED`) : USD et PYG,
 *    tarifs remboursable et non remboursable, promos plateforme et hôte, 1 ou 2 groupes fiscaux
 *    (dont « pour compte de tiers »), parts hôte et assureur, motifs bêta, instants aux bornes.
 * 2. `oracle_driver.py` les évalue par les oracles de `docs/specs/tools/`
 *    (`independent_settlement_check.py`, `check_legs.py`), lancés par `python -I -X utf8`.
 * 3. Le moteur est comparé champ par champ : 0 écart et 0 violation d'invariant attendus.
 *
 * Aucun attendu n'est calculé ici avec le code testé : la taxe payée et le total payé du trip
 * viennent eux aussi de l'oracle (`mk_trip`, taxe par ligne puis sommée).
 *
 * Domaine (limites écrites dans le README et l'ADR-076) :
 * - motifs bêta seulement (`BETA_CANCELLATION_REASONS`) ; fins anticipées et encaissements
 *   partiels n'ont pas encore de moteur TypeScript (le moteur complet est US-518, l'encaissement
 *   US-223 / US-224) ;
 * - un no-show du voyageur est demandé dans la fenêtre de déclaration `[noShowAt ; T + 72 h]`
 *   (BR-CXL-08) : l'oracle VERIF_09 ne modélise ni le refus `REJECTED_TOO_EARLY` ni la fin de
 *   fenêtre, couverts par les vecteurs dorés (T06, T39) et par `test/settlement/properties.test.ts` ;
 * - promos dans le domaine du fuzz de l'oracle (PP ≥ −P/5, PH ≥ −P/10) et part hôte ≥ ½ : la part
 *   hôte brute y reste ≥ 0, le plancher T63 n'est pas exercé ici (vecteur doré T63).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BETA_CANCELLATION_REASONS,
  LEGS,
  SETTLEMENT_LINES,
  allocHost,
  buildSettlementRecord,
  computeCancellationSettlement,
  money,
  ratio,
  roundHalfUp,
  settlementDelta,
  type CancellationEvent,
  type CancellationSettlement,
  type Currency,
  type Legs,
  type SettlementLine,
  type SettlementParams,
  type SettlementRecord,
  type SettlementTrip,
} from '../../src/index.ts';
import { COUNTRY_VARIANTS } from '../fixtures.ts';
import { T0_MS, at } from '../settlement/adapter.ts';

const DRIVER = fileURLToPath(new URL('./oracle_driver.py', import.meta.url));
/** Oracles lus par le pilote : leur contenu entre dans la clé du cache. */
const ORACLE_FILES = [
  DRIVER,
  fileURLToPath(
    new URL('../../../../docs/specs/tools/independent_settlement_check.py', import.meta.url),
  ),
  fileURLToPath(new URL('../../../../docs/specs/tools/check_legs.py', import.meta.url)),
  fileURLToPath(new URL('../../../../docs/specs/08_BUSINESS_RULES.md', import.meta.url)),
];
/**
 * Cache facultatif des attendus (`RUEDA_MONEY_ORACLE_CACHE`, répertoire) : la mutation rejoue ce
 * test pour chaque mutant ; les attendus ne dépendent que des cas et des oracles, jamais du code
 * muté, donc l'oracle n'est lancé qu'une fois par jeu de cas.
 */
const CACHE_DIR = process.env['RUEDA_MONEY_ORACLE_CACHE'];
const PYTHON = process.env['RUEDA_PYTHON'] ?? 'python';
const RUNS = positiveInteger('RUEDA_MONEY_ORACLE_RUNS', 10_000);
const PRIMITIVE_RUNS = positiveInteger('RUEDA_MONEY_ORACLE_PRIMITIVE_RUNS', 5_000);
const SEED = integer('RUEDA_MONEY_ORACLE_SEED', 20_261_103);

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} : entier attendu, reçu « ${raw} »`);
  return value;
}
function positiveInteger(name: string, fallback: number): number {
  const value = integer(name, fallback);
  if (value < 1) throw new Error(`${name} : entier ≥ 1 attendu`);
  return value;
}

/** Lignes de l'oracle (08 `LINES`) ; `youngDriver` n'y figure pas et reste absent (= 0). */
const ORACLE_LINES = SETTLEMENT_LINES.filter((l) => l !== 'youngDriver');
type OracleLine = (typeof ORACLE_LINES)[number];

const HOUR = 60;
const DAY = 24 * HOUR;

// ----------------------------------------------------------------------------- générateurs

/** Fraction dans [lo ; 1] (dénominateurs 2, 4, 10, 100, 10 000 ou quelconque ≤ 10^6). */
function shareArb(minNumOverDen: [bigint, bigint]) {
  return fc
    .oneof(fc.constantFrom(2n, 4n, 10n, 100n, 10_000n), fc.bigInt({ min: 1n, max: 1_000_000n }))
    .chain((den) => {
      const lo = (minNumOverDen[0] * den + minNumOverDen[1] - 1n) / minNumOverDen[1];
      return fc.tuple(fc.bigInt({ min: lo, max: den }), fc.constant(den));
    });
}

/** Montant ≥ 0 : petits montants (demi-unités, centimes impairs) ou montants de trip réalistes. */
const amountArb = fc.oneof(
  fc.bigInt({ min: 0n, max: 1_000n }),
  fc.bigInt({ min: 0n, max: 10_000_000n }),
  fc.bigInt({ min: 0n, max: 10_000_000_000n }),
);

const taxRateArb = fc.oneof(
  fc.constantFrom<[bigint, bigint]>([7n, 100n], [1n, 10n], [5n, 100n], [0n, 1n]),
  fc.tuple(fc.bigInt({ min: 0n, max: 3_000n }), fc.constant(10_000n)),
);

const groupsArb = fc
  .array(
    fc.record({
      // Une promo réduit l'assiette de P (08 BR-PRICE-16) : elle est taxée avec P, jamais seule.
      lines: fc
        .subarray([...ORACLE_LINES.filter((l) => l !== 'promoPlatform' && l !== 'promoHost')], {
          minLength: 1,
        })
        .map((ls): OracleLine[] =>
          ls.includes('tripPrice') ? [...ls, 'promoPlatform', 'promoHost'] : ls,
        ),
      rate: taxRateArb,
      thirdParty: fc.boolean(),
    }),
    { minLength: 1, maxLength: 2 },
  )
  .map((gs) => gs.map((g, i) => ({ id: i === 0 ? 'g' : 'tiers', ...g })));

const rawEventArb = fc.record({
  reason: fc.constantFrom(...BETA_CANCELLATION_REASONS),
  offset: fc.integer({ min: 0, max: 1_000_000 }),
  boundary: fc.integer({ min: 0, max: 9 }),
  flags: fc.tuple(fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean()),
});
type RawEvent = typeof rawEventArb extends fc.Arbitrary<infer T> ? T : never;

/** Instant de la demande : borne de 08 (± 1 min) ou point quelconque de [réservation ; T + 72 h]. */
function toCaseEvent(e: RawEvent, bookedMinutes: number) {
  const booked = -bookedMinutes;
  const lastMinute = bookedMinutes < 25 * HOUR;
  const freeUntil = lastMinute ? Math.min(booked + 60, 0) : -24 * HOUR;
  const bounds = [freeUntil, freeUntil + 1, booked + DAY, booked + DAY + 1, -24 * HOUR, 60, 59];
  let requested =
    e.boundary < bounds.length ? bounds[e.boundary]! : booked + (e.offset % (72 * HOUR - booked));
  requested = Math.max(booked, Math.min(requested, 72 * HOUR));
  if (e.reason === 'GUEST_NO_SHOW') {
    // fenêtre de déclaration [noShowAt ; T + 72 h] (BR-CXL-08)
    requested = 60 + (e.offset % (72 * HOUR - 60 + 1));
  }
  const [evidence, checkin, traced, reported, approved] = e.flags;
  return {
    reason: e.reason as string,
    requestedMinutes: requested,
    evidenceValidated: evidence,
    checkinValidated: checkin,
    hostMessageTraced: traced,
    hostNoShowReportedBefore: reported,
    additionalDriverApproved: approved,
  };
}
type CaseEvent = ReturnType<typeof toCaseEvent>;

const settlementCaseArb = fc
  .record({
    variant: fc.constantFrom(...COUNTRY_VARIANTS.map((v) => v.country)),
    days: fc.oneof(fc.constantFrom(1, 2, 3, 4, 7, 30), fc.integer({ min: 1, max: 30 })),
    rate: fc.constantFrom('R', 'NR'),
    bookedMinutes: fc.oneof(
      fc.integer({ min: 1, max: 20 * DAY }),
      fc.integer({ min: 1, max: 25 * HOUR }), // dernière minute (BR-CXL-01)
      fc.constantFrom(25 * HOUR, 25 * HOUR - 1, 25 * HOUR + 1, 24 * HOUR, 30),
    ),
    p: amountArb,
    ppFifths: fc.bigInt({ min: 0n, max: 1_000_000n }),
    phTenths: fc.bigInt({ min: 0n, max: 1_000_000n }),
    f: amountArb,
    pr: amountArb,
    x: amountArb,
    r: amountArb,
    ad: amountArb,
    d: amountArb,
    groups: groupsArb,
    share: shareArb([1n, 2n]),
    insurerPremiumShare: shareArb([0n, 1n]),
    insurerRoadsideShare: shareArb([0n, 1n]),
    event: rawEventArb,
    event2: fc.option(rawEventArb, { freq: 2 }),
  })
  .map((c) => {
    const booked = -c.bookedMinutes;
    // Domaine du fuzz de l'oracle : PP ≥ −P/5, PH ≥ −P/10.
    const pp = -((c.p / 5n) * c.ppFifths) / 1_000_000n;
    const ph = -((c.p / 10n) * c.phTenths) / 1_000_000n;
    const lines: Record<OracleLine, bigint> = {
      tripPrice: c.p,
      promoPlatform: pp,
      promoHost: ph,
      tripFee: c.f,
      protection: c.pr,
      extras: c.x,
      enhancedRoadside: c.r,
      additionalDriver: c.ad,
      delivery: c.d,
    };
    return {
      kind: 'settlement' as const,
      variant: c.variant,
      currency: currencyOf(c.variant).code,
      days: c.days,
      rate: c.rate,
      bookedMinutes: booked,
      lines,
      groups: c.groups,
      share: c.share,
      insurerPremiumShare: c.insurerPremiumShare,
      insurerRoadsideShare: c.insurerRoadsideShare,
      event: toCaseEvent(c.event, c.bookedMinutes),
      event2: c.event2 === null ? null : toCaseEvent(c.event2, c.bookedMinutes),
    };
  });
type SettlementCase = typeof settlementCaseArb extends fc.Arbitrary<infer T> ? T : never;

const anyRatioArb = fc.tuple(
  fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }),
  fc.oneof(fc.constantFrom(1n, 2n, 3n, 4n, 100n), fc.bigInt({ min: 1n, max: 10n ** 12n })),
);
const rhuCaseArb = anyRatioArb.map((r) => ({ kind: 'rhu' as const, ratio: r }));
const allocCaseArb = fc
  .tuple(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), shareArb([0n, 1n]))
  .map(([amount, r]) => ({ kind: 'alloc' as const, amount, ratio: r }));

// ----------------------------------------------------------------------------- oracle

interface OracleSettlement extends OracleEvaluation {
  taxPaid: Record<string, string>;
  totalPaid: string;
  penaltyScheduleMajor: [string, string, string, string];
  captureLegs: Record<string, string>;
  second?: OracleEvaluation;
}
interface OracleEvaluation {
  reason: string;
  guestRefund: string;
  taxRefund: string;
  hostEarnings: string;
  hostFromGuest: string;
  hostCompensation: string;
  platformNet: string;
  retained: string;
  retainedTax: string;
  hostPenaltyMajor: string;
  refundByLine: Record<OracleLine, string>;
  taxRefundByGroup: Record<string, string>;
  settledLegs: Record<string, string>;
  legVariation: Record<string, string>;
}

function runOracle(cases: readonly unknown[]): unknown[] {
  const input = JSON.stringify(cases, (_k, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
  let cached: string | undefined;
  if (CACHE_DIR !== undefined && CACHE_DIR !== '') {
    const key = createHash('sha256').update(input);
    for (const f of ORACLE_FILES) key.update('\0').update(readFileSync(f));
    mkdirSync(CACHE_DIR, { recursive: true });
    cached = join(CACHE_DIR, `attendus-${key.digest('hex')}.json`);
    if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8')) as unknown[];
  }
  const dir = mkdtempSync(join(tmpdir(), 'rueda-us042-'));
  try {
    const inputFile = join(dir, 'cas.json');
    const output = join(dir, 'attendus.json');
    writeFileSync(inputFile, input);
    const run = spawnSync(PYTHON, ['-I', '-X', 'utf8', DRIVER, inputFile, output], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (run.error) throw run.error;
    if (run.status !== 0) {
      throw new Error(`oracle Python en échec (${String(run.status)}) :\n${run.stderr}`);
    }
    const text = readFileSync(output, 'utf8');
    if (cached !== undefined) {
      // écriture atomique : un autre processus de mutation ne lit jamais un fichier partiel
      const partial = `${cached}.${String(process.pid)}.tmp`;
      writeFileSync(partial, text);
      renameSync(partial, cached);
    }
    return JSON.parse(text) as unknown[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ----------------------------------------------------------------------------- moteur

function currencyOf(variant: string): Currency {
  const found = COUNTRY_VARIANTS.find((v) => v.country === variant);
  if (!found) throw new Error(`variante inconnue : ${variant}`);
  return found.currency;
}

function toTrip(c: SettlementCase, o: OracleSettlement): SettlementTrip {
  const currency = currencyOf(c.variant);
  const m = (x: bigint | string) => money(BigInt(x), currency);
  const lines: Partial<Record<SettlementLine, ReturnType<typeof money>>> = {};
  for (const l of ORACLE_LINES) lines[l] = m(c.lines[l]);
  const host = ratio(c.share[0], c.share[1]);
  return {
    currency,
    days: c.days,
    rateType: c.rate === 'R' ? 'REFUNDABLE' : 'NON_REFUNDABLE',
    startAtMs: T0_MS,
    bookedAtMs: at(c.bookedMinutes),
    lines,
    taxGroups: c.groups.map((g) => ({
      id: g.id,
      lines: g.lines,
      taxPaid: m(o.taxPaid[g.id]!),
      thirdParty: g.thirdParty,
    })),
    totalPaid: m(o.totalPaid),
    hostSharePctFrozen: host,
    deliverySharePct: host,
    extrasSharePct: host,
    insurerPremiumShareFrozen: ratio(c.insurerPremiumShare[0], c.insurerPremiumShare[1]),
    insurerRoadsideShareFrozen: ratio(c.insurerRoadsideShare[0], c.insurerRoadsideShare[1]),
  };
}

function toEvent(e: CaseEvent): CancellationEvent {
  return {
    reason: e.reason,
    requestedAtMs: at(e.requestedMinutes),
    subReason: 'INVALID_LICENSE',
    evidenceValidated: e.evidenceValidated,
    checkinValidated: e.checkinValidated,
    hostMessageTraced: e.hostMessageTraced,
    hostNoShowReportedBefore: e.hostNoShowReportedBefore,
    additionalDriverApproved: e.additionalDriverApproved,
  };
}

/** Paramètres de la configuration de test de 08 ; barème `PENALTY[devise]` lu dans l'oracle. */
function toParams(currency: Currency, o: OracleSettlement, optionA: boolean): SettlementParams {
  const scale = 10n ** BigInt(currency.exponent);
  const [early, late, noShow, clean] = o.penaltyScheduleMajor.map((v) =>
    money(BigInt(v) * scale, currency),
  );
  return {
    noShowGraceMinutes: 60,
    lastMinuteThresholdHours: 25,
    freeCancelLeadHours: 24,
    ...(optionA ? { platformFundedHostCompensation: true } : {}),
    hostPenalty: { cxlEarly: early!, cxlLate: late!, hostNoShow: noShow!, cleanliness: clean! },
  };
}

function legsOf(l: Legs): Record<string, bigint> {
  return {
    ...Object.fromEntries(LEGS.map((k) => [k, l[k].amountMinor])),
    TOTAL: l.total.amountMinor,
  };
}
function bigints(r: Record<string, string>): Record<string, bigint> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, BigInt(v)]));
}

/** Observation du moteur, dans les unités et les noms de l'oracle. */
function observe(s: CancellationSettlement, currency: Currency) {
  const scale = 10n ** BigInt(currency.exponent);
  return {
    reason: s.reason as string,
    guestRefund: s.guestRefund.amountMinor,
    taxRefund: s.taxRefund.amountMinor,
    hostEarnings: s.hostEarnings.amountMinor,
    hostFromGuest: s.hostFromGuest.amountMinor,
    hostCompensation: s.hostCompensation.amountMinor,
    platformNet: s.platformNet.amountMinor,
    retained: s.retained.amountMinor,
    retainedTax: s.retainedTax.amountMinor,
    // pénalité de 08 en unités majeures : comparée en unités mineures, sans division
    hostPenaltyMinor: s.hostPenalty.amountMinor,
    hostPenaltyScale: scale,
    refundByLine: Object.fromEntries(ORACLE_LINES.map((l) => [l, s.refundByLine[l].amountMinor])),
    youngDriverRefund: s.refundByLine.youngDriver.amountMinor,
    taxRefundByGroup: Object.fromEntries(
      Object.entries(s.taxRefundByGroup).map(([g, v]) => [g, v.amountMinor]),
    ),
    captureLegs: legsOf(s.captureLegs),
    settledLegs: legsOf(s.settledLegs),
    legVariation: legsOf(s.legVariation),
    negativeLeg: s.negativeLeg,
  };
}

/** Attendu de l'oracle (option A : compensation financée par la plateforme, comme l'oracle). */
function expectedA(o: OracleSettlement, currency: Currency) {
  const scale = 10n ** BigInt(currency.exponent);
  const settled = bigints(o.settledLegs);
  return {
    reason: o.reason,
    guestRefund: BigInt(o.guestRefund),
    taxRefund: BigInt(o.taxRefund),
    hostEarnings: BigInt(o.hostEarnings),
    hostFromGuest: BigInt(o.hostFromGuest),
    hostCompensation: BigInt(o.hostCompensation),
    platformNet: BigInt(o.platformNet),
    retained: BigInt(o.retained),
    retainedTax: BigInt(o.retainedTax),
    hostPenaltyMinor: BigInt(o.hostPenaltyMajor) * scale,
    hostPenaltyScale: scale,
    refundByLine: bigints(o.refundByLine),
    youngDriverRefund: 0n,
    taxRefundByGroup: bigints(o.taxRefundByGroup),
    captureLegs: bigints(o.captureLegs),
    settledLegs: settled,
    legVariation: bigints(o.legVariation),
    negativeLeg: LEGS.some((k) => settled[k]! < 0n),
  };
}

/**
 * Option B (défaut fail-closed, DEC-FONDATEUR-01) : aucune compensation. L'oracle VERIF_09 ne
 * connaît que l'option A ; l'attendu B en découle sans calcul : compensation 0, gains hôte =
 * part hôte venue du guest, net plateforme = net de l'oracle + compensation. Jambes inchangées
 * (la compensation n'est pas une jambe, 08 E7).
 */
function expectedB(o: OracleSettlement, currency: Currency) {
  const a = expectedA(o, currency);
  return {
    ...a,
    hostCompensation: 0n,
    hostEarnings: a.hostFromGuest,
    platformNet: a.platformNet + a.hostCompensation,
  };
}

/** Invariants de 08 (équilibre, Σ jambes, remboursement ≤ encaissé, taxe ≤ taxe payée). */
function violations(trip: SettlementTrip, s: CancellationSettlement): string[] {
  const out: string[] = [];
  const total = trip.totalPaid.amountMinor;
  const sumLegs = (l: Legs) => LEGS.reduce((acc, k) => acc + l[k].amountMinor, 0n);
  if (s.guestRefund.amountMinor + s.retained.amountMinor + s.retainedTax.amountMinor !== total)
    out.push('équilibre remboursement + retenu + taxe retenue ≠ total payé');
  if (s.guestRefund.amountMinor < 0n || s.guestRefund.amountMinor > total)
    out.push('refund_committed hors de [0 ; collected_total]');
  for (const legs of [s.captureLegs, s.settledLegs, s.legVariation])
    if (sumLegs(legs) !== legs.total.amountMinor) out.push('Σ jambes ≠ total');
  if (s.captureLegs.total.amountMinor !== total) out.push('jambes de capture ≠ total payé');
  if (s.settledLegs.total.amountMinor !== total - s.guestRefund.amountMinor)
    out.push('jambes retenues ≠ total − remboursement');
  for (const g of trip.taxGroups) {
    const r = s.taxRefundByGroup[g.id]!.amountMinor;
    if (r < 0n || r > g.taxPaid.amountMinor) out.push(`taxe remboursée ${g.id} hors bornes`);
  }
  if (s.hostEarnings.amountMinor < 0n) out.push('gains hôte < 0');
  return out;
}

// ----------------------------------------------------------------------------- tests

const json = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x));

let memo: { cases: SettlementCase[]; expected: OracleSettlement[] } | undefined;
/** Cas de règlement et attendus de l'oracle, calculés une fois pour les deux tests. */
function settlementCases() {
  if (memo === undefined) {
    const cases = fc.sample(settlementCaseArb, { seed: SEED, numRuns: RUNS });
    const expected = runOracle(cases) as OracleSettlement[];
    expect(expected).toHaveLength(cases.length);
    memo = { cases, expected };
  }
  return memo;
}

/**
 * Version persistée attendue (US-018, 08 E7 règle 5 et E4) : jambe signée = jambe retenue de
 * l'oracle ; `kept` = max(0, signée), `advance` = manque (PLATFORM seulement) ; `basis` = jambes
 * de capture de l'oracle (v1) ou jambes signées de la version n (v n+1) ; variation = signée − base.
 */
function expectedLegRecords(settled: Record<string, string>, basis: Record<string, string>) {
  return LEGS.map((leg) => {
    const signed = BigInt(settled[leg]!);
    return {
      leg,
      keptMinor: signed < 0n ? 0n : signed,
      advanceMinor: signed < 0n ? -signed : 0n,
      basisMinor: BigInt(basis[leg]!),
      variationMinor: signed - BigInt(basis[leg]!),
    };
  });
}

function recordHeader(r: SettlementRecord) {
  return {
    reason: r.reason,
    totalPaidMinor: r.totalPaidMinor,
    guestRefundMinor: r.guestRefundMinor,
    taxRefundMinor: r.taxRefundMinor,
    retainedMinor: r.retainedMinor,
    retainedTaxMinor: r.retainedTaxMinor,
    hostFromGuestMinor: r.hostFromGuestMinor,
    hostCompensationMinor: r.hostCompensationMinor,
    hostEarningsMinor: r.hostEarningsMinor,
    platformNetMinor: r.platformNetMinor,
    hostPenaltyMinor: r.hostPenaltyMinor,
    negativeLeg: r.negativeLeg,
    lines: r.lines.map((l) => [l.line, l.amountMinor, l.refundMinor, l.retainedMinor]),
    taxGroups: r.taxGroups.map((g) => [
      g.groupId,
      g.thirdParty,
      g.taxPaidMinor,
      g.taxRefundMinor,
      g.retainedTaxMinor,
    ]),
    legs: r.legs,
  };
}

function expectedHeader(
  c: SettlementCase,
  o: OracleSettlement,
  e: OracleEvaluation,
  basis: Record<string, string>,
  currency: Currency,
) {
  const legs = expectedLegRecords(e.settledLegs, basis);
  return {
    reason: e.reason,
    totalPaidMinor: BigInt(o.totalPaid),
    guestRefundMinor: BigInt(e.guestRefund),
    taxRefundMinor: BigInt(e.taxRefund),
    retainedMinor: BigInt(e.retained),
    retainedTaxMinor: BigInt(e.retainedTax),
    hostFromGuestMinor: BigInt(e.hostFromGuest),
    hostCompensationMinor: BigInt(e.hostCompensation),
    hostEarningsMinor: BigInt(e.hostEarnings),
    platformNetMinor: BigInt(e.platformNet),
    hostPenaltyMinor: BigInt(e.hostPenaltyMajor) * 10n ** BigInt(currency.exponent),
    negativeLeg: legs.some((l) => l.advanceMinor > 0n),
    lines: SETTLEMENT_LINES.map((l) => {
      const amount = l === 'youngDriver' ? 0n : c.lines[l];
      const refund = l === 'youngDriver' ? 0n : BigInt(e.refundByLine[l]);
      return [l, amount, refund, amount - refund];
    }),
    taxGroups: c.groups.map((g) => {
      const paid = BigInt(o.taxPaid[g.id]!);
      const refund = BigInt(e.taxRefundByGroup[g.id]!);
      return [g.id, g.thirdParty, paid, refund, paid - refund];
    }),
    legs,
  };
}

describe(`US-042 — moteur comparé aux oracles de 08 (graine ${SEED})`, () => {
  it(`roundHalfUp et allocHost : ${PRIMITIVE_RUNS} cas chacun, 0 écart`, () => {
    const rhuCases = fc.sample(rhuCaseArb, { seed: SEED, numRuns: PRIMITIVE_RUNS });
    const allocCases = fc.sample(allocCaseArb, { seed: SEED + 1, numRuns: PRIMITIVE_RUNS });
    const cases = [...rhuCases, ...allocCases];
    const expected = runOracle(cases) as { value: string }[];
    expect(expected).toHaveLength(cases.length);
    const gaps: string[] = [];
    const currency = COUNTRY_VARIANTS[0]!.currency;
    cases.forEach((c, i) => {
      const want = BigInt(expected[i]!.value);
      const r = ratio(c.ratio[0], c.ratio[1]);
      const got =
        c.kind === 'rhu' ? roundHalfUp(r) : allocHost(money(c.amount, currency), r).amountMinor;
      if (got !== want) gaps.push(`${c.kind} ${json(c)} : moteur ${got}, oracle ${want}`);
    });
    expect(gaps.slice(0, 5)).toEqual([]);
  });

  it(`règlement et jambes : ${RUNS} cas (USD et PYG), options A et B, 0 écart, 0 violation`, () => {
    const { cases, expected } = settlementCases();
    const gaps: string[] = [];
    const seen = { USD: 0, PYG: 0, reasons: new Set<string>(), compensated: 0, negative: 0 };
    cases.forEach((c, i) => {
      const o = expected[i]!;
      const trip = toTrip(c, o);
      const event = toEvent(c.event);
      for (const optionA of [true, false]) {
        const label = `cas ${i} (option ${optionA ? 'A' : 'B'}) ${json(c)}`;
        let s: CancellationSettlement;
        try {
          s = computeCancellationSettlement(trip, event, toParams(trip.currency, o, optionA));
        } catch (error) {
          gaps.push(`${label} : refus ${String(error)}`);
          continue;
        }
        const want = optionA ? expectedA(o, trip.currency) : expectedB(o, trip.currency);
        const got = observe(s, trip.currency);
        if (json(got) !== json(want)) {
          gaps.push(`${label}\n  moteur ${json(got)}\n  oracle ${json(want)}`);
        }
        for (const v of violations(trip, s)) gaps.push(`${label} : invariant violé, ${v}`);
        if (optionA) {
          seen[trip.currency.code as 'USD' | 'PYG'] += 1;
          seen.reasons.add(s.reason);
          if (s.hostCompensation.amountMinor > 0n) seen.compensated += 1;
          if (s.negativeLeg) seen.negative += 1;
        }
      }
    });
    expect(gaps.slice(0, 3)).toEqual([]);
    expect(gaps).toHaveLength(0);
    // Le générateur exerce bien les deux devises, chaque motif bêta et les branches rares.
    expect(seen.USD).toBeGreaterThan(RUNS / 4);
    expect(seen.PYG).toBeGreaterThan(RUNS / 4);
    if (RUNS >= 1_000) {
      expect([...seen.reasons].sort()).toEqual([...BETA_CANCELLATION_REASONS].sort());
      expect(seen.compensated).toBeGreaterThan(0);
      expect(seen.negative).toBeGreaterThan(0);
    }
  });

  it(`règlements persistés : version 1, version n+1 et delta comparés à l'oracle (${RUNS} cas)`, () => {
    const { cases, expected } = settlementCases();
    const gaps: string[] = [];
    let versions = 0;
    let refusedCaptures = 0;
    cases.forEach((c, i) => {
      const o = expected[i]!;
      const trip = toTrip(c, o);
      const params = toParams(trip.currency, o, true);
      const label = `cas ${i} ${json(c)}`;
      const captureNegative = LEGS.some((k) => BigInt(o.captureLegs[k]!) < 0n);
      let v1: SettlementRecord;
      try {
        v1 = buildSettlementRecord(trip, toEvent(c.event), params);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (captureNegative && code === 'LEG_AMOUNT_NEGATIVE') refusedCaptures += 1;
        else gaps.push(`${label} : refus inattendu ${String(error)}`);
        return;
      }
      if (captureNegative) gaps.push(`${label} : capture à jambe négative acceptée`);
      const want1 = expectedHeader(c, o, o, o.captureLegs, trip.currency);
      if (json(recordHeader(v1)) !== json(want1)) {
        gaps.push(`${label} v1\n  moteur ${json(recordHeader(v1))}\n  oracle ${json(want1)}`);
      }
      versions += 1;
      const e2 = o.second;
      if (c.event2 === null || e2 === undefined) return;
      const v2 = buildSettlementRecord(trip, toEvent(c.event2), params, v1);
      const want2 = expectedHeader(c, o, e2, o.settledLegs, trip.currency);
      if (json(recordHeader(v2)) !== json(want2)) {
        gaps.push(`${label} v2\n  moteur ${json(recordHeader(v2))}\n  oracle ${json(want2)}`);
      }
      // 08 E4 : delta = S(v n+1) − S(v n), champ par champ et par jambe signée.
      const minus = (a: string, b: string) => BigInt(a) - BigInt(b);
      const scale = 10n ** BigInt(trip.currency.exponent);
      const wantDelta = {
        guestRefundMinor: minus(e2.guestRefund, o.guestRefund),
        taxRefundMinor: minus(e2.taxRefund, o.taxRefund),
        hostEarningsMinor: minus(e2.hostEarnings, o.hostEarnings),
        platformNetMinor: minus(e2.platformNet, o.platformNet),
        hostPenaltyMinor: minus(e2.hostPenaltyMajor, o.hostPenaltyMajor) * scale,
        retainedMinor: minus(e2.retained, o.retained),
        retainedTaxMinor: minus(e2.retainedTax, o.retainedTax),
        legs: Object.fromEntries(
          LEGS.map((k) => [k, minus(e2.settledLegs[k]!, o.settledLegs[k]!)]),
        ),
      };
      const delta = settlementDelta(v1, v2);
      if (json(delta) !== json(wantDelta)) {
        gaps.push(`${label} delta\n  moteur ${json(delta)}\n  oracle ${json(wantDelta)}`);
      }
      versions += 1;
    });
    expect(gaps.slice(0, 3)).toEqual([]);
    expect(gaps).toHaveLength(0);
    expect(versions).toBeGreaterThan(RUNS);
    if (RUNS >= 1_000) expect(refusedCaptures).toBeGreaterThan(0);
  });
});
