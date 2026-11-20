/**
 * US-306 — escalade de non-restitution par l'ops et vue des retards (migration 0173, ADR-193 ;
 * fixture 9912, et 9917 / 9963 / 9650 réutilisées). Rôles de PRODUCTION seulement (assertion
 * L0-05 par `connectAs`), au Panama (USD, America/Panama) et au Paraguay (PYG sans décimale,
 * America/Asuncion) : chaque trip est posé par le parcours nominal (hold → preuve signée →
 * conversion gardée d'US-024), mené IN_PROGRESS par la machine à états d'US-207 puis OVERDUE par la
 * détection d'US-305 (travailleur trip_overdue).
 *
 * Attendus tirés de 19 US-306 (« apparaît en ≤ 1 min avec son étape » ; « l'étape, le motif et les
 * gabarits produits (mise en demeure, plainte pré-remplie à déposer par l'hôte) sont journalisés et
 * l'hôte est informé »), de 16 TRP-038 / ADM-022, de 08 BR-RETURN-04 (T+2 h contact, T+6 h mise en
 * demeure, T+24 h plainte de l'hôte), de 17 §3.2.10 (étapes T30M, T2H, T6H, T24H), §4.5
 * (`trip.overdue.escalated` : trip_id, stage) et §7.2 (`overdue_escalation_hours` = +2 h, +6 h,
 * +24 h, graine 0009), de 22 OQ-BR-17 (aucune récupération ni coupure par la plateforme) et du
 * pré-mortem du lot 3 (L3-PM-17, L3-PM-28), jamais du code testé.
 *
 * Aucun montant n'est attendu : US-306 n'écrit rien d'argent ; la variante PY rejoue les mêmes
 * critères (heures du pays, aucune fuite entre pays).
 *
 * Concurrence : une connexion par client (libérée en fin de test) et une connexion d'observation
 * pour l'attente (`waitUntilBlocked`).
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { connectAs, releaseClient, withTestTransaction } from '../../src/testing/index.ts';
import { at, bookTrip, COUNTRIES, inTx, newSlot } from '../support/avl.ts';
import type { CountryCase, Slot } from '../support/avl.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';
import { newHash } from '../support/golive.ts';
import { createStaff, uuid } from '../support/staff.ts';

type Row = Record<string, unknown>;

/** 17 §7.2 : détection à 30 min ; escalades à +2 h, +6 h, +24 h de la fin prévue (graine 0009). */
const DETECTION_MIN = 30;
const T2H_MIN = 2 * 60;
const T6H_MIN = 6 * 60;
const T24H_MIN = 24 * 60;
const REASON = 'Voyageur injoignable par appel et WhatsApp, hôte prévenu';

const DETECT = 'SELECT core.trip_cmd_detect_overdue($1::uuid) AS r';
const TRANSITION = 'SELECT core.booking_cmd_trip_transition($1, $2, $3, NULL) AS r';
const ACT =
  'SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])';
const BOARD = 'SELECT * FROM core.support_staff_overdue_board($1, $2)';
const HANDLER =
  'SELECT * FROM core.trip_manual_action_escalate_overdue($1, $2, $3, $4, $5::jsonb, $6, $7, $8)';

const T0 = '2037-02-03T12:00:00.000Z';
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

let slotDay = 0;
/** Créneau propre (véhicule neuf), de 10:00 à 10:00 locales deux jours plus tard. */
function freshSlot(c: CountryCase): Slot {
  slotDay += 4;
  const d0 = new Date(Date.parse('2037-03-01T00:00:00.000Z') + slotDay * DAY_MS);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return newSlot(
    localInstant(day(d0), '10:00', c.timezone),
    localInstant(day(new Date(d0.getTime() + 2 * DAY_MS)), '10:00', c.timezone),
  );
}

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

interface Overdue {
  readonly tripId: string;
  readonly slot: Slot;
  readonly holder: string;
}

async function lifecycle(cl: Clients, now: string, trip: string, to: string, reason: string) {
  await inTx(cl.worker, { worker: 'trip_lifecycle', virtualNow: now, commit: true }, (tx) =>
    tx.query(TRANSITION, [trip, to, reason]),
  );
}

