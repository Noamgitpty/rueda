/**
 * US-701 (ADR-169) : caution lue par S05 dans la réponse du paiement. Attendus : contrat
 * (`openapi.json`, `CheckoutDeposit`) et 08 BR-PAY-06 (« le voyageur ne voit que le montant… jamais
 * les déclencheurs ») ; message du refus (suite S-8 d'US-225 ; 10b UX-24) : au moins un jour
 * possible ⇒ `web.deposit.unavailable`, 0 ou aucun ⇒ `web.deposit.unavailableNone`. Montant de test
 * 300,00 de T57 en devise à deux décimales (XTS, 30 000) et sans décimale (XXX, 300), codes de test ISO 4217, jamais le code testé.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { checkoutPaymentOf, depositRefusalMessage, paymentErrorKey } from './checkout-payment.ts';

const base = {
  holdId: '00000000-0000-4000-8000-0000000701b1',
  state: 'PAYABLE',
  holdStatus: 'ACTIVE',
  tripId: null,
  expiresAt: '2036-11-30T15:10:00.000Z',
  paymentInFlightUntil: null,
};
const reply = (deposit: unknown) => ({
  status: 200,
  json: { payment: { ...base, deposit } },
  session: null,
});
const RELEASE = '2036-12-06T15:00:00.000Z';

describe('US-701 — caution sur S05 (site)', () => {
  for (const [currency, amount] of [
    ['XTS', 30_000n],
    ['XXX', 300n],
  ] as const) {
    it(`caution exigée (${currency}) : montant, nature et libération lus tels quels`, () => {
      expect(
        checkoutPaymentOf(
          reply({
            status: 'REQUIRED',
            amountMinor: String(amount),
            currency,
            kind: 'HOLD',
            releaseAt: RELEASE,
          }),
        )?.deposit,
      ).toEqual({
        status: 'REQUIRED',
        amountMinor: amount,
        currency,
        kind: 'HOLD',
        releaseAt: RELEASE,
      });
    });
  }

  it('aucune caution ⇒ NONE ; champ absent ⇒ null ; refus ⇒ jours possibles (ou null)', () => {
    expect(checkoutPaymentOf(reply({ status: 'NONE' }))?.deposit).toEqual({ status: 'NONE' });
    expect(checkoutPaymentOf(reply(undefined))?.deposit).toBeNull();
    expect(
      checkoutPaymentOf(reply({ status: 'UNAVAILABLE', maxBookableDays: 3 }))?.deposit,
    ).toEqual({ status: 'UNAVAILABLE', maxBookableDays: 3 });
    expect(
      checkoutPaymentOf(reply({ status: 'UNAVAILABLE', maxBookableDays: null }))?.deposit,
    ).toEqual({ status: 'UNAVAILABLE', maxBookableDays: null });
  });

  it('fail-closed : champ [C2] (déclencheurs, âge), montant nul ou illisible, nature ou statut inconnus ⇒ réponse refusée', () => {
    for (const deposit of [
      { status: 'NONE', triggers: ['RISK'] },
      {
        status: 'REQUIRED',
        amountMinor: '30000',
        currency: 'XTS',
        kind: 'HOLD',
        releaseAt: RELEASE,
        triggers: ['CLASS'],
      },
      { status: 'REQUIRED', amountMinor: '0', currency: 'XTS', kind: 'HOLD', releaseAt: RELEASE },
      { status: 'REQUIRED', amountMinor: 300, currency: 'XXX', kind: 'HOLD', releaseAt: RELEASE },
      { status: 'REQUIRED', amountMinor: '300', currency: 'XXX', kind: 'AUTO', releaseAt: RELEASE },
      { status: 'REQUIRED', amountMinor: '300', currency: 'XXX', kind: 'HOLD', releaseAt: 'x' },
      { status: 'UNAVAILABLE', maxBookableDays: -1 },
      { status: 'UNAVAILABLE', maxBookableDays: 2.5 },
      { status: 'UNAVAILABLE', maxBookableDays: 3, youngestDriverAge: 25 },
      { status: 'REFUSED' },
      null,
      [],
    ]) {
      expect(checkoutPaymentOf(reply(deposit)), JSON.stringify(deposit)).toBeNull();
    }
  });

  it('S-8 : au moins un jour ⇒ `web.deposit.unavailable` avec le nombre ; 0 ou aucun ⇒ `web.deposit.unavailableNone`', () => {
    expect(depositRefusalMessage({ status: 'UNAVAILABLE', maxBookableDays: 3 })).toEqual({
      key: 'web.deposit.unavailable',
      count: 3,
    });
    expect(depositRefusalMessage({ status: 'UNAVAILABLE', maxBookableDays: 1 })).toEqual({
      key: 'web.deposit.unavailable',
      count: 1,
    });
    for (const days of [0, null]) {
      expect(depositRefusalMessage({ status: 'UNAVAILABLE', maxBookableDays: days })).toEqual({
        key: 'web.deposit.unavailableNone',
      });
    }
  });

  it('refus 409 de l’API ⇒ clé commune, et textes présents sans variable restante dans les quatre langues', () => {
    for (const code of ['DEPOSIT_RAIL_UNAVAILABLE', 'DEPOSIT_PARAM_MISSING']) {
      expect(paymentErrorKey({ status: 409, json: { code }, session: null })).toBe(
        'common.payment.depositUnavailable',
      );
    }
    for (const tag of LOCALE_CONFIG.locales.map((l) => l.tag)) {
      const t = createTranslator(getProfile(LOCALE_CONFIG, tag)).t;
      for (const text of [
        t('web.deposit.none'),
        t('common.payment.depositUnavailable'),
        t('web.deposit.unavailable', { count: 3 }),
        t('web.deposit.unavailableNone'),
      ]) {
        expect(text.trim().length, tag).toBeGreaterThan(0);
        expect(text, tag).not.toMatch(/[{}]/);
      }
    }
  });

  it('contrat : le schéma CheckoutDeposit ne porte aucun champ [C2]', () => {
    const openapi = JSON.parse(
      readFileSync(new URL('../../api/openapi/openapi.json', import.meta.url), 'utf8'),
    ) as { components: { schemas: Record<string, { oneOf: { properties: object }[] }> } };
    const fields = openapi.components.schemas['CheckoutDeposit']!.oneOf.flatMap((o) =>
      Object.keys(o.properties),
    );
    expect([...new Set(fields)].sort()).toEqual([
      'amountMinor',
      'currency',
      'kind',
      'maxBookableDays',
      'releaseAt',
      'status',
    ]);
  });
});
