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
import { CountryConfigService } from '../../cfg/index.js';
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
import type { OtpCodeHasher } from './phone/otp-code.js';
import { PhoneController } from './phone/phone.controller.js';
import type { PhoneOtpStore } from './phone/phone-otp-store.js';
import { UnavailablePhoneOtpStore } from './phone/phone-otp-store.js';
import { PhoneVerifiedGuard } from './phone/phone-verified.guard.js';
import type { OtpSendGuard } from './phone/phone-verification.service.js';
import {
  PhoneVerificationService,
  UNAVAILABLE_SEND_GUARD,
} from './phone/phone-verification.service.js';
import {
  AUTHENTICATION_PORT,
  IAM_AUTH_STORE,
  IAM_CLOCK,
  IAM_NOTIFIER,
  IAM_PASSWORD_HASHER,
  IAM_PHONE_VERIFICATION,
  IAM_POLICY,
  systemClock,
} from './tokens.js';
import type { Clock } from './tokens.js';

/**
 * Vérification du téléphone par OTP (US-104, ADR-098). Absente : OTP indisponible (503,
 * fail-closed), les autres routes inchangées.
 */
export interface PhoneOtpOptions {
  readonly store: PhoneOtpStore;
  /** Empreinte des codes (`RUEDA_OTP_KEY`) ; `null` : clé absente, OTP indisponible. */
  readonly hasher: OtpCodeHasher | null;
  /** Plafonds anti-abus des envois (`AbuseGuard` de RISK, injecté par la racine de composition). */
  readonly sendGuard: OtpSendGuard;
}

export interface IamAuthOptions {
  readonly store: AuthStore;
  readonly notifier: IdentityNotifier;
  readonly policy?: AuthPolicy;
  readonly hasher?: Argon2idPasswordHasher;
  readonly clock?: Clock;
  readonly phone?: PhoneOtpOptions;
}

/** Service de l'OTP du téléphone, plans de numérotation lus dans la configuration pays (CFG). */
function phoneVerification(options: PhoneOtpOptions | undefined): PhoneVerificationService {
  const countries = new CountryConfigService().config.countries;
  return new PhoneVerificationService({
    store: options?.store ?? new UnavailablePhoneOtpStore(),
    hasher: options?.hasher ?? null,
    sendGuard: options?.sendGuard ?? UNAVAILABLE_SEND_GUARD,
    numbering: (country) => countries.get(country)?.phone,
    countries: [...countries.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((c) => ({ code: c.code, names: c.names, phone: c.phone })),
  });
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
      // US-104 : vérification du téléphone par OTP (même session)
      controllers: [AuthController, HostAccountController, PhoneController],
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
        { provide: IAM_PHONE_VERIFICATION, useValue: phoneVerification(options.phone) },
        PhoneVerifiedGuard,
      ],
      exports: [AUTHENTICATION_PORT, SessionGuard, IAM_PHONE_VERIFICATION, PhoneVerifiedGuard],
    };
  }
}
