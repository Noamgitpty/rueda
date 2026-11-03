import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { IamAuthModule } from './modules/iam/index.js';
import type { IamAuthOptions } from './modules/iam/index.js';

/**
 * Module racine du processus API (main.ts) : AppModule (partagé avec le travailleur) plus ce
 * qui ne doit tourner que dans l'API, sous le rôle `app_api` (routes d'authentification, US-010).
 */
@Module({})
export class ApiModule {
  static register(iam: IamAuthOptions): DynamicModule {
    return { module: ApiModule, imports: [AppModule, IamAuthModule.register(iam)] };
  }
}
