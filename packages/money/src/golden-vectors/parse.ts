/**
 * Lecture stricte (fail-closed) de l'export des oracles. Toute forme inattendue lève
 * `GoldenVectorsError` : clé inconnue ou manquante, montant qui n'est pas un entier écrit en texte,
 * devise absente du bloc `currencies`, identifiant en double, format inconnu.
 * Aucun montant n'est calculé ici : les valeurs sont copiées telles que l'oracle les a écrites.
 */
import {
  LEG_NAMES,
  LINE_NAMES,
  SETTLEMENT_AMOUNT_FIELDS,
  type GoldenAcceptance,
  type GoldenCheck,
  type GoldenCurrency,
  type GoldenEvent,
  type GoldenLegVector,
  type GoldenRatio,
  type GoldenSettlementVector,
  type GoldenTaxGroup,
  type GoldenTrip,
  type GoldenValue,
  type GoldenVectorSet,
  type LegName,
  type LegVectorKind,
  type LineName,
} from './types.ts';

/** Codes d'erreur PROPOSÉS (US-016), à reporter au catalogue 16 A.8 s'ils sortent des tests. */
export type GoldenVectorsErrorCode =
  'GOLDEN_VECTORS_INVALID' | 'GOLDEN_VECTOR_NOT_FOUND' | 'GOLDEN_REPLAY_EMPTY';

export class GoldenVectorsError extends Error {
  readonly code: GoldenVectorsErrorCode;

  constructor(code: GoldenVectorsErrorCode, message: string) {
    super(`${code} : ${message}`);
    this.name = 'GoldenVectorsError';
    this.code = code;
  }
}

type Json = unknown;
type Obj = Record<string, Json>;

const fail = (path: string, why: string): never => {
  throw new GoldenVectorsError('GOLDEN_VECTORS_INVALID', `${path} : ${why}`);
};

function obj(
  v: Json,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(path, 'objet attendu');
  const o = v as Obj;
  for (const k of Object.keys(o)) {
    if (!required.includes(k) && !optional.includes(k)) fail(path, `clé inconnue « ${k} »`);
  }
  for (const k of required) if (!(k in o)) fail(path, `clé manquante « ${k} »`);
  return o;
}

function arr(v: Json, path: string): readonly Json[] {
  return Array.isArray(v) ? v : fail(path, 'tableau attendu');
}

function str(v: Json, path: string): string {
  return typeof v === 'string' ? v : fail(path, 'texte attendu');
}

function bool(v: Json, path: string): boolean {
  return typeof v === 'boolean' ? v : fail(path, 'booléen attendu');
}

/** Entier sûr pour un compte (jours, minutes, exposant), jamais pour un montant. */
function count(v: Json, path: string): number {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : fail(path, 'entier attendu');
}

const INTEGER = /^-?(0|[1-9]\d*)$/;

/** Montant en unités mineures : uniquement un entier écrit en texte (jamais un `number` JSON). */
function amount(v: Json, path: string): bigint {
  if (typeof v !== 'string' || !INTEGER.test(v) || v === '-0') {
    return fail(path, `montant entier en texte attendu, reçu ${JSON.stringify(v)}`);
  }
  return BigInt(v);
}

const RATIO = /^(-?(?:0|[1-9]\d*))\/([1-9]\d*)$/;

function ratio(v: Json, path: string): GoldenRatio {
  const m = typeof v === 'string' ? RATIO.exec(v) : null;
  if (!m?.[1] || !m[2]) return fail(path, `fraction « n/d » attendue, reçu ${JSON.stringify(v)}`);
  return { numerator: BigInt(m[1]), denominator: BigInt(m[2]) };
}

function currencyRef(
  v: Json,
  path: string,
  currencies: ReadonlyMap<string, GoldenCurrency>,
): string {
  const code = str(v, path);
  if (!currencies.has(code)) fail(path, `devise « ${code} » absente du bloc currencies`);
  return code;
}

