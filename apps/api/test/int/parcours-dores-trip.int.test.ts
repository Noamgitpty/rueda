/**
 * US-312 — parcours dorés « trip complet » (prolonge US-221), sur PostgreSQL réel, sous les rôles
 * de PRODUCTION (`connectAs` : assertion L0-05 en tête de chaque test), dans chaque pays configuré :
 * USD (deux décimales) et PYG (sans décimale). Écrits par l'agent QA depuis 19 US-312, 08 et les
 * oracles, sans prendre le code testé comme oracle : chaque montant attendu vient de l'export des
 * oracles (`docs/specs/tools/golden_vectors.json`, `@rueda/money/golden-vectors`), d'une sortie de
 * `docs/specs/tools/check_legs.py` (`python -I -X utf8`, recopiée et citée là où l'export n'a pas
 * de vecteur PYG) ou des paramètres de test de 08 (`HOST_PENALTY[pays]`, BR-PAYOUT, ADR-185).
 *
 * Six variantes par devise (critère 1 de 19 US-312), chacune sur ses propres objets :
 *
 * 1. Trip normal — remise et retour (transaction ANNULÉE sous app_api : `insurer_contract_active`
 *    ne s'ouvre que là, par la VRAIE procédure à deux personnes d'US-125) : message de l'hôte
 *    (vraie commande de MSG) → ouverture de la remise → photos de départ des deux parties →
 *    contrôle du permis (hôte) → validation des deux parties ⇒ IN_PROGRESS à l'heure serveur →
 *    photos de retour → validation des deux parties ⇒ RETURNED, occupations libérées, clés
 *    rendues → avis en double aveugle publiés à la seconde soumission → dossier de preuve scellé
 *    par l'ops (US-308). Interrupteurs fermés après l'annulation.
 * 2. Trip normal — argent (transaction ANNULÉE sous app_worker `payment_command`) : capture par
 *    jambe (TJ01 / TJ08a) → trip terminé (fin effective) → préparation du versement : lot
 *    ON_HOLD `PAYOUTS_DISABLED`, J+5 ouvrés du pays à 10:00 locale (premier versement), montant =
 *    jambe HOST, `host_ledger` vide ; puis CHARGEBACK : HOST et INSURER gelées, lot ON_HOLD
 *    `CHARGEBACK` (versement retenu en litige) ; chargeback perdu ⇒ imputation TJ14b (trip
 *    réalisé, aucun versement émis ⇒ aucune reprise sur l'hôte), jambes dégelées, `host_ledger`
 *    vide, lot toujours retenu par l'interrupteur.
 * 3. Retard (données VALIDÉES) : trip en cours → fin + 29 min : rien → fin + 30 min : OVERDUE,
 *    `trip.overdue.detected` une fois, routé vers EVT_TRIP_OVERDUE (voyageur et hôte) → retour
 *    par les vraies commandes de la remise ⇒ RETURNED ; détection rejouée ⇒ SKIPPED.
 * 4. No-show du voyageur déclaré par l'hôte (T05 / T41), message de l'hôte tracé : VRAI
 *    `TripCancellationProcessor` ⇒ variation TJ04b (USD) ou `capture_and(D, NO_SHOW, 2)` (PYG),
 *    ordre REFUND = −variation, `host_ledger` vide, NO_SHOW_GUEST, aucun lot de versement.
 * 5. Refus du véhicule au départ (propreté, console) : remboursement intégral (TJ06 / FULL de D),
 *    pénalité `cleanliness` au `host_ledger` (08 : 5 000 cents / 400 000 PYG), REFUSED_AT_PICKUP.
 * 6. Annulations tardives : du voyageur à T−10 h (T03 / T27 : TJ02b / TJ08b ; notification
 *    EVT_BOOKING_CANCELLED PRODUITE pour les deux parties : la vraie ligne d'outbox passe par le
 *    vrai répartiteur de NTF, `ntf_notification_dispatch` relu) et de l'hôte (T15 à T−24 h pile /
 *    D à T−10 h : remboursement intégral, pénalité `cxlLate` au `host_ledger`).
 *
 * Coutures assumées (passation US-312) : la remise exige `insurer_contract_active`, ouvert
 * seulement en transaction annulée sous app_api ; le versement et le chargeback sont des commandes
 * d'app_worker : le trip de la variante 2 est terminé par la fixture 9921 (`us708_complete_trip`,
 * même ligne RETURNED que la remise) ; le trip de la variante 3 est mis en cours par la fixture
 * 9997 (le départ réel exige l'interrupteur).
 *
 * ÉCARTS CONNUS (passation US-312 ; `docs/qa/STRATEGIE_TESTS.md` §5) — chaque assertion qui fige
 * le comportement actuel porte « ÉCART CONNU n° X → suite » :
 * - n° 1 : gains d'annulation de l'hôte jamais mis en lot (`payout_cmd_prepare_trip` ⇒
 *   NOT_COMPLETED après no-show, refus, annulation ; aucun lot `CXL_EARNINGS`, renvoi d'US-709) ;
 * - n° 2 : `payout.batch.status_changed` jamais émis ⇒ EVT_PAYOUT_ON_HOLD jamais reçu (US-708) ;
 * - n° 3 : no-show et refus réglés sans notification (EVT_NO_SHOW_DECLARED, EVT_VEHICLE_REFUSED
 *   absents, suites d'ADR-191) ;
 * - n° 4 : retard sans frais (aucun débit MIT `DELAYED_CHARGES` produit, renvoi d'US-305 à US-703).
 * Les n° 2 et 3 sont des `it.fails` : ils passent au vert le jour où la suite est livrée et doivent
 * alors devenir des tests ordinaires ; chacun a une garde (état de sa variante absent ⇒ la fonction
 * rend sans erreur ⇒ `it.fails` ROUGE), jamais vert pour une mauvaise raison.
 *
 * `support/fake-account.ts` (`onlyFakeActive` / `onFakeAccount`) n'est pas utilisé : il protège
 * T1 (`booking_cmd_checkout_pay`), qui retient le PREMIER compte ACTIVE du pays et peut tomber sur
 * un compte BAC ou EBANX ouvert un instant par un autre fichier (constat C-1 d'US-221). Ce fichier
 * n'appelle jamais T1 : chaque capture est enregistrée directement sur le compte FAKE partagé
 * (`us024_psp_account`, fixture 9800), et le processeur, l'ordonnanceur des remboursements et la
 * préparation du versement relisent le compte de la capture, pas « le premier compte actif ».
 *
 * Horloges virtuelles : années 2081 à 2086 (une par variante ; 6a et 6b partagent 2085, à 10 jours
 * d'écart), décalées de 30 jours par pays ; aucune autre série de la base ne les utilise. Aucun
 * compte global : chaque lecture est bornée au trip, au lot ou à l'opération du test ; les
 * événements d'un agrégat sont ordonnés par version d'agrégat, heure, puis identifiant.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SubjectKeyStore } from '@rueda/db/audit';
import { FakeKeyWrapper } from '@rueda/db/testing';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import { legVector, settlementVector } from '@rueda/money/golden-vectors';
import { toTrip } from '@rueda/money/testing';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import type {
  AlertChannel,
  DomainEvent,
  JsonObject,
  OpsAlert,
  WorkerTransactions,
} from '../../src/modules/bus/index.js';
import { postgresNotificationParties } from '../../src/modules/avl/index.js';
import { dispatchEvent, RULES } from '../../src/modules/ntf/index.js';
import { TripCancellationProcessor, type CancellationFacts } from '../../src/modules/stl/index.js';
import { countryCases } from '../support/countries.js';
import { openSwitch } from '../support/go-live.js';
import {
  ALL_CLOSED,
  DAY,
  LEGS,
  MINUTE,
  asStaff,
  asWorker,
  golden,
  inTx,
  iso,
  legsOf,
  negate,
  open,
  recordOperation,
  signedStatus,
  sqlOf,
  staffMember,
  sum,
  switches,
  type Json,
  type LegName,
  type Legs,
} from '../support/redteam-l2.js';

const legs = (HOST: bigint, INSURER: bigint, TAX_THIRD_PARTY: bigint, PLATFORM: bigint): Legs => ({
  HOST,
  INSURER,
  TAX_THIRD_PARTY,
  PLATFORM,
});
const ZERO = legs(0n, 0n, 0n, 0n);
const legsMap = (rows: readonly { leg: string; v: string }[]): Legs => {
  const out: Legs = { ...ZERO };
  for (const r of rows) out[r.leg as LegName] = BigInt(r.v);
  return out;
};

/**
 * Attendus par devise (jamais par pays : le pays est celui que la configuration associe à la
 * devise, ADR-024). Trip A de 08 en USD, trip D en PYG.
 *
 * PYG sans vecteur de l'export : sorties de `check_legs.py` (`python -I -X utf8`, 2026-11-22,
 * `capture_and("X", D, kind, j, eligible)`) :
 * - D NO_SHOW j = 2, hôte éligible : variation [-268 750, -105 000, 0, -213 933], remboursement
 *   587 683 (= T41.guestRefundMinor de l'export) ;
 * - D FULL : variation [-787 500, -105 000, 0, -545 550] = −TJ08a, remboursement 1 438 050.
 * Pénalités de l'hôte : 08 §E2 `HOST_PENALTY[pays]` en unités mineures — USD cleanliness 5 000,
 * cxlLate 5 000 (= T15.hostPenaltyMinor) ; PYG cleanliness 400 000, cxlLate 400 000 (PROPOSÉ).
 * Chargeback perdu d'un trip réalisé sans versement émis : TJ14b (USD) ; PYG par la même méthode
 * (08 E7 règle 7, N-402) : toute la perte sur PLATFORM, −total payé.
 */
