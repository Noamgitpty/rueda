# VERIF_15 — Audit indépendant du PRD (16_PRODUCT_REQUIREMENTS_DOCUMENT.md)

Date : 2026-10-30. Auditeur : agent indépendant (produit + QA). Fichier audité : `16_PRODUCT_REQUIREMENTS_DOCUMENT.md` (397 978 octets, 4 310 lignes). Sources de vérité : 04 (CSV + README), 08, 09b, 10b v2, 11, 17 (en cours de correction : écarts de nommage seulement), 18, 22. Aucun fichier audité n'a été modifié. Scripts écrits pour cet audit (aucun script de l'auteur n'a été lu ; l'auteur n'a d'ailleurs pas versionné le sien, voir F10) : `tools/verif15_struct.py`, `tools/verif15_ta.py`, `tools/verif15_conf.py`.

## 1. Verdict

**ACCEPTABLE AVEC RÉSERVES — 0 CRITIQUE, 4 MAJEUR, 10 MINEUR.**
Le PRD est structurellement irréprochable (160/160 lignes P0, 127 fiches × 24 rubriques dans l'ordre, 498/498 lignes P1–P3, aucun identifiant inventé) et ses vecteurs TA01–TA09 sont exacts. Les réserves portent sur (a) la conception de la concurrence hold → trip, incomplète dans BKG-014 (risque de reproduire en code le défaut CRITIQUE de VERIF_14), (b) l'absence totale de reprise de 10b v2 (écrans, libellés, changements §7), (c) un trou monétaire P0-A (agence inéligible à la retenue), (d) un critère d'acceptation de paiement appuyé sur la mauvaise configuration. Les contraintes P0-A (aucune détention de fonds, remboursements exécutés par l'agence, mandat LEG-027) et les décisions fondateur ouvertes sont respectées.

## 2. Contrôles structurels (Python `-I`)

