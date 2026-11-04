/**
 * Lecture de données personnelles par le staff (US-004, ADR-080 ; 16 ADM-032 « Given une
 * consultation d'un dossier KYC, Then elle est au journal d'accès » ; 17 §2.3, §3.1.4).
 *
 * Toute route de la console qui rend une donnée C3 (pièce, selfie, permis, compte bancaire…) ou
 * une consultation hors dossier passe par `readPersonalDataAsStaff` : la porte
 * `core.iam_staff_cmd_data_access` (migration 0051) juge la session, le TOTP, la permission
 * `kyc.read_sensitive` dans le pays du DOSSIER et le dossier lui-même, écrit l'accès au journal
 * (`data_access_log` + ligne chaînée `STAFF_DATA_ACCESS` de `audit_log`), puis seulement la
 * lecture a lieu, DANS LA MÊME TRANSACTION : si le journal échoue, rien n'est lu ; si la lecture
 * échoue, la transaction (journal compris) est annulée par l'appelant et rien n'est rendu.
 *
 * L'appelant fournit une transaction ouverte sous `app_api` (contexte de session posé) ; l'acteur
 * n'est jamais reçu : c'est celui de la session désignée par l'empreinte du jeton.
 */
import type { SqlClient } from '../../bus/index.js';

/** Types d'accès admis par la porte (READ_C2_SUPPORT et BULK_EXPORT : stories SUP, `data.export`). */
export type StaffDataAccessKind = 'READ_C3' | 'BREAK_GLASS';

export type StaffDataAccessOutcome = 'GRANTED' | 'FORBIDDEN' | 'MFA_REQUIRED' | 'AUTH_REQUIRED';

export interface StaffDataAccessRequest {
  /** Idempotence de la requête HTTP (UUID) ; repris au journal. */
  readonly requestId: string;
  /** Dossier (`support_case`) qui justifie l'accès ; son pays fait foi (jamais reçu du client). */
  readonly caseId: string;
  /** Type technique du sujet (`USER`, `IDENTITY_VERIFICATION`…), majuscules. */
  readonly subjectType: string;
  readonly subjectId: string;
  /** Champ ou fichier lu (`identity_document.number_enc`, identifiant de fichier). */
  readonly fieldOrFile: string;
  readonly accessKind: StaffDataAccessKind;
  /** Motif (10 à 500 caractères). */
  readonly purpose: string;
}

/** Refus de la porte : la route répond 401 / 403 sans rien lire. */
export class StaffDataAccessDenied extends Error {
  readonly outcome: Exclude<StaffDataAccessOutcome, 'GRANTED'>;

  constructor(outcome: Exclude<StaffDataAccessOutcome, 'GRANTED'>) {
    super(`accès aux données refusé : ${outcome}`);
    this.name = 'StaffDataAccessDenied';
    this.outcome = outcome;
  }
}

const OUTCOMES: readonly StaffDataAccessOutcome[] = [
  'GRANTED',
  'FORBIDDEN',
  'MFA_REQUIRED',
  'AUTH_REQUIRED',
];

export const STAFF_DATA_ACCESS_SQL =
  'SELECT outcome, access_id FROM core.iam_staff_cmd_data_access($1, $2, $3, $4, $5, $6, $7, $8)';

/** Juge l'accès et l'écrit au journal ; rend l'identifiant de la ligne `data_access_log`. */
export async function recordStaffDataAccess(
  tx: SqlClient,
  tokenHash: Uint8Array,
  request: StaffDataAccessRequest,
): Promise<string> {
  const { rows } = await tx.query<{ outcome: string; access_id: string | null }>(
    STAFF_DATA_ACCESS_SQL,
    [
      tokenHash,
      request.requestId,
      request.caseId,
      request.subjectType,
      request.subjectId,
      request.fieldOrFile,
      request.accessKind,
      request.purpose,
    ],
  );
  const row = rows[0];
  const outcome = OUTCOMES.find((o) => o === row?.outcome);
  // issue inconnue ou absente : contrat rompu, traité comme un refus (fail-closed)
  if (outcome === undefined) throw new StaffDataAccessDenied('FORBIDDEN');
  if (outcome !== 'GRANTED') throw new StaffDataAccessDenied(outcome);
  if (typeof row?.access_id !== 'string') throw new StaffDataAccessDenied('FORBIDDEN');
  return row.access_id;
}

/**
 * Journalise l'accès, PUIS lit : `read` n'est appelée que sur l'issue GRANTED, dans la même
 * transaction `tx`. Rend la donnée lue et l'identifiant de l'accès journalisé.
 */
export async function readPersonalDataAsStaff<T>(
  tx: SqlClient,
  tokenHash: Uint8Array,
  request: StaffDataAccessRequest,
  read: (tx: SqlClient) => Promise<T>,
): Promise<{ readonly data: T; readonly accessId: string }> {
  const accessId = await recordStaffDataAccess(tx, tokenHash, request);
  return { data: await read(tx), accessId };
}
