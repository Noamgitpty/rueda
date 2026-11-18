/**
 * Lecture de la configuration des rails de la caution (US-225, ADR-164) sous un rôle de production
 * (`app_api` au checkout, `app_worker` pour les minuteries) : paramètres du pays (17 §7.2 ; graines
 * 0009 et 0141), interrupteur `funds_holding_enabled` (`core.config_go_live`, fail-closed) et
 * matrice `psp_capability` du fournisseur (seule une ligne `VALIDATED_*` compte, `CapabilitySet`).
 *
 * Lecture seule, aucune écriture : le rail se choisit par configuration (19 US-225, notes
 * techniques). Une valeur absente, mal typée ou hors vocabulaire est rendue ABSENTE : la fonction
 * pure appelante applique le fail-closed (déclencheur vrai, `PARAM_MISSING`, capacité « non »).
 */
import { CapabilitySet } from './capabilities.js';
import type { CapabilityRecord, CapabilityStatus } from './capabilities.js';
import { DEPOSIT_VALUE_CLASSES } from './deposit-triggers.js';
import type { DepositTriggerParams, DepositValueClass } from './deposit-triggers.js';
import type { DepositRailParams } from './deposit-rails.js';
import type { SqlExecutor } from './pg-stores.js';

/** Clés lues (portée pays, sauf `provider_max_hold_h` : réseau > PSP > pays, 17 §7.1 point 6). */
export const DEPOSIT_CONFIG_KEYS = [
  'deposit_always_required',
  'deposit_trigger_classes',
  'deposit_young_driver_age',
  'deposit_young_driver_classes',
  'deposit_on_risk_flag',
  'risk_control_deployed',
  'deposit_amount',
  'deposit_charge_cap',
  'deposit_safety_h',
  'deposit_reauth_lead_h',
  'deposit_fee_notice_h',
  'auth_lead_h',
  'release_delay_h',
  'marge_h',
  'provider_max_hold_h',
] as const;
type ConfigKey = (typeof DEPOSIT_CONFIG_KEYS)[number];

export interface DepositRailConfig {
  readonly triggerParams: DepositTriggerParams;
  /** `deposit_amount[pays]` par classe ; `undefined` : absent (aujourd'hui `TO_DECIDE`). */
  readonly amounts: Readonly<Partial<Record<DepositValueClass, bigint>>> | undefined;
  readonly railParams: DepositRailParams;
  /** `deposit_fee_notice_h` ; `null` : absent. */
  readonly feeNoticeH: number | null;
  readonly capabilities: CapabilitySet;
}

const boolOf = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

const hoursOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;

const MINOR = /^(0|[1-9][0-9]{0,18})$/;
const minorOf = (v: unknown): bigint | null =>
  typeof v === 'string' && MINOR.test(v) ? BigInt(v) : null;

/** Ensemble de classes du vocabulaire fermé ; autre forme ⇒ absent (toutes les classes). */
function classesOf(v: unknown): readonly DepositValueClass[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: DepositValueClass[] = [];
  for (const c of v) {
    if (!(DEPOSIT_VALUE_CLASSES as readonly unknown[]).includes(c)) return undefined;
    out.push(c as DepositValueClass);
  }
  return out;
}

/** `deposit_amount` : `{ classe: "unités mineures" }` ; entrée illisible ⇒ classe absente. */
function amountsOf(v: unknown): Partial<Record<DepositValueClass, bigint>> | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Partial<Record<DepositValueClass, bigint>> = {};
  for (const cls of DEPOSIT_VALUE_CLASSES) {
    const m = minorOf((v as Record<string, unknown>)[cls]);
    if (m !== null && m > 0n) out[cls] = m;
  }
  return out;
}

const CAP_STATUSES: readonly CapabilityStatus[] = [
  'VALIDATED_SANDBOX',
  'VALIDATED_CONTRACT',
  'DOCUMENTED',
  'UNKNOWN',
];

export class PgDepositRailConfigReader {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  /**
   * Configuration du pays et du fournisseur à l'heure de la base (`platform.now()`). `network` :
   * réseau de la carte si connu (`provider_max_hold_h` et capacités les plus précises d'abord).
   */
  async read(country: string, provider: string, network = '*'): Promise<DepositRailConfig> {
    const { rows } = await this.#db.query<{ key: ConfigKey; value: unknown }>(
      `WITH t AS (SELECT platform.now() AS ts)
       SELECT DISTINCT ON (v.key) v.key, v.value
         FROM core.config_param_value AS v CROSS JOIN t
        WHERE v.key = ANY ($3::text[])
          AND v.country_code = $1
          AND v.valid_from <= t.ts
          AND (v.valid_to IS NULL OR v.valid_to > t.ts)
          AND (v.scope_type = 'COUNTRY'
               OR (v.scope_type = 'PSP' AND v.scope_id = $2)
               OR (v.scope_type = 'NETWORK' AND v.network = $4))
        ORDER BY v.key,
                 CASE v.scope_type WHEN 'NETWORK' THEN 0 WHEN 'PSP' THEN 1 ELSE 2 END,
                 v.valid_from DESC`,
      [country, provider, [...DEPOSIT_CONFIG_KEYS], network],
    );
    const value = (key: ConfigKey): unknown => rows.find((r) => r.key === key)?.value;
    const funds = await this.#db.query<{ enabled: boolean | null }>(
      `SELECT core.config_go_live('funds_holding_enabled', $1) AS enabled`,
      [country],
    );
    const caps = await this.#db.query<{
      capability: string;
      method: string;
      network: string;
      value: unknown;
      status: string;
    }>(
      `SELECT DISTINCT ON (c.capability, c.method, c.network)
              c.capability, c.method, c.network, c.value, c.status
         FROM core.payment_psp_capability AS c
        WHERE c.provider = $1 AND c.country_code = $2 AND c.valid_from <= platform.now()
        ORDER BY c.capability, c.method, c.network, c.valid_from DESC`,
      [provider, country],
    );
    const records: CapabilityRecord[] = caps.rows
      .filter((r) => (CAP_STATUSES as readonly string[]).includes(r.status))
      .map((r) => ({
        capability: r.capability,
        method: r.method,
        network: r.network,
        value: r.value,
        status: r.status as CapabilityStatus,
      }));
    return {
      triggerParams: {
        alwaysRequired: boolOf(value('deposit_always_required')),
        triggerClasses: classesOf(value('deposit_trigger_classes')),
        youngDriverAge: hoursOf(value('deposit_young_driver_age')) ?? undefined,
        youngDriverClasses: classesOf(value('deposit_young_driver_classes')),
        onRiskFlag: boolOf(value('deposit_on_risk_flag')),
        riskControlDeployed: boolOf(value('risk_control_deployed')),
      },
      amounts: amountsOf(value('deposit_amount')),
      railParams: {
        authLeadH: hoursOf(value('auth_lead_h')),
        releaseDelayH: hoursOf(value('release_delay_h')),
        marginH: hoursOf(value('marge_h')),
        safetyH: hoursOf(value('deposit_safety_h')),
        reauthLeadH: hoursOf(value('deposit_reauth_lead_h')),
        // failMode ZERO : absent ⇒ 0 (aucune pré-autorisation ; rail b interdit)
        providerMaxHoldH: hoursOf(value('provider_max_hold_h')) ?? 0,
        chargeCapMinor: minorOf(value('deposit_charge_cap')) ?? 0n,
        fundsHoldingEnabled: funds.rows[0]?.enabled === true,
      },
      feeNoticeH: hoursOf(value('deposit_fee_notice_h')),
      capabilities: new CapabilitySet(records),
    };
  }
}
