import type { MessageKey } from './es.ts';
import type { Message } from './types.ts';

/**
 * Catalogue français (DEC-FONDATEUR-17), aligné clé pour clé sur `es.ts` (qui fait foi). Le
 * `satisfies` fait échouer `pnpm typecheck` si une clé manque ou est en trop.
 *
 * Registre : **tutoiement** dans l'interface, comme Turo en France (journal
 * `docs/team/COMME_TURO.md`, PROPOSÉ) ; le **vouvoiement** est réservé au contrat et aux textes
 * juridiques, comme « usted » en espagnol (UX-12). Typographie française : espace insécable
 * (U+00A0) avant « : », « ; », « ? » et « ! », apostrophe typographique « ’ ».
 *
 * Pluriels (CLDR du français) : `one` couvre 0 et 1 (« 0 jour », « 1 jour »), `other` le reste ;
 * la catégorie `many` (1 000 000) se replie sur `other`.
 */
export const FR_MESSAGES = {
  'common.locale.switchLabel': 'Langue',
  'common.locale.current': 'Langue actuelle\u00a0: {language}',
  'common.price.finalForDays': {
    one: 'Prix final · {count} jour',
    other: 'Prix final · {count} jours',
  },
  'web.home.tagline': 'Loue une voiture et découvre le prix final dès le départ.',
  'backoffice.meta.title': '{brand} — back-office',
  'backoffice.meta.description': 'Console interne.',
  'backoffice.home.heading': '{brand} — back-office',
  'backoffice.home.intro': 'Console interne de l’équipe.',
} as const satisfies Readonly<Record<MessageKey, Message>>;
