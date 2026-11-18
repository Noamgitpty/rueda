/**
 * Magasin du checkout (US-208, ADR-133) : lectures et commande de la migration 0108 sous app_api
 * (fonctions SECURITY DEFINER de cmd_hold_owner ; voyageur désigné par l'empreinte de son jeton de
 * session), paramètres liés, aucun SQL construit. Annonce publiée et instant du devis lus en base
 * (`core.catalog_public_listing`, `platform.now()`). Sans adaptateur : 503 partout (fail-closed).
 * US-226 (migration 0110) : plan de gains du véhicule (`core.catalog_listing_earnings_plan`),
 * niveau de protection, âge déclaré, instant du gel et interrupteur de l'assureur du devis.
 */
import { FROZEN_QUOTE_FORMAT, type FrozenQuote } from '../../../prc/index.js';
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
  /** Distance de l'annonce (US-205b), figée avec le devis et rejouée par la base. */
  readonly mileageMode: 'UNLIMITED' | 'INCLUDED';
  readonly includedKmPerDay: number | null;
  /** Prix du km supplémentaire (texte d'un entier, unités mineures) ; `null` si illimité. */
  readonly extraKmPriceMinor: string | null;
}

/**
 * Annulation gratuite si la réservation est faite maintenant (US-205b ; 08 BR-CXL-01, calculée par
 * la base à `platform.now()` pour le départ du devis) : date limite, fenêtre de dernière minute.
 */
export interface CheckoutCancellation {
  readonly lastMinute: boolean;
  readonly freeUntil: string;
  readonly lastMinuteWindowMinutes: number;
  /** Dernière minute et départ dans moins que la fenêtre : gratuite jusqu'au départ seulement. */
  readonly endsAtStart: boolean;
}

/**
 * Retenue d'une annulation volontaire hors fenêtre gratuite (US-205b ; 08 BR-CXL-06 ; 10b UX-54),
 * calculée par le moteur de règlement sur le devis figé rejoué : jours de location retenus (« 1 »
 * ou « 1/2 ») et montant TTC.
 */
export interface CheckoutLateCancellation {
  readonly penaltyDays: '1' | '1/2';
  readonly retainedMinor: string;
}

/** Distance figée dans le devis (US-205b ; 16 LST-012), lue en base. */
export interface CheckoutMileage {
  readonly mode: 'UNLIMITED' | 'INCLUDED';
  readonly includedKm: number | null;
  readonly extraKmPriceMinor: string | null;
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
  /**
   * Hôte de l'annonce en prénom et initiale (US-212 critère 3, N-346 ; 0146) ; `null` : titulaire
   * pseudonymisé ou sans prénom, l'écran ne nomme personne.
   */
  readonly hostName: string | null;
  /** Niveaux vendus et leur prix pour la période (calculés par l'API, devis provisoires). */
  readonly protectionOptions: readonly CheckoutProtectionOption[];
  /** Distance figée (US-205b) ; `null` : devis figé avant US-205b, aucune distance promise. */
  readonly mileage: CheckoutMileage | null;
  /** Annulation gratuite si la réservation a lieu maintenant ; `null` : aucune promesse. */
  readonly cancellation: CheckoutCancellation | null;
  /** Retenue hors fenêtre gratuite (moteur de règlement) ; `null` : non calculable. */
  readonly lateCancellation: CheckoutLateCancellation | null;
}

/** Lecture de la base, avant les options de protection et la retenue (ajoutées par le service). */
export type CheckoutQuoteRow = Omit<CheckoutQuote, 'protectionOptions' | 'lateCancellation'> & {
  /** Instant du gel (ms) : instant des paramètres des options, celui du devis. */
  readonly frozenAtMs: number;
  /** Documents canoniques du devis figé (US-205b) : rejoués par l'API pour la retenue. */
  readonly frozen: FrozenQuote | null;
};

/** États de revue d'un hold de checkout rendus par la base (0120). */
export const CHECKOUT_REVIEW_STATES = ['NONE', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type CheckoutReviewState = (typeof CHECKOUT_REVIEW_STATES)[number];
const REVIEW_STATES: ReadonlySet<string> = new Set(CHECKOUT_REVIEW_STATES);

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
  /**
   * État de revue du hold (US-209 partie 209c, ADR-144 ; `core.booking_checkout_review_state`) :
   * `PENDING` = revue avant le débit en cours (aucun paiement possible, `BOOKING_UNDER_REVIEW`) ;
   * `APPROVED` = revu, payable jusqu'à `expiresAt` ; `REJECTED` = libéré par la revue ; `NONE`.
   */
  readonly reviewState: CheckoutReviewState;
  /** Version exacte de chaque document accepté (16 BKG-008). */
  readonly documents: readonly {
    readonly kind: string;
    readonly version: number;
    readonly locale: string;
  }[];
}

