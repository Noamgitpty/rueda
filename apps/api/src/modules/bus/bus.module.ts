import { Module } from '@nestjs/common';
import { ALERTER, LogAlerter } from './internal/alerts.js';
import { BusRegistry } from './internal/registry.js';

/**
 * Module BUS — outbox transactionnelle, consommation idempotente, lettres mortes et tâches
 * planifiées (17 §4.1, §4.2 ; US-008 ; ADR-011, ADR-050).
 *
 * Fournit le registre des abonnements (un seul par processus) et le port d'alerte. Le relais et
 * l'exécuteur de files (`OutboxRelay`, `JobRunner`) sont construits par le processus travailleur
 * avec ses connexions (`workerTransactions`) : le câblage du pool et des secrets arrive avec US-003.
 */
@Module({
  providers: [
    { provide: BusRegistry, useValue: new BusRegistry() },
    { provide: ALERTER, useClass: LogAlerter },
  ],
  exports: [BusRegistry, ALERTER],
})
export class BusModule {}
