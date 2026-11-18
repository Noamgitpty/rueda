/**
 * US-223 partie 223b (ADR-142) : lecture défensive de la route du paiement par le site ; S06 ne
 * croit qu'un état connu, « confirmé » exige un trip né, la page hébergée n'est suivie que si l'API
 * rend une adresse https ; chaque code de refus a sa clé (typecheck des quatre catalogues).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import {
  bookingReference,
  checkoutPaymentOf,
  localSlotOf,
  PAYMENT_ERROR_CODES,
  PAYMENT_STATES,
  paymentErrorKey,
  REQUEST_STATUSES,
  requestScreenOf,
} from './checkout-payment.ts';
import type { CheckoutPaymentView } from './checkout-payment.ts';

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
      // US-223d : réservation immédiate (aucun champ `request`) ⇒ `null`
      request: null,
      // US-701 : aucun champ `deposit` ⇒ `null`
      deposit: null,
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
  it('états du site identiques à l’énumération du contrat (openapi.json, CheckoutPaymentState)', () => {
    const doc = JSON.parse(
      readFileSync(new URL('../../api/openapi/openapi.json', import.meta.url), 'utf8'),
    ) as { components: { schemas: { CheckoutPaymentState: { enum: string[] } } } };
    expect(doc.components.schemas.CheckoutPaymentState.enum).toEqual([...PAYMENT_STATES]);
  });

  it('double de l’API (e2e/stub-api.mjs) : chaque état du contrat est rendu par sa table', () => {
    const stub = readFileSync(new URL('../e2e/stub-api.mjs', import.meta.url), 'utf8');
    const start = stub.indexOf('const paymentStateOf = (h) => {');
    const body = stub.slice(start, stub.indexOf('};', start));
    expect(start).toBeGreaterThan(0);
    for (const state of PAYMENT_STATES.filter((s) => s !== 'PAYABLE')) {
      expect(body, state).toContain(`'${state}'`);
    }
    expect(body).toContain("'PAYABLE'");
  });
});

/**
 * US-223 partie 223d (ADR-152) : champ `request` du paiement (hold REQUEST, ADR-146 §9) et écran
 * dédié du voyageur. Attendus : énumération du contrat (openapi.json, CheckoutRequestState) et
 * table de 0126 (`core.booking_checkout_request`) recopiée par ADR-146 §9, jamais le code testé.
 */
