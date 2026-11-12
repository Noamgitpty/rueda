/**
 * Port `TaxIdSealer` du module KYC (16 FIN-008 ; 17 §3.1.3 point 1, §3.1.4 ; ADR-026, ADR-051 ;
 * US-123, ADR-105) : chiffre le numéro fiscal de l'hôte (cédula ou RUC, selon les types admis par
 * la configuration du pays) par la clé de données du SUJET (compte d'hôte `ORG:<id>`), enveloppe v1
 * de `@rueda/db/audit`, AAD `rueda.c2.v1|core.kyc_host_tax_profile.tax_id_enc|ORG:<id>`. La base ne
 * reçoit jamais le numéro en clair ; détruire la clé du sujet l'efface (crypto-shredding).
 *
 * Fail-closed : sans KMS (production avant l'adaptateur du coffre), `UNAVAILABLE` ⇒ 503, rien
 * n'est écrit. Adaptateur de test : `FakeTaxIdSealer` (`../testing/`).
 */
export const TAX_ID_COLUMN = { table: 'core.kyc_host_tax_profile', column: 'tax_id_enc' } as const;

export type SealOutcome =
  | { readonly status: 'OK'; readonly envelope: Buffer }
  | { readonly status: 'UNAVAILABLE' };

export interface TaxIdSealer {
  readonly seal: (orgId: string, plaintext: string) => Promise<SealOutcome>;
}
