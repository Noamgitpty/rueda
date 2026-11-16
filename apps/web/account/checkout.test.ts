/**
 * Lecture défensive des réponses du checkout S05 et du total de la fiche S03 (US-208, partie 208b).
 * Montants attendus : TA01 (16 A.8.1, « PA1 ») 120,00 + 8,40 = 128,40, en unités mineures
 * 12 000 + 840 = 12 840 ; jamais tirés du code testé. Aucune devise ni aucun pays réels : devise de
 * test ISO 4217 `XTS`, pays réservé `ZZ`.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGS } from '@rueda/i18n';
import {
  CHECKOUT_DOCUMENT_KINDS,
  CHECKOUT_ERROR_CODES,
  checkoutDocumentHref,
  checkoutErrorKey,
  checkoutHoldOf,
  checkoutInputErrors,
  checkoutInputOf,
  checkoutQuoteOf,
  holdRequestOf,
  S05_FIELD,
  slotPriceOf,
} from './checkout.ts';

const Q = '00000000-0000-4000-8000-0000000208a1';
const L = '00000000-0000-4000-8000-0000000208b1';
const H = '00000000-0000-4000-8000-0000000208c1';
const reply = (status: number, json: unknown) => ({ status, json, session: null }) as const;

const docs = () => [
  { kind: 'GEO_TERMS', version: 1, locale: 'es', title: 'Zonas' },
  { kind: 'TOS_GUEST', version: 2, locale: 'es', title: 'Términos' },
  { kind: 'CANCELLATION_POLICY', version: 1, locale: 'es', title: 'Cancelación' },
];

const quote = (extra: Record<string, unknown> = {}) => ({
  quote: {
    quoteId: Q,
    listingId: L,
    country: 'ZZ',
    currency: 'XTS',
    startAt: '2036-12-10T10:00:00.000Z',
    endAt: '2036-12-13T10:00:00.000Z',
    billableDays: 3,
    lines: [{ type: 'TRIP_PRICE', amountMinor: '12000', taxMinor: '840' }],
    totalMinor: '12840',
    expiresAt: '2036-11-30T15:30:00.000Z',
    expired: false,
    manualTransmission: false,
    instantBook: true,
    documents: docs(),
    ...extra,
  },
});

describe('total TTC de la fiche (availability.price)', () => {
  const avail = (price: unknown) =>
    reply(200, { availability: { startAt: 'x', endAt: 'y', timezone: 'UTC', price } });

  it('total, devise et jours facturés lus tels quels (aucun calcul)', () => {
    expect(slotPriceOf(avail({ totalMinor: '12840', currency: 'XTS', billableDays: 3 }))).toEqual({
      totalMinor: 12840n,
      currency: 'XTS',
      billableDays: 3,
    });
  });

  it('aucun devis possible ou champ illisible ⇒ null (aucun total, aucun bouton)', () => {
    for (const price of [
      null,
      undefined,
      { totalMinor: 12840, currency: 'XTS', billableDays: 3 },
      { totalMinor: '-1', currency: 'XTS', billableDays: 3 },
      { totalMinor: '12840', currency: 'xts', billableDays: 3 },
      { totalMinor: '12840', currency: 'XTS', billableDays: 0 },
    ]) {
      expect(slotPriceOf(avail(price))).toBeNull();
    }
    expect(slotPriceOf(reply(409, { code: 'DATES_UNAVAILABLE' }))).toBeNull();
    expect(slotPriceOf({ status: 'unavailable' })).toBeNull();
  });
});

describe('devis figé du checkout', () => {
  it('TA01 : lignes et total rendus, somme des lignes = total ; documents dans l’ordre de l’écran', () => {
    const q = checkoutQuoteOf(reply(200, quote()));
    expect(q).not.toBeNull();
    expect(q?.totalMinor).toBe(12840n);
    expect(q?.lines).toEqual([{ type: 'TRIP_PRICE', amountMinor: 12000n, taxMinor: 840n }]);
    expect(q?.documents.map((d) => d.kind)).toEqual([...CHECKOUT_DOCUMENT_KINDS]);
    expect(checkoutQuoteOf(reply(201, quote()))?.quoteId).toBe(Q);
  });

  it('US-226 : ligne PROTECTION et niveau figé rendus (TA01 + protection BASICA de 30,00 = 158,40) ; ligne sans niveau, niveau sans ligne ou niveau mal formé ⇒ null', () => {
    const lines = [
      { type: 'TRIP_PRICE', amountMinor: '12000', taxMinor: '840' },
      { type: 'PROTECTION', amountMinor: '3000', taxMinor: '0' },
    ];
    const q = checkoutQuoteOf(
      reply(200, quote({ lines, totalMinor: '15840', protectionLevel: 'BASICA' })),
    );
    expect(q?.protectionLevel).toBe('BASICA');
    expect(q?.lines.map((l) => [l.type, l.amountMinor])).toEqual([
      ['TRIP_PRICE', 12000n],
      ['PROTECTION', 3000n],
    ]);
    expect(checkoutQuoteOf(reply(200, quote()))?.protectionLevel).toBeNull();
    for (const extra of [
      { lines, totalMinor: '15840' },
      { lines, totalMinor: '15840', protectionLevel: null },
      { protectionLevel: 'BASICA' },
      { lines, totalMinor: '15840', protectionLevel: 'basica' },
      { lines, totalMinor: '15840', protectionLevel: 3 },
    ]) {
      expect(checkoutQuoteOf(reply(200, quote(extra))), JSON.stringify(extra)).toBeNull();
    }
  });

  it('somme des lignes ≠ total ⇒ jamais affiché (aucun recalcul)', () => {
    expect(checkoutQuoteOf(reply(200, quote({ totalMinor: '12841' })))).toBeNull();
  });

  it('ligne que l’écran ne sait pas nommer, document en double ou d’un autre genre ⇒ null', () => {
    const extra = [
      { lines: [{ type: 'DELIVERY_FEE', amountMinor: '12840', taxMinor: '0' }] },
      { lines: [] },
      { documents: [...docs(), docs()[0]] },
      {
        documents: [
          docs()[0],
          docs()[1],
          { kind: 'PRIVACY', version: 1, locale: 'es', title: 'P' },
        ],
      },
      { documents: [{ ...docs()[0], version: 0 }] },
      { expired: 'false' },
      { endAt: '2036-12-10T10:00:00.000Z' },
      { quoteId: 'pas-un-uuid' },
      { expiresAt: 'demain' },
    ];
    for (const e of extra)
      expect(checkoutQuoteOf(reply(200, quote(e))), JSON.stringify(e)).toBeNull();
  });

  it('document non publié : absent de la liste (l’écran refuse la réservation, fail-closed)', () => {
    const q = checkoutQuoteOf(reply(200, quote({ documents: docs().slice(0, 2) })));
    expect(q?.documents).toHaveLength(2);
  });

  it('expiré et boîte manuelle lus de la base', () => {
    const q = checkoutQuoteOf(reply(200, quote({ expired: true, manualTransmission: true })));
    expect(q).toMatchObject({ expired: true, manualTransmission: true });
  });
});

describe('hold posé', () => {
  const hold = (extra: Record<string, unknown> = {}) =>
    reply(201, {
      hold: {
        holdId: H,
        status: 'ACTIVE',
        expiresAt: '2036-11-30T15:10:00.000Z',
        quoteId: Q,
        listingId: L,
        currency: 'XTS',
        startAt: '2036-12-10T10:00:00.000Z',
        endAt: '2036-12-13T10:00:00.000Z',
        totalMinor: '12840',
        manualConfirmed: false,
        documents: [
          { kind: 'CANCELLATION_POLICY', version: 1, locale: 'es' },
          { kind: 'GEO_TERMS', version: 1, locale: 'es' },
          { kind: 'TOS_GUEST', version: 2, locale: 'es' },
        ],
        ...extra,
      },
    });

  it('versions acceptées relues telles quelles', () => {
    expect(checkoutHoldOf(hold())?.documents).toEqual([
      { kind: 'CANCELLATION_POLICY', version: 1 },
      { kind: 'GEO_TERMS', version: 1 },
      { kind: 'TOS_GUEST', version: 2 },
    ]);
  });

  it('réponse mal formée ⇒ null', () => {
    for (const e of [
      { holdId: 'x' },
      { totalMinor: 12840 },
      { documents: [{ kind: 'PRIVACY', version: 1 }] },
      { manualConfirmed: 'non' },
    ]) {
      expect(checkoutHoldOf(hold(e)), JSON.stringify(e)).toBeNull();
    }
  });
});

describe('saisie de S05 : contrôles de forme et corps envoyé (jamais un montant)', () => {
  const form = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  };
  const shown = {
    'version.TOS_GUEST': '2',
    'version.CANCELLATION_POLICY': '1',
    'version.GEO_TERMS': '1',
  };

  it('rien de coché ⇒ une erreur par champ et par case (TERMS_NOT_ACCEPTED)', () => {
    const input = checkoutInputOf(form(shown));
    const errors = checkoutInputErrors(input, true);
    expect(errors.map((e) => e.fieldId)).toEqual([
      S05_FIELD.firstName,
      S05_FIELD.lastName,
      S05_FIELD.manual,
      ...CHECKOUT_DOCUMENT_KINDS.map((k) => S05_FIELD.document(k)),
    ]);
    expect(errors.filter((e) => e.key === 'common.checkout.termsNotAccepted')).toHaveLength(3);
  });

  it('tout saisi ⇒ aucun refus ; corps : conducteur, case, versions affichées, aucun montant', () => {
    const input = checkoutInputOf(
      form({
        ...shown,
        firstName: 'Lucía',
        lastName: 'Gómez',
        manual: 'on',
        'accept.TOS_GUEST': 'on',
        'accept.CANCELLATION_POLICY': 'on',
        'accept.GEO_TERMS': 'on',
        totalMinor: '1',
      }),
    );
    expect(checkoutInputErrors(input, true)).toEqual([]);
    const body = holdRequestOf(input);
    expect(body).toEqual({
      driver: { firstName: 'Lucía', lastName: 'Gómez' },
      manualTransmissionConfirmed: true,
      acceptedDocuments: [
        { kind: 'TOS_GUEST', version: 2 },
        { kind: 'CANCELLATION_POLICY', version: 1 },
        { kind: 'GEO_TERMS', version: 1 },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/amount|total|price/i);
  });

  it('version illisible ⇒ document non affiché, jamais accepté ; noms bornés à 100', () => {
    const input = checkoutInputOf(
      form({ 'version.TOS_GUEST': '0', 'accept.TOS_GUEST': 'on', firstName: 'x'.repeat(150) }),
    );
    expect(input.accepted).toEqual([]);
    expect(input.firstName).toHaveLength(100);
  });
});

describe('messages des refus', () => {
  it('chaque code connu a sa clé dans les quatre catalogues', () => {
    for (const code of CHECKOUT_ERROR_CODES) {
      const key = checkoutErrorKey(reply(409, { code }));
      for (const catalog of Object.values(CATALOGS)) {
        expect(catalog.messages, `${code} → ${key}`).toHaveProperty([key]);
      }
    }
    expect(checkoutErrorKey(reply(409, { code: 'QUOTE_EXPIRED' }))).toBe('common.quote.expired');
  });

  it('code inconnu ou API injoignable ⇒ message générique, jamais un texte technique', () => {
    expect(checkoutErrorKey(reply(500, { code: 'WHATEVER' }))).toBe('common.checkout.unavailable');
    expect(checkoutErrorKey({ status: 'unavailable' })).toBe('common.checkout.unavailable');
  });

  it('lien du document : version exacte, pays du trajet, retour au devis', () => {
    const href = checkoutDocumentHref({ kind: 'GEO_TERMS', version: 3 }, 'ZZ', Q);
    const url = new URL(href, 'http://localhost');
    expect(url.pathname).toBe('/legal/GEO_TERMS');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      country: 'ZZ',
      version: '3',
      from: 'checkout',
      quote: Q,
    });
  });
});
