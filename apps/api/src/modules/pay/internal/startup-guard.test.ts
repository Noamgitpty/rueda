/**
 * Refus de démarrage (C19 ; 17 §6.5 point 3). Décision pure, puis lecture de
 * `core.payment_startup_guard()` par un exécuteur simulé (la fonction SQL est prouvée par
 * `packages/db/test/l0/l0-pay-port.test.ts` sur la base de production du banc).
 */
import { describe, expect, it } from 'vitest';
import { PaymentError } from './errors.js';
import {
  assertPaymentStartup,
  checkPaymentStartup,
  fakeAdapterVariables,
} from './startup-guard.js';

const prod = { deploymentEnv: 'production', fakeAccounts: 0 };
const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof PaymentError && error.code === 'FAKE_FORBIDDEN_IN_PRODUCTION';
  }
  return false;
};

describe('contrôle de démarrage PAY (C19)', () => {
  it('production saine : accepté', () => {
    expect(refused(() => checkPaymentStartup('production', {}, prod))).toBe(false);
  });

  it('production + variable *_ADAPTER=FAKE (casse ignorée) ⇒ refus', () => {
    expect(
      fakeAdapterVariables({ PSP_ADAPTER: 'fake', KYC_ADAPTER: 'REAL', MAIL_ADAPTER: ' FAKE ' }),
    ).toEqual(['MAIL_ADAPTER', 'PSP_ADAPTER']);
    expect(refused(() => checkPaymentStartup('production', { PSP_ADAPTER: 'FAKE' }, prod))).toBe(
      true,
    );
    // hors production, la variable est permise (développement local)
    expect(
      refused(() =>
        checkPaymentStartup(
          'development',
          { PSP_ADAPTER: 'FAKE' },
          { deploymentEnv: 'test', fakeAccounts: 0 },
        ),
      ),
    ).toBe(false);
  });

  it('compte PSP FAKE en base de production ⇒ refus, que l’application se croie en production ou non', () => {
    expect(refused(() => checkPaymentStartup('production', {}, { ...prod, fakeAccounts: 1 }))).toBe(
      true,
    );
    expect(refused(() => checkPaymentStartup('test', {}, { ...prod, fakeAccounts: 1 }))).toBe(true);
    expect(
      refused(() => checkPaymentStartup('test', {}, { deploymentEnv: 'test', fakeAccounts: 3 })),
    ).toBe(false);
  });

  it('application et base discordantes, l’une en production ⇒ refus', () => {
    expect(
      refused(() =>
        checkPaymentStartup('production', {}, { deploymentEnv: 'test', fakeAccounts: 0 }),
      ),
    ).toBe(true);
    expect(refused(() => checkPaymentStartup('development', {}, prod))).toBe(true);
  });

  it('RUEDA_ENV absent ou inconnu ⇒ production (fail-closed) ; lit core.payment_startup_guard()', async () => {
    const queries: string[] = [];
    const db = {
      query: <R extends Record<string, unknown>>(text: string) => {
        queries.push(text);
        return Promise.resolve({
          rows: [{ deployment_env: 'production', fake_accounts: 2 }] as unknown as R[],
        });
      },
    };
    await expect(assertPaymentStartup({ env: {}, db })).rejects.toMatchObject({
      code: 'FAKE_FORBIDDEN_IN_PRODUCTION',
    });
    await expect(assertPaymentStartup({ env: { RUEDA_ENV: 'prod' }, db })).rejects.toBeInstanceOf(
      PaymentError,
    );
    expect(queries[0]).toMatch(/core\.payment_startup_guard\(\)/);
    const empty = {
      query: <R extends Record<string, unknown>>() => Promise.resolve({ rows: [] as R[] }),
    };
    await expect(
      assertPaymentStartup({ env: { RUEDA_ENV: 'test' }, db: empty }),
    ).rejects.toBeInstanceOf(PaymentError);
    const ok = {
      query: <R extends Record<string, unknown>>() =>
        Promise.resolve({ rows: [{ deployment_env: 'test', fake_accounts: 1 }] as unknown as R[] }),
    };
    await expect(assertPaymentStartup({ env: { RUEDA_ENV: 'test' }, db: ok })).resolves.toEqual({
      environment: 'test',
      deploymentEnv: 'test',
      fakeAccounts: 1,
    });
  });
});
