/**
 * US-305 — détection automatique des retards (migration 0168, ADR-188 ; fixture 9917, et 9963
 * réutilisée). Rôles de PRODUCTION seulement (assertion L0-05 par `connectAs`), au Panama (USD,
 * America/Panama) et au Paraguay (PYG sans décimale, America/Asuncion) : chaque trip est posé par
 * le parcours nominal (hold → preuve signée → conversion gardée d'US-024) puis mené IN_PROGRESS
 * par la machine à états d'US-207.
 *
 * Attendus tirés de 19 US-305 (fin à 10:00 du pays, `overdue_detection_minutes` = 30 : rien à
 * 10:29, OVERDUE et une seule alerte à 10:30 ; C10 : aucun chevauchement actif, trip suivant à
 * risque ; variante PY), de 16 TRP-035 (« seuls les trips réservés ensuite l'appliquent » ; EC-19),
 * de 08 BR-RETURN-03 (franchise 0–29 min) et BR-BOOK-05 (tampon de 120 min), de 17 §2.5
 * (« Retard et prolongation tacite » : [début, now() + overdue_occupancy_step_minutes (60) +
 * tampon), bornée au début de l'occupation suivante ; C10) et §7.2 (défauts PROPOSÉS 30, 60, 120),
 * et du pré-mortem du lot 3 (L3-PM-09 heure serveur, L3-PM-13 occupation, L3-PM-15 une alerte et
 * C10, L3-PM-55 deux pays), jamais du code testé.
 *
 * Aucun montant n'est attendu : US-305 n'écrit rien d'argent (le frais de retard, `lateFee` =
 * max(grille, extension), est porté par US-703). La variante PY rejoue donc les mêmes critères
 * (bornes, alerte unique, C10) et prouve l'absence de toute écriture d'argent, de part et d'autre.
 *
 * Concurrence : une connexion par client (libérée en fin de test) et une connexion d'observation
 * pour chaque attente (`waitUntilBlocked`).
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import {
  at,
  bookTrip,
  convert,
  COUNTRIES,
  inTx,
  insertRentOperation,
  newSlot,
  placeHold,
  receiveProof,
  slotPeriod,
  uuid,
} from '../support/avl.ts';
import type { CountryCase, Hold, Slot } from '../support/avl.ts';
import {
  backendPid,
  ensureParties,
  placeHoldLocked,
  waitUntilBlocked,
} from '../support/concurrency.ts';

type Row = Record<string, unknown>;

/** 17 §7.2 : défauts PROPOSÉS au PA et au PY (graine 0009). */
const DETECTION_MIN = 30;
const STEP_MIN = 60;
const BUFFER_MIN = 120;
/** Valeur de TEST (transaction annulée) : distincte du défaut, elle prouve la lecture par pays. */
const VARIED_MIN = 45;
const NEW_PARAM_VERSION = `INSERT INTO core.config_param_value
  (key, country_code, scope_type, value, change_reason)
  VALUES ($1, $2, 'COUNTRY', $3::jsonb, 'test US-305 (annulé) : seuil à la réservation')`;

const DETECT = 'SELECT core.trip_cmd_detect_overdue($1::uuid) AS r';
const DUE = 'SELECT trip_id FROM core.trip_overdue_due($1)';
const TRANSITION = 'SELECT core.booking_cmd_trip_transition($1, $2, $3, NULL) AS r';

const T0 = '2036-05-04T12:00:00.000Z';
const DAY_MS = 86_400_000;

/** Instant UTC dont l'heure murale est `hhmm` le jour `day` dans le fuseau `tz` (donnée pays). */
function localInstant(day: string, hhmm: string, tz: string): string {
  const guess = Date.parse(`${day}T${hhmm}:00.000Z`);
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const wall = Date.parse(
    `${p['year']}-${p['month']}-${p['day']}T${p['hour']}:${p['minute']}:00.000Z`,
  );
  return new Date(guess - (wall - guess)).toISOString();
}

