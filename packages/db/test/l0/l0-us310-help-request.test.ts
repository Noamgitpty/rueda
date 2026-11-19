/**
 * US-310 (migration 0162, ADR-182) — demande d'aide pendant le trip, réponse automatique hors plage
 * et mesure M6 : `core.support_trip_help_context`, `core.support_cmd_open_help_request`,
 * `core.support_staff_help_requests` et `core.support_staff_set_case_status` (prise d'une demande
 * non assignée, première réponse, résolution). Rôles de PRODUCTION seulement (assertion L0-05 par
 * `withRole` / `connectAs`), au Panama (USD) et au Paraguay (PYG).
 *
 * Attendus tirés de 19 US-310 (accès à l'aide depuis le trip pour le voyageur et l'hôte ; « un
 * message hors plage ⇒ réponse automatique dans la langue du compte ; délai de première réponse
 * mesuré (M6) »), de 16 SUP-004 (« ticket(trip_id, channel, lang, first_response_at, resolved_at) »,
 * états OPEN → PENDING → RESOLVED, « hors plage → message automatique »), de 16 SUP-020 (aucune
 * plage publiée sans planning validé : plage absente ⇒ toujours hors plage, fail-closed), de 17
 * §2.3 (IDOR : même réponse qu'un trip absent ; séparation des tâches, RLS-24) et de l'heure locale
 * du pays (fuseau IANA de la donnée de test `COUNTRIES`, calculée par `Intl`, jamais par la base).
 * Jamais le code testé comme oracle.
 *
 * Trips de la fixture 9948 (US-214), lectures de la fixture 9925 ; tout se passe dans une
 * transaction ANNULÉE ; aucun interrupteur n'est touché.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { first } from '../redteam/l1/support-host.ts';
import { staffPerson } from '../redteam/l1/support-p2.ts';
import { byCountry, ops, otherOf, rolledBack, uuid } from '../redteam/l1/support.ts';
import type { CountryCase } from '../support/avl.ts';
import { inTx } from '../support/avl.ts';
import { openSession, setVirtualNow } from '../support/iam.ts';
import { installTestProofKey } from '../support/staff.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const OPEN = 'SELECT * FROM core.support_cmd_open_help_request($1, $2, $3, $4, $5::jsonb)';
const CONTEXT = 'SELECT * FROM core.support_trip_help_context($1, $2)';
const LIST = 'SELECT * FROM core.support_staff_help_requests($1, $2, $3)';
const STATUS = 'SELECT * FROM core.support_staff_set_case_status($1, $2, $3, $4)';
const LINES = JSON.stringify([{ type: 'TRIP_PRICE', amountMinor: '1000' }]);
const DAY = 86_400_000;
/** Instant fixe des preuves de plage : 12 h 30 UTC (heure locale différente dans chaque pays). */
const T0 = '2035-05-02T12:30:00.000Z';

interface Open {
  readonly outcome: string;
  readonly case_id: string | null;
  readonly off_hours: boolean | null;
  readonly requester_role: string | null;
  readonly country_code: string | null;
}

/** Trip BOOKED de la fixture 9948 (voyageur `guest`, compte d'hôte neuf) ; rend trip et titulaire. */
async function tripOf(
  tx: Tx,
  c: CountryCase,
  guest: string,
  start: string,
  end: string,
): Promise<{ trip: string; holder: string }> {
  const r = (
    await tx.query<{ trip_id: string; holder_id: string }>(
      `SELECT * FROM test_fixture.us214_trip($1, $2, 'Ana', 'Pérez', 'María', 'Gómez', $3, $4,
                                             $5::jsonb)`,
      [c.country, guest, start, end, LINES],
    )
  ).rows[0]!;
  return { trip: r.trip_id, holder: r.holder_id };
}

const open = (
  tx: Tx,
  hash: Buffer | null,
  trip: string,
  topic: string,
  hours: Record<string, string> | null,
  requestId: string = uuid(),
): Promise<Open> =>
  first<Open>(tx, OPEN, [
    hash,
    requestId,
    trip,
    topic,
    hours === null ? null : JSON.stringify(hours),
  ]);

const caseOf = async (tx: Tx, id: string): Promise<Row | undefined> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us310_case($1)', [id])).rows[0];
const eventsOf = async (tx: Tx, id: string): Promise<Row[]> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us310_events($1)', [id])).rows;

/** Rejet SQLSTATE attendu, sans abandonner la transaction du test. */
async function rejects(tx: Tx, sql: string, values: readonly unknown[], code: string) {
  await tx.query('SAVEPOINT us310');
  await expect(tx.query(sql, values as unknown[])).rejects.toMatchObject({ code });
  await tx.query('ROLLBACK TO SAVEPOINT us310');
}

