/**
 * US-701 partie 701c (T70 c ; ADR-173) — caution annoncée avant le checkout (fiche S03, cartes) :
 * même décision que la porte du checkout, stade PRE_CHECKOUT. Attendus : contrôles de l'oracle
 * `docs/specs/tools/check_t49plus.py` (T70 c, T72 c, T73 ; export `@rueda/money/golden-vectors`),
 * jamais le code testé ; paramètres PROPOSÉS relus dans la graine (`cfg/data/params.json`). Chaque
 * cas dans chaque pays configuré (USD au PA, PYG sans décimale au PY).
 */
import { readFileSync } from 'node:fs';
import { checksFor, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenValue } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { countryCases } from '../../../../test/support/countries.js';
import { CapabilitySet } from './capabilities.js';
import { evaluateDepositCheckout } from './deposit-checkout.js';
import type { DepositConfigSource } from './deposit-checkout.js';
import { preCheckoutDeposit, PreCheckoutDepositReader } from './deposit-notice.js';
import type { DepositTriggerParams, DepositValueClass } from './deposit-triggers.js';
import type { DepositRailConfig } from './pg-deposit-config.js';

const set = loadGoldenVectors();
const check = (vectorId: string, label: RegExp): GoldenValue => {
  const found = checksFor(set, vectorId).find((c) => label.test(c.label));
  if (found === undefined) throw new Error(`contrôle ${vectorId} ${label} absent`);
  return found.expected;
};

const PARAMS = (
  JSON.parse(readFileSync(new URL('../../cfg/data/params.json', import.meta.url), 'utf8')) as {
    params: { key: string; values: Record<string, unknown> }[];
  }
).params;
const p = (key: string, country: string): unknown =>
  PARAMS.find((x) => x.key === key)?.values[country];

function proposed(country: string): DepositTriggerParams {
  return {
    alwaysRequired: p('deposit_always_required', country) as boolean,
    triggerClasses: p('deposit_trigger_classes', country) as DepositValueClass[],
    youngDriverAge: p('deposit_young_driver_age', country) as number,
    youngDriverClasses: p('deposit_young_driver_classes', country) as DepositValueClass[],
    onRiskFlag: p('deposit_on_risk_flag', country) as boolean,
    riskControlDeployed: p('risk_control_deployed', country) as boolean,
  };
}

/** Configuration complète (rails sans capacité : jamais lus sans déclencheur ni montant). */
function config(
  country: string,
  over: {
    triggerParams?: DepositTriggerParams;
    amounts?: DepositRailConfig['amounts'];
  } = {},
): DepositRailConfig {
  return {
    triggerParams: over.triggerParams ?? proposed(country),
    amounts: over.amounts,
    railParams: {
      authLeadH: null,
      releaseDelayH: null,
      marginH: null,
      safetyH: null,
      reauthLeadH: null,
      providerMaxHoldH: 0,
      chargeCapMinor: 0n,
      fundsHoldingEnabled: false,
    },
    feeNoticeH: null,
    capabilities: new CapabilitySet([]),
  };
}

const CLASSES: readonly (DepositValueClass | null)[] = ['STANDARD', 'PREMIUM', 'LUXE', null];

