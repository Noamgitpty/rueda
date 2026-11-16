/**
 * FAKE du magasin du checkout et du magasin des devis figés (US-208) — TESTS SEULEMENT (contrat
 * HTTP). Les règles (rejeu du devis, validité, annonce immédiate, boîte manuelle, conducteur,
 * documents, pose du hold) sont prouvées en base (`packages/db/test/l0/l0-us208-checkout.test.ts`) ;
 * ces doubles rendent ce qu'on leur impose et retiennent ce que l'API leur transmet.
 */
import type { FreezeOutcome, FrozenQuote, QuoteStore } from '../../prc/index.js';
import type { CheckoutDemand } from '../internal/checkout/model.js';
import type {
  CheckoutHold,
  CheckoutListing,
  CheckoutQuote,
  CheckoutQuoteRow,
  CheckoutResult,
  CheckoutStore,
} from '../internal/checkout/store.js';

export class FakeQuoteStore implements QuoteStore {
  outcome: FreezeOutcome = 'DONE';
  quoteId = '00000000-0000-4000-8000-0000000208c1';
  down = false;
  frozen: { proof: string; listingId: string; frozen: FrozenQuote }[] = [];

  freeze(tokenHash: Buffer, listingId: string, frozen: FrozenQuote) {
    if (this.down) return Promise.reject(new Error('base indisponible (FAKE)'));
    this.frozen.push({ proof: tokenHash.toString('hex'), listingId, frozen });
    return Promise.resolve({
      outcome: this.outcome,
      quoteId: this.outcome === 'DONE' ? this.quoteId : null,
    });
  }

  versionTripPrice(): Promise<never> {
    return Promise.reject(new Error('non prévu par le contrat du checkout'));
  }
}

export class FakeCheckoutStore implements CheckoutStore {
  listings = new Map<string, CheckoutListing>();
  /**
   * Devis par empreinte de session (hex) puis identifiant, tels que l'API les rend ; la lecture
   * de la base en retire les options de protection (calculées par le service) et y ajoute
   * l'instant du gel `frozenAtMs` (US-226).
   */
  quotes = new Map<string, CheckoutQuote>();
  frozenAtMs = 0;
  /**
   * Documents canoniques rendus avec chaque devis (US-205b), par identifiant ; absents : devis
   * antérieur (aucune retenue calculable). La retenue est calculée par le service (rejeu).
   */
  frozenDocuments = new Map<string, FrozenQuote>();
  holds = new Map<string, CheckoutHold>();
  result: CheckoutResult = { outcome: 'DONE', holdId: null, expiresAt: null };
  down = false;
  demands: { proof: string; quoteId: string; demand: CheckoutDemand }[] = [];

  #fail(): Promise<never> {
    return Promise.reject(new Error('base indisponible (FAKE)'));
  }

  listing(listingId: string): Promise<CheckoutListing | null> {
    if (this.down) return this.#fail();
    return Promise.resolve(this.listings.get(listingId) ?? null);
  }

  quote(proof: Buffer, quoteId: string): Promise<CheckoutQuoteRow | null> {
    if (this.down) return this.#fail();
    const view = this.quotes.get(`${proof.toString('hex')}:${quoteId}`);
    if (view === undefined) return Promise.resolve(null);
    // options de protection : calculées par le service, jamais lues en base
    const row = Object.fromEntries(
      Object.entries(view).filter(([k]) => k !== 'protectionOptions' && k !== 'lateCancellation'),
    ) as Omit<CheckoutQuote, 'protectionOptions' | 'lateCancellation'>;
    return Promise.resolve({
      ...row,
      frozenAtMs: this.frozenAtMs,
      frozen: this.frozenDocuments.get(quoteId) ?? null,
    });
  }

  checkout(proof: Buffer, quoteId: string, demand: CheckoutDemand): Promise<CheckoutResult> {
    if (this.down) return this.#fail();
    this.demands.push({ proof: proof.toString('hex'), quoteId, demand });
    return Promise.resolve(this.result);
  }

  hold(proof: Buffer, holdId: string): Promise<CheckoutHold | null> {
    if (this.down) return this.#fail();
    return Promise.resolve(this.holds.get(`${proof.toString('hex')}:${holdId}`) ?? null);
  }
}
