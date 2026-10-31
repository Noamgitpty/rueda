# OPERATING_RULES — Règles d'exploitation de l'équipe d'agents (v1)

> **Version 1** — 2026-10-31, écrite par l'orchestrateur avant la première fusion (19 §1.9, US-029). Elle reprend le texte de `docs/specs/19_DEVELOPMENT_BACKLOG.md` §1.9 et du handoff §4.6, §4.7, §4.9 et §4.10. **Ces sources font foi en cas d'écart.** US-050 l'applique par configuration et la teste. **Fichier protégé** : toute modification passe par une demande de fusion approuvée par le fondateur (CODEOWNERS dès US-050). Les valeurs chiffrées sont **PROPOSÉES** et paramétrables.
>
> **Adaptations en vigueur au 2026-10-31** (voir `DECISIONS.md`) : identité git option A (TECH-003) ; famille B indisponible, donc revues dégradées sur un autre modèle Claude (TECH-007) ; banc PostgreSQL natif P-07 en local, les preuves faisant foi en CI (TECH-002) ; première fusion par exception (EXC-001).

## 1. Moindre privilège (secrets et base de données)

**Aucun agent ne détient de secret de production.**

| Acteur | Dépôt | Préproduction | Production | Secrets |
|---|---|---|---|---|
| Agents d'implémentation, de design et vérificateurs | branche de story seulement (aucun push sur `main`) | déploiement automatique depuis `main` ; base en lecture via `app_api` sur graines synthétiques PA / PY ; jamais `migrator` en interactif | **aucun accès** (ni console cloud, ni base, ni journaux bruts avec données personnelles) | secrets de test et clés `FAKE` seulement, injectés par la CI, jamais affichés |
| Red team | lecture seule | comptes de test, préproduction seulement | aucun | aucun |
| Orchestrateur | fusion par demande de fusion sur la branche protégée | idem agents + relance des déploiements de préproduction | **déclenche** le pipeline de production (§2) ; aucune session interactive sur la base | aucun secret de production (OIDC à durée courte côté pipeline) |
| Pipeline CI / CD | — | — | seul détenteur du droit de déployer ; `migrator` utilisé seulement par le job de migration | lecture au coffre au moment du job |
| Fondateur | propriétaire et administrateur (MFA) | — | propriétaire des comptes ; bris de glace journalisé (runbook US-405) | propriétaire du coffre et du séquestre (F-13) |

**Aucune donnée réelle** n'entre dans un environnement accessible aux agents.

**Poste local (P-07)** : le mot de passe du superutilisateur PostgreSQL local est stocké **hors du dépôt**. Seul le harnais de tests le lit, par un chemin de fichier passé en variable d'environnement. Il n'est **jamais affiché, journalisé ni commité**. Le superutilisateur sert uniquement à créer puis supprimer la base jetable de chaque série de tests et à installer les rôles. Les tests eux-mêmes tournent sous `app_api`, `app_worker` et `app_anon` (L0-05).

## 2. Porte de déploiement en production

Un déploiement de production est **déclenché seulement par l'orchestrateur**, via le pipeline, et seulement si toutes ces conditions sont réunies :
- (a) toutes les portes CI sont vertes sur le commit exact ;
- (b) la version est passée par la préproduction ;
- (c) le rapport « go » de re-vérification existe (US-408) ;
- (d) le fondateur a donné son **accord** dans l'environnement protégé `production`. Cet accord est requis pour les **5 premiers déploiements** (`founder_approval_first_prod_deploys` = 5). Ensuite, jusqu'à la fin de la recette pilote, il est requis pour toute version qui contient une migration de données ou destructive, un changement de RLS ou de rôles, ou un changement du moteur de règlement, de `Money` ou du devis.

L'orchestrateur peut lancer un retour arrière sans accord préalable ; il le notifie au fondateur.

## 3. Budget d'usage, limites, reprise

- **Budget du lot** = points du lot × usage mesuré par point (mesuré sur les 20 premiers points du lot 0, US-027) × 1,3. Plafonds mensuel et journalier fixés par le fondateur (F-15, en attente).
- **Seuils** :
  - 70 % du plafond journalier : alerte ;
  - 90 % : arrêt des tâches non critiques, régression nocturne réduite au minimum (C11 à 1 000, parcours dorés, oracle) ;
  - 100 % : point de reprise, puis arrêt.
