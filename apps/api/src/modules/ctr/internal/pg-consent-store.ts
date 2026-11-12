/**
 * Adaptateur PostgreSQL du port `ConsentStore` (production) : appelle les seules fonctions
 * `core.ctr_*` des migrations 0059 et 0070 (`SECURITY DEFINER`, `EXECUTE` au seul `app_api`). Requêtes
 * paramétrées uniquement. Une erreur de la base est remplacée par une erreur sans message du
 * serveur ni paramètre (SQLSTATE seulement) ; les refus métier deviennent `ConsentDocumentsError`.
 */
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
} from './consent-store.js';
import { ConsentDocumentsError } from './consent-store.js';

/** Sous-ensemble de `pg.Pool` utilisé ici. */
export interface CtrSqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

export class ConsentStoreError extends Error {
  override readonly name = 'ConsentStoreError';
  readonly sqlstate: string | undefined;

  constructor(operation: string, sqlstate: string | undefined) {
    super(`CTR : échec de la base (${operation}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
  }
}

const REASONS: Readonly<Record<string, ConsentDocumentsError['reason']>> = {
  ctr_document_version_current: 'VERSION_CHANGED',
  ctr_document_unavailable: 'UNAVAILABLE',
  ctr_document_request_invalid: 'INVALID',
};

interface DocumentRow extends Record<string, unknown> {
  doc_kind: string;
  version: number;
  is_major: boolean;
  locale: string;
  title: string;
  content_hash: Buffer;
  is_draft: boolean;
  valid_from: Date;
}

const summary = (r: DocumentRow): LegalDocumentSummary => ({
  kind: r.doc_kind as LegalDocumentKind,
  version: r.version,
  isMajor: r.is_major,
  locale: r.locale,
  title: r.title,
  contentHash: Buffer.from(r.content_hash).toString('hex'),
  draft: r.is_draft,
  validFrom: r.valid_from,
});

export class PgConsentStore implements ConsentStore {
  readonly #db: CtrSqlExecutor;

  constructor(db: CtrSqlExecutor) {
    this.#db = db;
  }

  async #run<R extends Record<string, unknown>>(
    operation: string,
    text: string,
    values: readonly unknown[],
  ): Promise<R[]> {
    try {
      return (await this.#db.query<R>(text, values)).rows;
    } catch (error) {
      const { code, constraint } = error as { code?: unknown; constraint?: unknown };
      const reason =
        code === '23514' && typeof constraint === 'string' ? REASONS[constraint] : undefined;
      if (reason !== undefined) throw new ConsentDocumentsError(reason);
      throw new ConsentStoreError(operation, typeof code === 'string' ? code : undefined);
    }
  }

  async publishedDocuments(
    country: string | null,
    language: string,
  ): Promise<LegalDocumentSummary[]> {
    const rows = await this.#run<DocumentRow>(
      'published_documents',
      `SELECT doc_kind, version, is_major, locale, title, content_hash, is_draft, valid_from
         FROM core.ctr_published_documents($1, $2)`,
      [country, language],
    );
    return rows.map(summary);
  }

  async documentBody(
    kind: LegalDocumentKind,
    country: string | null,
    language: string,
    version: number | null,
  ): Promise<LegalDocument | null> {
    const rows = await this.#run<DocumentRow & { body_md: string }>(
      'document_body',
      `SELECT doc_kind, version, is_major, locale, title, body_md, content_hash, is_draft,
              valid_from
         FROM core.ctr_document_body($1, $2, $3, $4)`,
      [kind, country, language, version],
    );
    const row = rows[0];
    return row === undefined ? null : { ...summary(row), bodyMd: row.body_md };
  }

  async status(proof: Buffer): Promise<ConsentStatusRow[] | null> {
    const rows = await this.#run<{
      doc_kind: string;
      required: boolean;
      current_version: number | null;
      required_version: number | null;
      accepted_version: number | null;
      accepted: boolean;
      reaccept_required: boolean;
    }>(
      'consent_status',
      `SELECT doc_kind, required, current_version, required_version, accepted_version, accepted,
              reaccept_required
         FROM core.ctr_consent_status($1)`,
      [proof],
    );
    if (rows.length === 0) return null;
    return rows.map((r) => ({
      kind: r.doc_kind as LegalDocumentKind,
      required: r.required,
      currentVersion: r.current_version,
      requiredVersion: r.required_version,
      acceptedVersion: r.accepted_version,
      accepted: r.accepted,
      reacceptRequired: r.reaccept_required,
    }));
  }

  async accept(proof: Buffer, documents: readonly DocumentVersion[]): Promise<number | null> {
    const rows = await this.#run<{ n: number }>(
      'accept_documents',
      'SELECT core.ctr_cmd_accept_documents($1, $2::jsonb) AS n',
      [proof, JSON.stringify(documents)],
    );
    const n = rows[0]?.n ?? -1;
    return n < 0 ? null : n;
  }

  async setMarketing(proof: Buffer, optIn: boolean): Promise<'CHANGED' | 'UNCHANGED' | null> {
    const rows = await this.#run<{ outcome: string }>(
      'set_marketing',
      'SELECT core.ctr_cmd_set_marketing($1, $2) AS outcome',
      [proof, optIn],
    );
    const outcome = rows[0]?.outcome;
    return outcome === 'CHANGED' || outcome === 'UNCHANGED' ? outcome : null;
  }

  async history(proof: Buffer): Promise<ConsentHistoryRow[]> {
    const rows = await this.#run<{
      doc_kind: string;
      doc_version: number;
      locale: string;
      accepted: boolean;
      accepted_at: Date;
      context: string;
    }>(
      'consent_history',
      `SELECT doc_kind, doc_version, locale, accepted, accepted_at, context
         FROM core.ctr_consent_history($1)`,
      [proof],
    );
    return rows.map((r) => ({
      kind: r.doc_kind,
      version: r.doc_version,
      locale: r.locale,
      accepted: r.accepted,
      acceptedAt: r.accepted_at,
      context: r.context,
    }));
  }

  async hostTerms(
    proof: Buffer,
    orgId: string,
    language: string,
  ): Promise<HostTermsState | 'AUTH_REQUIRED' | 'FORBIDDEN'> {
    const rows = await this.#run<{
      outcome: string;
      country_code: string | null;
      version: number | null;
      is_major: boolean | null;
      locale: string | null;
      title: string | null;
      content_hash: Buffer | null;
      is_draft: boolean | null;
      valid_from: Date | null;
      required_version: number | null;
      accepted_version: number | null;
      accepted_at: Date | null;
      reaccept_required: boolean | null;
    }>(
      'host_terms',
      `SELECT outcome, country_code, version, is_major, locale, title, content_hash, is_draft,
              valid_from, required_version, accepted_version, accepted_at, reaccept_required
         FROM core.ctr_host_terms($1, $2::uuid, $3)`,
      [proof, orgId, language],
    );
    const r = rows[0];
    if (r === undefined || r.outcome === 'AUTH_REQUIRED') return 'AUTH_REQUIRED';
    if (r.outcome === 'FORBIDDEN' || r.country_code === null) return 'FORBIDDEN';
    const document =
      r.outcome === 'OK' &&
      r.version !== null &&
      r.is_major !== null &&
      r.locale !== null &&
      r.title !== null &&
      r.content_hash !== null &&
      r.is_draft !== null &&
      r.valid_from !== null
        ? summary({
            doc_kind: 'TOS_HOST',
            version: r.version,
            is_major: r.is_major,
            locale: r.locale,
            title: r.title,
            content_hash: r.content_hash,
            is_draft: r.is_draft,
            valid_from: r.valid_from,
          })
        : null;
    return {
      country: r.country_code,
      document,
      requiredVersion: r.required_version,
      acceptedVersion: r.accepted_version,
      acceptedAt: r.accepted_at,
      // fail-closed : une valeur absente vaut « à accepter »
      reacceptRequired: document === null || r.reaccept_required !== false,
    };
  }

  async acceptHostTerms(
    proof: Buffer,
    orgId: string,
    version: number,
    language: string,
  ): Promise<HostTermsOutcome> {
    const rows = await this.#run<{ outcome: string }>(
      'accept_host_terms',
      'SELECT outcome FROM core.ctr_cmd_accept_host_terms($1, $2::uuid, $3, $4)',
      [proof, orgId, version, language],
    );
    const outcome = rows[0]?.outcome;
    if (outcome === undefined || !HOST_TERMS_OUTCOMES.has(outcome)) {
      throw new ConsentStoreError('accept_host_terms', undefined);
    }
    return outcome as HostTermsOutcome;
  }
}

const HOST_TERMS_OUTCOMES: ReadonlySet<string> = new Set<HostTermsOutcome>([
  'DONE',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'REQUEST_INVALID',
  'LEGAL_DOCUMENT_UNAVAILABLE',
  'TERMS_VERSION_CHANGED',
]);

/**
 * Contrôle de démarrage (L0-05 appliqué à la production) : la connexion tourne sous `app_api`.
 * IAM le vérifie déjà au démarrage (`postgresIamAdapters`) sur le même pool ; CTR le répète pour
 * qu'aucun montage ne lui donne une autre connexion.
 */
export async function postgresCtrAdapters(db: CtrSqlExecutor): Promise<{ store: ConsentStore }> {
  const { rows } = await db.query<{ current_user: string }>('SELECT current_user');
  if (rows[0]?.current_user !== 'app_api') {
    throw new Error('CTR : la connexion de l’API doit être app_api');
  }
  return { store: new PgConsentStore(db) };
}
