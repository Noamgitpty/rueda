/**
 * Détection automatique des retards (US-305, ADR-188 ; 19 US-305 ; 16 TRP-035 ; 08 BR-RETURN-03 ;
 * 17 §2.5 « Retard et prolongation tacite », C10 ; migration 0168).
 *
 * - Tâche périodique `trip_overdue` (60 s, PROPOSÉ : 16 TRP-035 « chaque minute ») : la base liste
 *   les trips à traiter (`core.trip_overdue_due`), puis chaque trip est traité dans SA transaction
 *   (`core.trip_cmd_detect_overdue` : verrous du voyageur puis du véhicule, heure serveur lue après
 *   les verrous, IN_PROGRESS → OVERDUE, dossier `trip_ops_overdue_case`, prolongation tacite de
 *   l'occupation bornée par l'occupation suivante, trip suivant marqué à risque). Un trip en échec
 *   ne bloque jamais les suivants ; les échecs sont comptés et alertés (`TRIP_OVERDUE_FAILED`, P1),
 *   par leur code seulement.
 * - Consommateur `trip_overdue_alert` : l'ops reçoit UNE alerte par événement
 *   `trip.overdue.detected` (`TRIP_OVERDUE_DETECTED`) et `trip.at_risk.flagged`
 *   (`TRIP_NEXT_AT_RISK`, P1 : voyageur suivant à reloger, 16 TRP-035, EC-19), dans la transaction
 *   du reçu (`inbox_receipt`) : un rejeu du même événement ne renvoie rien. Le voyageur et l'hôte
 *   sont prévenus par NTF (`EVT_TRIP_OVERDUE`, `EVT_TRIP_AT_RISK_HOST`), sur les mêmes événements.
 *
 * La base n'écrit l'événement `trip.overdue.detected` qu'à l'ouverture du dossier (unique par
 * trip) : minuterie rejouée, deux travailleurs, trip déjà en retard ⇒ aucune seconde alerte. Aucun
 * montant, aucune écriture d'argent : le frais de retard est porté par US-703.
 *
 * Journaux et alertes : des comptes et des codes, jamais un identifiant ni une donnée personnelle
 * (17 §6.3).
 */
import type {
  AlertChannel,
  BusRegistry,
  DomainEvent,
  SqlClient,
  WorkerTransactions,
} from '../../../bus/index.js';

/** Nom de travailleur exigé par la base (0168) : seul écrivain des retards. */
export const TRIP_OVERDUE_WORKER = 'trip_overdue';
/** Consommateur des alertes de l'ops (une par événement, reçu de l'inbox). */
export const TRIP_OVERDUE_ALERT_WORKER = 'trip_overdue_alert';
export const TRIP_OVERDUE_DETECTED_EVENT = 'trip.overdue.detected';
export const TRIP_AT_RISK_FLAGGED_EVENT = 'trip.at_risk.flagged';

/** Valeurs PROPOSÉES (ADR-188). */
export const TRIP_OVERDUE_DEFAULTS = {
  /** 16 TRP-035 : « tâche planifiée (chaque minute, PROPOSÉ) ». */
  periodSeconds: 60,
  /** Trips traités par passage, un par transaction (borne de la base : 1 000). */
  batch: 200,
  /** Reprise d'un interblocage (SQLSTATE 40P01) : 3 essais au plus (comme les autres tâches). */
  deadlockAttempts: 3,
} as const;

/** Issues de `core.trip_cmd_detect_overdue` (0168). */
export const DETECTION_OUTCOMES = [
  'DETECTED',
  'CASE_OPENED',
  'EXTENDED',
  'UNCHANGED',
  'NOT_DUE',
  'SKIPPED',
] as const;
export type DetectionOutcome = (typeof DETECTION_OUTCOMES)[number];

export interface DetectionResult {
  readonly outcome: DetectionOutcome;
  /** Trip suivant du véhicule marqué à risque dans cette transaction (C10). */
  readonly nextAtRisk: boolean;
}

export interface OverduePassCounts {
  readonly candidates: number;
  readonly detected: number;
  readonly extended: number;
  readonly next_at_risk: number;
  readonly unchanged: number;
  readonly failed: number;
}

/** Lecture stricte de la réponse de la base : une forme inattendue est une erreur, jamais ignorée. */
export function parseDetection(value: unknown): DetectionResult {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('détection du retard : réponse absente');
  }
  const r = value as { outcome?: unknown; nextAtRisk?: unknown };
  if (
    typeof r.outcome !== 'string' ||
    !(DETECTION_OUTCOMES as readonly string[]).includes(r.outcome)
  ) {
    throw new TypeError('détection du retard : issue inconnue');
  }
  return { outcome: r.outcome as DetectionOutcome, nextAtRisk: r.nextAtRisk === true };
}

const sqlStateOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'UNKNOWN';

const isDeadlock = (error: unknown): boolean => sqlStateOf(error) === '40P01';

