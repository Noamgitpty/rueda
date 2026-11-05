# RESUME_HERE — point de reprise du dépôt

> Lu en premier par toute session qui reprend le travail (handoff §4.9). Tenu par l'orchestrateur à chaque fin de session. **Dernière mise à jour : 2026-11-05 (recalage sur les PR #1 à #82).**

## Pour reprendre

1. Lis `CLAUDE.md`, ce fichier, puis `docs/team/BOARD.md`, les passations `docs/team/handoffs/US-xxx.md` des stories `IN_PROGRESS`, `IN_REVIEW` ou `PAUSED_USAGE_LIMIT`, et les questions ouvertes de `docs/team/QUESTIONS.md`. Ne relis pas tout `docs/specs/`.
2. Sous Git Bash : `export PATH="/c/Program Files/nodejs:/c/Users/noamm/AppData/Roaming/npm:/c/Program Files/GitHub CLI:$PATH"`. Vérifie `node -v`, qui doit donner v26.13.0 (ADR-041).
3. `git fetch`, `git worktree list`, puis relance les tests de chaque branche en cours **avant** de continuer (OPERATING_RULES §3).

## État du projet

**Modèle** : Kmino, place de marché de location de voitures **de particulier à particulier**, comme Turo, au Panama et au Paraguay ; **aucune agence** (DEC-FONDATEUR-13 à 16) ; produit **trilingue es / en / fr** (DEC-FONDATEUR-17). Fusion autonome de toutes les PR par l'orchestrateur, avec garde-fous (DEC-FONDATEUR-15).

