/**
 * Adaptateur LOCAL du port `KeyWrapper` (US-036 ; 17 §6.1 « Secrets », §3.1.3 point 1 ; ADR-026,
 * ADR-051, ADR-120).
 *
 * Il remplace le KMS du nuage sur un poste, en CI et dans la préproduction LOCALE : la clé
 * maîtresse (32 octets) est lue dans un fichier (0600, jamais dans le dépôt ni dans une variable
 * affichée) et chaque DEK est enveloppée en AES-256-GCM, avec une AAD qui lie l'enveloppe à son
 * sujet et à la clé maîtresse. Format de l'enveloppe (61 octets, dans les bornes de
 * `subject_key_wrapped_dek_size`) : `0x01` (version) ‖ IV (12) ‖ étiquette (16) ‖ DEK chiffrée (32).
 *
 * Ce n'est PAS un FAKE : il est déterministe seulement par sa clé, et deux processus qui lisent le
 * même fichier déroulent les mêmes enveloppes (CLI d'export / d'import, exercice de portabilité).
 * Il est néanmoins REFUSÉ en production (fail-closed : `RUEDA_ENV` absente ou inconnue aussi) :
 * une clé maîtresse dans un fichier ne vaut pas un KMS. En production, l'adaptateur est celui de
 * l'hébergeur retenu (Q-007), derrière le même port ; alternatives nommées : ADR-120.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { SubjectRef } from '../audit/envelope.ts';
import type { KeyWrapper } from '../audit/key-wrapper.ts';
import { KeyWrapperRejectedError } from '../audit/key-wrapper.ts';

/** Environnements où l'adaptateur local est admis (jamais `production`). */
export const LOCAL_KEY_WRAPPER_ENVIRONMENTS = ['development', 'test', 'preproduction'] as const;

export class LocalAdapterForbiddenError extends Error {
  override readonly name = 'LocalAdapterForbiddenError';
  readonly code = 'LOCAL_ADAPTER_FORBIDDEN';
}

const VERSION = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEK_BYTES = 32;
export const LOCAL_WRAPPED_BYTES = 1 + IV_BYTES + TAG_BYTES + DEK_BYTES;

/** Refuse l'adaptateur local hors des environnements admis (absent ou inconnu : refus). */
export function assertLocalAdapterAllowed(
  what: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const value = env['RUEDA_ENV'];
  if ((LOCAL_KEY_WRAPPER_ENVIRONMENTS as readonly (string | undefined)[]).includes(value)) return;
  throw new LocalAdapterForbiddenError(
    `${what} : adaptateur local refusé (RUEDA_ENV = ${value === undefined ? 'absent' : JSON.stringify(value)} ; ` +
      `seuls ${LOCAL_KEY_WRAPPER_ENVIRONMENTS.join(', ')} l'acceptent)`,
  );
}

/** Identifiant public d'une clé maîtresse : empreinte tronquée, jamais la clé. */
export function localKeyId(master: Buffer): string {
  const digest = createHash('sha256').update('rueda-local-kek-id-v1').update(master).digest();
  return `local-aes256gcm:${digest.subarray(0, 8).toString('hex')}`;
}

const aad = (keyId: string, context: SubjectRef): Buffer =>
  Buffer.from(`rueda-local-kw-v1|${keyId}|${context.type}|${context.id}`, 'utf8');

export class LocalKeyWrapper implements KeyWrapper {
  readonly keyId: string;
  readonly #master: Buffer;

  constructor(master: Buffer, env: Readonly<Record<string, string | undefined>> = process.env) {
    assertLocalAdapterAllowed('LocalKeyWrapper', env);
    if (master.length !== 32) {
      throw new Error('LocalKeyWrapper : la clé maîtresse fait exactement 32 octets');
    }
    this.#master = Buffer.from(master);
    this.keyId = localKeyId(this.#master);
  }

  /** Lit la clé maîtresse dans un fichier : 32 octets bruts ou 64 caractères hexadécimaux. */
  static fromFile(
    path: string,
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): LocalKeyWrapper {
    assertLocalAdapterAllowed('LocalKeyWrapper', env);
    const raw = readFileSync(path);
    const text = raw.toString('utf8').trim();
    const master = /^[0-9a-fA-F]{64}$/.test(text) ? Buffer.from(text, 'hex') : raw;
    try {
      return new LocalKeyWrapper(master, env);
    } finally {
      master.fill(0);
      raw.fill(0);
    }
  }

  wrap(dek: Buffer, context: SubjectRef): Promise<Buffer> {
    if (dek.length !== DEK_BYTES) throw new Error('LocalKeyWrapper : DEK de 32 octets attendue');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.#master, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad(this.keyId, context));
    const sealed = Buffer.concat([cipher.update(dek), cipher.final()]);
    return Promise.resolve(
      Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), sealed]),
    );
  }

  unwrap(wrapped: Buffer, keyId: string, context: SubjectRef): Promise<Buffer> {
    if (keyId !== this.keyId) {
      return Promise.reject(new KeyWrapperRejectedError('enveloppe d’une autre clé maîtresse'));
    }
    if (wrapped.length !== LOCAL_WRAPPED_BYTES || wrapped[0] !== VERSION) {
      return Promise.reject(new KeyWrapperRejectedError('enveloppe locale mal formée'));
    }
    try {
      const iv = wrapped.subarray(1, 1 + IV_BYTES);
      const tag = wrapped.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', this.#master, iv, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(aad(this.keyId, context));
      decipher.setAuthTag(tag);
      const body = wrapped.subarray(1 + IV_BYTES + TAG_BYTES);
      return Promise.resolve(Buffer.concat([decipher.update(body), decipher.final()]));
    } catch {
      return Promise.reject(new KeyWrapperRejectedError('enveloppe refusée (sujet ou octets)'));
    }
  }
}
