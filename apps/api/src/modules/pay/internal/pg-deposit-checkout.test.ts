/**
 * US-701 (ADR-169) — lecture défensive des fonctions de 0146 par `PgDepositCheckoutStore` (sans
 * base : exécutant simulé). Attendus : forme des fonctions de la migration (colonnes, issues) ; une
 * forme inattendue ⇒ erreur (503 chez l'appelant), jamais une décision devinée. Les fonctions
 * elles-mêmes sont prouvées en base (`l0-us701-deposit-hold`).
 */
import { describe, expect, it } from 'vitest';
import { isPaymentError } from './errors.js';
import { PgDepositCheckoutStore } from './pg-deposit-checkout.js';
import type { SqlExecutor } from './pg-stores.js';

const PROOF = Buffer.from('jeton');
const START = new Date('2031-07-10T10:00:00.000Z');
const END = new Date('2031-07-13T10:00:00.000Z');
const NOW = new Date('2031-07-01T10:00:00.000Z');

function db(row: Record<string, unknown> | undefined, calls: unknown[][] = []): SqlExecutor {
  return {
    query: <R extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
      calls.push([text, ...(values ?? [])]);
      return Promise.resolve({ rows: (row === undefined ? [] : [row]) as R[] });
    },
  };
}

const open = {
  outcome: 'DONE',
  country_code: 'ZZ',
  currency: 'XTS',
  value_class: 'LUXE',
  scheduled_start: START,
  scheduled_end: END,
  provider: 'FAKE',
  now: NOW,
  mechanism: null,
  amount_minor: null,
  release_at: null,
};

describe('PgDepositCheckoutStore — lecture', () => {
  it('contexte ouvert : classe du catalogue, période, fournisseur et heure de la base', async () => {
    expect(await new PgDepositCheckoutStore(db(open)).read(PROOF, 'h')).toEqual({
      kind: 'OPEN',
      context: {
        country: 'ZZ',
        currency: 'XTS',
        valueClass: 'LUXE',
        scheduledStart: START,
        scheduledEnd: END,
        provider: 'FAKE',
        now: NOW,
      },
    });
  });

  it('classe hors vocabulaire ⇒ inconnue (fail-closed) ; aucun compte marchand ⇒ fournisseur null', async () => {
    const r = await new PgDepositCheckoutStore(
      db({ ...open, value_class: 'SUPER', provider: null }),
    ).read(PROOF, 'h');
    expect(r).toMatchObject({ kind: 'OPEN', context: { valueClass: null, provider: null } });
  });

  it('décision figée : mécanisme, montant (bigint), devise, libération ; aucun autre champ', async () => {
    const r = await new PgDepositCheckoutStore(
      db({ ...open, mechanism: 'PREAUTH_SINGLE', amount_minor: '30000', release_at: END }),
    ).read(PROOF, 'h');
    expect(r).toEqual({
      kind: 'RECORDED',
      deposit: {
        mechanism: 'PREAUTH_SINGLE',
        amountMinor: 30000n,
        currency: 'XTS',
        releaseAt: END,
      },
    });
  });

  it('issues de la base rendues telles quelles ; mécanisme, montant ou issue inattendus ⇒ erreur', async () => {
    for (const outcome of ['AUTH_REQUIRED', 'HOLD_NOT_FOUND', 'QUOTE_UNAVAILABLE']) {
      expect(await new PgDepositCheckoutStore(db({ outcome })).read(PROOF, 'h')).toBe(outcome);
    }
    for (const row of [
      { ...open, mechanism: 'REFUSED', amount_minor: '0' },
      { ...open, mechanism: 'PREAUTH_SINGLE', amount_minor: '-1', release_at: END },
      { ...open, outcome: 'SURPRISE' },
      undefined,
    ]) {
      const e = await new PgDepositCheckoutStore(db(row)).read(PROOF, 'h').catch((x: unknown) => x);
      expect(isPaymentError(e, 'INVALID_REQUEST'), JSON.stringify(row)).toBe(true);
    }
  });
});

describe('PgDepositCheckoutStore — écriture', () => {
  const record = {
    mechanism: 'PREAUTH_SINGLE' as const,
    triggers: ['CLASS' as const],
    paramsSnapshot: { version: 1 },
    amountMinor: 30000n,
    provider: 'FAKE',
    hRequiredHours: 168,
    vHours: 168,
    authAt: START,
    releaseAt: END,
    decisionAt: END,
    reauthDueAt: null,
  };

  it('décision transmise en JSON (montant en texte, instants ISO) ; issue de la commande rendue', async () => {
    const calls: unknown[][] = [];
    const out = await new PgDepositCheckoutStore(db({ r: 'RECORDED' }, calls)).record(
      PROOF,
      'h',
      record,
    );
    expect(out).toBe('RECORDED');
    expect(JSON.parse(String(calls[0]?.[3]))).toMatchObject({
      mechanism: 'PREAUTH_SINGLE',
      triggers: ['CLASS'],
      amountMinor: '30000',
      authAt: START.toISOString(),
      reauthDueAt: null,
    });
  });

  it('issue inconnue ou déclencheur hors liste ⇒ erreur, rien n’est supposé écrit', async () => {
    const e1 = await new PgDepositCheckoutStore(db({ r: 'DONE' }))
      .record(PROOF, 'h', record)
      .catch((x: unknown) => x);
    expect(isPaymentError(e1, 'INVALID_REQUEST')).toBe(true);
    const calls: unknown[][] = [];
    const e2 = await new PgDepositCheckoutStore(db({ r: 'RECORDED' }, calls))
      .record(PROOF, 'h', { ...record, triggers: ['ZODIAC' as 'CLASS'] })
      .catch((x: unknown) => x);
    expect(isPaymentError(e2, 'INVALID_REQUEST')).toBe(true);
    expect(calls).toEqual([]);
  });
});
