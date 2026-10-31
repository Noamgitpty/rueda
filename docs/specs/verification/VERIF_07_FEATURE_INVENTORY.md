# VERIF_07 — Audit indépendant de l'inventaire des fonctionnalités (04)

> Auditeur indépendant (n'a pas rédigé l'inventaire). Fichiers revus sans modification : `04_FEATURE_INVENTORY.csv` (613 lignes, 15 colonnes) et `04_FEATURE_INVENTORY_README.md`. Comparés à 05, 06, 08, 09, 10, 11, 12 (§9–§10), 15, 20 et `sources/*.md`. **`09b_PAYMENT_PARTNERS_PA_PY.md` n'existe pas dans le dossier** : non vérifié. Turo non consulté. Analyse du CSV en Python (`python -I`). Date : 2026-10-30.

## 0. Verdict

L'inventaire est riche et globalement fidèle aux sources : toutes les références `G-…`, `H-…`, `TOS-…`, `EC-…`, `12 §x` et `SRC_G x.y` contrôlées existent, aucune `EV-` n'est hors registre, les 613 identifiants sont uniques, les modules correspondent aux préfixes, et les comptes du README sont exacts. Il **n'est pourtant pas utilisable tel quel comme backlog de bêta fermée** :

- le P0 (275 lignes, 45 %) est presque le double d'un MVP défendable ; une version réduite de **133 lignes existantes + 8 lignes à créer = 141** est proposée (§3) ;
- le P0 suppose que la plateforme encaisse l'argent, alors que 12 §10.3 retient pour la phase 0 que **l'agence encaisse** (la qualification « casa de remesas » est bloquante) ;
- 16 lignes P0 dépendent d'une ligne P1/P2 (22 dépendances inversées au total) et 36 cycles de dépendances existent, alors que le README affirme que les références sont « contrôlées » ;
- plusieurs étiquettes de preuve sont trop fortes (DIRECTEMENT TESTÉ sans EV) et la source 15 n'est jamais citée (0 occurrence de `IMP-` dans le CSV).

Comptes : **3 CRITIQUE, 9 MAJEUR, 9 MINEUR**.

## 1. Constats

