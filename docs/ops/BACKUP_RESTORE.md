# Runbook — sauvegardes et restauration (US-004)

Décisions : [ADR-080](../adr/ADR-080-sauvegardes-supervision-journal-acces.md) (sauvegardes), [ADR-082](../adr/ADR-082-restauration-testee-rotation-secrets.md) (restauration testée, US-051). Rotation des secrets : [SECRET_ROTATION.md](SECRET_ROTATION.md). Code : `infra/opentofu/modules/environment/backup.tf`, `infra/opentofu/modules/backup-vault/`, `infra/opentofu/environments/backup/`. Objectifs par scénario (US-112, ADR-121, PROPOSÉS, À DÉCIDER) : [`recovery-objectives.json`](recovery-objectives.json), source unique rejouée par l'exercice ; exigence de 17 §6.4 : RPO ≤ 24 h, RTO ≤ 8 h. Plan de reprise (rôles, ordre, communication) : [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).

**Aucun agent n'applique ce runbook** : il n'a ni compte, ni accès, ni secret (OPERATING_RULES §1). Le fondateur l'exécute avec ses propres accès ; un agent peut le lire avec lui.

## Ce qui est sauvegardé

| Quoi                                             | Comment                                                                                                                                                                                     | Où                                               | Conservé (PROPOSÉ)                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------- |
| Base (restauration à un instant donné)           | sauvegardes automatiques et journaux de transactions du service géré                                                                                                                        | compte de l'environnement                        | `db_backup_retention_days` (14)   |
| Base et compartiments (actifs, preuves, journal) | plan AWS Backup quotidien, 05:00 UTC                                                                                                                                                        | coffre de l'environnement (clé dédiée `backup`)  | `backup_retention_days` (35)      |
| Copie de chaque sauvegarde quotidienne           | `copy_action` du plan                                                                                                                                                                       | coffre du **compte de sauvegarde**, autre région | `backup_copy_retention_days` (35) |
| Secrets et clés                                  | non sauvegardés : clés KMS à rotation ; DEK par sujet exportées par le séquestre du fondateur pour un changement d'hébergeur ([PORTABILITY.md](PORTABILITY.md), US-036) ; secrets re-saisis | —                                                | —                                 |

En production, `tofu plan` **refuse** un plan sans copie hors compte, une copie dans le même compte ou la même région, et moins de 7 jours de rétention.

## Amorçage (une fois, par le fondateur)

1. Créer un compte AWS **dédié aux sauvegardes** (organisation du fondateur), activer la sauvegarde entre comptes dans AWS Backup (paramètres de l'organisation).
2. Dans ce compte : `cd infra/opentofu/environments/backup`, copier `backup.tfvars.example` en `backup.tfvars` (comptes de la préproduction et de la production), décommenter l'état distant, `tofu init`, `tofu plan -var-file=backup.tfvars`, `tofu apply`. Noter la sortie `vault_arn` (aucun secret).
3. Reporter `vault_arn` dans `backup_copy_vault_arn` du `.tfvars` de la production (et de la préproduction si sa copie est voulue), ainsi que `alert_email`. Appliquer l'environnement (`docs/ops/DEPLOY.md`).
4. Confirmer l'abonnement au sujet des alertes (courriel reçu d'AWS).
5. Le lendemain : vérifier un travail de sauvegarde `COMPLETED` et un travail de copie `COMPLETED` (console AWS Backup, « Jobs ») ; le point de restauration doit apparaître dans le coffre du compte de sauvegarde.

## Avant la première application : vérifier la copie entre comptes

La copie n'a jamais tourné (aucun compte). Avant d'ouvrir l'environnement, le fondateur vérifie, sur une sauvegarde à la demande :

1. **Clé `backup` de l'environnement** : le compte de copie n'y a que `Decrypt`, `DescribeKey` et `CreateGrant` (ressource AWS), sous `kms:CallerAccount` et `kms:ViaService` (`backup` ou `rds` de la région). Si la copie échoue avec `AccessDenied` sur KMS, lire dans CloudTrail le service et le compte appelants, et n'élargir que la condition fautive (jamais vers la clé `data`).
2. **Coffre de destination** : il accepte la copie (`backup:CopyIntoBackupVault` pour les comptes des environnements) et rechiffre avec SA clé, que seul le compte de sauvegarde utilise ; les comptes sources n'y ont aucun droit, par conception. Si AWS Backup exigeait un accès des comptes sources à cette clé, l'ajouter sous les mêmes conditions (`kms:ViaService` backup, `kms:CallerAccount`) et le consigner dans ADR-080.
3. Un travail de copie `COMPLETED` et le point de restauration visible dans le coffre du compte de sauvegarde ; sinon l'alarme « échec de sauvegarde » doit être reçue.

## Restaurer

