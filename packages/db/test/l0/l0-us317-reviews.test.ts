/**
 * US-317 (migration 0170, ADR-190) — avis réciproques en double aveugle : enregistrement, scellé,
 * publication simultanée au second avis, avis reçus (droit d'accès), profil public de l'hôte.
 * Rôles de PRODUCTION seulement (assertion L0-05 par `connectAs`), au Panama (USD) et au Paraguay
 * (PYG sans décimale), sous horloge virtuelle. La publication à l'échéance par le travailleur et les
 * courses à deux connexions sont prouvées par `l0-us317-review-timer.test.ts` (données validées,
 * fichier isolé).
 *
 * Attendus tirés de 19 US-317 (critère 2 : « les deux avis donnés à J+3 ⇒ publiés en même temps au
 * second enregistrement » ; critère 3 : « avis de l'hôte sur le voyageur publié ⇒ visible sur le
 * profil du voyageur et consultable par lui ; texte obligatoire si la note est de 1 à 3 » ;
 * critère 4 : « bloc de l'hôte : note, badge, nombre de trips, ancienneté »), de 16 REV-002 /
 * REV-004 (« Given un avis soumis et non publié, When l'autre partie consulte le trip, Then elle ne
 * voit ni la note ni le texte » ; `REVIEW_WINDOW_CLOSED`, `REVIEW_TEXT_REQUIRED`,
 * `REVIEW_ALREADY_SUBMITTED`), de 16 LST-020 (« la réponse API ne contient ni nom de famille ni
 * adresse »), de 08 BR-REVIEW-02 à 04 et 07, du pré-mortem L3-PM-48 / RT-L3-D04 (« avis lu par
 * l'API, par l'agrégat et par la notification avant publication ; avis modifié après lecture de
 * l'autre ; note 2 sans texte ; co-hôte ou trip annulé qui note ») et d'ADR-190. La durée de la
 * fenêtre est lue dans les DONNÉES de configuration (params.json), jamais dans le code testé.
 *
 * Tout se passe dans des transactions ANNULÉES (trips de la fixture 9926 par 9915 ; sessions
 * ouvertes par la vraie commande) ; aucun interrupteur n'est touché.
 */
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, openSession, setVirtualNow } from '../support/iam.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;
type View = Record<string, unknown>;

const SUBMIT = 'SELECT * FROM core.review_cmd_submit($1, $2::uuid, $3, $4::jsonb, $5)';
const READ = 'SELECT * FROM core.review_trip_read($1, $2::uuid)';
const RECEIVED = 'SELECT * FROM core.review_my_received($1)';
const PROFILE = 'SELECT * FROM core.review_listing_host_profile($1::uuid)';

const T0 = '2035-05-02T09:00:00.000Z';
const START = '2035-06-10T15:00:00.000Z';
const END = '2035-06-13T15:00:00.000Z';
/** Retour validé une heure avant la fin prévue : la fin effective est celle du journal (ADR-183). */
const RETURNED_AT = '2035-06-13T14:00:00.000Z';
const DAY_MS = 86_400_000;
const plusDays = (iso: string, days: number, seconds = 0): string =>
  new Date(Date.parse(iso) + days * DAY_MS + seconds * 1000).toISOString();
/** Texte de 25 caractères exactement (BR-REVIEW-04, borne basse). */
const TEXT_25 = 'Auto limpio y puntual ok.';
const LONG_TEXT = 'Todo salió bien, el auto estaba impecable y la entrega fue puntual.';
/** Numéros FICTIFS de test, au format de chaque pays (données de test, pas du code). */
const PHONE: Readonly<Record<string, string>> = { PA: '+507 6123-4567', PY: '+595 981 123 456' };

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
/** Fenêtre de notation du pays (08 BR-REVIEW-01, OQ-P2P-06). */
const windowDays = (country: string): number => {
  const v = PARAMS.find((p) => p.key === 'review_window_days')?.values[country];
  if (typeof v !== 'number') throw new Error(`review_window_days sans valeur (${country})`);
  return v;
};

