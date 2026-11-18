/**
 * US-212 — constancia d'arrendamiento : lecture stricte des faits, texte bilingue, PDF déterministe
 * (ADR-162 ; 16 LEG-026 ; 19 US-212 critère 1 ; L2-PM-26, L2-PM-35). Chaque pays de la
 * configuration du dépôt (aucune constante de pays) : devise à deux décimales et devise sans
 * décimale. Attendus tirés de la spécification et des catalogues, jamais du code testé ; les
 * montants sont formatés par `formatMoney` de `@rueda/i18n` (oracle de la bibliothèque, prouvée
 * par ses propres tests).
 */
import { createHash } from 'node:crypto';
import { createTranslator, formatMoney, getProfile, parseLocaleConfig } from '@rueda/i18n';
import type { LocaleConfig } from '@rueda/i18n';
import locales from '@rueda/i18n/config/locales.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { repoConfig } from '../../../../../test/support/quote.js';
import { nonWinAnsiCount } from '../contract/pdf.js';
import {
  buildConstanciaBody,
  CONSTANCIA_TEMPLATE_DRAFT,
  constanciaFooter,
  ConstanciaInputError,
  constanciaLocaleOf,
  constanciaSha256,
  parseConstanciaFacts,
  renderConstanciaPdf,
  splitConstanciaBody,
} from './constancia.js';
import type { ConstanciaInput, ConstanciaLocale } from './constancia.js';

const LOCALES: LocaleConfig = parseLocaleConfig(locales);
const COUNTRIES = [...repoConfig.countries.values()];

/** Total de TEST : 12 840 unités mineures (128,40 à deux décimales ; 12 840 sans décimale). */
const TOTAL = '12840';

function row(country: (typeof COUNTRIES)[number], over: Record<string, unknown> = {}) {
  return {
    outcome: 'OK',
    viewer_role: 'GUEST',
    viewer_locale: 'pt-BR',
    trip_status: 'BOOKED',
    contract_version: 3,
    terms: {
      schema: 'ctr.rental/1',
      tripRef: 'K-0190F5A2',
      country: country.code,
      currency: country.currency.code,
      timezone: country.timeZone,
      startLocal: '2034-03-08 10:00',
      endLocal: '2034-03-11 10:00',
      bookedAtLocal: '2034-03-01 09:00',
      vehicle: { make: 'Toyota', model: 'Yaris', year: 2022 },
      hostCapacity: 'AUTHORIZED',
      priceTotalMinor: TOTAL,
      // faits du contrat sans objet pour la constancia : ignorés, jamais imprimés
      priceLines: [{ type: 'TRIP_PRICE', amountMinor: TOTAL, taxMinor: '0' }],
    },
    brand: 'Marca',
    host_name: 'María G.',
    guest_name: 'Ana P.',
    plate: 'AB-1234',
    handover_place: 'Estación de prueba',
    handover_city: 'Ciudad de prueba',
    signed_at_local: '2034-03-02 09:15',
    ...over,
  };
}

function input(
  country: (typeof COUNTRIES)[number],
  courtesy: ConstanciaLocale,
  over: Record<string, unknown> = {},
): ConstanciaInput {
  return {
    facts: parseConstanciaFacts(row(country, over)),
    courtesy,
    exponent: country.currency.exponent,
    localeConfig: LOCALES,
    countryNames: country.names,
  };
}

const textOf = (i: ConstanciaInput) =>
  buildConstanciaBody(i)
    .map((l) => l.t)
    .join('\n');

