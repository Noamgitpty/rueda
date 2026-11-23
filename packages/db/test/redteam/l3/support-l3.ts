/**
 * US-313 — aides de la red team du lot 3 (19 US-313 critère 2 ; pré-mortem du lot 3, plan RT-L3-*).
 * TESTS SEULEMENT (dossier `test/`, hors de l'image de production).
 *
 * Règles de jeu (comme au lot 2) : connexions sous les rôles de PRODUCTION (`withRole` : assertion
 * L0-05 en tête), une connexion par client, toujours libérée ; horloge de la base (`platform.now()`,
 * horloge virtuelle de test, années 2090 à 2096 pour les passes précédentes et 2076 à 2078 pour la passe de la porte : 2076 MIT, 2077 amendes, 2078 frais annexes ; aucune autre preuve ne les utilise) ; aucun
 * interrupteur de mise en service ouvert hors d'une transaction ANNULÉE et par la vraie procédure à
 * deux personnes (US-125) ; aucune constante de pays (pays et devises de `COUNTRIES`) ; attendus
 * tirés de 16, de 08 et des oracles (`docs/specs/tools/`), jamais du code testé.
 *
 * Les corps de `world`, `openInsurer`, `series`, `departed` reprennent ceux de
 * `l0-us303-inspection-photos` et `l0-us315-handover` (les preuves L0 n'exportent pas leurs aides).
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { expect } from 'vitest';
import { SubjectKeyStore } from '../../../src/audit/index.ts';
import { FakeKeyWrapper, withRole, withTestTransaction } from '../../../src/testing/index.ts';
import { setActor } from '../../support/audit.ts';
import { uuid } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { approveSwitch, freshSession, requestSwitch } from '../../support/golive.ts';
import type { StaffActor } from '../../support/golive.ts';
import { openSession, setVirtualNow } from '../../support/iam.ts';
import { staff as rlsStaff, staffSessionHash } from '../../support/rls.ts';

export type Tx = pg.ClientBase;
export type Row = Record<string, unknown>;
export { uuid, setVirtualNow };

/** Instant ISO décalé de `s` secondes. */
export const plus = (iso: string, s: number): string =>
  new Date(Date.parse(iso) + s * 1000).toISOString();
export const sha = (b: Buffer): Buffer => createHash('sha256').update(b).digest();
/** Heure d'un champ jsonb (texte ISO du serveur) au format de comparaison. */
export const at = (v: unknown): string | null =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
export const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);

/**
 * Loyer du trip de test, en unités mineures, selon le pas de prix de la devise (donnée de test de
 * `COUNTRIES` : 1 pour deux décimales, 1 000 sans décimale) ; mêmes montants que les preuves L0.
 */
export const rentOf = (c: CountryCase): string => (c.priceStepMinor === 1 ? '12000' : '1000000');
export const linesOf = (c: CountryCase): string =>
  JSON.stringify([{ type: 'TRIP_PRICE', amountMinor: rentOf(c) }]);

