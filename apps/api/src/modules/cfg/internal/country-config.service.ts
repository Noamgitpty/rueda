import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { loadRepositoryConfig } from './load.js';
import type { CountryConfig } from './model.js';
import { isGoLiveSwitchOn, resolveParam } from './resolve.js';
import type { ParamContext, ResolvedParam } from './resolve.js';
import { runStartupChecks } from './startup.js';
import type { RuntimeEnvironment } from './startup.js';

/**
 * Configuration pays du processus (API et travailleur ; US-013). Chargée et validée à la
 * construction ; contrôles de démarrage à l'initialisation du module : une erreur arrête le
 * démarrage (`CONFIG_INVALID`, `TZDATA_MISMATCH`, `PARAM_MISSING` en production).
 */
@Injectable()
export class CountryConfigService implements OnModuleInit {
  readonly config: CountryConfig = loadRepositoryConfig();
  private environmentValue: RuntimeEnvironment | undefined;

  onModuleInit(): void {
    this.environmentValue = runStartupChecks({
      environment: process.env['RUEDA_ENV'],
      config: this.config,
      at: new Date(),
    });
  }

  /** Environnement retenu au démarrage (absent ou inconnu ⇒ `production`). */
  get environment(): RuntimeEnvironment {
    return this.environmentValue ?? 'production';
  }

  resolve(key: string, ctx: ParamContext): ResolvedParam {
    return resolveParam(this.config, key, ctx);
  }

  isGoLiveSwitchOn(key: string, country: string, at: Date): boolean {
    return isGoLiveSwitchOn(this.config, key, country, at);
  }
}
