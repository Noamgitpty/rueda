/**
 * US-013 — critères « clé obligatoire manquante ⇒ refus explicite au démarrage de la production »
 * (16 ADM-014) et « tzdata contrôlée au démarrage » (17 §1.3, ADR-019, OQ-BR-20).
 *
 * Liste attendue des manques : les valeurs « à fixer » de 17 §7.2 (et les « à fixer » du PY),
 * l'entité juridique (ADR-013 en attente) et les fériés (aucune liste dans les spécifications).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CfgModule } from '../cfg.module.js';
import { loadRepositoryConfig } from './load.js';
import type { CountryConfig, ParamDefinition, ParamJson, ParamValue } from './model.js';
import { assertProductionReady, findReadinessIssues } from './readiness.js';
import { parseRuntimeEnvironment, runStartupChecks } from './startup.js';
import {
  checkPostgresTimeZoneData,
  checkRuntimeTimeZoneData,
  runtimeUtcOffsetMinutes,
} from './tzdata.js';
import { cloneSources, country, errorCode, errorDetails, parse } from './test-helpers.js';

const config = loadRepositoryConfig();
const at = new Date('2026-11-03T12:00:00Z');

// 17 §7.2 : clés « à fixer » (J-ADM-031, contrat d'assureur, OQ-PAY-18), communes aux deux pays.
const TO_FIX_BOTH = [
  'damage_overcharge_refund_days',
  'deposit_amount',
  'deposit_max',
  'fuel_refill_max',
  'host_advance_cap_minor',
  'incidental_charge_deadline_days',
  'insurer_premium_share',
  'insurer_roadside_share',
  'late_fee_cap',
  'max_reattempts',
  'platform_reserve_minor',
  'reconciliation_delta_threshold_bps',
];
// 17 §7.2 : « à fixer » au PA seulement (commercial_gesture_cap : « — » au PY).
const TO_FIX_PA = ['commercial_gesture_cap'];
// 17 §7.2 : colonne PY « à fixer ».
const TO_FIX_PY = [
  'biometric_appeal_retention_days',
  'biometric_retention_max_years',
  'biometric_score_retention_days',
  'trip_id_evidence_retention_days',
  'webhook_raw_body_retention_days',
];

describe('contrôle de production sur la configuration du dépôt', () => {
  const issues = findReadinessIssues(config, at);
  const missing = (c: string): string[] =>
    issues.filter((i) => i.country === c && i.kind === 'PARAM_MISSING').map((i) => i.key!);

  it('PA : exactement les clés « à fixer »', () => {
    expect(missing('PA')).toEqual([...TO_FIX_BOTH, ...TO_FIX_PA].sort());
  });

  it('PY : exactement les clés « à fixer »', () => {
    expect(missing('PY')).toEqual([...TO_FIX_BOTH, ...TO_FIX_PY].sort());
  });

  it('entité juridique et fériés manquent dans les deux pays', () => {
    for (const c of ['PA', 'PY']) {
      expect(issues.filter((i) => i.country === c && i.key === null).map((i) => i.kind)).toEqual([
        'LEGAL_ENTITY_MISSING',
        'HOLIDAYS_MISSING',
      ]);
    }
  });

  it('interrupteurs, clés FALSE / ZERO, optionnelles et sans objet ne sont pas exigés', () => {
    const keys = new Set(issues.map((i) => i.key));
    for (const key of [
      'p2p_private_hosts_enabled',
      'payouts_enabled',
      'platform_funded_host_compensation',
      'provider_max_hold_h',
      'deposit_charge_cap',
      'billing_boundary_minutes',
      'delivery_share_pct',
    ]) {
      expect(keys.has(key)).toBe(false);
    }
    expect(issues.some((i) => i.country === 'PY' && i.key === 'ach_xpress_max_minor')).toBe(false);
    expect(issues.some((i) => i.country === 'PA' && i.key === 'price_display_step_minor')).toBe(
      false,
    );
  });
});

/** Valeur de test d'un type (jamais une valeur métier). */
function sample(def: ParamDefinition): ParamJson {
  switch (def.type) {
    case 'BOOL':
      return true;
    case 'MONEY':
      return '1';
    case 'ENUM':
      return def.allowedValues![0]!;
    case 'JSON':
      return { test: '1' };
    default:
      return 1;
  }
}

/** Configuration complétée par des valeurs de test, pour isoler le critère. */
function completeConfig(): CountryConfig {
  const sources = cloneSources();
  for (const code of ['PA', 'PY']) {
    country(sources, code)['legalEntity'] = {
      name: 'Entité de test',
      countryOfIncorporation: code,
      taxId: 'TEST-0001',
      invoicingRegime: 'TEST_REGIME',
    };
    country(sources, code)['holidayCalendar'] = {
      version: 1,
      holidays: [{ date: '2026-12-25', name: 'Test' }],
    };
  }
  const base = parse(sources);
  const extra: ParamValue[] = findReadinessIssues(base, at)
    .filter((i) => i.kind === 'PARAM_MISSING')
    .map((i) => {
      const def = base.definitions.get(i.key!)!;
      const scopeType = def.scopes.includes('COUNTRY') ? 'COUNTRY' : def.scopes[0]!;
      return {
        key: def.key,
        country: i.country,
        scopeType,
        scopeId: scopeType === 'COUNTRY' || scopeType === 'NETWORK' ? null : 'TEST',
        network: scopeType === 'NETWORK' ? 'TEST' : null,
        currency: null,
        value: sample(def),
        validFrom: null,
        validTo: null,
      };
    });
  return { ...base, values: [...base.values, ...extra] };
}

