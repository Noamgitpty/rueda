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
 * et ses appelants passent des constantes (limite écrite dans ADR-088).
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
      return 'static';
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
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.property.type !== 'Identifier' || callee.property.name !== 'query') return;
        const first = node.arguments[0];
        if (first === undefined || first.type === 'SpreadElement') return;
        const scope = context.sourceCode.getScope(node);
        if (verdict(first as Node, scope) === 'dynamic') {
          context.report({ node: first as Rule.Node, messageId: 'dynamic' });
        }
      },
    };
  },
};

export default rule;
