# CLAUDE.md — consignes pour tout agent du projet « rueda »

> « rueda » est un **nom de code provisoire**, pas une marque (la marque est DEC-MARQUE, une donnée de thème : aujourd'hui **Kmino**). Ce fichier est lu par **chaque agent** : il reste court. Règles complètes : [`docs/team/OPERATING_RULES.md`](docs/team/OPERATING_RULES.md). Point d'entrée de la spécification : [`docs/specs/CLAUDE_BUILD_HANDOFF.md`](docs/specs/CLAUDE_BUILD_HANDOFF.md).

## Mission (10 lignes)

Place de marché de location de voitures **de particulier à particulier** pour le **Panama** et le **Paraguay**, construite par une équipe d'agents Claude Code. Le fondateur est le seul humain : il est product owner, fait la recette et s'occupe des comptes, des contrats et du juridique.

- Modèle : **hôtes particuliers uniquement, aucune agence ni loueur professionnel** (DEC-FONDATEUR-13) ; **par défaut, comme Turo** (DEC-FONDATEUR-14, 16) : trip fee, plans de protection vendus pour un assureur partenaire, part de l'hôte selon son plan (08). Le voyageur paie **Kmino, marchand de référence** ; un PSP de place de marché, **uniquement en `FAKE`** jusqu'au lot C, répartit chaque paiement en jambes (hôte, assureur, plateforme, taxe) ; l'hôte est versé après le trajet.
- Remise et retour **entre personnes**, sur un lieu déclaré par l'hôte. Le client est un web mobile-first avec PWA, **trilingue es / en / fr** (DEC-FONDATEUR-17).
- Ordre de construction : **bêta P2P** (lots 0 à 5 révisés de `docs/specs/19_DEVELOPMENT_BACKLOG.md` v3), puis les connecteurs réels (lot C) après le choix du pays et la **porte go / no-go du PSP**.
- Pile : monorepo pnpm + Turborepo, TypeScript, NestJS (API + travailleur pg-boss) et Next.js. PostgreSQL 16, avec un schéma par module.

## Contraintes non négociables (handoff §1)

1. Aucune fusion sans revues indépendantes. Les revues argent, RLS / rôles, `SECURITY DEFINER` et concurrence se font sur un **autre modèle** que l'auteur.
2. Aucun PSP réel : uniquement les ports et les adaptateurs `FAKE`, **jamais actifs en production**.
3. **Deux pays de premier rang** : aucune constante propre à un pays dans le code. Les tests tournent en USD (PA) et en PYG sans décimale (PY).
4. Argent : `bigint` en unités mineures, `roundHalfUp` / `allocHost` uniques. Le règlement est une fonction pure versionnée qui calcule **chaque jambe** (hôte, assureur, plateforme, taxe) ; une commande vers le PSP porte le **montant explicite de chaque jambe**, jamais un prorata. Une capacité PSP inconnue vaut « non » ; une capacité **bloquante** inconnue rend l'hôte non activable. Aucun fonds de tiers détenu : vrai en build et en `FAKE`, et en production tant que `funds_holding_enabled[pays]` = `false` (17 §0.1).
5. Réservation : on écrit **uniquement par commandes**. On s'appuie sur l'exclusion GiST et la conversion gardée. L'horloge fait foi côté base (`platform.now()`). RLS `ENABLE` + `FORCE` partout, et aucun rôle applicatif `BYPASSRLS`.
6. Les tests tournent **sous les rôles de production** (`app_api`, `app_worker`, `app_anon`), jamais sous `migrator` ni sous le superutilisateur. Chaque test commence par l'assertion L0-05.
7. Aucune décision du fondateur n'est prise à sa place : on code le **défaut fail-closed** de `docs/specs/22_OPEN_QUESTIONS.md`, on le marque PROPOSÉ et on continue. Les **interrupteurs de mise en service par pays** (`p2p_private_hosts_enabled`, `insurer_contract_active`, `funds_holding_enabled`, `payouts_enabled`) valent `false` en production ; ils ne changent que sur décision écrite du fondateur, par la **commande à deux personnes** de 17 v6 (`cmd_request_go_live_switch` puis `cmd_approve_go_live_switch`), **jamais par du code** ni par un agent.
8. La documentation fait partie de la DoD de chaque story (README du module, ADR, CHANGELOG, paramètres). Tout texte visible est livré **en es, en et fr** dans la même story (catalogue 10b §4.3).
9. **Comme Turo** pour toute question produit propre au P2P : on applique la solution de Turo adaptée au PA / PY, on la marque PROPOSÉ et on l'inscrit dans `docs/team/COMME_TURO.md` ; seuls les contrats, les dépenses et le juridique vont au fondateur. On ne reprend rien de Turo : ni son identité visuelle, ni ses textes, ni ses données, et on ne l'aspire pas.

## Interdits

- **Fusionner sur `main`** sans que toute la CI soit verte et que toutes les revues exigées soient APPROUVÉ (DEC-FONDATEUR-15) ; **jamais de push direct sur `main` ni de force-push** ; jamais contourner ou affaiblir un contrôle pour faire passer une PR.
- Afficher, journaliser ou commiter un **secret**, y compris le mot de passe PostgreSQL local, qui reste hors du dépôt. Créer un compte ou entrer un vrai identifiant.
- `now()`, `current_timestamp` et apparentés dans le SQL métier (le lint échoue) : utiliser `platform.now()`.
- Importer l'intérieur d'un autre module : passer uniquement par son `index.ts` public (le lint échoue).
- Utiliser le code testé comme oracle : les valeurs attendues viennent de `docs/specs/08` et des oracles Python de `docs/specs/tools/` (`python -I -X utf8`).
- Modifier `docs/specs/`, sauf par une demande de fusion revue (architecture, plus argent ou sécurité selon `docs/team/review-requirements.json`).

## Carte des documents (handoff §2)

| Sujet                                                                    | Fait foi                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| règles métier, trip fee, plans de protection, part de l'hôte, jambes, TJ | `docs/specs/08_BUSINESS_RULES.md`                                             |
| architecture, entités, RLS, interrupteurs, paramètres, ADR, L0, tests    | `docs/specs/17_DATA_MODEL_AND_ARCHITECTURE.md` (v6)                           |
| critères Given / When / Then, codes d'erreur, TA01–TA11                  | `docs/specs/16_PRODUCT_REQUIREMENTS_DOCUMENT.md` (v5)                         |
| stories, DoR / DoD, équipe, lots                                         | `docs/specs/19_DEVELOPMENT_BACKLOG.md` (v3)                                   |
| décisions ouvertes et défauts, OQ-P2P                                    | `docs/specs/22_OPEN_QUESTIONS.md` → `docs/team/DECISIONS.md`, `COMME_TURO.md` |
| UX, écrans, design, textes es / en / fr                                  | `docs/specs/10b_UX_UI_ANALYSIS.md` (v3, §4.3)                                 |

Ne lire d'un gros document **que la section citée par sa story**.

## Commandes (handoff §7 ; figées par US-002 / US-039)

Node.js 26.13 officiel (`C:\Program Files\nodejs`, voir ADR-041) et pnpm 10.34.

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck
pnpm test:unit
pnpm test:int     # PostgreSQL réel : natif en local (P-07), Testcontainers / postgres:16 en CI (fait foi)
pnpm test:l0      # preuves L0 sous les rôles de production
```

## Travailler sur une story

1. Lire ce fichier, puis `docs/team/roles/<rôle>.md`, puis la story dans 19, puis `docs/team/handoffs/US-xxx.md` si ce fichier existe.
2. Créer la branche `story/US-xxx-<slug>` et le worktree `../wt/US-xxx` (voir `CONTRIBUTING.md`).
3. Ajouter à chaque commit les pieds `Agent-Role: <rôle>` et `Agent-Model: <modèle>`.
4. Terminer par la passation `docs/team/handoffs/US-xxx.md` et un rapport d'une page au plus.
5. Poser les questions dans `docs/team/QUESTIONS.md`. L'état du projet est décrit dans `docs/team/RESUME_HERE.md` et `docs/team/BOARD.md`.