describe('US-223d — demande à l’hôte (site)', () => {
  const RESPOND_BY = '2036-11-30T19:10:00.000Z';
  const view = (
    state: CheckoutPaymentView['state'],
    status: (typeof REQUEST_STATUSES)[number] | null,
  ): CheckoutPaymentView => ({
    holdId: HOLD,
    state,
    tripId: state === 'CONFIRMED' ? TRIP : null,
    expiresAt: base.expiresAt,
    paymentInFlightUntil: null,
    redirectUrl: null,
    request: status === null ? null : { status, respondBy: RESPOND_BY },
    deposit: null,
  });

  it('champ `request` : lu tel quel ; absent ⇒ null ; état inconnu, heure illisible ou attente sans heure limite ⇒ refus', () => {
    expect(
      checkoutPaymentOf(
        reply({ ...base, request: { status: 'AWAITING_HOST', respondBy: RESPOND_BY } }),
      )?.request,
    ).toEqual({ status: 'AWAITING_HOST', respondBy: RESPOND_BY });
    expect(
      checkoutPaymentOf(reply({ ...base, request: { status: 'AUTHORIZING', respondBy: null } }))
        ?.request,
    ).toEqual({ status: 'AUTHORIZING', respondBy: null });
    expect(checkoutPaymentOf(reply(base))?.request).toBeNull();
    for (const request of [
      null,
      'AWAITING_HOST',
      { status: 'PENDING', respondBy: RESPOND_BY },
      { status: 'AWAITING_HOST', respondBy: 'demain' },
      { status: 'AWAITING_HOST', respondBy: null },
      { status: 'CAPTURING', respondBy: null },
      { status: 'DECLINED' },
    ]) {
      expect(checkoutPaymentOf(reply({ ...base, request })), JSON.stringify(request)).toBeNull();
    }
  });

  it('états de la demande identiques à l’énumération du contrat (openapi.json, CheckoutRequestState)', () => {
    const doc = JSON.parse(
      readFileSync(new URL('../../api/openapi/openapi.json', import.meta.url), 'utf8'),
    ) as {
      components: {
        schemas: { CheckoutRequestState: { properties: { status: { enum: string[] } } } };
      };
    };
    expect(doc.components.schemas.CheckoutRequestState.properties.status.enum).toEqual([
      ...REQUEST_STATUSES,
    ]);
  });

  it('écran dédié : envoyée et acceptée seulement en VERIFYING, terminées seulement en ENDED ; sinon l’état du paiement fait foi', () => {
    expect(requestScreenOf(view('VERIFYING', null))).toBeNull();
    expect(requestScreenOf(view('VERIFYING', 'AWAITING_HOST'))).toBe('REQUEST_SENT');
    expect(requestScreenOf(view('VERIFYING', 'CAPTURING'))).toBe('REQUEST_CAPTURING');
    expect(requestScreenOf(view('VERIFYING', 'AUTHORIZING'))).toBeNull();
    expect(requestScreenOf(view('ENDED', 'DECLINED'))).toBe('REQUEST_DECLINED');
    expect(requestScreenOf(view('ENDED', 'EXPIRED'))).toBe('REQUEST_EXPIRED');
    expect(requestScreenOf(view('ENDED', 'CAPTURE_FAILED'))).toBe('REQUEST_CAPTURE_FAILED');
    // sortie avant l'envoi : écran « expirée » ordinaire
    expect(requestScreenOf(view('ENDED', 'ENDED'))).toBeNull();
    expect(requestScreenOf(view('CONFIRMED', 'ACCEPTED'))).toBeNull();
    expect(requestScreenOf(view('REFUND_DUE', 'COMPENSATED'))).toBeNull();
    expect(requestScreenOf(view('DECLINED', 'AUTHORIZING'))).toBeNull();
    // combinaisons incohérentes : jamais « envoyée » si un paiement est possible, jamais
    // « refusée » si l'API ne dit pas « aucun débit »
    expect(requestScreenOf(view('PAYABLE', 'AWAITING_HOST'))).toBeNull();
    expect(requestScreenOf(view('UNPROVEN', 'DECLINED'))).toBeNull();
    expect(requestScreenOf(view('VERIFYING', 'DECLINED'))).toBeNull();
  });

  it('créneau local de la recherche : heure du fuseau du véhicule (fuseaux fixes UTC−5 et UTC−3, aucun pays écrit) ; fuseau ou instant illisible ⇒ null', () => {
    expect(localSlotOf('2036-12-23T15:00:00.000Z', 'Etc/GMT+5')).toBe('2036-12-23T10:00');
    expect(localSlotOf('2036-12-23T13:00:00.000Z', 'Etc/GMT+3')).toBe('2036-12-23T10:00');
    expect(localSlotOf('2036-12-24T02:30:00.000Z', 'Etc/GMT+5')).toBe('2036-12-23T21:30');
    expect(localSlotOf('2036-12-23T10:00:00.000Z', 'UTC')).toBe('2036-12-23T10:00');
    expect(localSlotOf('2036-12-23T10:00:00.000Z', 'Pas/Un_Fuseau')).toBeNull();
    expect(localSlotOf('demain', 'UTC')).toBeNull();
  });

  it('double de l’API (e2e/stub-api.mjs) : chaque état de la demande est rendu par sa table', () => {
    const stub = readFileSync(new URL('../e2e/stub-api.mjs', import.meta.url), 'utf8');
    const start = stub.indexOf('const requestStatusOf = (h) => {');
    const body = stub.slice(start, stub.indexOf('};', start));
    expect(start).toBeGreaterThan(0);
    for (const status of REQUEST_STATUSES) expect(body, status).toContain(`'${status}'`);
  });

  it('textes du voyageur présents et sans variable restante dans les quatre langues', () => {
    for (const tag of LOCALE_CONFIG.locales.map((l) => l.tag)) {
      const t = createTranslator(getProfile(LOCALE_CONFIG, tag)).t;
      for (const [key, values] of [
        ['web.s07.request.title', {}],
        ['web.s07.request.pending', { host_name: 'Ana', time: '19:10' }],
        ['web.s07.request.capturing.body', { host_name: 'Ana' }],
        ['web.error.requestDeclined', { host_name: 'Ana' }],
        ['web.error.requestExpired', { host_name: 'Ana' }],
        ['web.s06.request.captureFailed.body', {}],
        ['web.s05.request.authorize', { amount: '128,40', host_name: 'Ana' }],
        ['web.s05.ctaRequest', {}],
      ] as const) {
        const text = t(key, values);
        expect(text.trim(), `${tag} ${key}`).not.toBe('');
        expect(text, `${tag} ${key}`).not.toMatch(/[{}]/);
      }
    }
  });
});
