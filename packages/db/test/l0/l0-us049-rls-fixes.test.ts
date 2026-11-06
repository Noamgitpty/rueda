/**
 * US-049 — correctifs de la red team RLS de la porte du lot 0 (docs/team/redteam/L0-rls.md ;
 * migration 0056, amorçage 0000 § 3, ADR-089). Les attaques elles-mêmes restent dans
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
 * - RT-CONC-02 (red team concurrence, « fin infinie ») : hold et blocage à borne infinie refusés
 *   (`INVALID_PERIOD`) ; hold de plus de `max_trip_days` jours du pays (17 §7.2 : 30) refusé
 *   (`INVALID_PERIOD`), exactement 30 jours accepté.
 * - F-RLS-06 (0057) : sous `app_worker`, un nom de travailleur inconnu, ou connu mais non
 *   autorisé, ne lit aucune clé de sujet et n'en écrit aucune ; un nom inconnu n'écrit ni dans le
 *   journal d'audit, ni dans le journal d'accès aux données, ni dans le registre des fichiers ; la
 *   liste des travailleurs admis à écrire ces trois tables est EXACTEMENT celle de la matrice
 *   d'autorisations. Chaque test peuple lui-même la table qu'il lit (aucune dépendance à l'ordre
 *   des fichiers, contrairement à RT-RLS-16).
 * F-RLS-01 (blocage sur le véhicule d'autrui ou inconnu) est prouvé dans
 * l0-occ-single-occupancy (cloisonnement des écritures) et par RT-RLS-17.
 * Rôles de production seulement (assertion L0-05 par connectAs / withRole). En USD (PA) et en PYG
 * (PY).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { APP_ROLES, PACKAGE_ROOT, setSessionContext, translateDbError } from '../../src/index.ts';
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

/** Durée maximale d'une location par pays (17 §7.2 `max_trip_days`, ADM-031 : 30 j en bêta). */
const MAX_TRIP_DAYS = 30;
const DAY_MS = 86_400_000;

