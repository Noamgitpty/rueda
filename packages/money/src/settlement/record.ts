/**
 * Règlement persistable, versions, supersession et jambes (US-018 ; 08 E4, E7 règles 3, 3 bis, 5 ;
 * 17 §2.9, §3.2.8 ; ADR-057).
 *
 * `buildSettlementRecord` appelle le moteur pur (`computeCancellationSettlement`, ADR-054) et met
 * son résultat sous la forme stockée par `core.settlement_cmd_record` (migration 0027) :
 * - jambes retenues `keptMinor` ≥ 0, avance de Kmino `advanceMinor` (jambe `PLATFORM` négative
 *   seulement, drapeau `negativeLeg`, 08 E7 règle 5), base `basisMinor` (état capturé pour la
 *   version 1, jambes signées de la version n pour la version n+1) et variation signée
 *   `variationMinor = kept − advance − basis` (08 E7 règle 3) ;
 * - hachage des entrées `inputsHash` (08 E4 : un recalcul doit redonner le même hachage) et des
 *   paramètres figés `paramSnapshotHash`, SHA-256 d'une sérialisation canonique.
 *
 * `settlementDelta(v n, v n+1)` donne l'écart ligne par ligne de la requalification (08 E4, T36) ;
 * `settlementOperationKey` forme la clé d'idempotence `…:v{version}:{opération}:{moyen}:i{n}:a{n}`.
 * Fonctions pures : aucune horloge, aucune E/S, aucune constante pays.
 */
import { createHash } from 'node:crypto';
import { computeCancellationSettlement } from './cancellation.ts';
import { SettlementError } from './errors.ts';
import {
  LEGS,
  SETTLEMENT_LINES,
  type CancellationEvent,
  type CancellationSettlement,
  type Leg,
  type SettlementLine,
  type SettlementParams,
  type SettlementTrip,
} from './types.ts';

/** Format de la charge utile attendue par `core.settlement_cmd_record` (0027). */
export const SETTLEMENT_RECORD_FORMAT = 1;

export interface SettlementLineRecord {
  readonly line: SettlementLine;
  /** Montant de la ligne au trip (signé : une promo est négative). */
  readonly amountMinor: bigint;
  readonly refundMinor: bigint;
  readonly retainedMinor: bigint;
}

export interface SettlementTaxRecord {
  readonly groupId: string;
  readonly thirdParty: boolean;
  readonly taxPaidMinor: bigint;
  readonly taxRefundMinor: bigint;
  readonly retainedTaxMinor: bigint;
}

export interface SettlementLegRecord {
  readonly leg: Leg;
  /** Jambe retenue de la version, ≥ 0 (17 §3.2.8). */
  readonly keptMinor: bigint;
  /** Avance de Kmino : seulement sur `PLATFORM`, quand la jambe retenue serait négative. */
  readonly advanceMinor: bigint;
  /** État précédent : jambe capturée (version 1) ou jambe signée de la version n. */
  readonly basisMinor: bigint;
  /** Variation signée `kept − advance − basis` (Σ = − remboursement du guest). */
  readonly variationMinor: bigint;
}

export interface SettlementRecord {
  readonly format: typeof SETTLEMENT_RECORD_FORMAT;
  readonly kind: 'CANCELLATION';
  readonly engineVersion: string;
  readonly currency: string;
  readonly requestedReason: string;
  readonly reason: string;
  readonly origin: string;
  readonly qualification: string;
  readonly targetState: string;
  readonly hostEligible: boolean;
  readonly totalPaidMinor: bigint;
  readonly guestRefundMinor: bigint;
  readonly taxRefundMinor: bigint;
  readonly retainedMinor: bigint;
  readonly retainedTaxMinor: bigint;
  readonly hostFromGuestMinor: bigint;
  readonly hostCompensationMinor: bigint;
  readonly hostEarningsMinor: bigint;
  readonly platformNetMinor: bigint;
  readonly hostPenaltyMinor: bigint;
  /** Une jambe retenue est négative : revue FIN, ordres `PLANNED`, remboursement jamais réduit. */
  readonly negativeLeg: boolean;
  readonly lines: readonly SettlementLineRecord[];
  readonly taxGroups: readonly SettlementTaxRecord[];
  readonly legs: readonly SettlementLegRecord[];
  /** Entrées canoniques du moteur (`canonicalJson`) : rejouables avant tout ordre (ADR-057). */
  readonly inputs: string;
  /** SHA-256 hexadécimal (64 caractères) de `SETTLEMENT_INPUTS_HASH_PREFIX` ‖ `inputs`. */
  readonly inputsHash: string;
  /** SHA-256 hexadécimal des paramètres figés. */
  readonly paramSnapshotHash: string;
}

