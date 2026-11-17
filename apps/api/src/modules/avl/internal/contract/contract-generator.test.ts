/**
 * US-211 (partie 211a) — travailleur `booking_contract` (ADR-143 ; 16 BKG-018 « déclencheur :
 * passage BOOKED », « CONTRACT_GENERATION_FAILED (bloque la confirmation, alerte ops) » ; pré-mortem
 * du lot 2 : L2-PM-33 « une version de contrat par génération demandée »). Base simulée : les
 * commandes de 0122 sont prouvées par `packages/db/test/l0/l0-us211-rental-contract.test.ts`.
 *
 * Retenue écrite au contrat (celle que le voyageur signe ; revues argent et qa n° 1-2 de #195) :
 * devis FIGÉS RÉELS (`freezeQuote`) des vecteurs de l'oracle (`docs/specs/tools/golden_vectors.json`)
 * en exposant 2 et en exposant 0, rejoués par le travailleur ; attendu = total payé − remboursement
 * du voyageur de l'oracle, jours retenus = « j » de la qualification de 08 (1 ou ½). Jamais le code
 * testé comme oracle.
 */
import { createHash } from 'node:crypto';
import { money, type SettlementParams } from '@rueda/money';
import { settlementVector } from '@rueda/money/golden-vectors';
import { testParams } from '@rueda/money/testing';
import { parseLocaleConfig } from '@rueda/i18n';
import locales from '@rueda/i18n/config/locales.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import type { DomainEvent, SqlClient } from '../../../bus/index.js';
import { renderContractPdf, RENTAL_CONTRACT_RENDERER } from '../../../ctr/index.js';
import { freezeQuote, type QuoteParams } from '../../../prc/index.js';
import {
  caseOfGoldenTrip,
  countryOfCurrency,
  DAY_MS,
  golden,
  goldenRegistry,
  MINUTE_MS,
  repoConfig,
  T0_MS,
  testTripFeeSchedule,
} from '../../../../../test/support/quote.js';
import {
  ContractGenerationError,
  failureReason,
  localMinute,
  RentalContractGenerator,
  type ContractLogEntry,
} from './contract-generator.js';

const TRIP = '01900000-0000-7000-8000-0000000000aa';
const EVENT_ID = '01900000-0000-7000-8000-0000000000ee';

interface OracleCase {
  readonly source: Record<string, unknown>;
  readonly facts: Record<string, unknown>;
  readonly params: SettlementParams;
  readonly country: string;
}

/**
 * Source de la base pour un trip dont le devis est le devis FIGÉ d'un vecteur de l'oracle
 * (`freezeQuote`, même construction que `prc/internal/quote/frozen.test.ts`).
 */
