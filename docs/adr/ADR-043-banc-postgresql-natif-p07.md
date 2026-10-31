# ADR-043 — Banc PostgreSQL : natif en local (repli P-07), Testcontainers en CI

- **Statut** : DÉCIDÉ (le fondateur a choisi l'« option légère » sans Docker ni WSL ; acté par l'orchestrateur le 2026-10-31). À reporter dans 17 §8.1 et §11.
- **Stories** : US-005 (banc), US-006 et US-007 (preuves L0), US-002 (CI). **Sources** : handoff §5 (P-01, P-02, P-07), 17 §11, §12, 19 §1.4 point 1.

## Contexte
17 §11 et 19 §1.4 exigent un PostgreSQL **réel en conteneur**, de même version majeure que la production, avec `btree_gist`, une connexion directe sans pooler et des tests sous les rôles de production. Le poste du fondateur n'a ni Docker ni WSL, par décision du fondateur. PostgreSQL 16.15 natif y est installé : localhost:5432, service Windows `postgresql-x64-16` en démarrage manuel, `btree_gist` disponible.

## Décision
1. **En local** : on utilise le PostgreSQL 16 natif (repli P-07).
   - Le harnais de tests reçoit une URL d'administration et crée **une base jetable par série de tests** (nom aléatoire préfixé `rueda_test_`). Il y installe le schéma sous `migrator`, exécute les tests sous `app_api`, `app_worker` et `app_anon`, puis supprime la base, même en cas d'échec.
   - Les rôles PostgreSQL sont globaux à l'instance. Le harnais les crée donc de façon **idempotente** et leur donne un mot de passe aléatoire à chaque série. Il ne crée jamais de rôle `SUPERUSER` ou `BYPASSRLS` pour l'application.
   - Le mot de passe du superutilisateur local est lu dans un fichier **hors dépôt**, dont le chemin est passé par la variable `RUEDA_PG_SUPERUSER_PASSWORD_FILE`. Il n'est jamais affiché, journalisé ni commité.
2. **En CI** (GitHub Actions, US-002) : on utilise **Testcontainers** et un service `postgres:16`, avec le même harnais, paramétré par URL. **Les preuves L0 et les tests d'intégration font foi en CI.** Un vert en local ne suffit pas comme preuve (handoff §5, note).
3. Démarrer le service local demande les droits administrateur. C'est une action du fondateur (validation UAC). Les agents ne modifient pas les réglages système.

## Conséquences
- Le poste local peut diverger de la CI (version mineure, paramètres, `tzdata`) : c'est le risque L0-PM-03. Chaque rapport de preuve L0 indique donc où il a été obtenu, en local ou en CI.
- Testcontainers ne tourne pas en local. Le code du harnais isole le choix de la source de base (URL fournie ou Testcontainers) derrière une seule fonction.
- Si Docker est installé plus tard, il suffit d'activer Testcontainers en local, sans changer les tests.

## Alternatives écartées
- WSL 2 et Docker Desktop (P-01, P-02) : écartés par le fondateur pour l'instant.
- Une base PostgreSQL hébergée partagée pour les tests : écartée, car elle exposerait une instance accessible aux agents et la latence fausserait les mesures p95.
