/**
 * US-049 — correctifs de la red team RLS de la porte du lot 0 (docs/team/redteam/L0-rls.md ;
 * migration 0054, amorçage 0000 § 3, ADR-088). Les attaques elles-mêmes restent dans
 * `test/l0/redteam-rls/` (inchangées, gardes de non-régression) ; ce fichier prouve les contours
 * de chaque correctif.
 *
 * Attendus (16 BKG-012 / ACC-014 « ne réserve jamais sa propre voiture, ni par un compte lié » ;
 * 17 §2.3 RLS-3, RLS-15 ; jamais le code testé) :
 * - F-RLS-02 : un membre du compte d'hôte du véhicule (co-hôte ACTIVE, invitation INVITED, co-hôte
 *   dont la portée ne couvre même pas le véhicule) ne pose pas de hold sur ce véhicule
 *   (`SELF_BOOKING_FORBIDDEN`) ; un ex-co-hôte (REMOVED) et le co-hôte d'un AUTRE compte le
 *   peuvent (témoins : le refus vient bien de l'appartenance) ;
 * - F-RLS-04 : aucune fonction de pg_catalog à effet de bord hors RLS (`pg_logical_emit_message`,
 *   grands objets, `pg_cancel_backend`, `pg_terminate_backend`) n'est exécutable par `app_api`,
 *   `app_worker` ni `app_anon`, dans la base de test et dans la base de production du banc ;
 *   l'appel réel répond `42501`.
 * F-RLS-01 (blocage sur le véhicule d'autrui ou inconnu) est prouvé dans
 * l0-occ-single-occupancy (cloisonnement des écritures) et par RT-RLS-17.
 * Rôles de production seulement (assertion L0-05 par connectAs / withRole). En USD (PA) et en PYG
 * (PY).
 */
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { APP_ROLES, translateDbError } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import { placeHoldCommand, registerVehicles } from '../support/concurrency.ts';

/** Code métier d'une pose réelle : `OK` ou le code traduit (sans détail). */
async function pose(
  client: pg.ClientBase,
  guestId: string,
  vehicleId: string,
  orgId: string,
  start: string,
  end: string,
): Promise<string> {
  try {
    await placeHoldCommand(client, {
      slot: { vehicleId, orgId, start, end, bufferHours: 0 },
      guestId,
    });
    return 'OK';
  } catch (error) {
    return translateDbError(error).code;
  }
}

describe.each(COUNTRIES)('US-049 F-RLS-02 — membre du compte d’hôte ($country, $currency)', (c) => {
  it('co-hôte ACTIVE (dans ou hors portée) et invitation : SELF_BOOKING_FORBIDDEN ; ex-co-hôte et co-hôte d’un autre compte : hold posé', async () => {
    const org = uuid();
    const otherOrg = uuid();
    const vehicle = uuid();
    const other = uuid();
    const people = {
      cohostInScope: uuid(),
      cohostOutOfScope: uuid(),
      invited: uuid(),
      removed: uuid(),
      foreignCohost: uuid(),
    };
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { commit: true }, async (tx) => {
        await tx.query('SELECT test_fixture.create_org($1, $2, $3)', [org, c.country, 'ACTIVE']);
        await tx.query('SELECT test_fixture.create_org($1, $2, $3)', [
          otherOrg,
          c.country,
          'ACTIVE',
        ]);
        await registerVehicles(tx, [vehicle, other], org, c);
        for (const person of Object.values(people)) {
          await tx.query('SELECT test_fixture.ensure_party($1, NULL, NULL)', [person]);
        }
        const member = (user: string, inOrg: string, scope: string[], status: string) =>
          tx.query(
            `SELECT test_fixture.iam_insert_membership($1, $2, $3, 'CO_HOST', $4::uuid[], $5)`,
            [uuid(), user, inOrg, scope, status],
          );
        await member(people.cohostInScope, org, [vehicle], 'ACTIVE');
        await member(people.cohostOutOfScope, org, [other], 'ACTIVE');
        await member(people.invited, org, [vehicle], 'INVITED');
        await member(people.removed, org, [vehicle], 'REMOVED');
        await member(people.foreignCohost, otherOrg, [], 'ACTIVE');
      });

      const START = '2034-03-01T10:00:00Z';
      const END = '2034-03-03T10:00:00Z';
      for (const guest of [people.cohostInScope, people.cohostOutOfScope, people.invited]) {
        expect(await pose(client, guest, vehicle, org, START, END), guest).toBe(
          'SELF_BOOKING_FORBIDDEN',
        );
      }
      // témoins : l'appartenance retirée, ou à un autre compte, ne bloque pas (créneaux disjoints)
      expect(await pose(client, people.removed, vehicle, org, START, END)).toBe('OK');
      expect(
        await pose(
          client,
          people.foreignCohost,
          vehicle,
          org,
          '2034-04-01T10:00:00Z',
          '2034-04-03T10:00:00Z',
        ),
      ).toBe('OK');
    });
  });
});

/** Fonctions de pg_catalog à effet de bord hors RLS, retirées de PUBLIC par l'amorçage (§ 3). */
const SIDE_EFFECT_FUNCTIONS = [
  'pg_logical_emit_message',
  'lo_creat',
  'lo_create',
  'lo_from_bytea',
  'lo_import',
  'lo_export',
  'pg_cancel_backend',
  'pg_terminate_backend',
] as const;

describe.each(['main', 'production'] as const)('US-049 F-RLS-04 — base %s', (database) => {
  it('aucune fonction de pg_catalog à effet de bord n’est exécutable par un rôle applicatif', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{ sig: string; role: string; x: boolean }>(
          `SELECT p.oid::regprocedure::text AS sig, r.role,
                  pg_catalog.has_function_privilege(r.role, p.oid, 'EXECUTE') AS x
             FROM pg_catalog.pg_proc AS p
             JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
            CROSS JOIN pg_catalog.unnest($2::text[]) AS r(role)
            WHERE n.nspname = 'pg_catalog' AND p.proname = ANY ($1::text[])
            ORDER BY 1, 2`,
          [[...SIDE_EFFECT_FUNCTIONS], [...APP_ROLES]],
        );
        // la liste n'est pas vide : les deux signatures de pg_logical_emit_message au moins
        expect(rows.filter((r) => r.sig.startsWith('pg_logical_emit_message(')).length).toBe(
          2 * APP_ROLES.length,
        );
        expect(rows.filter((r) => r.x)).toEqual([]);
      },
      { database },
    );
  });

  it.each(APP_ROLES)('appel réel sous %s : 42501', async (role) => {
    await withRole(
      role,
      async (client) => {
        for (const sql of [
          `SELECT pg_catalog.pg_logical_emit_message(false, 'rueda-us049', 'x')`,
          `SELECT pg_catalog.lo_from_bytea(0, '\\x00'::bytea)`,
          'SELECT pg_catalog.lo_creat(-1)',
        ]) {
          await expect(client.query(sql), sql).rejects.toMatchObject({ code: '42501' });
        }
      },
      { database },
    );
  });
});
