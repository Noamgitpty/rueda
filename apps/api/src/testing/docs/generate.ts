/**
 * Documentation GÉNÉRÉE depuis le code (US-038, ADR-079) — TESTS SEULEMENT (exclu du build).
 *
 * - `docs/architecture/modules.md` : modules du graphe (`dependency-graph.ts`), schéma cible
 *   (`@rueda/db/schemas`), dépendances AUTORISÉES et dépendances RÉELLEMENT importées (lecture des
 *   sources), routes HTTP par module, état (coquille ou construit) ; diagramme mermaid du graphe.
 * - `docs/architecture/api.md` : référence lisible du contrat `apps/api/openapi/openapi.json`
 *   (opérations, statuts, codes d'erreur stables, réponses transverses).
 *
 * `docs-sync.test.ts` compare le texte généré au fichier commité : un écart fait échouer
 * `pnpm test:unit` (donc la CI). Régénérer : `RUEDA_DOCS_WRITE=1 pnpm --filter @rueda/api exec
 * vitest run src/testing/docs`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULE_SCHEMAS } from '@rueda/db/schemas';
import {
  allowedDependencies,
  MODULE_CODES,
  MODULES,
  moduleDir,
  SOCLE_MODULES,
} from '../../modules/dependency-graph.js';
import type { ModuleCode } from '../../modules/dependency-graph.js';
import { HTTP_METHODS } from '../openapi-contract.js';
import type { OpenApiDocument } from '../openapi-contract.js';

export const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const MODULES_DIR = fileURLToPath(new URL('../../modules/', import.meta.url));

const GENERATED = (source: string, command: string): string =>
  `<!-- Fichier GÉNÉRÉ depuis ${source} (US-038, ADR-079) : ne pas modifier à la main. -->\n` +
  `<!-- Régénérer : ${command} ; la CI échoue si ce fichier n'est plus à jour. -->\n`;

const DOCS_COMMAND = 'RUEDA_DOCS_WRITE=1 pnpm --filter @rueda/api exec vitest run src/testing/docs';

const cell = (text: string): string => text.replaceAll('|', '\\|').replaceAll('\n', ' ');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.split(sep).join('/'))
    .sort();
}

const isTest = (f: string): boolean =>
  /\.test\.ts$|\.test-support\.ts$/.test(f) || /(^|\/)testing\//.test(f);

/** Modules réellement importés par les fichiers de production d'un module. */
export function importedModules(code: ModuleCode): ModuleCode[] {
  const dir = join(MODULES_DIR, moduleDir(code));
  const used = new Set<ModuleCode>();
  for (const file of sourceFiles(dir).filter((f) => !isTest(f))) {
    const abs = join(dir, file);
    const text = readFileSync(abs, 'utf8');
    for (const m of text.matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']+)'/g)) {
      const target = relative(MODULES_DIR, join(abs, '..', m[1] as string))
        .split(sep)
        .join('/');
      const first = target.split('/')[0] ?? '';
      const other = MODULE_CODES.find((c) => moduleDir(c) === first);
      if (other !== undefined && other !== code) used.add(other);
    }
  }
  return MODULE_CODES.filter((c) => used.has(c));
}

