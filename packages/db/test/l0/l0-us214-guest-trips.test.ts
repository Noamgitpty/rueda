/**
 * US-214 (migration 0136, ADR-160) — « Mis viajes » (S08) et détail du trip (S09) du voyageur :
 * `core.booking_guest_trips` (SECURITY DEFINER, EXECUTE app_api). Rôles de PRODUCTION seulement
 * (assertion L0-05 par `connectAs`), au Panama (USD) et au Paraguay (PYG sans décimale).
 *
 * Attendus tirés de 19 US-214 (« Given un guest A, When il demande le trip de B, Then 404 (RLS-1) »),
 * de 16 BKG-027 (liste à venir, passés, annulés ; « Permissions : GUEST propriétaire du trip »), de
 * 17 §2.3 point 5 (IDOR : même réponse qu'un trip absent), du pré-mortem du lot 2 (L2-PM-35 : hôte
 * en prénom et initiale), de 0101 (partition des statuts en onglets) et de 0126 (demande en
 * attente : heure limite écrite par la base). Les montants attendus sont CEUX que le test écrit
 * dans le devis figé (lignes de test, PYG sans décimale) : la lecture les rend sans les recalculer.
 * Jamais le code testé comme oracle.
 *
 * Tout se passe dans une transaction ANNULÉE sous app_api (trips et demande de la fixture 9948, contrat signé par 9963,
 * sessions ouvertes par la vraie commande) ; aucun interrupteur n'est touché.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, openSession, setVirtualNow } from '../support/iam.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

/** Montants de TEST en unités mineures, par devise (jamais par pays) ; total = Σ lignes. */
const AMOUNTS: Readonly<
  Record<
    string,
    {
      readonly lines: readonly { type: string; amountMinor: string }[];
      readonly total: string;
      readonly request: string;
    }
  >
> = {
  USD: {
    lines: [
      { type: 'TRIP_PRICE', amountMinor: '12000' },
      { type: 'TRIP_FEE', amountMinor: '840' },
    ],
    total: '12840',
    request: '9150',
  },
  PYG: {
    lines: [
      { type: 'TRIP_PRICE', amountMinor: '1000000' },
      { type: 'TRIP_FEE', amountMinor: '71000' },
    ],
    total: '1071000',
    request: '640000',
  },
};

const LIST = 'SELECT * FROM core.booking_guest_trips($1, $2, $3::uuid, $4)';
const T0 = '2035-05-02T09:17:23.000Z';
const at = (minutes: number): string => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

/** Trip BOOKED (fixture 9948 : sans assureur ni caution, répétable dans une transaction). */
async function world(
  tx: Tx,
  c: CountryCase,
  guest: string,
  minute: number,
  start: string,
  end: string,
): Promise<{ trip: string; holder: string }> {
  const a = AMOUNTS[c.currency]!;
  await setVirtualNow(tx, at(minute));
  const w = (
    await tx.query<{ trip_id: string; holder_id: string }>(
      `SELECT * FROM test_fixture.us214_trip($1, $2, 'Ana', 'Pérez', 'María', 'Gómez', $3, $4,
                                             $5::jsonb)`,
      [c.country, guest, start, end, JSON.stringify(a.lines)],
    )
  ).rows[0]!;
  return { trip: w.trip_id, holder: w.holder_id };
}

const read = async (
  tx: Tx,
  hash: Buffer,
  tab: string | null = null,
  trip: string | null = null,
  limit = 200,
): Promise<Row[]> => (await tx.query<Row>(LIST, [hash, tab, trip, limit])).rows;

