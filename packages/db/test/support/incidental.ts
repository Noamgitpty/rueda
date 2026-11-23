/**
 * US-706 — monde commun des preuves L0 des frais annexes (fichier principal et courses à deux
 * connexions) : trip rendu, photos des séries, validations, loyer par carte, appels des commandes.
 * Les attendus restent dans les tests (19 US-706, 16 CLM-021, 08), jamais dans ces aides.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { SubjectKeyStore } from '../../src/audit/index.ts';
import { FakeKeyWrapper, withRole } from '../../src/testing/index.ts';
import { setActor } from './audit.ts';
import { COUNTRIES } from './avl.ts';
import type { CountryCase } from './avl.ts';
import { elevated, uuid } from './claims.ts';
import type { Staff } from './claims.ts';
import { openSession } from './iam.ts';
import { payTx } from './pay.ts';

export type Tx = pg.ClientBase;
export type Row = Record<string, unknown>;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const at = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

/** Trip du 7 au 10 mars 2097, rendu à 08:00 ; demande notifiée à J0 10:00 (heure de la base). */
export const START = '2097-03-07T08:00:00.000Z';
export const END = '2097-03-10T08:00:00.000Z';
export const J0 = '2097-03-10T10:00:00.000Z';
/** J0 + `invoice_guest_response_h` (72 h, 08 BR-REIMB-02) : J+3 10:00. */
export const DUE = '2097-03-13T10:00:00.000Z';

/**
 * Montants par devise (unités mineures) : nettoyage demandé, sous le plafond PROPOSÉ
 * `incidental_cleaning_max_minor` ; carburant de T69 (12,00 USD) et son équivalent PYG ; plafond
 * de carburant posé par le test (`fuel_refill_max` est « à fixer », 0009). PYG sans décimale.
 */
export const AMOUNTS: readonly Readonly<Record<string, bigint>>[] = [
  // devise à deux décimales (premier pays de COUNTRIES)
  { cleaning: 4500n, cleaningCap: 15000n, fuel: 1200n, fuelCap: 10000n, rent: 30000n },
  // devise sans décimale (second pays de COUNTRIES)
  {
    cleaning: 300000n,
    cleaningCap: 1125000n,
    fuel: 90000n,
    fuelCap: 750000n,
    rent: 2000000n,
  },
];
export const amountsOf = (c: CountryCase): Readonly<Record<string, bigint>> =>
  AMOUNTS[COUNTRIES.indexOf(c)] ?? {};

export const SUBMIT = `SELECT outcome, invoice_id::text AS invoice_id, response_due_at
  FROM core.claim_cmd_submit_incidental($1, $2::uuid, $3::uuid, $4, $5::bigint, $6, $7::uuid[])`;
export const ACCEPT = 'SELECT core.claim_cmd_accept_incidental($1, $2::uuid) AS r';
export const DISPUTE =
  'SELECT core.claim_cmd_dispute_incidental($1, $2::uuid, $3, $4::uuid[]) AS r';
export const CANCEL = 'SELECT core.claim_cmd_cancel_incidental($1, $2::uuid) AS r';
export const VIEW = 'SELECT core.claim_incidental_view($1, $2::uuid) AS v';
export const DECIDE = `SELECT outcome, body
  FROM core.support_staff_decide_incidental($1, $2::uuid, $3::uuid, $4, $5)`;
export const STAFF_VIEW =
  'SELECT outcome, body FROM core.support_staff_incidental($1, $2::uuid, $3::uuid)';
export const CHARGE =
  'SELECT outcome, code FROM core.claim_cmd_charge_incidental($1::uuid, $2::uuid)';
/** File du travailleur, filtrée DANS la requête (avant la limite) sur les demandes du test. */
export const DUE_LIST =
  'SELECT invoice_id::text AS id FROM core.claim_incidental_invoices_due(100, $1::uuid[])';
