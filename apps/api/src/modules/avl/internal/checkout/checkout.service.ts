/**
 * Checkout en une page, partie back-end (US-208 ; 16 BKG-001 / BKG-006, BKG-002 / BKG-025,
 * BKG-008 / BKG-023, PRC-025 ; ADR-133).
 *
 * 1. Devis : l'API calcule le devis avec le moteur `prc.quote/3` de PRC (même instantané de
 *    configuration que la recherche et la fiche : `paramsOf` câblé par `main.ts` sur l'instance
 *    `QuoteService`), le fige (`freezeQuote`), puis la base le REJOUE avec sa configuration avant
 *    de l'écrire (`core.pricing_cmd_freeze_quote`, écart ⇒ `QUOTE_MISMATCH`). La réponse est lue
 *    dans la base : lignes, total et validité rejoués, jamais ceux de l'API ni du client.
 * 2. Checkout : la base juge tout dans une transaction (`core.booking_cmd_checkout`) : devis valide
 *    et rejoué, annonce immédiate, boîte manuelle, conducteur titulaire, documents acceptés, pose du
 *    hold CHECKOUT. Aucun paiement (US-223).
 *
 * 3. Protection du voyageur (US-226, ADR-136 ; 16 BKG-003, PRT-001, PRT-002, PRT-011) : le niveau
 *    choisi (absent : minimum du pays, présélectionné) et l'âge déclaré entrent dans le devis ;
 *    la ligne `PROTECTION` et la prime de l'assureur sont calculées par le moteur puis rejouées
 *    par la base ; le devis lu rend les niveaux vendus et leur prix pour la période (options
 *    calculées avec l'instantané du gel, jamais engagées : un autre niveau = un nouveau devis).
 *    Le plan de gains du véhicule (lu en base) fixe la part de l'hôte figée au devis.
 *
 * 4. Conditions (US-205b, ADR-140 ; 19 US-205 critères 1 et 2 ; 08 BR-CXL-01, BR-CXL-06) : la
 *    distance de l'annonce entre dans le devis figé (rejouée par la base) ; le devis lu rend la
 *    distance figée, l'annulation gratuite si la réservation a lieu maintenant (base) et la retenue
 *    d'une annulation hors fenêtre, calculée par le moteur de règlement unique sur le devis figé
 *    REJOUÉ (`replayFrozenQuote`, `lateCancellationOf`) : jamais une durée ni un montant écrits.
 *
 * Points d'extension : mode `REQUEST` (US-223, aujourd'hui `REQUEST_MODE_UNAVAILABLE`) ; contrôles
 * bloquants et revue (US-209, aujourd'hui aucune règle : hold non signalé).
 */
import { money, type SettlementParams } from '@rueda/money';
import {
  freezeQuote,
  isQuoteError,
  lateCancellationOf,
  penaltyDaysLabel,
  protectionOptions,
  QuoteHttpError,
  replayFrozenQuote,
  type QuoteErrorCode,
  type QuoteHttpCode,
  type QuoteParamsOf,
  type QuoteStore,
} from '../../../prc/index.js';
import { CheckoutHttpError, isCheckoutCode } from './errors.js';
import { isUuid, parseCheckoutDemand, parseQuoteDemand } from './model.js';
import type {
  CheckoutHold,
  CheckoutLateCancellation,
  CheckoutProtectionOption,
  CheckoutQuote,
  CheckoutQuoteRow,
  CheckoutStore,
} from './store.js';

/**
 * Journal d'exploitation d'une panne du magasin ou de la base (revue de code de 208a, n° 6) :
 * opération, nom de l'erreur et SQLSTATE seulement. Jamais le message (il peut citer une valeur),
 * ni jeton, ni identifiant de personne, ni montant.
 */
export type CheckoutFailureLog = (operation: CheckoutOperation, error: unknown) => void;
export type CheckoutOperation =
  'listing' | 'freeze' | 'quote' | 'options' | 'cancellation' | 'checkout' | 'hold';

/**
 * Paramètres d'annulation du pays à un instant (PRC, CFG : `free_cancel_lead`,
 * `last_minute_threshold`, `no_show_grace_minutes`) ; lève si absents.
 */
export type CancellationParamsOf = (ctx: {
  readonly country: string;
  readonly at: Date;
}) => SettlementParams;

/** Aucun paramètre d'annulation fourni : aucune retenue affichée (jamais un montant deviné). */
export const UNAVAILABLE_CANCELLATION_PARAMS: CancellationParamsOf = () => {
  throw new Error('paramètres d’annulation indisponibles');
};

const SQLSTATE = /^[0-9A-Z]{5}$/;

/** Champs sûrs d'une erreur : nom de classe (borné) et SQLSTATE, rien d'autre. */
export function failureFields(error: unknown): { errorName: string; sqlState: string | null } {
  const name =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)
      ? error.name
      : 'unknown';
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return {
    errorName: name,
    sqlState: typeof code === 'string' && SQLSTATE.test(code) ? code : null,
  };
}

export const LOG_CHECKOUT_FAILURE: CheckoutFailureLog = (operation, error) => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'checkout.store_failed',
      operation,
      ...failureFields(error),
    }),
  );
};

