/**
 * Port `PayoutAccountVault` du module PYO (US-707, ADR-180 ; 17 §3.1.3 point 1, §3.1.4 ;
 * ADR-026, ADR-051, ADR-105) : opérations sous la clé de données du SUJET (compte d'hôte
 * `ORG:<id>`), enveloppe v1 de `@rueda/db/audit`.
 *
 * - `sealAccountNumber` : chiffre le numéro de compte (C3), AAD
 *   `rueda.c2.v1|core.payout_payout_account.account_number_enc|ORG:<id>` ; la base ne le voit jamais
 *   en clair ; détruire la clé du sujet l'efface (crypto-shredding).
 * - `matchesTaxId` : ouvre l'enveloppe du numéro fiscal de l'hôte (`core.kyc_host_tax_profile`,
 *   AAD de KYC) et la compare, à temps constant et après normalisation, à la cédula / au RUC
 *   déclaré pour le titulaire ; le numéro en clair ne sort jamais du coffre.
 *
 * Fail-closed : sans KMS (production avant l'adaptateur du coffre), `UNAVAILABLE` ⇒ 503, rien
 * n'est écrit. Adaptateur de test : `FakePayoutAccountVault` (`../testing/`).
 */
export const ACCOUNT_NUMBER_COLUMN = {
  table: 'core.payout_payout_account',
  column: 'account_number_enc',
} as const;
export const HOST_TAX_ID_COLUMN = {
  table: 'core.kyc_host_tax_profile',
  column: 'tax_id_enc',
} as const;

export type VaultSealOutcome =
  { readonly status: 'OK'; readonly envelope: Buffer } | { readonly status: 'UNAVAILABLE' };

export type VaultMatchOutcome = 'MATCH' | 'MISMATCH' | 'UNAVAILABLE';

export interface PayoutAccountVault {
  readonly sealAccountNumber: (orgId: string, accountNumber: string) => Promise<VaultSealOutcome>;
  readonly matchesTaxId: (
    orgId: string,
    taxIdEnvelope: Buffer,
    candidate: string,
  ) => Promise<VaultMatchOutcome>;
}

/** Forme normalisée d'un numéro fiscal (même règle que le profil fiscal de KYC, US-123). */
export const normalizeTaxId = (raw: string): string => raw.replace(/[\s.]/g, '').toUpperCase();
