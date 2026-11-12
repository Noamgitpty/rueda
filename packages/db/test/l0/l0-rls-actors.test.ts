/**
 * L0-05 / L0-07 — politiques RLS par type d'acteur et par pays (US-011 ; 17 §2.3, §11 ; ADR-053).
 * Sous les rôles de PRODUCTION (assertion L0-05 en tête de chaque test, withRole / connectAs), le
 * contexte `app.*` posé par la couche d'accès réelle (`setSessionContext`), en USD (PA) et en PYG
 * (PY). Les attentes viennent du tableau RLS-1 à RLS-20 de 17 §2.3, jamais du code testé.
 *
 * Couvert ici : RLS-1 (voyageur contre voyageur), cloisonnement hôte contre hôte et pays contre
 * pays, RLS-5 (app_anon), RLS-6 (OPS / SUPPORT sans puis avec dossier, bris de glace motivé),
 * RLS-7 (FINANCE, partiel : pas encore de relevés ni de KYC), RLS-8 (contexte absent, incomplet ou
 * mal formé), RLS-9 (co-hôte de portée véhicule), RLS-12 (inventaire), RLS-13 (écriture directe
 * du voyageur), RLS-18 (limite documentée), RLS-20 (OPS {premier pays} sur un dossier de l'autre
 * pays, ADMIN des deux pays). RLS-15 / RLS-16 : l0-rls-15-security-definer.test.ts.
 */
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { setSessionContext } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import {
  asActor,
  buildWorld,
  ids,
  sorted,
  staffSessionHash,
  uuid,
  withRawContext,
} from '../support/rls.ts';
import type { CountryWorld, World } from '../support/rls.ts';

let world: World;

beforeAll(async () => {
  const api = await connectAs('app_api');
  try {
    world = await buildWorld(api, COUNTRIES);
  } finally {
    await releaseClient(api);
  }
});

/** Tables lisibles par app_api (0025) et colonne d'identifiant. */
const API_TABLES = [
  ['booking_trip', 'id'],
  ['booking_checkout_hold', 'id'],
  ['booking_guest_occupancy', 'id'],
  ['payment_payment_operation', 'id'],
  ['iam_user_account', 'id'],
  ['iam_organization', 'id'],
  ['iam_membership', 'id'],
  ['support_support_case', 'id'],
] as const;

const allCountries = (): string[] => COUNTRIES.map((c) => c.country);
const w = (i: number): CountryWorld => {
  const x = world.countries[i];
  if (!x) throw new Error(`pays ${i}`);
  return x;
};
const tripIds = (pick: (x: CountryWorld) => string[]): string[] =>
  sorted(world.countries.flatMap(pick));

const api = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> => withRole('app_api', fn);

describe('RLS-8 — contexte absent, incomplet ou mal formé : 0 ligne, aucune erreur', () => {
  it('app_api sans aucun paramètre app.* : 0 ligne sur toutes les tables lisibles', async () => {
    await api(async (client) => {
      await withRawContext(client, {}, async (tx) => {
        for (const [table] of API_TABLES) expect(await ids(tx, table), table).toEqual([]);
      });
    });
  });

  it('contextes incomplets ou mal formés : 0 ligne, aucune erreur (au plus son propre compte)', async () => {
    // [paramètres, compte visible par user_account_self_read] : un identifiant d'acteur valide
    // sous un type valide ne donne que SON compte ; tout le reste exige le contexte complet.
    const bad: [Record<string, string>, string | null][] = [
      [{ 'app.actor_kind': 'GUEST' }, null], // sans actor_id
      [{ 'app.actor_kind': 'GUEST', 'app.actor_id': 'pas-un-uuid' }, null],
      [{ 'app.actor_kind': 'HOST', 'app.actor_id': world.holderA }, world.holderA], // sans org_id
      [
        { 'app.actor_kind': 'HOST', 'app.actor_id': world.holderA, 'app.org_id': "x' OR true --" },
        world.holderA,
      ],
      [{ 'app.actor_kind': 'STAFF', 'app.actor_id': world.staff.adminAll }, world.staff.adminAll],
      [
        {
          'app.actor_kind': 'STAFF',
          'app.actor_id': world.staff.adminAll,
          'app.country_scope': 'tous',
        },
        world.staff.adminAll,
      ],
      [{ 'app.actor_kind': 'AGENCY', 'app.actor_id': world.guest1 }, null], // historique, sans objet
      [{ 'app.actor_kind': 'WORKER', 'app.worker_name': 'booking_conversion' }, null],
      [{ 'app.actor_kind': 'guest', 'app.actor_id': world.guest1 }, null], // casse
    ];
    await api(async (client) => {
      for (const [settings, self] of bad) {
        await withRawContext(client, settings, async (tx) => {
          for (const [table] of API_TABLES) {
            const expected = table === 'iam_user_account' && self !== null ? [self] : [];
            expect(await ids(tx, table), `${JSON.stringify(settings)} ${table}`).toEqual(expected);
          }
        });
      }
    });
  });

  it('app_worker sans contexte, ou d’un nom hors liste : 0 ligne sur les tables AVL / PAY', async () => {
    await withRole('app_worker', async (client) => {
      for (const settings of [{}, { 'app.actor_kind': 'WORKER', 'app.worker_name': 'inconnu' }]) {
        await withRawContext(client, settings, async (tx) => {
          for (const table of [
            'booking_trip',
            'booking_checkout_hold',
            'payment_payment_operation',
          ]) {
            expect(await ids(tx, table), table).toEqual([]);
          }
        });
      }
    });
  });
});

