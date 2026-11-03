/**
 * `@rueda/fake-adapters` — adaptateurs FAKE derrière les ports de 17 §5 (US-019, puis US-020 et
 * US-061). Dépendance de DÉVELOPPEMENT seulement : jamais dans l'image de production (17 §6.5
 * point 2, C19). Chaque FAKE refuse de se construire hors `RUEDA_ENV` = development | test.
 */
export {
  assertFakeAllowed,
  FAKE_ALLOWED_ENVIRONMENTS,
  FakeForbiddenError,
  type EnvironmentVariables,
  type FakeAllowedEnvironment,
} from './guard.ts';
export * from './psp/index.ts';
