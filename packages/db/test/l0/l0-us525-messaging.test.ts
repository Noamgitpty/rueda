/**
 * US-525 (migration 0161, ADR-181) — messagerie par trip et signal du marché gris :
 * `core.messaging_thread_read` et `core.messaging_cmd_post_message` (SECURITY DEFINER, EXECUTE
 * app_api). Rôles de PRODUCTION seulement (assertion L0-05 par `connectAs`), au Panama (USD) et au
 * Paraguay (PYG sans décimale).
 *
 * Attendus tirés de 19 US-525 (critère 1 : « Given "escríbeme al +507 6xxx-xxxx", When le message
 * est envoyé, Then le numéro est masqué et le message signalé ; un visiteur sans trip ne peut pas
 * écrire » ; critère 2 : « Given un message contenant "efectivo" ou "por fuera", When il est envoyé,
 * Then il est signalé à l'ops et l'expéditeur voit un rappel que tout paiement passe par Kmino »),
 * de 16 MSG-001 / MSG-007 (prénoms seulement ; fil en lecture seule après la fin du trip +
 * `review_window_days` ; états SENT / FLAGGED ; `MESSAGE_THREAD_CLOSED`), de 17 §2.3
 * (`message.trip_thread` : voyageur de ses trips, titulaire, co-hôte limité à sa portée, RLS-9 ;
 * point 5 : même réponse qu'un trip absent), du pré-mortem du lot 3 (L3-PM-45, L3-PM-46, L3-PM-49 :
 * corpus de contournement et de faux positifs, « jamais bloquer tout le message ») et de la graine
 * `review_window_days` = 10 jours (0009, PA et PY). Jamais le code testé comme oracle.
 *
 * Tout se passe dans des transactions ANNULÉES sous app_api (trips et personnes de la fixture 9926,
 * sessions ouvertes par la vraie commande) ; aucun interrupteur n'est touché.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connectAs, releaseClient, withRole } from '../../src/testing/index.ts';
import { COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, openSession, setVirtualNow } from '../support/iam.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const READ = 'SELECT * FROM core.messaging_thread_read($1, $2::uuid, $3)';
const POST = 'SELECT * FROM core.messaging_cmd_post_message($1, $2::uuid, $3::uuid, $4)';
const MASK = '•••';
const T0 = '2035-05-02T09:00:00.000Z';
/** Numéros FICTIFS de test, au format de chaque pays (données de test, pas du code). */
const PHONE: Readonly<Record<string, string>> = {
  PA: '+507 6123-4567',
  PY: '+595 981 123 456',
};
/** `review_window_days` de la graine (0009) : 10 jours en PA et en PY (16 MSG-001). */
const WINDOW_DAYS = 10;
const DAY_MS = 86_400_000;

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
  start: string,
  end: string,
  org: string | null = null,
): Promise<Trip> {
  const r = (
    await tx.query<{ trip_id: string; org_id: string; vehicle_id: string; holder_id: string }>(
      `SELECT * FROM test_fixture.us525_trip($1, $2::uuid, $3::uuid, 'Ana', 'María José', $4, $5)`,
      [c.country, org, guest, start, end],
    )
  ).rows[0]!;
  return { trip: r.trip_id, org: r.org_id, vehicle: r.vehicle_id, holder: r.holder_id };
}

const read = async (tx: Tx, hash: Buffer, tripId: string, limit = 200): Promise<Row[]> =>
  (await tx.query<Row>(READ, [hash, tripId, limit])).rows;

const post = async (
  tx: Tx,
  hash: Buffer,
  tripId: string,
  body: string | null,
  id: string = uuid(),
): Promise<Row> => {
  const { rows } = await tx.query<Row>(POST, [hash, tripId, id, body]);
  expect(rows).toHaveLength(1);
  return rows[0]!;
};

const evidence = async (tx: Tx, id: string): Promise<Row> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us525_message($1)', [id])).rows[0]!;

const items = async (tx: Tx, tripId: string): Promise<Row[]> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us525_review_items($1)', [tripId])).rows;

const START = '2035-06-10T15:00:00.000Z';
const END = '2035-06-13T15:00:00.000Z';

