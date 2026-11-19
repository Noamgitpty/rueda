/**
 * US-701 partie 701c (T70 c ; migration 0151, ADR-173) — base de la caution annoncée avant le
 * checkout, `core.catalog_public_deposit_basis(uuid[])`, sous les rôles de PRODUCTION (assertion
 * L0-05 par `connectAs`), en PA (USD) et en PY (PYG), transactions annulées :
 * - `app_api` : pays, devise et classe de valeur du CATALOGUE des seules annonces LISTED demandées
 *   (classe inconnue ⇒ NULL, jamais une classe devinée) ; annonce non publiée ou inconnue ⇒ aucune
 *   ligne ; au plus 50 identifiants lus (une page de résultats, `SEARCH_LIMIT_MAX`) ; aucune
 *   colonne personnelle ni [C2] (ni compte, ni plaque, ni lieu) ;
 * - `app_worker` et `app_anon` : EXECUTE refusé (42501).
 * Attendus : 08 BR-PAY-06 « Moment de l'évaluation » (avant le checkout, seuls COUNTRY et CLASS,
 * connus du véhicule), 17 §3.2.3 — jamais le code testé. La décision elle-même (montant, mention
 * générique, caution non disponible) est celle de PAY, prouvée par `deposit-notice.test.ts` et par
 * `pg-search.int.test.ts` sur cette base.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { listedListing } from '../support/checkout.ts';

const NOW = '2026-12-01T12:00:00.000Z';
const BASIS = 'SELECT * FROM core.catalog_public_deposit_basis($1::uuid[])';

type Row = Record<string, unknown>;

async function listing(tx: pg.ClientBase, cc: CountryCase, valueClass: string | null) {
  const l = await listedListing(tx, cc, Number(cc.rentMinor));
  await tx.query('SELECT test_fixture.us108_set_value_class($1, $2)', [l.vehicleId, valueClass]);
  return l;
}

describe.each(COUNTRIES)(
  'US-701c — base de la caution avant le checkout ($country, $currency)',
  (cc) => {
    it('app_api : pays, devise et classe du catalogue des annonces LISTED seules ; inconnue ⇒ NULL ; non publiée ou inconnue ⇒ aucune ligne ; colonnes fermées', async () => {
      const api = await connectAs('app_api'); // assertion L0-05
      try {
        await inTx(api, { virtualNow: NOW }, async (tx) => {
          const luxe = await listing(tx, cc, 'LUXE');
          const premium = await listing(tx, cc, 'PREMIUM');
          const unknown = await listing(tx, cc, null);
          const snoozed = await listing(tx, cc, 'STANDARD');
          await tx.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [
            snoozed.listingId,
            'SNOOZED',
          ]);
          const { rows, fields } = await tx.query<Row>(BASIS, [
            [luxe.listingId, premium.listingId, unknown.listingId, snoozed.listingId, uuid()],
          ]);
          expect(fields.map((f) => f.name)).toEqual([
            'listing_id',
            'country_code',
            'currency',
            'value_class',
          ]);
          const byId = new Map(rows.map((r) => [String(r['listing_id']), r]));
          expect(byId.size).toBe(3);
          expect(byId.get(luxe.listingId)).toEqual({
            listing_id: luxe.listingId,
            country_code: cc.country,
            currency: cc.currency,
            value_class: 'LUXE',
          });
          expect(byId.get(premium.listingId)?.['value_class']).toBe('PREMIUM');
          // classe inconnue : NULL (la décision de PAY la traite en fail-closed : CLASS vrai)
          expect(byId.get(unknown.listingId)?.['value_class']).toBeNull();
          expect(byId.has(snoozed.listingId)).toBe(false);
          // tableau vide ou NULL : aucune ligne, aucune erreur
          expect((await tx.query<Row>(BASIS, [[]])).rows).toEqual([]);
          expect((await tx.query<Row>(BASIS, [null])).rows).toEqual([]);
        });
      } finally {
        await releaseClient(api);
      }
    });

    it('app_api : au plus 50 identifiants lus (une page de résultats)', async () => {
      const api = await connectAs('app_api'); // assertion L0-05
      try {
        await inTx(api, { virtualNow: NOW }, async (tx) => {
          const l = await listing(tx, cc, 'STANDARD');
          const filler = Array.from({ length: 50 }, () => uuid());
          expect((await tx.query<Row>(BASIS, [[...filler, l.listingId]])).rows).toEqual([]);
          expect((await tx.query<Row>(BASIS, [[l.listingId, ...filler]])).rows).toHaveLength(1);
        });
      } finally {
        await releaseClient(api);
      }
    });
  },
);

describe('US-701c — la base de la caution est fermée aux autres rôles de production', () => {
  it.each(['app_worker', 'app_anon'] as const)(
    '%s ne peut pas l’exécuter (42501)',
    async (role) => {
      const client = await connectAs(role); // assertion L0-05
      try {
        await expect(client.query(BASIS, [[uuid()]])).rejects.toMatchObject({ code: '42501' });
      } finally {
        await releaseClient(client);
      }
    },
  );
});
