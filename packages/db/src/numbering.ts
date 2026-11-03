/**
 * Règle de numérotation des migrations (revue architecture US-008, constat 3 ;
 * packages/db/migrations/README.md, CONTRIBUTING §9).
 *
 * L'exécuteur (`planMigrations`) refuse une migration plus ancienne que la dernière appliquée, et
 * la somme SHA-256 interdit de renuméroter une migration appliquée. D'où la règle :
 * 1. production (`migrations/`) : numéros uniques, **contigus** depuis 0000, tous < 9000 ;
 * 2. test (`test-migrations/`) : numéros uniques, ≥ 9000 ;
 * 3. une migration absente de la branche de base (`origin/main`) a un numéro **strictement
 *    supérieur** au plus grand numéro de production de la base : sinon, renuméroter en mettant à
 *    jour la branche (gratuit tant que rien n'est appliqué ailleurs). Pas de plage réservée.
 */

export const TEST_MIGRATION_FLOOR = 9000;

export interface NumberingInput {
  /** Migrations de production de la branche, `NNNN_nom`. */
  readonly production: readonly string[];
  /** Migrations de test, `NNNN_nom`. */
  readonly test: readonly string[];
  /** Migrations de production de la branche de base (`NNNN_nom`), si elles sont connues. */
  readonly base?: readonly string[];
}

const versionOf = (id: string): string => id.slice(0, 4);

/** Renvoie la liste des manquements (vide si la règle est respectée). */

export function checkMigrationNumbering(raw: NumberingInput): string[] {
  const input = {
    production: raw.production.map(versionOf),
    test: raw.test.map(versionOf),
  };
  const errors: string[] = [];
  const dup = (list: readonly string[], label: string): void => {
    const seen = new Set<string>();
    for (const v of list) {
      if (seen.has(v)) errors.push(`${label} : numéro ${v} en double`);
      seen.add(v);
    }
  };
  dup(input.production, 'production');
  dup(input.test, 'test');
  for (const v of input.test) {
    if (input.production.includes(v)) errors.push(`numéro ${v} à la fois en production et en test`);
    if (Number(v) < TEST_MIGRATION_FLOOR) errors.push(`test : ${v} < ${TEST_MIGRATION_FLOOR}`);
  }
  const prod = [...new Set(input.production)].map(Number).sort((a, b) => a - b);
  prod.forEach((n, i) => {
    if (n >= TEST_MIGRATION_FLOOR) {
      errors.push(`production : ${String(n).padStart(4, '0')} ≥ ${TEST_MIGRATION_FLOOR}`);
    } else if (n !== i) {
      errors.push(
        `production : numéros non contigus (attendu ${String(i).padStart(4, '0')}, trouvé ` +
          `${String(n).padStart(4, '0')}) ; renuméroter à la suite de origin/main`,
      );
    }
  });
  if (raw.base !== undefined && raw.base.length > 0) {
    const baseSet = new Set(raw.base);
    const baseMax = Math.max(...raw.base.map((id) => Number(versionOf(id))));
    for (const id of raw.production) {
      if (!baseSet.has(id) && Number(versionOf(id)) <= baseMax) {
        errors.push(
          `migration ${id} absente de la base mais ≤ ${String(baseMax).padStart(4, '0')} ` +
            '(dernière de origin/main) : mettre à jour la branche et renuméroter',
        );
      }
    }
  }
  return [...new Set(errors)];
}
