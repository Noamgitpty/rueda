# RESUME_HERE — point de reprise du dépôt

> Lu en premier par toute session qui reprend le travail (handoff §4.9). Tenu par l'orchestrateur à chaque fin de session. **Dernière mise à jour : 2026-11-03 (US-060, fin de la révision P2P des spécifications ; PR #1 à #25 fusionnées).**

## Pour reprendre

1. Lis `CLAUDE.md`, ce fichier, puis `docs/team/BOARD.md`, les passations `docs/team/handoffs/US-xxx.md` des stories `IN_PROGRESS`, `IN_REVIEW` ou `PAUSED_USAGE_LIMIT`, et les questions ouvertes de `docs/team/QUESTIONS.md`. Ne relis pas tout `docs/specs/`.
2. Sous Git Bash : `export PATH="/c/Program Files/nodejs:/c/Users/noamm/AppData/Roaming/npm:/c/Program Files/GitHub CLI:$PATH"`. Vérifie `node -v`, qui doit donner v26.13.0 (ADR-041).
3. `git fetch`, `git worktree list`, puis relance les tests de chaque branche en cours **avant** de continuer (OPERATING_RULES §3).

## État du projet

**Modèle** : Kmino, place de marché de location de voitures **de particulier à particulier**, comme Turo, au Panama et au Paraguay ; **aucune agence** (DEC-FONDATEUR-13 à 16) ; produit **trilingue es / en / fr** (DEC-FONDATEUR-17). Fusion autonome de toutes les PR par l'orchestrateur, avec garde-fous (DEC-FONDATEUR-15).

**Révision P2P des spécifications : terminée.** Les huit demandes de fusion S1 à S8 de `docs/team/impact/2026-11-02-pivot-p2p.md` sont faites : 22 (US-053), 18 v5, 04 rév. 6 et 21 (US-054), 08 (US-055), 17 v6 (US-056), 16 v5 (US-057), 19 v3 (US-058), 10b v3 (US-059), puis le point d'entrée (US-060 : `CLAUDE.md`, handoff, `00_README`, `RESUME_HERE` des specs, reliquats de 17, colonne `fr` du catalogue 10b §4.3). US-060 attend ses revues (code, architecture, sécurité, argent ; UX conseillée) puis la fusion.

| Story                     | Statut                | Où                                  | Où en est-on                                                                        |
| ------------------------- | --------------------- | ----------------------------------- | ----------------------------------------------------------------------------------- |
| US-001, US-029            | MERGED                | `main` (PR #1)                      | —                                                                                   |
| US-002 CI                 | MERGED                | `main` (PR #2)                      | Le job « revues » lit `docs/team/review-requirements.json` depuis `origin/main`.    |
| US-005 banc PostgreSQL    | MERGED                | `main` (PR #18)                     | `test:int` et `test:l0` lancent les vrais tests (`docs/ops/CI.md`).                 |
| US-014, US-015, US-026    | MERGED                | `main` (PR #3, #4, #5)              | US-014 doit recevoir le catalogue `fr` (DEC-FONDATEUR-17) : ajustement à planifier. |
| US-028 naming             | MERGED                | `main` (PR #8, #10, #13)            | Kmino, direction Lienzo · Tinta (révisable).                                        |
| US-050 règles             | IN_PROGRESS (partiel) | `main` (PR #6, #12, #14, #17, #21)  | Reste : protection de branche, accès, usage (F-15).                                 |
| US-053 à US-059 (S1 à S7) | MERGED                | `main` (PR #16, #19, #20, #22, #24) | —                                                                                   |
| US-060 (S8)               | IN_REVIEW             | `story/US-060-specs-handoff-claude` | Passation : `docs/team/handoffs/US-060.md`.                                         |

`BOARD.md` n'a pas suivi toutes ces fusions (US-005 et US-028 y sont encore en cours) : à remettre à jour par l'orchestrateur.

## Prochaine action exacte (orchestrateur)

1. **Avant le 2026-11-06** : monter `@nestjs/platform-express` (ou `overrides`) et retirer les deux exceptions de `docs/ops/audit-exceptions.json` (`docs/ops/CI.md` §audit). Sinon la CI devient rouge.
2. Faire relire puis fusionner US-060 (revues code, architecture, sécurité, argent ; UX conseillée pour 10b §4.3).
3. **Reprendre le développement** dans l'ordre de 19 v3 §2 : stories restantes du **lot 0**, dans leur version ajustée par le pivot (19 v3 §3.1 ; US-026 et US-028, déjà fusionnées, gardent seulement leurs ajustements à reporter), en commençant par celles que débloquent les fusions (US-006 et US-008 à US-010 après US-005, US-013, US-016 après US-015, US-003 après US-002 ; voir BOARD), puis le **lot 1** (identité, hôtes, véhicules).
4. Chaque story livre ses textes en es, en et fr (catalogue 10b §4.3) et note ses choix « comme Turo » dans `docs/team/COMME_TURO.md`.
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

## Rappels

- Fusion vers `main` seulement si toute la CI est verte et toutes les revues exigées APPROUVÉ (DEC-FONDATEUR-15) ; jamais de push direct ni de force-push.
- Le service PostgreSQL local démarre manuellement et demande une validation UAC du fondateur.
- Revues argent et sécurité : « revue dégradée » sur Sonnet tant que F-15 n'est pas réglé (TECH-007).
