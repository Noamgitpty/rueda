/**
 * FAKE du port `TaxIdSealer` (US-123) — TESTS SEULEMENT, jamais compilé en production
 * (`testing/` exclu par tsconfig.build.json). Une clé de données (DEK) aléatoire par compte d'hôte,
 * en mémoire, et l'enveloppe v1 RÉELLE de `@rueda/db/audit` (AES-256-GCM, AAD de la colonne et du
 * sujet) : le test peut ouvrir l'enveloppe et prouver que le numéro n'est jamais en clair.
 * `available = false` simule un KMS injoignable (fail-closed : 503, rien n'est écrit).
 */
import { randomBytes } from 'node:crypto';
import { columnAad, open, seal } from '@rueda/db/audit';
import type { SealOutcome, TaxIdSealer } from '../internal/tax-id-sealer.port.js';
import { TAX_ID_COLUMN } from '../internal/tax-id-sealer.port.js';

const aadOf = (orgId: string): string =>
  columnAad(TAX_ID_COLUMN.table, TAX_ID_COLUMN.column, { type: 'ORG', id: orgId });

export class FakeTaxIdSealer implements TaxIdSealer {
  available = true;
  readonly #keys = new Map<string, Buffer>();

  seal = (orgId: string, plaintext: string): Promise<SealOutcome> => {
    if (!this.available) return Promise.resolve({ status: 'UNAVAILABLE' });
    let dek = this.#keys.get(orgId);
    if (dek === undefined) {
      dek = randomBytes(32);
      this.#keys.set(orgId, dek);
    }
    return Promise.resolve({
      status: 'OK',
      envelope: seal(dek, Buffer.from(plaintext, 'utf8'), aadOf(orgId)),
    });
  };

  /** Lecture du test : ouvre une enveloppe avec la clé du compte d'hôte. */
  openFor(orgId: string, envelope: Buffer): string {
    const dek = this.#keys.get(orgId);
    if (dek === undefined) throw new Error('aucune clé pour ce sujet');
    return open(dek, envelope, aadOf(orgId)).toString('utf8');
  }
}
