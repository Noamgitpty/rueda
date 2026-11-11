/**
 * US-013 — résolution des paramètres (17 §7.1 points 6 et 7), interrupteurs (17 §0.1) et
 * non-rétroactivité (16 ADM-014). Attentes tirées de 17 §7.2.
 */
import { describe, expect, it } from 'vitest';
import { loadRepositoryConfig } from './load.js';
import type { ParamValue } from './model.js';
import {
  assertNotRetroactive,
  findOptionalParam,
  isGoLiveSwitchOn,
  resolveParam,
} from './resolve.js';
import { errorCode, withValues } from './test-helpers.js';

const config = loadRepositoryConfig();
const at = new Date('2026-11-03T12:00:00Z');

const SWITCHES = [
  'p2p_private_hosts_enabled',
  'insurer_contract_active',
  'funds_holding_enabled',
  'payouts_enabled',
];

describe.each([
  { country: 'PA', currency: 'USD' },
  { country: 'PY', currency: 'PYG' },
])('$country ($currency)', ({ country, currency }) => {
  it('valeur de portée pays (17 §7.2 : hold_ttl_minutes = 10, max_trip_days = 30)', () => {
    expect(resolveParam(config, 'hold_ttl_minutes', { country, at })).toMatchObject({
      value: 10,
      origin: 'VALUE',
      scopeType: 'COUNTRY',
    });
    expect(resolveParam(config, 'max_trip_days', { country, at }).value).toBe(30);
  });

  it('spécificité CATEGORY > COUNTRY (advance_notice_minutes : 180 ; 1 440 classe LUXE)', () => {
    expect(resolveParam(config, 'advance_notice_minutes', { country, at }).value).toBe(180);
    expect(
      resolveParam(config, 'advance_notice_minutes', { country, at, category: 'LUXE' }),
    ).toMatchObject({
      value: 1440,
      scopeType: 'CATEGORY',
    });
    expect(
      resolveParam(config, 'advance_notice_minutes', { country, at, category: 'ECONOMY' }).value,
    ).toBe(180);
  });

  it('portée NETWORK seule (damage_charge_deadline_days : MC 30, Visa 90) ; réseau inconnu ⇒ PARAM_MISSING', () => {
    expect(
      resolveParam(config, 'damage_charge_deadline_days', { country, at, network: 'VISA' }).value,
    ).toBe(90);
    expect(
      resolveParam(config, 'damage_charge_deadline_days', { country, at, network: 'MASTERCARD' })
        .value,
    ).toBe(30);
    expect(
      errorCode(() => resolveParam(config, 'damage_charge_deadline_days', { country, at })),
    ).toBe('PARAM_MISSING');
  });

  it('fail_mode BLOCK : valeur « à fixer » absente ⇒ PARAM_MISSING (jamais 0 silencieux)', () => {
    expect(errorCode(() => resolveParam(config, 'deposit_max', { country, at }))).toBe(
      'PARAM_MISSING',
    );
    expect(errorCode(() => resolveParam(config, 'platform_reserve_minor', { country, at }))).toBe(
      'PARAM_MISSING',
    );
  });

  it('fail_mode FALSE : platform_funded_host_compensation absent ⇒ false', () => {
    expect(
      resolveParam(config, 'platform_funded_host_compensation', { country, at }),
    ).toMatchObject({
      value: false,
      origin: 'FAIL_MODE',
    });
  });

  it('fail_mode ZERO : deposit_charge_cap inconnu ⇒ 0 dans la devise du pays (rail interdit)', () => {
    expect(resolveParam(config, 'deposit_charge_cap', { country, at })).toMatchObject({
      value: '0',
      origin: 'FAIL_MODE',
      currency,
    });
    expect(resolveParam(config, 'provider_max_hold_h', { country, at }).value).toBe(0);
  });

  it('montant lié à la devise du pays (host_penalty)', () => {
    expect(resolveParam(config, 'host_penalty', { country, at }).currency).toBe(currency);
  });

  it('les quatre interrupteurs sont faux', () => {
    for (const key of SWITCHES) expect(isGoLiveSwitchOn(config, key, country, at)).toBe(false);
  });

  it('clé optionnelle absente : repli de l’appelant (billing_boundary_minutes non appliqué)', () => {
    expect(findOptionalParam(config, 'billing_boundary_minutes', { country, at })).toBeUndefined();
    expect(errorCode(() => findOptionalParam(config, 'hold_ttl_minutes', { country, at }))).toBe(
      'PARAM_UNKNOWN',
    );
  });
});

describe('clés sans objet dans un pays (17 §7.2 « — »)', () => {
  it('price_display_step_minor : 1 000 PYG au PY (BR-PRICE-14), sans objet au PA', () => {
    expect(resolveParam(config, 'price_display_step_minor', { country: 'PY', at })).toMatchObject({
      value: '1000',
      currency: 'PYG',
    });
    expect(
      errorCode(() => resolveParam(config, 'price_display_step_minor', { country: 'PA', at })),
    ).toBe('PARAM_NOT_APPLICABLE');
  });

  it('ach_xpress_max_minor : 500 000 cents au PA (BR-PAYOUT-01), sans objet au PY', () => {
    expect(resolveParam(config, 'ach_xpress_max_minor', { country: 'PA', at }).value).toBe(
      '500000',
    );
    expect(
      errorCode(() => resolveParam(config, 'ach_xpress_max_minor', { country: 'PY', at })),
    ).toBe('PARAM_NOT_APPLICABLE');
  });
});

