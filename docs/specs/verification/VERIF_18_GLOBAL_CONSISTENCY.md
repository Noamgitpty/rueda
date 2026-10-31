# VERIF_18 — Audit indépendant de cohérence croisée et de préparation au développement

> Date : 2026-10-30. Auditeur indépendant. Périmètre : 04 (CSV + README), 08, 10b, 11, 16, 17 (v4), 18 (v3), 22, `sources/SRC_VEHICLE_DATA.md`, `tools/*.py`, `verification/*.md`. Hors périmètre (décision du lead) : conception de concurrence de 17 §2.5 (à prouver sur PostgreSQL au lot 0, 17 §11).
> Aucun fichier relu n'a été modifié. Scripts écrits pour cet audit (lecture seule, `python -I -X utf8`) : `tools/verif18_crossref.py` (identifiants) et `tools/verif18_stale.py` (contenus périmés). Sorties brutes : `verification/verif18_crossref_output.txt`, `verification/verif18_stale_output.txt`.
> Convention : `fichier:ligne` = ligne physique du fichier (pour le CSV : ligne du fichier, en-tête = ligne 1). Gravité : CRITIQUE (une implémentation fidèle produit un résultat faux ou dangereux) / MAJEUR (un développeur est bloqué ou implémente la mauvaise valeur) / MINEUR (confusion, dette de documentation).

## 0. Verdict

**Aucun CRITIQUE. 9 MAJEUR (F-01 à F-09), 15 MINEUR numérotés (F-10 à F-24) et quelques écarts mineurs non numérotés. Verdict : CONDITIONNEL — utilisable pour démarrer le lot 0 (preuves PostgreSQL de 17 §11, socle), pas encore pour remettre 04/16/18 tels quels à une équipe sans une passe de corrections.** Les valeurs métier et monétaires sont cohérentes dans l'ensemble (section 2) ; les écarts viennent surtout (a) de la décision DEC-FONDATEUR-04 (deux pays dès le jour 1) reflétée dans 17/18 §0 mais pas dans l'inventaire 04 ni dans les parties périmées de 16/18, (b) de comptes et plans de tests restés à leur état v2/v3, (c) d'un ADR cité mais absent (ADR-028). Les contrôles existants repassent : `check_inventory` OK (149 P0-A + 13 P0-B ; Bêta 18/64/55/12 = 82 ; barème 6,2–14,8 et 21,4–42,8), `check_prd_structure` OK (162/162, 129 fiches, D.1 sans écart), `check_ta_consolidation` OK, `verif15_struct` sans écart, `verif11_settlement`, `verif12_t49plus` 38/38, `check_verif12_fixes` 0 écart, `independent_settlement_check` 0 écart sur T01–T48 (fuzz 20 000 cas), `check_t49plus` 0 écart. Limite : aucun script ne couvre T66–T68 (seule trace dans `check_verif12_fixes.py`).

## 1. Identifiants (script `verif18_crossref.py`)

Sortie résumée :