export interface OverdueDetectorOptions {
  readonly transactions: WorkerTransactions;
  readonly alerts: AlertChannel;
  readonly log: (line: string) => void;
  readonly batch?: number;
  readonly deadlockAttempts?: number;
}

/** Un passage : liste de la base, puis un trip par transaction. */
export class OverdueDetector {
  readonly #o: OverdueDetectorOptions;

  constructor(options: OverdueDetectorOptions) {
    this.#o = options;
  }

  async runPass(listTx: SqlClient): Promise<OverduePassCounts> {
    const batch = this.#o.batch ?? TRIP_OVERDUE_DEFAULTS.batch;
    const { rows } = await listTx.query<{ trip_id: string }>(
      'SELECT trip_id FROM core.trip_overdue_due($1)',
      [batch],
    );
    let detected = 0;
    let extended = 0;
    let nextAtRisk = 0;
    let unchanged = 0;
    let failed = 0;
    const failures = new Map<string, number>();
    for (const row of rows) {
      try {
        const r = await this.#detectOne(row.trip_id);
        if (r.outcome === 'DETECTED' || r.outcome === 'CASE_OPENED') detected++;
        else if (r.outcome === 'EXTENDED') extended++;
        else unchanged++;
        if (r.nextAtRisk) nextAtRisk++;
      } catch (error) {
        // un trip en échec (paramètre absent, invariant) ne bloque jamais les suivants : compté,
        // alerté par son SQLSTATE seulement (aucun identifiant, 17 §6.3)
        failed++;
        const code = sqlStateOf(error);
        failures.set(code, (failures.get(code) ?? 0) + 1);
      }
    }
    for (const [code, n] of [...failures].sort(([a], [b]) => a.localeCompare(b))) {
      this.#o.log(
        JSON.stringify({ level: 'warn', worker: TRIP_OVERDUE_WORKER, error: code, failed: n }),
      );
      await this.#o.alerts.send({
        code: 'TRIP_OVERDUE_FAILED',
        severity: 'P1',
        counts: { failed: n },
        labels: { error_code: /^[A-Za-z]/.test(code) ? code : `SQL_${code}` },
      });
    }
    const counts: OverduePassCounts = {
      candidates: rows.length,
      detected,
      extended,
      next_at_risk: nextAtRisk,
      unchanged,
      failed,
    };
    this.#o.log(JSON.stringify({ level: 'info', worker: TRIP_OVERDUE_WORKER, ...counts }));
    return counts;
  }

  async #detectOne(tripId: string): Promise<DetectionResult> {
    const attempts = this.#o.deadlockAttempts ?? TRIP_OVERDUE_DEFAULTS.deadlockAttempts;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.#o.transactions.run(TRIP_OVERDUE_WORKER, async (tx) => {
          const { rows } = await tx.query<{ r: unknown }>(
            'SELECT core.trip_cmd_detect_overdue($1::uuid) AS r',
            [tripId],
          );
          return parseDetection(rows[0]?.r);
        });
      } catch (error) {
        if (!isDeadlock(error) || attempt >= attempts) throw error;
      }
    }
  }
}

const COUNTRY = /^[A-Z]{2}$/;

/**
 * Alerte de l'ops pour un événement du retard : un code, un compte, le pays de l'événement. Un
 * événement sans pays valide est une erreur de contrat (lettre morte et alerte du bus), jamais
 * une alerte sans pays.
 */
export async function alertOps(event: DomainEvent, alerts: AlertChannel): Promise<void> {
  const country = event.countryCode;
  if (country === null || !COUNTRY.test(country)) {
    throw new TypeError(`${event.type} : pays de l’événement absent`);
  }
  if (event.type === TRIP_OVERDUE_DETECTED_EVENT) {
    await alerts.send({
      code: 'TRIP_OVERDUE_DETECTED',
      severity: 'P2',
      counts: { overdue: 1 },
      labels: { country },
    });
    return;
  }
  if (event.type === TRIP_AT_RISK_FLAGGED_EVENT) {
    await alerts.send({
      code: 'TRIP_NEXT_AT_RISK',
      severity: 'P1',
      counts: { at_risk: 1 },
      labels: { country },
    });
    return;
  }
  throw new TypeError(`type d’événement inattendu : ${event.type}`);
}

/** Déclare la tâche périodique `trip_overdue` et le consommateur `trip_overdue_alert`. */
export function registerOverdueDetection(
  registry: BusRegistry,
  transactions: WorkerTransactions,
  alerts: AlertChannel,
  log: (line: string) => void,
): void {
  const detector = new OverdueDetector({ transactions, alerts, log });
  registry.registerPeriodic(
    TRIP_OVERDUE_WORKER,
    TRIP_OVERDUE_DEFAULTS.periodSeconds,
    async (_payload, tx) => {
      await detector.runPass(tx);
    },
  );
  registry.registerConsumer(
    TRIP_OVERDUE_ALERT_WORKER,
    [TRIP_OVERDUE_DETECTED_EVENT, TRIP_AT_RISK_FLAGGED_EVENT],
    (event) => alertOps(event, alerts),
  );
}