| Contrôle | Résultat |
|---|---|
| Lignes 04 : 658 = P0-A 147 + P0-B 13 + P1 342 + P2 109 + P3 47 | OK |
| `feature_id` P0 (160) présents dans une rubrique FEATURE ID | 160/160 ; manquants 0 ; doublons 0 ; hors P0 0 (I18N-003/004 ne sont détectés qu'avec un regex acceptant des chiffres dans le préfixe) |
| Fiches | 127 ; 24 rubriques exactement, dans l'ordre imposé : 127/127 |
| Comptes par epic vs titres E1–E15 | 16/15/9/13/9/12/13/12/6/8/5/18/11/8/5 : tous égaux aux titres |
| Critères d'acceptation : Given/When/Then équilibrés (≥ 1 de chaque, mêmes nombres) | 127/127 |
| Priorité produit / lot de la fiche = `phase_mvp` / `lot_p0a` de 04 | 0 écart |
| Bêta pilote de la fiche = `beta_pilote` de 04 (fiches simples et regroupées) | 0 écart ; répartition 18 OUI / 58 SIMPLIFIÉ / 59 MANUEL / 12 DIFFÉRÉ = A.3 |
| Procédures MANUEL/SIMPLIFIÉ décrites (≥ 40 caractères) | toutes |
| Statut de preuve Turo (`turo_statut_preuve` de 04) vs rubrique Confiance | 160/160 cohérents (OBSERVÉ→confirmé 30, DOCUMENTÉ→documenté 59, INFÉRÉ→inféré 8, PROPOSÉ→proposé 63) |
| BR cités (131 distincts) existent dans 08 | 0 inconnu |
| SM (8), EC (32), T (47 distincts), OQ (48), TA (9) existent dans leur source | 0 inconnu |
| `feature_id` cités dans le texte existent dans 04 | 0 inconnu |
| Partie C : 498 lignes P1–P3 (342/109/47) | 498/498, 0 doublon, 0 en trop |
| D.1 : 160 lignes ; D.2 : 58 lignes | cohérent avec le total annoncé ; une erreur d'attribution (F8) |

## 3. Recalcul indépendant TA01–TA09 (`tools/verif15_ta.py`, entiers, Fractions, `roundHalfUp`)

Écrit à partir du texte de A.8.1, puis comparé à 08 (BR-CXL-01/06/08/13, T14/T15, T43). **Tous identiques** : TA01 128,40 / 0 / 0 ; TA02 retenu 40,00, remb. 85,60 (taxe 5,60), conservé TTC 42,80, commission 4,80, équilibre 128,40 ; TA03 80,00 / 42,80 (2,80) / 9,60 ; TA04 128,40 et bornes (30 h → gt24h ; 24 h exactement → le24h, aligné sur 08 T14/T15) ; TA05 20,00 / 64,20 (4,20) / 2,40 ; TA06 total 48,16, retenu 22,51, ITBMS remboursé 157,46→1,57, remb. 24,07, conservé 24,09, commission 2,70 ; TA07 3 / 4 / 1 ; TA08 14,40 + 9,60 + 5,40 + 4,80 = 34,20 ; TA09 refus car plafond 0. Les valeurs de j (1 si > 2 j, ½ sinon ; no-show 2 / ¾) sont conformes à `penaltyDays` de 08.

Recalcul de critères monétaires hors TA contre 08 : PAY-006 (T28 : 256,66 − 187,44 = 69,22 capturé, 187,44 voidé) OK ; PRC-020 (T43 : 0,70 + 0,70 = 1,40) OK ; FIN-004 (T44 : 8,80 remboursé + 5,40 retenu = 14,20 payé) OK ; PYO-007 (T53/T54/T55 : 45,00 ; 0,00 / 25,50 ; 220 752 PYG) OK ; PAY-004 (T33 : Yappy 37,44, carte 150,00) OK ; BKG-035 (T16 187,44 ; T17/T18/T20 45,00 / 45,00 / 75,00) OK ; ADM-008 (T36 : −118,44 et −50) OK.

## 4. Constats

### MAJEUR

**F1 — BKG-014 / CAL-011 / PAY-033 : la conversion hold → trip n'est pas spécifiée sous la contrainte d'exclusion.** La fiche ne traite que « paiement confirmé après expiration **et créneau repris** ». Elle est muette sur le cas symétrique (paiement ou confirmation agence reçu après expiration, créneau encore libre) : une implémentation naïve convertirait un hold devenu inactif en TRIP par simple `UPDATE kind` sans réinsertion, d'où une double réservation silencieuse (le CRITIQUE de VERIF_14 sur 17). Manquent aussi, par rapport à 08 BR-BOOK-10 : réinsertion sous contrainte à la conversion (sinon VOID / remboursement), un seul paiement en cours par hold, limite de 2 holds simultanés par guest, expiration par tâche de 60 s, cible « 0 autorisation ouverte après 20 min », test d'acceptation de 100 requêtes concurrentes (le PRD en teste 50). Le hold prolongé à « 2 h 10 » du mode (b) (BKG-014, PAY-033) est incompatible avec la recommandation de 17 §2.5 (réservation `BOOKED` « paiement en attente », occupation de type TRIP, annulation automatique à 2 h) et avec toute proposition de hold de type lien agence : le PRD doit adopter la forme retenue ou renvoyer explicitement à 17 corrigé. À corriger avant le lot 2 (risque de S2 ≠ 0). Passe en CRITIQUE si 17 corrigé et PRD restent désalignés au moment du build.

**F2 — 10b v2 n'est pas repris dans le PRD.** 10b ne figure pas dans la liste des sources ; aucune référence aux écrans S01–S17 / A01–A13 ni aux exigences UX-xx / UXQ ; les changements de 10b §7 (non appliqués dans 04) ne sont reflétés dans aucune fiche : (i) PAY-035, LST-013, BKG-018 : pas de liste fermée « ce que la caution couvre / ne couvre pas » (dommages oui / non) ni de libellé de caution de 10b (UX-21, A11) ; (ii) VER-007 / BKG-012 / ADM-029 : le PRD dit « When il paie, Then la réservation passe en revue » alors que 10b (principe n° 2, P0-A) place le cas signalé en revue **avant** l'émission du lien de paiement, véhicule bloqué (UXQ-08 ouverte, non signalée dans le PRD) ; (iii) BKG-014 : état « paiement en cours » et blocage du véhicule jusqu'à l'état final (Yappy 5 min, mode b 2 h) au-delà des 10 min du hold (UXQ-09) ; la fiche libère le créneau à 10:10 même si un ordre Yappy lancé à 10:08 court jusqu'à 10:13 ; (iv) LEG-010 : finalité « remboursement par virement » absente ; (v) PAY-021 : pas de vue agence « remboursements à exécuter » (A12). Les minuteries Yappy 10 min (hold) / 5 min (ordre) sont, elles, correctes. Atténuant : le PRD déclare que 04 fait foi et 04 n'est pas encore consolidé ; mais la dépendance aurait dû être signalée dans D.2 / D.3.

**F3 — Trou monétaire P0-A : agence inéligible à la retenue (TRP-015, T38/T39, OQ-BR-45).** Dans 08 (T38/T39) toute la retenue d'un no-show sans message tracé « revient à la plateforme ». En P0-A la plateforme ne détient rien (A.8.1 : « la part retenue reste à l'agence ») : le PRD ne dit pas ce qui se passe (remboursement intégral du guest ? commission ?) et aucun vecteur TA ne couvre le cas. À spécifier (valeur par défaut fail-closed) ou à rattacher explicitement à OQ-BR-45 dans D.2 pour TRP-015.

