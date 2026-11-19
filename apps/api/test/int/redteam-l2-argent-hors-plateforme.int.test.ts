/**
 * US-222b — red team argent du lot 2, axe « paiement hors plateforme proposé par l'hôte » (19 US-222
 * critère 2, scénario 9 ; pré-mortem L2 : RT-L2-M12 ; risque L2-PM-30, P-08). Contrôle produit et
 * message : textes saisis par l'hôte que le voyageur lit (zone et ville publiques de l'annonce,
 * libellé et adresse du lieu de remise lus après la réservation) et confirmation de la réservation.
 * Rapport : docs/team/redteam/L2-argent.md.
 *
 * Sous les rôles de PRODUCTION (`connectAs` : L0-05), en PA et en PY (pays de la configuration),
 * transactions ANNULÉES. Attendu (pré-mortem, RT-L2-M12) : « détecté et masqué, ou bloqué avec
 * signalement ». Le filtre automatique des textes publics (ADR-114, US-118, US-122) vise les
 * coordonnées ; il est éprouvé ici sur les coordonnées (bloqué, test vert) et sur une proposition de
 * paiement hors plateforme sans coordonnée (défaut : `it.fails` documenté, F-L2-ARG-02 et 04).
 */
import { randomUUID } from 'node:crypto';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  CASES,
  DAY,
  asWorker,
  inTx,
  invariant,
  iso,
  open,
  openSession,
  register,
  type Case,
} from '../support/redteam-l2.js';

const createLocation = async (
  tx: pg.ClientBase,
  hash: Buffer,
  org: string,
  t: { label?: string; address?: string; city?: string; area?: string | null },
): Promise<string> => {
  const { rows } = await tx.query<{ outcome: string }>(
    `SELECT outcome FROM core.catalog_cmd_create_location($1, $2, 'HOME', $3, $4, $5, $6, NULL,
                                                          NULL)`,
    [
      hash,
      org,
      t.label ?? 'Casa',
      t.address ?? 'Calle Ficticia 123',
      t.city ?? 'Ciudad Uno',
      t.area === undefined ? 'Barrio Norte' : t.area,
    ],
  );
  return rows[0]?.outcome ?? '';
};

/** Hôte réel : personne inscrite, session, compte d'hôte individuel (vraies commandes). */
async function hostOf(tx: pg.ClientBase, country: string): Promise<{ hash: Buffer; org: string }> {
  const user = await register(tx, country, randomUUID(), 'Hugo', 'Rivas');
  const hash = await openSession(tx, user);
  const acc = await tx.query<{ outcome: string; org_id: string | null }>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [hash, country, 'INDIVIDUAL'],
  );
  const org = acc.rows[0]?.org_id;
  if (acc.rows[0]?.outcome !== 'DONE' || !org) throw new Error('compte d’hôte refusé');
  return { hash, org };
}

/**
 * Propositions de paiement hors plateforme SANS coordonnée (es, pt-BR, en) : moyens de paiement
 * locaux nommés, espèces, virement, remise pour contourner Kmino.
 */
const OFFERS = [
  'Pago directo por Yappy, sin comisión',
  'Efectivo al entregar: 10% menos',
  'Pix direto comigo, sem taxa do app',
  'Pay me cash, skip the app fee',
] as const;

const observed = new Map<string, { area: string[]; label: string[]; address: string[] }>();

