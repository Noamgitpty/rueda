/**
 * Magasin des devis figés (commandes de la migration 0100) et textes du devis (US-202). Le
 * comportement des commandes est prouvé sous les rôles de production par
 * `packages/db/test/l0/l0-us202-quote.test.ts` ; ici, l'adaptateur seul (paramètres, issues).
 */
import { CATALOGS, CATALOG_LANGUAGES } from '@rueda/i18n';
import { describe, expect, it } from 'vitest';
import type { FrozenQuote } from './frozen.js';
import { QUOTE_MESSAGES } from './http-errors.js';
import { PgQuoteStore, QuoteStoreUnavailableError, UnavailableQuoteStore } from './ports.js';

const FROZEN: FrozenQuote = {
  format: 'prc.quote.frozen/1',
  engineVersion: 'prc.quote/2',
  inputs: '{"request":{}}',
  inputsHash: 'a'.repeat(64),
  outputs: '{"total":"1"}',
  outputsHash: 'b'.repeat(64),
  totalMinor: '1',
  currency: 'XXX',
};

function fake(rows: Record<string, unknown>[]) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  return {
    calls,
    db: {
      query: <R extends Record<string, unknown>>(text: string, values: readonly unknown[] = []) => {
        calls.push({ text, values });
        return Promise.resolve({ rows: rows as R[] });
      },
    },
  };
}

describe('PgQuoteStore', () => {
  it('freeze : commande pricing_cmd_freeze_quote avec les documents canoniques et leurs empreintes', async () => {
    const f = fake([{ outcome: 'DONE', quote_id: 'q1' }]);
    const hash = Buffer.alloc(32, 1);
    expect(await new PgQuoteStore(f.db).freeze(hash, 'l1', FROZEN)).toEqual({
      outcome: 'DONE',
      quoteId: 'q1',
    });
    expect(f.calls[0]?.text).toContain('core.pricing_cmd_freeze_quote');
    expect(f.calls[0]?.values).toEqual([
      hash,
      'l1',
      FROZEN.inputs,
      FROZEN.inputsHash,
      FROZEN.outputs,
      FROZEN.outputsHash,
    ]);
  });

  it('versionTripPrice : commande pricing_cmd_version_trip_price', async () => {
    const f = fake([{ outcome: 'DONE', version: 2 }]);
    expect(await new PgQuoteStore(f.db).versionTripPrice(Buffer.alloc(32), 't1', 'q1')).toEqual({
      outcome: 'DONE',
      version: 2,
    });
    expect(f.calls[0]?.text).toContain('core.pricing_cmd_version_trip_price');
  });

  it('issue inconnue ou absente ⇒ erreur (fail-closed), jamais un succès', async () => {
    await expect(
      new PgQuoteStore(fake([{ outcome: 'OK', quote_id: 'q' }]).db).freeze(
        Buffer.alloc(1),
        'l',
        FROZEN,
      ),
    ).rejects.toBeInstanceOf(QuoteStoreUnavailableError);
    await expect(
      new PgQuoteStore(fake([]).db).versionTripPrice(Buffer.alloc(1), 't', 'q'),
    ).rejects.toBeInstanceOf(QuoteStoreUnavailableError);
    await expect(new UnavailableQuoteStore().freeze()).rejects.toBeInstanceOf(
      QuoteStoreUnavailableError,
    );
  });
});

describe('textes du devis (catalogue @rueda/i18n, quatre langues)', () => {
  it('chaque clé de QUOTE_MESSAGES existe et n’est pas vide en es, en, fr et pt', () => {
    expect(CATALOG_LANGUAGES.length).toBe(4);
    for (const { messageKey } of Object.values(QUOTE_MESSAGES)) {
      for (const lang of CATALOG_LANGUAGES) {
        const text = (CATALOGS[lang].messages as Record<string, unknown>)[messageKey];
        expect(typeof text === 'string' && text.length > 0, `${lang} ${messageKey}`).toBe(true);
      }
    }
  });
});
