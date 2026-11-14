/**
 * US-110 — paramètres par défaut de Panama et du Paraguay (16 ADM-031, 17 §7.2, 22).
 *
 * Critères de 19 US-110 :
 * 1. Given `platform_funded_host_compensation` absent, When T61 est rejoué, Then compensation 0.
 * 2. Given une valeur encore « À DÉCIDER », When un déploiement de production est demandé, Then il
 *    est refusé (valeurs de test autorisées en préproduction).
 * Notes techniques : chaque valeur porte son statut (PROPOSÉ / DÉCIDÉ / À DÉCIDER) et sa source.
 *
 * Attendus : 17 §7.2 (statuts, défauts), 16 ADM-031 (liste des valeurs À DÉCIDER au jalon
 * J-ADM-031), 22 (défauts fail-closed : OQ-BR-04 29 min, OQ-BR-30 25 h, OQ-BR-33 60 min,
 * DEC-FONDATEUR-01 `false`), DEC-FONDATEUR-19 (aucun plafond de véhicules) ; montants de T61 :
 * export des oracles Python (`@rueda/money/golden-vectors`), jamais le code testé.
 */
import { checksFor, loadGoldenVectors, settlementVector } from '@rueda/money/golden-vectors';
import type { GoldenValue } from '@rueda/money/golden-vectors';
import { settleVector, testParams, toEvent, toTrip } from '@rueda/money/testing';
import { computeCancellationSettlement } from '@rueda/money';
import { describe, expect, it } from 'vitest';
import { loadRepositoryConfig } from './load.js';
import { DECISION_STATUSES } from './model.js';
import type { CountryConfig, ParamValue } from './model.js';
import { assertProductionReady, findReadinessIssues } from './readiness.js';
import { resolveParam } from './resolve.js';
import { runStartupChecks } from './startup.js';
import {
  cloneSources,
  completeConfig,
  country,
  errorCode,
  errorDetails,
  param,
  parse,
  READINESS_AT,
} from './test-helpers.js';

const config = loadRepositoryConfig();
const at = READINESS_AT;
const COUNTRIES = ['PA', 'PY'] as const;

const def = (key: string) => {
  const d = config.definitions.get(key);
  if (!d) throw new Error(`clé ${key} absente`);
  return d;
};

// 16 ADM-031 : « valeurs de lancement À DÉCIDER au jalon J-ADM-031 » (clés de 17 §7.2).
const ADM_031_KEYS = [
  'min_driver_age',
  'host_min_age_years',
  'advance_notice_minutes',
  'buffer_minutes',
  'free_cancel_lead',
  'last_minute_threshold',
  'host_penalty',
  'grace_minutes',
  'no_show_grace_minutes',
  'host_default_plan',
  'guest_protection_min_level',
  'review_window_days',
  'p2p_default_booking_mode',
  'self_booking_forbidden',
  'claim_declaration_window_h',
  'max_trip_days',
  'platform_reserve_minor',
  'host_advance_cap_minor',
  'platform_funded_host_compensation',
];

/**
 * Liste attendue **exacte** des clés « À DÉCIDER » (revues qa et sécurité US-110) : toute
 * différence avec le dépôt, dans un sens ou dans l'autre, fait échouer le test. Chaque clé porte
 * la source qui la rend À DÉCIDER :
 * - « 17 statut » : la colonne « Statut / OQ » de 17 §7.2 cite une question ouverte (OQ, UXQ,
 *   J-ADM-031, contrat d'assureur) ou « à fixer » ;
 * - « 17 source » : la colonne « Source » de 17 §7.2 cite une OQ ouverte (ADR-093, point 2) ;
 * - « 16 ADM-031 » : valeur de lancement « À DÉCIDER au jalon J-ADM-031 » ;
 * - « 22 » : défaut fail-closed d'une question ouverte (OQ-BR-04, DEC-FONDATEUR-01) ;
 * - « lot C » : rail du PSP, choisi avec le pays (DEC-PAYS, porte PAY-041).
 */
