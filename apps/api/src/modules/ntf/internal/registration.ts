/**
 * Montage de NTF sur le module BUS (US-021, ADR-050, ADR-061) : un consommateur
 * `ntf_dispatcher` abonné aux types d'événements du catalogue, et une minuterie `ntf_sender`
 * (une tâche par tentative d'envoi). Le câblage dans `worker.ts` (pool, boucles) vient avec US-003.
 */
import type { BusRegistry } from '../../bus/index.js';
import type { CountryConfig } from '../../cfg/index.js';
import { parseLocaleConfig } from '@rueda/i18n';
import type { LocaleConfig } from '@rueda/i18n';
import locales from '@rueda/i18n/config/locales.json' with { type: 'json' };
import type { RuleSpec } from './catalog.js';
import { RULES, subscribedEventTypes } from './catalog.js';
import { dispatchEvent, NTF_DISPATCHER_WORKER, NTF_SENDER_WORKER } from './dispatcher.js';
import type { CountryNotificationProfile, NotificationSender } from './sender.js';

export function registerNotifications(
  registry: BusRegistry,
  sender: NotificationSender,
  rules: readonly RuleSpec[] = RULES,
): void {
  registry.registerConsumer(
    NTF_DISPATCHER_WORKER,
    subscribedEventTypes(rules),
    async (event, tx) => {
      await dispatchEvent(event, tx, rules);
    },
  );
  registry.registerTimer(NTF_SENDER_WORKER, (payload, tx) => sender.handle(payload, tx));
}

/** Locales de `@rueda/i18n` (`config/locales.json`), validées au chargement (ADR-024). */
export function repositoryLocaleConfig(): LocaleConfig {
  return parseLocaleConfig(locales);
}

/** Fuseaux, locales et exposants lus dans la configuration pays (CFG, US-013). */
export function notificationCountryData(config: CountryConfig): {
  readonly countryOf: (code: string) => CountryNotificationProfile | undefined;
  readonly exponentOf: (currency: string) => number | undefined;
} {
  return {
    countryOf: (code) => {
      const entry = config.countries.get(code);
      return entry === undefined
        ? undefined
        : { timeZone: entry.timeZone, defaultLocale: entry.defaultLocale, locales: entry.locales };
    },
    exponentOf: (currency) => config.currencies.find((c) => c.code === currency)?.exponent,
  };
}
