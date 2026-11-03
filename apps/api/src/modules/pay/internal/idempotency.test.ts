/**
 * Clés d'idempotence (08 E4) : formes attendues tirées des contrôles des oracles T51, T52, T68
 * (`@rueda/money/golden-vectors`, jamais du code testé).
 */
import { createHash } from 'node:crypto';
import { checksFor, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenValue } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import {
  holdAttemptKey,
  holdCompensationRefundKey,
  idempotencyKeyToSend,
  nextAttemptKey,
  offSettlementRefundKey,
  settlementOperationKey,
} from './idempotency.js';

const set = loadGoldenVectors();
const check = (vectorId: string, label: RegExp): GoldenValue => {
  const found = checksFor(set, vectorId).find((c) => label.test(c.label));
  if (found === undefined) throw new Error(`contrôle ${vectorId} ${label} absent`);
  return found.expected;
};

describe('clés de règlement (08 E4)', () => {
  it('T51 : rejeu du remboursement en délai dépassé ⇒ même clé …:v1:REFUND:card:i1:a1', () => {
    const expected = (check('T51', /rejeu/) as GoldenValue[])[2];
    expect(
      settlementOperationKey({
        tripId: 'A',
        segmentId: '1',
        settlementVersion: 1,
        operationType: 'REFUND',
        tenderId: 'card',
        instanceSeq: 1,
        attemptNo: 1,
      }),
    ).toBe(expected);
  });

  it('T52 : nouvelle tentative après échec reçu ⇒ attempt_no = 2, même instance', () => {
    const expected = (check('T52', /cle a2/) as GoldenValue[])[0];
    const a1 = settlementOperationKey({
      tripId: 'A',
      segmentId: '1',
      settlementVersion: 1,
      operationType: 'REFUND',
      tenderId: 'yappy',
      instanceSeq: 1,
      attemptNo: 1,
    });
    expect(nextAttemptKey(a1)).toBe(expected);
  });

  it('T68 : a1 refusé, a2 en délai dépassé rejoué à l’identique, a3 accepté', () => {
    const expected = check('T68', /^T68 cles$/) as GoldenValue[];
    const a1 = settlementOperationKey({
      tripId: 'A',
      segmentId: '1',
      settlementVersion: 1,
      operationType: 'MIT_CHARGE',
      tenderId: 'card',
      instanceSeq: 1,
      attemptNo: 1,
    });
    const a2 = nextAttemptKey(a1); // après le refus reçu de J0
    const replay = a2; // délai dépassé : la même clé, rien n'est incrémenté
    const a3 = nextAttemptKey(replay); // après le refus reçu au rejeu de J+3
    expect([a1, a2, replay, a3]).toEqual(expected);
  });

  it('composants invalides (séparateur, vide, rang < 1) ⇒ INVALID_REQUEST', () => {
    const base = {
      tripId: 'A',
      segmentId: '1',
      settlementVersion: 1,
      operationType: 'REFUND' as const,
      tenderId: 'card',
      instanceSeq: 1,
      attemptNo: 1,
    };
    for (const bad of [
      { tripId: 'a:b' },
      { tenderId: '' },
      { instanceSeq: 0 },
      { attemptNo: 1.5 },
      { settlementVersion: 0 },
      { operationType: 'PAYOUT' as unknown as 'REFUND' },
    ]) {
      expect(() => settlementOperationKey({ ...base, ...bad })).toThrow(/INVALID|clé|type/);
    }
  });
});

describe('variantes (08 E4, consolidé 17-C08-8)', () => {
  it('pré-trip : une clé par tentative, jamais hold_id seul', () => {
    expect(holdAttemptKey('h1', 'AUTH', 1)).toBe('hold:h1:AUTH:a1');
    expect(nextAttemptKey(holdAttemptKey('h1', 'CAPTURE', 2))).toBe('hold:h1:CAPTURE:a3');
  });

  it('hors règlement et compensation de hold : segment v0-… sans collision avec v1, v2…', () => {
    const off = offSettlementRefundKey({
      tripId: 'A',
      segmentId: '1',
      originType: 'DEPOSIT',
      originId: 'd1',
      tenderId: 'card',
      instanceSeq: 1,
      attemptNo: 1,
    });
    expect(off).toBe('A:1:v0-DEPOSIT-d1:REFUND:card:i1:a1');
    expect(off.split(':')[2]).not.toMatch(/^v[1-9]/);
    expect(
      holdCompensationRefundKey({ holdId: 'h1', operationId: 'op1', instanceSeq: 1, attemptNo: 2 }),
    ).toBe('hold:h1:v0-HOLD_COMPENSATION:REFUND:op1:i1:a2');
  });
});

describe('valeur transmise au PSP (idem_sent, 17 §2.8 IDEMPOTENCY_KEY_MAX_LEN)', () => {
  const plain = 'A:1:v1:REFUND:card:i1:a1';
  const digest = createHash('sha256').update(plain, 'utf8').digest('hex');

  it('limite connue et respectée ⇒ la clé elle-même', () => {
    expect(idempotencyKeyToSend(plain, 64)).toBe(plain);
    expect(idempotencyKeyToSend(plain, plain.length)).toBe(plain);
  });

  it('limite dépassée ou inconnue (0) ⇒ hex(sha256(idem_plain)), 64 caractères', () => {
    expect(idempotencyKeyToSend(plain, plain.length - 1)).toBe(digest);
    expect(idempotencyKeyToSend(plain, 0)).toBe(digest);
    expect(digest).toHaveLength(64);
  });

  it('clé vide ⇒ refus', () => {
    expect(() => idempotencyKeyToSend('', 64)).toThrow();
  });
});