describe('RLS-1 — voyageur contre voyageur (tous hôtes, tous pays)', () => {
  it('guest1 voit ses trips, holds, occupations et opérations dans les deux pays, rien d’autre', async () => {
    await api(async (client) => {
      await asActor(client, { kind: 'GUEST', actorId: world.guest1 }, async (tx) => {
        expect(await ids(tx, 'booking_trip')).toEqual(
          tripIds((x) => [x.trips.a1.id, x.trips.b1.id]),
        );
        expect(await ids(tx, 'booking_checkout_hold')).toEqual(tripIds((x) => [x.holds.h1]));
        expect(await ids(tx, 'booking_guest_occupancy', 'trip_id')).toEqual(
          tripIds((x) => [x.trips.a1.id, x.trips.b1.id]),
        );
        expect(await ids(tx, 'payment_payment_operation')).toEqual(
          tripIds((x) => [x.ops.a1, x.ops.b1, x.ops.h1]),
        );
        expect(await ids(tx, 'iam_user_account')).toEqual([world.guest1]);
        // un voyageur ne lit ni compte d'hôte, ni appartenance, ni dossier
        for (const t of ['iam_organization', 'iam_membership', 'support_support_case']) {
          expect(await ids(tx, t), t).toEqual([]);
        }
      });
    });
  });

  it('guest2 ne lit rien de guest1, ni par UUID ni par public_ref (404)', async () => {
    await api(async (client) => {
      await asActor(client, { kind: 'GUEST', actorId: world.guest2 }, async (tx) => {
        for (const x of world.countries) {
          const byId = await tx.query('SELECT 1 FROM core.booking_trip WHERE id = $1', [
            x.trips.a1.id,
          ]);
          const byRef = await tx.query('SELECT 1 FROM core.booking_trip WHERE public_ref = $1', [
            x.trips.a1.publicRef,
          ]);
          const hold = await tx.query('SELECT 1 FROM core.booking_checkout_hold WHERE id = $1', [
            x.holds.h1,
          ]);
          const ops = await tx.query(
            'SELECT 1 FROM core.payment_payment_operation WHERE id = ANY ($1::uuid[])',
            [[x.ops.a1, x.ops.b1, x.ops.h1]],
          );
          const occ = await tx.query(
            'SELECT 1 FROM core.booking_guest_occupancy WHERE guest_user_id = $1',
            [world.guest1],
          );
          const acc = await tx.query('SELECT 1 FROM core.iam_user_account WHERE id = $1', [
            world.guest1,
          ]);
          for (const r of [byId, byRef, hold, ops, occ, acc]) expect(r.rowCount).toBe(0);
        }
        // ses propres objets restent visibles
        expect(await ids(tx, 'booking_trip')).toEqual(tripIds((x) => [x.trips.a2.id]));
      });
    });
  });

  it('les colonnes de paiement sensibles et le hachage du mot de passe ne sont jamais lisibles (42501)', async () => {
    await api(async (client) => {
      for (const sql of [
        'SELECT idem_plain FROM core.payment_payment_operation',
        'SELECT provider_reference FROM core.payment_payment_operation',
        'SELECT password_hash FROM core.iam_user_account',
        'SELECT * FROM core.iam_user_account',
      ]) {
        await expect(
          asActor(client, { kind: 'GUEST', actorId: world.guest1 }, (tx) => tx.query(sql)),
          sql,
        ).rejects.toMatchObject({ code: '42501' });
      }
    });
  });
});

