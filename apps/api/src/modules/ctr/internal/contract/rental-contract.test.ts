/**
 * US-211 (partie 211a) — texte du contrat de location, PDF déterministe et empreinte (ADR-143 ;
 * 16 BKG-018, BKG-019 ; 19 US-211 critères 1 à 3). Attendus tirés de 19 US-211, de 16 BKG-018
 * (« Kmino est l'intermédiaire et n'est pas partie », pièce masquée, plan de protection, franchise,
 * caution, grille de retard, interdiction de sortie du territoire) et du format des montants de la
 * configuration des locales (`@rueda/i18n/config/locales.json`) ; jamais du code testé.
 * Les pays de premier rang de la configuration du dépôt (devises d'exposant 2 et 0).
 */
import { parseLocaleConfig } from '@rueda/i18n';
import locales from '@rueda/i18n/config/locales.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { repoConfig } from '../../../../../test/support/quote.js';
import { nonWinAnsiCount, renderPdf } from './pdf.js';
import {
  buildContractBody,
  contractFooter,
  ContractInputError,
  contractSha256,
  parseContractBody,
  parseContractDerived,
  parseContractFacts,
  parseContractTerms,
  renderContractPdf,
  RENTAL_CONTRACT_RENDERER,
  verifyContractPdf,
  verifySignedContractPdf,
  type RentalContractInput,
} from './rental-contract.js';

const localeConfig = parseLocaleConfig(locales);

interface Amounts {
  readonly total: string;
  readonly deductible: string;
  readonly rc: string;
  readonly deposit: string;
  readonly extraKm: string;
  readonly retained: string;
  /** Montants attendus (chiffres), au format es des locales (séparateurs de locales.json). */
  readonly expected: {
    readonly total: string;
    readonly deductible: string;
    readonly deposit: string;
    readonly retained: string;
    readonly extraKm: string;
  };
}

/** Montants de test par exposant de devise (2 : centièmes ; 0 : aucune décimale). */
const BY_EXPONENT: Readonly<Record<number, Amounts>> = {
  2: {
    total: '12840',
    deductible: '50000',
    rc: '2500000',
    deposit: '25000',
    extraKm: '35',
    retained: '4280',
    expected: {
      total: '128,40',
      deductible: '500,00',
      deposit: '250,00',
      retained: '42,80',
      extraKm: '0,35',
    },
  },
  0: {
    total: '1071000',
    deductible: '3500000',
    rc: '150000000',
    deposit: '1750000',
    extraKm: '2500',
    retained: '357000',
    expected: {
      total: '1.071.000',
      deductible: '3.500.000',
      deposit: '1.750.000',
      retained: '357.000',
      extraKm: '2.500',
    },
  },
};

interface Case extends Amounts {
  readonly country: string;
  readonly currency: string;
  readonly exponent: number;
  readonly timezone: string;
  readonly names: Readonly<Record<string, string>>;
}

/** Pays de premier rang lus de la configuration du dépôt (aucune constante de pays ici). */
const CASES: readonly Case[] = [...repoConfig.countries.values()].map((k) => {
  const amounts = BY_EXPONENT[k.currency.exponent];
  if (amounts === undefined) throw new Error(`exposant sans montants de test : ${k.code}`);
  return {
    ...amounts,
    country: k.code,
    currency: k.currency.code,
    exponent: k.currency.exponent,
    timezone: k.timeZone,
    names: k.names,
  };
});

