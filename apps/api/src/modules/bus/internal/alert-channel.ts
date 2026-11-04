/**
 * Port d'alerte de l'exploitation (US-004, ADR-080 ; 17 §6.3 ; 16 ADM-032, NFR-15).
 *
 * Une alerte ne porte que des COMPTES et des CODES techniques, jamais une donnée personnelle ni un
 * identifiant d'objet (17 §6.3 « journaux expurgés ») : `code` et `severity` dans des listes
 * fermées, `counts` des entiers ≥ 0, `labels` des codes courts d'une liste fermée de clés (pays,
 * fournisseur, type d'événement, consommateur, code d'erreur). `assertSafeAlert` le vérifie avant
 * tout envoi, quel que soit l'adaptateur : une alerte non conforme est refusée (exception), jamais
 * envoyée tronquée.
 *
 * Adaptateurs :
 * - `LogAlertChannel` (production) : une ligne JSON `{"event":"ops.alert",…}` sur la sortie
 *   d'erreur ; l'hébergeur la transforme en notification (filtre de métrique et alarme, IaC
 *   `infra/opentofu/modules/environment/monitoring.tf`). Changer d'hébergeur ne touche pas au code
 *   (portabilité, US-036).
 * - `FakeAlertChannel` (`../testing/fake-alert-channel.ts`) : tests seulement, jamais dans l'image.
 */
import type { Alerter, DeadLetterAlert } from './alerts.js';

/** Codes d'alerte (liste fermée, PROPOSÉE ; seuils : `ops-monitor.ts`). */
export const ALERT_CODES = [
  'BUS_DEAD_LETTER',
  'OPS_OUTBOX_STALE',
  'OPS_PAYMENT_UNKNOWN',
  'OPS_WEBHOOK_FAILING',
  'OPS_WEBHOOK_SIGNATURE',
  'OPS_P1_EVENT',
] as const;
export type AlertCode = (typeof ALERT_CODES)[number];

export type AlertSeverity = 'P1' | 'P2';

/** Clés d'étiquette admises (codes techniques seulement). */
export const ALERT_LABEL_KEYS = [
  'country',
  'provider',
  'event_type',
  'consumer',
  'error_code',
] as const;
export type AlertLabelKey = (typeof ALERT_LABEL_KEYS)[number];

export interface OpsAlert {
  readonly code: AlertCode;
  readonly severity: AlertSeverity;
  readonly counts: Readonly<Record<string, number>>;
  readonly labels?: Readonly<Partial<Record<AlertLabelKey, string>>>;
}

export interface AlertChannel {
  send(alert: OpsAlert): Promise<void>;
}

export class UnsafeAlertError extends Error {
  constructor(reason: string) {
    super(`alerte refusée : ${reason}`);
    this.name = 'UnsafeAlertError';
  }
}

const COUNT_KEY = /^[a-z][a-z0-9_]{0,39}$/;
// code technique court : pas d'espace, pas d'@, pas de chiffres seuls (téléphone), pas d'UUID
const LABEL_VALUE = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;
const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const MAX_COUNTS = 16;

/** Vérifie qu'une alerte ne contient que des comptes et des codes ; lève sinon. */
export function assertSafeAlert(alert: OpsAlert): void {
  if (!(ALERT_CODES as readonly string[]).includes(alert.code)) {
    throw new UnsafeAlertError('code inconnu');
  }
  if (alert.severity !== 'P1' && alert.severity !== 'P2') {
    throw new UnsafeAlertError('sévérité inconnue');
  }
  const counts = Object.entries(alert.counts);
  if (counts.length === 0 || counts.length > MAX_COUNTS) {
    throw new UnsafeAlertError('comptes : 1 à 16 attendus');
  }
  for (const [key, value] of counts) {
    if (!COUNT_KEY.test(key) || !Number.isSafeInteger(value) || value < 0) {
      throw new UnsafeAlertError('compte invalide');
    }
  }
  for (const [key, value] of Object.entries(alert.labels ?? {})) {
    if (!(ALERT_LABEL_KEYS as readonly string[]).includes(key)) {
      throw new UnsafeAlertError('étiquette non admise');
    }
    if (typeof value !== 'string' || !LABEL_VALUE.test(value) || UUID_LIKE.test(value)) {
      throw new UnsafeAlertError('valeur d’étiquette non admise');
    }
  }
}

/** Ligne JSON d'une alerte (forme lue par le filtre de métrique de l'IaC). */
export function alertLogLine(alert: OpsAlert): string {
  assertSafeAlert(alert);
  return JSON.stringify({
    level: 'error',
    event: 'ops.alert',
    code: alert.code,
    severity: alert.severity,
    counts: alert.counts,
    labels: alert.labels ?? {},
  });
}

/** Adaptateur de production : une ligne JSON sur la sortie d'erreur (reprise par l'hébergeur). */
export class LogAlertChannel implements AlertChannel {
  readonly #log: (line: string) => void;

  constructor(
    log: (line: string) => void = (line) => {
      console.error(line);
    },
  ) {
    this.#log = log;
  }

  send(alert: OpsAlert): Promise<void> {
    this.#log(alertLogLine(alert));
    return Promise.resolve();
  }
}

const ERROR_CODE = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;

/**
 * Lettres mortes (US-008) relayées sur le canal d'alerte : consommateur, code d'erreur court et
 * nombre de tentatives. L'identifiant de l'événement et de la tâche restent dans le journal du
 * bus (`dead_letter`), pas dans l'alerte.
 */
export class ChannelAlerter implements Alerter {
  readonly #channel: AlertChannel;

  constructor(channel: AlertChannel) {
    this.#channel = channel;
  }

  deadLetter(alert: DeadLetterAlert): Promise<void> {
    return this.#channel.send({
      code: 'BUS_DEAD_LETTER',
      severity: 'P1',
      counts: { attempts: alert.attempts, dead_letters: 1 },
      labels: {
        consumer: alert.consumer,
        error_code: ERROR_CODE.test(alert.errorCode) ? alert.errorCode : 'UNKNOWN',
      },
    });
  }
}
