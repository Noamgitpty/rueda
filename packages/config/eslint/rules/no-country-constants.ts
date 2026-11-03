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

// Couverture (revues US-013) : littéraux chaîne, gabarits, texte JSX, motifs d'expression
// régulière, clés de propriété nues (`{ PYG: 0 }`, champs de classe, méthodes), membres d'`enum`,
// sans tenir compte de la casse. Limite : les nombres (`0.07`, `700`) ne sont pas détectables
// sans faux positifs ; un taux codé en dur ne se voit qu'en revue (ADR-049). Les commentaires
// `eslint-disable` qui couperaient la règle sont refusés par `country-constants/cli.ts`.

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

    type Keyed = { key?: { type?: string; name?: string }; computed?: boolean };
    const checkKey = (node: Rule.Node): void => {
      const { key, computed } = node as unknown as Keyed;
      if (!computed && key?.type === 'Identifier' && typeof key.name === 'string') {
        check(node, key.name);
      }
    };
    const listener: Rule.RuleListener = {
      Literal(node) {
        if (typeof node.value === 'string') check(node as Rule.Node, node.value);
        const regex = (node as { regex?: { pattern?: string } }).regex;
        if (regex?.pattern !== undefined) check(node as Rule.Node, regex.pattern);
      },
      TemplateElement(node) {
        check(node as unknown as Rule.Node, node.value.cooked ?? node.value.raw);
      },
      Property(node) {
        checkKey(node as Rule.Node);
      },
      MethodDefinition(node) {
        checkKey(node as Rule.Node);
      },
    };
    const extra = listener as Record<string, (node: Rule.Node) => void>;
    // Nœuds hors estree : texte JSX, champs de classe, membres d'enum TypeScript.
    extra['JSXText'] = (node) => {
      const value = (node as unknown as { value?: unknown }).value;
      if (typeof value === 'string') check(node, value);
    };
    extra['PropertyDefinition'] = checkKey;
    extra['TSPropertySignature'] = checkKey;
    extra['TSEnumMember'] = (node) => {
      const id = (node as unknown as { id?: { type?: string; name?: string } }).id;
      if (id?.type === 'Identifier' && typeof id.name === 'string') check(node, id.name);
    };
    return listener;
  },
};

export default rule;
