import { Module } from '@nestjs/common';
import { CfgModule } from '../cfg/index.js';
import { QuoteService } from './internal/quote/quote.service.js';

/**
 * Module PRC — Pricing & Quotes (17 §2.2, §2.6). US-202 : moteur de devis versionné (fonction pure),
 * jours facturables, taxe par ligne, jambes de la capture, devis figé rejouable.
 */
@Module({
  imports: [CfgModule],
  providers: [QuoteService],
  exports: [QuoteService],
})
export class PrcModule {}