async function detect(cl: Clients, trip: string, now: string): Promise<Row> {
  return inTx(cl.worker, { worker: 'trip_overdue', virtualNow: now, commit: true }, async (tx) => {
    const r = await tx.query<{ r: Row }>(DETECT, [trip]);
    return r.rows[0]!.r;
  });
}

async function records(cl: Clients, trip: string): Promise<Row> {
  const r = await cl.worker.query<{ r: Row }>('SELECT test_fixture.us306_records($1) AS r', [trip]);
  return r.rows[0]!.r;
}

/** Trip remis (US-207) puis IN_PROGRESS ; `detect` : passé OVERDUE à fin + 30 min (US-305). */
async function inProgress(cl: Clients, c: CountryCase, detectIt: boolean): Promise<Overdue> {
  const slot = freshSlot(c);
  const { tripId } = await bookTrip(cl.api, cl.worker, slot, c, T0);
  // US-211 (0122) : la remise (IN_PROGRESS) exige le contrat de location signé par le voyageur
  await cl.worker.query('SELECT test_fixture.us211_sign($1)', [tripId]);
  await lifecycle(cl, at(slot.start, -60), tripId, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED');
  await lifecycle(cl, at(slot.start, 5), tripId, 'IN_PROGRESS', 'CHECKIN_VALIDATED');
  if (detectIt) {
    expect(await detect(cl, tripId, at(slot.end, DETECTION_MIN))).toMatchObject({
      outcome: 'DETECTED',
    });
  }
  const holder = (await records(cl, tripId))['holderUserId'] as string;
  return { tripId, slot, holder };
}

interface Staff {
  readonly userId: string;
  readonly countries: readonly string[];
}

async function staffOf(cl: Clients, role: string, countries: readonly string[]): Promise<Staff> {
  const s = await createStaff(cl.api, role, countries, { withFactor: false });
  return { userId: s.userId, countries };
}

/** Session ÉLEVÉE ouverte dans la transaction (heure virtuelle) et contexte STAFF. */
async function staffContext(tx: pg.ClientBase, s: Staff): Promise<Buffer> {
  const hash = newHash();
  await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [s.userId, hash]);
  await setSessionContext(tx, {
    kind: 'STAFF',
    actorId: s.userId,
    countryScope: [...s.countries],
    sessionTokenHash: hash.toString('hex'),
  });
  return hash;
}

interface Outcome {
  readonly outcome: string;
  readonly action_id: string | null;
  readonly domain_ref: string | null;
  readonly detail: string | null;
}

const ACT_ARGS = (hash: Buffer, requestId: string, trip: string, input: Row) => [
  hash,
  requestId,
  'ESCALATE_OVERDUE',
  trip,
  REASON,
  input,
  [],
];

/** `ESCALATE_OVERDUE` lancé par la console à l'instant `now` (VALIDÉ). */
async function escalate(
  cl: Clients,
  s: Staff,
  trip: string,
  now: string,
  input: Row,
  requestId: string = uuid(),
): Promise<Outcome> {
  return withTestTransaction(cl.api, { virtualNow: now, commit: true }, async (tx) => {
    const hash = await staffContext(tx, s);
    const { rows } = await tx.query<Outcome>(ACT, ACT_ARGS(hash, requestId, trip, input));
    return rows[0] ?? { outcome: '', action_id: null, domain_ref: null, detail: null };
  });
}

interface Board {
  readonly outcome: string;
  readonly body: Row | null;
}

/** Vue des retards lue à l'instant `now` (transaction annulée). */
async function board(cl: Clients, s: Staff, now: string): Promise<Board> {
  return withTestTransaction(cl.api, { virtualNow: now }, async (tx) => {
    const hash = await staffContext(tx, s);
    const { rows } = await tx.query<Board>(BOARD, [hash, uuid()]);
    return rows[0] ?? { outcome: '', body: null };
  });
}

const tripsOf = (b: Board): Row[] => (b.body?.['trips'] as Row[] | undefined) ?? [];
const rowOf = (b: Board, trip: string): Row | undefined =>
  tripsOf(b).find((t) => t['tripId'] === trip);
