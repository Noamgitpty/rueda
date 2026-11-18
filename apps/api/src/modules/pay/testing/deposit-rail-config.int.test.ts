/**
 * US-225 — configuration des rails de la caution lue sur PostgreSQL réel sous le rôle de production
 * `app_api` (`connectAs` exécute l'assertion L0-05 en tête de chaque test), dans chaque pays
 * configuré (USD, PYG sans décimale), transactions ANNULÉES :
 * - graine 0138 (défauts PROPOSÉS) : aucune caution par défaut — un STANDARD n'évalue aucun rail
 *   (T70) ; un LUXE est refusé avant le paiement tant que `deposit_amount` n'est pas fixé
 *   (`PARAM_MISSING`, T72 c) ; capacités inconnues ⇒ aucune pré-autorisation ;
 * - valeurs de test de 08 posées dans la transaction (fixture 9943, capacités par 9800) : T57 ⇒
 *   pré-autorisation unique ; T59 ⇒ `DEPOSIT_RAIL_UNAVAILABLE` (3 jours possibles) ; plafond du
 *   rail « débit puis remboursement » posé mais `funds_holding_enabled` = false ⇒ toujours refusé
 *   (critère 4) ; `SUPPORTS_REAUTH` validée ⇒ rail de ré-autorisation (critère 3) ;
 * - `app_api` n'écrit aucun paramètre ni aucune capacité (lecture seule).
 * Attendus : 08 BR-PAY-06, vecteurs T57 / T59 / T70 / T72, `params.json` (lu comme donnée), jamais
 * le code testé.
 */
import { readFileSync } from 'node:fs';
import { connectAs, releaseClient } from '@rueda/db/testing';
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { decideDepositGate, PgDepositRailConfigReader } from '../index.js';
import type { DepositGateDecision, DepositRailConfig, DepositValueClass } from '../index.js';
import { countryCases } from '../../../../test/support/countries.js';

/** Fournisseur propre à ce fichier : aucune capacité d'un autre test ne s'y mêle. */
const PROVIDER = 'FAKE_US225';
const H = 3_600_000;