describe.each(COUNTRIES)('US-214 — Mis viajes et détail du trip ($country, $currency)', (c) => {
  const a = AMOUNTS[c.currency]!;

  it('S08 / S09 : trips et demande du voyageur de la session, onglets, hôte minimisé, lieu minimisé, total du devis tel quel, état du contrat ; trip d’autrui : aucune ligne', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const other = uuid();
        // trip à venir (contrat signé), trip annulé (aucun contrat), trip d'une autre personne
        const upcoming = await world(
          tx,
          c,
          guest,
          1,
          '2035-06-10T15:00:00.000Z',
          '2035-06-13T15:00:00.000Z',
        );
        const cancelled = await world(
          tx,
          c,
          guest,
          2,
          '2035-07-10T15:00:00.000Z',
          '2035-07-12T15:00:00.000Z',
        );
        const foreign = await world(
          tx,
          c,
          other,
          3,
          '2035-06-10T15:00:00.000Z',
          '2035-06-13T15:00:00.000Z',
        );
        await tx.query('SELECT test_fixture.us211_sign($1)', [upcoming.trip]);
        await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [
          cancelled.trip,
          'CANCELLED_BY_HOST',
        ]);
        // demande en attente de l'hôte (fixture 9948), heure limite posée par le test
        await setVirtualNow(tx, at(4));
        const respondBy = '2035-05-03T09:17:23.000Z';
        const request = (
          await tx.query<{ hold_id: string }>(
            `SELECT * FROM test_fixture.us214_request($1, $2, 'Luis', 'Benítez', 'Ciudad de prueba',
                                                      $3, $4, $5, $6)`,
            [
              c.country,
              guest,
              '2035-08-01T15:00:00.000Z',
              '2035-08-03T15:00:00.000Z',
              a.request,
              respondBy,
            ],
          )
        ).rows[0]!.hold_id;

        await setVirtualNow(tx, at(5));
        const g = await openSession(tx, guest);
        const o = await openSession(tx, other);
        const host = await openSession(tx, upcoming.holder);

        // liste : demande d'abord, puis à venir, puis annulés
        const rows = await read(tx, g.hash);
        expect(rows.map((r) => [r['outcome'], r['kind'], r['item_id'], r['tab']])).toEqual([
          ['DONE', 'REQUEST', request, 'REQUESTED'],
          ['DONE', 'TRIP', upcoming.trip, 'UPCOMING'],
          ['DONE', 'TRIP', cancelled.trip, 'CANCELLED'],
        ]);
        const [req, up, cx] = rows as [Row, Row, Row];
        expect(up).toMatchObject({
          public_ref: `K-${upcoming.trip.slice(0, 8).toUpperCase()}`,
          status: 'BOOKED',
          payment_status: 'CONFIRMED',
          currency: c.currency,
          timezone: c.timezone,
          respond_by: null,
          vehicle_make: 'Toyota',
          vehicle_model: 'Yaris',
          vehicle_year: 2022,
          // L2-PM-35 : prénom et initiale de l'hôte, jamais son nom complet
          host_name: 'María G.',
          // total du devis figé écrit par le test (Σ lignes), en unités mineures, jamais recalculé
          total_minor: a.total,
          contract_state: 'SIGNED',
        });
        expect((up['starts_at'] as Date).toISOString()).toBe('2035-06-10T15:00:00.000Z');
        expect((up['ends_at'] as Date).toISOString()).toBe('2035-06-13T15:00:00.000Z');
        expect(up['place_label']).toEqual(expect.any(String));
        expect(up['place_address']).toEqual(expect.any(String));
        expect(up['place_city']).toEqual(expect.any(String));
        // trip annulé : nom du lieu seulement (ni adresse ni ville), aucun contrat généré
        expect(cx).toMatchObject({
          status: 'CANCELLED_BY_HOST',
          total_minor: a.total,
          place_address: null,
          place_city: null,
          contract_state: 'NONE',
          host_name: 'María G.',
        });
        expect(cx['place_label']).toEqual(expect.any(String));
        // demande : ni référence, ni statut du paiement, ni contrat ; ville seulement ; heure limite
        expect(req).toMatchObject({
          public_ref: null,
          status: 'AWAITING_HOST',
          payment_status: null,
          currency: c.currency,
          vehicle_make: 'Kia',
          vehicle_model: 'Rio',
          vehicle_year: 2021,
          host_name: 'Luis B.',
          place_label: null,
          place_address: null,
          place_city: 'Ciudad de prueba',
          total_minor: a.request,
          contract_state: null,
        });
        expect((req['respond_by'] as Date).toISOString()).toBe(respondBy);
        expect((req['starts_at'] as Date).toISOString()).toBe('2035-08-01T15:00:00.000Z');
        // PYG sans décimale : l'unité mineure EST l'unité (aucun chiffre perdu ni ajouté)
        expect(String(up['total_minor'])).toBe(a.total);

        // onglet : filtre en base
        expect((await read(tx, g.hash, 'CANCELLED')).map((r) => r['item_id'])).toEqual([
          cancelled.trip,
        ]);
        expect((await read(tx, g.hash, 'REQUESTED')).map((r) => r['item_id'])).toEqual([request]);
        expect(await read(tx, g.hash, 'DONE')).toEqual([]);
        expect((await read(tx, g.hash, null, null, 1)).map((r) => r['item_id'])).toEqual([request]);

        // détail : le trip de la session ; une demande n'est jamais lue par son identifiant
        expect((await read(tx, g.hash, null, upcoming.trip)).map((r) => r['item_id'])).toEqual([
          upcoming.trip,
        ]);
        expect(await read(tx, g.hash, null, request)).toEqual([]);

        // RLS-1 / IDOR : trip d'une autre personne, trip hébergé par la session, trip inconnu :
        // aucune ligne, même réponse qu'un trip absent
        expect(await read(tx, g.hash, null, foreign.trip)).toEqual([]);
        expect(await read(tx, o.hash, null, upcoming.trip)).toEqual([]);
        expect(await read(tx, host.hash, null, upcoming.trip)).toEqual([]);
        expect(await read(tx, g.hash, null, uuid())).toEqual([]);
        // la liste d'une autre personne ne contient que ses trips ; l'hôte n'y voit rien
        expect((await read(tx, o.hash)).map((r) => r['item_id'])).toEqual([foreign.trip]);
        expect(await read(tx, host.hash)).toEqual([]);

        // session inconnue : AUTH_REQUIRED, aucune donnée
        const unknown = await read(tx, newToken().hash);
        expect(unknown).toHaveLength(1);
        expect(unknown[0]).toMatchObject({ outcome: 'AUTH_REQUIRED', item_id: null });
        // saisie invalide : REQUEST_INVALID, aucune donnée
        for (const [tab, limit] of [
          ['PAST', 200],
          [null, 0],
          [null, 201],
        ] as const) {
          const bad = await read(tx, g.hash, tab, null, limit);
          expect(bad).toHaveLength(1);
          expect(bad[0]).toMatchObject({ outcome: 'REQUEST_INVALID', item_id: null });
        }
      });
    } finally {
      await releaseClient(api);
    }
  });
});

describe('US-214 — la lecture du voyageur est fermée aux autres rôles de production', () => {
  it.each(['app_worker', 'app_anon'] as const)(
    '%s ne peut pas l’exécuter (42501)',
    async (role) => {
      const client = await connectAs(role);
      try {
        await expect(client.query(LIST, [newToken().hash, null, null, 10])).rejects.toMatchObject({
          code: '42501',
        });
      } finally {
        await releaseClient(client);
      }
    },
  );
});
