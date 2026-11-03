/**
 * Port d'alerte des lettres mortes (17 §4.2 « puis file des lettres mortes » ; 19 US-008 « avec
 * alerte » ; 17 §6.3 alertes). L'alerte ne contient que des identifiants et un code d'erreur court :
 * ni charge utile, ni message d'erreur (journaux expurgés, 17 §6.3).
 */

export interface DeadLetterAlert {
  readonly consumer: string;
  readonly eventId: string | null;
  readonly jobId: string;
  readonly attempts: number;
  readonly errorCode: string;
}

export interface Alerter {
  deadLetter(alert: DeadLetterAlert): void | Promise<void>;
}

/** Jeton d'injection Nest du port. */
export const ALERTER = Symbol('bus.Alerter');

/** Adaptateur par défaut : une ligne JSON au niveau erreur, reprise par l'observabilité (17 §6.3). */
export class LogAlerter implements Alerter {
  readonly #log: (line: string) => void;

  constructor(
    log: (line: string) => void = (line) => {
      console.error(line);
    },
  ) {
    this.#log = log;
  }

  deadLetter(alert: DeadLetterAlert): void {
    this.#log(
      JSON.stringify({
        level: 'error',
        alert: 'bus.dead_letter',
        consumer: alert.consumer,
        event_id: alert.eventId,
        job_id: alert.jobId,
        attempts: alert.attempts,
        error_code: alert.errorCode,
      }),
    );
  }
}
