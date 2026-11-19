/**
 * Panne du magasin du checkout (revue de code de 208a, n° 6 ; US-208b) : 503 `BOOKING_UNAVAILABLE`
 * comme avant, et la panne est maintenant JOURNALISÉE pour l'exploitation, sans donnée
 * personnelle : opération, nom de l'erreur et SQLSTATE seulement, jamais le message de l'erreur
 * (qui peut citer une valeur saisie), ni jeton, ni identifiant.
 */
import { describe, expect, it } from 'vitest';
import { QuoteError } from '../../../prc/index.js';
import type { QuoteStore } from '../../../prc/index.js';
import { CheckoutHttpError } from './errors.js';
import { CheckoutService, failureFields, LOG_CHECKOUT_FAILURE } from './checkout.service.js';
import type { CheckoutOperation } from './checkout.service.js';
import type { CheckoutStore } from './store.js';

const QUOTE_ID = '20800000-0000-4000-8000-0000000000aa';
const HOLD_ID = '20800000-0000-4000-8000-0000000000bb';
const PROOF = Buffer.alloc(32, 7);
// message d'erreur qui cite une donnée personnelle : il ne doit jamais sortir dans le journal
const SECRET = 'Ana Pérez ana@example.test';

class DbError extends Error {
  override readonly name = 'DbError';
  constructor(readonly code: string) {
    super(`échec pour ${SECRET}`);
  }
}

function failingStore(error: unknown): CheckoutStore {
  const fail = (): Promise<never> => Promise.reject(error);
  return { listing: fail, quote: fail, returnPlace: fail, checkout: fail, hold: fail };
}

const NO_QUOTES = {} as QuoteStore;

function service(error: unknown) {
  const logged: { operation: CheckoutOperation; error: unknown }[] = [];
  const svc = new CheckoutService(
    () => {
      throw new Error('non appelé');
    },
    NO_QUOTES,
    failingStore(error),
    (operation, e) => logged.push({ operation, error: e }),
  );
  return { svc, logged };
}

describe('panne du magasin du checkout : 503 et journal sans donnée personnelle', () => {
  it.each([
    ['quote', (s: CheckoutService) => s.quote(PROOF, QUOTE_ID)],
    ['hold', (s: CheckoutService) => s.hold(PROOF, HOLD_ID)],
    [
      'checkout',
      (s: CheckoutService) =>
        s.checkout(PROOF, QUOTE_ID, { driver: { firstName: 'Ana', lastName: 'Pérez' } }),
    ],
  ] as const)('%s : 503 BOOKING_UNAVAILABLE et une ligne de journal', async (operation, call) => {
    const { svc, logged } = service(new DbError('57P01'));
    const failure = call(svc);
    await expect(failure).rejects.toBeInstanceOf(CheckoutHttpError);
    await expect(failure).rejects.toMatchObject({ code: 'BOOKING_UNAVAILABLE' });
    expect(logged.map((l) => l.operation)).toEqual([operation]);
  });

  it('champs journalisés : nom de classe et SQLSTATE seulement', () => {
    expect(failureFields(new DbError('40P01'))).toEqual({
      errorName: 'DbError',
      sqlState: '40P01',
    });
    // SQLSTATE mal formé ou absent, nom de classe inattendu, valeur jetée qui n'est pas une Error
    expect(failureFields(new DbError(SECRET))).toEqual({ errorName: 'DbError', sqlState: null });
    const odd = new Error(SECRET);
    odd.name = `${SECRET} !`;
    expect(failureFields(odd)).toEqual({ errorName: 'unknown', sqlState: null });
    expect(failureFields(SECRET)).toEqual({ errorName: 'unknown', sqlState: null });
    expect(failureFields(null)).toEqual({ errorName: 'unknown', sqlState: null });
  });

  it('journal par défaut : une ligne JSON d’erreur, jamais le message ni la donnée saisie', () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    try {
      LOG_CHECKOUT_FAILURE('checkout', new DbError('08006'));
    } finally {
      console.error = original;
    }
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({
      level: 'error',
      event: 'checkout.store_failed',
      operation: 'checkout',
      errorName: 'DbError',
      sqlState: '08006',
    });
    expect(lines[0]).not.toContain('Ana');
    expect(lines[0]).not.toContain('example.test');
  });
});

describe('niveaux proposés du devis lu (US-226, revue de code n° 3)', () => {
  const ROW = {
    quoteId: QUOTE_ID,
    listingId: HOLD_ID,
    country: 'ZZ',
    currency: 'XTS',
    startAt: '2036-12-10T10:00:00.000Z',
    endAt: '2036-12-13T10:00:00.000Z',
    billableDays: 3,
    lines: [
      { type: 'TRIP_PRICE', amountMinor: '12000', taxMinor: '840' },
      { type: 'PROTECTION', amountMinor: '3000', taxMinor: '0' },
    ],
    totalMinor: '15840',
    expiresAt: null,
    expired: false,
    manualTransmission: false,
    instantBook: true,
    requestMode: { enabled: false, expiryHours: null },
    documents: [],
    protectionLevel: 'BASICA',
    driverAge: null,
    insurerContractActive: true,
    hostName: 'María G.',
    frozenAtMs: 0,
    frozen: null,
    mileage: null,
    cancellation: null,
  };
  const reading = (paramsError: unknown) => {
    const logged: CheckoutOperation[] = [];
    const store: CheckoutStore = {
      ...failingStore(new DbError('57P01')),
      quote: () => Promise.resolve(ROW),
    };
    const svc = new CheckoutService(
      () => {
        throw paramsError;
      },
      NO_QUOTES,
      store,
      (operation) => logged.push(operation),
    );
    return { svc, logged };
  };

  it('configuration du pays refusée par le moteur ⇒ devis lisible sans autre niveau, panne journalisée', async () => {
    const { svc, logged } = reading(new QuoteError('QUOTE_UNAVAILABLE', 'grille absente'));
    const q = await svc.quote(PROOF, QUOTE_ID);
    expect(q.protectionOptions).toEqual([]);
    expect(q.protectionLevel).toBe('BASICA');
    expect(logged).toEqual(['options']);
  });

  it('erreur inattendue de la configuration ⇒ 503 BOOKING_UNAVAILABLE (jamais 500), journalisée', async () => {
    const { svc, logged } = reading(new Error(SECRET));
    await expect(svc.quote(PROOF, QUOTE_ID)).rejects.toMatchObject({
      code: 'BOOKING_UNAVAILABLE',
    });
    expect(logged).toEqual(['options']);
  });
});
