/**
 * Adaptateur RISK du port `SmsBudget` de NTF (US-052, critère 2) : réserve un SMS sur le plafond
 * journalier du pays (`rate_limit_sms_daily_cap`, jour LOCAL du pays compté par la base) DANS la
 * transaction du travailleur `ntf_sender` (`core.risk_cmd_sms_reserve` refuse tout autre
 * travailleur, 42501). RISK ne dépend pas de NTF : le port est satisfait par structure.
 * Paramètre absent ou erreur SQL : levée ⇒ la tâche échoue et sera rejouée, aucun SMS ne part.
 */
import type { CountryConfig } from '../../cfg/index.js';
import { SMS_RESERVE_SQL } from './counter-store.js';
import type { RiskSqlExecutor } from './counter-store.js';
import { configRateLimitPolicy } from './policy.js';
import type { RateLimitPolicy } from './policy.js';

export interface SmsBudgetAdapter {
  reserve(
    tx: RiskSqlExecutor,
    input: { readonly country: string; readonly critical: boolean },
  ): Promise<{ allowed: boolean; alert: boolean }>;
}

export function ntfSmsBudget(source: CountryConfig | RateLimitPolicy): SmsBudgetAdapter {
  const policy = 'limit' in source ? source : configRateLimitPolicy(source);
  return {
    async reserve(tx, input) {
      const cap = policy.limit('smsDailyCap', input.country);
      const { rows } = await tx.query<{ allowed: boolean; alert: boolean }>(SMS_RESERVE_SQL, [
        input.country,
        cap,
        input.critical,
      ]);
      const r = rows[0];
      if (r === undefined) throw new Error('risk_cmd_sms_reserve sans résultat');
      return { allowed: r.allowed, alert: r.alert };
    },
  };
}