describe.each(COUNTRIES)('US-525 — messagerie par trip ($country, $currency)', (c) => {
  it('critère 1 : numéro masqué et message signalé ; critère 2 : paiement hors plateforme signalé à l’ops et rappel à l’expéditeur, jamais refusé ; prénoms seulement ; texte reçu gardé comme preuve', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest, START, END);
        const g = await openSession(tx, guest);
        const h = await openSession(tx, t.holder);

        // fil vide : une ligne d'en-tête, aucun message ; prénom (premier mot) de l'autre partie
        const empty = await read(tx, g.hash, t.trip);
        expect(empty).toHaveLength(1);
        expect(empty[0]).toMatchObject({
          outcome: 'DONE',
          viewer_role: 'GUEST',
          counterpart_name: 'María',
          writable: true,
          timezone: c.timezone,
          message_id: null,
        });
        // fenêtre : fin prévue + review_window_days (graine : 10 jours)
        expect((empty[0]!['closes_at'] as Date).toISOString()).toBe(
          new Date(Date.parse(END) + WINDOW_DAYS * DAY_MS).toISOString(),
        );

        // critère 1 : « escríbeme al +507 … » ⇒ numéro masqué, message signalé
        const phone = PHONE[c.country]!;
        const m1 = await post(tx, g.hash, t.trip, `Hola! escríbeme al ${phone} para coordinar`);
        expect(m1).toMatchObject({
          outcome: 'DONE',
          body: `Hola! escríbeme al ${MASK} para coordinar`,
          masked: true,
          off_platform: false,
        });
        const e1 = await evidence(tx, m1['message_id'] as string);
        expect(e1).toMatchObject({
          // texte reçu gardé tel quel (preuve), jamais servi
          body: `Hola! escríbeme al ${phone} para coordinar`,
          body_masked: `Hola! escríbeme al ${MASK} para coordinar`,
          status: 'FLAGGED',
          author_role: 'GUEST',
          author_user_id: guest,
          flags: [{ kind: 'CONTACT_MASKED', matched: ['PHONE'], reviewItem: true }],
        });
        // signal à l'ops : le fil dans la file GRAY_MARKET du pays du trip
        expect(await items(tx, t.trip)).toEqual([
          {
            queue: 'GRAY_MARKET',
            subject_type: 'MESSAGE_THREAD',
            country_code: c.country,
            status: 'OPEN',
            flag_items: '1',
          },
        ]);

        // critère 2 : « efectivo », « por fuera » ⇒ enregistré tel quel (jamais refusé), signalé,
        // rappel à l'expéditeur (off_platform) ; un seul élément vivant par fil (aucune inondation)
        await setVirtualNow(tx, '2035-05-02T09:01:00.000Z');
        const m2 = await post(tx, g.hash, t.trip, 'Si quieres te pago en efectivo, por fuera');
        expect(m2).toMatchObject({
          outcome: 'DONE',
          body: 'Si quieres te pago en efectivo, por fuera',
          masked: false,
          off_platform: true,
        });
        const e2 = await evidence(tx, m2['message_id'] as string);
        expect(e2['status']).toBe('FLAGGED');
        expect(e2['flags']).toEqual([
          {
            kind: 'GRAY_MARKET_KEYWORD',
            matched: ['ES_CASH', 'ES_MSG_OUTSIDE'],
            reviewItem: true,
          },
        ]);
        const queued = await items(tx, t.trip);
        expect(queued).toHaveLength(1);
        expect(queued[0]).toMatchObject({ queue: 'GRAY_MARKET', status: 'OPEN', flag_items: '2' });

        // message ordinaire : SENT, sans signal ni masque (date, heure, nom de rue gardés)
        await setVirtualNow(tx, '2035-05-02T09:02:00.000Z');
        const m3 = await post(
          tx,
          h.hash,
          t.trip,
          '  Perfecto, nos vemos el 10/06 a las 10:30 en Calle 50, frente al banco.  ',
        );
        expect(m3).toMatchObject({
          outcome: 'DONE',
          body: 'Perfecto, nos vemos el 10/06 a las 10:30 en Calle 50, frente al banco.',
          masked: false,
          off_platform: false,
        });
        expect(await evidence(tx, m3['message_id'] as string)).toMatchObject({
          status: 'SENT',
          author_role: 'HOST',
          flags: [],
        });

        // lecture par l'hôte : texte masqué seulement, prénom du voyageur, rappel jamais montré
        // au destinataire ; ordre chronologique
        const hostView = await read(tx, h.hash, t.trip);
        expect(
          hostView.map((r) => [
            r['outcome'],
            r['viewer_role'],
            r['counterpart_name'],
            r['message_id'],
            r['mine'],
            r['author_role'],
            r['author_name'],
            r['body'],
            r['masked'],
            r['off_platform'],
          ]),
        ).toEqual([
          [
            'DONE',
            'HOST',
            'Ana',
            m1['message_id'],
            false,
            'GUEST',
            'Ana',
            `Hola! escríbeme al ${MASK} para coordinar`,
            true,
            false,
          ],
          [
            'DONE',
            'HOST',
            'Ana',
            m2['message_id'],
            false,
            'GUEST',
            'Ana',
            'Si quieres te pago en efectivo, por fuera',
            false,
            false,
          ],
          [
            'DONE',
            'HOST',
            'Ana',
            m3['message_id'],
            true,
            'HOST',
            'María',
            'Perfecto, nos vemos el 10/06 a las 10:30 en Calle 50, frente al banco.',
            false,
            false,
          ],
        ]);
        // lecture par le voyageur : son rappel sur son propre message
        const guestView = await read(tx, g.hash, t.trip);
        expect(guestView.map((r) => [r['mine'], r['off_platform']])).toEqual([
          [true, false],
          [true, true],
          [false, false],
        ]);
        // aucune ligne ne porte le numéro (ni nom de famille) : minimisation
        expect(JSON.stringify([...hostView, ...guestView])).not.toContain(phone);
        expect(JSON.stringify([...hostView, ...guestView])).not.toMatch(/Pérez|Gómez/);
        // limite : les derniers messages, du plus ancien au plus récent
        expect((await read(tx, g.hash, t.trip, 2)).map((r) => r['message_id'])).toEqual([
          m2['message_id'],
          m3['message_id'],
        ]);

        // réessai : même identifiant, même auteur ⇒ le message enregistré, sans doublon ni signal
        const again = await post(tx, g.hash, t.trip, 'texte différent', m1['message_id'] as string);
        expect(again).toMatchObject({
          outcome: 'DONE',
          message_id: m1['message_id'],
          body: `Hola! escríbeme al ${MASK} para coordinar`,
          masked: true,
        });
        expect(await read(tx, g.hash, t.trip)).toHaveLength(3);
        // identifiant déjà pris par un autre auteur : refus, rien d'écrit
        expect(await post(tx, h.hash, t.trip, 'hola', m1['message_id'] as string)).toMatchObject({
          outcome: 'REQUEST_INVALID',
          message_id: null,
        });

        // saisie invalide : texte vide (blancs), trop long ; 2 000 caractères : accepté
        for (const body of ['   ', '\n\t', 'x'.repeat(2001), null]) {
          expect(await post(tx, g.hash, t.trip, body)).toMatchObject({
            outcome: 'MESSAGE_INVALID',
            message_id: null,
          });
        }
        expect((await post(tx, g.hash, t.trip, 'y'.repeat(2000)))['outcome']).toBe('DONE');
        for (const limit of [0, 201]) {
          const bad = await read(tx, g.hash, t.trip, limit);
          expect(bad).toEqual([expect.objectContaining({ outcome: 'REQUEST_INVALID' })]);
        }
        expect(await post(tx, g.hash, t.trip, 'hola', null as unknown as string)).toMatchObject({
          outcome: 'REQUEST_INVALID',
        });
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('parties seulement : visiteur sans trip, autre voyageur, autre hôte, co-hôte hors portée (RLS-9), révoqué ou invité : NOT_FOUND sans rien écrire ; co-hôte de portée : lit et écrit ; session inconnue : AUTH_REQUIRED', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const guest2 = uuid();
        const guest3 = uuid();
        // compte A : véhicules V1 (trip t1) et V2 (trip t2) ; compte B : trip t3
        const t1 = await trip(tx, c, guest, START, END);
        const t2 = await trip(tx, c, guest2, START, END, t1.org);
        const t3 = await trip(tx, c, guest3, START, END);
        const member = async (
          scope: string[],
          status: string,
          overrides: string[] = [],
        ): Promise<string> =>
          (
            await tx.query<{ id: string }>(
              `SELECT test_fixture.us525_member($1, 'CO_HOST', $2::uuid[], $3, 'Lucía', $4::text[]) AS id`,
              [t1.org, scope, status, overrides],
            )
          ).rows[0]!.id;
        const coV1 = await member([t1.vehicle], 'ACTIVE');
        const coRemoved = await member([t1.vehicle], 'REMOVED');
        const coInvited = await member([t1.vehicle], 'INVITED');
        const visitor = (
          await tx.query<{ id: string }>(`SELECT test_fixture.us525_person('Pedro') AS id`)
        ).rows[0]!.id;

        const s = {
          guest: await openSession(tx, guest),
          guest2: await openSession(tx, guest2),
          holderA: await openSession(tx, t1.holder),
          holderB: await openSession(tx, t3.holder),
          coV1: await openSession(tx, coV1),
          coRemoved: await openSession(tx, coRemoved),
          coInvited: await openSession(tx, coInvited),
          visitor: await openSession(tx, visitor),
        };
        const first = await post(tx, s.guest.hash, t1.trip, 'Hola');
        expect(first['outcome']).toBe('DONE');

        // co-hôte de portée V1 : lit le fil de t1, y écrit comme CO_HOST
        const coRead = await read(tx, s.coV1.hash, t1.trip);
        expect(coRead[0]).toMatchObject({
          outcome: 'DONE',
          viewer_role: 'CO_HOST',
          counterpart_name: 'Ana',
        });
        const coPost = await post(tx, s.coV1.hash, t1.trip, 'Soy Lucía, coanfitriona');
        expect(coPost['outcome']).toBe('DONE');
        expect(await evidence(tx, coPost['message_id'] as string)).toMatchObject({
          author_role: 'CO_HOST',
          author_user_id: coV1,
        });
        // le titulaire de A lit les deux trips de son compte
        expect((await read(tx, s.holderA.hash, t2.trip))[0]).toMatchObject({
          outcome: 'DONE',
          viewer_role: 'HOST',
        });

        // refus : même issue qu'un trip inconnu, aucune donnée, rien d'écrit
        const refused: [string, Buffer, string][] = [
          ['co-hôte V1 sur le trip de V2 (RLS-9)', s.coV1.hash, t2.trip],
          ['co-hôte révoqué', s.coRemoved.hash, t1.trip],
          ['co-hôte invité', s.coInvited.hash, t1.trip],
          ['hôte B sur le trip de A', s.holderB.hash, t1.trip],
          ['visiteur sans trip', s.visitor.hash, t1.trip],
          ['voyageur d’un autre trip du même hôte', s.guest2.hash, t1.trip],
          ['voyageur sur un trip inconnu', s.guest.hash, uuid()],
        ];
        for (const [label, hash, tripId] of refused) {
          const r = await read(tx, hash, tripId);
          expect(r, label).toEqual([
            {
              outcome: 'NOT_FOUND',
              viewer_role: null,
              counterpart_name: null,
              writable: null,
              closes_at: null,
              timezone: null,
              message_id: null,
              mine: null,
              author_role: null,
              author_name: null,
              body: null,
              masked: null,
              off_platform: null,
              sent_at: null,
            },
          ]);
          expect(await post(tx, hash, tripId, 'te escribo por aquí'), label).toMatchObject({
            outcome: 'NOT_FOUND',
            message_id: null,
          });
        }
        // rien n'a été écrit par les refus : deux messages dans t1, aucun fil pour t2
        expect(await read(tx, s.guest.hash, t1.trip)).toHaveLength(2);
        expect(await read(tx, s.guest2.hash, t2.trip)).toEqual([
          expect.objectContaining({ outcome: 'DONE', message_id: null }),
        ]);
        // permission unitaire du titulaire : sans portée sur V2, toujours refusé (portée d'abord)
        const coOverride = await member([t1.vehicle], 'ACTIVE', ['message.trip_thread']);
        const so = await openSession(tx, coOverride);
        expect((await read(tx, so.hash, t2.trip))[0]).toMatchObject({ outcome: 'NOT_FOUND' });
        expect((await read(tx, so.hash, t1.trip))[0]).toMatchObject({ outcome: 'DONE' });

        // session inconnue : AUTH_REQUIRED, aucune donnée
        const unknown = newToken().hash;
        expect(await read(tx, unknown, t1.trip)).toEqual([
          expect.objectContaining({ outcome: 'AUTH_REQUIRED', message_id: null, body: null }),
        ]);
        expect(await post(tx, unknown, t1.trip, 'hola')).toMatchObject({
          outcome: 'AUTH_REQUIRED',
          message_id: null,
        });
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('16 MSG-001 : fil en lecture seule après la fin du trip + review_window_days (MESSAGE_THREAD_CLOSED), lecture conservée', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest, START, END);
        const g0 = await openSession(tx, guest);
        expect((await post(tx, g0.hash, t.trip, 'Hola'))['outcome']).toBe('DONE');
        const closes = Date.parse(END) + WINDOW_DAYS * DAY_MS;

        // dernière minute de la fenêtre : écriture permise (sessions ouvertes à l'heure posée)
        await setVirtualNow(tx, new Date(closes - 60_000).toISOString());
        const h = await openSession(tx, t.holder);
        expect((await post(tx, h.hash, t.trip, 'Gracias por cuidar el auto'))['outcome']).toBe(
          'DONE',
        );
        // après la fenêtre : refus, rien d'écrit ; la lecture reste ouverte, non modifiable
        await setVirtualNow(tx, new Date(closes + 60_000).toISOString());
        const g = await openSession(tx, guest);
        for (const hash of [g.hash, h.hash]) {
          expect(await post(tx, hash, t.trip, '¿Sigues ahí?')).toMatchObject({
            outcome: 'MESSAGE_THREAD_CLOSED',
            message_id: null,
          });
        }
        const view = await read(tx, g.hash, t.trip);
        expect(view).toHaveLength(2);
        expect(view.every((r) => r['outcome'] === 'DONE' && r['writable'] === false)).toBe(true);
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('L3-PM-49 : corpus de contournement (masqué et / ou signalé) et de faux positifs (jamais masqués ni bloqués), es / en / fr / pt-BR', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest, START, END);
        const g = await openSession(tx, guest);
        const phone = PHONE[c.country]!;
        // [texte envoyé, texte servi attendu, masqué, hors plateforme]
        const CASES: readonly (readonly [string, string, boolean, boolean])[] = [
          // téléphones : séparateurs, sans indicatif, chiffres pleine chasse, émoji, invisibles
          [`llámame ${phone}`, `llámame ${MASK}`, true, false],
          ['mi cel 6123 4567', `mi cel ${MASK}`, true, false],
          ['WhatsApp 0981.123.456 cuando llegues', `WhatsApp ${MASK} cuando llegues`, true, false],
          ['call (507) 6123-4567', `call (${MASK}`, true, false],
          ['número ６１２３４５６７', `número ${MASK}`, true, false],
          [
            'marca 6\u{FE0F}\u{20E3}1\u{FE0F}\u{20E3}2\u{FE0F}\u{20E3}3\u{FE0F}\u{20E3}4567',
            `marca ${MASK}`,
            true,
            false,
          ],
          ['número 6123\u{200B}4567', `número ${MASK}`, true, false],
          // téléphones en toutes lettres (es, pt-BR, en)
          [
            'mi número es seis uno dos tres cuatro cinco seis siete',
            `mi número es ${MASK}`,
            true,
            false,
          ],
          [
            'meu número: nove oito um, um dois três, quatro cinco seis',
            `meu número: ${MASK}`,
            true,
            false,
          ],
          ['text me at six one two three four five six seven', `text me at ${MASK}`, true, false],
          ['0981 uno dos tres cuatro cinco seis', MASK, true, false],
          // courriels, identifiants, liens (liens courts compris)
          ['escríbeme a ana.perez@correo.com', `escríbeme a ${MASK}`, true, false],
          ['ana arroba correo punto com', MASK, true, false],
          ['sígueme en @ana_autos', `sígueme en ${MASK}`, true, false],
          ['wa.me/50761234567', MASK, true, false],
          ['https://example.com/contacto ahí está', `${MASK} ahí está`, true, false],
          ['mira bit.ly/3xYz', `mira ${MASK}`, true, false],
          // paiement hors plateforme, quatre langues : texte gardé, signalé
          ['te pago en efectivo', 'te pago en efectivo', false, true],
          ['mejor por fuera, sin comisión', 'mejor por fuera, sin comisión', false, true],
          ['pásame por Yappy directo', 'pásame por Yappy directo', false, true],
          [
            'sin pasar por la app te sale más barato',
            'sin pasar por la app te sale más barato',
            false,
            true,
          ],
          ['I can pay you directly in cash', 'I can pay you directly in cash', false, true],
          ['je te paie en espèces', 'je te paie en espèces', false, true],
          ['posso pagar em dinheiro, por fora', 'posso pagar em dinheiro, por fora', false, true],
          // les deux : coordonnée masquée ET proposition signalée
          [`efectivo, llámame al ${phone}`, `efectivo, llámame al ${MASK}`, true, true],
          // faux positifs : jamais masqués (montants, dates, heures, plaque, rue, kilométrage)
          [
            'El total fue 1.500.000 Gs con todo incluido',
            'El total fue 1.500.000 Gs con todo incluido',
            false,
            false,
          ],
          ['son ₲ 2.500.000 por los tres días', 'son ₲ 2.500.000 por los tres días', false, false],
          ['el depósito es $ 1,250.00', 'el depósito es $ 1,250.00', false, false],
          ['llego el 19/11/2026 a las 10:30', 'llego el 19/11/2026 a las 10:30', false, false],
          ['nos vemos el 19.11.2026', 'nos vemos el 19.11.2026', false, false],
          ['placa ABC 1234, el auto gris', 'placa ABC 1234, el auto gris', false, false],
          ['Calle 50 y Vía España, a las 9', 'Calle 50 y Vía España, a las 9', false, false],
          ['tiene 123456 km y anda bien', 'tiene 123456 km y anda bien', false, false],
          ['somos dos adultos y tres niños', 'somos dos adultos y tres niños', false, false],
          // faux positif SIGNALÉ (relecture de l'ops), jamais bloqué ni masqué (comme Turo)
          [
            '¿es efectivo el seguro contra robo?',
            '¿es efectivo el seguro contra robo?',
            false,
            true,
          ],
        ];
        let minute = 0;
        for (const [sent, served, masked, offPlatform] of CASES) {
          minute += 1;
          await setVirtualNow(tx, new Date(Date.parse(T0) + minute * 60_000).toISOString());
          const r = await post(tx, g.hash, t.trip, sent);
          expect(r, sent).toMatchObject({
            outcome: 'DONE',
            body: served,
            masked,
            off_platform: offPlatform,
          });
          const e = await evidence(tx, r['message_id'] as string);
          // texte reçu toujours gardé comme preuve ; FLAGGED dès qu'un signal existe
          expect(e['body'], sent).toBe(sent.trim());
          expect(e['status'], sent).toBe(masked || offPlatform ? 'FLAGGED' : 'SENT');
          // un signal ne porte que des codes, jamais le texte
          for (const f of e['flags'] as { matched: string[] }[]) {
            for (const code of f.matched) expect(code, sent).toMatch(/^[A-Z][A-Z0-9_]+$/);
          }
        }
        // tous les signaux du fil : un seul élément vivant de la file GRAY_MARKET
        const queued = await items(tx, t.trip);
        expect(queued).toHaveLength(1);
        expect(queued[0]).toMatchObject({ queue: 'GRAY_MARKET', status: 'OPEN' });
      });
    } finally {
      await releaseClient(api);
    }
  });
});

