# RESUME_HERE — point de reprise du dépôt

> Lu en premier par toute session qui reprend le travail (handoff §4.9). Tenu par l'orchestrateur à chaque fin de session. **Dernière mise à jour : 2026-11-19, 7 h UTC (lot 2 : 26 stories sur 27 MERGED, 137 points sur 140 ; reste la porte, US-222 ; détail au `BOARD.md`).** Mise à jour précédente : 2026-11-18, 23 h UTC (lot 2 : 21 sur 27, 110 points). Avant : 2026-11-10 (porte du lot 0 tenue : PR #92, #93 et #94 fusionnées ; US-027 en revue).

## Pour reprendre

1. Lis `CLAUDE.md`, ce fichier, puis `docs/team/BOARD.md`, les passations `docs/team/handoffs/US-xxx.md` des stories `IN_PROGRESS`, `IN_REVIEW` ou `PAUSED_USAGE_LIMIT`, et les questions ouvertes de `docs/team/QUESTIONS.md`. Ne relis pas tout `docs/specs/`.
2. Sous Git Bash : `export PATH="/c/Program Files/nodejs:/c/Users/noamm/AppData/Roaming/npm:/c/Program Files/GitHub CLI:$PATH"`. Vérifie `node -v`, qui doit donner v26.13.0 (ADR-041).
3. `git fetch`, `git worktree list`, puis relance les tests de chaque branche en cours **avant** de continuer (OPERATING_RULES §3).

## État au 2026-11-19, 7 h UTC

Le `BOARD.md` fait foi ; ce résumé ne sert qu'à reprendre vite.

