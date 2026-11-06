/**
 * US-049 — red team, axe `rls` : scénarios par ACTEUR (19 US-049, critère 3), joués sous les rôles
 * de production (assertion L0-05 par connectAs / withRole), en USD (PA) et en PYG (PY), sur le
 * monde de test de support/rls.ts (US-011). Identifiants RT-RLS-xx : docs/team/redteam/L0-rls.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`, jamais maquillé). Exception ASSUMÉE et étiquetée « LIMITE DOCUMENTÉE » : la limite déjà
 * écrite de 17 §2.3 (RLS-18, contexte forgeable sous SQL arbitraire), éprouvée en caractérisation.
 *
 * Attendus : tableau RLS-1 à RLS-28 de 17 §2.3 (RLS-1, RLS-2, RLS-9, RLS-11, RLS-13, RLS-20,
 * RLS-22, RLS-23, RLS-25, RLS-28), 16 BKG-012 / ACC-014 (`SELF_BOOKING_FORBIDDEN`, y compris par un
 * compte lié), 17 §2.3 « Invariants par voyageur entre hôtes » ; jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../../src/testing/index.ts';
import { COUNTRIES } from '../../support/avl.ts';
import { registerVehicles } from '../../support/concurrency.ts';
import {
  account,
  asActor,
  buildWorld,
  ids,
  sorted,
  staff,
  staffSessionHash,
  uuid,
  withRawContext,
} from '../../support/rls.ts';
import type { CountryWorld, World } from '../../support/rls.ts';

let world: World;
/** Nombre de lignes visibles d'une table (colonne `id` non supposée). */
async function count(tx: pg.ClientBase, table: string): Promise<number> {
  const r = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM core.${table}`);
  return r.rows[0]?.n ?? -1;
}

beforeAll(async () => {
  const api = await connectAs('app_api');
  try {
    world = await buildWorld(api, COUNTRIES);
    await withTestTransaction(api, { commit: true }, async (tx) => {
      for (const x of world.countries) {
        for (const trip of [x.trips.a1, x.trips.b1]) {
          for (const leg of ['HOST', 'PLATFORM', 'INSURER', 'TAX_THIRD_PARTY']) {
            await tx.query(
              `SELECT test_fixture.settlement_insert_leg_balance($1, 1, $2, $3::bigint, 0::bigint)`,
              [trip.id, leg, x.c.rentMinor],
            );
          }
        }
        await tx.query('SELECT test_fixture.us062_insert_advance($1, $2, $3, $4::bigint)', [
          uuid(),
          x.trips.a1.id,
          'RELEASED_LEG',
          x.c.rentMinor,
        ]);
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
const api = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> => withRole('app_api', fn);
const countryCodes = (): string[] => COUNTRIES.map((c) => c.country);

interface Attempt {
  readonly code?: string;
  readonly constraint?: string;
  readonly rows: Record<string, unknown>[];
  readonly rowCount: number;
}

/** Tente une instruction dans un point de sauvegarde : l'erreur est rendue, la transaction survit. */
async function attempt(
  tx: pg.ClientBase,
  sql: string,
  params: readonly unknown[] = [],
): Promise<Attempt> {
  await tx.query('SAVEPOINT rt_attempt');
  try {
    const r = await tx.query(sql, [...params]);
    await tx.query('RELEASE SAVEPOINT rt_attempt');
    return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount ?? 0 };
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT rt_attempt');
    const e = error as { code?: string; constraint?: string };
    return {
      rows: [],
      rowCount: 0,
      ...(e.code !== undefined ? { code: e.code } : {}),
      ...(e.constraint !== undefined ? { constraint: e.constraint } : {}),
    };
  }
}

/** Refus : erreur de privilège, ou aucune ligne touchée. Jamais un succès. */
const blocked = (a: Attempt): boolean =>
  a.code === '42501' || (a.code === undefined && a.rowCount === 0);

// ---------------------------------------------------------------------------------------------
describe.each([0, 1])('RT-RLS-10 — hôte A contre hôte B (lecture et écriture), pays n° %i', (i) => {
  it('hôte A : trips, holds, opérations, comptes et membres de B invisibles, par UUID comme par public_ref', async () => {
    const x = w(i);
    await api((client) =>
      asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: x.orgA }, async (tx) => {
        expect(await ids(tx, 'booking_trip')).toEqual(sorted([x.trips.a1.id, x.trips.a2.id]));
        const byId = await tx.query('SELECT id FROM core.booking_trip WHERE id = $1', [
          x.trips.b1.id,
        ]);
        expect(byId.rowCount).toBe(0);
        const byRef = await tx.query('SELECT id FROM core.booking_trip WHERE public_ref = $1', [
          x.trips.b1.publicRef,
        ]);
        expect(byRef.rowCount).toBe(0);
        // aucune politique HOST sur les holds, les opérations de paiement, l'occupation voyageur
        for (const t of [
          'booking_checkout_hold',
          'payment_payment_operation',
          'booking_guest_occupancy',
        ]) {
          expect(await ids(tx, t), t).toEqual([]);
        }
        expect(await ids(tx, 'iam_organization')).toEqual([x.orgA]);
        const members = await tx.query<{ org_id: string }>(
          'SELECT DISTINCT org_id FROM core.iam_membership',
        );
        expect(members.rows.map((r) => r.org_id)).toEqual([x.orgA]);
      }),
    );
  });

  it('hôte B symétrique ; org_id de A posé par B, portée de véhicules élargie par B : rien', async () => {
    const x = w(i);
    await api(async (client) => {
      await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgB }, async (tx) => {
        expect(await ids(tx, 'booking_trip')).toEqual([x.trips.b1.id]);
      });
      await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgA }, async (tx) => {
        expect(await ids(tx, 'booking_trip')).toEqual([]);
        expect(await ids(tx, 'iam_organization')).toEqual([]);
      });
      await asActor(
        client,
        { kind: 'HOST', actorId: x.holderB, orgId: x.orgB, vehicleScope: [x.v1, x.v2, x.v3] },
        async (tx) => {
          expect(await ids(tx, 'booking_trip')).toEqual([x.trips.b1.id]);
        },
      );
    });
  });

  it('écritures directes de l’hôte A sur les trips de B (UPDATE, DELETE, INSERT, TRUNCATE) : refusées, rien ne change', async () => {
    const x = w(i);
    await api((client) =>
      asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: x.orgA }, async (tx) => {
        const attempts = [
          await attempt(tx, `UPDATE core.booking_trip SET status = 'CANCELLED' WHERE id = $1`, [
            x.trips.b1.id,
          ]),
          await attempt(tx, `UPDATE core.booking_trip SET org_id = $2 WHERE id = $1`, [
            x.trips.b1.id,
            x.orgA,
          ]),
          await attempt(tx, `UPDATE core.booking_trip SET org_id = $2 WHERE id = $1`, [
            x.trips.a1.id,
            x.orgB,
          ]),
          await attempt(tx, `DELETE FROM core.booking_trip WHERE id = $1`, [x.trips.b1.id]),
          await attempt(tx, `INSERT INTO core.booking_trip (id) VALUES ($1)`, [uuid()]),
          await attempt(tx, `TRUNCATE core.booking_trip`),
          await attempt(tx, `UPDATE core.iam_organization SET holder_user_id = $1 WHERE id = $2`, [
            world.holderA,
            x.orgB,
          ]),
          await attempt(tx, `UPDATE core.iam_membership SET role = 'P2P_HOST' WHERE org_id = $1`, [
            x.orgB,
          ]),
          await attempt(
            tx,
            `INSERT INTO core.iam_membership (id, user_id, org_id, role) VALUES ($1, $2, $3, 'P2P_HOST')`,
            [uuid(), world.holderA, x.orgB],
          ),
        ];
        for (const [n, a] of attempts.entries())
          expect(blocked(a), `tentative ${n} : ${JSON.stringify(a)}`).toBe(true);
      }),
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe.each([0, 1])(
  'RT-RLS-11 — co-hôte et jambes d’argent (RLS-2, RLS-23, RLS-28), pays n° %i',
  (i) => {
    const legsOf = async (tx: pg.ClientBase): Promise<string[]> => {
      const { rows } = await tx.query<{ k: string }>(
        `SELECT trip_id::text || '/' || leg AS k FROM core.settlement_trip_leg_balance ORDER BY 1`,
      );
      return rows.map((r) => r.k);
    };

    it('titulaire : sa seule jambe HOST ; co-hôte (même avec vehicle_scope forgé élargi) : 0 ligne sur toutes les tables de jambes et d’avances', async () => {
      const x = w(i);
      await api(async (client) => {
        await asActor(
          client,
          { kind: 'HOST', actorId: world.holderA, orgId: x.orgA },
          async (tx) => {
            expect(await legsOf(tx)).toEqual([`${x.trips.a1.id}/HOST`]);
          },
        );
        for (const ctx of [
          { kind: 'HOST', actorId: world.cohost, orgId: x.orgA } as const,
          {
            kind: 'HOST',
            actorId: world.cohost,
            orgId: x.orgA,
            vehicleScope: [x.v1, x.v2],
          } as const,
          { kind: 'HOST', actorId: world.exCohost, orgId: x.orgA } as const,
        ]) {
          await asActor(client, ctx, async (tx) => {
            expect(await legsOf(tx), JSON.stringify(ctx)).toEqual([]);
            for (const t of [
              'settlement_settlement_leg',
              'settlement_platform_advance',
              'settlement_insurer_bordereau',
              'settlement_insurer_ledger_state',
              'payment_payment_operation_leg',
            ]) {
              expect(await count(tx, t), `${t} ${JSON.stringify(ctx)}`).toBe(0);
            }
            const adv = await tx.query('SELECT * FROM core.settlement_host_advance_v');
            expect(adv.rowCount, 'host_advance_v').toBe(0);
          });
        }
      });
    });

    it('RLS-28 : le titulaire donne par erreur finance.read_org_statements au co-hôte ⇒ toujours 0 ligne', async () => {
      const x = w(i);
      await api((client) =>
        asActor(client, { kind: 'HOST', actorId: world.cohost, orgId: x.orgA }, async (tx) => {
          await tx.query('SELECT test_fixture.us062_set_permission_overrides($1, $2, $3::text[])', [
            world.cohost,
            x.orgA,
            ['finance.read_org_statements'],
          ]);
          expect(await legsOf(tx)).toEqual([]);
          expect((await tx.query('SELECT * FROM core.settlement_host_advance_v')).rowCount).toBe(0);
        }),
      );
    });

    it('hôte B et hôte A ne lisent pas les jambes l’un de l’autre ; voyageur et contexte absent : rien', async () => {
      const x = w(i);
      await api(async (client) => {
        await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgB }, async (tx) => {
          expect(await legsOf(tx)).toEqual([`${x.trips.b1.id}/HOST`]);
        });
        await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgA }, async (tx) => {
          expect(await legsOf(tx)).toEqual([]);
        });
        await asActor(client, { kind: 'GUEST', actorId: world.guest1 }, async (tx) => {
          expect(await legsOf(tx)).toEqual([]);
        });
        expect(await legsOf(client)).toEqual([]);
      });
    });

    it('écritures directes sur les jambes (INSERT, UPDATE, DELETE, TRUNCATE) par titulaire, co-hôte, voyageur : refusées (RLS-21)', async () => {
      const x = w(i);
      for (const ctx of [
        { kind: 'HOST', actorId: world.holderA, orgId: x.orgA } as const,
        { kind: 'HOST', actorId: world.cohost, orgId: x.orgA } as const,
        { kind: 'GUEST', actorId: world.guest1 } as const,
      ]) {
        await api((client) =>
          asActor(client, ctx, async (tx) => {
            for (const t of ['settlement_trip_leg_balance']) {
              const as = [
                await attempt(tx, `UPDATE core.${t} SET captured_minor = 0`),
                await attempt(tx, `DELETE FROM core.${t}`),
                await attempt(tx, `INSERT INTO core.${t} (trip_id) VALUES ($1)`, [x.trips.a1.id]),
                await attempt(tx, `TRUNCATE core.${t}`),
              ];
              for (const [n, a] of as.entries())
                expect(blocked(a), `${t} ${n} ${ctx.kind} ${JSON.stringify(a)}`).toBe(true);
            }
          }),
        );
      }
    });
  },
);

// ---------------------------------------------------------------------------------------------
describe.each([0, 1])(
  'RT-RLS-12 — l’hôte et l’identité du voyageur (minimisation, NN6), pays n° %i',
  (i) => {
    it('compte du voyageur, colonne guest_user_id, vue minimisée : l’hôte ne voit ni identité, ni courriel, ni téléphone, ni naissance', async () => {
      const x = w(i);
      await api((client) =>
        asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: x.orgA }, async (tx) => {
          // compte d'un voyageur de ses trips : rien (politique : son propre compte seulement)
          expect(
            (await tx.query('SELECT id FROM core.iam_user_account WHERE id = $1', [world.guest1]))
              .rowCount,
          ).toBe(0);
          expect(
            (await tx.query('SELECT id FROM core.iam_user_account WHERE id <> $1', [world.holderA]))
              .rowCount,
          ).toBe(0);
          // la colonne qui nomme le voyageur n'est pas accordée à app_api (0035)
          const col = await attempt(tx, 'SELECT guest_user_id FROM core.booking_trip');
          expect(col.code).toBe('42501');
          const star = await attempt(tx, 'SELECT * FROM core.booking_trip');
          expect(star.code).toBe('42501');
          // la vue minimisée : exactement ses cinq colonnes, pour les trips de l'hôte seulement
          const view = await tx.query<Record<string, unknown>>(
            'SELECT * FROM core.booking_host_guest_v ORDER BY trip_id',
          );
          expect(Object.keys(view.rows[0] ?? {}).sort()).toEqual(
            ['age_years', 'first_name', 'rating', 'trip_id', 'verification_status'].sort(),
          );
          expect(view.rows.map((r) => r.trip_id)).toEqual(sorted([x.trips.a1.id, x.trips.a2.id]));
          const joined = JSON.stringify(view.rows);
          expect(joined).not.toContain('@');
          expect(joined).not.toContain(world.guest1);
          // tables d'identité, de facteurs, de sessions, de fichiers : aucun droit
          for (const t of [
            'iam_session',
            'iam_auth_factor',
            'iam_email_verification',
            'audit_file_asset',
          ]) {
            const a = await attempt(tx, `SELECT 1 FROM core.${t} LIMIT 1`);
            expect(a.code, t).toBe('42501');
          }
        }),
      );
    });

    it('la vue minimisée est vide pour co-hôte hors portée, ex-co-hôte, org forgée, voyageur, staff sans preuve, contexte absent ; portée véhicule respectée', async () => {
      const x = w(i);
      await api(async (client) => {
        await asActor(
          client,
          { kind: 'HOST', actorId: world.cohost, orgId: x.orgA },
          async (tx) => {
            const r = await tx.query<{ trip_id: string }>(
              'SELECT trip_id FROM core.booking_host_guest_v',
            );
            expect(r.rows.map((y) => y.trip_id)).toEqual([x.trips.a1.id]); // v1 seulement
          },
        );
        for (const ctx of [
          { kind: 'HOST', actorId: world.exCohost, orgId: x.orgA } as const,
          { kind: 'HOST', actorId: x.holderB, orgId: x.orgA } as const,
          { kind: 'GUEST', actorId: world.guest1 } as const,
          { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: countryCodes() } as const,
        ]) {
          await asActor(client, ctx, async (tx) => {
            expect(
              (await tx.query('SELECT * FROM core.booking_host_guest_v')).rowCount,
              JSON.stringify(ctx),
            ).toBe(0);
            expect(
              (await tx.query('SELECT * FROM core.booking_host_guest_rows()')).rowCount,
              'rows()',
            ).toBe(0);
          });
        }
        expect((await client.query('SELECT * FROM core.booking_host_guest_v')).rowCount).toBe(0);
      });
    });
  },
);

// ---------------------------------------------------------------------------------------------
describe.each([0, 1])(
  'RT-RLS-13 — auto-réservation et cumul hôte / voyageur sur un même compte, pays n° %i',
  (i) => {
    const c = COUNTRIES[i];
    if (c === undefined) throw new Error('pays');
    const START = '2033-06-01T10:00:00Z';
    const END = '2033-06-03T10:00:00Z';

    const place = (tx: pg.ClientBase, vehicle: string): Promise<Attempt> =>
      attempt(
        tx,
        'SELECT core.booking_cmd_place_hold($1::uuid, $2::timestamptz, $3::timestamptz, false) AS r',
        [vehicle, START, END],
      );

    it('le titulaire ne réserve pas son propre véhicule (SELF_BOOKING_FORBIDDEN), ni sous un autre type d’acteur', async () => {
      const org = uuid();
      const vehicle = uuid();
      const holder = await api(async (client) =>
        withTestTransaction(client, { commit: true }, async (tx) => {
          const h = await tx.query<{ h: string }>(
            'SELECT test_fixture.create_org($1, $2, $3) AS h',
            [org, c.country, 'ACTIVE'],
          );
          await registerVehicles(tx, [vehicle], org, c);
          return h.rows[0]?.h as string;
        }),
      );
      await api(async (client) => {
        await asActor(client, { kind: 'GUEST', actorId: holder }, async (tx) => {
          const a = await place(tx, vehicle);
          expect(a.constraint, JSON.stringify(a)).toBe('hold_self_booking');
        });
        // le titulaire, en contexte HOST ou STAFF forgé ou WORKER forgé : la commande refuse
        for (const settings of [
          { 'app.actor_kind': 'HOST', 'app.actor_id': holder, 'app.org_id': org },
          { 'app.actor_kind': 'WORKER', 'app.worker_name': 'booking_conversion' },
          {
            'app.actor_kind': 'STAFF',
            'app.actor_id': world.staff.adminAll,
            'app.country_scope': `{${c.country}}`,
          },
        ]) {
          await withRawContext(client, settings, async (tx) => {
            const a = await place(tx, vehicle);
            expect(a.constraint, JSON.stringify(settings)).toBe('hold_forbidden');
          });
        }
      });
    });

    it('un co-hôte ACTIF qui gère le véhicule ne le réserve pas non plus (BKG-012, ACC-014 : « ne réserve jamais sa propre voiture »)', async () => {
      const org = uuid();
      const vehicle = uuid();
      const { cohost } = await api(async (client) =>
        withTestTransaction(client, { commit: true }, async (tx) => {
          await tx.query('SELECT test_fixture.create_org($1, $2, $3)', [org, c.country, 'ACTIVE']);
          await registerVehicles(tx, [vehicle], org, c);
          const co = await account(tx);
          await tx.query(
            `SELECT test_fixture.iam_insert_membership($1, $2, $3, 'CO_HOST', $4::uuid[], 'ACTIVE')`,
            [uuid(), co, org, [vehicle]],
          );
          return { cohost: co };
        }),
      );
      await api((client) =>
        asActor(client, { kind: 'GUEST', actorId: cohost }, async (tx) => {
          const a = await place(tx, vehicle);
          // attendu : un refus. Un hold créé (rows[0].r) est la faille.
          expect(a.rows, JSON.stringify(a)).toEqual([]);
          expect(a.code, JSON.stringify(a)).toBeDefined();
        }),
      );
    });

    it('cumul : la même personne voyageur chez B et hôte chez A — chaque contexte ne voit que son rôle', async () => {
      const x = w(i);
      // holderA est voyageur d'un trip chez l'hôte B (fixture) ; titulaire du compte A
      const tripAsGuest = uuid();
      await api((client) =>
        withTestTransaction(client, { commit: true }, async (tx) => {
          await tx.query(
            `SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              tripAsGuest,
              world.holderA,
              x.orgB,
              uuid(),
              c.country,
              c.currency,
              c.timezone,
              `2034-03-0${i + 1}T10:00:00Z`,
              `2034-03-0${i + 1}T20:00:00Z`,
            ],
          );
        }),
      );
      await api(async (client) => {
        await asActor(client, { kind: 'GUEST', actorId: world.holderA }, async (tx) => {
          // un voyageur voit ses trips de tous les pays, mais JAMAIS ceux de son compte d'hôte
          const seen = await ids(tx, 'booking_trip');
          expect(seen).toContain(tripAsGuest);
          for (const w2 of world.countries) {
            expect(seen).not.toContain(w2.trips.a1.id);
            expect(seen).not.toContain(w2.trips.a2.id);
          }
        });
        // le contexte voyageur, avec l'org_id de A glissée dans la session, ne donne pas les trips de A
        await withRawContext(
          client,
          { 'app.actor_kind': 'GUEST', 'app.actor_id': world.holderA, 'app.org_id': x.orgA },
          async (tx) => {
            const seen = await ids(tx, 'booking_trip');
            expect(seen).toContain(tripAsGuest);
            expect(seen).not.toContain(x.trips.a1.id);
            expect(seen).not.toContain(x.trips.a2.id);
          },
        );
        await asActor(
          client,
          { kind: 'HOST', actorId: world.holderA, orgId: x.orgA },
          async (tx) => {
            const seen = await ids(tx, 'booking_trip');
            expect(seen).toEqual(sorted([x.trips.a1.id, x.trips.a2.id]));
            expect(seen).not.toContain(tripAsGuest);
          },
        );
        // l'hôte A, en voyageur, ne voit pas les jambes d'argent du trip B (jambe HOST du compte B)
        await asActor(client, { kind: 'GUEST', actorId: world.holderA }, async (tx) => {
          const r = await tx.query('SELECT 1 FROM core.settlement_trip_leg_balance');
          expect(r.rowCount).toBe(0);
        });
      });
    });
  },
);

