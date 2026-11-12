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
  Record<
    | 'homeTitle'
    | 'offlineBanner'
    | 'signupButton'
    | 'draftMarker'
    | 'codeSent'
    | 'phoneDigits'
    | 'hostEmpty'
    | 'hostSaved'
    | 'identityVerified'
    | 'identityRetake'
    | 'hostWaitingCountry',
    Readonly<Partial<Record<Language, string>>>
  >
> = {
  // 10b §4.3, ligne `web.s15.signup` (S15, US-102)
  signupButton: {
    es: 'Crear cuenta',
    en: 'Sign up',
    fr: 'Créer un compte',
  },
  // consigne de la story US-102 (orchestrateur) : textes juridiques provisoires marqués
  // « BROUILLON — à valider par le juridique » (formulation française donnée par la consigne) ;
  // es, en et pt : textes PROPOSÉS d'ADR-091 point 8 (BORRADOR / DRAFT / RASCUNHO)
  draftMarker: {
    es: 'BORRADOR — pendiente de validación jurídica',
    en: 'DRAFT — pending legal review',
    fr: 'BROUILLON — à valider par le juridique',
    pt: 'RASCUNHO — pendente de validação jurídica',
  },
  // 10b §4.3, lignes `web.a10.empty` et `web.a10.saved` (A10, US-115) ; 10b n'a pas de colonne
  // pt : texte pt-BR de référence de la story US-115 (DEC-FONDATEUR-18), à reporter dans 10b
  hostEmpty: {
    es: 'Aún no publicaste ningún auto',
    en: "You haven't listed a car yet",
    fr: 'Tu n’as encore publié aucune voiture',
    pt: 'Você ainda não anunciou nenhum carro',
  },
  hostSaved: { es: 'Guardado', en: 'Saved', fr: 'Enregistré', pt: 'Salvo' },
  // 10b §4.3, lignes `web.s04.result.verified` et `web.s04.result.retake` (S04, US-105)
  // pt : 10b n'a pas de colonne pt ; texte pt-BR de référence de la story US-105 (DEC-FONDATEUR-18),
  // à reporter dans 10b
  identityVerified: {
    es: 'Verificado',
    en: 'Verified',
    fr: 'Vérifié',
    pt: 'Identidade confirmada',
  },
  identityRetake: {
    es: 'Necesitamos otra foto',
    en: 'We need another photo',
    fr: 'Il nous faut une autre photo',
    pt: 'Precisamos de outra foto',
  },
  // 10b §4.3, ligne `web.a07.waitingCountry` (A07, US-123) : début du texte, avant {brand}
  hostWaitingCountry: {
    es: 'Todo listo de tu lado.',
    en: "You're all set.",
    fr: 'Tout est prêt de ton côté.',
  },
  // 10b §4.3, ligne `web.s15.codeSent` (S15, US-104) : début du texte, avant {phone}
  codeSent: {
    es: 'Código enviado a',
    en: 'Code sent to',
    fr: 'Code envoyé au',
  },
  // 10b §4.3, ligne `common.error.phoneDigits` (US-104) : début du texte, avant {digits}
  phoneDigits: {
    es: 'El número debe tener',
    en: 'Enter a',
    fr: 'Le numéro doit comporter',
  },
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
