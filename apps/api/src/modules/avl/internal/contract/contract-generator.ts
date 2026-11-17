/**
 * Travailleur `booking_contract` (US-211, ADR-143 ; 16 BKG-018 « déclencheur : passage BOOKED » ;
 * 17 §4.5 : CTR consomme `booking.trip.booked`) : génère le contrat de location hôte–voyageur d'un
 * trip, dans la transaction qui écrit le reçu de l'événement (module BUS).
 *   1. `core.booking_contract_source` : faits lus par la base (devis figé, assureur et caution à la
 *      réservation, véhicule, parties minimisées), devis canonique, gabarits, version suivante ;
 *   2. retenue d'une annulation hors fenêtre gratuite par le moteur de règlement UNIQUE, sur le
 *      devis figé REJOUÉ (PRC, `lateCancellationOf`, la même que S05 : N-199) ; rejeu impossible ⇒
 *      aucune retenue écrite (le contrat renvoie à la politique acceptée, jamais un montant deviné) ;
 *   3. texte du contrat (CTR, figé), PDF déterministe, empreinte SHA-256 ;
 *   4. `core.booking_cmd_record_contract` : la base relit les faits et refuse tout écart.
 * Idempotent : clé `evt:<identifiant de l'événement>` (un événement rejoué ⇒ ALREADY_RECORDED,
 * L2-PM-33). Faits changés entre la lecture et l'écriture ⇒ erreur, l'événement est rejoué.
 * Source incomplète ou gabarit absent ⇒ CONTRACT_GENERATION_FAILED (16 BKG-018), journalisé et
 * levé : rejoué puis lettre morte, alerte d'exploitation ; la remise reste refusée (fail-closed).
 * Journaux : issue, pays et motif court. Jamais un nom, une plaque, un montant ni un identifiant.
 */
import type { SettlementParams } from '@rueda/money';
import type { LocaleConfig } from '@rueda/i18n';
import type { BusRegistry, DomainEvent, SqlClient } from '../../../bus/index.js';
import {
  buildContractBody,
  contractFooter,
  contractSha256,
  nonWinAnsiCount,
  parseContractFacts,
  renderContractPdf,
  RENTAL_CONTRACT_RENDERER,
  type ContractCancellation,
  type CourtesyLocale,
} from '../../../ctr/index.js';
import {
  FROZEN_QUOTE_FORMAT,
  isQuoteError,
  lateCancellationOf,
  penaltyDaysLabel,
  replayFrozenQuote,
} from '../../../prc/index.js';

export const BOOKING_CONTRACT_WORKER = 'booking_contract';
export const TRIP_BOOKED_EVENT = 'booking.trip.booked';

export type ContractOutcome =
  | 'RECORDED'
  | 'ALREADY_RECORDED'
  | 'TRIP_UNKNOWN'
  | 'NOT_CONTRACTABLE'
  | 'CONTRACT_GENERATION_FAILED';

export interface ContractLogEntry {
  readonly event: 'booking.contract';
  readonly outcome: ContractOutcome | 'NON_WINANSI_TEXT';
  readonly country: string | null;
  readonly reason: string | null;
}

export interface ContractGeneratorDeps {
  /** Nom de marque (DEC-MARQUE, donnée de thème ; `RUEDA_BRAND_NAME`). */
  readonly brand: string;
  readonly localeConfig: LocaleConfig;
  /** Exposant d'une devise (CFG) ; inconnu ⇒ génération refusée. */
  readonly exponentOf: (currency: string) => number | undefined;
  /** Nom du pays dans chaque langue (CFG, `names`) ; inconnu ⇒ génération refusée (211b). */
  readonly countryNamesOf: (country: string) => Readonly<Record<string, string>> | undefined;
  /** Paramètres d'annulation du pays à un instant (PRC, CFG) ; lève s'ils manquent. */
  readonly cancellationParamsOf: (ctx: {
    readonly country: string;
    readonly at: Date;
  }) => SettlementParams;
  readonly log?: (entry: ContractLogEntry) => void;
}

export class ContractGenerationError extends Error {
  override readonly name = 'ContractGenerationError';
}

type Rec = Readonly<Record<string, unknown>>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COURTESY: readonly CourtesyLocale[] = ['en', 'fr', 'pt'];

