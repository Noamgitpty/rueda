# RESUME_HERE — point de reprise du dépôt

> Lu en premier par toute session qui reprend le travail (handoff §4.9). Tenu par l'orchestrateur à chaque fin de session. **Dernière mise à jour : 2026-11-22, 19 h UTC (lot 3 : 18 stories sur 21 MERGED, 97 points sur 110 ; détail au `BOARD.md`).** Mise à jour précédente : 2026-11-20, 6 h UTC (lot 3 : 8 sur 21, 48 points). Avant : 2026-11-19, 12 h UTC (fin du lot 2 : 27 stories sur 27 MERGED, 140 points sur 140 ; porte L2 franchie, #261). Avant : 2026-11-19, 7 h UTC (lot 2 : 26 sur 27, 137 points). Avant : 2026-11-18, 23 h UTC (lot 2 : 21 sur 27, 110 points). Avant : 2026-11-10 (porte du lot 0 tenue : PR #92, #93 et #94 fusionnées ; US-027 en revue).

## Pour reprendre

1. Lis `CLAUDE.md`, ce fichier, puis `docs/team/BOARD.md`, les passations `docs/team/handoffs/US-xxx.md` des stories `IN_PROGRESS`, `IN_REVIEW` ou `PAUSED_USAGE_LIMIT`, et les questions ouvertes de `docs/team/QUESTIONS.md`. Ne relis pas tout `docs/specs/`.
2. Sous Git Bash : `export PATH="/c/Program Files/nodejs:/c/Users/noamm/AppData/Roaming/npm:/c/Program Files/GitHub CLI:$PATH"`. Vérifie `node -v`, qui doit donner v26.13.0 (ADR-041).
3. `git fetch`, `git worktree list`, puis relance les tests de chaque branche en cours **avant** de continuer (OPERATING_RULES §3).

## État au 2026-11-22

Le `BOARD.md` fait foi ; ce résumé ne sert qu'à reprendre vite.

