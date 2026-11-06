/**
 * Règle `rueda/no-dynamic-sql` (US-049, constat F-RLS-03 de la red team RLS ; 17 §2.3 « Limite de
 * la RLS » et RLS-18 : « requêtes paramétrées seules (aucun SQL dynamique côté application, règle
 * de lint) »). Sous `app_api`, du SQL arbitraire peut forger le contexte `app.*` et appeler les
 * commandes dont un argument choisit l'acteur (`core.iam_cmd_open_session`) : la seule parade au
 * lot 0 est qu'aucune requête du code applicatif ne soit construite à partir de données.
 *
 * Le premier argument d'un appel `<objet>.query(…)` (pg, pool, transaction) doit être un texte
 * FIXE : chaîne littérale, gabarit sans interpolation, gabarit étiqueté (`sql\`…\``, qui
 * paramètre ses valeurs), constante (`const`) DU MODULE (calculée une fois au chargement, à partir
 * du seul code : elle ne peut pas dépendre d'une requête), ou constante locale dont la valeur est
 * elle-même fixe ; un objet `{ text, values }` est jugé sur `text`. Refusés : gabarit interpolé,
 * concaténation `+`, appel de fonction (`format`, `concat`, `join`…), constante LOCALE initialisée
 * ainsi. Une exception motivée se déclare ligne à ligne
 * (`// eslint-disable-next-line rueda/no-dynamic-sql -- <raison>`). Un paramètre de fonction
 * ou une propriété (`SQL.select`) n'est pas suivi : un enrobage `query(text, values)` reste permis
 * et ses appelants passent des constantes (limite écrite dans ADR-089). Formes d'appel couvertes
 * (revues de la PR n° 92) : `c.query(…)`, `c['query'](…)`, `c.query.call(ctx, …)`,
 * `c.query.apply(ctx, [...])`, et les alias `const q = c.query`, `c.query.bind(c)`,
 * `const { query } = c` ; une étiquette de gabarit autre que `sql` qui interpole est refusée.
 */
import type { Rule, Scope } from 'eslint';
import type { Node } from 'estree';

type Verdict = 'static' | 'dynamic' | 'unknown';

/** Dépouille les enrobages TypeScript (`as`, `!`, `satisfies`) et les parenthèses. */
const TS_WRAPPERS: ReadonlySet<string> = new Set([
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
]);

function unwrap(node: Node): Node {
  // nœuds TypeScript absents des types d'ESTree : lus par leur seul `type` et leur `expression`
  let n = node as { type: string; expression?: unknown };
  while (TS_WRAPPERS.has(n.type) && n.expression !== undefined) {
    n = n.expression as { type: string; expression?: unknown };
  }
  return n as Node;
}

/** `sql`, `sql.raw`, `sql<T>()`… : toute étiquette dont la racine s'appelle `sql`. */
function isSqlTag(tag: unknown): boolean {
  const t = tag as { type?: string; name?: string; object?: unknown; callee?: unknown };
  if (t.type === 'Identifier') return t.name === 'sql';
  if (t.type === 'MemberExpression') return isSqlTag(t.object);
  if (t.type === 'CallExpression') return isSqlTag(t.callee);
  return false;
}

/** `x.query`, `x['query']`, `x?.query` (accès calculé par un littéral compris). */
function isQueryMember(node: unknown): boolean {
  const n = node as {
    type?: string;
    computed?: boolean;
    property?: { type?: string; name?: string; value?: unknown };
  };
  if (n.type !== 'MemberExpression' || n.property === undefined) return false;
  if (!n.computed) return n.property.type === 'Identifier' && n.property.name === 'query';
  return n.property.type === 'Literal' && n.property.value === 'query';
}

/** `x.query`, `x.query.bind(…)` : la valeur est la méthode d'exécution elle-même. */
function isQueryValue(node: unknown): boolean {
  const n = unwrap(node as Node) as unknown as {
    type?: string;
    callee?: { type?: string; property?: { name?: string }; object?: unknown };
  };
  if (isQueryMember(n)) return true;
  return (
    n.type === 'CallExpression' &&
    n.callee?.type === 'MemberExpression' &&
    n.callee.property?.name === 'bind' &&
    isQueryMember(n.callee.object)
  );
}

function findVariable(scope: Scope.Scope | null, name: string): Scope.Variable | undefined {
  for (let s = scope; s !== null; s = s.upper) {
    const v = s.set.get(name);
    if (v !== undefined) return v;
  }
  return undefined;
}

