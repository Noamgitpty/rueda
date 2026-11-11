/**
 * Documents juridiques et consentements du voyageur (US-102 ; 16 ACC-001, LEG-001, LEG-002).
 *
 * - Lecture publique des documents en vigueur (CGU du voyageur, confidentialité, communications) :
 *   le formulaire d'inscription affiche leur version, renvoyée à l'inscription (IAM) ;
 * - état des consentements d'une session : après la publication d'une version MAJEURE, la
 *   réacceptation est exigée avant toute réservation (`TERMS_REACCEPT_REQUIRED`, `TermsGuard`) ;
 * - acceptation des versions en vigueur, accord ou révocation des communications, historique.
 * Toute écriture passe par une commande en base qui revérifie la session et la version.
 */
import { Inject, Injectable } from '@nestjs/common';
import { CATALOG_LANGUAGES } from '@rueda/i18n';
import { CountryConfigService } from '../../cfg/index.js';
import type {
  ConsentHistoryRow,
  ConsentStatusRow,
  ConsentStore,
  DocumentVersion,
  LegalDocument,
  LegalDocumentKind,
  LegalDocumentSummary,
} from './consent-store.js';
import {
  ConsentDocumentsError,
  LEGAL_DOCUMENT_KINDS,
  REQUIRED_DOCUMENT_KINDS,
} from './consent-store.js';
import { LegalHttpError } from './errors.js';
import type { LegalCode } from './errors.js';
import { CTR_CONSENT_STORE } from './tokens.js';

const LOCALE_FORMAT = /^[a-z]{2}(-[A-Z]{2})?$/;
const COUNTRY_FORMAT = /^[A-Z]{2}$/;

/** Langue du catalogue d'une étiquette (`es-PA` → `es`) ; `null` si inconnue. */
export function languageOf(locale: unknown): string | null {
  if (typeof locale !== 'string' || !LOCALE_FORMAT.test(locale)) return null;
  const language = locale.slice(0, 2);
  return (CATALOG_LANGUAGES as readonly string[]).includes(language) ? language : null;
}

/** Pays facultatif (`null` = documents communs) ; `undefined` s'il est mal formé. */
export function countryOf(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' && COUNTRY_FORMAT.test(value) ? value : undefined;
}

/** Pays déclarés par la configuration (CFG) : un pays inconnu est refusé (`COUNTRY_UNKNOWN`). */
export const KNOWN_COUNTRIES: ReadonlySet<string> = new Set(
  new CountryConfigService().config.countries.keys(),
);

export interface ConsentOverview {
  readonly code: Extract<LegalCode, 'TERMS_CURRENT' | 'TERMS_REACCEPT_REQUIRED'>;
  readonly documents: readonly ConsentStatusRow[];
  readonly marketingOptIn: boolean;
}

/** Versions demandées `[{ kind, version }]` (1 ou 2, genres requis distincts) ; sinon `null`. */
export function documentVersions(value: unknown): DocumentVersion[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  const out: DocumentVersion[] = [];
  for (const item of value as unknown[]) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const { kind, version } = item as { kind?: unknown; version?: unknown };
    if (!(REQUIRED_DOCUMENT_KINDS as readonly unknown[]).includes(kind)) return null;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
    if (out.some((d) => d.kind === kind)) return null;
    out.push({ kind: kind as DocumentVersion['kind'], version });
  }
  return out;
}

function mapStoreError(error: unknown): never {
  if (error instanceof ConsentDocumentsError) {
    throw new LegalHttpError(
      error.reason === 'VERSION_CHANGED'
        ? 'TERMS_VERSION_CHANGED'
        : error.reason === 'UNAVAILABLE'
          ? 'LEGAL_DOCUMENT_UNAVAILABLE'
          : 'REQUEST_INVALID',
    );
  }
  throw error;
}

@Injectable()
export class LegalService {
  constructor(@Inject(CTR_CONSENT_STORE) private readonly store: ConsentStore) {}

  /** Documents en vigueur ; 503 si les CGU ou la confidentialité manquent (fail-closed). */
  async publishedDocuments(country: string | null, language: string) {
    const documents: LegalDocumentSummary[] = await this.store.publishedDocuments(
      country,
      language,
    );
    for (const kind of REQUIRED_DOCUMENT_KINDS) {
      if (!documents.some((d) => d.kind === kind)) {
        throw new LegalHttpError('LEGAL_DOCUMENT_UNAVAILABLE');
      }
    }
    return documents;
  }

  async document(
    kind: unknown,
    country: string | null,
    language: string,
    version: number | null,
  ): Promise<LegalDocument> {
    if (!(LEGAL_DOCUMENT_KINDS as readonly unknown[]).includes(kind)) {
      throw new LegalHttpError('LEGAL_DOCUMENT_NOT_FOUND');
    }
    const doc = await this.store.documentBody(
      kind as LegalDocumentKind,
      country,
      language,
      version,
    );
    if (doc === null) throw new LegalHttpError('LEGAL_DOCUMENT_NOT_FOUND');
    return doc;
  }

  /** État des consentements ; 401 si la session n'est plus valide. */
  async overview(proof: Buffer | null): Promise<ConsentOverview> {
    if (proof === null) throw new LegalHttpError('AUTH_REQUIRED');
    const rows = await this.store.status(proof);
    if (rows === null) throw new LegalHttpError('AUTH_REQUIRED');
    return {
      code: rows.some((r) => r.reacceptRequired) ? 'TERMS_REACCEPT_REQUIRED' : 'TERMS_CURRENT',
      documents: rows,
      marketingOptIn: rows.some((r) => r.kind === 'MARKETING' && r.accepted),
    };
  }

  async history(proof: Buffer | null): Promise<ConsentHistoryRow[]> {
    if (proof === null) throw new LegalHttpError('AUTH_REQUIRED');
    return this.store.history(proof);
  }

  async accept(proof: Buffer | null, body: unknown): Promise<ConsentOverview> {
    if (proof === null) throw new LegalHttpError('AUTH_REQUIRED');
    const documents = documentVersions(body);
    if (documents === null) throw new LegalHttpError('REQUEST_INVALID');
    const n = await this.store.accept(proof, documents).catch(mapStoreError);
    if (n === null) throw new LegalHttpError('AUTH_REQUIRED');
    return this.overview(proof);
  }

  async setMarketing(proof: Buffer | null, optIn: unknown): Promise<boolean> {
    if (proof === null) throw new LegalHttpError('AUTH_REQUIRED');
    if (typeof optIn !== 'boolean') throw new LegalHttpError('REQUEST_INVALID');
    const outcome = await this.store.setMarketing(proof, optIn).catch(mapStoreError);
    if (outcome === null) throw new LegalHttpError('AUTH_REQUIRED');
    return optIn;
  }
}