const EXPECTED_TO_DECIDE: Readonly<Record<string, string>> = {
  advance_notice_minutes: '16 ADM-031 ; 17 statut ADM-031',
  ach_xpress_max_minor: 'lot C (17 statut « rail du PSP »)',
  audit_log_retention_years: '17 statut OQ-BR-25',
  auth_lead_h: '17 statut OQ-PAY-02',
  billing_boundary_minutes: '17 statut OQ-BR-04 ; 22',
  biometric_appeal_retention_days: '17 statut OQ-BR-25, OQ-MK-09',
  biometric_retention_max_years: '17 statut OQ-BR-25, OQ-MK-09',
  biometric_score_retention_days: '17 statut OQ-BR-25, OQ-MK-09',
  booking_request_expiry_hours: '17 source OQ-P2P-10',
  buffer_minutes: '16 ADM-031 ; 17 statut ADM-031',
  chargeback_window_days: '17 statut OQ-BR-43',
  claim_declaration_window_h: '16 ADM-031 ; 17 statut ADM-031',
  commercial_gesture_cap: '17 statut J-ADM-031',
  damage_charge_deadline_days: '17 statut OQ-PAY-18',
  damage_notice_days: '17 statut OQ-PAY-18',
  damage_overcharge_refund_days: '17 statut J-ADM-031',
  deposit_amount: '17 statut J-ADM-031 ; 17 source OQ-BR-47',
  deposit_charge_cap: '17 statut OQ-PAY-06, OQ-PAY-19',
  deposit_max: '17 statut J-ADM-031',
  deposit_safety_h: '17 statut OQ-PAY-02',
  elig_age_years_ceiling: '16 HST-019 (« valeurs À DÉCIDER dans ADM-031 ») ; 22 OQ-P2P-02 (US-124)',
  elig_doc_compulsory_insurance: '16 HST-039 ; 22 OQ-P2P-02 (US-124)',
  elig_doc_inspection: '16 HST-039 ; 22 OQ-P2P-02 (US-124)',
  elig_doc_lender_consent: '16 HST-039 ; 22 OQ-P2P-02, OQ-BR-28 (US-124)',
  elig_doc_owner_authorization: '16 HST-039 ; 22 OQ-P2P-02 (US-124)',
  elig_doc_plate_vin_photo: '16 HST-039 ; 22 OQ-P2P-02 (US-124)',
  elig_doc_title: '16 HST-039 ; 22 OQ-P2P-02 (US-124)',
  elig_odometer_km_ceiling:
    '16 HST-019 (« valeurs À DÉCIDER dans ADM-031 ») ; 22 OQ-P2P-02 (US-124)',
  evidence_retention_months: '17 statut OQ-BR-25',
  flagged_booking_payment_order: '17 statut UXQ-08',
  free_cancel_lead: '16 ADM-031 ; 17 statut ADM-031',
  fuel_refill_max: '17 statut J-ADM-031',
  grace_minutes: '16 ADM-031 ; 17 statut OQ-BR-04 ; 22',
  guest_protection_min_level: '16 ADM-031 ; 17 source OQ-P2P-12',
  host_advance_cap_minor: '16 ADM-031',
  host_default_plan: '16 ADM-031 ; 17 source OQ-P2P-11',
  host_min_age_years: '16 ADM-031 ; 17 source OQ-P2P-01',
  host_penalty: '16 ADM-031 ; 17 statut OQ-BR-24',
  host_share_pct: '16 ADM-031 (ESTÁNDAR 75 %) ; 17 statut OQ-P2P-11',
  incidental_charge_deadline_days: '17 statut J-ADM-031',
  insurer_premium_share: '17 statut contrat d’assureur',
  insurer_roadside_share: '17 statut contrat d’assureur',
  insurer_settlement_at: '17 statut contrat d’assureur',
  last_minute_threshold: '16 ADM-031 ; 17 statut OQ-BR-30 ; 22',
  late_fee_cap: '17 statut J-ADM-031',
  marge_h: '17 statut OQ-PAY-02',
  max_reattempts: '17 statut OQ-PAY-18',
  max_trip_days: '16 ADM-031 (17 statut : décidé pour la bêta)',
  min_driver_age: '16 ADM-031 ; 17 statut ADM-031',
  no_show_grace_minutes: '16 ADM-031 ; 17 statut OQ-BR-33 ; 22',
  overdue_detection_minutes: '22 OQ-BR-04 (= grace_minutes + 1 ; 17 statut : décidé)',
  p2p_default_booking_mode: '16 ADM-031',
  p2p_host_requires_tax_id: '17 source OQ-PAY-09, OQ-P2P-07',
  platform_funded_host_compensation: '16 ADM-031 ; 22 DEC-FONDATEUR-01',
  platform_reserve_minor: '16 ADM-031',
  provider_max_hold_h: '17 statut OQ-PAY-02',
  reconciliation_delta_threshold_bps: '17 statut J-ADM-031',
  refund_protection_on_nr: '17 statut OQ-BR-42',
  refund_reminders_days: '17 statut OQ-BR-44',
  release_delay_h: '17 statut OQ-PAY-02',
  review_hold_minutes: '17 statut UXQ-08',
  review_window_days: '16 ADM-031 ; 17 source OQ-P2P-06 (17 statut : décidé comme Turo)',
  security_incident_authority_notice_hours: '22 OQ-MK-09 (défaut 72 h, US-112)',
  security_incident_subjects_notice_hours: '22 OQ-MK-09 (défaut 72 h, US-112)',
  self_booking_forbidden: '16 ADM-031 ; 17 source OQ-P2P-08',
  trip_fee_schedule: '17 statut OQ-MK-01',
  trip_id_evidence_retention_days: '17 statut OQ-BR-25, OQ-MK-09',
  visa_objection_days: '17 statut OQ-PAY-18',
  webhook_raw_body_retention_days: '17 statut OQ-BR-25, OQ-MK-09',
};

