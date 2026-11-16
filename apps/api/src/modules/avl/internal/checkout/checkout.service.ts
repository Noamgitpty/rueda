/**
 * Checkout en une page, partie back-end (US-208 ; 16 BKG-001 / BKG-006, BKG-002 / BKG-025,
 * BKG-008 / BKG-023, PRC-025 ; ADR-133).
 *
 * 1. Devis : l'API calcule le devis avec le moteur `prc.quote/2` de PRC (même instantané de
 *    configuration que la recherche et la fiche : `paramsOf` câblé par `main.ts` sur l'instance
 *    `QuoteService`), le fige (`freezeQuote`), puis la base le REJOUE avec sa configuration avant
 *    de l'écrire (`core.pricing_cmd_freeze_quote`, écart ⇒ `QUOTE_MISMATCH`). La réponse est lue
 *    dans la base : lignes, total et validité rejoués, jamais ceux de l'API ni du client.
 * 2. Checkout : la base juge tout dans une transaction (`core.booking_cmd_checkout`) : devis valide
 *    et rejoué, annonce immédiate, boîte manuelle, conducteur titulaire, documents acceptés, pose du
 *    hold CHECKOUT. Aucun paiement (US-223).
 *
 * Points d'extension : protection du voyageur (US-226, niveau dans `QuoteParamsContext` et ligne
 * `PROTECTION`) ; mode `REQUEST` (US-223, aujourd'hui `REQUEST_MODE_UNAVAILABLE`) ; contrôles
 * bloquants et revue (US-209, aujourd'hui aucune règle : hold non signalé).
 */
import { money } from '@rueda/money';
import {
  freezeQuote,
  isQuoteError,
  QuoteHttpError,
  type QuoteParamsOf,
  type QuoteStore,
} from '../../../prc/index.js';
import { CheckoutHttpError, isCheckoutCode } from './errors.js';
import { isUuid, parseCheckoutDemand, parseQuoteDemand } from './model.js';
import type { CheckoutHold, CheckoutQuote, CheckoutStore } from './store.js';

export class CheckoutService {
  constructor(
    private readonly paramsOf: QuoteParamsOf,
    private readonly quotes: QuoteStore,
    private readonly store: CheckoutStore,
  ) {}

  /** Devis figé du voyageur de la session pour une annonce et une période. */
  async createQuote(proof: Buffer, body: unknown): Promise<CheckoutQuote> {
    const demand = parseQuoteDemand(body);
    if (demand === null) throw new QuoteHttpError('QUOTE_INPUT_INVALID');
    const listing = await this.#safe(() => this.store.listing(demand.listingId));
    if (listing === null) throw new QuoteHttpError('LISTING_NOT_FOUND');
    let frozen;
    try {
      const params = this.paramsOf({ country: listing.country, at: new Date(listing.quotedAtMs) });
      // annonce dans une autre devise que celle du pays : aucun devis (jamais de conversion)
      if (params.currency.code !== listing.currency) throw new QuoteHttpError('QUOTE_UNAVAILABLE');
      frozen = freezeQuote(
        {
          startAtMs: demand.startAtMs,
          endAtMs: demand.endAtMs,
          quotedAtMs: listing.quotedAtMs,
          // le type de tarif ne change pas le total (seulement l'annulation, BR-PRICE-11)
          rateType: 'REFUNDABLE',
          dailyRate: money(BigInt(listing.dailyPriceMinor), params.currency),
        },
        params,
      ).frozen;
    } catch (error) {
      if (error instanceof QuoteHttpError) throw error;
      if (isQuoteError(error)) {
        throw new QuoteHttpError(
          error.code === 'QUOTE_INPUT_INVALID' ? 'QUOTE_INPUT_INVALID' : 'QUOTE_UNAVAILABLE',
        );
      }
      // configuration illisible : indisponible, jamais un prix inventé
      throw new CheckoutHttpError('BOOKING_UNAVAILABLE');
    }
    const r = await this.#safe(() => this.quotes.freeze(proof, demand.listingId, frozen));
    if (r.outcome !== 'DONE' || r.quoteId === null) {
      throw new QuoteHttpError(r.outcome === 'DONE' ? 'LISTING_UNAVAILABLE' : r.outcome);
    }
    const quoteId = r.quoteId;
    const view = await this.#safe(() => this.store.quote(proof, quoteId));
    if (view === null) throw new CheckoutHttpError('BOOKING_UNAVAILABLE');
    return view;
  }

  /** Devis figé du voyageur de la session ; inconnu ou d'un autre ⇒ 404 (même réponse). */
  async quote(proof: Buffer, quoteId: string): Promise<CheckoutQuote> {
    if (!isUuid(quoteId)) throw new QuoteHttpError('QUOTE_NOT_FOUND');
    const view = await this.#safe(() => this.store.quote(proof, quoteId.toLowerCase()));
    if (view === null) throw new QuoteHttpError('QUOTE_NOT_FOUND');
    return view;
  }

  /** Checkout du devis : hold CHECKOUT posé, ou refus avec son code. */
  async checkout(proof: Buffer, quoteId: string, body: unknown): Promise<CheckoutHold> {
    if (!isUuid(quoteId)) throw new QuoteHttpError('QUOTE_NOT_FOUND');
    const demand = parseCheckoutDemand(body);
    if (demand === null) throw new CheckoutHttpError('REQUEST_INVALID');
    const r = await this.#safe(() => this.store.checkout(proof, quoteId.toLowerCase(), demand));
    if (r.outcome === 'AUTH_REQUIRED' || r.outcome === 'QUOTE_NOT_FOUND') {
      throw new QuoteHttpError(r.outcome);
    }
    if (r.outcome !== 'DONE' || r.holdId === null) {
      throw new CheckoutHttpError(isCheckoutCode(r.outcome) ? r.outcome : 'BOOKING_UNAVAILABLE');
    }
    const holdId = r.holdId;
    const hold = await this.#safe(() => this.store.hold(proof, holdId));
    if (hold === null) throw new CheckoutHttpError('BOOKING_UNAVAILABLE');
    return hold;
  }

  /** Hold de checkout du voyageur de la session ; inconnu ou d'un autre ⇒ 404 (même réponse). */
  async hold(proof: Buffer, holdId: string): Promise<CheckoutHold> {
    if (!isUuid(holdId)) throw new CheckoutHttpError('HOLD_NOT_FOUND');
    const hold = await this.#safe(() => this.store.hold(proof, holdId.toLowerCase()));
    if (hold === null) throw new CheckoutHttpError('HOLD_NOT_FOUND');
    return hold;
  }

  /** Base ou magasin en panne ⇒ 503, jamais un succès ni un détail technique. */
  async #safe<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      throw new CheckoutHttpError('BOOKING_UNAVAILABLE');
    }
  }
}
