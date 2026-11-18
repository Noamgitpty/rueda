/**
 * Service de la constancia d'arrendamiento d'un trip pour ses parties (US-212, ADR-162 ; 16 LEG-026 ;
 * 10b S07, S09, A05, UX-51). Lit les faits figés du dernier contrat (port `TripConstanciaStore`),
 * en tire :
 *   - un RÉSUMÉ (plaque, période locale, hôte en prénom et initiale, conducteur, lieu de remise,
 *     total payé, signature) que l'écran affiche en tête ;
 *   - l'ÉQUIVALENT HTML du PDF (UX-51) : le texte tel qu'imprimé, partie espagnole (fait foi) puis
 *     la langue du lecteur (anglais pour un lecteur hispanophone) ;
 *   - le PDF lui-même, rendu de nouveau à chaque demande (aucun fichier stocké), et son empreinte.
 * Recherche de l'hôte par plaque et date (EC-48) : la base ne rend que les trips de son compte.
 * Journaux : issue et code seulement, jamais un nom, une plaque, un montant ni un identifiant.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { parseLocaleConfig } from '@rueda/i18n';
import type { LocaleConfig } from '@rueda/i18n';
import locales from '@rueda/i18n/config/locales.json' with { type: 'json' };
import { CountryConfigService } from '../../../cfg/index.js';
import type { ContractLine } from '../contract/pdf.js';
import { CTR_CONSTANCIA_STORE } from '../tokens.js';
import {
  buildConstanciaBody,
  CONSTANCIA_RENDERER,
  CONSTANCIA_TEMPLATE_DRAFT,
  CONSTANCIA_TEMPLATE_VERSION,
  constanciaFooter,
  ConstanciaInputError,
  constanciaLocaleOf,
  constanciaSha256,
  parseConstanciaFacts,
  renderConstanciaPdf,
  splitConstanciaBody,
} from './constancia.js';
import type { ConstanciaFacts, ConstanciaLocale } from './constancia.js';
import { ConstanciaHttpError } from './errors.js';
import type { ConstanciaSearchRow, TripConstanciaStore } from './constancia.store.js';
import { ConstanciaStoreError } from './constancia.store.js';

export interface ConstanciaLineView {
  readonly style: ContractLine['s'];
  readonly text: string;
}

export interface ConstanciaPartView {
  readonly lang: string;
  readonly authoritative: boolean;
  readonly lines: readonly ConstanciaLineView[];
}

export interface TripConstanciaView {
  readonly tripId: string;
  readonly viewerRole: 'GUEST' | 'HOST';
  readonly contractVersion: number;
  readonly courtesyLocale: ConstanciaLocale;
  /** SHA-256 (hexadécimal) du PDF que `GET …/constancia/pdf` sert pour les mêmes faits. */
  readonly sha256: string;
  readonly renderer: string;
  readonly templateVersion: number;
  readonly draft: boolean;
  readonly summary: {
    readonly tripRef: string;
    readonly tripStatus: string;
    readonly country: string;
    readonly startLocal: string;
    readonly endLocal: string;
    readonly vehicle: ConstanciaFacts['vehicle'];
    readonly plate: string;
    readonly hostName: string;
    readonly hostCapacity: ConstanciaFacts['hostCapacity'];
    readonly driverName: string;
    readonly handoverPlace: string | null;
    readonly handoverCity: string;
    readonly currency: string;
    readonly currencyExponent: number;
    readonly priceTotalMinor: string;
    readonly signedAtLocal: string | null;
  };
  readonly parts: readonly ConstanciaPartView[];
}

export interface ConstanciaPdf {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly sha256: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const LOCALE_CONFIG: LocaleConfig = parseLocaleConfig(locales);

interface Rendered {
  readonly facts: ConstanciaFacts;
  readonly courtesy: ConstanciaLocale;
  readonly exponent: number;
  readonly body: ContractLine[];
  readonly bytes: Uint8Array;
}

/** Partie espagnole, puis la langue du lecteur (à partir de sa note, avant son titre). */
function partsOf(lines: readonly ContractLine[], courtesy: string): ConstanciaPartView[] {
  const view = (l: ContractLine): ConstanciaLineView => ({ style: l.s, text: l.t });
  const [es, reader] = splitConstanciaBody(lines);
  return [
    { lang: 'es', authoritative: true, lines: es.map(view) },
    { lang: courtesy, authoritative: false, lines: reader.map(view) },
  ];
}

@Injectable()
export class TripConstanciaService {
  readonly #logger = new Logger('TripConstancia');

  constructor(
    @Inject(CTR_CONSTANCIA_STORE) private readonly store: TripConstanciaStore,
    @Inject(CountryConfigService) private readonly countries: CountryConfigService,
  ) {}

