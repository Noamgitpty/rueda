/**
 * US-402 (ADR-206, hypothèse H-IDEM) : décision de levée de la garde de reprise. Valeurs attendues
 * tirées de la règle écrite (ADR-206 §3) : levée seulement après rapprochement attesté, puis soit
 * relevé complet du PSP depuis T, soit (levée − T) + 1 h < W ; W inconnue = aucune garantie.
 */
import { describe, expect, it } from 'vitest';
import { RELEASE_MARGIN_S, releaseDecision } from './recovery.ts';

const T = Date.UTC(2099, 0, 1, 12, 0, 0);
const H = 3_600_000;
const base = {
  restoredToMs: T,
  nowMs: T + 2 * H,
  idempotencyWindowS: 24 * 3600,
  reconciledWithPsp: true,
  pspListingSinceRestore: false,
};

describe('US-402 — levée de la garde de reprise (H-IDEM)', () => {
  it('marge d’une heure (ADR-206)', () => {
    expect(RELEASE_MARGIN_S).toBe(3600);
  });

  it('rapprochement non attesté ⇒ refusée, même avec un relevé du PSP ou une fenêtre large', () => {
    for (const p of [false, true]) {
      expect(
        releaseDecision({ ...base, reconciledWithPsp: false, pspListingSinceRestore: p }),
      ).toEqual({ allowed: false, reason: 'NOT_RECONCILED' });
    }
  });

  it('fenêtre inconnue (absente, 0, négative, NaN) ⇒ refusée sans relevé du PSP ; relevé ⇒ levée', () => {
    for (const w of [null, 0, -1, Number.NaN]) {
      expect(releaseDecision({ ...base, idempotencyWindowS: w })).toEqual({
        allowed: false,
        reason: 'IDEMPOTENCY_WINDOW_UNKNOWN',
      });
      expect(
        releaseDecision({ ...base, idempotencyWindowS: w, pspListingSinceRestore: true }),
      ).toEqual({ allowed: true, basis: 'PSP_LISTING' });
    }
  });

  it('borne de la fenêtre : 24 h − 1 h ; levée à T + 22 h 59 acceptée, à T + 23 h refusée', () => {
    expect(releaseDecision({ ...base, nowMs: T + 23 * H - 1000 })).toEqual({
      allowed: true,
      basis: 'IDEMPOTENCY_WINDOW',
    });
    expect(releaseDecision({ ...base, nowMs: T + 23 * H })).toEqual({
      allowed: false,
      reason: 'IDEMPOTENCY_WINDOW_ELAPSED',
    });
    // restauration à un instant ancien (scénario « instant », T à J − 3) : refusée sans relevé
    expect(releaseDecision({ ...base, nowMs: T + 72 * H })).toEqual({
      allowed: false,
      reason: 'IDEMPOTENCY_WINDOW_ELAPSED',
    });
    expect(releaseDecision({ ...base, nowMs: T + 72 * H, pspListingSinceRestore: true })).toEqual({
      allowed: true,
      basis: 'PSP_LISTING',
    });
  });

  it('fenêtre plus courte que la marge, ou horloge avant T ⇒ refusée', () => {
    expect(releaseDecision({ ...base, idempotencyWindowS: 3000, nowMs: T + 1000 })).toEqual({
      allowed: false,
      reason: 'IDEMPOTENCY_WINDOW_ELAPSED',
    });
    expect(releaseDecision({ ...base, nowMs: T - 1000 })).toEqual({
      allowed: false,
      reason: 'IDEMPOTENCY_WINDOW_ELAPSED',
    });
  });
});