describe.each(COUNTRIES)('US-049 RT-CONC-02 — périodes bornées ($country, $currency)', (c) => {
  it('hold : fin infinie et durée > max_trip_days ⇒ INVALID_PERIOD ; exactement max_trip_days accepté ; blocage à borne infinie ⇒ INVALID_PERIOD', async () => {
    const org = uuid();
    const vehicles = [uuid(), uuid()];
    const guest = uuid();
    await withRole('app_api', async (client) => {
      const holder = await withTestTransaction(client, { commit: true }, async (tx) => {
        const h = await tx.query<{ h: string }>('SELECT test_fixture.create_org($1, $2, $3) AS h', [
          org,
          c.country,
          'ACTIVE',
        ]);
        await registerVehicles(tx, vehicles, org, c);
        await tx.query('SELECT test_fixture.ensure_party($1, NULL, NULL)', [guest]);
        return h.rows[0]?.h as string;
      });
      const start = Date.parse('2035-05-01T10:00:00Z');
      const iso = (ms: number): string => new Date(ms).toISOString();
      const [v0, v1] = vehicles as [string, string];
      expect(await pose(client, guest, v0, org, iso(start), 'infinity')).toBe('INVALID_PERIOD');
      expect(
        await pose(client, guest, v0, org, iso(start), iso(start + MAX_TRIP_DAYS * DAY_MS + 1000)),
      ).toBe('INVALID_PERIOD');
      expect(
        await pose(client, guest, v0, org, iso(start), iso(start + MAX_TRIP_DAYS * DAY_MS)),
      ).toBe('OK');

      for (const [from, to] of [
        ['-infinity', iso(start)],
        [iso(start), 'infinity'],
      ] as const) {
        const code = await withTestTransaction(client, {}, async (tx) => {
          await setSessionContext(tx, { kind: 'HOST', actorId: holder, orgId: org });
          try {
            await tx.query(
              'SELECT core.booking_cmd_place_host_block($1, $2::timestamptz, $3::timestamptz)',
              [v1, from, to],
            );
            return 'OK';
          } catch (error) {
            return translateDbError(error).code;
          }
        });
        expect(code, `${from} → ${to}`).toBe('INVALID_PERIOD');
      }
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

// ---------------------------------------------------------------------------------------------
// F-RLS-06 (0057) : politiques des travailleurs fondées sur le seul nom
// ---------------------------------------------------------------------------------------------

/** Travailleurs déclarés par la matrice d'autorisations (ADR-077) : la source qui fait foi. */
const MATRIX_FILE = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'authorization-matrix.json'), 'utf8'),
) as {
  travailleurs: string[];
  relations: Record<string, { travailleurs?: Record<string, string> }>;
};
const DECLARED_WORKERS: readonly string[] = MATRIX_FILE.travailleurs;
/** Travailleurs qui chiffrent ou déchiffrent une donnée C2 / C3 (0057, ADR-089). */
const KEY_READERS = ['evidence_ingest', 'evidence_verifier', 'privacy_request'];
const KEY_WRITERS = ['evidence_ingest', 'privacy_request'];
const UNKNOWN_WORKER = 'us049_intrus';
const INSERT_KEY = `INSERT INTO core.audit_subject_key (subject_type, subject_id, wrapped_dek, kms_key_id)
                    VALUES ('USER', $1, $2, 'fake:us049')`;

/** Tentative en point de sauvegarde, sous le travailleur `name` : code SQLSTATE ou `OK`. */
async function asWorker(
  tx: pg.ClientBase,
  name: string,
  sql: string,
  params: readonly unknown[] = [],
): Promise<{ code: string; rows: number }> {
  await tx.query('SAVEPOINT us049_worker');
  try {
    await tx.query(
      `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
              pg_catalog.set_config('app.actor_id', '', true),
              pg_catalog.set_config('app.worker_name', $1, true)`,
      [name],
    );
    const r = await tx.query(sql, [...params]);
    await tx.query('RELEASE SAVEPOINT us049_worker');
    return { code: 'OK', rows: r.rowCount ?? 0 };
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT us049_worker');
    return { code: (error as { code?: string }).code ?? 'ERROR', rows: 0 };
  }
}

describe('US-049 F-RLS-06 — clés de sujet et journaux d’audit sous app_worker', () => {
  it('la matrice déclare les travailleurs autorisés aux clés de sujet, et eux seuls', async () => {
    // L0-05 : assertion de rôle exigée de chaque test, même sans requête métier
    await withRole('app_worker', (client) => client.query('SELECT 1'));
    for (const name of KEY_READERS) expect(DECLARED_WORKERS).toContain(name);
    expect(MATRIX_FILE.relations['core.audit_subject_key']?.travailleurs).toEqual(
      Object.fromEntries(KEY_READERS.map((n) => [n, 'tout'])),
    );
  });

  it('table peuplée : nom inconnu et nom connu non autorisé ⇒ 0 clé lue, aucune écrite ; travailleurs autorisés : lecture et écriture', async () => {
    const owner = uuid();
    await withRole('app_worker', async (client) => {
      // la table est peuplée par ce test (commit), jamais par un autre fichier
      await withTestTransaction(client, { commit: true }, async (tx) => {
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'evidence_ingest' });
        await tx.query(INSERT_KEY, [owner, randomBytes(48)]);
      });
      await withTestTransaction(client, {}, async (tx) => {
        const readers = [
          UNKNOWN_WORKER,
          ...DECLARED_WORKERS.filter((n) => !KEY_READERS.includes(n)),
        ];
        expect(readers.length).toBeGreaterThan(5);
        for (const name of readers) {
          const read = await asWorker(tx, name, 'SELECT 1 FROM core.audit_subject_key');
          expect(read, name).toEqual({ code: 'OK', rows: 0 });
        }
        const writers = [
          UNKNOWN_WORKER,
          ...DECLARED_WORKERS.filter((n) => !KEY_WRITERS.includes(n)),
        ];
        for (const name of writers) {
          const write = await asWorker(tx, name, INSERT_KEY, [uuid(), randomBytes(48)]);
          expect(write.code, name).toBe('42501');
        }
        // témoins : la clé posée est visible des lecteurs autorisés ; les écrivains en créent
        for (const name of KEY_READERS) {
          const read = await asWorker(
            tx,
            name,
            'SELECT 1 FROM core.audit_subject_key WHERE subject_id = $1',
            [owner],
          );
          expect(read, name).toEqual({ code: 'OK', rows: 1 });
        }
        for (const name of KEY_WRITERS) {
          const write = await asWorker(tx, name, INSERT_KEY, [uuid(), randomBytes(48)]);
          expect(write, name).toEqual({ code: 'OK', rows: 1 });
        }
      });
    });
  });

  const AUDIT_INSERTS: readonly (readonly [string, string, () => unknown[]])[] = [
    [
      'core.audit_audit_log',
      `INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                         subject_id, after, request_id)
       VALUES ($1, 'STAFF', 'TEST_ACTION', 'TRIP', $2, '{"us049": 1}', $3)`,
      () => [uuid(), uuid(), uuid()],
    ],
    [
      'core.audit_data_access_log',
      `INSERT INTO core.audit_data_access_log (id, actor_user_id, actor_role, subject_type, subject_id,
                                               field_or_file, purpose, access_kind, case_ref)
       VALUES ($1, $2, 'SUPPORT_AGENT', 'USER', $3, 'identity_document.number_enc',
               'vérification du dossier (test US-049)', 'READ_C3', 'CASE-2031-0049')`,
      () => [uuid(), uuid(), uuid()],
    ],
    [
      'core.audit_file_asset',
      `INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256, source,
                                          classification, retention_class)
       VALUES ($1, 'PUBLIC_LISTING', $2, 'image/jpeg', 1, $3, 'IN_APP_CAMERA', 'C0', 'CLAIM_EVIDENCE')`,
      () => [uuid(), `k/${uuid()}`, randomBytes(32)],
    ],
  ];

  it.each(AUDIT_INSERTS)(
    '%s : un nom inconnu ou vide n’écrit rien (42501) ; chaque travailleur de la matrice passe la politique',
    async (_table, sql, params) => {
      await withRole('app_worker', async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          expect((await asWorker(tx, UNKNOWN_WORKER, sql, params())).code).toBe('42501');
          expect((await asWorker(tx, '', sql, params())).code).toBe('42501');
          // témoin : la politique admet les travailleurs déclarés (une contrainte de la table peut
          // refuser la ligne d'essai, jamais le droit : tout sauf 42501)
          for (const name of DECLARED_WORKERS) {
            expect((await asWorker(tx, name, sql, params())).code, name).not.toBe('42501');
          }
        });
      });
    },
  );

  it.each(['main', 'production'] as const)(
    'base %s : les politiques worker_insert des tables d’audit nomment exactement les travailleurs de la matrice',
    async (database) => {
      await withRole(
        'app_api',
        async (client) => {
          const { rows } = await client.query<{ rel: string; expr: string }>(
            `SELECT c.relname AS rel, pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS expr
               FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
              WHERE p.polname = 'worker_insert'
                AND c.relname IN ('audit_audit_log', 'audit_data_access_log', 'audit_file_asset')
              ORDER BY 1`,
          );
          expect(rows.map((r) => r.rel)).toEqual([
            'audit_audit_log',
            'audit_data_access_log',
            'audit_file_asset',
          ]);
          for (const r of rows) {
            const names = [...r.expr.matchAll(/'([a-z_]+)'::text/g)]
              .map((m) => m[1] as string)
              .sort();
            expect(names, r.rel).toEqual([...DECLARED_WORKERS].sort());
          }
        },
        { database },
      );
    },
  );
});
