/**
 * US-316 (migration 0166, ADR-186) — messagerie hôte–voyageur : confidentialité, rendez-vous et
 * rétention. Rôles de PRODUCTION seulement (assertion L0-05 par `connectAs`), au Panama (USD) et au
 * Paraguay (PYG sans décimale), sous horloge virtuelle pour les échéances.
 *
 * Attendus tirés de 19 US-316 (critère 1 : « il voit le prénom de l'autre et jamais son téléphone,
 * son e-mail, son numéro de permis ni l'image d'une pièce » ; critère 2 : « hôte B ⇒ 0 ligne ; un
 * co-hôte de portée V1 ne lit pas les fils de V2 (RLS-9) » ; critère 3 : « à l'échéance de
 * rétention, ils sont purgés selon US-111 » ; critère 4 : « proposition de rendez-vous de l'hôte
 * acceptée par le voyageur ⇒ lieu et heure rattachés au trip et repris dans les notifications du
 * trip »), de 16 MSG-001 / LEG-009 (« dossier en litige → gel de la purge »), de 22 OQ-BR-25
 * (défaut : la durée la plus courte), de 17 §7.2 (`evidence_retention_months` ≥ 15 mois,
 * REQ-PAY-DMG-11), du pré-mortem du lot 3 (L3-PM-45, L3-PM-46, L3-PM-49, L3-PM-50 : « jamais purgé
 * ou purgé avant la fin d'un litige ») et d'ADR-186. Les durées sont lues dans les DONNÉES de
 * configuration (params.json), jamais dans le code testé.
 *
 * Tout se passe dans des transactions ANNULÉES (trips de la fixture 9926 par 9919 ; sessions
 * ouvertes par la vraie commande) ; aucun interrupteur n'est touché.
 */
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, openSession, setVirtualNow } from '../support/iam.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const THREAD = 'SELECT * FROM core.messaging_thread_read($1, $2::uuid, $3)';
const POST = 'SELECT * FROM core.messaging_cmd_post_message($1, $2::uuid, $3::uuid, $4)';
const MEETINGS = 'SELECT * FROM core.messaging_meeting_read($1, $2::uuid)';
const PROPOSE =
  'SELECT * FROM core.messaging_cmd_propose_meeting($1, $2::uuid, $3::uuid, $4, $5, $6::timestamptz)';
const ANSWER = 'SELECT * FROM core.messaging_cmd_answer_meeting($1, $2::uuid, $3::uuid, $4)';
const PURGE = 'SELECT core.privacy_worker_message_purge($1) AS n';

const T0 = '2035-05-02T09:00:00.000Z';
const START = '2035-06-10T15:00:00.000Z';
const END = '2035-06-13T15:00:00.000Z';
const HOUR_MS = 3_600_000;
const at = (iso: string, hours: number): string =>
  new Date(Date.parse(iso) + hours * HOUR_MS).toISOString();
/** Numéros FICTIFS de test, au format de chaque pays (données de test, pas du code). */
const PHONE: Readonly<Record<string, string>> = {
  PA: '+507 6123-4567',
  PY: '+595 981 123 456',
};
const PLACE = 'Estacionamiento del centro comercial, entrada norte';

interface ParamData {
  readonly key: string;
  readonly values: Readonly<Record<string, number | boolean>>;
}
const PARAMS = (
  JSON.parse(
    readFileSync(
      new URL('../../../../apps/api/src/modules/cfg/data/params.json', import.meta.url),
      'utf8',
    ),
  ) as { params: ParamData[] }
).params;
/** Durée de la preuve du pays, plancher de 15 mois (17 §7.2, REQ-PAY-DMG-11). */
const retentionMonths = (country: string): number => {
  const v = PARAMS.find((p) => p.key === 'evidence_retention_months')?.values[country];
  if (typeof v !== 'number') throw new Error(`evidence_retention_months sans valeur (${country})`);
  return Math.max(v, 15);
};
/** Instant ISO à `months` mois et `minutes` minutes de `base` (calendrier UTC). */
function plusMonths(base: string, months: number, minutes = 0): string {
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + months);
  return new Date(d.getTime() + minutes * 60_000).toISOString();
}

interface Trip {
  readonly trip: string;
  readonly org: string;
  readonly vehicle: string;
  readonly holder: string;
}

async function trip(
  tx: Tx,
  c: CountryCase,
  guest: string,
  org: string | null = null,
  start = START,
  end = END,
): Promise<Trip> {
  const r = (
    await tx.query<{ trip_id: string; org_id: string; vehicle_id: string; holder_id: string }>(
      'SELECT * FROM test_fixture.us316_trip($1, $2::uuid, $3::uuid, $4, $5)',
      [c.country, org, guest, start, end],
    )
  ).rows[0]!;
  return { trip: r.trip_id, org: r.org_id, vehicle: r.vehicle_id, holder: r.holder_id };
}

