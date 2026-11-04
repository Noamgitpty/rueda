import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { BrandModule } from './modules/cfg/index.js';
import type { BrandOptions } from './modules/cfg/index.js';
import { IamAuthModule, StaffConsoleModule } from './modules/iam/index.js';
import type { IamAuthOptions, StaffOptions } from './modules/iam/index.js';
import { PayWebhookModule } from './modules/pay/index.js';
import type { PayWebhookOptions } from './modules/pay/index.js';
import { RiskHttpModule } from './modules/risk/index.js';
import type { RiskHttpOptions } from './modules/risk/index.js';
import {
  SupBrandConsoleModule,
  SupConsoleModule,
  SupSecurityConsoleModule,
} from './modules/sup/index.js';
import type { SupConsoleOptions } from './modules/sup/index.js';

/**
 * Module racine du processus API (main.ts) : AppModule (partagé avec le travailleur) plus ce
 * qui ne doit tourner que dans l'API, sous le rôle `app_api` (routes d'authentification, US-010 ;
 * réception des webhooks PSP, US-019 ; console interne, US-012 ; socle de marque, US-034 ;
 * limitation de débit et anti-abus, garde global et tableau de sécurité, US-052).
 */
@Module({})
export class ApiModule {
  static register(
    iam: IamAuthOptions,
    pay: PayWebhookOptions,
    staff: StaffOptions,
    sup: SupConsoleOptions,
    brand: BrandOptions,
    risk: RiskHttpOptions,
  ): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        AppModule,
        // en premier : son garde global (débit par IP, anti-robot) passe avant toute route
        RiskHttpModule.register(risk),
        IamAuthModule.register(iam),
        PayWebhookModule.register(pay),
        StaffConsoleModule.register(staff),
        SupConsoleModule.register(sup),
        BrandModule.register(brand),
        SupBrandConsoleModule,
        SupSecurityConsoleModule,
      ],
    };
  }
}
