/**
 * Module Nest de l'authentification (adaptateur interne du port, ADR-021 / ADR-052).
 *
 * Module DYNAMIQUE, importé par le seul processus API (`api.module.ts`), jamais par le
 * travailleur. Les adaptateurs sont choisis par l'appelant :
 * - production : `postgresIamAdapters(pool)` (PgAuthStore sous app_api, notificateur en attente
 *   de NTF) ; aucun interrupteur d'environnement ne peut y substituer un FAKE ;
 * - tests : `FakeAuthStore` et `RecordingIdentityNotifier` de `../testing/`, absents de la
 *   compilation de production (`tsconfig.build.json`).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { HostAccountController } from './host-account.controller.js';
import { AuthService } from './auth.service.js';
import type { AuthStore } from './auth-store.js';
import type { IdentityNotifier } from './notifier.js';
import { Argon2idPasswordHasher } from './password-hasher.js';
import { DEFAULT_AUTH_POLICY } from './policy.js';
import type { AuthPolicy } from './policy.js';
import { JsonWriteGuard } from './csrf.guard.js';
import { SessionGuard } from './session.guard.js';
import {
  AUTHENTICATION_PORT,
  IAM_AUTH_STORE,
  IAM_CLOCK,
  IAM_NOTIFIER,
  IAM_PASSWORD_HASHER,
  IAM_POLICY,
  systemClock,
} from './tokens.js';
import type { Clock } from './tokens.js';

export interface IamAuthOptions {
  readonly store: AuthStore;
  readonly notifier: IdentityNotifier;
  readonly policy?: AuthPolicy;
  readonly hasher?: Argon2idPasswordHasher;
  readonly clock?: Clock;
}

@Module({})
export class IamAuthModule {
  static register(options: IamAuthOptions): DynamicModule {
    return {
      module: IamAuthModule,
      // global : SessionGuard et AUTHENTICATION_PORT sont injectables dans tout module, sans
      // second appel à register() (un seul jeu d'adaptateurs par processus)
      global: true,
      // US-107 : ouverture du compte d'hôte (même store, même session que l'authentification)
      controllers: [AuthController, HostAccountController],
      providers: [
        { provide: IAM_AUTH_STORE, useValue: options.store },
        { provide: IAM_NOTIFIER, useValue: options.notifier },
        { provide: IAM_POLICY, useValue: options.policy ?? DEFAULT_AUTH_POLICY },
        { provide: IAM_PASSWORD_HASHER, useValue: options.hasher ?? new Argon2idPasswordHasher() },
        { provide: IAM_CLOCK, useValue: options.clock ?? systemClock },
        AuthService,
        { provide: AUTHENTICATION_PORT, useExisting: AuthService },
        SessionGuard,
        JsonWriteGuard,
      ],
      exports: [AUTHENTICATION_PORT, SessionGuard],
    };
  }
}
