/**
 * US-043 — matrice d'autorisations EXÉCUTABLE de la base (packages/db/authorization-matrix.json ;
 * 17 §2.3 matrice de permissions, rôles SQL, RLS-1 à RLS-28 ; ADR-077).
 *
 * Toute cellule est prouvée ici, sous les rôles de PRODUCTION (assertion L0-05 : withRole), en PA
 * et en PY :
 *
 * 1. Inventaire (base de production, migrations de production seules) : l'ensemble des relations
 *    des schémas du projet est EXACTEMENT celui de la matrice (une nouvelle table ou vue sans entrée
 *    fait échouer la CI) ; RLS ENABLE + FORCE sur chaque table ; vues en `security_invoker` ; droits
 *    de table ET de colonne des trois rôles applicatifs égaux à la matrice ; aucune politique,
 *    aucun droit pour PUBLIC ; politiques applicables à chaque rôle égales à la matrice ; aucun
 *    droit sur une séquence ; app_anon n'exécute aucune fonction du projet.
 * 2. Écritures : chaque droit INSERT, UPDATE, DELETE, TRUNCATE absent de la matrice est refusé
 *    (42501) à l'exécution, rôle par rôle et relation par relation.
 * 3. Lectures, acteur par acteur (anonyme, sans contexte, voyageur, hôte titulaire, co-hôte, hôte
 *    à compte forgé, staff par rôle et par pays, ADMIN à portée élargie par le contexte, staff
 *    sans session élevée, chaque travailleur, travailleur inconnu ou sans nom) et pays par pays :
 *    les lignes visibles sous la RLS sont EXACTEMENT celles du prédicat de la matrice (nombre,
 *    empreinte des identifiants, nombre par pays), calculé par la fixture 9900 dans le MÊME
 *    instantané (REPEATABLE READ) sans la RLS des rôles applicatifs. `refus` = 42501.
 *    Chaque relation lisible par app_api est peuplée dans chaque pays (sinon une cellule
 *    « aucune » ne prouverait rien), sauf exception motivée (`sans_donnees`).
 * Les prédicats viennent de 17 §2.3 (qui voit quoi) et des stories (US-011, US-012, US-062) ; ils ne
 * sont jamais lus dans les politiques testées.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { APP_ROLES, PACKAGE_ROOT, setSessionContext } from '../../src/index.ts';
import type { AppRole, SessionContext } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { buildWorld, staff, staffSessionHash, uuid, type World } from '../support/rls.ts';
import {
  captureLegs,
  golden,
  recordAsSettlementWorker,
  recordOfVector,
} from '../support/settlement.ts';

type Grants = Readonly<Record<string, '*' | readonly string[]>>;
interface Relation {
  readonly type: 'table' | 'view';
  readonly droits: Readonly<Record<AppRole, Grants>>;
  readonly politiques?: Readonly<Record<AppRole, readonly string[]>>;
  readonly source?: string;
  readonly identifiant?: string;
  /** Colonne de la source qui correspond à `identifiant` (vue lue par sa table, ex. trip_id = id). */
  readonly identifiant_source?: string;
  readonly lecture?: Readonly<Record<string, string>>;
  readonly travailleurs?: Readonly<Record<string, string>>;
  readonly sans_donnees?: string;
}
interface Matrix {
  readonly acteurs: readonly string[];
  readonly travailleurs: readonly string[];
  readonly fonctions_app_anon: readonly string[];
  readonly relations: Readonly<Record<string, Relation>>;
}

const MATRIX = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'authorization-matrix.json'), 'utf8'),
) as Matrix;
const RELATIONS = Object.entries(MATRIX.relations).sort(([a], [b]) => (a < b ? -1 : 1));
const PROJECT_SCHEMAS = ['core', 'app', 'platform'];
const WRITES = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] as const;
const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const INTRUDER = 'us043_intrus';
const NO_SESSION = '0'.repeat(64);

// ---------------------------------------------------------------------------------------------
// Prédicats de la matrice → SQL de la fixture (valeurs en paramètre lié $1, jsonb)
// ---------------------------------------------------------------------------------------------

interface Params {
  readonly acteur?: string | null;
  readonly org?: string | null;
  readonly vehicules?: readonly string[];
  readonly pays?: string | null;
  readonly dossiers?: readonly string[];
  readonly travailleur?: string | null;
}

const array = (name: string): string =>
  `ARRAY(SELECT pg_catalog.jsonb_array_elements_text($1->'${name}'))::uuid[]`;

/** Prédicat de la matrice en SQL ; `null` pour `refus` (aucun droit : 42501 attendu). */
export function predicateSql(cell: string): string | null {
  if (cell === 'refus') return null;
  if (cell === 'tout') return 'true';
  if (cell === 'aucune') return 'false';
  return cell
    .replace(/:acteur\b/g, "($1->>'acteur')::uuid")
    .replace(/:org\b/g, "($1->>'org')::uuid")
    .replace(/:pays\b/g, "($1->>'pays')")
    .replace(/:travailleur\b/g, "($1->>'travailleur')")
    .replace(/:vehicules\b/g, array('vehicules'))
    .replace(/:dossiers\b/g, array('dossiers'));
}

// ---------------------------------------------------------------------------------------------
// Observation sous la RLS et attendu de la fixture, dans le même instantané
// ---------------------------------------------------------------------------------------------

