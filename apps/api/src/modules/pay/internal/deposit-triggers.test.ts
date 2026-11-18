/**
 * Déclencheurs de la caution « comme Turo » (US-225 ; 08 BR-PAY-06, ADR-108). Attendus tirés des
 * contrôles de l'oracle `docs/specs/tools/check_t49plus.py` (T69–T73, export
 * `@rueda/money/golden-vectors`), jamais du code testé ; paramètres PROPOSÉS = ceux de la graine
 * 0141 (relus dans `params.json`, sans importer le module CFG).
 */
import { readFileSync } from 'node:fs';
import { checksFor, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenValue } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { countryCases } from '../../../../test/support/countries.js';
import { depositAmountFor, evaluateDepositTriggers } from './deposit-triggers.js';
import type {
  DepositTriggerDecision,
  DepositTriggerParams,
  DepositValueClass,
} from './deposit-triggers.js';

const set = loadGoldenVectors();
/** Pays configurés (CLAUDE.md point 3), lus dans la configuration. */
const COUNTRIES = countryCases().map((c) => c.country);
const check = (vectorId: string, label: RegExp): GoldenValue => {
  const found = checksFor(set, vectorId).find((c) => label.test(c.label));
  if (found === undefined) throw new Error(`contrôle ${vectorId} ${label} absent`);
  return found.expected;
};

interface ParamDoc {
  params: Array<{ key: string; values: Record<string, unknown> }>;
}
const PARAMS = JSON.parse(
  readFileSync(new URL('../../cfg/data/params.json', import.meta.url), 'utf8'),
) as ParamDoc;
const valueOf = (key: string, country: string): unknown =>
  PARAMS.params.find((p) => p.key === key)?.values[country];

/** Paramètres PROPOSÉS du pays, tels que la graine 0141 les charge. */
function proposed(country: string): DepositTriggerParams {
  return {
    alwaysRequired: valueOf('deposit_always_required', country) as boolean,
    triggerClasses: valueOf('deposit_trigger_classes', country) as DepositValueClass[],
    youngDriverAge: valueOf('deposit_young_driver_age', country) as number,
    youngDriverClasses: valueOf('deposit_young_driver_classes', country) as DepositValueClass[],
    onRiskFlag: valueOf('deposit_on_risk_flag', country) as boolean,
    riskControlDeployed: valueOf('risk_control_deployed', country) as boolean,
  };
}

/** Forme de l'oracle : (exigée, déclencheurs triés). */
const pair = (d: DepositTriggerDecision): [boolean, string[]] => [d.required, [...d.triggers]];

describe('paramètres PROPOSÉS (ADR-108) : aucune caution par défaut, P et P', () => {
  it.each(COUNTRIES)(
    '%s : pays faux, {LUXE}, âge 30 sur aucune classe, risque non déployé',
    (c) => {
      expect(proposed(c)).toEqual({
        alwaysRequired: false,
        triggerClasses: ['LUXE'],
        youngDriverAge: 30,
        youngDriverClasses: [],
        onRiskFlag: true,
        riskControlDeployed: false,
      });
    },
  );
});

