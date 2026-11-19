/**
 * US-222b — red team argent du lot 2, axe « paiement hors plateforme proposé par l'hôte » (19 US-222
 * critère 2, scénario 9 ; pré-mortem L2 : RT-L2-M12 ; risque L2-PM-30, P-08). Contrôle produit et
 * message : textes saisis par l'hôte que le voyageur lit (zone et ville publiques de l'annonce,
 * libellé et adresse du lieu de remise lus après la réservation) et confirmation de la réservation.
 * Rapport : docs/team/redteam/L2-argent.md.
 *
 * Sous les rôles de PRODUCTION (`connectAs` : L0-05), en PA et en PY (pays de la configuration),
 * transactions ANNULÉES. Attendu (pré-mortem, RT-L2-M12) : « détecté et masqué, ou bloqué avec
 * signalement » (refus, texte masqué ou entrée de la file GRAY_MARKET). Le filtre automatique des textes publics (ADR-114, US-118, US-122) vise les
 * coordonnées ; il est éprouvé ici sur les coordonnées (bloqué, test vert) et sur une proposition de
 * paiement hors plateforme sans coordonnée (défaut : `it.fails` documenté, F-L2-ARG-02 et 03).
 * US-222d (correctifs, migration 0155, ADR-176) : F-L2-ARG-02 et 03 sont corrigés (signal
 * « paiement hors plateforme » : zone et ville refusées, libellé et adresse signalés dans la file
 * GRAY_MARKET) ; leurs `it.fails` sont devenus des `it` sans changer l'attaque ni l'observation, et
 * le chemin qui réussit est prouvé (texte légitime accepté, adresse avec chiffres acceptée et non
 * signalée).
 */
import { randomUUID } from 'node:crypto';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  CASES,
  DAY,
  asStaff,
  asWorker,
  inTx,
  invariant,
  iso,
  open,
  openSession,
  register,
  staffMember,
  type Case,
} from '../support/redteam-l2.js';

const createLocation = async (
  tx: pg.ClientBase,
  hash: Buffer,
  org: string,
  t: { label?: string; address?: string; city?: string; area?: string | null },
): Promise<string> => (await createLocationRow(tx, hash, org, t)).outcome;

