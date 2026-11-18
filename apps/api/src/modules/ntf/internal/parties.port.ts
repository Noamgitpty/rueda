/**
 * Port `NotificationParties` (US-213, ADR-157) : parties d'une réservation (trip ou hold) lues en
 * base au moment de la résolution des destinataires, dans la transaction du reçu de l'événement.
 *
 * NTF ne dépend que de CFG (17 §2.2) : il ne lit pas les tables d'AVL ni d'IAM. Le module AVL
 * fournit l'adaptateur PostgreSQL (`postgresNotificationParties`, fonction
 * `core.booking_notification_parties`, migration 0133 : SECURITY DEFINER, EXECUTE au seul
 * app_worker, refus hors du travailleur `ntf_dispatcher`) ; la racine de composition
 * (`worker-tasks.ts`) l'injecte. AVL ne dépend pas de NTF : son adaptateur a la même forme, par
 * typage structurel, sans importer ce fichier.
 *
 * Identifiants et codes seulement : ni nom, ni coordonnée, ni pièce, ni montant.
 */
import type { SqlClient } from '../../bus/index.js';
import type { PartyFacts, PartySubject } from './catalog.js';

export interface NotificationParties {
  /** `null` : sujet inconnu (NTF le traite comme une erreur de contrat). */
  readonly partiesOf: (
    tx: SqlClient,
    subject: PartySubject,
    id: string,
  ) => Promise<PartyFacts | null>;
}