- **Lot 0** : porte tenue le 2026-11-10 ; 47 stories sur 49 fusionnées (US-027 IN_REVIEW, US-050 partielle).
- **Lot 1** : porte tenue le 2026-11-14 ; 27 stories sur 28 MERGED (117 points sur 120) ; US-122 IN_REVIEW (post-mortem).
- **Lot 2** : **26 MERGED sur 27, 137 points sur 140** ; bêta : environ 53 % (463 points sur 869). Fusionnées depuis le 2026-11-18, 23 h UTC : #247 (durcissement d'US-224 : N-354, N-342, N-313), #246 (US-221b : D1 / D2, N-388, N-389), #245 (US-221), #248 (US-702), #250 (US-701c : T70 c, N-372), #251 (durcissement argent : N-364, N-365, N-367), #252 (US-702b), #253 (US-213b : N-298 côté code), #254 (US-222b, red team argent), #255 (US-223e : N-246 sans la bascule, N-286, N-288 ; N-287 close). Passent MERGED : US-221, US-213, US-223, US-701, US-702 (critères qui exigent un PSP réel, un canal réel ou une bascule de mise en service renvoyés au lot C et documentés, comme US-227). **IN_PROGRESS** : US-222 seule (porte).
- **US-222 (porte du lot 2), découpage** : pré-mortem fait ; **222b** red team argent fusionnée (#254, rapport `docs/team/redteam/L2-argent.md`, quatre constats : F-L2-ARG-01 élevé, 02 à 04 moyens, N-399 à N-402) ; **222c** red team ex-LB / RLS-21 à 28 / console : PR #256 (brouillon, `story/US-222-redteam-rls-lb`), en revue ; **222d** correctifs des constats (`story/US-222-correctifs-argent`, autre famille d'auteur que la red team, L2-PM-39 ; PR peut-être pas encore ouverte) : en cours ; **222e** post-mortem et porte : en dernier.
- **Numéros sur `main`** (à reprendre à la suite) : dernière migration **0154** (#255 ; suivante 0155), catalogue **v92** (suivante v93), dernier ADR **ADR-175** (suivant ADR-176), dernière fixture de test **9932** (#252 ; suivante libre 9931). Vérifier aussi les PR ouvertes (#256 n'en prend aucun) avant de réserver.
- **Suffixes des fichiers de revue** : US-221 est close (#246 a pris `r`, #245 `s` et `t`). **US-222** : sur `main`, les revues vont jusqu'à `2026-11-19b` (#254, 222b) ; chaque PR suivante d'US-222 (#256, puis 222d, 222e) prend un suffixe libre **après** le dernier pris sur `main` **et** dans les autres PR ouvertes d'US-222 (`c`, `d`…), pour qu'aucune fusion n'écrase la revue d'une autre partie.
- **Suites** : N-399 à N-414 inscrites au BOARD le 2026-11-19 ; inventaire « avant l'ouverture d'un pays » : 31 suites (N-399 et N-402 en cours dans US-222d).
- **Fondateur** : `POUR_LE_FONDATEUR.md` ; nouveautés : **deux numéros par pays** (support de Kmino, assistance de l'assureur, format E.164 ; la production refuse de démarrer sans eux, GL-36), remontés en page 1 et au §2.13 ; vingt branches à supprimer sur son « oui » (§5) ; en information : mode « sur demande » prêt mais fermé jusqu'à GL-26 (§7.4), red team argent (§7.10).

## Prochaine action exacte (orchestrateur, 2026-11-19)

1. Faire relire **#256** (US-222c) par les revues exigées (`node scripts/ci/check-story-reviews.mjs --branch story/US-222-redteam-rls-lb --base origin/main --root . --author-model <modèle de l'auteur>`), argent / RLS / `SECURITY DEFINER` sur un autre modèle, puis fusionner CI verte et revues APPROUVÉ.
2. Faire aboutir les **correctifs US-222d** (`story/US-222-correctifs-argent`) : N-399 (élevé) à N-402, chaque `it.fails` de 222b (et de 222c s'il en ajoute) inversé en `it` sans toucher l'attaque, revue argent sur un autre modèle ; puis passer N-399 à N-402 en FAIT au BOARD.
3. Lancer **US-222e** : post-mortem du lot 2 et porte (`docs/team/gates/L2/postmortem.md`), après 222c et 222d ; y traiter N-403 ; GL-17 / N-172 si des constats élevés restent.
4. Traiter l'inventaire des suites « avant l'ouverture d'un pays » du BOARD par petites PR (en tête : N-411, moyen revu de changer une valeur de paramètre ; N-395 ; N-407).
5. Ne supprimer aucune branche distante sans le « oui » écrit du fondateur (`POUR_LE_FONDATEUR.md` §5) ; le dossier local `wt/US-223b-residu-2026-11-16` peut être supprimé du poste (N-414).

## État au 2026-11-18, 23 h UTC (historique)

Le `BOARD.md` fait foi ; ce résumé ne sert qu'à reprendre vite.

- **Lot 0** : porte tenue le 2026-11-10 ; 47 stories sur 49 fusionnées (US-027 IN_REVIEW, US-050 partielle).
- **Lot 1** : porte tenue le 2026-11-14 ; 27 stories sur 28 MERGED (117 points sur 120) ; US-122 IN_REVIEW (post-mortem).
- **Lot 2** (ouvert le 2026-11-14) : **21 MERGED sur 27, 110 points sur 140**. Fusionnées depuis le 2026-11-18, 14 h UTC : US-224 (224f, #239), US-225 (#236), US-227 (#237), US-514 (#241), US-217 (217b, #240), US-212 (212b, #244) ; US-214 passe MERGED avec le reçu de #240 ; 701a (#242). **IN_PROGRESS** : US-222 (porte : red team et post-mortem à venir), US-223 (ouverture du mode sur demande, N-246), US-213 (numéros de l'assureur, N-298, donnée du fondateur), US-701 (T70 c : fiche et cartes, N-372). **IN_REVIEW** : US-221 (parcours dorés, PR #245, remplace #243 fermée), US-221b (PR #246, défauts D1 et D2 : N-388, N-389, **avant l'ouverture d'un pays**), US-702 (PR #248). Durcissement d'US-224 avant l'ouverture d'un pays : PR #247 (N-354, N-342, N-313).
- **Numéros sur `main`** (à reprendre à la suite) : dernière migration **0147** (#244 ; #248 prend 0148), catalogue **v86**, dernier ADR fusionné **ADR-169** (ADR-170 : #246, ADR-171 : #247, ADR-172 : #248, en revue).
- **Revues d'US-221** : #246 a pris le suffixe `r` ; les revues suivantes de #245 viennent après (`s`, `t`…).
- **Suites** : N-364 à N-398 inscrites au BOARD le 2026-11-18 ; l'inventaire des suites « avant l'ouverture d'un pays » est sous le tableau des suites du BOARD (32 suites ouvertes).
- **Fondateur** : `POUR_LE_FONDATEUR.md` (page 1 « Ce que j'attends de toi ») ; nouveautés : montant de la caution LUXE (`deposit_amount[pays][LUXE]`, À DÉCIDER, priorité 9), sept branches de PR fermées à supprimer sur son « oui » (§5), question au contrat de l'assureur sur le bordereau (§2.3 septies).

## Prochaine action exacte (orchestrateur, 2026-11-18, historique)

1. Faire relire puis fusionner, CI verte et revues APPROUVÉ : **#246** (US-221b, argent sur un autre modèle), puis **#245** (US-221, après #246 : retirer les `it.fails` et prolonger le segment B), **#247** (durcissement d'US-224) et **#248** (US-702), dans l'ordre des migrations.
2. Lancer **N-372** (US-701, T70 c) pour fermer US-701, puis la porte du lot 2 (US-222 : red team et post-mortem).
3. Traiter l'inventaire des suites « avant l'ouverture d'un pays » du BOARD par petites PR.
4. Ne supprimer aucune branche distante sans le « oui » écrit du fondateur (`POUR_LE_FONDATEUR.md` §5).

## État du projet au 2026-11-10 (historique)

**Modèle** : Kmino, place de marché de location de voitures **de particulier à particulier**, comme Turo, au Panama et au Paraguay ; **aucune agence** (DEC-FONDATEUR-13 à 16) ; produit **quadrilingue es / en / fr / pt-BR** (DEC-FONDATEUR-17, 18). Fusion autonome de toutes les PR par l'orchestrateur, avec garde-fous (DEC-FONDATEUR-15).

**Révision P2P des spécifications : terminée et fusionnée** (US-053 à US-060, PR #16, #19, #20, #22, #24, #27 ; US-061 et US-062, PR #55 et #52).

**Lot 0 : terminé côté construction, porte tenue le 2026-11-10** (**Réserve EXC-003** : le fondateur en a été informé dans la conversation du 2026-11-05 (termes expliqués, avec l'offre de corriger tout de suite ; il n'a pas objecté). **Ratifiée par le fondateur le 2026-11-11** (« Je ratifie EXC-003 », dans la conversation de l'orchestrateur).) : 47 stories sur 49 fusionnées, 217 points sur 222 (`BOARD.md`). Aucune story n'est ACCEPTED : c'est la recette du fondateur. Rapport des preuves et recalage : [`gates/L0/rapport-preuves.md`](gates/L0/rapport-preuves.md) ; post-mortem final : [`gates/L0/postmortem.md`](gates/L0/postmortem.md).

| Story                                                            | Statut                | Où                                                     | Où en est-on                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | --------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toutes les autres stories du lot 0 (47 sur 49 ; voir `BOARD.md`) | MERGED                | `main` (PR #1 à #94)                                   | Dernières : US-049 (porte du lot 0 : PR #93 `32fa23a`, puis #92 `cc1ef72`, qui contient #88 à #91) ; US-042 correctif (PR #94, `f91541a`).                                                                        |
| US-027 rapport des preuves du lot 0                              | IN_REVIEW             | `story/US-027-rapport-preuves-L0` (`../wt/US-027`)     | PR en brouillon ; revues exigées : code, architecture. Contient aussi le post-mortem final, RISKS, BOARD, la liste de contrôle de mise en service et ce fichier.                                                  |
| US-050 règles d'exploitation                                     | IN_PROGRESS (partiel) | `main` (PR #6, #12, #14, #17, #21, #28, #36, #39, #50) | Protection de `main` faite le 2026-11-10 (17 statuts, `enforce_admins`). Reste : `CODEOWNERS`, jeton du compte machine pour les agents (`gh api user` rend encore `Noamgitpty`, admin), usage et plafonds (F-15). |

**Ce que le lot 0 a prouvé** (run CI `42804893221` sur `cc1ef72`, 15 jobs verts, 2 ignorés par conception (revues, changelog : jobs de PR)) : aucune preuve L0 en échec ; L0-05, L0-06 et L0-08 partielles ; C10 absent (US-305, avec US-312) ; RLS-7 et RLS-27 partiels ; critiques et élevés des red teams corrigés, sauf RT-RLS-03 (EXC-003, accepté pour la bêta, bloquant pour la production, US-410). **Alerte ADR-056, antérieure à la porte** : p95 de la forme transactionnelle de C1 au-dessus de 300 ms depuis au moins le 2026-11-04, sans régression démontrée (N-16, US-045 : révision de 17 §2.5 avant le lot 2). Statuts « partielle » et « absent » : jugement de l'orchestrateur, PROPOSÉ.

**Nuits** : rouges du 2026-11-04 au 2026-11-10 (gitleaks sur le commit `c824308` de la PR #78 fermée, incident I-3). Branches mortes supprimées le 2026-11-10. Nuit planifiée du 2026-11-10 (`42805510046`) rouge pour gitleaks ; nuit de vérification `42905487854` (même SHA) : **verte** (conclusion `success`, terminée à 21:49Z : 28 jobs verts, 2 ignorés par conception — revues et CHANGELOG —, aucun rouge ; gitleaks vert, job `130142280824` ; fuzz C11 long 10 × 1 000 et moteur contre oracles 100 000 cas verts ; tableau de bord QA « VERT, 0 bogue(s) », job `130153551430`).

Rappel : US-014 (français et portugais du Brésil : PR #26 et #61) est fusionnée ; la colonne `fr` du catalogue est livrée.

## Prochaine action exacte au 2026-11-10 (historique, lot 0)

1. Faire relire **US-027** (code, architecture), puis fusionner la PR quand la CI est verte et les deux revues APPROUVÉ.
2. **Démarrer le lot 1** (identité, hôtes, véhicules ; 19 v3 §2, 28 stories, 120 points) par son **pré-mortem**, avant toute story du lot : `docs/team/gates/L1/premortem.md`, porté par US-122 (règle 11 du post-mortem du lot 0). Ensuite, suivre l'ordre de 19 v3 §2. En tête du chemin critique : US-101 (cadre `manual_action`), puis US-107, US-115 et US-119. Chaque story livre ses textes en es, en, fr et pt-BR (catalogue 10b §4.3) et note ses choix « comme Turo » dans `docs/team/COMME_TURO.md`.
3. Réserver au BOARD, avant de coder, les numéros d'ADR et de migration de chaque story du lot 1 (règle 2 du post-mortem). Dernier ADR : ADR-090. Dernière migration : 0058.
4. Mesurer l'usage dès les 20 premiers points du lot 1 : un rapport de santé par session dans `docs/team/health/`, pour calculer le budget (19 §1.9 point 3). Plafonds F-15 à demander au fondateur.
5. Avant le lot 2 : ouvrir la révision de 17 §2.5 (N-16) par une demande de fusion revue. Traiter aussi N-17 à N-20 avec leur story.
6. Solder US-050 : `CODEOWNERS`, jeton du compte machine (GL-05), environnement `production` (GL-03).
7. Écrire les fiches d'incident I-1, I-4 et I-9 dans `docs/team/incidents/` (avec le fondateur pour I-1).
8. Les branches réécrites par rebase ne se force-pushent pas : une attestation `git range-diff` d'un relecteur indépendant certifie les nouveaux SHA. Pour mettre une PR à jour, préférer `gh pr update-branch` (fusion).

## Reports à faire dans `docs/specs/` (par demande de fusion revue)

- 17, revue d'architecture d'US-001 : ligne BUS en §2.2 et socle implicite ; préfixe de table et table module → schéma en §10 point 3 ; ADR-001 DÉCIDÉ, ADR-041 à ADR-043 en §8.1 (et ADR-043 en §11) ; arbitrage « back-office séparé » en §10.
- 17, « S4 bis » (passation US-057) : noms sans équivalent (`vehicle_earnings_plan`, `plan_history`, `host_guest_block`, `insurer_contract.exclusions`, `rc_amount_minor`, `go_live_switch_request`, `handover_location`, types de `vehicle_document` et de `fiscal_document`, `no_show.side`).
- 16 et 19 : mentions « es et en » à lire « es, en, fr et pt-BR » (règle de 10b §4.3) ; à réécrire à la prochaine révision.
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