/** Issues de `core.booking_cmd_checkout` (0108, contrôles du conducteur : 0112). */
export const CHECKOUT_OUTCOMES = [
  'DONE',
  'AUTH_REQUIRED',
  'QUOTE_NOT_FOUND',
  'QUOTE_ALREADY_USED',
  'QUOTE_EXPIRED',
  'QUOTE_LINE_NOT_SUPPORTED',
  // US-226 (0110) : devis sans protection, pays sans contrat d'assureur actif
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
  // US-209 (0112, ADR-135) : contrôles bloquants du conducteur (16 BKG-012)
  'KYC_NOT_APPROVED',
  'KYC_BIOMETRIC_CONSENT_MISSING',
  'KYC_LICENSE_EXPIRED',
  'AGE_CLASS_MISMATCH',
  'BOOKING_UNAVAILABLE',
] as const;
export type CheckoutOutcome = (typeof CHECKOUT_OUTCOMES)[number];

export interface CheckoutResult {
  readonly outcome: CheckoutOutcome;
  readonly holdId: string | null;
  readonly expiresAt: string | null;
}

/** Issues de `core.booking_checkout_return_place` (0144, US-514). */
export const RETURN_PLACE_OUTCOMES = [
  'DONE',
  'AUTH_REQUIRED',
  'QUOTE_NOT_FOUND',
  'ONE_WAY_NOT_ALLOWED',
] as const;
export type ReturnPlaceOutcome = (typeof RETURN_PLACE_OUTCOMES)[number];
const RETURN_PLACE = new Set<string>(RETURN_PLACE_OUTCOMES);

export interface CheckoutStore {
  /** Annonce LISTED et instant serveur ; `null` : inconnue ou non publiée. */
  listing(listingId: string): Promise<CheckoutListing | null>;
  /** Devis figé du voyageur ; `null` : inconnu ou d'un autre voyageur. */
  quote(proof: Buffer, quoteId: string): Promise<CheckoutQuoteRow | null>;
  /**
   * Lieu de retour demandé pour le devis du voyageur (US-514) : `DONE` s'il est le lieu de prise,
   * `ONE_WAY_NOT_ALLOWED` sinon ; lecture seule.
   */
  returnPlace(
    proof: Buffer,
    quoteId: string,
    returnLocationId: string,
  ): Promise<ReturnPlaceOutcome>;
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
  returnPlace = (): Promise<ReturnPlaceOutcome> => this.#fail();
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

const mileageMode = (value: unknown): 'UNLIMITED' | 'INCLUDED' => {
  if (value !== 'UNLIMITED' && value !== 'INCLUDED') {
    throw new CheckoutStoreError('distance illisible');
  }
  return value;
};

/** Distance figée du devis (0118) ; `null` : devis antérieur, aucune distance promise. */
function mileageOf(r: Record<string, unknown>): CheckoutMileage | null {
  const mode = r['quote_mileage_mode'];
  if (mode === null || mode === undefined) return null;
  const m = mileageMode(mode);
  if (m === 'UNLIMITED') return { mode: m, includedKm: null, extraKmPriceMinor: null };
  const km = intOrNull(r['quote_included_km']);
  const extra = r['quote_extra_km_price_minor'];
  if (km === null || km < 1 || extra === null || extra === undefined) {
    throw new CheckoutStoreError('distance illisible');
  }
  return { mode: m, includedKm: km, extraKmPriceMinor: minor(extra) };
}

/** Annulation gratuite pour le départ du devis (BR-CXL-01, base) ; `null` : aucune promesse. */
function cancellationOf(r: Record<string, unknown>, startAt: string): CheckoutCancellation | null {
  const last = r['cancel_last_minute'];
  const until = r['cancel_free_until'];
  const win = r['cancel_window_minutes'];
  if (typeof last !== 'boolean' || until === null || until === undefined) return null;
  if (win === null || win === undefined) return null;
  const freeUntil = iso(until);
  return {
    lastMinute: last,
    freeUntil,
    lastMinuteWindowMinutes: int(win),
    endsAtStart: last && Date.parse(freeUntil) >= Date.parse(startAt),
  };
}

/** Fonctions de 0108 (et fiche publique de 0067), sous app_api. */
export class PgCheckoutStore implements CheckoutStore {
  constructor(private readonly db: SqlExecutor) {}

