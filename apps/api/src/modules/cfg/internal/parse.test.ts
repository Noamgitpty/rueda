/**
 * US-013 — configuration pays en données, validée fail-closed. Les attentes viennent des
 * spécifications : 17 §1.2 (USD = 2, PYG = 0), §1.3 (fuseaux), §1.4 (locales), §7.2 (défauts),
 * 08 BR-CXL-13 (HOST_PENALTY en unités mineures), BR-PRICE-06 (trip fee), BR-PRICE-12 (taux).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadRepositoryConfig } from './load.js';
import { TAX_LINE_TYPES } from './model.js';
import { cloneSources, country, errorCode, errorDetails, param, parse } from './test-helpers.js';

const config = loadRepositoryConfig();

// Vecteurs des deux pays de premier rang (CLAUDE.md contrainte 3 ; 17 §1.2, §1.3, §1.4 ; 08 BR-PRICE-12).
const COUNTRIES = [
  {
    code: 'PA',
    currency: 'USD',
    exponent: 2,
    timeZone: 'America/Panama',
    legalLocale: 'es-PA',
    taxGroup: 'ITBMS',
    taxBps: 700,
    // 08 BR-CXL-13 / penalty() : 2 500 / 5 000 / 15 000 / 5 000 cents.
    penalty: { cxlEarly: '2500', cxlLate: '5000', hostNoShow: '15000', cleanliness: '5000' },
    // 08 BR-PRICE-06 : minimum 5 USD = 500 cents.
    tripFeeMinMinor: '500',
  },
  {
    code: 'PY',
    currency: 'PYG',
    exponent: 0,
    timeZone: 'America/Asuncion',
    legalLocale: 'es-PY',
    taxGroup: 'IVA',
    taxBps: 1000,
    penalty: {
      cxlEarly: '200000',
      cxlLate: '400000',
      hostNoShow: '1200000',
      cleanliness: '400000',
    },
    tripFeeMinMinor: '35000',
  },
] as const;

describe('configuration du dépôt', () => {
  it('se charge et ne contient que les deux pays de premier rang', () => {
    expect([...config.countries.keys()].sort()).toEqual(['PA', 'PY']);
    expect(config.currencies.map((c) => [c.code, c.exponent]).sort()).toEqual([
      ['PYG', 0],
      ['USD', 2],
    ]);
  });

  describe.each(COUNTRIES)('$code', (expected) => {
    const entry = config.countries.get(expected.code)!;

    it('devise, exposant, fuseau et locales (17 §1.2–§1.4 ; DEC-FONDATEUR-17)', () => {
      expect(entry.currency).toEqual({ code: expected.currency, exponent: expected.exponent });
      expect(entry.timeZone).toBe(expected.timeZone);
      expect(entry.legalLocale).toBe(expected.legalLocale);
      expect([...entry.locales].sort()).toEqual([expected.legalLocale, 'en', 'fr'].sort());
      expect(Object.keys(entry.names).sort()).toEqual(['en', 'es', 'fr']);
    });

    it('taxe par ligne : tous les types de ligne, défaut « assiette = loyer seul » (OQ-BR-14)', () => {
      expect(entry.taxLines.map((t) => t.lineType).sort()).toEqual([...TAX_LINE_TYPES].sort());
      const taxable = entry.taxLines.filter((t) => t.taxable);
      expect(taxable.map((t) => t.lineType).sort()).toEqual([
        'PROMO_HOST',
        'PROMO_PLATFORM',
        'TRIP_PRICE',
      ]);
      for (const line of taxable) {
        expect(line).toMatchObject({
          rateGroup: expected.taxGroup,
          rateBps: expected.taxBps,
          thirdParty: false,
        });
      }
    });

    it('montants forfaitaires en unités mineures de la devise du pays, jamais convertis', () => {
      const penalty = config.values.find(
        (v) => v.key === 'host_penalty' && v.country === expected.code,
      );
      expect(penalty).toMatchObject({ currency: expected.currency, value: expected.penalty });
      const fee = config.values.find(
        (v) => v.key === 'trip_fee_schedule' && v.country === expected.code,
      );
      expect(fee?.currency).toBe(expected.currency);
      expect((fee?.value as { minMinor: string }).minMinor).toBe(expected.tripFeeMinMinor);
    });

    it('interrupteurs de mise en service à false (17 §0.1, §7.2)', () => {
      for (const key of [
        'p2p_private_hosts_enabled',
        'insurer_contract_active',
        'funds_holding_enabled',
        'payouts_enabled',
      ]) {
        expect(config.definitions.get(key)).toMatchObject({
          goLiveSwitch: true,
          failMode: 'FALSE',
        });
        const value = config.values.find((v) => v.key === key && v.country === expected.code);
        expect(value?.value).toBe(false);
      }
    });
  });

  it('aucun interrupteur à true dans les données, quel que soit le pays', () => {
    const on = config.values.filter(
      (v) => config.definitions.get(v.key)?.goLiveSwitch && v.value !== false,
    );
    expect(on).toEqual([]);
  });

  it('platform_funded_host_compensation est absent (16 ADM-031) et vaut false par fail_mode', () => {
    expect(config.values.some((v) => v.key === 'platform_funded_host_compensation')).toBe(false);
    expect(config.definitions.get('platform_funded_host_compensation')?.failMode).toBe('FALSE');
  });

  it('les locales des pays sont celles de @rueda/i18n (réutilisées, non dupliquées)', () => {
    const i18n = JSON.parse(
      readFileSync(
        new URL('../../../../../../packages/i18n/config/locales.json', import.meta.url),
        'utf8',
      ),
    ) as { locales: { tag: string }[] };
    const tags = i18n.locales.map((l) => l.tag);
    for (const entry of config.countries.values()) {
      for (const tag of entry.locales) expect(tags).toContain(tag);
    }
  });

  it('la configuration est immuable', () => {
    const value = config.values.find((v) => v.key === 'host_penalty')!;
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.value)).toBe(true);
    expect(Object.isFrozen(config.countries.get('PA'))).toBe(true);
  });
});

describe('validation fail-closed (CONFIG_INVALID)', () => {
  const cases: [string, (s: ReturnType<typeof cloneSources>) => void, RegExp][] = [
    ['devise inconnue', (s) => (country(s, 'PY')['currency'] = 'XXX'), /devise non configurée/],
    ['exposant hors bornes', (s) => (s.currencies.currencies[0]!['exponent'] = 19), /exponent/],
    [
      'devise en double',
      (s) => s.currencies.currencies.push({ ...s.currencies.currencies[0]! }),
      /double/,
    ],
    ['fuseau inconnu', (s) => (country(s, 'PA')['timeZone'] = 'America/Atlantis'), /fuseau IANA/],
    [
      'locale absente de i18n',
      (s) => (country(s, 'PY')['locales'] = ['es-PY', 'de']),
      /absente de @rueda\/i18n/,
    ],
    [
      'locale juridique hors du pays',
      (s) => (country(s, 'PA')['legalLocale'] = 'es-PY'),
      /legalLocale/,
    ],
    [
      'nom manquant (fr)',
      (s) => delete (country(s, 'PA')['names'] as Record<string, unknown>)['fr'],
      /names\.fr/,
    ],
    [
      'type de ligne absent',
      (s) => (country(s, 'PA')['taxLines'] = (country(s, 'PA')['taxLines'] as unknown[]).slice(1)),
      /TRIP_PRICE.*absente/,
    ],
    [
      'groupe fiscal incohérent',
      (s) => ((country(s, 'PY')['taxLines'] as Record<string, unknown>[])[1]!['rateBps'] = 500),
      /incohérent/,
    ],
    ['contrôle tzdata manquant', (s) => (country(s, 'PY')['timeZoneChecks'] = []), /tzdata/],
    ['entité juridique non déclarée', (s) => delete country(s, 'PA')['legalEntity'], /legalEntity/],
    ['champ inconnu', (s) => (country(s, 'PA')['vatRate'] = 7), /champ inconnu « vatRate »/],
    [
      'clé en double',
      (s) => s.params.params.push({ ...param(s, 'hold_ttl_minutes') }),
      /clé en double/,
    ],
    [
      'flottant',
      (s) => ((param(s, 'grace_minutes')['values'] as Record<string, unknown>)['PA'] = 29.5),
      /entier/,
    ],
    [
      'flottant dans un JSON',
      (s) =>
        ((param(s, 'refund_reminders_days')['values'] as Record<string, unknown>)['PA'] = [1.5]),
      /aucun flottant/,
    ],
    [
      'montant en nombre',
      (s) =>
        ((param(s, 'ach_xpress_max_minor')['values'] as Record<string, unknown>)['PA'] = 500000),
      /unités mineures/,
    ],
    [
      'ENUM hors liste',
      (s) => ((param(s, 'collection_mode')['values'] as Record<string, unknown>)['PA'] = 'AGENCY'),
      /valeur attendue parmi/,
    ],
    [
      'ENUM sans liste',
      (s) => delete param(s, 'collection_mode')['allowedValues'],
      /allowedValues/,
    ],
    [
      'interrupteur non fail-closed',
      (s) => (param(s, 'payouts_enabled')['failMode'] = 'BLOCK'),
      /interrupteur/,
    ],
    [
      'interrupteur de portée ORG',
      (s) => (param(s, 'payouts_enabled')['scopes'] = ['ORG', 'COUNTRY']),
      /interrupteur/,
    ],
    [
      'FALSE sur un entier',
      (s) => (param(s, 'hold_ttl_minutes')['failMode'] = 'FALSE'),
      /FALSE réservé/,
    ],
    [
      'valeur dans un pays sans objet',
      (s) => ((param(s, 'ach_xpress_max_minor')['values'] as Record<string, unknown>)['PY'] = '1'),
      /sans objet/,
    ],
    [
      'pays inconnu dans une valeur',
      (s) => ((param(s, 'hold_ttl_minutes')['values'] as Record<string, unknown>)['CO'] = 10),
      /pays inconnu/,
    ],
    [
      'portée non permise',
      (s) =>
        (param(s, 'hold_ttl_minutes')['scoped'] = [
          { country: 'PA', scopeType: 'ORG', scopeId: 'x', value: 5 },
        ]),
      /non permise/,
    ],
    ['clé non snake_case', (s) => (param(s, 'hold_ttl_minutes')['key'] = 'HoldTtl'), /snake_case/],
    [
      'fail_mode inconnu',
      (s) => (param(s, 'hold_ttl_minutes')['failMode'] = 'DEFAULT'),
      /failMode/,
    ],
  ];

  it.each(cases)('%s', (_name, mutate, message) => {
    const sources = cloneSources();
    mutate(sources);
    expect(errorCode(() => parse(sources))).toBe('CONFIG_INVALID');
    expect(errorDetails(() => parse(sources)).join('\n')).toMatch(message);
  });

  it('liste tous les défauts, pas seulement le premier', () => {
    const sources = cloneSources();
    country(sources, 'PA')['timeZone'] = 'Nowhere/Nothing';
    country(sources, 'PY')['currency'] = 'EUR';
    expect(errorDetails(() => parse(sources)).length).toBeGreaterThanOrEqual(2);
  });

  it('un document absent est refusé', () => {
    expect(errorCode(() => parse({ ...cloneSources(), params: undefined } as never))).toBe(
      'CONFIG_INVALID',
    );
  });
});
