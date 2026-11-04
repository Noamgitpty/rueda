/**
 * Moniteur d'exploitation (US-004, ADR-080 ; 17 §6.3 ; 16 ADM-032, NFR-15), travailleur
 * `ops_monitor`. Une passe périodique lit `core.ops_monitor_metrics` (migration 0051 : comptes
 * seulement) et envoie une alerte par dépassement sur le port `AlertChannel`.
 *
 * | Métrique (0051)              | Alerte                  | Sévérité | Seuil (PROPOSÉ)                     |
 * | ---------------------------- | ----------------------- | -------- | ----------------------------------- |
 * | `outbox_oldest_age_s`        | `OPS_OUTBOX_STALE`      | P1       | > 120 s (17 §6.3)                   |
 * | `webhook_failing`            | `OPS_WEBHOOK_FAILING`   | P1       | ≥ 1 webhook en échec 3 fois (ADM-032)|
 * | `payment_unknown_30m`        | `OPS_PAYMENT_UNKNOWN`   | P1       | ≥ 1 opération UNKNOWN > 30 min      |
 * | `webhook_signature_rejected` | `OPS_WEBHOOK_SIGNATURE` | P2       | ≥ 1 depuis la passe précédente      |
 * | `p1_event`                   | `OPS_P1_EVENT`          | P1       | ≥ 1 depuis la passe précédente      |
 *
 * Jauges (trois premières lignes) : une alerte au premier dépassement, puis seulement si la valeur
 * monte ou toutes les `realertSeconds` tant qu'elle reste au-dessus du seuil ; l'état est oublié dès
 * qu'elle repasse sous le seuil. Compteurs (deux dernières) : une alerte par passe non nulle. Les
 * alertes P1 déjà écrites dans l'outbox par la base (oracle C12, invariant de conversion,
 * disposition en retard, plafond SMS) sont ainsi relayées sans qu'aucun module ne connaisse le canal.
 *
 * Livraison : l'état d'une jauge n'avance qu'après l'envoi réussi de son alerte ; une alerte non
 * conforme est écartée et comptée sans bloquer la passe (revue sécurité US-004).
 *
 * Fenêtre des compteurs : depuis l'horloge de la base lue à la passe précédente (`platform.now()`),
 * au premier passage depuis `periodSeconds`. Livraison « au moins une fois » : une passe en échec
 * est rejouée par le bus et peut renvoyer les mêmes alertes ; un événement validé après la lecture
 * de l'horloge mais daté avant elle peut échapper au compteur (transaction longue) : la jauge de
 * l'outbox et l'oracle quotidien restent les filets.
 */
import { UnsafeAlertError } from './alert-channel.js';
import type { AlertChannel, AlertSeverity, OpsAlert } from './alert-channel.js';
import type { BusRegistry } from './registry.js';
import type { SqlClient } from './sql.js';

export const OPS_MONITOR_WORKER = 'ops_monitor';

/** Valeurs PROPOSÉES (ADR-080) ; seuils de 17 §6.3 et d'ADM-032. */
export const OPS_MONITOR_DEFAULTS = {
  periodSeconds: 60,
  outboxStaleSeconds: 120,
  webhookFailures: 3,
  realertSeconds: 1_800,
} as const;

export type OpsMonitorOptions = { -readonly [K in keyof typeof OPS_MONITOR_DEFAULTS]: number };

export interface OpsMetricRow {
  readonly metric: string;
  readonly label: string | null;
  readonly country_code: string | null;
  readonly value: string | number;
}

export class OpsMonitorContractError extends Error {
  constructor(reason: string) {
    super(`ops_monitor : ${reason}`);
    this.name = 'OpsMonitorContractError';
  }
}

interface Rule {
  readonly code: OpsAlert['code'];
  readonly severity: AlertSeverity;
  readonly gauge: boolean;
  readonly label: 'provider' | 'event_type' | null;
  readonly breached: (value: number, o: OpsMonitorOptions) => boolean;
}

const RULES: Readonly<Record<string, Rule>> = {
  outbox_oldest_age_s: {
    code: 'OPS_OUTBOX_STALE',
    severity: 'P1',
    gauge: true,
    label: null,
    breached: (v, o) => v > o.outboxStaleSeconds,
  },
  webhook_failing: {
    code: 'OPS_WEBHOOK_FAILING',
    severity: 'P1',
    gauge: true,
    label: 'provider',
    breached: (v) => v > 0,
  },
  payment_unknown_30m: {
    code: 'OPS_PAYMENT_UNKNOWN',
    severity: 'P1',
    gauge: true,
    label: null,
    breached: (v) => v > 0,
  },
  webhook_signature_rejected: {
    code: 'OPS_WEBHOOK_SIGNATURE',
    severity: 'P2',
    gauge: false,
    label: 'provider',
    breached: (v) => v > 0,
  },
  p1_event: {
    code: 'OPS_P1_EVENT',
    severity: 'P1',
    gauge: false,
    label: 'event_type',
    breached: (v) => v > 0,
  },
};

const toCount = (value: string | number): number => {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 0) throw new OpsMonitorContractError('compte attendu');
  return n;
};

interface PlannedAlert {
  readonly alert: OpsAlert;
  /** Retient l'état de la jauge ; appelé seulement après un envoi réussi. */
  readonly commit: () => void;
}

