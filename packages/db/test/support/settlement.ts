/**
 * Aides des preuves STL (US-018) : versions de règlement construites par le moteur pur
 * (`@rueda/money`, ADR-054) à partir des vecteurs dorés de l'export des oracles (US-016), puis
 * enregistrées par la seule commande `core.settlement_cmd_record` sous app_worker (travailleur
 * `settlement`). Les attendus des tests viennent de l'export (`@rueda/money/golden-vectors`),
 * jamais de ce fichier ni du code testé.
 *
 * L'adaptateur vecteur → entrées du moteur est celui des tests du moteur (US-017), exposé par le
 * sous-chemin réservé aux tests `@rueda/money/testing` : il ne contient que des ENTRÉES recopiées
 * de 08 (paramètres de test, parts assureur 7/10 et 1/2, trips N, NP, J et J3).
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  buildSettlementRecord,
  settlementRecordPayload,
  type CancellationEvent,
  type SettlementRecord,
  type SettlementTrip,
} from '@rueda/money';
import {
  legVector,
  loadGoldenVectors,
  settlementVector,
  type GoldenLegVector,
} from '@rueda/money/golden-vectors';
import { setSessionContext } from '../../src/index.ts';
import { testParams, toEvent, toTrip } from '@rueda/money/testing';

export { J3, N_MAX, NP_MAX, at } from '@rueda/money/testing';

export const uuid = (): string => randomUUID();
export const golden = loadGoldenVectors();
export const tj = (id: string): GoldenLegVector => legVector(golden, id);

/** Version d'un vecteur de règlement de l'export (ex. « T03 »), éventuellement n+1 de `previous`. */
export function recordOfVector(id: string, previous?: SettlementRecord): SettlementRecord {
  const v = settlementVector(golden, id);
  const trip = toTrip(v.trip);
  return buildSettlementRecord(trip, toEvent(v.event), testParams(trip.currency), previous);
}

/** Version calculée sur un trip et un événement donnés (paramètres de test de 08). */
export function recordOf(
  trip: SettlementTrip,
  event: CancellationEvent,
  previous?: SettlementRecord,
): SettlementRecord {
  return buildSettlementRecord(trip, event, testParams(trip.currency), previous);
}

/** Événement d'un vecteur de l'export (pour le rejouer sur un autre trip, ex. TJ18c). */
export const eventOfVector = (id: string): CancellationEvent =>
  toEvent(settlementVector(golden, id).event);
export const tripOfVector = (id: string): SettlementTrip =>
  toTrip(settlementVector(golden, id).trip);

export interface RecordArgs {
  readonly tripId: string;
  readonly version: number;
  readonly supersedesId?: string | null;
  readonly segmentNo?: number;
  /** `trip.row_version` lu au calcul (0 pour un trip de fixture jamais modifié). */
  readonly tripRowVersion?: number;
  readonly id?: string;
}

/** Appel brut de la commande (le contexte de session est celui de la transaction). */
export async function callRecord(
  tx: pg.ClientBase,
  args: RecordArgs,
  payload: unknown,
): Promise<string> {
  const id = args.id ?? uuid();
  const { rows } = await tx.query<{ id: string }>(
    `SELECT core.settlement_cmd_record($1, $2, $3, $4, $5, $6, $7::jsonb) AS id`,
    [
      id,
      args.tripId,
      args.segmentNo ?? 1,
      args.version,
      args.supersedesId ?? null,
      args.tripRowVersion ?? 0,
      JSON.stringify(payload),
    ],
  );
  return rows[0]?.id ?? '';
}

/** Enregistre une version sous le travailleur `settlement` (contexte posé dans la transaction). */
export async function recordAsSettlementWorker(
  tx: pg.ClientBase,
  args: RecordArgs,
  record: SettlementRecord,
): Promise<string> {
  await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
  return callRecord(tx, args, settlementRecordPayload(record));
}

/** Charge utile modifiable (essais de falsification). */
export const payloadOf = (record: SettlementRecord): Record<string, unknown> =>
  JSON.parse(JSON.stringify(settlementRecordPayload(record))) as Record<string, unknown>;

export interface LegRow {
  readonly leg: string;
  readonly kept: bigint;
  readonly advance: bigint;
  readonly basis: bigint;
  readonly variation: bigint;
}

/** Jambes d'une version lisibles dans la transaction (sous la RLS du rôle courant). */
export async function legsOf(tx: pg.ClientBase, settlementId: string): Promise<LegRow[]> {
  const { rows } = await tx.query<{
    leg: string;
    kept: string;
    advance: string;
    basis: string;
    variation: string;
  }>(
    `SELECT leg, kept_minor::text AS kept, advance_minor::text AS advance,
            basis_minor::text AS basis, variation_minor::text AS variation
       FROM core.settlement_settlement_leg WHERE settlement_id = $1 ORDER BY leg`,
    [settlementId],
  );
  return rows.map((r) => ({
    leg: r.leg,
    kept: BigInt(r.kept),
    advance: BigInt(r.advance),
    basis: BigInt(r.basis),
    variation: BigInt(r.variation),
  }));
}

/** `{ HOST, INSURER, TAX_THIRD_PARTY, PLATFORM }` d'une colonne des jambes lues. */
export const byLeg = (
  rows: readonly LegRow[],
  field: 'kept' | 'advance' | 'basis' | 'variation',
): Record<string, bigint> => Object.fromEntries(rows.map((r) => [r.leg, r[field]]));

/** Pose l'état capturé d'un segment (fixture 9400, en attendant cmd_apply_leg_movement). */
export async function captureLegs(
  tx: pg.ClientBase,
  tripId: string,
  legs: Readonly<Record<string, bigint>>,
  released: Readonly<Record<string, bigint>> = {},
): Promise<void> {
  for (const [leg, captured] of Object.entries(legs)) {
    await tx.query(
      `SELECT test_fixture.settlement_insert_leg_balance($1, 1, $2, $3::bigint, $4::bigint)`,
      [tripId, leg, captured.toString(), (released[leg] ?? 0n).toString()],
    );
  }
}

/** Trip BOOKED de fixture (voyageur et compte d'hôte créés s'ils manquent), row_version 0. */
export async function insertTrip(
  tx: pg.ClientBase,
  c: { readonly country: string; readonly currency: string; readonly timezone: string },
  slot: number,
  org: string = uuid(),
): Promise<{ id: string; org: string }> {
  const id = uuid();
  const day = (d: number): string => new Date(Date.UTC(2032, 0, 1) + d * 86_400_000).toISOString();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    id,
    uuid(),
    org,
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    day(slot * 3),
    day(slot * 3 + 2),
  ]);
  return { id, org };
}
