# Runbook — portabilité : changer d'hébergeur et récupérer toutes les données (US-036)

Décision : [ADR-120](../adr/ADR-120-portabilite-ports-export-sequestre.md) (PROPOSÉ). Code : `packages/db/src/portability/` (outil d'export), `scripts/ops/portability-pg.sh` (base), `scripts/ops/portability-drill.sh` (exercice). Sauvegardes et restauration dans le même hébergeur : [BACKUP_RESTORE.md](BACKUP_RESTORE.md). Le choix de l'hébergeur reste au fondateur (Q-007) : ce runbook ne le présume pas.

**Aucun agent n'applique ce runbook sur un vrai environnement** : il n'a ni compte, ni accès, ni secret (OPERATING_RULES §1). Le fondateur l'exécute avec ses propres accès. La CI l'exécute tel quel sur deux instances locales (§ « Exercice »).

## 1. Ports des services de l'hébergeur

Règle (US-036 critère 1) : un service propre à l'hébergeur ne s'utilise que derrière un port, avec un adaptateur local et une alternative nommée. Le code de `apps/` et `packages/` n'importe aucun SDK de fournisseur et ne contient aucune constante de fournisseur (hôte de service, ARN, région) : `packages/db/src/portability/provider-neutral.test.ts` l'interdit (`pnpm test:unit`). Les adaptateurs de l'hébergeur vivent hors du code : IaC (`infra/`), image (`docker/`), scripts de déploiement (`scripts/deploy/`).

| Service                                  | Port (fichier)                                                                                                                                                                 | Adaptateur local (poste, CI, préproduction locale)                                           | FAKE (tests)                                       | Défaut PROPOSÉ (Q-007)                                                  | Alternatives nommées                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Base de données                          | PostgreSQL 16 standard (variables libpq `PG*`, extension `btree_gist` seulement, migrations SQL du dépôt)                                                                      | conteneur `postgres:16`                                                                      | —                                                  | PostgreSQL géré (RDS Multi-AZ)                                          | tout PostgreSQL 16 géré (Cloud SQL, Azure Flexible Server, Scaleway, OVHcloud) ou auto-hébergé                        |
| Stockage objet (photos, preuves, marque) | `FileStore` (`packages/db/src/audit/file-asset.ts`) ; mêmes contrats : `BrandFileStore` (CFG), `DocumentFileStore` (CAT), `EvidenceFileStore` (SUP), stockage des photos (CAT) | `FsFileStore` (`packages/db/src/portability/fs-file-store.ts`, création seule)               | `InMemoryFileStore` (`@rueda/fake-adapters/files`) | stockage objet S3 (SSE-KMS, versionnage, verrou objet sur les preuves)  | stockage compatible S3 (MinIO, Cloudflare R2, Scaleway), Google Cloud Storage, Azure Blob, volume POSIX               |
| Clés de chiffrement (KMS)                | `KeyWrapper` (`packages/db/src/audit/key-wrapper.ts`) ; ses consommateurs : `DocumentVault` (CAT), `EvidenceVault` (SUP), `TaxIdSealer` (KYC)                                  | `LocalKeyWrapper` (`packages/db/src/portability/local-key-wrapper.ts`, refusé en production) | `FakeKeyWrapper` (`@rueda/db/testing`)             | KMS de l'hébergeur                                                      | HashiCorp Vault / OpenBao (moteur Transit), Google Cloud KMS, Azure Key Vault                                         |
| Coffre de secrets                        | variables d'environnement du processus ([ENV_VARS.md](ENV_VARS.md)) ; `TotpSecretVault` (IAM) pour les secrets TOTP                                                            | fichiers 0600 (`secrets-init`, `RUEDA_DEV_SECRETS_DIR`)                                      | `FakeTotpSecretVault` (`apps/api`, tests)          | gestionnaire de secrets de l'hébergeur                                  | HashiCorp Vault / OpenBao, Google Secret Manager, Azure Key Vault, fichiers chiffrés (sops)                           |
| Files et minuteries                      | pg-boss et outbox **dans PostgreSQL** (17 §6.1) : aucun service de file de l'hébergeur                                                                                         | la base locale                                                                               | —                                                  | —                                                                       | sans objet (portable avec la base)                                                                                    |
| Courriel, SMS, WhatsApp                  | `MessagingChannel` (NTF)                                                                                                                                                       | FAKE (aucun envoi réel avant le lot C)                                                       | `FakeMessagingChannel`                             | fournisseurs choisis au lot C (DEC-FONDATEUR-03), indépendants du cloud | tout fournisseur SMTP ou API (dont le service de courriel de l'hébergeur), derrière le même port                      |
| Antivirus                                | `UploadScanner` (AUD)                                                                                                                                                          | ClamAV auto-hébergé (DEC-FONDATEUR-20)                                                       | `FakeUploadScanner`                                | ClamAV dans un conteneur                                                | sans objet (auto-hébergé)                                                                                             |
| Exécution des conteneurs                 | image OCI standard (`docker/prod/Dockerfile`) ; déploiement : même interface `deploy` / `rollback` / journal (`scripts/deploy/local.sh`, `scripts/deploy/ecs.sh`)              | `infra/local/compose.yaml`, `scripts/deploy/local.sh`                                        | —                                                  | conteneurs gérés (ECS Fargate)                                          | Kubernetes, Google Cloud Run, Azure Container Apps, Fly.io, Nomad, une VM avec Docker Compose                         |
| Infrastructure en code                   | module OpenTofu `infra/opentofu/modules/environment` (sorties : adresse de la base, compartiments, clés, rôle de déploiement)                                                  | `infra/local/compose.yaml`                                                                   | `tofu test` (fournisseur simulé)                   | fournisseur AWS                                                         | réécrire le module pour le fournisseur retenu, mêmes sorties ; la plateforme ne lit que des variables d'environnement |
| TLS vers la base gérée                   | `PGSSLMODE=verify-full`, `NODE_EXTRA_CA_CERTS` (lue par Node.js lui-même, aucun code du dépôt)                                                                                 | sans TLS (réseau local)                                                                      | —                                                  | paquet d'autorité RDS épinglé dans l'image (ADR-084)                    | remplacer le fichier **et** sa somme SHA-256 dans le `Dockerfile` ([DEPLOY.md](DEPLOY.md) §4 étape 5)                 |
| Sauvegardes                              | instantanés et journaux du service géré ; copie hors compte                                                                                                                    | `pg_basebackup` et journaux archivés (exercice de restauration)                              | —                                                  | AWS Backup (ADR-080)                                                    | sauvegardes du service géré retenu ; l'export de ce runbook reste valable partout                                     |
| Supervision et alertes                   | journaux JSON sur la sortie standard, traces OpenTelemetry (17 §6.3) ; alarmes dans l'IaC                                                                                      | sortie standard                                                                              | —                                                  | journaux et alarmes de l'hébergeur ([MONITORING.md](MONITORING.md))     | tout collecteur OTLP (Grafana, Datadog, Elastic), alertes du nouvel hébergeur                                         |

Seuls l'adaptateur local et le FAKE existent dans le code tant que l'hébergeur n'est pas choisi : en production, l'API répond `503` sur les fonctions qui en ont besoin (`Unavailable*`, fail-closed). Les adaptateurs réels (KMS, stockage objet) arrivent **avec le choix de l'hébergeur** (Q-007), avant le premier déploiement cloud ; l'outil d'export refuse tout nom d'adaptateur qu'il ne connaît pas (`RUEDA_KEY_WRAPPER`, `RUEDA_FILE_STORE`).

## 2. Ce qui est exporté

| Quoi                           | Comment                                                                                                                                                                                  | Fichier de l'export (dossier 0700, fichiers 0600) |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Base                           | `pg_dump` format custom (PostgreSQL 16 standard), **sans** les données de `core.audit_subject_key` ; contrôle fail-closed de cette absence ; SHA-256                                     | `base.dump`, `base.dump.sha256`                   |
| Clés de données par sujet      | chaque DEK vivante déroulée par le KMS de l'ancien hébergeur et ré-enveloppée pour la clé **publique** de séquestre du fondateur (RSA-OAEP-SHA-256) ; clés détruites exportées détruites | `subject-keys.escrow.jsonl`                       |
| Fichiers                       | chaque objet du registre `file_asset`, octet pour octet (C2 / C3 restent chiffrés par la clé de leur sujet) ; manifeste SHA-256                                                          | `files/<bucket>/<clé>`, `files-manifest.json`     |
| Clés maîtresses, mots de passe | **jamais exportés** : le nouvel hébergeur a ses propres clés et ses propres secrets                                                                                                      | —                                                 |

**L'export contient des données personnelles en clair** (colonnes non chiffrées de la base) : il se traite comme la base de production. Jamais dans le dépôt, jamais en artefact de CI, jamais dans un journal ; transfert chiffré de bout en bout vers le nouvel hébergeur ; destruction dès la bascule vérifiée. La clé privée de séquestre ne quitte jamais le support hors ligne du fondateur, sauf pendant l'import (§ 5), et ne figure jamais dans le dossier d'export (L1-PM-34).

## 3. Préalables (fondateur)

1. **Clé de séquestre**, une fois, sur un poste hors ligne : `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out escrow-private.pem`, puis `openssl pkey -in escrow-private.pem -pubout -out escrow-public.pem`. La clé privée reste sur le support du fondateur (avec une copie de secours) ; la clé publique, qui n'est pas un secret, sert à l'export. 3 072 bits au moins (l'outil refuse moins).
2. **Nouvel hébergeur** : une instance PostgreSQL 16 vide, un stockage objet, un KMS et un coffre (IaC adaptée ou manuelle). Nouveaux mots de passe des rôles de connexion dans son coffre.
3. **Fenêtre de maintenance** : API et travailleur arrêtés sur l'ancien hébergeur (aucune écriture entre l'export de la base, celui des clés et celui des fichiers).
4. Rôle d'administration de chaque instance : il doit lire toutes les tables malgré la RLS (superutilisateur ou rôle d'administration `BYPASSRLS` du service géré ; **jamais** un rôle applicatif). La vérification finale contrôle qu'aucun rôle applicatif n'a `BYPASSRLS`.

## 4. Export (ancien hébergeur)

Variables de l'étape : `PGHOST`, `PGPORT`, `PGDATABASE`, `RUEDA_DB_ADMIN_USER`, `RUEDA_SECRETS_DIR` (un fichier 0600 par rôle, dont celui de l'administration), `RUEDA_EXPORT_DIR`, `RUEDA_ESCROW_PUBLIC_KEY_FILE`, `RUEDA_KEY_WRAPPER` et `RUEDA_LOCAL_MASTER_KEY_FILE` (KMS de l'ancien hébergeur), `RUEDA_FILE_STORE` et `RUEDA_FILE_STORE_DIR` (stockage de l'ancien hébergeur), `RUEDA_ENV`. Outils PostgreSQL : conteneur `postgres:16` par défaut, ou ceux du poste (`RUEDA_PG_CLIENT=local`).