/** Code HTTP d'un refus du moteur de devis (16 A.8) ; tout autre refus : prix impossible. */
function quoteCodeOf(code: QuoteErrorCode): QuoteHttpCode {
  switch (code) {
    case 'QUOTE_INPUT_INVALID':
    case 'PROTECTION_LEVEL_REQUIRED':
    case 'PROTECTION_LEVEL_NOT_ELIGIBLE':
      return code;
    default:
      return 'QUOTE_UNAVAILABLE';
  }
}

export class CheckoutService {
  constructor(
    private readonly paramsOf: QuoteParamsOf,
    private readonly quotes: QuoteStore,
    private readonly store: CheckoutStore,
    private readonly logFailure: CheckoutFailureLog = LOG_CHECKOUT_FAILURE,
    private readonly cancellationParamsOf: CancellationParamsOf = UNAVAILABLE_CANCELLATION_PARAMS,
  ) {}

  /** Devis figé du voyageur de la session pour une annonce et une période. */
  async createQuote(proof: Buffer, body: unknown): Promise<CheckoutQuote> {
    const demand = parseQuoteDemand(body);
    if (demand === null) throw new QuoteHttpError('QUOTE_INPUT_INVALID');
    // 16 PRT-011 : aucune protection demandée ⇒ refus, jamais un trip sans protection
    if (demand.protectionLevel === null) throw new QuoteHttpError('PROTECTION_LEVEL_REQUIRED');
    const listing = await this.#safe('listing', () => this.store.listing(demand.listingId));
    if (listing === null) throw new QuoteHttpError('LISTING_NOT_FOUND');
    let frozen;
    try {
      const params = this.paramsOf({
        country: listing.country,
        at: new Date(listing.quotedAtMs),
        hostPlan: listing.hostPlan,
      });
      // annonce dans une autre devise que celle du pays : aucun devis (jamais de conversion)
      if (params.currency.code !== listing.currency) throw new QuoteHttpError('QUOTE_UNAVAILABLE');
      // 16 BKG-003 : niveau absent ⇒ minimum du pays, présélectionné
      const level = demand.protectionLevel ?? params.protectionGrid?.minLevel;
      frozen = freezeQuote(
        {
          startAtMs: demand.startAtMs,
          endAtMs: demand.endAtMs,
          quotedAtMs: listing.quotedAtMs,
          // le type de tarif ne change pas le total (seulement l'annulation, BR-PRICE-11)
          rateType: 'REFUNDABLE',
          dailyRate: money(BigInt(listing.dailyPriceMinor), params.currency),
          ...(level === undefined ? {} : { protectionLevel: level }),
          ...(demand.driverAge === undefined ? {} : { driverAge: demand.driverAge }),
          // US-205b : distance de l'annonce lue en base, figée et rejouée avec le devis
          mileage:
            listing.mileageMode === 'INCLUDED' &&
            listing.includedKmPerDay !== null &&
            listing.extraKmPriceMinor !== null
              ? {
                  mode: 'INCLUDED',
                  kmPerDay: listing.includedKmPerDay,
                  extraKmPrice: money(BigInt(listing.extraKmPriceMinor), params.currency),
                }
              : { mode: 'UNLIMITED' },
        },
        params,
      ).frozen;
    } catch (error) {
      if (error instanceof QuoteHttpError) throw error;
      if (isQuoteError(error)) throw new QuoteHttpError(quoteCodeOf(error.code));
      // configuration illisible : indisponible, jamais un prix inventé
      throw new CheckoutHttpError('BOOKING_UNAVAILABLE');
    }
    const r = await this.#safe('freeze', () => this.quotes.freeze(proof, demand.listingId, frozen));
    if (r.outcome !== 'DONE') throw new QuoteHttpError(r.outcome);
    // DONE sans identifiant : réponse incohérente de la base, jamais un devis (revue de code n° 4)
    if (r.quoteId === null) throw new CheckoutHttpError('BOOKING_UNAVAILABLE');
    const quoteId = r.quoteId;
    const view = await this.#safe('quote', () => this.store.quote(proof, quoteId));
    if (view === null) throw new CheckoutHttpError('BOOKING_UNAVAILABLE');
    return this.#withOptions(view);
  }

  /** Devis figé du voyageur de la session ; inconnu ou d'un autre ⇒ 404 (même réponse). */
  async quote(proof: Buffer, quoteId: string): Promise<CheckoutQuote> {
    if (!isUuid(quoteId)) throw new QuoteHttpError('QUOTE_NOT_FOUND');
    const view = await this.#safe('quote', () => this.store.quote(proof, quoteId.toLowerCase()));
    if (view === null) throw new QuoteHttpError('QUOTE_NOT_FOUND');
    return this.#withOptions(view);
  }

