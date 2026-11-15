/**
 * Adaptateur PRC du port `SearchPricer` de CAT (US-203 ; 16 SRC-042, PRC-025 ; ADR-131) : le total
 * TTC affiché par la recherche est un **devis provisoire** du moteur `prc.quote/2` (US-202,
 * US-704), le même que la fiche et le checkout : prix journalier × jours facturables, trip fee du
 * barème du pays, taxe par ligne, total. Rien n'est persisté (16 SRC-042 « devis PROVISIONAL »).
 *
 * Entrées : l'annonce (prix, devise), la période et l'instant du devis lus en base
 * (`platform.now()`, contrainte 5) ; aucune option facultative. La protection minimale `BASICA`
 * de SRC-042 n'est pas encore une ligne du devis : tant que la part de l'assureur n'est pas figée
 * (contrat non signé, US-226), toute protection rend le devis `QUOTE_UNAVAILABLE` (fail-closed,
 * 08 E7). US-226 l'ajoute ici et au checkout ensemble.
 *
 * Devis impossible (paramètre du pays manquant ou invalide, devise de l'annonce différente de
 * celle du pays, durée) : `null`, l'annonce est exclue et l'ops alertée (16 SRC-008). Toute autre
 * erreur remonte : la recherche répond 503.
 */
import { money } from '@rueda/money';
import type { SearchPrice, SearchPriceInput, SearchPricer } from '../../../cat/index.js';
import { computeQuote, type QuoteParams } from './engine.js';
import { isQuoteError } from './errors.js';
import type { QuoteParamsContext } from './params.js';

/** Instantané des paramètres d'un pays à un instant (CFG) ; `QuoteError` si absent. */
export type QuoteParamsOf = (ctx: QuoteParamsContext) => QuoteParams;

const MINOR = /^(0|[1-9][0-9]{0,18})$/;

function instantMs(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isSafeInteger(ms)) throw new Error('instant illisible');
  return ms;
}

export function searchQuotePricer(paramsOf: QuoteParamsOf): SearchPricer {
  return {
    price(input: SearchPriceInput): SearchPrice | null {
      if (!MINOR.test(input.dailyPriceMinor)) throw new Error('prix journalier illisible');
      const quotedAtMs = instantMs(input.quotedAt);
      const startAtMs = instantMs(input.startAt);
      const endAtMs = instantMs(input.endAt);
      try {
        const params = paramsOf({ country: input.country, at: new Date(quotedAtMs) });
        // annonce dans une autre devise que celle du pays : aucun devis (jamais de conversion)
        if (params.currency.code !== input.currency) return null;
        const quote = computeQuote(
          {
            startAtMs,
            endAtMs,
            quotedAtMs,
            // le type de tarif ne change pas le total (seulement l'annulation, US-208)
            rateType: 'REFUNDABLE',
            dailyRate: money(BigInt(input.dailyPriceMinor), params.currency),
          },
          params,
        );
        return { totalMinor: quote.total.amountMinor.toString(), billableDays: quote.billableDays };
      } catch (error) {
        if (isQuoteError(error)) return null;
        throw error;
      }
    },
  };
}