describe('refus explicites', () => {
  it('clé inconnue ⇒ PARAM_UNKNOWN ; pays inconnu ⇒ COUNTRY_UNKNOWN', () => {
    expect(errorCode(() => resolveParam(config, 'no_such_key', { country: 'PA', at }))).toBe(
      'PARAM_UNKNOWN',
    );
    expect(errorCode(() => resolveParam(config, 'hold_ttl_minutes', { country: 'CO', at }))).toBe(
      'COUNTRY_UNKNOWN',
    );
  });
});

describe('interrupteurs : absent ou inconnu = false (17 §0.1)', () => {
  const on = (key: string, country: string): ParamValue => ({
    key,
    country,
    scopeType: 'COUNTRY',
    scopeId: null,
    network: null,
    currency: null,
    value: true,
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validTo: null,
    decision: 'DECIDED',
    decisionRef: 'test',
    source: 'test',
  });

  it('clé inconnue, casse différente, pays inconnu ou en minuscules ⇒ false, sans exception', () => {
    expect(isGoLiveSwitchOn(config, 'no_such_switch', 'PA', at)).toBe(false);
    expect(isGoLiveSwitchOn(config, 'PAYOUTS_ENABLED', 'PA', at)).toBe(false);
    expect(isGoLiveSwitchOn(config, 'payouts_enabled', 'XX', at)).toBe(false);
    expect(isGoLiveSwitchOn(config, 'payouts_enabled', 'pa', at)).toBe(false);
  });

  it('une clé qui n’est pas un interrupteur ne vaut jamais true', () => {
    expect(isGoLiveSwitchOn(config, 'goodfaith_comp_requires_support_validation', 'PA', at)).toBe(
      false,
    );
  });

  it('valeur absente (aucune ligne) ⇒ false', () => {
    const empty = withValues(
      config,
      config.values.filter((v) => v.key !== 'payouts_enabled'),
    );
    expect(isGoLiveSwitchOn(empty, 'payouts_enabled', 'PY', at)).toBe(false);
  });

  // Configuration synthétique construite à la main (hors parseur, qui refuse true jusqu'à US-125) :
  // elle éprouve seulement la lecture par pays.
  it('par pays : true dans un pays n’ouvre pas l’autre (ADR-024)', () => {
    const synthetic = withValues(config, [
      ...config.values.filter((v) => v.key !== 'payouts_enabled'),
      on('payouts_enabled', 'PA'),
    ]);
    expect(isGoLiveSwitchOn(synthetic, 'payouts_enabled', 'PA', at)).toBe(true);
    expect(isGoLiveSwitchOn(synthetic, 'payouts_enabled', 'PY', at)).toBe(false);
  });

  it('valeur illisible (non booléenne) ⇒ false', () => {
    const odd = withValues(config, [{ ...on('payouts_enabled', 'PA'), value: 'true' }]);
    expect(isGoLiveSwitchOn(odd, 'payouts_enabled', 'PA', at)).toBe(false);
  });
});

describe('versions datées (17 §7.1 point 6)', () => {
  const base: ParamValue = {
    key: 'hold_ttl_minutes',
    country: 'PY',
    scopeType: 'COUNTRY',
    scopeId: null,
    network: null,
    currency: null,
    value: 10,
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validTo: new Date('2026-12-01T00:00:00Z'),
    decision: 'PROPOSED',
    decisionRef: 'test',
    source: 'test',
  };
  const next: ParamValue = {
    ...base,
    value: 12,
    validFrom: new Date('2026-12-01T00:00:00Z'),
    validTo: null,
  };
  const versioned = withValues(config, [base, next]);

  it('la valeur en vigueur dépend de la date de l’événement ; valid_to est exclu', () => {
    expect(resolveParam(versioned, 'hold_ttl_minutes', { country: 'PY', at }).value).toBe(10);
    expect(
      resolveParam(versioned, 'hold_ttl_minutes', {
        country: 'PY',
        at: new Date('2026-12-01T00:00:00Z'),
      }).value,
    ).toBe(12);
  });

  it('avant la première version ⇒ PARAM_MISSING', () => {
    expect(
      errorCode(() =>
        resolveParam(versioned, 'hold_ttl_minutes', {
          country: 'PY',
          at: new Date('2025-06-01T00:00:00Z'),
        }),
      ),
    ).toBe('PARAM_MISSING');
  });
});

describe('non-rétroactivité (16 ADM-014 : PARAM_RETROACTIVE)', () => {
  const now = new Date('2026-11-03T12:00:00.000Z');

  it('valid_from passé ⇒ PARAM_RETROACTIVE', () => {
    expect(errorCode(() => assertNotRetroactive(new Date('2026-11-03T11:59:59.999Z'), now))).toBe(
      'PARAM_RETROACTIVE',
    );
  });

  it('valid_from = maintenant ou futur ⇒ accepté', () => {
    expect(() => assertNotRetroactive(now, now)).not.toThrow();
    expect(() => assertNotRetroactive(new Date('2027-01-01T00:00:00Z'), now)).not.toThrow();
  });

  it('instant illisible ⇒ refus', () => {
    expect(errorCode(() => assertNotRetroactive(new Date('nope'), now))).toBe('PARAM_RETROACTIVE');
  });
});
