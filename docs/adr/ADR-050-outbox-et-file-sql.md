# ADR-050 — Outbox, inbox et file de tâches en SQL sous RLS, derrière le port de file (pg-boss non retenu en Bêta)

- **Statut** : PROPOSÉ (US-008, agent back-end, 2026-11-03 ; complété après la revue architecture du 2026-11-03). Revues architecture et QA requises (et sécurité, car `packages/db/` est touché), sur un autre modèle que l'auteur.
- **Stories** : US-008 ; s'appuient dessus toutes les stories qui publient ou consomment un événement, les minuteries de 17 §2.11 et les balayeurs de 17 §2.5 (TRP, STL, PYO, AVL). **Sources** : 17 §1.3, §2.3, §2.5, §4.1, §4.2, §6.1, §6.3, §6.7, §11 (L0-06) ; ADR-011 (pg-boss + outbox, PROPOSÉ), ADR-035, ADR-044.

## Contexte

ADR-011 et 17 §6.1 proposent pg-boss pour la file interne et les minuteries ; 17 décrit `scheduled_job` comme « la table du moteur de files (pg-boss) ». ADR-011 est PROPOSÉ et 17 le déclare « remplaçable derrière l'interface de file ». Les contraintes non négociables (CLAUDE.md points 5 et 6) imposent :

1. **la testabilité par l'horloge de la base** (motif principal) : minuteries, baux, attentes exponentielles et âges doivent suivre `platform.now()`, donc l'horloge virtuelle des preuves (`app.virtual_now`, 17 §1.3 point 2, L0-06), pour être prouvés sans attendre et de façon déterministe ;
2. la RLS `ENABLE` + `FORCE` sur toutes les tables, sans rôle applicatif `BYPASSRLS` ;
3. des tests sous les rôles de production (`app_worker` n'a aucun droit de création d'objets).

Constats sur pg-boss 12.38.0 (version courante au 2026-11-03, paquet npm inspecté, fichiers `dist/plans.js` et `dist/index.js`) :

- **Horloge** : le SQL de pg-boss lit l'heure par une fonction d'horloge propre à son schéma, dont le corps est `SELECT pg_catalog.now();` (`CLOCK_FUNCTION_BODY`, `plans.js` l. 221-232). Les valeurs par défaut des colonnes restent sur `pg_catalog.now()` (même commentaire), et `plans.js` contient 140 occurrences de `now()`. Son mode de test (`TestClock`) garde l'heure simulée dans sa propre table (`__pgboss_test_clock`) derrière le paramètre `pgboss.test_clock`, indépendant de `app.virtual_now`. Brancher pg-boss sur `platform.now()` voudrait dire réécrire le corps d'une fonction qu'il possède et restaure à ses migrations. Ce n'est pas un usage pris en charge. `now()` est en outre l'heure de début de transaction, pas `clock_timestamp()` (ADR-030).
- **RLS** : aucune table de pg-boss n'a de politique RLS.
- **DDL à l'exécution** : `create_queue()` exécute `CREATE TABLE … (LIKE job INCLUDING DEFAULTS)` puis `ATTACH PARTITION` quand une file est partitionnée (`plans.js` l. 1075-1115). Le partitionnement est optionnel par file.
- **`migrate: false`** (`index.js` l. 211, 230) : pg-boss n'installe ni ne migre son schéma au démarrage.

## Décision

