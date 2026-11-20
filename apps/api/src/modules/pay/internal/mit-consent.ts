/**
 * Consentement MIT du voyageur (US-703, ADR-189 ; 16 PAY-015 « consentement explicite au
 * checkout », PAY-037 « consentement écrit au check-in » ; 10b UX-30 `web.s05.mitConsent`) :
 * port et adaptateur PostgreSQL sous `app_api` (commandes de 0169, voyageur désigné par sa
 * session). La base juge tout (hold du voyageur, hold payable, remise ouverte) ; ici, on ne lit que
 * l'issue. Le texte accepté est identifié par sa clé et la version du catalogue servie
 * (`CATALOG_VERSION`), dans la langue d'affichage.
 */
import { CATALOG_VERSION } from '@rueda/i18n';
import type { SqlExecutor } from './pg-stores.js';

export const MIT_CONSENT_OUTCOMES = [
  'ACCEPTED',
  'ALREADY_ACCEPTED',
  'NOT_FOUND',
  'HOLD_NOT_PAYABLE',
  'REQUEST_INVALID',
] as const;
export type MitConsentOutcome = (typeof MIT_CONSENT_OUTCOMES)[number];

export const MIT_REMINDER_OUTCOMES = [
  'ACKNOWLEDGED',
  'ALREADY_ACKNOWLEDGED',
  'NOT_FOUND',
  'NO_CONSENT',
  'CHECKIN_NOT_OPEN',
  'REQUEST_INVALID',
] as const;
export type MitReminderOutcome = (typeof MIT_REMINDER_OUTCOMES)[number];

/** Version du catalogue dont le texte du consentement est servi (es / en / fr / pt-BR). */
export const MIT_CONSENT_CATALOG_VERSION: number = CATALOG_VERSION;

/** Langue d'affichage admise par la base (`es`, `pt-BR`…) ; sinon `null`. */
export function mitConsentLocaleOf(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(value) ? value : null;
}

export interface MitConsentPort {
  /** Consentement au checkout (S05), une fois par hold. */
  accept(proof: Buffer, holdId: string, locale: string): Promise<MitConsentOutcome>;
  /** Rappel lu et confirmé par le voyageur à la remise (S09). */
  acknowledgeReminder(proof: Buffer, tripId: string, locale: string): Promise<MitReminderOutcome>;
}

/** Sans base : toute écriture échoue (jamais un consentement supposé). */
export const UNAVAILABLE_MIT_CONSENTS: MitConsentPort = {
  accept: () => Promise.reject(new Error('consentement MIT indisponible')),
  acknowledgeReminder: () => Promise.reject(new Error('consentement MIT indisponible')),
};

function outcomeOf<T extends string>(list: readonly T[], v: unknown): T {
  if (typeof v === 'string' && (list as readonly string[]).includes(v)) return v as T;
  throw new Error('issue illisible du consentement MIT');
}

export class PgMitConsentStore implements MitConsentPort {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async accept(proof: Buffer, holdId: string, locale: string): Promise<MitConsentOutcome> {
    const { rows } = await this.#db.query(
      'SELECT outcome FROM core.payment_cmd_accept_mit_consent($1, $2::uuid, $3, $4)',
      [proof, holdId, locale, MIT_CONSENT_CATALOG_VERSION],
    );
    return outcomeOf(MIT_CONSENT_OUTCOMES, rows[0]?.['outcome']);
  }

  async acknowledgeReminder(
    proof: Buffer,
    tripId: string,
    locale: string,
  ): Promise<MitReminderOutcome> {
    const { rows } = await this.#db.query(
      'SELECT outcome FROM core.payment_cmd_ack_mit_reminder($1, $2::uuid, $3, $4)',
      [proof, tripId, locale, MIT_CONSENT_CATALOG_VERSION],
    );
    return outcomeOf(MIT_REMINDER_OUTCOMES, rows[0]?.['outcome']);
  }
}