describe('clé obligatoire manquante ⇒ refus explicite (16 ADM-014)', () => {
  it('configuration complète : aucun manque', () => {
    expect(findReadinessIssues(completeConfig(), at)).toEqual([]);
    expect(() => assertProductionReady(completeConfig(), at)).not.toThrow();
  });

  it.each(['PA', 'PY'])('une clé retirée au %s : PARAM_MISSING qui la nomme', (c) => {
    const complete = completeConfig();
    const without = {
      ...complete,
      values: complete.values.filter((v) => !(v.key === 'hold_ttl_minutes' && v.country === c)),
    };
    expect(errorCode(() => assertProductionReady(without, at))).toBe('PARAM_MISSING');
    expect(errorDetails(() => assertProductionReady(without, at))).toEqual([
      `${c} hold_ttl_minutes`,
    ]);
  });

  it('fériés de l’année contrôlée absents ⇒ refus', () => {
    expect(findReadinessIssues(completeConfig(), new Date('2027-03-01T00:00:00Z'))).toEqual([
      { country: 'PA', kind: 'HOLIDAYS_MISSING', key: null },
      { country: 'PY', kind: 'HOLIDAYS_MISSING', key: null },
    ]);
  });
});

describe('environnement d’exécution (RUEDA_ENV)', () => {
  it('absent ou inconnu ⇒ production (fail-closed)', () => {
    expect(parseRuntimeEnvironment(undefined)).toBe('production');
    expect(parseRuntimeEnvironment('')).toBe('production');
    expect(parseRuntimeEnvironment('PRODUCTION')).toBe('production');
    expect(parseRuntimeEnvironment('staging')).toBe('production');
    expect(parseRuntimeEnvironment('development')).toBe('development');
    expect(parseRuntimeEnvironment('preproduction')).toBe('preproduction');
  });

  it('hors production : tzdata seule ; en production : données obligatoires en plus', () => {
    expect(runStartupChecks({ environment: 'development', config, at })).toBe('development');
    expect(errorCode(() => runStartupChecks({ environment: 'production', config, at }))).toBe(
      'PARAM_MISSING',
    );
    expect(errorCode(() => runStartupChecks({ environment: undefined, config, at }))).toBe(
      'PARAM_MISSING',
    );
    expect(runStartupChecks({ environment: 'production', config: completeConfig(), at })).toBe(
      'production',
    );
  });
});

describe('démarrage du module CFG (NestJS)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('RUEDA_ENV absent : le démarrage échoue avec PARAM_MISSING', async () => {
    vi.stubEnv('RUEDA_ENV', undefined);
    await expect(
      NestFactory.createApplicationContext(CfgModule, { logger: false }),
    ).rejects.toMatchObject({
      code: 'PARAM_MISSING',
    });
  });

  it('RUEDA_ENV=development : le démarrage réussit', async () => {
    vi.stubEnv('RUEDA_ENV', 'development');
    const app = await NestFactory.createApplicationContext(CfgModule, { logger: false });
    await app.close();
  });
});

describe('tzdata (17 §1.3 ; ADR-019 ; OQ-BR-20 ; EC-33)', () => {
  it('runtime : America/Asuncion = UTC−3 permanent (08 BR-CXL-00, Ley 7354/2024), America/Panama = UTC−5', () => {
    expect(runtimeUtcOffsetMinutes('2025-07-15T12:00:00Z', 'America/Asuncion')).toBe(-180);
    expect(runtimeUtcOffsetMinutes('2023-07-15T12:00:00Z', 'America/Asuncion')).toBe(-240);
    expect(runtimeUtcOffsetMinutes('2026-07-01T12:00:00Z', 'America/Panama')).toBe(-300);
    expect(() => checkRuntimeTimeZoneData(config)).not.toThrow();
  });

  it('une tzdata ancienne (UTC−4 l’hiver austral) ⇒ TZDATA_MISMATCH', () => {
    const sources = cloneSources();
    // Simule l'attente qu'aurait vérifiée une tzdata d'avant la loi : l'écart doit être détecté.
    country(sources, 'PY')['timeZoneChecks'] = [
      { instant: '2025-07-15T12:00:00Z', offsetMinutes: -240 },
    ];
    expect(errorCode(() => checkRuntimeTimeZoneData(parse(sources)))).toBe('TZDATA_MISMATCH');
    expect(
      errorCode(() => runStartupChecks({ environment: 'development', config: parse(sources), at })),
    ).toBe('TZDATA_MISMATCH');
  });

  it('PostgreSQL : chaque attente est interrogée, un écart est refusé', async () => {
    const asked: [string, string][] = [];
    await checkPostgresTimeZoneData(config, async (_sql, [instant, tz]) => {
      asked.push([instant, tz]);
      return runtimeUtcOffsetMinutes(instant, tz);
    });
    expect(asked.length).toBe(
      [...config.countries.values()].reduce((n, c) => n + c.timeZoneChecks.length, 0),
    );
    await expect(checkPostgresTimeZoneData(config, async () => -240)).rejects.toMatchObject({
      code: 'TZDATA_MISMATCH',
    });
  });
});