function verdict(
  node: Node,
  scope: Scope.Scope,
  seen: ReadonlySet<Scope.Variable> = new Set(),
): Verdict {
  const n = unwrap(node);
  switch (n.type) {
    case 'Literal':
      return 'static';
    case 'TemplateLiteral':
      return n.expressions.length === 0 ? 'static' : 'dynamic';
    case 'TaggedTemplateExpression':
      // seule une étiquette `sql` (Kysely, Drizzle…) paramètre ses valeurs ; toute autre étiquette
      // peut concaténer : dynamique dès qu'elle interpole (revue sécurité US-049, constat 5)
      return n.quasi.expressions.length === 0 || isSqlTag(n.tag) ? 'static' : 'dynamic';
    case 'BinaryExpression':
      return n.operator === '+' ? 'dynamic' : 'unknown';
    case 'CallExpression':
    case 'NewExpression':
      return 'dynamic';
    case 'ConditionalExpression': {
      const a = verdict(n.consequent, scope, seen);
      const b = verdict(n.alternate, scope, seen);
      if (a === 'dynamic' || b === 'dynamic') return 'dynamic';
      return a === 'static' && b === 'static' ? 'static' : 'unknown';
    }
    case 'ObjectExpression': {
      for (const p of n.properties) {
        if (
          p.type === 'Property' &&
          !p.computed &&
          ((p.key.type === 'Identifier' && p.key.name === 'text') ||
            (p.key.type === 'Literal' && p.key.value === 'text'))
        ) {
          return verdict(p.value as Node, scope, seen);
        }
      }
      return 'unknown';
    }
    case 'Identifier': {
      const v = findVariable(scope, n.name);
      if (v === undefined || seen.has(v)) return 'unknown';
      const def = v.defs[0];
      if (def === undefined || def.type !== 'Variable') return 'unknown';
      const decl = def.parent as { kind?: string } | null;
      const init = (def.node as { init?: Node | null }).init;
      if (decl?.kind !== 'const' || init === undefined || init === null) return 'unknown';
      // constante du module : évaluée au chargement, sans donnée d'une requête
      if (v.scope.type === 'module' || v.scope.type === 'global') return 'static';
      return verdict(init, scope, new Set([...seen, v]));
    }
    default:
      return 'unknown';
  }
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Interdit le SQL construit à partir de données dans le code applicatif : requêtes paramétrées seules (17 §2.3, RLS-18).',
    },
    schema: [],
    messages: {
      dynamic:
        'SQL dynamique interdit : passer un texte fixe à query() et les valeurs en paramètres liés ($1, $2…) (17 §2.3 RLS-18, US-049).',
    },
  },
  create(context) {
    /** Alias de la méthode d'exécution : `const q = c.query`, `c.query.bind(c)`, `{ query } = c`. */
    const aliases = new Set<Scope.Variable>();
    const check = (arg: unknown, node: Rule.Node): void => {
      if (arg === undefined || (arg as { type?: string }).type === 'SpreadElement') return;
      if (verdict(arg as Node, context.sourceCode.getScope(node)) === 'dynamic') {
        context.report({ node: arg as Rule.Node, messageId: 'dynamic' });
      }
    };
    const aliasOf = (id: unknown, node: Rule.Node): void => {
      const i = id as { type?: string; name?: string };
      if (i.type !== 'Identifier' || i.name === undefined) return;
      const v = findVariable(context.sourceCode.getScope(node), i.name);
      if (v !== undefined) aliases.add(v);
    };
    return {
      VariableDeclarator(node) {
        if (node.init && isQueryValue(node.init)) aliasOf(node.id, node as Rule.Node);
        if (node.id.type === 'ObjectPattern') {
          for (const p of node.id.properties) {
            if (
              p.type === 'Property' &&
              ((p.key.type === 'Identifier' && p.key.name === 'query') ||
                (p.key.type === 'Literal' && p.key.value === 'query'))
            ) {
              aliasOf(p.value, node as Rule.Node);
            }
          }
        }
      },
      AssignmentExpression(node) {
        if (isQueryValue(node.right)) aliasOf(node.left, node as Rule.Node);
      },
      CallExpression(node) {
        const callee = unwrap(node.callee as Node) as unknown as {
          type?: string;
          name?: string;
          object?: unknown;
          property?: { type?: string; name?: string };
          computed?: boolean;
        };
        // c.query(texte, …) ; c['query'](texte, …)
        if (isQueryMember(callee)) {
          check(node.arguments[0], node as Rule.Node);
          return;
        }
        // c.query.call(ctx, texte, …) ; c.query.apply(ctx, [texte, …])
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          (callee.property?.name === 'call' || callee.property?.name === 'apply') &&
          isQueryMember(callee.object)
        ) {
          const second = node.arguments[1] as unknown as { type?: string; elements?: unknown[] };
          check(
            callee.property.name === 'apply' && second?.type === 'ArrayExpression'
              ? second.elements?.[0]
              : second,
            node as Rule.Node,
          );
          return;
        }
        // q(texte, …) pour un alias de la méthode
        if (callee.type === 'Identifier' && callee.name !== undefined) {
          const v = findVariable(context.sourceCode.getScope(node), callee.name);
          if (v !== undefined && aliases.has(v)) check(node.arguments[0], node as Rule.Node);
        }
      },
    };
  },
};

export default rule;