interface Expectations {
  readonly capture: string;
  readonly noShow: { readonly vector: string; readonly variation: Legs };
  readonly refusal: { readonly vector: string; readonly variation: Legs; readonly penalty: bigint };
  readonly guestLate: { readonly vector: string; readonly variation: Legs };
  readonly hostLate: {
    readonly vector: string;
    readonly requestedAtMinutes: number;
    readonly variation: Legs;
    readonly penalty: bigint;
  };
  readonly chargebackLost: Legs;
}
const EXPECT: readonly Expectations[] = [
  {
    capture: 'TJ01',
    noShow: { vector: 'T05', variation: legsOf('TJ04b') },
    refusal: { vector: 'T14', variation: legsOf('TJ06'), penalty: 5000n },
    guestLate: { vector: 'T03', variation: legsOf('TJ02b') },
    hostLate: {
      vector: 'T15',
      requestedAtMinutes: -1440,
      variation: legsOf('TJ06'),
      penalty: settlementVector(golden, 'T15').expected.hostPenaltyMinor,
    },
    chargebackLost: legsOf('TJ14b'),
  },
  {
    capture: 'TJ08a',
    noShow: { vector: 'T41', variation: legs(-268_750n, -105_000n, 0n, -213_933n) },
    refusal: { vector: 'T48', variation: negate(legsOf('TJ08a')), penalty: 400_000n },
    guestLate: { vector: 'T27', variation: legsOf('TJ08b') },
    hostLate: {
      vector: 'T48',
      requestedAtMinutes: -600,
      variation: negate(legsOf('TJ08a')),
      penalty: 400_000n,
    },
    chargebackLost: legs(0n, 0n, 0n, -sum(legsOf('TJ08a'))),
  },
];

/** Fuseau du pays, lu dans les données de configuration (comme `countryCases`). */
const TIME_ZONES = new Map(
  (
    JSON.parse(
      readFileSync(new URL('../../src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
    ) as { countries: { code: string; timeZone: string }[] }
  ).countries.map((c) => [c.code, c.timeZone]),
);

const CASES = countryCases().map((c, index) => {
  // devise de chaque jeu d'attendus = devise de son vecteur de capture (export des oracles)
  const e = EXPECT.find((x) => legVector(golden, x.capture).currency === c.currency);
  if (e === undefined) throw new Error(`aucun attendu en ${c.currency}`);
  const timeZone = TIME_ZONES.get(c.country);
  if (timeZone === undefined) throw new Error(`fuseau absent : ${c.country}`);
  return {
    country: c.country,
    currency: c.currency,
    amountMinor: c.amountMinor,
    index,
    timeZone,
    e,
  };
});
type Case = (typeof CASES)[number];

/** Instant de base d'une variante (année propre) décalé de 30 jours par pays. */
const base = (year: number, c: Case): number => Date.UTC(year, 2, 1, 15, 0, 0) + c.index * 30 * DAY;

// --- aides ---------------------------------------------------------------------------------------

/** Session de 14 jours ouverte par la VRAIE commande, à l'instant virtuel de la transaction. */
async function session(tx: pg.ClientBase, userId: string): Promise<Buffer> {
  const hash = createHash('sha256').update(randomBytes(32)).digest();
  const s = await tx.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, 1209600, 'NONE', NULL, 'vitest') AS expires_at`,
    [randomUUID(), userId, hash],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  return hash;
}
async function at(tx: pg.ClientBase, ms: number): Promise<void> {
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso(ms)]);
}
async function actor(tx: pg.ClientBase, kind: 'GUEST' | 'HOST' | 'STAFF', id: string) {
  await tx.query(
    `SELECT pg_catalog.set_config('app.actor_kind', $1, true),
            pg_catalog.set_config('app.actor_id', $2, true),
            pg_catalog.set_config('app.worker_name', '', true)`,
    [kind, id],
  );
}

const keys = new SubjectKeyStore(new FakeKeyWrapper());
/** Clé USER de la personne (dépôt chiffré des photos, US-303 ; archive du dossier, US-308). */
async function subjectKey(
  tx: pg.ClientBase,
  kind: 'GUEST' | 'HOST' | 'STAFF',
  id: string,
): Promise<void> {
  await actor(tx, kind, id);
  const k = await keys.dekFor(tx, { type: 'USER', id }, 'create');
  if (k.status !== 'OK') throw new Error(`clé du sujet : ${k.status}`);
}

/** 17 §3.2.10 : gabarit minimal de la série de photos (16 TRP-004). */
const SLOTS = [
  ...Array.from({ length: 15 }, (_, i) => `EXT_${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, i) => `INT_${String(i + 1).padStart(2, '0')}`),
  'FUEL',
  'ODOMETER',
];
/** Série complète d'une partie par les VRAIES commandes d'US-303, puis soumission. */
async function series(
  tx: pg.ClientBase,
  who: Buffer,
  trip: string,
  kind: 'CHECKIN' | 'CHECKOUT',
): Promise<void> {
  for (const slot of SLOTS) {
    const cap = (
      await tx.query<Json>('SELECT * FROM core.trip_cmd_open_photo_capture($1, $2::uuid, $3, $4)', [
        who,
        trip,
        kind,
        slot,
      ])
    ).rows[0]!;
    expect(cap['outcome'], slot).toBe('DONE');
    const body = randomBytes(64);
    const r = (
      await tx.query<Json>(
        `SELECT * FROM core.trip_cmd_add_inspection_photo($1, $2::uuid, $3, $4::uuid, $5, $6::uuid,
                                                          $7, $8::bigint, $9, $10::timestamptz)`,
        [
          who,
          trip,
          kind,
          cap['capture_id'],
          slot,
          randomUUID(),
          'image/jpeg',
          body.length,
          createHash('sha256').update(body).digest(),
          null,
        ],
      )
    ).rows[0]!;
    expect(r['outcome'], slot).toBe('DONE');
  }
  const s = await tx.query<Json>(
    'SELECT * FROM core.trip_cmd_submit_inspection($1, $2::uuid, $3)',
    [who, trip, kind],
  );
  expect(s.rows[0]?.['outcome']).toBe('DONE');
}
const VALIDATE =
  'SELECT * FROM core.trip_cmd_validate_handover($1, $2::uuid, $3, $4::integer, $5::integer, $6)';