  /**
   * Niveaux vendus et leur prix pour la période du devis (16 BKG-003 ; PRT-001 : niveau refusé à
   * l'âge déclaré grisé avec sa raison), avec l'instantané du pays à l'instant du gel. Prix
   * journalier net = ligne `TRIP_PRICE` / jours facturables (prix journalier × jours, exact).
   * Aucune option si le devis n'a pas de protection ou si la configuration ne le permet plus.
   */
  #withOptions(row: CheckoutQuoteRow): CheckoutQuote {
    const { frozenAtMs, frozen, ...view } = row;
    const lateCancellation = this.#lateCancellation(frozen, view.country, frozenAtMs);
    let options: readonly CheckoutProtectionOption[] = [];
    const trip = view.lines.find((l) => l.type === 'TRIP_PRICE');
    if (view.protectionLevel !== null && trip !== undefined && view.billableDays >= 1) {
      try {
        const params = this.paramsOf({ country: view.country, at: new Date(frozenAtMs) });
        const total = BigInt(trip.amountMinor);
        const days = BigInt(view.billableDays);
        if (params.currency.code === view.currency && total % days === 0n) {
          options = protectionOptions(
            params,
            money(total / days, params.currency),
            view.billableDays,
            view.driverAge ?? undefined,
          ).map((o) => ({
            level: o.level,
            eligible: o.eligible,
            reason: o.reason,
            minDriverAge: o.minDriverAge,
            dailyMinor: o.daily.amountMinor.toString(),
            lineMinor: o.line.amountMinor.toString(),
            selected: o.level === view.protectionLevel,
          }));
        }
      } catch (error) {
        // configuration du pays devenue illisible : journalisée (sans donnée personnelle) ; une
        // QuoteError laisse le devis lisible, sans autre niveau ; toute autre erreur : 503
        this.logFailure('options', error);
        if (!isQuoteError(error)) throw new CheckoutHttpError('BOOKING_UNAVAILABLE');
      }
    }
    return { ...view, protectionOptions: options, lateCancellation };
  }

  /**
   * Retenue d'une annulation volontaire hors fenêtre gratuite (08 BR-CXL-06 ; 10b UX-54) : devis
   * figé REJOUÉ depuis ses documents canoniques, puis moteur de règlement unique avec les
   * paramètres d'annulation du pays à l'instant du gel. Devis antérieur, rejeu ou paramètres
   * impossibles ⇒ `null` (journalisé) : S05 renvoie alors à la politique publiée, jamais un
   * montant deviné. La retenue ne dépend pas de l'instant de réservation (j = 1 ou 1/2).
   */
  #lateCancellation(
    frozen: CheckoutQuoteRow['frozen'],
    country: string,
    frozenAtMs: number,
  ): CheckoutLateCancellation | null {
    if (frozen === null) return null;
    try {
      const quote = replayFrozenQuote(frozen);
      const params = this.cancellationParamsOf({ country, at: new Date(frozenAtMs) });
      const late = lateCancellationOf(quote, params, Math.min(frozenAtMs, quote.startAtMs));
      if (late === null) return null;
      const penaltyDays = penaltyDaysLabel(late.penaltyDays);
      if (penaltyDays === null) return null;
      return { penaltyDays, retainedMinor: late.retained.amountMinor.toString() };
    } catch (error) {
      this.logFailure('cancellation', error);
      return null;
    }
  }

  /** Checkout du devis : hold CHECKOUT posé, ou refus avec son code. */
  async checkout(proof: Buffer, quoteId: string, body: unknown): Promise<CheckoutHold> {
    if (!isUuid(quoteId)) throw new QuoteHttpError('QUOTE_NOT_FOUND');
    const demand = parseCheckoutDemand(body);
    if (demand === null) throw new CheckoutHttpError('REQUEST_INVALID');
    const r = await this.#safe('checkout', () =>
      this.store.checkout(proof, quoteId.toLowerCase(), demand),
    );
    if (r.outcome === 'AUTH_REQUIRED' || r.outcome === 'QUOTE_NOT_FOUND') {
      throw new QuoteHttpError(r.outcome);
    }
    if (r.outcome !== 'DONE' || r.holdId === null) {
      throw new CheckoutHttpError(isCheckoutCode(r.outcome) ? r.outcome : 'BOOKING_UNAVAILABLE');
    }
    const holdId = r.holdId;
    const hold = await this.#safe('hold', () => this.store.hold(proof, holdId));
    if (hold === null) throw new CheckoutHttpError('BOOKING_UNAVAILABLE');
    return hold;
  }

  /** Hold de checkout du voyageur de la session ; inconnu ou d'un autre ⇒ 404 (même réponse). */
  async hold(proof: Buffer, holdId: string): Promise<CheckoutHold> {
    if (!isUuid(holdId)) throw new CheckoutHttpError('HOLD_NOT_FOUND');
    const hold = await this.#safe('hold', () => this.store.hold(proof, holdId.toLowerCase()));
    if (hold === null) throw new CheckoutHttpError('HOLD_NOT_FOUND');
    return hold;
  }

  /**
   * Base ou magasin en panne ⇒ 503, jamais un succès ni un détail technique ; la panne est
   * journalisée pour l'exploitation (sans donnée personnelle : `failureFields`).
   */
  async #safe<T>(operation: CheckoutOperation, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logFailure(operation, error);
      throw new CheckoutHttpError('BOOKING_UNAVAILABLE');
    }
  }
}
