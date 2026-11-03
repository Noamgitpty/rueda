/**
 * Adaptateurs FAKE des ports d'audit (US-009) : `KeyWrapper` (KMS) et `FileStore` (stockage
 * objet). TESTS SEULEMENT : exportés par `@rueda/db/testing`, jamais par `@rueda/db` ni
 * `@rueda/db/audit` ; refusés à la construction si `NODE_ENV = production` (C19 : aucun FAKE en
 * production, CLAUDE.md point 2).
 *
 * `FakeKeyWrapper` : la clé maîtresse est tirée au hasard EN MÉMOIRE à la construction (aucune
 * clé en dur, rien sur disque, rien d'affiché). Elle meurt avec l'instance : une DEK enveloppée par
 * une instance ne se déroule pas avec une autre (comme deux clés KMS distinctes).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Bucket, FileStore } from '../audit/file-asset.ts';
import { KeyWrapperRejectedError, KeyWrapperUnavailableError } from '../audit/key-wrapper.ts';
import type { KeyWrapper } from '../audit/key-wrapper.ts';
import { subjectLabel } from '../audit/envelope.ts';
import type { SubjectRef } from '../audit/envelope.ts';

/** Refuse un adaptateur FAKE dans un processus de production. */
export function assertNotProduction(adapter: string, env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(`${adapter} : adaptateur FAKE refusé en production (C19)`);
  }
}

const NONCE = 12;
const TAG = 16;

export class FakeKeyWrapper implements KeyWrapper {
  readonly keyId: string;
  readonly #master: Buffer;
  #available = true;
  #unwrapCalls = 0;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    assertNotProduction('FakeKeyWrapper', env);
    this.#master = randomBytes(32);
    this.keyId = `fake-kms/${randomBytes(6).toString('hex')}`;
  }

  /** Simule une panne (ou le retour) du KMS. */
  setAvailable(available: boolean): void {
    this.#available = available;
  }

  /** Nombre d'appels à `unwrap` (preuve du cache). */
  get unwrapCalls(): number {
    return this.#unwrapCalls;
  }

  async wrap(dek: Buffer, context: SubjectRef): Promise<Buffer> {
    if (!this.#available) throw new KeyWrapperUnavailableError('KMS FAKE indisponible');
    const nonce = randomBytes(NONCE);
    const cipher = createCipheriv('aes-256-gcm', this.#master, nonce, { authTagLength: TAG });
    cipher.setAAD(Buffer.from(`fake-kms|${subjectLabel(context)}`, 'utf8'));
    const body = Buffer.concat([cipher.update(dek), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]);
  }

  async unwrap(wrapped: Buffer, keyId: string, context: SubjectRef): Promise<Buffer> {
    this.#unwrapCalls++;
    if (!this.#available) throw new KeyWrapperUnavailableError('KMS FAKE indisponible');
    if (keyId !== this.keyId || wrapped.length < NONCE + TAG + 1) {
      throw new KeyWrapperRejectedError('enveloppe refusée');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.#master, wrapped.subarray(0, NONCE), {
        authTagLength: TAG,
      });
      decipher.setAAD(Buffer.from(`fake-kms|${subjectLabel(context)}`, 'utf8'));
      decipher.setAuthTag(wrapped.subarray(wrapped.length - TAG));
      return Buffer.concat([
        decipher.update(wrapped.subarray(NONCE, wrapped.length - TAG)),
        decipher.final(),
      ]);
    } catch {
      throw new KeyWrapperRejectedError('enveloppe refusée');
    }
  }
}

/** Stockage objet en mémoire. `corrupt` simule une altération des octets stockés. */
export class InMemoryFileStore implements FileStore {
  readonly #objects = new Map<string, Buffer>();

  constructor(env: NodeJS.ProcessEnv = process.env) {
    assertNotProduction('InMemoryFileStore', env);
  }

  async put(bucket: Bucket, key: string, body: Buffer): Promise<void> {
    this.#objects.set(`${bucket}/${key}`, Buffer.from(body));
  }

  async get(bucket: Bucket, key: string): Promise<Buffer> {
    const body = this.#objects.get(`${bucket}/${key}`);
    if (body === undefined) throw new Error('objet absent');
    return Buffer.from(body);
  }

  /** Octets tels que stockés (preuve que le clair n'y figure pas). */
  raw(bucket: Bucket, key: string): Buffer | undefined {
    const body = this.#objects.get(`${bucket}/${key}`);
    return body === undefined ? undefined : Buffer.from(body);
  }

  /** Inverse un octet de l'objet stocké. */
  corrupt(bucket: Bucket, key: string, offset = 0): void {
    const body = this.#objects.get(`${bucket}/${key}`);
    if (body === undefined || body.length === 0) throw new Error('objet absent ou vide');
    const at = Math.min(offset, body.length - 1);
    body[at] = (body[at] ?? 0) ^ 0xff;
  }
}