async function validate(
  tx: pg.ClientBase,
  who: Buffer,
  trip: string,
  kind: 'CHECKIN' | 'CHECKOUT',
  odometer: number,
  fuel: number,
): Promise<Json> {
  return (await tx.query<Json>(VALIDATE, [who, trip, kind, odometer, fuel, 'IN_PERSON'])).rows[0]!;
}
const isoOf = (v: unknown): string | null =>
  v instanceof Date
    ? v.toISOString()
    : typeof v === 'string' && Number.isFinite(Date.parse(v))
      ? new Date(v).toISOString()
      : null;

/** Trip BOOKED de la fixture 9948 (voyageur et hôte réels, annonce, devis figé, occupations). */
async function bookedTrip(
  tx: pg.ClientBase,
  c: Case,
  startMs: number,
  endMs: number,
): Promise<{ trip: string; guest: string; holder: string; amount: string }> {
  const guest = randomUUID();
  const amount = c.amountMinor; // 120 unités de la devise (countryCases)
  const { rows } = await tx.query<{ trip_id: string; holder_id: string }>(
    `SELECT * FROM test_fixture.us214_trip($1, $2, 'Ana', 'Pérez', 'María', 'Gómez', $3, $4,
                                           $5::jsonb)`,
    [
      c.country,
      guest,
      iso(startMs),
      iso(endMs),
      JSON.stringify([{ type: 'TRIP_PRICE', amountMinor: amount }]),
    ],
  );
  return { trip: rows[0]!.trip_id, guest, holder: rows[0]!.holder_id, amount };
}

/** Transactions du travailleur (app_worker), VALIDÉES, à l'instant virtuel `atMs`. */
function committing(atMs: number): WorkerTransactions {
  return {
    async run(worker, fn) {
      const client = await open('app_worker');
      return inTx(client, { at: iso(atMs), worker, commit: true }, (tx) => fn(sqlOf(tx)));
    },
  };
}
class Alerts implements AlertChannel {
  readonly sent: OpsAlert[] = [];
  send(alert: OpsAlert): Promise<void> {
    this.sent.push(alert);
    return Promise.resolve();
  }
}

/**
 * Étapes nommées d'une longue transaction : un échec est rapporté avec le nom de l'étape en cours
 * (« variante 1, étape « retour » : … »), sans couper la transaction (une seule transaction annulée
 * porte l'interrupteur de l'assureur de bout en bout).
 */
async function phased<T>(
  label: string,
  fn: (step: (name: string) => void) => Promise<T>,
): Promise<T> {
  let phase = 'mise en place';
  try {
    return await fn((name) => {
      phase = name;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}, étape « ${phase} » : ${message}`, { cause: error });
  }
}

/** Le trip est sorti vers `to` par UNE transition, la dernière (ordre : version d'agrégat). */
function expectFinal(statuses: readonly string[], to: string): void {
  expect(statuses.filter((x) => x === to)).toHaveLength(1);
  expect(statuses[statuses.length - 1]).toBe(to);
}

/** Règles du catalogue de NTF qui reçoivent cet événement : gabarit et destinataires. */
function routed(type: string, payload: Json): { template: string; recipients: string[] }[] {
  return RULES.filter(
    (r) =>
      r.eventType === type &&
      (r.condition === undefined || r.condition.matches(String(payload[r.condition.field] ?? ''))),
  ).map((r) => ({ template: r.template, recipients: r.recipients.map((x) => x.role) }));
}

/** Événements d'outbox de l'agrégat (lecture du relais, transaction annulée). */
async function events(aggregate: string): Promise<{ type: string; payload: Json }[]> {
  const client = await open('app_worker');
  return inTx(
    client,
    { worker: 'outbox_relay' },
    async (tx) =>
      (
        await tx.query<{ type: string; payload: Json }>(
          `SELECT type, payload FROM core.outbox_outbox_event
            WHERE aggregate_id = $1::uuid ORDER BY aggregate_version, occurred_at, id`,
          [aggregate],
        )
      ).rows,
  );
}

/**
 * Notification PRODUITE, pas seulement routée en mémoire : la vraie ligne d'outbox du changement
 * d'état vers `to` passe par le vrai répartiteur de NTF (`dispatchEvent`, parties lues en base par
 * l'adaptateur d'AVL) sous `ntf_dispatcher`, puis les envois planifiés de CET événement sont relus
 * sous `ntf_sender`. Transaction ANNULÉE : rien n'est écrit.
 */
async function produced(
  trip: string,
  to: string,
): Promise<{ role: string; uid: string; template: string }[]> {
  const client = await open('app_worker');
  return inTx(client, { worker: 'outbox_relay' }, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      type: string;
      schema_version: number;
      aggregate_type: string;
      aggregate_id: string;
      aggregate_version: string;
      country_code: string | null;
      actor_user_id: string | null;
      actor_role: string;
      correlation_id: string;
      causation_id: string | null;
      payload: JsonObject;
      partition_key: string | null;
      occurred_at: Date;
    }>(
      `SELECT id::text, type, schema_version, aggregate_type, aggregate_id::text,
              aggregate_version::text, country_code, actor_user_id::text, actor_role,
              correlation_id::text, causation_id::text, payload, partition_key, occurred_at
         FROM core.outbox_outbox_event
        WHERE aggregate_id = $1::uuid AND type = 'trip.status_changed' AND payload ->> 'to' = $2`,
      [trip, to],
    );
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    const event: DomainEvent = {
      eventId: r.id,
      type: r.type,
      schemaVersion: r.schema_version,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      aggregateVersion: BigInt(r.aggregate_version),
      countryCode: r.country_code,
      actor: r.actor_user_id === null ? 'SYSTEM' : { userId: r.actor_user_id, role: r.actor_role },
      correlationId: r.correlation_id,
      causationId: r.causation_id,
      payload: r.payload,
      partitionKey: r.partition_key,
      occurredAt: r.occurred_at.toISOString(),
    };
    await asWorker(tx, 'ntf_dispatcher');
    await dispatchEvent(event, sqlOf(tx), RULES, postgresNotificationParties);
    await asWorker(tx, 'ntf_sender');
    return (
      await tx.query<{ role: string; uid: string; template: string }>(
        `SELECT DISTINCT recipient_role AS role, recipient_user_id::text AS uid,
                template_key AS template
           FROM core.ntf_notification_dispatch WHERE event_id = $1::uuid
          ORDER BY 1, 2, 3`,
        [r.id],
      )
    ).rows;
  });
}

/** Lecture sous un travailleur (transaction annulée). */
async function read<R extends pg.QueryResultRow>(
  worker: string,
  sql: string,
  params: unknown[],
): Promise<R[]> {
  const client = await open('app_worker');
  return inTx(client, { worker }, async (tx) => (await tx.query<R>(sql, params)).rows);
}

// --- trips capturés (données VALIDÉES) pour les variantes réglées par le processeur --------------

interface CapturedWorld {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
  readonly capture: string;
  readonly startMs: number;
}
/**
 * Trip neuf de la fixture 9300, capturé aux jambes de l'oracle (vraie commande, webhook signé,
 * report sur les soldes), remise ouverte si demandé (un no-show ou un refus ne se déclare qu'en
 * CHECKIN_OPEN). VALIDÉ.
 */
async function capturedWorld(
  c: Case,
  vector: string,
  startMs: number,
  checkinOpen: boolean,
): Promise<CapturedWorld> {
  const v = settlementVector(golden, vector);
  const capture = legsOf(c.e.capture);
  expect(sum(capture)).toBe(v.trip.totalPaidMinor);
  const trip = randomUUID();
  const guest = randomUUID();
  const worker = await open('app_worker');
  const bookedAt = startMs + v.trip.bookedAtMinutes * MINUTE;
  const op = await inTx(
    worker,
    { worker: 'payment_command', at: iso(bookedAt), commit: true },
    async (tx) => {
      await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, 'UTC', $7, $8)`, [
        trip,
        guest,
        randomUUID(),
        randomUUID(),
        c.country,
        c.currency,
        iso(startMs),
        iso(startMs + v.trip.days * DAY),
      ]);
      const account = (
        await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
          c.country,
        ])
      ).rows[0]!.id;
      const r = await recordOperation(tx, {
        tripId: trip,
        accountId: account,
        amountMinor: sum(capture),
        currency: c.currency,
        legs: capture,
      });
      expect(await signedStatus(tx, r.operation_id, 'SUCCEEDED')).toBe('APPLIED');
      const moved = await tx.query<{ r: string }>(
        'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
        [r.operation_id],
      );
      expect(moved.rows[0]?.r).toBe('APPLIED');
      if (checkinOpen) {
        await asWorker(tx, 'trip_lifecycle');
        await tx.query(
          `SELECT core.booking_cmd_trip_transition($1, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED',
                                                   NULL)`,
          [trip],
        );
      }
      return r.operation_id;
    },
  );
  const holder = await inTx(
    worker,
    {},
    async (tx) =>
      (await tx.query<{ id: string }>('SELECT test_fixture.us307_holder($1) AS id', [trip]))
        .rows[0]!.id,
  );
  return { trip, guest, holder, capture: op, startMs };
}