**Révision P2P des spécifications : terminée et fusionnée** (US-053 à US-060, PR #16, #19, #20, #22, #24, #27 ; US-061 et US-062, PR #55 et #52).

**Lot 0 : presque tout est fusionné** (détail et revues dans `BOARD.md`). Aucune story n'est ACCEPTED : c'est la recette du fondateur.

| Story                                                            | Statut                | Où                                                     | Où en est-on                                                                                           |
| ---------------------------------------------------------------- | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Toutes les autres stories du lot 0 (44 sur 49 ; voir `BOARD.md`) | MERGED                | `main` (PR #1 à #82)                                   | Dernières : US-051 (PR #79), US-040 (PR #80), US-003 durcissement (PR #81), US-035 isolation (PR #82). |
| US-039 stratégie de test                                         | IN_PROGRESS           | branche à créer par l'agent                            | Agent lancé le 2026-11-05.                                                                             |
| US-047 régression nocturne                                       | IN_PROGRESS           | `story/US-047-regression-nocturne` (`../wt/US-047`)    | Agent lancé le 2026-11-05.                                                                             |
| US-050 règles d'exploitation                                     | IN_PROGRESS (partiel) | `main` (PR #6, #12, #14, #17, #21, #28, #36, #39, #50) | Reste : protection de branche, accès, usage (F-15).                                                    |
| US-049 porte du lot 0                                            | TODO                  | —                                                      | Éprouve les stories fusionnées (US-011, US-012, US-018, US-019, US-025) : peut démarrer.               |
| US-027 rapport des preuves du lot 0                              | TODO                  | —                                                      | Attend US-049.                                                                                         |

Rappel : US-014 (français et portugais du Brésil : PR #26 et #61) est fusionnée ; la colonne `fr` du catalogue est livrée.

## Prochaine action exacte (orchestrateur)

1. **Avant le 2026-11-06** : monter `@nestjs/platform-express` (ou `overrides`) et retirer les deux exceptions de `docs/ops/audit-exceptions.json` (`docs/ops/CI.md` §audit). Sinon la CI devient rouge.
2. Faire relire puis fusionner US-039 et US-047 (agents lancés le 2026-11-05).
3. Lancer **US-049** (pré-mortem et red team argent / RLS / concurrence), puis **US-027** (rapport des preuves et recalage) ; solder US-050 (protection de branche, accès, usage : F-15).
4. Puis le **lot 1** (identité, hôtes, véhicules) dans l'ordre de 19 v3 §2. Chaque story livre ses textes en es, en, fr et pt-BR (catalogue 10b §4.3) et note ses choix « comme Turo » dans `docs/team/COMME_TURO.md`.
5. Les branches réécrites par rebase ne se force-pushent pas : une attestation `git range-diff` d'un relecteur indépendant certifie les nouveaux SHA. Pour mettre une PR à jour, préférer `gh pr update-branch` (fusion).

## Reports à faire dans `docs/specs/` (par demande de fusion revue)

- 17, revue d'architecture d'US-001 : ligne BUS en §2.2 et socle implicite ; préfixe de table et table module → schéma en §10 point 3 ; ADR-001 DÉCIDÉ, ADR-041 à ADR-043 en §8.1 (et ADR-043 en §11) ; arbitrage « back-office séparé » en §10.
- 17, « S4 bis » (passation US-057) : noms sans équivalent (`vehicle_earnings_plan`, `plan_history`, `host_guest_block`, `insurer_contract.exclusions`, `rc_amount_minor`, `go_live_switch_request`, `handover_location`, types de `vehicle_document` et de `fiscal_document`, `no_show.side`).
- 16 et 19 : mentions « es et en » à lire « es, en et fr » (règle de 10b §4.3) ; à réécrire à la prochaine révision.
- Runbook de bascule d'un interrupteur de mise en service (PLT-003), avec la story qui construit les commandes à deux personnes.

## Reports entre stories (DoR des stories cibles)

- **US-061 / US-223** (passation US-062) : rejouer RLS-25 sur `cmd_apply_leg_movement` (travailleur hors liste blanche : appel refusé, 0 ligne), comme `l0-us062-host-money` le fait pour `settlement_cmd_record`. **Fait par US-061** (PR #55, `l0-pay-marketplace`). Reste pour **US-223 / US-224** : rejeu des entrées du règlement depuis les sources (ADR-057), avance de Kmino portée sur PLATFORM (TJ18b), exigence de `trip_leg_balance` pour une v1 (tests « limite connue »).
- **US-514** (passation US-062, critère 6) : l'adresse de l'hôte disparaît de la vue du voyageur à la fin du trip + `review_window_days` ; aucune table de lieux n'existait pour US-062.
- **US-224** (revue sécurité US-062) : la création d'une avance relit `org_id` du trip (non contraint en base, ADR-064).
- **US-227** : clés étrangères `insurer` / `insurer_contract` des tables `settlement_insurer_*` ; **US-101** : rejet et expiration des demandes FINANCE ; **US-125** : RLS-27 et réserves 1 et 2 d'US-056.
- **US-120 / US-032** (passation US-034, revues architecture et code) : brancher `apps/web/theme.tsx` et le back-office sur `GET /brand` (version publiée, feuille `css` prête), avec repli sur le thème embarqué si `503 BRAND_VERSION_UNAVAILABLE` ; aujourd'hui le site lit encore `packages/design-tokens/config/theme.json`.
- **US-120** (passation US-034) : téléversement d'actifs limité à environ **64 Kio** (`assetMaxBytes` = 65 536, base64 dans le JSON de l'API dont la limite est inchangée) : prévoir une route de téléversement dédiée pour les images d'accueil.
- **US-120** (revue architecture US-034) : la palette **Lienzo · Azur** échoue au contraste actuel (`primary / glass` 3,89:1 en clair, contrôle d'US-030) ; un retour à Azur est donc refusé à la publication. À traiter dans l'écran « Apparence / Marque » : proposer de foncer `primary` (décision design), ou l'indiquer avant le choix. Même cas : Cielo, Lagune, Voltio, Tierra firme (README de `@rueda/design-tokens`).
- **US-536 bloque l'activation des hôtes** (passation et revues US-046) : tant que la pseudonymisation des colonnes C2 des tables B (compte, organisation, sessions, motifs) et la purge par rétention (IP, user-agent, email et téléphone de vérification, variables de notification) ne sont pas codées et prouvées, et que les motifs C2 des registres en ajout seul (`audit_log.reason`, `data_access_log.purpose`, `finance_approval.reason`, `config_param_value.change_reason`, `iam_role_permission.change_reason`) n'ont pas de sort, `p2p_private_hosts_enabled` ne peut passer à `true` dans aucun pays (dérogations de `packages/db/personal-data-inventory.json`, report `US-536`). À inscrire dans la DoR d'US-536 et dans la liste des préalables de la commande à deux personnes.

## Rappels

- Fusion vers `main` seulement si toute la CI est verte et toutes les revues exigées APPROUVÉ (DEC-FONDATEUR-15) ; jamais de push direct ni de force-push.
- Le service PostgreSQL local démarre manuellement et demande une validation UAC du fondateur.
- Revues argent et sécurité : « revue dégradée » sur Sonnet tant que F-15 n'est pas réglé (TECH-007).