interface Seen {
  readonly n: number;
  readonly ids: string | null;
  readonly countries: Readonly<Record<string, number>> | null;
}

const quoteRel = (rel: string): string => {
  if (!/^[a-z]+\.[a-z0-9_]+$/.test(rel)) throw new Error(`relation inattendue : ${rel}`);
  return rel;
};

async function columnReadable(tx: pg.ClientBase, rel: string, column: string): Promise<boolean> {
  const { rows } = await tx.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                     WHERE attrelid = $1::regclass AND attname = $2 AND attnum > 0 AND NOT attisdropped)
            AND pg_catalog.has_column_privilege($1::regclass, $2, 'SELECT') AS ok`,
    [rel, column],
  );
  return rows[0]?.ok === true;
}

/** Ce que l'acteur voit (ou `refus`) ; point de sauvegarde : la transaction reste utilisable. */
async function observe(
  tx: pg.ClientBase,
  rel: string,
  idColumn: string | null,
  byCountry: boolean,
): Promise<Seen | 'refus'> {
  await tx.query('SAVEPOINT cell');
  try {
    const id = idColumn === null ? 'NULL::text' : `${idColumn}::text`;
    const { rows } = await tx.query<{ n: string; ids: string }>(
      `SELECT count(*)::text AS n,
              pg_catalog.md5(COALESCE(pg_catalog.string_agg(${id}, ',' ORDER BY ${id}), '')) AS ids
         FROM ${quoteRel(rel)}`,
    );
    let countries: Record<string, number> | null = null;
    if (byCountry) {
      const c = await tx.query<{ k: string; n: string }>(
        `SELECT COALESCE(country_code::text, '') AS k, count(*)::text AS n FROM ${quoteRel(rel)} GROUP BY 1`,
      );
      countries = Object.fromEntries(c.rows.map((r) => [r.k, Number(r.n)]));
    }
    await tx.query('RELEASE SAVEPOINT cell');
    return {
      n: Number(rows[0]?.n),
      ids: idColumn === null ? null : (rows[0]?.ids ?? null),
      countries,
    };
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT cell');
    if ((error as { code?: string }).code === '42501') return 'refus';
    throw error;
  }
}

async function expected(
  tx: pg.ClientBase,
  rel: string,
  r: Relation,
  predicate: string,
  params: Params,
  idColumn: string | null,
  byCountry: boolean,
): Promise<Seen> {
  const { rows } = await tx.query<{
    e: { n: number; ids: string; countries: Record<string, number> };
  }>('SELECT test_fixture.us043_expected($1, $2, $3, $4::jsonb, $5, $6) AS e', [
    rel,
    r.source ?? null,
    predicate,
    JSON.stringify(params),
    idColumn === null ? null : (r.identifiant_source ?? idColumn),
    byCountry,
  ]);
  const e = rows[0]?.e;
  if (e === undefined) throw new Error(`attendu absent : ${rel}`);
  return {
    n: Number(e.n),
    ids: idColumn === null ? null : e.ids,
    countries: byCountry ? e.countries : null,
  };
}

interface CellResult {
  readonly cell: string;
  readonly seen: Seen | 'refus';
  readonly want: Seen | 'refus';
}

/**
 * Évalue toutes les cellules d'un acteur dans UNE transaction REPEATABLE READ : observation sous
 * la RLS, puis attendu de la fixture sur le même instantané.
 */
async function evaluate(
  client: pg.ClientBase,
  ctx: SessionContext | null,
  cellOf: (rel: string, r: Relation) => string,
  params: Params,
): Promise<Record<string, CellResult>> {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    if (ctx !== null) await setSessionContext(client, ctx);
    const out: Record<string, CellResult> = {};
    for (const [rel, r] of RELATIONS) {
      const cell = cellOf(rel, r);
      // « refus » : prouvé sur la base de PRODUCTION (la base de test porte des droits de test,
      // 9100 et 9500) par « lectures refusées » ci-dessous
      if (cell === 'refus') continue;
      const idCandidate = r.identifiant ?? 'id';
      const idColumn = (await columnReadable(client, rel, idCandidate)) ? idCandidate : null;
      const byCountry = await columnReadable(client, rel, 'country_code');
      const seen = await observe(client, rel, idColumn, byCountry);
      const sql = predicateSql(cell);
      if (sql === null) throw new Error(`cellule ${rel}`);
      const want = await expected(client, rel, r, sql, params, idColumn, byCountry);
      out[rel] = { cell, seen, want };
    }
    return out;
  } finally {
    await client.query('ROLLBACK');
  }
}

/** Forme canonique (clés triées) : l'ordre des pays rendu par la base n'est pas une différence. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x !== null && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : x,
  );

function assertCells(results: Record<string, CellResult>, who: string): void {
  const wrong = Object.entries(results)
    .filter(([, x]) => canonical(x.seen) !== canonical(x.want))
    .map(([rel, x]) => ({ rel, cell: x.cell, seen: x.seen, want: x.want }));
  expect(wrong, `${who} : cellules non conformes à la matrice`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------
// 1. Inventaire : base de production
// ---------------------------------------------------------------------------------------------

describe('US-043 — matrice : inventaire de la base de production', () => {
  it('relations du projet = matrice ; tables en RLS ENABLE + FORCE ; vues en security_invoker', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{
          rel: string;
          kind: string;
          rls: boolean;
          force: boolean;
          options: string[] | null;
        }>(
          `SELECT n.nspname || '.' || c.relname AS rel, c.relkind::text AS kind,
                  c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                  c.reloptions::text[] AS options
             FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ANY ($1::text[]) AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
            ORDER BY 1`,
          [PROJECT_SCHEMAS],
        );
        expect(rows.map((r) => r.rel)).toEqual(RELATIONS.map(([rel]) => rel));
        for (const r of rows) {
          const m = MATRIX.relations[r.rel];
          if (m?.type === 'table') {
            expect(r.kind, r.rel).toMatch(/^[rp]$/);
            expect({ rls: r.rls, force: r.force }, r.rel).toEqual({ rls: true, force: true });
          } else {
            expect(r.kind, r.rel).toBe('v');
            expect(r.options ?? [], r.rel).toContain('security_invoker=true');
          }
        }
      },
      { database: 'production' },
    );
  });

  it('droits de table et de colonne des rôles applicatifs = matrice ; aucun droit pour PUBLIC', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{
          rel: string;
          grantee: string;
          lvl: string;
          priv: string;
          col: string | null;
        }>(
          `WITH rels AS (
             SELECT c.oid, n.nspname || '.' || c.relname AS rel, c.relacl
               FROM pg_catalog.pg_class c
               JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = ANY ($1::text[]) AND c.relkind IN ('r', 'p', 'v', 'm', 'f'))
           SELECT r.rel, COALESCE(g.rolname, 'PUBLIC')::text AS grantee, 'T' AS lvl,
                  x.privilege_type AS priv, NULL::text AS col
             FROM rels r CROSS JOIN LATERAL pg_catalog.aclexplode(r.relacl) x
             LEFT JOIN pg_catalog.pg_roles g ON g.oid = x.grantee
            WHERE x.grantee = 0 OR g.rolname = ANY ($2::text[])
           UNION ALL
           SELECT r.rel, COALESCE(g.rolname, 'PUBLIC')::text, 'C', x.privilege_type, a.attname::text
             FROM rels r
             JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
             CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
             LEFT JOIN pg_catalog.pg_roles g ON g.oid = x.grantee
            WHERE x.grantee = 0 OR g.rolname = ANY ($2::text[])`,
          [PROJECT_SCHEMAS, [...APP_ROLES]],
        );
        expect(rows.filter((r) => r.grantee === 'PUBLIC')).toEqual([]);
        const seen: Record<string, Record<string, Record<string, '*' | string[]>>> = {};
        for (const r of rows) {
          const role = (seen[r.rel] ??= {});
          const privs = (role[r.grantee] ??= {});
          if (r.lvl === 'T') privs[r.priv] = '*';
          else if (privs[r.priv] !== '*') {
            const cols = (privs[r.priv] ?? []) as string[];
            cols.push(r.col ?? '');
            privs[r.priv] = cols;
          }
        }
        const normalize = (g: Grants | undefined): Record<string, '*' | string[]> =>
          Object.fromEntries(
            PRIVILEGES.filter((p) => g?.[p] !== undefined).map((p) => {
              const v = g?.[p];
              return [p, v === '*' ? '*' : [...(v ?? [])].sort()];
            }),
          );
        const diff = RELATIONS.flatMap(([rel, m]) =>
          APP_ROLES.map((role) => ({
            rel,
            role,
            want: normalize(m.droits[role]),
            seen: normalize(seen[rel]?.[role]),
          })).filter((x) => JSON.stringify(x.want) !== JSON.stringify(x.seen)),
        );
        expect(diff).toEqual([]);
      },
      { database: 'production' },
    );
  });

  it('politiques applicables à chaque rôle applicatif = matrice (toutes permissives)', async () => {
    await withRole(
      'app_worker',
      async (client) => {
        const { rows } = await client.query<{
          rel: string;
          name: string;
          cmd: string;
          permissive: boolean;
          roles: string[];
        }>(
          `SELECT n.nspname || '.' || c.relname AS rel, p.polname::text AS name,
                  CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                                WHEN 'd' THEN 'DELETE' ELSE 'ALL' END AS cmd,
                  p.polpermissive AS permissive,
                  ARRAY(SELECT CASE WHEN o = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(o)::text END
                          FROM unnest(p.polroles) AS o) AS roles
             FROM pg_catalog.pg_policy p
             JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ANY ($1::text[])`,
          [PROJECT_SCHEMAS],
        );
        expect(
          rows.filter((r) => r.roles.includes('PUBLIC')).map((r) => `${r.rel}.${r.name}`),
        ).toEqual([]);
        expect(rows.filter((r) => !r.permissive).map((r) => `${r.rel}.${r.name}`)).toEqual([]);
        const diff = RELATIONS.filter(([, m]) => m.type === 'table').flatMap(([rel, m]) =>
          APP_ROLES.map((role) => ({
            rel,
            role,
            want: [...(m.politiques?.[role] ?? [])].sort(),
            seen: rows
              .filter((r) => r.rel === rel && r.roles.includes(role))
              .map((r) => `${r.name}:${r.cmd}`)
              .sort(),
          })).filter((x) => JSON.stringify(x.want) !== JSON.stringify(x.seen)),
        );
        expect(diff).toEqual([]);
      },
      { database: 'production' },
    );
  });

  it('cohérence : lecture décrite ⇔ SELECT accordé (app_api), travailleurs décrits ⇔ SELECT (app_worker) ; chaque acteur a sa cellule', async () => {
    await withRole('app_api', (client) => client.query('SELECT 1'));
    for (const [rel, m] of RELATIONS) {
      expect(m.lecture !== undefined, `${rel} lecture`).toBe(m.droits.app_api.SELECT !== undefined);
      expect(m.travailleurs !== undefined, `${rel} travailleurs`).toBe(
        m.droits.app_worker.SELECT !== undefined,
      );
      expect(m.droits.app_anon, `${rel} app_anon`).toEqual({});
      if (m.lecture) expect(Object.keys(m.lecture).sort(), rel).toEqual([...MATRIX.acteurs].sort());
      for (const name of Object.keys(m.travailleurs ?? {})) {
        expect(['*', 'sans_nom', ...MATRIX.travailleurs], `${rel} ${name}`).toContain(name);
      }
      for (const cell of [
        ...Object.values(m.lecture ?? {}),
        ...Object.values(m.travailleurs ?? {}),
      ]) {
        expect(cell, rel).not.toBe('refus');
        expect(() => predicateSql(cell), rel).not.toThrow();
      }
    }
  });

  it('séquences : aucun droit applicatif ; app_anon n’exécute aucune fonction du projet', async () => {
    await withRole(
      'app_anon',
      async (client) => {
        const seq = await client.query<{ seq: string; role: string }>(
          `SELECT n.nspname || '.' || c.relname AS seq, r AS role
             FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             CROSS JOIN unnest($2::text[]) AS r
            WHERE n.nspname = ANY ($1::text[]) AND c.relkind = 'S'
              AND pg_catalog.has_sequence_privilege(r, c.oid, 'USAGE,SELECT,UPDATE')`,
          [PROJECT_SCHEMAS, [...APP_ROLES]],
        );
        expect(seq.rows).toEqual([]);
        const fns = await client.query<{ fn: string }>(
          `SELECT pg_catalog.regexp_replace(p.oid::regprocedure::text, ',\\s+', ',', 'g') AS fn
             FROM pg_catalog.pg_proc p
             JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = ANY ($1::text[])
              AND pg_catalog.has_function_privilege('app_anon', p.oid, 'EXECUTE')
            ORDER BY 1`,
          [PROJECT_SCHEMAS],
        );
        expect(fns.rows.map((r) => r.fn)).toEqual([...MATRIX.fonctions_app_anon].sort());
      },
      { database: 'production' },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Écritures : tout droit absent de la matrice est refusé à l'exécution
// ---------------------------------------------------------------------------------------------

/** Première colonne ordinaire (ni identité, ni générée), lue au catalogue sans droit sur le schéma. */
async function firstColumn(client: pg.ClientBase, rel: string): Promise<string> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT a.attname::text AS name
       FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname || '.' || c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attidentity = '' AND a.attgenerated = ''
      ORDER BY a.attnum LIMIT 1`,
    [rel],
  );
  const name = rows[0]?.name;
  if (name === undefined || !/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`colonne de ${rel}`);
  return name;
}

