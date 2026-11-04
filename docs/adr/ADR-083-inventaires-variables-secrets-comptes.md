# ADR-083 — Inventaires des variables, des secrets et des comptes, contrôlés par la CI

- **Statut** : PROPOSÉ (US-037, agent back-end, 2026-11-04). Revues exigées : code ; **sécurité** (story, `scripts/ci/`), sur un autre modèle que l'auteur. À reporter dans 17 §6.6 et §8.1 (orchestrateur).
- **Stories** : US-037 ; s'appuient dessus US-051 (rotation exercée), US-405 (bris de glace, incidents), US-050 (protection de branche, compte machine F-01), toute story qui ajoute une variable ou un fournisseur (lot C). **Sources** : 19 US-037, §1.4 point 6, §6 ; 17 §6.6 (Secrets, Fournisseurs) ; OPERATING_RULES §1 ; ADR-078 (IaC), ADR-080 (sauvegardes) ; Q-007, Q-008.

## Contexte

`docs/ops/ENV_VARS.md` existait mais n'était tenu qu'à la main : au début d'US-037, 39 variables lues par le dépôt n'y figuraient pas (drapeaux `WEB_*`, `THEME_*`, `RUEDA_MONEY_ORACLE_*`, variables de tiers et des workflows). Il ne disait ni l'environnement ni le propriétaire de chaque valeur, ni où vit chaque secret, comment il tourne et qui y a accès. Aucun document ne listait les comptes dont dépend le projet ni leur titulaire. Le dépôt est public.

## Décision

1. **Inventaire des variables** (`docs/ops/ENV_VARS.md`) : pour chaque variable, usage, environnements, **propriétaire de la valeur** (fondateur, IaC, image, compose, CI, poste, plateforme), secret ou non, story. Jamais de valeur. Trois tableaux : application et outils ; tiers posés par le dépôt ; plateforme et plomberie des workflows.
2. **Contrôle anti-oubli** (`scripts/ci/check-env-inventory.mjs`, lancé par `pnpm lint`, donc par le job `qualité`) : il balaie les fichiers suivis par git et relève toute variable **lue ou posée** : TS / JS (`process.env.X`, `env['X']`, `env[CONST]`, déstructuration, objets `env: {…}`, littéraux `RUEDA_…`), shell (lue sans être affectée dans le script, `export`, `docker -e`), compose (interpolation, clés d'environnement), workflows (`vars.`, `secrets.`, `env.`, blocs `env:`), IaC (`name = "X"` des définitions de tâche, littéraux `RUEDA_…`), Dockerfile (`ENV`), `turbo.json`, `.env.example`. Une variable absente de la première colonne d'un tableau de l'inventaire fait échouer la PR, avec le fichier et la ligne. **Fail-closed** : inventaire vide ou balayage qui ne trouve rien = échec. Les entrées sans lecture balayée sont seulement signalées (lues par Node.js ou un outil tiers, par exemple `NODE_EXTRA_CA_CERTS`).
3. **Preuve que le contrôle n'est pas à vide** (`check-env-inventory.test.mjs`) : un test par source ; sur le dépôt réel, au moins 80 variables et toutes les sources contribuent, dix lectures connues sont retrouvées ; **échecs volontaires** : retirer une ligne de l'inventaire (cinq variables, dont deux secrets), ajouter une lecture nouvelle, lancer la ligne de commande avec un inventaire partiel : chaque cas échoue.
4. **Secrets** (`ENV_VARS.md` § « Secrets ») : pour chacun, où il vit (coffre de l'hébergeur, chiffré par la clé `data` ; secret géré par le service pour l'administration de la base), rotation (runbook d'US-051, procédure provisoire d'amorçage d'ici là), qui y a accès (fondateur et rôle d'exécution de la seule tâche qui le consomme, `iam.tf`). Aucun agent.
5. **Comptes** (`docs/ops/ACCOUNTS.md`) : GitHub (propriétaire et bot), hébergeur (organisation, préproduction, production, sauvegarde), domaine, messagerie, e-mail, SMS, KYC, cartes, PSP par pays, assureur, abonnements des agents. Pour chacun : ce qu'il contrôle, titulaire attendu (**le fondateur**, jamais un agent ni un prestataire), état, accès des agents. Des rôles, jamais des données : un test (`accounts-inventory.test.mjs`) refuse un titulaire autre que le fondateur, une catégorie manquante et toute adresse e-mail, numéro de compte AWS, ARN, téléphone, clé d'accès ou jeton GitHub.
6. **Bot `Projetapploccar`** : il doit appartenir au fondateur et rester révocable par lui ; il n'est titulaire de rien. Sinon, compte machine créé par le fondateur (F-01, option B) avant toute fusion autonome.

## Conséquences

- Toute story qui ajoute une variable (ou un workflow qui en pose une) doit l'inscrire dans `ENV_VARS.md` dans la même PR, sinon `qualité` est rouge. Les variables relais des workflows (`EVENT_NAME`, `TARGET`…) sont inventoriées aussi : un peu de bruit, mais aucune exception dans le script.
- Les exclusions du balayage (docs, `*.md`, lockfile, le contrôle et son test) sont **en dur** : les élargir touche `scripts/ci/`, donc revue sécurité (DEC-FONDATEUR-15). L'inventaire lui-même n'est pas protégé : un ajout y est le comportement attendu ; la revue de code vérifie qu'il ne porte aucune valeur.

## Limites et reports

- Analyse lexicale, pas sémantique : une lecture par un nom calculé à l'exécution (par exemple `*_ADAPTER` filtré par suffixe dans `startup-guard.ts`) n'est pas vue ; la famille est documentée à la main (`PSP_ADAPTER`). Le shell des étapes `run:` des workflows n'est pas balayé : une variable y passe par un bloc `env:` (relevé) ou vient de la plateforme (`GITHUB_*`, `RUNNER_*`).
- Le contrôle ne compare pas l'inventaire aux secrets réellement saisis dans le coffre (aucun accès des agents) : c'est la vérification du fondateur à chaque porte de lot (`ACCOUNTS.md`).
- Rotation : runbook US-051 (en cours) ; incidents et bris de glace : US-405.
