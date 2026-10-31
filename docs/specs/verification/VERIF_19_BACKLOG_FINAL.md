# VERIF_19 — Audit indépendant du backlog 19 et de la dernière passe de cohérence (04 rév. 5, 16 v4, 17 v5, 18 v4, 22)

> Auditeur indépendant (rôle : manager d'ingénierie + responsable QA). Rédigé le 2026-10-30. **Aucun fichier revu n'a été modifié.** Fichiers produits : ce rapport, `tools/verif19_backlog.py` (script indépendant, ne réutilise pas `check_backlog.py`), `verification/verif19_backlog_output.txt` (sortie brute), une ligne dans `verification/VERIFICATION_LOG.md`.
> Périmètre lu : 19 en entier pour les §1, §2, §4 à §7 et 20 stories sur 168 en détail plus un balayage automatique des 168 ; 04 (CSV et README), 16, 17, 18, 22, 08 et 10b par recherches ciblées (pas relus intégralement). Les SQL et les tests ne sont pas exécutés (PostgreSQL absent) : rien de ce rapport ne prouve la conception de 17 §2.5.

## 0. Verdict

**Prêt à démarrer le lot 0 ? OUI, sous conditions.** 0 CRITIQUE, 4 MAJEUR, 17 MINEUR. Le périmètre est couvert, le graphe est sain et les chiffres tiennent. Les 4 MAJEUR sont des lacunes du **modèle d'exploitation de l'équipe d'agents** et des tâches du fondateur, pas du contenu produit. Ils se corrigent par des stories ou des règles écrites au tout début du lot 0 (US-029 est le bon support). **Conditions avant d'engager le lot 0** : (1) fondateur : F-01 et F-02 seulement ; (2) l'orchestrateur écrit, dans `docs/team/`, les règles du MAJEUR 2 (accès des agents, porte de déploiement, budget d'usage) avant la première fusion ; (3) le MAJEUR 1 devient une story ou une ligne du DoD avant la fin du lot 0.

## 1. Sorties de scripts

| Script (`python -I`) | Résultat |
|---|---|
| `tools/check_backlog.py` | RÉSULTAT : OK ; 168 stories, 819 pts ; couverture P0-A 166/166 et P0-B 13/13 ; 349 dépendances, 0 cycle ; 15 « écarts assumés » |
| `tools/check_inventory.py` | RÉSULTAT : OK ; 179/179 lignes P0 couvertes par un epic ; lots du P0-A : 22/50/65/24/1/C=4 ; 0 inversion de lot ; barème Bêta 7,5–17,5 et P0-A 24,4–49,9 unités |
| `tools/check_prd_structure.py` | RÉSULTAT : OK ; 134 fiches × 24 rubriques ; BR, SM, EC, T, TA, OQ, UXQ, écrans, ADR, DEC cités tous connus ; D.1 = régénération |
| `tools/verif19_backlog.py` (le mien) | **0 erreur**, 58 avertissements (détail en §1.1) ; sortie : `verification/verif19_backlog_output.txt` |

Contrôles du script indépendant (il ré-analyse le Markdown de 19 et le CSV de 04 sans réutiliser le code existant) :
- 168 stories ; rubriques obligatoires toutes présentes ; estimations toutes dans l'échelle 1, 2, 3, 5, 8, 13 ; centaine de l'identifiant = lot ; Bêta pilote cohérent avec le lot (OUI L0–L4, NON L5/LB, PRÉALABLE LC).
- Couverture : 166/166 lignes P0-A et 13/13 lignes P0-B de 04 portées par au moins une story (une première version du script manquait I18N-003/004/005 à cause d'une expression régulière sur les préfixes à chiffre ; corrigée, c'était mon défaut, pas celui de 19).
- Références inexistantes : 0 (ADR 30 distincts, BR 97, T 52, TA 11, C 20, RLS 14, L0 10, OQ 36, UXQ 11, EC 29, SM 8, DEC 5 ; tous retrouvés dans 08, 16, 17, 22, 11).
- Dépendances : toutes existent ; 0 cycle ; aucune dépendance vers un lot postérieur.
- Points par lot recalculés : L0 221, L1 87, L2 102, L3 52, L4 37, L5 210, LC 49, LB 61 = **819** ; Bêta (L0–L4) 499 ; P0-A (L0–L5) 709. Identiques à la table de 19 §7.
- Information : 15 lignes P0-A dont la première story arrive **après** le `lot_p0a` de 04 (HDB-001, SRC-002, SRC-012, LST-008, LST-020, BKG-016, PAY-002/004/006/017/018, TRP-057, NTF-002, NTF-011, ADM-007) : toutes sont DIFFÉRÉ ou MANUEL en Bêta, donc cohérent avec 19 §2 (versions complètes au lot 5).

