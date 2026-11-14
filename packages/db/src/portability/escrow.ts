/**
 * Séquestre des clés de données (US-036 critère 2 ; 17 §6.4 « Secrets et clés » ; ADR-120 ;
 * pré-mortem L1-PM-34).
 *
 * Changer d'hébergeur sans perdre les données C2 / C3 exige de sortir les DEK par sujet du KMS de
 * l'ancien hébergeur. Elles ne sortent JAMAIS en clair : l'export les ré-enveloppe pour la clé
 * PUBLIQUE de séquestre du fondateur (RSA-OAEP-SHA-256, 3 072 bits au moins). La plateforme, la CI
 * et l'export n'ont jamais la clé privée : elle reste hors ligne chez le fondateur et ne sert qu'à
 * l'import, sur le nouvel hébergeur, qui ré-enveloppe chaque DEK avec son propre `KeyWrapper`.
 *
 * L'étiquette OAEP lie chaque enveloppe à son sujet et à l'empreinte de la clé de séquestre :
 * une enveloppe recopiée sur un autre sujet ou ouverte avec une autre clé est refusée.
 */
import {
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
} from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { SubjectRef } from '../audit/envelope.ts';

export const ESCROW_MIN_MODULUS_BITS = 3072;

export class EscrowError extends Error {
  override readonly name = 'EscrowError';
}

/** Empreinte publique d'une clé de séquestre (SHA-256 de la SPKI DER, 16 octets en hexadécimal). */
export function escrowFingerprint(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return `escrow-rsa:${createHash('sha256').update(der).digest().subarray(0, 16).toString('hex')}`;
}

function checkRsa(key: KeyObject): void {
  const details = key.asymmetricKeyDetails;
  if (key.asymmetricKeyType !== 'rsa' || details?.modulusLength === undefined) {
    throw new EscrowError('clé de séquestre : RSA attendue');
  }
  if (details.modulusLength < ESCROW_MIN_MODULUS_BITS) {
    throw new EscrowError(`clé de séquestre : ${ESCROW_MIN_MODULUS_BITS} bits au moins`);
  }
}

const label = (fingerprint: string, subject: SubjectRef): Buffer =>
  Buffer.from(`rueda-escrow-v1|${fingerprint}|${subject.type}|${subject.id}`, 'utf8');

/** Côté export : chiffre pour le séquestre avec la seule clé PUBLIQUE. */
export class EscrowSealer {
  readonly fingerprint: string;
  readonly #key: KeyObject;

  constructor(publicKeyPem: string | Buffer) {
    let key: KeyObject;
    try {
      key = createPublicKey(publicKeyPem);
    } catch {
      throw new EscrowError('clé publique de séquestre illisible (PEM SPKI attendu)');
    }
    checkRsa(key);
    this.#key = key;
    this.fingerprint = escrowFingerprint(key);
  }

  seal(dek: Buffer, subject: SubjectRef): Buffer {
    return publicEncrypt(
      {
        key: this.#key,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
        oaepLabel: label(this.fingerprint, subject),
      },
      dek,
    );
  }
}

/** Côté import : ouvre avec la clé PRIVÉE du séquestre, fournie par le fondateur le temps de l'import. */
export class EscrowOpener {
  readonly fingerprint: string;
  readonly #key: KeyObject;

  constructor(privateKeyPem: string | Buffer) {
    let key: KeyObject;
    try {
      key = createPrivateKey(privateKeyPem);
    } catch {
      throw new EscrowError('clé privée de séquestre illisible (PEM PKCS#8 attendu)');
    }
    checkRsa(key);
    this.#key = key;
    this.fingerprint = escrowFingerprint(createPublicKey(key));
  }

  open(sealed: Buffer, subject: SubjectRef): Buffer {
    try {
      return privateDecrypt(
        {
          key: this.#key,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
          oaepLabel: label(this.fingerprint, subject),
        },
        sealed,
      );
    } catch {
      throw new EscrowError(`enveloppe de séquestre refusée (${subject.type})`);
    }
  }
}
