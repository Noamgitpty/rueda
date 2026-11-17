/**
 * US-223 partie 223b (ADR-142) : lecture du corps du paiement (le client n'envoie que le moyen,
 * L2-PM-03), état du paiement dérivé du hold et du trip né (10b UX-27 : jamais « confirmé » sans
 * trip), traduction des refus de la base (mêmes couples SQLSTATE / contrainte que
 * `packages/db/src/errors.ts`) et journal sans valeur.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentError } from '../../../pay/index.js';
import {
  LOG_PAYMENT_FAILURE,
  parsePaymentDemand,
  PAYMENT_STATES,
  paymentStateOf,
} from './payment.service.js';
import { paymentRefusalOf } from './payment-store.js';
import type { CheckoutPaymentRow } from './payment-store.js';

const ROW: CheckoutPaymentRow = {
  holdStatus: 'ACTIVE',
  tripId: null,
  expiresAt: '2036-11-30T15:10:00.000Z',
  paymentInFlightUntil: null,
  operationStatus: null,
  // US-223c : hold CHECKOUT (aucune demande à l'hôte)
  request: null,
};

describe('US-223b — paiement du hold (unitaires)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('corps : seulement `method` (défaut CARD) ; montant, jambe, champ inconnu ou moyen inconnu ⇒ refus', () => {
    expect(parsePaymentDemand(undefined)).toBe('CARD');
    expect(parsePaymentDemand({})).toBe('CARD');
    expect(parsePaymentDemand({ method: 'YAPPY' })).toBe('YAPPY');
    for (const body of [
      { amountMinor: '100' },
      { method: 'CARD', legs: {} },
      { method: 'card' },
      { method: 1 },
      [],
      'CARD',
    ]) {
      expect(parsePaymentDemand(body)).toBeNull();
    }
  });

  it('état : CONFIRMED seulement si CONVERTED avec un trip ; un SUCCEEDED sans conversion reste VERIFYING', () => {
    expect(paymentStateOf({ ...ROW, holdStatus: 'CONVERTED', tripId: 't' })).toBe('CONFIRMED');
    expect(paymentStateOf({ ...ROW, holdStatus: 'CONVERTED' })).toBe('VERIFYING');
    expect(
      paymentStateOf({ ...ROW, holdStatus: 'PAYMENT_IN_FLIGHT', operationStatus: 'SUCCEEDED' }),
    ).toBe('VERIFYING');
    expect(paymentStateOf({ ...ROW, operationStatus: 'SUCCEEDED' })).toBe('VERIFYING');
    expect(paymentStateOf({ ...ROW, operationStatus: 'FAILED' })).toBe('DECLINED');
    expect(paymentStateOf(ROW)).toBe('PAYABLE');
    expect(paymentStateOf({ ...ROW, holdStatus: 'COMPENSATED' })).toBe('REFUND_DUE');
    expect(paymentStateOf({ ...ROW, holdStatus: 'EXPIRED', operationStatus: 'UNKNOWN' })).toBe(
      'UNPROVEN',
    );
    expect(paymentStateOf({ ...ROW, holdStatus: 'RELEASED', operationStatus: 'FAILED' })).toBe(
      'ENDED',
    );
    expect(() => paymentStateOf({ ...ROW, holdStatus: 'NOUVEAU' })).toThrow();
  });

  it('table de vérité : chaque statut d’opération de 0005 sur chaque état du hold ; seul CONVERTED + trip confirme ; un statut inconnu ne confirme jamais', () => {
    const ops = [null, 'PENDING', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN'] as const;
    const expected: Record<string, readonly string[]> = {
      ACTIVE: ['PAYABLE', 'VERIFYING', 'VERIFYING', 'VERIFYING', 'DECLINED', 'VERIFYING'],
      PAYMENT_IN_FLIGHT: [
        'VERIFYING',
        'INTERRUPTED',
        'VERIFYING',
        'VERIFYING',
        'VERIFYING',
        'VERIFYING',
      ],
      COMPENSATED: ops.map(() => 'REFUND_DUE'),
      EXPIRED: ['ENDED', 'UNPROVEN', 'UNPROVEN', 'UNPROVEN', 'ENDED', 'UNPROVEN'],
      RELEASED: ['ENDED', 'UNPROVEN', 'UNPROVEN', 'UNPROVEN', 'ENDED', 'UNPROVEN'],
    };
    for (const [holdStatus, states] of Object.entries(expected)) {
      ops.forEach((operationStatus, i) => {
        expect(
          paymentStateOf({ ...ROW, holdStatus, operationStatus }),
          `${holdStatus}/${operationStatus}`,
        ).toBe(states[i]);
      });
    }
    for (const operationStatus of ops) {
      expect(paymentStateOf({ ...ROW, holdStatus: 'CONVERTED', operationStatus })).toBe(
        'VERIFYING',
      );
      expect(
        paymentStateOf({ ...ROW, holdStatus: 'CONVERTED', tripId: 't', operationStatus }),
      ).toBe('CONFIRMED');
    }
  });

  it('états identiques à l’énumération du contrat (openapi.json, CheckoutPaymentState)', () => {
    const doc = JSON.parse(
      readFileSync(new URL('../../../../../openapi/openapi.json', import.meta.url), 'utf8'),
    ) as { components: { schemas: { CheckoutPaymentState: { enum: string[] } } } };
    expect(doc.components.schemas.CheckoutPaymentState.enum).toEqual([...PAYMENT_STATES]);
  });

  it('refus de la base : couple (SQLSTATE, contrainte) exact, sinon panne (null)', () => {
    expect(paymentRefusalOf({ code: '55000', constraint: 'host_payout_rail_unavailable' })).toBe(
      'HOST_PAYOUT_RAIL_UNAVAILABLE',
    );
    expect(paymentRefusalOf({ code: '23514', constraint: 'hold_review_before_payment' })).toBe(
      'BOOKING_UNDER_REVIEW',
    );
    expect(paymentRefusalOf({ code: '55000', constraint: 'hold_not_payable' })).toBe(
      'HOLD_EXPIRED',
    );
    expect(paymentRefusalOf({ code: '23000', constraint: 'psp_account_fake_forbidden' })).toBe(
      'PAYMENT_UNAVAILABLE',
    );
    // même contrainte, autre SQLSTATE ; contrainte inconnue ; pas une erreur de la base
    expect(paymentRefusalOf({ code: '23514', constraint: 'hold_not_payable' })).toBeNull();
    expect(paymentRefusalOf({ code: '55000', constraint: 'toString' })).toBeNull();
    expect(paymentRefusalOf(new Error('x'))).toBeNull();
  });

  it('journal : opération, nom, SQLSTATE et code PSP seulement, jamais le message', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      lines.push(line);
    });
    LOG_PAYMENT_FAILURE('psp', new PaymentError('UNKNOWN_OUTCOME', 'secret 4111 1111'));
    LOG_PAYMENT_FAILURE('start', Object.assign(new Error('valeur privée'), { code: '40001' }));
    expect(lines.map((l) => JSON.parse(l) as unknown)).toEqual([
      {
        level: 'error',
        event: 'checkout.payment_failed',
        operation: 'psp',
        errorName: 'PaymentError',
        sqlState: null,
        pspCode: 'UNKNOWN_OUTCOME',
      },
      {
        level: 'error',
        event: 'checkout.payment_failed',
        operation: 'start',
        errorName: 'Error',
        sqlState: '40001',
        pspCode: null,
      },
    ]);
    expect(lines.join('')).not.toContain('secret');
    expect(lines.join('')).not.toContain('privée');
  });
});
