/**
 * FAKE du port `PayoutAccountVault` (US-707) — TESTS SEULEMENT, jamais compilé en production
 * (`testing/` exclu par tsconfig.build.json). Une clé de données (DEK) aléatoire par compte d'hôte,
 * en mémoire, et l'enveloppe v1 RÉELLE de `@rueda/db/audit` (AES-256-GCM, AAD de la colonne et du
 * sujet) : le test peut ouvrir l'enveloppe et prouver que le numéro n'est jamais en clair.
 * `available = false` simule un KMS injoignable (fail-closed : 503, rien n'est écrit).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { columnAad, open, seal } from '@rueda/db/audit';
import {
  ACCOUNT_NUMBER_COLUMN,
  HOST_TAX_ID_COLUMN,
  normalizeTaxId,
} from '../internal/payout-account-vault.port.js';
import type {
  PayoutAccountVault,
  VaultMatchOutcome,
  VaultSealOutcome,
} from '../internal/payout-account-vault.port.js';

const aad = (c: { table: string; column: string }, orgId: string): string =>
  columnAad(c.table, c.column, { type: 'ORG', id: orgId });

export class FakePayoutAccountVault implements PayoutAccountVault {
  available = true;
  readonly #keys = new Map<string, Buffer>();

  #dek(orgId: string): Buffer {
    let dek = this.#keys.get(orgId);
    if (dek === undefined) {
      dek = randomBytes(32);
      this.#keys.set(orgId, dek);
    }
    return dek;
  }

  sealAccountNumber = (orgId: string, accountNumber: string): Promise<VaultSealOutcome> => {
    if (!this.available) return Promise.resolve({ status: 'UNAVAILABLE' });
    return Promise.resolve({
      status: 'OK',
      envelope: seal(
        this.#dek(orgId),
        Buffer.from(accountNumber, 'utf8'),
        aad(ACCOUNT_NUMBER_COLUMN, orgId),
      ),
    });
  };

  matchesTaxId = (
    orgId: string,
    taxIdEnvelope: Buffer,
    candidate: string,
  ): Promise<VaultMatchOutcome> => {
    if (!this.available) return Promise.resolve('UNAVAILABLE');
    const plain = Buffer.from(
      normalizeTaxId(
        open(this.#dek(orgId), taxIdEnvelope, aad(HOST_TAX_ID_COLUMN, orgId)).toString('utf8'),
      ),
      'utf8',
    );
    const other = Buffer.from(normalizeTaxId(candidate), 'utf8');
    return Promise.resolve(
      plain.length === other.length && timingSafeEqual(plain, other) ? 'MATCH' : 'MISMATCH',
    );
  };

  /** Fixture : numéro fiscal de l'hôte chiffré comme par KYC (même clé du sujet). */
  sealTaxId(orgId: string, taxId: string): Buffer {
    return seal(this.#dek(orgId), Buffer.from(taxId, 'utf8'), aad(HOST_TAX_ID_COLUMN, orgId));
  }

  /** Lecture du test : ouvre une enveloppe de numéro de compte. */
  openAccount(orgId: string, envelope: Buffer): string {
    return open(this.#dek(orgId), envelope, aad(ACCOUNT_NUMBER_COLUMN, orgId)).toString('utf8');
  }
}
