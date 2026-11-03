/**
 * Adaptateur FAKE du port d'audit `KeyWrapper` (KMS, US-009). TESTS SEULEMENT : exporté par
 * `@rueda/db/testing`, jamais par `@rueda/db` ni `@rueda/db/audit` ; garde centrale des FAKE
 * (`assertFakeAllowed` de `@rueda/fake-adapters`, US-020) : refusé hors `RUEDA_ENV` =
 * development | test (C19 ; revue sécurité US-009, constat 11).
 *
 * Le FAKE `FileStore` (`InMemoryFileStore`) est désormais dans `@rueda/fake-adapters/files`
 * (US-020). `FakeKeyWrapper` reste ici : il lève les classes d'erreur du port (`instanceof` dans
 * `subject-keys.ts`), et `@rueda/fake-adapters` ne peut pas importer `@rueda/db` sans créer un
 * cycle de paquets (ADR-058). KMS réel : US-003.
 *
 * `FakeKeyWrapper` : la clé maîtresse est tirée au hasard EN MÉMOIRE à la construction (aucune
 * clé en dur, rien sur disque, rien d'affiché). Elle meurt avec l'instance : une DEK enveloppée par
 * une instance ne se déroule pas avec une autre (comme deux clés KMS distinctes).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { assertFakeAllowed } from '@rueda/fake-adapters';
import type { EnvironmentVariables } from '@rueda/fake-adapters';
import { KeyWrapperRejectedError, KeyWrapperUnavailableError } from '../audit/key-wrapper.ts';
import type { KeyWrapper } from '../audit/key-wrapper.ts';
import { subjectLabel } from '../audit/envelope.ts';
import type { SubjectRef } from '../audit/envelope.ts';

const NONCE = 12;
const TAG = 16;

export class FakeKeyWrapper implements KeyWrapper {
  readonly keyId: string;
  readonly #master: Buffer;
  #available = true;
  #unwrapCalls = 0;

  constructor(env: EnvironmentVariables = process.env) {
    assertFakeAllowed('FakeKeyWrapper', env);
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