/** Heure murale `HH:MM` d'un instant dans le fuseau `tz`. */
function wallClock(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

let slotDay = 0;
/** Créneau propre (véhicule neuf), de 10:00 à 10:00 locales deux jours plus tard. */
function freshSlot(c: CountryCase): Slot {
  slotDay += 4;
  const d0 = new Date(Date.parse('2036-06-01T00:00:00.000Z') + slotDay * DAY_MS);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return newSlot(
    localInstant(day(d0), '10:00', c.timezone),
    localInstant(day(new Date(d0.getTime() + 2 * DAY_MS)), '10:00', c.timezone),
  );
}

/** Créneau suivant du MÊME véhicule, à `offsetMin` de la fin du premier. */
const nextSlot = (s: Slot, offsetMin: number): Slot => ({
  vehicleId: s.vehicleId,
  orgId: s.orgId,
  start: at(s.end, offsetMin),
  end: at(s.end, offsetMin + 2 * 24 * 60),
  bufferHours: s.bufferHours,
});

interface Clients {
  readonly api: pg.Client;
  readonly worker: pg.Client;
}

async function withClients<T>(fn: (c: Clients) => Promise<T>): Promise<T> {
  const api = await connectAs('app_api');
  try {
    const worker = await connectAs('app_worker');
    try {
      return await fn({ api, worker });
    } finally {
      await releaseClient(worker);
    }
  } finally {
    await releaseClient(api);
  }
}

/** Connexions supplémentaires (une par client concurrent, une par boucle d'attente). */
async function withExtra<T>(
  roles: readonly ('app_api' | 'app_worker')[],
  fn: (clients: pg.Client[]) => Promise<T>,
): Promise<T> {
  const clients: pg.Client[] = [];
  try {
    for (const r of roles) clients.push(await connectAs(r));
    return await fn(clients);
  } finally {
    for (const c of clients) await releaseClient(c);
  }
}

interface Booked {
  readonly tripId: string;
  readonly guestId: string;
  readonly slot: Slot;
}

async function booked(cl: Clients, c: CountryCase, slot: Slot = freshSlot(c)): Promise<Booked> {
  const { hold, tripId } = await bookTrip(cl.api, cl.worker, slot, c, T0);
  // US-211 (0122) : la remise (IN_PROGRESS) exige le contrat de location signé par le voyageur
  await cl.worker.query('SELECT test_fixture.us211_sign($1)', [tripId]);
  return { tripId, guestId: hold.guestId, slot };
}

async function lifecycle(cl: Clients, now: string, trip: string, to: string, reason: string) {
  const r = await inTx(
    cl.worker,
    { worker: 'trip_lifecycle', virtualNow: now, commit: true },
    (tx) => tx.query<{ r: Row }>(TRANSITION, [trip, to, reason]),
  );
  return r.rows[0]?.r;
}

/** Remise faite (US-207) : CHECKIN_OPEN une heure avant le début, IN_PROGRESS à début + 5 min. */
async function inProgress(cl: Clients, c: CountryCase, slot?: Slot): Promise<Booked> {
  const b = await booked(cl, c, slot);
  await lifecycle(cl, at(b.slot.start, -60), b.tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED');
  await lifecycle(cl, at(b.slot.start, 5), b.tripId, 'IN_PROGRESS', 'CHECKIN_VALIDATED');
  return b;
}

/** Détection validée sous `trip_overdue` à l'instant `now`. */
async function detect(cl: Clients, trip: string, now: string): Promise<Row> {
  return inTx(cl.worker, { worker: 'trip_overdue', virtualNow: now, commit: true }, async (tx) => {
    const r = await tx.query<{ r: Row }>(DETECT, [trip]);
    return r.rows[0]!.r;
  });
}

async function due(cl: Clients, now: string): Promise<string[]> {
  return inTx(cl.worker, { worker: 'trip_overdue', virtualNow: now }, async (tx) =>
    (await tx.query<{ trip_id: string }>(DUE, [1000])).rows.map((r) => r.trip_id),
  );
}

async function records(cl: Clients, trip: string): Promise<Row> {
  const r = await cl.worker.query<{ r: Row }>('SELECT test_fixture.us305_records($1) AS r', [trip]);
  return r.rows[0]!.r;
}

async function money(cl: Clients, trip: string): Promise<Row> {
  const r = await cl.worker.query<{ r: Row }>('SELECT test_fixture.us305_money($1) AS r', [trip]);
  return r.rows[0]!.r;
}

/** Instant d'un champ jsonb (texte ISO du serveur) au format de comparaison. */
const iso = (v: unknown): string | null =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const eventsOf = (r: Row, type: string): Row[] =>
  (r['events'] as Row[]).filter((e) => e['type'] === type);
const caseOf = (r: Row): Row => r['case'] as Row;

/** Occupations actives du véhicule, triées (lecture sous booking_conversion, politique de 0007). */
async function activePeriods(cl: Clients, vehicleId: string) {
  return inTx(cl.worker, { worker: 'booking_conversion' }, async (tx) => {
    const r = await tx.query<{ kind: string; lo: Date; hi: Date }>(
      `SELECT kind, lower(period) AS lo, upper(period) AS hi FROM core.booking_vehicle_occupancy
        WHERE vehicle_id = $1 AND active ORDER BY lower(period)`,
      [vehicleId],
    );
    return r.rows;
  });
}

/** Aucun chevauchement entre occupations actives du véhicule (exclusion GiST, C10). */
function assertNoOverlap(rows: readonly { lo: Date; hi: Date }[]): void {
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i - 1]!.hi.getTime()).toBeLessThanOrEqual(rows[i]!.lo.getTime());
  }
}

