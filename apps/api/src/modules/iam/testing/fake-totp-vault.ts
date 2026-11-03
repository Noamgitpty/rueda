/**
 * Coffre TOTP FAKE — TESTS SEULEMENT (exclu de la compilation de production par
 * `tsconfig.build.json`, refusé hors `RUEDA_ENV` = development | test : C19, CLAUDE.md
 * contrainte 2). Mémoire du processus ; références `fake-vault:<uuid>` (format de
 * `auth_factor_secret_ref_format`).
 */
import { randomUUID } from 'node:crypto';
import { assertFakeAllowed } from '@rueda/fake-adapters';
import type { TotpSecretVault } from '../internal/staff/secret-vault.js';

export class FakeTotpSecretVault implements TotpSecretVault {
  readonly #secrets = new Map<string, Buffer>();

  constructor(env: Readonly<Record<string, string | undefined>> = process.env) {
    assertFakeAllowed('FakeTotpSecretVault', env);
  }

  /** Range un secret sous une référence donnée (secret d'un facteur créé par une fixture). */
  put(ref: string, secret: Buffer): void {
    this.#secrets.set(ref, Buffer.from(secret));
  }

  store(secret: Buffer): Promise<string> {
    const ref = `fake-vault:${randomUUID()}`;
    this.#secrets.set(ref, Buffer.from(secret));
    return Promise.resolve(ref);
  }

  resolve(ref: string): Promise<Buffer | null> {
    const s = this.#secrets.get(ref);
    return Promise.resolve(s === undefined ? null : Buffer.from(s));
  }
}