const rows = async (tx: Tx, sql: string, values: unknown[]): Promise<Row[]> =>
  (await tx.query<Row>(sql, values)).rows;
const one = async (tx: Tx, sql: string, values: unknown[]): Promise<Row> => {
  const r = await rows(tx, sql, values);
  expect(r).toHaveLength(1);
  return r[0]!;
};
const propose = (
  tx: Tx,
  hash: Buffer,
  tripId: string,
  kind: string,
  place: string,
  meetAt: string,
  id: string = uuid(),
): Promise<Row> => one(tx, PROPOSE, [hash, tripId, id, kind, place, meetAt]);
const answer = (tx: Tx, hash: Buffer, tripId: string, id: string, decision: string) =>
  one(tx, ANSWER, [hash, tripId, id, decision]);
const meetingsOf = (tx: Tx, tripId: string) =>
  rows(tx, 'SELECT * FROM test_fixture.us316_meetings($1)', [tripId]);
const eventsOf = (tx: Tx, tripId: string) =>
  rows(tx, 'SELECT * FROM test_fixture.us316_events($1)', [tripId]);
const messagesOf = (tx: Tx, tripId: string) =>
  rows(tx, 'SELECT * FROM test_fixture.us316_messages($1)', [tripId]);
const logOf = (tx: Tx, tripId: string) =>
  rows(tx, 'SELECT * FROM test_fixture.us111_retention_log($1)', [tripId]);
const close = (tx: Tx, tripId: string, status: string) =>
  tx.query('SELECT test_fixture.us111_close_trip($1, $2, NULL, NULL)', [tripId, status]);

