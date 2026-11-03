/**
 * Aides des preuves L0-01 / L0-03 / L0-08 (US-006) : contexte de travailleur, pose de hold par la
 * fixture de test, expiration ciblée 2a, preuve de paiement, conversion gardée (17 §2.5 étape 4)
 * et bloc C. Toutes les requêtes passent par une connexion sous un rôle de PRODUCTION
 * (`withRole` / `connectAs` : assertion L0-05 en tête).
 *
 * Les valeurs attendues des tests viennent de 17 (§2.5, §11) et de 16 A.8, jamais de ce fichier.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { translateDbError } from '../../src/index.ts';
import type { DbBusinessError } from '../../src/index.ts';
import { withTestTransaction } from '../../src/testing/index.ts';
import { EXPIRY_2A_SQL } from './expiry-2a.ts';

export { EXPIRY_2A_SQL } from './expiry-2a.ts';

/**
 * Les deux pays de premier rang (CLAUDE.md point 3) : chaque preuve tourne en USD (PA) et en PYG
 * sans décimale (PY). Données de TEST, pas des constantes du code. Montants en unités mineures.
 */
export const COUNTRIES = [
  { country: 'PA', currency: 'USD', timezone: 'America/Panama', rentMinor: '12000' },
  { country: 'PY', currency: 'PYG', timezone: 'America/Asuncion', rentMinor: '850000' },
] as const;
export type CountryCase = (typeof COUNTRIES)[number];

/** TTL initial d'un hold : `hold_ttl_minutes` = 10 (08 BR-BOOK-10, 17 §2.5). */
export const HOLD_TTL = '10 minutes';
/** `sweep_grace_s` = 60 (PROPOSÉ, 17 §2.5 étape 3d). */
export const SWEEP_GRACE_S = 60;

export type Worker =
  | 'booking_conversion'
  | 'disposition_sweeper'
  | 'payment_intent_sweeper'
  | 'hold_expiry'
  | 'trip_lifecycle'
  | 'webhook_ingest'
  // relais de l'outbox (US-008) : seul lecteur des événements, pour vérifier ceux d'une commande
  | 'outbox_relay'
  // travailleur de commandes monétaires (US-019) : statuts appliqués, boîte d'envoi (US-024)
  | 'payment_command'
  // oracle de production C12 (US-025, 0042) : lecture seule
  | 'booking_oracle';

export const uuid = (): string => randomUUID();

export interface TxOptions {
  /** Contexte `app.actor_kind = WORKER`, `app.worker_name` (17 §2.3), posé par `SET LOCAL`. */
  readonly worker?: Worker;
  readonly virtualNow?: string;
  readonly commit?: boolean;
}

/** Transaction de test (US-005) avec, si demandé, le contexte de travailleur. */
export async function inTx<T>(
  client: pg.ClientBase,
  options: TxOptions,
  fn: (tx: pg.ClientBase) => Promise<T>,
): Promise<T> {
  return withTestTransaction(
    client,
    {
      ...(options.virtualNow !== undefined ? { virtualNow: options.virtualNow } : {}),
      ...(options.commit !== undefined ? { commit: options.commit } : {}),
    },
    async (tx) => {
      if (options.worker !== undefined) {
        await tx.query(
          `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                  pg_catalog.set_config('app.worker_name', $1, true)`,
          [options.worker],
        );
      }
      return fn(tx);
    },
  );
}

/** Un créneau : période commerciale du trip et période occupée (fin + tampon, BR-BOOK-05). */
export interface Slot {
  readonly vehicleId: string;
  readonly orgId: string;
  readonly start: string;
  readonly end: string;
  /** Tampon après la fin (BR-BOOK-05), en heures. */
  readonly bufferHours: number;
}

export const slotPeriod = (s: Slot): string => {
  const end = new Date(Date.parse(s.end) + s.bufferHours * 3_600_000).toISOString();
  return `[${s.start},${end})`;
};

export const newSlot = (start: string, end: string, bufferHours = 2): Slot => ({
  vehicleId: uuid(),
  orgId: uuid(),
  start,
  end,
  bufferHours,
});

export interface Hold {
  readonly holdId: string;
  readonly occupancyId: string;
  readonly guestId: string;
  readonly slot: Slot;
  readonly c: CountryCase;
}

