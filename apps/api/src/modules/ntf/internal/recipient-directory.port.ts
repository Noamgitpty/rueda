/**
 * Port `RecipientDirectory` (US-021, ADR-061) : coordonnées d'un destinataire au moment de l'envoi.
 *
 * NTF ne dépend que de CFG (17 §2.2) : il ne lit pas les tables IAM. IAM, qui dépend de NTF,
 * fournit l'adaptateur PostgreSQL (`postgresNotificationContacts`, fonction
 * `core.iam_notification_contact`, migration 0030) ; la racine de composition l'injecte.
 *
 * Données C2 : jamais journalisées, jamais écrites dans `notification_dispatch`.
 */
import type { SqlClient } from '../../bus/index.js';

export interface RecipientContact {
  /** Adresse vérifiée, sinon `null`. */
  readonly email: string | null;
  /** Numéro E.164 vérifié, sinon `null`. */
  readonly phoneE164: string | null;
  readonly preferredLocale: string | null;
  readonly firstName: string;
}

export interface RecipientDirectory {
  /** `null` : compte inconnu, fermé, banni ou pseudonymisé (rien à envoyer). */
  readonly contactOf: (tx: SqlClient, userId: string) => Promise<RecipientContact | null>;
}
