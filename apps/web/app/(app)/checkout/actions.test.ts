/**
 * Actions serveur du checkout (US-226 partie 226b, revue qa n° 1) : `renewQuoteAction` →
 * `renewFrom` → `freezeAndOpen` reprend le niveau et l'âge du devis expiré ; `changeProtectionAction`
 * ne fige rien pour un même choix et envoie le choix validé ; `startCheckoutAction` fige sans niveau
 * (minimum du pays). L'API est un double (`callApi`), `redirect` lève comme Next.js ; aucun
 * montant n'est jamais envoyé (L2-PM-03).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { protectionChoiceOf } from '../../../account/checkout.ts';

const calls: { method: string; path: string; body: unknown }[] = [];
let replies: Record<string, { status: number; json: unknown }> = {};

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock('../../../account/request.ts', () => ({
  clientContext: () => Promise.resolve({ sessionToken: 'jeton', locale: 'es' }),
}));
vi.mock('../../../account/api-client.ts', async (original) => {
  const real = await original<typeof import('../../../account/api-client.ts')>();
  return {
    ...real,
    callApi: (method: string, path: string, _ctx: unknown, body?: unknown) => {
      calls.push({ method, path, body });
      const r = replies[`${method} ${path}`];
      return Promise.resolve(r === undefined ? { status: 'unavailable' } : { ...r, session: null });
    },
  };
});

const { changeProtectionAction, renewQuoteAction, startCheckoutAction } =
  await import('./actions.ts');

const OLD = '00000000-0000-4000-8000-0000000226c1';
const NEW = '00000000-0000-4000-8000-0000000226c2';
const L = '00000000-0000-4000-8000-0000000226d1';
const START = '2036-12-22T10:00:00.000Z';
const END = '2036-12-25T10:00:00.000Z';
const docs = [
  { kind: 'TOS_GUEST', version: 1, locale: 'es', title: 'Términos' },
  { kind: 'CANCELLATION_POLICY', version: 1, locale: 'es', title: 'Cancelación' },
  { kind: 'GEO_TERMS', version: 1, locale: 'es', title: 'Zonas' },
];
/** Devis figé (ESTANDAR, 25 ans) ; montants de forme seulement, jamais relus par l'action. */
const quote = (id: string, extra: Record<string, unknown> = {}) => ({
  quote: {
    quoteId: id,
    listingId: L,
    country: 'ZZ',
    currency: 'XTS',
    startAt: START,
    endAt: END,
    billableDays: 3,
    lines: [
      { type: 'TRIP_PRICE', amountMinor: '12000', taxMinor: '840' },
      { type: 'PROTECTION', amountMinor: '4800', taxMinor: '0' },
    ],
    totalMinor: '17640',
    expiresAt: '2036-11-30T15:30:00.000Z',
    expired: true,
    manualTransmission: false,
    instantBook: true,
    documents: docs,
    protectionLevel: 'ESTANDAR',
    driverAge: 25,
    insurerContractActive: true,
    ...extra,
  },
});
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const INITIAL = { errors: [] };

beforeEach(() => {
  calls.length = 0;
  replies = {};
});

describe('protectionChoiceOf', () => {
  it('niveau et âge du devis repris ; sans âge : niveau seul ; sans niveau : aucun choix', () => {
    expect(protectionChoiceOf({ protectionLevel: 'ESTANDAR', driverAge: 25 })).toEqual({
      protectionLevel: 'ESTANDAR',
      driverAge: 25,
    });
    expect(protectionChoiceOf({ protectionLevel: 'TOTAL', driverAge: null })).toEqual({
      protectionLevel: 'TOTAL',
    });
    expect(protectionChoiceOf({ protectionLevel: null, driverAge: 30 })).toBeUndefined();
  });
});

