/**
 * US-023 — holds de checkout et commandes de réservation (16 BKG-014 ; 08 BR-BOOK-08,
 * BR-BOOK-10, BR-BOOK-11 ; 17 §2.3, §2.5 ; C5, C9, RLS-3, RLS-4, RLS-11, RLS-13, RLS-14 ;
 * migration 0035, ADR-063).
 *
 * Attendu (valeurs de 19 US-023, 16 BKG-014, 17 §2.3 / §2.5 / §7.2, jamais du code testé) :
 * - critère 1 : hold CHECKOUT posé à T0 sans ordre PSP, tâche d'expiration à T0 + 10 min
 *   (`hold_ttl_minutes` = 10) ⇒ `EXPIRED`, créneau de nouveau réservable ; aucun hold ne dure plus
 *   que `hold_max_total_minutes` = 20 ;
 * - critère 2 (RLS-3) : au plus `max_active_holds_per_guest` = 2 holds vivants par voyageur, tous
 *   hôtes confondus, y compris en sessions concurrentes (`HOLD_LIMIT_REACHED`) ;
 * - critère 3 (RLS-13) : écriture directe du voyageur sur son hold refusée (`42501`), commandes à
 *   paramètres hostiles refusées, colonnes gardées même pour le propriétaire des tables ; rien ne
 *   change ;
 * - critère 4 (C5) : hold `PAYMENT_IN_FLIGHT` après `expires_at`, avant `payment_in_flight_until` :
 *   une pose concurrente reçoit `409 VEHICLE_UNAVAILABLE`, le hold n'est pas expiré ;
 * - critère 5 (UXQ-08, défaut `REVIEW_BEFORE_CHARGE`) : réservation signalée ⇒ `review_required`,
 *   durée `review_hold_minutes` = 120, aucun paiement avant `reviewed_at` ; `PAY_THEN_REVIEW` ⇒
 *   hold ordinaire ;
 * - RLS-4 (`GUEST_OVERLAP`), RLS-11 (garde : aucune ligne hors session voyageur), RLS-14 (hold échu
 *   d'un tiers expiré par la pose, rien n'en est révélé), libération immédiate ou différée
 *   (17 §2.5 étape 6), rotation (`hold_creations_per_guest_vehicle_hour` = 3,
 *   `HOLD_RATE_LIMITED`), auto-réservation (`SELF_BOOKING_FORBIDDEN`), hôte non activé
 *   (`HOST_NOT_ACTIVATED`).
 * Rôles de production seulement (`app_api` voyageur, `app_worker` `hold_expiry` ; assertion L0-05
 * par connectAs / withRole). En USD (PA) et en PYG (PY).
 *
 * Horloge : la tâche d'expiration balaie TOUTE la base de test, partagée avec les autres fichiers.
 * Les tests qui la lancent posent donc leurs holds à l'instant M où les paramètres du pays sont
 * entrés en vigueur (migration 0009, arrondi à la seconde supérieure) : seuls des holds posés à
 * cet instant sont échus à M + 10 min (tout hold d'un autre fichier est posé plus tard, en temps
 * réel, ou dans les années 2031 et suivantes).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { commandCallSql, setSessionContext, translateDbError } from '../../src/index.ts';
import type { SessionContext } from '../../src/index.ts';
import { connectAs, releaseClient, withRole } from '../../src/testing/index.ts';
import { at, bookTrip, COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase, Slot } from '../support/avl.ts';
import {
  Barrier,
  ensureParties,
  placeHoldCommand,
  registerVehicles,
} from '../support/concurrency.ts';

/** `hold_ttl_minutes`, `hold_max_total_minutes`, `review_hold_minutes` (17 §7.2, graine US-013). */
const HOLD_TTL_MIN = 10;
const HOLD_MAX_TOTAL_MIN = 20;
const REVIEW_HOLD_MIN = 120;
/** `max_active_holds_per_guest` = 2, `hold_creations_per_guest_vehicle_hour` = 3 (17 §7.2). */
const MAX_LIVE = 2;
const RATE_PER_HOUR = 3;
/** `sweep_grace_s` = 60 (17 §7.2). */
const SWEEP_GRACE_S = 60;
const MIN = 60_000;
const LONG = 120_000;

const guestCtx = (actorId: string): SessionContext => ({ kind: 'GUEST', actorId });
/** Instant décalé de `seconds` secondes (entières : aucune milliseconde perdue). */
const atSec = (base: string, seconds: number): string =>
  new Date(Date.parse(base) + seconds * 1000).toISOString();

interface Outcome {
  readonly holdId?: string;
  readonly code?: string;
  readonly raw?: { readonly code: string | undefined; readonly constraint: string | undefined };
}

const outcomeOf = (error: unknown): Outcome => {
  const e = error as { code?: string; constraint?: string };
  return { code: translateDbError(error).code, raw: { code: e.code, constraint: e.constraint } };
};

