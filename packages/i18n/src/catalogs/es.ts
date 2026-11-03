import type { Catalog } from './types.ts';

/**
 * Catalogue espagnol : **version qui fait foi** (19 US-014, 16 NFR-11). Espagnol neutre
 * d'Amérique latine (10b UX-11), tutoiement « tú » dans l'interface (UXQ-04, défaut PROPOSÉ) ;
 * le vouvoiement « usted » est réservé au contrat et aux textes juridiques (UX-12). Jamais de
 * voseo ni de « vosotros ». Termes : glossaire `docs/glossary.md` (UX-13).
 *
 * Toute clé ajoutée ici doit l'être dans `en.ts` et `fr.ts` (sinon `pnpm typecheck` et les tests
 * échouent).
 */
export const ES_MESSAGES = {
  'common.locale.switchLabel': 'Idioma',
  'common.locale.current': 'Idioma actual: {language}',
  'common.price.finalForDays': {
    one: 'Precio final · {count} día',
    other: 'Precio final · {count} días',
  },
  'web.home.tagline': 'Alquila un auto y conoce el precio final desde el inicio.',
  'backoffice.meta.title': '{brand} — administración',
  'backoffice.meta.description': 'Consola interna.',
  'backoffice.home.heading': '{brand} — administración',
  'backoffice.home.intro': 'Consola interna del equipo.',
} as const satisfies Catalog;

export type MessageKey = keyof typeof ES_MESSAGES;
