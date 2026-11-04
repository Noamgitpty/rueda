/**
 * Export des données d'une personne en libre-service (US-046 ; 08 BR-ACC-09 « téléchargement des
 * données en libre-service » ; 17 §3.1.4 C2 « export sur demande »).
 *
 * L'export s'exécute dans la transaction de la personne, sous `app_api` avec SON contexte de
 * session (posé par la couche d'accès) : la RLS fait foi. Il couvre chaque table de l'inventaire
 * marquée `export: self` (cohérence avec la matrice d'US-043 vérifiée par
 * `checkMatrixCoherence`) et, dans chacune, les colonnes que la matrice accorde à `app_api`, sauf
 * les secrets (C4). Les données que la personne ne peut pas lire elle-même (journal d'audit,
 * sessions, notifications…) relèvent de l'export par le responsable des données (`controller`,
 * US-536).
 */
import type pg from 'pg';
import { classOf, grantedColumns } from './inventory.ts';
import type { AuthorizationMatrix, PersonalDataInventory } from './inventory.ts';

export type PersonalExport = Record<string, Array<Record<string, unknown>>>;

const IDENT = /^[a-z_][a-z0-9_]*$/;
const quote = (ident: string): string => {
  if (!IDENT.test(ident)) throw new Error(`identifiant inattendu : ${ident}`);
  return `"${ident}"`;
};

/** Colonnes exportées d'une table : lisibles par app_api d'après la matrice, hors C4. */
export function exportColumns(
  inventory: PersonalDataInventory,
  matrix: AuthorizationMatrix,
  table: string,
): string[] {
  const entry = inventory.tables[table];
  if (!entry || entry.export !== 'self') return [];
  return grantedColumns(matrix, inventory, table, 'app_api')
    .filter((c) => {
      const e = entry.columns[c];
      return e !== undefined && classOf(e) !== 'C4';
    })
    .sort();
}

/**
 * Exporte, dans la transaction `tx` (contexte de session déjà posé), toutes les lignes que la
 * personne peut lire d'elle-même. Les identifiants viennent de l'inventaire (liste fermée), jamais
 * de l'appelant.
 */
export async function exportOwnPersonalData(
  tx: pg.ClientBase,
  inventory: PersonalDataInventory,
  matrix: AuthorizationMatrix,
): Promise<PersonalExport> {
  const out: PersonalExport = {};
  for (const table of Object.keys(inventory.tables).sort()) {
    const cols = exportColumns(inventory, matrix, table);
    if (cols.length === 0) continue;
    const [schema, name] = table.split('.') as [string, string];
    const { rows } = await tx.query<Record<string, unknown>>(
      `SELECT ${cols.map(quote).join(', ')} FROM ${quote(schema)}.${quote(name)} ORDER BY 1`,
    );
    out[table] = rows;
  }
  return out;
}
