/**
 * Module Nest du tableau de sécurité (US-052), importé par le seul processus API après
 * `StaffConsoleModule` (StaffGuard) et `RiskHttpModule` de RISK (ABUSE_BOARD_STORE), tous deux
 * globaux.
 */
import { Module } from '@nestjs/common';
import { SecurityConsoleController } from './security-console.controller.js';

@Module({ controllers: [SecurityConsoleController] })
export class SupSecurityConsoleModule {}
