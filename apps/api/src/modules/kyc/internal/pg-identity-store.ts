/**
 * Adaptateur PostgreSQL du port `IdentityStore` (production) : appelle les seules fonctions
 * `core.kyc_*` de la migration 0071 (`SECURITY DEFINER`, `EXECUTE` au seul `app_api`). Requêtes
 * paramétrées uniquement. Une erreur de la base est remplacée par une erreur sans message du
 * serveur ni paramètre (SQLSTATE seulement) ; une issue inconnue de la base est une erreur
 * (fail-closed : jamais un succès supposé).
 */
import type { IdentityDecisionEvent } from './identity-provider.port.js';
import {
  CONSENT_OUTCOMES,
  DECISION_OUTCOMES,
  ELIGIBILITY_OUTCOMES,
  IdentityStoreError,
  KYC_STATUSES,
  OPEN_OUTCOMES,
  RECORD_OUTCOMES,
} from './identity-store.js';
import type {
  ConsentOutcome,
  DecisionResult,
  EligibilityOutcome,
  IdentityState,
  IdentityStore,
  KycStatus,
  OpenResult,
  RecordOutcome,
  SessionToRecord,
  WebhookRejectionReason,
} from './identity-store.js';

/** Sous-ensemble de `pg.Pool` utilisé ici. */
export interface KycSqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

function member<T extends string>(list: readonly T[], value: unknown, operation: string): T {
  if (typeof value === 'string' && (list as readonly string[]).includes(value)) return value as T;
  throw new IdentityStoreError(`${operation}: issue inconnue`, undefined);
}

const day = (d: unknown): string | null => {
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    // date sans fuseau rendue par pg en heure locale du processus : composantes locales
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};

interface StateRow extends Record<string, unknown> {
  outcome: string;
  status: string | null;
  country_code: string | null;
  reason_code: string | null;
  license_expires_on: Date | string | null;
  session_live: boolean | null;
  phone_verified: boolean | null;
  consent_version: number | null;
  consent_accepted_version: number | null;
  consent_locale: string | null;
  consent_title: string | null;
  consent_body: string | null;
}

export class PgIdentityStore implements IdentityStore {
  readonly #db: KycSqlExecutor;

  constructor(db: KycSqlExecutor) {
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
      const { code } = error as { code?: unknown };
      throw new IdentityStoreError(operation, typeof code === 'string' ? code : undefined);
    }
  }

  async state(tokenHash: Buffer, country: string | null): Promise<IdentityState | null> {
    const [r] = await this.#run<StateRow>(
      'state',
      'SELECT * FROM core.kyc_identity_state($1, $2)',
      [tokenHash, country],
    );
    if (r === undefined) throw new IdentityStoreError('state: aucune ligne', undefined);
    if (r.outcome === 'AUTH_REQUIRED') return null;
    if (r.outcome !== 'OK') throw new IdentityStoreError('state: issue inconnue', undefined);
    const consent =
      r.consent_version !== null &&
      r.consent_locale !== null &&
      r.consent_title !== null &&
      r.consent_body !== null
        ? {
            version: r.consent_version,
            acceptedVersion: r.consent_accepted_version,
            locale: r.consent_locale,
            title: r.consent_title,
            bodyMd: r.consent_body,
          }
        : null;
    return {
      status: member<KycStatus>(KYC_STATUSES, r.status, 'state'),
      country: r.country_code,
      reasonCode: r.reason_code,
      licenseExpiresOn: day(r.license_expires_on),
      sessionLive: r.session_live === true,
      phoneVerified: r.phone_verified === true,
      consent,
    };
  }

  async consent(
    tokenHash: Buffer,
    country: string | null,
    version: number | null,
    accepted: boolean,
  ): Promise<{ readonly outcome: ConsentOutcome; readonly version: number | null }> {
    const [r] = await this.#run<{ outcome: string; version: number | null }>(
      'consent',
      'SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)',
      [tokenHash, country, version, accepted],
    );
    return {
      outcome: member<ConsentOutcome>(CONSENT_OUTCOMES, r?.outcome, 'consent'),
      version: r?.version ?? null,
    };
  }

  async open(tokenHash: Buffer, country: string, provider: string): Promise<OpenResult> {
    const [r] = await this.#run<{
      outcome: string;
      verification_id: string | null;
      attempt: number | null;
      hosted_url: string | null;
      session_expires_at: Date | null;
    }>('open', 'SELECT * FROM core.kyc_cmd_open_verification($1, $2, $3)', [
      tokenHash,
      country,
      provider,
    ]);
    return {
      outcome: member(OPEN_OUTCOMES, r?.outcome, 'open'),
      verificationId: r?.verification_id ?? null,
      attempt: r?.attempt ?? null,
      hostedUrl: r?.hosted_url ?? null,
      sessionExpiresAt: r?.session_expires_at ?? null,
    };
  }

  async recordSession(tokenHash: Buffer, s: SessionToRecord): Promise<RecordOutcome> {
    const [r] = await this.#run<{ outcome: string }>(
      'record_session',
      'SELECT * FROM core.kyc_cmd_record_session($1, $2, $3, $4, $5, $6, $7)',
      [tokenHash, s.verificationId, s.attempt, s.provider, s.sessionRef, s.hostedUrl, s.expiresAt],
    );
    return member(RECORD_OUTCOMES, r?.outcome, 'record_session');
  }

  async applyDecision(provider: string, event: IdentityDecisionEvent): Promise<DecisionResult> {
    const d = event.checks.document;
    const [r] = await this.#run<{ outcome: string; status: string | null }>(
      'apply_decision',
      'SELECT * FROM core.kyc_cmd_apply_decision($1, $2, $3, $4, $5, $6, $7, $8::jsonb)',
      [
        provider,
        event.eventId,
        event.sessionId,
        event.subjectRef,
        event.decision,
        event.checks.livenessScore,
        event.checks.faceMatchScore,
        // champs minimaux seulement : aucune image ni numéro (le port n'en transporte pas)
        d === null
          ? null
          : JSON.stringify({
              kind: d.kind,
              country: d.country,
              expiresOn: d.expiresOn,
              licenseClass: d.licenseClass,
              isPermanent: d.isPermanent,
              providerDocumentRef: d.providerDocumentRef,
            }),
      ],
    );
    return {
      outcome: member(DECISION_OUTCOMES, r?.outcome, 'apply_decision'),
      status:
        r?.status === null || r?.status === undefined
          ? null
          : member(KYC_STATUSES, r.status, 'apply_decision'),
    };
  }

  async recordRejection(
    provider: string,
    reason: WebhookRejectionReason,
    bodySha256: Buffer,
    bodyLength: number,
  ): Promise<void> {
    await this.#run(
      'record_rejection',
      'SELECT core.kyc_cmd_record_webhook_rejection($1, $2, $3, $4)',
      [provider, reason, bodySha256, bodyLength],
    );
  }

  async eligibility(
    tokenHash: Buffer,
    tripEnd: Date,
    tripCountry: string,
  ): Promise<EligibilityOutcome> {
    const [r] = await this.#run<{ outcome: string }>(
      'eligibility',
      'SELECT * FROM core.kyc_driver_eligibility($1, $2, $3)',
      [tokenHash, tripEnd, tripCountry],
    );
    return member(ELIGIBILITY_OUTCOMES, r?.outcome, 'eligibility');
  }
}