export interface OpsMonitorPass {
  readonly metrics: number;
  /** Alertes envoyées. */
  readonly alerts: number;
  /** Alertes non conformes écartées (jamais envoyées tronquées). */
  readonly rejected: number;
}

interface GaugeState {
  readonly value: number;
  readonly at: number;
}

export class OpsMonitor {
  readonly #channel: AlertChannel;
  readonly #options: OpsMonitorOptions;
  readonly #gauges = new Map<string, GaugeState>();
  #since: Date | null = null;

  constructor(channel: AlertChannel, options: Partial<OpsMonitorOptions> = {}) {
    this.#channel = channel;
    this.#options = { ...OPS_MONITOR_DEFAULTS, ...options };
  }

  /**
   * Alertes d'une passe SANS changer l'état : chaque alerte de jauge porte l'état à retenir une fois
   * l'envoi réussi (`commit`). Les jauges revenues sous le seuil sont oubliées aussitôt (aucun envoi
   * en jeu).
   */
  #plan(rows: readonly OpsMetricRow[], at: Date): PlannedAlert[] {
    const planned: PlannedAlert[] = [];
    const seen = new Set<string>();
    const now = at.getTime();
    for (const row of rows) {
      const rule = RULES[row.metric];
      // métrique inconnue : contrat rompu entre la base et le code (fail-closed, jamais ignorée)
      if (rule === undefined) throw new OpsMonitorContractError('métrique inconnue');
      const value = toCount(row.value);
      if (!rule.breached(value, this.#options)) continue;
      const labels: Record<string, string> = {};
      if (rule.label !== null && row.label !== null) labels[rule.label] = row.label;
      if (row.country_code !== null) labels['country'] = row.country_code;
      const alert: OpsAlert = {
        code: rule.code,
        severity: rule.severity,
        counts: { value },
        labels,
      };
      if (!rule.gauge) {
        planned.push({ alert, commit: () => undefined });
        continue;
      }
      const key = `${row.metric}|${row.label ?? ''}|${row.country_code ?? ''}`;
      seen.add(key);
      const previous = this.#gauges.get(key);
      if (
        previous === undefined ||
        value > previous.value ||
        now - previous.at >= this.#options.realertSeconds * 1000
      ) {
        planned.push({
          alert,
          commit: () => {
            this.#gauges.set(key, { value, at: now });
          },
        });
      }
    }
    // jauge revenue sous le seuil (ou absente) : état oublié, le prochain dépassement alerte
    for (const key of [...this.#gauges.keys()]) {
      if (!seen.has(key)) this.#gauges.delete(key);
    }
    return planned;
  }

  /** Alertes d'une passe, considérées comme livrées (état des jauges mis à jour). */
  evaluate(rows: readonly OpsMetricRow[], at: Date): OpsAlert[] {
    return this.#plan(rows, at).map((p) => {
      p.commit();
      return p.alert;
    });
  }

  /**
   * Une passe dans la transaction du travailleur `ops_monitor`. L'état d'une jauge n'avance
   * qu'APRÈS l'envoi réussi de son alerte : un envoi en échec la renvoie à la passe suivante. Une
   * alerte non conforme (`UnsafeAlertError`) est écartée et comptée (`rejected`) sans bloquer les
   * autres. Si un envoi a échoué, toutes les autres sont tentées, puis la passe échoue (le bus la
   * rejoue) et la fenêtre des compteurs n'avance pas : livraison « au moins une fois ».
   */
  async run(tx: SqlClient): Promise<OpsMonitorPass> {
    const clock = await tx.query<{ at: Date }>('SELECT platform.now() AS at');
    const at = clock.rows[0]?.at;
    if (!(at instanceof Date)) throw new OpsMonitorContractError('horloge de la base illisible');
    const since = this.#since ?? new Date(at.getTime() - this.#options.periodSeconds * 1000);
    const { rows } = await tx.query<OpsMetricRow>(
      'SELECT metric, label, country_code, value FROM core.ops_monitor_metrics($1, $2)',
      [since, this.#options.webhookFailures],
    );
    let sent = 0;
    let rejected = 0;
    let failure: unknown = null;
    for (const p of this.#plan(rows, at)) {
      try {
        await this.#channel.send(p.alert);
        p.commit();
        sent += 1;
      } catch (error) {
        if (error instanceof UnsafeAlertError) rejected += 1;
        else failure ??= error;
      }
    }
    if (failure !== null) throw failure;
    this.#since = at;
    return { metrics: rows.length, alerts: sent, rejected };
  }
}

/** Déclare la tâche périodique `ops_monitor` (comptes journalisés, jamais d'identifiant). */
export function registerOpsMonitor(
  registry: BusRegistry,
  channel: AlertChannel,
  log: (line: string) => void,
  options: Partial<OpsMonitorOptions> = {},
): OpsMonitor {
  const monitor = new OpsMonitor(channel, options);
  registry.registerPeriodic(
    OPS_MONITOR_WORKER,
    options.periodSeconds ?? OPS_MONITOR_DEFAULTS.periodSeconds,
    async (_payload, tx) => {
      const r = await monitor.run(tx);
      log(
        JSON.stringify({
          level: r.rejected > 0 ? 'error' : 'info',
          worker: OPS_MONITOR_WORKER,
          ...r,
        }),
      );
    },
  );
  return monitor;
}
