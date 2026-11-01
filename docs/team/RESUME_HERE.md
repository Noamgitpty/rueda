# RESUME_HERE — point de reprise du dépôt

> Lu en premier par toute session qui reprend le travail (handoff §4.9). Tenu par l'orchestrateur à chaque fin de session. **Dernière mise à jour : 2026-10-31, fin de la session 01.**

## Pour reprendre

1. Lis `CLAUDE.md`, ce fichier, puis `docs/team/BOARD.md`, les passations `docs/team/handoffs/US-xxx.md` des stories `IN_PROGRESS`, `IN_REVIEW` ou `PAUSED_USAGE_LIMIT`, et les questions ouvertes de `docs/team/QUESTIONS.md`. Ne relis pas tout `docs/specs/`.
2. Sous Git Bash : `export PATH="/c/Program Files/nodejs:/c/Users/noamm/AppData/Roaming/npm:$PATH"`. Vérifie `node -v`, qui doit donner v26.13.0 (ADR-041).
3. `git fetch`, `git worktree list`, puis relance les tests de chaque branche en cours **avant** de continuer (OPERATING_RULES §3).

## État des stories (détail dans BOARD.md)

| Story                       | Statut      | Branche                                                             | Où en est-on                                                                                                                                                                                                                              |
| --------------------------- | ----------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-001 dépôt et conventions | MERGED      | `story/US-001-029-socle`                                            | Revue de code APPROUVÉE. La revue d'architecture a demandé des changements, corrigés après coup, et une seconde revue a été faite (voir `docs/team/reviews/US-001/`). **Fusion en attente de l'accord explicite du fondateur (EXC-001).** |
| US-029 artefacts d'équipe   | IN_REVIEW   | `story/US-001-029-socle` (même branche)                             | Revue de code avec changements demandés, corrigés, puis seconde revue (voir `docs/team/reviews/US-029/`). Le contrôle `scripts/team/check-reviews.mjs` sera branché en CI par US-002.                                                     |
| US-028 naming et identité   | IN_REVIEW   | `story/US-028-naming-identite`                                      | Livrée au fondateur : `docs/design/US-028/PROPOSITIONS.md` et `presentation.html`. Revue UX APPROUVÉE. **En attente du choix du fondateur (DEC-MARQUE, F-05).**                                                                           |
| US-005 banc PostgreSQL      | IN_PROGRESS | `story/US-005-banc-postgres` (à partir de `story/US-001-029-socle`) | Démarrée sur le PostgreSQL natif (P-07, ADR-043). Ne sera fusionnée qu'après US-002, quand ses tests tourneront en CI (TECH-008). Voir `docs/team/handoffs/US-005.md`.                                                                    |

## Prochaine action exacte (orchestrateur)

1. ~~EXC-001~~ : fait. Le fondateur a approuvé ; la PR #1 a été fusionnée dans `main` en avance rapide le 2026-11-01 (f66304f). Faire fusionner aussi cette branche de registre (`chore/registre-fusion-us-001`).
2. Lancer en parallèle, chacune dans son worktree, depuis `main` : US-002 (CI : intégrer `check-reviews.mjs`, Testcontainers et `postgres:16`), US-015 (`Money`), US-014 (i18n), US-026 (PWA iOS).
3. Rebaser `story/US-005-banc-postgres` sur `main`, la terminer, puis faire tourner ses tests en CI une fois US-002 fusionnée.
4. Après le choix DEC-MARQUE : fusionner US-028 et démarrer US-030.

## Reports à faire dans `docs/specs/17` (par demande de fusion approuvée)

D'après la revue d'architecture d'US-001 :

- ajouter la ligne BUS en §2.2 et une note sur le socle implicite (CFG et AUD dépendent de BUS) ;
- préfixe de table `<code>_` et table de correspondance module → schéma en §10 point 3 ;
- ADR-001 DÉCIDÉ, ADR-041 à ADR-043 en §8.1 (et ADR-043 en §11) ;
- arbitrage « back-office séparé » en §10.

## Rappels

- Aucun push ni aucune fusion vers `main` sans l'accord du fondateur (TECH-003).
- Le service PostgreSQL local démarre manuellement et demande une validation UAC du fondateur.
- Revues argent et sécurité : « revue dégradée » sur Sonnet tant que F-15 n'est pas réglé (TECH-007).
