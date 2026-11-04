/**
 * Routes déclarées par les contrôleurs Nest (lecture statique des décorateurs) — TESTS SEULEMENT.
 * Partagé par le contrat OpenAPI (US-041) et la matrice d'autorisations des routes (US-043) : une
 * route ajoutée à un contrôleur sans entrée dans l'un ou l'autre fait échouer la CI.
 * Format : `MÉTHODE /chemin/{param}`, trié.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULES = fileURLToPath(new URL('../modules/', import.meta.url));

export function controllerRoutes(): string[] {
  const files = readdirSync(MODULES, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.controller.ts'))
    .map((f) => join(MODULES, f));
  const routes: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const prefix = /@Controller\('([^']*)'\)/.exec(source)?.[1];
    if (prefix === undefined) throw new Error(`${file} : @Controller sans préfixe littéral`);
    for (const m of source.matchAll(/@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/g)) {
      const sub = (m[2] ?? '').replace(/:([A-Za-z]+)/g, '{$1}');
      routes.push(`${(m[1] as string).toUpperCase()} /${[prefix, sub].filter(Boolean).join('/')}`);
    }
  }
  return routes.sort();
}