/** Heure locale « HH » d'un instant dans le fuseau du pays (oracle : Intl, donnée de test). */
function localHour(iso: string, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso))
    .find((p) => p.type === 'hour')?.value;
  return Number(h);
}
const hh = (n: number): string => `${String(n).padStart(2, '0')}:00`;

describe.each(byCountry)('US-310 — demande d’aide du trip (%s, %s)', (_country, _currency, c) => {
  it('parties : voyageur (GUEST) et titulaire du compte d’hôte (HOST) seulement ; autrui ou trip inconnu : NOT_FOUND sans écriture ; sans session : AUTH_REQUIRED', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const w = await tripOf(
          tx,
          c,
          guest,
          '2035-06-10T15:00:00.000Z',
          '2035-06-13T15:00:00.000Z',
        );
        const other = await tripOf(
          tx,
          c,
          uuid(),
          '2035-06-10T15:00:00.000Z',
          '2035-06-12T15:00:00.000Z',
        );
        const g = await openSession(tx, guest);
        const h = await openSession(tx, w.holder);
        // une personne inscrite sans lien avec le trip : le voyageur d'un autre trip
        const stranger = await openSession(tx, other.holder);

        expect(await first<Row>(tx, CONTEXT, [g.hash, w.trip])).toEqual({
          outcome: 'DONE',
          requester_role: 'GUEST',
          country_code: c.country,
        });
        expect(await first<Row>(tx, CONTEXT, [h.hash, w.trip])).toEqual({
          outcome: 'DONE',
          requester_role: 'HOST',
          country_code: c.country,
        });
        const hidden = { outcome: 'NOT_FOUND', requester_role: null, country_code: null };
        expect(await first<Row>(tx, CONTEXT, [stranger.hash, w.trip])).toEqual(hidden);
        expect(await first<Row>(tx, CONTEXT, [g.hash, uuid()])).toEqual(hidden);
        expect((await first<Row>(tx, CONTEXT, [Buffer.alloc(32), w.trip]))['outcome']).toBe(
          'AUTH_REQUIRED',
        );

        const asGuest = await open(tx, g.hash, w.trip, 'ACCIDENT', null);
        expect(asGuest).toMatchObject({
          outcome: 'OPENED',
          requester_role: 'GUEST',
          country_code: c.country,
        });
        const asHost = await open(tx, h.hash, w.trip, 'HANDOVER', null);
        expect(asHost).toMatchObject({ outcome: 'OPENED', requester_role: 'HOST' });

        // IDOR : même issue pour un trip d'autrui et un trip inconnu ; rien n'est écrit
        const id = uuid();
        const refused = await open(tx, stranger.hash, w.trip, 'OTHER', null, id);
        expect(refused).toEqual({
          outcome: 'NOT_FOUND',
          case_id: null,
          off_hours: null,
          requester_role: null,
          country_code: null,
        });
        expect(await open(tx, g.hash, uuid(), 'OTHER', null)).toEqual(refused);
        expect(await caseOf(tx, id)).toBeUndefined();
        expect((await open(tx, Buffer.alloc(32), w.trip, 'OTHER', null))['outcome']).toBe(
          'AUTH_REQUIRED',
        );

        // dossier : canal IN_APP lié au trip, motif fermé, priorité dérivée du motif, non assigné
        expect(await caseOf(tx, asGuest.case_id!)).toMatchObject({
          requester_user_id: guest,
          country_code: c.country,
          trip_id: w.trip,
          channel: 'IN_APP',
          category: 'SAFETY',
          priority: 'URGENT',
          status: 'OPEN',
          assignee_id: null,
          help_topic: 'ACCIDENT',
          requester_role: 'GUEST',
          off_hours: true,
          first_response_at: null,
          resolved_at: null,
        });
        expect(await caseOf(tx, asHost.case_id!)).toMatchObject({
          requester_user_id: w.holder,
          category: 'TRIP',
          priority: 'HIGH',
          requester_role: 'HOST',
        });
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('rejeu, demande vivante, entrée invalide ; événement minimisé (aucune donnée personnelle hors l’identifiant du destinataire)', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const w = await tripOf(
          tx,
          c,
          guest,
          '2035-06-10T15:00:00.000Z',
          '2035-06-13T15:00:00.000Z',
        );
        const g = await openSession(tx, guest);
        const requestId = uuid();
        const opened = await open(tx, g.hash, w.trip, 'BREAKDOWN', null, requestId);
        expect(opened.outcome).toBe('OPENED');
        // même demande rejouée : DUPLICATE, même dossier
        expect(await open(tx, g.hash, w.trip, 'BREAKDOWN', null, requestId)).toMatchObject({
          outcome: 'DUPLICATE',
          case_id: requestId,
        });
        // même motif, autre identifiant : la demande vivante, aucun second dossier ni événement
        expect(await open(tx, g.hash, w.trip, 'BREAKDOWN', null)).toMatchObject({
          outcome: 'EXISTS',
          case_id: requestId,
        });
        // identifiant déjà pris pour un autre motif : refus
        await rejects(tx, OPEN, [g.hash, requestId, w.trip, 'OTHER', null], '22023');
        // motif hors de la liste fermée ; plages mal formées
        await rejects(tx, OPEN, [g.hash, uuid(), w.trip, 'CALL_ME', null], '22023');
        for (const bad of [
          { from: '8:00', to: '20:00' },
          { from: '20:00', to: '08:00' },
          { from: '08:00', to: '20:00', days: 'ALL' },
          { from: '08:00' },
          ['08:00', '20:00'],
        ]) {
          await rejects(tx, OPEN, [g.hash, uuid(), w.trip, 'OTHER', JSON.stringify(bad)], '22023');
        }

        const events = await eventsOf(tx, requestId);
        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({
          type: 'support.help_request.received',
          aggregate_type: 'support_case',
          country_code: c.country,
          actor_user_id: guest,
          actor_role: 'GUEST',
          payload: {
            case_id: requestId,
            trip_id: w.trip,
            requester_user_id: guest,
            requester_role: 'GUEST',
            topic: 'BREAKDOWN',
            off_hours: true,
            auto_reply: 'GUEST',
          },
        });
        // aucun nom, téléphone ni courriel dans la charge utile
        expect(JSON.stringify(events)).not.toMatch(/Ana|Pérez|María|Gómez|@|\+\d{6,}/);
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('hors plage jugé par la base à son horloge et au fuseau du pays ; plage absente ⇒ toujours hors plage (SUP-020, fail-closed)', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const local = localHour(T0, c.timezone);
        const utc = new Date(T0).getUTCHours();
        // l'heure locale du pays diffère de l'heure UTC (sinon la preuve du fuseau serait vide)
        expect(local).not.toBe(utc);
        const guest = uuid();
        const w = await tripOf(
          tx,
          c,
          guest,
          '2035-06-10T15:00:00.000Z',
          '2035-06-13T15:00:00.000Z',
        );
        await setVirtualNow(tx, T0);
        const g = await openSession(tx, guest);
        const cases: [string, Record<string, string> | null, boolean][] = [
          // plage non publiée : hors plage
          ['ACCIDENT', null, true],
          // plage qui couvre l'heure LOCALE : dans la plage, aucune réponse automatique
          ['BREAKDOWN', { from: hh(local), to: hh(local + 1) }, false],
          // plage qui couvre l'heure UTC mais pas l'heure locale : hors plage
          ['HANDOVER', { from: hh(utc), to: hh(utc + 1) }, true],
          // borne haute exclue : la plage se ferme à l'heure locale pile
          ['SAFETY', { from: hh(local - 1), to: `${hh(local).slice(0, 2)}:30` }, true],
        ];
        for (const [topic, hours, off] of cases) {
          await setVirtualNow(tx, T0);
          const r = await open(tx, g.hash, w.trip, topic, hours);
          expect(r, topic).toMatchObject({ outcome: 'OPENED', off_hours: off });
          const [e] = await eventsOf(tx, r.case_id!);
          expect(e?.['payload'], topic).toMatchObject({
            off_hours: off,
            auto_reply: off ? 'GUEST' : 'NONE',
          });
        }
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('console : liste sans donnée personnelle, prise par la première action (M6 : première réponse), résolution ; autre agent, autre pays et agent concerné refusés', async () => {
    await rolledBack(async (tx) => {
      await installTestProofKey(tx);
      const start = new Date(Date.now() + 5 * DAY).toISOString();
      const end = new Date(Date.now() + 8 * DAY).toISOString();
      const guest = uuid();
      const w = await tripOf(tx, c, guest, start, end);
      const g = await openSession(tx, guest);
      const opened = await open(tx, g.hash, w.trip, 'SAFETY', null);
      expect(opened.outcome).toBe('OPENED');
      const caseId = opened.case_id!;

      const agent = await ops(tx, 'SUPPORT_AGENT', [c.country]);
      const colleague = await ops(tx, 'SUPPORT_AGENT', [c.country]);
      const foreign = await ops(tx, 'SUPPORT_AGENT', [otherOf(c).country]);

      const listed = await first<{ outcome: string; body: Row }>(tx, LIST, [
        agent.hash,
        c.country,
        200,
      ]);
      expect(listed.outcome).toBe('OK');
      const items = listed.body['items'] as Row[];
      const item = items.find((i) => i['caseId'] === caseId);
      expect(item).toMatchObject({
        tripId: w.trip,
        country: c.country,
        topic: 'SAFETY',
        requesterRole: 'GUEST',
        priority: 'URGENT',
        status: 'OPEN',
        offHours: true,
        firstResponseAt: null,
        assigned: false,
        assignedToMe: false,
      });
      // aucune donnée personnelle : ni le demandeur, ni nom, ni téléphone
      expect(Object.keys(item ?? {}).sort()).toEqual(
        [
          'assigned',
          'assignedToMe',
          'caseId',
          'country',
          'createdAt',
          'firstResponseAt',
          'offHours',
          'priority',
          'requesterRole',
          'status',
          'topic',
          'tripId',
        ].sort(),
      );
      expect(JSON.stringify(listed.body)).not.toContain(guest);
      const m6Before = (listed.body['m6'] as Row[]).find((m) => m['country'] === c.country)!;
      expect(listed.body['windowDays']).toBe(28);

      // autre pays : liste refusée pour ce pays, et aucune prise
      expect((await first<Row>(tx, LIST, [foreign.hash, c.country, 50]))['outcome']).toBe(
        'FORBIDDEN',
      );
      expect(
        (await first<Row>(tx, STATUS, [foreign.hash, uuid(), caseId, 'PENDING']))['outcome'],
      ).toBe('FORBIDDEN');

      // première action : l'agent prend la demande ; first_response_at posé par la base
      expect(await first<Row>(tx, STATUS, [agent.hash, uuid(), caseId, 'PENDING'])).toEqual({
        outcome: 'UPDATED',
        body: { caseId, status: 'PENDING' },
      });
      const taken = (await caseOf(tx, caseId))!;
      expect(taken['assignee_id']).toBe(agent.userId);
      expect(taken['status']).toBe('PENDING');
      expect(taken['first_response_at']).toBeInstanceOf(Date);
      expect((taken['first_response_at'] as Date).getTime()).toBeGreaterThanOrEqual(
        (taken['created_at'] as Date).getTime(),
      );
      expect(taken['resolved_at']).toBeNull();
      // prise : un collègue n'agit plus sur une demande assignée à un autre
      expect(
        (await first<Row>(tx, STATUS, [colleague.hash, uuid(), caseId, 'RESOLVED']))['outcome'],
      ).toBe('CASE_REQUIRED');
      // résolution : resolved_at posé ; first_response_at inchangé
      expect(
        (await first<Row>(tx, STATUS, [agent.hash, uuid(), caseId, 'RESOLVED']))['outcome'],
      ).toBe('UPDATED');
      const resolved = (await caseOf(tx, caseId))!;
      expect(resolved['resolved_at']).toBeInstanceOf(Date);
      expect((resolved['first_response_at'] as Date).getTime()).toBe(
        (taken['first_response_at'] as Date).getTime(),
      );

      // M6 : la demande est comptée ouverte et répondue ; elle quitte la liste des vivantes
      const after = await first<{ outcome: string; body: Row }>(tx, LIST, [
        agent.hash,
        c.country,
        200,
      ]);
      const m6After = (after.body['m6'] as Row[]).find((m) => m['country'] === c.country)!;
      expect(Number(m6After['opened'])).toBe(Number(m6Before['opened']));
      expect(Number(m6After['answered'])).toBe(Number(m6Before['answered']) + 1);
      expect(typeof m6After['medianSeconds']).toBe('number');
      expect((after.body['items'] as Row[]).some((i) => i['caseId'] === caseId)).toBe(false);
    });
  });

  it('séparation des tâches (ADR-122) : l’agent qui est le voyageur du trip ne prend pas sa propre demande ; elle reste non assignée', async () => {
    await rolledBack(async (tx) => {
      await installTestProofKey(tx);
      const agent = await staffPerson(tx, c.country, 'SUPPORT_AGENT');
      const start = new Date(Date.now() + 5 * DAY).toISOString();
      const end = new Date(Date.now() + 8 * DAY).toISOString();
      // l'agent est lui-même le voyageur du trip (compte existant gardé par la fixture)
      const w = await tripOf(tx, c, agent.userId, start, end);
      const own = await openSession(tx, agent.userId);
      const opened = await open(tx, own.hash, w.trip, 'OTHER', null);
      expect(opened).toMatchObject({ outcome: 'OPENED', requester_role: 'GUEST' });
      expect(
        (await first<Row>(tx, STATUS, [agent.hash, uuid(), opened.case_id, 'PENDING']))['outcome'],
      ).toBe('SELF_FORBIDDEN');
      expect(await caseOf(tx, opened.case_id!)).toMatchObject({
        status: 'OPEN',
        assignee_id: null,
        first_response_at: null,
      });
    });
  });
});
