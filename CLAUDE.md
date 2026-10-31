# CLAUDE.md — consignes pour tout agent du projet « rueda »

> « rueda » est un **nom de code provisoire**, pas une marque (la marque est DEC-MARQUE, une donnée de thème). Ce fichier est lu par **chaque agent** : il reste court. Règles complètes : [`docs/team/OPERATING_RULES.md`](docs/team/OPERATING_RULES.md). Point d'entrée de la spécification : [`docs/specs/CLAUDE_BUILD_HANDOFF.md`](docs/specs/CLAUDE_BUILD_HANDOFF.md).

## Mission (10 lignes)
Place de marché de location de véhicules pour le **Panama** et le **Paraguay**, construite par une équipe d'agents Claude Code. Le fondateur est le seul humain : il est product owner, fait la recette et s'occupe des comptes et du juridique.
- Modèle MVP : des **loueurs professionnels** ; **l'agence encaisse** avec son propre PSP ; la plateforme **facture une commission** et **ne détient aucun fonds**.
- Remise et retour se font au comptoir. Le client est un web mobile-first avec PWA.
- Ordre de construction : la Bêta pilote (lots 0 à 4 de `docs/specs/19_DEVELOPMENT_BACKLOG.md`), puis le P0-A (lot 5), puis les connecteurs réels (lot C) après le choix du pays.
- Pile : monorepo pnpm + Turborepo, TypeScript, NestJS (API + travailleur pg-boss) et Next.js. PostgreSQL 16, avec un schéma par module.

## Contraintes non négociables (handoff §1)
1. Aucune fusion sans revues indépendantes. Les revues argent, RLS / rôles, `SECURITY DEFINER` et concurrence se font sur un **autre modèle** que l'auteur.
2. Aucun PSP réel : uniquement les ports et les adaptateurs `FAKE`, **jamais actifs en production**.
3. **Deux pays de premier rang** : aucune constante propre à un pays dans le code. Les tests tournent en USD (PA) et en PYG sans décimale (PY).
4. Argent : `bigint` en unités mineures, `roundHalfUp` / `allocHost` uniques. Le règlement est une fonction pure versionnée. Une capacité PSP inconnue vaut « non ».
5. Réservation : on écrit **uniquement par commandes**. On s'appuie sur l'exclusion GiST et la conversion gardée. L'horloge fait foi côté base (`platform.now()`). RLS `ENABLE` + `FORCE` partout, et aucun rôle applicatif `BYPASSRLS`.
6. Les tests tournent **sous les rôles de production** (`app_api`, `app_worker`, `app_anon`), jamais sous `migrator` ni sous le superutilisateur. Chaque test commence par l'assertion L0-05.
7. Aucune décision du fondateur n'est prise à sa place : on code le **défaut fail-closed** de `docs/specs/22_OPEN_QUESTIONS.md`, on le marque PROPOSÉ et on continue.
8. La documentation fait partie de la DoD de chaque story (README du module, ADR, CHANGELOG, paramètres).
9. On ne reprend rien de Turo : ni son identité visuelle, ni ses textes, ni ses données, et on ne l'aspire pas.

## Interdits
- **Pousser sur `main`** ou y fusionner sans l'accord explicite du fondateur (TECH-003, EXC-001). Le force-push est interdit.
- Afficher, journaliser ou commiter un **secret**, y compris le mot de passe PostgreSQL local, qui reste hors du dépôt. Créer un compte ou entrer un vrai identifiant.
- `now()`, `current_timestamp` et apparentés dans le SQL métier (le lint échoue) : utiliser `platform.now()`.
- Importer l'intérieur d'un autre module : passer uniquement par son `index.ts` public (le lint échoue).
- Utiliser le code testé comme oracle : les valeurs attendues viennent de `docs/specs/08` et des oracles Python de `docs/specs/tools/` (`python -I -X utf8`).
- Modifier `docs/specs/`, sauf par une demande de fusion approuvée.

## Carte des documents (handoff §2)
| Sujet | Fait foi |
|---|---|
| règles métier, montants, états, vecteurs T01–T68 | `docs/specs/08_BUSINESS_RULES.md` |
| architecture, entités, RLS, paramètres, ADR, L0, tests | `docs/specs/17_DATA_MODEL_AND_ARCHITECTURE.md` |
| critères Given / When / Then, codes d'erreur, TA01–TA11 | `docs/specs/16_PRODUCT_REQUIREMENTS_DOCUMENT.md` |
| stories, DoR / DoD, équipe, lots | `docs/specs/19_DEVELOPMENT_BACKLOG.md` |
| décisions ouvertes et défauts | `docs/specs/22_OPEN_QUESTIONS.md` → `docs/team/DECISIONS.md` |
| UX, écrans, design | `docs/specs/10b_UX_UI_ANALYSIS.md` |

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
