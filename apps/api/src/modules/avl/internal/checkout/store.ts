/**
 * Magasin du checkout (US-208, ADR-133) : lectures et commande de la migration 0108 sous app_api
 * (fonctions SECURITY DEFINER de cmd_hold_owner ; voyageur désigné par l'empreinte de son jeton de
 * session), paramètres liés, aucun SQL construit. Annonce publiée et instant du devis lus en base
 * (`core.catalog_public_listing`, `platform.now()`). Sans adaptateur : 503 partout (fail-closed).
 * US-226 (migration 0111) : plan de gains du véhicule (`core.catalog_listing_earnings_plan`),
 * niveau de protection, âge déclaré, instant du gel et interrupteur de l'assureur du devis.
 */
import type { CheckoutDemand } from './model.js';

export interface SqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

/** Annonce publiée (colonnes C0) et instant serveur du devis. */
export interface CheckoutListing {
  readonly country: string;
  readonly currency: string;
  /** Prix journalier en unités mineures (texte d'un entier). */
  readonly dailyPriceMinor: string;
  /** `platform.now()` (ms) : instant du devis et des paramètres. */
  readonly quotedAtMs: number;
  /** Plan de gains choisi pour le véhicule (US-226) ; `null` : plan par défaut du pays. */
  readonly hostPlan: string | null;
}

/** Niveau de protection proposé au checkout (S05, 16 BKG-003), prix de la période (US-226). */
export interface CheckoutProtectionOption {
  readonly level: string;
  readonly eligible: boolean;
  /** Raison d'un niveau grisé (16 PRT-001 : « grisé avec la raison »). */
  readonly reason: 'DRIVER_AGE' | null;
  readonly minDriverAge: number | null;
  readonly dailyMinor: string;
  readonly lineMinor: string;
  readonly selected: boolean;
}

export interface CheckoutLine {
  readonly type: string;
  readonly amountMinor: string;
  readonly taxMinor: string;
}

export interface CheckoutDocument {
  readonly kind: string;
  readonly version: number;
  readonly locale: string;
  readonly title: string;
}

/** Devis figé du voyageur, tel que la base l'a rejoué (16 BKG-006). */
export interface CheckoutQuote {
  readonly quoteId: string;
  readonly listingId: string;
  readonly country: string;
  readonly currency: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly billableDays: number;
  readonly lines: readonly CheckoutLine[];
  readonly totalMinor: string;
  readonly expiresAt: string | null;
  readonly expired: boolean;
  readonly manualTransmission: boolean;
  readonly instantBook: boolean;
  /** Documents à accepter (CGU, politique d'annulation, texte géographique), versions en vigueur. */
  readonly documents: readonly CheckoutDocument[];
  /** Niveau de protection figé (US-226) ; `null` : devis sans protection, jamais réservable. */
  readonly protectionLevel: string | null;
  /** Âge déclaré du conducteur figé dans le devis, `null` s'il n'a pas été saisi. */
  readonly driverAge: number | null;
  /** `insurer_contract_active` du pays : `false` ⇒ `INSURER_CONTRACT_INACTIVE` (16 PRT-001). */
  readonly insurerContractActive: boolean;
  /** Niveaux vendus et leur prix pour la période (calculés par l'API, devis provisoires). */
  readonly protectionOptions: readonly CheckoutProtectionOption[];
}

/** Lecture de la base, avant les options de protection (ajoutées par le service). */
export type CheckoutQuoteRow = Omit<CheckoutQuote, 'protectionOptions'> & {
  /** Instant du gel (ms) : instant des paramètres des options, celui du devis. */
  readonly frozenAtMs: number;
};

export interface CheckoutHold {
  readonly holdId: string;
  readonly status: string;
  readonly expiresAt: string;
  readonly quoteId: string;
  readonly listingId: string;
  readonly currency: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly totalMinor: string;
  readonly manualConfirmed: boolean;
  /** Version exacte de chaque document accepté (16 BKG-008). */
  readonly documents: readonly {
    readonly kind: string;
    readonly version: number;
    readonly locale: string;
  }[];
}

