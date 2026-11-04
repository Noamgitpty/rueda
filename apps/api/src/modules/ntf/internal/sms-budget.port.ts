/**
 * Port `SmsBudget` de NTF (US-052, critère 2 ; ADR-075) : plafond journalier d'envois SMS du
 * pays (`rate_limit_sms_daily_cap`), tenu par RISK (`ntfSmsBudget`, commande
 * `core.risk_cmd_sms_reserve` dans la transaction du travailleur `ntf_sender`).
 *
 * - message CRITIQUE de trip (gabarit `critical`) : toujours accordé, et compté ;
 * - message non critique, plafond atteint : refusé ; NTF le bascule sur son canal de repli
 *   (e-mail) ou, s'il était déjà un repli, le passe `FAILED` ; `alert` au premier refus du jour ⇒
 *   événement `notification.sms_cap.reached` dans l'outbox ;
 * - erreur (compteur ou paramètre indisponible) : levée ; la tâche échoue et sera rejouée,
 *   aucun SMS ne part (fail-closed).
 *
 * Une réservation n'a lieu qu'à la PREMIÈRE tentative d'un envoi (les réessais ne la recomptent
 * pas).
 */
import type { SqlClient } from '../../bus/index.js';

export interface SmsReserveResult {
  readonly allowed: boolean;
  readonly alert: boolean;
}

export interface SmsBudget {
  reserve(
    tx: SqlClient,
    input: { readonly country: string; readonly critical: boolean },
  ): Promise<SmsReserveResult>;
}