describe.each(APP_ROLES)(
  'US-043 — matrice : écritures refusées, %s (base de production)',
  (role) => {
    it('chaque INSERT, UPDATE, DELETE, TRUNCATE absent de la matrice ⇒ 42501', async () => {
      await withRole(
        role,
        async (client) => {
          const accepted: string[] = [];
          let probes = 0;
          await client.query('BEGIN');
          try {
            for (const [rel, m] of RELATIONS) {
              const col = await firstColumn(client, rel);
              const statements: Record<(typeof WRITES)[number], string> = {
                INSERT: `INSERT INTO ${quoteRel(rel)} (${col}) SELECT NULL WHERE false`,
                UPDATE: `UPDATE ${quoteRel(rel)} SET ${col} = ${col} WHERE false`,
                DELETE: `DELETE FROM ${quoteRel(rel)} WHERE false`,
                TRUNCATE: `TRUNCATE ${quoteRel(rel)}`,
              };
              for (const w of WRITES) {
                if (m.droits[role][w] !== undefined) continue;
                if (w === 'TRUNCATE' && m.type === 'view') continue;
                probes++;
                await client.query('SAVEPOINT probe');
                try {
                  await client.query(statements[w]);
                  accepted.push(`${rel} ${w}`);
                  await client.query('RELEASE SAVEPOINT probe');
                } catch (error) {
                  await client.query('ROLLBACK TO SAVEPOINT probe');
                  const code = (error as { code?: string }).code;
                  // 55000 : vue non modifiable (aucune écriture possible, quel que soit le droit)
                  if (code !== '42501' && !(m.type === 'view' && code === '55000')) {
                    accepted.push(`${rel} ${w} (${(error as { code?: string }).code})`);
                  }
                }
              }
            }
          } finally {
            await client.query('ROLLBACK');
          }
          expect(accepted).toEqual([]);
          expect(probes).toBeGreaterThan(RELATIONS.length);
        },
        { database: 'production' },
      );
    });
  },
);