const invalid = (message: string): SettlementError =>
  new SettlementError('SETTLEMENT_INPUT_INVALID', message);

/**
 * Sérialisation canonique (clés triées, `bigint` balisé, symboles ignorés) : deux entrées égales
 * donnent la même chaîne, quel que soit l'ordre de construction des objets.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'bigint':
      return `{"$bigint":"${value.toString()}"}`;
    case 'number':
      if (!Number.isFinite(value)) throw invalid('nombre non fini dans les entrées');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v: unknown) => canonicalJson(v)).join(',')}]`;
      // objet simple seulement : Date, Map, Set ou instance de classe donneraient « {} »
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw invalid('objet non simple dans les entrées (Date, Map, Set, instance)');
      }
      const entries = Object.keys(value)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
      return `{${entries.join(',')}}`;
    }
    default:
      throw invalid(`valeur non sérialisable dans les entrées (${typeof value})`);
  }
}

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Préfixe de domaine du hachage des entrées (recopié par le `CHECK` de 0027). */
export const SETTLEMENT_INPUTS_HASH_PREFIX = 'rueda.settlement.inputs/1\n';

/** Entrées canoniques du moteur (version, trip, événement, paramètres figés), conservées en base. */
export function settlementInputsCanonical(
  engineVersion: string,
  trip: SettlementTrip,
  event: CancellationEvent,
  params: SettlementParams,
): string {
  return canonicalJson({ engineVersion, trip, event, params });
}

/** 08 E4 : hachage des entrées = SHA-256(préfixe ‖ entrées canoniques). */
export function settlementInputsHash(
  engineVersion: string,
  trip: SettlementTrip,
  event: CancellationEvent,
  params: SettlementParams,
): string {
  return sha256Hex(
    SETTLEMENT_INPUTS_HASH_PREFIX + settlementInputsCanonical(engineVersion, trip, event, params),
  );
}

/** Hachage des paramètres figés (17 §3.2.8 `param_snapshot_hash`). */
export function settlementParamsHash(params: SettlementParams): string {
  return sha256Hex(`rueda.settlement.params/1\n${canonicalJson(params)}`);
}

/**
 * Trip canonique d'une version enregistrée, relu dans ses entrées `inputs` (texte canonique) : le
 * balisage `{"$bigint": "…"}` relu par `JSON.parse` se resérialise à l'identique.
 */
function previousTripCanonical(previous: SettlementRecord): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(previous.inputs);
  } catch {
    throw invalid('entrées de la version n illisibles');
  }
  const trip =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)['trip']
      : undefined;
  if (typeof trip !== 'object' || trip === null) {
    throw invalid('trip absent des entrées de la version n');
  }
  return canonicalJson(trip);
}

/** Jambes signées d'une version (`kept − advance`) : base de la version suivante. */
export function signedLegs(record: SettlementRecord): Readonly<Record<Leg, bigint>> {
  const out = {} as Record<Leg, bigint>;
  for (const leg of LEGS) {
    const l = record.legs.find((x) => x.leg === leg);
    if (l === undefined) throw invalid(`jambe ${leg} absente de la version précédente`);
    out[leg] = l.keptMinor - l.advanceMinor;
  }
  return Object.freeze(out);
}

/**
 * Jambes d'une version : `kept` ≥ 0, avance sur `PLATFORM` seulement, variation depuis `basis`.
 * Exportée pour les tests (cas inatteignable par le moteur : jambe non plateforme négative).
 */
