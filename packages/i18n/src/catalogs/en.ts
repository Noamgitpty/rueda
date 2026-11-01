import type { MessageKey } from './es.ts';
import type { Message } from './types.ts';

/**
 * Catalogue anglais, aligné clé pour clé sur `es.ts` (qui fait foi). Le `satisfies` fait
 * échouer `pnpm typecheck` si une clé manque ou est en trop.
 */
export const EN_MESSAGES = {
  'common.locale.switchLabel': 'Language',
  'common.locale.current': 'Current language: {language}',
  'common.price.finalForDays': {
    one: 'Final price · {count} day',
    other: 'Final price · {count} days',
  },
  'web.home.tagline': 'Rent a car and see the final price from the start.',
  'backoffice.meta.title': '{brand} — back office',
  'backoffice.meta.description': 'Internal console.',
  'backoffice.home.heading': '{brand} — back office',
  'backoffice.home.intro': 'Internal console for the team.',
} as const satisfies Readonly<Record<MessageKey, Message>>;