/** Pose d'un hold (fixture qui tient lieu de booking.cmd_place_hold, US-023), sous app_api. */
export async function placeHold(
  tx: pg.ClientBase,
  slot: Slot,
  c: CountryCase,
  guestId: string = uuid(),
  period: string = slotPeriod(slot),
): Promise<Hold> {
  const hold: Hold = { holdId: uuid(), occupancyId: uuid(), guestId, slot, c };
  await tx.query(
    `SELECT test_fixture.place_hold($1, $2, $3, $4, $5, $6, $7::tstzrange, $8::interval)`,
    [
      hold.holdId,
      hold.occupancyId,
      guestId,
      slot.vehicleId,
      slot.orgId,
      c.country,
      period,
      HOLD_TTL,
    ],
  );
  return hold;
}

/** Opération de loyer du hold (fixture qui tient lieu de cmd_start_payment, T1), sous app_api. */
export async function insertRentOperation(
  tx: pg.ClientBase,
  hold: Hold,
  status: 'PENDING' | 'SUCCEEDED' = 'PENDING',
  kind: 'CAPTURE' | 'AUTH' | 'REFUND' = 'CAPTURE',
): Promise<string> {
  const operationId = uuid();
  await tx.query(
    `SELECT test_fixture.insert_payment_operation($1, $2, $3, $4, $5::bigint, $6, 'RENT', $7)`,
    [operationId, hold.holdId, hold.c.country, hold.c.currency, hold.c.rentMinor, kind, status],
  );
  return operationId;
}

/**
 * Expiration ciblée 2a (17 §2.5) : exécute `EXPIRY_2A_SQL`. Renvoie le nombre d'occupations
 * désactivées. `guestId` nul = partie véhicule seule (ré-acquisition, VERIF_17 T3).
 */
export async function expireDueHolds(
  tx: pg.ClientBase,
  vehicleId: string,
  guestId: string | null,
): Promise<number> {
  const r = await tx.query(EXPIRY_2A_SQL, [vehicleId, guestId, SWEEP_GRACE_S]);
  return r.rowCount ?? 0;
}

/** Réception d'une preuve de paiement signée (17 §4.4 points 3 et 8), sous `webhook_ingest`. */
export async function receiveProof(tx: pg.ClientBase, operationId: string): Promise<void> {
  await tx.query(
    `INSERT INTO core.payment_webhook_inbox (id, provider, psp_account_id, provider_event_id,
                                             dedup_key, signature_valid, processing_status)
     VALUES ($1, 'FAKE', NULL, $2, convert_to($2, 'UTF8'), true, 'PROCESSED')`,
    [uuid(), `evt-${operationId}`],
  );
  await tx.query(
    `UPDATE core.payment_payment_operation SET status = 'SUCCEEDED', proof_type = 'WEBHOOK_SIGNED'
      WHERE id = $1`,
    [operationId],
  );
}

export type CompensationReason =
  | 'SLOT_LOST_AFTER_EXPIRY'
  | 'SLOT_LOST_AFTER_RELEASE'
  | 'GUEST_OVERLAP'
  | 'INVARIANT_VIOLATION'
  | 'DUPLICATE_PAYMENT'
  | 'LATE_PAYMENT_AFTER_COMPENSATION';

export interface BlocCResult {
  readonly kind: 'COMPENSATED';
  readonly reason: CompensationReason;
  readonly compensationId: string;
  /** Lignes de hold mises à jour par le bloc C (0 si déjà CONVERTED / COMPENSATED). */
  readonly holdRowsUpdated: number;
  /** Erreur traduite qui a mené au bloc C (23P01 de la ré-acquisition), le cas échéant. */
  readonly cause?: DbBusinessError;
  /** SQLSTATE et contrainte bruts de cette erreur, pour la preuve. */
  readonly rawCause?: { readonly code: string; readonly constraint: string | undefined };
}

export type ConversionResult =
  | { readonly kind: 'TRIP'; readonly tripId: string; readonly reacquired: boolean }
  | { readonly kind: 'REPLAY'; readonly disposition: string }
  | { readonly kind: 'IGNORED' }
  | BlocCResult;

/**
 * Bloc C (17 §2.5, esquisse de la transaction de conversion) : compensation dans la même
 * transaction. Action `REFUND_API` (capacité de remboursement validée du `FAKE`, 17 §2.5 étape 5).
 */