/** Issues de `core.booking_cmd_checkout` (0108). */
export const CHECKOUT_OUTCOMES = [
  'DONE',
  'AUTH_REQUIRED',
  'QUOTE_NOT_FOUND',
  'QUOTE_ALREADY_USED',
  'QUOTE_EXPIRED',
  'QUOTE_LINE_NOT_SUPPORTED',
  // US-226 (0111) : devis sans protection, pays sans contrat d'assureur actif
  'PROTECTION_LEVEL_REQUIRED',
  'INSURER_CONTRACT_INACTIVE',
  'LISTING_UNAVAILABLE',
  'REQUEST_MODE_UNAVAILABLE',
  'MANUAL_TRANSMISSION_NOT_CONFIRMED',
  'DRIVER_MUST_BE_ACCOUNT_HOLDER',
  'TERMS_NOT_ACCEPTED',
  'TERMS_VERSION_CHANGED',
  'TERMS_UNAVAILABLE',
  'DATES_UNAVAILABLE',
  'DATES_NOTICE_TOO_SHORT',
  'GUEST_OVERLAP',
  'HOLD_ALREADY_LIVE',
  'HOLD_LIMIT_REACHED',
  'HOLD_RATE_LIMITED',
  'SELF_BOOKING_FORBIDDEN',
  'ACCOUNT_RESTRICTED',
  'KYC_CONSENT_WITHDRAWN',
  'BOOKING_UNAVAILABLE',
] as const;
export type CheckoutOutcome = (typeof CHECKOUT_OUTCOMES)[number];

export interface CheckoutResult {
  readonly outcome: CheckoutOutcome;
  readonly holdId: string | null;
  readonly expiresAt: string | null;
}

export interface CheckoutStore {
  /** Annonce LISTED et instant serveur ; `null` : inconnue ou non publiée. */
  listing(listingId: string): Promise<CheckoutListing | null>;
  /** Devis figé du voyageur ; `null` : inconnu ou d'un autre voyageur. */
  quote(proof: Buffer, quoteId: string): Promise<CheckoutQuoteRow | null>;
  /** Contrôles, consentements et pose du hold, en une transaction (base). */
  checkout(proof: Buffer, quoteId: string, demand: CheckoutDemand): Promise<CheckoutResult>;
  /** Hold de checkout du voyageur ; `null` : inconnu ou d'un autre voyageur. */
  hold(proof: Buffer, holdId: string): Promise<CheckoutHold | null>;
}

export class CheckoutStoreError extends Error {
  override readonly name = 'CheckoutStoreError';
}

/** Aucun adaptateur : refus (503). */
export class UnavailableCheckoutStore implements CheckoutStore {
  #fail = (): Promise<never> =>
    Promise.reject(new CheckoutStoreError('magasin du checkout indisponible'));
  listing = (): Promise<CheckoutListing | null> => this.#fail();
  quote = (): Promise<CheckoutQuoteRow | null> => this.#fail();
  checkout = (): Promise<CheckoutResult> => this.#fail();
  hold = (): Promise<CheckoutHold | null> => this.#fail();
}

const iso = (value: unknown): string => {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new CheckoutStoreError('instant illisible');
  return d.toISOString();
};
const isoOrNull = (value: unknown): string | null => (value === null ? null : iso(value));
const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new CheckoutStoreError('colonne inattendue');
  return value;
};
const minor = (value: unknown): string => {
  const s = typeof value === 'bigint' || typeof value === 'number' ? String(value) : text(value);
  if (!/^(0|-?[1-9][0-9]{0,18})$/.test(s)) throw new CheckoutStoreError('montant illisible');
  return s;
};
const bool = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new CheckoutStoreError('colonne inattendue');
  return value;
};
const int = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new CheckoutStoreError('entier illisible');
  return n;
};
const textOrNull = (value: unknown): string | null => (value === null ? null : text(value));
const intOrNull = (value: unknown): number | null => (value === null ? null : int(value));
const list = (value: unknown): readonly Record<string, unknown>[] => {
  if (value === null) return [];
  if (!Array.isArray(value)) throw new CheckoutStoreError('liste inattendue');
  return value as Record<string, unknown>[];
};

const OUTCOMES: ReadonlySet<string> = new Set(CHECKOUT_OUTCOMES);