- **Priorités quand le quota baisse** : (1) `main` rouge ou incident ; (2) chemin critique (19 §4.2) ; (3) revues qui débloquent une fusion ; (4) le reste.
- **Coupe-circuit** : un agent s'arrête s'il échoue 3 fois sur la même erreur (`agent_max_attempts_per_task` = 3) ou s'il dépasse 2 fois l'usage prévu. Il écrit alors « BLOQUÉ » dans sa passation. L'orchestrateur réassigne, découpe ou escalade.
- **Point de reprise** :
  - (a) commits poussés à chaque étape sur la branche de story, et passation tenue à jour ;
  - (b) à l'avertissement de limite, finir ou annuler l'étape atomique en cours (jamais une migration à moitié appliquée), pousser, puis passer la story en `PAUSED_USAGE_LIMIT` avec l'heure de reprise ;
  - (c) la session qui reprend lit `docs/team/RESUME_HERE.md`, `BOARD.md` et les passations, et **relance les tests de la branche** avant de continuer ;
  - (d) le rapport de santé consigne l'interruption.
  
  Une revue interrompue est relancée en entier. Les sous-agents d'une session interrompue sont considérés comme perdus : on repart de leur dernier commit poussé.

## 4. Modèles par rôle (`team.model.*`)

| Rôles | Famille par défaut (PROPOSÉ) | Paramètre | En vigueur au 2026-10-31 |
|---|---|---|---|
| Orchestrateur, back-end, données, front-end, intégrations, design | famille A : Claude, modèle le plus capable | `team.model.implementation` | `claude-opus-5-5` |
| Revue de code, QA, architecture, UX / design | famille A, autre instance sans contexte partagé, de préférence un autre modèle | `team.model.review` | `claude-sonnet-5-5` |
| Argent, sécurité (RLS, rôles, `SECURITY DEFINER`), concurrence, re-vérification US-408, red team | **famille B** : autre fournisseur, approuvé par le fondateur (F-15) | `team.model.independent_review` | **indisponible** : `claude-sonnet-5-5`, marqué « **revue dégradée** », rejoué en famille B avant toute production ; au-delà de 5 jours ouvrés, escalade au point hebdomadaire |
| Oracle de règlement (US-016) | famille A, agent distinct de celui du moteur (US-017) ; revu par la famille B | — | — |

Cible : la revue famille B est un **job de CI** déclenché sur la demande de fusion, avec l'étiquette `review:money` ou `review:security`. La clé d'API est un secret de CI que les agents ne lisent pas. Ce job sera mis en place par US-050 après F-15.

## 5. Branches, fusion, identité

- **Une story = une branche `story/US-xxx-<slug>` et un worktree `../wt/US-xxx`.** Jamais deux agents sur la même migration ni sur le même fichier de configuration.
- **`main` protégée** (cible US-050) : demande de fusion obligatoire, statuts CI et rapports de revue requis, historique linéaire, ni push direct ni force-push. CODEOWNERS (fondateur) sur : migrations, RLS, `SECURITY DEFINER`, STL / PAY / PRC / AVL, `Money`, IaC, workflows, `OPERATING_RULES.md` et `CLAUDE.md`.
- **Seul l'orchestrateur fusionne.** **Aucune fusion vers `main` sans l'accord explicite du fondateur** tant que F-01 (compte machine, option B) et US-050 ne sont pas faits (TECH-003). La première fusion (US-001 avec US-029) est une exception consignée (EXC-001).
- **Identité** (option A, TECH-003) : les commits sont faits sous l'identité git du fondateur. Chaque commit porte en pied `Agent-Role: <rôle>` et `Agent-Model: <modèle>`.
- **Revue ≠ auteur** : un rapport de revue est un fichier `docs/team/reviews/US-xxx/<rôle>-<date>.md`. Son relecteur est un nouvel agent, sans le contexte de l'auteur. `scripts/team/check-reviews.mjs` vérifie la présence des rapports, le verdict et l'écart entre relecteur et auteur. US-002 le branche en CI.

## 6. Piste d'audit

Chaque session écrit un journal `docs/team/sessions/AAAA-MM-JJ-<agent>.md`. Il indique l'agent, le rôle, le modèle, la story, les commandes sensibles (migrations, déploiements, accès à la préproduction, relances), les fichiers touchés et le résultat. Les journaux GitHub et ceux de l'hébergeur sont conservés au moins 1 an. L'agent sécurité les relit à chaque porte de lot.

## 7. Escalade

- Les agents décident seuls de tout ce qui est technique, dans le cadre de 17. Une nouvelle décision d'architecture passe par un ADR revu par l'agent architecture.
- On n'escalade que deux choses : (a) les actions réservées à un humain (19 §6) et (b) les décisions produit de 22 / 19 §5. Chaque escalade porte un défaut, et le travail continue avec ce défaut.
- Les escalades sont groupées au **point hebdomadaire** (`docs/team/weekly/AAAA-Wnn.md`) : 5 décisions au plus.
- Hors de ce point, on n'interrompt le fondateur que pour un incident de production ou une action humaine qui bloque le chemin critique.
