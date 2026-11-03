import type { CatalogLanguage } from '../locale-profile.ts';
import { EN_MESSAGES } from './en.ts';
import { ES_MESSAGES } from './es.ts';
import { FR_MESSAGES } from './fr.ts';
import { PT_MESSAGES } from './pt.ts';
import type { MessageKey } from './es.ts';
import type { Message, VersionedCatalog } from './types.ts';

export type { MessageKey } from './es.ts';
export type { Catalog, Message, PluralCategory, PluralMessage, VersionedCatalog } from './types.ts';

/**
 * Version des catalogues (catalogue versionné, 19 US-014). Les quatre langues partagent la même
 * version : une clé ajoutée en es l'est en en, en fr et en pt dans le même commit. Version 8 :
 * portugais du Brésil (DEC-FONDATEUR-18) et sens changé de `common.brand.assetInvalid` et
 * `common.brand.contentLocaleMissing` (quatre langues exigées).
 */
export const CATALOG_VERSION = 8;

/** Catalogues de base par langue ; la langue d'un profil de locale choisit le sien. */
export const CATALOGS: Readonly<Record<CatalogLanguage, VersionedCatalog<MessageKey>>> = {
  es: { version: CATALOG_VERSION, messages: ES_MESSAGES },
  en: { version: CATALOG_VERSION, messages: EN_MESSAGES },
  fr: { version: CATALOG_VERSION, messages: FR_MESSAGES },
  pt: { version: CATALOG_VERSION, messages: PT_MESSAGES },
};

/** Surcharge régionale : sous-ensemble de clés, mêmes emplacements que la base. */
export type RegionalOverrides = Readonly<Partial<Record<MessageKey, Message>>>;
