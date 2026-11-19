import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { AvlCheckoutModule } from './modules/avl/index.js';
import type { AvlCheckoutOptions } from './modules/avl/index.js';
import { CatHostModule, CatSearchModule } from './modules/cat/index.js';
import type { CatHostOptions, CatSearchOptions } from './modules/cat/index.js';
import { BrandModule, RegulatoryNoticesModule } from './modules/cfg/index.js';
import { CtrLegalModule } from './modules/ctr/index.js';
import type { CtrLegalOptions } from './modules/ctr/index.js';
import type { BrandOptions } from './modules/cfg/index.js';
import { IamAuthModule, StaffConsoleModule } from './modules/iam/index.js';
import { KycIdentityModule } from './modules/kyc/index.js';
import type { KycIdentityOptions } from './modules/kyc/index.js';
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
import { TrpInspectionModule } from './modules/trp/index.js';
import type { TrpInspectionOptions } from './modules/trp/index.js';

/**
 * Module racine du processus API (main.ts) : AppModule (partagé avec le travailleur) plus ce
 * qui ne doit tourner que dans l'API, sous le rôle `app_api` (routes d'authentification, US-010 ;
 * réception des webhooks PSP, US-019 ; console interne, US-012 ; socle de marque, US-034 ;
 * limitation de débit et anti-abus, garde global et tableau de sécurité, US-052 ; documents
 * juridiques et consentements versionnés, US-102 ; lieux, véhicules et annonces de l'hôte, US-115 :
 * sans adaptateurs CAT, ses routes répondent 503, fail-closed ; vérification d'identité et
 * consentement biométrique, US-105 : sans adaptateurs KYC, magasin indisponible et aucun
 * fournisseur, fail-closed ; recherche publique, US-201 : sans adaptateurs, 503 ; checkout, devis
 * figé et pose du hold, US-208 : sans adaptateurs, 503 ; photos d'état du véhicule, US-303 : sans
 * adaptateurs, 503).
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
    ctr: CtrLegalOptions,
    cat?: CatHostOptions,
    kyc?: KycIdentityOptions,
    search?: CatSearchOptions,
    checkout?: AvlCheckoutOptions,
    trp?: TrpInspectionOptions,
  ): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        AppModule,
        // en premier : son garde global (débit par IP, anti-robot) passe avant toute route
        RiskHttpModule.register(risk),
        IamAuthModule.register(iam),
        // après IAM : routes /legal gardées par SessionGuard ; TermsGuard pour les réservations
        CtrLegalModule.register(ctr),
        // après IAM : routes /host/accounts/{orgId}/… gardées par SessionGuard (US-115)
        CatHostModule.register(cat),
        // US-201 : recherche publique /search (après le garde global de débit) ; sans adaptateurs, 503
        CatSearchModule.register(search),
        // US-208 : routes /checkout/… gardées par SessionGuard + TermsGuard (après IAM et CTR)
        AvlCheckoutModule.register(checkout),
        // US-303 : photos d'état du véhicule /trips/{tripId}/inspections/… gardées par SessionGuard +
        // TermsGuard (après IAM et CTR) ; sans adaptateurs, 503
        TrpInspectionModule.register(trp),
        // après IAM : routes /identity gardées par SessionGuard ; rappels /kyc/webhooks (US-105)
        KycIdentityModule.register(kyc),
        PayWebhookModule.register(pay),
        StaffConsoleModule.register(staff),
        SupConsoleModule.register(sup),
        BrandModule.register(brand),
        // US-125 : avertissements réglementaires par pays (route publique, configuration pays)
        RegulatoryNoticesModule,
        SupBrandConsoleModule,
        SupSecurityConsoleModule,
      ],
    };
  }
}