| # | Gravité | Axe | Constat | Lignes concernées | Correction proposée |
|---|---|---|---|---|---|
| F01 | CRITIQUE | Complétude / légalité | Le P0 suppose que la plateforme encaisse et reverse (PAY-006, PAY-011, PAY-015, PYO-002, PYO-007, FIN-005, FIN-014 « entité encaissante US », tous P0). 12 §10.1 E3 et §10.3 (VERIF_05 V5-20) écrivent que la qualification de casa de remesas / PSP est **bloquante si la plateforme encaisse**, et que l'option privilégiée de la phase 0 est « l'agence encaisse (son PSP local, Yappy compris), la plateforme facture sa commission ». Aucune ligne ne décrit ce mode (agence = commerçant de référence, plateforme = facturation de commission, caution prise par l'agence). | PAY-006, PAY-011, PYO-002, PYO-007, FIN-005, FIN-014 ; absence de ligne | Créer NEW-01 « mode agence encaisse » et NEW-02 « facturation de commission » (P0) ; faire dépendre le mode « plateforme encaisse » de OQ-BR-12 ; sortir FIN-014 du backlog (prérequis juridique). |
| F02 | CRITIQUE | Complétude | Les paiements locaux sont hors P0 alors que 12 §2 et IMP-01 en font la base de la clientèle locale : PAY-004 (Yappy/Clave/ACH) et PAY-022 sont P1, PAY-014 (caution par QR/virement) est P2, tandis que PAY-005 « carte garantissable obligatoire » et PAY-011/012 (pré-autorisation) sont P0. OQ-BR-12 (a, b) reste ouverte : on ignore si les acquéreurs locaux autorisent la pré-autorisation sur débit local ou Clave. Un résident sans carte de crédit ne peut donc pas réserver, et la caution P0 peut être techniquement impossible. | PAY-004, PAY-005, PAY-011, PAY-014, PAY-022 | Promouvoir PAY-004 en P0 (sous condition PSP) ; repli explicite « caution prise par l'agence au comptoir » (NEW-01) ; PAY-014/022 en P1. |
| F03 | CRITIQUE | Cohérence | Sur 275 lignes P0, 54 sont PROPOSÉ et 16 dépendent d'une ligne de priorité inférieure (§4, 22 dépendances inversées au total). Le P0 n'est donc pas fermé. Les 36 cycles bilatéraux (ACC-006↔VER-001, VER-002↔VER-003, BKG-001↔LST-023, VER-027↔ADM-004, TRP-038↔ADM-022…) rendent l'ordre de construction impossible à déduire. | Voir §4 | Retirer les dépendances « de confort », fusionner les paires cycliques, ajouter une colonne `lot` calculée par tri topologique. |
| F04 | MAJEUR | Preuve | Trois lignes « DIRECTEMENT TESTÉ » reposent sur le retest connecté `G-BOOK-06` (BKG-005, PAY-007, PRC-010) qui n'a **aucune entrée** dans 20_EVIDENCE_REGISTER (EV-0007 = checkout invité « sans soumission », G-BOOK-01 à 04). PRC-012 cite G-BOOK-06 pour moitié de sa source. | BKG-005, PAY-007, PRC-010, PRC-012 | Ajouter EV-0026 (retest connecté, aucune réservation) dans 20 et citer l'EV dans `source`. |
| F05 | MAJEUR | Preuve | PRC-018 (« DIRECTEMENT TESTÉ », sources `10 §1 ; 08 BR-PRICE-11`) et PRC-020 (Floride « vérifié au centime ») sont des **recalculs sur des montants observés**, pas des tests ; PRC-020 est nommé « moteur de taxes par marché » alors que seule la formule de Floride a été reproduite (ITBMS Panama : OQ-BR-14). EV-0025 (Carculator) est de type « document officiel » dans le registre mais DIRECTEMENT TESTÉ dans l'inventaire (HST-002). | PRC-018, PRC-020, HST-002 | Requalifier en OBSERVÉ + « recalcul vérifié » ; corriger le type de EV-0025. |
| F06 | MAJEUR | Preuve | Sur 126 lignes OBSERVÉ, 12 n'ont que des sources sans EV ni G-/H- (03 §x, « 08 BR-CXL (pages sœurs) », « 10 §1 », « 06 Inscription ») : non rattachables au registre 20 (EV-0001 à 0014). Le registre ne compte que 25 preuves pour 613 lignes. | LEG-011, SRC-033, SRC-035, SRC-036, MKT-012, MKT-014, LEG-005, LEG-006, I18N-001, SUP-001, PRT-006, ACC-003 | Ajouter les EV manquantes (observations du sitemap 03) ou retagger en DOCUMENTÉ/INFÉRÉ. |
| F07 | MAJEUR | Preuve | Les lignes NTF-011 à 016 et 019 sont DOCUMENTÉ alors que le catalogue 08 BR-NOTIF marque en partie INFÉRÉ le canal ou le déclencheur (NOTIF-11, 13, 14, 19, 31). 25 lignes DOCUMENTÉ ne citent que « 08 BR-… » sans source primaire SRC/TOS/EV (BKG-012, 033, 034, 035 ; TRP-009, 028, 031, 046 ; NTF-011 à 016, 019 ; REV-005 ; HST-026, 029 ; HDB-008 ; CLM-033 ; SUP-016 ; FIN-011 ; I18N-006, 007 ; PRC-022). | NTF-011…019, autres lignes listées | Répercuter le statut de 08 ligne par ligne ; ajouter la source primaire. |
| F08 | MAJEUR | Légal | README §3 : « preuves photo horodatées **exigées** par ACODECO » (TRP-004, LEG-024). 12 §3.7 (DOCUMENTÉ-SECONDAIRE, presse 2018) dit seulement qu'ACODECO a sanctionné des débits de caution **sans preuve documentée du dommage**. L'exigence « photo in-app, hash, géolocalisation » est une recommandation [NOUS]. | TRP-004, LEG-024, README §3 | Reformuler : « pratique recommandée pour résister aux plaintes ACODECO ». |
| F09 | MAJEUR | Complétude | La source 15 (39 idées IMP-01 à IMP-39) n'est citée nulle part (0 `IMP-` dans le CSV) et n'est pas dans les sources du README. Manquent notamment les éléments de l'offre phase 0 : IMP-22 (moteur de réservation en marque blanche), IMP-19 « vue comptoir », IMP-21 (onboarding express 48 h : FLT-011 est P1), IMP-12 (constancia de arrendamiento), IMP-02 (caution modulée/sans carte), IMP-11 (IA avant/après), IMP-23, IMP-28, IMP-31 à 39. | voir §5 | Ajouter une colonne `ref_improvement` et créer les lignes de §5. |
| F10 | MAJEUR | Cohérence P0 | Plusieurs lignes P0 gardent des valeurs américaines : BKG-032 (25/50 $), TRP-035 (20 $ + 3 %), TRP-038 (500 $), LST-021 (150 $), HST-019 (valeur ≤ 200 000 $, âge ≤ 12 ans), VER-025 (US 18/21/25/30), PRT-001/002/005 (franchises 500/3 000 $). Les notes disent « paramètre pays » mais aucune ligne ne porte la valeur Panama : un développeur ne peut pas coder. | BKG-032, TRP-035, TRP-038, LST-021, HST-019, VER-025, PRT-001, PRT-002, PRT-005 | Mettre la valeur cible Panama (ou « À DÉCIDER – OQ-xx ») dans `description_courte`, la valeur Turo dans `notes` (cf. NEW-07). |
| F11 | MAJEUR | Complexité / effort | Aucun barème de `complexite_tech` / `effort_ops`. Parmi les 9 lignes faible/élevé, plusieurs expriment un **risque financier ou juridique**, que le README exclut pourtant de `effort_ops` : FIN-014 (structure d'encaissement), PRT-003 (RC, assureur), PRT-014, MKT-017, CLM-015. PRT-009 (effort élevé) et HST-019 recouvrent des contrôles manuels non décrits. TRP-002 est « élevée » à cause du hors-ligne : scinder. | FIN-014, PRT-003, PRT-014, MKT-017, CLM-015, PRT-009, TRP-002 | Ajouter une colonne `risque_legal_financier`, documenter un barème (ex. faible < 3 j-dev), recoder ces lignes. |
| F12 | MAJEUR | Développabilité | 97 lignes ont une description de moins de 45 caractères, dont 29 en P0 ; HST-010 et HST-015 sont BLOQUÉ (contenu inconnu) mais P0 ; TRP-002, NTF-001, ADM-001, ADM-014, CAL-009 n'ont ni écrans, ni règles, ni critère d'acceptation (§6). | voir §6 | Réécrire avec acteur, déclencheur, règle, donnée et critère d'acceptation. |
| F13 | MINEUR | Doublons | Paires à fusionner : ACC-020 / BKG-025 (déclaration boîte manuelle) ; BKG-038 / TRP-031 (circonstances exceptionnelles) ; PYO-001 / FIN-008 / VER-027 / HST-018 (identité fiscale et bancaire du loueur) ; NTF-010 / NTF-018 ; LEG-001 / LEG-003 / LEG-004 (consentements) ; TRP-014 / TRP-015 (no-show) ; FIN-002 / PAY-029 / PYO-013 (documents fiscaux) ; ADM-005 / ADM-012 / SUP-016 ; ACC-031 / SRC-043 (Uber). | voir liste | Fusionner (cibles en §3.3). |
| F14 | MINEUR | Modules | Affectations discutables : VER-014 (re-vérification au check-in) relève de TRP ; MSG-007 (marché gris) est de la T&S ; PAY-029 (reçu) et PYO-013 (facture de commission) sont des sujets FIN ; SUP-015 et SUP-017 relèvent de LEG ; ACC-025 chevauche ADM-012/SUP-016 ; HST-004 est une règle ADM-027. | VER-014, MSG-007, PAY-029, PYO-013, SUP-015, SUP-017, ACC-025, HST-004 | Réaffecter ou documenter la règle de rattachement. |
| F15 | MINEUR | Traçabilité | EC-04, 05, 07, 10, 12, 13, 14, 21, 22, 23, 24, 25, 28, 30, 36, 39, 44 ne sont référencés par aucune ligne (couverts indirectement par des BR). 8 règles de 08 jamais liées : BR-CXL-03, BR-CXL-15, BR-FUEL-02, BR-FUEL-03, BR-PROT-08, BR-RETURN-05, BR-RETURN-07, BR-TT-05. Références génériques sans numéro (`BR-CXL`, `BR-DAMAGE`, `BR-MOD`, `BR-NOTIF`, `BR-REIMB`, `BR-RETURN`). 96 lignes ont `regles_liees` vide ou « — ». | voir texte | Compléter `regles_liees`, ajouter `cas_limites`. |
| F16 | MINEUR | Cohérence | PRC-011 (P0) dépend de PRC-010 (P1) ; ACC-008 (P0) dépend de ACC-007 (P1) pour un simple prénom d'usage ; LST-012 (distance incluse) dépend de PRC-020 (taxes) au lieu de PRC-019/HST-033 ; VER-015 (écran côté hôte) dépend de VER-014 (côté guest). | PRC-011, ACC-008, LST-012, VER-015 | Corriger (§4). |
| F17 | MINEUR | Priorité | Lignes non P0 qui devraient l'être : PAY-004, NTF-011, VER-028, LEG-020 (mandat hôte→plateforme nécessaire pour réclamations et récupération). | PAY-004, NTF-011, VER-028, LEG-020 | Voir §3.4. |
| F18 | MINEUR | Sources | Le README ne mentionne ni 15, ni 20, ni 09b (absent du dossier) ; la phrase « pas encore audité » doit renvoyer à ce rapport. Les `SRC_H Hnn` n'ont pas été contrôlés un par un (échantillon de 40 : 0 erreur). | README §0, §5 | Mettre à jour. |
| F19 | MINEUR | Échantillon | Sur 40 lignes tirées au hasard (graine 7) + les 12 TESTÉ, 5 BLOQUÉ/NON EXPLORÉ, 21 INFÉRÉ, 12 OBSERVÉ à sources faibles : aucun statut contredisant sa source, hors les cas ci-dessus. Aucun PROPOSÉ n'est présenté comme comportement Turo (ACC-030, SRC-024, NTF-006, MKT-006 citent Turo pour dire l'absence ou l'incohérence : correct). | — | — |

(CRITIQUE : F01–F03 ; MAJEUR : F04–F12 ; MINEUR : F13–F21.)

## 2. Contrôle des étiquettes de preuve (échantillon)

Méthode : 40 lignes tirées (graine 7) + toutes les lignes DIRECTEMENT TESTÉ, BLOQUÉ, NON EXPLORÉ, INFÉRÉ + les PROPOSÉ citant Turo + les OBSERVÉ sans EV. Résultats :

- **DIRECTEMENT TESTÉ (12)** : rattachés à une EV pour BKG-002 et BKG-006 (EV-0007), HST-003 et HST-004 (EV-0013) ; HST-002 (EV-0025, type incohérent) ; **non rattachés** : BKG-005, PAY-007, PRC-010 (retest G-BOOK-06 absent du registre), PRC-012 (partiel), PRC-014 (G-BOOK-02, couvert par EV-0007), PRC-018 et PRC-020 (recalculs, pas des tests).
- **BLOQUÉ (4) / NON EXPLORÉ (1)** : étiquettes correctes (HST-008/009/010/015 ; MKT-011) mais HST-010 et HST-015 sont P0 sans contenu connu.
- **DOCUMENTÉ** : 0 source inexistante ; 25 lignes ne citent que 08 (source de seconde main).
- **PROPOSÉ (125)** : aucune n'est décrite comme comportement Turo.
- **Comptes du README** (613 ; P0 275 / P1 193 / P2 99 / P3 46 ; statuts 12/126/324/21/125/4/1) : exacts.
- **Valeurs recalées dans les sources** : 65/40/25 % (10 §1), trip fee 23,56 % et 22,39 % (05), taxe Floride (05), pay-later J−7 (05), PAC (12 §3), art. 110 (12 §3.4) ; EC-50 « non applicable » chez Turo, cohérent avec VER-007 PROPOSÉ.

## 3. P0 réduit proposé

### 3.1 Taille

| | Lignes |
|---|---|
| P0 actuel | 275 |
| P0 conservé (lignes existantes) | 133 |
| dont promues depuis P1 | 4 (VER-028, PAY-004, NTF-011, LEG-020) |
| P0 rétrogradé en P1 ou fusionné | 146 |
| Nouvelles lignes P0 à créer (§5, NEW-01 à NEW-08) | 8 |
| **P0 réduit total** | **141** |

Principes : (1) vérifier avant de payer plutôt qu'après (supprime VER-011/012, BKG-009, NTF-008) ; (2) l'agence est le point de remise : contrôle du permis et photos au comptoir (VER-015, TRP-004) ; (3) tout ce qu'un agent humain peut faire (ADM-006/007) pour une dizaine d'agences est P1 ; (4) des règles codées en dur plutôt que des moteurs paramétrables ; (5) valeurs US paramétrées dans ADM-014, jamais codées ; (6) les sujets juridiques ouverts (OQ-BR-12, 14, 16) ne sont P0 que sous forme contractuelle ou manuelle.

### 3.2 Groupes (epics) du P0 réduit

**E1 Comptes, identité et KYC/KYB** (16) : ACC-001 Inscription par email et mot de passe ; ACC-006 Nom légal identique au permis ; ACC-008 Nom commercial affiché par l'hôte ; ACC-014 Un compte par personne ; ACC-029 Compte personne morale (loueur, RUC) ; VER-001 Téléversement du permis recto/verso ; VER-002 Selfie avec permis et liveness ; VER-003 Face match par prestataire tiers ; VER-004 Consentement biométrique et rétention ; VER-005 Pièce d'identité cédula / passeport ; VER-006 Règles des permis acceptés / refusés ; VER-007 Contrôle des 90 jours du permis étranger (Panama ; VER-013 Vérification du téléphone par OTP ; VER-015 Écran de vérification du permis par l'hôte (6 po ; VER-027 Vérification des loueurs professionnels (KYB) ; VER-028 Contrôle anti-blanchiment et listes de sanctions

**E2 Recherche et fiche véhicule** (15) : SRC-001 Recherche lieu + dates + heures ; SRC-002 Autocomplete de lieux typé ; SRC-008 Liste de résultats + carte avec marqueurs de pri ; SRC-011 Carte résultat ; SRC-012 Tri des résultats ; SRC-042 Affichage du total TTC ; LST-002 Galerie de photos ; LST-003 En-tête véhicule ; LST-006 Sélecteur de dates/heures sur la fiche ; LST-007 Adresse approximative + changement de lieu/livra ; LST-008 Gestion des dates indisponibles ; LST-010 Résumé de la politique d'annulation ; LST-012 Distance incluse et prix du km supplémentaire ; LST-013 Bloc assurance et protection ; LST-020 Bloc « Hosted by »

**E3 Disponibilité, calendrier et flotte** (9) : CAL-001 Calendrier par véhicule ; CAL-002 Blocage journalier ou horaire ; CAL-003 Préavis minimum par lieu ; CAL-004 Tampon entre trips ; CAL-009 Synchronisation iCal entrante et sortante ; CAL-011 Table d'occupation unique ; FLT-001 Équipes d'hébergement et invitation de co-hôtes ; FLT-003 Rôles fins (RBAC) pour flottes ; BKG-014 Hold de checkout et anti-double réservation

**E4 Réservation, contrat et checkout** (12) : BKG-001 Checkout sur une seule page ; BKG-002 Formulaire du conducteur principal ; BKG-006 Résumé et détail du sous-total ; BKG-008 Acceptation du montant et des conditions ; BKG-012 Contrôles bloquants à la réservation ; BKG-016 Lieux de prise et de retour ; BKG-018 Contrat de location/partage par trip ; BKG-019 Signature électronique horodatée du contrat ; BKG-022 Écran et notification de confirmation ; BKG-023 Clauses géographiques au checkout ; BKG-025 Confirmation d'aptitude boîte manuelle ; BKG-027 Détail du trip (Manage trip)

**E5 Tarification, taxes et facturation** (9) : PRC-001 Prix journalier fixé par l'hôte ; PRC-012 Trip fee (frais de service guest) ; PRC-020 Moteur de taxes par marché ; PRC-021 Arrondis et montants en unités mineures ; PRC-025 Moteur de devis versionné ; FIN-001 Grand livre en partie double ; FIN-002 Facturation électronique PAC (Panama) ; FIN-004 Collecte et reversement de la TVA locale (ITBMS) ; PYO-013 Relevé mensuel et facture de commission

**E6 Paiements, dépôt et remboursements** (11) : PAY-001 Abstraction multi-PSP (PaymentProvider) ; PAY-002 Cartes de crédit et débit au nom du guest ; PAY-004 Moyens locaux (Yappy, Clave, ACH) ; PAY-006 Pay now (autorisation puis capture) ; PAY-011 Dépôt de garantie ; PAY-012 Libération automatique du dépôt ; PAY-015 Carte enregistrée et débits ultérieurs (MIT) ; PAY-017 Gestion des refus de carte ; PAY-018 Authentification 3-D Secure ; PAY-019 Idempotence des opérations de paiement ; PAY-021 Remboursements sur le moyen d'origine

**E7 Onboarding agence et annonces** (12) : HST-005 Wizard d'annonce en 9 étapes ; HST-011 Détails du véhicule ; HST-012 Photos d'annonce ; HST-016 Soumission et revue de l'annonce ; HST-019 Éligibilité du véhicule ; HST-026 Cycle de vie de l'annonce ; HST-039 Documents du véhicule et attestation d'assurance ; HDB-001 Tableau de bord hôte ; HDB-002 Liste des trips de l'hôte ; PYO-001 Compte de versement et vérification ; PYO-002 Versements aux sociétés (ACH Panama) ; PYO-007 Grand livre hôte, compensations et solde négatif

**E8 Trip : remise, retour, preuves** (8) : TRP-002 Check-in / check-out mobile (PWA, mode hors lign ; TRP-004 Capture in-app avec gabarit d'angles et horodata ; TRP-007 Refus du véhicule au départ ; TRP-015 Déclaration de no-show guest par l'hôte ; TRP-033 Check-out avec photos de retour ; TRP-035 Détection automatique du retard et grille de fra ; TRP-038 Procédure de non-restitution graduée ; TRP-045 Machine à états du trip

**E9 Annulations et protection** (6) : BKG-028 Annulation par le guest en libre-service ; BKG-032 Annulation par l'hôte avec motif et pénalités ; BKG-035 Annulation par la plateforme ; PRT-003 RC tiers incluse dans chaque trip ; PRT-009 Mode « police flotte du loueur » ; PRT-013 Mentions de l'assureur et licences de distributi

**E10 Messagerie, notifications, avis** (8) : MSG-001 Messagerie guest–hôte par trip ; MSG-007 Détection du marché gris dans les messages ; NTF-001 Moteur de notifications multicanal ; NTF-007 Notification de réservation confirmée ; NTF-011 Notifications de trip ; REV-001 Avis du guest sur le trip/hôte avec sous-notes ; REV-004 Publication en double aveugle ; REV-010 Note moyenne et nombre de trips

**E11 Sinistres et litiges de base** (4) : CLM-001 Déclaration de dommage par l'hôte ; CLM-002 Déclaration d'incident/accident par le guest ; CLM-006 Instruction d'un dossier plateforme ; CLM-021 Paiement ou contestation par le guest sous 48 h

**E12 Back-office, support et risque** (13) : ADM-001 Console admin avec RBAC, 2FA et journal d'audit ; ADM-002 File de revue KYC ; ADM-003 File de revue des annonces ; ADM-004 Onboarding et KYB des loueurs ; ADM-005 Fiche utilisateur 360° ; ADM-006 Gestion des trips par les agents ; ADM-007 Remboursements, gestes commerciaux et crédits ; ADM-008 Arbitrage des litiges et factures contestées ; ADM-014 Paramétrage par pays ; ADM-022 Tableau ops des véhicules en retard / non restit ; ADM-029 File de revue des réservations à risque ; SUP-004 Support 24/7 et ligne d'urgence ; SUP-011 Support multilingue espagnol / anglais

**E13 Légal, consentements, i18n** (10) : LEG-001 Acceptation des CGU et de la confidentialité ; LEG-002 Consentements horodatés et versionnés ; LEG-009 Politique de rétention et pseudonymisation ; LEG-011 Centre légal ; LEG-014 Positionnement d'intermédiaire (« not a rental c ; LEG-015 Résolution des litiges et droit applicable ; LEG-020 Mandat de l'hôte à la plateforme (attorney-in-fa ; LEG-024 Conformité ACODECO (preuves et décisions motivée ; I18N-003 Espagnol et anglais au lancement ; I18N-004 Devise USD au Panama

**E14 Nouvelles lignes (8)** : NEW-01 à NEW-08 (§5).

### 3.3 Lignes à rétrograder de P0 en P1 (ou à fusionner)

Types : **Fusion** = disparaît comme ligne de backlog, contenu repris par la cible ; **Manuel bêta** = remplacé par un processus humain ou l'outil admin ; **Juridique/auto** = dépend d'un avis ouvert ou d'un moteur prématuré ; **Reportable** = confort.

| feature_id | nom | nouvelle priorité | type | raison |
|---|---|---|---|---|
| ACC-002 | Connexion / inscription Google (SSO) | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| ACC-004 | Connexion par code à usage unique (SMS / WhatsApp) | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| ACC-013 | Mise à jour email, téléphone, mot de passe | P1 | Manuel bêta | Changement de coordonnées via support en bêta. |
| ACC-017 | Profil public | P1 | Manuel bêta | Profil public non nécessaire : l'agence est identifiée par LST-020. |
| ACC-020 | Déclaration d'aptitude à la boîte manuelle | P1 | Fusion | Fusionner dans BKG-025 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| ACC-021 | Statut d'approbation conducteur visible | P1 | Reportable | Reportable en P1. |
| ACC-022 | Fermeture de compte en libre-service | P1 | Manuel bêta | Fermeture de compte via support (ticket) pendant la bêta. |
| ACC-023 | Garde-fous de fermeture | P1 | Fusion | Fusionner dans ACC-022 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| ACC-025 | Restrictions de compte (impayé, chargeback, échéancier) | P1 | Manuel bêta | Blocage des comptes débiteurs fait à la main par l'ops (ADM-005) ; automatiser en P1. |
| ACC-027 | Menu utilisateur connecté | P1 | Fusion | Fusionner dans HDB-001 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| ACC-028 | Menu hôte conditionnel | P1 | Fusion | Fusionner dans HDB-001 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| VER-009 | Screening à chaque réservation et en continu | P1 | Manuel bêta | Screening continu = règles ; au départ revue manuelle des réservations à risque (ADM-029). |
| VER-010 | Délai de revue d'un compte en attente | P1 | Fusion | Fusionner dans ADM-002 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| VER-011 | Checklist post-réservation avec échéance | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| VER-012 | Annulation automatique si checklist incomplète | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| VER-014 | Re-vérification d'identité au check-in | P1 | Manuel bêta | Le comptoir de l'agence contrôle le permis à la remise (VER-015). |
| VER-019 | Exigences dynamiques selon le risque | P1 | Juridique/auto | Moteur d'exigences dynamiques (complexité élevée) : en bêta, exigences statiques par classe de véhicule (HST-011 + PAY-011). |
| VER-023 | Notification de sanction et appel | P1 | Fusion | Fusionner dans ADM-005 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| VER-025 | Âge minimum selon la classe du véhicule | P1 | Fusion | Fusionner dans BKG-012 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| SRC-003 | Sélecteur d'heure par pas de 30 min | P1 | Fusion | Fusionner dans SRC-001 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| SRC-006 | Recherche par aéroport (code IATA) | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| SRC-010 | Compteur de résultats et état de fin de liste | P1 | Fusion | Fusionner dans SRC-008 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| SRC-013 | Barre de filtres rapides (chips) | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| SRC-014 | Filtre de prix total hors taxes | P1 | Fusion | Fusionner dans SRC-012 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| SRC-015 | Filtre par type de véhicule (2 niveaux) | P1 | Fusion | Fusionner dans SRC-012 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| SRC-016 | Filtres d'attributs véhicule | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| SRC-026 | Âge du conducteur dans la recherche | P1 | Fusion | Fusionner dans BKG-012 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| SRC-030 | Classement « Relevance » | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| LST-001 | URL SEO de fiche véhicule et titre | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| LST-019 | Avis sur la fiche | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| LST-021 | Règles de conduite (Rules of the road) | P1 | Fusion | Fusionner dans BKG-018 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| LST-022 | Mention de télématique / collecte de données | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| LST-023 | Barre sticky prix + CTA | P1 | Fusion | Fusionner dans BKG-001 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| LST-027 | Interdiction de sortie du territoire affichée | P1 | Fusion | Fusionner dans BKG-023 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| BKG-003 | Choix du plan de protection au checkout | P1 | Juridique/auto | Choix de plan au checkout : suit PRT-001. |
| BKG-009 | Bandeau de vérification post-réservation | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| BKG-010 | Book Instantly universel | P1 | Fusion | Fusionner dans BKG-014 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| BKG-013 | Pas de chevauchement de trips pour un guest | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| BKG-015 | Remboursement automatique si la réservation échoue | P1 | Fusion | Fusionner dans BKG-014 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| BKG-017 | Pas de one-way à la réservation | P1 | Fusion | Fusionner dans BKG-016 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| BKG-021 | Calcul des jours facturables | P1 | Fusion | Fusionner dans PRC-025 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| BKG-026 | Liste des trips à venir et historique | P1 | Fusion | Fusionner dans BKG-027 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| BKG-029 | Affichage de l'heure exacte de fin de gratuité | P1 | Fusion | Fusionner dans BKG-028 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| PAY-005 | Carte « garantissable » obligatoire | P1 | Fusion | Fusionner dans PAY-002 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| PAY-025 | Paiement des factures et soldes impayés in-app | P1 | Manuel bêta | Paiement d'un solde par lien PSP envoyé par le support. |
| PAY-028 | Gestion des chargebacks | P1 | Manuel bêta | Chargebacks traités dans le portail du PSP ; dossier de preuves manuel (TRP-004 fournit les pièces). |
| PAY-029 | Reçu détaillé du trip | P1 | Fusion | Fusionner dans FIN-002 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| PRC-002 | Prix personnalisés par date, plage ou ensemble de dates | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| PRC-008 | Remises de durée (3 j, 1, 2, 3 semaines, 1 mois) | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| PRC-011 | Règle de cumul des remises | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| PRC-014 | Frais jeune conducteur | P1 | Manuel bêta | Âge minimum et caution suffisent ; surcharge jeune conducteur en P1. |
| PRC-018 | Prix des protections en % du prix journalier net | P1 | Juridique/auto | Prix des plans : suit PRT-001. |
| PRC-019 | Tarif du kilomètre supplémentaire calculé et figé | P1 | Fusion | Fusionner dans HST-033 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| PRC-022 | Frais administratifs sur frais annexes | P1 | Reportable | Reportable en P1. |
| TRP-001 | Ouverture du check-in à T−24 h | P1 | Fusion | Fusionner dans TRP-002 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| TRP-003 | Photos du véhicule au départ par le guest | P1 | Fusion | Fusionner dans TRP-004 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| TRP-005 | Photos avant trip par l'hôte | P1 | Fusion | Fusionner dans TRP-004 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| TRP-006 | Checklist de conformité du véhicule | P1 | Fusion | Fusionner dans TRP-004 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| TRP-008 | Modes de remise des clés | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| TRP-011 | Instructions de retrait et de retour | P1 | Fusion | Fusionner dans HST-011 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| TRP-014 | Fenêtre de grâce et no-show guest | P1 | Fusion | Fusionner dans TRP-015 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| TRP-016 | Déclaration de no-show hôte par le guest | P1 | Manuel bêta | No-show hôte : remboursement manuel par le support (ADM-007) en bêta. |
| TRP-018 | Seul le conducteur principal retire et rend | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| TRP-020 | Demande de modification « Change trip » | P1 | Manuel bêta | Modifications via agent (ADM-006) ou annulation + nouvelle réservation en bêta. |
| TRP-021 | Approbation automatique ou demande à l'hôte | P1 | Manuel bêta | Voir TRP-020. |
| TRP-022 | Extension de trip | P1 | Manuel bêta | Voir TRP-020 (prolongation traitée par l'agence avec le support). |
| TRP-025 | Recalcul et remboursement des différences | P1 | Manuel bêta | Voir TRP-020. |
| TRP-027 | Échange de véhicule (swap) avant le trip | P1 | Manuel bêta | Échange de véhicule géré par l'agent (ADM-006) : annuler/rebooker. Le README en fait un P0 volontaire, mais sa dépendance FLT-013 est P1. |
| TRP-041 | Fin du trip par la plateforme et récupération | P1 | Manuel bêta | Récupération du véhicule par la plateforme : sujet juridique ouvert (OQ-BR-17) ; procédure manuelle TRP-038 + ADM-022. |
| TRP-046 | Fenêtres post-trip | P1 | Fusion | Fusionner dans TRP-045 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| TRP-050 | Signalement d'un problème de sécurité en cours de trip | P1 | Fusion | Fusionner dans SUP-004 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| MSG-004 | Masquage des coordonnées avant réservation | P1 | Fusion | Fusionner dans MSG-007 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| MSG-005 | Messages programmés de l'hôte | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| MSG-011 | Conservation de l'historique comme preuve | P1 | Fusion | Fusionner dans MSG-001 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| NTF-002 | Gabarits WhatsApp Business approuvés | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| NTF-003 | Matrice de préférences catégorie × canal | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| NTF-006 | Tests automatisés des gabarits avec toutes les variables | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| NTF-008 | Rappels de checklist avant échéance | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| NTF-012 | Notifications de modification | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| NTF-013 | Notifications de factures annexes | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| NTF-016 | Notifications de violation, suspension et appel | P1 | Fusion | Fusionner dans NTF-001 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| NTF-018 | Notifications de versement | P1 | Fusion | Fusionner dans NTF-001 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| REV-002 | Avis de l'hôte sur le guest | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| REV-003 | Fenêtre de notation | P1 | Fusion | Fusionner dans REV-001 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| HST-003 | Pré-étape de localisation du véhicule | P1 | Fusion | Fusionner dans HST-011 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| HST-004 | Blocage des pays/villes non ouverts | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| HST-006 | Identification par VIN | P1 | Fusion | Fusionner dans HST-011 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| HST-010 | Étape disponibilité du véhicule | P1 | Fusion | Fusionner dans CAL-001 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| HST-015 | Étape engagements sécurité et qualité | P1 | Fusion | Fusionner dans LEG-020 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| HST-018 | Prérequis de l'hôte | P1 | Fusion | Fusionner dans VER-027 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| HST-021 | Classification de valeur du véhicule | P1 | Fusion | Fusionner dans HST-011 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| HST-028 | Retrait/suppression bloqués s'il existe des trips futurs | P1 | Fusion | Fusionner dans HST-026 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| HST-033 | Configuration de la distance incluse | P1 | Reportable | Reportable en P1. |
| HST-040 | Acceptation de la politique de tracking | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| HST-042 | Interdits dans l'annonce | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| HST-046 | Description, règles et instructions du véhicule | P1 | Fusion | Fusionner dans HST-011 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| CAL-005 | Durées minimale et maximale | P1 | Fusion | Fusionner dans CAL-003 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| CAL-006 | Horaires de prise et de retour | P1 | Fusion | Fusionner dans CAL-003 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| CAL-010 | Refus d'un blocage chevauchant un trip confirmé | P1 | Fusion | Fusionner dans CAL-011 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| PYO-004 | Calendrier des versements | P1 | Fusion | Fusionner dans PYO-002 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| PYO-010 | Gains par trip hors taxes (reçu hôte) | P1 | Fusion | Fusionner dans PYO-013 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| PYO-012 | Export CSV et historique des transactions | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| PYO-016 | Machine à états du versement | P1 | Fusion | Fusionner dans PYO-007 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| FLT-002 | Lots de permissions co-hôte | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| FLT-004 | Calendrier multi-véhicules | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| FLT-005 | Prix et blocages en masse | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| FLT-009 | Exports CSV et iCal | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| CLM-003 | Preuves et délais des pièces | P1 | Fusion | Fusionner dans CLM-001 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| CLM-012 | Vol et disparition du véhicule | P1 | Manuel bêta | Vol : dossier manuel via TRP-038 + plainte ; automatisation en P1. |
| CLM-019 | Factures annexes de l'hôte | P1 | Fusion | Fusionner dans CLM-006 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| CLM-022 | Contestation et escalade | P1 | Fusion | Fusionner dans ADM-008 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| CLM-032 | Machines à états réclamation et facture annexe | P1 | Fusion | Fusionner dans CLM-006 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| PRT-001 | Plans de protection guest (3 niveaux + refus) | P1 | Juridique/auto | Plans guest à 3 niveaux : dépend de l'avis assureur/SSRP (OQ-BR-16). En bêta : police flotte de l'agence + dépôt/franchise contractuels (PRT-009). |
| PRT-002 | Éligibilité des plans | P1 | Juridique/auto | Suit PRT-001. |
| PRT-004 | Exclusions communes affichées | P1 | Fusion | Fusionner dans LST-013 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| PRT-005 | Assistance routière 24/7 de base | P1 | Fusion | Fusionner dans SUP-004 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| PRT-010 | Moteur de plans paramétrable par pays et assureur | P1 | Fusion | Fusionner dans ADM-014 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| PRT-011 | Protection minimale imposée / refus interdit | P1 | Juridique/auto | Suit PRT-001 / VER-019. |
| SUP-001 | Centre d'aide | P1 | Manuel bêta | Une page FAQ statique (LEG-011) suffit. |
| SUP-005 | Numéro WhatsApp Business vérifié unique | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| SUP-008 | Non-discrimination (tolérance zéro) | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| SUP-012 | Score de risque anti-fraude | P1 | Juridique/auto | Score anti-fraude : en bêta, règles simples (ADM-029), score en P1. |
| SUP-015 | Catalogue des usages interdits | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| SUP-016 | Restrictions et suspensions de compte | P1 | Fusion | Fusionner dans ADM-005 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| ADM-010 | Ticketing omnicanal | P1 | Manuel bêta | Boîte partagée / outil de support du commerce, pas un module à construire. |
| ADM-011 | Moteur de règles de risque configurable | P1 | Juridique/auto | Moteur de règles configurable : en bêta, 5 à 10 règles codées en dur (ADM-029). |
| ADM-012 | Sanctions, suspensions et appels | P1 | Fusion | Fusionner dans ADM-005 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| ADM-026 | Traitement des demandes de droits (accès, suppression) | P1 | Manuel bêta | Demandes de droits traitées par email avec modèle de réponse (délai légal à confirmer). |
| ADM-027 | Feature flags par pays et segment | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| FIN-005 | Rapprochement PSP et banques | P1 | Manuel bêta | Rapprochement PSP par exports et tableur la première période ; automatiser en P1. |
| FIN-008 | Profil fiscal de l'hôte | P1 | Fusion | Fusionner dans VER-027 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| FIN-014 | Entité encaissante US + entité locale | P1 | Juridique/auto | Prérequis juridique (structure d'encaissement), pas une fonctionnalité logicielle : le sortir du backlog et le suivre dans 22 (OQ-BR-12/14). |
| I18N-001 | Structure d'URL pays/langue | P1 | Reportable | Reportable en P1. |
| I18N-006 | Fuseau horaire du véhicule | P1 | Fusion | Fusionner dans I18N-003 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| I18N-007 | Montants forfaitaires définis par devise | P1 | Fusion | Fusionner dans ADM-014 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| I18N-008 | Cohérence linguistique de l'interface | P1 | Fusion | Fusionner dans I18N-003 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| I18N-009 | Formats locaux | P1 | Fusion | Fusionner dans I18N-003 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| I18N-010 | Pages légales par pays | P1 | Fusion | Fusionner dans LEG-011 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| I18N-011 | Distances en kilomètres | P1 | Fusion | Fusionner dans I18N-003 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| LEG-003 | Opt-in marketing non pré-coché | P1 | Fusion | Fusionner dans LEG-002 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| LEG-004 | Consentement aux messages automatiques (SMS / WhatsApp) | P1 | Fusion | Fusionner dans LEG-002 (même écran ou même règle) ; pas de ligne de backlog séparée. |
| LEG-005 | Bannière et préférences cookies | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| LEG-007 | Téléchargement de ses données en libre-service | P1 | Manuel bêta | Export manuel sur demande pendant la bêta. |
| LEG-008 | Demande de suppression des données | P1 | Manuel bêta | Suppression sur demande manuelle (ADM-026). |
| LEG-010 | Registre des traitements et DPO | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |
| LEG-017 | Consentement à la télématique | P1 | Reportable | Confort ou règle de second ordre : non requis pour la sécurité, la loi ni le flux d'argent d'une bêta fermée. |

Répartition : Reportable 45, Manuel bêta 23, Fusion 69, Juridique/auto 9.

### 3.4 Lignes à promouvoir en P0

| feature_id | priorité actuelle | nouvelle priorité | raison |
|---|---|---|---|
| PAY-004 | P1 | P0 (conditionnel PSP) | Sans Yappy/Clave, pas de clientèle locale (12 §2, IMP-01) ; dépend de OQ-BR-12. |
| NTF-011 | P1 | P0 | Rappels de retrait et de retour : sans eux, retards et plaintes (TRP-035). |
| VER-028 | P1 | P0 | KYC/LBC des loueurs et bénéficiaires de versements (12 §9.8) ; version minimale (liste de sanctions à l'onboarding). |
| LEG-020 | P1 | P0 | Mandat nécessaire pour réclamer à l'assureur et récupérer le véhicule (TRP-038, CLM-006). |

À ne pas promouvoir : LEG-013 (dommages forfaitaires 5 500 $, risque de clause abusive devant ACODECO), VER-008 (casier/crédit), PAY-009 (BNPL), BKG-011.

## 4. Dépendances incohérentes (P0 → priorité inférieure)

| Ligne | Priorité | Dépend de | Priorité | Action |
|---|---|---|---|---|
| ACC-008 | P0 | ACC-007 | P1 | Retirer ACC-007. |
| ACC-017 | P0 | REV-012 | P1 | Retirer REV-012. |
| VER-022 | P1 | MSG-009 | P2 | Reclasser l'une des deux lignes ou retirer la dépendance. |
| LST-007 | P0 | HST-034 | P1 | Séparer « adresse approximative » (P0) de « livraison » (P1, HST-034). |
| LST-009 | P1 | PRC-009 | P3 | — |
| LST-010 | P0 | BKG-034 | P1 | Retirer BKG-034. |
| LST-019 | P0 | REV-006 | P1 | Retirer REV-006. |
| BKG-002 | P0 | ACC-011 | P1 | Retirer ACC-011 (géo-IP). |
| BKG-016 | P0 | HST-034 | P1 | Idem LST-007. |
| BKG-017 | P0 | TRP-026 | P1 | Retirer TRP-026. |
| BKG-032 | P0 | HDB-011 | P2 | Retirer HDB-011 (blocage entretien) : inutile à l'annulation hôte. |
| PRC-011 | P0 | PRC-010 | P1 | PRC-010 est P1 : rétrograder PRC-011. |
| TRP-016 | P0 | BKG-036 | P1 | Rétrograder avec BKG-036. |
| TRP-027 | P0 | FLT-013 | P1 | FLT-013 est P1 : rétrograder TRP-027. |
| TRP-038 | P0 | TRP-042 | P1 | Retirer TRP-042 : procédure manuelle sans GPS en bêta. |
| HST-042 | P0 | ADM-017 | P1 | ADM-017 est P1. |
| HST-048 | P1 | PRT-007 | P2 | Reclasser l'une des deux lignes ou retirer la dépendance. |
| HDB-006 | P1 | HDB-004 | P2 | Reclasser l'une des deux lignes ou retirer la dépendance. |
| CLM-006 | P0 | ADM-009 | P1 | Retirer ADM-009 ou le fusionner. |
| CLM-012 | P0 | TRP-042 | P1 | Voir TRP-038. |
| PRT-008 | P1 | PRT-007 | P2 | Reclasser l'une des deux lignes ou retirer la dépendance. |
| PRT-015 | P1 | PRT-007 | P2 | Reclasser l'une des deux lignes ou retirer la dépendance. |

Total : 22 dépendances inversées (dont 16 depuis des lignes P0 et 6 depuis des lignes P1).

Cycles bilatéraux (36) : ACC-006↔VER-001, VER-002↔VER-003, BKG-001↔LST-023, VER-027↔ADM-004, VER-010↔ADM-002, HST-016↔ADM-003, TRP-038↔ADM-022, TRP-021↔NTF-012, PRT-001↔PRC-018, ACC-025↔PAY-025, ACC-015↔ADM-025, ACC-028↔HDB-001, LST-027↔BKG-023, MKT-002↔FIN-013… À lire comme « livrés ensemble » ; fusionner ou garder un seul sens.

## 5. Fonctionnalités manquantes ou à créer

Lignes à créer en P0 (comptées dans le total de §3.1) :

| ID proposé | Fonctionnalité | Source | Pourquoi |
|---|---|---|---|
| NEW-01 | Mode « agence encaisse » : paiement et caution pris par l'agence (son PSP, Yappy compris) avec statut synchronisé dans la plateforme | 12 §9.3, §10.1 E3, §10.3 ; V5-20 | Contourne la qualification casa de remesas ; fonde la bêta. |
| NEW-02 | Facturation de la commission plateforme aux agences (taux configurable par agence, facture électronique PAC) | 12 §9.12 (12 %), OQ-MK-07 | Revenu de la phase 0 ; PYO-013 ne couvre que le relevé. |
| NEW-03 | Contrat plateforme–loueur signé en ligne (adhésion, mandat, SLA, responsabilités, polices flotte, engagements) | 12 §10.3 cond. 6 ; IMP-14 | Aucune ligne LEG ne couvre la relation avec le loueur (seulement guest). |
| NEW-04 | Dépôt et contrôle de la police flotte couvrant la location via plateforme (preuve, plafonds, dates) | 12 §9.4 ; 10 | Condition bloquante de la phase 0. |
| NEW-05 | Constancia de arrendamiento PDF bilingue signée (preuve pour amendes/ATTT) | IMP-12 ; CLM-026 | Amendes imputées au propriétaire (OQ-BR-19). |
| NEW-06 | Interface agent comptoir : liste du jour, remise/retour en peu d'écrans | IMP-19 | Rend TRP-004 utilisable par les agences. |
| NEW-07 | Paramètres Panama avec valeurs par défaut (caution, franchise, pénalités, âge minimum) | 12 §3 ; ADM-014 | Remplace les valeurs US des lignes P0 (F10). |
| NEW-08 | Dossier de preuve exportable (hash, horodatage serveur, conservation) | 12 §3.7 ; TRP-004 | Réponse aux plaintes ACODECO et aux chargebacks. |

À créer en P1 à P3 (absentes de l'inventaire) :

| ID proposé | Fonctionnalité | Source |
|---|---|---|
| NEW-09 (P1) | Moteur de réservation en marque blanche / widget pour le site et WhatsApp des agences | IMP-22 |
| NEW-10 (P1) | API ouverte et connecteurs aux logiciels de location des agences (au-delà de FLT-010) | IMP-20 |
| NEW-11 (P1) | Onboarding express : import en masse et vérification des documents en 48 h (FLT-011 n'en est que la moitié) | IMP-21 |
| NEW-12 (P1) | Badge « Agencia verificada » et confiance qui réduit la caution | IMP-28, IMP-02 |
| NEW-13 (P1) | Caution modulée / « caution-assurance » hors pré-autorisation | IMP-02 |
| NEW-14 (P1) | Remboursement multi-rails (crédit immédiat ou virement) ; PAY-022 n'en couvre qu'une partie | IMP-03 |
| NEW-15 (P1) | Prix « tout compris » USD/PYG avec protection minimale (SRC-042 ne couvre que le TTC) | IMP-05 |
| NEW-16 (P1) | Clé perdue / non restituée (EC-14, aucune ligne) et guest suspendu avec trip à venir (EC-39) | 11 EC-14, EC-39 |
| NEW-17 (P1) | Observabilité, sauvegardes, journal d'accès aux données personnelles (aucun terme monitoring/sauvegarde/accessibilité dans le CSV) | — |
| NEW-18 (P1) | Rails de versement alternatifs et gestion du plafond ACH Xpress 5 000 $ | 12 §9.3 |
| NEW-19 (P2) | Inspection par IA avant/après (CLM-030 existe sans IA ni seuil) | IMP-11 |
| NEW-20 (P2) | Géofencing défini par l'hôte et alertes graduées (TRP-043 sans configuration par véhicule) | IMP-16 |
| NEW-21 (P2) | Intégration des GPS/télématiques existants (TRP-042 = règles seulement) | IMP-17 |
| NEW-22 (P2) | Livraison aéroport via points homologués et suivi de vol (BKG-024 existe) | IMP-25 |
| NEW-23 (P2) | Refacturation Panapass / ATTT avec solde vérifié (HST-037 = liaison seule) | IMP-26 |
| NEW-24 (P2) | Comptes entreprises multi-conducteurs, facture au RUC (ACC-030 P3 incomplet) | IMP-32 |
| NEW-25 (P2) | Locations 1–3 mois pour expatriés avec contrôle art. 110/111 | IMP-33 |
| NEW-26 (P2) | Recherche par usage et destination | IMP-34 |
| NEW-27 (P3) | Éligibilité P2P (nantissement, inspection, âge), onboarding fiscal hôte particulier, automatisations hôtes | IMP-36/37/38 |
| NEW-28 (P3) | Option avec chauffeur par mise en relation (juridique : OQ-BR-15) | IMP-39 |

## 6. Lignes trop vagues pour être développées

Critère : description de moins de 45 caractères ou absence d'acteur, de déclencheur ou de valeur. 97 lignes au total (29 en P0). P0 prioritaires à réécrire :

| feature_id | Problème | À ajouter |
|---|---|---|
| TRP-002 | « Caméra, géolocalisation, envoi différé » : PWA hors ligne = élevée ; aucune liste d'écrans. | Écrans, champs, comportement hors ligne, taille des photos, taux de rejet. |
| NTF-001 | « 38 événements » sans table de correspondance. | Catalogue événement → canal → gabarit (08 BR-NOTIF) et repli SMS. |
| HST-010 | BLOQUÉ : contenu inconnu. | Remplacer par CAL-001/003/004. |
| HST-015 | BLOQUÉ : engagements inconnus. | Définir les engagements du loueur (NEW-03). |
| ADM-001 | « RBAC, 2FA, journal » sans rôles. | Matrice rôle × action ; durée de conservation du journal. |
| SRC-011 | Liste de 10 éléments, pas de critère d'acceptation. | Champs obligatoires, cas « nouveau véhicule ». |
| LST-013 | « Assureur cité + lien » : quel assureur ? | Dépend de PRT-009 / NEW-04. |
| PAY-018 | « Challenge pendant le hold ». | Cas frictionless/challenge, échec, délai, PSP. |
| PRC-008 | « Remises par palier » sans barème. | Table des paliers (valeur Panama). |
| VER-013 | « Numéros virtuels refusés » : comment les détecter ? | Fournisseur ou règle ; cas WhatsApp. |
| CLM-006 | Instruction de dossier sans étapes. | Étapes, SLA, rôles, pièces, lien assureur. |
| SUP-004 | Horaires, canal et langue du support 24/7 ? | Horaires de la bêta et ligne d'urgence. |
| CAL-009 | Sync iCal toutes les 15 min : conflit ? | Priorité et message en cas de conflit. |
| FIN-001 | Grand livre en partie double sans plan de comptes. | Plan minimal, écritures par événement. |
| PYO-007 | Solde négatif sans règle de compensation. | Règle et seuil. |
| I18N-004 | « 2 décimales » sans politique d'arrondi. | Voir PRC-021. |
| LEG-002 | Consentements versionnés : quels documents ? | Table document × version × date. |
| ADM-014 | « Paramètres {param} » : aucun listé. | Annexe des paramètres Panama (NEW-07). |
| ADM-029 | File de revue risque : critères ? | 5 à 10 règles initiales (pays de la carte, âge du compte, montant, permis étranger). |

Liste complète des lignes de moins de 45 caractères : ACC-003, ACC-033, VER-013, VER-018, VER-024, SRC-018, SRC-020, SRC-031, SRC-034, SRC-043, LST-002, LST-004, LST-006, LST-011, LST-012, LST-013, LST-023, LST-025, BKG-031, PAY-010, PAY-018, PRC-008, TRP-002, TRP-013, TRP-049, MSG-013, NTF-004, NTF-005, NTF-007, NTF-014, NTF-016, NTF-017, NTF-018, NTF-020, NTF-021, REV-003, REV-006, REV-012, REV-013, HST-008, HST-010, HST-015, HST-017, HST-022, HST-027, HST-038, HST-041, HST-043, CAL-001, HDB-002, HDB-005, HDB-009, HDB-017, PYO-005, PYO-012, FLT-009, FLT-011, FLT-016, CLM-032, CLM-033, PRT-012, PRT-016, PRT-017, SUP-001, SUP-003, SUP-004, SUP-009, SUP-013, SUP-017, ADM-015, ADM-016, ADM-018, ADM-020, ADM-025, ADM-028, FIN-003, FIN-010, FIN-012, FIN-015, I18N-001, I18N-003, I18N-004, I18N-010, I18N-011, I18N-013, MKT-006, MKT-010, MKT-011, MKT-012, MKT-013, MKT-015, MKT-017, LEG-006, LEG-007, LEG-015, LEG-019, LEG-022.

## 7. Complexité technique et effort opérationnel

Croisement complexité × effort : faible/faible 233, moyenne/faible 141, moyenne/moyen 107, faible/moyen 60, élevée/moyen 27, moyenne/élevé 21, élevée/faible 11, faible/élevé 9, élevée/élevé 4. Pas de confusion systématique : les 11 élevée/faible sont techniques (CAL-011, BKG-014, PRC-025, TRP-045…). Défauts : voir F11 (risque financier/juridique rangé dans `effort_ops`, absence de barème). Modules : voir F14.

## 8. Suite proposée

1. Valider ou rejeter le P0 réduit (§3) avec le produit. 2. Créer NEW-01 à NEW-08. 3. Corriger les dépendances (§4) et ajouter une colonne `lot`. 4. Ajouter EV-0026 et retagger F04–F07. 5. Ajouter `ref_improvement` et les lignes de §5. 6. Mettre à jour le README (sources, comptes).
