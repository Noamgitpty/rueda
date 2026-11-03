/**
 * Refus de démarrage avec un FAKE en production (17 §6.5 point 3 ; C19 ; R20).
 *
 * L'API et le travailleur appellent `assertPaymentStartup` avant d'accepter du trafic. Refus si :
 * 1. l'environnement de l'application est `production` (variable `RUEDA_ENV` absente ou inconnue
 *    comprise : fail-closed, convention du module CFG) et une variable `*_ADAPTER` vaut `FAKE` ;
 * 2. l'application ou la base (`platform.deployment_env()`) est en production et un compte PSP
 *    `FAKE` existe (`core.payment_startup_guard()`) ;
 * 3. l'application et la base ne s'accordent pas, l'une étant en production (application de test
 *    branchée sur une base de production, ou l'inverse).
 *
 * Le refus de `platform.now()` branché sur `app.virtual_now` en production est prouvé par L0-06
 * (US-005) sur la base de production.
 */
import { parseRuntimeEnvironment } from '../../cfg/index.js';
import type { RuntimeEnvironment } from '../../cfg/index.js';
import { PaymentError } from './errors.js';
import type { SqlExecutor } from './pg-stores.js';

export interface PaymentStartupInput {
  /** Variables d'environnement du processus (`process.env`). */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly db: SqlExecutor;
}

export interface PaymentStartupState {
  readonly environment: RuntimeEnvironment;
  readonly deploymentEnv: string;
  readonly fakeAccounts: number;
}

/** Variables `*_ADAPTER` qui valent `FAKE` (casse ignorée). */
export function fakeAdapterVariables(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(env)
    .filter(([name, value]) => /_ADAPTER$/i.test(name) && value?.trim().toUpperCase() === 'FAKE')
    .map(([name]) => name)
    .sort();
}

/** Décision pure (testée sans base). */
export function checkPaymentStartup(
  environment: RuntimeEnvironment,
  env: Readonly<Record<string, string | undefined>>,
  db: { readonly deploymentEnv: string; readonly fakeAccounts: number },
): void {
  const appProd = environment === 'production';
  const dbProd = db.deploymentEnv === 'production';
  const refuse = (why: string): never => {
    throw new PaymentError('FAKE_FORBIDDEN_IN_PRODUCTION', `démarrage refusé (C19) : ${why}`);
  };
  if (appProd) {
    const fakes = fakeAdapterVariables(env);
    if (fakes.length > 0) refuse(`variable(s) ${fakes.join(', ')} = FAKE`);
  }
  if ((appProd || dbProd) && db.fakeAccounts > 0) {
    refuse(`${db.fakeAccounts} compte(s) PSP FAKE en base`);
  }
  if (appProd !== dbProd) {
    refuse(`application « ${environment} » et base « ${db.deploymentEnv} » discordantes`);
  }
}

export async function assertPaymentStartup(
  input: PaymentStartupInput,
): Promise<PaymentStartupState> {
  const environment = parseRuntimeEnvironment(input.env['RUEDA_ENV']);
  const { rows } = await input.db.query<{ deployment_env: string; fake_accounts: number }>(
    'SELECT deployment_env, fake_accounts FROM core.payment_startup_guard()',
  );
  const row = rows[0];
  if (row === undefined) {
    throw new PaymentError(
      'FAKE_FORBIDDEN_IN_PRODUCTION',
      'démarrage refusé : garde PAY illisible',
    );
  }
  const state = { deploymentEnv: row.deployment_env, fakeAccounts: Number(row.fake_accounts) };
  checkPaymentStartup(environment, input.env, state);
  return { environment, ...state };
}
