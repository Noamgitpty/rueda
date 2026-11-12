/**
 * Port `SanctionsScreener` du module KYC (16 VER-028 ; 17 §3.2.2 `sanctions_screening` ; US-123,
 * ADR-105). Filtrage d'un hôte contre les listes de sanctions (ONU, OFAC, listes nationales du pays
 * du compte d'hôte) par un prestataire qui REPREND la session d'identité déjà vérifiée chez le
 * fournisseur d'identité : l'application n'envoie ni nom, ni date de naissance, ni pièce.
 *
 * Règles du port :
 * - le prestataire rend le résultat, la version de chaque liste consultée et, en cas de
 *   correspondance, une référence OPAQUE de son dossier ; jamais une entrée de liste ;
 * - les échecs sont des valeurs ; `TIMEOUT` = issue inconnue : rejouer la même clé ;
 * - aucun prestataire en production avant le choix du pays (DEC-FONDATEUR-03) : la bêta pilote
 *   filtre à la main (VER-028 « MANUEL », US-108) ; sans prestataire, le dossier reste incomplet
 *   (`HOST_SCREENING_MISSING`).
 *
 * Adaptateurs : FAKE `@rueda/fake-adapters/sanctions` (tests et développement, C19).
 */
export type ScreeningResult = 'CLEAR' | 'POTENTIAL_MATCH' | 'CONFIRMED_MATCH';

export interface ScreeningRequest {
  readonly idempotencyKey: string;
  readonly identityProvider: string;
  readonly identitySessionRef: string;
  readonly country: string;
}

export interface ScreeningReport {
  readonly result: ScreeningResult;
  readonly listsVersion: Readonly<Record<string, string>>;
  readonly matchRef: string | null;
  readonly screenedAt: Date;
}

export type ScreeningOutcome =
  | { readonly status: 'OK'; readonly value: ScreeningReport; readonly replayed: boolean }
  | { readonly status: 'REFUSED'; readonly reason: string }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

export interface SanctionsScreener {
  readonly screen: (request: ScreeningRequest) => Promise<ScreeningOutcome>;
}
