/**
 * Garde centrale « aucun FAKE en production » (C19 ; critère 2 d'US-020) : chaque FAKE d'US-020
 * refuse de se construire hors `RUEDA_ENV` = development | test, et le refus est fail-closed
 * (variable absente, inconnue, préproduction, production).
 */
import { describe, expect, it } from 'vitest';
import { FakeIdentityProvider } from '../src/identity/index.ts';
import { FakeEInvoicingProvider } from '../src/e-invoicing/index.ts';
import { FakeMessagingChannel } from '../src/messaging/index.ts';
import { FakeUploadScanner, InMemoryFileStore } from '../src/files/index.ts';
import { FakeSignatureService } from '../src/signature/index.ts';
import { FakeMapTiles } from '../src/maps/index.ts';
import { assertFakeAllowed, FakeForbiddenError } from '../src/guard.ts';
import type { EnvironmentVariables } from '../src/guard.ts';
import { clock, secret } from './support.ts';

const builders: Record<string, (env: EnvironmentVariables) => unknown> = {
  FakeIdentityProvider: (env) =>
    new FakeIdentityProvider({
      clock: clock(),
      documents: [],
      webhookSecret: secret(),
      sessionTtlMs: 60_000,
      webhookToleranceSeconds: 300,
      env,
    }),
  FakeEInvoicingProvider: (env) => new FakeEInvoicingProvider({ clock: clock(), regimes: [], env }),
  FakeMessagingChannel: (env) => new FakeMessagingChannel({ clock: clock(), channel: 'SMS', env }),
  InMemoryFileStore: (env) => new InMemoryFileStore({ env }),
  FakeUploadScanner: (env) => new FakeUploadScanner({ env }),
  FakeSignatureService: (env) =>
    new FakeSignatureService({ clock: clock(), maxOtpAgeMs: 600_000, env }),
  FakeMapTiles: (env) => new FakeMapTiles({ clock: clock(), maxZoom: 18, env }),
};

const forbidden: EnvironmentVariables[] = [
  {},
  { RUEDA_ENV: 'production' },
  { RUEDA_ENV: 'preproduction' },
  { RUEDA_ENV: 'PRODUCTION' },
  { RUEDA_ENV: '' },
  { RUEDA_ENV: 'test ' },
  { NODE_ENV: 'test' },
];

describe('garde centrale des FAKE (C19)', () => {
  it.each(Object.keys(builders))('%s refuse de se construire hors development / test', (name) => {
    const build = builders[name];
    if (build === undefined) throw new Error(name);
    for (const env of forbidden) {
      expect(() => build(env)).toThrow(FakeForbiddenError);
    }
    expect(build({ RUEDA_ENV: 'test' })).toBeDefined();
    expect(build({ RUEDA_ENV: 'development' })).toBeDefined();
  });

  it('sans env explicite, la garde lit process.env (posé à test par vitest.config.ts)', () => {
    expect(new FakeUploadScanner()).toBeDefined();
    expect(assertFakeAllowed('x')).toBe('test');
  });

  it('le refus porte un code stable et ne divulgue que la valeur de RUEDA_ENV', () => {
    try {
      assertFakeAllowed('FakeMapTiles', {
        RUEDA_ENV: 'production',
        SECRET_TOKEN: 'ne-pas-afficher',
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FakeForbiddenError);
      expect((error as FakeForbiddenError).code).toBe('FAKE_FORBIDDEN_IN_PRODUCTION');
      expect((error as Error).message).not.toContain('ne-pas-afficher');
    }
  });
});
