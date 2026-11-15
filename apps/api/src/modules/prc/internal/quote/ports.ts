/**
 * Ports du devis (US-202) : annonce publiée lue chez CAT, devis figé écrit par la commande de la
 * base `core.pricing_cmd_freeze_quote` (migration 0100), rattachement au trip par
 * `core.pricing_cmd_version_trip_price`. Adaptateurs de production sous `app_api` ; sans
 * adaptateur, tout appel échoue (503, fail-closed).
 */
import type { FrozenQuote } from './frozen.js';

/** Champs de l'annonce publiée utiles au devis (fiche publique, colonnes C0). */
export interface QuoteListing {
  readonly id: string;
  readonly country: string;
  readonly currency: string;
  /** Prix journalier en unités mineures (texte d'un entier). */
  readonly dailyPriceMinor: string;
}

export interface QuoteListingSource {
  /** Annonce LISTED, sinon `null` (inconnue, brouillon, retirée : même réponse). */
  publicListing(listingId: string): Promise<QuoteListing | null>;
}

export type FreezeOutcome =
  | 'DONE'
  | 'AUTH_REQUIRED'
  | 'LISTING_NOT_FOUND'
  | 'QUOTE_UNAVAILABLE'
  | 'TAX_CONFIG_MISSING'
  | 'LEG_AMOUNT_NEGATIVE'
  | 'QUOTE_MISMATCH';

export type VersionOutcome =
  'DONE' | 'AUTH_REQUIRED' | 'QUOTE_NOT_FOUND' | 'TRIP_NOT_FOUND' | 'QUOTE_MISMATCH';

export interface QuoteStore {
  /** Fige le devis du voyageur de la session (la base le rejoue avec sa configuration). */
  freeze(
    tokenHash: Buffer,
    listingId: string,
    frozen: FrozenQuote,
  ): Promise<{ readonly outcome: FreezeOutcome; readonly quoteId: string | null }>;
  /** Rattache un devis figé du voyageur à son trip (version suivante). */
  versionTripPrice(
    tokenHash: Buffer,
    tripId: string,
    quoteId: string,
  ): Promise<{ readonly outcome: VersionOutcome; readonly version: number | null }>;
}

export class QuoteStoreUnavailableError extends Error {
  override readonly name = 'QuoteStoreUnavailableError';
}

/** Aucun adaptateur : refus (503). */
export class UnavailableQuoteListingSource implements QuoteListingSource {
  publicListing(): Promise<QuoteListing | null> {
    return Promise.reject(new QuoteStoreUnavailableError('annonces indisponibles'));
  }
}

export class UnavailableQuoteStore implements QuoteStore {
  freeze(): Promise<never> {
    return Promise.reject(new QuoteStoreUnavailableError('devis figés indisponibles'));
  }

  versionTripPrice(): Promise<never> {
    return Promise.reject(new QuoteStoreUnavailableError('devis figés indisponibles'));
  }
}

export interface SqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

const FREEZE_OUTCOMES: readonly string[] = [
  'DONE',
  'AUTH_REQUIRED',
  'LISTING_NOT_FOUND',
  'QUOTE_UNAVAILABLE',
  'TAX_CONFIG_MISSING',
  'LEG_AMOUNT_NEGATIVE',
  'QUOTE_MISMATCH',
];
const VERSION_OUTCOMES: readonly string[] = [
  'DONE',
  'AUTH_REQUIRED',
  'QUOTE_NOT_FOUND',
  'TRIP_NOT_FOUND',
  'QUOTE_MISMATCH',
];

/** Commandes de la migration 0100, sous app_api. */
export class PgQuoteStore implements QuoteStore {
  constructor(private readonly db: SqlExecutor) {}

  async freeze(tokenHash: Buffer, listingId: string, frozen: FrozenQuote) {
    const { rows } = await this.db.query<{ outcome: string; quote_id: string | null }>(
      'SELECT * FROM core.pricing_cmd_freeze_quote($1, $2, $3, $4, $5, $6)',
      [tokenHash, listingId, frozen.inputs, frozen.inputsHash, frozen.outputs, frozen.outputsHash],
    );
    const r = rows[0];
    if (r === undefined || !FREEZE_OUTCOMES.includes(r.outcome)) {
      throw new QuoteStoreUnavailableError('issue inattendue de pricing_cmd_freeze_quote');
    }
    return { outcome: r.outcome as FreezeOutcome, quoteId: r.quote_id };
  }

  async versionTripPrice(tokenHash: Buffer, tripId: string, quoteId: string) {
    const { rows } = await this.db.query<{ outcome: string; version: number | null }>(
      'SELECT * FROM core.pricing_cmd_version_trip_price($1, $2, $3)',
      [tokenHash, tripId, quoteId],
    );
    const r = rows[0];
    if (r === undefined || !VERSION_OUTCOMES.includes(r.outcome)) {
      throw new QuoteStoreUnavailableError('issue inattendue de pricing_cmd_version_trip_price');
    }
    return { outcome: r.outcome as VersionOutcome, version: r.version };
  }
}
