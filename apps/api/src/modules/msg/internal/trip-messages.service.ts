/**
 * Messagerie par trip (US-525, ADR-181 ; 16 MSG-001 / MSG-007 ; écran S16).
 *
 * - **Lecture** : fil du trip pour une partie du trip de la session (voyageur, titulaire du compte
 *   d'hôte, co-hôte dont la portée couvre le véhicule) ; texte MASQUÉ seulement, prénoms seulement.
 *   Toute autre personne, trip inconnu ou identifiant mal formé ⇒ 404 `TRIP_NOT_FOUND`, même
 *   réponse (17 §2.3 point 5).
 * - **Envoi** : corps `{ id, body }` (identifiant choisi par le client : un réessai ne crée pas de
 *   doublon). La base masque les coordonnées et signale le marché gris, sans jamais refuser un
 *   texte légitime ; la réponse porte les rappels à montrer à l'expéditeur
 *   (`CONTACT_MASKED`, `OFF_PLATFORM_PAYMENT`). Après la fin du trip + `review_window_days` :
 *   409 `MESSAGE_THREAD_CLOSED`.
 * - **Aucun texte de message dans un journal ni dans une erreur** : seuls des codes et un SQLSTATE
 *   sont journalisés.
 *
 * Fail-closed : base illisible ou forme inattendue ⇒ 503 `MESSAGES_UNAVAILABLE`.
 */
import { msgBody, MsgHttpError } from './errors.js';
import type { MsgBody, MsgCode } from './errors.js';
import { TripMessageStoreError } from './trip-message-store.js';
import type {
  PostResult,
  ThreadReadResult,
  TripMessageStore,
  ViewerRole,
} from './trip-message-store.js';

export interface MsgLogger {
  warn(message: string, fields: Readonly<Record<string, string | number>>): void;
}

export interface TripMessagesDeps {
  readonly store: TripMessageStore;
  readonly log: MsgLogger;
}

/** Plafond de la lecture (borne de la base : 200 derniers messages). */
export const THREAD_PAGE = 200;
/** Borne du texte (même borne que la base, en caractères). */
export const BODY_MAX_CHARS = 2000;

export const NOTICES = ['CONTACT_MASKED', 'OFF_PLATFORM_PAYMENT'] as const;
export type Notice = (typeof NOTICES)[number];

export interface TripMessageView {
  readonly id: string;
  readonly mine: boolean;
  readonly authorRole: ViewerRole;
  readonly authorName: string | null;
  readonly body: string | null;
  readonly masked: boolean;
  readonly offPlatform: boolean;
  readonly sentAt: string;
  /** Texte effacé par la rétention (US-316) ; `body` est alors `null`. */
  readonly purged: boolean;
}

export interface TripThreadView extends MsgBody {
  readonly code: 'TRIP_MESSAGES';
  readonly tripId: string;
  readonly viewerRole: ViewerRole;
  readonly counterpartName: string | null;
  readonly writable: boolean;
  readonly closesAt: string | null;
  readonly timezone: string;
  readonly messages: readonly TripMessageView[];
}

/** Message enregistré, tel que servi aux parties (texte masqué). */
export interface SentMessageView {
  readonly id: string;
  readonly body: string;
  readonly masked: boolean;
  readonly offPlatform: boolean;
  readonly sentAt: string;
}

export interface MessageSentView extends MsgBody {
  readonly code: 'MESSAGE_SENT';
  readonly message: SentMessageView;
  readonly notices: readonly Notice[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const REFUSALS: Readonly<Record<Exclude<PostResult['outcome'], 'DONE'>, MsgCode>> = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  NOT_FOUND: 'TRIP_NOT_FOUND',
  MESSAGE_THREAD_CLOSED: 'MESSAGE_THREAD_CLOSED',
  MESSAGE_INVALID: 'MESSAGE_INVALID',
  REQUEST_INVALID: 'REQUEST_INVALID',
};

export class TripMessagesService {
  readonly #store: TripMessageStore;
  readonly #log: MsgLogger;