const read = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../cfg/data/${file}`, import.meta.url), 'utf8'));
const PARAMS = (
  read('params.json') as { params: { key: string; values: Record<string, unknown> }[] }
).params;
const EXPONENTS = new Map(
  (read('currencies.json') as { currencies: { code: string; exponent: number }[] }).currencies.map(
    (c) => [c.code, c.exponent],
  ),
);
const seeded = (key: string, country: string): unknown =>
  PARAMS.find((p) => p.key === key)?.values[country];

const opened: pg.Client[] = [];
afterEach(async () => {
  for (const c of opened.splice(0)) await releaseClient(c);
});

async function inApiTx<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await connectAs('app_api'); // assertion L0-05
  opened.push(client);
  await client.query('BEGIN');
  try {
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
  }
}

async function dbNow(client: pg.Client): Promise<Date> {
  const { rows } = await client.query<{ now: Date }>('SELECT platform.now() AS now');
  const now = rows[0]?.now;
  if (now === undefined) throw new Error('platform.now() absent');
  return now;
}

const setParam = (client: pg.Client, key: string, country: string, value: unknown) =>
  client.query('SELECT test_fixture.us225_param_version($1, $2, $3::jsonb)', [
    key,
    country,
    JSON.stringify(value),
  ]);

const setCapability = (
  client: pg.Client,
  country: string,
  name: string,
  value: unknown,
  from: Date,
) =>
  client.query(
    `SELECT test_fixture.us024_set_capability($1, $2, '*', $3, $4::jsonb, 'VALIDATED_SANDBOX', $5::timestamptz)`,
    [PROVIDER, country, name, JSON.stringify(value), from.toISOString()],
  );

/** Décision du checkout pour un trip de `tripMinutes` qui part dans 10 jours. */
function gateFor(
  config: DepositRailConfig,
  now: Date,
  valueClass: DepositValueClass,
  tripMinutes: number,
): DepositGateDecision {
  const start = new Date(now.getTime() + 240 * H);
  return decideDepositGate({
    triggerParams: config.triggerParams,
    amounts: config.amounts,
    railParams: config.railParams,
    caps: { capabilities: config.capabilities },
    context: { valueClass, driverAges: [40], riskFlagged: false },
    bookedAt: now,
    scheduledStart: start,
    scheduledEnd: new Date(start.getTime() + tripMinutes * 60_000),
  });
}

describe.each(countryCases())('$country ($currency) — rails de la caution sous app_api', (c) => {
  const major = (units: bigint): bigint => units * 10n ** BigInt(EXPONENTS.get(c.currency) ?? -1);

  it('graine 0138 : paramètres PROPOSÉS lus tels que params.json ; aucune caution par défaut', async () => {
    await inApiTx(async (client) => {
      const config = await new PgDepositRailConfigReader(client).read(c.country, PROVIDER);
      expect(config.triggerParams).toEqual({
        alwaysRequired: seeded('deposit_always_required', c.country),
        triggerClasses: seeded('deposit_trigger_classes', c.country),
        youngDriverAge: seeded('deposit_young_driver_age', c.country),
        youngDriverClasses: seeded('deposit_young_driver_classes', c.country),
        onRiskFlag: seeded('deposit_on_risk_flag', c.country),
        riskControlDeployed: seeded('risk_control_deployed', c.country),
      });
      // ADR-108 : pays faux, {LUXE}, aucune classe pour l'âge, contrôle de risque non déployé
      expect(config.triggerParams).toMatchObject({
        alwaysRequired: false,
        triggerClasses: ['LUXE'],
        youngDriverClasses: [],
        riskControlDeployed: false,
      });
      expect(config.railParams).toEqual({
        authLeadH: seeded('auth_lead_h', c.country),
        releaseDelayH: seeded('release_delay_h', c.country),
        marginH: seeded('marge_h', c.country),
        safetyH: seeded('deposit_safety_h', c.country),
        reauthLeadH: seeded('deposit_reauth_lead_h', c.country),
        providerMaxHoldH: 0, // à fixer par PSP au lot C (absent ⇒ 0)
        chargeCapMinor: 0n, // absent ⇒ 0 : rail (b) interdit
        fundsHoldingEnabled: false, // interrupteur, false en production (17 §0.1)
      });
      expect(config.amounts).toBeUndefined(); // deposit_amount : TO_DECIDE (J-ADM-031)
      expect(config.feeNoticeH).toBe(seeded('deposit_fee_notice_h', c.country));

      const now = await dbNow(client);
      // T70 : STANDARD ⇒ aucun rail évalué, réservation possible
      expect(gateFor(config, now, 'STANDARD', 72 * 60 + 25).kind).toBe('NOT_REQUIRED');
      // T72 c : LUXE exige une caution dont le montant n'est pas fixé ⇒ refus avant le paiement
      const luxe = gateFor(config, now, 'LUXE', 72 * 60);
      expect(luxe.kind === 'REFUSED' && luxe.code).toBe('PARAM_MISSING');
    });
  });

  it('valeurs de test de 08 : T57 pré-autorisation unique ; T59 refusé (3 jours) ; rail (b) fermé par funds_holding_enabled ; ré-autorisation', async () => {
    await inApiTx(async (client) => {
      const now = await dbNow(client);
      await setParam(client, 'deposit_amount', c.country, { LUXE: major(300n).toString() });
      await setParam(client, 'provider_max_hold_h', c.country, 168);
      await setCapability(client, c.country, 'SUPPORTS_PREAUTH', true, now);
      await setCapability(client, c.country, 'MAX_HOLD_HOURS', 168, now);
      const reader = new PgDepositRailConfigReader(client);

      const t57 = gateFor(await reader.read(c.country, PROVIDER), now, 'LUXE', 72 * 60);
      expect(t57.kind === 'REQUIRED' && [t57.amountMinor, t57.rail.mechanism]).toEqual([
        major(300n),
        'PREAUTH_SINGLE',
      ]);

      const t59 = gateFor(await reader.read(c.country, PROVIDER), now, 'LUXE', 72 * 60 + 25);
      expect(t59.kind === 'REFUSED' && [t59.code, t59.maxBookableDays]).toEqual([
        'DEPOSIT_RAIL_UNAVAILABLE',
        3,
      ]);

      // critère 4 : plafond du débit puis remboursement posé, interrupteur fermé ⇒ toujours refusé
      await setParam(client, 'deposit_charge_cap', c.country, major(300n).toString());
      await setCapability(client, c.country, 'SUPPORTS_REFUND', true, now);
      const capped = await reader.read(c.country, PROVIDER);
      expect(capped.railParams).toMatchObject({
        chargeCapMinor: major(300n),
        fundsHoldingEnabled: false,
      });
      const b = gateFor(capped, now, 'LUXE', 72 * 60 + 25);
      expect(b.kind === 'REFUSED' && b.code).toBe('DEPOSIT_RAIL_UNAVAILABLE');

      // critère 3 : SUPPORTS_REAUTH validée ⇒ rail de ré-autorisation
      await setCapability(client, c.country, 'SUPPORTS_REAUTH', true, now);
      const a = gateFor(await reader.read(c.country, PROVIDER), now, 'LUXE', 72 * 60 + 25);
      expect(a.kind === 'REQUIRED' && a.rail.mechanism).toBe('REAUTH');
    });
  });

  it('app_api ne modifie ni un paramètre de la caution ni une capacité (lecture seule)', async () => {
    await inApiTx(async (client) => {
      const write = await client
        .query(
          `INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
           VALUES ('deposit_always_required', $1, 'COUNTRY', 'true'::jsonb, 'test')`,
          [c.country],
        )
        .catch((e: unknown) => e as { code?: string });
      expect((write as { code?: string }).code).toBe('42501');
    });
    await inApiTx(async (client) => {
      const write = await client
        .query(
          `UPDATE core.payment_psp_capability SET status = 'VALIDATED_SANDBOX' WHERE country_code = $1`,
          [c.country],
        )
        .catch((e: unknown) => e as { code?: string });
      expect((write as { code?: string }).code).toBe('42501');
    });
  });
});
