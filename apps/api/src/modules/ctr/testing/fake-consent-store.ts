/**
 * FAKE du port `ConsentStore` — TESTS SEULEMENT (répertoire exclu de `tsconfig.build.json`).
 * Reproduit la sémantique des fonctions `core.ctr_*` de la migration 0059 : version en vigueur =
 * plus haute version publiée, réacceptation exigée si la dernière version acceptée est inférieure à
 * la plus haute version MAJEURE, versions périmées refusées, communications révocables. La même
 * sémantique est prouvée sur PostgreSQL par `packages/db/test/l0/l0-ctr-consents.test.ts`.
 */
import { createHash } from 'node:crypto';
import type {
  ConsentHistoryRow,
  ConsentStatusRow,
  ConsentStore,
  DocumentVersion,
  HostTermsOutcome,
  HostTermsState,
  LegalDocument,
  LegalDocumentKind,
  LegalDocumentSummary,
} from '../internal/consent-store.js';
import {
  ConsentDocumentsError,
  LEGAL_DOCUMENT_KINDS,
  SERVED_DOCUMENT_KINDS,
} from '../internal/consent-store.js';

interface FakeVersion {
  readonly kind: LegalDocumentKind;
  readonly version: number;
  readonly isMajor: boolean;
  readonly draft: boolean;
}

interface FakeRow {
  readonly userId: string;
  readonly kind: LegalDocumentKind;
  readonly version: number;
  readonly accepted: boolean;
  readonly context: string;
  readonly at: Date;
}

const LANGS = ['es', 'en', 'fr', 'pt'];

export class FakeConsentStore implements ConsentStore {
  readonly versions: FakeVersion[] = SERVED_DOCUMENT_KINDS.map((kind) => ({
    kind,
    version: 1,
    isMajor: true,
    draft: true,
  }));
  readonly rows: FakeRow[] = [];
  readonly #sessions = new Map<string, string>();
  /** Comptes d'hôte : identifiant → titulaire et pays (comme `core.iam_host_accounts`). */
  readonly #hostAccounts = new Map<string, { userId: string; country: string }>();

  /** Associe un compte d'hôte à son titulaire et à son pays (US-126). */
  bindHostAccount(orgId: string, userId: string, country: string): void {
    this.#hostAccounts.set(orgId, { userId, country });
  }

  /** Associe une session (empreinte du jeton) à un compte. */
  bindSession(proof: Buffer, userId: string): void {
    this.#sessions.set(proof.toString('hex'), userId);
  }

  /** Publie une nouvelle version (majeure ou non) d'un document. */
  publish(kind: LegalDocumentKind, isMajor: boolean): number {
    const version = (this.#current(kind)?.version ?? 0) + 1;
    this.versions.push({ kind, version, isMajor, draft: true });
    return version;
  }

  /** Consentement posé hors API (inscription par IAM, fixture). */
  record(userId: string, kind: LegalDocumentKind, version: number, accepted = true): void {
    this.rows.push({ userId, kind, version, accepted, context: 'SIGNUP', at: new Date() });
  }

  #current(kind: LegalDocumentKind, majorOnly = false): FakeVersion | undefined {
    return this.versions
      .filter((v) => v.kind === kind && (v.isMajor || !majorOnly))
      .sort((a, b) => b.version - a.version)[0];
  }

