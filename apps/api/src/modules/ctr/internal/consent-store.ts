/**
 * Port de persistance des documents juridiques et des consentements (US-102 ; 17 §3.2.6 ; 16
 * LEG-001, LEG-002, NFR-17). Deux implémentations :
 * - `PgConsentStore` (production) : fonctions `core.ctr_*` de la migration 0059 sous `app_api` ;
 * - `FakeConsentStore` (`../testing/`, TESTS SEULEMENT, exclu de la compilation de production).
 *
 * Le titulaire est désigné par l'empreinte SHA-256 du jeton de session (`sessionProofOf` d'IAM),
 * jamais par un identifiant reçu : la base résout elle-même la session.
 */

/** Documents que l'inscription et le compte voyageur font accepter (US-102). */
export const LEGAL_DOCUMENT_KINDS = ['TOS_GUEST', 'PRIVACY', 'MARKETING'] as const;
export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];
/** Documents requis (sans eux : aucun compte, aucune réservation). */
export type RequiredDocumentKind = Exclude<LegalDocumentKind, 'MARKETING'>;
export const REQUIRED_DOCUMENT_KINDS: readonly RequiredDocumentKind[] = ['TOS_GUEST', 'PRIVACY'];

export interface LegalDocumentSummary {
  readonly kind: LegalDocumentKind;
  readonly version: number;
  readonly isMajor: boolean;
  /** Langue du texte servi (repli sur l'espagnol, qui fait foi, si la langue manque). */
  readonly locale: string;
  readonly title: string;
  /** SHA-256 du texte, hexadécimal (preuve de la version acceptée). */
  readonly contentHash: string;
  /** Version non validée par le juridique (OQ-BR-24) : affichée « BROUILLON ». */
  readonly draft: boolean;
  readonly validFrom: Date;
}

export interface LegalDocument extends LegalDocumentSummary {
  readonly bodyMd: string;
}

export interface ConsentStatusRow {
  readonly kind: LegalDocumentKind;
  readonly required: boolean;
  readonly currentVersion: number | null;
  /** Plus haute version MAJEURE en vigueur : la réacceptation l'exige. */
  readonly requiredVersion: number | null;
  readonly acceptedVersion: number | null;
  /** État courant (dernière ligne) : accepté ou retiré. */
  readonly accepted: boolean;
  readonly reacceptRequired: boolean;
}

export interface ConsentHistoryRow {
  readonly kind: string;
  readonly version: number;
  readonly locale: string;
  readonly accepted: boolean;
  readonly acceptedAt: Date;
  readonly context: string;
}

export interface DocumentVersion {
  readonly kind: RequiredDocumentKind;
  readonly version: number;
}

/** Refus d'une écriture de consentement : version périmée, aucun document, demande invalide. */
export class ConsentDocumentsError extends Error {
  override readonly name = 'ConsentDocumentsError';
  constructor(readonly reason: 'VERSION_CHANGED' | 'UNAVAILABLE' | 'INVALID') {
    super(`CTR : consentement refusé (${reason})`);
  }
}

export interface ConsentStore {
  /** Documents en vigueur pour le pays (null = communs) et la langue. */
  publishedDocuments(country: string | null, language: string): Promise<LegalDocumentSummary[]>;
  /** Texte en vigueur (version null) ou d'une version passée en vigueur ; null si inconnu. */
  documentBody(
    kind: LegalDocumentKind,
    country: string | null,
    language: string,
    version: number | null,
  ): Promise<LegalDocument | null>;
  /** État des consentements de la session ; `null` si la session n'est pas valide. */
  status(proof: Buffer): Promise<ConsentStatusRow[] | null>;
  /** Accepte les versions en vigueur ; `null` si la session n'est pas valide. */
  accept(proof: Buffer, documents: readonly DocumentVersion[]): Promise<number | null>;
  /** Communications : accord ou révocation ; `null` si la session n'est pas valide. */
  setMarketing(proof: Buffer, optIn: boolean): Promise<'CHANGED' | 'UNCHANGED' | null>;
  /** Historique (200 lignes au plus, de la plus récente à la plus ancienne). */
  history(proof: Buffer): Promise<ConsentHistoryRow[]>;
}