export const DESCRIPTION = 'Sièges arrière couverts de sable et de boue au retour';
export const DISPUTE_REASON =
  'Le véhicule a été rendu propre, voir ma photo de l’intérieur au retour.';
export const RATIONALE =
  'Photos de retour de l’hôte : sable visible sur la banquette ; frais justifié.';

export interface World {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
  readonly org: string;
  readonly rent: string | null;
  /** Photos des séries : départ jauge (hôte), retour jauge (hôte), retour intérieur (hôte et
   * voyageur), retour extérieur (hôte). */
  readonly fuelOut: string;
  readonly fuelIn: string;
  readonly inner: string;
  readonly guestInner: string;
  readonly outer: string;
}

export interface WorldOptions {
  readonly rent?: boolean;
  /** Niveaux de carburant (huitièmes) : départ, retour (les deux parties). */
  readonly fuel?: readonly [number, number];
  readonly returned?: boolean;
  readonly terminatedEarly?: boolean;
  /** Trip avec devis et Extra vendu (fixture 9948, ligne EXTRAS). */
  readonly extras?: boolean;
  readonly guest?: string;
  /** Compte d'hôte existant (même titulaire pour deux trips). */
  readonly org?: string;
}

export async function photo(tx: Tx, trip: string, kind: string, slot: string, role = 'HOST') {
  return (
    await tx.query<{ id: string }>('SELECT test_fixture.us706_photo($1, $2, $3, $4)::text AS id', [
      trip,
      kind,
      slot,
      role,
    ])
  ).rows[0]!.id;
}

/** Trip rendu à END (heure de la base), photos des deux séries, validations, loyer par carte. */
export async function world(tx: Tx, c: CountryCase, o: WorldOptions = {}): Promise<World> {
  let trip = uuid();
  const guest = o.guest ?? uuid();
  if (o.extras === true) {
    trip = (
      await tx.query<{ trip_id: string }>(
        `SELECT trip_id::text AS trip_id FROM test_fixture.us214_trip($1, $2, 'Ana', 'Ruiz',
                'Luis', 'Paz', $3::timestamptz, $4::timestamptz, $5::jsonb)`,
        [
          c.country,
          guest,
          START,
          END,
          JSON.stringify([
            { type: 'TRIP_PRICE', amountMinor: '20000' },
            { type: 'EXTRAS', amountMinor: '1000' },
          ]),
        ],
      )
    ).rows[0]!.trip_id;
  } else {
    await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      trip,
      guest,
      o.org ?? uuid(),
      uuid(),
      c.country,
      c.currency,
      c.timezone,
      START,
      END,
    ]);
  }
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [START]);
  const fuelOut = await photo(tx, trip, 'CHECKIN', 'FUEL');
  const [out, back] = o.fuel ?? [8, 5];
  for (const role of ['HOST', 'GUEST']) {
    await tx.query('SELECT test_fixture.us706_validation($1, $2, $3, $4::smallint)', [
      trip,
      'CHECKIN',
      role,
      out,
    ]);
  }
  if (o.terminatedEarly === true) {
    await tx.query('SELECT test_fixture.us706_terminated_early($1)', [trip]);
  }
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [END]);
  const fuelIn = await photo(tx, trip, 'CHECKOUT', 'FUEL');
  const inner = await photo(tx, trip, 'CHECKOUT', 'INT_01');
  const guestInner = await photo(tx, trip, 'CHECKOUT', 'INT_02', 'GUEST');
  const outer = await photo(tx, trip, 'CHECKOUT', 'EXT_01');
  for (const role of ['HOST', 'GUEST']) {
    await tx.query('SELECT test_fixture.us706_validation($1, $2, $3, $4::smallint)', [
      trip,
      'CHECKOUT',
      role,
      back,
    ]);
  }
  if (o.returned !== false) await tx.query('SELECT test_fixture.us309_returned($1)', [trip]);
  let rent: string | null = null;
  if (o.rent !== false) {
    rent =
      (
        await tx.query<{ id: string }>('SELECT test_fixture.us309_card_rent($1, $2)::text AS id', [
          trip,
          amountsOf(c)['rent']!.toString(),
        ])
      ).rows[0]?.id ?? null;
  }
  const holder = (
    await tx.query<{ h: string }>('SELECT test_fixture.us309_holder($1)::text AS h', [trip])
  ).rows[0]!.h;
  const org = (
    await tx.query<{ o: string }>('SELECT test_fixture.us309_trip_org($1)::text AS o', [trip])
  ).rows[0]!.o;
  return { trip, guest, holder, org, rent, fuelOut, fuelIn, inner, guestInner, outer };
}