| Famille | cités / définis | cités sans définition | Définis jamais cités hors définition |
|---|---|---|---|
| feature_id | 649 / 661 | 0 (`SHA-256` est un faux positif de l'expression) | — |
| BR | 198 / 198 | 0 | 9 absents de 04 (regles_liees/notes) : BR-CXL-03, -15, -16, BR-FUEL-02, -03, BR-PROT-08, BR-RETURN-05, -07, BR-TT-05 ; **4 citées nulle part hors 08** : BR-FUEL-02, BR-PROT-08, BR-RETURN-05, BR-TT-05 |
| SM | 11 / 10 | `SM-x` (17:923, générique, faux positif) | 0 |
| EC | 56 / 56 | 0 | 6 jamais cités ailleurs que dans 11 : EC-05, 21, 22, 23, 25, 44 ; EC-54 sans ID de BR (renvoie à « BR-CXL (règles 4 et 5) », 11:573) |
| T (08) | T01–T68 définis | 0 | T04, T10, T21 jamais cités hors 08 |
| TA (16) | 11 / 11 | 0 | 0 |
| OQ | 82 / 82 | 0 | OQ-PAY-09, -14, -16, -20, OQ-ARCH-01, OQ-ARCH-02 jamais cités hors 22 |
| UXQ | 13 / 13 | 0 | 0 |
| DEC | 4 / 4 | 0 | 0 |
| ADR | 35 / 34 | **ADR-028** (voir F-03) | ADR-008, 010, 011, 015, 016, 018, 020, 022, 023 (cités seulement dans 17, normal) |
| C-tests | C1–C20 définis (17:735–756) | 0 (`C0` = bruit) | — |
| RLS | RLS-1 à RLS-20 cités, **0 « défini » sous forme de ligne** (voir F-10) | — | — |
| L0 | L0-01 à L0-10 | 0 | L0-02, 03, 04, 08, 09 cités nulle part hors du tableau 17:2391–2400 |
| Écrans 10b | S01–S17, A01–A13, O01 | 0 côté 16/17/22 ; 18 cite S20, S21, S33, S40, S42 = **semaines**, pas des écrans (voir F-19) | tous les écrans sont cités par 16 |

Autres contrôles : P0 sans fiche dans 16 : 0 (outil existant : 162/162). Features P0 sans BR en `regles_liees` : 29 (VER-028, SRC-001, SRC-002, BKG-027, TRP-045, NTF-001, NTF-002, HDB-001, HDB-002, SUP-011, ADM-001, ADM-014, FIN-005, I18N-003, LEG-010, LEG-011, LEG-014, LEG-015, FIN-019, ADM-032 à ADM-036, PAY-041, SUP-020, TRP-056, TRP-057, HST-050) : acceptable pour du socle ou de l'ops, sauf HST-050/ADM-036 (F-17).

## 2. Mêmes faits, mêmes valeurs — tableau de contrôle

| Fait | Verdict | Détail et écarts |
|---|---|---|
| Règle de caution : libération fin + 72 h, jamais suspendue par une Claim, frais annexes liste fermée | **Cohérent sur le fond** ; 3 écarts de formulation | 72 h en 04 PAY-012 (CSV:188), 08:1290/1298/2938, 10b:315, 16:3499, 17:2174 (`release_delay_h` 72, marge 0). La valeur « 80 h » (Turo) reste dans 04 TRP-046 (CSV:279, 16:3894, P1), 08:2415 (NOTIF-20 « Libération du dépôt (80 h) »), 10b:166, 11:597 : à étiqueter « valeur Turo » (F-24). Écarts : F-04 (PAY-036), F-05 (PAY-012/PAY-011) |
| trip_days + 4 ≤ max hold | **Incohérent** entre formules | 08:1301 : forme en heures `H_requise = (start−auth_at)+(durée)+72 h+marge 0 h` prévaut, la forme « jours + 4 » est un repère (T59 : 3 j + 25 min échoue à 7 j). 04 PAY-011 (CSV:187) et 04 README:114 écrivent « ≈ trips ≤ 3 j à 7 j » sans le garde-fou en heures ; **PAY-036 (CSV:632, 16:3499) ajoute « + 1 j » de marge** : `trip_max_preauth = V − (pose + libération + 1 j)` donne V−5 j (2 j à 7 j), alors que sa propre phrase annonce « ≤ 3 j environ » et 08/17 posent marge = 0 h. → F-04 |
| TTL hold CHECKOUT 10 min ; borne `payment_in_flight` 20 min ; ordre Yappy 300 s ; AGENCY_LINK 120 min PROPOSÉ (UXQ-09) | **Cohérent** | 04 (CSV:150, 194, 615), 08:508–513/1146–1149/1195, 10b:339/420/811/825, 16:1057–1060/1817/1829, 17:508–510/2129–2146, 22:127/150. Rien ne présente 120 min comme décidé. Reste périmé uniquement dans des journaux (« hold de 2 h 10 » 16:1061, 16:4532, 17:2414) |
| Annulation gratuite 24 h ; seuil « dernière minute » 25 h ; grâce no-show 60 min | **Cohérent** | 08:52–62/399–400/500, 11:384, 16:955/2589/3103, 17:2124–2126, 22:54/160 (noms différents : `lastMinuteThreshold`, `lastMinuteThresholdHours`, `last_minute_threshold` : MINEUR) |
| Frais jeune conducteur | **Cohérent** (P1) avec 1 réserve | PRC-014 est P1 (CSV:222, 16:3857, 18:114) ; 08:26/90/126/301/330 et 17:1037 (`YOUNG_DRIVER_FEE`) le portent déjà dans la formule/les enums : aucune mention « = 0 en P0 » (F-23) |
| `platform_funded_host_compensation` défaut `false` | **Cohérent** | 08:9/420/504/554/627, 16:6/2629/3103/3107/4463, 17:62/2167/2224, 22:65/146 ; 04 ne porte pas le paramètre (renvoie à ADM-014/OQ-BR-41) |
| `p0a_ineligible_no_show_outcome` défaut `REFUND_GUEST` | **Cohérent** | CSV:248, 08:11/147/506, 16:335/2445, 17:2168, 22:69/149 ; TA11 = 128,40 remboursé (script OK) |
| Devise / arrondi | **Cohérent** | `Money{amount_minor,currency}`, `roundHalfUp` par ligne, taxe par ligne puis somme, `allocHost` au plus proche (égalité → plateforme), PYG exposant 0 : CSV:229, 08:323–335/1502, 11:342–352, 16:149/1477, 17:87/1007. Seul écart : « phase PY » (CSV:229 note PRC-021) |
| Taux de taxe en paramètres | **Cohérent** | ITBMS 7 % / IVA 10 % dans `tax_line_config` (17:2185/2328, 22:176, CSV:228) ; 04 ADM-031 (CSV:623) cite « Panama et Paraguay » ; valeurs 7 % présentes dans les fiches seulement comme valeurs par défaut |
| Fenêtre de conservation des preuves | **Cohérent** ≥ 15 mois | 08:1365/2945, 09b:348, 17:125/933/2178 ; « 12 mois » n'apparaît que comme fenêtre de chargeback Bancard (08:785, 22:67) ou validité KYC réutilisable (10b:349/557), pas comme rétention de preuve |
| Comptes Bêta 18 / 64 / 55 / 12 = 149 ; 82 construites | **Cohérent aux endroits à jour** ; périmé ailleurs | À jour : CSV via script, 04 README:61, 16:49, 17:2300, 18:3/12/26/28/32/366. Périmé : F-08, F-14 |
| Comptes de tables (17) | **Non vérifiable** | seul 17 §10 (17:2349) les donne : 85 + 4 = 89 nommées + 4 d'infrastructure = 93 ; 138 entités ; 7 ports sur 13. Aucun script ne recompte ; 04/16/18 ne les citent pas (pas d'incohérence croisée) |
| Estimation Bêta « 16–28 semaines-équipe ≈ 4–7 mois » | **Cohérent** | 16:72, 17:2362, 18:189/201/203/295/367 ; 16:72 omet la définition « 1 semaine-équipe = 2 développeurs × 1 semaine » (17:2362) : MINEUR |
| Estimation « P0-A complet 21–42 » | **Ambigu** | 18:197 : 21–42 « à relever d'environ +8 à +14 (non recalculé) » ; 18:234 écrit « ≈ 21–43 » (21,4–42,8) ; aucune valeur retenue pour le P0-A avec les non négociables et deux pays. → F-09 |