// ---------------------------------------------------------------------------------------------
describe('RT-RLS-14 — pays croisé : acteur d’un pays sur les données de l’autre', () => {
  const first = COUNTRIES[0].country;
  const second = COUNTRIES[1].country;

  it('OPS / FINANCE / SUPPORT du premier pays, même avec une portée forgée sur les deux pays : aucune ligne du second', async () => {
    const both = `{${first},${second}}`;
    await api(async (client) => {
      for (const [role, actorId] of [
        ['OPS', world.staff.opsFirst],
        ['FINANCE', world.staff.financeFirst],
      ] as const) {
        const hash = staffSessionHash(actorId);
        await withRawContext(
          client,
          {
            'app.actor_kind': 'STAFF',
            'app.actor_id': actorId,
            'app.country_scope': both,
            'app.session_token_hash': hash ?? '',
          },
          async (tx) => {
            for (const [table, col] of [
              ['booking_trip', 'country_code'],
              ['booking_checkout_hold', 'country_code'],
              ['payment_payment_operation', 'country_code'],
              ['settlement_trip_leg_balance', 'country_code'],
              ['settlement_platform_advance', 'country_code'],
              ['support_support_case', 'country_code'],
              ['iam_organization', 'country_code'],
            ] as const) {
              const r = await tx.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM core.${table} WHERE ${col} = $1`,
                [second],
              );
              expect(r.rows[0]?.n, `${role} ${table}`).toBe(0);
            }
          },
        );
      }
      // SUPPORT des deux pays : dossiers assignés seulement (aucun ici) — jamais plus
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.supportAll, countryScope: countryCodes() },
        async (tx) => {
          expect(await count(tx, 'support_support_case')).toBe(0);
          expect(await count(tx, 'settlement_platform_advance')).toBe(0);
        },
      );
    });
  });

  it('hôte d’un compte du premier pays : aucun trip, jambe ni compte du second pays, même titulaire des deux comptes', async () => {
    const a = w(0);
    const b = w(1);
    await api(async (client) => {
      await asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: a.orgA }, async (tx) => {
        const seen = await ids(tx, 'booking_trip');
        expect(seen).toEqual(sorted([a.trips.a1.id, a.trips.a2.id]));
        expect(seen).not.toContain(b.trips.a1.id);
        expect(await ids(tx, 'iam_organization')).toEqual([a.orgA]);
      });
      // org du second pays posée par le même titulaire : c'est SON compte PY — pas de fuite vers PA
      await asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: b.orgA }, async (tx) => {
        const seen = await ids(tx, 'booking_trip');
        expect(seen).toEqual(sorted([b.trips.a1.id, b.trips.a2.id]));
      });
    });
  });

  it('staff du premier pays : la commande d’action manuelle sur un trip du second pays est refusée (FORBIDDEN), sans effet', async () => {
    const x1 = w(1);
    await api(async (client) => {
      const hash = Buffer.from(staffSessionHash(world.staff.opsFirst) ?? '', 'hex');
      await client.query('BEGIN');
      try {
        const r = await client.query<{ outcome: string }>(
          `SELECT outcome FROM core.iam_staff_cmd_manual_action($1, $2, 'RECORD_CLAIM', $3, $4, NULL)`,
          [hash, uuid(), x1.trips.a1.id, 'red team : sujet d’un autre pays, doit être refusé'],
        );
        expect(r.rows[0]?.outcome).not.toBe('RECORDED');
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('RT-RLS-15 — commandes appelées sans le rôle prévu (jetons et rôles)', () => {
  let guestHash: Buffer;
  let opsHash: Buffer;
  let adminFirstHash: Buffer;
  let adminFirstId: string;
  let superId: string;
  let adminBothHash: Buffer;

  beforeAll(async () => {
    const client = await connectAs('app_api');
    try {
      await withTestTransaction(client, { commit: true }, async (tx) => {
        const guest = await account(tx);
        guestHash = Buffer.from(randomBytes(32));
        await tx.query(`SELECT core.iam_cmd_open_session($1, $2, $3, 3600, 'NONE', NULL, 'rt')`, [
          uuid(),
          guest,
          guestHash,
        ]);
        const ops = await staff(tx, 'OPS_AGENT', [COUNTRIES[0].country]);
        opsHash = Buffer.from(staffSessionHash(ops) ?? '', 'hex');
        adminFirstId = await staff(tx, 'ADMIN', [COUNTRIES[0].country]);
        adminFirstHash = Buffer.from(staffSessionHash(adminFirstId) ?? '', 'hex');
        superId = await staff(tx, 'SUPERADMIN', countryCodes());
        adminBothHash = Buffer.from(
          staffSessionHash(await staff(tx, 'ADMIN', countryCodes())) ?? '',
          'hex',
        );
      });
    } finally {
      await releaseClient(client);
    }
  });

  const call = async (sql: string, params: readonly unknown[]): Promise<Attempt> =>
    api((client) => withTestTransaction(client, {}, async (tx) => attempt(tx, sql, params)));

  it('jeton de simple voyageur ou de rôle sans permission : suspension, réinitialisation TOTP, brouillon de contenu, lecture du journal ne réussissent pas', async () => {
    const reason = 'red team : tentative sans le rôle prévu, doit échouer';
    for (const [who, hash] of [
      ['voyageur', guestHash],
      ['OPS', opsHash],
    ] as const) {
      const s = await call('SELECT core.iam_staff_cmd_suspend($1, $2, $3, $4) AS r', [
        hash,
        uuid(),
        superId,
        reason,
      ]);
      expect(s.rows[0]?.r, `suspend ${who}`).not.toBe('DONE');
      const t = await call(
        'SELECT core.iam_staff_cmd_reset_totp($1, $2, $3, $4, $5, $6, $7, 3600) AS r',
        [hash, uuid(), superId, reason, uuid(), 'fake-vault:rt', randomBytes(32)],
      );
      expect(t.rows[0]?.r, `reset-totp ${who}`).not.toBe('DONE');
      const d = await call(
        `SELECT version_no FROM core.cfg_content_cmd_save_draft($1, $2, 'rt.key', NULL, $3::jsonb, NULL)`,
        [hash, uuid(), JSON.stringify({ es: 'Hola', en: 'Hello', fr: 'Salut', pt: 'Ola' })],
      );
      expect(d.rows[0]?.version_no ?? null, `brouillon ${who}`).toBeNull();
      const a = await call('SELECT * FROM core.iam_staff_audit_read($1, NULL, 50)', [hash]);
      if (who === 'voyageur') expect(a.rows, 'journal voyageur').toEqual([]);
    }
  });

  it('ADMIN d’un seul pays : ne suspend ni ne réinitialise un SUPERADMIN ni lui-même ; session non élevée : MFA exigée', async () => {
    const reason = 'red team : élévation latérale ADMIN vers SUPERADMIN';
    const s = await call('SELECT core.iam_staff_cmd_suspend($1, $2, $3, $4) AS r', [
      adminFirstHash,
      uuid(),
      superId,
      reason,
    ]);
    expect(s.rows[0]?.r).toBe('FORBIDDEN');
    const self = await call('SELECT core.iam_staff_cmd_suspend($1, $2, $3, $4) AS r', [
      adminFirstHash,
      uuid(),
      adminFirstId,
      reason,
    ]);
    expect(self.rows[0]?.r).toBe('FORBIDDEN');
    const token = Buffer.from(randomBytes(32));
    const unelevated = await api(async (client) =>
      withTestTransaction(client, { commit: true }, async (tx) => {
        const id = await account(tx);
        await tx.query(`SELECT test_fixture.iam_set_account_status($1, 'ACTIVE')`, [id]);
        await tx.query(
          `SELECT test_fixture.iam_grant_staff_role($1, $2, 'ADMIN', $3::text[], NULL, NULL)`,
          [uuid(), id, countryCodes()],
        );
        await tx.query(`SELECT core.iam_cmd_open_session($1, $2, $3, 3600, 'NONE', NULL, 'rt')`, [
          uuid(),
          id,
          token,
        ]);
        return id;
      }),
    );
    expect(unelevated).toBeDefined();
    const r = await call('SELECT core.iam_staff_cmd_suspend($1, $2, $3, $4) AS r', [
      token,
      uuid(),
      adminFirstId,
      reason,
    ]);
    expect(r.rows[0]?.r).toBe('MFA_REQUIRED');
  });

  it('ADMIN du premier pays : brouillon de contenu pour le second pays refusé (portée pays relue en base)', async () => {
    const d = await call(
      `SELECT outcome, version_no FROM core.cfg_content_cmd_save_draft($1, $2, 'rt.cross', $3, $4::jsonb, NULL)`,
      [
        adminFirstHash,
        uuid(),
        COUNTRIES[1].country,
        JSON.stringify({ es: 'Hola', en: 'Hello', fr: 'Salut', pt: 'Ola' }),
      ],
    );
    expect(d.rows[0]?.version_no ?? null, JSON.stringify(d.rows)).toBeNull();
    // témoin : l'ADMIN des deux pays obtient, lui, une version (le refus vient donc de la portée)
    const ok = await call(
      `SELECT outcome, version_no FROM core.cfg_content_cmd_save_draft($1, $2, 'rt.cross', $3, $4::jsonb, NULL)`,
      [
        adminBothHash,
        uuid(),
        COUNTRIES[1].country,
        JSON.stringify({ es: 'Hola', en: 'Hello', fr: 'Salut', pt: 'Ola' }),
      ],
    );
    expect(ok.rows[0]?.version_no ?? null, JSON.stringify(ok.rows)).not.toBeNull();
  });

  it('fonctions inaccessibles au rôle : chaque fonction des schémas du projet sans EXECUTE pour le rôle répond 42501 (app_api sur les commandes du travailleur, et l’inverse)', async () => {
    for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
      await withRole(
        role,
        async (client) => {
          const { rows } = await client.query<{ call: string }>(
            `SELECT 'SELECT ' || quote_ident(n.nspname) || '.' || quote_ident(p.proname) || '('
                    || COALESCE((SELECT string_agg('(SELECT NULL::' || format_type(t.oid, NULL) || ')', ', ' ORDER BY a.ord)
                                   FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS a(oid, ord)
                                   JOIN pg_catalog.pg_type t ON t.oid = a.oid), '') || ')' AS call
               FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('core', 'app', 'platform') AND p.prokind = 'f'
                AND NOT pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE')
              ORDER BY 1`,
          );
          expect(rows.length, role).toBeGreaterThan(5);
          const accepted: string[] = [];
          for (const r of rows) {
            const a = await client.query(r.call).then(
              () => 'ACCEPTÉ',
              (error: { code?: string }) => error.code ?? '?',
            );
            if (a !== '42501') accepted.push(`${a} : ${r.call}`);
          }
          expect(accepted, role).toEqual([]);
        },
        { database: 'production' },
      );
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('RT-RLS-16 — contexte app.* forgé d’un AUTRE type d’acteur, sous le mauvais rôle de base', () => {
  // référence publique de la plateforme (aucune donnée de personne) ; `payment_psp_account` n'est
  // lisible par app_worker QUE dans la base de test (GRANT de test-migrations/9500, absent de la
  // production : authorization-matrix.json « droits » vides) — exclu pour ne pas confondre
  const REFERENCE =
    /^(config_|pricing_|finance_legal_entity|payment_psp_capability|payment_psp_account)/;

  async function readableTables(client: pg.Client, role: string): Promise<string[]> {
    const { rows } = await client.query<{ t: string }>(
      `SELECT c.relname AS t
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'core' AND c.relkind IN ('r', 'p', 'v')
          AND pg_catalog.has_any_column_privilege($1, c.oid, 'SELECT')
        ORDER BY 1`,
      [role],
    );
    return rows.map((r) => r.t).filter((t) => !REFERENCE.test(t));
  }

  async function counts(
    tx: pg.ClientBase,
    tables: readonly string[],
  ): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of tables) {
      const a = await attempt(tx, `SELECT count(*)::int AS n FROM core.${t}`);
      out[t] = a.code === undefined ? Number(a.rows[0]?.n) : -1; // -1 : refus (42501…), admis
    }
    return out;
  }

  it('app_api prétend être un travailleur (tous les noms de la base) : aucune ligne de plus que sans contexte', async () => {
    await api(async (client) => {
      const tables = await readableTables(client, 'app_api');
      expect(tables.length).toBeGreaterThan(5);
      const { rows } = await client.query<{ src: string }>(
        `SELECT COALESCE(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '') || ' ' || COALESCE(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '') AS src
           FROM pg_catalog.pg_policy p`,
      );
      const names = new Set<string>([
        'booking_conversion',
        'disposition_sweeper',
        'payment_intent_sweeper',
        'hold_expiry',
        'trip_lifecycle',
        'webhook_ingest',
        'outbox_relay',
        'payment_command',
        'booking_oracle',
      ]);
      for (const r of rows) {
        if (!r.src.includes('worker_name')) continue;
        for (const m of r.src.matchAll(/'([a-z][a-z0-9_]+)'::text/g))
          if (m[1] !== undefined) names.add(m[1]);
      }
      const baseline = await withRawContext(client, {}, (tx) => counts(tx, tables));
      for (const name of names) {
        const forged = await withRawContext(
          client,
          { 'app.actor_kind': 'WORKER', 'app.worker_name': name },
          (tx) => counts(tx, tables),
        );
        for (const t of tables) {
          expect(forged[t], `worker forgé ${name} sur ${t}`).toBeLessThanOrEqual(baseline[t] ?? 0);
        }
      }
    });
  });

  it('app_worker sans contexte, ou avec un contexte voyageur / hôte / staff forgé (identifiants réels du monde) : 0 ligne partout sauf la référence publique', async () => {
    await withRole('app_worker', async (client) => {
      const tables = await readableTables(client, 'app_worker');
      expect(tables.length).toBeGreaterThan(5);
      const x = w(0);
      const settingsList: Record<string, string>[] = [
        {},
        { 'app.actor_kind': 'GUEST', 'app.actor_id': world.guest1 },
        { 'app.actor_kind': 'HOST', 'app.actor_id': world.holderA, 'app.org_id': x.orgA },
        {
          'app.actor_kind': 'STAFF',
          'app.actor_id': world.staff.adminAll,
          'app.country_scope': `{${countryCodes().join(',')}}`,
          'app.session_token_hash': staffSessionHash(world.staff.adminAll) ?? '',
        },
        { 'app.actor_kind': 'WORKER', 'app.worker_name': 'nom_inconnu' },
      ];
      for (const settings of settingsList) {
        const got = await withRawContext(client, settings, (tx) => counts(tx, tables));
        const leaking = Object.entries(got).filter(([, n]) => n > 0);
        expect(leaking, JSON.stringify(Object.keys(settings))).toEqual([]);
      }
    });
  });

  it('app_api sans contexte, ou avec un type d’acteur inventé : 0 ligne sur toute relation lisible (sauf la référence publique)', async () => {
    await api(async (client) => {
      const tables = await readableTables(client, 'app_api');
      for (const settings of [
        {},
        { 'app.actor_kind': 'ROOT', 'app.actor_id': world.guest1 },
        { 'app.actor_kind': '', 'app.actor_id': '' },
      ]) {
        const got = await withRawContext(client, settings, (tx) => counts(tx, tables));
        const leaking = Object.entries(got).filter(([t, n]) => n > 0 && t !== 'iam_user_account');
        expect(leaking, JSON.stringify(settings)).toEqual([]);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('RT-RLS-17 — IDOR par les commandes de réservation (hold d’un autre, blocage d’un autre hôte)', () => {
  it('libérer le hold d’un autre voyageur : refusé pour un autre voyageur, l’hôte, le staff, un travailleur forgé', async () => {
    const x = w(0);
    await api(async (client) => {
      for (const settings of [
        { 'app.actor_kind': 'GUEST', 'app.actor_id': world.guest2 },
        { 'app.actor_kind': 'HOST', 'app.actor_id': world.holderA, 'app.org_id': x.orgA },
        { 'app.actor_kind': 'WORKER', 'app.worker_name': 'hold_expiry' },
      ]) {
        await withRawContext(client, settings, async (tx) => {
          const a = await attempt(tx, 'SELECT core.booking_cmd_release_own_hold($1::uuid) AS r', [
            x.holds.h1,
          ]);
          expect(a.code, JSON.stringify(settings)).toBe('42501');
        });
      }
      // témoin : le propriétaire du hold peut le libérer (le refus ci-dessus vient donc de l'IDOR)
      await asActor(client, { kind: 'GUEST', actorId: world.guest1 }, async (tx) => {
        const a = await attempt(tx, 'SELECT core.booking_cmd_release_own_hold($1::uuid) AS r', [
          x.holds.h1,
        ]);
        expect(a.code, JSON.stringify(a)).toBeUndefined();
      });
    });
  });

  it('blocage de calendrier : l’hôte A ne peut ni poser un blocage sur le véhicule de B, ni lever celui de B, ni un co-hôte hors portée, ni un ex-co-hôte', async () => {
    const x = w(0);
    const c = COUNTRIES[0];
    const START = '2035-01-10T10:00:00Z';
    const END = '2035-01-12T10:00:00Z';
    // un blocage réel de B, sur un véhicule enregistré pour B
    const vB = uuid();
    const blockB = await api(async (client) => {
      await withTestTransaction(client, { commit: true }, (tx) =>
        registerVehicles(tx, [vB], x.orgB, c),
      );
      return asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgB }, async (tx) => {
        const a = await attempt(tx, 'SELECT core.booking_cmd_place_host_block($1, $2, $3) AS r', [
          vB,
          START,
          END,
        ]);
        return a;
      });
    });
    expect(blockB.code, 'témoin : B bloque son propre véhicule').toBeUndefined();
    await api(async (client) => {
      // lever le blocage d'un autre compte : jamais
      const remove = async (ctx: Parameters<typeof asActor>[1], block: string): Promise<Attempt> =>
        asActor(client, ctx, (tx) =>
          attempt(tx, 'SELECT core.booking_cmd_remove_host_block($1::uuid) AS r', [block]),
        );
      const id = String(blockB.rows[0]?.r);
      for (const ctx of [
        { kind: 'HOST', actorId: world.holderA, orgId: x.orgA } as const,
        { kind: 'HOST', actorId: world.cohost, orgId: x.orgA } as const,
        { kind: 'HOST', actorId: world.exCohost, orgId: x.orgA } as const,
        { kind: 'GUEST', actorId: world.guest1 } as const,
      ]) {
        const a = await remove(ctx, id);
        expect(a.constraint, JSON.stringify([ctx.kind, a])).toBe('occupancy_host_forbidden');
      }
      // poser un blocage sur le véhicule d'un autre compte qui a déjà des occupations (v3 : trip de B)
      for (const ctx of [
        { kind: 'HOST', actorId: world.holderA, orgId: x.orgA } as const,
        { kind: 'HOST', actorId: world.cohost, orgId: x.orgA } as const, // portée {v1} : v2 hors portée
        { kind: 'HOST', actorId: world.exCohost, orgId: x.orgA } as const,
      ]) {
        const target = ctx.actorId === world.cohost ? x.v2 : x.v3;
        const a = await asActor(client, ctx, (tx) =>
          attempt(tx, 'SELECT core.booking_cmd_place_host_block($1, $2, $3) AS r', [
            target,
            START,
            END,
          ]),
        );
        expect(a.constraint, JSON.stringify([ctx.actorId, a])).toBe('occupancy_host_forbidden');
      }
    });
  });

  it('SQUATTING : l’hôte A ne peut pas poser un blocage sur un véhicule de B qui n’a encore AUCUNE occupation (la commande ne consulte pas le propriétaire du véhicule)', async () => {
    const x = w(0);
    const c = COUNTRIES[0];
    const fresh = uuid();
    await api(async (client) => {
      await withTestTransaction(client, { commit: true }, (tx) =>
        registerVehicles(tx, [fresh], x.orgB, c),
      );
      await asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: x.orgA }, async (tx) => {
        const a = await attempt(tx, 'SELECT core.booking_cmd_place_host_block($1, $2, $3) AS r', [
          fresh,
          '2036-02-10T10:00:00Z',
          '2036-02-12T10:00:00Z',
        ]);
        // attendu : refus (le véhicule est à B). Un uuid rendu = blocage écrit sur le véhicule d'autrui.
        expect(a.rows, `blocage posé par A sur le véhicule de B : ${JSON.stringify(a)}`).toEqual(
          [],
        );
        expect(a.constraint, JSON.stringify(a)).toBe('occupancy_host_forbidden');
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('RT-RLS-18 — LIMITE DOCUMENTÉE (0011, 17 §2.3 RLS-18) : commandes dont l’argument choisit l’acteur', () => {
  it('LIMITE DOCUMENTÉE : sous SQL arbitraire, app_api ouvre une session pour N’IMPORTE QUEL compte (caractérisation : ce test passe tant que la limite existe)', async () => {
    await api(async (client) => {
      const hash = Buffer.from(randomBytes(32));
      await client.query('BEGIN');
      try {
        const opened = await client.query<{ expires: Date | null }>(
          `SELECT core.iam_cmd_open_session($1, $2, $3, 3600, 'NONE', NULL, 'rt') AS expires`,
          [uuid(), world.staff.supportAll, hash],
        );
        const resolved = await client.query<{ user_id: string | null }>(
          'SELECT user_id FROM core.iam_session_resolve($1)',
          [hash],
        );
        // la limite est exploitable : le jeton choisi par l'appelant désigne le compte de staff visé
        expect(opened.rows[0]?.expires).not.toBeNull();
        expect(resolved.rows[0]?.user_id).toBe(world.staff.supportAll);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });
});