  #summary(v: FakeVersion, language: string): LegalDocument {
    const locale = LANGS.includes(language) ? language : 'es';
    const bodyMd = `${v.kind} v${v.version} (${locale})`;
    return {
      kind: v.kind,
      version: v.version,
      isMajor: v.isMajor,
      locale,
      title: `${v.kind} ${v.version}`,
      contentHash: createHash('sha256').update(bodyMd, 'utf8').digest('hex'),
      draft: v.draft,
      validFrom: new Date('2000-01-01T00:00:00Z'),
      bodyMd,
    };
  }

  async publishedDocuments(_country: string | null, language: string) {
    const out: LegalDocumentSummary[] = [];
    for (const kind of LEGAL_DOCUMENT_KINDS) {
      const v = this.#current(kind);
      if (v !== undefined) {
        const d = this.#summary(v, language);
        out.push({
          kind: d.kind,
          version: d.version,
          isMajor: d.isMajor,
          locale: d.locale,
          title: d.title,
          contentHash: d.contentHash,
          draft: d.draft,
          validFrom: d.validFrom,
        });
      }
    }
    return out;
  }

  async documentBody(
    kind: LegalDocumentKind,
    _country: string | null,
    language: string,
    version: number | null,
  ) {
    const v =
      version === null
        ? this.#current(kind)
        : this.versions.find((x) => x.kind === kind && x.version === version);
    return v === undefined ? null : this.#summary(v, language);
  }

  #user(proof: Buffer): string | undefined {
    return this.#sessions.get(proof.toString('hex'));
  }

  #last(userId: string, kind: LegalDocumentKind, acceptedOnly: boolean): FakeRow | undefined {
    return this.rows
      .filter((r) => r.userId === userId && r.kind === kind && (r.accepted || !acceptedOnly))
      .at(-1);
  }

  async status(proof: Buffer): Promise<ConsentStatusRow[] | null> {
    const userId = this.#user(proof);
    if (userId === undefined) return null;
    return [...LEGAL_DOCUMENT_KINDS].sort().map((kind) => {
      const required = kind !== 'MARKETING';
      const accepted = this.#last(userId, kind, true)?.version ?? null;
      const last = this.#last(userId, kind, false);
      const major = this.#current(kind, true)?.version ?? null;
      return {
        kind,
        required,
        currentVersion: this.#current(kind)?.version ?? null,
        requiredVersion: major,
        acceptedVersion: accepted,
        accepted: last?.accepted ?? false,
        reacceptRequired:
          required &&
          (accepted === null || last?.accepted !== true || (major !== null && accepted < major)),
      };
    });
  }

  async accept(proof: Buffer, documents: readonly DocumentVersion[]): Promise<number | null> {
    const userId = this.#user(proof);
    if (userId === undefined) return null;
    // tout document à réaccepter doit figurer dans la demande (comme la commande 0059)
    const pending = ((await this.status(proof)) ?? []).filter((r) => r.reacceptRequired);
    if (pending.some((r) => !documents.some((d) => d.kind === r.kind))) {
      throw new ConsentDocumentsError('VERSION_CHANGED');
    }
    for (const d of documents) {
      const current = this.#current(d.kind);
      if (current === undefined) throw new ConsentDocumentsError('UNAVAILABLE');
      if (current.version !== d.version) throw new ConsentDocumentsError('VERSION_CHANGED');
    }
    for (const d of documents) {
      this.rows.push({
        userId,
        kind: d.kind,
        version: d.version,
        accepted: true,
        context: 'REACCEPT',
        at: new Date(),
      });
    }
    return documents.length;
  }

  async setMarketing(proof: Buffer, optIn: boolean) {
    const userId = this.#user(proof);
    if (userId === undefined) return null;
    if ((this.#last(userId, 'MARKETING', false)?.accepted ?? false) === optIn) return 'UNCHANGED';
    const current = this.#current('MARKETING');
    if (current === undefined) throw new ConsentDocumentsError('UNAVAILABLE');
    this.rows.push({
      userId,
      kind: 'MARKETING',
      version: current.version,
      accepted: optIn,
      context: 'SETTINGS',
      at: new Date(),
    });
    return 'CHANGED' as const;
  }

  /**
   * CGU de l'hôte (US-126) : documents communs seulement dans le FAKE (la portée par pays est
   * prouvée sur PostgreSQL par `l0-us126-host-terms`) ; réacceptation exigée si jamais acceptées
   * ou acceptées sous la plus haute version MAJEURE ; aucun document ⇒ exigée (fail-closed).
   */
  async hostTerms(
    proof: Buffer,
    orgId: string,
    language: string,
  ): Promise<HostTermsState | 'AUTH_REQUIRED' | 'FORBIDDEN'> {
    const userId = this.#user(proof);
    if (userId === undefined) return 'AUTH_REQUIRED';
    const account = this.#hostAccounts.get(orgId);
    if (account?.userId !== userId) return 'FORBIDDEN';
    const current = this.#current('TOS_HOST');
    const required = this.#current('TOS_HOST', true)?.version ?? null;
    const last = this.#last(userId, 'TOS_HOST', true);
    const accepted = last?.version ?? null;
    const document = current === undefined ? null : this.#summary(current, language);
    return {
      country: account.country,
      document:
        document === null
          ? null
          : {
              kind: document.kind,
              version: document.version,
              isMajor: document.isMajor,
              locale: document.locale,
              title: document.title,
              contentHash: document.contentHash,
              draft: document.draft,
              validFrom: document.validFrom,
            },
      requiredVersion: required,
      acceptedVersion: accepted,
      acceptedAt: last?.at ?? null,
      reacceptRequired:
        document === null || accepted === null || (required !== null && accepted < required),
    };
  }

  async acceptHostTerms(
    proof: Buffer,
    orgId: string,
    version: number,
    language: string,
  ): Promise<HostTermsOutcome> {
    const state = await this.hostTerms(proof, orgId, language);
    if (state === 'AUTH_REQUIRED' || state === 'FORBIDDEN') return state;
    if (!LANGS.includes(language)) return 'REQUEST_INVALID';
    if (state.document === null) return 'LEGAL_DOCUMENT_UNAVAILABLE';
    if (state.document.version !== version) return 'TERMS_VERSION_CHANGED';
    const userId = this.#user(proof) as string;
    this.rows.push({
      userId,
      kind: 'TOS_HOST',
      version,
      accepted: true,
      context: this.#last(userId, 'TOS_HOST', true) === undefined ? 'HOST_ONBOARDING' : 'REACCEPT',
      at: new Date(),
    });
    return 'DONE';
  }

  async history(proof: Buffer): Promise<ConsentHistoryRow[]> {
    const userId = this.#user(proof);
    if (userId === undefined) return [];
    return this.rows
      .filter((r) => r.userId === userId)
      .reverse()
      .map((r) => ({
        kind: r.kind,
        version: r.version,
        locale: 'es',
        accepted: r.accepted,
        acceptedAt: r.at,
        context: r.context,
      }));
  }
}