describe.each(COUNTRIES.map((c, i) => [c.country, c.currency, i] as const))(
  'hôte contre hôte, pays contre pays (%s, %s)',
  (_country, _currency, i) => {
    it('titulaire A : trips de SON compte d’hôte de ce pays seulement ; aucun hold, aucune opération, aucune occupation du voyageur', async () => {
      const x = w(i);
      await api(async (client) => {
        await asActor(
          client,
          { kind: 'HOST', actorId: world.holderA, orgId: x.orgA },
          async (tx) => {
            expect(await ids(tx, 'booking_trip')).toEqual(sorted([x.trips.a1.id, x.trips.a2.id]));
            for (const t of [
              'booking_checkout_hold',
              'booking_guest_occupancy',
              'payment_payment_operation',
              'support_support_case',
            ]) {
              expect(await ids(tx, t), t).toEqual([]);
            }
            expect(await ids(tx, 'iam_organization')).toEqual([x.orgA]);
            expect(await ids(tx, 'iam_user_account')).toEqual([world.holderA]);
            // titulaire : toutes les appartenances de son compte (lui, co-hôte, co-hôte retiré)
            const members = await tx.query<{ user_id: string }>(
              'SELECT user_id FROM core.iam_membership ORDER BY 1',
            );
            expect(members.rows.map((r) => r.user_id)).toEqual(
              sorted([world.holderA, world.cohost, world.exCohost]),
            );
          },
        );
      });
    });

    it('le même particulier, titulaire dans l’autre pays, ne voit pas ces trips sous ce compte d’hôte (mono-pays)', async () => {
      const x = w(i);
      const other = w(1 - i);
      await api(async (client) => {
        await asActor(
          client,
          { kind: 'HOST', actorId: world.holderA, orgId: other.orgA },
          async (tx) => {
            const r = await tx.query(
              'SELECT 1 FROM core.booking_trip WHERE id = ANY ($1::uuid[])',
              [[x.trips.a1.id, x.trips.a2.id, x.trips.b1.id]],
            );
            expect(r.rowCount).toBe(0);
            expect(await ids(tx, 'iam_organization')).toEqual([other.orgA]);
          },
        );
      });
    });

    it('IDOR : l’hôte B ne lit aucun trip de A par UUID ou public_ref ; org_id forgé vers A = 0 ligne', async () => {
      const x = w(i);
      await api(async (client) => {
        await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgB }, async (tx) => {
          expect(await ids(tx, 'booking_trip')).toEqual([x.trips.b1.id]);
          for (const [col, v] of [
            ['id', x.trips.a1.id],
            ['public_ref', x.trips.a1.publicRef],
          ] as const) {
            const r = await tx.query(`SELECT 1 FROM core.booking_trip WHERE ${col} = $1`, [v]);
            expect(r.rowCount, col).toBe(0);
          }
        });
        // défaut de la couche d'accès : org_id du compte A posé pour l'hôte B (non membre)
        await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgA }, async (tx) => {
          for (const [table] of API_TABLES) {
            const got = await ids(tx, table);
            expect(got, table).toEqual(table === 'iam_user_account' ? [x.holderB] : []);
          }
        });
      });
    });

    it('RLS-9 — co-hôte de portée {v1} : trips de v1 seulement ; la portée posée ne peut que réduire', async () => {
      const x = w(i);
      await api(async (client) => {
        // portée relue dans membership, même si la couche d'accès n'a pas posé vehicle_scope
        await asActor(
          client,
          { kind: 'HOST', actorId: world.cohost, orgId: x.orgA },
          async (tx) => {
            expect(await ids(tx, 'booking_trip')).toEqual([x.trips.a1.id]);
            const v2 = await tx.query('SELECT 1 FROM core.booking_trip WHERE vehicle_id = $1', [
              x.v2,
            ]);
            expect(v2.rowCount).toBe(0);
            // jamais le compte d'hôte (gains, numéro fiscal) ; seulement sa propre appartenance
            expect(await ids(tx, 'iam_organization')).toEqual([]);
            const members = await tx.query<{ user_id: string }>(
              'SELECT user_id FROM core.iam_membership',
            );
            expect(members.rows.map((r) => r.user_id)).toEqual([world.cohost]);
          },
        );
        // tentative d'élargissement par le contexte : {v2} n'est pas dans membership
        await asActor(
          client,
          { kind: 'HOST', actorId: world.cohost, orgId: x.orgA, vehicleScope: [x.v1, x.v2] },
          async (tx) => {
            expect(await ids(tx, 'booking_trip')).toEqual([x.trips.a1.id]);
          },
        );
        await asActor(
          client,
          { kind: 'HOST', actorId: world.cohost, orgId: x.orgA, vehicleScope: [x.v2] },
          async (tx) => {
            expect(await ids(tx, 'booking_trip')).toEqual([]);
          },
        );
        // le titulaire peut se réduire lui-même à un véhicule
        await asActor(
          client,
          { kind: 'HOST', actorId: world.holderA, orgId: x.orgA, vehicleScope: [x.v2] },
          async (tx) => {
            expect(await ids(tx, 'booking_trip')).toEqual([x.trips.a2.id]);
          },
        );
      });
    });

    it('co-hôte RETIRÉ : plus aucune ligne du compte d’hôte', async () => {
      const x = w(i);
      await api(async (client) => {
        await asActor(
          client,
          { kind: 'HOST', actorId: world.exCohost, orgId: x.orgA, vehicleScope: [x.v1, x.v2] },
          async (tx) => {
            for (const [table] of API_TABLES) {
              const got = await ids(tx, table);
              expect(got, table).toEqual(table === 'iam_user_account' ? [world.exCohost] : []);
            }
          },
        );
      });
    });

    it('RLS-13 — écriture directe du voyageur sur son hold ou son trip : 42501, aucun changement', async () => {
      const x = w(i);
      await api(async (client) => {
        for (const sql of [
          `UPDATE core.booking_checkout_hold SET expires_at = expires_at + interval '1 day' WHERE id = $1`,
          `UPDATE core.booking_checkout_hold SET status = 'CONVERTED' WHERE id = $1`,
          `UPDATE core.booking_checkout_hold SET vehicle_id = gen_random_uuid() WHERE id = $1`,
          `UPDATE core.booking_checkout_hold SET payment_in_flight_until = NULL WHERE id = $1`,
          `DELETE FROM core.booking_checkout_hold WHERE id = $1`,
          `UPDATE core.booking_trip SET status = 'CANCELLED_BY_HOST' WHERE id = $1`,
        ]) {
          const target = sql.includes('booking_trip') ? x.trips.a1.id : x.holds.h1;
          await expect(
            asActor(client, { kind: 'GUEST', actorId: world.guest1 }, (tx) =>
              tx.query(sql, [target]),
            ),
            sql,
          ).rejects.toMatchObject({ code: '42501' });
        }
        await asActor(client, { kind: 'GUEST', actorId: world.guest1 }, async (tx) => {
          const { rows } = await tx.query<{ status: string }>(
            'SELECT status FROM core.booking_checkout_hold WHERE id = $1',
            [x.holds.h1],
          );
          expect(rows).toEqual([{ status: 'ACTIVE' }]);
        });
      });
    });
  },
);