  async listing(listingId: string): Promise<CheckoutListing | null> {
    const { rows } = await this.db.query(
      `SELECT p.country_code, p.currency, p.daily_price_minor::text AS daily_price_minor,
              platform.now() AS quoted_at,
              core.catalog_listing_earnings_plan(p.listing_id) AS host_plan,
              p.mileage_mode, p.included_km_per_day,
              p.extra_km_price_minor::text AS extra_km_price_minor
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
      mileageMode: mileageMode(r['mileage_mode']),
      includedKmPerDay: intOrNull(r['included_km_per_day']),
      extraKmPriceMinor:
        r['extra_km_price_minor'] === null ? null : minor(r['extra_km_price_minor']),
    };
  }

  async quote(proof: Buffer, quoteId: string): Promise<CheckoutQuoteRow | null> {
    // US-226 : protection du devis (niveau, âge déclaré, instant du gel, interrupteur de
    // l'assureur) lue par sa propre fonction de 0110 ; un devis inconnu ou d'un autre voyageur
    // ne rend aucune ligne dans l'une comme dans l'autre (même réponse)
    // US-205b : documents canoniques et distance figée (core.pricing_checkout_terms, 0118) ;
    // annulation gratuite pour le départ du devis si la réservation a lieu maintenant
    // (core.catalog_public_terms) ; même requête
    // US-212b (N-346, 0146) : hôte en prénom et initiale (core.booking_checkout_host_name), même
    // garde du voyageur de la session
    const { rows } = await this.db.query(
      `SELECT q.*, p.protection_level, p.driver_age, p.frozen_at, p.insurer_contract_active,
              m.engine_version AS frozen_engine_version, m.inputs AS frozen_inputs,
              m.inputs_hash AS frozen_inputs_hash, m.outputs AS frozen_outputs,
              m.outputs_hash AS frozen_outputs_hash, m.mileage_mode AS quote_mileage_mode,
              m.included_km AS quote_included_km,
              m.extra_km_price_minor::text AS quote_extra_km_price_minor,
              t.last_minute AS cancel_last_minute, t.free_until AS cancel_free_until,
              t.last_minute_window_minutes AS cancel_window_minutes,
              hn.host_name AS checkout_host_name
         FROM core.booking_checkout_quote($1, $2::uuid) AS q
         JOIN core.booking_checkout_protection($1, $2::uuid) AS p ON p.quote_id = q.quote_id
         LEFT JOIN core.pricing_checkout_terms($1, $2::uuid) AS m ON m.quote_id = q.quote_id
         LEFT JOIN LATERAL core.catalog_public_terms(q.listing_id, q.start_at) AS t ON true
         LEFT JOIN core.booking_checkout_host_name($1, $2::uuid) AS hn ON hn.quote_id = q.quote_id`,
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
      hostName: textOrNull(r['checkout_host_name']),
      frozenAtMs: Date.parse(iso(r['frozen_at'])),
      frozen:
        r['frozen_inputs'] === null || r['frozen_inputs'] === undefined
          ? null
          : {
              format: FROZEN_QUOTE_FORMAT,
              engineVersion: text(r['frozen_engine_version']),
              inputs: text(r['frozen_inputs']),
              inputsHash: text(r['frozen_inputs_hash']),
              outputs: text(r['frozen_outputs']),
              outputsHash: text(r['frozen_outputs_hash']),
              totalMinor: minor(r['total_minor']),
              currency: text(r['currency']),
            },
      mileage: mileageOf(r),
      cancellation: cancellationOf(r, iso(r['start_at'])),
    };
  }

  async returnPlace(
    proof: Buffer,
    quoteId: string,
    returnLocationId: string,
  ): Promise<ReturnPlaceOutcome> {
    const { rows } = await this.db.query(
      'SELECT outcome FROM core.booking_checkout_return_place($1, $2::uuid, $3::uuid)',
      [proof, quoteId, returnLocationId],
    );
    const outcome = rows[0] === undefined ? '' : String(rows[0]['outcome']);
    // issue inconnue (version N de la base pendant un déploiement) : indisponible, fail-closed
    if (!RETURN_PLACE.has(outcome)) {
      throw new CheckoutStoreError(
        `issue inattendue de booking_checkout_return_place : ${outcome}`,
      );
    }
    return outcome as ReturnPlaceOutcome;
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
      // état de revue (0120, US-209c) lu dans la même instruction : même voyageur, même hold
      `SELECT s.*, r.review_state
         FROM core.booking_checkout_summary($1, $2::uuid) AS s
         LEFT JOIN core.booking_checkout_review_state($1, $2::uuid) AS r ON r.hold_id = s.hold_id`,
      [proof, holdId],
    );
    const r = rows[0];
    if (r === undefined) return null;
    const review = typeof r['review_state'] === 'string' ? r['review_state'] : '';
    // état de revue absent ou inconnu (version N de la base pendant un déploiement) : indisponible,
    // jamais un hold présenté comme payable (fail-closed, N-203)
    if (!REVIEW_STATES.has(review)) {
      throw new CheckoutStoreError(`état de revue inattendu du hold : ${review}`);
    }
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
      reviewState: review as CheckoutReviewState,
      documents: list(r['documents']).map((x) => ({
        kind: text(x['kind']),
        version: int(x['version']),
        locale: text(x['locale']),
      })),
    };
  }
}