/** Routes HTTP des contrôleurs d'un module (décorateurs littéraux), triées. */
export function moduleRoutes(code: ModuleCode): string[] {
  const dir = join(MODULES_DIR, moduleDir(code));
  const routes: string[] = [];
  for (const file of sourceFiles(dir).filter((f) => f.endsWith('.controller.ts'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    const prefix = /@Controller\('([^']*)'\)/.exec(text)?.[1] ?? '';
    for (const m of text.matchAll(/@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/g)) {
      const sub = (m[2] ?? '').replace(/:([A-Za-z]+)/g, '{$1}');
      routes.push(`${(m[1] as string).toUpperCase()} /${[prefix, sub].filter(Boolean).join('/')}`);
    }
  }
  return routes.sort();
}

/** Applications et paquets du monorepo, avec leurs dépendances internes (`workspace:*`). */
function packagesSection(): string[] {
  const rows: string[] = [];
  const edges: string[] = [];
  for (const group of ['apps', 'packages']) {
    const dir = join(REPO_ROOT, group);
    for (const name of readdirSync(dir).sort()) {
      let pkg: { name: string; description?: string; dependencies?: Json; devDependencies?: Json };
      try {
        pkg = JSON.parse(readFileSync(join(dir, name, 'package.json'), 'utf8')) as typeof pkg;
      } catch {
        continue;
      }
      const internal = (deps: Json | undefined): string[] =>
        Object.keys(deps ?? {})
          .filter((d) => d.startsWith('@rueda/'))
          .sort();
      const prod = internal(pkg.dependencies);
      const dev = internal(pkg.devDependencies);
      const node = (n: string) => n.replace('@rueda/', '').replaceAll('-', '_');
      for (const d of prod) edges.push(`  ${node(pkg.name)} --> ${node(d)}`);
      for (const d of dev) edges.push(`  ${node(pkg.name)} -.-> ${node(d)}`);
      rows.push(
        `| \`${pkg.name}\` | \`${group}/${name}\` | ${cell(pkg.description ?? '')} | ${prod.join(', ') || '—'} | ${dev.join(', ') || '—'} |`,
      );
    }
  }
  return [
    '## Applications et paquets',
    '',
    'Trait plein : dépendance de production ; pointillé : dépendance de développement (tests, outillage).',
    '',
    '```mermaid',
    'flowchart LR',
    ...edges,
    '```',
    '',
    '| Paquet | Répertoire | Description | Dépendances internes | Dépendances internes de développement |',
    '| ------ | ---------- | ----------- | -------------------- | ------------------------------------- |',
    ...rows,
    '',
  ];
}

export function modulesDocument(): string {
  const lines: string[] = [
    GENERATED(
      'apps/api/src/modules (dependency-graph.ts, sources) et packages/db/schemas.ts',
      DOCS_COMMAND,
    ),
    '# Modules et dépendances',
    '',
    'Monolithe modulaire NestJS (17 §2.1, §2.2) : un répertoire par module sous `apps/api/src/modules/`, importé seulement par son `index.ts` (règle de lint `rueda/module-boundaries`). Les dépendances **autorisées** viennent du graphe `dependency-graph.ts` (17 §2.2 ; socle implicite CFG, AUD, BUS) ; les dépendances **réelles** sont relues dans les imports des fichiers de production. Une dépendance réelle hors du graphe fait échouer le lint ; ce document les montre côte à côte.',
    '',
    '## Graphe des dépendances explicites',
    '',
    'Flèche = « dépend de » (17 §2.2). Les dépendances implicites de chaque module vers le socle (CFG, AUD, BUS) sont omises pour la lisibilité.',
    '',
    '```mermaid',
    'flowchart LR',
  ];
  for (const code of MODULE_CODES) {
    const shape = SOCLE_MODULES.includes(code) ? `${code}[(${code})]` : `${code}[${code}]`;
    lines.push(`  ${shape}`);
  }
  for (const code of MODULE_CODES) {
    for (const dep of MODULES[code].dependsOn) {
      if (SOCLE_MODULES.includes(dep) && !SOCLE_MODULES.includes(code)) continue;
      lines.push(`  ${code} --> ${dep}`);
    }
  }
  lines.push('```', '', '## Modules', '');
  lines.push(
    '| Code | Nom (17 §2.2) | Schéma cible | Responsabilité | Dépendances autorisées | Dépendances réelles (imports) | Routes HTTP | État |',
    '| ---- | ------------- | ------------ | -------------- | ---------------------- | ----------------------------- | ----------- | ---- |',
  );
  for (const code of MODULE_CODES) {
    const spec = MODULES[code];
    const schema = MODULE_SCHEMAS[code];
    const extra = sourceFiles(join(MODULES_DIR, moduleDir(code)))
      .filter((f) => !isTest(f))
      .filter((f) => f !== 'index.ts' && f !== `${moduleDir(code)}.module.ts`);
    const state =
      extra.length === 0
        ? 'coquille'
        : extra.every((f) => f.endsWith('.port.ts'))
          ? 'ports seulement'
          : 'construit';
    const routes = moduleRoutes(code);
    const used = importedModules(code);
    lines.push(
      `| ${code} | ${cell(spec.name)} | \`${schema.schema}\` (${schema.origin}) | ${cell(spec.responsibility)} | ${allowedDependencies(code).join(', ') || '—'} | ${used.join(', ') || '—'} | ${routes.length === 0 ? '—' : routes.map((r) => `\`${r}\``).join('<br>')} | ${state} |`,
    );
  }
  lines.push(
    '',
    ...packagesSection(),
    '## Lecture',
    '',
    '- **Schéma cible** : `17` = nommé par 17 ; `PROPOSÉ` = choisi par US-001 (`packages/db/schemas.ts`). En bêta, toutes les tables sont dans le schéma unique `core`, préfixées par le schéma cible (`core.booking_trip` → `booking.trip`) : voir [`schema.md`](schema.md).',
    '- **État** : `coquille` = seulement `index.ts` et `<code>.module.ts`, réservés par US-001 ; `ports seulement` = des ports d’intégration (`*.port.ts`) sans logique ; `construit` = du code de production.',
    '',
  );
  return lines.join('\n');
}

type Json = Record<string, unknown>;

function resolveResponse(doc: OpenApiDocument, r: unknown): Json {
  const ref = (r as { $ref?: string }).$ref;
  if (ref === undefined) return r as Json;
  return (doc.components?.responses?.[ref.split('/').pop() as string] ?? {}) as Json;
}

function codesOf(response: Json): string[] {
  const content = (response['content'] ?? {}) as Record<string, { schema?: Json }>;
  return Object.values(content).flatMap((media) => {
    const props = (media.schema?.['properties'] ?? {}) as Record<string, Json>;
    const code = props['code'];
    if (code === undefined) return [];
    if (typeof code['const'] === 'string') return [code['const']];
    return Array.isArray(code['enum']) ? (code['enum'] as string[]) : [];
  });
}

function statusCell(doc: OpenApiDocument, status: string, r: unknown): string {
  const response = resolveResponse(doc, r);
  const codes = codesOf(response);
  const media = Object.keys((response['content'] ?? {}) as Json);
  const kind =
    codes.length > 0 ? codes.join(' / ') : media.length === 0 ? 'sans corps' : media.join(', ');
  return `**${status}** ${kind}`;
}

export function apiReferenceDocument(doc: OpenApiDocument): string {
  const info = (doc as unknown as { info: { version: string; summary?: string } }).info;
  const lines: string[] = [
    GENERATED('apps/api/openapi/openapi.json', DOCS_COMMAND),
    '# Référence de l’API HTTP',
    '',
    `Contrat OpenAPI ${doc.openapi}, version ${info.version} : [\`apps/api/openapi/openapi.json\`](../../apps/api/openapi/openapi.json) (fait foi). ${info.summary ?? ''}`,
    '',
    'Chaque statut ci-dessous est exercé par un test de contrat sur l’application réelle (`ContractClient`) ; les codes d’erreur sont ceux des catalogues du code (16 A.8). Corps d’erreur : `{ code, messageKey, values? }` (le client affiche le texte dans sa langue).',
    '',
  ];
  const groups = new Map<string, string[]>();
  for (const [template, item] of Object.entries(doc.paths).sort(([a], [b]) => a.localeCompare(b))) {
    const prefix = `/${template.split('/')[1] ?? ''}`;
    for (const method of HTTP_METHODS) {
      const op = item[method] as (Json & { responses?: Record<string, unknown> }) | undefined;
      if (op === undefined) continue;
      const statuses = Object.entries(op.responses ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([s, r]) => statusCell(doc, s, r))
        .join('<br>');
      const row = `| \`${method.toUpperCase()}\` | \`${template}\` | \`${String(op['operationId'])}\` | ${cell(String(op['summary'] ?? ''))} | ${statuses} |`;
      groups.set(prefix, [...(groups.get(prefix) ?? []), row]);
    }
  }
  for (const [prefix, rows] of groups) {
    lines.push(
      `## \`${prefix}\``,
      '',
      '| Méthode | Chemin | operationId | Résumé | Statuts et codes |',
      '| ------- | ------ | ----------- | ------ | ---------------- |',
      ...rows,
      '',
    );
  }
  lines.push(
    '## Réponses transverses',
    '',
    'Valables pour toute opération (`x-rueda-transverse-responses`) : produites par la garde anti-abus globale ou le durcissement HTTP.',
    '',
    '| Statut | Code | Description |',
    '| ------ | ---- | ----------- |',
  );
  for (const [status, r] of Object.entries(doc['x-rueda-transverse-responses'] ?? {})) {
    const response = resolveResponse(doc, r);
    lines.push(
      `| ${status} | ${codesOf(response).join(' / ') || '—'} | ${cell(String(response['description'] ?? ''))} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