function lineName(v: Json, path: string): LineName {
  const s = str(v, path);
  return (LINE_NAMES as readonly string[]).includes(s)
    ? (s as LineName)
    : fail(path, `ligne inconnue « ${s} »`);
}

function parseCurrencies(v: Json): ReadonlyMap<string, GoldenCurrency> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    return fail('currencies', 'objet attendu');
  const out = new Map<string, GoldenCurrency>();
  for (const [code, def] of Object.entries(v as Obj)) {
    const d = obj(def, `currencies.${code}`, ['exponent']);
    const exponent = count(d['exponent'], `currencies.${code}.exponent`);
    if (exponent < 0 || exponent > 18) fail(`currencies.${code}.exponent`, 'hors de [0 ; 18]');
    out.set(code, { code, exponent });
  }
  if (out.size === 0) fail('currencies', 'aucune devise');
  return out;
}

function parseTrip(
  v: Json,
  path: string,
  currencies: ReadonlyMap<string, GoldenCurrency>,
): GoldenTrip {
  const t = obj(v, path, [
    'name',
    'currency',
    'days',
    'rate',
    'bookedAtMinutes',
    'hostSharePct',
    'deliverySharePct',
    'extrasSharePct',
    'linesMinor',
    'taxGroups',
    'totalPaidMinor',
  ]);
  const rate = str(t['rate'], `${path}.rate`);
  if (rate !== 'REFUNDABLE' && rate !== 'NON_REFUNDABLE')
    fail(`${path}.rate`, `tarif inconnu « ${rate} »`);
  const linesObj = obj(t['linesMinor'], `${path}.linesMinor`, LINE_NAMES);
  const linesMinor = Object.fromEntries(
    LINE_NAMES.map((l) => [l, amount(linesObj[l], `${path}.linesMinor.${l}`)]),
  ) as Record<LineName, bigint>;
  const taxGroups = arr(t['taxGroups'], `${path}.taxGroups`).map((g, i): GoldenTaxGroup => {
    const p = `${path}.taxGroups[${i}]`;
    const o = obj(g, p, ['id', 'rate', 'lines', 'taxPaidMinor']);
    return {
      id: str(o['id'], `${p}.id`),
      rate: ratio(o['rate'], `${p}.rate`),
      lines: arr(o['lines'], `${p}.lines`).map((l, j) => lineName(l, `${p}.lines[${j}]`)),
      taxPaidMinor: amount(o['taxPaidMinor'], `${p}.taxPaidMinor`),
    };
  });
  return {
    name: str(t['name'], `${path}.name`),
    currency: currencyRef(t['currency'], `${path}.currency`, currencies),
    days: count(t['days'], `${path}.days`),
    rate: rate as GoldenTrip['rate'],
    bookedAtMinutes: count(t['bookedAtMinutes'], `${path}.bookedAtMinutes`),
    hostSharePct: ratio(t['hostSharePct'], `${path}.hostSharePct`),
    deliverySharePct: ratio(t['deliverySharePct'], `${path}.deliverySharePct`),
    extrasSharePct: ratio(t['extrasSharePct'], `${path}.extrasSharePct`),
    linesMinor,
    taxGroups,
    totalPaidMinor: amount(t['totalPaidMinor'], `${path}.totalPaidMinor`),
  };
}

const EVENT_FLAGS = [
  'evidenceValidated',
  'hostGoodFaith',
  'additionalDriverApproved',
  'hostMessageTraced',
  'checkedIn',
  'hostNoShowReported',
  'hostEligibleOverride',
] as const;
const EVENT_TIMES = ['requestedAtMinutes', 'terminatedAtMinutes'] as const;

