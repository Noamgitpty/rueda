# Runbook — rotation des secrets sans coupure (US-051)

Décision : [ADR-082](../adr/ADR-082-restauration-testee-rotation-secrets.md). Variables : [ENV_VARS.md](ENV_VARS.md). Déploiement : [DEPLOY.md](DEPLOY.md). Sauvegardes : [BACKUP_RESTORE.md](BACKUP_RESTORE.md). Ce runbook est l'un de ceux qu'US-405 fera rejouer par un agent qui ne l'a pas écrit.

**Aucun agent n'applique ce runbook en préproduction ou en production cloud** : il n'a ni compte, ni accès, ni secret (OPERATING_RULES §1). Le fondateur l'exécute avec ses propres accès. La partie locale (§ 4) est exécutée **telle qu'écrite** par la CI (job « reprise », `scripts/ops/rotation-drill.sh`) sur la préproduction locale et l'image de production, avec des valeurs tirées au hasard pour l'exercice.

## 1. Principe

Une rotation ne coupe jamais le service : pendant la transition, **deux valeurs** sont valides ou comptées, puis l'ancienne est **refusée**. Ordre général : (1) poser la valeur suivante là où elle est vérifiée, (2) redéployer les consommateurs, par vagues, avec les deux valeurs ou la nouvelle, (3) retirer l'ancienne. Une valeur n'est jamais affichée, journalisée, copiée dans un ticket ni commitée ; on la tire au hasard dans le coffre (`openssl rand -hex 32` saisi directement, ou génération du coffre).

## 2. Inventaire