export async function now(tx: Tx, iso: string): Promise<void> {
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso]);
}

export async function session(tx: Tx, user: string): Promise<Buffer> {
  await setActor(tx, { kind: 'NONE' });
  return (await openSession(tx, user)).hash;
}

export async function submit(
  tx: Tx,
  hash: Buffer,
  trip: string,
  feeType: string,
  amount: bigint,
  evidence: readonly string[],
  requestId = uuid(),
): Promise<Row> {
  return (
    await tx.query<Row>(SUBMIT, [
      hash,
      trip,
      requestId,
      feeType,
      amount.toString(),
      DESCRIPTION,
      evidence,
    ])
  ).rows[0]!;
}

export async function invoices(tx: Tx, trip: string): Promise<Row[]> {
  return (await tx.query<Row>('SELECT * FROM test_fixture.us706_invoices($1)', [trip])).rows;
}

export async function charges(tx: Tx, invoice: string): Promise<Row[]> {
  return (await tx.query<Row>('SELECT * FROM test_fixture.us706_charges($1)', [invoice])).rows;
}

export async function param(tx: Tx, key: string, country: string, value: unknown): Promise<void> {
  await tx.query('SELECT test_fixture.us706_param_version($1, $2, $3::jsonb)', [
    key,
    country,
    JSON.stringify(value),
  ]);
}

export async function decide(
  tx: Tx,
  who: Staff,
  invoice: string,
  outcome: string,
  rationale = RATIONALE,
  requestId = uuid(),
): Promise<Row> {
  const hash = await elevated(tx, who);
  return (await tx.query<Row>(DECIDE, [hash, requestId, invoice, outcome, rationale])).rows[0]!;
}

const KEYS = new SubjectKeyStore(new FakeKeyWrapper());

export const ATTACH =
  'SELECT core.claim_cmd_attach_incidental_file($1, $2::uuid, $3::uuid, $4, $5::bigint, $6) AS r';

/** Dépôt d'un fichier de preuve par une personne (session neuve) ; octets tirés au hasard. */
export async function attach(
  tx: Tx,
  user: string,
  trip: string,
  o: {
    readonly id?: string;
    readonly sha?: Buffer;
    readonly bytes?: number;
    readonly mime?: string;
  } = {},
): Promise<{ readonly r: string; readonly id: string }> {
  const id = o.id ?? uuid();
  // clé USER du déposant (le fichier est chiffré par elle, comme les photos d'état d'US-303)
  await setActor(tx, { kind: 'GUEST', actorId: user });
  const k = await KEYS.dekFor(tx, { type: 'USER', id: user }, 'create');
  if (k.status !== 'OK') throw new Error(`clé du sujet : ${k.status}`);
  const hash = await session(tx, user);
  const r = (
    await tx.query<{ r: string }>(ATTACH, [
      hash,
      trip,
      id,
      o.mime ?? 'image/jpeg',
      String(o.bytes ?? 2048),
      o.sha ?? randomBytes(32),
    ])
  ).rows[0]!.r;
  return { r, id };
}

export const asPayments = <T>(virtualNow: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withRole('app_worker', (worker) => payTx(worker, { worker: 'payment_command', virtualNow }, fn));
