/**
 * US-225 — paramètres des déclencheurs et des rails de la caution (migration 0138 ; ADR-108,
 * ADR-164) sous les rôles de production `app_api` et `app_worker` (assertion L0-05 en tête de chaque
 * connexion, withRole), en USD (PA) et en PYG (PY) :
 * - **aucune caution par défaut** : chaque clé du groupe a sa valeur dans chaque pays, égale au
 *   fichier de paramètres et aux valeurs PROPOSÉES d'ADR-108 (pays faux, {LUXE}, aucune classe
 *   pour l'âge, contrôle de risque non déployé) ; définitions `BLOCK`, jamais un interrupteur ;
 * - **aucun fonds de tiers détenu** : `funds_holding_enabled` reste fermé (`core.config_go_live`),
 *   `deposit_charge_cap` et `provider_max_hold_h` sans valeur (⇒ 0 : rail « débit puis
 *   remboursement » interdit, aucune pré-autorisation) et aucune capacité `SUPPORTS_REAUTH`
 *   validée dans la graine ;
 * - lecture seule : `app_api` n'écrit aucun paramètre ; `app_anon` ne lit rien.
 * Valeurs attendues : ADR-108 et 17 §7.2 (texte), le fichier `params.json` lu comme donnée.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';

interface ParamDoc {
  params: Array<{ key: string; values: Record<string, unknown> }>;
}
const PARAMS = JSON.parse(
  readFileSync(
    new URL('../../../../apps/api/src/modules/cfg/data/params.json', import.meta.url),
    'utf8',
  ),
) as ParamDoc;
const seeded = (key: string, country: string): unknown =>
  PARAMS.params.find((p) => p.key === key)?.values[country];

/** Groupe de la graine 0138 et valeurs PROPOSÉES (ADR-108 point 2, 17 §7.2, DEC-FONDATEUR-21). */
const PROPOSED: Readonly<Record<string, unknown>> = {
  deposit_always_required: false,
  deposit_trigger_classes: ['LUXE'],
  deposit_young_driver_age: 30,
  deposit_young_driver_classes: [],
  deposit_on_risk_flag: true,
  risk_control_deployed: false,
  deposit_reauth_lead_h: 24,
  deposit_fee_notice_h: 48,
};
const KEYS = Object.keys(PROPOSED);

async function current(client: pg.ClientBase, country: string): Promise<Map<string, unknown>> {
  const { rows } = await client.query<{ key: string; value: unknown }>(
    `SELECT DISTINCT ON (key) key, value
       FROM core.config_param_value
      WHERE country_code = $1 AND scope_type = 'COUNTRY' AND key = ANY ($2::text[])
        AND valid_from <= platform.now() AND (valid_to IS NULL OR valid_to > platform.now())
      ORDER BY key, valid_from DESC`,
    [country, [...KEYS, 'deposit_charge_cap', 'provider_max_hold_h', 'deposit_amount']],
  );
  return new Map(rows.map((r) => [r.key, r.value]));
}

describe.each(COUNTRIES)('$country ($currency) — graine 0138 des rails de la caution', (c) => {
  it.each(['app_api', 'app_worker'] as const)(
    '%s : aucune caution par défaut, valeurs PROPOSÉES lues telles que params.json',
    async (role) => {
      await withRole(role, async (client) => {
        const values = await current(client, c.country);
        for (const key of KEYS) {
          expect(values.get(key), key).toEqual(PROPOSED[key]);
          expect(values.get(key), key).toEqual(seeded(key, c.country));
        }
        // fail-closed : sans valeur, la caution exigée est refusée et le rail (b) interdit
        expect(values.has('deposit_amount')).toBe(false);
        expect(values.has('deposit_charge_cap')).toBe(false);
        expect(values.has('provider_max_hold_h')).toBe(false);
      });
    },
  );

  it('app_api : funds_holding_enabled fermé ; aucune capacité SUPPORTS_REAUTH ni MAX_HOLD_HOURS validée dans la graine', async () => {
    await withRole('app_api', async (client) => {
      const sw = await client.query<{ open: boolean }>(
        `SELECT core.config_go_live('funds_holding_enabled', $1) AS open`,
        [c.country],
      );
      expect(sw.rows[0]?.open).toBe(false);
      const caps = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM core.payment_psp_capability
          WHERE country_code = $1 AND capability IN ('SUPPORTS_REAUTH', 'MAX_HOLD_HOURS')
            AND status IN ('VALIDATED_SANDBOX', 'VALIDATED_CONTRACT')`,
        [c.country],
      );
      expect(caps.rows[0]?.n).toBe('0');
    });
  });

  it('définitions : fail_mode BLOCK, portée pays, jamais un interrupteur de mise en service', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{
        key: string;
        fail_mode: string;
        allowed_scopes: string[];
        go_live_switch: boolean;
      }>(
        `SELECT key, fail_mode, allowed_scopes, go_live_switch
           FROM core.config_param_definition WHERE key = ANY ($1::text[]) ORDER BY key`,
        [KEYS],
      );
      expect(rows.map((r) => r.key)).toEqual([...KEYS].sort());
      for (const r of rows) {
        expect([r.fail_mode, r.allowed_scopes, r.go_live_switch], r.key).toEqual([
          'BLOCK',
          ['COUNTRY'],
          false,
        ]);
      }
    });
  });

  // app_worker reçoit l'écriture de la configuration en TEST seulement (9100, gardes éprouvées) :
  // seule la base de contrôle sans migrations de test le prouve pour lui (test/int/config-country)
  it.each(['app_api'] as const)(
    '%s : aucune écriture d’un paramètre de la caution (42501)',
    async (role) => {
      await withRole(role, async (client) => {
        const error = await client
          .query(
            `INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
             VALUES ('deposit_always_required', $1, 'COUNTRY', 'true'::jsonb, 'test US-225')`,
            [c.country],
          )
          .catch((e: unknown) => e as { code?: string });
        expect((error as { code?: string }).code).toBe('42501');
      });
    },
  );

  it('app_anon : aucune lecture des paramètres de la caution (42501)', async () => {
    await withRole('app_anon', async (client) => {
      const error = await client
        .query(`SELECT value FROM core.config_param_value WHERE key = 'deposit_trigger_classes'`)
        .catch((e: unknown) => e as { code?: string });
      expect((error as { code?: string }).code).toBe('42501');
    });
  });
});