// ---------------------------------------------------------------------------------------------
// 3. Lectures, acteur par acteur et pays par pays
// ---------------------------------------------------------------------------------------------

let world: World;
interface CountryStaff {
  readonly SUPPORT_AGENT: string;
  readonly OPS_AGENT: string;
  readonly FINANCE: string;
  readonly ADMIN: string;
  readonly SUPERADMIN: string;
}
const staffOf: CountryStaff[] = [];
const REF: Readonly<Record<string, { readonly vector: string; readonly capture: string }>> = {
  USD: { vector: 'T03', capture: 'TJ01' },
  PYG: { vector: 'T27', capture: 'TJ08a' },
};
const refOf = (currency: string): { vector: string; capture: string } => {
  const r = REF[currency];
  if (!r) throw new Error(`aucun vecteur de référence en ${currency}`);
  return r;
};
const TRIP_KEYS = ['a1', 'a2', 'b1'] as const;
/** Avance RELEASED_LEG du trip b1, par pays : sujet de la demande FINANCE. */
const advanceB1: string[] = [];
const hashOf = (actor: string): Buffer => Buffer.from(staffSessionHash(actor) ?? '', 'hex');

/**
 * US-049 (F-RLS-05, red team RLS) : `core.config_brand_asset` n'est lisible par app_api que pour
 * un actif référencé par une version de thème ou un bloc de contenu PUBLIÉS. Le test « relations
 * peuplées » dépendait des actifs publiés par un AUTRE fichier (l0-brand), qui les publie puis les
 * remplace en cours de route : vert ou rouge selon l'ordre des fichiers. La matrice publie donc son
 * propre actif, par les vraies commandes (ADMIN des deux pays, session élevée du monde de test) :
 * un bloc de contenu par pays, à une clé propre à ce fichier, qu'aucun autre test ne remplace ni
 * n'archive. Le contrôle n'est pas affaibli : la table reste exigée peuplée, sans `sans_donnees`.
 */
