import { Module } from '@nestjs/common';
import { AudModule } from './modules/aud/index.js';
import { AvlModule } from './modules/avl/index.js';
import { BusModule } from './modules/bus/index.js';
import { CatModule } from './modules/cat/index.js';
import { CfgModule } from './modules/cfg/index.js';
import { ClmModule } from './modules/clm/index.js';
import { CtrModule } from './modules/ctr/index.js';
import { FinModule } from './modules/fin/index.js';
import { IamModule } from './modules/iam/index.js';
import { KycModule } from './modules/kyc/index.js';
import { MsgModule } from './modules/msg/index.js';
import { NtfModule } from './modules/ntf/index.js';
import { PayModule } from './modules/pay/index.js';
import { PrcModule } from './modules/prc/index.js';
import { PyoModule } from './modules/pyo/index.js';
import { RevModule } from './modules/rev/index.js';
import { RiskModule } from './modules/risk/index.js';
import { RptModule } from './modules/rpt/index.js';
import { StlModule } from './modules/stl/index.js';
import { SupModule } from './modules/sup/index.js';
import { TrpModule } from './modules/trp/index.js';

/** Tous les modules métier, dans l'ordre de 17 §2.2 (+ BUS, socle de §2.1). */
export const DOMAIN_MODULES = [
  IamModule,
  KycModule,
  CatModule,
  AvlModule,
  PrcModule,
  CtrModule,
  PayModule,
  StlModule,
  PyoModule,
  TrpModule,
  ClmModule,
  MsgModule,
  NtfModule,
  RevModule,
  SupModule,
  FinModule,
  RiskModule,
  CfgModule,
  AudModule,
  RptModule,
  BusModule,
] as const;

/** Module racine, partagé par les deux processus (API et travailleur). */
@Module({ imports: [...DOMAIN_MODULES] })
export class AppModule {}
