/** Catégories de pluriel CLDR (`Intl.PluralRules`). */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** Message au pluriel : `other` obligatoire, repli de toute catégorie absente ; `{count}` fourni. */
export type PluralMessage = { readonly other: string } & {
  readonly [C in Exclude<PluralCategory, 'other'>]?: string;
};

export type Message = string | PluralMessage;

/** Catalogue plat : clé à points (`<espace>.<écran>.<élément>`) → message. */
export type Catalog = Readonly<Record<string, Message>>;

export interface VersionedCatalog<K extends string = string> {
  /** Version du catalogue ; incrémentée à chaque ajout, retrait ou changement de sens d'une clé. */
  readonly version: number;
  readonly messages: Readonly<Record<K, Message>>;
}