/** Fonctions de 0108 (et fiche publique de 0067), sous app_api. */
export class PgCheckoutStore implements CheckoutStore {
  constructor(private readonly db: SqlExecutor) {}

  async listing(listingId: string): Promise<CheckoutListing | null> {
    const { rows } = await this.db.query(
      `SELECT p.country_code, p.currency, p.daily_price_minor::text AS daily_price_minor,
              platform.now() AS quoted_at,
              core.catalog_listing_earnings_plan(p.listing_id) AS host_plan
         FROM core.catalog_public_listing($1::uuid) AS p`,
      [listingId],
    );
    const r = rows[0];
    if (r === undefined) return null;
    return {
      country: text(r['country_code']),
      currency: text(r['currency']),
      dailyPriceMinor: minor(r['daily_price_minor']),
      quotedAtMs: Date.parse(iso(r['quoted_at'])),
      hostPlan: textOrNull(r['host_plan']),
    };
  }

  async quote(proof: Buffer, quoteId: string): Promise<CheckoutQuoteRow | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM core.booking_checkout_quote($1, $2::uuid)',
      [proof, quoteId],
    );
    const r = rows[0];
    if (r === undefined) return null;
    return {
      quoteId: text(r['quote_id']),
      listingId: text(r['listing_id']),
      country: text(r['country_code']),
      currency: text(r['currency']),
      startAt: iso(r['start_at']),
      endAt: iso(r['end_at']),
      billableDays: int(r['billable_days']),
      lines: list(r['lines']).map((l) => ({
        type: text(l['type']),
        amountMinor: minor(l['amountMinor']),
        taxMinor: minor(l['taxMinor']),
      })),
      totalMinor: minor(r['total_minor']),
      expiresAt: isoOrNull(r['expires_at']),
      expired: bool(r['expired']),
      manualTransmission: bool(r['manual_transmission']),
      instantBook: bool(r['instant_book']),
      documents: list(r['documents']).map((d) => ({
        kind: text(d['kind']),
        version: int(d['version']),
        locale: text(d['locale']),
        title: text(d['title']),
      })),
      protectionLevel: textOrNull(r['protection_level']),
      driverAge: intOrNull(r['driver_age']),
      insurerContractActive: bool(r['insurer_contract_active']),
      frozenAtMs: Date.parse(iso(r['frozen_at'])),
    };
  }

  async checkout(proof: Buffer, quoteId: string, d: CheckoutDemand): Promise<CheckoutResult> {
    const { rows } = await this.db.query(
      'SELECT * FROM core.booking_cmd_checkout($1, $2::uuid, $3, $4, $5, $6::jsonb)',
      [
        proof,
        quoteId,
        d.driverFirstName,
        d.driverLastName,
        d.manualTransmissionConfirmed,
        JSON.stringify(d.acceptedDocuments),
      ],
    );
    const r = rows[0];
    const outcome = r === undefined ? '' : String(r['outcome']);
    // issue inconnue (version N de la base pendant un déploiement) : indisponible, fail-closed
    if (r === undefined || !OUTCOMES.has(outcome)) {
      throw new CheckoutStoreError(`issue inattendue de booking_cmd_checkout : ${outcome}`);
    }
    if (outcome === 'DONE') {
      return { outcome: 'DONE', holdId: text(r['hold_id']), expiresAt: iso(r['expires_at']) };
    }
    return { outcome: outcome as CheckoutOutcome, holdId: null, expiresAt: null };
  }

  async hold(proof: Buffer, holdId: string): Promise<CheckoutHold | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM core.booking_checkout_summary($1, $2::uuid)',
      [proof, holdId],
    );
    const r = rows[0];
    if (r === undefined) return null;
    return {
      holdId: text(r['hold_id']),
      status: text(r['status']),
      expiresAt: iso(r['expires_at']),
      quoteId: text(r['quote_id']),
      listingId: text(r['listing_id']),
      currency: text(r['currency']),
      startAt: iso(r['start_at']),
      endAt: iso(r['end_at']),
      totalMinor: minor(r['total_minor']),
      manualConfirmed: r['manual_confirmed_at'] !== null,
      documents: list(r['documents']).map((x) => ({
        kind: text(x['kind']),
        version: int(x['version']),
        locale: text(x['locale']),
      })),
    };
  }
}