### 1.1 Avertissements du script (non bloquants)
- Critères Given/When/Then déséquilibrés dans 15 stories (ex. US-704, US-709, US-710 : 1 Given, 0 When ; US-017 : 8/6/8 car « Given … Then » sans When explicite).
- Écrans cités avec « Revue design : NON » : US-012 (O01), US-206 (A11).
- « Revue design : OUI » sans écran cité : 40 stories (surtout lot 5 et LB, où les écrans ne sont pas encore nommés).

## 2. Contrôle des constats F-01 à F-24 de VERIF_18

| F | Statut constaté | Preuve |
|---|---|---|
| F-01 lot C | **Corrigé** | 04 : 4 lignes `lot_p0a = C` (PAY-041, PAY-042, FIN-020, VER-029) ; 19 : lot LC ; `check_inventory` accepte C |
| F-02 DEC-04 | **Corrigé** | I18N-005 (OUI, lot 0) et FIN-003 (MANUEL, lot 2) en P0-A ; plus de « Panama City » seul ni de « phase PY » dans 16/18 |
| F-03 ADR-028 | **Corrigé** | 17:2272 présent, tableau ADR ordonné 026 à 040 |
| F-04 formule de caution | **Corrigé** | 04 PAY-036 = formule en heures de 08:1301 (`H_requise`, marge 0 h) |
| F-05 fiche PAY-011/012 | **Corrigé** | 16:3474 : « jamais suspendue par une réclamation » |
| F-06 10b mode b à 2 h | **Corrigé** | plus de « sous 2 h » dans 10b hors métrique M-KYC-02 (sans rapport) |
| F-07 C1–C12 | **Corrigé** | 04:150, 16:1045/1071, 08:1192, 18:402 citent C1–C20, RLS-1–20, L0-01–10 ; les occurrences restantes de « C1–C12 » sont des citations d'historique (17 annexes) |
| F-08 README de 04 | **Corrigé** | 676 lignes, 166 P0-A, 658 et 147 disparus du corps |
| F-09 énoncé P0-A | **Corrigé** | 18:197 et 18:253 : 320–640 jours-agent (Bêta 170–300) |
| F-10 table RLS | **Corrigé** | 17:481–497 : tableau RLS-1 à RLS-20 avec résultat attendu |
| F-11 T66–T68 | **Corrigé** | `tools/check_t66_68.py` : RÉSULTAT OK |
| F-12 UXQ-08 | **Corrigé dans 17, non propagé à 19** | 17:2230 `flagged_booking_payment_order` ; 19 utilise encore `review_before_payment_link` (m2) |
| F-13 ACH Xpress | Appliqué selon le journal de 08 ; non revérifié en profondeur | 08:3029 |
| F-14 comptes périmés | **Corrigé** | `verif18_stale` : seuls restent des journaux et valeurs Turo étiquetées |
| F-15 orphelins | **Partiel** | BR-FUEL-02, BR-FUEL-03, BR-RETURN-05, BR-TT-05 toujours cités nulle part hors 08 (m14) |
| F-16 paramètres de partage | **Corrigé** | `delivery_share_pct` présent dans 17 |
| F-17 catalogue | Non revérifié (3 sous-points non rouverts) | — |
| F-18 `graceMinutes` | **Partiel** | résidus en 08:301, 370, 372, 1701, 2477 et 17:789, 2259 (m6) |
| F-19 collision « S » | **Corrigé** | colonne « Fin (S) » retirée de 18 (18:300) |
| F-20 portes juridiques | **Partiel** | note de lecture v4 en tête de 18 §3 et 22, cellules « Bloque » de C2/C3/C5 réécrites ; reste non revérifié pour les autres lignes |
| F-21 ordre des ADR | **Corrigé** | idem F-03 |
| F-22 PAY-001 / C19 | **Corrigé** | la fiche cite C19 |
| F-23 frais jeune conducteur | **Corrigé** | « ligne nulle en P0 » en 08:90, 126 |
| F-24 « 80 h » | **Quasi corrigé** | un résidu non étiqueté en 08:1728 (m7) |

