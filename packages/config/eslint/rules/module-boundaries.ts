/**
 * Règle `rueda/module-boundaries` (17 §2.1, §2.2, §6.1 ; US-001).
 *
 * 1. Un fichier ne peut importer un autre module que par son point d'entrée public
 *    (`modules/<x>/index.ts`) ; tout import de `modules/<x>/internal/…`, `<x>.module.ts`, etc.
 *    depuis l'extérieur du module est une erreur (`internalImport`).
 * 2. Un module ne peut importer que les modules autorisés par le graphe de dépendances
 *    (`apps/api/src/modules/dependency-graph.ts`), passé en option par la configuration
 *    racine (`forbiddenDependency`).
 * 3. Un répertoire de module absent du graphe est une erreur (`unknownModule`).
 *
 * Formes analysées : `import`, `export … from`, `import()` et `require()` / `require.resolve()`
 * / alias de `createRequire` avec un littéral ou un gabarit sans expression.
 * Limites connues (passation US-001) : spécificateur calculé (`import(variable)`, gabarit avec
 * expression), alias de chemin ou paquet nu (aucun dans le dépôt), `createRequire` réaffecté.
 * Seuls les imports relatifs sont analysés.
 */
import { dirname, posix } from 'node:path';
import type { Rule } from 'eslint';

export interface ModuleBoundariesModule {
  /** Code du module dans 17 §2.2 (ex. `AVL`). */
  readonly code: string;
  /** Répertoires des modules que ce module a le droit d'importer. */
  readonly allowed: readonly string[];
}

export interface ModuleBoundariesOptions {
  /** Segment de chemin du dossier des modules, ex. `apps/api/src/modules`. */
  readonly modulesPath: string;
  /** Modules connus, indexés par nom de répertoire (`avl`, `prc`…). */
  readonly modules: Readonly<Record<string, ModuleBoundariesModule>>;
}

interface ModuleLocation {
  /** Répertoire du module, ou `null` pour un fichier posé à la racine du dossier des modules. */
  readonly dir: string | null;
  /** Reste du chemin dans le module, sans extension (`index`, `internal/quote`…). */
  readonly rest: string;
}

const PUBLIC_ENTRY = new Set(['', 'index']);

/** Valeur d'un littéral chaîne ou d'un gabarit sans expression (`\`…\``), sinon `undefined`. */
function staticSpecifier(node: unknown): string | undefined {
  const n = node as {
    type?: string;
    value?: unknown;
    expressions?: unknown[];
    quasis?: Array<{ value: { cooked?: string | null; raw: string } }>;
  };
  if (n?.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n?.type === 'TemplateLiteral' && n.expressions?.length === 0) {
    const quasi = n.quasis?.[0];
    return quasi ? (quasi.value.cooked ?? quasi.value.raw) : undefined;
  }
  return undefined;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function stripExtension(p: string): string {
  return p.replace(/\.(d\.)?(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, '').replace(/\/$/, '');
}

function locate(absPath: string, modulesPath: string): ModuleLocation | undefined {
  const marker = `/${modulesPath.replace(/^\/+|\/+$/g, '')}/`;
  const index = absPath.lastIndexOf(marker);
  if (index === -1) return undefined;
  const inside = absPath.slice(index + marker.length);
  const slash = inside.indexOf('/');
  if (slash === -1) return { dir: null, rest: stripExtension(inside) };
  return { dir: inside.slice(0, slash), rest: stripExtension(inside.slice(slash + 1)) };
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Interdit d'importer l'intérieur d'un autre module et toute dépendance absente du graphe de 17 §2.2.",
    },
    schema: [
      {
        type: 'object',
        properties: {
          modulesPath: { type: 'string' },
          modules: { type: 'object' },
        },
        required: ['modulesPath', 'modules'],
        additionalProperties: false,
      },
    ],
    messages: {
      internalImport:
        "Import interdit de l'intérieur du module {{target}} ({{specifier}}) : passer par son point d'entrée public `modules/{{targetDir}}/index.ts`.",
      forbiddenDependency:
        'Dépendance interdite : {{source}} ne peut pas dépendre de {{target}} (absent du graphe de 17 §2.2, voir dependency-graph.ts). Dépendances autorisées : {{allowed}}.',
      unknownModule:
        'Module inconnu « {{dir}} » : tout module doit être déclaré dans apps/api/src/modules/dependency-graph.ts.',
    },
  },
  create(context) {
    const options = context.options[0] as ModuleBoundariesOptions | undefined;
    if (!options) return {};
    const filename = toPosix(context.filename);
    const source = locate(filename, options.modulesPath);
    const sourceModule = source?.dir ? options.modules[source.dir] : undefined;

    const requireAliases = new Set<string>(['require']);

    function check(node: Rule.Node, specifier: unknown): void {
      if (typeof specifier !== 'string' || !specifier.startsWith('.')) return;
      const target = locate(
        posix.normalize(posix.join(toPosix(dirname(filename)), specifier)),
        options!.modulesPath,
      );
      if (!target || target.dir === null) return;
      if (source?.dir === target.dir) return;

      const targetModule = options!.modules[target.dir];
      if (!targetModule) {
        context.report({ node, messageId: 'unknownModule', data: { dir: target.dir } });
        return;
      }
      if (!PUBLIC_ENTRY.has(target.rest)) {
        context.report({
          node,
          messageId: 'internalImport',
          data: { target: targetModule.code, targetDir: target.dir, specifier },
        });
        return;
      }
      if (sourceModule && !sourceModule.allowed.includes(target.dir)) {
        context.report({
          node,
          messageId: 'forbiddenDependency',
          data: {
            source: sourceModule.code,
            target: targetModule.code,
            allowed:
              sourceModule.allowed.map((d) => options!.modules[d]?.code ?? d).join(', ') ||
              'aucune',
          },
        });
      }
    }

    return {
      Program(node) {
        if (source?.dir && !sourceModule) {
          context.report({ node, messageId: 'unknownModule', data: { dir: source.dir } });
        }
      },
      ImportDeclaration(node) {
        check(node as Rule.Node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node as Rule.Node, node.source.value);
      },
      ExportAllDeclaration(node) {
        check(node as Rule.Node, node.source.value);
      },
      ImportExpression(node) {
        check(node as Rule.Node, staticSpecifier(node.source));
      },
      VariableDeclarator(node) {
        // `const req = createRequire(import.meta.url)` : `req(…)` est traité comme `require(…)`.
        if (
          node.id.type === 'Identifier' &&
          node.init?.type === 'CallExpression' &&
          node.init.callee.type === 'Identifier' &&
          node.init.callee.name === 'createRequire'
        ) {
          requireAliases.add(node.id.name);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        const isRequire =
          // require('…'), req('…') (alias de createRequire)
          (callee.type === 'Identifier' && requireAliases.has(callee.name)) ||
          // require.resolve('…')
          (callee.type === 'MemberExpression' &&
            callee.object.type === 'Identifier' &&
            requireAliases.has(callee.object.name)) ||
          // createRequire(import.meta.url)('…')
          (callee.type === 'CallExpression' &&
            callee.callee.type === 'Identifier' &&
            callee.callee.name === 'createRequire');
        if (isRequire) check(node as Rule.Node, staticSpecifier(node.arguments[0]));
      },
    };
  },
};

export default rule;