async function seedPublishedBrandAsset(client: pg.ClientBase): Promise<void> {
  const admin = hashOf(world.staff.adminAll);
  const body = Buffer.from(`us043 ${uuid()}`, 'utf8');
  const asset = await client.query<{ outcome: string; asset_id: string | null }>(
    `SELECT outcome, asset_id FROM core.cfg_brand_cmd_register_asset($1, $2, $3, 'HERO_IMAGE',
       'image/png', $4, $5, 'Imagen de prueba', 'Test image', 'Image de test', 'Imagem de teste',
       'Licence vérifiée (test US-043)')`,
    [admin, uuid(), uuid(), body.length, createHash('sha256').update(body).digest()],
  );
  expect(asset.rows[0]?.outcome).toBe('REGISTERED');
  const key = `us043.matrix_${uuid().replace(/-/g, '').slice(0, 12)}.hero`;
  // un bloc par pays : config_content_block est lue par pays (colonne country_code), et un bloc
  // commun (pays NULL) ne compterait pour aucun des deux
  for (const { country } of COUNTRIES) {
    const draft = await client.query<{ outcome: string; version_no: number | null }>(
      'SELECT * FROM core.cfg_content_cmd_save_draft($1, $2, $3, $4, $5, $6)',
      [
        admin,
        uuid(),
        key,
        country,
        {
          es: 'Bloque de prueba de la matriz.',
          en: 'Authorization matrix test block.',
          fr: 'Bloc de test de la matrice.',
          pt: 'Bloco de teste da matriz.',
        },
        asset.rows[0]?.asset_id,
      ],
    );
    expect(draft.rows[0]?.outcome, country).toBe('SAVED');
    const published = await client.query<{ outcome: string }>(
      'SELECT * FROM core.cfg_content_cmd_publish($1, $2, $3, $4, $5)',
      [admin, uuid(), key, country, draft.rows[0]?.version_no],
    );
    expect(published.rows[0]?.outcome, country).toBe('PUBLISHED');
  }
}

