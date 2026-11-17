/**
 * US-218 — avis recueillis par l'ops et agrégats (migration 0104, ADR-130 ; fixture 9987). Rôles de
 * production seulement (assertion L0-05 par `connectAs`), au Panama (USD) et au Paraguay (PYG).
 * Chaque test crée ses personnes, son agent, son compte d'hôte, son véhicule par les VRAIES
 * commandes (US-102, US-107, US-115, console d'US-101) et ses trips par le parcours hold → preuve →
 * conversion d'US-024 (`bookTrip`), puis par les VRAIES transitions d'US-207 jusqu'à COMPLETED.
 *
 * Attendus tirés de 19 US-218 (critère 1 : « l'ops l'enregistre (RECORD_REVIEW), il est rattaché au
 * trip et journalisé » ; critère 2 : « 3 avis (5, 4, 3) et 2 trips non notés ⇒ moyenne 4,0 et 5
 * trips »), de 16 REV-001 / REV-010 (REVIEW_WINDOW_CLOSED ; trip non noté exclu de la moyenne), de
 * 08 BR-REVIEW-01 (10 jours après la fin, `review_window_days` du pays, graine 0009) et BR-REVIEW-03
 * (note 1 à 5), de 17 §3.2.12 (UQ `(trip_id, author_user_id, subject_type)`, trip COMPLETED requis)
 * et de 17 §2.3 (`host_guest_v` : note du voyageur), jamais du code testé.
 *
 * Horloge (instants virtuels de `platform.now()`, toujours APRÈS la migration du banc : les
 * paramètres des pays n'existent qu'à partir de là) : les trips ont lieu dans les jours qui suivent,
 * et les avis sont enregistrés à un instant `rec` postérieur à tous les retours, par un agent élevé
 * par TOTP à cet instant (pas TOTP calculé sur `rec`, comme le fait la base).
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { at, bookTrip, COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { one, person } from '../support/kyc.ts';
import type { Staff } from '../support/kyc.ts';
import { auditOf, elevate, login } from '../support/staff.ts';
import { uniquePlate } from '../support/unique.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const REASON = 'Avis reçu par e-mail le jour du retour, joint en pièce';
const DAY_MIN = 24 * 60;
/** 08 BR-REVIEW-01 : 10 jours (graine 0009, PA et PY). */
const WINDOW_DAYS = 10;
/** Saisie fermée de l'action (BR-REVIEW-03 : note 1 à 5), jamais un nombre. */
type Stars = 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';

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

interface Host {
  readonly userId: string;
  readonly hash: Buffer;
  readonly org: string;
}

/** Personne inscrite (compte ACTIVE), session ouverte, compte d'hôte ACTIVE (vraies commandes). */
async function host(tx: pg.ClientBase, country: string): Promise<Host> {
  const userId = uuid();
  const r = await tx.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400, NULL,
                                                $6, $7::jsonb, false) AS ok`,
    [userId, `us218-${userId}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await tx.query('SELECT test_fixture.iam_set_account_status($1, $2)', [userId, 'ACTIVE']);
  const t = newToken();
  const s = await tx.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  const { rows } = await tx.query<{ outcome: string; org_id: string | null }>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [t.hash, country, 'INDIVIDUAL'],
  );
  if (rows[0]?.outcome !== 'DONE' || !rows[0].org_id) throw new Error('compte d’hôte refusé');
  await tx.query('SELECT test_fixture.us115_set_org_status($1, $2)', [rows[0].org_id, 'ACTIVE']);
  return { userId, hash: t.hash, org: rows[0].org_id };
}

