/**
 * US-211 (partie 211a) — travailleur `booking_contract` (ADR-143 ; 16 BKG-018 « déclencheur :
 * passage BOOKED », « CONTRACT_GENERATION_FAILED (bloque la confirmation, alerte ops) » ; pré-mortem
 * du lot 2 : L2-PM-33 « une version de contrat par génération demandée »). Base simulée : les
 * commandes de 0122 sont prouvées par `packages/db/test/l0/l0-us211-rental-contract.test.ts`.
 * Attendus tirés de 16 BKG-018 et de 19 US-211, jamais du code testé.
 */
import { createHash } from 'node:crypto';
import { parseLocaleConfig } from '@rueda/i18n';
import locales from '@rueda/i18n/config/locales.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import type { DomainEvent, SqlClient } from '../../../bus/index.js';
import { renderContractPdf, RENTAL_CONTRACT_RENDERER } from '../../../ctr/index.js';
import { repoConfig } from '../../../../../test/support/quote.js';
import {
  ContractGenerationError,
  localMinute,
  RentalContractGenerator,
  type ContractLogEntry,
} from './contract-generator.js';

const TRIP = '01900000-0000-7000-8000-0000000000aa';
/** Pays de premier rang de la configuration dont la devise n'a aucune décimale. */
const K = [...repoConfig.countries.values()].find((c) => c.currency.exponent === 0)!;
const FACTS = {
  terms: {
    schema: 'ctr.rental/1',
    tripRef: 'K-0190AAAA',
    country: K.code,
    currency: K.currency.code,
    timezone: K.timeZone,
    startLocal: '2034-03-08 10:00',
    endLocal: '2034-03-11 10:00',
    bookedAtLocal: '2034-03-01 09:00',
    vehicle: { make: 'Toyota', model: 'Yaris', year: 2022 },
    hostCapacity: 'OWNER',
    priceTotalMinor: '1071000',
    priceLines: [{ type: 'TRIP_PRICE', amountMinor: '1071000', taxMinor: '0' }],
    protection: {
      level: 'BASICA',
      deductibleMinor: '3500000',
      rcMinor: '150000000',
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
const SOURCE = {
  outcome: 'OK',
  tripId: TRIP,
  country: K.code,
  currency: K.currency.code,
  bookedAt: '2034-03-01T12:00:00.000Z',
  facts: FACTS,
  nextVersion: 1,
  // documents canoniques illisibles : le rejeu échoue, aucune retenue n'est écrite
  quote: {
    engineVersion: 'prc.quote/3',
    inputs: '{}',
    inputsHash: '0'.repeat(64),
    outputs: '{}',
    outputsHash: '0'.repeat(64),
    frozenAt: '2034-03-01T11:50:00.000Z',
  },
  template: { id: 't-es', version: 1, title: 'Contrato', body: 'BORRADOR.', isDraft: true },
  courtesy: { id: 't-pt', locale: 'pt', title: 'Contrato', body: 'RASCUNHO.', isDraft: true },
};

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

function generator(logs: ContractLogEntry[]) {
  return new RentalContractGenerator({
    brand: 'Marca',
    localeConfig: parseLocaleConfig(locales),
    exponentOf: (c) => repoConfig.currencies.find((x) => x.code === c)?.exponent,
    cancellationParamsOf: () => {
      throw new Error('paramètres absents');
    },
    log: (e) => logs.push(e),
  });
}

const event = (payload: Record<string, unknown>): DomainEvent =>
  ({
    eventId: '01900000-0000-7000-8000-0000000000ee',
    type: 'booking.trip.booked',
    payload,
    countryCode: K.code,
  }) as unknown as DomainEvent;

describe('US-211 — travailleur booking_contract', () => {
  it('passage BOOKED : faits relus tels quels, texte figé, empreinte du PDF rendu, clé de l’événement', async () => {
    const logs: ContractLogEntry[] = [];
    const { tx, calls } = fakeTx(SOURCE);
    await generator(logs).handle(event({ trip_id: TRIP }), tx);
    expect(calls).toHaveLength(2);
    const p = calls[1]!.params;
    expect(p[0]).toBe(TRIP);
    expect(p[1]).toBe('evt:01900000-0000-7000-8000-0000000000ee');
    expect(JSON.parse(p[2] as string)).toEqual(FACTS);
    // retenue impossible à rejouer ⇒ aucune retenue écrite (jamais un montant deviné)
    expect(JSON.parse(p[3] as string)).toEqual({ brand: 'Marca', cancellation: null });
    const body = JSON.parse(p[4] as string) as { s: 'p'; t: string }[];
    const text = body.map((l) => l.t).join('\n');
    expect(text).toContain('Conductor (viajero): Ana P.');
    expect(text).toContain('Marca actúa solo como plataforma intermediaria');
    expect(text).toContain(`franquicia de 3.500.000 ${K.currency.code}`);
    expect(text).toContain('Cancelación: según la política aceptada en la reserva.');
    expect(text).toContain('o texto em espanhol prevalece');
    expect(p[5]).toBe('t-es');
    expect(p[6]).toBe('t-pt');
    expect(p[7]).toBe(RENTAL_CONTRACT_RENDERER);
    const pdf = renderContractPdf(body, 'K-0190AAAA v1', RENTAL_CONTRACT_RENDERER);
    expect((p[8] as Buffer).toString('hex')).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect(logs.map((l) => l.outcome)).toEqual(['NO_CANCELLATION_TERMS', 'RECORDED']);
    // journaux : jamais un nom, une plaque, un montant ni un identifiant
    const logged = JSON.stringify(logs);
    for (const secret of ['Ana', 'María', 'AB1234', '1071000', TRIP]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('L2-PM-33 : événement rejoué ⇒ ALREADY_RECORDED, aucune autre version', async () => {
    const logs: ContractLogEntry[] = [];
    const { tx } = fakeTx(SOURCE, 'ALREADY_RECORDED');
    expect(await generator(logs).generate(TRIP, 'evt:x', tx)).toBe('ALREADY_RECORDED');
  });

  it('trip annulé ou déjà remis ⇒ rien n’est écrit, l’événement est consommé', async () => {
    for (const outcome of ['NOT_CONTRACTABLE', 'TRIP_UNKNOWN']) {
      const { tx, calls } = fakeTx({ outcome });
      expect(await generator([]).generate(TRIP, 'evt:x', tx)).toBe(outcome);
      expect(calls).toHaveLength(1);
    }
  });

  it('source incomplète ou gabarit absent ⇒ CONTRACT_GENERATION_FAILED journalisé et levé (rejeu, lettre morte, alerte)', async () => {
    for (const outcome of ['SOURCE_UNAVAILABLE', 'TEMPLATE_UNAVAILABLE']) {
      const logs: ContractLogEntry[] = [];
      const { tx, calls } = fakeTx({ outcome });
      await expect(generator(logs).generate(TRIP, 'evt:x', tx, K.code)).rejects.toBeInstanceOf(
        ContractGenerationError,
      );
      expect(calls).toHaveLength(1);
      expect(logs).toEqual([
        {
          event: 'booking.contract',
          outcome: 'CONTRACT_GENERATION_FAILED',
          country: K.code,
          reason: outcome,
        },
      ]);
    }
    const { tx } = fakeTx({ ...SOURCE, currency: 'XXX' });
    await expect(generator([]).generate(TRIP, 'evt:x', tx)).rejects.toThrow(/CURRENCY_UNKNOWN/);
  });

  it('faits changés entre la lecture et l’écriture (SOURCE_CHANGED) ⇒ erreur, l’événement est rejoué', async () => {
    const { tx } = fakeTx(SOURCE, 'SOURCE_CHANGED');
    await expect(generator([]).generate(TRIP, 'evt:x', tx)).rejects.toThrow(/SOURCE_CHANGED/);
  });

  it('événement sans trip_id valide ⇒ refus, aucune lecture', async () => {
    const { tx, calls } = fakeTx(SOURCE);
    await expect(generator([]).handle(event({ trip_id: 'nope' }), tx)).rejects.toBeInstanceOf(
      ContractGenerationError,
    );
    expect(calls).toHaveLength(0);
  });

  it('heure locale figée dans le document (fuseau donné)', () => {
    const at = Date.parse('2034-03-07T15:00:00.000Z');
    expect(localMinute(at, 'UTC')).toBe('2034-03-07 15:00');
    // Etc/GMT+5 = UTC−5 (convention de signe IANA)
    expect(localMinute(at, 'Etc/GMT+5')).toBe('2034-03-07 10:00');
  });
});
