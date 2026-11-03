/**
 * Règle `rueda/no-country-constants` (US-013 ; ADR-024, ADR-033 ; CLAUDE.md contrainte 3) :
 * aucune devise, aucun fuseau, aucun code pays, aucune locale régionale, aucun groupe fiscal ni
 * type de pièce propre à un pays dans les chaînes du code. Ces valeurs vivent dans les données
 * de configuration pays ; les jetons sont tirés de ces données (`country-constants/tokens.ts`),
 * passés en option par `eslint.config.mjs`. Les commentaires ne sont pas analysés.
 *
 * Option : `{ tokens: string[] }`. Sans jeton, la règle signale une erreur de configuration
 * (fail-closed : une règle muette ne doit pas passer pour un contrôle).
 */
import type { Rule } from 'eslint';
import { findCountryConstants } from '../../country-constants/tokens.ts';

export interface NoCountryConstantsOptions {
  readonly tokens: readonly string[];
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Interdit les constantes propres à un pays (devise, fuseau, code pays, locale régionale, taxe, pièce) dans le code.',
    },
    schema: [
      {
        type: 'object',
        properties: { tokens: { type: 'array', items: { type: 'string' } } },
        required: ['tokens'],
        additionalProperties: false,
      },
    ],
    messages: {
      constant:
        '« {{token}} » est propre à un pays : le lire dans la configuration pays (module CFG), jamais en constante (ADR-024).',
      misconfigured:
        'rueda/no-country-constants : aucun jeton fourni (configuration pays introuvable).',
    },
  },
  create(context) {
    const options = (context.options[0] ?? { tokens: [] }) as NoCountryConstantsOptions;
    const tokens = options.tokens;
    let reportedMisconfiguration = false;

    function check(node: Rule.Node, text: string): void {
      if (tokens.length === 0) {
        if (!reportedMisconfiguration) {
          reportedMisconfiguration = true;
          context.report({ node, messageId: 'misconfigured' });
        }
        return;
      }
      for (const finding of findCountryConstants(text, tokens)) {
        context.report({ node, messageId: 'constant', data: { token: finding.token } });
      }
    }

    const listener: Rule.RuleListener = {
      Literal(node) {
        if (typeof node.value === 'string') check(node as Rule.Node, node.value);
      },
      TemplateElement(node) {
        check(node as unknown as Rule.Node, node.value.cooked ?? node.value.raw);
      },
    };
    // Texte JSX (applications Next.js) : même contrôle que les chaînes (nœud hors estree).
    (listener as Record<string, (node: Rule.Node) => void>)['JSXText'] = (node) => {
      const value = (node as unknown as { value?: unknown }).value;
      if (typeof value === 'string') check(node, value);
    };
    return listener;
  },
};

export default rule;
