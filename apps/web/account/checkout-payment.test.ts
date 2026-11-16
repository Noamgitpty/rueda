/**
 * US-223 partie 223b (ADR-142) : lecture défensive de la route du paiement par le site ; S06 ne
 * croit qu'un état connu, « confirmé » exige un trip né, la page hébergée n'est suivie que si l'API
 * rend une adresse https ; chaque code de refus a sa clé (typecheck des quatre catalogues).
 */
import { describe, expect, it } from 'vitest';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import {
  bookingReference,
  checkoutPaymentOf,
  PAYMENT_ERROR_CODES,
  paymentErrorKey,
} from './checkout-payment.ts';

const HOLD = '00000000-0000-4000-8000-0000000223b1';
const TRIP = '00000000-0000-4000-8000-0000000223d1';
const base = {
  holdId: HOLD,
  state: 'VERIFYING',
  holdStatus: 'PAYMENT_IN_FLIGHT',
  tripId: null,
  expiresAt: '2036-11-30T15:10:00.000Z',
  paymentInFlightUntil: '2036-11-30T15:12:00.000Z',
};
const reply = (payment: unknown, status = 200) => ({ status, json: { payment }, session: null });

describe('US-223b — paiement du hold (site)', () => {
  it('réponse bien formée : état, échéances ; adresse hébergée https seulement', () => {
    expect(
      checkoutPaymentOf(reply({ ...base, redirectUrl: 'https://psp.fake.invalid/pay/x' }, 201)),
    ).toEqual({
      holdId: HOLD,
      state: 'VERIFYING',
      tripId: null,
      expiresAt: base.expiresAt,
      paymentInFlightUntil: base.paymentInFlightUntil,
      redirectUrl: 'https://psp.fake.invalid/pay/x',
    });
    for (const url of ['http://psp.test/x', 'javascript:alert(1)', 'https://a b', 42]) {
      expect(checkoutPaymentOf(reply({ ...base, redirectUrl: url }, 201))?.redirectUrl).toBeNull();
    }
  });

  it('fail-closed : état inconnu, « confirmé » sans trip, identifiant ou instant illisible ⇒ refus', () => {
    expect(checkoutPaymentOf(reply({ ...base, state: 'PAID' }))).toBeNull();
    expect(checkoutPaymentOf(reply({ ...base, state: 'CONFIRMED' }))).toBeNull();
    expect(checkoutPaymentOf(reply({ ...base, state: 'CONFIRMED', tripId: TRIP }))?.state).toBe(
      'CONFIRMED',
    );
    expect(checkoutPaymentOf(reply({ ...base, holdId: 'x' }))).toBeNull();
    expect(checkoutPaymentOf(reply({ ...base, expiresAt: 'demain' }))).toBeNull();
    expect(checkoutPaymentOf(reply(base, 409))).toBeNull();
    expect(checkoutPaymentOf({ status: 'unavailable' })).toBeNull();
  });

  it('codes de refus : clé connue, sinon paiement indisponible ; aucun texte vide dans les quatre langues', () => {
    expect(
      paymentErrorKey({
        status: 409,
        json: { code: 'HOST_PAYOUT_RAIL_UNAVAILABLE' },
        session: null,
      }),
    ).toBe('common.payment.payoutRailUnavailable');
    expect(paymentErrorKey({ status: 503, json: { code: 'INCONNU' }, session: null })).toBe(
      'common.payment.unavailable',
    );
    expect(paymentErrorKey({ status: 'unavailable' })).toBe('common.payment.unavailable');
    // chaque locale déclarée (aucune locale de pays écrite ici, ADR-024)
    for (const { tag } of LOCALE_CONFIG.locales) {
      const t = createTranslator(getProfile(LOCALE_CONFIG, tag));
      for (const code of PAYMENT_ERROR_CODES) {
        const key = paymentErrorKey({ status: 409, json: { code }, session: null });
        expect(t.t(key).length).toBeGreaterThan(0);
      }
    }
  });

  it('numéro de réservation : huit premiers caractères du hold, en majuscules', () => {
    expect(bookingReference('abcdef12-0000-4000-8000-000000000000')).toBe('ABCDEF12');
  });
});