async function begin(client: pg.ClientBase, now: string, worker: string | null): Promise<void> {
  await client.query('BEGIN');
  await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [now]);
  if (worker !== null) {
    await client.query(
      `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
              pg_catalog.set_config('app.worker_name', $1, true)`,
      [worker],
    );
  }
}

const rollback = (client: pg.ClientBase) => client.query('ROLLBACK').catch(() => undefined);

describe.each(COUNTRIES)('US-305 — détection des retards ($country, $currency, $timezone)', (c) => {
  it('critère 1 : fin à 10:00 du pays, seuil 30 min ⇒ rien à 10:29 ni 10:29:59 ; à 10:30 OVERDUE, dossier T30M et UN trip.overdue.detected ; rejeux sans second événement ; prolongation tacite ; aucune écriture d’argent', async () => {
    await withClients(async (cl) => {
      const b = await inProgress(cl, c);
      const end = b.slot.end;
      expect(wallClock(end, c.timezone)).toBe('10:00');
      const money0 = await money(cl, b.tripId);

      // 10:29 et 10:29:59 : franchise (BR-RETURN-03), rien n'est écrit, rien n'est listé
      expect(await detect(cl, b.tripId, at(end, DETECTION_MIN - 1))).toMatchObject({
        outcome: 'NOT_DUE',
        status: 'IN_PROGRESS',
      });
      const justBefore = new Date(Date.parse(end) + DETECTION_MIN * 60_000 - 1_000).toISOString();
      expect(wallClock(justBefore, c.timezone)).toBe('10:29');
      expect(await due(cl, justBefore)).not.toContain(b.tripId);
      expect(await detect(cl, b.tripId, justBefore)).toMatchObject({ outcome: 'NOT_DUE' });
      let r = await records(cl, b.tripId);
      expect(r).toMatchObject({ status: 'IN_PROGRESS', case: null, overdueTransitions: 0 });
      expect(r['events']).toEqual([]);

      // 10:30 : OVERDUE, dossier, un événement, prolongation [début, 10:30 + 60 + 120)
      const t30 = at(end, DETECTION_MIN);
      expect(wallClock(t30, c.timezone)).toBe('10:30');
      expect(await due(cl, t30)).toContain(b.tripId);
      const first = await detect(cl, b.tripId, t30);
      expect(first).toMatchObject({
        outcome: 'DETECTED',
        status: 'OVERDUE',
        bounded: false,
        nextAtRisk: false,
      });
      expect(iso(first['useUntil'])).toBe(at(t30, STEP_MIN));
      expect(iso(first['occupancyUntil'])).toBe(at(t30, STEP_MIN + BUFFER_MIN));
      r = await records(cl, b.tripId);
      expect(r).toMatchObject({ status: 'OVERDUE', overdueTransitions: 1, atRiskReason: null });
      const cs = caseOf(r);
      expect(cs).toMatchObject({
        stage: 'T30M',
        countryCode: c.country,
        detectionMinutes: DETECTION_MIN,
        bounded: false,
        nextTripId: null,
      });
      expect(iso(cs['scheduledEnd'])).toBe(end);
      expect(iso(cs['detectedAt'])).toBe(t30);
      expect(iso(cs['useUntil'])).toBe(at(t30, STEP_MIN));
      expect(iso(cs['occupancyUntil'])).toBe(at(t30, STEP_MIN + BUFFER_MIN));
      const occ = r['occupancy'] as Row;
      expect(occ['active']).toBe(true);
      expect(iso(occ['lower'])).toBe(b.slot.start);
      expect(iso(occ['upper'])).toBe(at(t30, STEP_MIN + BUFFER_MIN));
      const detected = eventsOf(r, 'trip.overdue.detected');
      expect(detected).toHaveLength(1);
      expect(detected[0]).toMatchObject({ countryCode: c.country, actorRole: 'SYSTEM' });
      const payload = detected[0]!['payload'] as Row;
      expect(payload).toMatchObject({
        trip_id: b.tripId,
        stage: 'T30M',
        guest_user_id: b.guestId,
        host_user_id: r['holderUserId'],
      });
      expect(iso(payload['scheduled_end'])).toBe(end);
      expect(iso(payload['detected_at'])).toBe(t30);
      expect(eventsOf(r, 'trip.status_changed')).toHaveLength(1);

      // minuterie rejouée (même instant, minute suivante) : aucun second événement
      expect(await detect(cl, b.tripId, t30)).toMatchObject({ outcome: 'UNCHANGED' });
      expect(await detect(cl, b.tripId, at(t30, 1))).toMatchObject({ outcome: 'UNCHANGED' });
      expect(await due(cl, at(t30, 1))).not.toContain(b.tripId);
      // prolongation épuisée à 11:30 : nouvelle prolongation de 60 min, toujours un seul événement
      expect(await due(cl, at(t30, STEP_MIN))).toContain(b.tripId);
      const again = await detect(cl, b.tripId, at(t30, STEP_MIN));
      expect(again).toMatchObject({ outcome: 'EXTENDED', bounded: false });
      expect(iso(again['occupancyUntil'])).toBe(at(t30, 2 * STEP_MIN + BUFFER_MIN));
      r = await records(cl, b.tripId);
      expect(eventsOf(r, 'trip.overdue.detected')).toHaveLength(1);
      expect(r['overdueTransitions']).toBe(1);
      expect(iso((r['occupancy'] as Row)['upper'])).toBe(at(t30, 2 * STEP_MIN + BUFFER_MIN));

      // aucune écriture d'argent ni de release_at (US-703 porte le frais de retard)
      expect(await money(cl, b.tripId)).toEqual(money0);
    });
  });

  it('critère 1 : deux travailleurs à 10:30 sur le même trip ⇒ le second attend les verrous puis ne trouve rien à faire ; une transition, un dossier, un événement', async () => {
    await withClients(async (cl) => {
      const b = await inProgress(cl, c);
      const t30 = at(b.slot.end, DETECTION_MIN);
      await withExtra(['app_worker', 'app_worker', 'app_api'], async ([a, w2, observer]) => {
        try {
          await begin(a!, t30, 'trip_overdue');
          await begin(w2!, t30, 'trip_overdue');
          const ra = (await a!.query<{ r: Row }>(DETECT, [b.tripId])).rows[0]!.r;
          expect(ra).toMatchObject({ outcome: 'DETECTED' });
          const pid = await backendPid(w2!);
          const pending = w2!.query<{ r: Row }>(DETECT, [b.tripId]);
          await waitUntilBlocked(observer!, pid, 'advisory');
          await a!.query('COMMIT');
          const rb = (await pending).rows[0]!.r;
          expect(rb).toMatchObject({ outcome: 'UNCHANGED', status: 'OVERDUE' });
          await w2!.query('COMMIT');
        } catch (error) {
          await rollback(a!);
          await rollback(w2!);
          throw error;
        }
      });
      const r = await records(cl, b.tripId);
      expect(r['overdueTransitions']).toBe(1);
      expect(eventsOf(r, 'trip.overdue.detected')).toHaveLength(1);
      expect(eventsOf(r, 'trip.status_changed')).toHaveLength(1);
    });
  });

  it('un retour validé à 10:20 serveur n’est jamais OVERDUE ; un retour qui tient les verrous à 10:30 passe avant la détection, qui ne trouve plus rien (heure lue après les verrous)', async () => {
    await withClients(async (cl) => {
      const b = await inProgress(cl, c);
      await lifecycle(cl, at(b.slot.end, 20), b.tripId, 'RETURNED', 'CHECKOUT_VALIDATED');
      const t30 = at(b.slot.end, DETECTION_MIN);
      expect(await due(cl, t30)).not.toContain(b.tripId);
      expect(await detect(cl, b.tripId, t30)).toMatchObject({
        outcome: 'SKIPPED',
        status: 'RETURNED',
      });
      let r = await records(cl, b.tripId);
      expect(r).toMatchObject({ status: 'RETURNED', case: null, overdueTransitions: 0 });
      expect(r['events']).toEqual([]);

      const b2 = await inProgress(cl, c);
      const t30b = at(b2.slot.end, DETECTION_MIN);
      await withExtra(['app_worker', 'app_worker', 'app_api'], async ([ret, det, observer]) => {
        try {
          await begin(ret!, t30b, 'trip_lifecycle');
          await begin(det!, t30b, 'trip_overdue');
          await ret!.query(TRANSITION, [b2.tripId, 'RETURNED', 'CHECKOUT_VALIDATED']);
          const pid = await backendPid(det!);
          const pending = det!.query<{ r: Row }>(DETECT, [b2.tripId]);
          await waitUntilBlocked(observer!, pid, 'advisory');
          await ret!.query('COMMIT');
          expect((await pending).rows[0]!.r).toMatchObject({
            outcome: 'SKIPPED',
            status: 'RETURNED',
          });
          await det!.query('COMMIT');
        } catch (error) {
          await rollback(ret!);
          await rollback(det!);
          throw error;
        }
      });
      r = await records(cl, b2.tripId);
      expect(r).toMatchObject({ status: 'RETURNED', case: null, overdueTransitions: 0 });
      expect(r['events']).toEqual([]);
    });
  });

  it('C10 (le hold d’abord) : un hold posé sur la période suivante pendant la détection ⇒ prolongation bornée à son début, aucun chevauchement actif ; le hold converti en trip ⇒ ce trip est marqué à risque, une seule fois', async () => {
    await withClients(async (cl) => {
      const b = await inProgress(cl, c);
      const t30 = at(b.slot.end, DETECTION_MIN);
      // période suivante : libre après le tampon (fin + 120), prise avant la prolongation visée
      // (10:30 + 60 + 120 = fin + 210)
      const s2 = nextSlot(b.slot, 180);
      const guestB = uuid();
      await inTx(cl.api, { commit: true }, (tx) => ensureParties(tx, [guestB], s2.orgId, c));
      const box: { hold?: Hold; operationId?: string } = {};
      await withExtra(['app_api', 'app_worker', 'app_api'], async ([poser, det, observer]) => {
        try {
          await begin(poser!, at(b.slot.end, DETECTION_MIN - 1), null);
          const pose = await placeHoldLocked(poser!, {
            slot: s2,
            c,
            guestId: guestB,
            period: slotPeriod(s2),
            vehicleLock: true,
          });
          box.hold = {
            holdId: pose.holdId,
            occupancyId: pose.occupancyId,
            guestId: guestB,
            slot: s2,
            c,
          };
          box.operationId = await insertRentOperation(poser!, box.hold);
          await begin(det!, t30, 'trip_overdue');
          const pid = await backendPid(det!);
          const pending = det!.query<{ r: Row }>(DETECT, [b.tripId]);
          await waitUntilBlocked(observer!, pid, 'advisory');
          await poser!.query('COMMIT');
          const r = (await pending).rows[0]!.r;
          expect(r).toMatchObject({ outcome: 'DETECTED', bounded: true, nextAtRisk: false });
          expect(iso(r['occupancyUntil'])).toBe(s2.start);
          await det!.query('COMMIT');
        } catch (error) {
          await rollback(poser!);
          await rollback(det!);
          throw error;
        }
      });
      let periods = await activePeriods(cl, b.slot.vehicleId);
      expect(periods.map((p) => p.kind)).toEqual(['TRIP', 'HOLD']);
      expect(periods[0]!.hi.toISOString()).toBe(s2.start);
      assertNoOverlap(periods);
      expect(caseOf(await records(cl, b.tripId))).toMatchObject({
        bounded: true,
        nextTripId: null,
      });

      // le hold devient un trip (preuve signée, conversion gardée) : passage suivant ⇒ à risque
      const { hold, operationId } = box;
      if (hold === undefined || operationId === undefined) throw new Error('hold absent');
      await inTx(
        cl.worker,
        { worker: 'webhook_ingest', virtualNow: at(t30, 1), commit: true },
        (tx) => receiveProof(tx, operationId),
      );
      const conv = await inTx(
        cl.worker,
        { worker: 'booking_conversion', virtualNow: at(t30, 2), commit: true },
        (tx) => convert(tx, hold, operationId),
      );
      if (conv.kind !== 'TRIP') throw new Error(`conversion inattendue : ${conv.kind}`);
      expect(await due(cl, at(t30, 3))).toContain(b.tripId);
      expect(await detect(cl, b.tripId, at(t30, 3))).toMatchObject({
        outcome: 'UNCHANGED',
        bounded: true,
        nextAtRisk: true,
      });
      expect(await detect(cl, b.tripId, at(t30, 4))).toMatchObject({ nextAtRisk: false });
      const next = await records(cl, conv.tripId);
      expect(next).toMatchObject({ status: 'BOOKED', atRiskReason: 'PREVIOUS_OVERDUE' });
      const flagged = eventsOf(next, 'trip.at_risk.flagged');
      expect(flagged).toHaveLength(1);
      expect(flagged[0]).toMatchObject({ countryCode: c.country, actorRole: 'SYSTEM' });
      expect(flagged[0]!['payload']).toMatchObject({
        trip_id: conv.tripId,
        reason: 'PREVIOUS_OVERDUE',
        host_user_id: next['holderUserId'],
      });
      expect(iso((flagged[0]!['payload'] as Row)['scheduled_start'])).toBe(s2.start);
      expect(caseOf(await records(cl, b.tripId))).toMatchObject({ nextTripId: conv.tripId });
      periods = await activePeriods(cl, b.slot.vehicleId);
      expect(periods.map((p) => p.kind)).toEqual(['TRIP', 'TRIP']);
      assertNoOverlap(periods);
    });
  });

  it('C10 (la prolongation d’abord) : la pose d’un hold sur la période prolongée attend le verrou du véhicule puis est refusée (VEHICLE_UNAVAILABLE) ; aucun chevauchement actif', async () => {
    await withClients(async (cl) => {
      const b = await inProgress(cl, c);
      const t30 = at(b.slot.end, DETECTION_MIN);
      const s2 = nextSlot(b.slot, 180);
      const guestB = uuid();
      await inTx(cl.api, { commit: true }, (tx) => ensureParties(tx, [guestB], s2.orgId, c));
      await withExtra(['app_worker', 'app_api', 'app_api'], async ([det, poser, observer]) => {
        try {
          await begin(det!, t30, 'trip_overdue');
          const r = (await det!.query<{ r: Row }>(DETECT, [b.tripId])).rows[0]!.r;
          expect(r).toMatchObject({ outcome: 'DETECTED', bounded: false });
          await begin(poser!, t30, null);
          const pid = await backendPid(poser!);
          const pending = placeHoldLocked(poser!, {
            slot: s2,
            c,
            guestId: guestB,
            period: slotPeriod(s2),
            vehicleLock: true,
          }).then(
            () => 'POSED',
            (error: unknown) => translateDbError(error).code,
          );
          await waitUntilBlocked(observer!, pid, 'advisory');
          await det!.query('COMMIT');
          expect(await pending).toBe('VEHICLE_UNAVAILABLE');
          await rollback(poser!);
        } catch (error) {
          await rollback(det!);
          await rollback(poser!);
          throw error;
        }
      });
      const periods = await activePeriods(cl, b.slot.vehicleId);
      expect(periods.map((p) => p.kind)).toEqual(['TRIP']);
      expect(periods[0]!.hi.toISOString()).toBe(at(t30, STEP_MIN + BUFFER_MIN));
    });
  });

  it('EC-19 : trip suivant déjà réservé sur le même véhicule ⇒ prolongation bornée à son début, trip suivant marqué à risque à la détection, une seule fois', async () => {
    await withClients(async (cl) => {
      const slot = freshSlot(c);
      const s2 = nextSlot(slot, 180);
      const b = await inProgress(cl, c, slot);
      const n = await booked(cl, c, s2);
      const t30 = at(b.slot.end, DETECTION_MIN);
      const r = await detect(cl, b.tripId, t30);
      expect(r).toMatchObject({ outcome: 'DETECTED', bounded: true, nextAtRisk: true });
      expect(iso(r['occupancyUntil'])).toBe(s2.start);
      expect(await detect(cl, b.tripId, at(t30, 1))).toMatchObject({
        outcome: 'UNCHANGED',
        nextAtRisk: false,
      });
      const next = await records(cl, n.tripId);
      expect(next).toMatchObject({ atRiskReason: 'PREVIOUS_OVERDUE' });
      expect(eventsOf(next, 'trip.at_risk.flagged')).toHaveLength(1);
      const mine = await records(cl, b.tripId);
      expect(eventsOf(mine, 'trip.overdue.detected')).toHaveLength(1);
      expect(caseOf(mine)).toMatchObject({ bounded: true, nextTripId: n.tripId });
      assertNoOverlap(await activePeriods(cl, slot.vehicleId));
    });
  });

  it('aucune constante : un seuil de 45 min publié APRÈS la réservation ne change rien (30 min) ; un trip réservé sous 45 min ⇒ rien à 10:44, OVERDUE à 10:45 (transactions annulées)', async () => {
    await withClients(async (cl) => {
      const b = await inProgress(cl, c);
      const t30 = at(b.slot.end, DETECTION_MIN);
      const later = await inTx(
        cl.worker,
        { worker: 'trip_overdue', virtualNow: t30 },
        async (tx) => {
          await tx.query(NEW_PARAM_VERSION, [
            'overdue_detection_minutes',
            c.country,
            String(VARIED_MIN),
          ]);
          const r = (await tx.query<{ r: Row }>(DETECT, [b.tripId])).rows[0]!.r;
          const cs = (
            await tx.query<{ r: Row }>('SELECT test_fixture.us305_records($1) AS r', [b.tripId])
          ).rows[0]!.r;
          return { r, cs: caseOf(cs) };
        },
      );
      expect(later.r).toMatchObject({ outcome: 'DETECTED' });
      expect(later.cs).toMatchObject({ detectionMinutes: DETECTION_MIN });
      expect(await records(cl, b.tripId)).toMatchObject({ status: 'IN_PROGRESS', case: null });

      // trip réservé pendant que 45 min sont en vigueur (conversion dans la transaction annulée)
      const slot = freshSlot(c);
      const { hold, operationId } = await inTx(
        cl.api,
        { virtualNow: T0, commit: true },
        async (tx) => {
          const placed = await placeHold(tx, slot, c);
          return { hold: placed, operationId: await insertRentOperation(tx, placed) };
        },
      );
      await inTx(
        cl.worker,
        { worker: 'webhook_ingest', virtualNow: at(T0, 2), commit: true },
        (tx) => receiveProof(tx, operationId),
      );
      const setCtx = (tx: pg.ClientBase, worker: string, now: string) =>
        tx.query(
          `SELECT pg_catalog.set_config('app.worker_name', $1, true),
                  pg_catalog.set_config('app.virtual_now', $2, true)`,
          [worker, now],
        );
      const varied = await inTx(
        cl.worker,
        { worker: 'booking_conversion', virtualNow: at(T0, 2) },
        async (tx) => {
          await tx.query(NEW_PARAM_VERSION, [
            'overdue_detection_minutes',
            c.country,
            String(VARIED_MIN),
          ]);
          const conv = await convert(tx, hold, operationId);
          if (conv.kind !== 'TRIP') throw new Error(`conversion inattendue : ${conv.kind}`);
          await tx.query('SELECT test_fixture.us211_sign($1)', [conv.tripId]);
          await setCtx(tx, 'trip_lifecycle', at(slot.start, -60));
          await tx.query(TRANSITION, [conv.tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED']);
          await setCtx(tx, 'trip_lifecycle', at(slot.start, 5));
          await tx.query(TRANSITION, [conv.tripId, 'IN_PROGRESS', 'CHECKIN_VALIDATED']);
          await setCtx(tx, 'trip_overdue', at(slot.end, VARIED_MIN - 1));
          const early = (await tx.query<{ r: Row }>(DETECT, [conv.tripId])).rows[0]!.r;
          await setCtx(tx, 'trip_overdue', at(slot.end, VARIED_MIN));
          const onTime = (await tx.query<{ r: Row }>(DETECT, [conv.tripId])).rows[0]!.r;
          const cs = (
            await tx.query<{ r: Row }>('SELECT test_fixture.us305_records($1) AS r', [conv.tripId])
          ).rows[0]!.r;
          return { early, onTime, cs: caseOf(cs) };
        },
      );
      expect(varied.early).toMatchObject({ outcome: 'NOT_DUE' });
      expect(varied.onTime).toMatchObject({ outcome: 'DETECTED' });
      expect(varied.cs).toMatchObject({ detectionMinutes: VARIED_MIN });
      // la même conversion, validée sans la variation : aucun paiement prouvé laissé sans trip
      // (oracle C12)
      const kept = await inTx(
        cl.worker,
        { worker: 'booking_conversion', virtualNow: at(T0, 2), commit: true },
        (tx) => convert(tx, hold, operationId),
      );
      expect(kept.kind).toBe('TRIP');
    });
  });
});

describe('US-305 — droits et écritures directes', () => {
  it('commandes du seul travailleur trip_overdue ; dossier illisible et inécrivable par les rôles applicatifs ; faits figés et prolongation jamais reculée ; libération directe de l’occupation sans effet', async () => {
    const c = COUNTRIES[0];
    await withClients(async (cl) => {
      const b = await inProgress(cl, c);
      const t30 = at(b.slot.end, DETECTION_MIN);
      await detect(cl, b.tripId, t30);

      // commandes : EXECUTE au seul app_worker, et sous le seul nom trip_overdue
      const anon = await connectAs('app_anon');
      try {
        for (const client of [cl.api, anon]) {
          await expect(client.query(DETECT, [b.tripId])).rejects.toMatchObject({ code: '42501' });
          await expect(client.query(DUE, [10])).rejects.toMatchObject({ code: '42501' });
          for (const sql of [
            'SELECT 1 FROM core.trip_ops_overdue_case LIMIT 1',
            'DELETE FROM core.trip_ops_overdue_case',
          ]) {
            await expect(client.query(sql), sql).rejects.toMatchObject({ code: '42501' });
          }
        }
      } finally {
        await releaseClient(anon);
      }
      for (const worker of ['trip_lifecycle', 'booking_conversion'] as const) {
        await expect(
          inTx(cl.worker, { worker, virtualNow: t30 }, (tx) => tx.query(DETECT, [b.tripId])),
        ).rejects.toMatchObject({ code: '42501', constraint: 'trip_command_forbidden' });
        await expect(
          inTx(cl.worker, { worker, virtualNow: t30 }, (tx) => tx.query(DUE, [10])),
        ).rejects.toMatchObject({ code: '42501', constraint: 'trip_command_forbidden' });
      }
      await expect(
        inTx(cl.worker, { worker: 'trip_overdue', virtualNow: t30 }, (tx) => tx.query(DUE, [0])),
      ).rejects.toMatchObject({ constraint: 'trip_overdue_batch_invalid' });
      for (const sql of [
        'SELECT 1 FROM core.trip_ops_overdue_case LIMIT 1',
        `INSERT INTO core.trip_ops_overdue_case (trip_id, country_code, scheduled_end,
           detection_minutes, detected_at, use_until, occupancy_until)
         VALUES ('${b.tripId}', 'XX', '2036-01-01Z', 0, '2036-01-01Z', '2036-01-01Z',
                 '2036-01-01Z')`,
        'DELETE FROM core.trip_ops_overdue_case',
      ]) {
        await expect(
          inTx(cl.worker, { worker: 'trip_overdue', virtualNow: t30 }, (tx) => tx.query(sql)),
          sql,
        ).rejects.toMatchObject({ code: '42501' });
      }

      // cmd_hold_owner lui-même : fait figé non accordé (42501) ; prolongation reculée refusée
      await expect(
        inTx(cl.worker, { worker: 'trip_overdue', virtualNow: t30 }, (tx) =>
          tx.query('SELECT test_fixture.us305_case_probe($1, $2)', [b.tripId, 'END']),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        inTx(cl.worker, { worker: 'trip_overdue', virtualNow: t30 }, (tx) =>
          tx.query('SELECT test_fixture.us305_case_probe($1, $2)', [b.tripId, 'SHRINK']),
        ),
      ).rejects.toMatchObject({ code: '23000', constraint: 'trip_overdue_case_immutable' });

      // libération directe de l'occupation (RT-L3-NS05) : aucune politique d'app_worker sous ce
      // nom ; écriture directe de l'état : droit retiré (0099)
      const released = await inTx(
        cl.worker,
        { worker: 'trip_overdue', virtualNow: t30, commit: true },
        (tx) =>
          tx.query(
            `UPDATE core.booking_vehicle_occupancy
                SET active = false, deactivated_reason = 'TRIP_TERMINAL'
              WHERE kind = 'TRIP' AND ref_type = 'TRIP' AND ref_id = $1`,
            [b.tripId],
          ),
      );
      expect(released.rowCount).toBe(0);
      await expect(
        inTx(cl.worker, { worker: 'trip_overdue', virtualNow: t30 }, (tx) =>
          tx.query(`UPDATE core.booking_trip SET status = 'RETURNED' WHERE id = $1`, [b.tripId]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      const r = await records(cl, b.tripId);
      expect(r).toMatchObject({ status: 'OVERDUE' });
      expect((r['occupancy'] as Row)['active']).toBe(true);
    });
  });
});