export async function blocC(
  tx: pg.ClientBase,
  args: { holdId: string; occupancyId: string; operationId: string; reason: CompensationReason },
): Promise<Omit<BlocCResult, 'cause' | 'rawCause'>> {
  const compensationId = uuid();
  await tx.query(
    `INSERT INTO core.booking_hold_compensation (id, hold_id, operation_id, reason, action, status)
     VALUES ($1, $2, $3, $4, 'REFUND_API', 'OPEN')`,
    [compensationId, args.holdId, args.operationId, args.reason],
  );
  await tx.query(
    `INSERT INTO core.booking_payment_disposition (operation_id, hold_id, disposition, hold_compensation_id)
     VALUES ($1, $2, 'COMPENSATION', $3)`,
    [args.operationId, args.holdId, compensationId],
  );
  const hold = await tx.query(
    `UPDATE core.booking_checkout_hold SET status = 'COMPENSATED', compensated_at = platform.now()
      WHERE id = $1 AND status NOT IN ('CONVERTED', 'COMPENSATED')`,
    [args.holdId],
  );
  await tx.query(
    `UPDATE core.booking_vehicle_occupancy SET active = false, deactivated_reason = 'HOLD_COMPENSATED'
      WHERE id = $1 AND kind = 'HOLD'`,
    [args.occupancyId],
  );
  return {
    kind: 'COMPENSATED',
    reason: args.reason,
    compensationId,
    holdRowsUpdated: hold.rowCount ?? 0,
  };
}

const isPgError = (e: unknown): e is { code: string; constraint?: string } =>
  typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string';

/**
 * Conversion atomique et gardée (17 §2.5 étape 4, esquisse SQL), sous un travailleur de
 * conversion, dans la transaction ouverte par l'appelant. Les contrôles de preuve 2 et 2 bis
 * (devis, jambes, éligibilité) relèvent de US-024 ; ici la preuve est l'opération SUCCEEDED.
 */