const iso = (v: unknown): string | null =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const other = (c: CountryCase): CountryCase => COUNTRIES.find((x) => x.country !== c.country) ?? c;

describe.each(COUNTRIES)('US-306 — escalade et vue des retards ($country, $currency)', (c) => {
  it('critère 1 : un trip passé OVERDUE figure dans la vue (≤ 1 min) avec son étape ; ops du pays seulement, aucune fuite entre pays ; rôle sans droit refusé et journalisé', async () => {
    await withClients(async (cl) => {
      const ops = await staffOf(cl, 'OPS_AGENT', [c.country]);
      const away = await staffOf(cl, 'OPS_AGENT', [other(c).country]);
      const finance = await staffOf(cl, 'FINANCE', [c.country]);
      const o = await inProgress(cl, c, false);
      const t30 = at(o.slot.end, DETECTION_MIN);

      // avant la détection : IN_PROGRESS, absent de la vue
      let b = await board(cl, ops, t30);
      expect(b.outcome).toBe('OK');
      expect(b.body?.['countries']).toEqual([c.country]);
      expect(rowOf(b, o.tripId)).toBeUndefined();

      // le travailleur (60 s) le passe OVERDUE à 10:30 ; la lecture suivante (≤ 1 min) le montre
      expect(await detect(cl, o.tripId, t30)).toMatchObject({ outcome: 'DETECTED' });
      b = await board(cl, ops, at(t30, 1));
      const row = rowOf(b, o.tripId);
      expect(row).toMatchObject({
        country: c.country,
        status: 'OVERDUE',
        stage: 'T30M',
        lateMinutes: DETECTION_MIN + 1,
        nextStep: 'CONTACT',
        paramMissing: false,
        nextTripAtRisk: false,
        escalations: [],
      });
      expect(iso(row?.['scheduledEnd'])).toBe(o.slot.end);
      expect(iso(row?.['detectedAt'])).toBe(t30);
      expect(iso(row?.['nextStepAt'])).toBe(at(o.slot.end, T2H_MIN));
      // aucune donnée personnelle rendue (identifiants techniques, codes, heures)
      expect(Object.keys(row ?? {}).sort()).toEqual(
        [
          'country',
          'detectedAt',
          'escalations',
          'lateMinutes',
          'nextStep',
          'nextStepAt',
          'nextTripAtRisk',
          'paramMissing',
          'scheduledEnd',
          'stage',
          'status',
          'tripId',
        ].sort(),
      );
      // aucune fuite : l'ops de l'autre pays ne voit que son pays
      const elsewhere = await board(cl, away, at(t30, 1));
      expect(elsewhere.outcome).toBe('OK');
      expect(elsewhere.body?.['countries']).toEqual([other(c).country]);
      expect(rowOf(elsewhere, o.tripId)).toBeUndefined();
      expect(tripsOf(elsewhere).every((t) => t['country'] === other(c).country)).toBe(true);
      // FINANCE ne détient pas ops.force_terminate_trip : refus
      expect((await board(cl, finance, at(t30, 1))).outcome).toBe('FORBIDDEN');
    });
  });

  it('critère 2 : ESCALATE_OVERDUE, une étape à la fois et à son heure (fin + 2 h, + 6 h, + 24 h) ; étape, gabarits, motif, événement à l’hôte ; le trip reste OVERDUE, rien sur le véhicule', async () => {
    await withClients(async (cl) => {
      const ops = await staffOf(cl, 'OPS_AGENT', [c.country]);
      const o = await inProgress(cl, c, true);
      const end = o.slot.end;
      const before = await records(cl, o.tripId);
      expect(before).toMatchObject({ status: 'OVERDUE', stage: 'T30M', escalations: [] });

      // refus, rien n'est écrit : trop tôt (fin + 2 h − 1 min), étape sautée, étape absente
      for (const [now, input, why] of [
        [at(end, T2H_MIN - 1), { escalationStep: 'CONTACT' }, 'OVERDUE_STEP_TOO_EARLY'],
        [at(end, T2H_MIN), { escalationStep: 'FORMAL_NOTICE' }, 'OVERDUE_STEP_OUT_OF_ORDER'],
        [at(end, T2H_MIN), { escalationStep: 'POLICE_REPORT' }, 'OVERDUE_STEP_OUT_OF_ORDER'],
        [at(end, T2H_MIN), {}, 'OVERDUE_STEP_REQUIRED'],
      ] as const) {
        expect(await escalate(cl, ops, o.tripId, now, input), why).toMatchObject({
          outcome: 'REFUSED',
          detail: why,
        });
      }
      expect(await records(cl, o.tripId)).toMatchObject({
        stage: 'T30M',
        escalations: [],
        events: [],
        actions: [],
      });

      // T+2 h : contact (CONTACT_SCRIPT)
      const steps = [
        ['CONTACT', 'T30M', 'T2H', T2H_MIN, ['CONTACT_SCRIPT']],
        ['FORMAL_NOTICE', 'T2H', 'T6H', T6H_MIN, ['DEMAND_LETTER', 'GPS_REQUEST']],
        ['POLICE_REPORT', 'T6H', 'T24H', T24H_MIN, ['POLICE_REPORT_DRAFT']],
      ] as const;
      for (const [n, [step, from, stage, minutes, documents]] of steps.entries()) {
        const due = at(end, minutes);
        if (n > 0) {
          // l'étape suivante est refusée une minute avant son heure
          expect(
            await escalate(cl, ops, o.tripId, at(due, -1), { escalationStep: step }),
          ).toMatchObject({ outcome: 'REFUSED', detail: 'OVERDUE_STEP_TOO_EARLY' });
        }
        const requestId = uuid();
        const done = await escalate(cl, ops, o.tripId, due, { escalationStep: step }, requestId);
        expect(done, step).toMatchObject({ outcome: 'DONE', action_id: requestId });
        const r = await records(cl, o.tripId);
        expect(r).toMatchObject({ status: 'OVERDUE', stage, occupancyActive: true });
        // aucune transition du trip (le passage UNRETURNED est renvoyé à US-318, ADR-193)
        expect(r['transitions']).toBe(before['transitions']);
        const esc = (r['escalations'] as Row[])[n]!;
        expect(esc).toMatchObject({
          id: requestId,
          fromStage: from,
          stage,
          countryCode: c.country,
          documents: [...documents],
        });
        expect(iso(esc['escalatedAt'])).toBe(due);
        expect(iso(esc['dueAt'])).toBe(due);
        // UN événement, attribué à l'agent, à l'hôte (titulaire du compte d'hôte), sans donnée du
        // voyageur
        const events = r['events'] as Row[];
        expect(events).toHaveLength(n + 1);
        const ev = events[n]!;
        expect(ev).toMatchObject({
          id: esc['eventId'],
          countryCode: c.country,
          actorRole: 'OPS_AGENT',
          actorUserId: ops.userId,
          correlationId: requestId,
        });
        const payload = ev['payload'] as Row;
        expect(payload).toMatchObject({
          trip_id: o.tripId,
          stage,
          host_user_id: o.holder,
          documents: [...documents],
        });
        expect(Object.keys(payload).sort()).toEqual(
          ['documents', 'escalated_at', 'host_user_id', 'scheduled_end', 'stage', 'trip_id'].sort(),
        );
        expect(iso(payload['scheduled_end'])).toBe(end);
        expect(iso(payload['escalated_at'])).toBe(due);
        // action de console journalisée : motif, saisie, événement émis, audit rattaché
        const action = (r['actions'] as Row[])[n]!;
        expect(action).toMatchObject({
          id: requestId,
          outcome: 'DONE',
          reason: REASON,
          input: { escalationStep: step },
          countryCode: c.country,
          actorUserId: ops.userId,
          actorRole: 'OPS_AGENT',
          emittedEventIds: [esc['eventId']],
          audited: true,
        });
        // même requête rejouée : DUPLICATE (console) ; même étape par une requête neuve : refus
        expect(
          await escalate(cl, ops, o.tripId, at(due, 1), { escalationStep: step }, requestId),
        ).toMatchObject({ outcome: 'DUPLICATE', detail: 'DONE' });
        expect(
          await escalate(cl, ops, o.tripId, at(due, 1), { escalationStep: step }),
        ).toMatchObject({ outcome: 'REFUSED', detail: 'OVERDUE_STEP_OUT_OF_ORDER' });
        expect((await records(cl, o.tripId))['escalations']).toHaveLength(n + 1);
      }

      // T24H atteinte : plus aucune étape ; la vue la montre, la prolongation tacite continue
      const b = await board(cl, ops, at(end, T24H_MIN + 1));
      const row = rowOf(b, o.tripId);
      expect(row).toMatchObject({ stage: 'T24H', nextStep: null, nextStepAt: null });
      expect((row?.['escalations'] as Row[]).map((e) => e['stage'])).toEqual([
        'T2H',
        'T6H',
        'T24H',
      ]);
      expect(await detect(cl, o.tripId, at(end, T24H_MIN + 1))).toMatchObject({
        outcome: 'EXTENDED',
        status: 'OVERDUE',
      });
      expect(await records(cl, o.tripId)).toMatchObject({ stage: 'T24H', occupancyActive: true });
    });
  });

  it('critère 2 : deux agents, deux connexions, la même étape au même instant ⇒ le second attend les verrous puis est refusé ; une escalade, un événement', async () => {
    await withClients(async (cl) => {
      const first = await staffOf(cl, 'OPS_AGENT', [c.country]);
      const second = await staffOf(cl, 'OPS_AGENT', [c.country]);
      const o = await inProgress(cl, c, true);
      const due = at(o.slot.end, T2H_MIN);
      const a = await connectAs('app_api');
      const b = await connectAs('app_api');
      const observer = await connectAs('app_api');
      try {
        const open = async (client: pg.Client, s: Staff) => {
          await client.query('BEGIN');
          await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [due]);
          // filet : aucune attente de verrou ni instruction au-delà de 15 s (un échec du test ne peut
          // jamais garder les verrous du voyageur, du véhicule ni la tête de l'audit chaîné)
          await client.query(
            `SELECT pg_catalog.set_config('lock_timeout', '15s', true),
                    pg_catalog.set_config('statement_timeout', '15s', true)`,
          );
          return staffContext(client, s);
        };
        const ha = await open(a, first);
        const hb = await open(b, second);
        // pid lu AVANT la requête concurrente : une fois lancée, la connexion b est occupée
        const pidB = await backendPid(b);
        const ra = await a.query<Outcome>(
          ACT,
          ACT_ARGS(ha, uuid(), o.tripId, { escalationStep: 'CONTACT' }),
        );
        expect(ra.rows[0]).toMatchObject({ outcome: 'DONE' });
        const pending = b.query<Outcome>(
          ACT,
          ACT_ARGS(hb, uuid(), o.tripId, { escalationStep: 'CONTACT' }),
        );
        await waitUntilBlocked(observer, pidB);
        await a.query('COMMIT');
        expect((await pending).rows[0]).toMatchObject({
          outcome: 'REFUSED',
          detail: 'OVERDUE_STEP_OUT_OF_ORDER',
        });
        await b.query('COMMIT');
      } finally {
        await a.query('ROLLBACK').catch(() => undefined);
        await b.query('ROLLBACK').catch(() => undefined);
        await releaseClient(observer);
        await releaseClient(b);
        await releaseClient(a);
      }
      const r = await records(cl, o.tripId);
      expect(r).toMatchObject({ stage: 'T2H' });
      expect(r['escalations']).toHaveLength(1);
      expect(r['events']).toHaveLength(1);
      expect(r['actions']).toHaveLength(1);
    });
  });
});