interface Trip {
  readonly trip: string;
  readonly org: string;
  readonly vehicle: string;
  readonly holder: string;
  readonly listing: string;
}

async function trip(
  tx: Tx,
  c: CountryCase,
  guest: string,
  org: string | null = null,
): Promise<Trip> {
  const r = (
    await tx.query<{
      trip_id: string;
      org_id: string;
      vehicle_id: string;
      holder_id: string;
      listing_id: string;
    }>('SELECT * FROM test_fixture.us317_trip($1, $2::uuid, $3::uuid, $4, $5)', [
      c.country,
      org,
      guest,
      START,
      END,
    ])
  ).rows[0]!;
  return {
    trip: r.trip_id,
    org: r.org_id,
    vehicle: r.vehicle_id,
    holder: r.holder_id,
    listing: r.listing_id,
  };
}

/** Trip rendu à RETURNED_AT (ligne RETURNED du journal à l'heure de la base). */
async function returned(tx: Tx, t: Trip): Promise<void> {
  await setVirtualNow(tx, RETURNED_AT);
  await tx.query('SELECT test_fixture.us317_return($1)', [t.trip]);
}

const rows = async (tx: Tx, sql: string, values: unknown[]): Promise<Row[]> =>
  (await tx.query<Row>(sql, values)).rows;
const one = async (tx: Tx, sql: string, values: unknown[]): Promise<Row> => {
  const r = await rows(tx, sql, values);
  expect(r).toHaveLength(1);
  return r[0]!;
};
const submit = (
  tx: Tx,
  hash: Buffer,
  tripId: string,
  overall: number | null,
  text: string | null = null,
  sub: Record<string, unknown> | null = null,
): Promise<Row> =>
  one(tx, SUBMIT, [hash, tripId, overall, sub === null ? null : JSON.stringify(sub), text]);
const read = async (tx: Tx, hash: Buffer, tripId: string): Promise<View> => {
  const r = await one(tx, READ, [hash, tripId]);
  expect(r['outcome']).toBe('DONE');
  return r['view'] as View;
};
const received = async (tx: Tx, hash: Buffer): Promise<View> => {
  const r = await one(tx, RECEIVED, [hash]);
  expect(r['outcome']).toBe('DONE');
  return r['view'] as View;
};
const reviewsOf = (tx: Tx, tripId: string) =>
  rows(tx, 'SELECT * FROM test_fixture.us317_reviews($1)', [tripId]);
const submissionsOf = (tx: Tx, tripId: string) =>
  rows(tx, 'SELECT * FROM test_fixture.us317_submissions($1)', [tripId]);
const aggregate = (tx: Tx, type: string, id: string) =>
  rows(tx, 'SELECT * FROM test_fixture.us317_aggregate($1, $2::uuid)', [type, id]);
const eventsOf = (tx: Tx, tripId: string) =>
  rows(tx, 'SELECT * FROM test_fixture.us317_events($1)', [tripId]);