## 3. Décisions du fondateur

| Décision | État | Constat |
|---|---|---|
| DEC-FONDATEUR-02 (construire d'abord ; avis juridiques = porte de mise en service) | Reflétée dans 16 en-tête/A.6 (16:123), 17 ADR-031 (17:2239), 18 §0/§4 (18:10, 183, 363), 22:174 | Restes périmés : portes G1a/G1b « avant le lot 1 / lot 2 » encore dans les tableaux 16:128–129 (annotés), 18:133–134, 22:78 (« porte G1 … avant le lot 2, avis préliminaire avant le lot 1 »), 22:111 (« aucun développement avant réponse ») ; CSV:623 « jalon avant le lot 2 » (J-ADM-031 : valeurs de test autorisées, 22 liste unique) : MINEUR F-20 |
| DEC-FONDATEUR-03 (PSP réel après choix du pays ; adaptateurs FAKE ; garde production) | Reflétée dans 04 PAY-001 (CSV:177 note) et PAY-041 (CSV:641), FIN-002 (CSV:545 note), 16:72/1911, 17 ADR-032 + C19, 18:292/312 | Garde production (contrainte, image, refus de démarrage, C19) bien présente. Écarts : PAY-041 (CSV:641 et 16:1895) place toujours la porte « au début du lot 2 », alors que 18:292 la met après le choix du pays dans un « lot des connecteurs réels » sans `lot_p0a` en 04 (F-01) ; le critère d'acceptation de PAY-001 (16:1673) ne cite ni FAKE ni C19 (F-22) |
| DEC-FONDATEUR-04 (Panama et Paraguay dès le jour 1) | **Partielle** | Reflétée : 04 PRC-020/ADM-014/ADM-031 notes, 16:59/6, 17:48/2241 (ADR-033), 18:10/15/128/365, 22:176. **Non reflétée** : I18N-005 et FIN-003 restent P2 « Phase Paraguay » (CSV:565 et CSV:546), PRC-021 note « phase PY » (CSV:229), 16:57/79/1521/3487/4177, 17:109 (`es-PY` « P2 ou bascule »), 17:899, 17:1998 (SIFEN « bascule ou P2 »), 18:106, 18:239, 18:300 (contredisent 18:15 et 18:365), 10b:302 (« Paraguay (P2) »). → F-02 |
| DEC-FONDATEUR-01 (compensation hôte) | **OUVERTE, non implémentée en silence** | défaut `false` fail-closed ; T17/T18/T20 libellés « option A explicite », T61 option B (08:554/627) ; ADR-014 « à trancher avant le lot 2 » (17:2224), 22:146 « mise en service du lot 2 » : formulations voisines, à unifier (MINEUR) |
| OQ-BR-04 (jours facturés) | **OUVERTE** | `grace_minutes` = 29 en paramètre ; 29 min est aussi écrit en dur dans la description de BKG/PRC (CSV:233 « − 29 min », CSV:268) mais toujours avec renvoi à OQ-BR-04 (16:1529 : « paramètre `grace_minutes` »). Écart de nommage : 08:1080 « une seule constante `graceMinutes` partagée avec BR-RETURN-03 » contre 16 R10 / 17:2127/2191 (deux paramètres `grace_minutes` et `overdue_detection_minutes` = grace + 1) : F-18 |
| OQ-BR-45 | **OUVERTE** | défaut `REFUND_GUEST` ; alternatives chiffrées TA11 ; rien de tranché |
| UXQ-01 à UXQ-13 | **OUVERTES, non tranchées** | UXQ-08/09 explicitement conditionnelles (08:1200, 16:614/1271/3159, 17:508). Réserves : 10b:259/352 écrivent en texte d'interface « lien de paiement émis après décision (PROPOSÉ, UXQ-08) » ; aucun paramètre de 17 §7.2 ne porte le choix de branche UXQ-08 (seul `review_hold_minutes`, 17:2133) : le développeur ne sait pas quelle branche coder par défaut (F-12) ; UXQ-09 : 10b:322/530/716 gardent « 2 h » (F-06) |

## 4. Catalogue véhicules (HST-050, ADM-036, HST-051, HST-007, OQ-CAT-01, ADR-034, entités)

**Globalement cohérent.** HST-050 (P0-A, lot 1, SIMPLIFIÉ), ADM-036 (P0-A, lot 1, SIMPLIFIÉ, dépend de HST-050), HST-051 (P2), HST-007 (P1, VIN en *best effort*, jamais bloquant) : mêmes statuts dans 04 (CSV:631/659/660/340), 16 (fiches 16:2157–2196, D.1 16:4359, C 16:4194), 18 (lot 1 = 48 lignes, Bêta 21 au lot 1), 17 (ADR-034 17:2242, entités `vehicle_make`/`vehicle_model`/`vehicle_variant`/`catalog_addition_request` 17:1012–1015, `vehicle.variant_id` 17:1005, paramètre `catalog_addition_sla_business_h` = 24 17:2135 = 16:2183). `review_queue_item` de type `CATALOG_ADDITION` concordant (17:1015, 16:2191, CSV:631). Écarts :
- F-17 (MINEUR) : HST-050 et ADM-036 ont `regles_liees` vide et HST-050 n'a aucune dépendance ; 16:2162/2188 disent « aucune règle de 08 » : normal, mais BR-LIST-04 (saisie du véhicule) n'est pas liée.
- F-17 (MINEUR) : OQ-CAT-01 (g) demande si un véhicule sans variante peut être publié ; 04 HST-011/FLT-011 (notes v4) et 17:1011 tranchent déjà « jamais une annonce publiée » (décision implicite d'une sous-question ouverte).
- F-17 (MINEUR) : `sources/SRC_VEHICLE_DATA.md:3` annonce comme cible une entité « `catalog.vehicle` », nom qui n'existe pas dans 17.
- HST-050 amorcé par NHTSA/Wikidata au lot 1 alors que OQ-CAT-01 (licences À VALIDER) est ouverte ; mitigation présente (champs `source` + `license_note` obligatoires, valeurs EPA étiquetées) : pas d'écart.
- OQ-CAT-01 est cité par 16 (16:2174, 16:4359) et 04, pas par 18 (pas de porte de mise en service listée pour les licences) : MINEUR.

## 5. Contenus périmés (script `verif18_stale.py`, occurrences [CORPS] hors journaux)

| Motif recherché | Résultat |
|---|---|
| « trip `BOOKED` impayé » | **Aucun contenu périmé** : seules mentions = alternative non retenue de ADR-025 (08:290/1204, 16:1821, 17:503/2235/2414, 22:127/150) |
| Hold 2 h 10 / 130 min | **Aucun** hors journaux (16:1061, 16:4532, 17:2414) |
| Mode b « sous 2 h, sinon annulation automatique » | **Périmé dans le corps de 10b** : 10b:322, 10b:530 (diagramme) ; 16 R1 (16:4554/4575) le déclare « Résolu (10b) » mais seule la colonne Erreur de S06 a été corrigée. 10b:716 : « mode b ≤ 2 h (PAY-033) » codé en dur. → F-06 |
| ACH Xpress dans le chemin Yappy P0-A | **Aucun en P0-A**, mais 2 passages sans qualification P0-B : 08:1325 (« remboursement par virement ACH Xpress (PA) / SIPAP (PY) » en [NOUS], alors que C08-11 « appliqué » dit : P0-A = virement par l'agence) et 11:524 ; 22:112 (OQ-PAY-22 « renvoi manuel (ACH Xpress) »). Les autres mentions (04 PAY-004/README:152, 08:703/708, 16:86/1713, 17:832/1989/2415, 18:116) sont correctes. → F-13 |
| 72 h vs 80 h | cf. section 2 ; « 80 h » à étiqueter « Turo » : CSV:279, 16:3894, 08:2415, 10b:166, 11:597 |
| Rétention 12 vs 15 mois | **Aucun écart** (voir section 2) |
| Stripe Panama/Paraguay « non » | Cohérent : « Stripe indisponible pour une entité PA/PY » (CSV:177 note, 08:1249). Réserve : 08:2124 reprend « Stripe indisponible » pour les **versements**, alors que 22 OQ-PAY-20 (22:110) signale `py_bank_account` ajouté par Stripe Global Payouts le 27/05/2026 : à nuancer (MINEUR) |
| Localpayment « licencié » | **Aucune occurrence** ; Localpayment = « enregistré à la SBP, MP-012 » (22:95, 08:2923). « PSP licencié » apparaît seulement au sens générique de P0-B (17:42, 18:90, 22:79/111) |
| Comptes périmés | **Nombreux** : README 04 (658, 147, 109, 160, §7 deux fois), 16 (147, 160, 109, T01–T65, « 59 lignes MANUEL »), 17:154/2012, 18:22/53/96/234/300 : F-08, F-14 |
| Tests C1–C12 / RLS-1 à RLS-12 | **Périmés dans des fiches d'acceptation** : CSV:150 (BKG-014), 16:1044 (CAL-011), 16:1070 (BKG-014), 08:1192, 17:2028/2356/2360 : F-07 |

## 6. Constats détaillés

### MAJEUR

- **F-01 — Lot des connecteurs réels : pas de place dans le modèle de lots.** 18:289–292 : le lot 2 contient « PAY-033 connecteur réel sous mandat, PAY-041 » (18:289) et, dans la même ligne, « connecteur réel au lot des connecteurs » ; 04 n'a que `lot_p0a` ∈ {0..4} (check_inventory : lot 0 = 11, 1 = 48, 2 = 65, 3 = 24, 4 = 1). Les lignes concernées (PAY-033, PAY-034, VER-001, FIN-002, PAY-041) restent en lot 1 ou 2, et la porte PAY-041 est « au début du lot 2 » (CSV:641, 16:1895). Un développeur ne sait pas quand livrer le connecteur réel ni dans quel lot comptabiliser l'effort (« non chiffré », 18:292). Correction : décrire chaque ligne en deux livrables (port + FAKE au lot N ; connecteur réel au « lot C ») et ajouter une valeur `lot_p0a` = C (ou une colonne `lot_connecteur`), réécrire PAY-041 (« après le choix du pays, avant la mise en service »).
- **F-02 — DEC-FONDATEUR-04 non reflétée dans l'inventaire ni dans des passages de 16/17/18.** Voir section 3 : I18N-005 et FIN-003 en P2 (CSV:565, CSV:546), « phase PY » (CSV:229), 16:57/79/1521/3487/4177, 17:109/899/1998, 18:106/239/300, 10b:302 ; cadrage « Panamá City » seul en 16:49, 18:51, 18:96 et lot 2 intitulé « (Panama) » (18:289) ; PAY-041 ne vise que Tilopay/Panama (CSV:641) alors que le PSP paraguayen (Bancard vPOS/upay) n'a aucune porte équivalente côté 04 (OQ-PAY-10/11 seulement). Une équipe lisant 04 construira le Paraguay « plus tard ». Correction : passer I18N-005/FIN-003 (interface/port) en P0-A et créer les lignes manquantes (es-PY, PYG, pénalités en PYG, port SIFEN, pièces PY), réécrire les passages « bascule » comme « choix du pays de lancement ».
- **F-03 — ADR-028 cité mais absent.** Cité par 08:695 (consolidé 17-C08-10), 17:1810, 17:2243, 17:2538 ; le tableau 8.1 (17:2209–2244) passe de ADR-027 à ADR-030 ; ADR-029 est rangé après ADR-035. L'ADR devrait porter la décision de change (deux montants, taux exact, `fx_position`, `conversion_group_id`). Correction : ajouter ADR-028 (ou renvoyer les 4 citations vers ADR-009/ADR-022) et remettre ADR-029 dans l'ordre.
- **F-04 — Formule de rétention de caution divergente (PAY-036).** CSV:632 et 16:3499 : `trip_max_preauth = validité_PSP − (pose + libération + 1 j)` ; 08:1301 : `H_requise = pose + durée + 72 h + marge 0 h`, forme en heures prévalente ; 17:2174 `marge_h` = 0. Numériquement, avec pose 1 j et libération 3 j, la formule de 04 donne 2 j à 7 j de validité (pas « ≈ 3 j ») et 0 à 5 j. Correction : réécrire PAY-036/PAY-011/README:114 en reprenant la forme en heures de 08 BR-PAY-06 et le vecteur T59 ; supprimer le « + 1 j ».
- **F-05 — Fiche PAY-011/012/036 (16:3499) auto-contradictoire.** « PAY-012 : libération automatique **sauf dommage, facture ou frais d'assistance dus** — divergence : une Claim **ne suspend pas** la libération (T57) » : la première moitié reprend l'ancienne description de 04 (« Libéré 80 h … sauf dommage », remplacée CSV:188) et contredit 08 BR-PAY-06 (jamais suspendue ; seules les factures de frais annexes de la liste fermée **émises avant l'échéance** retiennent). PAY-011 (CSV:187, 16:3499) : « toute retenue exige CLM-034 » sans préciser que la retenue est limitée aux frais annexes de la liste fermée (jamais un dommage). Correction : recopier la formulation de CSV:188 dans la fiche.
- **F-06 — 10b contredit ADR-025 dans le corps.** 10b:322 et 10b:530 : mode b « sous 2 h, sinon annulation automatique » ; ADR-025 : hold `AGENCY_LINK` libéré, aucun trip créé, TTL `agency_link_hold_minutes` PROPOSÉ 120 ; 10b:716 « mode b ≤ 2 h » (durée en dur, UXQ-09 ouverte). Les repères de 16 R1/R2 les donnent pour résolus à tort. Correction : remplacer par « hold libéré après `agency_link_hold_minutes` », message « liberando tu reserva ».
- **F-07 — Critères d'acceptation de BKG-014/CAL-011 sur l'ancien plan C1–C12.** CSV:150 (CA de BKG-014 : « tests C1–C12 de 17 §2.5 ; 100 requêtes → 1 hold »), 16:1044, 16:1070, 08:1192, 17:2028 (« RLS-1 à RLS-12 »), 17:2356/2360 ; 17 impose C1–C20 et RLS-1 à RLS-20 « sous les rôles de production » (17:355/2243/2381). Les tests C13–C20 (sécurité, FAKE C19, AGENCY_LINK C20) et RLS-13 à RLS-20 n'entrent donc dans aucune fiche d'acceptation de ligne 04. Correction : remplacer partout par « C1–C20, RLS-1–RLS-20, L0-01–L0-10 » ; ajouter RLS/L0 aux fiches ADM-033, BKG-014, PAY-041.
- **F-08 — README de 04 : comptes périmés, §7 en double.** README:44 (147), :50 (« Total : 658 »), :57 (P2 109), :93 (tableau 658/147/13/342/109/47), :32 (160 lignes P0), :148 (« E1 à E13 = 147 ») ; §7 « Contrôle automatique » : deux blocs identiques de sortie d'outil (README:237–309 et ~370–440) montrant 658 lignes, 147 P0-A, 76 Bêta, barème 5,9–14,0, 160/160, alors que `check_inventory.py` donne aujourd'hui 661, 149, 82, 6,2–14,8, 162/162, lots 11/48/65/24/1. README:61 est à jour : le fichier se contredit. Correction : coller la sortie actuelle une seule fois, mettre à jour §2 et §4.
- **F-09 — Estimation P0-A : pas d'énoncé retenu.** 18:197 reconnaît que 21–42 ne couvre pas la sûreté de 17 (+8 à +14, « non recalculé ») ; 18:234 écrit « ≈ 21–43 » ; 18:239 garde « P2 Paraguay pro-first ≈ 10–20 (non recalculé) » alors que le Paraguay est dans le build. La Bêta (16–28 semaines-équipe) est plus chère que l'intervalle bas du P0-A complet (21–42) : un lecteur peut citer 21–42 pour « tout le P0-A ». Correction : ajouter une ligne « P0-A complet retenu ≈ X–Y » (ou « non estimé ») et supprimer la ligne P2 Paraguay.

### MINEUR

- **F-10 — Tests RLS sans table d'identifiants** : RLS-1 à RLS-20 sont décrits dans un paragraphe (17:474), non dans un tableau comme C1–C20 (17:735–756) et L0-01–L0-10 (17:2391) : pas de colonne « résultat attendu » par test ; difficile à tracer. Proposer un tableau.
- **F-11 — T66–T68 non couverts par script** ; T04, T10, T21 jamais cités hors 08.
- **F-12 — UXQ-08** : aucun paramètre du registre 17 §7.2 ne choisit la branche (« revue avant le lien » / « paiement puis revue ») ; défaut non déclaré. Ajouter `flagged_booking_payment_order` avec défaut explicite (fail-closed).
- **F-13 — ACH Xpress sans qualification** : 08:1325, 11:524, 22:112 (voir section 5).
- **F-14 — Comptes périmés dans 16/17/18** : 16:5 (« T01–T65 », 08 va à T68), 16:11 (160), 16:49 (« Les 59 lignes MANUEL » ; 55), 16:50 (147), 16:54 (P2 109 ; 110), 17:154 (« 59 lignes ; 55 si les changements C-v3-01/02 sont acceptés » : déjà appliqués), 17:2012 (147), 18:22/53/96/234 (147), 18:300 (P2 109).
- **F-15 — Orphelins** : BR-FUEL-02/-03, BR-PROT-08, BR-RETURN-05, BR-TT-05 (citées nulle part hors 08) ; EC-05, 21, 22, 23, 25, 44 (EC-44 « conducteur mineur » et EC-05 devraient être liées à BKG-012/TRP-004, P0) ; EC-54 sans ID de BR ; OQ-PAY-09/14/16/20, OQ-ARCH-01/02 (OQ-ARCH-01 devrait être citée par L0-10) ; L0-02/03/04/08/09.
- **F-16 — Paramètres de 08 absents du registre 17 §7.2** : `delivery_share_pct`, `extras_share_pct`, `host_share_pct` (08:249 et paramètres), contrôlé par script.
- **F-17 — Catalogue** : voir section 4 (3 points).
- **F-18 — `graceMinutes` unique (08:1080) contre deux paramètres (16 R10, 17:2127/2191)** ; renommer côté 08.
- **F-19 — Collision de notation « S »** : écrans S01–S17 (10b), semaines S0…S42 des lots (18:289–291 « S3,5–S7 », « S20–S40 », « S21–S42 »), indicateurs de succès S1–S4 (18 §1.1, 17:2381). Dans 18, « Fin (S) » n'est pas recalculée (aveu 18:295/370).
- **F-20 — Portes juridiques** : 22:78, 22:111, 18:133–134 (colonnes « Bloque ») gardent le sens v2 (avant lot) ; la lecture v4 est portée par une note en tête (18:128, 22:174). Réécrire les cellules.
- **F-21 — ADR-035 (17:2243) rangé entre ADR-030 et ADR-029.**
- **F-22 — Fiche PAY-001 (16:1673)** : aucun critère « aucun FAKE en production / C19 » (présent seulement dans 16:72 et dans la rubrique Bêta de PAY-041, 16:1911).
- **F-23 — Frais jeune conducteur** : présent dans la formule de remboursement (08:26/90/126/301) et dans l'enum de 17:1037 alors que PRC-014 est P1 ; préciser « = 0 en P0 ».
- **F-24 — « 80 h »** à étiqueter « valeur Turo, non reprise » dans CSV:279, 16:3894, 08:2415 (NOTIF-20), 10b:166, 11:597.
- Autres : 16:72 sans la définition de « semaine-équipe » ; 22 UXQ-09 (22:127) garde « délai de confirmation agence 2 h » dans l'énoncé de la question (historique assumé) ; noms de paramètres de la dernière minute (3 variantes) ; 08:2124 « Stripe indisponible » pour les versements.

## 7. Développeur encore bloqué ou confus — top 20 et correction proposée

| # | Où | Blocage / confusion | Correction proposée |
|---|---|---|---|
| 1 | 18:289–292 ; CSV:615/641 | Quand livrer les connecteurs réels (PSP, PAC/SIFEN, KYC) et comment les compter dans les lots | Dédoubler chaque ligne (port + FAKE / connecteur réel) et créer un lot « C » dans 04 (F-01) |
| 2 | CSV:565, CSV:546, CSV:229 ; 16:57/79 ; 18:106/239/300 | Le Paraguay est « P2/bascule » dans l'inventaire alors que le build est bi-pays | Promouvoir/créer les lignes P0 Paraguay ; réécrire « bascule » (F-02) |
| 3 | CSV:150 ; 16:1044/1070 | Critères d'acceptation de BKG-014 sur C1–C12 : C13–C20 et RLS-13–20 jamais exigés | Remplacer par C1–C20, RLS-1–20, L0-01–10 (F-07) |
| 4 | 17:2209–2244 | ADR-028 introuvable (4 renvois) | Ajouter l'ADR ou re-router les renvois (F-03) |
| 5 | CSV:632 ; 16:3499 | Deux formules de caution (+1 j de marge ou non) | Ne garder que la forme en heures de 08:1301 (F-04) |
| 6 | 16:3499 | PAY-012 : « sauf dommage » contre « Claim ne suspend pas » | Recopier CSV:188 (F-05) |
| 7 | 10b:322/530/716 | Mode b « annulation automatique à 2 h » contre hold libéré à TTL paramétré | Aligner sur ADR-025 (F-06) |
| 8 | README 04 §2/§7 | Comptes et sortie d'outil périmés, doublon | Régénérer une fois (F-08) |
| 9 | 18:197/234/239 | Pas de chiffre pour le P0-A complet avec sûreté et deux pays | Ajouter l'énoncé ou « non estimé » (F-09) |
| 10 | 17:474 | Tests RLS-1 à 20 en prose, sans attendu individuel | Tableau RLS comme pour C1–C20 (F-10) |
| 11 | 17 §7.2 | Pas de paramètre pour la branche UXQ-08 | Ajouter la clé et son défaut fail-closed (F-12) |
| 12 | 18:289 vs 18:128 | Le lot 2 s'intitule « (Panama) » et la Bêta « Panamá City » (16:49, 18:51/96) alors que le pays est à choisir | Renommer « pays de lancement » |
| 13 | 18:295, 18:289–291 | « Fin (S) » non recalculée (S20–S40, S21–S42) ; collision avec écrans S01–S17 et KPI S1–S4 | Retirer la colonne ou la recalculer ; renommer les semaines « W » (F-19) |
| 14 | 08:1080 vs 17:2127/2191 | Une constante ou deux (`grace_minutes`, `overdue_detection_minutes`) | Aligner 08 sur 16 R10 (F-18) |
| 15 | 08:1325 ; 11:524 | Remboursement Yappy « par ACH Xpress » sans dire que P0-A = virement par l'agence | Ajouter « P0-B seulement » (F-13) |
| 16 | CSV:641 ; 22 (PY) | Porte PSP définie pour Tilopay/Panama seulement ; Paraguay : aucune porte par ligne 04 | Généraliser PAY-041 « PSP du pays retenu » (liens OQ-PAY-10/11) |
| 17 | 16:5 ; 16:49/50/54/11 ; 18:22/53/96/300 | Comptes P0-A/P2/T/MANUEL périmés | Mise à jour mécanique (F-14) ; ajouter un contrôle de chiffres au script `check_prd_structure` |
| 18 | CSV:631/659 ; 22:137 | OQ-CAT-01 (g) déjà tranchée par 17:1011 ; `catalog.vehicle` (SRC:3) | Dire dans OQ-CAT-01 que (g) est « décidée : non publiable » ou retirer (g) |
| 19 | 16:1673 (PAY-001) | Aucun critère « pas de FAKE en production » | Ajouter le critère (C19) (F-22) |
| 20 | 08 (T66–T68), 17 §11 | T66–T68 sans script de contrôle ; L0-02/03/04/08/09 sans lien avec une ligne 04 | Étendre `check_verif12_fixes.py` ; lier chaque L0 à ADM-033/BKG-014/PAY-041 (F-11, F-15) |

## 8. Ce qui a été vérifié et n'a pas posé de problème

Identifiants (BR/EC/SM/OQ/UXQ/DEC/TA/L0 définis ; ADR hors ADR-028 ; features), TTL des holds, fenêtres d'annulation, défauts fail-closed des paramètres ouverts, règles d'arrondi, taux de taxe en paramètres, rétention ≥ 15 mois, comptes Bêta 18/64/55/12 = 82 (aux endroits à jour), énoncé Bêta 16–28 / 4–7 mois, cohérence du catalogue véhicules, garde `FAKE` en production, non-tranchage de DEC-FONDATEUR-01, OQ-BR-04, OQ-BR-45, UXQ.
Non vérifié : comptes de tables de 17 §10 (pas de source recomptable), exécution PostgreSQL (hors périmètre), cohérence de 09b/12/13 (hors liste).
