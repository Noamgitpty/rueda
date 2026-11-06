/**
 * US-049 — red team « concurrence », holds : double hold d'un même véhicule (bornes, fuseaux,
 * durée nulle), contournement de l'exclusion GiST par écriture directe (19 US-049 critère 4 ;
 * 17 §2.3, §2.5 ; C1, C5, C9 ; RLS-13).
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée.
 * Attendus : tampon `buffer_minutes` = 120 min après la fin (17 §7.2), période occupée
 * `[début, fin + tampon)` demi-ouverte (BR-BOOK-05), `hold_ttl_minutes` = 10, un seul hold
 * vivant par créneau et par véhicule (exclusion `vehicle_occupancy_no_overlap`).
 * Rôles de production seulement (`app_api` voyageur, `app_worker` travailleurs, `app_anon`),
 * assertion L0-05 par connectAs. En USD (PA) et en PYG (PY).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { setSessionContext } from '../../../src/index.ts';
import type { SessionContext } from '../../../src/index.ts';
import { connectAs, releaseClient } from '../../../src/testing/index.ts';
import { COUNTRIES, inTx } from '../../support/avl.ts';
import type { Worker } from '../../support/avl.ts';
import { Barrier } from '../../support/concurrency.ts';
import {
  activeOccupancies,
  at,
  atSec,
  BUFFER_MIN,
  holdInfo,
  inOffset,
  LONG,
  MIN,
  pose,
  slotBetween,
  T,
  uuid,
  world,
} from './support.ts';
import type { Outcome, Slot } from './support.ts';

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

const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

/** `n` poses simultanées (une session par pose, départ commun par barrière). */
async function concurrentPoses(
  guests: readonly string[],
  slots: readonly Slot[],
  when: string,
): Promise<Outcome[]> {
  const observer = await connectAs('app_api');
  const sessions = await Promise.all(slots.map(() => connectAs('app_api')));
  try {
    const barrier = await Barrier.open(observer);
    const runs = sessions.map(async (session, i) => {
      await barrier.wait(session);
      return pose(session, guests[i] as string, slots[i] as Slot, when);
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

describe.each(COUNTRIES)('US-049 red team concurrence — holds ($country, $currency)', (c) => {
  // ---------------------------------------------------------------------------------------------
  // RT-CONC-01 : bornes de l'exclusion (début, fin + tampon), fuseaux, durée nulle
  // ---------------------------------------------------------------------------------------------
  it(
    'RT-CONC-01 : chevauchements aux bornes (± 1 s du tampon), même instant écrit dans d’autres fuseaux ⇒ VEHICLE_UNAVAILABLE ; bords demi-ouverts ⇒ réservables',
    async () => {
      const w = await world(api, c, 1, 14);
      const vehicle = w.vehicles[0] as string;
      const s = Date.parse(T) + 5 * DAY;
      const e = s + 2 * DAY;
      const occupiedEnd = e + BUFFER_MIN * MIN; // fin du hold A, tampon compris
      const a = await pose(
        api,
        w.guests[0] as string,
        slotBetween(vehicle, w.orgId, iso(s), iso(e)),
        T,
      );
      expect(a.code).toBeUndefined();

      const conflicts: [string, string, string][] = [
        ['fin du tampon moins 1 s', iso(occupiedEnd - 1000), iso(occupiedEnd + DAY)],
        [
          'avant : fin + tampon dépasse le début de 1 s',
          iso(s - DAY - BUFFER_MIN * MIN),
          iso(s - BUFFER_MIN * MIN + 1000),
        ],
        ['identique', iso(s), iso(e)],
        ['inclus', iso(s + DAY), iso(s + DAY + 3_600_000)],
        ['englobant', iso(s - DAY), iso(e + DAY)],
        ['même instant, UTC-05:00', inOffset(iso(s), -300), inOffset(iso(e), -300)],
        ['même instant, UTC-03:00', inOffset(iso(s), -180), inOffset(iso(e), -180)],
        ['même instant, UTC+14:00', inOffset(iso(s), 840), inOffset(iso(e), 840)],
        ['début dans le tampon (fin + 1 h)', iso(e + 3_600_000), iso(e + DAY)],
      ];
      for (const [i, [label, start, end]] of conflicts.entries()) {
        const got = await pose(
          api,
          w.guests[i + 1] as string,
          slotBetween(vehicle, w.orgId, start, end),
          T,
        );
        expect(got.code, label).toBe('VEHICLE_UNAVAILABLE');
        expect(got.raw, label).toEqual({
          code: '23P01',
          constraint: 'vehicle_occupancy_no_overlap',
        });
      }
      // rien d'autre que A n'occupe le véhicule
      expect(await activeOccupancies(worker, vehicle)).toHaveLength(1);

      // bords demi-ouverts : collé après le tampon de A, et collé avant (fin + tampon = début de A)
      const after = await pose(
        api,
        w.guests[10] as string,
        slotBetween(vehicle, w.orgId, iso(occupiedEnd), iso(occupiedEnd + DAY)),
        T,
      );
      expect(after.code).toBeUndefined();
      const before = await pose(
        api,
        w.guests[11] as string,
        slotBetween(vehicle, w.orgId, iso(s - DAY - BUFFER_MIN * MIN), iso(s - BUFFER_MIN * MIN)),
        T,
      );
      expect(before.code).toBeUndefined();
      expect(await activeOccupancies(worker, vehicle)).toHaveLength(3);
    },
    LONG,
  );

  it(
    'RT-CONC-02 : durée nulle ou négative, début passé ou égal à maintenant, fin infinie ⇒ INVALID_PERIOD, aucune occupation créée',
    async () => {
      const w = await world(api, c, 2, 2);
      const vehicle = w.vehicles[0] as string;
      const guest = w.guests[0] as string;
      const s = Date.parse(T) + 3 * DAY;
      const cases: [string, string, string][] = [
        ['durée nulle', iso(s), iso(s)],
        ['fin avant le début (1 ms)', iso(s), iso(s - 1)],
        ['fin avant le début (1 jour)', iso(s), iso(s - DAY)],
        ['début égal à platform.now()', T, iso(s)],
        ['début dans le passé', iso(Date.parse(T) - DAY), iso(s)],
        ['début infiniment ancien', '-infinity', iso(s)],
      ];
      for (const [label, start, end] of cases) {
        const got = await pose(api, guest, slotBetween(vehicle, w.orgId, start, end), T);
        expect(got.code, label).toBe('INVALID_PERIOD');
      }
      // fin infinie : le code exact importe peu, mais un hold d'une durée illimitée est une faille
      const infinite = await pose(api, guest, slotBetween(vehicle, w.orgId, iso(s), 'infinity'), T);
      expect(infinite.code, 'fin infinie').toBeDefined();
      expect(await activeOccupancies(worker, vehicle)).toEqual([]);
      // la borne exacte « maintenant + 1 s » reste possible : le refus n'est pas un blocage général
      const ok = await pose(
        api,
        guest,
        slotBetween(w.vehicles[1] as string, w.orgId, atSec(T, 1), iso(s)),
        T,
      );
      expect(ok.code).toBeUndefined();
    },
    LONG,
  );

  it(
    'RT-CONC-03 : fuseau de session hostile (DST américain, UTC+14) ⇒ période occupée exactement [début, fin + 120 min) en UTC',
    async () => {
      const start = '2045-03-10T10:00:00.000Z'; // traverse le passage à l'heure d'été américain
      const end = '2045-03-14T10:00:00.000Z';
      for (const timeZone of ['America/New_York', 'Pacific/Kiritimati', 'Asia/Kolkata', 'UTC']) {
        const w = await world(api, c, 1, 1);
        const placed = await pose(
          api,
          w.guests[0] as string,
          slotBetween(w.vehicles[0] as string, w.orgId, start, end),
          T,
          { timeZone },
        );
        expect(placed.code, timeZone).toBeUndefined();
        const info = await holdInfo(worker, placed.holdId as string);
        expect(info?.lo.toISOString(), timeZone).toBe(start);
        expect(info?.hi.toISOString(), timeZone).toBe(
          new Date(Date.parse(end) + BUFFER_MIN * MIN).toISOString(),
        );
      }
    },
    LONG,
  );

  // ---------------------------------------------------------------------------------------------
  // RT-CONC-04 : course sur le même véhicule (C1)
  // ---------------------------------------------------------------------------------------------
  it(
    'RT-CONC-04 : 8 voyageurs distincts posent en même temps des créneaux qui se chevauchent sur un véhicule ⇒ exactement un hold, les 7 autres VEHICLE_UNAVAILABLE (3 manches)',
    async () => {
      for (let round = 0; round < 3; round++) {
        const w = await world(api, c, 1, 8);
        const vehicle = w.vehicles[0] as string;
        const base = Date.parse(T) + (7 + round) * DAY;
        // décalages de -3 h à +22 h (< 24 h + 2 h de tampon) : les 8 créneaux se chevauchent deux à deux
        const offsetsH = [0, 1, -1, 3, -3, 12, 20, 22];
        const slots = offsetsH.map((h) =>
          slotBetween(vehicle, w.orgId, iso(base + h * 3_600_000), iso(base + DAY + h * 3_600_000)),
        );
        const outcomes = await concurrentPoses(w.guests, slots, T);
        const tally: Record<string, number> = {};
        for (const o of outcomes) tally[o.code ?? 'OK'] = (tally[o.code ?? 'OK'] ?? 0) + 1;
        expect(tally).toEqual({ OK: 1, VEHICLE_UNAVAILABLE: 7 });
        for (const o of outcomes.filter((x) => x.code !== undefined)) {
          expect(o.raw).toEqual({ code: '23P01', constraint: 'vehicle_occupancy_no_overlap' });
        }
        const occ = await activeOccupancies(worker, vehicle);
        expect(occ).toHaveLength(1);
      }
    },
    LONG,
  );

  it(
    'RT-CONC-05 : créneaux adjacents (bords demi-ouverts) posés ensemble ⇒ tous réussissent, aucun faux conflit ; chevauchement de tampon seul ⇒ un seul gagnant',
    async () => {
      const w = await world(api, c, 1, 6);
      const vehicle = w.vehicles[0] as string;
      const base = Date.parse(T) + 20 * DAY;
      const step = DAY + BUFFER_MIN * MIN; // fin + tampon = début du suivant
      const adjacent = [0, 1, 2].map((i) =>
        slotBetween(vehicle, w.orgId, iso(base + i * step), iso(base + i * step + DAY)),
      );
      const ok = await concurrentPoses(w.guests.slice(0, 3), adjacent, T);
      expect(ok.map((o) => o.code ?? 'OK')).toEqual(['OK', 'OK', 'OK']);
      expect(await activeOccupancies(worker, vehicle)).toHaveLength(3);

      // deux créneaux séparés de 1 s de moins que le tampon : un seul passe
      const w2 = await world(api, c, 1, 2);
      const v2 = w2.vehicles[0] as string;
      const b = Date.parse(T) + 40 * DAY;
      const pair = [
        slotBetween(v2, w2.orgId, iso(b), iso(b + DAY)),
        slotBetween(v2, w2.orgId, iso(b + DAY + BUFFER_MIN * MIN - 1000), iso(b + 2 * DAY)),
      ];
      const tally = (await concurrentPoses(w2.guests, pair, T)).map((o) => o.code ?? 'OK').sort();
      expect(tally).toEqual(['OK', 'VEHICLE_UNAVAILABLE']);
    },
    LONG,
  );

  it(
    'RT-CONC-06 : hold A échu, deux voyageurs posent en même temps le même créneau ⇒ A expiré par la pose, un seul nouvel occupant (jamais deux)',
    async () => {
      for (let round = 0; round < 3; round++) {
        const w = await world(api, c, 1, 3);
        const vehicle = w.vehicles[0] as string;
        const s = Date.parse(T) + (60 + round * 3) * DAY;
        const slot = slotBetween(vehicle, w.orgId, iso(s), iso(s + 2 * DAY));
        const [a, b, d] = w.guests as [string, string, string];
        const first = await pose(api, a, slot, T);
        expect(first.code).toBeUndefined();
        const later = at(T, 11); // hold_ttl_minutes = 10 : A est échu
        const outcomes = await concurrentPoses([b, d], [slot, slot], later);
        expect(outcomes.map((o) => o.code ?? 'OK').sort()).toEqual(['OK', 'VEHICLE_UNAVAILABLE']);
        expect((await holdInfo(worker, first.holdId as string))?.status).toBe('EXPIRED');
        expect(await activeOccupancies(worker, vehicle)).toHaveLength(1);
      }
    },
    LONG,
  );

  // ---------------------------------------------------------------------------------------------
  // RT-CONC-07 : contournement de l'exclusion par écriture directe
  // ---------------------------------------------------------------------------------------------
  it(
    'RT-CONC-07 : INSERT / UPDATE / DELETE directs d’occupation par tout rôle et tout contexte forgé ⇒ refusés ; l’exclusion GiST n’est pas contournable (réactivation d’un hold expiré sur un créneau repris comprise)',
    async () => {
      const w = await world(api, c, 1, 3);
      const vehicle = w.vehicles[0] as string;
      const [a, b, attacker] = w.guests as [string, string, string];
      const s = Date.parse(T) + 80 * DAY;
      const slot = slotBetween(vehicle, w.orgId, iso(s), iso(s + 2 * DAY));
      const holdA = (await pose(api, a, slot, T)).holdId as string;
      // A expire (2a de la pose de B), B reprend le créneau
      const holdB = (await pose(api, b, slot, at(T, 11))).holdId as string;
      expect(holdB).toBeDefined();
      const infoA = await holdInfo(worker, holdA);
      expect(infoA?.status).toBe('EXPIRED');
      const occA = infoA?.occupancy_id as string;
      const before = await activeOccupancies(worker, vehicle);
      expect(before).toHaveLength(1);

      const insertSql = `INSERT INTO core.booking_vehicle_occupancy
              (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at,
               ref_type, ref_id, created_by)
        VALUES (gen_random_uuid(), $1, $2, $3, 'HOLD', 'CHECKOUT',
                tstzrange($4::timestamptz, $5::timestamptz, '[)'), true, $6::timestamptz,
                'HOLD', gen_random_uuid(), $7)`;
      const insertArgs = [
        vehicle,
        w.orgId,
        c.country,
        iso(s + DAY),
        iso(s + 3 * DAY),
        at(T, 600),
        attacker,
      ];
      // `workers` : l'attaque vaut aussi pour les travailleurs. Les travailleurs de conversion ont, par
      // conception, le droit de modifier `active` et `period` (0007) : ces deux attaques-là ne
      // visent que app_api et app_anon.
      const attacks: [string, string, unknown[], boolean][] = [
        ['INSERT d’une occupation chevauchante', insertSql, insertArgs, true],
        [
          'réactivation de l’occupation expirée de A (chevauche B)',
          `UPDATE core.booking_vehicle_occupancy SET active = true, deactivated_reason = NULL WHERE id = $1`,
          [occA],
          true,
        ],
        [
          'décalage de la période de B pour libérer la place',
          `UPDATE core.booking_vehicle_occupancy SET period = tstzrange('2046-01-01', '2046-01-02') WHERE vehicle_id = $1 AND active`,
          [vehicle],
          false,
        ],
        [
          'désactivation en masse',
          `UPDATE core.booking_vehicle_occupancy SET active = false WHERE vehicle_id = $1`,
          [vehicle],
          false,
        ],
        [
          'DELETE des occupations du véhicule',
          `DELETE FROM core.booking_vehicle_occupancy WHERE vehicle_id = $1`,
          [vehicle],
          true,
        ],
      ];
      // refus attendus ; `EXÉCUTÉ:0` = la RLS a filtré toutes les lignes (aucun effet)
      const ALLOWED_REFUSALS = ['42501', '23P01', '23514', '23503', '23000', 'EXÉCUTÉ:0'];
      const WORKERS: Worker[] = [
        'booking_conversion',
        'hold_expiry',
        'trip_lifecycle',
        'disposition_sweeper',
        'payment_intent_sweeper',
        'webhook_ingest',
        'payment_command',
        'outbox_relay',
      ];
      const attempt = async (
        client: pg.ClientBase,
        prepare: (tx: pg.ClientBase) => Promise<void>,
        sql: string,
        args: unknown[],
      ): Promise<string> => {
        try {
          await inTx(client, {}, async (tx) => {
            await prepare(tx);
            await tx.query(sql, args);
          });
          return 'EXECUTÉ';
        } catch (error) {
          return (error as { code?: string }).code ?? 'SANS_CODE';
        }
      };
      const anon = await connectAs('app_anon');
      try {
        for (const [label, sql, args, forWorkers] of attacks) {
          const results: [string, string][] = [];
          // app_api : contextes voyageur, hôte titulaire, et travailleurs forgés
          const apiContexts: [string, SessionContext][] = [
            ['GUEST', { kind: 'GUEST', actorId: attacker }],
            ['HOST', { kind: 'HOST', actorId: uuid(), orgId: w.orgId }],
            ...WORKERS.map((n): [string, SessionContext] => [
              `api+WORKER:${n}`,
              { kind: 'WORKER', workerName: n },
            ]),
          ];
          for (const [name, ctx] of apiContexts) {
            results.push([
              `app_api/${name}`,
              await attempt(api, (tx) => setSessionContext(tx, ctx), sql, args),
            ]);
          }
          // app_worker : chaque nom de travailleur (le rôle de base les accueille tous)
          for (const n of forWorkers ? WORKERS : []) {
            results.push([
              `app_worker/${n}`,
              await attempt(
                worker,
                async (tx) => {
                  await tx.query(
                    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                            pg_catalog.set_config('app.worker_name', $1, true)`,
                    [n],
                  );
                },
                sql,
                args,
              ),
            ]);
          }
          results.push(['app_anon', await attempt(anon, () => Promise.resolve(), sql, args)]);
          for (const [who, code] of results) {
            expect(ALLOWED_REFUSALS, `${label} — ${who} : ${code}`).toContain(code);
          }
        }
      } finally {
        await releaseClient(anon);
      }
      // l'état est intact : B seul occupe le créneau, A reste expiré
      const after = await activeOccupancies(worker, vehicle);
      expect(after.map((o) => [o.id, o.lo.toISOString(), o.hi.toISOString()])).toEqual(
        before.map((o) => [o.id, o.lo.toISOString(), o.hi.toISOString()]),
      );
      expect((await holdInfo(worker, holdA))?.status).toBe('EXPIRED');
      expect((await holdInfo(worker, holdB))?.status).toBe('ACTIVE');
    },
    LONG,
  );
});