/** Transaction du travailleur privacy_request (contexte posé comme la couche BUS). */
const worker = async <T>(c: Tx, virtualNow: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withTestTransaction(c, { virtualNow }, async (tx) => {
    await tx.query(
      `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
              pg_catalog.set_config('app.worker_name', 'privacy_request', true)`,
    );
    return fn(tx);
  });

describe.each(COUNTRIES)('US-316 — confidentialité et rendez-vous ($country, $currency)', (c) => {
  it('critère 1 : prénom de l’autre partie seulement ; jamais téléphone, e-mail, nom de famille, permis ni pièce, dans le fil comme dans les rendez-vous', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest);
        const g = await openSession(tx, guest);
        const h = await openSession(tx, t.holder);
        await one(tx, POST, [g.hash, t.trip, uuid(), 'Hola, ¿dónde nos vemos?']);
        await propose(tx, h.hash, t.trip, 'PICKUP', PLACE, at(START, -1));

        // colonnes rendues : aucune n'est un contact, un nom de famille, un permis ou une pièce
        const { rows: cols } = await tx.query<{ fn: string; names: string[] }>(
          `SELECT p.proname AS fn, p.proargnames AS names FROM pg_catalog.pg_proc p
            WHERE p.pronamespace = 'core'::regnamespace
              AND p.proname IN ('messaging_thread_read', 'messaging_meeting_read')`,
        );
        expect(cols).toHaveLength(2);
        for (const r of cols) {
          for (const n of r.names) {
            expect(n, r.fn).not.toMatch(
              /phone|email|mail|last_name|license|licence|permit|document|id_image|selfie|birth|address/i,
            );
          }
        }

        const views: Row[][] = [];
        for (const s of [g, h]) {
          views.push(await rows(tx, THREAD, [s.hash, t.trip, 200]));
          views.push(await rows(tx, MEETINGS, [s.hash, t.trip]));
        }
        // prénom = premier mot du prénom légal ; nom de famille et courriel jamais servis
        expect(views[0]![0]).toMatchObject({ viewer_role: 'GUEST', counterpart_name: 'María' });
        expect(views[2]![0]).toMatchObject({ viewer_role: 'HOST', counterpart_name: 'Ana' });
        const served = JSON.stringify(views);
        for (const leak of ['Gómez', 'Pérez', 'José', '@fixture.test', guest, t.holder]) {
          expect(served, leak).not.toContain(leak);
        }
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('critère 2 : hôte B et co-hôte de portée V1 : 0 ligne du fil et des rendez-vous d’un trip de A ou de V2, même issue qu’un trip inconnu (RLS-9)', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t1 = await trip(tx, c, guest);
        // second véhicule du MÊME compte (V2) et trip d'un autre hôte (B)
        const t2 = await trip(tx, c, uuid(), t1.org);
        const other = await trip(tx, c, uuid());
        const coV2 = await tx.query<{ id: string }>(
          `SELECT test_fixture.us525_member($1, 'CO_HOST', ARRAY[$2::uuid], 'ACTIVE', 'Leo', '{}') AS id`,
          [t1.org, t2.vehicle],
        );
        const h1 = await openSession(tx, t1.holder);
        await propose(tx, h1.hash, t1.trip, 'PICKUP', PLACE, at(START, -1));
        const sessions = {
          hostB: await openSession(tx, other.holder),
          coHostV2: await openSession(tx, coV2.rows[0]!.id),
          stranger: { hash: newToken().hash },
        };
        for (const [who, s] of Object.entries(sessions)) {
          const thread = await rows(tx, THREAD, [s.hash, t1.trip, 200]);
          const meet = await rows(tx, MEETINGS, [s.hash, t1.trip]);
          const expected = who === 'stranger' ? 'AUTH_REQUIRED' : 'NOT_FOUND';
          expect(thread, who).toEqual([
            expect.objectContaining({ outcome: expected, message_id: null }),
          ]);
          expect(meet, who).toEqual([
            expect.objectContaining({ outcome: expected, meeting_id: null }),
          ]);
          expect(meet[0], who).toMatchObject({
            viewer_role: null,
            timezone: null,
            place_label: null,
          });
          // écriture : même issue
          expect(
            (await propose(tx, s.hash, t1.trip, 'RETURN', PLACE, at(END, -1)))['outcome'],
            who,
          ).toBe(expected);
        }
        // le co-hôte de V2 lit bien le trip de V2 (portée), pas celui de V1
        expect((await rows(tx, MEETINGS, [sessions.coHostV2.hash, t2.trip]))[0]).toMatchObject({
          outcome: 'DONE',
          viewer_role: 'CO_HOST',
          can_propose: true,
        });
        // trip inconnu : même issue que celui d'un autre
        expect((await rows(tx, MEETINGS, [sessions.hostB.hash, uuid()]))[0]).toMatchObject({
          outcome: 'NOT_FOUND',
        });
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('critère 4 : proposition de l’hôte, acceptée par le voyageur ⇒ rendez-vous du trip (lieu et heure) et événement trip.meeting.confirmed (heure, jamais le lieu) ; remplacements ; réessais sans doublon', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest);
        const g = await openSession(tx, guest);
        const h = await openSession(tx, t.holder);

        // aucun rendez-vous : une ligne d'en-tête ; seul l'hôte peut proposer
        expect(await rows(tx, MEETINGS, [g.hash, t.trip])).toEqual([
          expect.objectContaining({
            outcome: 'DONE',
            viewer_role: 'GUEST',
            can_propose: false,
            timezone: c.timezone,
            meeting_id: null,
          }),
        ]);
        expect((await rows(tx, MEETINGS, [h.hash, t.trip]))[0]).toMatchObject({
          viewer_role: 'HOST',
          can_propose: true,
        });
        // le voyageur ne propose pas
        expect((await propose(tx, g.hash, t.trip, 'PICKUP', PLACE, at(START, -1)))['outcome']).toBe(
          'MEETING_NOT_ALLOWED',
        );

        // horloge avancée d'une minute à chaque étape : ordre des propositions déterministe
        let clock = T0;
        const tick = async () => {
          clock = at(clock, 1 / 60);
          await setVirtualNow(tx, clock);
        };
        // première proposition, puis une seconde qui la remplace
        const first = uuid();
        expect(
          await propose(tx, h.hash, t.trip, 'PICKUP', 'Plaza central', at(START, -2), first),
        ).toMatchObject({ outcome: 'DONE', meeting_id: first, status: 'PROPOSED' });
        await tick();
        const id = uuid();
        const meetAt = at(START, -1);
        const p = await propose(tx, h.hash, t.trip, 'PICKUP', `  ${PLACE} `, meetAt, id);
        expect(p).toMatchObject({
          outcome: 'DONE',
          meeting_id: id,
          kind: 'PICKUP',
          status: 'PROPOSED',
        });
        expect(p['place_label']).toBe(PLACE);
        // réessai du même identifiant : la proposition enregistrée, sans doublon
        expect(
          await propose(tx, h.hash, t.trip, 'PICKUP', 'Otro lugar', at(START, -3), id),
        ).toMatchObject({ outcome: 'DONE', meeting_id: id, place_label: PLACE });
        expect((await meetingsOf(tx, t.trip)).map((m) => [m['id'], m['status']])).toEqual([
          [first, 'SUPERSEDED'],
          [id, 'PROPOSED'],
        ]);
        // le voyageur voit la proposition en attente (lieu, heure), pas la remplacée
        const seen = await rows(tx, MEETINGS, [g.hash, t.trip]);
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({
          meeting_id: id,
          kind: 'PICKUP',
          place_label: PLACE,
          status: 'PROPOSED',
          mine: false,
        });
        expect((seen[0]!['meet_at'] as Date).toISOString()).toBe(meetAt);

        // l'hôte ne répond pas à sa propre proposition
        expect((await answer(tx, h.hash, t.trip, id, 'ACCEPT'))['outcome']).toBe(
          'MEETING_NOT_ALLOWED',
        );
        expect(await eventsOf(tx, t.trip)).toEqual([]);

        await tick();
        // le voyageur accepte : rendez-vous du trip, un événement (heure, sans le lieu)
        expect(await answer(tx, g.hash, t.trip, id, 'ACCEPT')).toMatchObject({
          outcome: 'DONE',
          meeting_id: id,
          kind: 'PICKUP',
          status: 'ACCEPTED',
        });
        expect(await meetingsOf(tx, t.trip)).toEqual([
          expect.objectContaining({ id: first, status: 'SUPERSEDED' }),
          expect.objectContaining({
            id,
            status: 'ACCEPTED',
            answered_by: guest,
            place_label: PLACE,
            proposer_role: 'HOST',
          }),
        ]);
        const events = await eventsOf(tx, t.trip);
        expect(events).toEqual([
          {
            type: 'trip.meeting.confirmed',
            aggregate_type: 'trip',
            country_code: c.country,
            actor_role: 'GUEST',
            actor_user_id: guest,
            payload: { trip_id: t.trip, meeting_id: id, kind: 'PICKUP', meet_at: meetAt },
          },
        ]);
        expect(JSON.stringify(events)).not.toContain('Estacionamiento');
        // réessai de la même réponse : DONE, aucun second événement ; autre réponse : refusée
        expect((await answer(tx, g.hash, t.trip, id, 'ACCEPT'))['outcome']).toBe('DONE');
        expect(await eventsOf(tx, t.trip)).toHaveLength(1);
        expect((await answer(tx, g.hash, t.trip, id, 'DECLINE'))['outcome']).toBe(
          'MEETING_NOT_PENDING',
        );
        expect((await answer(tx, g.hash, t.trip, first, 'ACCEPT'))['outcome']).toBe(
          'MEETING_NOT_PENDING',
        );

        await tick();
        // nouveau rendez-vous de remise accepté : l'ancien est remplacé, un seul ACCEPTED
        const moved = uuid();
        await propose(tx, h.hash, t.trip, 'PICKUP', 'Terminal de buses, andén 3', START, moved);
        // le rendez-vous accepté reste en vigueur tant que le nouveau n'est pas accepté
        expect(
          (await rows(tx, MEETINGS, [g.hash, t.trip])).map((m) => [m['meeting_id'], m['status']]),
        ).toEqual([
          [id, 'ACCEPTED'],
          [moved, 'PROPOSED'],
        ]);
        await tick();
        await answer(tx, g.hash, t.trip, moved, 'ACCEPT');
        expect(
          (await rows(tx, MEETINGS, [h.hash, t.trip])).map((m) => [m['meeting_id'], m['status']]),
        ).toEqual([[moved, 'ACCEPTED']]);
        expect(await eventsOf(tx, t.trip)).toHaveLength(2);

        await tick();
        // retour : refus du voyageur, aucun événement
        const ret = uuid();
        await propose(tx, h.hash, t.trip, 'RETURN', PLACE, at(END, 2), ret);
        expect(await answer(tx, g.hash, t.trip, ret, 'DECLINE')).toMatchObject({
          outcome: 'DONE',
          status: 'DECLINED',
        });
        expect(await eventsOf(tx, t.trip)).toHaveLength(2);

        // proposition d'un autre trip (identifiant valable) : même issue qu'inconnue
        const t2 = await trip(tx, c, uuid(), t.org);
        expect((await answer(tx, g.hash, t2.trip, moved, 'ACCEPT'))['outcome']).toBe('NOT_FOUND');
        expect((await answer(tx, g.hash, t.trip, uuid(), 'ACCEPT'))['outcome']).toBe('NOT_FOUND');
        expect((await answer(tx, g.hash, t.trip, moved, 'MAYBE'))['outcome']).toBe(
          'REQUEST_INVALID',
        );
        // identifiant de proposition déjà pris par un autre trip
        const h2 = await openSession(tx, t2.holder);
        expect(
          (await propose(tx, h2.hash, t2.trip, 'PICKUP', PLACE, at(START, -1), moved))['outcome'],
        ).toBe('REQUEST_INVALID');
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('lieu proposant un paiement hors plateforme : enregistré (jamais refusé), codes seulement, fil du trip dans la file GRAY_MARKET (ADR-176) ; lieu ordinaire : aucun signal', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const t = await trip(tx, c, uuid());
        const h = await openSession(tx, t.holder);
        const plain = uuid();
        await propose(tx, h.hash, t.trip, 'RETURN', PLACE, at(END, -1), plain);
        expect(
          await rows(tx, 'SELECT * FROM test_fixture.us525_review_items($1)', [t.trip]),
        ).toEqual([]);
        const cash = uuid();
        const r = await propose(
          tx,
          h.hash,
          t.trip,
          'PICKUP',
          'Plaza central, te pago en efectivo al llegar',
          at(START, -1),
          cash,
        );
        expect(r).toMatchObject({ outcome: 'DONE', meeting_id: cash, status: 'PROPOSED' });
        const stored = (await meetingsOf(tx, t.trip)).find((m) => m['id'] === cash)!;
        expect(stored['review_item']).toBe(true);
        const codes = stored['offplatform_codes'] as string[];
        expect(codes.length).toBeGreaterThan(0);
        for (const code of codes) expect(code).toMatch(/^[A-Z][A-Z0-9_]+$/);
        expect((await meetingsOf(tx, t.trip)).find((m) => m['id'] === plain)).toMatchObject({
          offplatform_codes: null,
          review_item: false,
        });
        expect(
          await rows(tx, 'SELECT * FROM test_fixture.us525_review_items($1)', [t.trip]),
        ).toEqual([
          {
            queue: 'GRAY_MARKET',
            subject_type: 'MESSAGE_THREAD',
            country_code: c.country,
            status: 'OPEN',
            flag_items: '0',
          },
        ]);
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('lieu sans coordonnées (refus, jamais masqué) ; heure future et bornée par le trip ; trip clos ou commencé : refus ; heure passée : plus acceptable', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest);
        const h = await openSession(tx, t.holder);
        let hostHash = h.hash;
        const pick = (place: string, when = at(START, -1), kind = 'PICKUP') =>
          propose(tx, hostHash, t.trip, kind, place, when).then((r) => r['outcome']);

        // coordonnées (L3-PM-45, L3-PM-49 : « jamais bloquer, sauf coordonnées »)
        for (const place of [
          `Llámame al ${PHONE[c.country]!}`,
          'Escríbeme a ana.perez@gmail.com',
          'Mi usuario @anaperez',
          'https://wa.me/50761234567',
          'Ubicación en maps.example.com/xyz',
        ]) {
          expect(await pick(place), place).toBe('MEETING_PLACE_CONTACT');
        }
        // faux positifs : une heure, un numéro de rue court ou un prix ne bloquent pas
        expect(await pick('Calle 50 y Vía España, a las 10:30')).toBe('DONE');
        // forme
        expect(await pick('ab')).toBe('MEETING_INVALID');
        expect(await pick('x'.repeat(161))).toBe('MEETING_INVALID');
        expect(await pick(PLACE, at(START, -1), 'ELSEWHERE')).toBe('MEETING_INVALID');
        // heure : passée, trop tôt pour une remise, après la fin pour une remise, retour trop tard
        expect(await pick(PLACE, at(T0, -1))).toBe('MEETING_INVALID');
        expect(await pick(PLACE, at(START, -25))).toBe('MEETING_INVALID');
        expect(await pick(PLACE, at(END, 1))).toBe('MEETING_INVALID');
        expect(await pick(PLACE, at(END, 25), 'RETURN')).toBe('MEETING_INVALID');
        expect(await pick(PLACE, at(START, -1), 'RETURN')).toBe('MEETING_INVALID');
        expect(await pick(PLACE, at(END, 24), 'RETURN')).toBe('DONE');

        // heure passée : la proposition ne s'accepte plus (un refus reste possible)
        const late = uuid();
        await propose(tx, h.hash, t.trip, 'PICKUP', PLACE, at(START, -1), late);
        await setVirtualNow(tx, at(START, -0.5));
        // sessions d'une durée bornée (US-101) : rouvertes à la nouvelle heure
        const g2 = await openSession(tx, guest);
        const h2 = await openSession(tx, t.holder);
        hostHash = h2.hash;
        expect((await answer(tx, g2.hash, t.trip, late, 'ACCEPT'))['outcome']).toBe(
          'MEETING_EXPIRED',
        );
        expect((await answer(tx, g2.hash, t.trip, late, 'DECLINE'))['outcome']).toBe('DONE');

        // trip commencé : plus de remise ; retour encore ; trip clos : rien
        await close(tx, t.trip, 'IN_PROGRESS');
        expect(await pick(PLACE, at(START, 1))).toBe('MEETING_NOT_ALLOWED');
        expect(await pick(PLACE, at(END, 1), 'RETURN')).toBe('DONE');
        await close(tx, t.trip, 'COMPLETED');
        expect(await pick(PLACE, at(END, 1), 'RETURN')).toBe('MEETING_NOT_ALLOWED');
        expect((await rows(tx, MEETINGS, [hostHash, t.trip]))[0]).toMatchObject({
          can_propose: false,
        });
      });
    } finally {
      await releaseClient(api);
    }
  });
});

