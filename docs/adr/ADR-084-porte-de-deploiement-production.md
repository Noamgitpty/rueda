# ADR-084 — Porte de déploiement en production imposée par le code

- **Statut** : PROPOSÉ (US-003, durcissement, agent back-end, 2026-11-04). Revues exigées : code ; **architecture** (story) ; **sécurité** (story, `.github/`, IaC, image), sur un autre modèle que l'auteur. Complète [ADR-078](ADR-078-environnements-iac-deploiement-reversible.md) §8.
- **Origine** : revue sécurité d'US-003 (`docs/team/reviews/US-003/securite-2026-11-04b.md`), constat 2 (MAJEUR), constats 4 et 10, suivi 1. **Sources** : OPERATING_RULES §1, §2 ; DEC-FONDATEUR-15 ; [`docs/ops/DEPLOY.md`](../ops/DEPLOY.md), [`docs/ops/ACCOUNTS.md`](../ops/ACCOUNTS.md).

## Contexte

L'accord du fondateur avant un déploiement en production reposait sur un **réglage manuel** du dépôt : l'approbateur requis de l'environnement GitHub `production` (DEPLOY.md §4, étape 8). Ce réglage n'existe pas encore. Or GitHub crée l'environnement **sans protection** au premier run qui le nomme, et le rôle AWS de déploiement ne vérifiait que `repo:<dépôt>:environment:<env>`. Un run lancé par le compte des agents aurait donc pu déployer sans accord, et une copie modifiée de `deploy.yml` sur une autre branche aurait obtenu les mêmes identifiants. De plus, le runbook annonçait un retour arrière de production « sans accord préalable », alors que le job y est soumis.

Le défaut n'est pas exploitable aujourd'hui (aucun compte cloud), mais il doit être corrigé avant le premier déploiement cloud.

## Décision

1. **Rôle OIDC lié au workflow, à la branche et à l'environnement** (`infra/opentofu/modules/environment/iam.tf`). Pour un fournisseur OIDC, les clés de condition qu'AWS documente sont `aud` et `sub`. Le dépôt publie donc un `sub` **personnalisé** (`PUT /repos/<dépôt>/actions/oidc/customization/sub`, `include_claim_keys = ["repo", "context", "ref", "job_workflow_ref"]`, réglage du fondateur). Le rôle exige l'égalité **exacte** (`StringEquals`, sans joker) avec :
   `repo:<dépôt>:environment:<env>:ref:refs/heads/main:job_workflow_ref:<dépôt>/.github/workflows/deploy.yml@refs/heads/main`.
   Si la branche, le workflow, l'environnement ou le dépôt diffère, la demande est refusée. Elle l'est aussi quand la personnalisation est absente (le `sub` par défaut ne correspond pas) : le système échoue fermé. `github_repository` est validé (`propriétaire/nom`, sans `:` ni joker). La sortie `deploy_oidc_subject` publie la valeur attendue. **Preuve** : `tofu test`, runs `oidc_production` et `oidc_preproduction` (jetons candidats écrits à la main ; acceptation si et seulement si chaque condition est égale à l'affirmation de même nom), et `depot_avec_deux_points_refuse`.
2. **Porte « accord du fondateur » dans `deploy.yml`**, pour **toute** action dont la cible est `production` (`deploy` et `rollback`). Elle s'exécute **avant** tout identifiant AWS, avec le jeton éphémère du job (`contents: read`, `actions: read`, `id-token: write` ; aucune permission d'écriture). Elle lit `GET /repos/<dépôt>/environments/production` et `GET /repos/<dépôt>/actions/runs/<run>/approvals`. Le script `scripts/deploy/production-gate.mjs` (fonction pure, testée) exige :
   - que l'environnement existe ;
   - qu'il porte une règle `required_reviewers` avec au moins un approbateur ;
   - qu'il restreigne les branches (`deployment_branch_policy` non nul) ;
   - que le run courant ait été **approuvé** pour `production` par une personne qui n'est pas un bot, et qui n'est ni l'acteur du run ni la personne qui l'a lancé ou relancé ;
   - qu'aucun refus ne soit enregistré.
     Si une condition manque, le run échoue. Le compte des agents ne peut donc pas s'approuver lui-même, même s'il figure parmi les approbateurs.