describe('staff : dossiers assignés et portée par pays (RLS-6, RLS-7, RLS-20)', () => {
  it('RLS-6 — SUPPORT des deux pays SANS dossier : 0 ligne partout', async () => {
    await api(async (client) => {
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.supportAll, countryScope: allCountries() },
        async (tx) => {
          for (const [table] of API_TABLES) {
            const got = await ids(tx, table);
            expect(got, table).toEqual(
              table === 'iam_user_account' ? [world.staff.supportAll] : [],
            );
          }
        },
      );
    });
  });

  it('RLS-6 — OPS avec un dossier ouvert : le trip du dossier et ses opérations seulement ; un dossier clos n’ouvre rien', async () => {
    const x = w(0);
    await api(async (client) => {
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.opsFirst, countryScope: [x.c.country] },
        async (tx) => {
          expect(await ids(tx, 'booking_trip')).toEqual([x.trips.a1.id]);
          expect(await ids(tx, 'payment_payment_operation')).toEqual([x.ops.a1]);
          expect(await ids(tx, 'booking_checkout_hold')).toEqual([]);
          expect(await ids(tx, 'iam_organization')).toEqual([]);
          // ses dossiers du pays couvert (ouvert et clos), jamais celui de l'autre pays
          expect(await ids(tx, 'support_support_case')).toEqual(
            sorted([world.cases.firstA1, world.cases.closedA2]),
          );
        },
      );
    });
  });

  it('RLS-6 — bris de glace léger (17 §2.3) : un dossier BREAK_GLASS motivé ouvre l’objet, le retrait le referme ; sans motif, refusé', async () => {
    const x = w(0);
    await api(async (client) => {
      await expect(
        asActor(client, { kind: 'GUEST', actorId: world.guest1 }, (tx) =>
          tx.query(
            `SELECT test_fixture.rls_insert_support_case($1, $2, $3, $4, 'OPEN', 'BREAK_GLASS', NULL)`,
            [uuid(), x.c.country, x.trips.b1.id, world.staff.opsFirst],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'support_case_break_glass_reason' });
      // dossier motivé, dans une transaction annulée : visible, puis plus rien après l'annulation
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.opsFirst, countryScope: [x.c.country] },
        async (tx) => {
          await tx.query(
            `SELECT test_fixture.rls_insert_support_case($1, $2, $3, $4, 'OPEN', 'BREAK_GLASS', $5)`,
            [
              uuid(),
              x.c.country,
              x.trips.b1.id,
              world.staff.opsFirst,
              'contrôle de fraude signalé',
            ],
          );
          expect(await ids(tx, 'booking_trip')).toEqual(sorted([x.trips.a1.id, x.trips.b1.id]));
        },
      );
      // après l'annulation, le dossier n'existe plus : l'objet redevient invisible
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.opsFirst, countryScope: [x.c.country] },
        async (tx) => {
          expect(await ids(tx, 'booking_trip')).toEqual([x.trips.a1.id]);
        },
      );
    });
  });

  it('RLS-20 — OPS de portée {premier pays} : 0 ligne du second pays, même assignée, même avec une portée posée élargie', async () => {
    const second = w(1);
    await api(async (client) => {
      for (const countryScope of [[w(0).c.country], allCountries(), [second.c.country]]) {
        await asActor(
          client,
          { kind: 'STAFF', actorId: world.staff.opsFirst, countryScope },
          async (tx) => {
            const r = await tx.query('SELECT 1 FROM core.booking_trip WHERE id = $1', [
              second.trips.a1.id,
            ]);
            expect(r.rowCount, countryScope.join(',')).toBe(0);
            const c = await tx.query('SELECT 1 FROM core.support_support_case WHERE id = $1', [
              world.cases.secondA1,
            ]);
            expect(c.rowCount, countryScope.join(',')).toBe(0);
            const o = await tx.query('SELECT 1 FROM core.payment_payment_operation WHERE id = $1', [
              second.ops.a1,
            ]);
            expect(o.rowCount, countryScope.join(',')).toBe(0);
          },
        );
      }
    });
  });

  it('RLS-20 — ADMIN des deux pays : tout dans les deux pays ; la portée posée réduit à un pays', async () => {
    await api(async (client) => {
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: allCountries() },
        async (tx) => {
          const mine = await tx.query<{ id: string }>(
            'SELECT id::text FROM core.booking_trip WHERE id = ANY ($1::uuid[]) ORDER BY 1',
            [world.countries.flatMap((x) => [x.trips.a1.id, x.trips.a2.id, x.trips.b1.id])],
          );
          expect(mine.rows.map((r) => r.id)).toEqual(
            tripIds((x) => [x.trips.a1.id, x.trips.a2.id, x.trips.b1.id]),
          );
          const orgs = await tx.query(
            'SELECT 1 FROM core.iam_organization WHERE id = ANY ($1::uuid[])',
            [world.countries.flatMap((x) => [x.orgA, x.orgB])],
          );
          expect(orgs.rowCount).toBe(4);
        },
      );
      for (const [i, x] of world.countries.entries()) {
        const other = w(1 - i);
        await asActor(
          client,
          { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: [x.c.country] },
          async (tx) => {
            const r = await tx.query(
              'SELECT 1 FROM core.booking_trip WHERE id = ANY ($1::uuid[])',
              [[other.trips.a1.id, other.trips.a2.id, other.trips.b1.id]],
            );
            expect(r.rowCount).toBe(0);
            const own = await tx.query(
              'SELECT 1 FROM core.booking_trip WHERE id = ANY ($1::uuid[])',
              [[x.trips.a1.id, x.trips.a2.id, x.trips.b1.id]],
            );
            expect(own.rowCount).toBe(3);
          },
        );
      }
    });
  });

  it('ADMIN : appartenances et dossiers de support de sa portée pays (lectures positives)', async () => {
    const [x, other] = [w(0), w(1)];
    await api(async (client) => {
      for (const [scope, worlds] of [
        [allCountries(), [x, other]],
        [[x.c.country], [x]],
      ] as const) {
        await asActor(
          client,
          { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: [...scope] },
          async (tx) => {
            const members = await tx.query<{ org_id: string }>(
              'SELECT DISTINCT org_id::text FROM core.iam_membership WHERE org_id = ANY ($1::uuid[]) ORDER BY 1',
              [[x.orgA, x.orgB, other.orgA, other.orgB]],
            );
            expect(
              members.rows.map((r) => r.org_id),
              scope.join(','),
            ).toEqual(sorted(worlds.flatMap((y) => [y.orgA, y.orgB])));
            // titulaire, co-hôte, co-hôte retiré (A) et titulaire (B), par pays
            const n = await tx.query(
              'SELECT 1 FROM core.iam_membership WHERE org_id = ANY ($1::uuid[])',
              [worlds.flatMap((y) => [y.orgA, y.orgB])],
            );
            expect(n.rowCount, scope.join(',')).toBe(4 * worlds.length);
            const cases = await tx.query<{ id: string }>(
              'SELECT id::text FROM core.support_support_case WHERE id = ANY ($1::uuid[]) ORDER BY 1',
              [[world.cases.firstA1, world.cases.secondA1, world.cases.closedA2]],
            );
            expect(
              cases.rows.map((r) => r.id),
              scope.join(','),
            ).toEqual(
              sorted(
                worlds.length === 2
                  ? [world.cases.firstA1, world.cases.secondA1, world.cases.closedA2]
                  : [world.cases.firstA1, world.cases.closedA2],
              ),
            );
          },
        );
      }
    });
  });

  it('RLS-7 (partiel) — FINANCE {premier pays} : trips, holds et opérations de tous les hôtes de ce pays ; rien de l’autre ; aucun compte d’autrui', async () => {
    const [x, other] = [w(0), w(1)];
    await api(async (client) => {
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.financeFirst, countryScope: allCountries() },
        async (tx) => {
          const trips = await tx.query<{ id: string }>(
            'SELECT id::text FROM core.booking_trip WHERE id = ANY ($1::uuid[]) ORDER BY 1',
            [[x.trips.a1.id, x.trips.a2.id, x.trips.b1.id, other.trips.a1.id]],
          );
          expect(trips.rows.map((r) => r.id)).toEqual(
            sorted([x.trips.a1.id, x.trips.a2.id, x.trips.b1.id]),
          );
          const ops = await tx.query<{ id: string }>(
            'SELECT id::text FROM core.payment_payment_operation WHERE id = ANY ($1::uuid[]) ORDER BY 1',
            [[x.ops.a1, x.ops.b1, x.ops.h1, other.ops.a1, other.ops.h1]],
          );
          expect(ops.rows.map((r) => r.id)).toEqual(sorted([x.ops.a1, x.ops.b1, x.ops.h1]));
          const holds = await tx.query(
            'SELECT 1 FROM core.booking_checkout_hold WHERE id = ANY ($1::uuid[])',
            [[x.holds.h1, x.holds.h2, other.holds.h1]],
          );
          expect(holds.rowCount).toBe(2);
          expect(await ids(tx, 'iam_user_account')).toEqual([world.staff.financeFirst]);
          expect(await ids(tx, 'iam_membership')).toEqual([]);
          expect(await ids(tx, 'support_support_case')).toEqual([]);
        },
      );
    });
  });

  it('rôle expiré, compte suspendu, ou acteur sans rôle interne qui se dit STAFF : 0 ligne', async () => {
    await api(async (client) => {
      for (const actorId of [
        world.staff.adminExpired,
        world.staff.adminSuspended,
        world.guest1,
        world.holderA,
      ]) {
        await asActor(
          client,
          { kind: 'STAFF', actorId, countryScope: allCountries() },
          async (tx) => {
            for (const [table] of API_TABLES) {
              const got = await ids(tx, table);
              expect(got, `${actorId} ${table}`).toEqual(
                table === 'iam_user_account' ? [actorId] : [],
              );
            }
          },
        );
      }
    });
  });
});