describe('statut et source de chaque valeur (19 US-110, notes techniques)', () => {
  it('chaque clé porte un statut de la liste fermée et une référence de décision', () => {
    for (const d of config.definitions.values()) {
      expect(DECISION_STATUSES, d.key).toContain(d.decision);
      expect(d.decisionRef.trim(), d.key).not.toBe('');
      expect(d.source.trim(), d.key).not.toBe('');
    }
  });

  it('chaque valeur PA / PY hérite du statut et de la source de sa clé', () => {
    expect(config.values.length).toBeGreaterThan(0);
    for (const v of config.values) {
      const d = def(v.key);
      expect([v.decision, v.decisionRef, v.source], v.key).toEqual([
        d.decision,
        d.decisionRef,
        d.source,
      ]);
    }
    for (const c of COUNTRIES) expect(config.values.some((v) => v.country === c)).toBe(true);
  });

  it('DÉCIDÉ seulement si 17 §7.2 dit « décidé », ou pour un interrupteur à false', () => {
    for (const d of config.definitions.values()) {
      if (d.decision !== 'DECIDED') continue;
      expect(d.status.startsWith('décidé') || d.goLiveSwitch, d.key).toBe(true);
    }
  });

  it('ensemble des clés À DÉCIDER = liste attendue exacte (17, 22, 16 ADM-031), dans les deux sens', () => {
    const actual = [...config.definitions.values()]
      .filter((d) => d.decision === 'TO_DECIDE')
      .map((d) => d.key)
      .sort();
    expect(actual).toEqual(Object.keys(EXPECTED_TO_DECIDE).sort());
  });

  it('une question ouverte citée par 17 §7.2, en statut ou en source ⇒ À DÉCIDER (sauf interrupteurs)', () => {
    const open = /OQ-|UXQ-|DEC-FONDATEUR-01|J-ADM-031|ADM-031|à fixer|contrat/;
    for (const d of config.definitions.values()) {
      // Interrupteurs : false décidé (17 §0.1) ; leurs OQ ferment la mise en service par US-125.
      if (d.goLiveSwitch) continue;
      if (open.test(d.status) || open.test(d.source)) expect(d.decision, d.key).toBe('TO_DECIDE');
    }
  });

  it('les valeurs de lancement de 16 ADM-031 sont À DÉCIDER (J-ADM-031)', () => {
    for (const key of ADM_031_KEYS) expect(def(key).decision, key).toBe('TO_DECIDE');
    // taxe 7 % au PA et 10 % au PY (OQ-BR-14)
    for (const c of COUNTRIES) {
      expect(config.countries.get(c)?.taxDecision.decision, c).toBe('TO_DECIDE');
      expect(config.countries.get(c)?.taxDecision.decisionRef, c).toContain('OQ-BR-14');
    }
  });

  it('interrupteurs : DÉCIDÉ à false dans les deux pays (17 §0.1 ; leur passage est US-125)', () => {
    for (const key of [
      'p2p_private_hosts_enabled',
      'insurer_contract_active',
      'funds_holding_enabled',
      'payouts_enabled',
    ]) {
      expect(def(key).decision, key).toBe('DECIDED');
      for (const c of COUNTRIES) {
        expect(resolveParam(config, key, { country: c, at }).value, `${c} ${key}`).toBe(false);
      }
    }
  });
});

