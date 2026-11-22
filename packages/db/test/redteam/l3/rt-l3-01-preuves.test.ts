/**
 * US-313 — red team du lot 3, axe « preuves et remise » (19 US-313 critère 2 ; pré-mortem du lot 3,
 * RT-L3-P01, P02, P03, RM02, RM04 ; risques L3-PM-01, 02, 03, 09, 11). Rôles de PRODUCTION seulement
 * (`withRole` : assertion L0-05 en tête de chaque test), USD (PA) et PYG sans décimale (PY),
 * transactions ANNULÉES, horloge virtuelle 2090 (aucune autre preuve ne l'utilise). TESTS SEULEMENT :
 * aucun correctif, aucune migration, aucune fixture (la passe de correctifs est une autre PR, sur
 * une autre famille d'auteurs). Rapport : docs/team/redteam/L3-preuves.md.
 *
 * Règles de jeu : un test vert prouve que l'attaque est BLOQUÉE. Un défaut est prouvé par un
 * `it.fails` nommé par son constat (`F-L3-PRE-nn`), doublé d'un test vert « observation » qui
 * affirme que l'attaque a bien eu lieu et note l'issue (une observation absente fait rougir
 * l'`it.fails` : jamais un vert pour une mauvaise raison). Chaque `it.fails` juge le SIGNAL ATTENDU
 * après correction, jamais l'issue brute.
 *
 * Attendus (jamais le code testé) :
 * - 16 TRP-004 et 19 US-303 (photo prise dans l'application, jeton à usage unique, heure SERVEUR ;
 *   « l'empreinte du fichier stocké égale celle enregistrée »), 08 BR-PICKUP-03 (métadonnées de la
 *   photo : indice seulement, jamais la source de l'heure) ;
 * - pré-mortem L3-PM-03 : « refus d'une empreinte SHA-256 déjà enregistrée (tous trips) » ;
 * - 19 US-315 critère 4 (« retour à 10:20 serveur ⇒ fin effective 10:20 », « heure serveur de la
 *   seconde validation »), contrainte 5 (`platform.now()` seul) ;
 * - 16 VER-015 (six points, jamais le numéro ni l'image d'une pièce), 10b UX-37 (prénom, initiale du
 *   nom, année de naissance), 16 TRP-002 (CHECKIN_LICENSE_CHECK_INCOMPLETE, IDENTITY_CHECK_FAILED).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { setActor } from '../../support/audit.ts';
import { COUNTRIES } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import {
  ALL_OK,
  VIEW_HANDOVER,
  VIEW_INSPECTION,
  addPhoto,
  at,
  bookedWorld,
  capture,
  checkinOpenWorld,
  departed,
  identity,
  iso,
  open,
  openInsurer,
  plus,
  records,
  rolledBack,
  series,
  setVirtualNow,
  shoot,
  submit,
  subjectKeys,
  uuid,
  validate,
  viewOf,
} from './support-l3.ts';
import type { Row } from './support-l3.ts';

// photos : départ en 2090
const T0 = '2090-05-02T09:17:23.000Z';
const P_START = '2090-06-10T15:00:00.000Z';
const P_END = '2090-06-13T15:00:00.000Z';
// remise : début à 10:00 serveur, ouverture permise 24 h avant, retour prévu le 14 à 10:00
const START = '2090-06-11T10:00:00.000Z';
const END = '2090-06-14T10:00:00.000Z';
const OPENS = '2090-06-10T10:00:00.000Z';

describe.each(COUNTRIES)('RT-L3 preuves de la remise ($country, $currency)', (c: CountryCase) => {
  // -------------------------------------------------------------------------------------------
  it('RT-L3-P01 / P02 (L3-PM-01, L3-PM-02) : photo antidatée, EXIF à J−2, heure de l’appareil fausse ou absente ⇒ heure SERVEUR seule ; jeton d’un autre trip, d’un autre angle ou d’une autre personne refusé', async () => {
    await rolledBack(T0, async (tx) => {
      const w = await checkinOpenWorld(tx, c, P_START, P_END);
      const other = await checkinOpenWorld(tx, c, P_START, P_END);
      await subjectKeys(tx, w);
      await subjectKeys(tx, other);

      // l'heure de l'appareil (EXIF, champ de la requête) est un indice : l'heure retenue est celle du
      // serveur, et l'écart d'horloge (plus de `clock_skew_flag_h` = 2 h) est signalé
      const lies: readonly [string, string | null, boolean][] = [
        ['EXT_01', '2001-01-01T00:00:00.000Z', true], // photo « ancienne »
        ['EXT_02', '2099-12-31T23:59:59.000Z', true], // horloge avancée
        ['EXT_03', plus(T0, -2 * 86_400), true], // EXIF à J−2 (BR-PICKUP-03 : au plus 24 h avant)
        ['EXT_04', null, true], // heure absente : signalée (fail-closed)
        ['EXT_05', plus(T0, -60), false], // témoin : heure cohérente, non signalée
      ];
      for (const [slot, device] of lies) {
        const r = await shoot(tx, w.g, w.trip, slot, { device });
        expect(r['outcome'], slot).toBe('DONE');
        expect(iso(r['received_at']), slot).toBe(T0);
      }
      // plus tard : la photo antidatée reçue à T0 + 90 s porte T0 + 90 s, jamais l'heure annoncée
      await setVirtualNow(tx, plus(T0, 90));
      const late = await shoot(tx, w.g, w.trip, 'EXT_06', { device: plus(T0, -3 * 86_400) });
      expect(late['outcome']).toBe('DONE');
      expect(iso(late['received_at'])).toBe(plus(T0, 90));
      await setVirtualNow(tx, T0);

      const v = await viewOf(tx, VIEW_INSPECTION, [w.h, w.trip, 'CHECKIN']);
      const guestSide = (v['sides'] as { role: string; photos: Row[] }[]).find(
        (s) => s.role === 'GUEST',
      );
      const skew = Object.fromEntries(
        (guestSide?.photos ?? []).map((p) => [String(p['slot']), p['clockSkew']]),
      );
      expect(skew).toEqual({
        EXT_01: true,
        EXT_02: true,
        EXT_03: true,
        EXT_04: true,
        EXT_05: false,
        EXT_06: true,
      });

      // jeton d'un autre trip : le voyageur du trip `w` présente le jeton émis pour le trip `other`
      const foreign = await capture(tx, other.g, other.trip, 'EXT_01');
      expect((await addPhoto(tx, w.g, w.trip, foreign['capture_id'], 'EXT_07'))['outcome']).toBe(
        'PHOTO_GALLERY_FORBIDDEN',
      );
      expect((await addPhoto(tx, w.g, w.trip, foreign['capture_id'], 'EXT_01'))['outcome']).toBe(
        'PHOTO_GALLERY_FORBIDDEN',
      );
      // jeton d'un autre angle, d'une autre personne (l'hôte), d'un autre type de série, inventé
      const mine = await capture(tx, w.g, w.trip, 'EXT_08');
      expect((await addPhoto(tx, w.g, w.trip, mine['capture_id'], 'EXT_09'))['outcome']).toBe(
        'PHOTO_GALLERY_FORBIDDEN',
      );
      expect((await addPhoto(tx, w.h, w.trip, mine['capture_id'], 'EXT_08'))['outcome']).toBe(
        'PHOTO_GALLERY_FORBIDDEN',
      );
      expect(
        (await addPhoto(tx, w.g, w.trip, mine['capture_id'], 'EXT_08', { kind: 'CHECKOUT' }))[
          'outcome'
        ],
      ).not.toBe('DONE');
      expect((await addPhoto(tx, w.g, w.trip, uuid(), 'EXT_08'))['outcome']).toBe(
        'PHOTO_GALLERY_FORBIDDEN',
      );
      // témoin : le jeton qui lui est propre passe, une seule fois
      expect((await addPhoto(tx, w.g, w.trip, mine['capture_id'], 'EXT_08'))['outcome']).toBe(
        'DONE',
      );
      expect((await addPhoto(tx, w.g, w.trip, mine['capture_id'], 'EXT_08'))['outcome']).toBe(
        'PHOTO_GALLERY_FORBIDDEN',
      );
    });
  });

  // -------------------------------------------------------------------------------------------
  /** Même fichier : deux angles d'une même série, puis un autre trip (L3-PM-03). */
  async function duplicateAttack(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    await rolledBack(T0, async (tx) => {
      const w = await checkinOpenWorld(tx, c, P_START, P_END);
      const other = await checkinOpenWorld(tx, c, P_START, P_END);
      await subjectKeys(tx, w);
      await subjectKeys(tx, other);
      const body = randomBytes(2048);
      out['first'] = String((await shoot(tx, w.g, w.trip, 'EXT_01', { body }))['outcome']);
      out['sameSeries'] = String((await shoot(tx, w.g, w.trip, 'EXT_02', { body }))['outcome']);
      out['otherTrip'] = String(
        (await shoot(tx, other.g, other.trip, 'EXT_01', { body }))['outcome'],
      );
      // témoin : un autre fichier à un autre angle passe
      out['witness'] = String((await shoot(tx, w.g, w.trip, 'EXT_03'))['outcome']);
    });
    return out;
  }

  it('RT-L3-P03 (L3-PM-03) — observation : le même fichier est accepté à deux angles de la série et sur un autre trip', async () => {
    const out = await duplicateAttack();
    expect(out['first']).toBe('DONE');
    expect(out['witness']).toBe('DONE');
    // CONSTAT F-L3-PRE-01 → suite : aucune garde d'empreinte déjà vue (0158, `trip_cmd_add_inspection_photo`)
    expect(out['sameSeries']).toBe('DONE');
    expect(out['otherTrip']).toBe('DONE');
  });

  // CONSTAT F-L3-PRE-01 → suite : refuser une empreinte SHA-256 déjà enregistrée (tous trips, photos
  // d'annonce comprises) ; les angles d'une série ne se remplissent pas avec un seul fichier
  it.fails(
    'RT-L3-P03 (L3-PM-03) — CONSTAT F-L3-PRE-01 : une empreinte déjà enregistrée est refusée (même série, autre trip)',
    async () => {
      const out = await duplicateAttack();
      expect(out['first']).toBe('DONE');
      expect(out['witness']).toBe('DONE');
      expect(out['sameSeries']).not.toBe('DONE');
      expect(out['otherTrip']).not.toBe('DONE');
    },
  );

  // -------------------------------------------------------------------------------------------
  it('RT-L3-RM02 (L3-PM-09) : aucune commande de la remise, du départ, du retour ou du versement ne reçoit une heure du client ; seule l’heure de l’appareil d’une photo est reçue, comme indice', async () => {
    await rolledBack(OPENS, async (tx) => {
      const commands = [
        'trip_cmd_open_checkin',
        'trip_cmd_identity_check',
        'trip_cmd_validate_handover',
        'trip_cmd_submit_inspection',
        'trip_cmd_open_photo_capture',
        'trip_cmd_report_no_show',
        'trip_cmd_detect_overdue',
        'payout_cmd_prepare_trip',
        'payout_cmd_initiate_batch',
        'payout_cmd_net_batch',
        'payout_cmd_record_payout_result',
      ];
      const timeArgs = `
        SELECT p.proname AS name, t.typname AS type
          FROM pg_catalog.pg_proc AS p
          JOIN pg_catalog.pg_namespace AS ns ON ns.oid = p.pronamespace
         CROSS JOIN LATERAL pg_catalog.unnest(p.proargtypes::oid[]) AS a(oid)
          JOIN pg_catalog.pg_type AS t ON t.oid = a.oid
         WHERE ns.nspname = 'core' AND p.proname = ANY($1::text[])
           AND t.typname = ANY(ARRAY['timestamptz', 'timestamp', 'date', 'time', 'timetz',
                                     'interval']::text[])`;
      const found = await tx.query<{ n: number }>(
        `SELECT pg_catalog.count(DISTINCT p.proname)::int AS n
           FROM pg_catalog.pg_proc AS p
           JOIN pg_catalog.pg_namespace AS ns ON ns.oid = p.pronamespace
          WHERE ns.nspname = 'core' AND p.proname = ANY($1::text[])`,
        [commands],
      );
      // une commande renommée ne rend pas la preuve vide
      expect(found.rows[0]?.n).toBe(commands.length);
      expect((await tx.query(timeArgs, [commands])).rows).toEqual([]);
      // la seule heure reçue : celle de l'appareil d'une photo (indice conservé, 0158)
      const photo = await tx.query<{ type: string; args: string }>(
        `SELECT t.typname AS type, pg_catalog.pg_get_function_arguments(p.oid) AS args
           FROM pg_catalog.pg_proc AS p
           JOIN pg_catalog.pg_namespace AS ns ON ns.oid = p.pronamespace
          CROSS JOIN LATERAL pg_catalog.unnest(p.proargtypes::oid[]) AS a(oid)
           JOIN pg_catalog.pg_type AS t ON t.oid = a.oid
          WHERE ns.nspname = 'core' AND p.proname = 'trip_cmd_add_inspection_photo'
            AND t.typname = ANY(ARRAY['timestamptz', 'timestamp', 'date', 'interval']::text[])`,
      );
      expect(photo.rows).toHaveLength(1);
      expect(photo.rows[0]).toMatchObject({ type: 'timestamptz' });
      expect(photo.rows[0]?.args).toContain('p_device_captured_at');
    });
  });

  it('RT-L3-RM02 (L3-PM-09) : retour antidaté — une première validation tôt ne fixe pas la fin ; fin effective = heure SERVEUR de la seconde validation, rejeu à l’heure d’origine', async () => {
    await rolledBack(OPENS, async (tx) => {
      await openInsurer(tx, c.country);
      await setVirtualNow(tx, OPENS);
      const w = await bookedWorld(tx, c, START, END);
      await subjectKeys(tx, w);
      await departed(tx, w);

      await setVirtualNow(tx, END);
      await series(tx, w.h, w.trip, 'CHECKOUT');
      await series(tx, w.g, w.trip, 'CHECKOUT');
      expect((await submit(tx, w.h, w.trip, 'CHECKOUT'))['outcome']).toBe('DONE');
      expect((await submit(tx, w.g, w.trip, 'CHECKOUT'))['outcome']).toBe('DONE');

      // le voyageur valide à 10:05 (sa version : « rendu à l'heure ») ; l'hôte ne valide qu'à 10:40
      await setVirtualNow(tx, plus(END, 5 * 60));
      const first = await validate(tx, w.g, w.trip, 'CHECKOUT', 42500, 6);
      expect(first).toMatchObject({
        outcome: 'DONE',
        completed_at: null,
        trip_status: 'IN_PROGRESS',
      });
      expect(iso(first['validated_at'])).toBe(plus(END, 5 * 60));
      expect((await records(tx, w.trip))['status']).toBe('IN_PROGRESS');
      const SECOND = plus(END, 40 * 60);
      await setVirtualNow(tx, SECOND);
      const second = await validate(tx, w.h, w.trip, 'CHECKOUT', 42500, 6);
      expect(second).toMatchObject({ outcome: 'DONE', trip_status: 'RETURNED' });
      expect(iso(second['completed_at'])).toBe(SECOND);
      const r = await records(tx, w.trip);
      expect(at(r['returnedAt'])).toBe(SECOND);
      expect(at(r['returnedAt'])).not.toBe(plus(END, 5 * 60));
      // rejeu, plus tard, avec d'autres relevés : l'heure d'origine, une seule transition
      await setVirtualNow(tx, plus(END, 3600));
      const replay = await validate(tx, w.g, w.trip, 'CHECKOUT', 1, 0);
      expect(replay['outcome']).toBe('ALREADY_VALIDATED');
      expect(iso(replay['completed_at'])).toBe(SECOND);
      expect((await records(tx, w.trip))['transitions']).toBe(2);
    });
  });

  // -------------------------------------------------------------------------------------------
  it('RT-L3-RM04 (L3-PM-11) : permis d’un tiers présenté à l’hôte ⇒ TRIP_ID_FAILED définitif, aucune remise, motif hors liste refusé ; le voyageur et un autre hôte ne peuvent pas écrire le contrôle', async () => {
    await rolledBack(OPENS, async (tx) => {
      await openInsurer(tx, c.country);
      await setVirtualNow(tx, OPENS);
      const w = await bookedWorld(tx, c, START, END);
      const stranger = await bookedWorld(tx, c, START, END);
      await subjectKeys(tx, w);
      expect((await open(tx, w.h, w.trip))['outcome']).toBe('DONE');

      // le voyageur ne se contrôle pas lui-même ; un autre hôte n'écrit pas ce contrôle
      expect(await identity(tx, w.g, w.trip, ALL_OK)).toMatchObject({ outcome: 'HOST_ONLY' });
      expect(await identity(tx, stranger.h, w.trip, ALL_OK)).toMatchObject({
        outcome: 'NOT_FOUND',
      });
      // motif hors liste : refusé, rien n'est écrit
      expect(
        await identity(tx, w.h, w.trip, { ...ALL_OK, name: false }, 'FACE_MISMATCH'),
      ).toMatchObject({ outcome: 'REQUEST_INVALID' });
      expect((await records(tx, w.trip))['identity']).toBeNull();

      // le titulaire du permis n'est pas le voyageur (prénom et année différents)
      const failed = await identity(
        tx,
        w.h,
        w.trip,
        { ...ALL_OK, name: false, birthYear: false },
        'OTHER_DRIVER_SENT',
      );
      expect(failed).toMatchObject({ outcome: 'DONE', status: 'TRIP_ID_FAILED' });
      // définitif : l'hôte ne peut pas se raviser, le voyageur ne peut pas écraser
      expect(await identity(tx, w.h, w.trip, ALL_OK)).toMatchObject({
        outcome: 'ALREADY_CHECKED',
        status: 'TRIP_ID_FAILED',
      });
      expect(await identity(tx, w.g, w.trip, ALL_OK)).toMatchObject({ outcome: 'HOST_ONLY' });

      // aucune remise ne passe, même avec les deux séries complètes
      await series(tx, w.h, w.trip, 'CHECKIN');
      await series(tx, w.g, w.trip, 'CHECKIN');
      expect((await submit(tx, w.h, w.trip, 'CHECKIN'))['outcome']).toBe('DONE');
      expect((await submit(tx, w.g, w.trip, 'CHECKIN'))['outcome']).toBe('DONE');
      for (const who of [w.h, w.g]) {
        expect(await validate(tx, who, w.trip, 'CHECKIN', 42000, 8)).toMatchObject({
          outcome: 'IDENTITY_CHECK_FAILED',
        });
      }
      expect(await records(tx, w.trip)).toMatchObject({
        status: 'CHECKIN_OPEN',
        transitions: 0,
        validations: [],
      });
      // le contrôle du permis ne se rejoue pas en bloc : relevé inchangé
      expect((await records(tx, w.trip))['identity']).toMatchObject({
        status: 'TRIP_ID_FAILED',
        subreason: 'OTHER_DRIVER_SENT',
      });
    });
  });

  it('RT-L3-RM04 / RT-L3-H08 (L3-PM-11, L3-PM-45) : l’hôte ne lit ni la date de naissance complète, ni le nom, ni la pièce du voyageur — par chaque vue de la remise, par les tables de la pièce et du contrôle', async () => {
    await rolledBack(OPENS, async (tx) => {
      await openInsurer(tx, c.country);
      await setVirtualNow(tx, OPENS);
      const w = await bookedWorld(tx, c, START, END);
      await tx.query('SELECT test_fixture.us315_birth($1, $2::date)', [w.guest, '1990-04-12']);
      await subjectKeys(tx, w);
      expect((await open(tx, w.h, w.trip))['outcome']).toBe('DONE');

      // témoin : l'hôte voit le prénom, l'initiale du nom et l'année de naissance (10b UX-37)
      const hv = await viewOf(tx, VIEW_HANDOVER, [w.h, w.trip, 'CHECKIN']);
      expect(hv['guest']).toEqual({ firstName: 'Ana', lastInitial: 'P', birthYear: 1990 });
      // aucune vue servie à l'hôte ne porte le nom complet, la date complète ni un champ de pièce
      const views: readonly [string, readonly unknown[]][] = [
        [VIEW_HANDOVER, [w.h, w.trip, 'CHECKIN']],
        [VIEW_HANDOVER, [w.h, w.trip, 'CHECKOUT']],
        [VIEW_INSPECTION, [w.h, w.trip, 'CHECKIN']],
        [VIEW_INSPECTION, [w.h, w.trip, 'CHECKOUT']],
        ['SELECT core.trip_no_show_view($1, $2::uuid) AS v', [w.h, w.trip]],
      ];
      for (const [sql, args] of views) {
        const text = JSON.stringify(await viewOf(tx, sql, args));
        for (const leak of [
          'Pérez',
          '1990-04-12',
          'licenseNumber',
          'documentNumber',
          'dateOfBirth',
          'idNumber',
        ]) {
          expect(text, `${sql} ${leak}`).not.toContain(leak);
        }
      }

      // lecture directe sous le contexte de l'hôte : refus (aucun droit) ou aucune ligne du voyageur
      await setActor(tx, { kind: 'HOST', actorId: w.holder });
      const reads: readonly [string, readonly unknown[]][] = [
        ['SELECT 1 FROM core.kyc_identity_document WHERE user_id = $1', [w.guest]],
        ['SELECT 1 FROM core.kyc_identity_verification WHERE user_id = $1', [w.guest]],
        ['SELECT 1 FROM core.trip_ops_identity_check WHERE trip_id = $1', [w.trip]],
        ['SELECT date_of_birth FROM core.iam_user_account WHERE id = $1', [w.guest]],
      ];
      for (const [sql, args] of reads) {
        await tx.query('SAVEPOINT rt_l3_read');
        let seen = 0;
        try {
          seen = (await tx.query(sql, args as unknown[])).rowCount ?? 0;
          await tx.query('RELEASE SAVEPOINT rt_l3_read');
        } catch (error) {
          await tx.query('ROLLBACK TO SAVEPOINT rt_l3_read');
          expect((error as { code?: string }).code, sql).toBe('42501');
        }
        expect(seen, sql).toBe(0);
      }
    });
  });
});