describe('RLS-5, RLS-12, RLS-18', () => {
  it('RLS-5 — app_anon : aucun droit sur aucune table de core, aucune fonction de politique', async () => {
    await withRole('app_anon', async (client) => {
      const { rows } = await client.query<{ t: string }>(
        `SELECT c.relname AS t
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relkind IN ('r', 'p', 'v', 'm')
            AND (pg_catalog.has_table_privilege('app_anon', c.oid, 'SELECT')
                 OR pg_catalog.has_any_column_privilege('app_anon', c.oid, 'SELECT'))`,
      );
      expect(rows).toEqual([]);
      for (const sql of [
        'SELECT 1 FROM core.booking_trip',
        'SELECT 1 FROM core.iam_organization',
        `SELECT app.has_staff_role('ADMIN', 'AA')`,
        'SELECT app.actor_id()',
      ]) {
        await expect(client.query(sql), sql).rejects.toMatchObject({ code: '42501' });
      }
    });
  });

  it('RLS-12 — toute vue a security_invoker ; toute table à org_id ou guest_user_id a une politique app_api ; ENABLE + FORCE partout', async () => {
    await api(async (client) => {
      const views = await client.query<{ v: string }>(
        `SELECT n.nspname || '.' || c.relname AS v
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'v' AND n.nspname IN ('core', 'app', 'platform')
            AND NOT COALESCE('security_invoker=true' = ANY (c.reloptions), false)`,
      );
      expect(views.rows).toEqual([]);
      const tables = await client.query<{
        t: string;
        api_policies: number;
        rls: boolean;
        force: boolean;
      }>(
        `SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                (SELECT count(*)::int FROM pg_catalog.pg_policy p
                  WHERE p.polrelid = c.oid AND 'app_api'::regrole = ANY (p.polroles)) AS api_policies
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relkind IN ('r', 'p')
            AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                         WHERE a.attrelid = c.oid AND a.attname IN ('org_id', 'guest_user_id')
                           AND NOT a.attisdropped)
          ORDER BY 1`,
      );
      expect(tables.rows.map((r) => r.t)).toEqual(
        sorted([
          'booking_checkout_hold',
          'booking_guest_occupancy',
          'booking_trip',
          'booking_vehicle_occupancy',
          // US-114 (0074, ADR-104) : même règle (commandes de l'hôte et fonctions de domaine de
          // catalog_cmd_owner, console d'iam_staff_owner)
          'catalog_addition_request',
          // US-115 (0067, ADR-099) : AUCUN droit ni politique d'app_api ; accès par les seules
          // fonctions SECURITY DEFINER de catalog_cmd_owner (hôte désigné par son jeton)
          'catalog_listing',
          'catalog_listing_photo',
          'catalog_location',
          'catalog_vehicle',
          'iam_membership',
          // US-123 (0075, ADR-105) : AUCUN droit ni politique d'app_api ; accès par les seules
          // fonctions SECURITY DEFINER de kyc_cmd_owner (hôte désigné par son jeton)
          'kyc_host_tax_profile',
          'kyc_host_verification',
          'payment_payment_operation_leg', // US-019 : jambe HOST du titulaire, ADMIN / FINANCE
          'payment_psp_submerchant', // US-061 : statut du titulaire, ADMIN / FINANCE
          'settlement_settlement',
          'settlement_platform_advance', // US-062 : créance du titulaire, FINANCE / ADMIN
          'settlement_settlement_leg',
          'settlement_trip_leg_balance',
        ]),
      );
      for (const r of tables.rows) {
        expect(r, r.t).toMatchObject({ rls: true, force: true });
        if (r.t.startsWith('catalog_') || r.t.startsWith('kyc_')) {
          expect(r.api_policies, r.t).toBe(0);
        } else expect(r.api_policies, r.t).toBeGreaterThan(0);
      }
      const all = await client.query<{ t: string }>(
        `SELECT c.relname AS t
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname IN ('core', 'platform') AND c.relkind IN ('r', 'p')
            AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`,
      );
      expect(all.rows).toEqual([]);
    });
  });

  it('RLS-18 — LIMITE réduite (US-012) : l’identité d’un ADMIN connu ne suffit plus, il faut la preuve de possession d’une session élevée', async () => {
    // Ce test ne prétend pas fermer la limite (17 §2.3 B8) : il montre ce que la relecture en base
    // réduit. Depuis US-012 (ADR-062), app.has_staff_role exige que app.session_token_hash désigne
    // une session VIVANTE, ÉLEVÉE par TOTP, de l'acteur ; app_api ne lit pas iam_session et
    // l'élévation exige une preuve HMAC dont la clé n'est lisible par aucun rôle applicatif
    // (l0-iam-staff-mfa). Reste : qui détient le jeton d'une session élevée (ou son empreinte) agit
    // comme son titulaire, jusqu'à son expiration (8 h) ou sa révocation.
    const all = `{${allCountries().join(',')}}`;
    await api(async (client) => {
      await withRawContext(
        client,
        { 'app.actor_kind': 'STAFF', 'app.actor_id': uuid(), 'app.country_scope': all },
        async (tx) => {
          expect(await ids(tx, 'booking_trip')).toEqual([]); // identité inventée : rien
        },
      );
      // identité d'un ADMIN réel, sans empreinte ou avec une empreinte inventée : rien
      for (const hash of ['', 'ab'.repeat(32)]) {
        await withRawContext(
          client,
          {
            'app.actor_kind': 'STAFF',
            'app.actor_id': world.staff.adminAll,
            'app.country_scope': all,
            'app.session_token_hash': hash,
          },
          async (tx) => {
            expect(await ids(tx, 'booking_trip'), hash).toEqual([]);
          },
        );
      }
      // l'empreinte d'une session élevée d'UN AUTRE membre du staff ne vaut pas pour l'ADMIN
      await withRawContext(
        client,
        {
          'app.actor_kind': 'STAFF',
          'app.actor_id': world.staff.adminAll,
          'app.country_scope': all,
          'app.session_token_hash': staffSessionHash(world.staff.financeFirst) ?? '',
        },
        async (tx) => {
          expect(await ids(tx, 'booking_trip')).toEqual([]);
        },
      );
      // avec la preuve de possession de SA session élevée : les lectures de l'ADMIN
      await withRawContext(
        client,
        {
          'app.actor_kind': 'STAFF',
          'app.actor_id': world.staff.adminAll,
          'app.country_scope': all,
          'app.session_token_hash': staffSessionHash(world.staff.adminAll) ?? '',
        },
        async (tx) => {
          const r = await tx.query('SELECT 1 FROM core.booking_trip WHERE id = $1', [
            w(0).trips.a1.id,
          ]);
          expect(r.rowCount).toBe(1);
        },
      );
    });
  });
});

