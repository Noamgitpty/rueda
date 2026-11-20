/**
 * US-307 (migration 0171, ADR-191 ; revue qa n° 1 de la PR #283) — preuves NÉGATIVES du
 * vérificateur en base du moteur `cxl-beta/2` (`core.settlement_verify_cxl_beta_2`, rejeu de 0054
 * choisi par la version stockée), en USD (PA) et en PYG (PY), sous `app_worker` (assertion L0-05 par
 * `withRole`), transactions ANNULÉES :
 *   (a) un règlement stocké `cxl-beta/1` qui porte la ligne n° 8 (`CLEANLINESS_SAFETY_VALID`) est
 *       refusé : ce motif n'existe pas dans `cxl-beta/1` ;
 *   (b) un règlement `cxl-beta/2` de la ligne n° 8 dont la pénalité, l'état cible ou le motif est
 *       altéré est refusé (`settlement_replay_mismatch`) ;
 *   (c) une version n+1 qui change de version du moteur est refusée
 *       (`settlement_trip_inputs_changed`) ;
 *   (d) un barème `host_penalty` sans `cleanliness` (ou absent) est refusé
 *       (`settlement_replay_input_invalid`), jamais une pénalité 0.
 * Témoin : la version intacte est acceptée. Les entrées viennent des vecteurs de l'export (trip A de
 * T14, trip D de T27) ; aucun montant attendu n'est calculé ici (le témoin est la base elle-même).
 */
import {
  buildSettlementRecord,
  settlementInputsCanonical,
  settlementInputsHash,
  settlementParamsHash,
  settlementRecordPayload,
  type CancellationEvent,
  type SettlementParams,
  type SettlementRecord,
  type SettlementTrip,
} from '@rueda/money';
import { testParams } from '@rueda/money/testing';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { callRecord, captureLegs, insertTrip, tj, tripOfVector } from '../support/settlement.ts';

type Payload = Record<string, unknown>;
const VECTORS: Readonly<Record<string, { trip: string; capture: string }>> = {
  USD: { trip: 'T14', capture: 'TJ01' },
  PYG: { trip: 'T27', capture: 'TJ08a' },
};

const worker = <T>(fn: (tx: pg.ClientBase) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) => withTestTransaction(client, {}, fn));

/** Contrainte levée par `run` (contrôles différés exécutés), ou 'OK' ; transaction utilisable. */
async function outcome(tx: pg.ClientBase, run: () => Promise<unknown>): Promise<string> {
  await tx.query('SAVEPOINT us307_verifier');
  try {
    await run();
    await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT us307_verifier');
    return String((error as { constraint?: unknown }).constraint ?? 'SANS_CONTRAINTE');
  }
  await tx.query('SET CONSTRAINTS ALL DEFERRED');
  await tx.query('RELEASE SAVEPOINT us307_verifier');
  return 'OK';
}

const event = (trip: SettlementTrip): CancellationEvent => ({
  reason: 'CLEANLINESS_SAFETY_VALID',
  requestedAtMs: trip.startAtMs + 10 * 60_000,
  subReason: 'CLEANLINESS',
  checkinValidated: false,
});

/** Charge utile réécrite à une autre version ou d'autres paramètres, empreintes recalculées. */
function rewritten(
  record: SettlementRecord,
  trip: SettlementTrip,
  ev: CancellationEvent,
  version: string,
  params: SettlementParams,
): Payload {
  const p = { ...settlementRecordPayload(record) } as Payload;
  p.engineVersion = version;
  p.inputs = settlementInputsCanonical(version, trip, ev, params);
  p.inputsHash = settlementInputsHash(version, trip, ev, params);
  p.paramSnapshotHash = settlementParamsHash(params);
  return p;
}