/** Demande de la console d'un agent OPS du pays (session élevée), à l'instant `atMs`. */
async function opsAction(
  c: Case,
  trip: string,
  action: string,
  input: Json,
  atMs: number,
): Promise<string> {
  const api = await open('app_api');
  const ops = await inTx(api, { commit: true }, (tx) => staffMember(tx, 'OPS_AGENT', c.country));
  return inTx(api, { at: iso(atMs), commit: true }, async (tx) => {
    const s = await asStaff(tx, ops, c.country);
    const { rows } = await tx.query<{ outcome: string; domain_ref: string | null }>(
      `SELECT outcome, domain_ref
         FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, '{}'::uuid[])`,
      [s.hash, randomUUID(), action, trip, 'Parcours doré US-312, demande de test', input],
    );
    expect(rows[0]?.outcome).toBe('DONE');
    return String(rows[0]?.domain_ref);
  });
}

/** Vrai processeur de production, trip du moteur = trip du vecteur aux instants de la base. */
function processor(vector: string, atMs: number, alerts: Alerts): TripCancellationProcessor {
  return new TripCancellationProcessor({
    transactions: committing(atMs),
    alerts,
    tripOf: (f: CancellationFacts): ReturnType<typeof toTrip> => ({
      ...toTrip(settlementVector(golden, vector).trip),
      startAtMs: f.startAtMs,
      bookedAtMs: f.bookedAtMs,
    }),
  });
}

interface Settled {
  readonly status: string;
  readonly costBearer: string;
  readonly variation: Legs;
  readonly refund: Legs;
  readonly ledger: { reason: string; amount: bigint; currency: string }[];
  readonly statuses: string[];
}
/** État lu après le règlement : demande, variation, ordre REFUND, host_ledger, statuts du trip. */
async function settled(cancellation: string, trip: string): Promise<Settled> {
  const row = (
    await read<{ status: string; settlement_id: string | null; cost_bearer: string }>(
      'settlement',
      'SELECT status, settlement_id, cost_bearer FROM test_fixture.us215_cancellation($1)',
      [cancellation],
    )
  )[0]!;
  const variation = legsMap(
    await read<{ leg: string; v: string }>(
      'settlement',
      `SELECT leg, variation_minor::text AS v FROM core.settlement_settlement_leg
        WHERE settlement_id = $1`,
      [row.settlement_id],
    ),
  );
  const refund = legsMap(
    await read<{ leg: string; v: string }>(
      'payment_command',
      `SELECT l.leg, l.amount_minor::text AS v
         FROM core.payment_payment_operation AS o
         JOIN core.payment_payment_operation_leg AS l ON l.operation_id = o.id
        WHERE o.trip_id = $1 AND o.kind = 'REFUND'`,
      [trip],
    ),
  );
  const ledger = (
    await read<{ reason: string; amount_minor: string; currency: string }>(
      'payment_command',
      'SELECT reason, amount_minor::text AS amount_minor, currency FROM test_fixture.us307_host_ledger($1)',
      [trip],
    )
  ).map((e) => ({ reason: e.reason, amount: BigInt(e.amount_minor), currency: e.currency }));
  const statuses = (await events(trip))
    .filter((e) => e.type === 'trip.status_changed')
    .map((e) => String(e.payload['to']));
  return { status: row.status, costBearer: row.cost_bearer, variation, refund, ledger, statuses };
}

/** Préparation du versement d'un trip, dans une transaction ANNULÉE (rien n'est écrit). */
async function preparePayout(trip: string): Promise<string> {
  const worker = await open('app_worker');
  return inTx(
    worker,
    { worker: 'payment_command' },
    async (tx) =>
      (
        await tx.query<{ outcome: string }>(
          'SELECT outcome FROM core.payout_cmd_prepare_trip($1)',
          [trip],
        )
      ).rows[0]!.outcome,
  );
}

// ------------------------------------------------------------------------------------------------