describe('défauts fail-closed de 22 chargés pour PA et PY (19 US-110, « Bloqué par »)', () => {
  it.each(COUNTRIES)('%s : OQ-BR-04 29 min, OQ-BR-30 25 h, OQ-BR-33 60 min, À DÉCIDER', (c) => {
    const cases: [string, number, string][] = [
      ['grace_minutes', 29, 'OQ-BR-04'],
      ['last_minute_threshold', 25, 'OQ-BR-30'],
      ['no_show_grace_minutes', 60, 'OQ-BR-33'],
    ];
    for (const [key, expected, ref] of cases) {
      const r = resolveParam(config, key, { country: c, at });
      expect([r.value, r.origin], key).toEqual([expected, 'VALUE']);
      expect(def(key).decision, key).toBe('TO_DECIDE');
      expect(def(key).decisionRef, key).toContain(ref);
    }
  });

  it.each(COUNTRIES)('%s : free_cancel_lead 24 h et trip_fee_schedule de 17 §7.2', (c) => {
    expect(resolveParam(config, 'free_cancel_lead', { country: c, at }).value).toBe(24);
    // 17 §7.2 : 15 / 12 / 8 % ; minimum 5 USD (500 cents) au PA, 35 000 PYG au PY (BR-PRICE-06)
    const fee = resolveParam(config, 'trip_fee_schedule', { country: c, at });
    expect(fee.value).toEqual({
      tiers: [
        { maxDays: 6, rateBps: 1500 },
        { maxDays: 29, rateBps: 1200 },
        { maxDays: null, rateBps: 800 },
      ],
      minMinor: c === 'PA' ? '500' : '35000',
    });
    expect(fee.currency).toBe(c === 'PA' ? 'USD' : 'PYG');
  });

  it('ach_xpress_max_minor : 500 000 (5 000 USD) au PA, sans objet au PY (17 §7.2)', () => {
    const r = resolveParam(config, 'ach_xpress_max_minor', { country: 'PA', at });
    expect([r.value, r.currency]).toEqual(['500000', 'USD']);
    expect(
      errorCode(() => resolveParam(config, 'ach_xpress_max_minor', { country: 'PY', at })),
    ).toBe('PARAM_NOT_APPLICABLE');
  });

  it.each(COUNTRIES)(
    '%s : platform_funded_host_compensation absent ⇒ false (DEC-FONDATEUR-01)',
    (c) => {
      expect(config.values.some((v) => v.key === 'platform_funded_host_compensation')).toBe(false);
      const r = resolveParam(config, 'platform_funded_host_compensation', { country: c, at });
      expect([r.value, r.origin]).toEqual([false, 'FAIL_MODE']);
      expect(def('platform_funded_host_compensation').decisionRef).toContain('DEC-FONDATEUR-01');
    },
  );

  it('montants : chaînes d’entiers en unités mineures, devise du pays (USD au PA, PYG au PY)', () => {
    const expected: Record<string, string> = { PA: 'USD', PY: 'PYG' };
    const money = config.values.filter((v) => def(v.key).currencyBound);
    for (const c of COUNTRIES) expect(money.some((v) => v.country === c)).toBe(true);
    const minor = (x: unknown): void => {
      if (typeof x === 'string') expect(x).toMatch(/^(0|[1-9][0-9]*)$/);
      else if (Array.isArray(x)) x.forEach(minor);
      else if (x !== null && typeof x === 'object') Object.values(x).forEach(minor);
    };
    for (const v of money) {
      expect(v.currency, `${v.country} ${v.key}`).toBe(expected[v.country]);
      if (def(v.key).type === 'MONEY') minor(v.value);
    }
    // 17 §7.2 host_penalty : 2 500 / 5 000 / 15 000 / 5 000 (USD) ; 200 000 / 400 000 / 1 200 000 / 400 000 (PYG)
    const penalty = (c: string): ParamValue['value'] =>
      resolveParam(config, 'host_penalty', { country: c, at }).value;
    expect(penalty('PA')).toEqual({
      cxlEarly: '2500',
      cxlLate: '5000',
      hostNoShow: '15000',
      cleanliness: '5000',
    });
    expect(penalty('PY')).toEqual({
      cxlEarly: '200000',
      cxlLate: '400000',
      hostNoShow: '1200000',
      cleanliness: '400000',
    });
  });

  describe('DEC-FONDATEUR-19 : aucun plafond de véhicules ou d’annonces par hôte', () => {
    // Un mot de flotte et un mot de borne, dans un ordre ou dans l'autre, n'importe où dans la clé
    // (pas de borne de mot : `_` est un caractère de mot ; revue qa US-110, constat 1).
    const FLEET =
      '(vehicle|vehicule|vehiculo|car|auto|listing|annonce|anuncio|fleet|flota|flotte|unit)';
    const BOUND = '(max|cap|limit|quota|plafond|tope|ceiling|count|size)';
    const cap = new RegExp(`${BOUND}.*${FLEET}|${FLEET}.*${BOUND}`);
    const mustMatch = [
      'max_vehicles_per_host',
      'max_cars_per_host',
      'max_vehicle_count',
      'max_fleet_size',
      'fleet_size_max',
      'vehicle_quota',
      'max_vehicules',
      'max_annonces',
      'max_autos_per_host',
      'max_units',
      'host_vehicle_cap',
      'vehicle_limit',
      'max_listings',
      'listing_max',
      'max_active_vehicles',
      'vehicles_per_host_max',
      'host_max_vehicles',
      'plafond_vehicules_hote',
      'tope_vehiculos',
    ];
    // Clés existantes qui ne bornent pas une flotte : elles ne doivent pas correspondre.
    const mustNotMatch = [
      'hold_creations_per_guest_vehicle_hour',
      'vehicle_financed_requires_lender_consent',
      'max_trip_days',
      'max_active_holds_per_guest',
      'catalog_addition_sla_business_h',
    ];

    it.each(mustMatch)('« %s » est reconnu comme un plafond', (key) => {
      expect(key).toMatch(cap);
    });

    it.each(mustNotMatch)('« %s » n’est pas un plafond de flotte', (key) => {
      expect(key).not.toMatch(cap);
    });

    it('aucune clé du dépôt n’est un plafond de flotte', () => {
      for (const key of config.definitions.keys()) expect(key, key).not.toMatch(cap);
    });
  });
});

