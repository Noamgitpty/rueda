/**
 * Clés d'idempotence des opérations monétaires (08 E4 ; 17 §2.8, §4.3 point 2).
 *
 * - `idem_plain` est toujours stocké ; la valeur transmise au PSP (`idem_sent`) est `idem_plain`
 *   si sa longueur respecte `IDEMPOTENCY_KEY_MAX_LEN`, sinon `hex(sha256(idem_plain))` (64 car.).
 *   Limite inconnue (0, capacité non validée) ⇒ toujours le condensé (17 §2.8).
 * - `instance_seq` et `attempt_no` sont attribués sous le verrou du trip AVANT l'envoi ;
 *   `attempt_no` + 1 seulement après un refus REÇU ; un délai dépassé rejoue la MÊME clé (T51,
 *   T52, T68). Ce module ne fait que composer les clés : il ne décide pas du rang.
 */
import { createHash } from 'node:crypto';
import { PaymentError } from './errors.js';

/** Types d'opération de la clé de règlement (08 E4). */
export const SETTLEMENT_OPERATION_TYPES = [
  'CAPTURE',
  'VOID',
  'REFUND',
  'MIT_CHARGE',
  'CREDIT_REISSUE',
  'DEPOSIT_CAPTURE',
  'DEPOSIT_VOID',
  'DEBT_COLLECTION',
] as const;
export type SettlementOperationType = (typeof SETTLEMENT_OPERATION_TYPES)[number];

/** Opérations d'un hold, avant le trip (variante 1 de 08 E4). */
export const HOLD_OPERATION_TYPES = ['AUTH', 'CAPTURE', 'VOID'] as const;
export type HoldOperationType = (typeof HOLD_OPERATION_TYPES)[number];

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

function part(name: string, value: string): string {
  if (!SEGMENT.test(value)) {
    throw new PaymentError('INVALID_REQUEST', `clé d'idempotence : ${name} invalide`);
  }
  return value;
}

function rank(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PaymentError('INVALID_REQUEST', `clé d'idempotence : ${name} entier ≥ 1 attendu`);
  }
  return value;
}

export interface SettlementKeyParts {
  readonly tripId: string;
  readonly segmentId: string;
  readonly settlementVersion: number;
  readonly operationType: SettlementOperationType;
  readonly tenderId: string;
  readonly instanceSeq: number;
  readonly attemptNo: number;
}

/** `{trip_id}:{segment_id}:v{version}:{operation_type}:{tender_id}:i{instance_seq}:a{attempt_no}`. */
export function settlementOperationKey(p: SettlementKeyParts): string {
  if (!(SETTLEMENT_OPERATION_TYPES as readonly string[]).includes(p.operationType)) {
    throw new PaymentError('INVALID_REQUEST', `type d'opération inconnu : ${p.operationType}`);
  }
  return [
    part('trip_id', p.tripId),
    part('segment_id', p.segmentId),
    `v${rank('settlement_version', p.settlementVersion)}`,
    p.operationType,
    part('tender_id', p.tenderId),
    `i${rank('instance_seq', p.instanceSeq)}`,
    `a${rank('attempt_no', p.attemptNo)}`,
  ].join(':');
}

/** Variante pré-trip : `hold:{hold_id}:{AUTH | CAPTURE | VOID}:a{attempt_no}` (jamais hold_id seul). */
export function holdAttemptKey(
  holdId: string,
  operation: HoldOperationType,
  attemptNo: number,
): string {
  if (!(HOLD_OPERATION_TYPES as readonly string[]).includes(operation)) {
    throw new PaymentError('INVALID_REQUEST', `opération de hold inconnue : ${operation}`);
  }
  return `hold:${part('hold_id', holdId)}:${operation}:a${rank('attempt_no', attemptNo)}`;
}

/**
 * Variante hors règlement (caution, surfacturation de dommage, révision d'un frais annexe) :
 * `{trip_id}:{segment_id}:v0-{origin_type}-{origin_id}:REFUND:{tender_id}:i{n}:a{m}` ; le segment
 * `v0-…` ne peut entrer en collision avec une version de règlement.
 */
export function offSettlementRefundKey(p: {
  readonly tripId: string;
  readonly segmentId: string;
  readonly originType: 'DEPOSIT' | 'DAMAGE_OVERCHARGE' | 'INCIDENTAL_REVISION';
  readonly originId: string;
  readonly tenderId: string;
  readonly instanceSeq: number;
  readonly attemptNo: number;
}): string {
  return [
    part('trip_id', p.tripId),
    part('segment_id', p.segmentId),
    `v0-${p.originType}-${part('origin_id', p.originId)}`,
    'REFUND',
    part('tender_id', p.tenderId),
    `i${rank('instance_seq', p.instanceSeq)}`,
    `a${rank('attempt_no', p.attemptNo)}`,
  ].join(':');
}

/** Compensation de hold : `hold:{hold_id}:v0-HOLD_COMPENSATION:REFUND:{operation_id}:i{n}:a{m}`. */
export function holdCompensationRefundKey(p: {
  readonly holdId: string;
  readonly operationId: string;
  readonly instanceSeq: number;
  readonly attemptNo: number;
}): string {
  return [
    'hold',
    part('hold_id', p.holdId),
    'v0-HOLD_COMPENSATION',
    'REFUND',
    part('operation_id', p.operationId),
    `i${rank('instance_seq', p.instanceSeq)}`,
    `a${rank('attempt_no', p.attemptNo)}`,
  ].join(':');
}

/** `idem_sent` : la clé elle-même si `maxLen` connue (> 0) et respectée, sinon son SHA-256 hex. */
export function idempotencyKeyToSend(idemPlain: string, maxLen: number): string {
  if (idemPlain === '' || idemPlain.length > 512) {
    throw new PaymentError('INVALID_REQUEST', "clé d'idempotence vide ou trop longue");
  }
  if (Number.isSafeInteger(maxLen) && maxLen > 0 && idemPlain.length <= maxLen) return idemPlain;
  return createHash('sha256').update(idemPlain, 'utf8').digest('hex');
}

/** Clé de la tentative suivante (même instance, `attempt_no` + 1) après un refus REÇU. */
export function nextAttemptKey(idemPlain: string): string {
  const match = /^(.*:a)(\d+)$/.exec(idemPlain);
  if (!match)
    throw new PaymentError('INVALID_REQUEST', `clé sans rang de tentative : ${idemPlain}`);
  return `${match[1]}${Number(match[2]) + 1}`;
}