Bilan : 17 corrigés, 4 partiels ou non propagés (F-12, F-15, F-18, F-20), 3 non revérifiés à fond (F-13, F-17, F-20).

## 3. Constats

### 3.1 MAJEUR

**MAJ-1 — Red team, pré-mortem et post-mortem « à chaque lot » : promis, non planifiés.**
19:76 et 19:114 disent « agent red team à chaque lot » et 19:113 « pré-mortem avant chaque lot, post-mortem après chaque incident ». Les seules stories sont US-407 « Red team du lot 4 » (19:2007) et un post-mortem dans le critère S1 d'US-409 (19:2045). Aucune story ni ligne de DoD ne l'impose aux lots 0 à 3, alors que les lots 0 et 2 contiennent l'argent, la RLS et la concurrence : c'est là que l'attaque coûte le moins cher. La phrase « répété à chaque lot suivant » (US-407, notes) ne vise que les lots après le 4.
*Correction proposée* : une story récurrente « Pré-mortem et red team de lot » (2 à 3 pts par lot, L0 à L3, avec livrable au registre des risques), et l'ajouter à la porte de sortie de chaque lot.

**MAJ-2 — Garde-fous opérationnels de l'équipe d'agents absents ou non testables.**
- *Accès et secrets des agents* : 19 §6 dit « accès délégué révocable » mais aucune règle ni story ne fixe le moindre privilège (qui peut lire les secrets, toucher la base de production, lancer un déploiement). Rien n'indique **qui déclenche un déploiement en production** (l'orchestrateur seul ? avec accord du fondateur ?). US-408 donne un go/no-go d'agent, pas une porte humaine.
- *Limites d'usage et continuité* : un paragraphe (19:119–121) et un champ du rapport de santé. Pas de règle de priorité quand le quota baisse (chemin critique d'abord ?), pas de plafond de dépense ni de coupe-circuit pour une boucle d'agent qui s'emballe, pas de règle de reprise (branche WIP poussée à chaque étape, notes de passation avant arrêt).
- *Indépendance « autre modèle »* : exigée pour l'argent seulement (19:1.5, 1.4 point 4, US-408). Elle n'est pas définie (quel modèle, comment l'orchestrateur l'invoque, que faire s'il est indisponible), et la sécurité, la RLS (US-011, 8 pts) et la concurrence (US-024) sont revues par le même modèle que celui qui implémente : erreurs corrélées. L'oracle (US-016) est écrit par « un autre agent » du même modèle ; il est atténué par le fait que les scripts Python existent déjà (audités).
*Correction proposée* : un document `docs/team/OPERATING_RULES.md` (story de 3 pts au lot 0) couvrant ces trois points, avec défauts : déploiement en production = accord du fondateur au point hebdomadaire, plafond d'usage journalier, seconde revue de modèle différent étendue aux stories RLS et conversion gardée.

**MAJ-3 — Tâches du fondateur : « minimales » mais incomplètes (§6, 19:3105–3123).**
Absents : (a) **entité juridique, compte bancaire et enregistrement fiscal** du porteur du projet, nécessaires aux contrats PSP, KYC et cloud (F-02, F-07, F-08, F-09 les supposent) ; (b) **budget et abonnement d'usage des agents** eux-mêmes, qui sont le goulot déclaré (19:33) ; (c) **recrutement des agences pilotes** et entretiens G0 de 5 à 10 loueurs par pays (OQ-MK-07, 18 C1) : F-12 ne couvre que la recette, pas la prospection ni la signature du contrat-cadre (US-537) ; (d) compte **WhatsApp Business / BSP** (US-526, lot 5) ; (e) **assurance de la plateforme elle-même** (RC, cyber), distincte de l'attestation de police des agences (F-09) ; (f) désignation du **responsable des données** Ley 81 (US-536 le suppose) ; (g) clé d'API des tuiles/lieux (SRC-002 est DIFFÉRÉ, donc seulement les tuiles, déjà dans F-04). Apple / Google : correctement absents (PWA, pas d'app native ; à ajouter à DEC-NATIVE si elle est un jour prise). F-03 (domaine « après DEC-MARQUE ») entre en conflit avec US-003/US-021 qui ont besoin d'un domaine d'envoi dès le lot 0 (m15).
*Correction proposée* : ajouter F-14 à F-18 (entité et banque, budget d'usage, prospection des agences et G0, WhatsApp, assurance plateforme et responsable des données) avec « quand ».

**MAJ-4 — Échéances de décision de 19 §5 en désaccord avec 22, et un critère qui bloque malgré le défaut.**
- US-026 (19, lot 0) : « Given aucune décision ADR-005, When le lot 3 démarre, Then US-302 et US-303 ne démarrent pas » contredit à la fois son propre « Bloqué par (défaut) : PWA en ligne seulement », la règle d'autonomie (« jamais bloqué en attente d'une réponse », 19 §1.5) et 17 ADR-039 qui décide déjà la PWA pour le MVP. Le blocage doit disparaître : le défaut s'applique.
- ADR-005 : « fin du lot 2 » (19:3081) contre « fin du lot 0, résultat de TRP-056 » (22:167) contre « décidé par ADR-039 » (17:2249). Trois états pour une même décision.
- UXQ-08 : « fin du lot 2 » (19:3087) contre « avant le lot 2 » (22:151) ; UXQ-09 : « avant la mise en service » (19) contre « avant la recette de la Bêta » (22:150) ; UXQ-04 : « lot 0 » (19) contre « avant la recette de la Bêta » (22:157) ; UXQ-03 : « lot 5 » (19:3091) contre « avant le lot 2 » (22:156) ; DEC-MARQUE : « fin de la 1re moitié du lot 0 » (19:3079) contre « fin du lot 0 » (22:169) ; J-ADM-031 : « avant la production du lot 2 » (19) contre « début du lot 2, valeurs de test autorisées » (22).
*Correction proposée* : 22 fait foi (liste unique, 22:140) ; recopier ses échéances dans 19 §5 ; supprimer le critère bloquant d'US-026.

