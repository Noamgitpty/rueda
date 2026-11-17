/**
 * Lecture défensive des réponses du checkout S05 et du total de la fiche S03 (US-208, partie 208b).
 * Montants attendus : TA01 (16 A.8.1, « PA1 ») 120,00 + 8,40 = 128,40, en unités mineures
 * 12 000 + 840 = 12 840 ; jamais tirés du code testé. Aucune devise ni aucun pays réels : devise de
 * test ISO 4217 `XTS`, pays réservé `ZZ`.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGS } from '@rueda/i18n';
import {
  AGE_INVALID_MESSAGE,
  CHECKOUT_DOCUMENT_KINDS,
  CHECKOUT_ERROR_CODES,
  checkoutDocumentHref,
  checkoutErrorKey,
  checkoutHoldOf,
  checkoutInputErrors,
  checkoutInputOf,
  checkoutQuoteOf,
  holdPayable,
  holdRequestOf,
  IDENTITY_REFUSAL_KEYS,
  protectionChanged,
  protectionInputErrors,
  protectionInputOf,
  S05_FIELD,
  S05_PROTECTION_FIELD,
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

  // US-226b : niveaux proposés de S05. Attendus (16 PRC-018, grille de TEST 1/4, 2/5, 13/20 du
  // prix journalier net de 40,00 ; TOTAL dès 21 ans, ADR-136) : BASICA 10,00 / jour ⇒ 30,00 sur
  // 3 jours (la protection du trip A de 08, TJ01) ; ESTANDAR 16,00 ⇒ 48,00 ; TOTAL 26,00 ⇒ 78,00
  const options = (selected = 'BASICA', age: number | null = null) =>
    [
      ['BASICA', null, '1000', '3000'],
      ['ESTANDAR', null, '1600', '4800'],
      ['TOTAL', 21, '2600', '7800'],
    ].map(([level, min, daily, line]) => {
      const eligible = min === null || (age !== null && age >= (min as number));
      return {
        level,
        eligible,
        reason: eligible ? null : 'DRIVER_AGE',
        minDriverAge: min,
        dailyMinor: daily,
        lineMinor: line,
        selected: level === selected,
      };
    });
  const withProtection = (extra: Record<string, unknown> = {}) =>
    quote({
      lines: [
        { type: 'TRIP_PRICE', amountMinor: '12000', taxMinor: '840' },
        { type: 'PROTECTION', amountMinor: '3000', taxMinor: '0' },
      ],
      totalMinor: '15840',
      protectionLevel: 'BASICA',
      driverAge: null,
      insurerContractActive: true,
      protectionOptions: options(),
      ...extra,
    });

  it('US-226b : niveaux proposés lus tels quels (prix de l’API, niveau grisé avec sa raison), âge déclaré et interrupteur de l’assureur', () => {
    const q = checkoutQuoteOf(reply(200, withProtection()));
    expect(q?.driverAge).toBeNull();
    expect(q?.insurerContractActive).toBe(true);
    expect(q?.protectionOptions).toEqual([
      {
        level: 'BASICA',
        eligible: true,
        reason: null,
        minDriverAge: null,
        dailyMinor: 1000n,
        lineMinor: 3000n,
        selected: true,
      },
      {
        level: 'ESTANDAR',
        eligible: true,
        reason: null,
        minDriverAge: null,
        dailyMinor: 1600n,
        lineMinor: 4800n,
        selected: false,
      },
      {
        level: 'TOTAL',
        eligible: false,
        reason: 'DRIVER_AGE',
        minDriverAge: 21,
        dailyMinor: 2600n,
        lineMinor: 7800n,
        selected: false,
      },
    ]);
    // 25 ans déclarés : TOTAL permis ; contrat de l'assureur fermé : lu (aucune réservation)
    const older = checkoutQuoteOf(
      reply(200, withProtection({ driverAge: 25, protectionOptions: options('BASICA', 25) })),
    );
    expect(older?.driverAge).toBe(25);
    expect(older?.protectionOptions[2]?.eligible).toBe(true);
    expect(
      checkoutQuoteOf(reply(200, withProtection({ insurerContractActive: false })))
        ?.insurerContractActive,
    ).toBe(false);
    // réponse antérieure à US-226 : aucun niveau, aucune fermeture annoncée
    const legacy = checkoutQuoteOf(reply(200, quote()));
    expect(legacy?.protectionOptions).toEqual([]);
    expect(legacy?.insurerContractActive).toBe(true);
    expect(legacy?.driverAge).toBeNull();
  });

  it('US-226b : niveaux incohérents ⇒ devis jamais affiché (fail-closed)', () => {
    const bad = (mutate: (o: ReturnType<typeof options>) => unknown) =>
      checkoutQuoteOf(reply(200, withProtection({ protectionOptions: mutate(options()) })));
    // niveau sélectionné ≠ niveau du devis, ou sa ligne ≠ la ligne PROTECTION du devis
    expect(
      checkoutQuoteOf(reply(200, withProtection({ protectionOptions: options('ESTANDAR') }))),
    ).toBeNull();
    expect(
      bad((o) => o.map((x) => (x.level === 'BASICA' ? { ...x, lineMinor: '3001' } : x))),
    ).toBeNull();
    // deux sélectionnés, doublon, niveau refusé sans raison, raison inconnue, montant illisible
    expect(bad((o) => o.map((x) => ({ ...x, selected: x.level !== 'TOTAL' })))).toBeNull();
    expect(bad((o) => [...o, o[1]])).toBeNull();
    expect(bad((o) => o.map((x) => (x.level === 'TOTAL' ? { ...x, reason: null } : x)))).toBeNull();
    expect(
      bad((o) => o.map((x) => (x.level === 'TOTAL' ? { ...x, reason: 'VALUE' } : x))),
    ).toBeNull();
    expect(
      bad((o) => o.map((x) => (x.level === 'ESTANDAR' ? { ...x, dailyMinor: 1600 } : x))),
    ).toBeNull();
    expect(bad(() => 'BASICA')).toBeNull();
    expect(checkoutQuoteOf(reply(200, withProtection({ driverAge: '25' })))).toBeNull();
    expect(checkoutQuoteOf(reply(200, withProtection({ insurerContractActive: 'no' })))).toBeNull();
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

  it('US-205b : distance figée, annulation gratuite et retenue hors fenêtre lues telles quelles (TA01, 3 jours : 1 jour retenu, 42,80 de 08 BR-CXL-06) ; forme inattendue ⇒ champ nul, jamais deviné', () => {
    const x = checkoutQuoteOf(
      reply(
        200,
        quote({
          mileage: { mode: 'INCLUDED', includedKm: 600, extraKmPriceMinor: '35' },
          cancellation: {
            lastMinute: false,
            freeUntil: '2036-12-09T10:00:00.000Z',
            lastMinuteWindowMinutes: 60,
            endsAtStart: false,
          },
          lateCancellation: { penaltyDays: '1', retainedMinor: '4280' },
        }),
      ),
    );
    expect(x?.mileage).toEqual({ mode: 'INCLUDED', includedKm: 600, extraKmPriceMinor: 35n });
    expect(x?.cancellation).toEqual({
      lastMinute: false,
      freeUntil: new Date('2036-12-09T10:00:00.000Z'),
      windowMinutes: 60,
      endsAtStart: false,
    });
    expect(x?.lateCancellation).toEqual({ penaltyDays: 'ONE', retainedMinor: 4280n });
    const half = checkoutQuoteOf(
      reply(200, quote({ lateCancellation: { penaltyDays: '1/2', retainedMinor: '2140' } })),
    );
    expect(half?.lateCancellation).toEqual({ penaltyDays: 'HALF', retainedMinor: 2140n });
    // absents (réponse antérieure) : aucune condition promise, devis lisible
    const old = checkoutQuoteOf(reply(200, quote()));
    expect(old).not.toBeNull();
    expect([old?.mileage, old?.cancellation, old?.lateCancellation]).toEqual([null, null, null]);
    for (const extra of [
      { mileage: { mode: 'INCLUDED', includedKm: 0, extraKmPriceMinor: '35' } },
      { mileage: { mode: 'MILES', includedKm: 600, extraKmPriceMinor: '35' } },
      { lateCancellation: { penaltyDays: '2', retainedMinor: '4280' } },
      // retenue au-delà du total : jamais affichée
      { lateCancellation: { penaltyDays: '1', retainedMinor: '12841' } },
      { cancellation: { lastMinute: false, freeUntil: null, lastMinuteWindowMinutes: 60 } },
    ]) {
      const y = checkoutQuoteOf(reply(200, quote(extra)));
      expect(y, JSON.stringify(extra)).not.toBeNull();
      expect([y?.mileage, y?.cancellation, y?.lateCancellation]).toEqual([null, null, null]);
    }
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
        reviewState: 'NONE',
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
      // US-209c (N-203) : état de revue absent ou inconnu ⇒ refusé (fail-closed)
      { reviewState: undefined },
      { reviewState: 'UNDER_REVIEW' },
      { reviewState: null },
    ]) {
      expect(checkoutHoldOf(hold(e)), JSON.stringify(e)).toBeNull();
    }
  });

  it('US-209c (N-203) : « Pagar » seulement pour un hold ACTIVE sans revue ou revu ; jamais en revue, refusé ou hors ACTIVE', () => {
    const payable = (status: string, reviewState: string) => {
      const h = checkoutHoldOf(hold({ status, reviewState }));
      if (h === null) throw new Error('hold mal lu');
      return holdPayable(h);
    };
    expect(payable('ACTIVE', 'NONE')).toBe(true);
    expect(payable('ACTIVE', 'APPROVED')).toBe(true);
    expect(payable('ACTIVE', 'PENDING')).toBe(false);
    expect(payable('RELEASED', 'REJECTED')).toBe(false);
    expect(payable('PAYMENT_IN_FLIGHT', 'APPROVED')).toBe(false);
    expect(payable('EXPIRED', 'NONE')).toBe(false);
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

describe('choix de la protection de S05 (US-226b) : contrôles de forme, aucun gel inutile', () => {
  const form = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  };

  it('niveau et âge lus ; âge vide ⇒ non déclaré ; âge illisible ou hors bornes ⇒ erreur liée au champ', () => {
    expect(protectionInputOf(form({ protectionLevel: 'TOTAL', driverAge: ' 25 ' }))).toEqual({
      level: 'TOTAL',
      driverAge: 25,
    });
    expect(protectionInputOf(form({ protectionLevel: 'BASICA', driverAge: '' }))).toEqual({
      level: 'BASICA',
      driverAge: undefined,
    });
    for (const age of ['15', '100', '2a', '-3', '21.5']) {
      const input = protectionInputOf(form({ protectionLevel: 'BASICA', driverAge: age }));
      expect(input.driverAge, age).toBeNull();
      expect(protectionInputErrors(input)).toEqual([
        { fieldId: S05_PROTECTION_FIELD.age, key: AGE_INVALID_MESSAGE },
      ]);
    }
  });

  it('aucun niveau (ou niveau mal formé) ⇒ PROTECTION_LEVEL_REQUIRED : aucune option « sans protection »', () => {
    for (const entries of [{}, { protectionLevel: '' }, { protectionLevel: 'none' }]) {
      expect(protectionInputErrors(protectionInputOf(form(entries)))).toEqual([
        { fieldId: S05_PROTECTION_FIELD.levels, key: 'common.quote.protectionRequired' },
      ]);
    }
  });

  it('même niveau et même âge que le devis ⇒ aucun nouveau gel ; tout changement ⇒ nouveau devis', () => {
    const quote = { protectionLevel: 'BASICA', driverAge: null };
    expect(protectionChanged(quote, { level: 'BASICA', driverAge: undefined })).toBe(false);
    expect(protectionChanged(quote, { level: 'ESTANDAR', driverAge: undefined })).toBe(true);
    expect(protectionChanged(quote, { level: 'BASICA', driverAge: 30 })).toBe(true);
    expect(
      protectionChanged(
        { protectionLevel: 'TOTAL', driverAge: 30 },
        { level: 'TOTAL', driverAge: 30 },
      ),
    ).toBe(false);
  });
});

describe('messages des refus', () => {
  it('US-226 : refus de la protection nommés (niveau exigé, refusé, contrat de l’assureur fermé)', () => {
    for (const [code, key] of [
      ['PROTECTION_LEVEL_REQUIRED', 'common.quote.protectionRequired'],
      ['PROTECTION_LEVEL_NOT_ELIGIBLE', 'common.quote.protectionNotEligible'],
      ['INSURER_CONTRACT_INACTIVE', 'common.quote.insurerContractInactive'],
    ] as const) {
      expect(checkoutErrorKey(reply(422, { code }))).toBe(key);
    }
  });

  it('chaque code connu a sa clé dans les quatre catalogues', () => {
    for (const code of CHECKOUT_ERROR_CODES) {
      const key = checkoutErrorKey(reply(409, { code }));
      for (const catalog of Object.values(CATALOGS)) {
        expect(catalog.messages, `${code} → ${key}`).toHaveProperty([key]);
      }
    }
    expect(checkoutErrorKey(reply(409, { code: 'QUOTE_EXPIRED' }))).toBe('common.quote.expired');
  });

  it('US-209 : refus du conducteur (403 de la pose, 16 BKG-012) ⇒ leur propre message, jamais « réessaie plus tard »', () => {
    const expected: Readonly<Record<string, string>> = {
      KYC_NOT_APPROVED: 'common.kyc.notApproved',
      KYC_BIOMETRIC_CONSENT_MISSING: 'common.kyc.consentMissing',
      KYC_LICENSE_EXPIRED: 'common.kyc.licenseExpired',
      AGE_CLASS_MISMATCH: 'common.checkout.ageClassMismatch',
    };
    for (const [code, key] of Object.entries(expected)) {
      expect(checkoutErrorKey(reply(403, { code })), code).toBe(key);
      for (const catalog of Object.values(CATALOGS)) {
        expect(catalog.messages, `${code} → ${key}`).toHaveProperty([key]);
      }
    }
    // l'ancien code d'US-208 n'est plus rendu par l'API (N-122 : un seul code)
    expect(CHECKOUT_ERROR_CODES).not.toContain('KYC_CONSENT_WITHDRAWN');
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

describe('US-209c (UXQ-12) : refus du conducteur levés depuis S04', () => {
  it('KYC_NOT_APPROVED, KYC_BIOMETRIC_CONSENT_MISSING, KYC_LICENSE_EXPIRED ⇒ lien vers S04 ; AGE_CLASS_MISMATCH et autres ⇒ aucun', () => {
    const linked = (code: string) =>
      IDENTITY_REFUSAL_KEYS.has(checkoutErrorKey(reply(403, { code, messageKey: 'x' })));
    expect(linked('KYC_NOT_APPROVED')).toBe(true);
    expect(linked('KYC_BIOMETRIC_CONSENT_MISSING')).toBe(true);
    expect(linked('KYC_LICENSE_EXPIRED')).toBe(true);
    expect(linked('AGE_CLASS_MISMATCH')).toBe(false);
    expect(linked('DRIVER_CHECK_UNKNOWN')).toBe(false);
  });
});