- **Lots 0 à 2** : inchangés (lot 2 clos, porte L2 franchie le 2026-11-19).
- **Lot 3** (21 stories, 110 points) : **18 MERGED, 97 points** (88 %). Fusionnées depuis #280 : US-709 (#277, `6fc0e7cc`), US-305 (#278, `18564cae`), US-703 (#279, `c0890e5b`), US-317 (#282, `36e71769`), US-307 (#283, `8b10cf13`), US-314 (#284, `69e5b0a0` : **S-04 faite**), US-306 (#285, `beff2411`), US-311 (#286, `b8dc0bc4` ; correctif du test des KPI #290, `6b11ee49`), US-309 (#287, `45f9e1c4`), US-312 (#288, `bad1a4e4`), red team du lot 3 (#289, `f647fd59`, US-313 critères 2 et 3) ; hors lot : #281 (US-047, stabilité du rapprochement, `29248b80`). Bêta : environ **65 %** (563 points sur 869).
- **Fusionnée ensuite** : **#291** (US-303 suite, hors total, `be5e1026` : F-L3-PRE-01 et F-L3-PRE-02 corrigés ; 0176, ADR-196, v111, 9908). **En revue** : **#292** (US-706, frais annexes) et **#293** (US-318, sinistres entre particuliers), toutes deux en correction après revues.
- **Reste du lot 3** : US-706, US-318 et le post-mortem d'US-313 (critère 4), qui attend la red team restante (N-474 : V08 « deux travailleurs », V09 logique, axe « données », H08 complet, puis S01 à S04 et M04 sur US-706 et US-318).
- **Constats de la red team** (`RISKS.md`, « Constats de la red team du lot 3 ») : F-L3-PRE-01 et 02 (ÉLEVÉ) corrigés (#291) ; F-L3-PRE-03 (MOYEN, second chargeback perdu) ouvert, suite d'US-709 (N-473). L3-PM-03 et L3-PM-06 : « corrigé (#291) ».
- **Numéros sur `main`** : dernière migration **0176** (#291), dernier ADR **ADR-196**, catalogue **v111** (v100 et v102 non prises), fixtures jusqu'à **9908** (9910 prise par US-003). **Réservés** : US-706 (#292) 0177 / ADR-197 / v112 / 9907 ; US-318 (#293) 0178 / ADR-198 / v113 / 9906. **Prochains libres** : 0179 / ADR-199 / v114 / 9905. Vérifier les PR ouvertes avant de réserver ; renuméroter à chaque fusion de `main` si l'ordre change.
- **Suites** : N-462 à N-489 inscrites au BOARD ; N-19, N-272, N-402, N-415, N-471, N-472 faites ; N-270, N-271, N-274, N-384, N-455 en partie. Story **US-319** ouverte (report de la jambe HOST des frais `INCIDENTAL`, `DAMAGE` et `TRAFFIC` dans les versements, N-463). **Bogue** : « {brand_name} » non résolu dans le titre de la console (N-462). **Prérequis d'ouverture de `payouts_enabled`** : US-319, N-464 (gains d'annulation `CXL_EARNINGS`), N-465 (`EVT_PAYOUT_ON_HOLD`), N-467 (calendrier complet), N-473, N-483, N-437, N-438, N-454, N-455, N-270, N-271, N-384. Inventaire « avant l'ouverture d'un pays » : 45 suites.
- **Fondateur** : `POUR_LE_FONDATEUR.md` §0 à jour ; quatre réglages nouveaux au §3 (plafond `fuel_refill_max`, à fixer après avoir distingué BR-FUEL-02 et la fin anticipée due à l'hôte ; frais de gestion de 5 % TTC ou en sus ; débit d'un frais annexe à l'échéance et préavis Visa J+6 ; gel du versement en cas de vol) ; en information : `incidental_evidence_trip_photos_only` = faux par défaut, comme Turo (DEC-FONDATEUR-22, appliqué dans #292) ; doublons du §7 signalés (N-489) ; §7.14 (red team) et §7.15 (versements) ; branches mortes : vingt et une, aucune nouvelle.

## Prochaine action exacte (orchestrateur, 2026-11-22)

1. #291 fusionnée (`be5e1026`) : RISKS et BOARD déjà à jour.
2. Mener **#292** (US-706) et **#293** (US-318) à la fin de leurs corrections et à leurs revues delta, puis les fusionner dans l'ordre de leurs numéros (0177 puis 0178).
3. Lancer la red team restante (N-474), puis le **post-mortem du lot 3** (US-313 critère 4 ; N-422, N-423).
4. Avant toute idée d'ouverture des versements : US-319 et les prérequis de l'inventaire (jamais codés comme ouverture ; `payouts_enabled` ne change que par la commande à deux personnes sur décision écrite du fondateur).
5. Ne supprimer aucune branche distante sans le « oui » écrit du fondateur (`POUR_LE_FONDATEUR.md` §5, N-428).

## État au 2026-11-20 (historique)

Le `BOARD.md` fait foi ; ce résumé ne sert qu'à reprendre vite.

- **Lots 0 à 2** : inchangés (lot 2 clos, porte L2 franchie le 2026-11-19 ; US-027, US-050 et US-122 comme au BOARD). **US-535a MERGED** (#262, `f44199cf`, 0157, ADR-178 ; 5 points hors total, tranche d'US-535) : N-411 et N-421 faites.
- **Lot 3** (21 stories, 110 points) : **8 MERGED, 48 points** (44 %) : US-303 (#266, `7bf6159b`), US-707 (#267, `3bcbfdea`), US-525 (#268, `95dc6662`), US-310 (#269, `f7fb5113`), US-315 (#270, `bf989b30`), US-308 (#271, `84d35703`), US-708 (#273, `fce5db9c` : **S-06 faite**, écrivain unique de `release_at`), US-316 (#274, `b24b893f`). Fusionnés aussi : registre des revues du lot 3 (#264, US-050), pré-mortem du lot 3 (#265, US-313 critère 1, `gates/L3/premortem.md`, L3-PM-01 à 60), e2e web à 45 min (#272, US-050), stabilité des parcours dorés (#276, US-221 ; remplace #275, fermée). Bêta : environ **59 %** (514 points sur 869).
- **En revue** : **US-709** (PR #277, `story/US-709-grand-livre` ; grand livre, chargebacks, compensation, solde négatif ; N-270 à N-277, N-402, N-415, N-455).
- **En cours** : **US-305** (PR #278, brouillon, `story/US-305-retards`), **US-703** (en cours d'écriture, pas encore de PR) ; **US-313** (porte) : pré-mortem fait, red team et post-mortem en dernier.
- **Prochaine vague** : US-307, US-317, US-309, US-706, US-306, US-311, US-314, US-318, US-312, puis la **porte US-313**.
- **Numéros sur `main`** (à reprendre à la suite) : dernière migration **0166** (#274), catalogue **v101** (#274 ; v100 non prise), dernier ADR **ADR-186** (#274), fixtures jusqu'à **9919** (#274 ; 9928 et 9923 non prises, 9920 libre). **Réservés** : US-709 0167 / ADR-187 ; US-305 0168 / ADR-188 / v103 ; US-703 0169 / ADR-189 / v104 (v102 libre). Vérifier les PR ouvertes avant de réserver ; renuméroter à chaque fusion de `main` si l'ordre change.
- **Suites** : N-433 à N-461 inscrites au BOARD (réserves des revues et suites des passations d'US-303, US-707, US-525, US-310, US-315, US-308, US-708, US-316, US-221 et US-535a) ; N-120, N-362, N-383, N-410, N-416 faites en partie ; N-422 confiée à la partie post-mortem d'US-313 ; S-04 portée par US-314. **Prérequis d'ouverture de `payouts_enabled`** : N-437 (OTP avant un changement de compte, notification de l'hôte), N-438, N-454 (L0 `IN_TRANSIT` / `FAILED` / reprise au rang suivant, `PgPayoutBatchStore` contre PostgreSQL, alertes FIN bloquantes, fériés PA / PY saisis), N-455, N-270 à N-272, N-384, S-04. Inventaire « avant l'ouverture d'un pays » : 45 suites (dont N-445 : numéros d'urgence à valider par l'ops, heures du support et plan de staffing, SUP-020).
- **Fondateur** : `POUR_LE_FONDATEUR.md` (page 1 et son ordre gardés) ; §0 à jour ; branche `fix/US-221-flocon-parcours-dores` ajoutée à la demande de « oui » pour les branches mortes (vingt et une) ; en information : versements aux hôtes livrés mais fermés en production, prérequis qui relèvent de lui (fériés, heures du support, numéros d'urgence à valider) ; aucune nouvelle demande.

## Prochaine action exacte (orchestrateur, 2026-11-20, historique)

1. Faire relire **#277** (US-709) par les revues exigées (`node scripts/ci/check-story-reviews.mjs --branch story/US-709-grand-livre --base origin/main --root . --author-model <modèle de l'auteur>`), argent sur un autre modèle, puis fusionner CI verte et revues APPROUVÉ ; N-402, N-415 et N-455 passent alors FAIT selon la passation.
2. Mener **#278** (US-305) et **US-703** à la revue ; lancer la vague suivante (US-307, US-317, US-309, puis US-706, US-306, US-311, US-314, US-318, US-312) en réservant les numéros au BOARD avant de coder.
3. Avant toute idée d'ouverture des versements : N-437 et N-454 (prérequis, jamais codés comme ouverture ; `payouts_enabled` ne change que par la commande à deux personnes sur décision écrite du fondateur).
4. Ne supprimer aucune branche distante sans le « oui » écrit du fondateur (`POUR_LE_FONDATEUR.md` §5, N-428).

## État au 2026-11-19, fin du lot 2 (historique)

Le `BOARD.md` fait foi ; ce résumé ne sert qu'à reprendre vite.

- **Lot 0** : porte tenue le 2026-11-10 ; 47 stories sur 49 fusionnées (US-027 IN_REVIEW, US-050 partielle).
- **Lot 1** : porte tenue le 2026-11-14 ; 27 stories sur 28 MERGED (117 points sur 120) ; US-122 IN_REVIEW (post-mortem).
- **Lot 2** : **clos, 27 MERGED sur 27, 140 points sur 140** ; **porte L2 franchie** le 2026-11-19 (#261, `218bf757`, `docs/team/gates/L2/gate.md` §7 : aucun constat critique, élevés corrigés, `test:l0` sans « expected fail » au run `44498559096`, restauration rejouée). Bêta : environ 54 % (466 points sur 869). Fusionnées depuis 7 h UTC : #256 (US-222c, red team ex-LB / RLS / console, cinq constats), #257 (US-222d, correctifs argent : N-399, N-400, N-401 ; N-402 en partie), #259 (US-222d2, correctifs RLS : N-114, N-118), #260 (préparation d'US-535a : 19 et registre des revues), #261 (US-222e, post-mortem et porte : N-139, N-403). **US-222 MERGED.** Les deux red teams ont trouvé neuf défauts, tous corrigés sauf l'imputation complète d'un chargeback perdu (jambe HOST gelée, contrôle FIN ; imputation à US-709, N-402, N-415).
- **En revue** : **US-535a** (PR #262, brouillon, `story/US-535-commande-parametres` ; tranche d'US-535, 5 points hors total du lot 2 ; migration 0157, ADR-178, fixture 9929) : commande revue de changement d'une valeur de paramètre pays (N-411, N-421).
- **Numéros sur `main`** (à reprendre à la suite) : dernière migration **0156** (#259 ; #262 prend 0157), catalogue **v93** (#257 ; suivante v94), dernier ADR **ADR-177** (#259 ; #262 prend ADR-178), dernière fixture de test **9931** (#257 ; #262 prend 9929, suivante libre 9930 à vérifier contre les PR ouvertes). Vérifier les PR ouvertes avant de réserver.
- **Suites** : N-415 à N-432 inscrites au BOARD (suites d'US-222d, mineurs des revues de #256, #259, #260, #261, renvois à la porte du lot 3 N-423, manques bloquants pour la production N-424 à N-428, suites de `gate.md` §6 N-429 à N-432) ; S-04 (US-125) comptée parmi les élevés hérités ; inventaire « avant l'ouverture d'un pays » : 35 suites.
- **Fondateur** : `POUR_LE_FONDATEUR.md` (page 1 inchangée) ; en information : lot 2 terminé et porte franchie (§0, §7.10) ; rappel des manques bloquants pour la production qui relèvent de lui : « oui » pour supprimer les branches mortes (§5, nuits rouges), jeton du bot et accès des agents (priorité 6, §2.8).

## Prochaine action exacte (orchestrateur, 2026-11-19, fin du lot 2, historique)

1. Faire relire **#262** (US-535a) par les revues exigées (`node scripts/ci/check-story-reviews.mjs --branch story/US-535-commande-parametres --base origin/main --root . --author-model <modèle de l'auteur>`), argent / `SECURITY DEFINER` sur un autre modèle, puis fusionner CI verte et revues APPROUVÉ ; N-411 et N-421 passent alors FAIT.
2. **Démarrer le lot 3** : pré-mortem du lot 3 (`docs/team/gates/L3/premortem.md`, US-313 critère 1, branche de story) et ordre des stories, en cours d'analyse par l'orchestrateur ; y reprendre les renvois de la porte du lot 2 (N-423) et les corrections de `gate.md` (N-422).
3. Traiter l'inventaire « avant l'ouverture d'un pays » et les manques bloquants pour la production (N-424 à N-428) par petites PR ; N-431 (règles du §5.2 du post-mortem) avant le lot 3.
4. Ne supprimer aucune branche distante sans le « oui » écrit du fondateur (`POUR_LE_FONDATEUR.md` §5, N-428).

## État au 2026-11-19, 7 h UTC (historique)

Le `BOARD.md` fait foi ; ce résumé ne sert qu'à reprendre vite.

- **Lot 0** : porte tenue le 2026-11-10 ; 47 stories sur 49 fusionnées (US-027 IN_REVIEW, US-050 partielle).
- **Lot 1** : porte tenue le 2026-11-14 ; 27 stories sur 28 MERGED (117 points sur 120) ; US-122 IN_REVIEW (post-mortem).
- **Lot 2** : **26 MERGED sur 27, 137 points sur 140** ; bêta : environ 53 % (463 points sur 869). Fusionnées depuis le 2026-11-18, 23 h UTC : #247 (durcissement d'US-224 : N-354, N-342, N-313), #246 (US-221b : D1 / D2, N-388, N-389), #245 (US-221), #248 (US-702), #250 (US-701c : T70 c, N-372), #251 (durcissement argent : N-364, N-365, N-367), #252 (US-702b), #253 (US-213b : N-298 côté code), #254 (US-222b, red team argent), #255 (US-223e : N-246 sans la bascule, N-286, N-288 ; N-287 close). Passent MERGED : US-221, US-213, US-223, US-701, US-702 (critères qui exigent un PSP réel, un canal réel ou une bascule de mise en service renvoyés au lot C et documentés, comme US-227). **IN_PROGRESS** : US-222 seule (porte).
- **US-222 (porte du lot 2), découpage** : pré-mortem fait ; **222b** red team argent fusionnée (#254, rapport `docs/team/redteam/L2-argent.md`, quatre constats : F-L2-ARG-01 élevé, 02 à 04 moyens, N-399 à N-402) ; **222c** red team ex-LB / RLS-21 à 28 / console : PR #256 (brouillon, `story/US-222-redteam-rls-lb`), en revue ; **222d** correctifs des constats (`story/US-222-correctifs-argent`, autre famille d'auteur que la red team, L2-PM-39 ; PR peut-être pas encore ouverte) : en cours ; **222e** post-mortem et porte : en dernier.
- **Numéros sur `main`** (à reprendre à la suite) : dernière migration **0154** (#255 ; suivante 0155), catalogue **v92** (suivante v93), dernier ADR **ADR-175** (suivant ADR-176), dernière fixture de test **9932** (#252 ; suivante libre 9931). Vérifier aussi les PR ouvertes (#256 n'en prend aucun) avant de réserver.
- **Suffixes des fichiers de revue** : US-221 est close (#246 a pris `r`, #245 `s` et `t`). **US-222** : sur `main`, les revues vont jusqu'à `2026-11-19b` (#254, 222b) ; chaque PR suivante d'US-222 (#256, puis 222d, 222e) prend un suffixe libre **après** le dernier pris sur `main` **et** dans les autres PR ouvertes d'US-222 (`c`, `d`…), pour qu'aucune fusion n'écrase la revue d'une autre partie.
- **Suites** : N-399 à N-414 inscrites au BOARD le 2026-11-19 ; inventaire « avant l'ouverture d'un pays » : 31 suites (N-399 et N-402 en cours dans US-222d).
- **Fondateur** : `POUR_LE_FONDATEUR.md` ; nouveautés : **deux numéros par pays** (support de Kmino, assistance de l'assureur, format E.164 ; la production refuse de démarrer sans eux, GL-36), remontés en page 1 et au §2.13 ; vingt branches à supprimer sur son « oui » (§5) ; en information : mode « sur demande » prêt mais fermé jusqu'à GL-26 (§7.4), red team argent (§7.10).

## Prochaine action exacte (orchestrateur, 2026-11-19, 7 h UTC, historique)

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
