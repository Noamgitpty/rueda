# Module BUS — détail (US-008)

Le `README.md` du module donne la fiche (responsabilité, entités, événements, ports, commandes de test, US-035) ; le détail est ici.

## US-008 : outbox, consommation idempotente, lettres mortes, tâches planifiées

Décision : ADR-050 (PROPOSÉ). Tables et fonctions SQL : `packages/db/migrations/0012` à `0015` (schéma Bêta `core`, préfixe `outbox_`).

| Élément (`index.ts`)                                        | Rôle                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publishEvent(tx, event)`                                   | Écrit l'enveloppe 17 §4.1 dans `core.outbox_outbox_event` **dans la transaction du producteur** (annulée ⇒ rien n'est émis). Identifiant UUID v7 et `occurred_at` donnés par la base.                                                                      |
| `BusRegistry`                                               | Abonnements : `registerConsumer(nom, types, gestionnaire)`, `registerTimer(nom, gestionnaire)`. Un consommateur = un travailleur nommé = une file.                                                                                                         |
| `OutboxRelay`                                               | Travailleur `outbox_relay` : lot `FOR UPDATE SKIP LOCKED`, une tâche par consommateur abonné (clé = `event_id`), `published_at` posé une fois.                                                                                                             |
| `JobRunner`                                                 | Exécute la file d'un travailleur : reçu `inbox_receipt` (doublon ⇒ sauté), gestionnaire dans la même transaction, verrou consultatif sur `partition_key` (F32) ; échec ⇒ attente exponentielle, puis `dead_letter` et alerte après 5 tentatives (17 §4.2). |
| `scheduleJob(tx, …)`                                        | Minuterie durable (17 §2.11) : délai calculé par la base ou instant métier lu en base.                                                                                                                                                                     |
| `workerTransactions(connect)`                               | Une transaction par connexion directe, contexte `app.actor_kind = WORKER` et `app.worker_name` posé en local.                                                                                                                                              |
| `BusRegistry.registerPeriodic` + `PeriodicScheduler.tick()` | Tâches périodiques sans cron : une occurrence vivante par tâche (clé `periodic`), recréée à chaque passage du planificateur (`bus_scheduler`), même après une lettre morte (ADR-050 point 5).                                                              |
| `BusMetrics.collect()`, `metricsLogLine`                    | Âge et volume de l'outbox non publiée, profondeur des files, lettres mortes ouvertes (`core.outbox_metrics()`, travailleur `bus_monitor` ; 17 §6.3, alerte > 120 s).                                                                                       |
| `Alerter`, `LogAlerter`, `ALERTER`                          | Port d'alerte des lettres mortes (identifiants et code court seulement, jamais le message d'erreur ni la charge utile).                                                                                                                                    |

Règles pour les producteurs et consommateurs :

- `payload` : identifiants et valeurs non sensibles, **aucune donnée C3 ni C4** ; montants en chaînes d'unités mineures.
- Un gestionnaire n'appelle rien d'externe de façon non idempotente : ses écritures et le reçu sont validés ensemble, ou rien.
- L'ordre entre événements d'un agrégat n'est pas garanti : s'appuyer sur `aggregateVersion`.

Valeurs PROPOSÉES (ADR-050) : base d'attente 30 s, bail 300 s, lots 100 (relais) et 10 (exécuteur).

Tests : `src/modules/bus/internal/*.test.ts` (unitaires) ; `apps/api/test/int/bus.int.test.ts` (`pnpm test:int`, PostgreSQL réel sous `app_api` et `app_worker`, banc de `@rueda/db`).

Non câblé : processus `worker.ts` et pool de connexions (US-003) ; purge à 90 j ; rejeu console des lettres mortes.