describe('US-525 — catalogue de motifs réutilisé (ADR-176) : les motifs MESSAGE ne touchent pas les textes publics de l’hôte', () => {
  it('« por fuera » signale un message mais ne refuse pas une zone publique ; « efectivo » reste refusé dans une zone (0155 inchangée)', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, {}, async (tx) => {
        const offers = async (text: string): Promise<boolean> =>
          (
            await tx.query<{ v: boolean }>(
              'SELECT test_fixture.us525_public_text_offers($1) AS v',
              [text],
            )
          ).rows[0]!.v;
        expect(await offers('Estacionamiento por fuera del centro')).toBe(false);
        expect(await offers('Sin pasar por la app')).toBe(false);
        expect(await offers('Efectivo al entregar')).toBe(true);
        expect(await offers('Yappy directo')).toBe(true);
      });
    } finally {
      await releaseClient(api);
    }
  });
});

describe('US-525 — preuve jamais supprimée, tables fermées aux rôles applicatifs', () => {
  it('garde : ni suppression ni réécriture d’un message ou d’un signal, même par le propriétaire des tables ; seul hidden_at se pose', async () => {
    const api = await connectAs('app_api');
    try {
      const c = COUNTRIES[0];
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const t = await trip(tx, c, guest, START, END);
        const g = await openSession(tx, guest);
        const m = await post(tx, g.hash, t.trip, `efectivo y ${PHONE[c.country]!}`);
        const id = m['message_id'] as string;
        for (const what of ['DELETE', 'REWRITE', 'DELETE_FLAG']) {
          await tx.query('SAVEPOINT w');
          await expect(
            tx.query('SELECT test_fixture.us525_force_write($1, $2)', [id, what]),
            what,
          ).rejects.toMatchObject({ code: '23000', constraint: 'messaging_record_guarded' });
          await tx.query('ROLLBACK TO SAVEPOINT w');
        }
        await tx.query('SELECT test_fixture.us525_force_write($1, $2)', [id, 'HIDE']);
        // message masqué : servi sans texte, toujours présent (preuve)
        const view = await read(tx, g.hash, t.trip);
        expect(view).toEqual([expect.objectContaining({ message_id: id, body: null })]);
        expect((await evidence(tx, id))['body']).toContain('efectivo');
        // hidden_at ne se pose qu'une fois
        await tx.query('SAVEPOINT w');
        await expect(
          tx.query('SELECT test_fixture.us525_force_write($1, $2)', [id, 'HIDE']),
        ).rejects.toMatchObject({ code: '23000' });
        await tx.query('ROLLBACK TO SAVEPOINT w');
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('RLS ENABLE + FORCE, propriétaire migrator, politique migrator_all ; aucun droit ni politique pour app_api, app_worker, app_anon', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<Row>(
        `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                ARRAY(SELECT p.polname || ':' || pg_catalog.array_to_string(ARRAY(
                               SELECT pg_catalog.pg_get_userbyid(r) FROM pg_catalog.unnest(p.polroles) AS r
                                ORDER BY 1), ',')
                        FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid ORDER BY 1) AS policies
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname LIKE 'messaging\\_%' AND c.relkind = 'r'
          ORDER BY 1`,
      );
      // US-316 (0166, ADR-186) : politiques AJOUTÉES de la purge à l'échéance TRIP_MESSAGES
      // (privacy_cmd_owner, travailleur privacy_request) sur le fil (lecture) et le message
      // (lecture, purge) ; table des rendez-vous ajoutée, prouvée par l0-us316 ; le signal garde
      // exactement les politiques de 0161
      const purge: Readonly<Record<string, readonly string[]>> = {
        messaging_message: [
          'privacy_cmd_purge:privacy_cmd_owner',
          'privacy_cmd_read:privacy_cmd_owner',
        ],
        messaging_message_flag: [],
        messaging_message_thread: ['privacy_cmd_read:privacy_cmd_owner'],
      };
      expect(rows.filter((r) => r['relname'] !== 'messaging_meeting_proposal')).toEqual(
        ['messaging_message', 'messaging_message_flag', 'messaging_message_thread'].map(
          (relname) => ({
            relname,
            rls: true,
            force: true,
            owner: 'migrator',
            policies: [
              'messaging_cmd_ins:messaging_cmd_owner',
              'messaging_cmd_sel:messaging_cmd_owner',
              'migrator_all:migrator',
              ...(purge[relname] ?? []),
            ],
          }),
        ),
      );
      for (const t of ['messaging_message_thread', 'messaging_message', 'messaging_message_flag']) {
        await expect(client.query(`SELECT 1 FROM core.${t} LIMIT 1`), t).rejects.toMatchObject({
          code: '42501',
        });
      }
    });
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await expect(
          client.query('SELECT 1 FROM core.messaging_message LIMIT 1'),
        ).rejects.toMatchObject({ code: '42501' });
      });
    }
  });

  it.each(['app_worker', 'app_anon'] as const)(
    '%s ne peut exécuter ni la lecture ni l’envoi (42501)',
    async (role) => {
      const client = await connectAs(role);
      try {
        await expect(client.query(READ, [newToken().hash, uuid(), 10])).rejects.toMatchObject({
          code: '42501',
        });
        await expect(
          client.query(POST, [newToken().hash, uuid(), uuid(), 'hola']),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await releaseClient(client);
      }
    },
  );
});