/** 17 §3.2.10 : gabarit minimal des photos (16 TRP-004). */
export const REQUIRED: readonly string[] = [
  ...Array.from({ length: 15 }, (_, i) => `EXT_${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, i) => `INT_${String(i + 1).padStart(2, '0')}`),
  'FUEL',
  'ODOMETER',
];
export const ALL_OK = {
  face: true,
  name: true,
  birthYear: true,
  valid: true,
  provisional: true,
  restrictions: true,
};

export const VIEW_INSPECTION = 'SELECT core.trip_inspection_view($1, $2::uuid, $3) AS v';
export const VIEW_HANDOVER = 'SELECT core.trip_handover_view($1, $2::uuid, $3) AS v';
export const CAPTURE = 'SELECT * FROM core.trip_cmd_open_photo_capture($1, $2::uuid, $3, $4)';
export const ADD = `SELECT * FROM core.trip_cmd_add_inspection_photo($1, $2::uuid, $3, $4::uuid, $5,
                                                              $6::uuid, $7, $8::bigint, $9,
                                                              $10::timestamptz)`;
export const SUBMIT = 'SELECT * FROM core.trip_cmd_submit_inspection($1, $2::uuid, $3)';
export const OPEN_CHECKIN = 'SELECT * FROM core.trip_cmd_open_checkin($1, $2::uuid)';
export const IDENTITY = 'SELECT * FROM core.trip_cmd_identity_check($1, $2::uuid, $3::jsonb, $4)';
export const VALIDATE =
  'SELECT * FROM core.trip_cmd_validate_handover($1, $2::uuid, $3, $4::integer, $5::integer, $6)';

export interface World {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
  /** Empreintes de session du voyageur et de l'hôte titulaire. */
  readonly g: Buffer;
  readonly h: Buffer;
}

export interface Ready {
  readonly proof?: 'WEBHOOK_SIGNED' | 'POLL' | null;
  readonly deposit?: 'NOT_REQUIRED' | 'PLANNED' | 'AUTHORIZED' | null;
  readonly contract?: boolean;
}

/**
 * Trip BOOKED (fixture 9948), paiement prouvé et caution (9924), contrat signé (9963) : voyageur
 * et hôte réels, session ouverte pour chacun.
 */
export async function bookedWorld(
  tx: Tx,
  c: CountryCase,
  start: string,
  end: string,
  r: Ready = {},
): Promise<World> {
  const guest = uuid();
  const { rows } = await tx.query<{ trip_id: string; holder_id: string }>(
    `SELECT * FROM test_fixture.us214_trip($1, $2, 'Ana', 'Pérez', 'María', 'Gómez', $3, $4,
                                           $5::jsonb)`,
    [c.country, guest, start, end, linesOf(c)],
  );
  const trip = rows[0]!.trip_id;
  const holder = rows[0]!.holder_id;
  await tx.query('SELECT test_fixture.us315_payment($1, $2, $3::bigint)', [
    trip,
    r.proof === undefined ? 'WEBHOOK_SIGNED' : r.proof,
    rentOf(c),
  ]);
  await tx.query('SELECT test_fixture.us315_deposit($1, $2, $3::bigint)', [
    trip,
    r.deposit === undefined ? 'NOT_REQUIRED' : r.deposit,
    rentOf(c),
  ]);
  if (r.contract !== false) await tx.query('SELECT test_fixture.us211_sign($1)', [trip]);
  return {
    trip,
    guest,
    holder,
    g: (await openSession(tx, guest)).hash,
    h: (await openSession(tx, holder)).hash,
  };
}

/** Trip dont la remise est ouverte (fixture 9997 : statut forcé), sans paiement ni contrat. */
export async function checkinOpenWorld(
  tx: Tx,
  c: CountryCase,
  start: string,
  end: string,
): Promise<World> {
  const guest = uuid();
  const { rows } = await tx.query<{ trip_id: string; holder_id: string }>(
    `SELECT * FROM test_fixture.us214_trip($1, $2, 'Ana', 'Pérez', 'María', 'Gómez', $3, $4,
                                           $5::jsonb)`,
    [c.country, guest, start, end, linesOf(c)],
  );
  const trip = rows[0]!.trip_id;
  const holder = rows[0]!.holder_id;
  await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [trip, 'CHECKIN_OPEN']);
  return {
    trip,
    guest,
    holder,
    g: (await openSession(tx, guest)).hash,
    h: (await openSession(tx, holder)).hash,
  };
}

/** Interrupteur de l'assureur ouvert par la procédure à deux personnes d'US-125 (annulée). */
export async function openInsurer(tx: Tx, country: string): Promise<void> {
  const actor = async (role: string): Promise<StaffActor> => {
    const id = await rlsStaff(tx, role, [country]);
    return { userId: id, hash: Buffer.from(staffSessionHash(id) ?? '', 'hex'), scope: [country] };
  };
  await tx.query('SELECT test_fixture.us108_insurer_contract($1, $2, $3)', [
    country,
    50,
    ['STANDARD', 'PREMIUM', 'LUXE'],
  ]);
  const requester = await actor('ADMIN');
  const approver = await freshSession(tx, await actor('SUPERADMIN'));
  const r = await requestSwitch(tx, requester, 'insurer_contract_active', country, true);
  if (r.outcome !== 'REQUESTED' || r.request_id === null) throw new Error(`demande : ${r.outcome}`);
  const a = await approveSwitch(tx, approver, r.request_id);
  if (a.outcome !== 'APPLIED') throw new Error(`approbation : ${a.outcome}`);
}

const keys = new SubjectKeyStore(new FakeKeyWrapper());

/** Clés USER des deux parties (dépôt chiffré des photos, US-303). */
export async function subjectKeys(tx: Tx, w: World): Promise<void> {
  for (const [kind, id] of [
    ['GUEST', w.guest],
    ['HOST', w.holder],
  ] as const) {
    await setActor(tx, { kind, actorId: id });
    const k = await keys.dekFor(tx, { type: 'USER', id }, 'create');
    if (k.status !== 'OK') throw new Error(`clé du sujet : ${k.status}`);
  }
}

export const capture = async (
  tx: Tx,
  who: Buffer,
  trip: string,
  slot: string,
  kind = 'CHECKIN',
): Promise<Row> => (await tx.query<Row>(CAPTURE, [who, trip, kind, slot])).rows[0]!;

export interface AddOptions {
  readonly mime?: string;
  readonly body?: Buffer;
  /** Heure de l'appareil (indice conservé, jamais crue) ; `null` : absente ; défaut : `null`. */
  readonly device?: string | null;
  readonly kind?: string;
}

/** Ajout d'une photo à un angle avec le jeton `captureId` (issue de la commande). */
export async function addPhoto(
  tx: Tx,
  who: Buffer,
  trip: string,
  captureId: unknown,
  slot: string,
  o: AddOptions = {},
): Promise<Row> {
  const body = o.body ?? randomBytes(64);
  return (
    await tx.query<Row>(ADD, [
      who,
      trip,
      o.kind ?? 'CHECKIN',
      captureId,
      slot,
      uuid(),
      o.mime ?? 'image/jpeg',
      body.length,
      sha(body),
      o.device === undefined ? null : o.device,
    ])
  ).rows[0]!;
}

/** Jeton puis photo d'un angle (issue de la commande d'ajout). */
export async function shoot(
  tx: Tx,
  who: Buffer,
  trip: string,
  slot: string,
  o: AddOptions = {},
): Promise<Row> {
  const cap = await capture(tx, who, trip, slot, o.kind ?? 'CHECKIN');
  expect(cap['outcome'], slot).toBe('DONE');
  return addPhoto(tx, who, trip, cap['capture_id'], slot, o);
}

/** Série de photos d'une partie par les VRAIES commandes d'US-303 (jeton puis photo par angle). */
export async function series(
  tx: Tx,
  who: Buffer,
  trip: string,
  kind: 'CHECKIN' | 'CHECKOUT',
  slots: readonly string[] = REQUIRED,
): Promise<void> {
  for (const slot of slots) {
    const r = await shoot(tx, who, trip, slot, { kind });
    expect(r['outcome'], slot).toBe('DONE');
  }
}

export const submit = async (tx: Tx, who: Buffer, trip: string, kind: string): Promise<Row> =>
  (await tx.query<Row>(SUBMIT, [who, trip, kind])).rows[0]!;

export const viewOf = async (tx: Tx, sql: string, args: readonly unknown[]): Promise<Row> =>
  (await tx.query<{ v: Row }>(sql, args as unknown[])).rows[0]!.v;

export const open = async (tx: Tx, who: Buffer, trip: string): Promise<Row> =>
  (await tx.query<Row>(OPEN_CHECKIN, [who, trip])).rows[0]!;

export async function identity(
  tx: Tx,
  who: Buffer,
  trip: string,
  checklist: unknown,
  subreason: string | null = null,
): Promise<Row> {
  return (await tx.query<Row>(IDENTITY, [who, trip, JSON.stringify(checklist), subreason]))
    .rows[0]!;
}

export async function validate(
  tx: Tx,
  who: Buffer,
  trip: string,
  kind: string,
  odometer: number | null,
  fuel: number | null,
  method = 'IN_PERSON',
): Promise<Row> {
  return (await tx.query<Row>(VALIDATE, [who, trip, kind, odometer, fuel, method])).rows[0]!;
}

export const records = async (tx: Tx, trip: string): Promise<Row> =>
  (await tx.query<{ r: Row }>('SELECT test_fixture.us315_records($1) AS r', [trip])).rows[0]!.r;

/** Départ complet par les vraies commandes : ouverture, deux séries, permis, deux validations. */
export async function departed(tx: Tx, w: World): Promise<void> {
  expect((await open(tx, w.h, w.trip))['outcome']).toBe('DONE');
  await series(tx, w.h, w.trip, 'CHECKIN');
  await series(tx, w.g, w.trip, 'CHECKIN');
  expect((await submit(tx, w.h, w.trip, 'CHECKIN'))['outcome']).toBe('DONE');
  expect((await submit(tx, w.g, w.trip, 'CHECKIN'))['outcome']).toBe('DONE');
  expect((await identity(tx, w.h, w.trip, ALL_OK))['outcome']).toBe('DONE');
  expect((await validate(tx, w.h, w.trip, 'CHECKIN', 42000, 8))['outcome']).toBe('DONE');
  expect((await validate(tx, w.g, w.trip, 'CHECKIN', 42000, 8))['trip_status']).toBe('IN_PROGRESS');
}

/** Transaction ANNULÉE sous app_api à l'instant virtuel `virtualNow`. */
export const rolledBack = (virtualNow: string, body: (tx: Tx) => Promise<void>): Promise<void> =>
  withRole('app_api', (client) => withTestTransaction(client, { virtualNow }, body));

/** Erreur d'une instruction, isolée par un point de sauvegarde (la transaction continue). */
export async function failure(
  tx: Tx,
  text: string,
  values: readonly unknown[] = [],
): Promise<{ code: string | undefined; constraint: string | undefined } | null> {
  await tx.query('SAVEPOINT rt_l3');
  try {
    await tx.query(text, values as unknown[]);
    await tx.query('RELEASE SAVEPOINT rt_l3');
    return null;
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT rt_l3');
    const e = error as { code?: string; constraint?: string };
    return { code: e.code, constraint: e.constraint };
  }
}
