/**
 * Module Nest des avertissements réglementaires (US-125), importé par le seul processus API
 * (`api.module.ts`) : une route publique de lecture, servie depuis la configuration pays.
 */
import { Module } from '@nestjs/common';
import { CfgModule } from '../../cfg.module.js';
import { RegulatoryNoticesController } from './regulatory-notices.controller.js';

@Module({
  imports: [CfgModule],
  controllers: [RegulatoryNoticesController],
})
export class RegulatoryNoticesModule {}