export async function convert(
  tx: pg.ClientBase,
  hold: Hold,
  operationId: string,
  options: { readonly vehicleLock?: boolean } = {},
): Promise<ConversionResult> {
  // 0. verrous : guest puis véhicule (ordre global, VERIF_16-M2). `vehicleLock: false` est
  // l'injection de L0-02 (US-007) : la même conversion sans le verrou du véhicule.
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('guest:' || $1::text, 0))`, [
    hold.guestId,
  ]);
  if (options.vehicleLock !== false) {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('veh:' || $1::text, 0))`, [
      hold.slot.vehicleId,
    ]);
  }
  const replay = await tx.query<{ disposition: string }>(
    `SELECT disposition FROM core.booking_payment_disposition WHERE operation_id = $1`,
    [operationId],
  );
  if (replay.rows[0]) return { kind: 'REPLAY', disposition: replay.rows[0].disposition };

  // 1. verrou de ligne du hold, sans prédicat de statut
  const h = await tx.query<{ status: string; conversion_operation_id: string | null }>(
    `SELECT status, conversion_operation_id FROM core.booking_checkout_hold WHERE id = $1 FOR UPDATE`,
    [hold.holdId],
  );
  const status = h.rows[0]?.status;
  if (status === undefined) throw new Error(`hold ${hold.holdId} invisible au travailleur`);
  const base = { holdId: hold.holdId, occupancyId: hold.occupancyId, operationId };
  if (status === 'CONVERTED') {
    return blocC(tx, { ...base, reason: 'DUPLICATE_PAYMENT' });
  }
  if (status === 'COMPENSATED') {
    return blocC(tx, { ...base, reason: 'LATE_PAYMENT_AFTER_COMPENSATION' });
  }
  const late = status === 'EXPIRED' || status === 'RELEASED';
  // ré-acquisition : d'abord l'expiration ciblée 2a, partie véhicule (VERIF_17 T3)
  if (late) await expireDueHolds(tx, hold.slot.vehicleId, null);

  // 3. occupation HOLD -> TRIP active, dans un SAVEPOINT (réévaluation de l'exclusion)
  const tripId = uuid();
  await tx.query('SAVEPOINT reacquire');
  let updated: number;
  try {
    const r = await tx.query(
      `UPDATE core.booking_vehicle_occupancy
          SET kind = 'TRIP', active = true, expires_at = NULL, deactivated_reason = NULL,
              ref_type = 'TRIP', ref_id = $2
        WHERE id = $1 AND kind = 'HOLD'`,
      [hold.occupancyId, tripId],
    );
    updated = r.rowCount ?? 0;
  } catch (error) {
    if (!isPgError(error) || error.code !== '23P01') throw error;
    await tx.query('ROLLBACK TO SAVEPOINT reacquire');
    const c = await blocC(tx, {
      ...base,
      reason: status === 'RELEASED' ? 'SLOT_LOST_AFTER_RELEASE' : 'SLOT_LOST_AFTER_EXPIRY',
    });
    return {
      ...c,
      cause: translateDbError(error),
      rawCause: { code: error.code, constraint: error.constraint },
    };
  }
  if (updated !== 1) return blocC(tx, { ...base, reason: 'INVARIANT_VIOLATION' });

  // 4. trip BOOKED et occupation du guest (trips seulement, sans tampon)
  await tx.query(
    `INSERT INTO core.booking_trip (id, guest_user_id, org_id, vehicle_id, country_code, currency,
                                    timezone, scheduled_start, scheduled_end, status, source_hold_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'BOOKED', $10)`,
    [
      tripId,
      hold.guestId,
      hold.slot.orgId,
      hold.slot.vehicleId,
      hold.c.country,
      hold.c.currency,
      hold.c.timezone,
      hold.slot.start,
      hold.slot.end,
      hold.holdId,
    ],
  );
  await tx.query('SAVEPOINT guest_overlap');
  try {
    await tx.query(
      `INSERT INTO core.booking_guest_occupancy (id, guest_user_id, period, active, trip_id)
       VALUES ($1, $2, tstzrange($3::timestamptz, $4::timestamptz, '[)'), true, $5)`,
      [uuid(), hold.guestId, hold.slot.start, hold.slot.end, tripId],
    );
  } catch (error) {
    if (!isPgError(error) || error.code !== '23P01') throw error;
    await tx.query('ROLLBACK TO SAVEPOINT reacquire');
    const c = await blocC(tx, { ...base, reason: 'GUEST_OVERLAP' });
    return {
      ...c,
      cause: translateDbError(error),
      rawCause: { code: error.code, constraint: error.constraint },
    };
  }
  // 5. disposition CONVERSION (PK : XOR) puis hold CONVERTED
  await tx.query(
    `INSERT INTO core.booking_payment_disposition (operation_id, hold_id, disposition, trip_id)
     VALUES ($1, $2, 'CONVERSION', $3)`,
    [operationId, hold.holdId, tripId],
  );
  await tx.query(
    `UPDATE core.booking_checkout_hold
        SET status = 'CONVERTED', converted_trip_id = $2, conversion_operation_id = $3
      WHERE id = $1`,
    [hold.holdId, tripId, operationId],
  );
  return { kind: 'TRIP', tripId, reacquired: late };
}

/** Instant virtuel décalé de `minutes` (ISO 8601, UTC). */
export const at = (base: string, minutes: number): string =>
  new Date(Date.parse(base) + minutes * 60_000).toISOString();

/**
 * Parcours nominal jusqu'à un trip BOOKED (hold ACTIVE, preuve, conversion), chaque étape dans
 * sa transaction validée et sous son rôle : pose sous app_api, preuve sous `webhook_ingest`,
 * conversion sous `booking_conversion`.
 */
export async function bookTrip(
  api: pg.ClientBase,
  worker: pg.ClientBase,
  slot: Slot,
  c: CountryCase,
  t0: string,
): Promise<{ hold: Hold; operationId: string; tripId: string }> {
  const { hold, operationId } = await inTx(api, { virtualNow: t0, commit: true }, async (tx) => {
    const placed = await placeHold(tx, slot, c);
    return { hold: placed, operationId: await insertRentOperation(tx, placed) };
  });
  await inTx(worker, { worker: 'webhook_ingest', virtualNow: at(t0, 2), commit: true }, (tx) =>
    receiveProof(tx, operationId),
  );
  const result = await inTx(
    worker,
    { worker: 'booking_conversion', virtualNow: at(t0, 2), commit: true },
    (tx) => convert(tx, hold, operationId),
  );
  if (result.kind !== 'TRIP') throw new Error(`conversion inattendue : ${result.kind}`);
  return { hold, operationId, tripId: result.tripId };
}
