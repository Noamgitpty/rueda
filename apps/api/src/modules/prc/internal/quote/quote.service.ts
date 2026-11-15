import { Inject, Injectable } from '@nestjs/common';
import { CountryConfigService } from '../../../cfg/index.js';
import { computeQuote, type Quote, type QuoteParams, type QuoteRequest } from './engine.js';
import { freezeQuote, type FrozenQuote } from './frozen.js';
import { resolveQuoteParams, type QuoteParamsContext } from './params.js';

/**
 * Point d'entrée du devis pour les autres modules (US-203 recherche, US-208 checkout, US-226
 * protections) : instantané des paramètres du pays (CFG) puis moteur pur. Ne lit aucune horloge :
 * l'appelant passe l'instant serveur (`platform.now()`) dans `request.quotedAtMs` et `ctx.at`.
 */
@Injectable()
export class QuoteService {
  constructor(@Inject(CountryConfigService) private readonly countryConfig: CountryConfigService) {}

  /** Instantané des paramètres du pays (CFG) à l'instant donné. */
  params(ctx: QuoteParamsContext): QuoteParams {
    return resolveQuoteParams(this.countryConfig.config, ctx);
  }

  /** Devis avec un instantané déjà résolu. */
  quoteWith(request: QuoteRequest, params: QuoteParams): Quote {
    return computeQuote(request, params);
  }

  /** Devis provisoire (affichage : recherche, fiche, checkout). */
  quote(request: QuoteRequest, ctx: QuoteParamsContext): Quote {
    return computeQuote(request, resolveQuoteParams(this.countryConfig.config, ctx));
  }

  /** Devis figé (réservation, modification) : entrées, instantané et sorties, rejouable. */
  freeze(
    request: QuoteRequest,
    ctx: QuoteParamsContext,
  ): { readonly quote: Quote; readonly frozen: FrozenQuote } {
    return freezeQuote(request, resolveQuoteParams(this.countryConfig.config, ctx));
  }
}
