# ADR-044 — Migrations SQL, amorçage des rôles et harnais de tests PostgreSQL

- **Statut** : PROPOSÉ (US-005, agent données, 2026-10-31). Revue architecture et sécurité (rôles, secrets) requises, sur un autre modèle que l'auteur. À reporter dans 17 §8.1.
- **Stories** : US-005 ; s'appuient dessus US-006 à US-011, US-022 à US-025. **Sources** : 17 §1.3, §2.3, §6.1, §11 (L0-05, L0-06) ; ADR-030, ADR-035, ADR-043 ; CONTRIBUTING §8, §9.

## Contexte

CONTRIBUTING (§9) laisse à US-005 le choix de l'outil et du format des migrations. Les rôles PostgreSQL sont globaux à l'instance, alors que les migrations s'appliquent à une base et sous `migrator`, qui n'a pas `CREATEROLE`. Le banc local (ADR-043) partage une instance entre les séries de tests.

## Décision

1. **Migrations en SQL brut**, `packages/db/migrations/NNNN_<nom>.sql`, appliquées par un exécuteur maison minimal (`pg`, sans ORM) : une transaction par fichier, inscription dans `platform.schema_migration` dans la même transaction, somme SHA-256 vérifiée (migration appliquée immuable), ordre linéaire imposé, verrou consultatif contre deux exécuteurs concurrents. L'exécuteur refuse une connexion qui n'est pas `migrator` ou qui a `SUPERUSER` / `BYPASSRLS`.
2. **Amorçage séparé et idempotent** (`packages/db/bootstrap/`), exécuté par un administrateur avant les migrations, rejoué à chaque fois et non suivi : création des rôles s'ils manquent, **réimposition** de leurs attributs (`NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`, `LOGIN` ou `NOLOGIN`), refus de toute appartenance de rôle inattendue, droits sur la base, `btree_gist`. Les droits sur les objets (schéma `platform`, `platform.now()`) sont dans une migration (`0001_role_grants`), accordés par leur propriétaire `migrator`.
3. **Mots de passe** : jamais dans le SQL du dépôt. Le harnais génère des mots de passe aléatoires par série et envoie à `ALTER ROLE` un **vérificateur SCRAM-SHA-256** calculé côté client, jamais le mot de passe en clair.
4. **Migrations de test** dans `packages/db/test-migrations/` (numéros 9000 et plus), ajoutées par le harnais seul. Le harnais crée **deux bases jetables** par série : principale (production + test) et contrôle (production seule), pour prouver sur une vraie base que le corps de production de `platform.now()` ne lit pas `app.virtual_now`.
5. **Une série à la fois par instance** : verrou consultatif pris dans la base d'administration pendant toute la série (les mots de passe d'instance changent à chaque série) ; les bases `rueda_test_*` orphelines sont supprimées sous ce verrou.
6. **Garde-fou L0-05** : tout test des suites `test:int` / `test:l0` qui n'a exécuté aucune assertion de rôle échoue (`setupFiles`).

## Conséquences

- Pas de migrations descendantes automatiques pour l'instant : chaque fichier documente son retour arrière en commentaire. À outiller avant le premier déploiement réversible (US-003).
- Deux séries de tests ne tournent pas en parallèle sur la même instance (en CI, chaque tâche a son conteneur).
- En production, l'amorçage sera exécuté par un rôle de provisionnement (US-003), les mots de passe venant du gestionnaire de secrets.
- Passer plus tard à Kysely ou Drizzle (17 §6.1) ne change ni le format des migrations ni le harnais.

## Alternatives écartées

- Outil tiers (node-pg-migrate, Flyway, migrations Drizzle) : dépendance de plus pour un besoin simple ; certains génèrent du SQL ou exigent un format propre.
- Création des rôles par une migration sous `migrator` : exigerait `CREATEROLE` pour `migrator`, contraire au moindre privilège.
- Mot de passe en clair dans `ALTER ROLE … PASSWORD '…'` : visible dans `pg_stat_activity` et les journaux d'instructions.