describe('renouvellement d’un prix expiré (renewFrom → freezeAndOpen)', () => {
  it('nouveau gel avec le même niveau et le même âge, puis S05 du nouveau devis (?renewed=1)', async () => {
    replies[`GET /checkout/quotes/${OLD}`] = { status: 200, json: quote(OLD) };
    replies['POST /checkout/quotes'] = { status: 201, json: quote(NEW, { expired: false }) };
    await expect(renewQuoteAction(INITIAL, form({ quoteId: OLD }))).rejects.toThrow(
      `REDIRECT /checkout/${NEW}?renewed=1`,
    );
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      path: '/checkout/quotes',
      body: {
        listingId: L,
        startAt: START,
        endAt: END,
        protectionLevel: 'ESTANDAR',
        driverAge: 25,
      },
    });
  });

  it('devis sans protection : nouveau gel sans niveau (minimum du pays)', async () => {
    const legacy = quote(OLD, {
      lines: [{ type: 'TRIP_PRICE', amountMinor: '12000', taxMinor: '840' }],
      totalMinor: '12840',
      protectionLevel: null,
      driverAge: null,
    });
    replies[`GET /checkout/quotes/${OLD}`] = { status: 200, json: legacy };
    replies['POST /checkout/quotes'] = { status: 201, json: quote(NEW, { expired: false }) };
    await expect(renewQuoteAction(INITIAL, form({ quoteId: OLD }))).rejects.toThrow('REDIRECT');
    expect(calls.at(-1)?.body).toEqual({ listingId: L, startAt: START, endAt: END });
  });

  it('nouveau gel refusé ⇒ message du formulaire du prix (jamais un champ de la protection)', async () => {
    replies[`GET /checkout/quotes/${OLD}`] = { status: 200, json: quote(OLD) };
    replies['POST /checkout/quotes'] = {
      status: 422,
      json: { code: 'PROTECTION_LEVEL_NOT_ELIGIBLE' },
    };
    expect(await renewQuoteAction(INITIAL, form({ quoteId: OLD }))).toEqual({
      errors: [{ fieldId: 's05-form', key: 'common.quote.protectionNotEligible' }],
    });
  });
});

describe('changement de protection (changeProtectionAction → freezeAndOpen)', () => {
  it('même niveau et même âge ⇒ retour au même devis, aucun gel', async () => {
    replies[`GET /checkout/quotes/${OLD}`] = { status: 200, json: quote(OLD, { expired: false }) };
    await expect(
      changeProtectionAction(
        INITIAL,
        form({ quoteId: OLD, protectionLevel: 'ESTANDAR', driverAge: '25' }),
      ),
    ).rejects.toThrow(`REDIRECT /checkout/${OLD}`);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('choix validé ⇒ un gel avec le niveau et l’âge, puis ?protection=1 ; aucun montant envoyé', async () => {
    replies[`GET /checkout/quotes/${OLD}`] = { status: 200, json: quote(OLD, { expired: false }) };
    replies['POST /checkout/quotes'] = { status: 201, json: quote(NEW, { expired: false }) };
    await expect(
      changeProtectionAction(
        INITIAL,
        form({ quoteId: OLD, protectionLevel: 'TOTAL', driverAge: '21' }),
      ),
    ).rejects.toThrow(`REDIRECT /checkout/${NEW}?protection=1`);
    expect(calls.at(-1)?.body).toEqual({
      listingId: L,
      startAt: START,
      endAt: END,
      protectionLevel: 'TOTAL',
      driverAge: 21,
    });
  });

  it('niveau refusé à l’âge déclaré ⇒ erreur liée au groupe des niveaux, saisie conservée', async () => {
    replies[`GET /checkout/quotes/${OLD}`] = { status: 200, json: quote(OLD, { expired: false }) };
    replies['POST /checkout/quotes'] = {
      status: 422,
      json: { code: 'PROTECTION_LEVEL_NOT_ELIGIBLE' },
    };
    expect(
      await changeProtectionAction(
        INITIAL,
        form({ quoteId: OLD, protectionLevel: 'TOTAL', driverAge: '20' }),
      ),
    ).toEqual({
      errors: [{ fieldId: 's05-protection-levels', key: 'common.quote.protectionNotEligible' }],
      values: { protectionLevel: 'TOTAL', driverAge: '20' },
    });
  });

  it('âge illisible ⇒ refus de forme, aucun appel à l’API', async () => {
    const r = await changeProtectionAction(
      INITIAL,
      form({ quoteId: OLD, protectionLevel: 'BASICA', driverAge: '150' }),
    );
    expect(r.errors).toEqual([{ fieldId: 's05-driver-age', key: 'web.s05.age.invalid' }]);
    expect(calls).toEqual([]);
  });
});

describe('S03 « Reservar » (startCheckoutAction → freezeAndOpen)', () => {
  it('gel sans niveau (minimum du pays) ; contrat de l’assureur fermé ⇒ message du formulaire', async () => {
    replies['POST /checkout/quotes'] = {
      status: 409,
      json: { code: 'INSURER_CONTRACT_INACTIVE' },
    };
    expect(
      await startCheckoutAction(
        INITIAL,
        form({
          listingId: L,
          startAt: '2036-12-27T10:00:00.000Z',
          endAt: '2036-12-30T10:00:00.000Z',
        }),
      ),
    ).toEqual({ errors: [{ fieldId: 's05-form', key: 'common.quote.insurerContractInactive' }] });
    expect(calls[0]?.body).toEqual({
      listingId: L,
      startAt: '2036-12-27T10:00:00.000Z',
      endAt: '2036-12-30T10:00:00.000Z',
    });
  });
});
