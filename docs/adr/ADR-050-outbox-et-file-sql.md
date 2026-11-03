# ADR-050 — Outbox, inbox et file de tâches en SQL sous RLS, derrière le port de file (pg-boss différé)

- **Statut** : PROPOSÉ (US-008, agent back-end, 2026-11-03). Revues architecture et QA requises (et sécurité, car `packages/db/` est touché), sur un autre modèle que l'auteur. À reporter dans 17 §8.1 et dans la ligne `scheduled_job` de 17 (tableau des entités transverses).
- **Stories** : US-008 ; s'appuient dessus toutes les stories qui publient ou consomment un événement, et les minuteries de 17 §2.11 (TRP, STL, PYO). **Sources** : 17 §1.3, §2.3, §4.1, §4.2, §6.1 ; ADR-011 (pg-boss + outbox, PROPOSÉ), ADR-035, ADR-044.

## Contexte

ADR-011 et 17 §6.1 proposent pg-boss pour la file interne et les minuteries ; 17 décrit `scheduled_job` comme « la table du moteur de files (pg-boss) ». Les contraintes non négociables du projet (CLAUDE.md points 5 et 6) imposent :

1. la RLS `ENABLE` + `FORCE` sur **toutes** les tables, sans rôle applicatif `BYPASSRLS` ;
2. l'horloge de la base `platform.now()` seule dans le SQL (lint `sql-clock`, horloge virtuelle des preuves L0-06) ;
3. des tests sous les rôles de production (`app_worker` n'a aucun droit de création d'objets).

pg-boss 12.38 (version courante, inspectée pour cet ADR) crée son propre schéma et ses tables **sans RLS**, appelle `now()` plus d'une centaine de fois dans son SQL (insensible à l'horloge virtuelle) et crée dynamiquement des partitions par file (`CREATE TABLE … ATTACH PARTITION`), donc exige un droit DDL pour le rôle d'exécution. Il ne peut pas tourner sous `app_worker` sans une exception aux points 1 à 3.

## Décision

1. **Tables** (schéma Bêta `core`, préfixe du schéma cible `outbox`, `schemas.ts`) : `outbox_outbox_event` (enveloppe 17 §4.1 + colonnes 17 §4.2), `outbox_inbox_receipt` (PK `(consumer, event_id)`), `outbox_dead_letter`, `outbox_scheduled_job`. RLS `ENABLE` + `FORCE`, `migrator_all`, aucun `DELETE` ni `TRUNCATE` accordé.
2. **`scheduled_job` est portée par le projet**, pas par pg-boss : colonnes de 17 (`name`, `run_at`, `payload`, `singleton_key`, `state`) plus `event_id`, `attempts`, `max_attempts`, `locked_until`, `last_error`. Une file = un travailleur : `name` = `app.worker_name`, et la RLS ne laisse un travailleur lire ou modifier que **sa** file. Réclamation `FOR UPDATE SKIP LOCKED` avec bail ; au plus une tâche vivante par `(name, singleton_key)`.
3. **Fonctions SQL `SECURITY INVOKER`** (`core.outbox_*`, migration 0101) : une seule façon de réclamer, terminer, faire échouer, recevoir. Elles ne donnent aucun droit (RLS et droits par colonne de l'appelant). Horloge : `platform.now()` ; l'application passe des durées, jamais « l'heure courante ».
4. **Consommation idempotente** : reçu `inbox_receipt` (consommateur = `app.worker_name()`) écrit dans la transaction du traitement ; doublon ⇒ traitement sauté. Échec ⇒ `ROLLBACK`, puis `outbox_fail_job` dans une transaction séparée : nouvelle échéance `base × 2^(tentative − 1)`, ou, à `max_attempts` (5, 17 §4.2), `FAILED` + `dead_letter` dans la même transaction, puis alerte par le port `Alerter`. Un bail expiré sur la dernière tentative donne aussi une lettre morte (`outbox_reap_expired_jobs`).
5. **Identifiants** : `platform.uuid_v7()` (UUID v7 horodaté par `platform.now()`), demandé par le publieur avant l'insertion (le producteur n'a pas de droit de lecture sur l'outbox).
6. **Port de file** : le code TypeScript (module BUS) ne parle qu'à ces fonctions (`OutboxRelay`, `JobRunner`, `scheduleJob`, `WorkerTransactions`). Un adaptateur pg-boss (ou SQS, BullMQ : ADR-011 « remplaçable derrière l'interface de file ») pourra remplacer la file **si** une exception aux contraintes 1 à 3 est décidée ; il n'est pas construit.
7. **Valeurs PROPOSÉES** (17 ne fixe que les 5 tentatives) : base d'attente 30 s, bail 300 s, lot du relais 100, lot de l'exécuteur 10. Ce sont des options du code, pas encore des paramètres de 17 §7.2.

## Conséquences

- Les preuves (RLS, SKIP LOCKED, reçus, lettres mortes, horloge virtuelle) tournent sous les rôles de production, comme le reste du lot 0.
- Le projet maintient un petit moteur de file (≈ 250 lignes de SQL) au lieu d'une dépendance. Fonctions absentes à ce stade : planification cron, priorité, purge (90 j pour l'outbox et les reçus, 17 §4.2), rejeu console des lettres mortes (ADMIN, journalisé).
- `inbox_receipt` et `dead_letter` n'ont pas de clé étrangère vers l'outbox ni vers la file (purges indépendantes).
- Le processus travailleur (`worker.ts`, boucles de relais et de files, pool de connexions) n'est pas câblé : il dépend des secrets et de la configuration de déploiement (US-003).

## Alternatives écartées

- **pg-boss dans son schéma, hors RLS** : viole les contraintes 1 et 2 ; à reconsidérer seulement par décision explicite.
- **Charger le SQL de pg-boss dans une migration** : même problème (`now()`, absence de RLS), plus une copie à maintenir à chaque version.
- **Lecture directe de l'outbox par chaque consommateur (curseur)** : pas d'état par consommateur pour les réessais et les lettres mortes.