3. **Ordre de mise en place** (DEPLOY.md §4, étape 0 ; ACCOUNTS.md) : avant toute variable, tout secret ou tout run, le fondateur crée l'environnement protégé `production`, avec lui comme approbateur, la branche `main` seule et l'auto-approbation interdite. Il pose ensuite la personnalisation du `sub` OIDC.
4. **Retour arrière en production = même porte.** Le runbook, l'en-tête de `deploy.yml` et ADR-078 §8 l'écrivent désormais : en production, le retour arrière manuel attend l'accord du fondateur (la sécurité prime) ; en préproduction, il se fait sans accord. Le retour arrière **automatique** (coupe-circuit d'ECS pendant un déploiement déjà approuvé) n'en demande pas d'autre.
5. **Autorité de certification de la base gérée dans l'image.** Le paquet public « global » d'Amazon RDS (`docker/prod/certs/rds-global-bundle.pem`, 114 autorités, aucune clé privée) est commité et épinglé par sa somme SHA-256 dans le `Dockerfile`. Une autre version fait échouer la construction. `NODE_EXTRA_CA_CERTS=/app/certs/rds-global-bundle.pem` est posée dans l'image. `image-checks.sh` vérifie trois points : la variable, la somme (identique au fichier du dépôt) et le chargement par Node.js d'au moins 100 autorités. Le point US-036 « autorité TLS de la base » est ainsi soldé ; les adaptateurs réels KMS et S3 restent dans US-036.
6. **`ecs.sh run_db_job`.** Si `run-task` ne lance aucune tâche (erreur de l'appel, capacité, `failures` d'ECS), le journal porte `DEPLOY FAILED` (`reason` : job de base non lancé), rien n'est basculé et le run sort en 1. Preuve : `scripts/deploy/ecs.test.mjs`, avec des doubles d'`aws` et de `jq` et le vrai journal.

## Conséquences

- Un déploiement ou un retour arrière en production exige **trois** conditions indépendantes : la protection GitHub, que la porte revérifie, et le rôle AWS lié au workflow sur `main`. L'absence du réglage n'ouvre plus rien.
- **Le fondateur ne peut pas approuver un run qu'il a lancé lui-même.** C'est la règle PROPOSÉE : l'orchestrateur lance, le fondateur approuve. Pour déployer seul, il lui faudrait un second approbateur ; la question est tracée dans QUESTIONS Q-010.
- L'accord est exigé pour **toute** action en production. L'allègement d'OPERATING_RULES §2 (d) après les 5 premiers déploiements n'est pas codé : il demandera une PR sous revue sécurité (Q-010).
- La personnalisation du `sub` s'applique à **tout** le dépôt. Aucun autre workflow n'utilise OIDC aujourd'hui (`id-token: write` n'apparaît que dans `deploy.yml`).
- Mettre à jour le paquet RDS demande de remplacer le fichier et la somme dans la même PR, sous revue sécurité.

## Limites

- **Rien n'a tourné contre un vrai compte.** Le format exact du `sub` personnalisé est celui de la documentation de GitHub. Si GitHub produit autre chose, la demande est refusée (fail-closed). Le fondateur compare alors la sortie `deploy_oidc_subject` au `sub` réel (étape de vérification de DEPLOY.md §4).
- **La protection de `main` (US-050) reste la base.** Un `deploy.yml` affaibli puis fusionné sur `main` contournerait la porte. La fusion exige les revues, et la revue sécurité pour `.github/` (`docs/team/review-requirements.json`).
- **Un compte qui a les droits d'administration du dépôt** peut retirer la protection. Le compte des agents ne doit pas les avoir (ACCOUNTS.md).

## Alternatives écartées

- **Conditions IAM directes sur `job_workflow_ref` ou `ref`** : pour un fournisseur OIDC, la documentation d'AWS ne garantit que les clés `aud` et `sub`. Une condition sur une clé non prise en charge refuserait tout, ou ne protégerait rien si elle était mal écrite. Le `sub` personnalisé est la voie que GitHub documente.
- **`StringLike` avec joker** (`repo:<dépôt>:*`) : il accepterait une autre branche ou un autre workflow.
- **Vérifier la protection seulement dans le runbook** : c'est le défaut que corrige cet ADR.
- **Télécharger l'autorité RDS pendant la construction** : la construction dépendrait du réseau et le contenu ne serait pas relu en revue. Le fichier commité et épinglé est contrôlé.
