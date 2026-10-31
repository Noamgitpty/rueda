/**
 * Règle `rueda/no-sql-clock` (17 §1.3, ADR-030 ; US-001) : version TypeScript du contrôle
 * des fichiers `.sql` (`packages/config/sql-clock/cli.ts`). Elle analyse le SQL écrit dans le
 * code : gabarits étiquetés `sql` (Kysely, Drizzle…) et chaînes qui ressemblent à du SQL.
 * Aucune liste blanche ici : `platform.now()` n'est défini que dans une migration SQL.
 */
import type { Rule } from 'eslint';
import type { TemplateLiteral } from 'estree';
import { looksLikeSql, scanSql } from '../../sql-clock/scan.ts';

function templateText(node: TemplateLiteral): string {
  // Chaque expression interpolée devient un paramètre neutre.
  return node.quasis.map((q) => q.value.cooked ?? q.value.raw).join(' $1 ');
}

/** `sql`, `sql.raw`, `sql<T>()`… : toute étiquette dont la racine s'appelle `sql`. */
function isSqlTag(tag: unknown): boolean {
  const t = tag as { type?: string; name?: string; object?: unknown; callee?: unknown };
  if (t.type === 'Identifier') return t.name === 'sql';
  if (t.type === 'MemberExpression') return isSqlTag(t.object);
  if (t.type === 'CallExpression') return isSqlTag(t.callee);
  return false;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Interdit now(), current_timestamp et les autres horloges dans le SQL métier écrit en TypeScript.',
    },
    schema: [],
    messages: {
      clock: '{{message}}',
    },
  },
  create(context) {
    function report(node: Rule.Node, text: string): void {
      for (const finding of scanSql(text)) {
        context.report({ node, messageId: 'clock', data: { message: finding.message } });
      }
    }
    return {
      TemplateLiteral(node) {
        const parent = (node as Rule.Node).parent;
        const tagged = parent?.type === 'TaggedTemplateExpression' && isSqlTag(parent.tag);
        const text = templateText(node);
        if (tagged || looksLikeSql(text)) report(node as Rule.Node, text);
      },
      Literal(node) {
        if (typeof node.value === 'string' && looksLikeSql(node.value)) {
          report(node as Rule.Node, node.value);
        }
      },
    };
  },
};

export default rule;
