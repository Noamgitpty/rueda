/**
 * Aides de la red team « concurrence » d'US-049 (19 US-049 critère 4 ; 17 §2.5, §11 C1–C20).
 *
 * Toutes les connexions passent par `connectAs` / `withRole` (assertion L0-05 en tête, rôles de
 * production seulement). Les valeurs attendues des attaques viennent de 17 (§2.5, §7.2 : tampon
 * `buffer_minutes` = 120, `hold_ttl_minutes` = 10) et de 08, jamais du code testé.
 */
import type pg from 'pg';
import { translateDbError } from '../../../src/index.ts';
import { at, inTx, uuid } from '../../support/avl.ts';
import type { CountryCase, Slot } from '../../support/avl.ts';
import { ensureParties, placeHoldCommand, registerVehicles } from '../../support/concurrency.ts';

/** `buffer_minutes` = 120 (17 §7.2, graine US-013) : tampon après la fin d'un trip. */
export const BUFFER_MIN = 120;
export const MIN = 60_000;
export const LONG = 180_000;

/** Instant virtuel de pose : 2045 n'est utilisé par aucune autre suite (eaux 2031 à 2041). */
export const T = '2045-01-05T10:00:00.000Z';

/** Décalage en secondes entières d'un instant ISO. */
export const atSec = (base: string, seconds: number): string =>
  new Date(Date.parse(base) + seconds * 1000).toISOString();

/** Même instant écrit avec un décalage horaire (`minutes` : décalage de l'heure locale sur UTC). */
export function inOffset(iso: string, minutes: number): string {
  const local = new Date(Date.parse(iso) + minutes * MIN).toISOString();
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return local.replace('Z', `${sign}${hh}:${mm}`);
}

export interface Outcome {
  readonly holdId?: string;
  readonly code?: string;
  readonly raw?: { readonly code: string | undefined; readonly constraint: string | undefined };
}

export const outcomeOf = (error: unknown): Outcome => {
  const e = error as { code?: string; constraint?: string };
  return { code: translateDbError(error).code, raw: { code: e.code, constraint: e.constraint } };
};

export interface World {
  readonly orgId: string;
  readonly vehicles: string[];
  readonly guests: string[];
}

/** Un compte d'hôte, ses véhicules au registre de test et des voyageurs, créés et validés. */
export async function world(
  api: pg.ClientBase,
  c: CountryCase,
  vehicles: number,
  guests: number,
): Promise<World> {
  const orgId = uuid();
  const v = Array.from({ length: vehicles }, () => uuid());
  const g = Array.from({ length: guests }, () => uuid());
  await inTx(api, { commit: true }, async (tx) => {
    await ensureParties(tx, g, orgId, c);
    await registerVehicles(tx, v, orgId, c);
  });
  return { orgId, vehicles: v, guests: g };
}

/** Créneau explicite sur un véhicule (instants ISO, éventuellement avec décalage). */
export const slotBetween = (
  vehicleId: string,
  orgId: string,
  start: string,
  end: string,
): Slot => ({
  vehicleId,
  orgId,
  start,
  end,
  bufferHours: BUFFER_MIN / 60,
});

/** Pose par la commande réelle, validée ; l'erreur est traduite (sans DETAIL). */
export async function pose(
  api: pg.ClientBase,
  guestId: string,
  slot: Slot,
  when: string,
  options: { readonly timeZone?: string } = {},
): Promise<Outcome> {
  try {
    const holdId = await inTx(api, { virtualNow: when, commit: true }, async (tx) => {
      if (options.timeZone !== undefined) {
        await tx.query(`SELECT pg_catalog.set_config('TimeZone', $1, true)`, [options.timeZone]);
      }
      return placeHoldCommand(tx, { slot, guestId, flagged: false });
    });
    return { holdId };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** Occupations actives d'un véhicule (lecture du travailleur `hold_expiry`). */
export async function activeOccupancies(
  worker: pg.ClientBase,
  vehicleId: string,
): Promise<{ id: string; kind: string; lo: Date; hi: Date }[]> {
  return inTx(worker, { worker: 'hold_expiry' }, async (tx) => {
    const { rows } = await tx.query<{ id: string; kind: string; lo: Date; hi: Date }>(
      `SELECT id, kind, lower(period) AS lo, upper(period) AS hi
         FROM core.booking_vehicle_occupancy WHERE vehicle_id = $1 AND active ORDER BY lower(period)`,
      [vehicleId],
    );
    return rows;
  });
}

/** Statut et occupation d'un hold (lecture du travailleur `hold_expiry`). */
export async function holdInfo(
  worker: pg.ClientBase,
  holdId: string,
): Promise<{ status: string; occupancy_id: string; lo: Date; hi: Date } | undefined> {
  return inTx(worker, { worker: 'hold_expiry' }, async (tx) => {
    const { rows } = await tx.query<{
      status: string;
      occupancy_id: string;
      lo: Date;
      hi: Date;
    }>(
      `SELECT h.status, h.occupancy_id, lower(o.period) AS lo, upper(o.period) AS hi
         FROM core.booking_checkout_hold h
         JOIN core.booking_vehicle_occupancy o ON o.id = h.occupancy_id
        WHERE h.id = $1`,
      [holdId],
    );
    return rows[0];
  });
}

export { at, uuid };
export type { CountryCase, Slot };