function input(c: Case, over: Partial<RentalContractInput> = {}): RentalContractInput {
  return {
    terms: {
      schema: 'ctr.rental/1',
      tripRef: 'K-ABC12345',
      country: c.country,
      currency: c.currency,
      timezone: c.timezone,
      startLocal: '2034-03-08 10:00',
      endLocal: '2034-03-11 10:00',
      bookedAtLocal: '2034-03-01 09:00',
      vehicle: { make: 'Toyota', model: 'Yaris', year: 2022 },
      hostCapacity: 'OWNER',
      priceTotalMinor: c.total,
      priceLines: [{ type: 'TRIP_PRICE', amountMinor: c.total, taxMinor: '0' }],
      protection: {
        level: 'BASICA',
        deductibleMinor: c.deductible,
        rcMinor: c.rc,
        insurer: 'Aseguradora de prueba',
        broker: null,
      },
      depositMinor: c.deposit,
      mileage: { mode: 'INCLUDED', includedKm: 600, extraKmPriceMinor: c.extraKm },
      lateGraceMinutes: 29,
    },
    identity: {
      hostName: 'María Gómez',
      guestName: 'Ana P.',
      plate: 'AB1234',
      handoverPlace: 'Casa',
      handoverAddress: 'Calle 50',
      handoverCity: 'Ciudad',
    },
    derived: {
      brand: 'Marca',
      cancellation: {
        freeUntilLocal: '2034-03-07 10:00',
        penaltyDays: '1',
        retainedMinor: c.retained,
        engineVersion: 'cxl-beta/1',
      },
    },
    version: 1,
    es: { title: 'Contrato de alquiler', body: 'BORRADOR.\n1. Partes.', isDraft: true },
    courtesy: {
      locale: 'en',
      title: 'Rental agreement',
      body: 'DRAFT.\n1. Parties.',
      isDraft: true,
    },
    exponent: c.exponent,
    localeConfig,
    countryNames: c.names,
    ...over,
  };
}

const textOf = (i: RentalContractInput): string =>
  buildContractBody(i)
    .map((l) => l.t)
    .join('\n');