describe.each(CASES)(
  'US-312 — parcours dorés « trip complet » ($country, $currency)',
  (c: Case) => {
    const capture = legsOf(c.e.capture);
    const total = sum(capture);

    // ---------------------------------------------------------------------------------------------
    it('1. trip normal : remise, retour, avis, dossier de preuve', async () => {
      const START = base(2081, c);
      const END = START + 3 * DAY;
      const OPENS = START - DAY;
      const RETURN_AT = END - 40 * MINUTE;
      const api = await open('app_api');
      await inTx(api, { at: iso(OPENS) }, (tx) =>
        phased('variante 1', async (step) => {
          step('assureur et interrupteur');
          // assureur partenaire (fixture 9976) puis interrupteur par la procédure à deux personnes
          // (même ordre que l0-us315-handover : contrat, puis audit et verrou consultatif)
          await tx.query('SELECT test_fixture.us108_insurer_contract($1, $2, $3)', [
            c.country,
            50,
            ['STANDARD', 'PREMIUM', 'LUXE'],
          ]);
          await openSwitch(tx, 'insurer_contract_active', c.country);
          step('trip réservé, paiement prouvé, contrat signé');
          await at(tx, OPENS);
          const w = await bookedTrip(tx, c, START, END);
          await tx.query('SELECT test_fixture.us315_payment($1, $2, $3::bigint)', [
            w.trip,
            'WEBHOOK_SIGNED',
            w.amount,
          ]);
          await tx.query('SELECT test_fixture.us315_deposit($1, $2, $3::bigint)', [
            w.trip,
            'NOT_REQUIRED',
            w.amount,
          ]);
          await tx.query('SELECT test_fixture.us211_sign($1)', [w.trip]);
          await subjectKey(tx, 'GUEST', w.guest);
          await subjectKey(tx, 'HOST', w.holder);
          const g = await session(tx, w.guest);
          const h = await session(tx, w.holder);

          step('messagerie');
          // messagerie du trip (US-316) : l'hôte écrit, le voyageur lit (prénom de l'hôte seulement)
          const posted = await tx.query<Json>(
            'SELECT * FROM core.messaging_cmd_post_message($1, $2::uuid, $3::uuid, $4)',
            [h, w.trip, randomUUID(), 'Te espero en el punto de entrega a la hora acordada.'],
          );
          expect(posted.rows[0]?.['outcome']).toBe('DONE');
          const thread = (
            await tx.query<Json>('SELECT * FROM core.messaging_thread_read($1, $2::uuid, $3)', [
              g,
              w.trip,
              50,
            ])
          ).rows;
          expect(thread[0]).toMatchObject({ viewer_role: 'GUEST', counterpart_name: 'María' });
          expect(thread.filter((m) => m['message_id'] !== null)).toEqual([
            expect.objectContaining({ mine: false, author_role: 'HOST' }),
          ]);
          expect(JSON.stringify(thread)).not.toContain('Gómez');

          step('départ');
          // départ : ouverture 24 h avant, photos des deux parties, permis (hôte), deux validations
          const opened = await tx.query<Json>(
            'SELECT * FROM core.trip_cmd_open_checkin($1, $2::uuid)',
            [h, w.trip],
          );
          expect(opened.rows[0]?.['outcome']).toBe('DONE');
          await at(tx, START - 10 * MINUTE);
          await series(tx, h, w.trip, 'CHECKIN');
          await series(tx, g, w.trip, 'CHECKIN');
          const identity = await tx.query<Json>(
            'SELECT * FROM core.trip_cmd_identity_check($1, $2::uuid, $3::jsonb, $4)',
            [
              h,
              w.trip,
              JSON.stringify({
                face: true,
                name: true,
                birthYear: true,
                valid: true,
                provisional: true,
                restrictions: true,
              }),
              null,
            ],
          );
          expect(identity.rows[0]).toMatchObject({ outcome: 'DONE', status: 'TRIP_ID_OK' });
          expect(await validate(tx, h, w.trip, 'CHECKIN', 42000, 8)).toMatchObject({
            outcome: 'DONE',
            completed_at: null,
            trip_status: 'CHECKIN_OPEN',
          });
          const departed = START - 5 * MINUTE;
          await at(tx, departed);
          const go = await validate(tx, g, w.trip, 'CHECKIN', 42000, 8);
          expect(go).toMatchObject({ outcome: 'DONE', trip_status: 'IN_PROGRESS' });
          expect(isoOf(go['completed_at'])).toBe(iso(departed));

          step('retour');
          // retour : photos des deux parties, deux validations ⇒ RETURNED à l'heure serveur
          await at(tx, RETURN_AT - 20 * MINUTE);
          await series(tx, h, w.trip, 'CHECKOUT');
          await series(tx, g, w.trip, 'CHECKOUT');
          expect(await validate(tx, h, w.trip, 'CHECKOUT', 42350, 6)).toMatchObject({
            outcome: 'DONE',
            completed_at: null,
            trip_status: 'IN_PROGRESS',
          });
          await at(tx, RETURN_AT);
          const back = await validate(tx, g, w.trip, 'CHECKOUT', 42351, 6);
          expect(back).toMatchObject({ outcome: 'DONE', trip_status: 'RETURNED' });
          expect(isoOf(back['completed_at'])).toBe(iso(RETURN_AT));
          const records = (
            await tx.query<{ r: Json }>('SELECT test_fixture.us315_records($1) AS r', [w.trip])
          ).rows[0]!.r;
          expect(records).toMatchObject({
            status: 'RETURNED',
            transitions: 2,
            vehicleOccupancyActive: 0,
            guestOccupancyActive: 0,
          });
          expect(isoOf(records['returnedAt'])).toBe(iso(RETURN_AT));
          expect(isoOf(records['checkinValidatedAt'])).toBe(iso(departed));
          expect((records['keys'] as Json[]).map((k) => [k['direction'], k['method']])).toEqual([
            ['OUT', 'IN_PERSON'],
            ['IN', 'IN_PERSON'],
          ]);

          step('avis');
          // avis (US-317) : double aveugle, publiés à la seconde soumission
          await at(tx, RETURN_AT + 2 * DAY);
          const h2 = await session(tx, w.holder);
          const g2 = await session(tx, w.guest);
          const SUBMIT = 'SELECT * FROM core.review_cmd_submit($1, $2::uuid, $3, $4::jsonb, $5)';
          expect((await tx.query<Json>(SUBMIT, [h2, w.trip, 5, null, null])).rows[0]).toMatchObject(
            {
              outcome: 'DONE',
              status: 'SUBMITTED',
            },
          );
          const blind = (
            await tx.query<{ view: Json }>('SELECT * FROM core.review_trip_read($1, $2::uuid)', [
              g2,
              w.trip,
            ])
          ).rows[0]!.view;
          expect(blind['published']).toEqual([]);
          await at(tx, RETURN_AT + 3 * DAY);
          const guestReview = await tx.query<Json>(SUBMIT, [
            g2,
            w.trip,
            4,
            null,
            'Auto limpio, entrega puntual y anfitrión muy atento durante todo el viaje.',
          ]);
          expect(guestReview.rows[0]).toMatchObject({ outcome: 'DONE', status: 'PUBLISHED' });
          const reviews = (
            await tx.query<Json>('SELECT * FROM test_fixture.us317_reviews($1)', [w.trip])
          ).rows;
          expect(reviews).toHaveLength(3);
          for (const r of reviews) expect(r).toMatchObject({ status: 'PUBLISHED' });

          step('dossier de preuve');
          // dossier de preuve (US-308) : agent OPS du pays, dossier de support assigné, manifeste scellé
          const ops = await staffMember(tx, 'OPS_AGENT', c.country);
          const caseId = randomUUID();
          await tx.query(
            'SELECT test_fixture.rls_insert_support_case($1, $2, $3, $4, $5, $6, $7)',
            [caseId, c.country, w.trip, ops, 'OPEN', 'CLAIM', null],
          );
          await subjectKey(tx, 'STAFF', ops);
          const staff = await asStaff(tx, ops, c.country);
          const bundle = (
            await tx.query<Json>(
              `SELECT outcome, bundle_id::text AS bundle_id, status
             FROM core.support_staff_request_evidence_bundle($1, $2::uuid, $3::uuid, $4::uuid, $5,
                                                             $6)`,
              [staff.hash, randomUUID(), w.trip, caseId, 'INSURER', 'Parcours doré US-312'],
            )
          ).rows[0]!;
          expect(bundle).toMatchObject({ outcome: 'REQUESTED', status: 'REQUESTED' });
          const sealed = (
            await tx.query<Json>('SELECT * FROM test_fixture.us308_bundle($1)', [
              bundle['bundle_id'],
            ])
          ).rows[0]!;
          const manifest = sealed['manifest'] as Json;
          expect(manifest).toMatchObject({
            schema: 'clm.evidence/1',
            trip: { id: w.trip, country: c.country, currency: c.currency, status: 'RETURNED' },
            messages: { count: 1 },
          });
          const files = manifest['files'] as Json[];
          expect(files.filter((f) => f['kind'] === 'PHOTO')).toHaveLength(4 * SLOTS.length);
          // une inspection par sens (départ, retour) et par partie (hôte, voyageur)
          expect(manifest['inspections'] as Json[]).toHaveLength(4);
          expect(
            createHash('sha256')
              .update(String(sealed['manifest_text']))
              .digest()
              .equals(sealed['manifest_sha256'] as Buffer),
          ).toBe(true);
          for (const secret of ['Pérez', 'Gómez', 'Te espero', 'license', 'latitude']) {
            expect(String(sealed['manifest_text'])).not.toContain(secret);
          }
        }),
      );
      // transaction annulée : l'interrupteur ouvert pour la remise n'existe plus
      await inTx(api, { at: iso(START) }, async (tx) => {
        expect(await switches(tx, c.country)).toEqual(ALL_CLOSED);
      });
    });

    // ---------------------------------------------------------------------------------------------
    /** Instantané de la variante 2 (transaction annulée), affirmé par les tests qui suivent. */
    const money: { payoutEvents?: { type: string; payload: Json }[] } = {};

    it('2. trip normal : versement ON_HOLD, chargeback perdu (TJ14b)', async () => {
      const worker = await open('app_worker');
      // fin effective : vendredi 15:00 locale (année 2086) ; premier versement ⇒ J+5 ouvrés,
      // 10:00 locale (08 BR-PAYOUT, ADR-185) ; seul férié du calendrier de test : 1er janvier
      const Y = 2086;
      const friday = 15 + 7 * c.index; // 2086-03-15 et 2086-03-22 sont des vendredis
      const day = (d: number): string => `${Y}-03-${String(d).padStart(2, '0')}`;
      await inTx(
        worker,
        { worker: 'payment_command', at: iso(base(Y, c) - 10 * DAY) },
        async (tx) => {
          const local = async (wall: string): Promise<number> =>
            Date.parse(
              (
                await tx.query<{ at: string }>(
                  `SELECT pg_catalog.to_char(($1::timestamp AT TIME ZONE $2) AT TIME ZONE 'UTC',
                                         'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at`,
                  [wall, c.timeZone],
                )
              ).rows[0]!.at,
            );
          const end = await local(`${day(friday)} 15:00`);
          const expectedPayout = await local(`${day(friday + 7)} 10:00`);
          const trip = randomUUID();
          await tx.query(
            `SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              trip,
              randomUUID(),
              randomUUID(),
              randomUUID(),
              c.country,
              c.currency,
              c.timeZone,
              iso(end - 3 * DAY),
              iso(end),
            ],
          );
          const account = (
            await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
              c.country,
            ])
          ).rows[0]!.id;
          const cap = await recordOperation(tx, {
            tripId: trip,
            accountId: account,
            amountMinor: total,
            currency: c.currency,
            legs: capture,
          });
          expect(await signedStatus(tx, cap.operation_id, 'SUCCEEDED')).toBe('APPLIED');
          expect(
            (
              await tx.query<{ r: string }>(
                'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
                [cap.operation_id],
              )
            ).rows[0]?.r,
          ).toBe('APPLIED');
          const balances = legsMap(
            (
              await tx.query<{ leg: string; v: string }>(
                `SELECT leg, captured_minor::text AS v FROM core.settlement_trip_leg_balance
              WHERE trip_id = $1 AND segment_no = 1`,
                [trip],
              )
            ).rows,
          );
          expect(balances).toEqual(capture);

          // trip terminé à la fin effective, puis préparation du versement
          await tx.query('SELECT test_fixture.us708_holiday($1, $2::date)', [
            c.country,
            `${Y}-01-01`,
          ]);
          await tx.query('SELECT test_fixture.us708_verified_account($1, NULL)', [trip]);
          await at(tx, end);
          await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);
          await at(tx, end + 60 * MINUTE);
          const prepared = (
            await tx.query<{
              outcome: string;
              batch_id: string;
              payout_at: Date;
              status: string;
              hold_reasons: string[];
            }>(
              'SELECT outcome, batch_id, payout_at, status, hold_reasons FROM core.payout_cmd_prepare_trip($1)',
              [trip],
            )
          ).rows[0]!;
          expect(prepared).toMatchObject({ outcome: 'PREPARED', status: 'ON_HOLD' });
          expect(prepared.hold_reasons).toEqual(expect.arrayContaining(['PAYOUTS_DISABLED']));
          expect(prepared.hold_reasons).not.toContain('CHARGEBACK');
          expect(prepared.payout_at.toISOString()).toBe(iso(expectedPayout));
          const batch = async () =>
            (
              await tx.query<Json>(
                `SELECT id, status, first_payout, gross_minor::text AS gross, netted_minor::text AS netted,
                    net_minor::text AS net, hold_reasons FROM test_fixture.us708_batches($1)`,
                [trip],
              )
            ).rows;
          expect(await batch()).toEqual([
            expect.objectContaining({
              id: prepared.batch_id,
              status: 'ON_HOLD',
              first_payout: true,
              gross: capture.HOST.toString(),
              netted: '0',
              net: capture.HOST.toString(),
            }),
          ]);
          const ledger = async () =>
            (
              await tx.query<Json>(
                'SELECT reason, amount_minor::text AS amount FROM test_fixture.us709_ledger($1)',
                [trip],
              )
            ).rows;
          expect(await ledger()).toEqual([]);
          expect((await switches(tx, c.country))['payouts_enabled']).toBe(false);

          // notifications du lot (lecture du relais, puis retour au travailleur de l'argent)
          await asWorker(tx, 'outbox_relay');
          money.payoutEvents = (
            await tx.query<{ type: string; payload: Json }>(
              `SELECT type, payload FROM core.outbox_outbox_event
                WHERE aggregate_id = $1::uuid ORDER BY aggregate_version, occurred_at, id`,
              [prepared.batch_id],
            )
          ).rows;
          await asWorker(tx, 'payment_command');

          // chargeback du total : HOST et INSURER gelées (08 E7 règle 7), versement retenu en litige
          const cb = await recordOperation(tx, {
            tripId: trip,
            accountId: account,
            kind: 'CHARGEBACK',
            amountMinor: total,
            currency: c.currency,
            legs: null,
          });
          const freeze = async (leg: LegName) =>
            (
              await tx.query<{ frozen: boolean; frozen_reason: string | null }>(
                'SELECT * FROM test_fixture.us222d_leg_freeze($1, $2)',
                [trip, leg],
              )
            ).rows[0];
          const FROZEN = { frozen: true, frozen_reason: 'CHARGEBACK' };
          const FREE = { frozen: false, frozen_reason: null };
          expect(await freeze('HOST')).toEqual(FROZEN);
          expect(await freeze('INSURER')).toEqual(FROZEN);
          expect(await freeze('PLATFORM')).toEqual(FREE);
          await at(tx, expectedPayout + MINUTE);
          const held = (
            await tx.query<{ outcome: string; hold_reasons: string[] }>(
              'SELECT outcome, hold_reasons FROM core.payout_cmd_net_batch($1)',
              [prepared.batch_id],
            )
          ).rows[0]!;
          expect(held.outcome).toBe('ON_HOLD');
          expect(held.hold_reasons).toEqual(
            expect.arrayContaining(['CHARGEBACK', 'PAYOUTS_DISABLED']),
          );

          // chargeback perdu (preuve signée) : imputation TJ14b, aucune reprise, jambes dégelées
          expect(await signedStatus(tx, cb.operation_id, 'SUCCEEDED')).toBe('APPLIED');
          const imputed = (
            await tx.query<Json>('SELECT * FROM test_fixture.us709_imputation($1)', [
              cb.operation_id,
            ])
          ).rows[0]!;
          expect(imputed).toMatchObject({
            earnings_kind: 'REALIZED',
            currency: c.currency,
            clawback_minor: '0',
          });
          expect({
            HOST: BigInt(String(imputed['host_leg_minor'])),
            INSURER: BigInt(String(imputed['insurer_leg_minor'])),
            TAX_THIRD_PARTY: BigInt(String(imputed['tax_third_party_leg_minor'])),
            PLATFORM: BigInt(String(imputed['platform_leg_minor'])),
          }).toEqual(c.e.chargebackLost);
          expect(await freeze('HOST')).toEqual(FREE);
          expect(await freeze('INSURER')).toEqual(FREE);
          expect(await ledger()).toEqual([]);
          await at(tx, expectedPayout + 20 * MINUTE);
          const after = (
            await tx.query<{ outcome: string; hold_reasons: string[] }>(
              'SELECT outcome, hold_reasons FROM core.payout_cmd_net_batch($1)',
              [prepared.batch_id],
            )
          ).rows[0]!;
          expect(after.outcome).toBe('ON_HOLD');
          expect(after.hold_reasons).toContain('PAYOUTS_DISABLED');
          expect(after.hold_reasons).not.toContain('CHARGEBACK');
          expect((await switches(tx, c.country))['payouts_enabled']).toBe(false);
        },
      );
    });

    // ÉCART CONNU n° 2 → suite d'US-708 : `payout.batch.status_changed` n'est pas émis ; la règle
    // EVT_PAYOUT_ON_HOLD de NTF ne reçoit rien et l'hôte n'est pas prévenu de son versement retenu.
    // Passe au vert quand l'événement est livré (il devient alors un test ordinaire).
    it.fails(
      '2b. ÉCART n° 2 : versement retenu notifié à l’hôte (EVT_PAYOUT_ON_HOLD)',
      async () => {
        await open('app_api'); // L0-05
        // garde : sans l'état de la variante 2, la fonction rend sans erreur ⇒ it.fails ROUGE
        if (money.payoutEvents === undefined) return;
        const notices = money.payoutEvents.flatMap((e) => routed(e.type, e.payload));
        expect(notices).toContainEqual({ template: 'EVT_PAYOUT_ON_HOLD', recipients: ['HOST'] });
      },
    );

    // ---------------------------------------------------------------------------------------------
    it('3. retard : OVERDUE à fin + 30 min, EVT_TRIP_OVERDUE, retour', async () => {
      const START = base(2082, c);
      const END = START + 2 * DAY;
      const api = await open('app_api');
      const worker = await open('app_worker');
      const w = await inTx(api, { at: iso(START - 2 * DAY), commit: true }, async (tx) => {
        const t = await bookedTrip(tx, c, START, END);
        // couture : départ réel impossible en données validées (interrupteur de l'assureur)
        await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [t.trip, 'IN_PROGRESS']);
        return t;
      });
      const detect = async (ms: number): Promise<Json> =>
        inTx(
          worker,
          { worker: 'trip_overdue', at: iso(ms), commit: true },
          async (tx) =>
            (
              await tx.query<{ r: Json }>('SELECT core.trip_cmd_detect_overdue($1::uuid) AS r', [
                w.trip,
              ])
            ).rows[0]!.r,
        );
      expect(await detect(END + 29 * MINUTE)).toMatchObject({
        outcome: 'NOT_DUE',
        status: 'IN_PROGRESS',
      });
      expect(await detect(END + 30 * MINUTE)).toMatchObject({
        outcome: 'DETECTED',
        status: 'OVERDUE',
      });
      expect(await detect(END + 31 * MINUTE)).toMatchObject({ outcome: 'UNCHANGED' });
      const records = async (): Promise<Json> =>
        inTx(
          worker,
          {},
          async (tx) =>
            (await tx.query<{ r: Json }>('SELECT test_fixture.us305_records($1) AS r', [w.trip]))
              .rows[0]!.r,
        );
      const overdue = await records();
      expect(overdue['status']).toBe('OVERDUE');
      const detected = (overdue['events'] as Json[]).filter(
        (e) => e['type'] === 'trip.overdue.detected',
      );
      expect(detected).toHaveLength(1);
      const payload = detected[0]!['payload'] as Json;
      expect(payload).toMatchObject({
        trip_id: w.trip,
        stage: 'T30M',
        guest_user_id: w.guest,
        host_user_id: w.holder,
      });
      expect(routed('trip.overdue.detected', payload)).toEqual([
        { template: 'EVT_TRIP_OVERDUE', recipients: ['GUEST', 'HOST'] },
      ]);

      // retour en retard par les vraies commandes de la remise (aucun interrupteur lu au retour)
      const RETURN_AT = END + 50 * MINUTE;
      await inTx(api, { at: iso(END + 35 * MINUTE), commit: true }, async (tx) => {
        await subjectKey(tx, 'GUEST', w.guest);
        await subjectKey(tx, 'HOST', w.holder);
        const g = await session(tx, w.guest);
        const h = await session(tx, w.holder);
        await series(tx, h, w.trip, 'CHECKOUT');
        await series(tx, g, w.trip, 'CHECKOUT');
        expect(await validate(tx, h, w.trip, 'CHECKOUT', 42500, 5)).toMatchObject({
          outcome: 'DONE',
          trip_status: 'OVERDUE',
        });
        await at(tx, RETURN_AT);
        const back = await validate(tx, g, w.trip, 'CHECKOUT', 42500, 5);
        expect(back).toMatchObject({ outcome: 'DONE', trip_status: 'RETURNED' });
        expect(isoOf(back['completed_at'])).toBe(iso(RETURN_AT));
      });
      expect((await records())['status']).toBe('RETURNED');
      expect(await detect(END + 90 * MINUTE)).toMatchObject({
        outcome: 'SKIPPED',
        status: 'RETURNED',
      });
      // une seule détection pour tout le retard
      expect(
        ((await records())['events'] as Json[]).filter(
          (e) => e['type'] === 'trip.overdue.detected',
        ),
      ).toHaveLength(1);
      // ÉCART CONNU n° 4 → suite (frais de retard, renvoi d'US-305 à US-703) : aucun débit MIT
      // n'est produit pour le retard ; fige le comportement actuel
      const charges = await read<{ n: number }>(
        'payment_command',
        `SELECT pg_catalog.count(*)::int AS n FROM core.payment_payment_operation
          WHERE trip_id = $1 AND kind = 'MIT_CHARGE'`,
        [w.trip],
      );
      expect(charges[0]!.n).toBe(0);
    });

    // ---------------------------------------------------------------------------------------------
    /** Notifications routées des événements du trip réglé (variantes 4 et 5), pour 4b et 5b. */
    const routedOf: {
      noShow?: { template: string; recipients: string[] }[];
      refusal?: { template: string; recipients: string[] }[];
    } = {};

    it('4. no-show déclaré par l’hôte (T+70 min, message tracé)', async () => {
      const START = base(2083, c);
      const w = await capturedWorld(c, c.e.noShow.vector, START, true);
      const declaredAt = START + 70 * MINUTE;
      const requestId = randomUUID();
      const api = await open('app_api');
      await inTx(api, { at: iso(declaredAt), commit: true }, async (tx) => {
        const h = await session(tx, w.holder);
        await tx.query('SELECT test_fixture.us316_seed_message($1, $2, $3, $4, $5::timestamptz)', [
          w.trip,
          w.holder,
          'HOST',
          'Estoy en el punto de entrega',
          iso(START + 50 * MINUTE),
        ]);
        const r = await tx.query<Json>(
          'SELECT * FROM core.trip_cmd_report_no_show($1, $2::uuid, $3::uuid)',
          [h, w.trip, requestId],
        );
        expect(r.rows[0]).toMatchObject({ outcome: 'DONE', status: 'PENDING' });
      });
      const row = (
        await read<Json>('trip_lifecycle', 'SELECT * FROM test_fixture.us307_cancellation($1)', [
          requestId,
        ])
      )[0]!;
      expect(row).toMatchObject({
        requested_reason: 'GUEST_NO_SHOW',
        initiator: 'HOST',
        host_message_traced: true,
      });
      const alerts = new Alerts();
      expect(
        await processor(c.e.noShow.vector, declaredAt + MINUTE, alerts).process(requestId),
      ).toEqual({ outcome: 'SETTLED', costBearer: 'GUEST', orders: 1 });
      expect(alerts.sent).toEqual([]);
      const s = await settled(requestId, w.trip);
      const v = settlementVector(golden, c.e.noShow.vector);
      expect(s.status).toBe('SETTLED');
      expect(s.variation).toEqual(c.e.noShow.variation);
      expect(sum(s.variation)).toBe(-v.expected.guestRefundMinor);
      expect(capture.HOST + s.variation.HOST).toBe(v.expected.hostEarningsMinor);
      expect(s.refund).toEqual(negate(c.e.noShow.variation));
      expect(s.ledger).toEqual([]);
      expectFinal(s.statuses, 'NO_SHOW_GUEST');
      // ÉCART CONNU n° 1 → suite (lot CXL_EARNINGS, renvoi d'US-709) : la part de l'hôte retenue
      // n'est jamais mise en lot ; fige le comportement actuel
      expect(await preparePayout(w.trip)).toBe('NOT_COMPLETED');
      routedOf.noShow = (await events(w.trip)).flatMap((e) => routed(e.type, e.payload));
    });

    // ÉCART CONNU n° 3 → suite d'ADR-191 : EVT_NO_SHOW_DECLARED n'existe pas ; ni le voyageur
    // déclaré absent ni l'hôte ne sont notifiés du no-show réglé.
    it.fails('4b. ÉCART n° 3 : no-show réglé notifié (EVT_NO_SHOW_DECLARED)', async () => {
      await open('app_api'); // L0-05
      // garde : sans l'état de la variante 4, la fonction rend sans erreur ⇒ it.fails ROUGE
      if (routedOf.noShow === undefined) return;
      expect(routedOf.noShow).toContainEqual({
        template: 'EVT_NO_SHOW_DECLARED',
        recipients: ['GUEST', 'HOST'],
      });
    });

    // ---------------------------------------------------------------------------------------------
    it('5. refus au départ (propreté) : remboursement intégral, pénalité', async () => {
      const START = base(2084, c);
      const w = await capturedWorld(c, c.e.refusal.vector, START, true);
      const refusedAt = START + 10 * MINUTE;
      const id = await opsAction(
        c,
        w.trip,
        'REFUSE_AT_PICKUP',
        { refusalReason: 'CLEANLINESS' },
        refusedAt,
      );
      const alerts = new Alerts();
      expect(await processor(c.e.refusal.vector, refusedAt + MINUTE, alerts).process(id)).toEqual({
        outcome: 'SETTLED',
        costBearer: 'HOST',
        orders: 1,
      });
      expect(alerts.sent).toEqual([]);
      const s = await settled(id, w.trip);
      expect(s.variation).toEqual(c.e.refusal.variation);
      expect(s.refund).toEqual(capture); // intégral : chaque jambe capturée est remboursée
      expect(sum(s.refund)).toBe(total);
      expect(s.ledger).toEqual([
        { reason: 'HOST_CANCELLATION_PENALTY', amount: -c.e.refusal.penalty, currency: c.currency },
      ]);
      expectFinal(s.statuses, 'REFUSED_AT_PICKUP');
      // ÉCART CONNU n° 1 → suite (lot CXL_EARNINGS) : aucun lot ; fige le comportement actuel
      expect(await preparePayout(w.trip)).toBe('NOT_COMPLETED');
      routedOf.refusal = (await events(w.trip)).flatMap((e) => routed(e.type, e.payload));
    });

    // ÉCART CONNU n° 3 → suite d'ADR-191 : EVT_VEHICLE_REFUSED n'existe pas ; le refus réglé n'est
    // notifié à aucune des parties.
    it.fails('5b. ÉCART n° 3 : refus réglé notifié (EVT_VEHICLE_REFUSED)', async () => {
      await open('app_api'); // L0-05
      // garde : sans l'état de la variante 5, la fonction rend sans erreur ⇒ it.fails ROUGE
      if (routedOf.refusal === undefined) return;
      expect(routedOf.refusal).toContainEqual({
        template: 'EVT_VEHICLE_REFUSED',
        recipients: ['GUEST', 'HOST'],
      });
    });

    // ---------------------------------------------------------------------------------------------
    it('6a. annulation tardive du voyageur (T−10 h), notification produite', async () => {
      const START = base(2085, c);
      const v = settlementVector(golden, c.e.guestLate.vector);
      const w = await capturedWorld(c, c.e.guestLate.vector, START, false);
      const requestedAt = START + (v.event.requestedAtMinutes ?? 0) * MINUTE;
      const id = await opsAction(c, w.trip, 'CANCEL_TRIP_GUEST', {}, requestedAt);
      const alerts = new Alerts();
      expect(
        await processor(c.e.guestLate.vector, requestedAt + MINUTE, alerts).process(id),
      ).toEqual({ outcome: 'SETTLED', costBearer: 'GUEST', orders: 1 });
      const s = await settled(id, w.trip);
      expect(s.variation).toEqual(c.e.guestLate.variation);
      expect(sum(s.refund)).toBe(v.expected.guestRefundMinor);
      expect(s.refund).toEqual(negate(c.e.guestLate.variation));
      expect(capture.HOST + s.variation.HOST).toBe(v.expected.hostFromGuestMinor);
      expect(s.ledger).toEqual([]);
      expectFinal(s.statuses, 'CANCELLED_BY_GUEST');
      const changed = (await events(w.trip)).filter(
        (e) => e.type === 'trip.status_changed' && e.payload['to'] === 'CANCELLED_BY_GUEST',
      );
      expect(changed).toHaveLength(1);
      expect(routed(changed[0]!.type, changed[0]!.payload)).toEqual([
        { template: 'EVT_BOOKING_CANCELLED', recipients: ['GUEST', 'HOST'] },
      ]);
      const parties = await read<{ p: Json }>(
        'ntf_dispatcher',
        'SELECT core.booking_notification_parties($1, $2::uuid) AS p',
        ['TRIP', w.trip],
      );
      expect(parties[0]!.p).toEqual({ guestUserId: w.guest, hostUserId: w.holder });
      // notification produite : envois planifiés de CET événement, un par partie
      expect(await produced(w.trip, 'CANCELLED_BY_GUEST')).toEqual([
        { role: 'GUEST', uid: w.guest, template: 'EVT_BOOKING_CANCELLED' },
        { role: 'HOST', uid: w.holder, template: 'EVT_BOOKING_CANCELLED' },
      ]);
      // ÉCART CONNU n° 1 → suite (lot CXL_EARNINGS) : aucun lot ; fige le comportement actuel
      expect(await preparePayout(w.trip)).toBe('NOT_COMPLETED');
    });

    it('6b. annulation tardive de l’hôte : remboursement intégral, `cxlLate`', async () => {
      const START = base(2085, c) + 10 * DAY;
      const w = await capturedWorld(c, c.e.hostLate.vector, START, false);
      const requestedAt = START + c.e.hostLate.requestedAtMinutes * MINUTE;
      const id = await opsAction(c, w.trip, 'CANCEL_TRIP_HOST', {}, requestedAt);
      const alerts = new Alerts();
      expect(
        await processor(c.e.hostLate.vector, requestedAt + MINUTE, alerts).process(id),
      ).toEqual({
        outcome: 'SETTLED',
        costBearer: 'HOST',
        orders: 1,
      });
      const s = await settled(id, w.trip);
      expect(s.variation).toEqual(c.e.hostLate.variation);
      expect(s.refund).toEqual(capture);
      expect(s.ledger).toEqual([
        {
          reason: 'HOST_CANCELLATION_PENALTY',
          amount: -c.e.hostLate.penalty,
          currency: c.currency,
        },
      ]);
      expectFinal(s.statuses, 'CANCELLED_BY_HOST');
      const changed = (await events(w.trip)).filter(
        (e) => e.type === 'trip.status_changed' && e.payload['to'] === 'CANCELLED_BY_HOST',
      );
      expect(changed).toHaveLength(1);
      expect(routed(changed[0]!.type, changed[0]!.payload)).toEqual([
        { template: 'EVT_BOOKING_CANCELLED', recipients: ['GUEST', 'HOST'] },
      ]);
      for (const k of LEGS) expect(s.refund[k] >= 0n, k).toBe(true);
    });
  },
);
