/**
 * Port `KeyWrapper` : enveloppement des clés de données par sujet par le KMS (US-009 ;
 * 17 §1.6, §3.1.3 points 1 et 9, §3.1.4 C4 ; ADR-026 ; ADR-051).
 *
 * Le KMS détient la clé maîtresse ; l'application ne voit jamais que des DEK enveloppées
 * (`wrapped_dek`, stockées en base) et, en mémoire seulement, les DEK déroulées. Aucune clé n'est
 * dans le code, la configuration ni le dépôt (CLAUDE.md « Interdits »).
 *
 * Adaptateurs :
 * - `FAKE` (tests seulement) : `@rueda/db/testing` → `FakeKeyWrapper`, clé maîtresse aléatoire
 *   tirée en mémoire à la construction, refusé en production ;
 * - réel (KMS du nuage) : US-003 (IaC, secrets et KMS). Jamais de `FAKE` en production (C19).
 *
 * Contrat : `unwrap` lève `KeyWrapperUnavailableError` si le KMS ne répond pas (l'audit s'écrit
 * alors sans la donnée C2, 17 §3.1.3 point 9) et `KeyWrapperRejectedError` si l'enveloppe ne
 * correspond pas (autre clé maîtresse, autre sujet, octets altérés). Le `context` (sujet) est lié
 * à l'enveloppe (contexte de chiffrement du KMS) : une DEK enveloppée ne se déroule que pour son
 * sujet.
 */
import type { SubjectRef } from './envelope.ts';

export interface KeyWrapper {
  /** Identifiant de la clé maîtresse utilisée pour envelopper (stocké dans `kms_key_id`). */
  readonly keyId: string;
  wrap(dek: Buffer, context: SubjectRef): Promise<Buffer>;
  unwrap(wrapped: Buffer, keyId: string, context: SubjectRef): Promise<Buffer>;
}

/** KMS injoignable : la DEK n'est pas disponible (aucune donnée C2 ne s'écrit en clair). */
export class KeyWrapperUnavailableError extends Error {
  override readonly name = 'KeyWrapperUnavailableError';
}

/** Enveloppe refusée par le KMS (autre clé, autre sujet, octets altérés). */
export class KeyWrapperRejectedError extends Error {
  override readonly name = 'KeyWrapperRejectedError';
}
