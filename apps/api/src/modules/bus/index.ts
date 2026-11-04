// Point d'entrée public du module BUS. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, bus.module.ts) est privé (règle rueda/module-boundaries).
export { BusModule } from './bus.module.js';
export {
  ALERT_CODES,
  ALERT_LABEL_KEYS,
  alertLogLine,
  assertSafeAlert,
  ChannelAlerter,
  LogAlertChannel,
  UnsafeAlertError,
} from './internal/alert-channel.js';
export type {
  AlertChannel,
  AlertCode,
  AlertLabelKey,
  AlertSeverity,
  OpsAlert,
} from './internal/alert-channel.js';
export { ALERTER, LogAlerter } from './internal/alerts.js';
export type { Alerter, DeadLetterAlert } from './internal/alerts.js';
export { EnvelopeError, errorCode, validateNewEvent } from './internal/envelope.js';
export type {
  DomainEvent,
  EventActor,
  JsonObject,
  JsonValue,
  NewDomainEvent,
} from './internal/envelope.js';
export { JOB_RUNNER_DEFAULTS, JobRunner } from './internal/job-runner.js';
export type { JobOutcome, JobRunnerOptions, RunResult } from './internal/job-runner.js';
export { BusMetrics, metricsLogLine, toSnapshot } from './internal/metrics.js';
export type { BusMetricsSnapshot, QueueDepth } from './internal/metrics.js';
export {
  OPS_MONITOR_DEFAULTS,
  OPS_MONITOR_WORKER,
  OpsMonitor,
  OpsMonitorContractError,
  registerOpsMonitor,
} from './internal/ops-monitor.js';
export type { OpsMetricRow, OpsMonitorOptions, OpsMonitorPass } from './internal/ops-monitor.js';
export { PeriodicScheduler } from './internal/periodic.js';
export { publishEvent } from './internal/publisher.js';
export {
  BUS_MONITOR_WORKER,
  BUS_SCHEDULER_WORKER,
  BusRegistry,
  OUTBOX_RELAY_WORKER,
  PERIODIC_SINGLETON_KEY,
} from './internal/registry.js';
export type { EventHandler, PeriodicSpec, TimerHandler } from './internal/registry.js';
export { OutboxRelay } from './internal/relay.js';
export type { OutboxRelayOptions, RelayResult } from './internal/relay.js';
export { scheduleJob, SPEC_MAX_ATTEMPTS } from './internal/scheduler.js';
export type { ScheduleJobInput } from './internal/scheduler.js';
export { workerTransactions } from './internal/sql.js';
export type { LeasedSqlClient, SqlClient, SqlResult, WorkerTransactions } from './internal/sql.js';
