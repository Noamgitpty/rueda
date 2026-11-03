/**
 * US-019 — RLS des jambes `core.payment_payment_operation_leg` (0028 ; 17 §2.3, §3.2.7 : RLS-2,
 * RLS-24, RLS-28 ; revues sécurité n° 6 et qa n° 7), sous `app_api` avec le contexte posé par
 * `setSessionContext` (assertion L0-05 par withRole / connectAs), sur des DONNÉES RÉELLES :
 * - l'hôte TITULAIRE lit sa seule jambe HOST, jamais celles d'un autre compte d'hôte, ni les jambes
 *   INSURER / TAX_THIRD_PARTY / PLATFORM ; un co-hôte ne lit rien ; un `org_id` forgé ne donne rien ;
 * - FINANCE lit les jambes de SON pays seulement ; ADMIN des deux pays lit tout ;
 * - OPS lit seulement les jambes du trip couvert par son dossier ouvert, dans son pays ;
 * - le voyageur et une session sans contexte ne lisent rien ; `beneficiary_ref` n'est pas lisible.
 * Monde de test d'US-011 (`support/rls.ts`) ; jambes écrites par la fixture 9500 avec les montants
 * des vecteurs TJ (USD et PYG sans décimale).
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { asActor, buildWorld, sorted, uuid } from '../support/rls.ts';
import type { CountryWorld, World } from '../support/rls.ts';

const set = loadGoldenVectors();
const CAPTURE: Record<string, ReturnType<typeof legVector>> = {
  [legVector(set, 'TJ01').currency]: legVector(set, 'TJ01'),
  [legVector(set, 'TJ08a').currency]: legVector(set, 'TJ08a'),
};
const LEG_NAMES = ['HOST', 'INSURER', 'PLATFORM', 'TAX_THIRD_PARTY'];

let world: World;
/** Par pays : opération du trip a1 (compte A) et du trip b1 (compte B). */
const ops: { a1: string; b1: string }[] = [];

beforeAll(async () => {
  const api = await connectAs('app_api');
  try {
    world = await buildWorld(api, COUNTRIES);
    await withTestTransaction(api, { commit: true }, async (tx) => {
      for (const x of world.countries) {
        const v = CAPTURE[x.c.currency];
        if (v === undefined) throw new Error(`aucun vecteur TJ en ${x.c.currency}`);
        const legs = JSON.stringify(
          Object.fromEntries(Object.entries(v.legsMinor).map(([k, a]) => [k, a.toString()])),
        );
        const pair = { a1: uuid(), b1: uuid() };
        for (const [op, trip] of [
          [pair.a1, x.trips.a1.id],
          [pair.b1, x.trips.b1.id],
        ] as const) {
          await tx.query(
            `SELECT test_fixture.pay_insert_operation_raw($1, $2, 'CAPTURE', $3::bigint, $4::jsonb, true)`,
            [op, trip, v.totalMinor.toString(), legs],
          );
        }
        ops.push(pair);
      }
    });
  } finally {
    await releaseClient(api);
  }
});

const w = (i: number): CountryWorld => {
  const x = world.countries[i];
  if (!x) throw new Error(`pays ${i}`);
  return x;
};
const ourOps = (): string[] => ops.flatMap((p) => [p.a1, p.b1]);
const all = (op: string): string[] => LEG_NAMES.map((l) => `${op}/${l}`);

async function visible(tx: pg.ClientBase): Promise<string[]> {
  const { rows } = await tx.query<{ k: string }>(
    `SELECT operation_id::text || '/' || leg AS k FROM core.payment_payment_operation_leg
      WHERE operation_id = ANY ($1::uuid[]) ORDER BY 1`,
    [ourOps()],
  );
  return rows.map((r) => r.k);
}

const api = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> => withRole('app_api', fn);
const countries = (): string[] => COUNTRIES.map((c) => c.country);

