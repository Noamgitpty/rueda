/**
 * BOARD N-13 (a), ADR-090 décision 2, ADR-145 : le service appelant du moteur attrape
 * `REFUND_OUT_OF_RANGE`, n'écrit rien, lève une alerte FIN sans identifiant et rend le contexte.
 * Le refus réel du moteur (contre-exemple de la graine -1546341607 : remboursement −2 pour un total
 * de 2, en PYG) est prouvé dans `packages/money/test/settlement/payable-amounts.test.ts` ; ici, le
 * contexte de l'erreur est recopié de ce test (montants de l'oracle, devise remplacée par le code
 * de test ISO 4217 `XTS`), jamais recalculé. Pays fictifs (aucune constante de pays, ADR-024).
 */
import { SettlementError } from '@rueda/money';
import { describe, expect, it } from 'vitest';
import { assertSafeAlert } from '../../bus/index.js';
import type { AlertChannel, OpsAlert } from '../../bus/index.js';
import { settleOrFinReview } from './settlement-review.js';

/** Canal qui garde les alertes après le contrôle de production (`assertSafeAlert`). */
class FakeAlertChannel implements AlertChannel {
  readonly sent: OpsAlert[] = [];
  failing = false;

  send(alert: OpsAlert): Promise<void> {
    assertSafeAlert(alert);
    if (this.failing) return Promise.reject(new Error('canal d’alerte indisponible'));
    this.sent.push(alert);
    return Promise.resolve();
  }
}

const DETAILS = {
  engineVersion: 'cxl-beta/1',
  currency: 'XTS',
  reason: 'GUEST_NO_SHOW',
  guestRefundMinor: '-2',
  totalPaidMinor: '2',
  retainedMinor: '2',
  taxRefundMinor: '-1',
  taxGroupId: 'g',
};

describe('settleOrFinReview (N-13 a)', () => {
  it.each(['XA', 'XB'])(
    '%s : REFUND_OUT_OF_RANGE ⇒ FIN_REVIEW, contexte rendu, alerte P1 sans identifiant',
    async (country) => {
      const alerts = new FakeAlertChannel();
      const attempt = await settleOrFinReview(
        () => {
          throw new SettlementError('REFUND_OUT_OF_RANGE', 'remboursement hors bornes', DETAILS);
        },
        country,
        alerts,
      );
      expect(attempt).toEqual({
        outcome: 'FIN_REVIEW',
        code: 'REFUND_OUT_OF_RANGE',
        details: DETAILS,
      });
      expect(alerts.sent).toEqual([
        {
          code: 'FIN_SETTLEMENT_REVIEW',
          severity: 'P1',
          counts: { settlements: 1 },
          labels: { country, error_code: 'REFUND_OUT_OF_RANGE' },
        },
      ]);
      // aucune donnée de l'erreur ni du trip dans l'alerte
      expect(JSON.stringify(alerts.sent)).not.toMatch(/-2|XTS|GUEST_NO_SHOW/);
    },
  );

  it('règlement produit ⇒ SETTLED, aucune alerte', async () => {
    const alerts = new FakeAlertChannel();
    const attempt = await settleOrFinReview(() => ({ version: 1 }), 'XA', alerts);
    expect(attempt).toEqual({ outcome: 'SETTLED', result: { version: 1 } });
    expect(alerts.sent).toEqual([]);
  });

  it('autre refus du moteur, ou erreur quelconque ⇒ relancé tel quel, aucune alerte', async () => {
    const alerts = new FakeAlertChannel();
    const other = new SettlementError('SETTLEMENT_INPUT_INVALID', 'entrée invalide');
    await expect(
      settleOrFinReview(
        () => {
          throw other;
        },
        'XB',
        alerts,
      ),
    ).rejects.toBe(other);
    await expect(
      settleOrFinReview(
        () => {
          throw new Error('panne');
        },
        'XB',
        alerts,
      ),
    ).rejects.toThrow('panne');
    expect(alerts.sent).toEqual([]);
  });

  it('canal d’alerte en panne ⇒ l’erreur remonte (la revue FIN n’est jamais perdue en silence)', async () => {
    const alerts = new FakeAlertChannel();
    alerts.failing = true;
    await expect(
      settleOrFinReview(
        () => {
          throw new SettlementError('REFUND_OUT_OF_RANGE', 'hors bornes', DETAILS);
        },
        'XA',
        alerts,
      ),
    ).rejects.toThrow('canal');
  });

  it('pays mal formé ⇒ refus avant tout calcul', async () => {
    let called = false;
    await expect(
      settleOrFinReview(
        () => {
          called = true;
          return 1;
        },
        'x1',
        new FakeAlertChannel(),
      ),
    ).rejects.toThrow('pays');
    expect(called).toBe(false);
  });
});