**F4 — PAY-006 : critère d'acceptation appuyé sur T28** (configuration avec protection, trip fee et parts hôte), pas sur la configuration P0-A. Aucun vecteur P0-A de « capture partielle + void » (par ex. TA02 : capturer 42,80, voider 85,60). Le test ne valide donc pas le comportement réellement livré (le PRD annonce lui-même que les colonnes hôte / plateforme ne s'appliquent pas). Ajouter TA10 ou citer TA02 dans l'AC.

### MINEUR

**F5 — Vecteurs T66–T68 (08, VERIF_12) absents.** A.8.1 s'arrête à T65 ; PAY-021 (imputation incrémentale, T66), ADM-008 (chargeback sur remboursement bloqué, T67) et PAY-019 / PAY-015 (`attempt_no` des débits, T68) devraient les citer.

**F6 — TRP-004 : gabarit incohérent.** Description : ≥ 12 extérieures + 6 intérieures + carburant + compteur (= 20 images) ; AC : « 17 photos sur 18 ». Préciser le total ; noter la divergence volontaire avec 08 BR-PICKUP-03 (≥ 15 + 8).

**F7 — AC sans valeur concrète** : CLM-006 (recevabilité 2 j ouvrés, pièces 15 j non testés), CLM-021 (délai guest 72 h non donné), CLM-034 (aucun seuil). Les AC restent testables mais pas à la valeur.

**F8 — D.1 : attribution erronée pour I18N-003 / I18N-004.** Le générateur a absorbé l'en-tête de l'epic E14 : ces deux lignes P0-A portent BR-PAY-06, BR-REIMB-03 et 9 OQ de la porte G2 (OQ-MK-02, OQ-PAY-02…), alors que la fiche n'en cite aucun. D.2 n'est pas affecté.

**F9 — Conventions de noms écartées de 17** (à aligner ; le PRD le reconnaît) : `hold` → `checkout_hold` ; `vehicle_occupancy.type` incluant `ICAL` → `kind ∈ {TRIP, HOLD, HOST_BLOCK, BUFFER}` + `source ∈ {CHECKOUT, MANUAL, ICAL, SYSTEM}` ; `company` → `organization` ; rôle `AGENCY_COUNTER` → `AGENCY_COUNTER_AGENT`, rôle `AGENCY_OWNER` absent du PRD (signataire du contrat-cadre et du mandat) ; `fleet_policy`, `framework_contract`, `psp_gate`, `payment_intent`, `identity_key`, `upload_queue` n'existent pas dans 17 (qui a `psp_mandate`, `deposit_policy`, `deposit_hold`) ; retard « 29 min » paramétré (PRD) vs « end + 30 min » (17, minuteries).

**F10 — D.3 : script de couverture « non versionné ».** Le contrôle annoncé « OK » et le script TA « indépendant » de l'auteur ne sont pas dans `tools/` ; l'audit n'a pu que refaire les contrôles (tous concordent). Verser le script de l'auteur.

**F11 — BKG-035 « avoir commercial plafonné (ADM-007) » comme coût de repli** quand la cause n'est pas imputable à l'agence : acceptable car le plafond vaut 0 par défaut (TA09) et `platform_funded_host_compensation` absent = false (T61), mais la formulation peut se lire comme une décision partielle de DEC-FONDATEUR-01. Ajouter « plafond 0 tant que DEC-FONDATEUR-01 est ouverte ».

**F12 — OQ-BR-04 : TA07 est un test actif avec 29 min** (paramétré mais non marqué provisoire), alors que T17/T18/T20 sont explicitement « désactivés » (BKG-035). L'AC de TRP-035 fige « OVERDUE à 10:30 ». Marquer TA07 et cet AC comme valeur de test dépendante du paramètre.