  constructor(deps: TripMessagesDeps) {
    this.#store = deps.store;
    this.#log = deps.log;
  }

  /** Identifiant de trip mal formé ⇒ 404, comme un trip inconnu (aucun oracle). */
  static tripOf(tripId: string): string {
    if (!UUID.test(tripId)) throw new MsgHttpError('TRIP_NOT_FOUND');
    return tripId;
  }

  #unavailable(operation: string, error: unknown): MsgHttpError {
    // jamais le texte d'un message : opération et SQLSTATE seulement
    this.#log.warn('MESSAGES_UNAVAILABLE', {
      operation,
      sqlstate: error instanceof TripMessageStoreError ? (error.sqlstate ?? 'none') : 'none',
    });
    return new MsgHttpError('MESSAGES_UNAVAILABLE');
  }

  async thread(proof: Buffer | null, tripId: string): Promise<TripThreadView> {
    if (proof === null) throw new MsgHttpError('AUTH_REQUIRED');
    const trip = TripMessagesService.tripOf(tripId);
    let r: ThreadReadResult;
    try {
      r = await this.#store.read(proof, trip, THREAD_PAGE);
    } catch (error) {
      throw this.#unavailable('read', error);
    }
    if (r.outcome !== 'DONE') {
      if (r.outcome === 'AUTH_REQUIRED') throw new MsgHttpError('AUTH_REQUIRED');
      if (r.outcome === 'NOT_FOUND') throw new MsgHttpError('TRIP_NOT_FOUND');
      // limite hors borne : jamais envoyée par l'API ; une telle issue est une incohérence
      throw this.#unavailable('read', undefined);
    }
    return {
      ...(msgBody('TRIP_MESSAGES') as MsgBody & { code: 'TRIP_MESSAGES' }),
      tripId: trip,
      viewerRole: r.viewerRole,
      counterpartName: r.counterpartName,
      writable: r.writable,
      closesAt: r.closesAt === null ? null : r.closesAt.toISOString(),
      timezone: r.timezone,
      messages: r.messages.map((m) => ({ ...m, sentAt: m.sentAt.toISOString() })),
    };
  }

  async post(proof: Buffer | null, tripId: string, body: unknown): Promise<MessageSentView> {
    if (proof === null) throw new MsgHttpError('AUTH_REQUIRED');
    const trip = TripMessagesService.tripOf(tripId);
    if (!isRecord(body) || Object.keys(body).some((k) => k !== 'id' && k !== 'body')) {
      throw new MsgHttpError('REQUEST_INVALID');
    }
    const id = body['id'];
    const text = body['body'];
    if (typeof id !== 'string' || !UUID.test(id) || typeof text !== 'string') {
      throw new MsgHttpError('REQUEST_INVALID');
    }
    // borne grossière avant la base (la base juge le texte après les blancs de bord)
    if ([...text].length > BODY_MAX_CHARS * 2) throw new MsgHttpError('MESSAGE_INVALID');
    let r: PostResult;
    try {
      r = await this.#store.post(proof, trip, id, text);
    } catch (error) {
      throw this.#unavailable('post', error);
    }
    if (r.outcome !== 'DONE') throw new MsgHttpError(REFUSALS[r.outcome]);
    const notices: Notice[] = [];
    if (r.masked) notices.push('CONTACT_MASKED');
    if (r.offPlatform) notices.push('OFF_PLATFORM_PAYMENT');
    if (notices.length > 0) {
      // signal journalisé par codes seulement (le texte reste en base, hors journaux)
      this.#log.warn('MESSAGE_FLAGGED', { notices: notices.join(',') });
    }
    return {
      ...(msgBody('MESSAGE_SENT') as MsgBody & { code: 'MESSAGE_SENT' }),
      message: {
        id: r.id,
        body: r.body,
        masked: r.masked,
        offPlatform: r.offPlatform,
        sentAt: r.sentAt.toISOString(),
      },
      notices,
    };
  }
}