/** Exécute `sql` dans un SAVEPOINT et rend le SQLSTATE de l'erreur (ou 'OK'). */
async function outcome(tx: pg.ClientBase, sql: string, params: unknown[]): Promise<string> {
  await tx.query('SAVEPOINT outcome');
  try {
    await tx.query(sql, params);
    await tx.query('RELEASE SAVEPOINT outcome');
    return 'OK';
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT outcome');
    return (error as { code?: string }).code ?? 'ERREUR';
  }
}

const INSERT_KEY = `INSERT INTO core.audit_subject_key (subject_type, subject_id, wrapped_dek, kms_key_id)
                    VALUES ($1, $2, $3, 'fake:rls-test')`;

describe('clés de données par sujet (report US-009) : chaque session n’accède qu’à la clé de SON sujet', () => {
  it('USER : le compte de la session seulement ; PLATFORM : jamais app_api', async () => {
    await api(async (client) => {
      await asActor(client, { kind: 'GUEST', actorId: world.guest1 }, async (tx) => {
        expect(await outcome(tx, INSERT_KEY, ['USER', world.guest1, randomBytes(48)])).toBe('OK');
        expect(await ids(tx, 'audit_subject_key', 'subject_id')).toEqual([world.guest1]);
        // clé « empoisonnée » pour un tiers : refusée par la politique (42501)
        expect(await outcome(tx, INSERT_KEY, ['USER', world.guest2, randomBytes(48)])).toBe(
          '42501',
        );
        expect(await outcome(tx, INSERT_KEY, ['PLATFORM', uuid(), randomBytes(48)])).toBe('42501');
      });
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: allCountries() },
        async (tx) => {
          expect(await outcome(tx, INSERT_KEY, ['USER', world.guest1, randomBytes(48)])).toBe(
            '42501',
          );
          expect(
            await outcome(tx, INSERT_KEY, ['USER', world.staff.adminAll, randomBytes(48)]),
          ).toBe('OK');
        },
      );
    });
  });

  it('une clé USER existante n’est lisible que par son sujet', async () => {
    const owner = uuid();
    await withRole('app_worker', async (client) => {
      await withTestTransaction(client, { commit: true }, async (tx) => {
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'evidence_ingest' });
        await tx.query(INSERT_KEY, ['USER', owner, randomBytes(48)]);
      });
    });
    await api(async (client) => {
      for (const [actorId, visible] of [
        [owner, true],
        [world.guest1, false],
      ] as const) {
        await asActor(client, { kind: 'GUEST', actorId }, async (tx) => {
          const r = await tx.query('SELECT 1 FROM core.audit_subject_key WHERE subject_id = $1', [
            owner,
          ]);
          expect(r.rowCount, actorId).toBe(visible ? 1 : 0);
        });
      }
    });
  });

  it('ORG : le titulaire du compte d’hôte de la session seulement (ni co-hôte, ni hôte d’un autre compte)', async () => {
    const x = w(0);
    await api(async (client) => {
      for (const [actorId, orgId, expected] of [
        [world.holderA, x.orgA, 'OK'],
        [world.cohost, x.orgA, '42501'],
        [x.holderB, x.orgA, '42501'],
      ] as const) {
        await asActor(client, { kind: 'HOST', actorId, orgId }, async (tx) => {
          expect(await outcome(tx, INSERT_KEY, ['ORG', x.orgA, randomBytes(48)]), actorId).toBe(
            expected,
          );
        });
      }
    });
  });
});