describe.each(CASES)('US-211 — contrat de location ($country, $currency)', (c) => {
  it('critère 1 : hôte nommé, voyageur minimisé, plateforme intermédiaire jamais loueur, faits du devis et de la fiche', () => {
    const t = textOf(input(c));
    const es = t.split('Traducción de cortesía')[0] ?? '';
    expect(es).toContain('Anfitrión: María Gómez, propietario del vehículo');
    expect(es).toContain('Conductor (viajero): Ana P.');
    // la plateforme est nommée ; ce qu'elle est (intermédiaire, non partie), la pièce masquée et
    // l'interdiction de sortie du territoire sont dans les clauses du gabarit soumis à l'avocat
    expect(es).toContain('Plataforma intermediaria: Marca');
    expect(es).toContain('1. Partes.');
    expect(es).not.toMatch(/Marca (es|como) (el )?arrendador/);
    expect(es).toContain(`Total pagado, impuestos incluidos: ${c.expected.total} ${c.currency}`);
    expect(es).toContain(`franquicia de ${c.expected.deductible} ${c.currency}`);
    expect(es).toContain('plan Básica');
    expect(es).toContain(`Depósito de garantía con tarjeta: ${c.expected.deposit} ${c.currency}`);
    expect(es).toContain(`kilómetro adicional: ${c.expected.extraKm} ${c.currency}`);
    // retenue du moteur de règlement (N-199) et grille de retard (tolérance du pays)
    expect(es).toContain(
      `después se retiene 1 día de alquiler: ${c.expected.retained} ${c.currency}`,
    );
    expect(es).toContain('tolerancia de 29 min');
    expect(es).toContain('Vehículo: Toyota Yaris (2022), placa AB1234');
    expect(es).toContain('BORRADOR');
    // jamais « definitiva e inapelable » tant qu'OQ-BR-24 est ouverte
    expect(t.toLowerCase()).not.toContain('inapelable');
  });

  it('lignes du prix : la taxe de chaque ligne taxée est visible', () => {
    const base = input(c);
    const t = textOf({
      ...base,
      terms: {
        ...base.terms,
        priceLines: [{ type: 'TRIP_PRICE', amountMinor: c.deductible, taxMinor: c.deposit }],
      },
    });
    expect(t).toContain(
      `Alquiler: ${c.expected.deductible} ${c.currency} (impuestos: ${c.expected.deposit} ${c.currency})`,
    );
  });

  it('distance incohérente (mode inconnu, km ou prix absent) ⇒ refus, jamais « illimité » ni un prix à 0 deviné', () => {
    const base = input(c);
    for (const mileage of [
      { mode: 'INCLUDED', includedKm: null, extraKmPriceMinor: c.extraKm },
      { mode: 'INCLUDED', includedKm: 600, extraKmPriceMinor: null },
      { mode: 'UNLIMITED', includedKm: 600, extraKmPriceMinor: null },
    ] as const) {
      expect(() => buildContractBody({ ...base, terms: { ...base.terms, mileage } })).toThrow(
        ContractInputError,
      );
    }
  });

  it('marqueurs de signature remplacés dans le seul bloc de signature, jamais dans le texte libre', () => {
    const base = input(c);
    const body = buildContractBody({
      ...base,
      es: { ...base.es, body: 'Cláusula con {{seal}} escrito.' },
    });
    const pdf = Buffer.from(
      renderContractPdf(body, 'K v1', RENTAL_CONTRACT_RENDERER, {
        signatureId: 'sig-1',
        signedAt: new Date('2034-03-02T12:00:00.000Z'),
        documentSha256: 'b'.repeat(64),
        sealSha256: 'a'.repeat(64),
      }),
    ).toString('latin1');
    expect(pdf).toContain('{{seal}} escrito.');
    expect(pdf).toContain('a'.repeat(64));
  });

  it('mandataire : titre d’un tiers ⇒ « autorisé par procuration notariée »', () => {
    const base = input(c);
    const t = textOf({ ...base, terms: { ...base.terms, hostCapacity: 'AUTHORIZED' } });
    expect(t).toContain('autorizado por el titular del vehículo mediante poder notarial');
    expect(t).toContain('authorized by the vehicle owner through a notarized power of attorney');
  });

  it('traduction de courtoisie dans la langue du voyageur ; l’espagnol fait foi', () => {
    for (const locale of ['en', 'fr', 'pt'] as const) {
      const base = input(c);
      const t = textOf({ ...base, courtesy: { ...base.courtesy, locale } });
      const marker = {
        en: 'the Spanish text prevails',
        fr: 'le texte espagnol fait foi',
        pt: 'o texto em espanhol prevalece',
      }[locale];
      expect(t).toContain(marker);
    }
  });

  it('critère 3 : PDF déterministe ; un octet modifié ⇒ CONTRACT_HASH_MISMATCH', () => {
    const body = buildContractBody(input(c));
    const footer = contractFooter('K-ABC12345', 1);
    const a = renderContractPdf(body, footer, RENTAL_CONTRACT_RENDERER);
    const b = renderContractPdf(body, footer, RENTAL_CONTRACT_RENDERER);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const sha = contractSha256(a);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyContractPdf(a, sha)).toEqual({ ok: true });
    const tampered = Uint8Array.from(a);
    const i = Buffer.from(a).indexOf('Ana P.');
    tampered[i] = 'E'.charCodeAt(0);
    expect(verifyContractPdf(tampered, sha)).toEqual({ ok: false, code: 'CONTRACT_HASH_MISMATCH' });
    // PDF signé : autres octets, l'empreinte du document présenté ne le valide pas
    const signed = renderContractPdf(body, footer, RENTAL_CONTRACT_RENDERER, {
      signatureId: '01900000-0000-7000-8000-000000000001',
      signedAt: new Date('2034-03-02T12:00:00.000Z'),
      documentSha256: sha,
      sealSha256: 'a'.repeat(64),
    });
    expect(verifyContractPdf(signed, sha)).toEqual({ ok: false, code: 'CONTRACT_HASH_MISMATCH' });
    expect(Buffer.from(signed).toString('latin1')).toContain('2034-03-02 12:00:00 UTC');
  });
});