### 3.2 MINEUR

- **m1 — WCAG 2.1 contre 2.2.** 16:163 (NFR-14) et 17:2469 disent « WCAG 2.1 AA » ; 10b §3.10 (10b:389–394), 19 et 18 disent 2.2 AA (UX-47 s'appuie sur 2.4.11 et 2.5.7, critères de 2.2). Aligner 16 et 17.
- **m2 — Nom de paramètre périmé dans 19.** `review_before_payment_link = true` (19:1510, 19:3087) contre `flagged_booking_payment_order = REVIEW_BEFORE_LINK` (17:2230, 22:151). La DoR 5 de 19 exige le nom de 17 §7.2 ; un test écrit sur l'ancien nom échouerait.
- **m3 — En-tête de 19 périmé.** 19:3–4 cite « 17 v4 », « 18 v3 », « epics E1–E15 » et « version 1 » alors que 17 est en v5, 18 en v4 et que le README de 04 compte E1–E18. 19:34 parle de « 18 §5.0 (16 à 28 semaines-équipe) » comme énoncé caduc, ce qui est exact, mais 18 v4 donne maintenant 170–300 et 320–640 jours-agent : le citer.
- **m4 — DEC-NATIVE « à ajouter à 22 » (19:3082)** n'est toujours pas dans 22.
- **m5 — 10b §3.4 garde le titre « Prix tout compris en USD (PYG plus tard) »** (10b:297) alors que UX-16, juste dessous, construit le PYG dès le départ ; UX-15 cite seulement l'ITBMS 7 % (pas l'IVA 10 %).
- **m6 — `graceMinutes` résiduel** après F-18 : 08:1701 (« 0 si `graceMinutes` = 29, partagé avec BR-BOOK-03 », or `overdue_detection_minutes` = 30 est un paramètre distinct), 08:2477, 08:370–372, 17:789, 17:2259 (ADR-015). US-305 teste correctement 30 min.
- **m7 — « dépôt libéré 80 h » non étiqueté** en 08:1728.
- **m8 — Références de design.** US-120, US-538 et US-121 citent « 10b §3.10 » (qui est la section WCAG, 10b:389) au lieu de l'écran **O02 Apparence / Marque** (10b:483, §8) ; O02 n'est cité nulle part dans 19. US-206 (écran A11) et US-012 (O01) ont « Revue design : NON » alors qu'ils produisent un écran : la DoD point 4 n'imposera donc pas de revue UX.
- **m9 — Variante PY non écrite dans les critères.** Seules 22 stories sur 168 mentionnent PYG / PY / Asunción dans leurs critères ; 37 stories à contenu monétaire (heuristique) ne la citent pas (ex. US-203 fiche et prix, US-210 paiement par lien, US-215 annulations, US-217 commission, US-304, US-307). La couverture repose sur la règle générique de la DoD point 2 et sur les parcours dorés (US-221, US-312, US-539, qui citent PA et PY). Acceptable, mais un agent QA qui lit le critère seul ne voit pas la variante : ajouter « et variante PYG de l'oracle » aux 6 stories d'argent principales.
- **m10 — Critères non testables.** US-603 (« le fondateur décide ») est une décision, pas un test ; US-607 est une liste de cases (acceptable comme porte, à mesurer par un rapport signé). Quinze stories ont un Given/When/Then déséquilibré (voir §1.1).
- **m11 — Grand livre : pas de rattrapage ni de rapprochement.** US-530 (19:2515) dépend seulement d'US-217 et n'a aucun critère de reprise des règlements, relevés et pénalités déjà produits pendant la Bêta, ni de test « Σ grand livre = Σ `commission_line` + pénalités ». À ajouter (voir §4.1).
- **m12 — Anti-abus global.** Le verrouillage OTP existe (1062 : `OTP_LOCKED`) et les poses de hold ont un plafond (17 paramètre `hold_creations_per_guest_vehicle_hour`), mais aucune story ne traite la limitation de débit sur l'envoi de SMS / e-mails (coût), la recherche publique et l'API, ni la protection contre les bots. À ajouter à US-043 ou comme story L1 de 3 pts.
- **m13 — Chemin critique.** `check_backlog` donne le même chemin pour la fin de build Bêta et pour « P0-A complet » (+ US-607) : aucune story du lot 5 n'allonge le plus long chemin, parce que le lot 5 ne dépend pas de la coupe dans le graphe. Cela ne contredit rien (les lots sont une affaire de capacité, pas de dépendance), mais la phrase « le chemin critique traverse… » de 19:4.2 ne dit rien du parallélisme réel ; pas d'impact sur le démarrage.
- **m14 — Orphelins de VERIF_18 F-15 non traités** : BR-FUEL-02/-03, BR-RETURN-05, BR-TT-05 (aucune fiche ni story ne les cite).
- **m15 — Domaine et e-mail d'envoi** : F-03 (19:3112 ss.) place l'achat du domaine « après DEC-MARQUE » mais US-003 et US-021 (L0) en ont besoin pour SPF/DKIM et la préproduction ; indiquer un domaine de travail par défaut (sous-domaine technique du fondateur).
- **m16 — Estimation, lecture.** Voir §5 : cohérente, mais au bas de la fourchette de 18 pour le P0-A (355 jours-agent pour 320–640) ; sept stories à 13 pts (US-515, etc.) non découpées.
- **m17 — Densité du lot 0.** 48 stories, 221 pts (44 % de la Bêta) avant toute fonction visible, hors maquettes ; voir §4.2.