export function settlementLegRecords(
  settlement: Pick<CancellationSettlement, 'settledLegs'>,
  basis: Readonly<Record<Leg, bigint>>,
): SettlementLegRecord[] {
  return LEGS.map((leg) => {
    const signed = settlement.settledLegs[leg].amountMinor;
    const advance = signed < 0n ? -signed : 0n;
    if (advance > 0n && leg !== 'PLATFORM') {
      // HOST est planchéré à 0, INSURER et TAX_THIRD_PARTY sont ≥ 0 par construction : fail-closed.
      throw new SettlementError('LEG_AMOUNT_NEGATIVE', `jambe ${leg} retenue négative`);
    }
    const kept = signed < 0n ? 0n : signed;
    return Object.freeze({
      leg,
      keptMinor: kept,
      advanceMinor: advance,
      basisMinor: basis[leg],
      variationMinor: signed - basis[leg],
    });
  });
}

/**
 * Calcule (moteur pur) et met en forme la version d'un règlement. Sans `previous` : version 1,
 * base = état capturé (`captureLegs`, chaque jambe ≥ 0, sinon `LEG_AMOUNT_NEGATIVE`, 08 E7
 * règle 5). Avec `previous` : version n+1 (requalification, SM-7), base = jambes signées de la
 * version n, même devise exigée.
 */
export function buildSettlementRecord(
  trip: SettlementTrip,
  event: CancellationEvent,
  params: SettlementParams,
  previous?: SettlementRecord,
): SettlementRecord {
  const s = computeCancellationSettlement(trip, event, params);
  let basis: Readonly<Record<Leg, bigint>>;
  if (previous === undefined) {
    const capture = {} as Record<Leg, bigint>;
    for (const leg of LEGS) {
      const v = s.captureLegs[leg].amountMinor;
      if (v < 0n) {
        throw new SettlementError('LEG_AMOUNT_NEGATIVE', `jambe ${leg} capturée négative`);
      }
      capture[leg] = v;
    }
    basis = capture;
  } else {
    if (previous.currency !== s.currency) throw invalid('devise différente de la version n');
    if (previous.engineVersion !== s.engineVersion) {
      // ADR-057 : une version n+1 se calcule avec la même version du moteur que la version n
      throw invalid('version du moteur différente de la version n');
    }
    if (previous.totalPaidMinor !== trip.totalPaid.amountMinor) {
      throw invalid('total payé différent de la version n (nouvelle version de prix : hors bêta)');
    }
    // US-049 (RC-1, ARG-04c) : la version n+1 porte sur le MÊME devis figé que la version n (08 E1,
    // BR-CXL-03) ; un devis recomposé à total égal déplacerait de la valeur entre lignes et jambes.
    if (canonicalJson(trip) !== previousTripCanonical(previous)) {
      throw invalid('trip différent de celui de la version n (devis figé, 08 E1)');
    }
    basis = signedLegs(previous);
  }
  const legs = settlementLegRecords(s, basis);
  // une avance n'existe que sur PLATFORM négative : drapeau negativeLeg (08 E7 règle 5)
  const negativeLeg = legs.some((l) => l.advanceMinor > 0n);
  const lines = SETTLEMENT_LINES.map((line) =>
    Object.freeze({
      line,
      amountMinor: trip.lines[line]?.amountMinor ?? 0n,
      refundMinor: s.refundByLine[line].amountMinor,
      retainedMinor: s.retainedByLine[line].amountMinor,
    }),
  );
  const taxGroups = trip.taxGroups.map((g) =>
    Object.freeze({
      groupId: g.id,
      thirdParty: g.thirdParty,
      taxPaidMinor: g.taxPaid.amountMinor,
      taxRefundMinor: s.taxRefundByGroup[g.id]?.amountMinor ?? 0n,
      retainedTaxMinor: s.retainedTaxByGroup[g.id]?.amountMinor ?? 0n,
    }),
  );
  return Object.freeze({
    format: SETTLEMENT_RECORD_FORMAT,
    kind: 'CANCELLATION',
    engineVersion: s.engineVersion,
    currency: s.currency,
    requestedReason: s.requestedReason,
    reason: s.reason,
    origin: s.origin,
    qualification: s.qualification,
    targetState: s.targetState,
    hostEligible: s.hostEligible,
    totalPaidMinor: trip.totalPaid.amountMinor,
    guestRefundMinor: s.guestRefund.amountMinor,
    taxRefundMinor: s.taxRefund.amountMinor,
    retainedMinor: s.retained.amountMinor,
    retainedTaxMinor: s.retainedTax.amountMinor,
    hostFromGuestMinor: s.hostFromGuest.amountMinor,
    hostCompensationMinor: s.hostCompensation.amountMinor,
    hostEarningsMinor: s.hostEarnings.amountMinor,
    platformNetMinor: s.platformNet.amountMinor,
    hostPenaltyMinor: s.hostPenalty.amountMinor,
    negativeLeg,
    lines: Object.freeze(lines),
    taxGroups: Object.freeze(taxGroups),
    legs: Object.freeze(legs),
    inputs: settlementInputsCanonical(s.engineVersion, trip, event, params),
    inputsHash: settlementInputsHash(s.engineVersion, trip, event, params),
    paramSnapshotHash: settlementParamsHash(params),
  });
}

