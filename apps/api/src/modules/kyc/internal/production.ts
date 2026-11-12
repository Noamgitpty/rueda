/**
 * Adaptateurs de PRODUCTION de la vérification d'identité (US-105, ADR-102 ; ADR-007 ; C19).
 *
 * - **Aucun fournisseur d'identité avant le lot C** (US-605) : le FAKE n'est jamais compilé dans
 *   l'image de production (`tsconfig.build.json` exclut `testing/` ; le paquet des FAKE est une
 *   dépendance de développement seulement) et le KYC de production reste désactivé tant que le registre
 *   LEG-010 n'est pas validé (OQ-MK-09, défaut PROPOSÉ) : l'ouverture d'une vérification rend
 *   `KYC_PROVIDER_UNAVAILABLE` (503) sans écriture, un rappel posté sur `/kyc/webhooks/{code}`
 *   rend 404 sans toucher la base. Aucune option ne permet d'y injecter un fournisseur.
 * - Vérification de l'hôte (US-123) : aucun prestataire de filtrage des sanctions ni coffre de
 *   clés compilé ; l'état et la soumission restent servis par la base, le profil fiscal rend 503.
 * - Le magasin est celui de la base (`core.kyc_*`, connexion `app_api`) : l'état et le
 *   consentement biométrique restent lisibles et enregistrables.
 */
import { CountryConfigService } from '../../cfg/index.js';
import type { KycIdentityOptions } from './kyc-identity.module.js';
import { kycConsoleLogger } from './kyc-identity.module.js';
import { PgHostVerificationStore } from './pg-host-verification-store.js';
import { PgIdentityStore } from './pg-identity-store.js';
import type { KycSqlExecutor } from './pg-identity-store.js';

/** Fournisseurs compilés dans l'image de production (lot C : connecteur réel seulement). */
export const PRODUCTION_IDENTITY_PROVIDERS: readonly string[] = [];

/** Pays proposés pour le dossier : ceux de la configuration (CFG), jamais une constante. */
export function kycCountries(
  config = new CountryConfigService().config,
): KycIdentityOptions['countries'] {
  return [...config.countries.values()].map((c) => ({ code: c.code, names: c.names }));
}

export function postgresKycAdapters(db: KycSqlExecutor): KycIdentityOptions {
  return {
    store: new PgIdentityStore(db),
    providers: { active: null, byCode: new Map() },
    returnUrl: null,
    countries: kycCountries(),
    log: kycConsoleLogger,
    // vérification de l'hôte (US-123) : commandes core.kyc_* de 0075 ; AUCUN prestataire de
    // filtrage (bêta pilote : filtrage manuel par l'ops, US-108) ni coffre de clés (KMS) avant leur
    // adaptateur : le profil fiscal rend 503 et le dossier reste incomplet (fail-closed)
    host: {
      store: new PgHostVerificationStore(db),
      screener: null,
      sealer: null,
      log: kycConsoleLogger,
    },
  };
}