describe.each(COUNTRIES.filter((c) => VECTORS[c.currency] !== undefined))(
  'US-307 — vérificateur cxl-beta/2, preuves négatives — $country ($currency)',
  (c) => {
    const v = VECTORS[c.currency]!;
    const trip = tripOfVector(v.trip);
    const params = testParams(trip.currency);
    const ev = event(trip);
    const record = buildSettlementRecord(trip, ev, params);

    /** Trip neuf capturé (état de la capture du vecteur), version 1 proposée. */
    async function propose(tx: pg.ClientBase, slot: number, payload: Payload): Promise<string> {
      const t = await insertTrip(tx, c, slot);
      await captureLegs(tx, t.id, tj(v.capture).legsMinor);
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
      return outcome(tx, () => callRecord(tx, { tripId: t.id, version: 1 }, payload));
    }

    it('témoin : la ligne n° 8 intacte est acceptée (cxl-beta/2)', async () => {
      expect(record.engineVersion).toBe('cxl-beta/2');
      await worker(async (tx) => {
        expect(await propose(tx, 60, { ...settlementRecordPayload(record) })).toBe('OK');
      });
    });

    it('(a) un règlement cxl-beta/1 portant CLEANLINESS_SAFETY_VALID est refusé', async () => {
      await worker(async (tx) => {
        const p = rewritten(record, trip, ev, 'cxl-beta/1', params);
        expect(await propose(tx, 61, p)).toBe('settlement_replay_input_invalid');
      });
    });

    it.each<[string, (p: Payload) => void]>([
      [
        'pénalité + 1',
        (p) => (p.hostPenaltyMinor = (BigInt(String(p.hostPenaltyMinor)) + 1n).toString()),
      ],
      ['pénalité 0', (p) => (p.hostPenaltyMinor = '0')],
      ['état cible CANCELLED_BY_HOST', (p) => (p.targetState = 'CANCELLED_BY_HOST')],
      ['motif qualifié HOST_CANCELLED', (p) => (p.reason = 'HOST_CANCELLED')],
    ])('(b) %s ⇒ settlement_replay_mismatch', async (_label, mutate) => {
      await worker(async (tx) => {
        const p = { ...settlementRecordPayload(record) } as Payload;
        mutate(p);
        expect(await propose(tx, 62, p)).toBe('settlement_replay_mismatch');
      });
    });

    it('(c) une version n+1 qui change de version du moteur ⇒ settlement_trip_inputs_changed', async () => {
      await worker(async (tx) => {
        const t = await insertTrip(tx, c, 63);
        await captureLegs(tx, t.id, tj(v.capture).legsMinor);
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
        // v1 : annulation de l'hôte (cxl-beta/2) ; v2 : ligne n° 8, réécrite en cxl-beta/1
        const hostEv: CancellationEvent = {
          reason: 'HOST_CANCELLED',
          requestedAtMs: trip.startAtMs + 10 * 60_000,
          checkinValidated: false,
        };
        const v1 = buildSettlementRecord(trip, hostEv, params);
        const v1Id = await callRecord(
          tx,
          { tripId: t.id, version: 1 },
          settlementRecordPayload(v1),
        );
        const v2 = buildSettlementRecord(trip, { ...hostEv, hostPenaltyWaived: true }, params, v1);
        const p = rewritten(v2, trip, { ...hostEv, hostPenaltyWaived: true }, 'cxl-beta/1', params);
        expect(
          await outcome(tx, () =>
            callRecord(tx, { tripId: t.id, version: 2, supersedesId: v1Id }, p),
          ),
        ).toBe('settlement_trip_inputs_changed');
      });
    });

    it.each<[string, SettlementParams]>([
      [
        'barème sans cleanliness',
        (() => {
          const { hostPenalty, ...rest } = params;
          if (hostPenalty === undefined) throw new Error('barème de test attendu');
          const partial = Object.fromEntries(
            Object.entries(hostPenalty).filter(([k]) => k !== 'cleanliness'),
          );
          return { ...rest, hostPenalty: partial } as unknown as SettlementParams;
        })(),
      ],
      [
        'barème absent',
        Object.fromEntries(
          Object.entries(params).filter(([k]) => k !== 'hostPenalty'),
        ) as unknown as SettlementParams,
      ],
    ])('(d) %s ⇒ refusé, jamais une pénalité 0', async (_label, without) => {
      await worker(async (tx) => {
        const p = rewritten(record, trip, ev, 'cxl-beta/2', without);
        p.hostPenaltyMinor = '0';
        expect(await propose(tx, 64, p)).toBe('settlement_replay_input_invalid');
      });
    });
  },
);
