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
  'common.auth.sessionRequired': 'Your session has ended. Please log in again.',
  'common.auth.invalidCredentials': 'Incorrect email or password.',
  'common.auth.emailInvalid': 'Enter a valid email address.',
  'common.auth.passwordWeak': 'Your password must be at least {min} characters long.',
  'common.auth.termsNotAccepted': 'You must accept the Terms and the Privacy Policy to continue.',
  'common.auth.linkExpired': 'This link is no longer valid. Request a new one.',
  'common.auth.rateLimited': 'Too many attempts. Wait a few minutes and try again.',
  'common.auth.requestInvalid': 'Please check the information you entered.',
  'common.auth.signupAccepted': 'Check your email to continue.',
  'common.auth.emailVerified': 'Your email is confirmed.',
  'web.home.tagline': 'Rent a car and see the final price from the start.',
  'backoffice.meta.title': '{brand} — back office',
  'backoffice.meta.description': 'Internal console.',
  'backoffice.home.heading': '{brand} — back office',
  'backoffice.home.intro': 'Internal console for the team.',
} as const satisfies Readonly<Record<MessageKey, Message>>;