/** Lieu et véhicule du compte (vraies commandes d'US-115). */
async function vehicle(tx: pg.ClientBase, h: Host): Promise<string> {
  const loc = await tx.query<{ location_id: string | null }>(
    'SELECT * FROM core.catalog_cmd_create_location($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [h.hash, h.org, 'HOME', 'Casa', 'Calle 1', 'Ciudad', null, null, null],
  );
  const veh = await tx.query<{ vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, NULL, NULL, 'Marca', 'Modelo',
                                                   2021, NULL, 'AUTOMATIC', 5::smallint,
                                                   'GASOLINE', 42000, false, false)`,
    [h.hash, h.org, loc.rows[0]?.location_id, await uniquePlate(tx, 'R')],
  );
  const id = veh.rows[0]?.vehicle_id;
  if (!id) throw new Error('véhicule refusé');
  return id;
}

interface Trip {
  readonly tripId: string;
  readonly guestId: string;
  readonly start: string;
  readonly end: string;
}

/** Origine des instants du test : demain, à la minute (après la migration du banc). */
const origin = (): string => {
  const d = new Date(Date.now() + DAY_MIN * 60_000);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
};

/**
 * Agent du staff élevé par TOTP à l'instant virtuel `when` (vraies commandes, comme `elevateAs` de
 * support/kyc.ts, mais au pas TOTP de `when` : la base le calcule sur `platform.now()`).
 */
async function staffAt(cl: Clients, role: string, country: string, when: string): Promise<Staff> {
  return inTx(cl.api, { virtualNow: when, commit: true }, async (tx) => {
    const { userId } = await person(tx, country);
    await tx.query(`SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, NULL)`, [
      uuid(),
      userId,
      role,
      [country],
    ]);
    const factorId = uuid();
    const code = randomBytes(9).toString('base64url');
    const codeHash = createHash('sha256').update(code, 'utf8').digest();
    await tx.query(
      `SELECT test_fixture.iam_insert_pending_totp($1, $2, 'fake-vault:test-secret', $3, 86400)`,
      [factorId, userId, codeHash],
    );
    const hash = await login(tx, userId);
    const reveal = await one<{ outcome: string }>(
      tx,
      'SELECT outcome FROM core.iam_staff_cmd_enroll_reveal($1, $2)',
      [hash, codeHash],
    );
    if (reveal.outcome !== 'OK') throw new Error('enrôlement refusé');
    const totpStep = Math.floor(Date.parse(when) / 1000 / 30);
    if ((await elevate(tx, hash, factorId, totpStep)) !== 'ENROLLED') {
      throw new Error('élévation refusée');
    }
    return { userId, hash };
  });
}

/** Trip réservé (US-024) du véhicule, de `start` à `start + 1 jour`, confirmé la veille. */
async function book(cl: Clients, c: CountryCase, h: Host, car: string, start: string) {
  const end = at(start, DAY_MIN);
  const r = await bookTrip(
    cl.api,
    cl.worker,
    { vehicleId: car, orgId: h.org, start, end, bufferHours: 2 },
    c,
    at(start, -DAY_MIN),
  );
  // US-211 (0121) : la remise (IN_PROGRESS) exige le contrat de location signé par le voyageur
  await cl.worker.query('SELECT test_fixture.us211_sign($1)', [r.tripId]);
  return { tripId: r.tripId, guestId: r.hold.guestId, start, end };
}

/** Une transition d'US-207 sous `trip_lifecycle` à l'instant `now`, validée ; refus ⇒ erreur. */
async function step(cl: Clients, now: string, trip: string, to: string, reason: string) {
  await inTx(cl.worker, { worker: 'trip_lifecycle', virtualNow: now, commit: true }, (tx) =>
    tx.query('SELECT core.booking_cmd_trip_transition($1, $2, $3, $4)', [trip, to, reason, null]),
  );
}

/** Parcours complet d'US-207 : BOOKED → … → COMPLETED (retour à la fin prévue). */
async function complete(cl: Clients, t: Trip): Promise<void> {
  await step(cl, at(t.start, -60), t.tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED');
  await step(cl, at(t.start, 5), t.tripId, 'IN_PROGRESS', 'CHECKIN_VALIDATED');
  await step(cl, t.end, t.tripId, 'RETURNED', 'CHECKOUT_COMPLETED');
  await step(cl, at(t.end, 60), t.tripId, 'POST_TRIP', 'OPERATIONAL_WINDOWS_OPEN');
  await step(cl, at(t.end, 120), t.tripId, 'COMPLETED', 'OPERATIONAL_WINDOWS_CLOSED');
}

interface World {
  readonly h: Host;
  readonly car: string;
  readonly listing: string;
  /** 5 trips COMPLETED du véhicule, terminés 1 à 7 jours avant `rec` (fenêtre de 10 jours) */
  readonly done: readonly Trip[];
  /** trip COMPLETED terminé 12 jours avant `rec` (hors fenêtre) ; absent si `withOld` est faux */
  readonly old: Trip | null;
  /** trip BOOKED (pas encore réalisé à `rec`) */
  readonly upcoming: Trip;
  /** instant de l'enregistrement des avis */
  readonly rec: string;
  readonly ops: Staff;
}

async function world(cl: Clients, c: CountryCase, withOld = true): Promise<World> {
  const base = origin();
  const { h, car } = await inTx(cl.api, { virtualNow: base, commit: true }, async (tx) => {
    const ha = await host(tx, c.country);
    return { h: ha, car: await vehicle(tx, ha) };
  });
  // rec = base + 14 j : old se termine à base + 2 j (12 jours avant), les 5 autres entre base + 7 j
  // et base + 13 j ; upcoming commence à rec + 3 j
  const rec = at(base, 14 * DAY_MIN);
  const old = withOld ? await book(cl, c, h, car, at(base, DAY_MIN)) : null;
  const done: Trip[] = [];
  for (let i = 0; i < 5; i += 1) {
    done.push(await book(cl, c, h, car, at(base, 6 * DAY_MIN + i * 1.5 * DAY_MIN)));
  }
  const upcoming = await book(cl, c, h, car, at(rec, 3 * DAY_MIN));
  for (const t of [...(old ? [old] : []), ...done]) await complete(cl, t);
  const listing = (
    await one<{ id: string }>(cl.api, 'SELECT test_fixture.us218_list_vehicle($1) AS id', [car])
  ).id;
  const ops = await staffAt(cl, 'OPS_AGENT', c.country, rec);
  return { h, car, listing, done, old, upcoming, rec, ops };
}

interface ActionRow {
  readonly outcome: string;
  readonly action_id: string | null;
  readonly domain_ref: string | null;
  readonly detail: string | null;
}

/** Action de console RECORD_REVIEW (cadre d'US-101), dans sa transaction validée, à `when`. */
const recordAt = (
  client: pg.ClientBase,
  when: string,
  s: Staff,
  tripId: string,
  input: Record<string, string>,
  requestId = uuid(),
) =>
  inTx(client, { virtualNow: when, commit: true }, (tx) =>
    one<ActionRow>(
      tx,
      'SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])',
      [s.hash, requestId, 'RECORD_REVIEW', tripId, REASON, JSON.stringify(input), []],
    ),
  );

/** Trip vu par l'hôte (core.booking_host_trips) à `when`, par une session ouverte à cet instant. */
const hostTripAt = (client: pg.ClientBase, when: string, h: Host, tripId: string | undefined) =>
  inTx(client, { virtualNow: when }, async (tx) => {
    const session = await login(tx, h.userId);
    const { rows } = await tx.query<Record<string, unknown>>(
      `SELECT * FROM core.booking_host_trips($1, $2::uuid, NULL, NULL, NULL, NULL, $3::uuid, 200)`,
      [session, h.org, tripId],
    );
    return rows[0];
  });
const byGuest = (overall: Stars) => ({ authorRole: 'GUEST', overall });
const byHost = (overall: Stars) => ({ authorRole: 'HOST', overall });

interface ReviewRow {
  readonly id: string;
  readonly country_code: string;
  readonly author_user_id: string;
  readonly author_role: string;
  readonly subject_type: string;
  readonly subject_id: string;
  readonly overall: number;
  readonly status: string;
  readonly source: string;
  readonly manual_action_id: string;
  readonly recorded_by: string;
  readonly published_at: Date | null;
}
const reviewsOf = async (client: pg.ClientBase, trip: string): Promise<ReviewRow[]> =>
  (await client.query<ReviewRow>('SELECT * FROM test_fixture.us218_reviews($1)', [trip])).rows;
const aggregateOf = async (client: pg.ClientBase, type: string, id: string) =>
  (
    await client.query<{ review_count: number; overall_sum: number; avg_overall_x100: number }>(
      'SELECT * FROM test_fixture.us218_aggregate($1, $2)',
      [type, id],
    )
  ).rows[0] ?? null;
const ratings = async (client: pg.ClientBase, ids: readonly string[]) =>
  (
    await client.query<Record<string, unknown>>(
      'SELECT * FROM core.review_listing_ratings($1::uuid[])',
      [ids],
    )
  ).rows;

describe.each(COUNTRIES)('US-218 — avis enregistrés et agrégats ($country, $currency)', (c) => {
  it('critère 1 : avis reçu par e-mail enregistré par l’ops (RECORD_REVIEW) ⇒ rattaché au trip COMPLETED, à ses parties relues en base, et journalisé ; une fois par partie et par trip', async () => {
    await withClients(async (cl) => {
      const w = await world(cl, c);
      const [t] = w.done;
      if (!t) throw new Error('trip absent');
      const requestId = uuid();
      const r = await recordAt(cl.api, w.rec, w.ops, t.tripId, byGuest('FOUR'), requestId);
      expect(r).toMatchObject({ outcome: 'DONE', action_id: requestId, detail: null });
      const rows = await reviewsOf(cl.api, t.tripId);
      // voyageur : avis sur l'hôte et sur le véhicule (même note), auteur = voyageur DU TRIP
      expect(rows.map((x) => [x.subject_type, x.subject_id])).toEqual([
        ['HOST', w.h.org],
        ['VEHICLE', w.car],
      ]);
      for (const x of rows) {
        expect(x).toMatchObject({
          country_code: c.country,
          author_user_id: t.guestId,
          author_role: 'GUEST',
          overall: 4,
          status: 'PUBLISHED',
          source: 'OPS_RECORDED',
          manual_action_id: requestId,
          recorded_by: w.ops.userId,
        });
        expect(x.published_at).not.toBeNull();
      }
      expect(rows.map((x) => x.id)).toContain(r.domain_ref);
      // journalisé : action de console et audit (cadre d'US-101)
      expect((await auditOf(cl.api, w.ops.userId)).at(-1)).toMatchObject({
        action_code: 'MANUAL_ACTION_DONE',
        subject_type: 'TRIP',
        subject_id: t.tripId,
        reason: REASON,
        after: {
          action: 'RECORD_REVIEW',
          mode: 'DOMAIN_COMMAND',
          country: c.country,
          outcome: 'DONE',
          manualActionId: requestId,
        },
      });
      // même requestId : rejeu idempotent, rien de plus
      expect(
        await recordAt(cl.api, w.rec, w.ops, t.tripId, byGuest('FOUR'), requestId),
      ).toMatchObject({
        outcome: 'DUPLICATE',
        action_id: requestId,
      });
      // une fois par partie et par trip : un second avis du voyageur est refusé, rien ne bouge
      expect(await recordAt(cl.api, w.rec, w.ops, t.tripId, byGuest('ONE'))).toMatchObject({
        outcome: 'REFUSED',
        detail: 'REVIEW_ALREADY_RECORDED',
      });
      expect(await reviewsOf(cl.api, t.tripId)).toHaveLength(2);
      expect(await aggregateOf(cl.api, 'HOST', w.h.org)).toEqual({
        review_count: 1,
        overall_sum: 4,
        avg_overall_x100: 400,
      });
      expect((await auditOf(cl.api, w.ops.userId)).at(-1)).toMatchObject({
        action_code: 'MANUAL_ACTION_REFUSED',
        after: { domainOutcome: 'REVIEW_ALREADY_RECORDED' },
      });

      // l'hôte du trip note le voyageur : auteur = titulaire du compte, sujet = voyageur ; la note
      // apparaît dans ce que l'hôte voit du voyageur (host_guest_v, ADR-128), deux décimales
      expect((await recordAt(cl.api, w.rec, w.ops, t.tripId, byHost('THREE'))).outcome).toBe(
        'DONE',
      );
      const guestRow = (await reviewsOf(cl.api, t.tripId)).find((x) => x.subject_type === 'GUEST');
      expect(guestRow).toMatchObject({
        author_user_id: w.h.userId,
        author_role: 'HOST',
        subject_id: t.guestId,
        overall: 3,
      });
      expect(await recordAt(cl.api, w.rec, w.ops, t.tripId, byHost('FIVE'))).toMatchObject({
        outcome: 'REFUSED',
        detail: 'REVIEW_ALREADY_RECORDED',
      });
      const seen = await hostTripAt(cl.api, w.rec, w.h, t.tripId);
      expect(seen).toMatchObject({ outcome: 'DONE', trip_id: t.tripId, guest_rating: '3.00' });
      // un voyageur sans avis : aucune note
      const unrated = await hostTripAt(cl.api, w.rec, w.h, w.done[1]?.tripId);
      expect(unrated?.['guest_rating']).toBeNull();
    });
  });

  it('critère 2 : 3 avis (5, 4, 3) et 2 trips non notés ⇒ moyenne 4,0 et 5 trips, pour l’hôte et pour le véhicule, dans la lecture publique de l’annonce', async () => {
    await withClients(async (cl) => {
      // 5 trips réalisés du véhicule de l'hôte, plus un trip BOOKED qui ne compte pas
      const w = await world(cl, c, false);
      // avant tout avis : 5 trips réalisés, aucun avis, aucune moyenne (badge « Nuevo »)
      expect(await ratings(cl.api, [w.listing])).toEqual([
        {
          listing_id: w.listing,
          vehicle_trip_count: 5,
          vehicle_review_count: 0,
          vehicle_avg_x100: null,
          host_trip_count: 5,
          host_review_count: 0,
          host_avg_x100: null,
        },
      ]);
      const stars: readonly Stars[] = ['FIVE', 'FOUR', 'THREE'];
      for (const [i, s] of stars.entries()) {
        const t = w.done[i];
        if (!t) throw new Error('trip absent');
        expect((await recordAt(cl.api, w.rec, w.ops, t.tripId, byGuest(s))).outcome, s).toBe(
          'DONE',
        );
      }
      // exemple de 19 US-218 : 3 avis (5, 4, 3) et 2 trips non notés ⇒ moyenne 4,0 et 5 trips
      const [row] = await ratings(cl.api, [w.listing]);
      expect(row).toEqual({
        listing_id: w.listing,
        vehicle_trip_count: 5,
        vehicle_review_count: 3,
        vehicle_avg_x100: 400,
        host_trip_count: 5,
        host_review_count: 3,
        host_avg_x100: 400,
      });
      expect(await aggregateOf(cl.api, 'HOST', w.h.org)).toEqual({
        review_count: 3,
        overall_sum: 12,
        avg_overall_x100: 400,
      });
      expect(await aggregateOf(cl.api, 'VEHICLE', w.car)).toEqual({
        review_count: 3,
        overall_sum: 12,
        avg_overall_x100: 400,
      });
      // un trip BOOKED n'est pas un trip réalisé : il ne compte pas
      expect((await ratings(cl.api, [w.listing]))[0]?.['host_trip_count']).toBe(5);
      // arrondi au demi supérieur : (5 + 4 + 3 + 4) / 4 = 4,00 ; + 5 ⇒ 21 / 5 = 4,20
      const t4 = w.done[3];
      const t5 = w.done[4];
      if (!t4 || !t5) throw new Error('trip absent');
      expect((await recordAt(cl.api, w.rec, w.ops, t4.tripId, byGuest('FOUR'))).outcome).toBe(
        'DONE',
      );
      expect((await recordAt(cl.api, w.rec, w.ops, t5.tripId, byGuest('FIVE'))).outcome).toBe(
        'DONE',
      );
      expect((await ratings(cl.api, [w.listing]))[0]).toMatchObject({
        host_review_count: 5,
        host_avg_x100: 420,
      });
      // annonce inconnue, liste trop longue : aucune ligne ; jamais l'identifiant du compte
      expect(await ratings(cl.api, [uuid()])).toEqual([]);
      expect(
        await ratings(
          cl.api,
          Array.from({ length: 101 }, () => w.listing),
        ),
      ).toEqual([]);
      expect(JSON.stringify(row)).not.toContain(w.h.org);
    });
  });

  it('domaine : trip non COMPLETED, fenêtre close (10 jours après la fin, review_window_days du pays), saisie absente ou hors énumération, permission ⇒ refus sans écriture', async () => {
    await withClients(async (cl) => {
      const w = await world(cl, c);
      expect(
        await recordAt(cl.api, w.rec, w.ops, w.upcoming.tripId, byGuest('FIVE')),
      ).toMatchObject({
        outcome: 'REFUSED',
        detail: 'REVIEW_TRIP_NOT_COMPLETED',
      });
      // fin 12 jours avant l'enregistrement > review_window_days (10) : fenêtre close
      if (!w.old) throw new Error('trip hors fenêtre absent');
      expect(Date.parse(w.rec) - Date.parse(w.old.end)).toBeGreaterThan(
        WINDOW_DAYS * DAY_MIN * 60_000,
      );
      expect(await recordAt(cl.api, w.rec, w.ops, w.old.tripId, byGuest('FIVE'))).toMatchObject({
        outcome: 'REFUSED',
        detail: 'REVIEW_WINDOW_CLOSED',
      });
      expect(await reviewsOf(cl.api, w.old.tripId)).toEqual([]);
      const [t] = w.done;
      if (!t) throw new Error('trip absent');
      for (const input of [{}, { authorRole: 'GUEST' }, { overall: 'FIVE' }]) {
        expect(
          await recordAt(cl.api, w.rec, w.ops, t.tripId, input),
          JSON.stringify(input),
        ).toMatchObject({
          outcome: 'REFUSED',
          detail: 'REVIEW_INPUT_REQUIRED',
        });
      }
      // valeur hors énumération fermée (jamais un nombre) : refusée par le cadre (22023)
      for (const input of [
        { authorRole: 'GUEST', overall: '5' },
        { authorRole: 'GUEST', overall: 'SIX' },
        { authorRole: 'PLATFORM', overall: 'FIVE' },
      ]) {
        await expect(recordAt(cl.api, w.rec, w.ops, t.tripId, input)).rejects.toMatchObject({
          code: '22023',
        });
      }
      // un agent du support n'a pas ops.review_listing_host (17 §2.3) : refusé et journalisé
      const support = await staffAt(cl, 'SUPPORT_AGENT', c.country, w.rec);
      expect((await recordAt(cl.api, w.rec, support, t.tripId, byGuest('FIVE'))).outcome).toBe(
        'FORBIDDEN',
      );
      // un agent d'un autre pays : hors portée
      const other = COUNTRIES.find((x) => x.country !== c.country)?.country ?? c.country;
      const abroad = await staffAt(cl, 'OPS_AGENT', other, w.rec);
      expect((await recordAt(cl.api, w.rec, abroad, t.tripId, byGuest('FIVE'))).outcome).toBe(
        'FORBIDDEN',
      );
      expect(await reviewsOf(cl.api, t.tripId)).toEqual([]);
      expect(await aggregateOf(cl.api, 'HOST', w.h.org)).toBeNull();
    });
  });

  it('concurrence et registre : deux enregistrements simultanés du même avis ⇒ un seul ; avis immuable (migrator compris) ; aucune lecture applicative des tables', async () => {
    await withClients(async (cl) => {
      const w = await world(cl, c);
      const [t] = w.done;
      if (!t) throw new Error('trip absent');
      const second = await connectAs('app_api');
      try {
        const results = await Promise.all([
          recordAt(cl.api, w.rec, w.ops, t.tripId, byGuest('FIVE')),
          recordAt(second, w.rec, w.ops, t.tripId, byGuest('TWO')),
        ]);
        expect(results.map((x) => x.outcome).sort()).toEqual(['DONE', 'REFUSED']);
        expect(results.find((x) => x.outcome === 'REFUSED')?.detail).toBe(
          'REVIEW_ALREADY_RECORDED',
        );
      } finally {
        await releaseClient(second);
      }
      const rows = await reviewsOf(cl.api, t.tripId);
      expect(rows).toHaveLength(2);
      expect((await aggregateOf(cl.api, 'HOST', w.h.org))?.review_count).toBe(1);
      for (const kind of ['UPDATE', 'DELETE']) {
        expect(
          (
            await one<{ r: string }>(cl.api, 'SELECT test_fixture.us218_try_write($1, $2) AS r', [
              rows[0]?.id,
              kind,
            ])
          ).r,
          kind,
        ).toBe('23000:review_record_immutable');
      }
      for (const sql of [
        'SELECT overall FROM core.review_review LIMIT 1',
        'SELECT avg_overall_x100 FROM core.review_rating_aggregate LIMIT 1',
      ]) {
        await expect(cl.api.query(sql), sql).rejects.toMatchObject({ code: '42501' });
      }
      // la commande liée n'est exécutable par aucun rôle applicatif (l'acteur y est un argument)
      await expect(
        cl.api.query(
          `SELECT * FROM core.review_manual_action_record_review($1, $2, 'RECORD_REVIEW', $3,
                                                                  '{}'::jsonb, 'x', $4, 'OPS_AGENT')`,
          [w.ops.hash, uuid(), t.tripId, w.ops.userId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
