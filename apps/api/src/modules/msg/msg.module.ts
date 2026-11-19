import { Module } from '@nestjs/common';

/**
 * Module MSG — Messaging (17 §2.2). Coquille statique (US-001) ; les routes de la messagerie par
 * trip sont servies par le module dynamique `MsgTripMessagesModule` (US-525, ADR-181), importé par
 * le seul processus API.
 */
@Module({})
export class MsgModule {}