describe('T61 rejoué avec la configuration PA / PY (critère 1)', () => {
  const set = loadGoldenVectors();
  const check = (label: string): readonly GoldenValue[] => {
    const found = checksFor(set, 'T61').find((x) => x.label === label);
    if (!found || !Array.isArray(found.expected)) throw new Error(`contrôle ${label} absent`);
    return found.expected as readonly GoldenValue[];
  };
  const int = (value: GoldenValue | undefined): bigint => {
    if (typeof value !== 'bigint') throw new Error('entier attendu');
    return value;
  };
  // Export de check_t49plus.py : [absent, non booléen, true (T17), payable (b)].
  const [absent, , withTrue, payable] = check('T61').map(int);
  const resolved = (c: string) =>
    resolveParam(config, 'platform_funded_host_compensation', { country: c, at }).value;

  it('PA (USD) : T61 (a) sur T17, paramètre résolu de la configuration ⇒ compensation 0', () => {
    const s = settleVector(settlementVector(set, 'T17'), {
      platformFundedHostCompensation: resolved('PA'),
    });
    expect(s.hostCompensation.amountMinor).toBe(absent);
    expect(s.hostEarnings.amountMinor).toBe(absent);
    expect(s.platformNet.amountMinor).toBe(absent);
    // Témoin : la même annulation avec `true` explicite (option A) donnerait 45,00.
    expect(
      settleVector(settlementVector(set, 'T17'), { platformFundedHostCompensation: true })
        .hostCompensation.amountMinor,
    ).toBe(withTrue);
  });

  it('PA (USD) : T61 (b) PSP_FAILURE à T − 2 h, paramètre résolu ⇒ compensation 0', () => {
    const v = settlementVector(set, 'T17');
    const trip = toTrip(v.trip);
    const event = { ...toEvent(v.event), reason: 'PSP_FAILURE' as const };
    const s = computeCancellationSettlement(
      trip,
      event,
      testParams(trip.currency, { platformFundedHostCompensation: resolved('PA') }),
    );
    expect(s.hostCompensation.amountMinor).toBe(absent);
    // Témoin `true` (option A) : 45,00 payables bien que rien ne soit encaissé. L'oracle le calcule
    // avec collected = 0 (`hostPayable(0, compensation(True, hp), 0, [], A_TOTAL)`) ; le moteur ne
    // prend pas l'encaissement en entrée : sa compensation ne dépend pas de `collected`.
    const optionA = computeCancellationSettlement(
      trip,
      event,
      testParams(trip.currency, { platformFundedHostCompensation: true }),
    );
    expect(optionA.hostCompensation.amountMinor).toBe(payable);
  });

  it('PY (PYG) : annulation de T17 sur le trip D (T48), paramètre résolu ⇒ compensation 0', () => {
    // Aucun vecteur T61 en PYG : 08 (option B, défaut fail-closed) fixe la compensation à 0 quelle
    // que soit la devise ; l'événement est celui de T17 (PLATFORM_REVIEW_DELAY à T − 2 h).
    const trip = toTrip(settlementVector(set, 'T48').trip);
    expect(trip.currency.code).toBe('PYG');
    const event = toEvent(settlementVector(set, 'T17').event);
    const run = (value: unknown) =>
      computeCancellationSettlement(
        trip,
        event,
        testParams(trip.currency, { platformFundedHostCompensation: value }),
      ).hostCompensation.amountMinor;
    expect(run(resolved('PY'))).toBe(0n);
    // Témoin non vide : l'événement ouvre bien le cas de compensation (option A, non décidée).
    expect(run(true)).toBeGreaterThan(0n);
  });
});