describe('US-306 — droits, portée pays et écritures directes', () => {
  it('ops d’un autre pays et FINANCE refusés par la console ; commande liée et lignes inaccessibles aux rôles applicatifs ; étape jamais reculée, sautée ni avancée hors de la console ; escalade inaltérable', async () => {
    const c = COUNTRIES[0];
    await withClients(async (cl) => {
      const away = await staffOf(cl, 'OPS_AGENT', [other(c).country]);
      const finance = await staffOf(cl, 'FINANCE', [c.country]);
      const ops = await staffOf(cl, 'OPS_AGENT', [c.country]);
      const o = await inProgress(cl, c, true);
      const due = at(o.slot.end, T2H_MIN);
      for (const s of [away, finance]) {
        expect(await escalate(cl, s, o.tripId, due, { escalationStep: 'CONTACT' })).toMatchObject({
          outcome: 'FORBIDDEN',
        });
      }
      // saisie hors de l'énumération fermée : refus de la console (22023), rien n'est écrit
      await expect(
        escalate(cl, ops, o.tripId, due, { escalationStep: 'T2H' }),
      ).rejects.toMatchObject({ code: '22023' });
      await expect(
        escalate(cl, ops, o.tripId, due, { escalationStep: 'CONTACT', amount: 'x' }),
      ).rejects.toMatchObject({ code: '22023' });
      // trip qui n'est pas en retard : refus
      const live = await inProgress(cl, c, false);
      expect(
        await escalate(cl, ops, live.tripId, at(live.slot.end, T2H_MIN), {
          escalationStep: 'CONTACT',
        }),
      ).toMatchObject({ outcome: 'REFUSED', detail: 'TRIP_NOT_OVERDUE' });
      expect(await records(cl, o.tripId)).toMatchObject({ stage: 'T30M', escalations: [] });

      // commande liée, lignes et vue interne : aucun rôle applicatif
      const anon = await connectAs('app_anon');
      try {
        for (const client of [cl.api, cl.worker, anon]) {
          for (const sql of [
            'SELECT 1 FROM core.trip_ops_overdue_escalation LIMIT 1',
            'SELECT 1 FROM core.trip_ops_overdue_case LIMIT 1',
            "SELECT core.trip_overdue_board(ARRAY['ZZ'])",
          ]) {
            await expect(client.query(sql), sql).rejects.toMatchObject({ code: '42501' });
          }
          await expect(
            client.query(HANDLER, [
              Buffer.alloc(32),
              uuid(),
              'ESCALATE_OVERDUE',
              o.tripId,
              { escalationStep: 'CONTACT' },
              REASON,
              ops.userId,
              'OPS_AGENT',
            ]),
          ).rejects.toMatchObject({ code: '42501' });
        }
        for (const client of [cl.worker, anon]) {
          await expect(client.query(BOARD, [Buffer.alloc(32), uuid()])).rejects.toMatchObject({
            code: '42501',
          });
        }
      } finally {
        await releaseClient(anon);
      }

      // cmd_hold_owner lui-même (sondes de 9912) : hors contexte STAFF, l'étape ne bouge pas
      await expect(
        inTx(cl.worker, { worker: 'trip_overdue', virtualNow: due }, (tx) =>
          tx.query('SELECT test_fixture.us306_stage_probe($1, $2)', [o.tripId, 'T2H']),
        ),
      ).rejects.toMatchObject({ code: '23000', constraint: 'trip_overdue_case_immutable' });
      // contexte STAFF : étape sautée (garde) ou reculée (politique) refusée
      await expect(
        withTestTransaction(cl.api, { virtualNow: due }, async (tx) => {
          await staffContext(tx, ops);
          return tx.query('SELECT test_fixture.us306_stage_probe($1, $2)', [o.tripId, 'T6H']);
        }),
      ).rejects.toMatchObject({ code: '23000', constraint: 'trip_overdue_case_immutable' });
      expect(await escalate(cl, ops, o.tripId, due, { escalationStep: 'CONTACT' })).toMatchObject({
        outcome: 'DONE',
      });
      await expect(
        withTestTransaction(cl.api, { virtualNow: due }, async (tx) => {
          await staffContext(tx, ops);
          return tx.query('SELECT test_fixture.us306_stage_probe($1, $2)', [o.tripId, 'T30M']);
        }),
      ).rejects.toMatchObject({ code: '42501' });
      // escalade : ni réécrite ni supprimée (aucun droit, garde en défense)
      for (const op of ['UPDATE', 'DELETE']) {
        await expect(
          withTestTransaction(cl.api, { virtualNow: due }, async (tx) => {
            await staffContext(tx, ops);
            return tx.query('SELECT test_fixture.us306_escalation_probe($1, $2)', [o.tripId, op]);
          }),
          op,
        ).rejects.toMatchObject({ code: '42501' });
      }
      expect(await records(cl, o.tripId)).toMatchObject({ stage: 'T2H' });
    });
  });
});
