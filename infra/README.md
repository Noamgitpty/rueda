# Infrastructure en code (US-003, US-004)

Décisions : [ADR-078](../docs/adr/ADR-078-environnements-iac-deploiement-reversible.md), [ADR-080](../docs/adr/ADR-080-sauvegardes-supervision-journal-acces.md) (sauvegardes, supervision). Runbooks : [`docs/ops/DEPLOY.md`](../docs/ops/DEPLOY.md), [`docs/ops/BACKUP_RESTORE.md`](../docs/ops/BACKUP_RESTORE.md), [`docs/ops/MONITORING.md`](../docs/ops/MONITORING.md).

## Responsabilité

Décrire en code chaque environnement d'exécution, pour qu'il se reconstruise depuis le dépôt sans autre action manuelle que la saisie des secrets, et que l'hébergeur reste remplaçable (ADR-037, US-036).

| Dossier                                                   | Contenu                                                                                                                                                                                                                                                                                | Appliqué par                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `local/`                                                  | préproduction locale : `compose.yaml` (base, job de base, API, travailleur) jouée avec l'image de production ; `init-secrets.sh` tient lieu de coffre ; profil `rotation` (US-051) : seconde instance de l'API, `rotate-secrets.sh` (gestes de rotation sur les volumes), `mfa-rotate` | `scripts/deploy/local.sh`, CI         |
| `opentofu/modules/environment/`                           | un environnement AWS complet (PROPOSÉ, ADR-006) : réseau, PostgreSQL géré, deux clés KMS, deux compartiments S3, coffre, registre, ECS Fargate, répartiteur                                                                                                                            | jamais directement : par une racine   |
| `opentofu/modules/environment/tests/`                     | `tofu test` avec un fournisseur simulé : invariants de production, aucun FAKE ni interrupteur de mise en service, images par empreinte                                                                                                                                                 | CI (job `infrastructure`)             |
| `opentofu/modules/environment/backup.tf`, `monitoring.tf` | US-004 : plan AWS Backup quotidien avec copie dans un autre compte et une autre région (refusé sans elle en production), alarmes et sujet des alertes chiffré                                                                                                                          | jamais directement : par une racine   |
| `opentofu/modules/backup-vault/`                          | US-004 : coffre de copie du compte de sauvegarde (copie seule depuis les environnements, suppression refusée, verrou), et ses `tofu test`                                                                                                                                              | par la racine `environments/backup`   |
| `opentofu/environments/{preproduction,production}/`       | racines : fournisseur, état distant (à décommenter), valeurs PROPOSÉES ; `*.tfvars.example` sans secret                                                                                                                                                                                | **le fondateur**, après Q-007 et F-02 |
| `opentofu/environments/backup/`                           | racine du compte DÉDIÉ aux sauvegardes (autre région), appliquée avant les environnements                                                                                                                                                                                              | **le fondateur**, après Q-008         |

## Ce que l'IaC ne fait jamais

- Écrire une valeur secrète (le coffre ne reçoit que des contenants ; le mot de passe d'administration de la base est géré par le service).
- Poser un interrupteur de mise en service, une variable `*_ADAPTER` ou toute référence à un FAKE.
- Désigner une image par une étiquette mobile.

## Ports du fournisseur (portabilité)

| Besoin          | Ici (AWS)                 | Port côté application                                  | Alternative nommée                          |
| --------------- | ------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| base de données | RDS PostgreSQL 16         | libpq (`PG*`), rôles et migrations du dépôt            | tout PostgreSQL 16 géré (GCP, Azure, Neon…) |
| conteneurs      | ECS Fargate + répartiteur | image OCI, `PORT`, sortie standard                     | Cloud Run, Fly.io, Kubernetes               |
| secrets         | Secrets Manager           | variables d'environnement injectées                    | Vault, coffre du PaaS                       |
| clés            | KMS                       | `KeyWrapper` (US-009), adaptateur réel : US-036        | Cloud KMS, Vault Transit                    |
| fichiers        | S3                        | `FileStore` (US-009, US-020), adaptateur réel : US-036 | stockage compatible S3 (R2, GCS)            |
| journaux        | CloudWatch Logs           | JSON sur la sortie standard (17 §6.3)                  | tout collecteur                             |

## Commandes de test

```bash
tofu fmt -check -recursive infra/opentofu
for m in environment backup-vault; do (cd infra/opentofu/modules/$m && tofu init -backend=false && tofu validate && tofu test); done
bash scripts/deploy/rehearsal.sh   # préproduction locale : déploiement, retours arrière, reconstruction
```