export interface SettlementDelta {
  readonly guestRefundMinor: bigint;
  readonly taxRefundMinor: bigint;
  readonly hostEarningsMinor: bigint;
  readonly platformNetMinor: bigint;
  readonly hostPenaltyMinor: bigint;
  readonly retainedMinor: bigint;
  readonly retainedTaxMinor: bigint;
  /** Variation de chaque jambe signée, v n → v n+1. */
  readonly legs: Readonly<Record<Leg, bigint>>;
}

/** 08 E4 : `delta = S(v n+1) − S(v n)`, ligne par ligne (vecteur T36). */
export function settlementDelta(from: SettlementRecord, to: SettlementRecord): SettlementDelta {
  if (from.currency !== to.currency) throw invalid('delta entre deux devises');
  const a = signedLegs(from);
  const b = signedLegs(to);
  const legs = {} as Record<Leg, bigint>;
  for (const leg of LEGS) legs[leg] = b[leg] - a[leg];
  return Object.freeze({
    guestRefundMinor: to.guestRefundMinor - from.guestRefundMinor,
    taxRefundMinor: to.taxRefundMinor - from.taxRefundMinor,
    hostEarningsMinor: to.hostEarningsMinor - from.hostEarningsMinor,
    platformNetMinor: to.platformNetMinor - from.platformNetMinor,
    hostPenaltyMinor: to.hostPenaltyMinor - from.hostPenaltyMinor,
    retainedMinor: to.retainedMinor - from.retainedMinor,
    retainedTaxMinor: to.retainedTaxMinor - from.retainedTaxMinor,
    legs: Object.freeze(legs),
  });
}

/** Charge utile JSON de `core.settlement_cmd_record` : montants en chaînes d'entiers. */
export type SettlementRecordPayload = Readonly<Record<string, unknown>>;