describe.each(COUNTRIES)('US-316 critère 3 — rétention des messages ($country, $currency)', (c) => {
  const months = retentionMonths(c.country);
  // dernière activité : un message envoyé deux heures après la fin (après la clôture du trip)
  const LAST = at(END, 2);
  const due = plusMonths(LAST, months);

  async function seeded(tx: Tx, status = 'COMPLETED'): Promise<{ t: Trip; guest: string }> {
    const guest = uuid();
    const t = await trip(tx, c, guest);
    await tx.query('SELECT test_fixture.us316_seed_message($1, $2, $3, $4, $5)', [
      t.trip,
      guest,
      'GUEST',
      `Te llamo al ${PHONE[c.country]!}`,
      T0,
    ]);
    await setVirtualNow(tx, at(END, 1));
    await close(tx, t.trip, status);
    await tx.query('SELECT test_fixture.us316_seed_message($1, $2, $3, $4, $5)', [
      t.trip,
      t.holder,
      'HOST',
      'Gracias, buen viaje',
      LAST,
    ]);
    return { t, guest };
  }

  it('à l’échéance (evidence_retention_months depuis la dernière activité) : textes et lieux purgés, lignes gardées, une ligne au journal, une seule fois ; une minute avant : rien', async () => {
    expect(months).toBeGreaterThanOrEqual(15);
    const w = await connectAs('app_worker');
    try {
      await worker(w, T0, async (tx) => {
        const { t } = await seeded(tx);
        await setVirtualNow(tx, plusMonths(due, 0, -1));
        await tx.query(PURGE, [10000]);
        expect(await logOf(tx, t.trip)).toEqual([]);
        expect((await messagesOf(tx, t.trip)).map((m) => m['purged_at'])).toEqual([null, null]);

        await setVirtualNow(tx, plusMonths(due, 0, 1));
        expect((await one(tx, PURGE, [10000]))['n']).toBeGreaterThanOrEqual(1);
        const msgs = await messagesOf(tx, t.trip);
        expect(msgs).toHaveLength(2);
        for (const m of msgs) {
          expect(m).toMatchObject({ body: null, body_masked: null, status: 'SENT' });
          expect(m['purged_at']).toBeInstanceOf(Date);
        }
        // heure serveur et auteur demeurent (preuve qu'un échange a eu lieu, sans son contenu)
        expect(msgs.map((m) => [m['author_role'], (m['sent_at'] as Date).toISOString()])).toEqual([
          ['GUEST', T0],
          ['HOST', LAST],
        ]);
        expect(await logOf(tx, t.trip)).toEqual([
          {
            rule_code: 'TRIP_MESSAGES',
            subject_type: 'TRIP',
            country_code: c.country,
            action: 'PURGE',
            columns: ['body', 'body_masked'],
            due_at: new Date(due),
            at: new Date(plusMonths(due, 0, 1)),
          },
        ]);
        // jamais deux fois
        await setVirtualNow(tx, plusMonths(due, 2));
        await tx.query(PURGE, [10000]);
        expect(await logOf(tx, t.trip)).toHaveLength(1);
      });
    } finally {
      await releaseClient(w);
    }
  });

  it.each([
    ['litige (IN_DISPUTE)', 'IN_DISPUTE', null],
    ['rétrofacturation inscrite', 'COMPLETED', 'RECORD_CHARGEBACK'],
    ['incident inscrit', 'COMPLETED', 'OPEN_INCIDENT'],
    ['demande bloquée par une obligation légale', 'COMPLETED', 'BLOCKED_LEGAL_HOLD'],
    ['réclamation ouverte', 'COMPLETED', 'CASE_OPEN'],
    ['réclamation en attente', 'COMPLETED', 'CASE_PENDING'],
    ['trip encore vivant', 'IN_PROGRESS', null],
  ] as const)(
    'jamais pendant un litige, une rétrofacturation ou une réclamation ouverte : %s',
    async (_label, status, hold) => {
      const w = await connectAs('app_worker');
      try {
        await worker(w, T0, async (tx) => {
          const { t } = await seeded(tx, status);
          if (hold === 'CASE_OPEN' || hold === 'CASE_PENDING') {
            await tx.query('SELECT test_fixture.us316_open_case($1, $2)', [
              t.trip,
              hold === 'CASE_OPEN' ? 'OPEN' : 'PENDING',
            ]);
          } else if (hold !== null) {
            await tx.query('SELECT test_fixture.us111_legal_hold($1, $2)', [t.trip, hold]);
          }
          await setVirtualNow(tx, plusMonths(due, 6));
          await tx.query(PURGE, [10000]);
          expect(await logOf(tx, t.trip)).toEqual([]);
          for (const m of await messagesOf(tx, t.trip)) {
            expect(m['purged_at']).toBeNull();
            expect(typeof m['body']).toBe('string');
          }
        });
      } finally {
        await releaseClient(w);
      }
    },
  );

  it('réclamation close (RESOLVED) : la purge reprend', async () => {
    const w = await connectAs('app_worker');
    try {
      await worker(w, T0, async (tx) => {
        const { t } = await seeded(tx);
        await tx.query('SELECT test_fixture.us316_open_case($1, $2)', [t.trip, 'RESOLVED']);
        await setVirtualNow(tx, plusMonths(due, 0, 1));
        await tx.query(PURGE, [10000]);
        expect(await logOf(tx, t.trip)).toHaveLength(1);
      });
    } finally {
      await releaseClient(w);
    }
  });

  it('rendez-vous : lieu purgé avec les messages, statut et heure gardés ; message purgé servi sans texte', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest);
        const g = await openSession(tx, guest);
        const h = await openSession(tx, t.holder);
        const id = uuid();
        await propose(tx, h.hash, t.trip, 'PICKUP', PLACE, at(START, -1), id);
        await answer(tx, g.hash, t.trip, id, 'ACCEPT');
        const m = await one(tx, POST, [g.hash, t.trip, uuid(), 'Perfecto, ahí estaré']);
        // purge (par le propriétaire des tables : la garde l'admet) puis lecture servie
        await tx.query('SELECT test_fixture.us316_force_write($1, $2)', [m['message_id'], 'PURGE']);
        expect(await rows(tx, THREAD, [g.hash, t.trip, 200])).toEqual([
          // purgé par la rétention, distingué d'un message masqué par l'équipe (hidden_at)
          expect.objectContaining({ message_id: m['message_id'], body: null, purged: true }),
        ]);
      });
    } finally {
      await releaseClient(api);
    }
    const w = await connectAs('app_worker');
    try {
      await worker(w, T0, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest);
        await tx.query('SELECT test_fixture.us316_seed_message($1, $2, $3, $4, $5)', [
          t.trip,
          guest,
          'GUEST',
          'Hola',
          T0,
        ]);
        const meeting = (
          await tx.query<{ id: string }>(
            'SELECT test_fixture.us316_seed_meeting($1, $2, $3, $4, $5) AS id',
            [t.trip, t.holder, 'PICKUP', PLACE, at(START, -1)],
          )
        ).rows[0]!.id;
        await setVirtualNow(tx, at(END, 1));
        await close(tx, t.trip, 'COMPLETED');
        await setVirtualNow(tx, plusMonths(at(END, 1), months, 1));
        await tx.query(PURGE, [10000]);
        expect(await meetingsOf(tx, t.trip)).toEqual([
          expect.objectContaining({
            id: meeting,
            kind: 'PICKUP',
            status: 'ACCEPTED',
            place_label: null,
            purged_at: expect.any(Date) as Date,
          }),
        ]);
        expect((await logOf(tx, t.trip))[0]).toMatchObject({
          columns: ['body', 'body_masked', 'place_label'],
        });
      });
    } finally {
      await releaseClient(w);
    }
  });
});