describe('valeur « À DÉCIDER » ⇒ production refusée, préproduction permise (critère 2)', () => {
  /** Configuration complète (aucun manque), statuts du dépôt conservés. */
  const withStatuses = completeConfig({ decided: false });

  it('dépôt : PARAM_UNDECIDED pour chaque valeur À DÉCIDER en vigueur, dans les deux pays', () => {
    const issues = findReadinessIssues(withStatuses, at);
    expect(issues.every((i) => i.kind === 'PARAM_UNDECIDED' || i.kind === 'TAX_UNDECIDED')).toBe(
      true,
    );
    for (const c of COUNTRIES) {
      const keys = issues
        .filter((i) => i.country === c && i.kind === 'PARAM_UNDECIDED')
        .map((i) => i.key);
      const expected = [
        ...new Set(
          config.values
            .filter((v) => v.country === c && v.decision === 'TO_DECIDE')
            .map((v) => v.key),
        ),
      ].sort();
      expect(keys).toEqual(expected);
      for (const key of ['grace_minutes', 'last_minute_threshold', 'no_show_grace_minutes'])
        expect(keys, `${c} ${key}`).toContain(key);
      // valeurs DÉCIDÉES ou PROPOSÉES : jamais listées
      expect(keys).not.toContain('payment_attempts_per_hold');
      expect(keys).not.toContain('hold_ttl_minutes');
      expect(keys).not.toContain('payouts_enabled');
      // absent n'est pas une valeur (16 ADM-014 : absence de cette clé ⇒ false, pas de refus)
      expect(keys).not.toContain('platform_funded_host_compensation');
    }
  });

  it('production : PARAM_UNDECIDED, refus explicite qui nomme la clé, le pays et la question', () => {
    expect(errorCode(() => assertProductionReady(withStatuses, at))).toBe('PARAM_UNDECIDED');
    const details = errorDetails(() => assertProductionReady(withStatuses, at));
    expect(details).toContain(
      'PA grace_minutes (À DÉCIDER : OQ-BR-04 ; J-ADM-031 (défaut de 22 : 29 min))',
    );
    expect(details).toContain('PY TAX_UNDECIDED (À DÉCIDER : OQ-BR-14, OQ-MK-06 (avis fiscal))');
    for (const env of ['production', undefined, 'inconnu']) {
      expect(
        errorCode(() => runStartupChecks({ environment: env, config: withStatuses, at })),
        String(env),
      ).toBe('PARAM_UNDECIDED');
    }
  });

  it('préproduction (et développement, test) : valeurs de test permises', () => {
    for (const env of ['preproduction', 'development', 'test']) {
      expect(runStartupChecks({ environment: env, config: withStatuses, at })).toBe(env);
      expect(runStartupChecks({ environment: env, config, at })).toBe(env);
    }
  });

  it('une seule valeur À DÉCIDER, au PA ou au PY, suffit à refuser', () => {
    const decided = completeConfig();
    expect(() => assertProductionReady(decided, at)).not.toThrow();
    for (const c of COUNTRIES) {
      const one: CountryConfig = {
        ...decided,
        values: decided.values.map((v) =>
          v.key === 'grace_minutes' && v.country === c ? { ...v, decision: 'TO_DECIDE' } : v,
        ),
      };
      expect(errorCode(() => assertProductionReady(one, at))).toBe('PARAM_UNDECIDED');
      expect(errorDetails(() => assertProductionReady(one, at))).toEqual([
        `${c} grace_minutes (À DÉCIDER : ${def('grace_minutes').decisionRef})`,
      ]);
    }
  });

  it('taux de taxe à décider dans un seul pays : refus (TAX_UNDECIDED)', () => {
    const decided = completeConfig();
    const entry = decided.countries.get('PY')!;
    const countries = new Map(decided.countries);
    countries.set('PY', { ...entry, taxDecision: { decision: 'TO_DECIDE', decisionRef: 'x' } });
    const cfg: CountryConfig = { ...decided, countries };
    expect(errorDetails(() => assertProductionReady(cfg, at))).toEqual([
      'PY TAX_UNDECIDED (À DÉCIDER : x)',
    ]);
  });

  it('valeur À DÉCIDER fermée ou pas encore en vigueur : ne refuse pas ; remplacée par une décidée : passe', () => {
    const decided = completeConfig();
    const pick = decided.values.find((v) => v.key === 'grace_minutes' && v.country === 'PA')!;
    const others = decided.values.filter((v) => v !== pick);
    const closed: ParamValue = {
      ...pick,
      decision: 'TO_DECIDE',
      validFrom: new Date('2026-01-01T00:00:00Z'),
      validTo: new Date('2026-06-01T00:00:00Z'),
    };
    const nextDecided: ParamValue = {
      ...pick,
      decision: 'DECIDED',
      validFrom: new Date('2026-06-01T00:00:00Z'),
    };
    const future: ParamValue = {
      ...pick,
      decision: 'TO_DECIDE',
      validFrom: new Date('2027-01-01T00:00:00Z'),
    };
    const cfg: CountryConfig = { ...decided, values: [...others, closed, nextDecided, future] };
    expect(() => assertProductionReady(cfg, at)).not.toThrow();
    // à l'instant où la version future entre en vigueur, elle refuse
    const later = new Date('2027-02-01T00:00:00Z');
    expect(findReadinessIssues(cfg, later).filter((i) => i.kind === 'PARAM_UNDECIDED')).toEqual([
      {
        country: 'PA',
        kind: 'PARAM_UNDECIDED',
        key: 'grace_minutes',
        decisionRef: pick.decisionRef,
      },
    ]);
  });

  it('dépôt sans entité juridique ni fériés : PARAM_MISSING, la liste nomme aussi les valeurs à décider', () => {
    expect(errorCode(() => assertProductionReady(config, at))).toBe('PARAM_MISSING');
    const details = errorDetails(() => assertProductionReady(config, at));
    expect(details).toContain('PA LEGAL_ENTITY_MISSING');
    expect(details.some((d) => d.startsWith('PY grace_minutes (À DÉCIDER'))).toBe(true);
  });
});

