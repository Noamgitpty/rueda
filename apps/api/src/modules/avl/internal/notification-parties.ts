/**
 * Adaptateur PostgreSQL du port `NotificationParties` de NTF (US-213, ADR-157) : AVL, propriétaire
 * des trips et des holds, fournit les parties d'une réservation par la seule fonction
 * `core.booking_notification_parties` (migration 0133 : SECURITY DEFINER, EXECUTE au seul
 * app_worker, refus hors du travailleur `ntf_dispatcher`). Requête paramétrée, aucune donnée
 * journalisée.
 *
 * AVL ne dépend pas de NTF (17 §2.2) : les types ci-dessous ont la forme du port de NTF (typage
 * structurel) ; la racine de composition (`worker-tasks.ts`) les relie. Une réponse mal formée est
 * une erreur (jamais un destinataire deviné) : la tâche échoue, puis lettre morte avec alerte.
 */
import type { SqlClient } from '../../bus/index.js';

export type BookingPartySubject = 'TRIP' | 'HOLD';

export interface BookingPartyFacts {
  readonly guestUserId: string;
  /** Titulaire du compte d'hôte (`organization.holder_user_id`). */
  readonly hostUserId: string;
  readonly holdKind: string | null;
  readonly holdStatus: string | null;
  readonly releaseReason: string | null;
  readonly requestAuthorized: boolean | null;
}

const PARTIES_SQL = 'SELECT core.booking_notification_parties($1::text, $2::uuid) AS p';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

export class NotificationPartiesError extends Error {
  override readonly name = 'NotificationPartiesError';
}

function code(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !CODE.test(value)) {
    throw new NotificationPartiesError(`parties : « ${field} » mal formé`);
  }
  return value;
}

/** Faits lus en base ; `null` : sujet inconnu. Réponse mal formée : `NotificationPartiesError`. */
export function parseBookingParties(
  subject: BookingPartySubject,
  raw: unknown,
): BookingPartyFacts | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new NotificationPartiesError('parties : objet attendu');
  }
  const r = raw as Readonly<Record<string, unknown>>;
  const guest = r['guestUserId'];
  const host = r['hostUserId'];
  if (typeof guest !== 'string' || !UUID.test(guest)) {
    throw new NotificationPartiesError('parties : « guestUserId » mal formé');
  }
  if (typeof host !== 'string' || !UUID.test(host)) {
    throw new NotificationPartiesError('parties : « hostUserId » mal formé');
  }
  if (subject === 'TRIP') {
    return {
      guestUserId: guest.toLowerCase(),
      hostUserId: host.toLowerCase(),
      holdKind: null,
      holdStatus: null,
      releaseReason: null,
      requestAuthorized: null,
    };
  }
  const authorized = r['requestAuthorized'];
  if (typeof authorized !== 'boolean') {
    throw new NotificationPartiesError('parties : « requestAuthorized » mal formé');
  }
  const kind = code(r['holdKind'], 'holdKind');
  const status = code(r['holdStatus'], 'holdStatus');
  if (kind === null || status === null) {
    throw new NotificationPartiesError('parties : type ou statut du hold absent');
  }
  return {
    guestUserId: guest.toLowerCase(),
    hostUserId: host.toLowerCase(),
    holdKind: kind,
    holdStatus: status,
    releaseReason: code(r['releaseReason'], 'releaseReason'),
    requestAuthorized: authorized,
  };
}

export const postgresNotificationParties = {
  partiesOf: async (
    tx: SqlClient,
    subject: BookingPartySubject,
    id: string,
  ): Promise<BookingPartyFacts | null> => {
    const { rows } = await tx.query<{ p: unknown }>(PARTIES_SQL, [subject, id]);
    return parseBookingParties(subject, rows[0]?.p ?? null);
  },
};
