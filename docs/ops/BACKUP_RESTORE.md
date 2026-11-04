# Runbook — sauvegardes et restauration (US-004)

Décision : [ADR-080](../adr/ADR-080-sauvegardes-supervision-journal-acces.md). Code : `infra/opentofu/modules/environment/backup.tf`, `infra/opentofu/modules/backup-vault/`, `infra/opentofu/environments/backup/`. Objectifs (17 §6.4, 16 ADM-035, À DÉCIDER) : RPO ≤ 24 h exigé, cible ≤ 1 h ; RTO ≤ 8 h.

**Aucun agent n'applique ce runbook** : il n'a ni compte, ni accès, ni secret (OPERATING_RULES §1). Le fondateur l'exécute avec ses propres accès ; un agent peut le lire avec lui.

## Ce qui est sauvegardé

| Quoi                                             | Comment                                                                                     | Où                                               | Conservé (PROPOSÉ)                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------- |
| Base (restauration à un instant donné)           | sauvegardes automatiques et journaux de transactions du service géré                        | compte de l'environnement                        | `db_backup_retention_days` (14)   |
| Base et compartiments (actifs, preuves, journal) | plan AWS Backup quotidien, 05:00 UTC                                                        | coffre de l'environnement (clé dédiée `backup`)  | `backup_retention_days` (35)      |
| Copie de chaque sauvegarde quotidienne           | `copy_action` du plan                                                                       | coffre du **compte de sauvegarde**, autre région | `backup_copy_retention_days` (35) |
| Secrets et clés                                  | non sauvegardés : clés KMS à rotation, procédure de recréation (US-036) ; secrets re-saisis | —                                                | —                                 |

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
3. Vérifier sous `app_api` (job de base, `packages/db/src/deploy/`) : rôle de production, environnement déclaré attendu, dernière migration appliquée.
4. Bascule : mettre l'adresse de la nouvelle instance dans `PGHOST` des tâches (nouvelle révision, `scripts/deploy/ecs.sh`), puis surveiller les alarmes 30 min. Journaliser la bascule (journal des déploiements).

### Perte du compte ou de la région : copie hors compte

1. Dans le compte de sauvegarde, choisir le point de restauration le plus récent du coffre de copie.
2. Le copier vers un compte d'environnement sain (ou recréer l'environnement depuis le dépôt dans une autre région : `tofu apply` d'une racine avec `region` changée), puis restaurer base et compartiments depuis ce point.
3. Re-saisir les secrets dans le nouveau coffre (DEPLOY.md « Amorçage »), redéployer la même empreinte d'image.
4. RPO de ce scénario : 24 h au plus (copie quotidienne).

## Tester la restauration (ADM-032 : avant l'ouverture, puis chaque mois)

Story US-051 (test chronométré). En attendant, chaque mois : restaurer le dernier point de la copie hors compte dans une instance jetable de préproduction, vérifier sous `app_api` (lignes de quelques tables, chaîne d'audit vérifiable par `audit_chain_verifier`), mesurer RPO et RTO, consigner le rapport dans `docs/team/incidents/`, puis détruire l'instance.

## En cas d'alerte de sauvegarde

L'alarme « échec d'une sauvegarde, d'une copie hors compte ou d'une restauration » (EventBridge) arrive sur le sujet des alertes. Ouvrir le travail en échec dans AWS Backup, lire le motif (droits KMS du compte de copie, coffre verrouillé, quota), corriger, relancer le travail à la main (« Create on-demand backup » / « Copy »), et noter l'incident.
