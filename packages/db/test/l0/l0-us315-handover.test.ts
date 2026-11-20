/**
 * US-315 — remise et retour du véhicule entre particuliers, en personne (migration 0163, ADR-183 ;
 * fixture 9924, et 9948, 9963, 9976, 9997 réutilisées). Rôles de PRODUCTION seulement (assertion
 * L0-05 par `withRole`), au Panama (USD) et au Paraguay (PYG sans décimale).
 *
 * Attendus tirés de 19 US-315 (critères 1, 2, 3, 4, 6), de 16 TRP-002 (ouverture 24 h avant le
 * début ; CHECKIN_NOT_OPEN, CHECKIN_PAYMENT_NOT_CONFIRMED, CHECKIN_STEP_INCOMPLETE,
 * CONTRACT_NOT_SIGNED ; « paiement confirmé et caution autorisée » ; « Given les deux validations,
 * When la dernière est reçue, Then IN_PROGRESS prend l'heure serveur »), de 16 VER-015 (6 points,
 * CHECKIN_LICENSE_CHECK_INCOMPLETE ; jamais le numéro ni l'image d'une pièce), de 16 TRP-033
 * (« heure serveur = fin effective »), de 10b UX-37 (prénom, initiale du nom, année de naissance)
 * et du pré-mortem du lot 3 (L3-PM-08 : chaque condition seule, avec témoin ; L3-PM-09 : heure
 * serveur ; L3-PM-10 : deux connexions ; L3-PM-12 : sans rencontre refusée ; L3-PM-13 : occupation
 * libérée par la commande), jamais du code testé.
 *
 * Interrupteurs : `insurer_contract_active` n'est ouvert que par la procédure à deux personnes
 * d'US-125, dans une transaction ANNULÉE (règle de `support/golive.ts`). La preuve de concurrence
 * (données validées) porte sur le retour, qui ne lit aucun interrupteur ; le départ passe par la
 * même commande et les mêmes verrous.
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { SubjectKeyStore } from '../../src/audit/index.ts';
import { FakeKeyWrapper, withRole, withTestTransaction } from '../../src/testing/index.ts';
import { setActor } from '../support/audit.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';
import { approveSwitch, freshSession, requestSwitch } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { openSession, setVirtualNow } from '../support/iam.ts';
import { staff as rlsStaff, staffSessionHash } from '../support/rls.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

// début du trip à 10:00 serveur ; ouverture permise à 24 h (08 BR-PICKUP-01) ; retour à 10:20
const START = '2035-06-11T10:00:00.000Z';
const END = '2035-06-14T10:00:00.000Z';
const BEFORE_OPEN = '2035-06-10T09:59:59.000Z';
const OPENS = '2035-06-10T10:00:00.000Z';
const RETURN_AT = '2035-06-14T10:20:00.000Z';
const LINES: Readonly<Record<string, readonly { type: string; amountMinor: string }[]>> = {
  USD: [{ type: 'TRIP_PRICE', amountMinor: '12000' }],
  PYG: [{ type: 'TRIP_PRICE', amountMinor: '1000000' }],
};
/** 17 §3.2.10 : gabarit minimal (16 TRP-004). */
const REQUIRED = [
  ...Array.from({ length: 15 }, (_, i) => `EXT_${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, i) => `INT_${String(i + 1).padStart(2, '0')}`),
  'FUEL',
  'ODOMETER',
];
const ALL_OK = {
  face: true,
  name: true,
  birthYear: true,
  valid: true,
  provisional: true,
  restrictions: true,
};

const VIEW = 'SELECT core.trip_handover_view($1, $2::uuid, $3) AS v';
const OPEN = 'SELECT * FROM core.trip_cmd_open_checkin($1, $2::uuid)';
const IDENTITY = 'SELECT * FROM core.trip_cmd_identity_check($1, $2::uuid, $3::jsonb, $4)';
const VALIDATE =
  'SELECT * FROM core.trip_cmd_validate_handover($1, $2::uuid, $3, $4::integer, $5::integer, $6)';
const CAPTURE = 'SELECT * FROM core.trip_cmd_open_photo_capture($1, $2::uuid, $3, $4)';
const ADD = `SELECT * FROM core.trip_cmd_add_inspection_photo($1, $2::uuid, $3, $4::uuid, $5, $6::uuid,
                                                              $7, $8::bigint, $9, $10::timestamptz)`;
const SUBMIT = 'SELECT * FROM core.trip_cmd_submit_inspection($1, $2::uuid, $3)';

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);
/** Heure d'un champ jsonb (texte ISO du serveur) au format de comparaison. */
const at = (v: unknown): string | null =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
/** Clés remises relues (heures comparées en ISO). */
const keysOf = (r: Row): Row[] => (r['keys'] as Row[]).map((k) => ({ ...k, at: at(k['at']) }));
const sha = (b: Buffer): Buffer => createHash('sha256').update(b).digest();

interface World {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
  readonly g: Buffer;
  readonly h: Buffer;
}

interface Ready {
  readonly proof?: 'WEBHOOK_SIGNED' | 'POLL' | null;
  readonly deposit?: 'NOT_REQUIRED' | 'PLANNED' | 'AUTHORIZED' | null;
  readonly contract?: boolean;
}

/** Trip BOOKED (9948), contrat signé (9963), paiement prouvé et caution (9924) selon `r`. */
async function world(tx: Tx, c: CountryCase, r: Ready = {}): Promise<World> {
  const guest = uuid();
  const { rows } = await tx.query<{ trip_id: string; holder_id: string }>(
    `SELECT * FROM test_fixture.us214_trip($1, $2, 'Ana', 'Pérez', 'María', 'Gómez', $3, $4,
                                           $5::jsonb)`,
    [c.country, guest, START, END, JSON.stringify(LINES[c.currency])],
  );
  const trip = rows[0]!.trip_id;
  const holder = rows[0]!.holder_id;
  const amount = LINES[c.currency]![0]!.amountMinor;
  await tx.query('SELECT test_fixture.us315_payment($1, $2, $3::bigint)', [
    trip,
    r.proof === undefined ? 'WEBHOOK_SIGNED' : r.proof,
    amount,
  ]);
  await tx.query('SELECT test_fixture.us315_deposit($1, $2, $3::bigint)', [
    trip,
    r.deposit === undefined ? 'NOT_REQUIRED' : r.deposit,
    amount,
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

/** Interrupteur ouvert par la procédure à deux personnes d'US-125 (transaction ANNULÉE). */
async function openInsurer(tx: Tx, country: string): Promise<void> {
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

/** Clés USER des deux parties (dépôt des photos, US-303). */
async function subjectKeys(tx: Tx, w: World): Promise<void> {
  for (const [kind, id] of [
    ['GUEST', w.guest],
    ['HOST', w.holder],
  ] as const) {
    await setActor(tx, { kind, actorId: id });
    const k = await keys.dekFor(tx, { type: 'USER', id }, 'create');
    if (k.status !== 'OK') throw new Error(`clé du sujet : ${k.status}`);
  }
}

/** Série de photos d'une partie par les VRAIES commandes d'US-303 (jeton puis photo par angle). */
async function series(
  tx: Tx,
  who: Buffer,
  trip: string,
  kind: 'CHECKIN' | 'CHECKOUT',
  slots: readonly string[] = REQUIRED,
): Promise<void> {
  for (const slot of slots) {
    const cap = (await tx.query<Row>(CAPTURE, [who, trip, kind, slot])).rows[0]!;
    expect(cap['outcome'], slot).toBe('DONE');
    const body = randomBytes(64);
    const r = (
      await tx.query<Row>(ADD, [
        who,
        trip,
        kind,
        cap['capture_id'],
        slot,
        uuid(),
        'image/jpeg',
        body.length,
        sha(body),
        null,
      ])
    ).rows[0]!;
    expect(r['outcome'], slot).toBe('DONE');
  }
}

async function submit(tx: Tx, who: Buffer, trip: string, kind: string): Promise<Row> {
  return (await tx.query<Row>(SUBMIT, [who, trip, kind])).rows[0]!;
}

async function view(tx: Tx, who: Buffer, trip: string, kind: string): Promise<Row> {
  return (await tx.query<{ v: Row }>(VIEW, [who, trip, kind])).rows[0]!.v;
}

async function open(tx: Tx, who: Buffer, trip: string): Promise<Row> {
  return (await tx.query<Row>(OPEN, [who, trip])).rows[0]!;
}

async function identity(
  tx: Tx,
  who: Buffer,
  trip: string,
  checklist: unknown,
  subreason: string | null = null,
): Promise<Row> {
  return (await tx.query<Row>(IDENTITY, [who, trip, JSON.stringify(checklist), subreason]))
    .rows[0]!;
}

async function validate(
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

async function records(tx: Tx, trip: string): Promise<Row> {
  return (await tx.query<{ r: Row }>('SELECT test_fixture.us315_records($1) AS r', [trip])).rows[0]!
    .r;
}

/** Départ complet par les vraies commandes : ouverture, permis, deux séries, deux validations. */
async function departed(tx: Tx, w: World): Promise<void> {
  expect((await open(tx, w.h, w.trip))['outcome']).toBe('DONE');
  await series(tx, w.h, w.trip, 'CHECKIN');
  await series(tx, w.g, w.trip, 'CHECKIN');
  expect((await submit(tx, w.h, w.trip, 'CHECKIN'))['outcome']).toBe('DONE');
  expect((await submit(tx, w.g, w.trip, 'CHECKIN'))['outcome']).toBe('DONE');
  expect((await identity(tx, w.h, w.trip, ALL_OK))['outcome']).toBe('DONE');
  expect((await validate(tx, w.h, w.trip, 'CHECKIN', 42000, 8))['outcome']).toBe('DONE');
  expect((await validate(tx, w.g, w.trip, 'CHECKIN', 42000, 8))['trip_status']).toBe('IN_PROGRESS');
}

const rolledBack = (at: string, body: (tx: Tx) => Promise<void>) =>
  withRole('app_api', (client) => withTestTransaction(client, { virtualNow: at }, body));

describe.each(COUNTRIES)(
  'US-315 — remise et retour entre particuliers ($country, $currency)',
  (c) => {
    it('critère 1 et L3-PM-08 : ouverture bloquée sans webhook signé, contrat, caution, assureur ; restriction ; fenêtre de 24 h ; chaque condition seule, avec témoin', async () => {
      await rolledBack(BEFORE_OPEN, async (tx) => {
        const ok = await world(tx, c);
        const stranger = await world(tx, c);
        const cases: readonly [string, Ready, string][] = [
          ['aucun paiement', { proof: null }, 'CHECKIN_PAYMENT_NOT_CONFIRMED'],
          ['preuve POLL, pas de webhook signé', { proof: 'POLL' }, 'CHECKIN_PAYMENT_NOT_CONFIRMED'],
          ['contrat non signé', { contract: false }, 'CONTRACT_NOT_SIGNED'],
          ['aucune décision de caution', { deposit: null }, 'DEPOSIT_NOT_READY'],
          ['caution exigée non autorisée', { deposit: 'PLANNED' }, 'DEPOSIT_NOT_READY'],
        ];
        const worlds = [] as [string, World, string][];
        for (const [label, r, code] of cases) worlds.push([label, await world(tx, c, r), code]);
        const guestRestricted = await world(tx, c);
        await tx.query('SELECT test_fixture.us315_restrict($1)', [guestRestricted.guest]);
        const hostRestricted = await world(tx, c);
        await tx.query('SELECT test_fixture.us315_restrict($1)', [hostRestricted.holder]);
        const authorized = await world(tx, c, { deposit: 'AUTHORIZED' });

        // fenêtre : 24 h avant le début, pas une seconde plus tôt (16 TRP-002)
        expect(await open(tx, ok.h, ok.trip)).toMatchObject({ outcome: 'CHECKIN_NOT_OPEN' });
        expect((await view(tx, ok.h, ok.trip, 'CHECKIN'))['canOpen']).toBe(false);
        // une autre personne, un autre hôte : NOT_FOUND (même réponse qu'un trip inconnu)
        expect(await open(tx, stranger.h, ok.trip)).toMatchObject({ outcome: 'NOT_FOUND' });
        expect(await open(tx, ok.h, uuid())).toMatchObject({ outcome: 'NOT_FOUND' });
        expect(await view(tx, stranger.g, ok.trip, 'CHECKIN')).toEqual({ outcome: 'NOT_FOUND' });

        await setVirtualNow(tx, OPENS);
        // assureur : interrupteur false (état de production) ⇒ bloqué, avec la cause
        expect(await open(tx, ok.h, ok.trip)).toMatchObject({
          outcome: 'INSURER_CONTRACT_INACTIVE',
        });
        expect((await view(tx, ok.h, ok.trip, 'CHECKIN'))['blockers']).toEqual([
          'INSURER_CONTRACT_INACTIVE',
        ]);
        await openInsurer(tx, c.country);
        await setVirtualNow(tx, OPENS);

        for (const [label, w, code] of worlds) {
          expect(await open(tx, w.h, w.trip), label).toMatchObject({ outcome: code });
          expect((await view(tx, w.h, w.trip, 'CHECKIN'))['blockers'], label).toEqual([code]);
          expect((await records(tx, w.trip))['status'], label).toBe('BOOKED');
        }
        // restriction du voyageur ou de l'hôte : bloqué, sans dire laquelle à l'autre partie
        for (const w of [guestRestricted, hostRestricted]) {
          expect(await open(tx, w.h, w.trip)).toMatchObject({ outcome: 'HANDOVER_BLOCKED' });
          expect(await open(tx, w.g, w.trip)).toMatchObject({ outcome: 'HANDOVER_BLOCKED' });
          expect((await records(tx, w.trip))['status']).toBe('BOOKED');
        }

        // témoins : tout est réuni (caution non exigée, ou exigée et autorisée) ⇒ ouvert, à l'heure
        // serveur ; le voyageur peut aussi ouvrir ; une seconde ouverture rend la première
        const v = await view(tx, ok.h, ok.trip, 'CHECKIN');
        expect(v).toMatchObject({
          outcome: 'OK',
          canOpen: true,
          blockers: [],
          tripStatus: 'BOOKED',
        });
        expect(at(v['opensAt'])).toBe(OPENS);
        const opened = await open(tx, ok.h, ok.trip);
        expect(opened['outcome']).toBe('DONE');
        expect(iso(opened['opened_at'])).toBe(OPENS);
        await setVirtualNow(tx, '2035-06-10T10:05:00.000Z');
        const again = await open(tx, ok.g, ok.trip);
        expect(again['outcome']).toBe('ALREADY_OPEN');
        expect(iso(again['opened_at'])).toBe(OPENS);
        expect((await open(tx, authorized.g, authorized.trip))['outcome']).toBe('DONE');
        expect((await records(tx, ok.trip))['status']).toBe('CHECKIN_OPEN');
      });
    });

    it('critères 2, 3 et 6 : permis en 6 points sans donnée de la pièce ; une série incomplète bloque ; début = heure serveur de la seconde validation ; sans rencontre refusée', async () => {
      await rolledBack(OPENS, async (tx) => {
        await openInsurer(tx, c.country);
        await setVirtualNow(tx, OPENS);
        const w = await world(tx, c);
        await tx.query('SELECT test_fixture.us315_birth($1, $2::date)', [w.guest, '1990-04-12']);
        await subjectKeys(tx, w);
        // avant l'ouverture : aucune donnée du voyageur à l'hôte
        expect((await view(tx, w.h, w.trip, 'CHECKIN'))['guest']).toBeNull();
        expect((await open(tx, w.g, w.trip))['outcome']).toBe('DONE');

        // critère 2 : l'hôte voit le prénom, l'initiale du nom et l'année de naissance, rien d'autre
        const hv = await view(tx, w.h, w.trip, 'CHECKIN');
        expect(hv['guest']).toEqual({ firstName: 'Ana', lastInitial: 'P', birthYear: 1990 });
        const text = JSON.stringify(hv);
        for (const leak of ['Pérez', '1990-04-12', '04-12', 'license', 'document', '@']) {
          expect(text, leak).not.toContain(leak);
        }
        expect(hv['identityCheck']).toEqual({ status: 'PENDING', checkedAt: null });
        expect((await view(tx, w.g, w.trip, 'CHECKIN'))['guest']).toBeNull();
        // critère 6 : la remise sans rencontre n'est jamais proposée
        expect(hv['contactlessOffered']).toBe(false);

        // le contrôle est celui de l'hôte ; forme stricte (six booléens)
        expect(await identity(tx, w.g, w.trip, ALL_OK)).toMatchObject({ outcome: 'HOST_ONLY' });
        const five = {
          face: true,
          name: true,
          birthYear: true,
          valid: true,
          provisional: true,
        };
        expect(await identity(tx, w.h, w.trip, five)).toMatchObject({
          outcome: 'CHECKIN_LICENSE_CHECK_INCOMPLETE',
        });
        expect(await identity(tx, w.h, w.trip, { ...ALL_OK, face: 'yes' })).toMatchObject({
          outcome: 'CHECKIN_LICENSE_CHECK_INCOMPLETE',
        });
        expect(await identity(tx, w.h, w.trip, { ...ALL_OK, licenseNumber: true })).toMatchObject({
          outcome: 'CHECKIN_LICENSE_CHECK_INCOMPLETE',
        });

        // critère 3 : l'hôte, série complète ; le voyageur, 24 angles sur 25
        await series(tx, w.h, w.trip, 'CHECKIN');
        expect((await submit(tx, w.h, w.trip, 'CHECKIN'))['outcome']).toBe('DONE');
        await series(
          tx,
          w.g,
          w.trip,
          'CHECKIN',
          REQUIRED.filter((s) => s !== 'ODOMETER'),
        );
        expect((await submit(tx, w.g, w.trip, 'CHECKIN'))['outcome']).toBe(
          'PHOTO_TEMPLATE_INCOMPLETE',
        );
        expect(await validate(tx, w.g, w.trip, 'CHECKIN', 42000, 8)).toMatchObject({
          outcome: 'CHECKIN_STEP_INCOMPLETE',
        });
        // l'hôte ne remet pas les clés avant le contrôle du permis
        expect(await validate(tx, w.h, w.trip, 'CHECKIN', 42000, 8)).toMatchObject({
          outcome: 'CHECKIN_LICENSE_CHECK_INCOMPLETE',
        });
        const checked = await identity(tx, w.h, w.trip, ALL_OK);
        expect(checked).toMatchObject({ outcome: 'DONE', status: 'TRIP_ID_OK' });
        expect(iso(checked['checked_at'])).toBe(OPENS);
        expect(await identity(tx, w.h, w.trip, { ...ALL_OK, face: false })).toMatchObject({
          outcome: 'ALREADY_CHECKED',
          status: 'TRIP_ID_OK',
        });
        // critère 6 : sans rencontre refusée ; relevés hors bornes refusés ; rien n'est écrit
        expect(await validate(tx, w.h, w.trip, 'CHECKIN', 42000, 8, 'CONTACTLESS')).toMatchObject({
          outcome: 'CONTACTLESS_UNAVAILABLE',
        });
        expect(await validate(tx, w.h, w.trip, 'CHECKIN', 42000, 9)).toMatchObject({
          outcome: 'READING_INVALID',
        });
        expect(await validate(tx, w.h, w.trip, 'CHECKIN', -1, 8)).toMatchObject({
          outcome: 'READING_INVALID',
        });
        expect((await records(tx, w.trip))['validations']).toEqual([]);

        // première validation (l'hôte, 10:10) : rien ne change d'état
        await setVirtualNow(tx, '2035-06-10T10:10:00.000Z');
        const first = await validate(tx, w.h, w.trip, 'CHECKIN', 42000, 8);
        expect(first).toMatchObject({
          outcome: 'DONE',
          completed_at: null,
          trip_status: 'CHECKIN_OPEN',
        });
        expect((await records(tx, w.trip))['status']).toBe('CHECKIN_OPEN');
        expect((await view(tx, w.g, w.trip, 'CHECKIN'))['validations']).toMatchObject({
          mine: null,
          other: { odometerKm: 42000, fuelEighths: 8 },
        });

        // seconde validation (le voyageur, série complétée, 10:30 serveur) : IN_PROGRESS à 10:30
        await series(tx, w.g, w.trip, 'CHECKIN', ['ODOMETER']);
        expect((await submit(tx, w.g, w.trip, 'CHECKIN'))['outcome']).toBe('DONE');
        const SECOND = '2035-06-10T10:30:00.000Z';
        await setVirtualNow(tx, SECOND);
        const second = await validate(tx, w.g, w.trip, 'CHECKIN', 42001, 8);
        expect(second).toMatchObject({ outcome: 'DONE', trip_status: 'IN_PROGRESS' });
        expect(iso(second['validated_at'])).toBe(SECOND);
        expect(iso(second['completed_at'])).toBe(SECOND);
        const r = await records(tx, w.trip);
        expect(r).toMatchObject({ status: 'IN_PROGRESS', transitions: 1 });
        // remise faite : l'hôte ne lit plus les données du voyageur
        expect((await view(tx, w.h, w.trip, 'CHECKIN'))['guest']).toBeNull();
        expect(at(r['checkinValidatedAt'])).toBe(SECOND);
        expect(r['identity']).toEqual({
          status: 'TRIP_ID_OK',
          checklist: ALL_OK,
          subreason: null,
          checkedBy: w.holder,
        });
        expect(keysOf(r)).toEqual([
          { direction: 'OUT', method: 'IN_PERSON', at: SECOND, by: w.holder },
        ]);
        // idempotence : l'heure d'origine, une seule transition
        await setVirtualNow(tx, '2035-06-10T11:00:00.000Z');
        for (const who of [w.g, w.h]) {
          const replay = await validate(tx, who, w.trip, 'CHECKIN', 1, 0);
          expect(replay['outcome']).toBe('ALREADY_VALIDATED');
          expect(iso(replay['completed_at'])).toBe(SECOND);
        }
        expect((await records(tx, w.trip))['transitions']).toBe(1);
        expect(at((await view(tx, w.h, w.trip, 'CHECKIN'))['completedAt'])).toBe(SECOND);
      });
    });

    it('critère 4 : retour à 10:20 serveur ⇒ fin effective 10:20, RETURNED une seule fois, occupations libérées par la commande, clés rendues', async () => {
      await rolledBack(OPENS, async (tx) => {
        await openInsurer(tx, c.country);
        await setVirtualNow(tx, OPENS);
        const w = await world(tx, c);
        await subjectKeys(tx, w);
        await departed(tx, w);
        expect(await records(tx, w.trip)).toMatchObject({
          vehicleOccupancyActive: 1,
          guestOccupancyActive: 1,
        });

        await setVirtualNow(tx, '2035-06-14T10:00:00.000Z');
        expect(await validate(tx, w.h, w.trip, 'CHECKOUT', 42500, 6)).toMatchObject({
          outcome: 'CHECKOUT_STEP_INCOMPLETE',
        });
        await series(tx, w.h, w.trip, 'CHECKOUT');
        await series(tx, w.g, w.trip, 'CHECKOUT');
        expect((await submit(tx, w.h, w.trip, 'CHECKOUT'))['outcome']).toBe('DONE');
        expect((await submit(tx, w.g, w.trip, 'CHECKOUT'))['outcome']).toBe('DONE');
        // compteur du retour inférieur à celui que la partie a relevé au départ : refusé
        expect(await validate(tx, w.h, w.trip, 'CHECKOUT', 41999, 6)).toMatchObject({
          outcome: 'READING_INVALID',
        });
        await setVirtualNow(tx, '2035-06-14T10:15:00.000Z');
        expect(await validate(tx, w.h, w.trip, 'CHECKOUT', 42500, 6)).toMatchObject({
          outcome: 'DONE',
          completed_at: null,
          trip_status: 'IN_PROGRESS',
        });
        expect((await records(tx, w.trip))['vehicleOccupancyActive']).toBe(1);
        await setVirtualNow(tx, RETURN_AT);
        const back = await validate(tx, w.g, w.trip, 'CHECKOUT', 42501, 6);
        expect(back).toMatchObject({ outcome: 'DONE', trip_status: 'RETURNED' });
        expect(iso(back['completed_at'])).toBe(RETURN_AT);
        const r = await records(tx, w.trip);
        expect(r).toMatchObject({
          status: 'RETURNED',
          transitions: 2,
          vehicleOccupancyActive: 0,
          guestOccupancyActive: 0,
        });
        expect(at(r['returnedAt'])).toBe(RETURN_AT);
        expect(keysOf(r).at(-1)).toEqual({
          direction: 'IN',
          method: 'IN_PERSON',
          at: RETURN_AT,
          by: w.guest,
        });
        // rejeu plus tard : heure d'origine ; aucune seconde transition ; le départ est fermé
        await setVirtualNow(tx, '2035-06-14T12:00:00.000Z');
        const replay = await validate(tx, w.g, w.trip, 'CHECKOUT', 1, 0);
        expect(replay['outcome']).toBe('ALREADY_VALIDATED');
        expect(iso(replay['completed_at'])).toBe(RETURN_AT);
        expect((await records(tx, w.trip))['transitions']).toBe(2);
        expect(at((await view(tx, w.h, w.trip, 'CHECKOUT'))['completedAt'])).toBe(RETURN_AT);
        expect((await open(tx, w.h, w.trip))['outcome']).toBe('CHECKIN_NOT_OPEN');
      });
    });

    it('critère 2 : un point non conforme ⇒ TRIP_ID_FAILED définitif ; la remise ne passe plus', async () => {
      await rolledBack(OPENS, async (tx) => {
        await openInsurer(tx, c.country);
        await setVirtualNow(tx, OPENS);
        const w = await world(tx, c);
        await subjectKeys(tx, w);
        expect((await open(tx, w.h, w.trip))['outcome']).toBe('DONE');
        expect(
          await identity(tx, w.h, w.trip, { ...ALL_OK, face: false }, 'WRONG_REASON'),
        ).toMatchObject({ outcome: 'REQUEST_INVALID' });
        expect(await identity(tx, w.h, w.trip, ALL_OK, 'INVALID_LICENSE')).toMatchObject({
          outcome: 'REQUEST_INVALID',
        });
        expect(
          await identity(tx, w.h, w.trip, { ...ALL_OK, face: false }, 'OTHER_DRIVER_SENT'),
        ).toMatchObject({ outcome: 'DONE', status: 'TRIP_ID_FAILED' });
        expect(await identity(tx, w.h, w.trip, ALL_OK)).toMatchObject({
          outcome: 'ALREADY_CHECKED',
          status: 'TRIP_ID_FAILED',
        });
        await series(tx, w.h, w.trip, 'CHECKIN');
        await series(tx, w.g, w.trip, 'CHECKIN');
        expect((await submit(tx, w.h, w.trip, 'CHECKIN'))['outcome']).toBe('DONE');
        expect((await submit(tx, w.g, w.trip, 'CHECKIN'))['outcome']).toBe('DONE');
        for (const who of [w.h, w.g]) {
          expect(await validate(tx, who, w.trip, 'CHECKIN', 42000, 8)).toMatchObject({
            outcome: 'IDENTITY_CHECK_FAILED',
          });
        }
        const r = await records(tx, w.trip);
        expect(r).toMatchObject({ status: 'CHECKIN_OPEN', transitions: 0, validations: [] });
        expect(r['identity']).toMatchObject({
          status: 'TRIP_ID_FAILED',
          subreason: 'OTHER_DRIVER_SENT',
        });
        expect((await view(tx, w.g, w.trip, 'CHECKIN'))['identityCheck']).toMatchObject({
          status: 'FAILED',
        });
      });
    });

    it('L3-PM-10 : deux connexions valident le retour en même temps ⇒ la seconde attend le verrou, une seule transition RETURNED', async () => {
      const AT = '2035-06-14T10:20:00.000Z';
      let w: World | null = null;
      await withRole('app_api', (client) =>
        withTestTransaction(client, { virtualNow: AT, commit: true }, async (tx) => {
          const x = await world(tx, c);
          await subjectKeys(tx, x);
          await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [x.trip, 'IN_PROGRESS']);
          await series(tx, x.h, x.trip, 'CHECKOUT');
          await series(tx, x.g, x.trip, 'CHECKOUT');
          expect((await submit(tx, x.h, x.trip, 'CHECKOUT'))['outcome']).toBe('DONE');
          expect((await submit(tx, x.g, x.trip, 'CHECKOUT'))['outcome']).toBe('DONE');
          w = x;
        }),
      );
      const x = w as World | null;
      if (x === null) throw new Error('monde absent');
      await withRole('app_api', (a) =>
        withRole('app_api', async (b) => {
          await a.query('BEGIN');
          await b.query('BEGIN');
          try {
            // A à l'heure virtuelle ; B à l'horloge réelle (platform.now() = clock_timestamp()) : son heure
            // doit être lue APRÈS l'attente du verrou (17 §1.3 point 1)
            await a.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [AT]);
            const firstA = await validate(a, x.h, x.trip, 'CHECKOUT', 42500, 6);
            expect(firstA).toMatchObject({ outcome: 'DONE', completed_at: null });
            const pidB = await backendPid(b);
            const pending = validate(b, x.g, x.trip, 'CHECKOUT', 42500, 6);
            await waitUntilBlocked(a, pidB, 'advisory');
            // instant de la base pendant que B attend : l'heure de B doit être postérieure
            const waited = (await a.query<{ t: Date }>('SELECT pg_catalog.clock_timestamp() AS t'))
              .rows[0]!.t;
            await a.query('COMMIT');
            const second = await pending;
            expect(second).toMatchObject({ outcome: 'DONE', trip_status: 'RETURNED' });
            const at2 = second['validated_at'] as Date;
            expect(at2.getTime()).toBeGreaterThan(waited.getTime());
            expect((second['completed_at'] as Date).getTime()).toBeGreaterThanOrEqual(
              at2.getTime(),
            );
            await b.query('COMMIT');
          } catch (error) {
            await a.query('ROLLBACK').catch(() => undefined);
            await b.query('ROLLBACK').catch(() => undefined);
            throw error;
          }
        }),
      );
      await withRole('app_api', (client) =>
        withTestTransaction(client, { virtualNow: AT }, async (tx) => {
          const r = await records(tx, x.trip);
          expect(r).toMatchObject({
            status: 'RETURNED',
            transitions: 1,
            vehicleOccupancyActive: 0,
            guestOccupancyActive: 0,
          });
          expect(r['validations']).toHaveLength(2);
          expect(r['keys']).toHaveLength(1);
        }),
      );
    });
  },
);

describe('US-315 — tables de la remise', () => {
  it('RLS : aucune lecture ni écriture directe par les rôles applicatifs ; registres en ajout seul', async () => {
    for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const table of [
          'core.trip_ops_identity_check',
          'core.trip_ops_handover_validation',
          'core.trip_ops_key_handover',
        ]) {
          await expect(
            client.query(`SELECT 1 FROM ${table} LIMIT 1`),
            `${role} ${table}`,
          ).rejects.toMatchObject({ code: '42501' });
          await expect(
            client.query(`DELETE FROM ${table}`),
            `${role} ${table}`,
          ).rejects.toMatchObject({ code: '42501' });
        }
        // les commandes ne s'exécutent que sous app_api
        if (role !== 'app_api') {
          await expect(
            client.query(VALIDATE, [Buffer.alloc(32), uuid(), 'CHECKIN', 1, 1, 'IN_PERSON']),
          ).rejects.toMatchObject({ code: '42501' });
        }
      });
    }
    const c = COUNTRIES[0];
    await rolledBack(OPENS, async (tx) => {
      await openInsurer(tx, c.country);
      await setVirtualNow(tx, OPENS);
      const w = await world(tx, c);
      await subjectKeys(tx, w);
      await departed(tx, w);
      for (const sql of [
        'SELECT test_fixture.us315_try_update($1)',
        'SELECT test_fixture.us315_try_delete($1)',
      ]) {
        await tx.query('SAVEPOINT s');
        await expect(tx.query(sql, [w.trip]), sql).rejects.toMatchObject({
          code: '23000',
          constraint: 'trip_handover_immutable',
        });
        await tx.query('ROLLBACK TO SAVEPOINT s');
      }
    });
  });
});