function text(o: Rec, k: string): string {
  const v = o[k];
  if (typeof v !== 'string') throw new ContractGenerationError(`source : ${k} attendu`);
  return v;
}

/**
 * Motif court d'un échec, sans donnée personnelle : SQLSTATE d'une erreur de la base, code d'une
 * erreur de devis, sinon le nom de la classe d'erreur.
 */
export function failureReason(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return `SQLSTATE_${code}`;
    if (isQuoteError(error)) return `QUOTE_${error.code}`;
    if (error instanceof Error) return error.name;
  }
  return 'UNKNOWN';
}

/** Heure locale « AAAA-MM-JJ HH:MM » d'un instant dans un fuseau (figée dans le document). */
export function localMinute(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export class RentalContractGenerator {
  readonly #deps: ContractGeneratorDeps;
  readonly #log: (entry: ContractLogEntry) => void;

  constructor(deps: ContractGeneratorDeps) {
    this.#deps = deps;
    this.#log = deps.log ?? ((entry) => console.log(JSON.stringify({ level: 'info', ...entry })));
  }

  async handle(event: DomainEvent, tx: SqlClient): Promise<void> {
    const tripId = event.payload['trip_id'];
    if (typeof tripId !== 'string' || !UUID.test(tripId)) {
      throw new ContractGenerationError('booking_contract : trip_id manquant ou invalide');
    }
    await this.generate(tripId.toLowerCase(), `evt:${event.eventId}`, tx, event.countryCode);
  }

  /** Génère (ou retrouve) la version demandée par `triggerKey` ; rend l'issue. */
  async generate(
    tripId: string,
    triggerKey: string,
    tx: SqlClient,
    country: string | null = null,
  ): Promise<ContractOutcome> {
    const { rows } = await tx.query<{ s: unknown }>(
      'SELECT core.booking_contract_source($1::uuid) AS s',
      [tripId],
    );
    const source = rows[0]?.s;
    if (!isRec(source)) throw new ContractGenerationError('source absente');
    const outcome = text(source, 'outcome');
    if (outcome === 'TRIP_UNKNOWN' || outcome === 'NOT_CONTRACTABLE') {
      this.#log({ event: 'booking.contract', outcome, country, reason: null });
      return outcome;
    }
    if (outcome !== 'OK') return this.#failed(country, outcome);
    const cc = text(source, 'country');
    const currency = text(source, 'currency');
    const exponent = this.#deps.exponentOf(currency);
    if (exponent === undefined) return this.#failed(cc, 'CURRENCY_UNKNOWN');
    const names = this.#deps.countryNamesOf(cc);
    if (names === undefined) return this.#failed(cc, 'COUNTRY_UNKNOWN');

    let body;
    let facts;
    try {
      facts = parseContractFacts(source['facts']);
      const template = source['template'];
      const courtesy = source['courtesy'];
      if (!isRec(template) || !isRec(courtesy)) throw new ContractGenerationError('gabarits');
      const locale = text(courtesy, 'locale') as CourtesyLocale;
      if (!COURTESY.includes(locale)) throw new ContractGenerationError('langue de courtoisie');
      const version = source['nextVersion'];
      if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
        throw new ContractGenerationError('version');
      }
      const cancellation = this.#cancellation(source, facts.terms.timezone, cc);
      body = buildContractBody({
        terms: facts.terms,
        identity: facts.identity,
        derived: { brand: this.#deps.brand, cancellation },
        version,
        es: {
          title: text(template, 'title'),
          body: text(template, 'body'),
          isDraft: template['isDraft'] === true,
        },
        courtesy: {
          locale,
          title: text(courtesy, 'title'),
          body: text(courtesy, 'body'),
          isDraft: courtesy['isDraft'] === true,
        },
        exponent,
        localeConfig: this.#deps.localeConfig,
        countryNames: names,
      });
      const odd = nonWinAnsiCount(body);
      if (odd > 0) {
        // compte seul (jamais le texte) : un nom rendu « ? » se voit à l'exploitation
        this.#log({
          event: 'booking.contract',
          outcome: 'NON_WINANSI_TEXT',
          country: cc,
          reason: String(odd),
        });
      }
      const pdf = renderContractPdf(
        body,
        contractFooter(facts.terms.tripRef, version),
        RENTAL_CONTRACT_RENDERER,
      );
      const sha = contractSha256(pdf);
      const rec = await tx.query<{ outcome: string }>(
        `SELECT outcome FROM core.booking_cmd_record_contract($1::uuid, $2, $3::jsonb, $4::jsonb,
                                                              $5::jsonb, $6::uuid, $7::uuid, $8,
                                                              $9::bytea)`,
        [
          tripId,
          triggerKey,
          JSON.stringify(source['facts']),
          JSON.stringify({ brand: this.#deps.brand, cancellation }),
          JSON.stringify(body),
          text(template, 'id'),
          text(courtesy, 'id'),
          RENTAL_CONTRACT_RENDERER,
          Buffer.from(sha, 'hex'),
        ],
      );
      const recorded = rec.rows[0]?.outcome;
      if (recorded === 'RECORDED' || recorded === 'ALREADY_RECORDED') {
        this.#log({ event: 'booking.contract', outcome: recorded, country: cc, reason: null });
        return recorded;
      }
      if (recorded === 'TRIP_UNKNOWN' || recorded === 'NOT_CONTRACTABLE') {
        this.#log({ event: 'booking.contract', outcome: recorded, country: cc, reason: null });
        return recorded;
      }
      // SOURCE_CHANGED (faits ou gabarits changés entre la lecture et l'écriture) : rejeu
      throw new ContractGenerationError(`enregistrement : ${String(recorded)}`);
    } catch (error) {
      if (error instanceof ContractGenerationError) throw error;
      return this.#failed(cc, failureReason(error));
    }
  }

  #failed(country: string | null, reason: string): never {
    this.#log({
      event: 'booking.contract',
      outcome: 'CONTRACT_GENERATION_FAILED',
      country,
      reason,
    });
    throw new ContractGenerationError(`CONTRACT_GENERATION_FAILED (${reason})`);
  }

  /**
   * Retenue hors fenêtre gratuite (moteur de règlement unique, devis figé rejoué), fail-closed :
   * `null` seulement quand le moteur ne prévoit aucune retenue applicable (annulation tardive
   * impossible avant le no-show, ou jours retenus ni 1 ni ½) ; toute autre erreur (devis illisible,
   * rejeu refusé, paramètres absents, bogue) fait échouer la génération : jamais un contrat signable
   * sans la retenue qu'il doit porter.
   */
  #cancellation(source: Rec, timeZone: string, country: string): ContractCancellation | null {
    const q = source['quote'];
    const facts = source['facts'];
    if (!isRec(q) || !isRec(facts) || !isRec(facts['terms'])) {
      throw new TypeError('devis canonique absent de la source');
    }
    const quote = replayFrozenQuote({
      format: FROZEN_QUOTE_FORMAT,
      engineVersion: text(q, 'engineVersion'),
      inputs: text(q, 'inputs'),
      inputsHash: text(q, 'inputsHash'),
      outputs: text(q, 'outputs'),
      outputsHash: text(q, 'outputsHash'),
      totalMinor: text(facts['terms'], 'priceTotalMinor'),
      currency: text(source, 'currency'),
    });
    const bookedAtMs = Date.parse(text(source, 'bookedAt'));
    if (!Number.isFinite(bookedAtMs)) throw new TypeError('instant de réservation illisible');
    const params = this.#deps.cancellationParamsOf({ country, at: new Date(bookedAtMs) });
    const late = lateCancellationOf(quote, params, Math.min(bookedAtMs, quote.startAtMs));
    if (late === null) return null;
    const penaltyDays = penaltyDaysLabel(late.penaltyDays);
    // jours retenus sans libellé (ni 1 ni ½) : jamais un contrat « selon la politique » à la place
    // d'une retenue connue du moteur (fail-closed ; revues argent n° 6 et code n° 5 de #195)
    if (penaltyDays === null) throw new ContractGenerationError('jours de retenue sans libellé');
    return {
      freeUntilLocal: localMinute(late.freeUntilMs, timeZone),
      penaltyDays,
      retainedMinor: late.retained.amountMinor.toString(),
      engineVersion: late.engineVersion,
    };
  }
}

/** Consommateur `booking_contract` de `booking.trip.booked`. */
export function registerRentalContracts(
  registry: BusRegistry,
  generator: RentalContractGenerator,
): void {
  registry.registerConsumer(BOOKING_CONTRACT_WORKER, [TRIP_BOOKED_EVENT], (event, tx) =>
    generator.handle(event, tx),
  );
}