function parseEvent(v: Json, path: string): GoldenEvent {
  const e = obj(v, path, ['reason'], [...EVENT_FLAGS, ...EVENT_TIMES]);
  const out: Record<string, unknown> = { reason: str(e['reason'], `${path}.reason`) };
  for (const k of EVENT_TIMES) if (k in e) out[k] = count(e[k], `${path}.${k}`);
  for (const k of EVENT_FLAGS) if (k in e) out[k] = bool(e[k], `${path}.${k}`);
  if (!('requestedAtMinutes' in out) && !('terminatedAtMinutes' in out)) {
    fail(path, 'horodatage manquant (requestedAtMinutes ou terminatedAtMinutes)');
  }
  return out as unknown as GoldenEvent;
}

function parseSettlement(
  v: Json,
  path: string,
  currencies: ReadonlyMap<string, GoldenCurrency>,
): GoldenSettlementVector {
  const s = obj(
    v,
    path,
    [
      'id',
      'currency',
      'normative',
      'oracle',
      'entries08',
      'qualification08',
      'trip',
      'event',
      'expected',
    ],
    ['nonNormativeReason'],
  );
  const currency = currencyRef(s['currency'], `${path}.currency`, currencies);
  const trip = parseTrip(s['trip'], `${path}.trip`, currencies);
  if (trip.currency !== currency) fail(path, 'devise du vecteur ≠ devise du trip');
  const e = obj(s['expected'], `${path}.expected`, [
    ...SETTLEMENT_AMOUNT_FIELDS,
    'qualifiedReason',
  ]);
  const expected = Object.fromEntries(
    SETTLEMENT_AMOUNT_FIELDS.map((f) => [f, amount(e[f], `${path}.expected.${f}`)]),
  ) as Record<(typeof SETTLEMENT_AMOUNT_FIELDS)[number], bigint>;
  const normative = bool(s['normative'], `${path}.normative`);
  if (!normative && !('nonNormativeReason' in s)) fail(path, 'vecteur non normatif sans raison');
  return {
    id: str(s['id'], `${path}.id`),
    currency,
    normative,
    ...('nonNormativeReason' in s
      ? { nonNormativeReason: str(s['nonNormativeReason'], `${path}.nonNormativeReason`) }
      : {}),
    oracle: str(s['oracle'], `${path}.oracle`),
    entries08: str(s['entries08'], `${path}.entries08`),
    qualification08: str(s['qualification08'], `${path}.qualification08`),
    trip,
    event: parseEvent(s['event'], `${path}.event`),
    expected: {
      ...expected,
      qualifiedReason: str(e['qualifiedReason'], `${path}.expected.qualifiedReason`),
    },
  };
}

const LEG_KINDS: readonly LegVectorKind[] = [
  'ALLOCATION',
  'VARIATION',
  'REFUSED_CAPTURE',
  'CHARGEBACK_LOSS',
];

function parseLeg(
  v: Json,
  path: string,
  currencies: ReadonlyMap<string, GoldenCurrency>,
): GoldenLegVector {
  const l = obj(v, path, [
    'id',
    'currency',
    'kind',
    'normative',
    'oracle',
    'entries08',
    'operation08',
    'legsMinor',
    'totalMinor',
  ]);
  const kind = str(l['kind'], `${path}.kind`);
  if (!(LEG_KINDS as readonly string[]).includes(kind))
    fail(`${path}.kind`, `nature inconnue « ${kind} »`);
  const legsObj = obj(l['legsMinor'], `${path}.legsMinor`, LEG_NAMES);
  return {
    id: str(l['id'], `${path}.id`),
    currency: currencyRef(l['currency'], `${path}.currency`, currencies),
    kind: kind as LegVectorKind,
    normative: bool(l['normative'], `${path}.normative`),
    oracle: str(l['oracle'], `${path}.oracle`),
    entries08: str(l['entries08'], `${path}.entries08`),
    operation08: str(l['operation08'], `${path}.operation08`),
    legsMinor: Object.fromEntries(
      LEG_NAMES.map((k) => [k, amount(legsObj[k], `${path}.legsMinor.${k}`)]),
    ) as Record<LegName, bigint>,
    totalMinor: amount(l['totalMinor'], `${path}.totalMinor`),
  };
}

