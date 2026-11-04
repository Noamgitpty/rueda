/**
 * Textes du prototype : catalogue `proto` (quatre langues, format de `@rueda/i18n`) complété par
 * le catalogue officiel. Une clé officielle est toujours lue dans `@rueda/i18n` ; une clé du
 * prototype n'existe que dans les fichiers de ce dossier.
 */
import { CATALOGS, placeholdersOf } from '@rueda/i18n';
import type { CatalogLanguage, Message, MessageKey, PluralCategory, Translator } from '@rueda/i18n';
import { EN_PROTO } from './en.ts';
import { ES_PROTO } from './es.ts';
import type { ProtoKey } from './es.ts';
import { FR_PROTO } from './fr.ts';
import { PT_PROTO } from './pt.ts';

export type { ProtoKey } from './es.ts';
export type CopyKey = ProtoKey | MessageKey;
export type CopyValues = Readonly<Record<string, string | number | bigint>>;

export const PROTO_CATALOGS: Readonly<
  Record<CatalogLanguage, Readonly<Record<ProtoKey, Message>>>
> = { es: ES_PROTO, en: EN_PROTO, fr: FR_PROTO, pt: PT_PROTO };

/** Catalogues officiels et du prototype réunis, par langue (tests « une vue = une langue »). */
export function mergedCatalogs(): Record<
  CatalogLanguage,
  { readonly messages: Readonly<Record<string, Message>> }
> {
  const out = {} as Record<
    CatalogLanguage,
    { readonly messages: Readonly<Record<string, Message>> }
  >;
  for (const language of Object.keys(PROTO_CATALOGS) as CatalogLanguage[]) {
    out[language] = { messages: { ...CATALOGS[language].messages, ...PROTO_CATALOGS[language] } };
  }
  return out;
}

export interface Copy {
  readonly i18n: Translator;
  readonly language: CatalogLanguage;
  /** Texte d'une clé officielle ou du prototype ; variable manquante → erreur, jamais « {x} ». */
  t(key: CopyKey, values?: CopyValues): string;
}

const isProtoKey = (key: string): key is ProtoKey => Object.hasOwn(ES_PROTO, key);

/** Remplit `{nom}` ; un nombre entier passe par le format de la locale, comme `@rueda/i18n`. */
function fill(i18n: Translator, pattern: string, values: CopyValues): string {
  for (const name of placeholdersOf(pattern)) {
    if (!Object.hasOwn(values, name)) throw new Error(`Variable manquante « ${name} ».`);
  }
  return pattern.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, (_, name: string) => {
    const value = values[name];
    if (typeof value === 'string') return value;
    if (value === undefined) return '';
    return i18n.number(value);
  });
}

export function createCopy(i18n: Translator): Copy {
  const language = i18n.profile.language;
  const catalog = PROTO_CATALOGS[language];
  const plurals = new Intl.PluralRules(i18n.profile.tag);
  return {
    i18n,
    language,
    t(key, values = {}) {
      if (!isProtoKey(key)) return i18n.t(key, values);
      const message = catalog[key];
      if (typeof message === 'string') return fill(i18n, message, values);
      const count = values['count'];
      if (typeof count !== 'number' && typeof count !== 'bigint') {
        throw new RangeError(`La clé ${key} est au pluriel : « count » obligatoire.`);
      }
      const category = plurals.select(Number(count)) as PluralCategory;
      return fill(i18n, message[category] ?? message.other, values);
    },
  };
}