describe.each(CASES)('US-211 partie 211b — mise en page et PDF signé ($country)', (c) => {
  const signature = (documentSha256: string) => ({
    signatureId: '01900000-0000-7000-8000-000000000002',
    signedAt: new Date('2034-03-02T12:00:00.000Z'),
    documentSha256,
    sealSha256: 'c'.repeat(64),
  });

  it('période : nom du pays de la configuration (es et courtoisie), jamais le fuseau IANA', () => {
    const t = textOf(input(c));
    expect(t).toContain(
      `Del 2034-03-08 10:00 al 2034-03-11 10:00 (hora local de ${c.names['es'] ?? '?'})`,
    );
    expect(t).toContain(
      `From 2034-03-08 10:00 to 2034-03-11 10:00 (${c.names['en'] ?? '?'} local time)`,
    );
    expect(t).not.toContain(c.timezone);
    // nom absent de la configuration ⇒ refus (jamais le code du pays à sa place)
    expect(() =>
      buildContractBody(input(c, { countryNames: { es: c.names['es'] ?? '' } })),
    ).toThrow(ContractInputError);
  });

  it('bandeau BROUILLON en tête (sous le titre, style note), une seule fois par partie', () => {
    const body = buildContractBody(input(c));
    expect(body[0]).toEqual({ s: 'title', t: 'Contrato de alquiler' });
    expect(body[1]).toEqual({ s: 'note', t: 'BORRADOR.' });
    expect(body.filter((l) => l.t === 'BORRADOR.')).toHaveLength(1);
    expect(body.filter((l) => l.t === 'DRAFT.')).toEqual([{ s: 'note', t: 'DRAFT.' }]);
    // gabarit validé : aucune ligne retirée des clauses
    const base = input(c);
    const final = buildContractBody({ ...base, es: { ...base.es, isDraft: false } });
    expect(final[1]?.s).not.toBe('note');
    expect(final).toContainEqual({ s: 'p', t: 'BORRADOR.' });
  });

  it('nom du voyageur hors du bloc de signature : un marqueur dans un nom reste du texte', () => {
    const base = input(c);
    const body = buildContractBody({
      ...base,
      identity: { ...base.identity, guestName: 'Ana {{seal}}' },
    });
    expect(body.filter((l) => l.s === 'sig' && l.t.includes('Ana'))).toHaveLength(0);
    const pdf = Buffer.from(
      renderContractPdf(body, 'K v1', RENTAL_CONTRACT_RENDERER, signature('d'.repeat(64))),
    ).toString('latin1');
    expect(pdf).toContain('Firma: Ana {{seal}}');
    expect(pdf).toContain('c'.repeat(64));
  });

  it('PDF signé présenté : identique ⇒ ok ; un octet modifié, PDF non signé ou texte changé ⇒ CONTRACT_HASH_MISMATCH', () => {
    const body = buildContractBody(input(c));
    const footer = contractFooter('K-ABC12345', 1);
    const sha = contractSha256(renderContractPdf(body, footer, RENTAL_CONTRACT_RENDERER));
    const block = signature(sha);
    const signed = renderContractPdf(body, footer, RENTAL_CONTRACT_RENDERER, block);
    const ok = verifySignedContractPdf(signed, body, footer, RENTAL_CONTRACT_RENDERER, block);
    expect(ok).toEqual({ ok: true });
    const mismatch = { ok: false, code: 'CONTRACT_HASH_MISMATCH' };
    const tampered = Uint8Array.from(signed);
    const at = Buffer.from(signed).indexOf('c'.repeat(64));
    tampered[at] = 'd'.charCodeAt(0);
    expect(
      verifySignedContractPdf(tampered, body, footer, RENTAL_CONTRACT_RENDERER, block),
    ).toEqual(mismatch);
    const unsigned = renderContractPdf(body, footer, RENTAL_CONTRACT_RENDERER);
    expect(
      verifySignedContractPdf(unsigned, body, footer, RENTAL_CONTRACT_RENDERER, block),
    ).toEqual(mismatch);
    // texte figé différent de celui dont l'empreinte a été signée ⇒ refus, même avec son PDF
    const other = body.map((l) => (l.t === 'Conductor (viajero): Ana P.' ? { ...l, t: 'X' } : l));
    const forged = renderContractPdf(other, footer, RENTAL_CONTRACT_RENDERER, block);
    expect(verifySignedContractPdf(forged, other, footer, RENTAL_CONTRACT_RENDERER, block)).toEqual(
      mismatch,
    );
  });
});

