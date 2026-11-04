// @ts-check
/**
 * Ignoreur Stryker « messages-diagnostic » (US-042, ADR-076 point 9) : les textes qui ne servent
 * qu'au message d'une erreur ne sont pas mutés. Le contrat d'une erreur est son **code** stable
 * (16 A.8, README) : il reste muté et testé. Un mutant qui vide un message ne change aucun montant
 * ni aucun refus ; le compter rendrait le score dépendant de tests de libellés.
 *
 * Ignorés, et seulement eux :
 * - le 2e argument de `new MoneyError(code, message)` et de `new SettlementError(code, message)` ;
 * - les arguments « libellé » des aides locales qui ne font que construire un message :
 *   `invalid(message)`, `requireInstant(nom, valeur)`, `requireNonNegativeInteger(nom, valeur)`,
 *   `requireFlag(nom, valeur, pourquoi)`, `positive(valeur, nom)`, `insurerPart(montant, part, nom)`.
 */
const ERROR_CLASSES = new Set(['MoneyError', 'SettlementError']);
/** Aide locale → positions des arguments qui ne servent qu'au message. */
const LABEL_ARGUMENTS = new Map([
  ['invalid', [0]],
  ['requireInstant', [0]],
  ['requireNonNegativeInteger', [0]],
  ['requireFlag', [0, 2]],
  ['positive', [1]],
  ['insurerPart', [2]],
]);
const REASON = 'texte de message d’erreur : non contractuel, le code l’est (ADR-076)';

/** @param {any} path chemin Babel du nœud visité */
function shouldIgnore(path) {
  const parent = path.parentPath;
  if (parent === null || parent === undefined || path.listKey !== 'arguments') return undefined;
  const callee = parent.node.callee;
  if (callee === undefined || callee.type !== 'Identifier') return undefined;
  if (parent.node.type === 'NewExpression' && ERROR_CLASSES.has(callee.name)) {
    return path.key === 1 ? REASON : undefined;
  }
  if (parent.node.type === 'CallExpression') {
    const positions = LABEL_ARGUMENTS.get(callee.name);
    if (positions !== undefined && positions.includes(Number(path.key))) return REASON;
  }
  return undefined;
}

export const strykerPlugins = [
  { kind: 'Ignore', name: 'messages-diagnostic', value: { shouldIgnore } },
];