describe.each(countryCases())('$country ($currency) — caution avant le checkout', (c) => {
  it('T70 c : PREMIUM ⇒ mention générique ; LUXE ⇒ montant deposit_amount[pays][LUXE] de test', () => {
    const [premium, luxe, amount] = check('T70', /avant checkout/) as [
      [boolean, string[]],
      [boolean, string[]],
      bigint,
    ];
    expect(premium[0]).toBe(false);
    expect(luxe[0]).toBe(true);
    const cfg = config(c.country, { amounts: { LUXE: amount } });
    expect(preCheckoutDeposit(cfg, 'PREMIUM')).toEqual({ status: 'GENERIC' });
    expect(preCheckoutDeposit(cfg, 'LUXE')).toEqual({ status: 'REQUIRED', amountMinor: amount });
  });

  it('graine (deposit_amount À DÉCIDER) : STANDARD et PREMIUM ⇒ générique ; LUXE et classe inconnue ⇒ caution non disponible (T72 c : PARAM_MISSING au checkout), jamais 0', () => {
    expect(p('deposit_amount', c.country)).toBeUndefined();
    const cfg = config(c.country, { amounts: undefined });
    expect(preCheckoutDeposit(cfg, 'STANDARD')).toEqual({ status: 'GENERIC' });
    expect(preCheckoutDeposit(cfg, 'PREMIUM')).toEqual({ status: 'GENERIC' });
    expect(preCheckoutDeposit(cfg, 'LUXE')).toEqual({ status: 'UNAVAILABLE' });
    // classe inconnue du catalogue : CLASS vrai (fail-closed), montant introuvable
    expect(preCheckoutDeposit(cfg, null)).toEqual({ status: 'UNAVAILABLE' });
    expect(check('T72', /a\/b\/c\/d/)).toContain('PARAM_MISSING');
  });

  it('T73 b : caution imposée par le pays (COUNTRY) ⇒ montant de la classe, une seule (STANDARD 500 000, LUXE 1 500 000, montants de test)', () => {
    const [, amountA, b, amountB] = check('T73', /a\/b/) as [
      unknown,
      bigint,
      [boolean, string[]],
      bigint,
    ];
    expect(b).toEqual([true, ['COUNTRY']]);
    const cfg = config(c.country, {
      triggerParams: { ...proposed(c.country), alwaysRequired: true },
      amounts: { LUXE: amountA, STANDARD: amountB },
    });
    expect(preCheckoutDeposit(cfg, 'STANDARD')).toEqual({
      status: 'REQUIRED',
      amountMinor: amountB,
    });
    expect(preCheckoutDeposit(cfg, 'LUXE')).toEqual({ status: 'REQUIRED', amountMinor: amountA });
    // PREMIUM sans montant alors que le pays impose une caution : non disponible
    expect(preCheckoutDeposit(cfg, 'PREMIUM')).toEqual({ status: 'UNAVAILABLE' });
  });

  it('fail-closed : paramètres de déclencheur absents ⇒ caution annoncée pour toute classe ; âge et risque jamais évalués avant le checkout', () => {
    const cfg = config(c.country, { triggerParams: {}, amounts: { STANDARD: 1n } });
    expect(preCheckoutDeposit(cfg, 'STANDARD')).toEqual({ status: 'REQUIRED', amountMinor: 1n });
    expect(preCheckoutDeposit(cfg, 'PREMIUM')).toEqual({ status: 'UNAVAILABLE' });
    // âge activé sur toutes les classes et risque déployé sans réponse : rien avant le checkout
    const ageRisk = config(c.country, {
      triggerParams: {
        ...proposed(c.country),
        youngDriverClasses: ['STANDARD', 'PREMIUM', 'LUXE'],
        riskControlDeployed: true,
        onRiskFlag: undefined,
      },
    });
    expect(preCheckoutDeposit(ageRisk, 'STANDARD')).toEqual({ status: 'GENERIC' });
  });

  it('cohérent avec S05 (paramètres PROPOSÉS) : générique ⇒ aucune caution au checkout ; non disponible ⇒ PARAM_MISSING ; montant ⇒ caution exigée au checkout', () => {
    for (const amounts of [undefined, { LUXE: 30_000n }]) {
      const cfg = config(c.country, { amounts });
      for (const valueClass of CLASSES) {
        const pre = preCheckoutDeposit(cfg, valueClass);
        const at = evaluateDepositCheckout(
          {
            country: c.country,
            currency: c.currency,
            valueClass,
            scheduledStart: new Date('2031-07-10T10:00:00.000Z'),
            scheduledEnd: new Date('2031-07-13T10:00:00.000Z'),
            provider: null,
            now: new Date('2031-07-01T10:00:00.000Z'),
          },
          cfg,
        ).decision;
        if (pre.status === 'GENERIC') expect(at.kind).toBe('NOT_REQUIRED');
        if (pre.status === 'UNAVAILABLE') {
          expect(at).toMatchObject({ kind: 'REFUSED', code: 'PARAM_MISSING' });
        }
        // montant annoncé : caution exigée au checkout (rails de ce test sans paramètres : refus)
        if (pre.status === 'REQUIRED') expect(at.kind).not.toBe('NOT_REQUIRED');
      }
    }
  });

  it('lecteur : paramètres du pays lus sans fournisseur ; classe lue en base hors vocabulaire ⇒ inconnue', async () => {
    const asked: [string, string][] = [];
    const source: DepositConfigSource = {
      read: (country, provider) => {
        asked.push([country, provider]);
        return Promise.resolve(config(country, { amounts: { LUXE: 7n } }));
      },
    };
    const reader = new PreCheckoutDepositReader(source);
    expect(await reader.notice(c.country, 'LUXE')).toEqual({ status: 'REQUIRED', amountMinor: 7n });
    expect(await reader.notice(c.country, 'PREMIUM')).toEqual({ status: 'GENERIC' });
    expect(await reader.notice(c.country, 'luxe')).toEqual({ status: 'UNAVAILABLE' });
    expect(await reader.notice(c.country, null)).toEqual({ status: 'UNAVAILABLE' });
    expect(asked).toEqual(Array.from({ length: 4 }, () => [c.country, '']));
  });
});
