/**
 * Enveloppe de chiffrement des colonnes C2 / C3 et des fichiers nominatifs, par clé de sujet
 * (US-009 ; 17 §3.1.3 point 1, §3.1.4 ; ADR-026 ; ADR-051).
 *
 * Format v1 : `0x01 || nonce (12 octets) || texte chiffré || étiquette GCM (16 octets)`,
 * AES-256-GCM avec la DEK (32 octets) du sujet. Les données associées (AAD) lient le texte
 * chiffré à son emplacement et à son sujet : un texte chiffré recopié dans une autre colonne, un
 * autre fichier ou pour un autre sujet ne se déchiffre pas. Nonce aléatoire (`randomBytes`) :
 * une DEK par sujet chiffre peu de valeurs, loin de la borne de 2^32 messages par clé.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const ENVELOPE_VERSION = 0x01;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
export const DEK_BYTES = 32;
/** Taille minimale d'une enveloppe (texte clair vide) : 1 + 12 + 16. */
export const ENVELOPE_MIN_BYTES = 1 + NONCE_BYTES + TAG_BYTES;

export type SubjectType = 'USER' | 'ORG' | 'PLATFORM';

/** Sujet d'une clé de données (17 §3.2.13 `subject_key`). */
export interface SubjectRef {
  readonly type: SubjectType;
  readonly id: string;
}

export const subjectLabel = (s: SubjectRef): string => `${s.type}:${s.id}`;

/** Emplacement d'une colonne C2 / C3 : AAD `rueda.c2.v1|<table>.<colonne>|<TYPE>:<id>`. */
export function columnAad(table: string, column: string, subject: SubjectRef): string {
  return `rueda.c2.v1|${table}.${column}|${subjectLabel(subject)}`;
}

/** Fichier nominatif : AAD `rueda.file.v1|<id du fichier>|<TYPE>:<id>`. */
export function fileAad(fileId: string, subject: SubjectRef): string {
  return `rueda.file.v1|${fileId}|${subjectLabel(subject)}`;
}

/** Erreur de déchiffrement, sans détail (clé, AAD ou octets incorrects). */
export class EnvelopeError extends Error {
  override readonly name = 'EnvelopeError';
}

function assertDek(dek: Buffer): void {
  if (dek.length !== DEK_BYTES) throw new EnvelopeError('clé de données invalide');
}

/** Chiffre `plaintext` avec la DEK du sujet. */
export function seal(dek: Buffer, plaintext: Buffer, aad: string): Buffer {
  assertDek(dek);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dek, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.of(ENVELOPE_VERSION), nonce, body, cipher.getAuthTag()]);
}

/** Déchiffre une enveloppe v1 ; `EnvelopeError` si la clé, l'AAD ou un octet ne correspond pas. */
export function open(dek: Buffer, envelope: Buffer, aad: string): Buffer {
  assertDek(dek);
  if (envelope.length < ENVELOPE_MIN_BYTES || envelope[0] !== ENVELOPE_VERSION) {
    throw new EnvelopeError('enveloppe invalide');
  }
  const nonce = envelope.subarray(1, 1 + NONCE_BYTES);
  const tag = envelope.subarray(envelope.length - TAG_BYTES);
  const body = envelope.subarray(1 + NONCE_BYTES, envelope.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', dek, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new EnvelopeError('déchiffrement refusé');
  }
}
