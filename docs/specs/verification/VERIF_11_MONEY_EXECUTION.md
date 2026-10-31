# VERIF_11 — Audit indépendant de l'exécution monétaire de 08_BUSINESS_RULES.md (2026-10-30)

Périmètre audité : BR-CXL (table de décision, `computeCancellationSettlement`, `computeTerminationSettlement` et fonctions d'aide), section « Exécution monétaire du règlement » E1–E6, SM-1 (`START_WINDOW_EXPIRED`), SM-6/6b/8, BR-PAY-06 (caution), BR-PAY-09 bis (REQ-PAY-DMG-01..11), BR-PAY-11, vecteurs T01–T48. Aucun fichier revu n'a été modifié.

## 1. Méthode et indépendance

1. **Implémentation écrite d'abord, à partir du seul texte de 08** : `tools/verif11_settlement.py` (entiers en unités mineures, `Fraction`, aucun flottant ; règlement, fin anticipée, exécution E1, répartition par moyen E2, `hostPayable`, grand livre simplifié, fuzz). Lancée avec `python -I`.
2. **Résultats enregistrés avant toute lecture des scripts existants** : 48 / 48 vecteurs identiques (T01–T27, T30, T31, T35, T37–T48 par le moteur de règlement ; T28, T29, T32 par l'exécution E1 ; T33, T34 par la répartition E2 ; T36 par le delta de versions). Fuzz de 20 000 cas : voir §4.
3. **Ensuite seulement**, ouverture de `tools/independent_settlement_check.py` et `tools/verify_cxl_tests.py` pour comparaison (§6).

## 2. Résultat des vecteurs

| Bloc | Vecteurs | Résultat |
|---|---|---|
| Règlement (remb. TTC, taxes remboursées, gains hôte, net plateforme, pénalité) | T01–T27, T30, T31, T35, T37–T48 (42 vecteurs) | 42 / 42 conformes |
| Exécution E1 (capture partielle / void, dette, hôte payable) | T28, T29, T32 | 3 / 3 conformes |
| Répartition par moyen E2 | T33, T34 | 2 / 2 conformes |
| Requalification (delta) | T36 | 1 / 1 conforme |
| **Total** | **48** | **48 / 48, 0 écart** |

Les lacunes ne sont donc pas dans l'arithmétique des vecteurs, mais dans les **cas que les vecteurs ne couvrent pas** (§5, §7).

## 3. Recalcul à la main (arithmétique détaillée, vecteurs nouveaux T28–T48)

Convention : montants en unités mineures entre crochets quand utile. Chaque ligne a été refaite sans reprendre le « Détail » de 08, puis comparée au script.

| # | Calcul | Résultat | Écart avec 08 |
|---|---|---|---|
| **T28** (autorisation non capturée) | Règlement = T03 : remb. HT 181,00 + taxe 6,44 = 187,44 ; `owed` = 256,66 − 187,44 = **69,22** ; encaissé 0 ⇒ `need` = 69,22 ; capture partielle 69,22, void = 256,66 − 69,22 = 187,44 ; fonds remboursés 0 ; hôte payable = ⌊4 500 × 6 922 / 6 922⌋ = 4 500 | conforme | aucun |
| **T32** (dette partielle) | ⌊4 500 × min(3 000 ; 6 922) / 6 922⌋ = ⌊1 950,30⌋ = 1 950 ; en attente 4 500 − 1 950 = 2 550 ; dette 6 922 − 3 000 = 3 922 | 19,50 / 25,50 / 39,22 | aucun |
| **T30** (segment E, 30 j) | P retenu 1 200 / 30 = 40,00 ; F 120 / 30 = 4,00 ; remb. HT 1 320 − 44 = 1 276 ; taxe 92,40 × 1 276 / 1 320 = 89,32 ; remb. 1 365,32 ; équilibre 1 365,32 + 44,00 + (92,40 − 89,32 = 3,08) = 1 412,40 ; hôte 0,75 × 40 = 30,00 ; net 44 − 30 = 14,00 | conforme | aucun |
| **T33** (4 moyens) | K = 256,66 − 187,44 = 69,22 ; promo 20,00 (reste 49,22) → crédit cash 30,00 (reste 19,22) → Yappy 19,22 ; Yappy remboursé 56,66 − 19,22 = 37,44 ; carte 150,00 ; total 187,44 | conforme | voir M3 (définition de « fonds ») |
| **T35** (promo plateforme) | promo retenue ⌊−2 000 / 3 + ½⌋ = ⌊−666,17⌋ = −667 ; retenu HT 4 000 − 667 + 600 + 2 000 = 5 933 ; remb. P 8 000, promo −1 333, F 1 200 ⇒ base taxable remb. 7 867 sur 11 800 ; taxe 826 × 7 867 / 11 800 = 550,69 → 551 ; remb. HT 22 700 − 5 933 = 16 767 + 551 = 17 318 ; hôte ⌊0,75 × 4 000⌋ + 1 500 = 4 500 ; net 5 933 − 4 500 = 1 433 | conforme | aucun |
| **T36** (delta v2 − v1) | v1 (T08) : 256,66 / 9,66 / 0 / 0 / 50 ; v2 (T07) : 138,22 / 3,22 / 75,00 / 37,00 / 0 ; delta −118,44 / −6,44 / +75,00 / +37,00 / −50 | conforme | aucun |
| **T37** (fin anticipée) | used = max(1 ; ⌈(1 200 − 29) / 1 440⌉ = 1) = 1 ; rem = 2 ; remb. P 80,00 + F 12,00 + protection 20,00 + assistance 6,00 + cond. add. 10,00 = 128,00 ; taxe 9,66 × 92 / 138 = 6,44 ; total 134,44 ; retenu 119,00 (P 40, F 6, prot. 10, extras 15, assist. 3, cond. 5, livraison 40) ; hôte 30,00 + 30,00 (livraison 40 × ¾) + 11,25 = 71,25 | conforme | aucun |
| **T40** (égalité exacte allocHost) | P 1 000 002 / 3 = 333 334 (exact) ; 333 334 × ¾ = 250 000,5 : frac = ½ exactement ⇒ **floor** ⇒ 250 000 (le résidu 0,5 va à la plateforme) ; + 25 000 × ¾ = 18 750 ⇒ 268 750 ; F 41 833,33 → 41 833 ; D 25 000 ; retenu 400 167 ; base taxable remb. 666 668 + 83 667 = 750 335 sur 1 125 502 ; taxe 112 550 × 750 335 / 1 125 502 = 75 033,37 → 75 033 ; remb. 925 335 + 75 033 = 1 000 368 ; équilibre 1 000 368 + 400 167 + 37 517 = 1 438 052 ; net 400 167 − 268 750 = 131 417 | conforme | aucun (deux conventions d'arrondi coexistent : demi vers le haut partout, mais égalité vers la plateforme pour la part hôte ; documenté) |
| **T41** (PYG, no-show) | P 2 000 000 / 3 → 666 667 ; F 251 000 / 3 → 83 667 ; D 25 000 ; retenu 775 334 ; remb. HT 333 333 + 41 833 + 150 000 + 25 000 = 550 166 ; taxe 112 550 × 375 166 / 1 125 500 = 37 516,6 → 37 517 ; remb. 587 683 ; équilibre 587 683 + 775 334 + 75 033 = 1 438 050 ; hôte 0,75 × 666 667 = 500 000,25 → 500 000 + 18 750 = 518 750 ; net 256 584 | conforme | aucun |
| **T42** (centimes impairs, 1 jour) | P 45,01 × ¾ = 33,7575 → 33,76 ; F 5,0625 → 5,06 ; D 7,505 → 7,51 ; retenu 46,33 ; remb. HT 11,25 + 1,69 + 12,00 + 7,50 = 32,44 ; taxe 362 × 1 294 / 5 176 = 90,5 → 91 ; remb. 33,35 ; hôte 0,75 × 33,76 = 25,32 + ⌈563,25 → 563⌉ = 5,63 = 30,95 ; net 46,33 − 30,95 = 15,38 | conforme | aucun |
| **T43** (taxe par ligne ≠ agrégée) | taxe par ligne 70 + 70 = 140 (agrégée 141) ; retenu P 1 005 × ½ / 2 = 251,25 → 251, F idem ⇒ 502 ; remb. HT 1 508 ; taxe 140 × 1 508 / 2 010 = 105,03 → 105 ; remb. 1 613 ; hôte 0,75 × 251 = 188,25 → 188 ; net 314 | conforme | aucun |
| **T44** (deux groupes fiscaux) | taxe payée 8,40 + 1,80 + 4,00 = 14,20 ; groupe 7 % (P) : 840 × 80 / 120 = 560 ; groupe 10 % (F + D) : 580 × (12 + 20) / (18 + 40) = 320 ; taxe remb. 880 ; remb. HT 181,00 + 8,80 = 189,80 ; taxe retenue 14,20 − 8,80 = 5,40 ; équilibre 189,80 + 66,00 + 5,40 = 261,20 | conforme | aucun |
| **T38** (NR, no-show auto, hôte inéligible) | cond. add. approuvé ⇒ remb. 0 ; retenu HT 224,00 ; hostMessageTraced faux ⇒ hôte 0 ; net 224,00 | conforme | décision produit non listée (m9) |
| **T47** (rien encaissé) | FULL ⇒ owed = 256,66 − 256,66 = 0 ; encaissé 0 ⇒ ni capture, ni remboursement, ni dette | conforme | `hostPayable` : division par `owed` = 0 non gardée (m2) |
| **T48** (PYG, HOST_CANCELLED à T−30 h) | FULL ⇒ 1 438 050 ; 30 h > 24 h ⇒ pénalité 200 000 PYG (devise isolée) | conforme | aucun |


## 4. Invariants

| Invariant | Méthode | Résultat |
|---|---|---|
| `remboursement + retenu HT + taxe retenue = total` | assertion dans `settle` sur 48 vecteurs + 20 000 cas aléatoires (promos plateforme et hôte, 1 ou 2 groupes fiscaux, USD/PYG, parts 70 % / 75 %, NR, fins anticipées) | **tenu**, 0 violation |
| `remboursement ≤ encaissé` (E1, `cashRefund ≤ collected`) | 4 niveaux d'encaissement par cas (0, ⅓ owed, owed, total) | **tenu** |
| `remboursement ≤ total payé` ; taxes ≥ 0 ; lignes de remboursement ≥ 0 (hors promos) | fuzz | **tenu** |
| `hostPayable ≤ hostEarnings` ; `hostFromGuest ≥ 0` | fuzz | **4 + 2 violations**, toutes avec `promoHost` aléatoire non plafonné (jusqu'à 3 000 pour un P de 500). BR-PRICE-16 plafonne le code hôte à 15 % : cas **non réaliste**, noté MINEUR m11 (aucun plancher n'est écrit dans `settle`) |
| Grand livre en partie double équilibré par version | écritures de 08 (capture, règlement, remboursement, pénalité) recréées dans le script ; T03 reproduit l'exemple de 08 ; T36 : capture + v1 + exécution + contre-passation v1 + v2 | **équilibré** (somme 0), `guest_funds_held` soldé à chaque version ; après T36, `refund_payable` = 118,44 au débit (= −118,44 de 08), `host_payable` = 75,00 au crédit. **Réserve** : équilibre vrai par construction ; 08 ne spécifie pas les écritures des moyens crédit/promo, de la reprise chargeback, ni le signe d'une commission négative (m8) |
| 2e exécution avec la même clé d'idempotence ⇒ aucun mouvement | (a) `settle` est pure : 2 calculs identiques ; (b) `execute` rejoué sur l'état mis à jour : remboursement 0, débit 0 | **tenu pour la fonction pure** ; **non démontré** pour le cas « remboursement encore en vol » (M1) |
| Requalification ⇒ delta seul | T36 : delta ligne à ligne ; contre-passation + nouvelle version, aucune modification | **tenu** sur le calcul ; l'exécution du delta quand v1 n'est pas encore exécutée n'est pas définie (M1) |

## 5. Constats

### MAJEUR

**M1 — Remboursements « en vol » non comptés : risque de double remboursement lors d'un rejeu ou d'une requalification (E1, E4, SM-8).**
`collected` soustrait les `REFUND` « **exécutés** ». Or SM-8 comporte des états non finaux (`PLANNED`, `SUBMITTED`, `SENT`, `PENDING_CUSTOMER_CHOICE`, `BLOCKED_CHARGEBACK`). Tant que le remboursement de la version n n'est pas `CONFIRMED`, `cashRefund = collected − owed` recalculé (rejeu, ou version n+1) redonne un second remboursement ; seule la clé `idem` protège, et sa composante « séquence » n'est pas définie (par tentative ? par moyen ? si elle s'incrémente à chaque rejeu, la protection disparaît ; si elle est fixe, une nouvelle tentative après `FAILED` est refusée par le PSP). Exemple : T36 avec le remboursement v1 (256,66) en `PENDING_CUSTOMER_CHOICE` ; v2 recalculé par `collected − owed` donnerait encore 138,22 de remboursement, soit 394,88 sur 256,66 encaissés. E4 prescrit le delta (bon), E1 prescrit `collected − owed` (mauvais dans ce cas) : les deux règles se contredisent selon l'état du remboursement. SM-8 n'a pas non plus de transition `PLANNED/PENDING_* → CANCELLED` quand une version n+1 remplace la version n.
Correction : `committed(segment)` = captures + MIT − remboursements dans tout état sauf `FAILED` / `CANCELLED` ; définir `séquence` (index d'instance SM-8, pas compteur de rejeu) ; ajouter la transition de supersession.

**M2 — Reprise sur gains hôte après chargeback perdu non plafonnée (E5, SM-6b).**
`floor(hostFromGuest × montant perdu / owed)` n'est pas borné par `hostFromGuest`. Un chargeback portant sur le montant capturé d'origine alors qu'un remboursement a déjà été émis (cas classique) donne `montant perdu` = total. T03 : `owed` = 69,22, `hostFromGuest` = 45,00, perte 256,66 ⇒ reprise ⌊4 500 × 25 666 / 6 922⌋ = **16 685 (166,85)** contre 45,00 gagnés. En outre `montant perdu` n'a pas de devise définie (devise débitée ou devise du trip ; dLocal débite en USD un trip en PYG) : le quotient mélangerait les devises.
Correction : `min(perdu_converti_en_devise_trip, owed)` et plafond `hostFromGuest` ; préciser la devise.

**M3 — « Encaissé » et « remboursement en fonds » mal définis face aux crédits (E1 vs E2, T33/T34).**
`collected` = captures + débits MIT, sans dire si les crédits (promo, cash) en font partie. Si non : T33 donne `cashRefund` = 206,66 − 69,22 = 137,44, alors que E2 rembourse 187,44 sur les rails externes. Si oui : T34 « remboursement en fonds » = 256,66, alors que 50,00 sont réémis en crédit (donc 206,66 en fonds). L'invariant « Σ remboursements par moyen = remboursement en fonds » est faux dans T34 tel que rédigé. L'ordre E2 (crédits absorbent d'abord la retenue) fait que le remboursement externe peut dépasser `collected_externe − owed` : l'invariant `cashRefund ≤ collected` n'est vrai que si les crédits sont des « encaissements ». Les vérifications d'implémentation divergeront.
Correction : définir `collected_total` (crédits inclus, `kind = CREDIT_REDEMPTION`) et `externalRefund` ; réécrire l'invariant par moyen (`refund[tender] ≤ paid[tender]`, promo jamais en fonds — **cet invariant, lui, est tenu** par l'ordre E2 : vérifié, chaque moyen reçoit `payé − absorbé ≥ 0`).

**M4 — Finalité de la caution contradictoire (BR-PAY-06 vs REQ-PAY-DMG-02/04, BR-DAMAGE-05).**
BR-PAY-06 suspend la libération tant qu'une `Claim` est ouverte, parle d'« imputation » et exige une preuve photo « pour toute retenue » ; REQ-PAY-DMG-02 interdit au contraire toute capture de dommage sur la pré-autorisation, laquelle « ne couvre que le loyer estimé et les frais prévisibles ». À `release_at` = fin + 72 h, la caution est libérée alors que la notification de dommage peut arriver jusqu'à J+10 et le débit jusqu'à J+30/90. Résultat : un blocage de fonds du guest (donc coût et exposition ACODECO) dont la plateforme ne peut se servir pour rien d'autre que « frais prévisibles » non définis. Il faut trancher : (a) caution = garantie réelle utilisable (alors DMG-02 est faux et la libération doit attendre le délai de notification), ou (b) caution = simple preuve de solvabilité (alors supprimer « imputation » et la suspension par Claim).

### MINEUR

- **m1 — Unité de `HOST_PENALTY[USD]`** : « 25 / 50 / 150 / 50 » sans dire dollars ou cents ; les vecteurs (T08 : 50 ; T48 : 200 000 PYG) sont en unités majeures alors que « Money = entier en unités mineures » ; un implémenteur peut débiter 50 cents. À écrire en unités mineures (5 000).
- **m2 — Division par zéro** dans `hostPayable` quand `owed` = 0 (T47, tout règlement FULL) : la formule `… / owed` n'a pas de garde ; seule `hostCompensation` doit alors être payable.
- **m3 — Compensation plateforme (DEC-FONDATEUR-01)** : bien présentée comme **ouverte** (en-tête ligne 9, table des options A/B, T17/T18/T20 marqués, OQ-BR-41, ligne 2709). Mais `compensation()` ne retourne 0 que si le paramètre vaut `NONE` : sans valeur configurée, le comportement par défaut est « la plateforme paie » (fail-open). Spécifier un défaut (`NONE` jusqu'à décision) et réconcilier les noms (options A/B ↔ `TURO_MODEL`/`NONE`). `PSP_FAILURE` versant une compensation pour une réservation jamais encaissée est un cas à nommer.
- **m4 — Entrées implicites dans les vecteurs** : T09, T41, T42 (no-show déclaré par l'hôte) ne disent pas que le message de l'hôte est tracé ; le résultat n'est correct que sous cette hypothèse (T38/T39 montrent le cas contraire).
- **m5 — Caution, détails de la règle `trip_days + 4 ≤ V`** : (i) la forme « en jours » est une approximation de `H_requise ≤ V` : trip de 3 j + 25 min (facturé 3 j, grâce 29 min) ⇒ H = 24 + 72 h 25 + 72 = 168 h 25 > 168 h alors que 3 + 4 ≤ 7 ; 08 doit dire que la forme en heures prévaut ; (ii) `marge = 0 h` laisse zéro tolérance à un retour tardif (la libération se décale, l'autorisation non) ; (iii) `deposit_charge_cap[pays]` n'a pas de valeur par défaut « inconnu ⇒ 0 » alors que le principe est posé pour `provider_max_hold` ; (iv) « Visa sans accord ⇒ débit au plus tôt vers J+30 » est en réalité le **pire cas** (notification à J+10), le plus tôt est date de notification + 20 j. Avec `V` inconnu = 0 : `H_requise ≤ 0` est faux pour tout trip ⇒ le repli (a)→(b)→(c) est atteint, et (c) comptoir/carte de crédit est toujours disponible : **comportement sûr, vérifié**.
- **m6 — Capacités PSP manquantes** : T28 suppose capture partielle + void ; E3 ne liste que `supports_partial_refund`. Ajouter `supports_partial_capture` et `supports_void` (défaut « non »), sinon T28 n'est pas exécutable chez un PSP sans capture partielle (repli : MIT ?).
- **m7 — Rétention des preuves DMG-11** : « ≥ 12 mois » sans point de départ ; la fenêtre vPOS court depuis la **date du débit** (jusqu'à 90 jours après le retour), donc ≥ 15 mois après le trip.
- **m8 — Grand livre incomplet** : pas d'écritures pour `credit_promo_liability` / `credit_cash_liability` (consommés par E2), `promo_expense` (T35 : commission plateforme 8,33 = 59,33 − 45,00 − 6,00, avec une promo de −6,67 retenue ; signe/compte non indiqué), reprise chargeback (M2), frais PSP, `fx_difference`. Écritures à montant négatif non interdites.
- **m9 — Équité/ACODECO non listée comme décision** : T38 (224,00) et T39 (112,00) laissent à la plateforme toute la retenue quand l'hôte n'a pas tracé son message ; défendable, mais c'est un enrichissement de la plateforme à valider (OQ à ouvrir).
- **m10 — Fin anticipée** : `trip.start` doit être le début du **segment** (non précisé ; avec le début du trip entier `used` = `days`, aucun remboursement) ; un minimum d'un jour est facturé même pour une panne à +5 min (choix produit à confirmer) ; l'assistance renforcée est remboursée au prorata alors qu'elle a pu servir (T37). Dépendance non signalée : si OQ-BR-04 est tranchée par `billingBoundaryMinutes` = 120, la formule `used` de `computeTerminationSettlement` (qui utilise `graceMinutes`) doit changer.
- **m11 — Pas de plancher sur `hostFromGuest`** (voir §4) ; à ajouter pour le jour où le plafond de 15 % du code hôte (OQ-BR-10) changerait.
- **m12 — SM-8** : `BLOCKED_CHARGEBACK` n'est atteignable que depuis `PLANNED`, pas depuis `SUBMITTED` / `PENDING_*` ; `PENDING_CUSTOMER_CHOICE` sans échéance (OQ-BR-44, déclaré ouvert).
- **m13 — Code promo à usage unique** lors d'un remboursement intégral : non dit s'il est restitué (le crédit promo l'est, T34).
- **m14 — Scripts de contrôle** : voir §6.

Aucun constat CRITIQUE : les formules de règlement sont exactes sur les 48 vecteurs et sur 20 000 cas, et aucune situation de perte d'argent sans mécanisme de rattrapage n'a été trouvée hors M1/M2 (qui sont MAJEUR car conditionnés à un rejeu ou à un chargeback atypique).

## 6. Comparaison avec les scripts existants (après coup)

`tools/independent_settlement_check.py` (466 lignes) donne les mêmes 48 résultats (0 écart rejoué). Comportements qu'il encode et que 08 **ne dit pas** ou dit autrement :
1. Éligibilité hôte : `host_msg_traced` vaut **True par défaut** (T05/T06/T09/T41/T42 passent sans donnée de message) ; la fenêtre `noShowAt ≤ déclaration ≤ start + 72 h` de `hostEligible` n'est pas testée ; le sous-motif (`NO_SHOW_SUBREASONS`) n'est pas testé, seule la preuve l'est ; la règle 3 (`REJECTED_TOO_EARLY`) est absente.
2. Une seule part (`share`) pour P, D et Extras (08 a trois paramètres figés distincts).
3. `cash()` : si l'autorisation couvre une partie du besoin, il débite la totalité en MIT (« capture = need ») ; 08 ne dit pas si la capture partielle et le MIT se cumulent.
4. Pas de grand livre, d'idempotence, de reprise chargeback, de SM-8, de caution ni de REQ-PAY-DMG : **aucun script ne teste ces règles** (le « 48/48 identiques » de 08 ne couvre que le calcul et E1/E2 partiels).
5. Pénalités en unités majeures (comme m1).
6. Fuzz : exclut la promo plateforme de la vérification « part hôte ≤ retenu » (justifié), `evidence=True` toujours.
7. « Assertés en CI » (08, notes d'implémentation) : il n'existe aucun dépôt de code ni CI (cf. m10 de VERIF_09).

`tools/verify_cxl_tests.py` (34 lignes) : confirmé non assertif, sans promos, sans taxe par ligne, sans éligibilité ; il affiche des tuples. 08 le déclare déjà inutilisable ; il devrait être supprimé du dépôt ou transformé en assertions pour éviter une réutilisation.

## 7. Sondes demandées

| Sonde | Résultat |
|---|---|
| Promo jamais convertie en cash | **Tenu** : chaque moyen reçoit `payé − absorbé`, donc le crédit promo ne dépasse jamais sa valeur et n'est réémis qu'en crédit (T34 : 20,00 réémis, échéance ≥ +30 j). Réserve : E1 ne le formule pas dans les mêmes termes (M3) |
| Crédit voyage vs promo : ordre | Promo → cash → externes non natifs → natifs, plus récent d'abord ; T33/T34 conformes. Effet à connaître : les crédits absorbent la retenue d'abord, le guest récupère plus de fonds mais perd son crédit (choix assumé, alternative prorata écartée) |
| Versement puis chargeback | Chemin de recouvrement **existe** (SM-6b : compensation sur gains futurs, débit direct à 30 j, échéancier, recouvrement, passage en perte) ; reprise bornée à la fenêtre `chargeback_window_days` (défaut 180, Bancard vPOS 365). Défaut : formule non plafonnée (M2) |
| Caution avec `provider_max_hold` inconnu (= 0) | Repli (a)→(b)→(c) atteint, comptoir toujours possible ; sûr. Défauts mineurs m5 |
| Isolation USD / PYG | `host_ledger` par hôte **et** devise, pénalités par devise, crédits non convertibles, remboursement dans la devise débitée. Aucune fuite trouvée dans les vecteurs T27, T40, T41, T48. Point à fixer : devise de `montant perdu` (M2) |
| Restes d'arrondi | `allocHost` : écart ≤ ½ par ligne, ≤ 1,5 par règlement, le reste va toujours à la plateforme ; la retenue étant `trip − remboursement`, aucun centime perdu (équilibre exact vérifié 20 000 fois) ; `hostPayable` en `floor` : à pleine encaisse = `hostFromGuest` exact, aucun résidu bloqué. Conversion par moyen : « dernier remboursement plafonné à son résidu » suffit |

## 8. Décisions fondateur

- **DEC-FONDATEUR-01** (compensation hôte payée par la plateforme) : **présentée comme ouverte** et non implémentée silencieusement (options A/B chiffrées, paramètre, vecteurs étiquetés) ; réserve sur le défaut du paramètre (m3).
- **OQ-BR-04** (jours facturés / retard vs extension) : **présentée comme ouverte** (BR-BOOK-03, BR-RETURN-03, OQ-BR-04), « non appliquée aux vecteurs » ; la formule en vigueur (`graceMinutes` = 29) est celle du statu quo ; dépendance cachée dans `used` (m10).

## 9. Verdict

**À corriger** pour la couche d'exécution. Le moteur de règlement (décision, retenues, taxes, arrondis, devises, fin anticipée) est **implémentable tel quel** : 48 / 48 vecteurs et 20 000 cas sans violation d'invariant monétaire. Avant d'écrire l'exécution : fermer M1 (remboursements en vol, clé d'idempotence, supersession SM-8), M2 (plafond de la reprise et devise), M3 (définition de `collected` face aux crédits) et M4 (finalité de la caution), puis les MINEUR m1, m2, m3 qui produisent des erreurs de code immédiates.
