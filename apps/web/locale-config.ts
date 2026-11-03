/**
 * Configuration des locales, chargée depuis la donnée partagée `@rueda/i18n/config/locales.json`
 * et validée au chargement (une configuration invalide fait échouer le démarrage, fail-closed).
 * Aucune locale ni aucun pays n'est écrit dans le code de l'application (ADR-024).
 */
import { parseLocaleConfig } from '@rueda/i18n';
import rawLocaleConfig from '@rueda/i18n/config/locales.json' with { type: 'json' };

export const LOCALE_CONFIG = parseLocaleConfig(rawLocaleConfig);
