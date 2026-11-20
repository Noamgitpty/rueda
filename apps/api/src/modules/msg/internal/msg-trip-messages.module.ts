/**
 * Module Nest de la messagerie par trip (US-525, ADR-181 : routes /trips/{tripId}/messages ;
 * US-316, ADR-186 : rendez-vous /trips/{tripId}/meetings).
 * Module DYNAMIQUE, importé par le seul processus API (`api.module.ts`), après `IamAuthModule` (il
 * utilise `SessionGuard`).
 *
 * Adaptateurs choisis par l'appelant :
 * - production : `postgresMsgAdapters(pool)` (fonctions de 0161 sous `app_api`) ;
 * - tests : FAKE du magasin (`../testing/`, absent de la compilation de production).
 * Sans options : magasin indisponible, 503 (fail-closed).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { MSG_TRIP_MEETINGS_SERVICE, MSG_TRIP_MESSAGES_SERVICE } from './tokens.js';
import { UnavailableTripMeetingStore } from './trip-meeting-store.js';
import type { TripMeetingStore } from './trip-meeting-store.js';
import { TripMeetingsController } from './trip-meetings.controller.js';
import { TripMeetingsService } from './trip-meetings.service.js';
import { TripMessagesController } from './trip-messages.controller.js';
import { UnavailableTripMessageStore } from './trip-message-store.js';
import { TripMessagesService } from './trip-messages.service.js';
import type { TripMessagesDeps } from './trip-messages.service.js';

export interface MsgTripMessagesOptions extends TripMessagesDeps {
  /** Rendez-vous du trip (US-316) ; absent : magasin indisponible (503). */
  readonly meetings?: TripMeetingStore;
}

/** Journal de la messagerie : codes et SQLSTATE seulement, jamais le texte d'un message. */
export const msgConsoleLogger: TripMessagesDeps['log'] = {
  warn: (message, fields) => {
    console.warn(JSON.stringify({ level: 'warn', module: 'MSG', message, ...fields }));
  },
};

/** Options fail-closed : aucun magasin. */
export function unavailableMsgOptions(): MsgTripMessagesOptions {
  return {
    store: new UnavailableTripMessageStore(),
    meetings: new UnavailableTripMeetingStore(),
    log: msgConsoleLogger,
  };
}

@Module({})
export class MsgTripMessagesModule {
  static register(options: MsgTripMessagesOptions = unavailableMsgOptions()): DynamicModule {
    return {
      module: MsgTripMessagesModule,
      controllers: [TripMessagesController, TripMeetingsController],
      providers: [
        { provide: MSG_TRIP_MESSAGES_SERVICE, useValue: new TripMessagesService(options) },
        {
          provide: MSG_TRIP_MEETINGS_SERVICE,
          useValue: new TripMeetingsService({
            meetings: options.meetings ?? new UnavailableTripMeetingStore(),
            log: options.log,
          }),
        },
      ],
    };
  }
}
