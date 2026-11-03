/**
 * Outils de test de `@rueda/i18n` (export `@rueda/i18n/testing`) : parité des catalogues et
 * détection du mélange de langues dans un écran rendu (19 US-014, 16 NFR-11).
 */
import { CATALOGS } from '../catalogs/index.ts';
import type { Catalog, Message } from '../catalogs/index.ts';
import type { CatalogLanguage } from '../locale-profile.ts';
import { PLACEHOLDER, placeholdersOf } from '../pattern.ts';

function forms(message: Message): Record<string, string> {
  return typeof message === 'string' ? { '': message } : { ...message };
}

function placeholderSet(message: Message): string {
  const names = new Set<string>();
  for (const text of Object.values(forms(message))) {
    for (const name of placeholdersOf(text)) names.add(name);
  }
  return [...names].sort().join(',');
}

/**
 * Compare un catalogue à la référence (es fait foi). Défauts signalés : clé manquante, clé en
 * trop, message vide, pluriel d'un côté seulement, `other` absent, emplacements différents.
 * Avec `partial`, les clés manquantes sont permises (surcharge régionale).
 */
export function compareCatalogs(
  reference: Catalog,
  candidate: Catalog,
  options: { readonly partial?: boolean } = {},
): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(reference)) {
    if (!Object.hasOwn(candidate, key) && !options.partial) problems.push(`clé manquante : ${key}`);
  }
  for (const [key, message] of Object.entries(candidate)) {
    const ref = reference[key];
    if (ref === undefined) {
      problems.push(`clé en trop : ${key}`);
      continue;
    }
    if (typeof ref !== typeof message) problems.push(`pluriel incohérent : ${key}`);
    if (typeof message === 'object' && typeof message.other !== 'string') {
      problems.push(`forme « other » absente : ${key}`);
    }
    for (const [form, text] of Object.entries(forms(message))) {
      if (text.trim().length === 0) problems.push(`message vide : ${key}${form ? `.${form}` : ''}`);
    }
    if (placeholderSet(ref) !== placeholderSet(message)) {
      problems.push(
        `emplacements différents : ${key} (${placeholderSet(ref)} ≠ ${placeholderSet(message)})`,
      );
    }
  }
  return problems;
}

/** Fragments fixes d'un message (le texte entre les emplacements), d'au moins `minLength` caractères. */
function fragments(message: Message, minLength: number): string[] {
  return Object.values(forms(message))
    .flatMap((text) => text.split(PLACEHOLDER).filter((_, i) => i % 2 === 0))
    .map((part) => part.trim())
    .filter((part) => part.length >= minLength);
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Vrai si `fragment` apparaît dans `text` comme **mot entier** : ni lettre ni chiffre juste avant
 * ni juste après. Espagnol et portugais partagent des racines : « Identidad » (es) est le début
 * de « Identidade » (pt) sans être une chaîne espagnole (DEC-FONDATEUR-18, ADR-071).
 */
function containsWhole(text: string, fragment: string): boolean {
  for (let at = text.indexOf(fragment); at !== -1; at = text.indexOf(fragment, at + 1)) {
    const before = at > 0 ? text.charAt(at - 1) : '';
    const after = text.charAt(at + fragment.length);
    const startsWord = WORD_CHAR.test(fragment.charAt(0));
    const endsWord = WORD_CHAR.test(fragment.charAt(fragment.length - 1));
    if ((!startsWord || !WORD_CHAR.test(before)) && (!endsWord || !WORD_CHAR.test(after))) {
      return true;
    }
  }
  return false;
}

/**
 * Fragments d'une **autre** langue trouvés dans un texte rendu dans la langue `view`. Un
 * fragment identique dans les deux langues (nom propre, ponctuation) n'est pas signalé, ni un
 * fragment qui n'est que le début ou la fin d'un mot plus long (mot entier exigé).
 * Résultat vide = aucune chaîne étrangère (« une vue = une langue », 10b UX-11).
 */
export function findForeignStrings(
  renderedText: string,
  view: CatalogLanguage,
  catalogs: Readonly<Record<CatalogLanguage, { readonly messages: Catalog }>> = CATALOGS,
  minLength = 4,
): string[] {
  const own = new Set(Object.values(catalogs[view].messages).flatMap((m) => fragments(m, 1)));
  const found = new Set<string>();
  for (const [language, catalog] of Object.entries(catalogs)) {
    if (language === view) continue;
    for (const message of Object.values(catalog.messages)) {
      for (const fragment of fragments(message, minLength)) {
        if (!own.has(fragment) && containsWhole(renderedText, fragment)) found.add(fragment);
      }
    }
  }
  return [...found];
}
