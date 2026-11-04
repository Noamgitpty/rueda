# Déploiement et retour arrière (runbook, US-003)

Décision : [ADR-078](../adr/ADR-078-environnements-iac-deploiement-reversible.md). Règles : [OPERATING_RULES §1 et §2](../team/OPERATING_RULES.md). Variables : [ENV_VARS.md](ENV_VARS.md). Infrastructure : [`infra/README.md`](../../infra/README.md).

## 1. Environnements

| Environnement         | Où                                          | Image                          | Base déclarée   | Données                          | FAKE                       |
| --------------------- | ------------------------------------------- | ------------------------------ | --------------- | -------------------------------- | -------------------------- |
| développement         | `compose.yaml` (racine), poste ou CI        | développement (`docker/dev`)   | `development`   | graines PA / PY                  | bibliothèques, hors API    |
| préproduction locale  | `infra/local/compose.yaml`, poste ou CI     | **production** (`docker/prod`) | `preproduction` | graines PA / PY                  | aucun (absents de l'image) |
| préproduction (cloud) | `infra/opentofu/environments/preproduction` | **production**, même empreinte | `preproduction` | synthétiques, jamais de KYC réel | aucun                      |
| production (cloud)    | `infra/opentofu/environments/production`    | **production**, même empreinte | `production`    | réelles                          | aucun ; refus de démarrer  |

La base porte son environnement (migration 0050) : déclaré une fois par le job de base, jamais modifié. Une base non déclarée vaut `production` (fail-closed).

## 2. Stratégie (identique en local et en cloud)

1. **Image immuable** : construite une fois, désignée par son empreinte `sha256:…`. La production reçoit la même empreinte que la préproduction (copie du manifeste, jamais une reconstruction).
2. **Job de base d'abord** (`node packages/db/src/deploy/cli.ts`) : amorçage des rôles, migrations, déclaration de l'environnement, vérification sous `app_api` (aucun compte PSP FAKE). En échec : rien n'est basculé, la version servie reste.
3. **Migrations expand / contract** : une migration ne casse jamais la version encore servie (ajout de colonnes, de tables, de fonctions ; la suppression vient dans une version ultérieure, quand plus rien ne lit l'ancien objet). Le retour arrière ne rejoue donc **aucune migration descendante**. Règle **imposée** depuis US-046 (ADR-081) : `pnpm lint:sql` refuse toute contraction sans dérogation justifiée (`packages/db/expand-contract-allowlist.json`), et le test `l0-us046-migrations` applique chaque migration seule sur une base peuplée en vérifiant que le schéma de la version N est conservé.
4. **Bascule gardée par la santé** : API saine (`GET /brand/content?locale=es` = 200), travailleur en marche.
5. **Retour arrière automatique** si la nouvelle version n'est pas saine : script local, coupe-circuit d'ECS (`rollback = true`).
6. **Retour arrière manuel** : resservir l'empreinte précédente du journal.
7. **Journal** : une ligne JSON par étape (`DEPLOY` / `ROLLBACK`, `STARTED` / `SUCCEEDED` / `FAILED`, empreinte, version, origine, motif). Local : fichier ; cloud : compartiment des preuves (`ops/deployments/<env>/`, verrouillage d'objet) et résumé du run GitHub (conservé au moins 1 an).

## 3. Préproduction locale

Prérequis : Docker, bash, Node, curl. Depuis la racine du dépôt :

```bash
docker build -f docker/prod/Dockerfile --build-arg RUEDA_RELEASE="$(git rev-parse --short=12 HEAD)" -t rueda-api:local .
bash scripts/deploy/image-checks.sh rueda-api:local       # sans FAKE, non root, sans test
bash scripts/deploy/local.sh deploy "$(docker image inspect -f '{{.Id}}' rueda-api:local)"
bash scripts/deploy/local.sh status                       # image et version servies
bash scripts/deploy/local.sh rollback                     # empreinte précédente du journal
bash scripts/deploy/local.sh destroy                      # base et secrets compris ; journal gardé
```

L'API répond sur `http://127.0.0.1:3300` (`RUEDA_LOCAL_API_PORT`). Le journal est dans `infra/local/.journal/deployments.jsonl` (non suivi ; `RUEDA_DEPLOY_JOURNAL`). La répétition complète, celle de la CI (job `déploiement local`), est `bash scripts/deploy/rehearsal.sh`.

## 4. Cloud : amorçage (une fois, par le fondateur)

Rien de cette section n'est fait par un agent. Elle suppose les décisions de [QUESTIONS Q-007](../team/QUESTIONS.md) (hébergeur, région, budget, comptes) et le domaine (F-03).

1. **Compte et garde-fous** : compte(s) AWS au nom de l'entité du fondateur, MFA, alertes de budget (F-02).
2. **Fournisseur OIDC GitHub** dans chaque compte (`token.actions.githubusercontent.com`, audience `sts.amazonaws.com`) ; noter son ARN.
3. **État OpenTofu** : un compartiment chiffré et versionné par compte ; décommenter le bloc `backend "s3"` de la racine de l'environnement.
4. **Certificat TLS** du sous-domaine de l'environnement (ACM, validation DNS).
5. **Autorité de certification de la base gérée** : ajouter le paquet de l'hébergeur à l'image et poser `NODE_EXTRA_CA_CERTS` (US-036). Sans lui, `PGSSLMODE=verify-full` refuse la connexion (fail-closed).
6. **Variables** : copier `<env>.tfvars.example` en `<env>.tfvars` (non suivi), remplir. Puis :

   ```bash
   cd infra/opentofu/environments/preproduction
   tofu init && tofu plan -var-file=preproduction.tfvars -out=plan && tofu apply plan
   ```

   Le premier `image_digest` est celui d'une image construite par le pipeline (`build`), poussée dans le registre créé par ce même `apply` : appliquer d'abord avec la cible `-target=module.environment.aws_ecr_repository.api`, lancer `build`, puis appliquer le reste. Commiter `.terraform.lock.hcl`.

7. **Secrets** (la seule action manuelle d'une reconstruction) : pour chaque contenant de la sortie `secret_arns`, saisir une valeur tirée au hasard (`openssl rand -hex 32`), sans l'afficher ni la copier ailleurs : `migrator_password`, `app_api_password`, `app_worker_password`, `app_anon_password`, `rate_limit_key` ; `staff_mfa_proof_key` le jour où la console staff s'ouvre (US-012). Le mot de passe d'administration de la base est géré par le service.
8. **Environnements GitHub** `preproduction` et `production` : variables (aucun secret) `RUEDA_AWS_REGION`, `RUEDA_DEPLOY_ROLE_ARN`, `RUEDA_CLUSTER`, `RUEDA_REPOSITORY_URL`, `RUEDA_SUBNETS` (virgules), `RUEDA_APP_SECURITY_GROUP`, `RUEDA_EVIDENCE_BUCKET`, plus `RUEDA_SOURCE_REPOSITORY_URL` en production (registre de préproduction). Sur `production` : **approbateur requis = le fondateur**, branche `main` seulement (`founder_approval_first_prod_deploys` = 5, OPERATING_RULES §2 d).
9. Recommencer 3 à 8 pour la production (`production.tfvars`, avec `promotion_source_repository_arn`).

**Reconstruction de la préproduction** (critère 2) : `tofu destroy` puis `tofu apply` (compartiments et registre vidés avec, secrets réutilisables aussitôt), saisie des secrets (étape 7), `deploy preproduction <empreinte>`.

## 5. Cloud : déployer (orchestrateur)

Depuis l'onglet Actions, workflow **deploy** (ou `gh workflow run deploy.yml -f action=… -f target=… -f image_digest=…`), sur `main` seulement :

1. `action=build target=preproduction` : l'empreinte est dans le résumé du run (`digest=sha256:…`).
2. `action=deploy target=preproduction image_digest=<empreinte>` : job de base, bascule, stabilité. Vérifier le parcours en préproduction.
3. Porte de production (OPERATING_RULES §2) : CI verte sur le commit, rapport « go » (US-408), puis `action=deploy target=production image_digest=<même empreinte>`. Le pipeline refuse une empreinte jamais déployée avec succès en préproduction ; l'environnement `production` attend l'accord du fondateur.

## 6. Retour arrière

- **Automatique** : une version non saine ne remplace pas la précédente (coupe-circuit ECS, script local). Le journal porte `DEPLOY FAILED` puis `ROLLBACK SUCCEEDED` (`reason: automatique`). Le run sort en erreur.
- **Manuel** : `action=rollback target=<env>` (sans accord préalable ; l'orchestrateur notifie le fondateur). Ressert l'empreinte précédente du journal, sans job de base ni migration descendante. Journal : `ROLLBACK SUCCEEDED` (`reason: manuel`, `from` = empreinte retirée).
- **Si une migration est en cause** : ne jamais modifier une migration appliquée. Écrire une migration corrective (nouvelle version), la faire passer par la préproduction, puis déployer.
- **Si le retour arrière échoue** (`ROLLBACK FAILED`) : incident ; le mode dégradé et l'astreinte sont décrits en 17 §6.4 (procédure d'incident : US-004, US-405).

## 7. Interdits

- Aucun agent n'applique l'IaC, ne crée de compte, ne lit un secret ni ne se connecte à la production (OPERATING_RULES §1).
- Les interrupteurs de mise en service (`p2p_private_hosts_enabled`, `insurer_contract_active`, `funds_holding_enabled`, `payouts_enabled`) ne sont **jamais** posés par l'IaC, le pipeline ou un script : seulement par la commande à deux personnes de 17 v6 (test `aucun_fake_ni_interrupteur_dans_l_iac`).
- Aucun FAKE en préproduction ni en production : l'image n'en contient pas (`image-checks.sh`), l'API refuse de démarrer en production avec une variable `*_ADAPTER=FAKE` ou un compte PSP FAKE (C19).