describe('validation des statuts (fail-closed, CONFIG_INVALID)', () => {
  it('statut absent, inconnu ou référence vide ⇒ refus', () => {
    const cases: [string, (p: Record<string, unknown>) => void][] = [
      ['absent', (p) => delete p['decision']],
      ['inconnu', (p) => (p['decision'] = 'PROPOSÉ')],
      ['référence absente', (p) => delete p['decisionRef']],
      ['référence vide', (p) => (p['decisionRef'] = ' ')],
    ];
    for (const [label, mutate] of cases) {
      const s = cloneSources();
      mutate(param(s, 'grace_minutes'));
      expect(
        errorCode(() => parse(s)),
        label,
      ).toBe('CONFIG_INVALID');
    }
  });

  it('interrupteur non DÉCIDÉ ⇒ refus', () => {
    const s = cloneSources();
    param(s, 'payouts_enabled')['decision'] = 'TO_DECIDE';
    expect(errorDetails(() => parse(s)).some((d) => d.includes('payouts_enabled.decision'))).toBe(
      true,
    );
  });

  it('statut des taxes absent ou inconnu ⇒ refus', () => {
    for (const value of [undefined, { decision: 'X', decisionRef: 'r' }, { decision: 'DECIDED' }]) {
      const s = cloneSources();
      if (value === undefined) delete country(s, 'PY')['taxDecision'];
      else country(s, 'PY')['taxDecision'] = value;
      expect(
        errorCode(() => parse(s)),
        JSON.stringify(value),
      ).toBe('CONFIG_INVALID');
    }
  });
});