function oracleCase(
  id: string,
  daily: bigint,
  feeBps: number | null,
  bookedAtMs?: number,
  params?: Partial<SettlementParams>,
): OracleCase {
  const v = settlementVector(golden, id);
  const base = caseOfGoldenTrip(v.trip).params;
  const qp: QuoteParams =
    feeBps === null
      ? base
      : { ...base, tripFeeSchedule: testTripFeeSchedule(base.currency, [[null, feeBps]], 0n) };
  const c = qp.currency;
  const t = v.trip.linesMinor;
  const request = {
    startAtMs: T0_MS,
    endAtMs: T0_MS + v.trip.days * DAY_MS,
    quotedAtMs: T0_MS + v.trip.bookedAtMinutes * MINUTE_MS,
    rateType: v.trip.rate,
    dailyRate: money(daily, c),
    lines: {
      PROTECTION: money(t.protection, c),
      EXTRAS: money(t.extras, c),
      ENHANCED_ROADSIDE: money(t.enhancedRoadside, c),
      ADDITIONAL_DRIVER_FEE: money(t.additionalDriver, c),
      DELIVERY_FEE: money(t.delivery, c),
    },
  };
  const { frozen } = freezeQuote(request, qp);
  // précondition : le devis figé est bien celui du vecteur (total payé de l'oracle)
  expect(frozen.totalMinor).toBe(v.trip.totalPaidMinor.toString());
  const country = countryOfCurrency(v.currency);
  const facts = {
    terms: {
      schema: 'ctr.rental/1',
      tripRef: 'K-0190AAAA',
      country,
      currency: v.currency,
      timezone: 'UTC',
      startLocal: '2026-01-14 15:00',
      endLocal: '2026-01-17 15:00',
      bookedAtLocal: '2026-01-10 15:00',
      vehicle: { make: 'Toyota', model: 'Yaris', year: 2022 },
      hostCapacity: 'OWNER',
      priceTotalMinor: frozen.totalMinor,
      priceLines: [{ type: 'TRIP_PRICE', amountMinor: frozen.totalMinor, taxMinor: '0' }],
      protection: {
        level: 'BASICA',
        deductibleMinor: '3500000',
        rcMinor: '750000000',
        insurer: 'Aseguradora de prueba',
        broker: null,
      },
      depositMinor: null,
      mileage: { mode: 'UNLIMITED', includedKm: null, extraKmPriceMinor: null },
      lateGraceMinutes: 29,
    },
    identity: {
      hostName: 'María Gómez',
      guestName: 'Ana P.',
      plate: 'AB1234',
      handoverPlace: null,
      handoverAddress: null,
      handoverCity: 'Ciudad',
    },
  };
  const source = {
    outcome: 'OK',
    tripId: TRIP,
    country,
    currency: v.currency,
    bookedAt: new Date(bookedAtMs ?? request.quotedAtMs).toISOString(),
    facts,
    nextVersion: 1,
    quote: {
      engineVersion: frozen.engineVersion,
      inputs: frozen.inputs,
      inputsHash: frozen.inputsHash,
      outputs: frozen.outputs,
      outputsHash: frozen.outputsHash,
      frozenAt: new Date(request.quotedAtMs).toISOString(),
    },
    template: { id: 't-es', version: 1, title: 'Contrato', body: 'BORRADOR.', isDraft: true },
    courtesy: { id: 't-pt', locale: 'pt', title: 'Contrato', body: 'RASCUNHO.', isDraft: true },
  };
  return {
    source,
    facts,
    params: { ...testParams(goldenRegistry.get(v.currency)), ...params },
    country,
  };
}