/** Pose par la commande réelle, validée ; erreur traduite (sans DETAIL). */
async function pose(
  api: pg.ClientBase,
  guestId: string,
  slot: Slot,
  when: string,
  flagged: boolean | null = false,
): Promise<Outcome> {
  try {
    const holdId = await inTx(api, { virtualNow: when, commit: true }, (tx) =>
      placeHoldCommand(tx, { slot, guestId, flagged }),
    );
    return { holdId };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** Libération par la commande réelle, contexte et appel dans une instruction (ADR-056). */
async function release(
  api: pg.ClientBase,
  ctx: SessionContext,
  holdId: string,
  when: string,
): Promise<{ readonly result?: string } & Outcome> {
  try {
    const result = await inTx(api, { virtualNow: when, commit: true }, async (tx) => {
      const { text, values } = commandCallSql(ctx, 'core.booking_cmd_release_own_hold', [
        { value: holdId, type: 'uuid' },
      ]);
      const r = await tx.query<{ result: string }>(text, values);
      return r.rows[0]?.result;
    });
    return result === undefined ? {} : { result };
  } catch (error) {
    return outcomeOf(error);
  }
}

interface HoldRow {
  status: string;
  created_at: Date;
  expires_at: Date;
  review_required: boolean;
  payment_in_flight_until: Date | null;
  release_requested_at: Date | null;
  released_at: Date | null;
  release_reason: string | null;
  vehicle_id: string;
  guest_user_id: string;
  occupancy_active: boolean;
  deactivated_reason: string | null;
}

/** État d'un hold et de son occupation, relu par le travailleur `hold_expiry`. */
async function holdRow(worker: pg.ClientBase, holdId: string): Promise<HoldRow | undefined> {
  return inTx(worker, { worker: 'hold_expiry' }, async (tx) => {
    const { rows } = await tx.query<HoldRow>(
      `SELECT h.status, h.created_at, h.expires_at, h.review_required, h.payment_in_flight_until,
              h.release_requested_at, h.released_at, h.release_reason, h.vehicle_id,
              h.guest_user_id, o.active AS occupancy_active, o.deactivated_reason
         FROM core.booking_checkout_hold h
         JOIN core.booking_vehicle_occupancy o ON o.id = h.occupancy_id
        WHERE h.id = $1`,
      [holdId],
    );
    return rows[0];
  });
}

/** Tâche d'expiration (17 §2.5 étape 7) sous `hold_expiry`, validée. */
async function runExpiryJob(worker: pg.ClientBase, when: string): Promise<number> {
  return inTx(worker, { worker: 'hold_expiry', virtualNow: when, commit: true }, async (tx) => {
    const { rows } = await tx.query<{ n: number }>(
      'SELECT core.booking_expire_due_holds(10000) AS n',
    );
    return rows[0]?.n ?? -1;
  });
}

/** Opération de loyer PENDING du hold (fixture de T1, US-024) puis PAYMENT_IN_FLIGHT. */
async function paymentInFlight(
  api: pg.ClientBase,
  holdId: string,
  c: CountryCase,
  when: string,
  until: string,
): Promise<void> {
  await inTx(api, { virtualNow: when, commit: true }, async (tx) => {
    await tx.query(
      `SELECT test_fixture.insert_payment_operation($1, $2, $3, $4, $5::bigint, 'CAPTURE', 'RENT', 'PENDING')`,
      [uuid(), holdId, c.country, c.currency, c.rentMinor],
    );
    await tx.query('SELECT test_fixture.l0_set_payment_in_flight($1, $2::timestamptz)', [
      holdId,
      until,
    ]);
  });
}

/** Un compte d'hôte, ses véhicules au registre de test et des voyageurs, créés et validés. */
async function world(
  api: pg.ClientBase,
  c: CountryCase,
  vehicles: number,
  guests: number,
): Promise<{ orgId: string; vehicles: string[]; guests: string[] }> {
  const orgId = uuid();
  const v = Array.from({ length: vehicles }, () => uuid());
  const g = Array.from({ length: guests }, () => uuid());
  await inTx(api, { commit: true }, async (tx) => {
    await ensureParties(tx, g, orgId, c);
    await registerVehicles(tx, v, orgId, c);
  });
  return { orgId, vehicles: v, guests: g };
}

/** Créneau de deux jours sur le véhicule, `days` jours après `base`, tampon de 2 h. */
const slotOf = (vehicleId: string, orgId: string, base: string, days = 7): Slot => {
  const start = new Date(Date.parse(base) + days * 86_400_000);
  return {
    vehicleId,
    orgId,
    start: start.toISOString(),
    end: new Date(start.getTime() + 2 * 86_400_000).toISOString(),
    bufferHours: 2,
  };
};

/** Holds vivants d'un voyageur, tous hôtes confondus (travailleur `hold_expiry`). */
async function liveHolds(worker: pg.ClientBase, guestId: string): Promise<number> {
  return inTx(worker, { worker: 'hold_expiry' }, async (tx) => {
    const { rows } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM core.booking_checkout_hold
        WHERE guest_user_id = $1 AND status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')`,
      [guestId],
    );
    return rows[0]?.n ?? -1;
  });
}

/** Types des événements de l'outbox d'un hold (lecture du relais). */
async function holdEvents(worker: pg.ClientBase, holdId: string): Promise<string[]> {
  return inTx(worker, { worker: 'outbox_relay' }, async (tx) => {
    const { rows } = await tx.query<{ type: string }>(
      `SELECT type FROM core.outbox_outbox_event WHERE aggregate_id = $1 ORDER BY created_at, type`,
      [holdId],
    );
    return rows.map((r) => r.type);
  });
}

/**
 * Instant M (seconde supérieure) d'entrée en vigueur des paramètres de hold du pays : le plus tôt
 * où une pose réussit, et où aucun hold d'un autre fichier de test n'est encore échu.
 */
async function paramsEra(api: pg.ClientBase, c: CountryCase): Promise<string> {
  const { rows } = await api.query<{ m: Date }>(
    `SELECT max(valid_from) AS m FROM core.config_param_value
      WHERE scope_type = 'COUNTRY' AND country_code = $1 AND valid_from <= $3::timestamptz
        AND key = ANY ($2::text[])`,
    [
      c.country,
      [
        'buffer_minutes',
        'hold_ttl_minutes',
        'hold_max_total_minutes',
        'max_active_holds_per_guest',
        'hold_creations_per_guest_vehicle_hour',
        'sweep_grace_s',
        'review_hold_minutes',
      ],
      new Date().toISOString(),
    ],
  );
  const m = rows[0]?.m;
  if (!(m instanceof Date)) throw new Error('paramètres de hold absents');
  return new Date(Math.ceil(m.getTime() / 1000) * 1000).toISOString();
}

let api: pg.Client;
let worker: pg.Client;

// connexions ouvertes par test : chaque test fait ainsi son assertion L0-05 (setup-l0-05)
beforeEach(async () => {
  api = await connectAs('app_api');
  worker = await connectAs('app_worker');
});

afterEach(async () => {
  await releaseClient(worker);
  await releaseClient(api);
});

describe.each(COUNTRIES)('US-023 — holds de checkout ($country, $currency)', (c) => {
  // ---------------------------------------------------------------------------------------------
  // Critère 1 : expiration par la tâche, créneau réservable, borne de 20 min
  // ---------------------------------------------------------------------------------------------
  it('critère 1 : hold sans ordre PSP posé à T0, tâche à T0 + 10 min ⇒ EXPIRED, créneau réservable ; durée ≤ 20 min', async () => {
    const T0 = await paramsEra(api, c);
    const w = await world(api, c, 1, 2);
    const [a, b] = w.guests as [string, string];
    const slot = slotOf(w.vehicles[0] as string, w.orgId, T0);
    const placed = await pose(api, a, slot, T0);
    expect(placed.code).toBeUndefined();
    const holdId = placed.holdId as string;

    const row = await holdRow(worker, holdId);
    expect(row?.status).toBe('ACTIVE');
    expect(row?.review_required).toBe(false);
    const ttl = (row?.expires_at.getTime() ?? 0) - (row?.created_at.getTime() ?? 0);
    expect(ttl).toBe(HOLD_TTL_MIN * MIN);
    expect(ttl).toBeLessThanOrEqual(HOLD_MAX_TOTAL_MIN * MIN);
    expect(row?.created_at.toISOString()).toBe(T0);

    // une seconde avant l'échéance : rien
    await runExpiryJob(worker, atSec(T0, HOLD_TTL_MIN * 60 - 1));
    expect((await holdRow(worker, holdId))?.status).toBe('ACTIVE');
    // à T0 + 10 min : EXPIRED, occupation désactivée
    expect(await runExpiryJob(worker, at(T0, HOLD_TTL_MIN))).toBeGreaterThanOrEqual(1);
    const expired = await holdRow(worker, holdId);
    expect(expired).toMatchObject({
      status: 'EXPIRED',
      occupancy_active: false,
      deactivated_reason: 'HOLD_EXPIRED',
    });
    expect(await holdEvents(worker, holdId)).toEqual(
      expect.arrayContaining(['booking.hold.created', 'booking.hold.expired']),
    );
    // le créneau est réservable : un autre voyageur le pose aussitôt
    const again = await pose(api, b, slot, at(T0, HOLD_TTL_MIN));
    expect(again.code).toBeUndefined();
    expect((await holdRow(worker, again.holdId as string))?.status).toBe('ACTIVE');
  });

  // ---------------------------------------------------------------------------------------------
  // Critère 2 (RLS-3) : au plus 2 holds vivants par voyageur, tous hôtes confondus, en concurrence
  // ---------------------------------------------------------------------------------------------
  /** `n` poses concurrentes du même voyageur, une par hôte, départ commun (barrière). */
  async function concurrentPoses(guest: string, slots: Slot[], when: string): Promise<Outcome[]> {
    const observer = await connectAs('app_api');
    const sessions = await Promise.all(slots.map(() => connectAs('app_api')));
    try {
      const barrier = await Barrier.open(observer);
      const runs = sessions.map(async (session, i) => {
        await barrier.wait(session);
        return pose(session, guest, slots[i] as Slot, when);
      });
      try {
        await barrier.waitForWaiters(sessions.length);
      } finally {
        await barrier.release();
      }
      return await Promise.all(runs);
    } finally {
      await Promise.all([...sessions, observer].map((s) => releaseClient(s)));
    }
  }

  it(
    'critère 2 (RLS-3) : 1 hold vivant chez A, deux sessions concurrentes chez B et C ⇒ exactement un refus HOLD_LIMIT_REACHED',
    async () => {
      const T = '2033-01-03T10:00:00.000Z';
      for (let round = 0; round < 5; round++) {
        const hosts = [
          await world(api, c, 1, 1),
          await world(api, c, 1, 0),
          await world(api, c, 1, 0),
        ];
        const guest = hosts[0]?.guests[0] as string;
        const slots = hosts.map((h) => slotOf(h.vehicles[0] as string, h.orgId, T));
        expect((await pose(api, guest, slots[0] as Slot, T)).code).toBeUndefined();
        const outcomes = await concurrentPoses(guest, slots.slice(1), T);
        const codes = outcomes.map((o) => o.code ?? 'OK').sort();
        expect(codes).toEqual(['HOLD_LIMIT_REACHED', 'OK']);
        expect(outcomes.find((o) => o.code)?.raw).toEqual({
          code: '55000',
          constraint: 'hold_guest_limit',
        });
        expect(await liveHolds(worker, guest)).toBe(MAX_LIVE);
      }
    },
    LONG,
  );

  it(
    'critère 2 (RLS-3) : 2 holds vivants chez A et B, 3ᵉ chez C en deux sessions concurrentes ⇒ refusé, jamais 3 vivants ; 6 hôtes à la fois ⇒ exactement 2 holds',
    async () => {
      const T = '2033-01-05T10:00:00.000Z';
      const hosts = [
        await world(api, c, 1, 1),
        await world(api, c, 1, 0),
        await world(api, c, 2, 0),
      ];
      const guest = hosts[0]?.guests[0] as string;
      for (const h of hosts.slice(0, 2)) {
        expect(
          (await pose(api, guest, slotOf(h.vehicles[0] as string, h.orgId, T), T)).code,
        ).toBeUndefined();
      }
      const hostC = hosts[2] as { orgId: string; vehicles: string[] };
      const third = await concurrentPoses(
        guest,
        hostC.vehicles.map((v) => slotOf(v, hostC.orgId, T)),
        T,
      );
      expect(third.map((o) => o.code)).toEqual(['HOLD_LIMIT_REACHED', 'HOLD_LIMIT_REACHED']);
      expect(await liveHolds(worker, guest)).toBe(MAX_LIVE);

      // sans hold vivant, six poses simultanées chez six hôtes : la garde sous le verrou du
      // voyageur laisse passer exactement max_active_holds_per_guest
      const six: Awaited<ReturnType<typeof world>>[] = [];
      for (let i = 0; i < 6; i++) six.push(await world(api, c, 1, 0));
      const fresh = (await world(api, c, 0, 1)).guests[0] as string;
      const many = await concurrentPoses(
        fresh,
        six.map((h) => slotOf(h.vehicles[0] as string, h.orgId, T)),
        T,
      );
      const tally: Record<string, number> = {};
      for (const o of many) tally[o.code ?? 'OK'] = (tally[o.code ?? 'OK'] ?? 0) + 1;
      expect(tally).toEqual({ OK: MAX_LIVE, HOLD_LIMIT_REACHED: 6 - MAX_LIVE });
      expect(await liveHolds(worker, fresh)).toBe(MAX_LIVE);
    },
    LONG,
  );

  // ---------------------------------------------------------------------------------------------
  // Critère 3 (RLS-13) : aucune modification hors des commandes
  // ---------------------------------------------------------------------------------------------
  it('critère 3 (RLS-13) : écriture directe 42501 ; commandes à paramètres hostiles refusées ; colonnes gardées même pour migrator ; rien ne change', async () => {
    const T = '2033-01-07T10:00:00.000Z';
    const w = await world(api, c, 1, 2);
    const [guest, other] = w.guests as [string, string];
    const slot = slotOf(w.vehicles[0] as string, w.orgId, T);
    const holdId = (await pose(api, guest, slot, T)).holdId as string;
    const before = await holdRow(worker, holdId);
    expect(before?.status).toBe('ACTIVE');

    // 1. écriture directe du voyageur sur SON hold : aucun droit (17 §2.3)
    for (const sql of [
      `UPDATE core.booking_checkout_hold SET expires_at = expires_at + interval '1 day' WHERE id = $1`,
      `UPDATE core.booking_checkout_hold SET status = 'CONVERTED' WHERE id = $1`,
      `UPDATE core.booking_checkout_hold SET kind = 'CHECKOUT' WHERE id = $1`,
      `UPDATE core.booking_checkout_hold SET vehicle_id = gen_random_uuid() WHERE id = $1`,
      `UPDATE core.booking_checkout_hold SET payment_in_flight_until = NULL WHERE id = $1`,
      `UPDATE core.booking_vehicle_occupancy SET active = false WHERE id IS NOT NULL`,
      `DELETE FROM core.booking_checkout_hold WHERE id = $1`,
    ]) {
      await expect(
        inTx(api, { virtualNow: at(T, 1) }, async (tx) => {
          await setSessionContext(tx, guestCtx(guest));
          return tx.query(sql, sql.includes('$1') ? [holdId] : []);
        }),
        sql,
      ).rejects.toMatchObject({ code: '42501' });
    }

    // 2. commandes avec des paramètres hostiles : refus traduit, sans DETAIL
    const host = { kind: 'HOST', actorId: uuid(), orgId: w.orgId } as const;
    const refusals: [string, Outcome, string][] = [
      [
        'libération par un autre voyageur',
        await release(api, guestCtx(other), holdId, at(T, 1)),
        'FORBIDDEN',
      ],
      [
        'libération d’un hold inconnu',
        await release(api, guestCtx(guest), uuid(), at(T, 1)),
        'FORBIDDEN',
      ],
      ['libération par un hôte', await release(api, host, holdId, at(T, 1)), 'FORBIDDEN'],
      [
        'libération par un travailleur',
        await release(api, { kind: 'WORKER', workerName: 'hold_expiry' }, holdId, at(T, 1)),
        'FORBIDDEN',
      ],
      [
        'pose dans le passé',
        await pose(api, other, slotOf(slot.vehicleId, w.orgId, T, -1), T),
        'INVALID_PERIOD',
      ],
      [
        'pose à fin avant le début',
        await pose(api, other, { ...slot, end: slot.start }, T),
        'INVALID_PERIOD',
      ],
      [
        'pose sur un véhicule inconnu',
        await pose(api, other, slotOf(uuid(), w.orgId, T), T),
        'VEHICLE_UNAVAILABLE',
      ],
    ];
    for (const [label, got, expected] of refusals) {
      expect(got.code, label).toBe(expected);
    }
    // pose sous un contexte d'hôte : refusée (identité tirée de la session, jamais d'un paramètre)
    const asHost = await inTx(api, { virtualNow: T }, async (tx) => {
      const { text, values } = commandCallSql(host, 'core.booking_cmd_place_hold', [
        { value: slot.vehicleId, type: 'uuid' },
        { value: slot.start, type: 'timestamptz' },
        { value: slot.end, type: 'timestamptz' },
        { value: false, type: 'boolean' },
      ]);
      return tx.query(text, values).then(
        () => 'OK',
        (e: unknown) => translateDbError(e).code,
      );
    });
    expect(asHost).toBe('FORBIDDEN');
    // sans contexte du tout : refusée
    const bare = await inTx(api, { virtualNow: T }, (tx) =>
      tx
        .query(`SELECT core.booking_cmd_place_hold($1, $2, $3, false)`, [
          slot.vehicleId,
          slot.start,
          slot.end,
        ])
        .then(
          () => 'OK',
          (e: unknown) => translateDbError(e).code,
        ),
    );
    expect(bare).toBe('FORBIDDEN');

    // 3. même le propriétaire des tables ne modifie pas une colonne gardée ni ne supprime le hold
    for (const what of [
      'expires_at',
      'vehicle_id',
      'guest_user_id',
      'review_required',
      'created_at',
      'delete',
    ]) {
      const err = await inTx(api, { virtualNow: at(T, 1) }, (tx) =>
        tx.query('SELECT test_fixture.hold_force_write($1, $2)', [holdId, what]).then(
          () => null,
          (e: unknown) => e,
        ),
      );
      expect(err, what).toMatchObject({
        code: '23000',
        constraint: what === 'delete' ? 'booking_record_no_delete' : 'hold_guarded_columns',
      });
      expect(translateDbError(err).code).toBe('IMMUTABLE_RECORD');
    }

    // 4. rien n'a changé
    expect(await holdRow(worker, holdId)).toEqual(before);
  });

  // ---------------------------------------------------------------------------------------------
  // Critère 4 (C5) : hold en paiement après expires_at
  // ---------------------------------------------------------------------------------------------
  it('critère 4 (C5) : hold PAYMENT_IN_FLIGHT après expires_at, avant payment_in_flight_until ⇒ B reçoit 409, A n’est pas expiré', async () => {
    const T0 = '2033-01-09T10:00:00.000Z';
    const w = await world(api, c, 1, 2);
    const [a, b] = w.guests as [string, string];
    const slot = slotOf(w.vehicles[0] as string, w.orgId, T0);
    const holdA = (await pose(api, a, slot, T0)).holdId as string;
    // T1 à T0 + 8 min : borne provisoire T0 + 14 min (≤ T0 + hold_max_total_minutes)
    await paymentInFlight(api, holdA, c, at(T0, 8), at(T0, 14));

    const racing = await pose(api, b, slot, at(T0, 12));
    expect(racing.code).toBe('VEHICLE_UNAVAILABLE');
    expect(racing.raw).toEqual({ code: '23P01', constraint: 'vehicle_occupancy_no_overlap' });
    expect(await holdRow(worker, holdA)).toMatchObject({
      status: 'PAYMENT_IN_FLIGHT',
      occupancy_active: true,
    });

    // borne + sweep_grace_s dépassées sans lecture du PSP : la pose de B expire A (2a) et réussit
    const later = await pose(api, b, slot, atSec(T0, 14 * 60 + SWEEP_GRACE_S + 1));
    expect(later.code).toBeUndefined();
    expect((await holdRow(worker, holdA))?.status).toBe('EXPIRED');
  });

  // ---------------------------------------------------------------------------------------------
  // Critère 5 : revue avant le débit (UXQ-08)
  // ---------------------------------------------------------------------------------------------
  it('critère 5 : réservation signalée ⇒ review_required, durée review_hold_minutes, aucun paiement avant reviewed_at ; non signalée ⇒ 10 min', async () => {
    const T = '2033-01-11T10:00:00.000Z';
    const w = await world(api, c, 3, 3);
    const durations: Record<string, { review: boolean; minutes: number }> = {};
    const holds: Record<string, string> = {};
    for (const [i, flagged] of ([true, null, false] as const).entries()) {
      const placed = await pose(
        api,
        w.guests[i] as string,
        slotOf(w.vehicles[i] as string, w.orgId, T),
        T,
        flagged,
      );
      expect(placed.code).toBeUndefined();
      const row = await holdRow(worker, placed.holdId as string);
      const key = String(flagged);
      holds[key] = placed.holdId as string;
      durations[key] = {
        review: row?.review_required ?? false,
        minutes: ((row?.expires_at.getTime() ?? 0) - (row?.created_at.getTime() ?? 0)) / MIN,
      };
    }
    expect(durations).toEqual({
      true: { review: true, minutes: REVIEW_HOLD_MIN },
      null: { review: true, minutes: REVIEW_HOLD_MIN }, // signal absent : fail-closed
      false: { review: false, minutes: HOLD_TTL_MIN },
    });
    // aucune intention de paiement avant reviewed_at (CHECK hold_review_before_payment)
    const err = await inTx(api, { virtualNow: at(T, 1) }, (tx) =>
      tx
        .query('SELECT test_fixture.l0_set_payment_in_flight($1, $2::timestamptz)', [
          holds['true'],
          at(T, 15),
        ])
        .then(
          () => null,
          (e: unknown) => e,
        ),
    );
    expect(err).toMatchObject({ code: '23514', constraint: 'hold_review_before_payment' });
    expect(translateDbError(err).code).toBe('BOOKING_UNDER_REVIEW');
    // le hold ordinaire, lui, peut entrer en paiement
    await paymentInFlight(api, holds['false'] as string, c, at(T, 1), at(T, 15));
    expect((await holdRow(worker, holds['false'] as string))?.status).toBe('PAYMENT_IN_FLIGHT');
  });

  it('critère 5 : PAY_THEN_REVIEW (autre branche d’UXQ-08) ⇒ réservation signalée posée en hold ordinaire', async () => {
    const T = '2033-01-13T10:00:00.000Z';
    const w = await world(api, c, 1, 1);
    // version du paramètre écrite puis ANNULÉE avec la pose (même transaction)
    const row = await inTx(api, { virtualNow: T }, async (tx) => {
      await tx.query('SELECT test_fixture.config_flag_order($1, $2)', [
        c.country,
        'PAY_THEN_REVIEW',
      ]);
      const holdId = await placeHoldCommand(tx, {
        slot: slotOf(w.vehicles[0] as string, w.orgId, T),
        guestId: w.guests[0] as string,
        flagged: true,
      });
      const { rows } = await tx.query<{ status: string; expires_at: Date }>(
        'SELECT status, expires_at FROM core.booking_checkout_hold WHERE id = $1',
        [holdId],
      );
      return rows[0];
    });
    expect(row?.status).toBe('ACTIVE');
    expect(row?.expires_at.toISOString()).toBe(at(T, HOLD_TTL_MIN));
  });

  // ---------------------------------------------------------------------------------------------
  // RLS-4, RLS-11, RLS-14
  // ---------------------------------------------------------------------------------------------
  it('RLS-4 : trip BOOKED chez l’hôte A, hold chevauchant chez l’hôte B ⇒ GUEST_OVERLAP ; hors chevauchement ⇒ accepté', async () => {
    const T0 = '2033-01-15T10:00:00.000Z';
    const hostA = await world(api, c, 1, 0);
    const hostB = await world(api, c, 2, 0);
    const slotA = slotOf(hostA.vehicles[0] as string, hostA.orgId, T0);
    const { hold } = await bookTrip(api, worker, slotA, c, T0);
    const guest = hold.guestId;
    const overlapping = await pose(
      api,
      guest,
      slotOf(hostB.vehicles[0] as string, hostB.orgId, T0),
      at(T0, 30),
    );
    expect(overlapping.code).toBe('GUEST_OVERLAP');
    expect(overlapping.raw).toEqual({ code: '55000', constraint: 'hold_guest_overlap' });
    const afterTrip = await pose(
      api,
      guest,
      slotOf(hostB.vehicles[1] as string, hostB.orgId, T0, 10),
      at(T0, 30),
    );
    expect(afterTrip.code).toBeUndefined();
  });

  it('RLS-11 : la fonction de garde ne renvoie aucune ligne hors session voyageur ; app_anon ne l’exécute pas', async () => {
    const period = '[2033-02-01T00:00:00Z,2033-02-02T00:00:00Z)';
    const contexts: [string, SessionContext | null, number][] = [
      ['hôte', { kind: 'HOST', actorId: uuid(), orgId: uuid() }, 0],
      ['travailleur', { kind: 'WORKER', workerName: 'hold_expiry' }, 0],
      ['sans contexte', null, 0],
      ['voyageur', guestCtx(uuid()), 1],
    ];
    for (const [label, ctx, expected] of contexts) {
      const rows = await inTx(api, {}, async (tx) => {
        if (ctx !== null) await setSessionContext(tx, ctx);
        const r = await tx.query<{ live_holds: number; trip_overlap: boolean }>(
          'SELECT * FROM platform.guest_hold_guard($1::tstzrange)',
          [period],
        );
        return r.rows;
      });
      expect(rows, label).toHaveLength(expected);
      if (expected === 1) expect(rows[0]).toEqual({ live_holds: 0, trip_overlap: false });
    }
    await withRole('app_anon', async (anon) => {
      await expect(
        anon.query('SELECT * FROM platform.guest_hold_guard($1::tstzrange)', [period]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('RLS-14 / C9 : hold échu du voyageur A (non balayé) expiré par la pose de B, qui obtient le sien sans rien apprendre de A ; A réessaie aussitôt', async () => {
    const T0 = '2033-01-17T10:00:00.000Z';
    const w = await world(api, c, 2, 2);
    const [a, b] = w.guests as [string, string];
    const slot = slotOf(w.vehicles[0] as string, w.orgId, T0);
    const holdA = (await pose(api, a, slot, T0)).holdId as string;
    const late = at(T0, HOLD_TTL_MIN + 1);
    const holdB = await pose(api, b, slot, late);
    expect(holdB.code).toBeUndefined();
    expect(await holdRow(worker, holdA)).toMatchObject({
      status: 'EXPIRED',
      occupancy_active: false,
      deactivated_reason: 'HOLD_EXPIRED',
    });
    // B ne voit que son propre hold ; le résultat de la commande n'est que son identifiant
    const seen = await inTx(api, { virtualNow: late }, async (tx) => {
      await setSessionContext(tx, guestCtx(b));
      const { rows } = await tx.query<{ id: string }>(
        'SELECT id FROM core.booking_checkout_hold WHERE vehicle_id = $1',
        [slot.vehicleId],
      );
      return rows.map((r) => r.id);
    });
    expect(seen).toEqual([holdB.holdId]);
    // C9 : A réessaie aussitôt sur un autre créneau du même véhicule
    const retry = await pose(api, a, slotOf(slot.vehicleId, w.orgId, T0, 20), late);
    expect(retry.code).toBeUndefined();
  });

  // ---------------------------------------------------------------------------------------------
  // Libération (17 §2.5 étape 6), rotation, auto-réservation, hôte non activé
  // ---------------------------------------------------------------------------------------------
  it('libération sans ordre vivant : RELEASED, créneau libre, rejeu NOOP ; hold converti : INVALID_TRANSITION', async () => {
    const T0 = '2033-01-19T10:00:00.000Z';
    const w = await world(api, c, 2, 2);
    const [g, other] = w.guests as [string, string];
    const slot = slotOf(w.vehicles[0] as string, w.orgId, T0);
    const holdId = (await pose(api, g, slot, T0)).holdId as string;
    expect((await release(api, guestCtx(g), holdId, at(T0, 2))).result).toBe('RELEASED');
    expect(await holdRow(worker, holdId)).toMatchObject({
      status: 'RELEASED',
      release_reason: 'GUEST_ABANDON',
      occupancy_active: false,
      deactivated_reason: 'HOLD_RELEASED',
    });
    expect(await holdEvents(worker, holdId)).toEqual(
      expect.arrayContaining(['booking.hold.created', 'booking.hold.released']),
    );
    expect((await release(api, guestCtx(g), holdId, at(T0, 3))).result).toBe('NOOP');
    expect((await pose(api, other, slot, at(T0, 3))).code).toBeUndefined();

    const { hold } = await bookTrip(
      api,
      worker,
      slotOf(w.vehicles[1] as string, w.orgId, T0, 30),
      c,
      T0,
    );
    const converted = await release(api, guestCtx(hold.guestId), hold.holdId, at(T0, 5));
    expect(converted.code).toBe('INVALID_TRANSITION');
    expect(converted.raw).toEqual({ code: '55000', constraint: 'hold_release_terminal' });
  });

  it('libération différée : ordre vivant ⇒ DEFERRED, créneau retenu ; la tâche libère après la borne et sweep_grace_s', async () => {
    const T0 = atSec(await paramsEra(api, c), 1); // M + 1 s (distinct du critère 1)
    const w = await world(api, c, 1, 2);
    const [g, other] = w.guests as [string, string];
    const slot = slotOf(w.vehicles[0] as string, w.orgId, T0);
    const holdId = (await pose(api, g, slot, T0)).holdId as string;
    // ordre PENDING, borne à T0 + 1 min, jamais lu par le balayage
    await paymentInFlight(api, holdId, c, T0, at(T0, 1));
    expect((await release(api, guestCtx(g), holdId, atSec(T0, 30))).result).toBe('DEFERRED');
    const deferred = await holdRow(worker, holdId);
    expect(deferred).toMatchObject({
      status: 'PAYMENT_IN_FLIGHT',
      release_reason: 'GUEST_ABANDON',
      occupancy_active: true,
    });
    expect(deferred?.release_requested_at?.toISOString()).toBe(atSec(T0, 30));
    expect((await release(api, guestCtx(g), holdId, atSec(T0, 36))).result).toBe('DEFERRED');
    // créneau retenu pendant l'ordre
    expect((await pose(api, other, slot, atSec(T0, 42))).code).toBe('VEHICLE_UNAVAILABLE');
    // avant borne + grâce : la tâche ne libère pas
    await runExpiryJob(worker, atSec(T0, 60 + SWEEP_GRACE_S - 1));
    expect((await holdRow(worker, holdId))?.status).toBe('PAYMENT_IN_FLIGHT');
    // après : RELEASED (et non EXPIRED), occupation libérée
    await runExpiryJob(worker, atSec(T0, 60 + SWEEP_GRACE_S + 1));
    const released = await holdRow(worker, holdId);
    expect(released).toMatchObject({
      status: 'RELEASED',
      occupancy_active: false,
      deactivated_reason: 'HOLD_RELEASED',
    });
    expect(released?.released_at?.toISOString()).toBe(atSec(T0, 60 + SWEEP_GRACE_S + 1));
  });

  it('rotation : 3 poses par voyageur, véhicule et heure glissante, la 4ᵉ ⇒ HOLD_RATE_LIMITED ; une heure après, acceptée', async () => {
    const T0 = '2033-01-21T10:00:00.000Z';
    const w = await world(api, c, 1, 1);
    const g = w.guests[0] as string;
    const vehicle = w.vehicles[0] as string;
    for (let i = 0; i < RATE_PER_HOUR; i++) {
      const placed = await pose(api, g, slotOf(vehicle, w.orgId, T0, 10 + 3 * i), at(T0, i));
      expect(placed.code, `pose ${i + 1}`).toBeUndefined();
      expect(
        (await release(api, guestCtx(g), placed.holdId as string, atSec(T0, i * 60 + 30))).result,
      ).toBe('RELEASED');
    }
    const fourth = await pose(api, g, slotOf(vehicle, w.orgId, T0, 30), at(T0, 10));
    expect(fourth.code).toBe('HOLD_RATE_LIMITED');
    expect(fourth.raw).toEqual({ code: '55000', constraint: 'hold_rate_limited' });
    const nextHour = await pose(api, g, slotOf(vehicle, w.orgId, T0, 30), at(T0, 61));
    expect(nextHour.code).toBeUndefined();
  });

  it('auto-réservation : le titulaire du compte d’hôte ⇒ SELF_BOOKING_FORBIDDEN ; hôte non activé ⇒ HOST_NOT_ACTIVATED ; aucun hold', async () => {
    const T = '2033-01-23T10:00:00.000Z';
    const active = uuid();
    const onboarding = uuid();
    const vActive = uuid();
    const vOnboarding = uuid();
    const guest = uuid();
    const holder = await inTx(api, { commit: true }, async (tx) => {
      const { rows } = await tx.query<{ h: string }>(
        'SELECT test_fixture.create_org($1, $2, $3) AS h',
        [active, c.country, 'ACTIVE'],
      );
      await tx.query('SELECT test_fixture.create_org($1, $2, $3)', [
        onboarding,
        c.country,
        'ONBOARDING',
      ]);
      await ensureParties(tx, [guest], active, c);
      await registerVehicles(tx, [vActive], active, c);
      await registerVehicles(tx, [vOnboarding], onboarding, c);
      return rows[0]?.h as string;
    });
    const self = await pose(api, holder, slotOf(vActive, active, T), T);
    expect(self.code).toBe('SELF_BOOKING_FORBIDDEN');
    const inactive = await pose(api, guest, slotOf(vOnboarding, onboarding, T), T);
    expect(inactive.code).toBe('HOST_NOT_ACTIVATED');
    expect(await liveHolds(worker, holder)).toBe(0);
    expect(await liveHolds(worker, guest)).toBe(0);
  });
});