// paramètres PROPOSÉS identiques dans chaque pays : chaque vecteur (P ou P dans 08) est rejoué
// dans chaque pays configuré
describe.each(COUNTRIES)(
  '%s — T69–T73 (oracle check_t49plus.py, fonction deposit_required)',
  (country) => {
    const P = proposed(country);

    it('T69 : P, STANDARD, 35 ans, aucun signal ⇒ aucune caution', () => {
      const expected = check('T69', /caution/) as GoldenValue[];
      const d = evaluateDepositTriggers(
        P,
        { valueClass: 'STANDARD', driverAges: [35], riskFlagged: false },
        'CHECKOUT',
      );
      expect(d.required).toBe(expected[0]);
      expect(d.triggers).toEqual([]);
    });

    it('T70 a / b : trip de T59 en STANDARD ⇒ aucune caution ; en LUXE ⇒ {CLASS}', () => {
      const [none, luxe] = check('T70', /sans caution/) as [boolean, [boolean, string[]]];
      expect(
        evaluateDepositTriggers(
          P,
          { valueClass: 'STANDARD', driverAges: [40], riskFlagged: false },
          'CHECKOUT',
        ).required,
      ).toBe(none);
      expect(
        pair(
          evaluateDepositTriggers(
            P,
            { valueClass: 'LUXE', driverAges: [40], riskFlagged: false },
            'CHECKOUT',
          ),
        ),
      ).toEqual(luxe);
    });

    it('T70 c : avant le checkout, AGE et RISK inconnus ne valent pas « vrai » ; LUXE affiche son montant', () => {
      const [premium, luxe, amount] = check('T70', /avant checkout/) as [
        [boolean, string[]],
        [boolean, string[]],
        bigint,
      ];
      expect(pair(evaluateDepositTriggers(P, { valueClass: 'PREMIUM' }, 'PRE_CHECKOUT'))).toEqual(
        premium,
      );
      const l = evaluateDepositTriggers(P, { valueClass: 'LUXE' }, 'PRE_CHECKOUT');
      expect(pair(l)).toEqual(luxe);
      expect(l.riskEvaluated).toBe(false);
      expect(depositAmountFor({ LUXE: 30_000n }, 'LUXE')).toBe(amount);
    });

    it('T71 a / b / c : valeurs PROPOSÉES, l’âge seul ne déclenche jamais (DEC-FONDATEUR-21)', () => {
      const expected = check('T71', /PROPOSEES/) as [boolean, string[]][];
      expect([
        pair(
          evaluateDepositTriggers(
            P,
            { valueClass: 'PREMIUM', driverAges: [29], riskFlagged: false },
            'CHECKOUT',
          ),
        ),
        pair(
          evaluateDepositTriggers(
            P,
            { valueClass: 'PREMIUM', driverAges: [45, 26], riskFlagged: false },
            'CHECKOUT',
          ),
        ),
        pair(
          evaluateDepositTriggers(
            P,
            { valueClass: 'LUXE', driverAges: [25], riskFlagged: false },
            'CHECKOUT',
          ),
        ),
      ]).toEqual(expected);
    });

    it('T71 d / e / f / g : pays qui active l’âge ; seuil strict ; paramètre absent ⇒ toutes les classes', () => {
      const expected = check('T71', /age active/) as [boolean, string[]][];
      const on: DepositTriggerParams = { ...P, youngDriverClasses: ['PREMIUM', 'LUXE'] };
      const absent: DepositTriggerParams = { ...P, youngDriverClasses: undefined };
      expect([
        pair(
          evaluateDepositTriggers(
            on,
            { valueClass: 'PREMIUM', driverAges: [29], riskFlagged: false },
            'CHECKOUT',
          ),
        ),
        pair(
          evaluateDepositTriggers(
            on,
            { valueClass: 'PREMIUM', driverAges: [30], riskFlagged: false },
            'CHECKOUT',
          ),
        ),
        pair(
          evaluateDepositTriggers(
            on,
            { valueClass: 'STANDARD', driverAges: [22], riskFlagged: false },
            'CHECKOUT',
          ),
        ),
        pair(
          evaluateDepositTriggers(
            absent,
            { valueClass: 'STANDARD', driverAges: [22], riskFlagged: false },
            'CHECKOUT',
          ),
        ),
      ]).toEqual(expected);
    });

    it('T72 a / b / c / d : fail-closed ; contrôle non déployé ≠ en panne', () => {
      const [a, b, c, d] = check('T72', /a\/b\/c\/d/) as [
        [boolean, string[]],
        [boolean, string[]],
        string,
        [boolean, string[]],
      ];
      const deployed: DepositTriggerParams = { ...P, riskControlDeployed: true };
      const ctx = { valueClass: 'STANDARD' as const, driverAges: [45], riskFlagged: false };
      const ra = evaluateDepositTriggers({ ...deployed, onRiskFlag: undefined }, ctx, 'CHECKOUT');
      expect(pair(ra)).toEqual(a);
      expect(
        pair(evaluateDepositTriggers(deployed, { ...ctx, riskFlagged: null }, 'CHECKOUT')),
      ).toEqual(b);
      // (c) caution exigée sans deposit_amount[P][STANDARD] ⇒ PARAM_MISSING, jamais 0
      expect(depositAmountFor({ LUXE: 1_500_000n }, 'STANDARD')).toBeNull();
      expect(c).toBe('PARAM_MISSING');
      const rd = evaluateDepositTriggers(P, { ...ctx, riskFlagged: null }, 'CHECKOUT');
      expect(pair(rd)).toEqual(d);
      expect(rd.riskEvaluated).toBe(false);
      expect(ra.riskEvaluated).toBe(true);
    });

    it('T73 a / b : une seule caution, montant de la classe, jamais cumulé (montants de test de T73)', () => {
      const [a, amountA, b, amountB] = check('T73', /a\/b/) as [
        [boolean, string[]],
        bigint,
        [boolean, string[]],
        bigint,
      ];
      const amounts = { LUXE: 1_500_000n, STANDARD: 500_000n };
      const deployed: DepositTriggerParams = { ...P, riskControlDeployed: true };
      expect(
        pair(
          evaluateDepositTriggers(
            deployed,
            { valueClass: 'LUXE', driverAges: [27], riskFlagged: true },
            'CHECKOUT',
          ),
        ),
      ).toEqual(a);
      expect(depositAmountFor(amounts, 'LUXE')).toBe(amountA);
      expect(
        pair(
          evaluateDepositTriggers(
            { ...P, alwaysRequired: true },
            { valueClass: 'STANDARD', driverAges: [45], riskFlagged: false },
            'CHECKOUT',
          ),
        ),
      ).toEqual(b);
      expect(depositAmountFor(amounts, 'STANDARD')).toBe(amountB);
    });
  },
);