interface Call {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function fakeTx(source: object, recordOutcome = 'RECORDED'): { tx: SqlClient; calls: Call[] } {
  const calls: Call[] = [];
  const tx: SqlClient = {
    query: <R>(sql: string, params: readonly unknown[] = []) => {
      calls.push({ sql, params });
      const rows = sql.includes('booking_contract_source')
        ? [{ s: JSON.parse(JSON.stringify(source)) }]
        : [{ outcome: recordOutcome }];
      return Promise.resolve({ rows: rows as R[], rowCount: rows.length });
    },
  };
  return { tx, calls };
}

function generator(logs: ContractLogEntry[], params?: SettlementParams) {
  return new RentalContractGenerator({
    brand: 'Marca',
    localeConfig: parseLocaleConfig(locales),
    exponentOf: (c) => repoConfig.currencies.find((x) => x.code === c)?.exponent,
    cancellationParamsOf: () => {
      if (params === undefined) throw new Error('paramètres absents');
      return params;
    },
    log: (e) => logs.push(e),
  });
}

const event = (payload: Record<string, unknown>, country: string): DomainEvent =>
  ({
    eventId: EVENT_ID,
    type: 'booking.trip.booked',
    payload,
    countryCode: country,
  }) as unknown as DomainEvent;

/** `derived` envoyé à la base (4e paramètre de booking_cmd_record_contract). */
const derivedOf = (calls: readonly Call[]) => JSON.parse(calls[1]!.params[3] as string) as unknown;

// T03 (exposant 2, 3 jours ⇒ j = 1), T04 (exposant 2, 2 jours ⇒ j = ½), T40 (exposant 0, j = 1) ;
// retenue = total payé − remboursement du voyageur de l'oracle
const ORACLE = [
  ['T03', 4_000n, null, '1'],
  ['T04', 4_000n, null, '1/2'],
  ['T40', 333_334n, 1255, '1'],
] as const;

describe('US-211 — retenue écrite au contrat : devis figés réels de l’oracle', () => {
  it.each(ORACLE)(
    '%s : retenue et jours retenus de l’oracle écrits dans derived',
    async (id, daily, fee, days) => {
      const v = settlementVector(golden, id);
      const c = oracleCase(id, daily, fee);
      const logs: ContractLogEntry[] = [];
      const { tx, calls } = fakeTx(c.source);
      expect(await generator(logs, c.params).generate(TRIP, 'evt:x', tx)).toBe('RECORDED');
      const derived = derivedOf(calls) as {
        brand: string;
        cancellation: {
          penaltyDays: string;
          retainedMinor: string;
          engineVersion: string;
          freeUntilLocal: string;
        };
      };
      expect(derived.brand).toBe('Marca');
      expect(derived.cancellation).toMatchObject({
        penaltyDays: days,
        retainedMinor: (v.trip.totalPaidMinor - v.expected.guestRefundMinor).toString(),
        engineVersion: 'cxl-beta/1',
      });
      expect(derived.cancellation.freeUntilLocal).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      // le texte que le voyageur signe porte la même retenue
      const body = JSON.parse(calls[1]!.params[4] as string) as { t: string }[];
      expect(body.map((l) => l.t).join('\n')).toContain(
        days === '1'
          ? 'después se retiene 1 día de alquiler'
          : 'después se retiene medio día de alquiler',
      );
    },
  );

  it('aucune retenue applicable (réservée 30 min avant le départ, tolérance de no-show nulle) ⇒ cancellation null, le contrat renvoie à la politique acceptée', async () => {
    const c = oracleCase('T03', 4_000n, null, T0_MS - 30 * MINUTE_MS, { noShowGraceMinutes: 0 });
    const logs: ContractLogEntry[] = [];
    const { tx, calls } = fakeTx(c.source);
    expect(await generator(logs, c.params).generate(TRIP, 'evt:x', tx)).toBe('RECORDED');
    expect(derivedOf(calls)).toEqual({ brand: 'Marca', cancellation: null });
    const body = JSON.parse(calls[1]!.params[4] as string) as { t: string }[];
    expect(body.map((l) => l.t).join('\n')).toContain(
      'Cancelación: según la política aceptada en la reserva.',
    );
  });
});

describe('US-211 — travailleur booking_contract', () => {
  const T40 = () => oracleCase('T40', 333_334n, 1255);

  it('passage BOOKED : faits relus tels quels, texte figé, empreinte du PDF rendu, clé de l’événement, journal sans PII', async () => {
    const c = T40();
    const logs: ContractLogEntry[] = [];
    const { tx, calls } = fakeTx(c.source);
    await generator(logs, c.params).handle(event({ trip_id: TRIP }, c.country), tx);
    expect(calls).toHaveLength(2);
    const p = calls[1]!.params;
    expect(p[0]).toBe(TRIP);
    expect(p[1]).toBe(`evt:${EVENT_ID}`);
    expect(JSON.parse(p[2] as string)).toEqual(c.facts);
    const body = JSON.parse(p[4] as string) as { s: 'p'; t: string }[];
    const text = body.map((l) => l.t).join('\n');
    expect(text).toContain('Conductor (viajero): Ana P.');
    expect(text).toContain('Plataforma intermediaria: Marca');
    expect(text).toContain('o texto em espanhol prevalece');
    expect(body.filter((l) => (l.s as string) === 'sig')).toHaveLength(10);
    expect(p[5]).toBe('t-es');
    expect(p[6]).toBe('t-pt');
    expect(p[7]).toBe(RENTAL_CONTRACT_RENDERER);
    const pdf = renderContractPdf(body, 'K-0190AAAA v1', RENTAL_CONTRACT_RENDERER);
    expect((p[8] as Buffer).toString('hex')).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect(logs.map((l) => l.outcome)).toEqual(['RECORDED']);
    const logged = JSON.stringify(logs);
    for (const secret of ['Ana', 'María', 'AB1234', TRIP]) expect(logged).not.toContain(secret);
  });

  it('fail-closed : devis illisible, paramètres absents ou rejeu refusé ⇒ CONTRACT_GENERATION_FAILED journalisé, aucun contrat écrit sans sa retenue', async () => {
    const c = T40();
    const broken = {
      ...c.source,
      quote: { ...(c.source['quote'] as object), outputsHash: '0'.repeat(64) },
    };
    for (const [source, params] of [
      [broken, c.params],
      [c.source, undefined],
    ] as const) {
      const logs: ContractLogEntry[] = [];
      const { tx, calls } = fakeTx(source);
      await expect(generator(logs, params).generate(TRIP, 'evt:x', tx, c.country)).rejects.toThrow(
        /CONTRACT_GENERATION_FAILED/,
      );
      expect(calls).toHaveLength(1);
      expect(logs.map((l) => l.outcome)).toEqual(['CONTRACT_GENERATION_FAILED']);
      expect(logs[0]!.reason).toMatch(/^(QUOTE_[A-Z_]+|Error)$/);
    }
  });

  it('motif d’échec : SQLSTATE, code de devis ou nom de classe, jamais le message', () => {
    expect(failureReason(Object.assign(new Error('nom Ana'), { code: '23505' }))).toBe(
      'SQLSTATE_23505',
    );
    expect(failureReason(new TypeError('Ana'))).toBe('TypeError');
    expect(failureReason('x')).toBe('UNKNOWN');
  });

  it('L2-PM-33 : événement rejoué ⇒ ALREADY_RECORDED, aucune autre version', async () => {
    const c = T40();
    const { tx } = fakeTx(c.source, 'ALREADY_RECORDED');
    expect(await generator([], c.params).generate(TRIP, 'evt:x', tx)).toBe('ALREADY_RECORDED');
  });

  it('trip annulé ou déjà remis ⇒ rien n’est écrit, l’événement est consommé', async () => {
    for (const outcome of ['NOT_CONTRACTABLE', 'TRIP_UNKNOWN']) {
      const { tx, calls } = fakeTx({ outcome });
      expect(await generator([]).generate(TRIP, 'evt:x', tx)).toBe(outcome);
      expect(calls).toHaveLength(1);
    }
  });

  it('source incomplète ou gabarit absent ⇒ CONTRACT_GENERATION_FAILED journalisé et levé (rejeu, lettre morte, alerte)', async () => {
    const country = T40().country;
    for (const outcome of ['SOURCE_UNAVAILABLE', 'TEMPLATE_UNAVAILABLE']) {
      const logs: ContractLogEntry[] = [];
      const { tx, calls } = fakeTx({ outcome });
      await expect(generator(logs).generate(TRIP, 'evt:x', tx, country)).rejects.toBeInstanceOf(
        ContractGenerationError,
      );
      expect(calls).toHaveLength(1);
      expect(logs).toEqual([
        {
          event: 'booking.contract',
          outcome: 'CONTRACT_GENERATION_FAILED',
          country,
          reason: outcome,
        },
      ]);
    }
    const { tx } = fakeTx({ ...T40().source, currency: 'XXX' });
    await expect(generator([]).generate(TRIP, 'evt:x', tx)).rejects.toThrow(/CURRENCY_UNKNOWN/);
  });

  it('faits changés entre la lecture et l’écriture (SOURCE_CHANGED) ⇒ erreur, l’événement est rejoué', async () => {
    const c = T40();
    const { tx } = fakeTx(c.source, 'SOURCE_CHANGED');
    await expect(generator([], c.params).generate(TRIP, 'evt:x', tx)).rejects.toThrow(
      /SOURCE_CHANGED/,
    );
  });

  it('événement sans trip_id valide ⇒ refus, aucune lecture', async () => {
    const { tx, calls } = fakeTx(T40().source);
    await expect(
      generator([]).handle(event({ trip_id: 'nope' }, T40().country), tx),
    ).rejects.toBeInstanceOf(ContractGenerationError);
    expect(calls).toHaveLength(0);
  });

  it('heure locale figée dans le document (fuseau donné)', () => {
    const at = Date.parse('2034-03-07T15:00:00.000Z');
    expect(localMinute(at, 'UTC')).toBe('2034-03-07 15:00');
    // Etc/GMT+5 = UTC−5 (convention de signe IANA)
    expect(localMinute(at, 'Etc/GMT+5')).toBe('2034-03-07 10:00');
  });
});