describe('US-211 — rendu PDF', () => {
  it('structure PDF 1.4, polices standard WinAnsi, aucune date ni identifiant aléatoire', () => {
    const pdf = Buffer.from(renderPdf([{ s: 'p', t: 'Año, niño (é) \\ ₲' }], 'X v1')).toString(
      'latin1',
    );
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf).toContain('/BaseFont /Courier /Encoding /WinAnsiEncoding');
    expect(pdf).not.toMatch(/CreationDate|ModDate|\/ID/);
    // é = 0xE9 (octal 351), ñ = 0xF1 (361), parenthèses et barre oblique échappées, ₲ ⇒ ?
    expect(pdf).toContain('(A\\361o, ni\\361o \\(\\351\\) \\\\ ?) Tj');
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
  });

  it('empreinte de référence figée de ctr.pdf/1 (changer le rendu exige ctr.pdf/2)', () => {
    const pdf = renderPdf(
      [
        { s: 'title', t: 'Contrato' },
        { s: 'p', t: 'Cláusula única.' },
      ],
      'K-REF v1',
    );
    expect(contractSha256(pdf)).toBe(REFERENCE_SHA256);
  });

  it('empreinte de référence figée de ctr.pdf/1 sur plusieurs pages et octets WinAnsi hauts (211b)', () => {
    // épingle de non-régression : lignes coupées, € (0x80), « » (0xAB, 0xBB), ñ (0xF1), titres et
    // bloc de signature, plusieurs pages ; changer un octet du rendu exige ctr.pdf/2
    const lines = [
      { s: 'title' as const, t: 'Contrato — versión «prueba»' },
      { s: 'note' as const, t: 'BORRADOR — pendiente de validación jurídica' },
      ...Array.from({ length: 120 }, (_, i) => ({
        s: (i % 10 === 0 ? 'h' : 'p') as 'h' | 'p',
        t: `Cláusula ${i}: año, niño, € 1.000,50 y un texto bastante largo para que la línea se corte a la anchura de la página.`,
      })),
      { s: 'sig' as const, t: 'Huella: -' },
    ];
    const pdf = renderPdf(lines, 'K-REF2 v3');
    expect(Buffer.from(pdf).toString('latin1')).toMatch(/\/Count [3-9]/);
    expect(contractSha256(pdf)).toBe(REFERENCE_MULTIPAGE_SHA256);
  });

  it('caractères hors WinAnsi comptés (journalisés par le travailleur), jamais silencieux', () => {
    expect(nonWinAnsiCount([{ s: 'p', t: 'Łukasz ₲ ok é?' }])).toBe(2);
  });

  it('pagination : un texte long tient sur plusieurs pages numérotées', () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({ s: 'p' as const, t: `Línea ${i}` }));
    const pdf = Buffer.from(renderPdf(lines, 'K v1')).toString('latin1');
    expect(pdf).toMatch(/\/Count [2-9]/);
    expect(pdf).toContain('(K v1 - 1/');
  });
});

describe('US-211 — lecture des faits de la base', () => {
  it('forme stricte : un champ manquant ou un montant mal formé est refusé', () => {
    const c = CASES[0]!;
    const ok = { terms: input(c).terms, identity: input(c).identity };
    expect(parseContractFacts(JSON.parse(JSON.stringify(ok)))).toEqual(ok);
    expect(() =>
      parseContractFacts({ ...ok, terms: { ...ok.terms, priceTotalMinor: '12.84' } }),
    ).toThrow();
    expect(() => parseContractFacts({ terms: ok.terms })).toThrow();
  });

  it('211b : faits, valeurs calculées et texte d’un document lus strictement', () => {
    const c = CASES[0]!;
    const terms = input(c).terms;
    expect(parseContractTerms(JSON.parse(JSON.stringify(terms)))).toEqual(terms);
    expect(() => parseContractTerms({ ...terms, hostCapacity: 'AGENCY' })).toThrow();
    const derived = input(c).derived;
    expect(parseContractDerived(JSON.parse(JSON.stringify(derived)))).toEqual(derived);
    expect(parseContractDerived({ brand: 'Marca', cancellation: null })).toEqual({
      brand: 'Marca',
      cancellation: null,
    });
    expect(() =>
      parseContractDerived({
        brand: 'Marca',
        cancellation: { ...derived.cancellation, penaltyDays: '3/4' },
      }),
    ).toThrow();
    expect(parseContractBody([{ s: 'p', t: 'a' }])).toEqual([{ s: 'p', t: 'a' }]);
    for (const bad of [[], [{ s: 'script', t: 'a' }], [{ s: 'p', t: 1 }], null]) {
      expect(() => parseContractBody(bad)).toThrow(ContractInputError);
    }
  });
});

/** Empreinte du PDF de référence multi-pages (épinglée à US-211 partie 211b). */
const REFERENCE_MULTIPAGE_SHA256 =
  'd0bdd3035d67bca7438d0c06c2c49b0e6b498cc809ec8780b0c309b174d51096';

/** Empreinte du PDF de référence (calculée une fois à la création de ctr.pdf/1, US-211). */
const REFERENCE_SHA256 = '94ddc2b3920bdb5325206eb5eb5e8db0e233b19f6b8707d1ecb95c86526ce60e';
