/**
 * US-218 — adaptateur des notes publiques d'annonces (16 REV-010 : nombre de trips, moyenne, badge
 * « Nuevo » sans avis). Sans base : un exécuteur simulé rend les lignes de
 * `core.review_listing_ratings` (0102) ; les attendus viennent de 19 US-218 critère 2 (3 avis 5, 4,
 * 3 et 2 trips non notés ⇒ moyenne 4,0 et 5 trips) et de 16 REV-010, jamais du code testé. La
 * preuve sur base réelle est `packages/db/test/l0/l0-us218-reviews.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  LISTING_RATINGS_MAX,
  ListingRatingStoreError,
  PgListingRatingStore,
  UnavailableListingRatingStore,
} from './listing-ratings.store.js';
import type { SqlExecutor } from './listing-ratings.store.js';

const A = '0b9f3c1e-2d4a-4b6c-8e0f-1a2b3c4d5e6f';
const B = '1c0a4d2f-3e5b-4c7d-9f10-2b3c4d5e6f70';

function executor(rows: Record<string, unknown>[] | Error) {
  const calls: { text: string; values: readonly unknown[] | undefined }[] = [];
  const db: SqlExecutor = {
    query: <R extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      return rows instanceof Error ? Promise.reject(rows) : Promise.resolve({ rows: rows as R[] });
    },
  };
  return { db, calls };
}

const row = (over: Record<string, unknown> = {}) => ({
  listing_id: A,
  vehicle_trip_count: 5,
  vehicle_review_count: 3,
  vehicle_avg_x100: 400,
  host_trip_count: 5,
  host_review_count: 3,
  host_avg_x100: 400,
  ...over,
});

describe('US-218 — notes publiques d’annonces (REV-010)', () => {
  it('critère 2 : 3 avis (5, 4, 3) et 2 trips non notés ⇒ moyenne 4,0 (400) et 5 trips, pour le véhicule et l’hôte', async () => {
    const { db, calls } = executor([row()]);
    expect(await new PgListingRatingStore(db).ratings([A])).toEqual([
      {
        listingId: A,
        vehicle: { tripCount: 5, reviewCount: 3, averageX100: 400, isNew: false },
        host: { tripCount: 5, reviewCount: 3, averageX100: 400, isNew: false },
      },
    ]);
    // requête paramétrée, une seule fonction de la base
    expect(calls).toEqual([
      { text: 'SELECT * FROM core.review_listing_ratings($1::uuid[])', values: [[A]] },
    ]);
  });

  it('sans avis : badge « Nuevo », aucune moyenne ; les trips non notés restent comptés', async () => {
    const { db } = executor([
      row({
        vehicle_review_count: 0,
        vehicle_avg_x100: null,
        host_review_count: 0,
        host_avg_x100: null,
        vehicle_trip_count: 2,
        host_trip_count: 2,
      }),
    ]);
    const [r] = await new PgListingRatingStore(db).ratings([A]);
    expect(r?.host).toEqual({ tripCount: 2, reviewCount: 0, averageX100: null, isNew: true });
  });

  it('liste vide : aucun appel ; doublons et majuscules ramenés à un identifiant ; trop d’annonces ou identifiant invalide : refus sans appel', async () => {
    const { db, calls } = executor([]);
    const store = new PgListingRatingStore(db);
    expect(await store.ratings([])).toEqual([]);
    expect(calls).toHaveLength(0);
    await store.ratings([A, A.toUpperCase(), B]);
    expect(calls[0]?.values).toEqual([[A, B]]);
    const many = Array.from(
      { length: LISTING_RATINGS_MAX + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    await expect(store.ratings(many)).rejects.toBeInstanceOf(ListingRatingStoreError);
    await expect(store.ratings(['pas-un-uuid'])).rejects.toBeInstanceOf(ListingRatingStoreError);
    expect(calls).toHaveLength(1);
  });

  it('ligne illisible (annonce non demandée, moyenne hors [1, 5], moyenne sans avis, compte négatif) : refus de toute la réponse', async () => {
    for (const bad of [
      row({ listing_id: B }),
      row({ host_avg_x100: 501 }),
      row({ host_avg_x100: 99 }),
      row({ host_review_count: 0 }),
      row({ host_review_count: 2, host_avg_x100: null }),
      row({ vehicle_trip_count: -1 }),
      row({ vehicle_trip_count: '5' }),
    ]) {
      const { db } = executor([bad]);
      await expect(
        new PgListingRatingStore(db).ratings([A]),
        JSON.stringify(bad),
      ).rejects.toBeInstanceOf(ListingRatingStoreError);
    }
  });

  it('erreur de la base : SQLSTATE seulement ; magasin indisponible : refus (fail-closed)', async () => {
    const { db } = executor(Object.assign(new Error('secret détaillé'), { code: '42501' }));
    const err = await new PgListingRatingStore(db).ratings([A]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ListingRatingStoreError);
    expect((err as ListingRatingStoreError).sqlstate).toBe('42501');
    expect((err as Error).message).not.toContain('secret');
    await expect(new UnavailableListingRatingStore().ratings()).rejects.toBeInstanceOf(
      ListingRatingStoreError,
    );
  });
});