export function settlementRecordPayload(record: SettlementRecord): SettlementRecordPayload {
  const minor = (v: bigint): string => v.toString();
  return {
    format: record.format,
    kind: record.kind,
    engineVersion: record.engineVersion,
    currency: record.currency,
    requestedReason: record.requestedReason,
    reason: record.reason,
    origin: record.origin,
    qualification: record.qualification,
    targetState: record.targetState,
    hostEligible: record.hostEligible,
    totalPaidMinor: minor(record.totalPaidMinor),
    guestRefundMinor: minor(record.guestRefundMinor),
    taxRefundMinor: minor(record.taxRefundMinor),
    retainedMinor: minor(record.retainedMinor),
    retainedTaxMinor: minor(record.retainedTaxMinor),
    hostFromGuestMinor: minor(record.hostFromGuestMinor),
    hostCompensationMinor: minor(record.hostCompensationMinor),
    hostEarningsMinor: minor(record.hostEarningsMinor),
    platformNetMinor: minor(record.platformNetMinor),
    hostPenaltyMinor: minor(record.hostPenaltyMinor),
    negativeLeg: record.negativeLeg,
    inputs: record.inputs,
    inputsHash: record.inputsHash,
    paramSnapshotHash: record.paramSnapshotHash,
    lines: record.lines.map((l) => ({
      line: l.line,
      amountMinor: minor(l.amountMinor),
      refundMinor: minor(l.refundMinor),
      retainedMinor: minor(l.retainedMinor),
    })),
    taxGroups: record.taxGroups.map((g) => ({
      groupId: g.groupId,
      thirdParty: g.thirdParty,
      taxPaidMinor: minor(g.taxPaidMinor),
      taxRefundMinor: minor(g.taxRefundMinor),
      retainedTaxMinor: minor(g.retainedTaxMinor),
    })),
    legs: record.legs.map((l) => ({
      leg: l.leg,
      keptMinor: minor(l.keptMinor),
      advanceMinor: minor(l.advanceMinor),
      basisMinor: minor(l.basisMinor),
      variationMinor: minor(l.variationMinor),
    })),
  };
}

/** Types d'opération monétaire de 08 E4. */
export const MONEY_OPERATION_TYPES = [
  'CAPTURE',
  'VOID',
  'REFUND',
  'MIT_CHARGE',
  'CREDIT_REISSUE',
  'DEPOSIT_CAPTURE',
  'DEPOSIT_VOID',
  'DEBT_COLLECTION',
] as const;
export type MoneyOperationType = (typeof MONEY_OPERATION_TYPES)[number];

export interface OperationKeyParts {
  readonly tripRef: string;
  readonly segmentNo: number;
  readonly version: number;
  readonly operation: MoneyOperationType;
  readonly tenderId: string;
  readonly instanceSeq: number;
  readonly attemptNo: number;
}

const KEY_PART = /^[A-Za-z0-9_-]{1,128}$/;
const positive = (n: number, name: string): number => {
  if (!Number.isSafeInteger(n) || n < 1) throw invalid(`${name} : entier ≥ 1 attendu`);
  return n;
};

/**
 * 08 E4 : `idem_plain = "{trip_id}:{segment_id}:v{version}:{operation}:{tender_id}:i{instance}:a{attempt}"`.
 * Aucun séparateur `:` dans les identifiants ; version ≥ 1 (le segment `v0-…` est réservé aux
 * opérations hors règlement).
 */
export function settlementOperationKey(parts: OperationKeyParts): string {
  if (!KEY_PART.test(parts.tripRef)) throw invalid('tripRef invalide');
  if (!KEY_PART.test(parts.tenderId)) throw invalid('tenderId invalide');
  if (!(MONEY_OPERATION_TYPES as readonly string[]).includes(parts.operation)) {
    throw invalid('type d’opération inconnu');
  }
  return [
    parts.tripRef,
    String(positive(parts.segmentNo, 'segmentNo')),
    `v${positive(parts.version, 'version')}`,
    parts.operation,
    parts.tenderId,
    `i${positive(parts.instanceSeq, 'instanceSeq')}`,
    `a${positive(parts.attemptNo, 'attemptNo')}`,
  ].join(':');
}

/** Longueur du condensé SHA-256 hexadécimal (08 E4 : « 64 caractères »). */
const SHA256_HEX_LENGTH = 64;

/**
 * Valeur transmise au PSP : la clé en clair si elle tient dans la limite, sinon son SHA-256
 * hexadécimal. Une limite inférieure à 64 est refusée : la valeur ne dépasse jamais la limite.
 */
export function pspIdempotencyValue(plain: string, maxLength: number): string {
  if (positive(maxLength, 'maxLength') < SHA256_HEX_LENGTH) {
    throw invalid('limite du PSP inférieure à 64 caractères : clé non transmissible');
  }
  return plain.length <= maxLength ? plain : sha256Hex(plain);
}