describe.each(COUNTRIES.map((c) => ({ c, code: c.code, currency: c.currency.code })))(
  'US-212 — constancia ($code, $currency)',
  ({ c }) => {
    it.each(['en', 'fr', 'pt'] as const)(
      'critère 1 : plaque, période exacte avec le nom du pays, hôte et conducteur minimisés, es (fait foi) puis %s',
      (courtesy) => {
        const body = buildConstanciaBody(input(c, courtesy));
        const titles = body.filter((l) => l.s === 'title');
        const es = createTranslator(getProfile(LOCALES, c.legalLocale));
        const other = createTranslator(getProfile(LOCALES, courtesy));
        expect(titles.map((l) => l.t)).toEqual([
          es.t('ctr.constancia.title'),
          other.t('ctr.constancia.title'),
        ]);
        const text = body.map((l) => l.t).join('\n');
        for (const fact of ['AB-1234', 'K-0190F5A2', 'María G.', 'Ana P.', 'Toyota', 'Yaris']) {
          expect(text.split(fact).length - 1, fact).toBe(2);
        }
        // période exacte (heures locales figées) et nom du pays dans chaque langue
        expect(text).toContain(
          es.t('ctr.constancia.period', {
            start: '2034-03-08 10:00',
            end: '2034-03-11 10:00',
            country: c.names.es,
          }),
        );
        expect(text).toContain(
          other.t('ctr.constancia.period', {
            start: '2034-03-08 10:00',
            end: '2034-03-11 10:00',
            country: c.names[courtesy],
          }),
        );
        // aucun fuseau IANA, aucune adresse exacte, aucune pièce
        expect(text).not.toContain(c.timeZone);
        expect(text).not.toMatch(/inapelable|inappellable|unappealable/i);
        // capacité de l'hôte (titulaire d'une autorisation) et intermédiaire, jamais loueur
        expect(text).toContain(es.t('ctr.contract.hostCapacity.authorized'));
        expect(text).toContain(es.t('ctr.constancia.platform', { brand: 'Marca' }));
        // signature horodatée à l'heure locale
        expect(text).toContain(es.t('ctr.constancia.signed', { date: '2034-03-02 09:15' }));
        // BROUILLON tant que l'avocat n'a pas validé (GL-39)
        expect(CONSTANCIA_TEMPLATE_DRAFT).toBe(true);
        expect(body.filter((l) => l.s === 'note').map((l) => l.t)).toEqual([
          es.t('ctr.constancia.draft'),
          other.t('ctr.constancia.draft'),
        ]);
        // tout le texte s'imprime en WinAnsi (aucun « ? » de substitution)
        expect(nonWinAnsiCount(body)).toBe(0);
      },
    );

    it.each(['en', 'fr', 'pt'] as const)(
      'N-353 : invariant du découpage en deux parties (es fait foi, puis %s à partir de sa note de traduction), quel que soit l’état signé',
      (courtesy) => {
        const es = createTranslator(getProfile(LOCALES, c.legalLocale));
        const other = createTranslator(getProfile(LOCALES, courtesy));
        const note = other.t('ctr.constancia.courtesy', {
          language: getProfile(LOCALES, courtesy).displayName,
        });
        for (const over of [{}, { signed_at_local: null }]) {
          const body = buildConstanciaBody(input(c, courtesy, over));
          const [first, second] = splitConstanciaBody(body);
          // les deux parties recouvrent tout le texte, dans l'ordre, sans perte ni doublon
          expect([...first, ...second]).toEqual(body);
          // partie espagnole : un seul titre, le sien, en tête ; aucune note de traduction
          expect(first[0]).toEqual({ s: 'title', t: es.t('ctr.constancia.title') });
          expect(first.filter((l) => l.s === 'title')).toHaveLength(1);
          expect(first.map((l) => l.t)).not.toContain(note);
          expect(first.at(-1)?.t).toBe(es.t('ctr.constancia.notice.fines', { brand: 'Marca' }));
          // partie du lecteur : la note de traduction, puis son titre ; un seul titre
          expect(second[0]).toEqual({ s: 'h', t: note });
          expect(second[1]).toEqual({ s: 'title', t: other.t('ctr.constancia.title') });
          expect(second.filter((l) => l.s === 'title')).toHaveLength(1);
          expect(second.at(-1)?.t).toBe(other.t('ctr.constancia.notice.fines', { brand: 'Marca' }));
        }
      },
    );

    it('montant : unités mineures figées, exposant de la devise (aucune décimale sans exposant), code ISO', () => {
      const text = textOf(input(c, 'en'));
      // profil de l'espagnol du pays (configuration), comme la partie qui fait foi
      const es = getProfile(LOCALES, c.legalLocale);
      const iso = {
        ...es,
        currency: {
          symbols: {},
          pattern: '{amount} {symbol}',
          negativePattern: '-{amount} {symbol}',
        },
      };
      const expected = formatMoney(
        { amountMinor: BigInt(TOTAL), currency: c.currency.code, exponent: c.currency.exponent },
        iso,
      );
      expect(text).toContain(expected);
      expect(expected).toContain(c.currency.code);
      if (c.currency.exponent === 0) expect(expected).not.toMatch(/[.,]\d{1,2}\b/);
    });

    it('PDF déterministe : mêmes faits ⇒ mêmes octets ; un fait changé ⇒ autre empreinte ; non signé ⇒ mention', () => {
      const footer = constanciaFooter('K-0190F5A2', 3);
      const a = renderConstanciaPdf(buildConstanciaBody(input(c, 'en')), footer);
      const b = renderConstanciaPdf(buildConstanciaBody(input(c, 'en')), footer);
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
      expect(constanciaSha256(a)).toBe(createHash('sha256').update(a).digest('hex'));
      expect(Buffer.from(a.subarray(0, 8)).toString('latin1')).toBe('%PDF-1.4');
      const other = renderConstanciaPdf(
        buildConstanciaBody(input(c, 'en', { plate: 'AB-1235' })),
        footer,
      );
      expect(constanciaSha256(other)).not.toBe(constanciaSha256(a));
      const unsigned = textOf(input(c, 'en', { signed_at_local: null }));
      expect(unsigned).toContain(
        createTranslator(getProfile(LOCALES, c.legalLocale)).t('ctr.constancia.unsigned'),
      );
    });
  },
);