| Secret                                                                         | Consommateurs                                | Mécanisme sans coupure                                                                                                                                                                                                   | Ancienne valeur refusée                                       | Preuve                                              |
| ------------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------- |
| mots de passe des rôles `app_api`, `app_worker`, `app_anon`, `migrator`        | API, travailleur, job de base                | `RUEDA_PGPASSWORD_NEXT` : une nouvelle connexion essaie la valeur courante puis, sur `28P01`, la suivante (`apps/api/src/db-pool.ts`) ; le job de base pose la suivante sur le rôle ; les connexions ouvertes continuent | oui, par PostgreSQL (un seul mot de passe par rôle)           | répétition locale (§ 4), `db-pool.test.ts`          |
| `RUEDA_RATE_LIMIT_KEY` (HMAC des compteurs)                                    | API                                          | `RUEDA_RATE_LIMIT_KEY_PREVIOUS` : chaque événement compté sous les deux empreintes, refus si l'une dépasse ; aucune limite remise à zéro ; retrait après 24 h (plus longue fenêtre)                                      | sans objet (clé de comptage) : retirée, elle n'a plus d'effet | répétition locale, `abuse-guard.test.ts`            |
| `RUEDA_STAFF_MFA_PROOF_KEY` (preuve d'élévation MFA)                           | API et `core.iam_mfa_proof_key`              | deux emplacements en base (migration 0053) : la base accepte la preuve sous l'ancienne et la nouvelle clé pendant le redéploiement                                                                                       | oui, après `PROMOTE`                                          | `l0-us051-mfa-key-rotation` (L0), répétition locale |
| mot de passe d'administration de la base                                       | job de base, vérification d'une restauration | géré par le service de base (`manage_master_user_password`, rotation du coffre) ; lu à chaque lancement du job                                                                                                           | oui, par le service                                           | hors dépôt (service géré)                           |
| jetons de session (voyageurs, hôtes, staff)                                    | API                                          | **aucun secret serveur** : jetons opaques, seule leur empreinte SHA-256 est en base ; en cas de doute, on révoque des sessions, on ne fait pas tourner de clé                                                            | —                                                             | US-010                                              |
| clés KMS (`data`, `files`, `backup`, `alerts`), secrets TOTP du staff          | coffre, stockage, enveloppes                 | rotation automatique annuelle des clés KMS (IaC) ; secret TOTP : nouvel enrôlement du membre du staff                                                                                                                    | —                                                             | US-036 (adaptateurs KMS réels)                      |
| identifiants PSP, KYC, facture électronique ; secret de signature des webhooks | lot C                                        | **aucun en préproduction aujourd'hui** (image sans FAKE, C19). Même schéma à deux valeurs exigé des adaptateurs réels (deux secrets de webhook acceptés pendant la transition)                                           | à câbler avec l'adaptateur                                    | US-061, US-223 (lot C)                              |

## 3. Cloud (préproduction puis production, par le fondateur)

Préalable : CI verte sur `main`, aucun déploiement en cours. Préproduction d'abord, production ensuite (même procédure). Dans AWS Secrets Manager, chaque contenant (`<env>/app_api_password`, etc., sortie `secret_arns`) garde ses versions : la valeur suivante est posée comme version **`AWSPENDING`**, puis promue **`AWSCURRENT`** ; l'ancienne devient `AWSPREVIOUS`.

> **Limite connue (Reste d'US-051)** : les définitions de tâches et `scripts/deploy/ecs.sh` ne savent pas encore injecter une valeur `AWSPENDING` le temps d'une rotation. Tant que ce câblage n'existe pas (US-036 / US-405, avant la première rotation cloud), les étapes « redéployer avec les deux valeurs » se font par une révision de transition enregistrée à la main (variables ci-dessous, valeur `<arn>::AWSPENDING:`), ou la rotation se fait dans une fenêtre de maintenance annoncée. La mécanique de l'application, elle, est prouvée (§ 4).

### 3.1 Mots de passe des rôles de la base

1. Pour chaque rôle (`migrator`, `app_api`, `app_worker`, `app_anon`) : poser une nouvelle version `AWSPENDING` tirée au hasard.
2. Redéployer l'API et le travailleur avec, en plus de `PGPASSWORD` (`AWSCURRENT`), `RUEDA_PGPASSWORD_NEXT` (`AWSPENDING`). Rien ne change encore : la valeur courante est acceptée.
3. Lancer le job de base avec les valeurs `AWSPENDING` (`RUEDA_DB_*_PASSWORD`) : il pose la nouvelle valeur sur chaque rôle. Les connexions ouvertes continuent ; les nouvelles basculent sur la valeur suivante (ligne `db.password.switched`, sans valeur, dans les journaux).
4. Promouvoir `AWSPENDING` en `AWSCURRENT` sur les quatre contenants.
5. Redéployer (même empreinte, `action=deploy`) : les tâches ne reçoivent plus que la nouvelle valeur.
6. Contrôler : aucune alarme 5xx ni de base pendant 30 min ; une connexion avec l'ancienne valeur est refusée (`28P01`). Noter la rotation dans le journal des déploiements.

### 3.2 Clé de débit `RUEDA_RATE_LIMIT_KEY`

1. Poser la nouvelle clé en `AWSPENDING` puis la promouvoir ; redéployer l'API avec `RUEDA_RATE_LIMIT_KEY` (nouvelle, `AWSCURRENT`) et `RUEDA_RATE_LIMIT_KEY_PREVIOUS` (ancienne, `AWSPREVIOUS`).
2. Après **24 h** (fenêtre du plafond SMS journalier, la plus longue), redéployer sans `RUEDA_RATE_LIMIT_KEY_PREVIOUS`.

### 3.3 Clé de preuve MFA `RUEDA_STAFF_MFA_PROOF_KEY`

Première installation (ouverture de la console staff) : `node packages/db/src/rotation/cli.ts mfa-proof-key INSTALL` en tâche ponctuelle de l'image (sous `migrator`, `RUEDA_STAFF_MFA_PROOF_KEY_NEXT` = la clé), puis déploiement de l'API avec `RUEDA_STAFF_MFA_PROOF_KEY` = la même clé. Rotation :

1. Nouvelle clé en `AWSPENDING` ; tâche ponctuelle `mfa-proof-key STAGE` avec `RUEDA_STAFF_MFA_PROOF_KEY_NEXT` = `AWSPENDING`. La base accepte alors les deux clés.
2. Promouvoir `AWSPENDING` ; redéployer l'API (nouvelle clé).
3. Tâche ponctuelle `mfa-proof-key PROMOTE` : l'ancienne clé est refusée. En cas d'abandon avant cette étape : `mfa-proof-key ABORT`.

### 3.4 Secret compromis

Même procédure, sans attendre : pour un mot de passe de base, enchaîner 3.1 en une fois ; pour la clé de débit, retirer `RUEDA_RATE_LIMIT_KEY_PREVIOUS` tout de suite (les compteurs repartent de zéro : risque accepté) ; pour la clé MFA, `STAGE` puis `PROMOTE` aussitôt après le redéploiement. Ouvrir un incident (17 §6.4, procédure US-405).

## 4. Préproduction locale (exécutée telle quelle par la CI)

Préproduction locale (`infra/local/compose.yaml`, image de production) servie par `scripts/deploy/local.sh`, avec la seconde instance de l'API (profil `rotation`) et une sonde qui joue le répartiteur et compte toute réponse autre que 200 (`scripts/ops/probe.mjs`). Variables : `RUEDA_IMAGE` (image servie, `rueda-local:<empreinte>`), `RUEDA_PROBE_TARGETS` (cibles en service). Les volumes de secrets jouent le coffre : `value` = `AWSCURRENT`, `next` = `AWSPENDING`, `previous` = `AWSPREVIOUS` (`infra/local/rotate-secrets.sh`).

Redéployer (une instance de l'API à la fois, l'autre sert ; puis le travailleur) :

```bash rotation-redeployer
bash scripts/ops/roll-local.sh
```

### 4.1 Mots de passe des rôles

Préparer : une valeur suivante par rôle, puis **redéployer**.

```bash rotation-bdd-preparer
docker compose -f infra/local/compose.yaml --profile rotation run --rm secrets-rotate stage db
```

Appliquer : le job de base pose la valeur suivante sur chaque rôle (les instances redéployées connaissent les deux).

```bash rotation-bdd-appliquer
docker compose -f infra/local/compose.yaml --profile job run --rm migrate
```

Promouvoir, puis **redéployer** (la nouvelle valeur seule), puis vérifier que l'ancienne est refusée :

```bash rotation-bdd-promouvoir
docker compose -f infra/local/compose.yaml --profile rotation run --rm secrets-rotate promote db
```

```bash rotation-bdd-verifier
docker compose -f infra/local/compose.yaml --profile rotation run --rm secrets-rotate verify db
```

### 4.2 Clé de débit

Préparer (nouvelle clé courante, l'ancienne comptée en double), puis **redéployer** ; après 24 h (l'exercice n'attend pas), retirer l'ancienne, puis **redéployer**.

```bash rotation-debit-preparer
docker compose -f infra/local/compose.yaml --profile rotation run --rm secrets-rotate stage rate-limit-key
```

```bash rotation-debit-retirer
docker compose -f infra/local/compose.yaml --profile rotation run --rm secrets-rotate retire rate-limit-key
```

### 4.3 Clé de preuve MFA

Installer la première clé (une fois, à l'ouverture de la console staff) :

```bash rotation-mfa-installer
docker compose -f infra/local/compose.yaml --profile rotation run --rm mfa-rotate INSTALL
```

Préparer (clé suivante posée en base : les deux acceptées), promouvoir dans le coffre, **redéployer**, puis promouvoir en base (l'ancienne refusée) :

```bash rotation-mfa-preparer
docker compose -f infra/local/compose.yaml --profile rotation run --rm secrets-rotate stage mfa
docker compose -f infra/local/compose.yaml --profile rotation run --rm mfa-rotate STAGE
```

```bash rotation-mfa-promouvoir-coffre
docker compose -f infra/local/compose.yaml --profile rotation run --rm secrets-rotate promote mfa
```

```bash rotation-mfa-promouvoir-base
docker compose -f infra/local/compose.yaml --profile rotation run --rm mfa-rotate PROMOTE
```

La répétition (`bash scripts/ops/rotation-drill.sh`, job CI « reprise ») enchaîne ces étapes dans l'ordre ci-dessus, sonde active du début à la fin : elle exige **zéro** réponse autre que 200, la bascule de chaque instance sur la valeur suivante (`db.password.switched`) quand elle redémarre après l'étape « appliquer », et le refus de chaque ancien mot de passe.
