# BUS — Outbox & event bus (`apps/api/src/modules/bus`)

**BUS — Outbox et bus d'événements** : outbox transactionnelle et diffusion des événements de domaine (17 §4). Dépendances autorisées : aucune (module du socle, ne dépend de personne ; source : 17 §2.1 (socle, absent de la table §2.2)).

## Responsabilité

BUS écrit les événements de domaine dans l'outbox, dans la transaction du producteur, puis les diffuse à chaque consommateur abonné, une file par consommateur. Il garantit la consommation idempotente (reçus), les nouvelles tentatives avec attente exponentielle, les lettres mortes avec alerte, les minuteries durables et les tâches périodiques sans cron (17 §4.1, §4.2, §2.11).

BUS ne connaît aucun événement métier : il transporte des enveloppes. Il n'appelle rien d'externe.

État réel : livré par US-008 (ADR-050). Détail des éléments, des règles et des valeurs PROPOSÉES : [`internal/README.md`](internal/README.md). Non câblé : processus `worker.ts` et pool de connexions (US-003), purge à 90 jours, rejeu des lettres mortes par la console.

## Entités

| Entité (17 §3.2.13) | En base                                            |
| ------------------- | -------------------------------------------------- |
| `outbox_event`      | table `core.outbox_outbox_event` (migration 0012)  |
| `inbox_receipt`     | table `core.outbox_inbox_receipt` (migration 0012) |
| `dead_letter`       | table `core.outbox_dead_letter` (migration 0012)   |
| `scheduled_job`     | table `core.outbox_scheduled_job` (migration 0012) |

Fonctions : 0013 ; droits et RLS : 0014 ; métriques (`core.outbox_metrics()`) : 0015.

## Événements

BUS n'émet ni ne consomme d'événement de domaine propre : il transporte ceux des autres modules (enveloppe 17 §4.1, catalogue 17 §4.5).

Producteurs réels aujourd'hui : les fonctions SQL d'AVL (`booking.hold.*`, `booking.trip.booked`…) écrivent directement dans `core.outbox_outbox_event` ; `publishEvent` est l'entrée TypeScript. Consommateur réel : NTF (`booking.trip.booked`, `trip.status_changed`, `trip.overdue.detected`). Une lettre morte déclenche une alerte par le port `Alerter`, pas un événement.

## Ports

API publique (`index.ts`) : `publishEvent`, `validateNewEvent`, `BusRegistry`, `OutboxRelay`, `JobRunner`, `scheduleJob`, `PeriodicScheduler`, `BusMetrics`, `workerTransactions` et leurs types (`DomainEvent`, `NewDomainEvent`, `SqlClient`…). Rôle de chaque élément : [`internal/README.md`](internal/README.md).

Port vers l'extérieur : `Alerter` (alerte des lettres mortes), avec l'adaptateur `LogAlerter` (journal) injecté par le jeton `ALERTER`.

Port d'alerte de l'exploitation (US-004, ADR-080) : `AlertChannel` (`internal/alert-channel.ts`) — codes fermés, sévérité P1 / P2, comptes et étiquettes techniques seulement, contrôlés par `assertSafeAlert` avant tout envoi. Adaptateurs : `LogAlertChannel` (production : ligne JSON `ops.alert`, reprise par l'IaC `monitoring.tf`) et `FakeAlertChannel` (`testing/`, tests seulement, hors image). `ChannelAlerter` relaie les lettres mortes sur ce canal (sans identifiant d'événement) ; le travailleur l'utilise.

Moniteur (US-004) : `registerOpsMonitor` / `OpsMonitor` (`internal/ops-monitor.ts`), tâche périodique `ops_monitor` (60 s) qui lit `core.ops_monitor_metrics` (migration 0051) et alerte : outbox > 120 s, webhook en échec 3 fois, opération UNKNOWN > 30 min, signature invalide, alertes P1 de l'outbox (oracle C12, plafond SMS…). Runbook : `docs/ops/MONITORING.md`.

## Commandes de test

- Unitaires (sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/bus` (`internal/bus.test.ts`, `internal/envelope.test.ts`, `internal/ops-monitor.test.ts`).
- Webhook en échec 3 fois ⇒ alerte, sur PostgreSQL : `test/int/ops-monitor.int.test.ts` ; métriques en base : `packages/db/test/l0/l0-us004-ops-monitor.test.ts`.
- Intégration (PostgreSQL réel, `app_api` et `app_worker`) : `pnpm --filter @rueda/api exec vitest run --config vitest.int.config.ts test/int/bus.int.test.ts`, ou toute la suite : `pnpm --filter @rueda/api test:int`.
- Schéma : `pnpm --filter @rueda/db exec vitest run --config vitest.int.config.ts test/int/outbox-schema.test.ts`.
- Preuves L0 (rôles de production) : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/outbox-idempotence.test.ts`.

`test:int` et `test:l0` demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».