## 4. Jugement de séquencement

### 4.1 Grand livre en partie double au lot 5 : acceptable pour la Bêta, à trois conditions
Raisonnement. En P0-A l'agence encaisse (mode b, lien du PSP de l'agence) ; la plateforme ne détient aucun fonds. Sa seule créance est la commission, déjà calculée et persistée par ligne dès le lot 0 (US-018 : `settlement`, `settlement_line`, versions et supersession, invariants E4, TA08 = 34,20) et exportée par US-217 (L2). Les remboursements sont suivis par `refund_instance` et `agency_refund_task` (US-216, L2), la commission facturée hors plateforme par le comptable, et le rapprochement mensuel assisté est livré en L3 (US-311) avec l'automatisation en L5 (US-532). Un grand livre à ce stade ne ferait que dupliquer des tables déjà équilibrées par construction ; 17 §10 le diffère explicitement. Il serait **nécessaire** dès que la plateforme détient de l'argent (P0-B, US-709), ce qui est correct.
Conditions : (1) un test Bêta d'invariant « Σ commissions du relevé = Σ lignes de règlement non annulées moins supersessions » en CI et en nuit (à vérifier dans US-217 / US-047 ; non écrit explicitement) ; (2) US-530 doit prévoir la **reprise de l'historique de Bêta** (règlements, pénalités, relevés) avec critère d'équilibre et de non-doublon (m11) ; (3) le rapprochement FIN-019 (US-311) en Bêta est un export lu par un humain : l'accepter explicitement comme MANUEL borné à 1–2 agences, avec le seuil d'écart de J-ADM-031 défini avant l'ouverture. Ni un grand livre minimal au lot 2, ni FIN-019 automatisé plus tôt, ne sont justifiés.