/** Jetons du thème par défaut (Tinta, DEC-MARQUE) : le jeu que publie aussi l0-brand. */
const BRAND_TOKENS = JSON.parse(
  readFileSync(
    new URL('../../../../docs/design/US-028/tokens-lienzo-tinta.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

/**
 * `core.config_brand_version` est lisible par app_api pour sa seule version PUBLIÉE. Le test
 * « relations peuplées » comptait sur la version publiée par un AUTRE fichier (l0-brand) : rouge
 * quand la matrice passait avant lui (job « guide d'installation » du run 43038483423, PA). La
 * matrice garantit donc elle-même qu'une version de thème est publiée, par les vraies commandes
 * (`cfg_brand_cmd_save_draft` puis `cfg_brand_cmd_publish`, ADMIN de tous les pays, session élevée
 * du monde de test). La version de thème est commune aux deux pays (aucune colonne de pays) : une
 * seule publication couvre PA et PY.
 *
 * Elle ne publie QUE si aucune version n'est publiée, et décide sous le verrou de la marque
 * (le verrou consultatif que prennent les commandes de publication et de retour arrière) : une
 * publication inconditionnelle s'intercalerait entre deux étapes d'un test de l0-brand qui
 * vérifie QUELLE version est publiée, et rendrait ce fichier-là dépendant de l'ordre. Une fois
 * une version publiée, il en reste toujours exactement une : publier et revenir en arrière
 * archivent l'ancienne et publient la nouvelle dans la même transaction, et aucune commande ne
 * dépublie sans publier. Le contrôle n'est pas affaibli : la table reste exigée peuplée, sans
 * `sans_donnees`, et ce fichier la peuple lui-même quel que soit l'ordre des fichiers.
 */
async function ensurePublishedBrandVersion(client: pg.ClientBase): Promise<void> {
  const admin = hashOf(world.staff.adminAll);
  await withTestTransaction(client, { commit: true }, async (tx) => {
    await tx.query(
      `SELECT pg_catalog.pg_advisory_xact_lock(
                pg_catalog.hashtextextended('core.config_brand_version', 0))`,
    );
    const live = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM test_fixture.brand_versions() WHERE status = 'PUBLISHED'`,
    );
    if (Number(live.rows[0]?.n) > 0) return;
    const draft = await tx.query<{ outcome: string; version_id: string | null }>(
      'SELECT * FROM core.cfg_brand_cmd_save_draft($1, $2, $3, $4, $5, 1, NULL, NULL, NULL, NULL)',
      [admin, uuid(), uuid(), 'Kmino us043', BRAND_TOKENS],
    );
    expect(draft.rows[0]?.outcome).toBe('SAVED');
    const versionId = draft.rows[0]?.version_id ?? '';
    const sha = await tx.query<{ tokens_sha256: string }>(
      'SELECT tokens_sha256 FROM test_fixture.brand_versions() WHERE id = $1',
      [versionId],
    );
    const published = await tx.query<{ outcome: string }>(
      'SELECT * FROM core.cfg_brand_cmd_publish($1, $2, $3, $4)',
      [
        admin,
        uuid(),
        versionId,
        {
          checker: 'test US-043',
          tokensSchemaVersion: 1,
          passed: true,
          failures: [],
          tokensSha256: sha.rows[0]?.tokens_sha256 ?? '',
        },
      ],
    );
    expect(published.rows[0]?.outcome).toBe('PUBLISHED');
  });
  const after = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM test_fixture.brand_versions() WHERE status = 'PUBLISHED'`,
  );
  expect(Number(after.rows[0]?.n)).toBe(1);
}

beforeAll(async () => {
  const api = await connectAs('app_api');
  try {
    world = await buildWorld(api, COUNTRIES);
    await withTestTransaction(api, { commit: true }, async (tx) => {
      for (const x of world.countries) {
        const c = x.c.country;
        const s: CountryStaff = {
          SUPPORT_AGENT: await staff(tx, 'SUPPORT_AGENT', [c]),
          OPS_AGENT: await staff(tx, 'OPS_AGENT', [c]),
          FINANCE: await staff(tx, 'FINANCE', [c]),
          ADMIN: await staff(tx, 'ADMIN', [c]),
          SUPERADMIN: await staff(tx, 'SUPERADMIN', [c]),
        };
        staffOf.push(s);
        // un dossier OUVERT du trip a1 de ce pays, assigné à l'agent SUPPORT puis à l'agent OPS
        for (const agent of [s.SUPPORT_AGENT, s.OPS_AGENT]) {
          await tx.query(
            `SELECT test_fixture.rls_insert_support_case($1, $2, $3, $4, 'OPEN', 'TRIP', NULL)`,
            [uuid(), c, x.trips.a1.id, agent],
          );
        }
        // tables de référence que la graine ne peuple pas encore (férié, entité, capacité UNKNOWN)
        await tx.query('SELECT test_fixture.us043_seed_reference($1)', [c]);
        // clés par sujet (USER : personnes du monde ; ORG : comptes d'hôte), sous-marchands
        for (const org of [x.orgA, x.orgB]) {
          await tx.query(`SELECT test_fixture.us043_seed_subject_key('ORG', $1)`, [org]);
          await tx.query('SELECT test_fixture.us043_seed_submerchant($1)', [org]);
        }
        for (const person of Object.values(s)) {
          await tx.query(`SELECT test_fixture.us043_seed_subject_key('USER', $1)`, [person]);
        }
        // argent : capture et jambes de paiement (TJ01 / TJ08a), avances, bordereau, assureur
        const v = legVector(golden, refOf(x.c.currency).capture);
        const legs = JSON.stringify(
          Object.fromEntries(Object.entries(v.legsMinor).map(([k, a]) => [k, a.toString()])),
        );
        for (const trip of [x.trips.a1.id, x.trips.b1.id]) {
          await tx.query(
            `SELECT test_fixture.pay_insert_operation_raw($1, $2, 'CAPTURE', $3::bigint, $4::jsonb, true)`,
            [uuid(), trip, v.totalMinor.toString(), legs],
          );
        }
        const host = (v.legsMinor['HOST'] ?? 0n).toString();
        const insurerLeg = (v.legsMinor['INSURER'] ?? 0n).toString();
        const b1 = uuid();
        advanceB1.push(b1);
        for (const [id, trip, cause] of [
          [uuid(), x.trips.a1.id, 'RELEASED_LEG'],
          [uuid(), x.trips.a2.id, 'CREDIT_BEYOND_PLATFORM'],
          [b1, x.trips.b1.id, 'RELEASED_LEG'],
        ] as const) {
          await tx.query('SELECT test_fixture.us062_insert_advance($1, $2, $3, $4::bigint)', [
            id,
            trip,
            cause,
            host,
          ]);
        }
        const bordereau = uuid();
        await tx.query('SELECT test_fixture.us062_insert_bordereau($1, $2, $3, $4::bigint)', [
          bordereau,
          c,
          x.c.currency,
          insurerLeg,
        ]);
        await tx.query('SELECT test_fixture.us062_insert_bordereau_line($1, $2, $3::bigint)', [
          bordereau,
          x.trips.a1.id,
          insurerLeg,
        ]);
        await tx.query('SELECT test_fixture.us062_insert_insurer_ledger($1, $2, $3, $4::bigint)', [
          uuid(),
          c,
          x.c.currency,
          insurerLeg,
        ]);
      }
      for (const person of [world.guest1, world.guest2, world.holderA, world.cohost]) {
        await tx.query(`SELECT test_fixture.us043_seed_subject_key('USER', $1)`, [person]);
      }
    });
    // demande FINANCE à deux personnes (première étape seulement), par le FINANCE de chaque pays
    for (const [i, x] of world.countries.entries()) {
      const fin = staffOf[i]?.FINANCE ?? '';
      await withTestTransaction(api, { commit: true }, async (tx) => {
        await setSessionContext(tx, {
          kind: 'STAFF',
          actorId: fin,
          countryScope: [x.c.country],
          sessionTokenHash: staffSessionHash(fin) ?? NO_SESSION,
        });
        const { rows } = await tx.query<{ outcome: string }>(
          'SELECT * FROM core.settlement_cmd_request_finance_action($1, $2, $3, $4, $5)',
          [hashOf(fin), uuid(), 'DECIDE_ADVANCE', advanceB1[i], 'Demande FINANCE motivée (US-043)'],
        );
        expect(rows[0]?.outcome).toBe('REQUESTED');
      });
    }
    await seedPublishedBrandAsset(api);
    await ensurePublishedBrandVersion(api);
  } finally {
    await releaseClient(api);
  }
  // règlements v1 par la vraie commande (travailleur settlement), puis état capturé
  await withRole('app_worker', async (client) => {
    await withTestTransaction(client, { commit: true }, async (tx) => {
      for (const x of world.countries) {
        const rec = recordOfVector(refOf(x.c.currency).vector);
        for (const t of TRIP_KEYS) {
          await recordAsSettlementWorker(tx, { tripId: x.trips[t].id, version: 1 }, rec);
        }
      }
    });
    await withTestTransaction(client, { commit: true }, async (tx) => {
      for (const x of world.countries) {
        const v = legVector(golden, refOf(x.c.currency).capture);
        for (const t of TRIP_KEYS) await captureLegs(tx, x.trips[t].id, v.legsMinor);
      }
    });
  });
}, 240_000);

interface ApiActor {
  readonly name: string;
  readonly ctx: SessionContext | null;
  readonly params: Params;
}

function apiActors(i: number): ApiActor[] {
  const x = world.countries[i];
  const s = staffOf[i];
  if (x === undefined || s === undefined) throw new Error(`pays ${i}`);
  const c = x.c.country;
  const all = world.countries.map((w) => w.c.country);
  const staffCtx = (id: string, scope: readonly string[], hash?: string): SessionContext => ({
    kind: 'STAFF',
    actorId: id,
    countryScope: scope,
    sessionTokenHash: hash ?? staffSessionHash(id) ?? NO_SESSION,
  });
  const base = (acteur: string | null, extra: Params = {}): Params => ({
    acteur,
    org: null,
    vehicules: [],
    pays: c,
    dossiers: [],
    travailleur: null,
    ...extra,
  });
  const a1 = [x.trips.a1.id];
  return [
    { name: 'sans_contexte', ctx: null, params: base(null) },
    { name: 'voyageur', ctx: { kind: 'GUEST', actorId: world.guest1 }, params: base(world.guest1) },
    {
      name: 'hote',
      ctx: { kind: 'HOST', actorId: world.holderA, orgId: x.orgA },
      params: base(world.holderA, { org: x.orgA }),
    },
    {
      name: 'cohote',
      ctx: { kind: 'HOST', actorId: world.cohost, orgId: x.orgA, vehicleScope: [x.v1] },
      params: base(world.cohost, { org: x.orgA, vehicules: [x.v1] }),
    },
    {
      name: 'hote_org_forgee',
      ctx: { kind: 'HOST', actorId: world.holderA, orgId: x.orgB },
      params: base(world.holderA, { org: x.orgB }),
    },
    {
      name: 'SUPPORT_AGENT',
      ctx: staffCtx(s.SUPPORT_AGENT, [c]),
      params: base(s.SUPPORT_AGENT, { dossiers: a1 }),
    },
    {
      name: 'OPS_AGENT',
      ctx: staffCtx(s.OPS_AGENT, [c]),
      params: base(s.OPS_AGENT, { dossiers: a1 }),
    },
    { name: 'FINANCE', ctx: staffCtx(s.FINANCE, [c]), params: base(s.FINANCE) },
    { name: 'ADMIN', ctx: staffCtx(s.ADMIN, [c]), params: base(s.ADMIN) },
    { name: 'ADMIN_portee_elargie', ctx: staffCtx(s.ADMIN, all), params: base(s.ADMIN) },
    { name: 'SUPERADMIN', ctx: staffCtx(s.SUPERADMIN, [c]), params: base(s.SUPERADMIN) },
    { name: 'staff_sans_session', ctx: staffCtx(s.ADMIN, [c], NO_SESSION), params: base(s.ADMIN) },
  ];
}

const apiCell =
  (name: string) =>
  (_rel: string, r: Relation): string =>
    r.lecture?.[name] ?? 'refus';

describe('US-043 — matrice : lectures sous la RLS, acteur par acteur, en PA et en PY', () => {
  it('acteurs de la matrice = acteurs éprouvés', async () => {
    await withRole('app_api', (client) => client.query('SELECT 1'));
    expect(apiActors(0).map((a) => a.name)).toEqual([...MATRIX.acteurs]);
  });

  it.each(COUNTRIES.map((c, i) => ({ ...c, i })))(
    'relations lisibles par app_api peuplées en $country (sinon « aucune » ne prouverait rien)',
    async ({ i }) => {
      const x = world.countries[i];
      if (x === undefined) throw new Error(`pays ${i}`);
      await withRole('app_api', async (client) => {
        const empty: string[] = [];
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        try {
          for (const [rel, r] of RELATIONS) {
            if (r.lecture === undefined || r.sans_donnees !== undefined) continue;
            const byCountry =
              (
                await client.query<{ ok: boolean }>(
                  `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = $1::regclass
                                   AND attname = 'country_code' AND NOT attisdropped) AS ok`,
                  [r.source ?? rel],
                )
              ).rows[0]?.ok === true;
            const e = await expected(client, rel, r, 'true', {}, null, byCountry);
            const n = byCountry ? (e.countries?.[x.c.country] ?? 0) : e.n;
            if (n === 0) empty.push(rel);
          }
        } finally {
          await client.query('ROLLBACK');
        }
        expect(empty).toEqual([]);
      });
    },
  );

  for (const name of MATRIX.acteurs) {
    it.each(COUNTRIES.map((c, i) => ({ ...c, i })))(
      `${name}, $country ($currency)`,
      async ({ i }) => {
        const actor = apiActors(i).find((a) => a.name === name);
        if (actor === undefined) throw new Error(`acteur ${name}`);
        await withRole('app_api', async (client) => {
          assertCells(await evaluate(client, actor.ctx, apiCell(name), actor.params), name);
        });
      },
    );
  }

  it.each(APP_ROLES)(
    'lectures refusées (base de production) : %s, chaque relation sans SELECT ⇒ 42501 (anonyme : toutes)',
    async (role) => {
      await withRole(
        role,
        async (client) => {
          await client.query('BEGIN');
          try {
            const allowed: string[] = [];
            let probes = 0;
            for (const [rel, m] of RELATIONS) {
              if (m.droits[role].SELECT !== undefined) continue;
              probes++;
              const seen = await observe(client, rel, null, false);
              if (seen !== 'refus') allowed.push(rel);
            }
            expect(allowed).toEqual([]);
            expect(probes).toBeGreaterThan(0);
          } finally {
            await client.query('ROLLBACK');
          }
        },
        { database: 'production' },
      );
    },
  );
});

const workerCell =
  (name: string) =>
  (_rel: string, r: Relation): string => {
    if (r.travailleurs === undefined) return 'refus';
    if (name === 'sans_nom') return r.travailleurs['sans_nom'] ?? 'aucune';
    return r.travailleurs[name] ?? r.travailleurs['*'] ?? 'aucune';
  };

describe('US-043 — matrice : lectures des travailleurs (app_worker), par nom, en PA et en PY', () => {
  for (const name of [...MATRIX.travailleurs, INTRUDER, 'sans_nom']) {
    it(`travailleur ${name}`, async () => {
      const ctx: SessionContext | null =
        name === 'sans_nom' ? null : { kind: 'WORKER', workerName: name };
      await withRole('app_worker', async (client) => {
        const results = await evaluate(client, ctx, workerCell(name), {
          travailleur: name === 'sans_nom' ? null : name,
        });
        assertCells(results, `travailleur ${name}`);
        // les deux pays de premier rang sont éprouvés quand la relation porte un pays lisible
        const withCountry = Object.values(results).filter(
          (x) => x.seen !== 'refus' && x.seen.countries !== null,
        );
        for (const x of withCountry) {
          for (const c of COUNTRIES) {
            const want = x.want === 'refus' ? 0 : (x.want.countries?.[c.country] ?? 0);
            expect(x.seen === 'refus' ? -1 : (x.seen.countries?.[c.country] ?? 0)).toBe(want);
          }
        }
      });
    });
  }
});

/** Cellules prouvées : lectures (acteurs app_api × pays, anonyme, travailleurs), écritures par rôle. */
const cellCount = (): number =>
  RELATIONS.length *
  (MATRIX.acteurs.length * COUNTRIES.length +
    1 +
    (MATRIX.travailleurs.length + 2) +
    APP_ROLES.length * WRITES.length);

describe('US-043 — taille de la matrice', () => {
  it('journal : nombre de cellules prouvées', async () => {
    await withRole('app_api', async (client) => {
      await client.query('SELECT 1');
    });
    const n = cellCount();
    process.stdout.write(
      `[US-043 matrice] ${RELATIONS.length} relations, ${MATRIX.acteurs.length} acteurs app_api × ${COUNTRIES.length} pays + anonyme, ${MATRIX.travailleurs.length + 2} travailleurs, ${APP_ROLES.length} rôles × ${WRITES.length} écritures : ${n} cellules (matrice ${createHash('sha256').update(JSON.stringify(MATRIX)).digest('hex').slice(0, 12)})\n`,
    );
    expect(n).toBeGreaterThan(1000);
  });
});