1. **Tables** (schéma Bêta `core`, préfixe du schéma cible `outbox`, `schemas.ts`) : `outbox_outbox_event` (enveloppe 17 §4.1 + colonnes 17 §4.2), `outbox_inbox_receipt` (PK `(consumer, event_id)`), `outbox_dead_letter`, `outbox_scheduled_job`. RLS `ENABLE` + `FORCE`, `migrator_all`, aucun `DELETE` ni `TRUNCATE` accordé (migrations 0012 à 0015).
2. **`scheduled_job` est portée par le projet.** Elle reprend les colonnes de 17 (`name`, `run_at`, `payload`, `singleton_key`, `state`) et ajoute `event_id`, `attempts`, `max_attempts`, `locked_until` et `last_error`. Une file correspond à un travailleur : `name` = `app.worker_name`, et la RLS ne laisse un travailleur lire ou modifier que **sa** file. La réclamation se fait en `FOR UPDATE SKIP LOCKED`, avec un bail. Il y a au plus une tâche vivante par `(name, singleton_key)`.
3. **Fonctions SQL `SECURITY INVOKER`** (`core.outbox_*`) : elles imposent une seule façon de réclamer, terminer, faire échouer et recevoir. Elles ne donnent aucun droit : la RLS et les droits par colonne de l'appelant s'appliquent. Horloge : `platform.now()` ; l'application passe des durées, jamais « l'heure courante ».
4. **Consommation idempotente** : reçu `inbox_receipt` (consommateur = `app.worker_name()`) dans la transaction du traitement ; doublon ⇒ traitement sauté. Échec ⇒ `ROLLBACK`, puis `outbox_fail_job` : nouvelle échéance `base × 2^(tentative − 1)`, ou, à `max_attempts` (5, 17 §4.2), `FAILED` + `dead_letter` dans la même transaction, puis alerte (port `Alerter`). Bail expiré sur la dernière tentative ⇒ lettre morte (`outbox_reap_expired_jobs`).
5. **Tâches périodiques sans cron** (balayeurs `disposition_sweeper`, `payment_intent_sweeper`, expiration des holds, rapprochements) : déclarées par `BusRegistry.registerPeriodic(nom, période, gestionnaire)`.
   - Le **planificateur** `PeriodicScheduler.tick()` tourne sous le travailleur réservé `bus_scheduler`, au démarrage du travailleur puis toutes les 5 s (PROPOSÉ). À chaque passage, il garantit une **occurrence vivante** par tâche, avec la clé de singleton `periodic`. Si une occurrence est déjà vivante, il ne fait rien (index partiel, `ON CONFLICT DO NOTHING`). Si l'occurrence précédente est terminée, **en lettre morte** ou n'a jamais existé, il en crée une nouvelle à `platform.now() + période`.
   - La chaîne **ne peut donc pas mourir définitivement**. Une lettre morte déclenche l'alerte habituelle, et la tâche reprend au passage suivant.
   - Preuves : `packages/db/test/l0/outbox-idempotence.test.ts` (« tâche périodique ») et `apps/api/test/int/bus.int.test.ts` (lettre morte, puis nouvelle occurrence traitée).
   - Une occurrence ne s'exécute qu'une fois à la fois. La période effective vaut la période plus le délai entre deux passages, ce qui suffit pour des filets de sécurité de 30 à 60 s.
6. **Observabilité** (17 §6.3, §6.7) : `core.outbox_metrics()` (0015) est lisible par le seul travailleur réservé `bus_monitor` ; sous un autre contexte, elle ne renvoie que des zéros. Elle donne :
   - `outbox_unpublished` et `outbox_oldest_age_s` (alerte de 17 §6.3 au-delà de 120 s ; objectif p99 < 30 s) ;
   - par file : `queue_ready`, `queue_scheduled`, `queue_active`, `queue_failed`, `queue_oldest_ready_age_s` et `dead_letter_open`.

   `BusMetrics.collect()` les rassemble en un instantané, que le travailleur publie en une ligne JSON `bus.metrics` (`metricsLogLine`), sans aucune donnée métier.

7. **Identifiants** : `platform.uuid_v7()` (UUID v7 horodaté par `platform.now()`), demandé par le publieur avant l'insertion.
8. **Port de file** : le code TypeScript (module BUS) ne parle qu'à ces fonctions (`OutboxRelay`, `JobRunner`, `PeriodicScheduler`, `BusMetrics`, `scheduleJob`, `WorkerTransactions`). Un adaptateur pg-boss, SQS ou BullMQ reste possible (voir « Alternatives »).
9. **Valeurs PROPOSÉES** (17 ne fixe que les 5 tentatives) : attente de base 30 s, bail 300 s, lot du relais 100, lot de l'exécuteur 10, passage du planificateur 5 s. Ce sont des options du code, pas encore des paramètres de 17 §7.2.