Toujours dans une **nouvelle** instance, jamais par-dessus la base en service ; la bascule se fait par la configuration de l'environnement.

### Erreur récente (RPO de quelques minutes) : instant donné

1. Choisir l'instant (UTC) juste avant l'incident ; la console RDS donne la fenêtre restaurable.
2. Restaurer l'instance à cet instant sous un nouvel identifiant, même groupe de sous-réseaux, groupe de sécurité `db`, groupe de paramètres de l'environnement, chiffrement par la clé `backup`.
3. Vérifier la nouvelle instance AVANT toute bascule : tâche ponctuelle de l'image (définition `migrate`, commande remplacée) `node packages/db/src/restore/cli.ts`, avec `PGHOST` = la nouvelle instance, `RUEDA_ENV` = l'environnement, et les secrets du job de base (`RUEDA_DB_ADMIN_USER`, `RUEDA_DB_ADMIN_PASSWORD`, `RUEDA_DB_APP_API_PASSWORD`, `RUEDA_DB_APP_WORKER_PASSWORD`). Contrôles : rôles sans SUPERUSER ni BYPASSRLS, RLS ENABLE + FORCE partout, toutes les migrations du dépôt appliquées, environnement déclaré, rôles de production (L0-05), chaîne d'audit vérifiable, oracle C12 à zéro, invariants d'argent, aucune occupation orpheline. Code 1 si un contrôle échoue : ne pas basculer.
4. Bascule : mettre l'adresse de la nouvelle instance dans `PGHOST` des tâches (nouvelle révision, `scripts/deploy/ecs.sh`), puis surveiller les alarmes 30 min. Journaliser la bascule (journal des déploiements).

### Perte du compte ou de la région : copie hors compte

1. Dans le compte de sauvegarde, choisir le point de restauration le plus récent du coffre de copie.
2. Le copier vers un compte d'environnement sain (ou recréer l'environnement depuis le dépôt dans une autre région : `tofu apply` d'une racine avec `region` changée), puis restaurer base et compartiments depuis ce point.
3. Re-saisir les secrets dans le nouveau coffre (DEPLOY.md « Amorçage »), redéployer la même empreinte d'image.
4. RPO de ce scénario : 24 h au plus (copie quotidienne).

## Tester la restauration (ADM-032 : avant l'ouverture, puis chaque mois ; US-051)