describe.each(COUNTRIES)('US-317 — avis en double aveugle ($country, $currency)', (c) => {
  const days = windowDays(c.country);

  it('double aveugle strict : l’avis scellé du voyageur n’est lisible par l’hôte par AUCUN chemin (lecture du trip, agrégat, profil public, avis reçus, événement) ; la lecture de l’hôte est identique avant et après', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest);
        await returned(tx, t);
        const g = await openSession(tx, guest);
        const h = await openSession(tx, t.holder);
        await setVirtualNow(tx, plusDays(RETURNED_AT, 1));

        const hostBefore = await read(tx, h.hash, t.trip);
        const profileBefore = await one(tx, PROFILE, [t.listing]);
        const hostReceivedBefore = await received(tx, h.hash);

        // une note de 2 avec un texte reconnaissable : jamais servi à l'hôte avant publication
        const secret = 'Llegó tarde y el auto olía a cigarro, no lo recomiendo.';
        expect(await submit(tx, g.hash, t.trip, 2, secret, { cleanliness: 1 })).toMatchObject({
          outcome: 'DONE',
          status: 'SUBMITTED',
          published_at: null,
        });

        // l'hôte : même lecture qu'avant (aucun signe que le voyageur a noté)
        expect(await read(tx, h.hash, t.trip)).toEqual(hostBefore);
        expect(hostBefore).toMatchObject({
          viewerRole: 'HOST',
          counterpartName: 'Ana',
          canSubmit: true,
          mine: null,
          published: [],
        });
        // ni agrégat (véhicule, hôte), ni profil public, ni avis reçus, ni événement
        expect(await aggregate(tx, 'VEHICLE', t.vehicle)).toEqual([]);
        expect(await aggregate(tx, 'HOST', t.org)).toEqual([]);
        expect(await one(tx, PROFILE, [t.listing])).toEqual(profileBefore);
        expect(await received(tx, h.hash)).toEqual(hostReceivedBefore);
        expect(await reviewsOf(tx, t.trip)).toEqual([]);
        expect(await eventsOf(tx, t.trip)).toEqual([]);
        const servedToHost = JSON.stringify([
          await read(tx, h.hash, t.trip),
          await one(tx, PROFILE, [t.listing]),
          await received(tx, h.hash),
        ]);
        expect(servedToHost).not.toContain('cigarro');

        // le voyageur relit SON avis, en attente (droit de l'auteur), jamais publié
        const mine = await read(tx, g.hash, t.trip);
        expect(mine).toMatchObject({
          viewerRole: 'GUEST',
          counterpartName: 'María',
          canSubmit: false,
          published: [],
          guestProfile: null,
          mine: { status: 'SUBMITTED', overall: 2, subScores: { cleanliness: 1 }, text: secret },
        });
        // aucun rôle applicatif ne lit le scellé (ni le registre, ni l'agrégat)
        for (const table of ['review_submission', 'review_review', 'review_rating_aggregate']) {
          await tx.query('SAVEPOINT s');
          await expect(tx.query(`SELECT * FROM core.${table}`), table).rejects.toMatchObject({
            code: '42501',
          });
          await tx.query('ROLLBACK TO SAVEPOINT s');
        }
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('critère 2 : les deux avis donnés à J+3 ⇒ publiés au même instant, au second enregistrement ; agrégats tenus une fois ; avis non modifiable ensuite', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest);
        await returned(tx, t);
        const g = await openSession(tx, guest);
        const h = await openSession(tx, t.holder);

        await setVirtualNow(tx, plusDays(RETURNED_AT, 2));
        expect(
          await submit(tx, h.hash, t.trip, 5, null, {
            punctuality: 5,
            returnCondition: 4,
            rulesRespect: 5,
            communication: 5,
          }),
        ).toMatchObject({ outcome: 'DONE', status: 'SUBMITTED' });
        const second = plusDays(RETURNED_AT, 3);
        await setVirtualNow(tx, second);
        const r = await submit(tx, g.hash, t.trip, 4, LONG_TEXT, { cleanliness: 5, accuracy: 4 });
        expect(r).toMatchObject({ outcome: 'DONE', status: 'PUBLISHED' });
        expect((r['published_at'] as Date).toISOString()).toBe(second);

        // trois lignes publiques (voyageur : VEHICLE et HOST ; hôte : GUEST), même instant
        const pub = await reviewsOf(tx, t.trip);
        expect(
          pub.map((x) => [x['author_role'], x['subject_type'], x['status'], x['source']]),
        ).toEqual([
          ['HOST', 'GUEST', 'PUBLISHED', 'IN_APP'],
          ['GUEST', 'HOST', 'PUBLISHED', 'IN_APP'],
          ['GUEST', 'VEHICLE', 'PUBLISHED', 'IN_APP'],
        ]);
        expect(new Set(pub.map((x) => (x['published_at'] as Date).toISOString()))).toEqual(
          new Set([second]),
        );
        // agrégats : une note par sujet (moyenne ×100 de 0104)
        expect(await aggregate(tx, 'VEHICLE', t.vehicle)).toEqual([
          { review_count: 1, overall_sum: 4, avg_overall_x100: 400 },
        ]);
        expect(await aggregate(tx, 'HOST', t.org)).toEqual([
          { review_count: 1, overall_sum: 4, avg_overall_x100: 400 },
        ]);
        expect(await aggregate(tx, 'GUEST', guest)).toEqual([
          { review_count: 1, overall_sum: 5, avg_overall_x100: 500 },
        ]);

        // chacun voit les deux avis publiés, prénom de l'auteur seulement
        for (const s of [g, h]) {
          const v = await read(tx, s.hash, t.trip);
          expect(v['mine']).toMatchObject({ status: 'PUBLISHED' });
          expect(v['published']).toEqual([
            expect.objectContaining({
              authorRole: 'GUEST',
              authorName: 'Ana',
              overall: 4,
              text: LONG_TEXT,
            }),
            expect.objectContaining({
              authorRole: 'HOST',
              authorName: 'María',
              overall: 5,
              text: null,
            }),
          ]);
          expect(v['canSubmit']).toBe(false);
          const served = JSON.stringify(v);
          for (const leak of ['Pérez', 'Gómez', 'José', '@fixture.test', guest, t.holder, t.org]) {
            expect(served, leak).not.toContain(leak);
          }
        }

        // ni modification ni second avis (une fois par partie) ; rien ne change
        expect((await submit(tx, g.hash, t.trip, 1, LONG_TEXT))['outcome']).toBe(
          'REVIEW_ALREADY_SUBMITTED',
        );
        expect((await submit(tx, h.hash, t.trip, 2, LONG_TEXT))['outcome']).toBe(
          'REVIEW_ALREADY_SUBMITTED',
        );
        expect(await reviewsOf(tx, t.trip)).toHaveLength(3);
        expect(await aggregate(tx, 'VEHICLE', t.vehicle)).toEqual([
          { review_count: 1, overall_sum: 4, avg_overall_x100: 400 },
        ]);
        // aucun événement ni notification d'un avis (ADR-190 : suite)
        expect(await eventsOf(tx, t.trip)).toEqual([]);
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('critère 3 : avis de l’hôte publié ⇒ consultable par le voyageur (droit d’accès) et visible sur son profil par un autre hôte ; texte obligatoire (≥ 25 caractères) de 1 à 3 ; coordonnées masquées avant l’écriture', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest);
        await returned(tx, t);
        const g = await openSession(tx, guest);
        const h = await openSession(tx, t.holder);
        await setVirtualNow(tx, plusDays(RETURNED_AT, 1));

        // texte exigé de 1 à 3 (les deux rôles), 25 caractères au moins
        for (const overall of [1, 2, 3]) {
          expect((await submit(tx, h.hash, t.trip, overall))['outcome']).toBe(
            'REVIEW_TEXT_REQUIRED',
          );
          expect((await submit(tx, h.hash, t.trip, overall, TEXT_25.slice(0, 24)))['outcome']).toBe(
            'REVIEW_TEXT_REQUIRED',
          );
          expect((await submit(tx, g.hash, t.trip, overall, '   '))['outcome']).toBe(
            'REVIEW_TEXT_REQUIRED',
          );
        }
        // bornes et clés fermées
        expect((await submit(tx, h.hash, t.trip, 0, LONG_TEXT))['outcome']).toBe('REVIEW_INVALID');
        expect((await submit(tx, h.hash, t.trip, 6, LONG_TEXT))['outcome']).toBe('REVIEW_INVALID');
        expect((await submit(tx, h.hash, t.trip, 5, null, { cleanliness: 5 }))['outcome']).toBe(
          'REVIEW_INVALID',
        );
        expect((await submit(tx, g.hash, t.trip, 5, null, { punctuality: 5 }))['outcome']).toBe(
          'REVIEW_INVALID',
        );
        expect((await submit(tx, g.hash, t.trip, 5, null, { cleanliness: 6 }))['outcome']).toBe(
          'REVIEW_INVALID',
        );
        expect((await submit(tx, g.hash, t.trip, 5, 'x'.repeat(1001)))['outcome']).toBe(
          'REVIEW_INVALID',
        );
        expect((await submit(tx, g.hash, t.trip, null))['outcome']).toBe('REQUEST_INVALID');
        expect(await submissionsOf(tx, t.trip)).toEqual([]);

        // note de 3 avec 25 caractères et un téléphone : accepté, téléphone masqué AVANT l'écriture
        const withPhone = `${TEXT_25} Escríbeme al ${PHONE[c.country]}`;
        expect(await submit(tx, h.hash, t.trip, 3, withPhone)).toMatchObject({
          outcome: 'DONE',
          status: 'SUBMITTED',
        });
        const [sealed] = await submissionsOf(tx, t.trip);
        expect(sealed).toMatchObject({ author_role: 'HOST', overall: 3, contact_masked: true });
        expect(String(sealed!['body'])).toContain('•••');
        expect(String(sealed!['body'])).not.toContain(PHONE[c.country]!.slice(-4));

        // le voyageur note à son tour : les deux avis sont publiés
        await setVirtualNow(tx, plusDays(RETURNED_AT, 2));
        expect((await submit(tx, g.hash, t.trip, 5))['status']).toBe('PUBLISHED');

        // droit d'accès (Ley 81) : le voyageur lit l'avis reçu de l'hôte, prénom de l'auteur seul
        const mineAsGuest = await received(tx, g.hash);
        expect(mineAsGuest).toMatchObject({
          asGuest: {
            reviewCount: 1,
            averageX100: 300,
            reviews: [
              expect.objectContaining({ authorRole: 'HOST', authorName: 'María', overall: 3 }),
            ],
          },
          asHost: null,
        });
        // profil du voyageur, servi à l'hôte d'un AUTRE trip du même voyageur
        const t2 = await trip(tx, c, guest);
        const h2 = await openSession(tx, t2.holder);
        const v2 = await read(tx, h2.hash, t2.trip);
        expect(v2['guestProfile']).toMatchObject({
          reviewCount: 1,
          averageX100: 300,
          reviews: [expect.objectContaining({ authorName: 'María', overall: 3 })],
        });
        // l'hôte du trip voit son avis reçu (comme hôte) ; aucun identifiant ni nom de famille
        const mineAsHost = await received(tx, h.hash);
        expect(mineAsHost['asHost']).toMatchObject({
          reviewCount: 1,
          averageX100: 500,
          reviews: [
            expect.objectContaining({ authorRole: 'GUEST', authorName: 'Ana', overall: 5 }),
          ],
        });
        const served = JSON.stringify([mineAsGuest, mineAsHost, v2]);
        for (const leak of [
          'Pérez',
          'Gómez',
          'José',
          '@fixture.test',
          guest,
          t.holder,
          t.org,
          PHONE[c.country]!,
        ]) {
          expect(served, leak).not.toContain(leak);
        }
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('qui note, quand : seules les parties, une fois, dans la fenêtre depuis la fin effective ; co-hôte, autre hôte, tiers, trip inconnu ⇒ NOT_FOUND (même issue) ; trip non rendu ou annulé ⇒ REVIEW_NOT_OPEN ; échéance ⇒ REVIEW_WINDOW_CLOSED ; avis de l’ops ⇒ déjà donné', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest);
        const other = await trip(tx, c, uuid());
        const co = await tx.query<{ id: string }>(
          `SELECT test_fixture.us525_member($1, 'CO_HOST', NULL, 'ACTIVE', 'Leo', '{}') AS id`,
          [t.org],
        );
        // sessions ouvertes la veille du retour (durée de vie d'une session : 14 jours)
        await setVirtualNow(tx, plusDays(RETURNED_AT, -1));
        const g = await openSession(tx, guest);
        const h = await openSession(tx, t.holder);
        const stranger = await tx.query<{ id: string }>(
          `SELECT test_fixture.us525_person('Zoe') AS id`,
        );
        const sessions = {
          coHost: await openSession(tx, co.rows[0]!.id),
          otherHost: await openSession(tx, other.holder),
          stranger: await openSession(tx, stranger.rows[0]!.id),
        };

        // avant la fin effective : rien à noter
        expect((await submit(tx, g.hash, t.trip, 5))['outcome']).toBe('REVIEW_NOT_OPEN');
        expect(await read(tx, g.hash, t.trip)).toMatchObject({
          endedAt: null,
          closesAt: null,
          canSubmit: false,
        });
        await returned(tx, t);
        await setVirtualNow(tx, plusDays(RETURNED_AT, 1));
        // fenêtre : fin effective + review_window_days du pays (au fuseau du trip)
        expect(await read(tx, g.hash, t.trip)).toMatchObject({
          endedAt: RETURNED_AT,
          closesAt: plusDays(RETURNED_AT, days),
          windowDays: days,
          timezone: c.timezone,
          canSubmit: true,
        });

        for (const [who, s] of Object.entries(sessions)) {
          expect((await submit(tx, s.hash, t.trip, 5))['outcome'], who).toBe('NOT_FOUND');
          expect(await one(tx, READ, [s.hash, t.trip]), who).toEqual({
            outcome: 'NOT_FOUND',
            view: null,
          });
        }
        expect((await submit(tx, h.hash, uuid(), 5))['outcome']).toBe('NOT_FOUND');
        expect((await submit(tx, newToken().hash, t.trip, 5))['outcome']).toBe('AUTH_REQUIRED');
        expect(await one(tx, READ, [newToken().hash, t.trip])).toEqual({
          outcome: 'AUTH_REQUIRED',
          view: null,
        });
        expect(await submissionsOf(tx, t.trip)).toEqual([]);

        // trip annulé (aucune ligne RETURNED) : jamais noté
        await tx.query(`SELECT test_fixture.us317_status($1, 'CANCELLED_BY_HOST')`, [other.trip]);
        const oh = await openSession(tx, other.holder);
        expect((await submit(tx, oh.hash, other.trip, 5))['outcome']).toBe('REVIEW_NOT_OPEN');

        // avis déjà enregistré par l'ops (US-218) : la partie a déjà noté
        await tx.query(`SELECT test_fixture.us317_ops_review($1, 'HOST', 4::smallint)`, [t.trip]);
        expect((await submit(tx, h.hash, t.trip, 5))['outcome']).toBe('REVIEW_ALREADY_SUBMITTED');

        // une seconde avant l'échéance : encore ouvert ; le voyageur note, l'autre partie ayant noté
        // (par l'ops), son avis est publié aussitôt
        await setVirtualNow(tx, plusDays(RETURNED_AT, days, -1));
        expect(await submit(tx, g.hash, t.trip, 4)).toMatchObject({
          outcome: 'DONE',
          status: 'PUBLISHED',
        });

        // à l'échéance exacte : close (J+10, BR-REVIEW-02 « ni prolongation »)
        const t3 = await trip(tx, c, uuid());
        await setVirtualNow(tx, RETURNED_AT);
        await tx.query('SELECT test_fixture.us317_return($1)', [t3.trip]);
        const h3 = await openSession(tx, t3.holder);
        await setVirtualNow(tx, plusDays(RETURNED_AT, days));
        expect((await submit(tx, h3.hash, t3.trip, 5))['outcome']).toBe('REVIEW_WINDOW_CLOSED');
        expect(await read(tx, h3.hash, t3.trip)).toMatchObject({ canSubmit: false });
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('critère 4 (LST-020) : profil public de l’hôte d’une annonce publiée : prénom, ancienneté au mois, trips réalisés, note et derniers avis publiés ; ni nom de famille ni contact ; annonce inconnue ⇒ NOT_FOUND', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest);
        // sans avis : badge « Nuevo » (aucune moyenne), aucun trip réalisé
        const empty = await one(tx, PROFILE, [t.listing]);
        expect(empty['outcome']).toBe('DONE');
        expect(empty['view']).toMatchObject({
          firstName: 'María',
          tripCount: 0,
          reviewCount: 0,
          averageX100: null,
          reviews: [],
        });
        expect(String((empty['view'] as View)['memberSince'])).toMatch(/^\d{4}-\d{2}$/);

        await returned(tx, t);
        const g = await openSession(tx, guest);
        const h = await openSession(tx, t.holder);
        await setVirtualNow(tx, plusDays(RETURNED_AT, 1));
        await submit(tx, g.hash, t.trip, 5, LONG_TEXT);
        await submit(tx, h.hash, t.trip, 5);
        // trip réalisé au sens de 0104 (COMPLETED)
        await tx.query(`SELECT test_fixture.us317_status($1, 'COMPLETED')`, [t.trip]);

        const p = await one(tx, PROFILE, [t.listing]);
        expect(p['view']).toMatchObject({
          firstName: 'María',
          tripCount: 1,
          reviewCount: 1,
          averageX100: 500,
          reviews: [
            expect.objectContaining({
              authorRole: 'GUEST',
              authorName: 'Ana',
              overall: 5,
              text: LONG_TEXT,
            }),
          ],
        });
        expect(Object.keys(p['view'] as View).sort()).toEqual(
          ['averageX100', 'firstName', 'memberSince', 'reviewCount', 'reviews', 'tripCount'].sort(),
        );
        const served = JSON.stringify(p);
        for (const leak of ['Gómez', 'Pérez', 'José', '@fixture.test', guest, t.holder, t.org]) {
          expect(served, leak).not.toContain(leak);
        }
        expect(await one(tx, PROFILE, [uuid()])).toEqual({ outcome: 'NOT_FOUND', view: null });
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('scellé immuable (tout rôle, propriétaire compris) ; travailleur réservé à app_worker ; lectures à colonnes fermées', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest);
        await returned(tx, t);
        const g = await openSession(tx, guest);
        await setVirtualNow(tx, plusDays(RETURNED_AT, 1));
        await submit(tx, g.hash, t.trip, 4);
        const [s] = await submissionsOf(tx, t.trip);
        for (const kind of ['UPDATE', 'DELETE']) {
          expect(
            (await one(tx, 'SELECT test_fixture.us317_force_write($1, $2) AS r', [s!['id'], kind]))[
              'r'
            ],
          ).toBe('23000:review_record_immutable');
        }
        // le travailleur n'est pas appelable par app_api
        await tx.query('SAVEPOINT w');
        await expect(tx.query('SELECT core.review_worker_publish_due(10)')).rejects.toMatchObject({
          code: '42501',
        });
        await tx.query('ROLLBACK TO SAVEPOINT w');
        // colonnes rendues : aucune n'est un contact, un nom de famille ou un identifiant de personne
        const { rows: fns } = await tx.query<{ fn: string; names: string[] }>(
          `SELECT p.proname AS fn, p.proargnames AS names FROM pg_catalog.pg_proc p
            WHERE p.pronamespace = 'core'::regnamespace
              AND p.proname IN ('review_trip_read', 'review_my_received',
                                'review_listing_host_profile', 'review_cmd_submit')`,
        );
        expect(fns).toHaveLength(4);
        for (const r of fns) {
          for (const n of r.names) {
            expect(n, r.fn).not.toMatch(/phone|email|mail|last_name|address|user_id|org_id/i);
          }
        }
      });
    } finally {
      await releaseClient(api);
    }
  });
});