```bash portabilite-export
install -d -m 0700 "$RUEDA_EXPORT_DIR"
export RUEDA_DB_ADMIN_PASSWORD="$(cat "$RUEDA_SECRETS_DIR/$RUEDA_DB_ADMIN_USER")"
bash scripts/ops/portability-pg.sh dump "$RUEDA_EXPORT_DIR"
node packages/db/src/portability/cli.ts export-keys
node packages/db/src/portability/cli.ts export-files
```

La sortie ne donne que des comptes, des tailles et l'empreinte publique de la clé de séquestre. Transférer ensuite le dossier `RUEDA_EXPORT_DIR` vers le nouvel hébergeur (canal chiffré), puis vérifier `base.dump.sha256` à l'arrivée (l'import le refait).

## 5. Import (nouvel hébergeur)

Variables de l'étape : celles du § 4, pointées sur la **nouvelle** instance (adresse, dossier de ses secrets, son KMS, son stockage), plus `RUEDA_ESCROW_PRIVATE_KEY_FILE` (clé privée de séquestre, montée depuis le support du fondateur le temps de cette étape). Ordre imposé : amorçage, schéma (`pre-data`), données (`data`), clés de sujet, puis contraintes, index, triggers et politiques (`post-data`) ; les fichiers en dernier.

```bash portabilite-import
export RUEDA_DB_ADMIN_PASSWORD="$(cat "$RUEDA_SECRETS_DIR/$RUEDA_DB_ADMIN_USER")"
export RUEDA_DB_MIGRATOR_PASSWORD="$(cat "$RUEDA_SECRETS_DIR/migrator")"
export RUEDA_DB_APP_API_PASSWORD="$(cat "$RUEDA_SECRETS_DIR/app_api")"
export RUEDA_DB_APP_WORKER_PASSWORD="$(cat "$RUEDA_SECRETS_DIR/app_worker")"
export RUEDA_DB_APP_ANON_PASSWORD="$(cat "$RUEDA_SECRETS_DIR/app_anon")"
node packages/db/src/portability/cli.ts prepare-target
bash scripts/ops/portability-pg.sh restore "$RUEDA_EXPORT_DIR" pre-data
bash scripts/ops/portability-pg.sh restore "$RUEDA_EXPORT_DIR" data
node packages/db/src/portability/cli.ts import-keys
bash scripts/ops/portability-pg.sh restore "$RUEDA_EXPORT_DIR" post-data
node packages/db/src/portability/cli.ts import-files
```

Chaque DEK est ré-enveloppée par le KMS du nouvel hébergeur (`kms_key_id` devient celui de sa clé maîtresse) ; la table des clés doit être vide, l'import se fait dans une seule transaction. Retirer ensuite la clé privée de séquestre du nouvel hébergeur.

## 6. Vérification, puis bascule

Même vérification que pour une restauration (rôles sans `SUPERUSER` ni `BYPASSRLS`, RLS `ENABLE` + `FORCE` partout, migrations, environnement déclaré, rôles de production L0-05, chaîne d'audit, oracle C12, invariants d'argent, occupations) :

```bash portabilite-verification
RUEDA_DB_ADMIN_PASSWORD="$(cat "$RUEDA_SECRETS_DIR/$RUEDA_DB_ADMIN_USER")" \
  RUEDA_DB_APP_API_PASSWORD="$(cat "$RUEDA_SECRETS_DIR/app_api")" \
  RUEDA_DB_APP_WORKER_PASSWORD="$(cat "$RUEDA_SECRETS_DIR/app_worker")" \
  node packages/db/src/restore/cli.ts
```

Code 1 si un contrôle échoue : ne pas basculer. Sinon : déployer la **même empreinte d'image** sur le nouvel hébergeur avec ses variables (adresse de la base, adaptateurs, secrets), vérifier que l'API répond et que le travailleur démarre, faire basculer le domaine (F-03), surveiller 30 min, journaliser. Puis détruire le dossier d'export et, une fois la période de repli écoulée, les données de l'ancien hébergeur.

## 7. Exercice (CI, à chaque PR)

Le job CI « reprise » lance, après l'exercice de restauration, `bash scripts/ops/portability-drill.sh` : deux instances PostgreSQL 16 locales (source peuplée en préproduction PA et PY, cible vide avec ses propres secrets), clés maîtresses locales et clé de séquestre tirées au hasard, puis les blocs ci-dessus **tels qu'écrits** (`scripts/ops/runbook.mjs`). `packages/db/test/portability/portability-drill.test.ts` compare ensuite, sous les rôles de production (assertion L0-05) :

- base identique : lignes par table, sommes d'argent par devise, tête de la chaîne d'audit, catalogue de sécurité, **lignes par pays** ; vérification verte ;
- **aucune fuite entre pays** : sous `app_api`, l'ADMIN du PA ne voit que les trips du PA, celui du PY que ceux du PY, et rien avec la portée de l'autre pays ;
- fichiers relus sous `evidence_verifier` avec la clé maîtresse de la **cible** (SHA-256 du clair = celui des octets envoyés) ; la clé de la source n'ouvre plus rien ; une clé détruite reste détruite ;
- séquestre (L1-PM-34) : ni l'export ni la sortie des étapes ne contiennent une DEK en clair, une clé maîtresse, la clé privée ou un mot de passe ; fichiers de l'export en 0600.

Tout est détruit à la fin ; aucun artefact n'est publié (l'export contient des données fictives, mais la règle est la même que pour un vrai).