Deux exercices, chronométrés, comparés aux objectifs de leur scénario ([`recovery-objectives.json`](recovery-objectives.json), US-112 : erreur récente et perte de l'instance RPO 15 min, RTO 4 h ; perte du compte ou de la région RPO 24 h, RTO 8 h ; PROPOSÉS) :

- **Exercice local, à chaque PR et chaque nuit** (job CI « reprise », `bash scripts/ops/restore-drill.sh`) : il exécute **tels quels** les blocs « exercice » ci-dessous sur une préproduction locale peuplée (PA, PY), et rejoue la même procédure à chaque porte de lot (19 §1.10, critère 4 d'US-051). Rapport JSON en artefact (`restauration-rapport`) ; mesure de référence : [`restore-drill-baseline.json`](restore-drill-baseline.json).
- **Exercice cloud, chaque mois et avant l'ouverture** (par le fondateur) : restaurer le dernier point de la copie hors compte dans une instance jetable de préproduction (§ « Restaurer »), lancer la vérification (étape 3), mesurer le RPO (instant du point restauré → instant de l'exercice) et le RTO (début de la restauration → API saine), consigner le rapport dans `docs/team/incidents/`, puis détruire l'instance.

### Exercice de restauration (préproduction locale, exécuté tel quel par la CI)

Équivalences avec le service géré : sauvegarde de base `pg_basebackup` = instantané quotidien ; journaux de transactions archivés en continu (`archive_command`, `archive_timeout` 30 s) = journaux de la restauration à un instant donné ; nouveau conteneur = nouvelle instance ; `serve-local.sh` = nouvelle révision des tâches avec `PGHOST` changé.

Variables : `RUEDA_PG_CONTAINER` (instance source), `RUEDA_BACKUP_VOLUME` et `RUEDA_WAL_VOLUME` (volumes des sauvegardes et des journaux), `RUEDA_BACKUP_LABEL`, `RUEDA_RESTORE_CONTAINER` et `RUEDA_RESTORE_PORT` (nouvelle instance), `RUEDA_RESTORE_TARGET_TIME` (instant UTC, vide = au plus récent), `PGDATABASE`, `RUEDA_SECRETS_DIR` (un fichier 0600 par rôle : `postgres`, `app_api`, `app_worker`), `RUEDA_SERVE_DIR`, `RUEDA_RESTORE_REPORT` (facultatif).

1. Sauvegarde de base (copie physique de l'instance, manifeste SHA-256 vérifié) :

   ```bash exercice-sauvegarde
   bash scripts/ops/pg-backup.sh "$RUEDA_PG_CONTAINER" "$RUEDA_BACKUP_LABEL"
   ```

2. Restauration dans une NOUVELLE instance, à l'instant choisi (ou au plus récent), puis promotion :

   ```bash exercice-restauration
   bash scripts/ops/pg-restore.sh "$RUEDA_BACKUP_LABEL" "$RUEDA_RESTORE_CONTAINER" \
     "$RUEDA_RESTORE_PORT" "$RUEDA_RESTORE_TARGET_TIME"
   ```

3. Vérification (même CLI qu'en cloud, étape 3 de « Restaurer ») :

   ```bash exercice-verification
   PGHOST=127.0.0.1 PGPORT="$RUEDA_RESTORE_PORT" RUEDA_ENV=preproduction \
     RUEDA_DB_ADMIN_USER=postgres \
     RUEDA_DB_ADMIN_PASSWORD="$(cat "$RUEDA_SECRETS_DIR/postgres")" \
     RUEDA_DB_APP_API_PASSWORD="$(cat "$RUEDA_SECRETS_DIR/app_api")" \
     RUEDA_DB_APP_WORKER_PASSWORD="$(cat "$RUEDA_SECRETS_DIR/app_worker")" \
     node packages/db/src/restore/cli.ts
   ```

4. Bascule : l'API et le travailleur démarrent sur la nouvelle instance ; l'API doit répondre et le travailleur démarrer :

   ```bash exercice-bascule
   PGHOST=127.0.0.1 PGPORT="$RUEDA_RESTORE_PORT" bash scripts/ops/serve-local.sh start
   ```

L'exercice (`packages/db/test/drill/restore-drill.test.ts`) enchaîne deux scénarios. **A, erreur récente** : sauvegarde, écritures, instant T, écritures après T ; restauration à T ⇒ données identiques à celles de T (comptes de lignes de chaque table, sommes d'argent par devise, tête de la chaîne d'audit), écritures d'après la sauvegarde présentes, aucune écriture postérieure à T, catalogue de sécurité identique (rôles, appartenances, politiques, RLS, droits), vérification verte, application redémarrée. **B, perte de l'instance** : l'instance source est tuée sans préavis ; restauration au plus récent ⇒ RPO = instant de la perte − dernière écriture rendue (borné par `archive_timeout`), vérification verte, application redémarrée. RTO = restauration + vérification + bascule.

### Mesures

Base de l'exercice : 960 lignes à T (PA et PY), sauvegarde de base en 0,59 s. Ces durées mesurent la **procédure** sur une petite base, pas le volume de la production. Depuis US-112, chaque scénario est comparé à son objectif (RPO 15 min, RTO 4 h, PROPOSÉS) et le rapport les consigne (`objectives`) ; la mesure sur un volume représentatif se fera à l'exercice cloud du fondateur (Q-009), en préproduction, et sera reportée ici.

| Date       | Commit                              | Scénario                                             | RPO mesuré                                       | RTO mesuré                                                    | Cible (17 §6.4)                                        |
| ---------- | ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------ |
| 2026-11-04 | `9d6f745` (run 41828640740)         | A : restauration à l'instant T                       | 0,02 s (instant visé − dernière écriture rendue) | 2,86 s (restauration 1,48 + vérification 0,29 + bascule 1,09) | RPO ≤ 1 h (exigé 24 h), RTO ≤ 8 h : **tenus**          |
| 2026-11-04 | `9d6f745` (run 41828640740)         | B : perte de l'instance, restauration au plus récent | 6,57 s (borné par `archive_timeout` = 30 s)      | 2,87 s (1,48 + 0,30 + 1,09)                                   | idem : **tenus**                                       |
| 2026-11-14 | `b8ad919` (run 43570361558, US-112) | A : restauration à l'instant T (2 752 lignes à T)    | 0,18 s                                           | 4,21 s (2,89 + 0,21 + 1,10)                                   | objectif `instant` RPO ≤ 15 min, RTO ≤ 4 h : **tenus** |
| 2026-11-14 | `b8ad919` (run 43570361558, US-112) | B : perte de l'instance, restauration au plus récent | 8,09 s                                           | 3,68 s (2,40 + 0,22 + 1,07)                                   | objectif `latest` RPO ≤ 15 min, RTO ≤ 4 h : **tenus**  |

## En cas d'alerte de sauvegarde

L'alarme « échec d'une sauvegarde, d'une copie hors compte ou d'une restauration » (EventBridge) arrive sur le sujet des alertes. Ouvrir le travail en échec dans AWS Backup, lire le motif (droits KMS du compte de copie, coffre verrouillé, quota), corriger, relancer le travail à la main (« Create on-demand backup » / « Copy »), et noter l'incident.