describe('US-212 — lecture stricte des faits et langue', () => {
  const c = COUNTRIES[0]!;

  it('langue de la seconde partie : celle du lecteur, l’anglais pour un lecteur hispanophone ou inconnu', () => {
    expect(constanciaLocaleOf(c.legalLocale)).toBe('en');
    expect(constanciaLocaleOf('es')).toBe('en');
    expect(constanciaLocaleOf('en')).toBe('en');
    expect(constanciaLocaleOf('fr')).toBe('fr');
    expect(constanciaLocaleOf('pt-BR')).toBe('pt');
    expect(constanciaLocaleOf(null)).toBe('en');
  });

  it.each([
    ['rôle inconnu', { viewer_role: 'OPS' }],
    ['version absente', { contract_version: 0 }],
    ['schéma inconnu', { terms: { ...row(c).terms, schema: 'ctr.rental/9' } }],
    ['heure locale mal formée', { terms: { ...row(c).terms, startLocal: '2034-03-08T10:00' } }],
    ['total décimal', { terms: { ...row(c).terms, priceTotalMinor: '128.40' } }],
    ['total négatif', { terms: { ...row(c).terms, priceTotalMinor: '-1' } }],
    ['capacité inconnue', { terms: { ...row(c).terms, hostCapacity: 'AGENCY' } }],
    ['plaque absente', { plate: null }],
    ['hôte absent', { host_name: ' ' }],
    ['signature mal formée', { signed_at_local: '2034-03-02' }],
  ])('refus : %s ⇒ ConstanciaInputError (jamais un document deviné)', (_label, over) => {
    expect(() => parseConstanciaFacts(row(c, over))).toThrow(ConstanciaInputError);
  });

  it('nom du pays absent dans une langue ⇒ refus', () => {
    expect(() =>
      buildConstanciaBody({ ...input(c, 'fr'), countryNames: { es: c.names.es } }),
    ).toThrow(ConstanciaInputError);
  });
});