describe('US-316 — gardes, droits et tables fermées', () => {
  it('garde : un rendez-vous ne se supprime pas, ne se réécrit pas, ne se rouvre pas, même par le propriétaire des tables ; un message ne se « dépurge » pas', async () => {
    const api = await connectAs('app_api');
    try {
      const c = COUNTRIES[0];
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest);
        const g = await openSession(tx, guest);
        const h = await openSession(tx, t.holder);
        const id = uuid();
        await propose(tx, h.hash, t.trip, 'PICKUP', PLACE, at(START, -1), id);
        await answer(tx, g.hash, t.trip, id, 'ACCEPT');
        for (const what of [
          'MEETING_DELETE',
          'MEETING_REWRITE_PLACE',
          'MEETING_MOVE',
          'MEETING_REOPEN',
        ]) {
          await tx.query('SAVEPOINT w');
          await expect(
            tx.query('SELECT test_fixture.us316_force_write($1, $2)', [id, what]),
            what,
          ).rejects.toMatchObject({ code: '23000', constraint: 'messaging_meeting_guarded' });
          await tx.query('ROLLBACK TO SAVEPOINT w');
        }
        const m = await one(tx, POST, [g.hash, t.trip, uuid(), 'Hola']);
        const mid = m['message_id'] as string;
        // purge partielle refusée (forme), puis purge, puis « dépurge » refusée (garde)
        await tx.query('SAVEPOINT w');
        await expect(
          tx.query('SELECT test_fixture.us316_force_write($1, $2)', [mid, 'PURGE_KEEP_BODY']),
        ).rejects.toMatchObject({ code: '23000' });
        await tx.query('ROLLBACK TO SAVEPOINT w');
        await tx.query('SELECT test_fixture.us316_force_write($1, $2)', [mid, 'PURGE']);
        await tx.query('SAVEPOINT w');
        await expect(
          tx.query('SELECT test_fixture.us316_force_write($1, $2)', [mid, 'UNPURGE']),
        ).rejects.toMatchObject({ code: '23000', constraint: 'messaging_record_guarded' });
        await tx.query('ROLLBACK TO SAVEPOINT w');
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('table des rendez-vous : RLS ENABLE + FORCE, propriétaire migrator, politiques exactes ; aucun droit pour app_api, app_worker, app_anon', async () => {
    await withRole('app_api', async (client) => {
      const { rows: r } = await client.query<Row>(
        `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                ARRAY(SELECT p.polname || ':' || pg_catalog.array_to_string(ARRAY(
                               SELECT pg_catalog.pg_get_userbyid(x) FROM pg_catalog.unnest(p.polroles) AS x
                                ORDER BY 1), ',')
                        FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid ORDER BY 1) AS policies
           FROM pg_catalog.pg_class c
          WHERE c.oid = 'core.messaging_meeting_proposal'::regclass`,
      );
      expect(r).toEqual([
        {
          rls: true,
          force: true,
          owner: 'migrator',
          policies: [
            'messaging_cmd_ins:messaging_cmd_owner',
            'messaging_cmd_sel:messaging_cmd_owner',
            'messaging_cmd_upd:messaging_cmd_owner',
            'migrator_all:migrator',
            'privacy_cmd_purge:privacy_cmd_owner',
            'privacy_cmd_read:privacy_cmd_owner',
          ],
        },
      ]);
      await expect(
        client.query('SELECT 1 FROM core.messaging_meeting_proposal LIMIT 1'),
      ).rejects.toMatchObject({ code: '42501' });
    });
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await expect(
          client.query('SELECT 1 FROM core.messaging_meeting_proposal LIMIT 1'),
        ).rejects.toMatchObject({ code: '42501' });
      });
    }
  });

  it('rendez-vous : app_worker et app_anon n’exécutent ni la lecture ni les commandes ; la purge : app_worker seul, et seulement comme travailleur privacy_request', async () => {
    for (const role of ['app_worker', 'app_anon'] as const) {
      const client = await connectAs(role);
      try {
        for (const [sql, values] of [
          [MEETINGS, [newToken().hash, uuid()]],
          [PROPOSE, [newToken().hash, uuid(), uuid(), 'PICKUP', PLACE, START]],
          [ANSWER, [newToken().hash, uuid(), uuid(), 'ACCEPT']],
        ] as const) {
          await expect(client.query(sql, [...values]), `${role} ${sql}`).rejects.toMatchObject({
            code: '42501',
          });
        }
      } finally {
        await releaseClient(client);
      }
    }
    for (const role of ['app_api', 'app_anon'] as const) {
      const client = await connectAs(role);
      try {
        await expect(client.query(PURGE, [10])).rejects.toMatchObject({ code: '42501' });
      } finally {
        await releaseClient(client);
      }
    }
    // app_worker sans le contexte du travailleur privacy_request : refus
    const w = await connectAs('app_worker');
    try {
      await expect(w.query(PURGE, [10])).rejects.toMatchObject({ code: '42501' });
      await worker(w, T0, async (tx) => {
        await expect(tx.query(PURGE, [0])).rejects.toMatchObject({ code: '22023' });
      });
    } finally {
      await releaseClient(w);
    }
  });
});
