import { Module } from '@nestjs/common';
import { CountryConfigService } from './internal/country-config.service.js';

/**
 * Module CFG — Country configuration (17 §2.2). US-013 : configuration pays en données, validée
 * fail-closed, contrôles de démarrage (tzdata, données obligatoires en production).
 */
@Module({
  providers: [CountryConfigService],
  exports: [CountryConfigService],
})
export class CfgModule {}