**F13 — PAY-021 : double voie (API sous LEG-027, sinon l'agence dans son back-office)** cohérente avec le mandat, mais aucun AC ne vérifie que, sans mandat, le remboursement reste exécuté par l'agence et seulement suivi par la plateforme. Ajouter un Given / When / Then.

**F14 — Libellés de preuve** : LST-010 marque « confirmé (OBSERVÉ) » alors que le texte espagnol et le calcul de `freeUntil` sont proposés ; préciser « base confirmée, texte proposé » comme dans ACC-001.

## 5. Conformité aux points demandés

- **Critères testables** : 127/127 fiches en Given / When / Then, valeurs concrètes dans la grande majorité (exceptions F7). Correspondance avec 08 et les TA : exacte (section 3).
- **P0-A** : aucune fiche P0-A ne fait encaisser, détenir, reverser ou prélever la plateforme (recherche textuelle + lecture de PAY-001/006/021/033/034/035, FIN-001/002/018/019, CLM-006, ADM-007/008, LEG-020/025/027). Mandat LEG-027 : liste fermée, montants bornés, `ERR_MANDATE_REQUIRED`, révocation → mode (b). Bêta : procédures MANUEL décrites pour les 59 lignes.
- **Décisions ouvertes** : DEC-FONDATEUR-01 / OQ-BR-41 laissées ouvertes (paramètre absent = false, T61 ; T17/T18/T20 « désactivés » ; ADM-031 sans valeur) ; OQ-BR-04 ouverte et paramétrée (réserve F12) ; pays non tranché ; D.2 signale les 58 fiches bloquées ou dégradées.
- **Statuts de preuve** : 160/160 cohérents avec 04 ; PROPOSÉ explicite pour tout ce qui n'existe pas chez Turo ; LEG-024 prudente (précédent 2018 non réglementaire).
- **Cohérence 10b v2** : minuteries Yappy et hold corrects ; reste F2.
- **Concurrence** : F1.

## 6. Échantillon revu en profondeur (≈ 95 identifiants, 15 epics)

| Epic | Fiches lues | Résultat |
|---|---|---|
| E1 | ACC-001, ACC-006, ACC-008, ACC-014, VER-001, VER-002/003, VER-004, VER-007, VER-015, VER-027, VER-028 | OK ; VER-007 : F2 ; dates (01/11 + 91 j = 31/01) vérifiées |
| E2 | SRC-042, LST-010, LST-012, LST-013 | OK ; F14 ; F2(i) |
| E3 | CAL-011, BKG-014, CAL-001/002, CAL-003/004, CAL-009 | F1, F9 ; CAL-003 (borne [début, fin + tampon), 14:00) OK |
| E4 | BKG-001/006, BKG-012, BKG-018, BKG-019, LEG-026 | OK ; BKG-012 : F2(ii) |
| E5 | PRC-001, PRC-020, PRC-021, PRC-025, FIN-001, FIN-002, FIN-018/PYO-013, FIN-019 | OK ; TA06, TA07, TA08 recalculés |
| E6 | PAY-001, PAY-002/017/018, PAY-004, PAY-006, PAY-019, PAY-021, PAY-033, PAY-034, PAY-035, PAY-041 | F1, F2, F4, F5, F13 |
| E7 | PRT-019, HST-016/026, HST-019, FLT-011 | OK |
| E8 | TRP-045, TRP-056, TRP-004, TRP-057, TRP-052, TRP-007, TRP-015, TRP-033, TRP-035, TRP-038 | F3, F6, F12 |
| E9 | BKG-028, BKG-032, BKG-035, PRT-009 | OK ; F11 |
| E10 | NTF-002, REV-001/010 | OK (moyenne 4,0 recalculée) |
| E11 | CLM-001/002, CLM-006, ADM-008, LEG-024 | OK ; F7 ; T36 recalculé |
| E12 | ADM-001, ADM-004, ADM-006, ADM-007, ADM-014/031, ADM-029 | OK ; ADM-029 : F2(ii) |
| E13 | LEG-009/010, LEG-014, LEG-020, LEG-025, LEG-027, I18N-003/004 | OK ; LEG-010 : F2(iv) ; F8 |
| E14 | PAY-011/012/036, PAY-015/037, CLM-021, PAY-038, PRC-012 | OK (T57–T59, T64, T29, T50 vérifiés) ; F7 pour CLM-021 |
| E15 | PYO-001/002, PYO-007, FIN-004, FIN-005 | OK (T44, T53–T55 recalculés) |

Soit 78 fiches lues sur 127 (au-delà du minimum de 25), tous epics représentés.

## 7. Recommandations (ordre de priorité)

1. Réécrire BKG-014 (F1) en cohérence avec 17 corrigé : réinsertion sous contrainte à la conversion, état « paiement en cours », forme retenue pour le mode (b).
2. Ajouter à D.2 / D.3 la liste des changements 10b §7 en attente et les reporter dès la consolidation de 04 (F2).
3. Décider ou ouvrir formellement le cas « agence inéligible » en P0-A (F3) ; ajouter TA10 pour PAY-006 (F4).
4. Corriger D.1 (F8), citer T66–T68 (F5), préciser TRP-004 (F6), verser le script de couverture de l'auteur (F10).