### 4.2 Moteur de règlement et conversion gardée au lot 0 : correct
Le règlement est une fonction pure déjà couverte par des vecteurs et un oracle audité (US-015 → US-016 → US-017 → US-018) ; la conversion gardée (US-022 à US-025) est la partie la plus risquée de 17 et ses preuves doivent précéder la réservation. Les placer au lot 0, avec C1–C20 et L0-01 à L0-09, est bien. Le coût de ce choix est le lot 0 lourd.

### 4.3 Lot 0 : trop tôt, ou manquant ?
- *Présent et à sa place* : preuves PostgreSQL (US-005 à US-007), rôles de production et assertion L0-05 (US-005), RLS et commandes (US-011), garde `FAKE` en production (C19 dans US-019, préparé dans US-003, vérifié dans US-607), portes de CI (US-002, §1.8), sauvegardes (US-004), journal d'audit (US-009).
- *Pas indispensable si tôt* (peut glisser sans toucher le chemin critique) : US-036 portabilité (5), US-040 CHANGELOG (2), US-044 régression visuelle (3), US-046 tests de migration et DSR (3, mais utile tôt), US-045 performance et résilience (5) : ces cinq stories n'ont aucun dépendant en L0 (outre US-027, US-031, US-048). Les repousser en L1 ne coûte rien de sûr et aplatit le lot 0. À l'inverse, rien de cela n'est à supprimer : DEC-FONDATEUR-08 et 09 les demandent.
- *Manquant ou trop tardif* : (a) un **test de restauration** dès le lot 0 : US-004 vérifie seulement qu'une copie existe ; la première restauration chronométrée est US-112 (L1) puis US-402 (L4) ; (b) limitation de débit et anti-bot (m12) ; (c) règles d'accès des agents et porte de déploiement (MAJ-2) ; (d) rotation des secrets seulement en runbook L4 (US-405).
- *Remarque de rythme* : 221 pts ≈ 110 jours-agent avant la première fonction visible (hors maquettes US-033). Prévoir une **tranche mince verticale** (inscription → fiche → lien) dès le début du lot 1 pour que le fondateur voie quelque chose au point hebdomadaire, ce que le plan permet déjà (L1 démarre quand US-011/US-012 sont fusionnées).