describe.each(CASES)(
  'RT-L2-ARG — paiement hors plateforme proposé par l’hôte ($country)',
  (c: Case) => {
    const obs = { area: [] as string[], label: [] as string[], address: [] as string[] };
    observed.set(c.country, obs);

    it('S9 : coordonnées de l’hôte dans un texte public (téléphone, messagerie, lien, courriel, chiffres en lettres) ⇒ lieu refusé (LOCATION_AREA_ADDRESS / LOCATION_CITY_INVALID) ; propositions de paiement hors plateforme sans coordonnée : issues observées ; confirmation : parties de la notification par identifiants seulement (aucun téléphone de l’hôte) ; invariant par jambe', async () => {
      const api = await open('app_api');
      await inTx(api, {}, async (tx) => {
        const h = await hostOf(tx, c.country);
        for (const area of [
          'WhatsApp 6123-4567 para pagar',
          'Pago por wa.me/50761234567',
          'Paga por Yappy al seis uno dos tres cuatro cinco seis siete',
          'Escríbeme a pago arroba correo punto com',
          'Insta @hugo.rivas.autos',
        ]) {
          expect(await createLocation(tx, h.hash, h.org, { area }), area).toBe(
            'LOCATION_AREA_ADDRESS',
          );
        }
        expect(await createLocation(tx, h.hash, h.org, { city: 'hugo.rivas@correo.com' })).toBe(
          'LOCATION_CITY_INVALID',
        );
        // témoin : un lieu honnête passe (le filtre ne gêne pas l'hôte honnête, DEC-FONDATEUR-22)
        await tx.query('SAVEPOINT rt_l2_ok');
        expect(await createLocation(tx, h.hash, h.org, {})).toBe('DONE');
        await tx.query('ROLLBACK TO SAVEPOINT rt_l2_ok');
        // propositions de paiement hors plateforme sans coordonnée : issue notée, jugée par it.fails
        for (const offer of OFFERS) {
          for (const [field, t] of [
            ['area', { area: offer }],
            ['label', { label: offer }],
            ['address', { address: `Calle 50, ${offer}` }],
          ] as const) {
            await tx.query('SAVEPOINT rt_l2_offer');
            obs[field].push(await createLocation(tx, h.hash, h.org, t));
            await tx.query('ROLLBACK TO SAVEPOINT rt_l2_offer');
          }
        }
        expect(obs.area).toHaveLength(OFFERS.length);
      });

      // confirmation (US-213) : parties de la notification par identifiants seulement
      const worker = await open('app_worker');
      await inTx(worker, { worker: 'payment_command' }, async (tx) => {
        const trip = randomUUID();
        const guest = randomUUID();
        await tx.query(
          `SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, 'UTC', $7, $8)`,
          [
            trip,
            guest,
            randomUUID(),
            randomUUID(),
            c.country,
            c.currency,
            iso(Date.UTC(2054, 0, 10) + 3 * DAY),
            iso(Date.UTC(2054, 0, 10) + 6 * DAY),
          ],
        );
        await asWorker(tx, 'ntf_dispatcher');
        const { rows } = await tx.query<{ p: Record<string, unknown> | null }>(
          'SELECT core.booking_notification_parties($1, $2::uuid) AS p',
          ['TRIP', trip],
        );
        const parties = rows[0]?.p;
        expect(parties).not.toBeNull();
        expect(Object.keys(parties ?? {}).sort()).toEqual(['guestUserId', 'hostUserId']);
        expect(parties?.['guestUserId']).toBe(guest);
      });
      await invariant(c.country);
    });

    // F-L2-ARG-02 (constat, gravité PROPOSÉE moyenne) : le filtre des textes PUBLICS de l'hôte (zone,
    // ville ; 0084, 0093) ne vise que les coordonnées : une proposition de paiement hors plateforme
    // qui nomme un moyen local (Yappy, Pix), les espèces ou une remise « sans la commission » passe,
    // sans masque ni signalement (aucune entrée dans la file GRAY_MARKET de la console, 0064). Attendu
    // (pré-mortem RT-L2-M12) : détecté et masqué, ou bloqué avec signalement à l'ops.
    it.fails(
      'F-L2-ARG-02 : une proposition de paiement hors plateforme dans la zone publique du lieu est refusée ou signalée',
      async () => {
        await open('app_api'); // L0-05
        const o = observed.get(c.country)?.area ?? [];
        // observation absente : le tableau est vide, l'assertion passe et l'it.fails rougit
        expect(o.filter((x) => x === 'DONE')).toEqual([]);
      },
    );
    // F-L2-ARG-03 (constat, gravité PROPOSÉE moyenne) : le libellé et l'adresse du lieu de remise,
    // lus par le voyageur après la réservation (catalog_guest_meeting_point, booking_guest_trips),
    // ne passent par AUCUN filtre : une proposition de paiement hors plateforme y est enregistrée
    // telle quelle et montrée au voyageur après son paiement.
    it.fails(
      'F-L2-ARG-03 : une proposition de paiement hors plateforme dans le libellé ou l’adresse du lieu de remise est refusée ou signalée',
      async () => {
        await open('app_api'); // L0-05
        const o = observed.get(c.country);
        const all = [...(o?.label ?? []), ...(o?.address ?? [])];
        expect(all.filter((x) => x === 'DONE')).toEqual([]);
      },
    );
  },
);
