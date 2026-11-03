# RESUME_HERE — point de reprise du dépôt

> Lu en premier par toute session qui reprend le travail (handoff §4.9). Tenu par l'orchestrateur à chaque fin de session. **Dernière mise à jour : 2026-11-01, session 01 (PR #1 à #6 fusionnées).**

## Pour reprendre

1. Lis `CLAUDE.md`, ce fichier, puis `docs/team/BOARD.md`, les passations `docs/team/handoffs/US-xxx.md` des stories `IN_PROGRESS`, `IN_REVIEW` ou `PAUSED_USAGE_LIMIT`, et les questions ouvertes de `docs/team/QUESTIONS.md`. Ne relis pas tout `docs/specs/`.
2. Sous Git Bash : `export PATH="/c/Program Files/nodejs:/c/Users/noamm/AppData/Roaming/npm:/c/Program Files/GitHub CLI:$PATH"`. Vérifie `node -v`, qui doit donner v26.13.0 (ADR-041).
3. `git fetch`, `git worktree list`, puis relance les tests de chaque branche en cours **avant** de continuer (OPERATING_RULES §3).

## État des stories (détail dans BOARD.md)

| Story                  | Statut                | Où                             | Où en est-on                                                                                                                                                                        |
| ---------------------- | --------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-001, US-029         | MERGED                | `main` (PR #1, f66304f)        | EXC-001 tranchée.                                                                                                                                                                   |
| US-002 CI              | MERGED                | `main` (PR #2, e4df2c5)        | Le job « revues » lit `docs/team/review-requirements.json` depuis `origin/main`.                                                                                                    |
| US-026 PWA iOS         | MERGED                | `main` (PR #5, 5342feb)        | Protocole de test sur iPhone pour le fondateur : `docs/qa/US-026-protocole-pwa-ios.md`.                                                                                             |
| US-050 règles          | IN_PROGRESS (partiel) | `main` (PR #6, 0677156)        | Seules les règles des paquets `money` et `i18n` sont livrées. Reste : protection de branche, accès, usage (F-15).                                                                   |
| US-015 Money           | MERGED                | `main` (PR #4, d722227)        | —                                                                                                                                                                                   |
| US-014 i18n            | MERGED                | `main` (PR #3, 62b2cc5)        | Conflit `apps/web/vitest.config.ts` avec US-026 résolu par fusion (motifs des deux stories).                                                                                        |
| US-028 naming          | IN_REVIEW             | `story/US-028-naming-identite` | **Attend le choix du fondateur (DEC-MARQUE).**                                                                                                                                      |
| US-005 banc PostgreSQL | IN_PROGRESS           | `story/US-005-banc-postgres`   | Partie de l'ancien socle : conflits avec `main` sur `CONTRIBUTING.md`, `package.json` et `packages/db/*`. À mettre à jour, puis revues architecture, sécurité, code et QA, puis CI. |

## Prochaine action exacte (orchestrateur)

1. **Avant le 2026-11-06** : monter `@nestjs/platform-express` (ou `overrides`) et retirer les deux exceptions de `docs/ops/audit-exceptions.json` (`docs/ops/CI.md` §audit). Sinon la CI devient rouge.
2. US-005 : fusionner `main` dans la branche (pas de force-push), résoudre les conflits, puis les 4 revues et la CI.
3. Lancer les stories suivantes débloquées (US-016 après US-015, US-003 après US-002, etc. : voir BOARD).
4. Après le choix DEC-MARQUE : fusionner US-028 et démarrer US-030.
5. Les branches réécrites par rebase ne se force-pushent pas : une attestation `git range-diff` d'un relecteur indépendant certifie les nouveaux SHA (dernier rapport de chaque rôle dans `docs/team/reviews/US-0xx/`). Pour mettre une PR à jour, préférer `gh pr update-branch` (fusion).

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