  #unavailable(operation: string, error: unknown): ConstanciaHttpError {
    const sqlstate = error instanceof ConstanciaStoreError ? (error.sqlstate ?? null) : null;
    this.#logger.error(
      JSON.stringify({ event: 'trip.constancia', operation, outcome: 'UNAVAILABLE', sqlstate }),
    );
    return new ConstanciaHttpError('CONSTANCIA_UNAVAILABLE');
  }

  #failed(operation: string, error: unknown): ConstanciaHttpError {
    const reason = error instanceof ConstanciaInputError ? 'SHAPE' : 'OTHER';
    this.#logger.error(
      JSON.stringify({ event: 'trip.constancia', operation, outcome: 'GENERATION_FAILED', reason }),
    );
    return new ConstanciaHttpError('DOCUMENT_GENERATION_FAILED');
  }

  /** Faits lus, texte et PDF rendus (mêmes faits ⇒ mêmes octets). */
  async #render(proof: Buffer | null, tripId: string, operation: string): Promise<Rendered> {
    if (proof === null) throw new ConstanciaHttpError('AUTH_REQUIRED');
    // identifiant mal formé ⇒ même 404 qu'un trip inconnu ou d'une autre personne (aucun oracle)
    if (!UUID.test(tripId)) throw new ConstanciaHttpError('CONSTANCIA_NOT_FOUND');
    let read;
    try {
      read = await this.store.read(proof, tripId);
    } catch (error) {
      throw this.#unavailable(operation, error);
    }
    switch (read.outcome) {
      case 'NOT_FOUND':
        throw new ConstanciaHttpError('CONSTANCIA_NOT_FOUND');
      case 'NOT_AVAILABLE':
        throw new ConstanciaHttpError('CONSTANCIA_NOT_AVAILABLE');
      case 'NOT_GENERATED':
        throw new ConstanciaHttpError('CONSTANCIA_NOT_GENERATED');
      case 'ERASED':
        throw new ConstanciaHttpError('CONSTANCIA_ERASED');
      case 'OK':
        break;
    }
    try {
      const facts = parseConstanciaFacts(read.row);
      const exponent = this.countries.config.currencies.find(
        (c) => c.code === facts.currency,
      )?.exponent;
      const names = this.countries.config.countries.get(facts.country)?.names;
      if (exponent === undefined || names === undefined) {
        throw new ConstanciaInputError('devise ou pays inconnu');
      }
      const courtesy = constanciaLocaleOf(facts.viewerLocale);
      const body = buildConstanciaBody({
        facts,
        courtesy,
        exponent,
        localeConfig: LOCALE_CONFIG,
        countryNames: names,
      });
      const bytes = renderConstanciaPdf(
        body,
        constanciaFooter(facts.tripRef, facts.contractVersion),
      );
      return { facts, courtesy, exponent, body, bytes };
    } catch (error) {
      throw this.#failed(operation, error);
    }
  }

  async view(proof: Buffer | null, tripId: string): Promise<TripConstanciaView> {
    const r = await this.#render(proof, tripId, 'view');
    const f = r.facts;
    return {
      tripId,
      viewerRole: f.viewerRole,
      contractVersion: f.contractVersion,
      courtesyLocale: r.courtesy,
      sha256: constanciaSha256(r.bytes),
      renderer: CONSTANCIA_RENDERER,
      templateVersion: CONSTANCIA_TEMPLATE_VERSION,
      draft: CONSTANCIA_TEMPLATE_DRAFT,
      summary: {
        tripRef: f.tripRef,
        tripStatus: f.tripStatus,
        country: f.country,
        startLocal: f.startLocal,
        endLocal: f.endLocal,
        vehicle: f.vehicle,
        plate: f.plate,
        hostName: f.hostName,
        hostCapacity: f.hostCapacity,
        driverName: f.driverName,
        handoverPlace: f.handoverPlace,
        handoverCity: f.handoverCity,
        currency: f.currency,
        currencyExponent: r.exponent,
        priceTotalMinor: f.priceTotalMinor,
        signedAtLocal: f.signedAtLocal,
      },
      parts: partsOf(r.body, r.courtesy),
    };
  }

  async pdf(proof: Buffer | null, tripId: string): Promise<ConstanciaPdf> {
    const r = await this.#render(proof, tripId, 'pdf');
    const safeRef = r.facts.tripRef.replace(/[^A-Za-z0-9-]/g, '');
    this.#logger.log(JSON.stringify({ event: 'trip.constancia', operation: 'pdf', outcome: 'OK' }));
    return {
      bytes: r.bytes,
      fileName: `constancia-${safeRef}-v${r.facts.contractVersion}-es-${r.courtesy}.pdf`,
      sha256: constanciaSha256(r.bytes),
    };
  }

  /** Recherche de l'hôte (EC-48) : `{ plate, date }`, date locale `AAAA-MM-JJ`. */
  async search(
    proof: Buffer | null,
    body: unknown,
  ): Promise<{ readonly trips: readonly ConstanciaSearchRow[] }> {
    if (proof === null) throw new ConstanciaHttpError('AUTH_REQUIRED');
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new ConstanciaHttpError('REQUEST_INVALID');
    }
    const b = body as Record<string, unknown>;
    const keys = Object.keys(b).sort();
    const plate = b['plate'];
    const date = b['date'];
    if (
      keys.length !== 2 ||
      keys[0] !== 'date' ||
      keys[1] !== 'plate' ||
      typeof plate !== 'string' ||
      plate.length < 2 ||
      plate.length > 32 ||
      typeof date !== 'string' ||
      !DATE.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`))
    ) {
      throw new ConstanciaHttpError('REQUEST_INVALID');
    }
    let r;
    try {
      r = await this.store.search(proof, plate, date);
    } catch (error) {
      throw this.#unavailable('search', error);
    }
    if (r.outcome !== 'DONE') throw new ConstanciaHttpError(r.outcome);
    this.#logger.log(
      JSON.stringify({ event: 'trip.constancia', operation: 'search', count: r.trips.length }),
    );
    return { trips: r.trips };
  }
}