const createLocationRow = async (
  tx: pg.ClientBase,
  hash: Buffer,
  org: string,
  t: { label?: string; address?: string; city?: string; area?: string | null },
): Promise<{ outcome: string; id: string | null }> => {
  const { rows } = await tx.query<{ outcome: string; location_id: string | null }>(
    `SELECT outcome, location_id FROM core.catalog_cmd_create_location($1, $2, 'HOME', $3, $4, $5, $6, NULL,
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
  return { outcome: rows[0]?.outcome ?? '', id: rows[0]?.location_id ?? null };
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

/**
 * Issue observée d'une proposition : `outcome` de la commande ; si le lieu est créé, `stored` = texte
 * relu par l'hôte (`catalog_host_locations` : masqué s'il diffère de l'offre) et `flagged` = le lieu
 * ou le compte d'hôte figure dans la file GRAY_MARKET lue par un agent OPS du pays
 * (`support_staff_queues`). Le signal attendu (RT-L2-M12 : « détecté et masqué, ou bloqué avec
 * signalement ») est : refus, OU texte masqué, OU signalement ; l'it.fails juge ce signal, jamais
 * l'issue brute, pour qu'un correctif par masque ou par signalement le fasse passer au vert.
 */
interface OfferOutcome {
  readonly offer: string;
  readonly outcome: string;
  readonly stored: string | null;
  readonly flagged: boolean;
}
const signalled = (o: OfferOutcome, field: 'area' | 'label' | 'address'): boolean =>
  o.outcome !== 'DONE' ||
  o.flagged ||
  (o.stored !== null && o.stored !== (field === 'address' ? `Calle 50, ${o.offer}` : o.offer));
const observed = new Map<
  string,
  { area: OfferOutcome[]; label: OfferOutcome[]; address: OfferOutcome[] }
>();

describe.each(CASES)(
  'RT-L2-ARG — paiement hors plateforme proposé par l’hôte ($country)',
  (c: Case) => {
    const obs = {
      area: [] as OfferOutcome[],
      label: [] as OfferOutcome[],
      address: [] as OfferOutcome[],
    };
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
        // propositions de paiement hors plateforme sans coordonnée : issue, texte relu et file
        // GRAY_MARKET notés, jugés par les it.fails
        const ops = await staffMember(tx, 'OPS_AGENT', c.country);
        const column = {
          area: 'area_label',
          label: 'place_label',
          address: 'address_line',
        } as const;
        for (const offer of OFFERS) {
          for (const [field, t] of [
            ['area', { area: offer }],
            ['label', { label: offer }],
            ['address', { address: `Calle 50, ${offer}` }],
          ] as const) {
            await tx.query('SAVEPOINT rt_l2_offer');
            const r = await createLocationRow(tx, h.hash, h.org, t);
            let stored: string | null = null;
            let flagged = false;
            if (r.outcome === 'DONE' && r.id !== null) {
              const back = await tx.query<Record<string, string | null>>(
                'SELECT * FROM core.catalog_host_locations($1, $2)',
                [h.hash, h.org],
              );
              stored = back.rows.find((x) => x['location_id'] === r.id)?.[column[field]] ?? null;
              // lecture de la file par l'ops (point de sauvegarde : une file absente ou une lecture
              // refusée vaut « non signalé »)
              await tx.query('SAVEPOINT rt_l2_queue');
              try {
                const s = await asStaff(tx, ops, c.country);
                const q = await tx.query<{ outcome: string; body: unknown }>(
                  'SELECT outcome, body FROM core.support_staff_queues($1, $2, $3)',
                  [s.hash, 'GRAY_MARKET', 200],
                );
                const text = JSON.stringify(q.rows);
                flagged = text.includes(r.id) || text.includes(h.org);
              } catch {
                flagged = false;
              }
              await tx.query('ROLLBACK TO SAVEPOINT rt_l2_queue');
            }
            obs[field].push({ offer, outcome: r.outcome, stored, flagged });
            await tx.query('ROLLBACK TO SAVEPOINT rt_l2_offer');
          }
        }
        expect(obs.area).toHaveLength(OFFERS.length);
        expect(obs.label).toHaveLength(OFFERS.length);
        expect(obs.address).toHaveLength(OFFERS.length);
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
    // (pré-mortem RT-L2-M12) : détecté et masqué, ou bloqué, ou signalé à l'ops : chaque offre
    // admise doit être refusée, masquée ou présente dans la file GRAY_MARKET (`signalled`).
    // US-222d : corrigé (0155) — `it.fails` inversé en `it`, attaque et jugement inchangés
    it('F-L2-ARG-02 : une proposition de paiement hors plateforme dans la zone publique du lieu est refusée ou signalée', async () => {
      await open('app_api'); // L0-05
      const o = observed.get(c.country)?.area ?? [];
      // US-222d : en `it`, une observation absente doit rougir : affirmée
      expect(o).toHaveLength(OFFERS.length);
      expect(o.filter((x) => !signalled(x, 'area')).map((x) => x.offer)).toEqual([]);
    });
    // F-L2-ARG-03 (constat, gravité PROPOSÉE moyenne) : le libellé et l'adresse du lieu de remise,
    // lus par le voyageur après la réservation (catalog_guest_meeting_point, booking_guest_trips),
    // ne passent par AUCUN filtre : une proposition de paiement hors plateforme y est enregistrée
    // telle quelle et montrée au voyageur après son paiement. Attendu : même signal que F-L2-ARG-02
    // (un signalement à l'ops suffit : l'adresse porte des chiffres légitimes).
    // US-222d : corrigé (0155) — `it.fails` inversé en `it`, attaque et jugement inchangés
    it('F-L2-ARG-03 : une proposition de paiement hors plateforme dans le libellé ou l’adresse du lieu de remise est refusée ou signalée', async () => {
      await open('app_api'); // L0-05
      const o = observed.get(c.country);
      // US-222d : en `it`, une observation absente doit rougir : affirmée
      expect(o?.label).toHaveLength(OFFERS.length);
      expect(o?.address).toHaveLength(OFFERS.length);
      const missed = [
        ...(o?.label ?? []).filter((x) => !signalled(x, 'label')),
        ...(o?.address ?? []).filter((x) => !signalled(x, 'address')),
      ];
      expect(missed.map((x) => x.offer)).toEqual([]);
    });

    // US-222d (preuve du chemin qui réussit, jamais plus lourd que Turo) : texte légitime accepté,
    // adresse avec chiffres acceptée et NON signalée ; zone qui propose un paiement hors plateforme
    // refusée (LOCATION_AREA_OFF_PLATFORM) ET compte d'hôte présent dans la file GRAY_MARKET ;
    // libellé qui le propose : lieu créé, présent dans la file
    it('US-222d : lieu légitime (zone, ville, libellé, adresse avec chiffres) créé et non signalé ; zone hors plateforme ⇒ refus et compte signalé ; libellé hors plateforme ⇒ lieu créé et signalé (GRAY_MARKET)', async () => {
      const api = await open('app_api');
      await inTx(api, {}, async (tx) => {
        const h = await hostOf(tx, c.country);
        const ops = await staffMember(tx, 'OPS_AGENT', c.country);
        const queue = async (): Promise<string> => {
          const s = await asStaff(tx, ops, c.country);
          const q = await tx.query<{ outcome: string; body: unknown }>(
            'SELECT outcome, body FROM core.support_staff_queues($1, $2, $3)',
            [s.hash, 'GRAY_MARKET', 200],
          );
          expect(q.rows[0]?.outcome).toBe('OK');
          return JSON.stringify(q.rows[0]?.body ?? null);
        };
        for (const t of [
          {
            label: 'Estacionamiento del centro comercial',
            address: 'Calle 50 y Avenida Samuel Lewis, Edificio 12, local 3, piso 2',
            city: 'Ciudad Uno',
            area: 'Costa del Este',
          },
          {
            label: 'Portaria do prédio',
            address: 'Rua das Flores 1250, apto 34, bloco B',
            city: 'Cidade Dois',
            area: 'Bairro Jardim',
          },
          {
            label: 'Main entrance',
            address: '25 de Mayo 1580, garage 2',
            city: 'Ciudad Tres',
            area: 'Barrio Norte',
          },
        ]) {
          const r = await createLocationRow(tx, h.hash, h.org, t);
          expect(r.outcome, t.address).toBe('DONE');
          const text = await queue();
          expect(text.includes(r.id ?? '∅'), t.address).toBe(false);
          expect(text.includes(h.org)).toBe(false);
        }
        // zone qui propose un paiement hors plateforme : refus, et le compte est dans la file
        expect(
          (await createLocationRow(tx, h.hash, h.org, { area: 'Pago por Yappy, sin comisión' }))
            .outcome,
        ).toBe('LOCATION_AREA_OFF_PLATFORM');
        expect(
          (await createLocationRow(tx, h.hash, h.org, { city: 'Ciudad Uno, efectivo' })).outcome,
        ).toBe('LOCATION_CITY_OFF_PLATFORM');
        expect(await queue()).toContain(h.org);
        // libellé qui le propose : lieu créé (jamais bloqué), lieu dans la file
        const flagged = await createLocationRow(tx, h.hash, h.org, {
          label: 'Casa — pagamento por fora, direto comigo',
        });
        expect(flagged.outcome).toBe('DONE');
        expect(await queue()).toContain(flagged.id!);
        // faux positif connu et documenté (revue qa n° 5, revue argent n° 7 ; ADR-176) : un mot du
        // catalogue employé honnêtement dans le libellé (« cajero de pago en efectivo ») signale le
        // lieu à l'ops, sans jamais le bloquer : le lieu est créé, l'ops tranche (jamais plus lourd
        // que Turo) ; le même mot dans la zone publique serait refusé
        const honest = await createLocationRow(tx, h.hash, h.org, {
          label: 'Junto al cajero de pago en efectivo del centro comercial',
        });
        expect(honest.outcome).toBe('DONE');
        expect(await queue()).toContain(honest.id!);
      });
      await invariant(c.country);
    });
  },
);
