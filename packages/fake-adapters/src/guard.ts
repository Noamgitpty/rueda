/**
 * Garde « aucun FAKE en production » (C19 ; 17 §6.5 ; CLAUDE.md contrainte 2).
 *
 * Tout adaptateur FAKE de ce paquet appelle `assertFakeAllowed` à sa construction. La variable
 * `RUEDA_ENV` (même convention que le module CFG, US-013) doit valoir **explicitement**
 * `development` ou `test` : absente, inconnue, `preproduction` ou `production` ⇒ refus
 * (fail-closed). La préproduction utilise les bacs à sable des PSP (17 §6.5), jamais un FAKE.
 *
 * Défense en profondeur : ce paquet n'est qu'une dépendance de développement (`devDependencies`)
 * de `apps/api`, exclue de l'image de production ; la base refuse aussi tout compte PSP `FAKE` en
 * production (migration 0028) et l'API refuse de démarrer si elle en trouve un.
 */

export const FAKE_ALLOWED_ENVIRONMENTS = ['development', 'test'] as const;
export type FakeAllowedEnvironment = (typeof FAKE_ALLOWED_ENVIRONMENTS)[number];

export class FakeForbiddenError extends Error {
  override readonly name = 'FakeForbiddenError';
  readonly code = 'FAKE_FORBIDDEN_IN_PRODUCTION';
}

export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

export function assertFakeAllowed(
  what: string,
  env: EnvironmentVariables = process.env,
): FakeAllowedEnvironment {
  const value = env['RUEDA_ENV'];
  if (value === 'development' || value === 'test') return value;
  throw new FakeForbiddenError(
    `${what} : adaptateur FAKE refusé (RUEDA_ENV = ${value === undefined ? 'absent' : JSON.stringify(value)} ; ` +
      `seuls ${FAKE_ALLOWED_ENVIRONMENTS.join(', ')} l'acceptent)`,
  );
}