describe.each([0, 1])('jambes : RLS par acteur, pays n° %i', (i) => {
  it('hôte titulaire : sa seule jambe HOST ; autre compte, co-hôte, org_id forgé : rien', async () => {
    const x = w(i);
    const mine = ops[i];
    if (mine === undefined) throw new Error('opérations absentes');
    await api(async (client) => {
      await asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: x.orgA }, async (tx) => {
        expect(await visible(tx)).toEqual([`${mine.a1}/HOST`]);
      });
      await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgB }, async (tx) => {
        expect(await visible(tx)).toEqual([`${mine.b1}/HOST`]);
      });
      // l'hôte B qui pose le compte A : n'en est pas titulaire
      await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgA }, async (tx) => {
        expect(await visible(tx)).toEqual([]);
      });
      // co-hôte actif du compte A : jamais les gains du titulaire
      await asActor(client, { kind: 'HOST', actorId: world.cohost, orgId: x.orgA }, async (tx) => {
        expect(await visible(tx)).toEqual([]);
      });
    });
  });

  it('voyageur et session sans contexte : rien (sur une table peuplée)', async () => {
    await api(async (client) => {
      await asActor(client, { kind: 'GUEST', actorId: world.guest1 }, async (tx) => {
        expect(await visible(tx)).toEqual([]);
      });
      expect(await visible(client)).toEqual([]);
    });
    // la table n'est pas vide : un ADMIN des deux pays voit les huit jambes du pays
    await api((client) =>
      asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: countries() },
        async (tx) => {
          const got = await visible(tx);
          const mine = ops[i];
          expect(got).toEqual(
            expect.arrayContaining([...all(mine?.a1 ?? ''), ...all(mine?.b1 ?? '')]),
          );
        },
      ),
    );
  });
});

describe('jambes : personnel', () => {
  it('ADMIN des deux pays : toutes les jambes ; portée posée réduite à un pays : ce pays seulement', async () => {
    await api(async (client) => {
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: countries() },
        async (tx) => {
          expect(await visible(tx)).toEqual(sorted(ourOps().flatMap(all)));
        },
      );
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: [w(1).c.country] },
        async (tx) => {
          const second = ops[1];
          expect(await visible(tx)).toEqual(
            sorted([...all(second?.a1 ?? ''), ...all(second?.b1 ?? '')]),
          );
        },
      );
    });
  });

  it('FINANCE du premier pays : ses jambes ; l’autre pays : rien, même s’il est posé dans la portée', async () => {
    const first = ops[0];
    await api((client) =>
      asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.financeFirst, countryScope: countries() },
        async (tx) => {
          expect(await visible(tx)).toEqual(
            sorted([...all(first?.a1 ?? ''), ...all(first?.b1 ?? '')]),
          );
        },
      ),
    );
    await api((client) =>
      asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.financeFirst, countryScope: [w(1).c.country] },
        async (tx) => {
          expect(await visible(tx)).toEqual([]);
        },
      ),
    );
  });

  it('OPS : seulement les jambes du trip de son dossier ouvert, dans son pays ; SUPPORT sans dossier : rien', async () => {
    const first = ops[0];
    await api(async (client) => {
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.opsFirst, countryScope: [w(0).c.country] },
        async (tx) => {
          expect(await visible(tx)).toEqual(sorted(all(first?.a1 ?? '')));
        },
      );
      // dossier assigné dans le second pays, rôle OPS limité au premier (RLS-20) : rien
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.opsFirst, countryScope: [w(1).c.country] },
        async (tx) => {
          expect(await visible(tx)).toEqual([]);
        },
      );
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.supportAll, countryScope: countries() },
        async (tx) => {
          expect(await visible(tx)).toEqual([]);
        },
      );
    });
  });

  it('colonnes lisibles par app_api : sans beneficiary_ref ; aucune écriture', async () => {
    await api(async (client) => {
      const { rows } = await client.query<{ col: string; sel: boolean }>(
        `SELECT a.attname::text AS col,
                pg_catalog.has_column_privilege('app_api', a.attrelid, a.attnum, 'SELECT') AS sel
           FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = 'core.payment_payment_operation_leg'::regclass AND a.attnum > 0
            AND NOT a.attisdropped ORDER BY 1`,
      );
      expect(rows.filter((r) => r.sel).map((r) => r.col)).toEqual(
        sorted([
          'amount_minor',
          'country_code',
          'created_at',
          'leg',
          'operation_id',
          'org_id',
          'trip_id',
        ]),
      );
      for (const priv of ['INSERT', 'UPDATE', 'DELETE']) {
        const r = await client.query<{ has: boolean }>(
          `SELECT pg_catalog.has_table_privilege('app_api', 'core.payment_payment_operation_leg', $1) AS has`,
          [priv],
        );
        expect(r.rows[0]?.has, priv).toBe(false);
      }
    });
  });
});
