/**
 * Bordereau mensuel de l'assureur partenaire (US-227, ADR-165 ; 08 E7 règles 6 et 7 ; 17 §2.9
 * `insurer_ledger`) : tâche périodique du travailleur `bordereau`. Chaque passage appelle
 * `core.settlement_cmd_draft_insurer_bordereaux(NULL)` (0143) : pour le mois clos de chaque pays,
 * un bordereau DRAFT par contrat d'assureur (lignes = prime due des trips terminés, jamais une
 * ligne gelée par un chargeback ouvert), puis la projection `insurer_ledger_state`. La base décide
 * tout (mois, éligibilité, montants lus du registre) ; ce module ne calcule aucun montant.
 *
 * L'émission reste une décision FINANCE à deux personnes (`ISSUE_BORDEREAU` par
 * `cmd_request_finance_action` puis `cmd_approve_finance_action`, console d'US-101). Aucun
 * paiement : aucun ordre `releaseLeg` ni reversement à l'assureur avant le lot C (PSP FAKE, aucun
 * fonds de tiers détenu). Le journal ne porte que des comptes par issue (aucun identifiant, 17 §6.3).
 */
import type { BusRegistry } from '../../bus/index.js';

/** Travailleur du bordereau (liste des politiques `cmd_money_ins` de 0036 et 0143). */
export const INSURER_BORDEREAU_WORKER = 'bordereau';

/** Une passe par 24 h (PROPOSÉ, ADR-165) : la rédaction est idempotente par (contrat, mois). */
export const INSURER_BORDEREAU_PERIOD_SECONDS = 86_400;

/** Mois précédent de chaque pays (NULL), dans le fuseau du pays. */
export const DRAFT_INSURER_BORDEREAUX_SQL =
  'SELECT outcome, country FROM core.settlement_cmd_draft_insurer_bordereaux(NULL)';

const OUTCOMES = ['DRAFTED', 'EXISTS', 'EMPTY', 'PERIOD_OPEN'] as const;
type DraftOutcome = (typeof OUTCOMES)[number];

/** Erreur de contrat : issue inconnue rendue par la commande (fail-closed). */
export class InsurerBordereauContractError extends Error {
  override readonly name = 'InsurerBordereauContractError';
}

/** Comptes par issue d'une passe (fonction pure). */
export function draftCounts(
  rows: readonly { readonly outcome: unknown }[],
): Record<DraftOutcome, number> {
  const counts: Record<DraftOutcome, number> = { DRAFTED: 0, EXISTS: 0, EMPTY: 0, PERIOD_OPEN: 0 };
  for (const r of rows) {
    if (typeof r.outcome !== 'string' || !(OUTCOMES as readonly string[]).includes(r.outcome)) {
      throw new InsurerBordereauContractError('issue de rédaction inconnue');
    }
    counts[r.outcome as DraftOutcome]++;
  }
  return counts;
}

/** Déclare la tâche périodique `bordereau`. */
export function registerInsurerBordereaux(
  registry: BusRegistry,
  log: (line: string) => void,
  periodSeconds: number = INSURER_BORDEREAU_PERIOD_SECONDS,
): void {
  registry.registerPeriodic(INSURER_BORDEREAU_WORKER, periodSeconds, async (_payload, tx) => {
    const { rows } = await tx.query<{ outcome: unknown; country: unknown }>(
      DRAFT_INSURER_BORDEREAUX_SQL,
    );
    const c = draftCounts(rows);
    log(
      JSON.stringify({
        level: 'info',
        worker: INSURER_BORDEREAU_WORKER,
        drafted: c.DRAFTED,
        exists: c.EXISTS,
        empty: c.EMPTY,
        period_open: c.PERIOD_OPEN,
      }),
    );
  });
}