## 5. Estimations
- Échelle : 1, 2, 3, 5, 8, 13 respectée ; 7 stories à 13 pts, toutes au lot 5 ou LC/LB (US-515 notamment) ; la règle « à découper avant d'entrer en cours » est écrite (19:1.2).
- 1 pt ≈ ½ jour-agent, revues comprises : Bêta 499 pts ≈ **250 jours-agent**, dans 18 « 170 à 300 » ; P0-A 709 pts ≈ **355 jours-agent**, dans 18 « 320 à 640 » mais au bas de la fourchette ; LC 49 pts ≈ 25 jours-agent contre « 11 à 26 » de 18 (borne haute) ; LB 61 pts ≈ 30 jours-agent contre 2,0–3,7 unités de 04 (20 à 37). **Cohérent.** Risque : 1 pt = ½ jour revues indépendantes comprises est optimiste pour les stories « argent » à double revue ; la mesure du lot 0 (US-027) doit corriger.
- Aucune promesse calendaire dans 19 (seule occurrence de « semaines » : 19:34, qui déclare l'ancien énoncé caduc). 18 propose « 2 à 4 semaines » de recette pilote (18 §5.0) : c'est un paramètre proposé, hors de 19.

## 6. Qualité des stories (échantillon de 25 : US-001, 002, 003, 004, 005, 011, 013, 016, 017, 018, 023, 024, 026, 029, 034, 048, 120, 204, 209, 210, 215, 216, 217, 302, 305, 307, 603, 607 ; certains choisis pour l'argent, la réservation, la RLS, l'Apparence, la PWA iOS)
- **INVEST** : bien. Les stories sont verticales sauf celles du socle (assumé), indépendantes par les dépendances explicites, estimées, testables. Les plus grosses (US-017 à 8, US-024 à 8, US-011 à 8) sont des unités de risque cohérentes.
- **Critères testables et cohérents avec 16 / 08** : très bons sur l'argent (US-017, 018, 215, 216, 217 : valeurs TA/T avec montants exacts), la réservation (US-023, 024 : C-tests nommés avec résultats), la RLS (US-011 : RLS-8, 15, 20), la caution (US-206), les retards (US-305). Les valeurs ont été recoupées avec 08 pour T et TA par le script (références toutes connues) ; je n'ai pas rejoué les montants un par un.
- **Faiblesses** : critères de décision non testables (US-603), variantes PY non écrites (m9), US-026 bloquant malgré le défaut (MAJ-4), écran O02 mal référencé (m8), US-034 sans le garde-fou de contraste (présent seulement dans US-120, ce qui est cohérent mais laisse US-034 publier un thème illisible tant qu'US-120 n'est pas livrée : ajouter la vérification de contraste au critère de publication d'US-034 ou la déclarer en dépendance de US-120).
- **PWA iOS** : US-026 (évaluation) puis US-048 (coquille) sont bien séquencées ; US-302 dépend d'US-303 et d'ADR-005. Seul le blocage dur est à retirer.
- **DoD (19:1.4)** : complète (tests, deux pays, `FAKE`, revues indépendantes dont argent sur autre modèle et design, traçabilité, documentation obligatoire, design modifiable, démo). Pas de contradiction avec 16 / 08 trouvée. Faille : la DoD n'impose pas de porte humaine avant la production (MAJ-2).
- **Stratégie de tests (19:1.8)** : exhaustive, avec seuils PROPOSÉS (couverture, mutation ≥ 80 %), parcours dorés PA et PY la nuit, honnête sur ses limites. Rien de contradictoire avec 17 §12 sauf WCAG 2.1 (m1).

## 7. Cohérence inter-fichiers après la dernière passe

| Sujet | Résultat |
|---|---|
| Entités de design (`brand_version`, `brand_asset`, `content_block`) | Présentes en 17 §3.2.13 et §10 ; DSN-001 à DSN-007 en 04 ; 19 les nomme. Cohérent. Seul défaut : référence d'écran O02 (m8) |
| ADR-036 à ADR-040 | Définis en 17:2280–2284 ; cités par 17, 19 ; pas d'identifiant inconnu |
| Lot C | 04 (4 lignes), README, 18, 19 (LC, 7 stories, 49 pts), 22 (DEC-PAYS) alignés. PAY-041 est `lot_p0a = C` mais sa garde (US-220) est construite au lot 2 et sa décision au lot LC (US-603) : cohérent, expliqué |
| I18N-005 et FIN-003 promues | 04 : I18N-005 OUI lot 0, FIN-003 MANUEL lot 2 ; 19 : US-013 et US-530/531 les portent ; 22 DEC-04 le dit. Cohérent |
| Formule de caution (PAY-036, 08 BR-PAY-06, 09b, 17 §7.2) | Alignée (en heures, marge 0 h, +1 j supprimé) |
| C1–C20 et RLS-1 à RLS-20 | Alignés dans 04, 08, 16, 17, 18, 19 ; occurrences « C1–C12 » restantes = historique |
| Comptes | 676 lignes ; P0-A 166 (lots 22/50/65/24/1/C4) ; P0-B 13 ; P1 342 ; P2 108 ; P3 47 : concordance CSV, README, 18, 19 |
| Points de 19 contre 18 | Cohérents (§5) |
| WCAG | Contradiction (m1) |
| Paramètre UXQ-08 | Contradiction de nom (m2) |
| `graceMinutes` | Résidus (m6) |

## 8. Ce qui n'a pas été fait
Pas d'exécution de SQL ni du banc de tests ; pas de relecture complète de 16, 17, 08, 10b ni de toutes les stories (échantillon + balayage automatique) ; montants des critères non recalculés ; F-13, F-17 et la totalité des cellules de F-20 non revérifiés ; coûts calendaires non estimés (volontairement).
