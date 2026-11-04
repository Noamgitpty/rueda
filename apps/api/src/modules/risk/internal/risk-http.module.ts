/**
 * Module Nest de l'anti-abus côté HTTP (US-052), importé par le seul processus API
 * (`api.module.ts`) : garde global par IP et heuristiques anti-robot (`APP_GUARD`), intercepteur
 * global par compte (`APP_INTERCEPTOR`), `AbuseGuard` injectable partout (envois coûteux : OTP,
 * e-mail) et lecture du tableau de sécurité. Module GLOBAL : un seul jeu d'adaptateurs par
 * processus. Adaptateurs choisis par l'appelant : `postgresRiskAdapters` en production (aucun
 * FAKE possible), `risk/testing` dans les tests.
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AbuseGuard } from './abuse-guard.js';
import type { AbuseBoardStore } from './abuse-board.js';
import { AccountRateLimitInterceptor } from './account-rate-limit.interceptor.js';
import type { BotChallengePort } from './bot-challenge.port.js';
import { RhythmTracker } from './bot-heuristics.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { ABUSE_BOARD_STORE, BOT_CHALLENGE, RHYTHM_TRACKER } from './tokens.js';

export interface RiskHttpOptions {
  readonly guard: AbuseGuard;
  readonly challenge: BotChallengePort;
  readonly board: AbuseBoardStore;
  /** Suivi du rythme (défaut : en mémoire du processus) ; remplaçable dans les tests. */
  readonly rhythm?: Pick<RhythmTracker, 'record'>;
}

@Module({})
export class RiskHttpModule {
  static register(options: RiskHttpOptions): DynamicModule {
    return {
      module: RiskHttpModule,
      global: true,
      providers: [
        { provide: AbuseGuard, useValue: options.guard },
        { provide: BOT_CHALLENGE, useValue: options.challenge },
        { provide: RHYTHM_TRACKER, useValue: options.rhythm ?? new RhythmTracker() },
        { provide: ABUSE_BOARD_STORE, useValue: options.board },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_INTERCEPTOR, useClass: AccountRateLimitInterceptor },
      ],
      exports: [AbuseGuard, ABUSE_BOARD_STORE],
    };
  }
}
