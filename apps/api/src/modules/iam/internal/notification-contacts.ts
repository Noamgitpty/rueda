/**
 * Adaptateur PostgreSQL du port `RecipientDirectory` de NTF (US-021, ADR-061) : IAM, qui dépend
 * de NTF (17 §2.2), fournit les coordonnées d'un destinataire par la seule fonction
 * `core.iam_notification_contact` (migration 0031 : SECURITY DEFINER, EXECUTE au seul app_worker,
 * zéro ligne hors du travailleur `ntf_sender`). Requête paramétrée, aucune donnée journalisée.
 */
import type { RecipientContact, RecipientDirectory } from '../../ntf/index.js';

const CONTACT_SQL = `
  SELECT email, phone_e164, preferred_locale, first_name
    FROM core.iam_notification_contact($1::uuid)`;

interface ContactRow {
  readonly email: string | null;
  readonly phone_e164: string | null;
  readonly preferred_locale: string | null;
  readonly first_name: string | null;
}

export const postgresNotificationContacts: RecipientDirectory = {
  contactOf: async (tx, userId): Promise<RecipientContact | null> => {
    const { rows } = await tx.query<ContactRow>(CONTACT_SQL, [userId]);
    const row = rows[0];
    if (row === undefined || row.first_name === null) return null;
    return {
      email: row.email,
      phoneE164: row.phone_e164,
      preferredLocale: row.preferred_locale,
      firstName: row.first_name,
    };
  },
};