## Conséquences

- Les preuves (RLS, SKIP LOCKED, reçus, lettres mortes, tâches périodiques, métriques, horloge virtuelle) tournent sous les rôles de production, comme le reste du lot 0.
- Le projet maintient un petit moteur de file d'environ 300 lignes de SQL. Plusieurs fonctions restent absentes :
  - priorité, et concurrence intra-file au-delà d'un exécuteur ;
  - purge (90 j pour l'outbox et les reçus, 17 §4.2) : elle demandera un `DELETE` dédié ;
  - rejeu des lettres mortes par la console (ADMIN, journalisé).
- `inbox_receipt` et `dead_letter` n'ont pas de clé étrangère vers l'outbox ni vers la file : leurs purges sont indépendantes.
- Le processus travailleur (`apps/api/src/worker.ts` : boucles du relais, des files, du planificateur et des métriques, pool de connexions) n'est pas câblé. Il dépend des secrets et de la configuration de déploiement (US-003).
- Le fan-out suit le registre du processus : un consommateur absent au démarrage ne reçoit rien, et un consommateur ajouté plus tard ne reçoit pas l'historique. À traiter avec US-003 par un test de démarrage qui compare le registre au catalogue de 17 §4.5.

## Alternatives écartées

- **pg-boss avec `migrate: false`, schéma installé par une migration sous `migrator`, files créées au déploiement sans partition, RLS ajoutée par migration.** Cette variante lève l'objection du DDL à l'exécution : avec des files non partitionnées, `create_queue()` n'exécute pas `CREATE TABLE`. Elle est pourtant écartée pour trois raisons :
  1. l'horloge de pg-boss resterait `now()` (fonction d'horloge et valeurs par défaut), indépendante de `platform.now()` et de l'horloge virtuelle : les minuteries, baux et attentes ne seraient pas prouvables en L0 ;
  2. il faudrait recopier et tenir à jour, à chaque version, le SQL de pg-boss dans nos migrations (celles-ci ne doivent contenir que `platform.now()`, ce qui exige une exception au lint d'horloge) et y ajouter des politiques RLS que pg-boss ne connaît pas ;
  3. ses tâches de maintenance (supervision, archivage, statistiques) écrivent sous le rôle d'exécution dans des tables qu'il faudrait toutes couvrir de politiques.

  À reconsidérer si le volume dépasse ce que la file SQL tient, ou si pg-boss offre une horloge injectable en SQL.

- **pg-boss dans son schéma, hors RLS** : contraire aux contraintes 1 à 3.
- **Lecture directe de l'outbox par chaque consommateur (curseur)** : pas d'état par consommateur pour les réessais et les lettres mortes.

## Reports demandés (orchestrateur ; fichiers non modifiables par l'auteur ou hors périmètre)

- 17 §8.1 : ligne ADR-050 ; ADR-011 « remplacé en Bêta par ADR-050 ».
- 17, tableau des entités transverses : `scheduled_job` « portée par le projet (ADR-050) » au lieu de « table du moteur de files (pg-boss) » ; 17 §6.1, ligne « Files et minuteries ».
- 17 §2.5, « Ordre global des verrous » : ajouter « (0) verrou `bus:` de partition, pris par l'exécuteur de files, hors commandes ».
- 17 §2.3 : noms de travailleurs `outbox_relay`, `bus_scheduler`, `bus_monitor` et règle « une file = un `app.worker_name` ».
- ADR-001 : ligne « travailleur pg-boss, ADR-011 » → « travailleur (file SQL, ADR-050) ».
- README.md l. 5 (« API + travailleur pg-boss ») et docs/team/roles/back-end.md l. 5 (« travailleurs pg-boss ») : même correction.
- CONTRIBUTING, arborescence (`apps/api` : « travailleur pg-boss ») et CLAUDE.md, « Pile » (« travailleur pg-boss ») : même correction.