/** Décode l'encodage typé de l'exporteur : {"$int": "…"} → bigint, {"$ratio": "n/d"} → fraction. */
export function decodeValue(v: Json, path = 'value'): GoldenValue {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number')
    return fail(path, 'nombre JSON interdit (entier attendu sous {"$int": "…"})');
  if (Array.isArray(v)) return v.map((x, i) => decodeValue(x, `${path}[${i}]`));
  if (typeof v === 'object') {
    const o = v as Obj;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === '$int') return amount(o['$int'], `${path}.$int`);
    if (keys.length === 1 && keys[0] === '$ratio') return ratio(o['$ratio'], `${path}.$ratio`);
    if (keys.some((k) => k.startsWith('$')))
      fail(path, `clé réservée inconnue (${keys.join(', ')})`);
    return Object.fromEntries(keys.map((k) => [k, decodeValue(o[k], `${path}.${k}`)]));
  }
  return fail(path, 'valeur non décodable');
}

function parseCheck(v: Json, path: string): GoldenCheck {
  const c = obj(v, path, ['vectorId', 'oracle', 'label', 'normative', 'expected']);
  return {
    vectorId: c['vectorId'] === null ? null : str(c['vectorId'], `${path}.vectorId`),
    oracle: str(c['oracle'], `${path}.oracle`),
    label: str(c['label'], `${path}.label`),
    normative: bool(c['normative'], `${path}.normative`),
    expected: decodeValue(c['expected'], `${path}.expected`),
  };
}

function parseAcceptance(
  v: Json,
  path: string,
  currencies: ReadonlyMap<string, GoldenCurrency>,
): GoldenAcceptance {
  const a = obj(
    v,
    path,
    ['id', 'currency', 'entries16', 'checkLabels', 'legVectorRefs'],
    ['expected'],
  );
  return {
    id: str(a['id'], `${path}.id`),
    currency: currencyRef(a['currency'], `${path}.currency`, currencies),
    entries16: str(a['entries16'], `${path}.entries16`),
    checkLabels: arr(a['checkLabels'], `${path}.checkLabels`).map((x, i) =>
      str(x, `${path}.checkLabels[${i}]`),
    ),
    legVectorRefs: arr(a['legVectorRefs'], `${path}.legVectorRefs`).map((x, i) =>
      str(x, `${path}.legVectorRefs[${i}]`),
    ),
    ...('expected' in a ? { expected: decodeValue(a['expected'], `${path}.expected`) } : {}),
  };
}

function unique<T extends { readonly id: string }>(list: readonly T[], what: string): readonly T[] {
  const seen = new Set<string>();
  for (const x of list) {
    if (seen.has(x.id)) fail(what, `identifiant en double « ${x.id} »`);
    seen.add(x.id);
  }
  return list;
}

/** Valide un export déjà lu (`JSON.parse`) et le convertit en types `bigint`. */
export function parseGoldenVectors(data: Json): GoldenVectorSet {
  const root = obj(data, 'racine', [
    '$comment',
    'format',
    'currencies',
    'settlement',
    'legs',
    'checks',
    'acceptance',
  ]);
  if (root['format'] !== 1)
    fail('format', `format 1 attendu, reçu ${JSON.stringify(root['format'])}`);
  const currencies = parseCurrencies(root['currencies']);
  return {
    format: 1,
    currencies,
    settlement: unique(
      arr(root['settlement'], 'settlement').map((s, i) =>
        parseSettlement(s, `settlement[${i}]`, currencies),
      ),
      'settlement',
    ),
    legs: unique(
      arr(root['legs'], 'legs').map((l, i) => parseLeg(l, `legs[${i}]`, currencies)),
      'legs',
    ),
    checks: arr(root['checks'], 'checks').map((c, i) => parseCheck(c, `checks[${i}]`)),
    acceptance: unique(
      arr(root['acceptance'], 'acceptance').map((a, i) =>
        parseAcceptance(a, `acceptance[${i}]`, currencies),
      ),
      'acceptance',
    ),
  };
}
