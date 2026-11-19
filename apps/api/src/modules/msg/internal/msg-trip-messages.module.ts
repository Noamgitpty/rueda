/**
 * Module Nest de la messagerie par trip (US-525, ADR-181 : routes /trips/{tripId}/messages).
 * Module DYNAMIQUE, importé par le seul processus API (`api.module.ts`), après `IamAuthModule` (il
 * utilise `SessionGuard`).
 *
 * Adaptateurs choisis par l'appelant :
 * - production : `postgresMsgAdapters(pool)` (fonctions de 0160 sous `app_api`) ;
 * - tests : FAKE du magasin (`../testing/`, absent de la compilation de production).
 * Sans options : magasin indisponible, 503 (fail-closed).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { MSG_TRIP_MESSAGES_SERVICE } from './tokens.js';
import { TripMessagesController } from './trip-messages.controller.js';
import { UnavailableTripMessageStore } from './trip-message-store.js';
import { TripMessagesService } from './trip-messages.service.js';
import type { TripMessagesDeps } from './trip-messages.service.js';

export type MsgTripMessagesOptions = TripMessagesDeps;

/** Journal de la messagerie : codes et SQLSTATE seulement, jamais le texte d'un message. */
export const msgConsoleLogger: TripMessagesDeps['log'] = {
  warn: (message, fields) => {
    console.warn(JSON.stringify({ level: 'warn', module: 'MSG', message, ...fields }));
  },
};

/** Options fail-closed : aucun magasin. */
export function unavailableMsgOptions(): MsgTripMessagesOptions {
  return { store: new UnavailableTripMessageStore(), log: msgConsoleLogger };
}

@Module({})
export class MsgTripMessagesModule {
  static register(options: MsgTripMessagesOptions = unavailableMsgOptions()): DynamicModule {
    return {
      module: MsgTripMessagesModule,
      controllers: [TripMessagesController],
      providers: [
        { provide: MSG_TRIP_MESSAGES_SERVICE, useValue: new TripMessagesService(options) },
      ],
    };
  }
}
