/**
 * Valeurs attendues des parcours e2e, recopiées de la spécification et NON du code testé
 * (CLAUDE.md : le code testé n'est jamais l'oracle).
 *
 * Source : 10b §4.3 (catalogue es / en / fr), lignes `web.s01.title` et `common.offline.banner`.
 * Le portugais (pt-BR, DEC-FONDATEUR-17 puis mémoire du projet) n'a pas encore de colonne dans 10b :
 * pour pt, les parcours vérifient la langue de la vue et un texte distinct des trois autres.
 */
import type { Language } from './fixtures.ts';

export const SPEC_TEXT: Readonly<
  Record<'homeTitle' | 'offlineBanner', Readonly<Partial<Record<Language, string>>>>
> = {
  homeTitle: {
    es: 'Alquila el auto de un vecino.',
    en: 'Rent a car from a neighbor.',
    fr: 'Réserve la voiture d’un voisin.',
  },
  offlineBanner: {
    es: 'Sin conexión. Te mostramos lo último guardado.',
    en: "You're offline. Showing what was last saved.",
    fr: 'Hors connexion. Voici les dernières informations enregistrées.',
  },
};