describe.each(COUNTRIES)('%s — fail-closed hors vecteurs', (country) => {
  const P = proposed(country);
  it('classe inconnue ⇒ CLASS vrai (et AGE si les classes de l’âge sont absentes) ; montant introuvable', () => {
    const d = evaluateDepositTriggers(
      P,
      { valueClass: null, driverAges: [40], riskFlagged: false },
      'CHECKOUT',
    );
    expect(d.triggers).toEqual(['CLASS']);
    expect(depositAmountFor({ LUXE: 30_000n }, null)).toBeNull();
  });

  it('paramètre du pays absent ⇒ COUNTRY vrai ; âge inconnu ou liste vide ⇒ AGE vrai si la classe en relève', () => {
    expect(
      evaluateDepositTriggers(
        { ...P, alwaysRequired: undefined },
        { valueClass: 'STANDARD', driverAges: [40], riskFlagged: false },
        'CHECKOUT',
      ).triggers,
    ).toEqual(['COUNTRY']);
    const on: DepositTriggerParams = { ...P, youngDriverClasses: ['STANDARD'] };
    for (const ages of [null, [], [40, null]]) {
      expect(
        evaluateDepositTriggers(
          on,
          { valueClass: 'STANDARD', driverAges: ages, riskFlagged: false },
          'CHECKOUT',
        ).triggers,
      ).toEqual(['AGE']);
    }
  });

  it('montant nul ou absent ⇒ null (refus avant le paiement, jamais une caution de 0)', () => {
    expect(depositAmountFor({ LUXE: 0n }, 'LUXE')).toBeNull();
    expect(depositAmountFor(undefined, 'LUXE')).toBeNull();
  });
});
