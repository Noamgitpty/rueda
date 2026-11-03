/**
 * `@rueda/fake-adapters` — adaptateurs FAKE derrière les ports de 17 §5 (US-019, US-020, US-061).
 * Dépendance de DÉVELOPPEMENT seulement : jamais dans l'image de production (17 §6.5 point 2,
 * §10 ; C19). Chaque FAKE refuse de se construire hors `RUEDA_ENV` = development | test.
 *
 * Paquet **feuille** : il n'importe aucun paquet de l'espace de travail (ADR-058) ; les FAKE
 * d'US-020 se conforment aux ports des modules par typage structurel, vérifié par les tests de
 * conformance des modules propriétaires.
 */
export {
  assertFakeAllowed,
  FAKE_ALLOWED_ENVIRONMENTS,
  FakeForbiddenError,
  type EnvironmentVariables,
  type FakeAllowedEnvironment,
} from './guard.ts';
export * from './core/index.ts';
export * from './identity/index.ts';
export * from './e-invoicing/index.ts';
export * from './messaging/index.ts';
export * from './files/index.ts';
export * from './signature/index.ts';
export * from './maps/index.ts';
