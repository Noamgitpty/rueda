# 11 — Cas limites et défaillances (edge cases)

> Rédigé le 2026-10-30 (Phase 4). Sources : `08_BUSINESS_RULES.md` (IDs BR-*), `sources/SRC_GUEST_DOCS.md` (SRC_G), `sources/SRC_HOST_DOCS.md` (SRC_H), `sources/SRC_TOS_NOTES.md` (TOS-*), `12_PANAMA_MARKET.md`, `13_PARAGUAY_MARKET.md`, `verification/VERIF_01_TURO_FUNCTIONAL.md`.
> **Corrections VERIF_04 (2026-10-30)** : les cas EC-01, 02, 07, 13, 16, 18, 22, 24, 27, 29, 31, 35, 36, 39, 43, 47 et 48 sont alignés sur le **modèle de règlement par motif** de `08` (table de décision BR-CXL, jeux de tests T01–T27) et sur les machines à états révisées. Chaque modification est marquée « (corrigé VERIF_04-<ID>) ».
> **Corrections VERIF_11 (2026-10-30)** : EC-29, EC-31, EC-54 et EC-55 sont alignés sur les corrections de l'exécution monétaire de `08` (remboursements en vol engagés, clé d'idempotence et supersession SM-8, reprise plafonnée et isolée par devise, crédits inclus dans l'encaissé) ; EC-56 (caution et Claim) est ajouté. Marques « (corrigé VERIF_11-<ID>) ».
> **Corrections VERIF_09 (2026-10-30)** : EC-01, 11, 28, 29, 30, 31, 32, 49 et 52 sont alignés sur la couche d'exécution monétaire de `08` (E1–E6 : encaissé ≠ dû, moyens multiples, rails de remboursement, idempotence, versement et reprise, fins anticipées) et sur les vecteurs T28–T48 ; EC-54 et EC-55 sont ajoutés. Marques « (corrigé VERIF_09-<ID>) ».
> **Statuts** de la colonne « Ce que fait Turo » : DOCUMENTÉ / OBSERVÉ / INFÉRÉ (raison donnée) / **NON DOCUMENTÉ**. Tout comportement de **notre** plateforme est marqué **[NOUS]** (PROPOSÉ). Le back-office interne de Turo n'est jamais décrit comme un fait.
> **Format** : chaque cas comporte Scénario · Déclencheur · Ce que fait Turo · Conséquences (Locataire / Hôte / Paiements / Réservation / Support) · Règles applicables · [NOUS] Comportement recommandé · Critères d'acceptation (Given / When / Then, testables).
> **Conventions de test** : `T` = `trip_start` dans le fuseau du véhicule ; `E` = fin prévue ; montants en USD (PA) sauf mention ; paramètres `{param}` = valeurs par défaut proposées dans 08.

---

## 0. Risque bloquant transverse : légalité du P2P (OQ-BR-35, P0) (corrigé VERIF_04-A10)
- **Risque** : il n'est pas établi qu'un particulier puisse légalement louer son véhicule via une plateforme.
  - Au **Panama**, un véhicule à plaque « particular » loué contre rémunération risque d'être requalifié en usage commercial (12 §3.1).
  - Au **Paraguay**, le statut fiscal et commercial de l'hôte P2P reste indéterminé : IRP, IVA, éventuelle inscription comme commerçant (13 §3.2).
- **Effet sur ce fichier** : tous les cas qui supposent un **hôte particulier** n'ont de sens que si OQ-BR-35 reçoit une réponse favorable. C'est le cas des cas EC-02, EC-36, EC-37, EC-38, EC-40 et EC-47 (indemnisation selon le plan), ainsi que des versements à un particulier. Si la réponse est défavorable, seul le modèle **hôte professionnel** (loueur sous licence) subsiste. Il faut alors revoir la qualification des pénalités hôte et l'assurance.
- **Règle** : aucun critère d'acceptation impliquant l'onboarding ou le versement à un hôte particulier n'est exécuté en recette tant que OQ-BR-35 est ouverte (08, Conventions, « Prérequis bloquants P0 »).
- **Critère d'acceptation** : Given `country_config.p2p_private_hosts_enabled = false`, ce qui est la valeur par défaut tant que OQ-BR-35 est ouverte, When un utilisateur sans RUC ni licence de loueur tente de publier une annonce, Then la publication est refusée avec le motif `PRIVATE_HOST_NOT_ENABLED`.

## A. Démarrage du trip

### EC-01 No-show du locataire
- **Scénario** : le guest ne se présente pas au rendez-vous et ne répond pas.
- **Déclencheur** : aucun check-in validé à `T + noShowGraceMinutes` et aucune annulation.
- **Ce que fait Turo** : DOCUMENTÉ — attente 2 h (US/CA/UK) ou 30 min (AU/FR) ; l'hôte écrit et attend 15 min la réponse ; il déclare le no-show sous 72 h ; retenue de 2 jours moyens (> 2 j) ou 75 % d'un jour (≤ 2 j) sur tarif remboursable, 0 remboursement en NR ; protection, Extras, assistance renforcée, caution, jeune conducteur et 50 % livraison remboursés (SRC_G 4.1.5 ; help:guest-trip-start-failures-HJUfENeVq ; SRC_H H90).
- **Conséquences** : Locataire — perte partielle ; Hôte — part du plan sur la retenue de **prix du trip** (sans trip fee) + part de la ½ livraison ; 0 s'il ne déclare pas sous 72 h et n'a pas tracé son message (corrigé VERIF_04-A02, R05) ; Paiements — remboursement partiel + libération caution ; Réservation — `NO_SHOW_GUEST`, créneau libéré ; Support — litige possible si le guest prétend être venu : objet SM-7, avec requalification et recalcul éventuels (corrigé VERIF_04-A27).
- **Règles** : BR-CXL-08, BR-CXL-15, BR-CXL-16, BR-PICKUP-04, BR-PAY-06.
- **[NOUS]** : grâce 60 min ; déclaration de no-show possible par l'hôte **avec preuve de géolocalisation** au lieu de rendez-vous ; à défaut de déclaration dans 72 h, le système déclare automatiquement le no-show si aucun check-in n'existe et que le guest n'a pas contacté le support.
- **Critères d'acceptation** :
  - **Given** :
    - un trip remboursable de 3 jours, le trip A de 08 : P 120, trip fee 18, protection 30, Extras 15, assistance renforcée 9, conducteur additionnel 15, livraison 40, taxe 7 % sur P + F = 9,66, total 256,66 ;
    - `noShowGraceMinutes = 60` `{param}` ;
    - part hôte = part livraison = 75 % ;
    - aucun check-in.

    **When** l'hôte déclare le no-show à `T + 70 min`, après un message resté 15 min sans réponse.

    **Then** :
    - le guest est remboursé de **138,22**. Détail : P 40 + F 6 + protection 30 + Extras 15 + assistance 9 + conducteur additionnel 15 + ½ livraison 20 = 135,00 HT, et une taxe au prorata de 9,66 × 46/138 = 3,22 ;
    - la caution est libérée ;
    - l'hôte reçoit **75,00** = 0,75 × 80 (2 jours de **prix du trip**, sans trip fee) + 0,75 × 20 (½ livraison, BR-CXL-16) ;
    - le net plateforme est de 37,00.

    Ce critère correspond au test T05 de 08. L'ancien critère, qui donnait à l'hôte « sa part de 92 », incluait le trip fee dans l'assiette (corrigé VERIF_04-A02, A35).
  - Given le même trip, When le no-show est déclaré par le système à `T + 72 h` (initiateur SYSTEM) au lieu de l'hôte, Then le résultat est identique (invariance à l'initiateur ; test T06 ; corrigé VERIF_04-A01).
  - Given un trip NR, When le no-show est déclaré, Then le remboursement du trip = 0 et la caution est libérée.
  - Given aucun signalement hôte et aucun check-in, When `T + 72 h` est atteint, Then le statut passe à `NO_SHOW_GUEST` automatiquement et les deux parties sont notifiées.
  - Given le trip A et **aucun message de l'hôte tracé** dans le fil du trip, When le no-show est déclaré automatiquement à `T + 72 h`, Then le guest est remboursé de 138,22, l'hôte reçoit **0,00** et le net plateforme est de 112,00 (`hostEligible` faux ; test T39 ; corrigé VERIF_09-M07).
  - Given le trip A et une annulation du guest reçue à `T + 75 min` sans check-in et sans signalement d'absence de l'hôte, When elle est traitée, Then elle est requalifiée `GUEST_NO_SHOW` et l'hôte reçoit 75,00 **même sans message tracé** (test T25 ; corrigé VERIF_09-M07).
  - Given le no-show T05 notifié au guest à `T + 70 min`, When aucune contestation n'est ouverte dans les 72 h, Then le lot « gains de no-show » de 75,00 est versé à `max(payout_at, notification + 72 h)` ; When le guest conteste dans ce délai, Then le lot passe `ON_HOLD` jusqu'à la décision SM-7 (corrigé VERIF_09-M05).

### EC-02 No-show de l'hôte
- **Scénario** : le guest est au rendez-vous, l'hôte ou le véhicule est absent.
- **Déclencheur** : `T + 30 min` sans remise du véhicule, guest présent (géolocalisé).
- **Ce que fait Turo** : DOCUMENTÉ — traité comme une annulation hôte + 150 $ (FR 100 €) ; guest remboursé intégralement ; fonds disponibles 24 h et crédit de rebooking de 24 h, puisque l'annulation intervient moins de 24 h avant le départ (corrigé VERIF_04-A15) ; avis automatique (BR-CXL-13 ; SRC_H H89).
- **Conséquences** : Locataire — remboursement intégral, besoin urgent d'un autre véhicule ; Hôte — pénalité, avis, sanctions ; Paiements — remboursement total + débit pénalité sur gains ; Réservation — `NO_SHOW_HOST` ; Support — rebooking prioritaire.
- **Règles** : BR-CXL-12, BR-CXL-13, BR-HP-03.
- **[NOUS]** : bouton « Anfitrión no llegó » activable à `T + 30 min` si le guest est géolocalisé à < 300 m du lieu ; proposition immédiate de véhicules disponibles à proximité ; crédit de compensation `{param}` = 20 USD.
- **Critères d'acceptation** : Given un guest géolocalisé au lieu de retrait à `T + 31 min` sans check-in, When il déclare l'absence de l'hôte, Then le trip passe à `NO_SHOW_HOST` (motif `HOST_NO_SHOW`, test T26), 100 % est remboursé (caution libérée), 150 USD sont débités du grand livre de l'hôte, un avis automatique est créé et une liste d'au moins 3 véhicules disponibles est affichée.

### EC-03 Véhicule indisponible avant le départ / échange (swap)
- **Scénario** : le véhicule réservé est immobilisé (panne, retard du trip précédent) ; l'hôte propose un autre véhicule.
- **Déclencheur** : l'hôte propose un swap avant `T`.
- **Ce que fait Turo** : DOCUMENTÉ — swap une seule fois, mêmes conditions, classe égale ou inférieure, gains inchangés ; refus du guest = annulation remboursée intégralement ; conducteurs additionnels à réajouter ; annulation hôte excusée si dommage/retard du trip précédent (SRC_H H95, H87 ; SRC_G 5.11, 4.2.7).
- **Conséquences** : Locataire — accepte ou refuse ; Hôte — pas de pénalité si swap accepté ou annulation excusée ; Paiements — inchangés ou remboursement intégral ; Réservation — `vehicle_id` remplacé (nouvelle version de contrat) ; Support — vérifie l'équivalence.
- **Règles** : BR-MOD-08, BR-HP-03, BR-BOOK-10.
- **[NOUS]** : swap validé automatiquement si classe ≤, mêmes Extras disponibles, même boîte ; conducteurs approuvés transférés automatiquement ; nouvelle ligne `vehicle_occupancy` créée **avant** libération de l'ancienne (transaction unique).
- **Critères d'acceptation** : Given un trip `BOOKED` sur le véhicule V1, When l'hôte propose V2 de classe supérieure, Then la proposition est refusée par le système ; When il propose V2 de même classe et que le guest refuse, Then le trip est annulé avec remboursement intégral et aucune pénalité n'est due si le motif « retard du trip précédent » est prouvé par un trip `OVERDUE` sur V1.

### EC-04 Véhicule endommagé ou sale avant le départ
- **Scénario** : au check-in, le guest constate une rayure importante, un pneu lisse ou une odeur de fumée.
- **Déclencheur** : constat pendant le check-in.
- **Ce que fait Turo** : DOCUMENTÉ — dommage mineur : photographier comme dommage préexistant (sinon présomption contre le guest) ; véhicule sale/dangereux : ne pas faire le check-in, photos, support → remboursement intégral ou rebooking (BR-CXL-04 ; TOS-GUEST ; SRC_G 4.1.6, 6.1.5).
- **Conséquences** : Locataire — remboursé ou continue avec dommages consignés ; Hôte — pénalité « nettoyage (annulation) » 50 $ ou 100 $ (conformité) ; Paiements — remboursement total ; Réservation — `REFUSED_AT_PICKUP` ; Support — décision sur la validité.
- **Règles** : BR-CXL-04, BR-PICKUP-03, BR-PICKUP-06, BR-CSP-03, BR-DAMAGE-06.
- **[NOUS]** : bouton « No acepto el vehículo » dans le check-in, photos obligatoires, annulation sans frais immédiate, revue a posteriori (sanction du guest en cas d'abus) ; dommages mineurs annotés sur un schéma du véhicule.
- **Critères d'acceptation** : Given un check-in en cours, When le guest refuse le véhicule avec ≥ 3 photos géolocalisées, Then le trip passe à `REFUSED_AT_PICKUP`, le remboursement intégral est déclenché sans attendre la revue, et un ticket de revue est créé ; Given un dommage photographié au check-in, When l'hôte déclare ce même dommage après le trip, Then le système le marque « préexistant » et bloque la réclamation sur cette zone.

### EC-05 Le guest envoie une autre personne
- **Scénario** : le conducteur principal envoie un ami (ou un conducteur additionnel) récupérer le véhicule.
- **Déclencheur** : selfie du check-in ≠ titulaire, ou déclaration de l'hôte.
- **Ce que fait Turo** : DOCUMENTÉ — no-show du guest ; conduire un non-approuvé annule la protection (SRC_G 2.9.2 ; BR-CXL-08).
- **Conséquences** : Locataire — retenue no-show ; Hôte — part no-show, ne doit pas remettre les clés ; Paiements — remboursement partiel ; Réservation — `NO_SHOW_GUEST` ; Support — vérification d'identité.
- **Règles** : BR-PICKUP-07, BR-VERIF-07, BR-CXL-08.
- **[NOUS]** : le face-match du check-in bloque la révélation du code de boîte à clés ; option « transférer le retrait » refusée (le principal doit être présent) ; message clair à l'hôte « no entregue las llaves ».
- **Critères d'acceptation** : Given un check-in dont le face-match selfie↔KYC du titulaire échoue (score < seuil), When la personne tente de continuer, Then le code de boîte à clés n'est pas révélé, l'hôte est notifié « identité non vérifiée » et l'option « déclarer no-show » lui est proposée.

### EC-06 Problèmes de conducteur additionnel
- **Scénario** : (a) l'additionnel n'est pas approuvé au moment de conduire ; (b) il a 22 ans sur un véhicule PREMIUM ; (c) le guest pense qu'il est approuvé.
- **Déclencheur** : invitation acceptée mais KYC en attente/refusé ; conduite constatée.
- **Ce que fait Turo** : DOCUMENTÉ — approbation obligatoire, mêmes seuils d'âge, statut non communiqué au principal ; frais 5 $/j (plafond 25 $) remboursés si aucun conducteur approuvé ; conduite non autorisée annule la protection (SRC_G 2.9.1–2.9.4).
- **Conséquences** : Locataire — risque de responsabilité illimitée ; Hôte — sinistre non couvert ; Paiements — remboursement des frais si non approuvé ; Réservation — inchangée ; Support — questions fréquentes.
- **Règles** : BR-VERIF-08, BR-PRICE-08, BR-ACC-04, BR-PROT-03.
- **[NOUS]** : statut visible par le principal (approuvé / en attente / refusé, sans motif) ; refus automatique si âge < seuil de la classe ; notification « X ne peut pas conduire » ; frais facturés seulement à l'approbation.
- **Critères d'acceptation** : Given un additionnel de 22 ans sur un véhicule PREMIUM (âge min. 25), When il accepte l'invitation, Then l'approbation est refusée avec le motif « âge », aucun frais n'est facturé et le principal voit « refusé ».

### EC-07 Le conducteur échoue à la vérification
- **Scénario** : permis expiré, provisoire, photo illisible, face-match négatif, ou refus de screening.
- **Déclencheur** : résultat KYC `REJECTED` ou checklist incomplète à `T − 2 h`.
- **Ce que fait Turo** : DOCUMENTÉ — annulation par Turo 2 h avant avec remboursement partiel BR-CXL-06 ; au check-in : no-show ; motifs non communiqués ; revue 24–48 h (SRC_G 1.4.4–1.4.5, 4.2.6).
- **Conséquences** : Locataire — perte partielle ; Hôte — part de retenue (INFÉRÉ) ; Paiements — remboursement partiel (NR : 0) ; Réservation — `CANCELLED_BY_PLATFORM` ; Support — appels.
- **Règles** : BR-VERIF-02, BR-VERIF-05, BR-VERIF-11, BR-CXL-07.
- **[NOUS]** : KYC **avant paiement** pour les réservations < 24 h ; si le refus est dû à notre retard de revue → annulation sans frais ; appel 1 fois.
- **Critères d'acceptation** : Given une réservation faite 2 jours avant le départ avec KYC en `MANUAL_REVIEW` non traité par l'équipe, When `T − 2 h` est atteint, Then le trip est annulé avec **remboursement intégral** : motif `PLATFORM_REVIEW_DELAY`, faute de la plateforme. L'hôte reçoit la compensation « annulation tardive » financée par la plateforme (test T17 : 45,00 sur le trip A). Given un KYC `REJECTED` notifié à J−1, When `T − 2 h` est atteint, Then le motif est `PLATFORM_INCOMPLETE_STEPS` et le remboursement partiel BR-CXL-06 s'applique (test T16 : 187,44) (corrigé VERIF_04-A11).

### EC-08 Retard de vol
- **Scénario** : le vol du guest arrive 5 h en retard.
- **Déclencheur** : message du guest avec preuve, ou absence à l'aéroport.
- **Ce que fait Turo** : DOCUMENTÉ — demander une modification de l'heure ; prévenir l'hôte avant le départ (help) / ≥ 1 h avant (policy) ; justificatif au support ≤ 24 h après `T` ; hôte de bonne foi qui ne peut accommoder → guest remboursé, hôte payé comme no-show ; sans effort → hôte 0 ; non applicable si l'annulation du vol survient > 3 jours avant (BR-CXL-10 ; SRC_G 4.1.7).
- **Conséquences** : Locataire — modification ou remboursement ; Hôte — attente, éventuel conflit avec le trip suivant ; Paiements — modification de prix ou remboursement ; Réservation — modification ou annulation ; Support — vérification de preuve.
- **Règles** : BR-CXL-09, BR-CXL-10, BR-MOD-02.
- **[NOUS]** : saisie optionnelle du numéro de vol au checkout ; suivi automatique du statut (API vols) qui propose au guest la modification et prévient l'hôte ; si le retard est confirmé par l'API, pas de justificatif à fournir.
- **Critères d'acceptation** : Given un trip aéroport avec numéro de vol enregistré, When l'API indique un retard de 5 h, Then guest et hôte reçoivent une proposition de nouvelle heure ; When l'hôte refuse faute de disponibilité, Then le guest est remboursé à 100 % et l'hôte reçoit la part d'un no-show ; When l'hôte ne répond pas en 2 h, Then l'heure est décalée automatiquement si le calendrier le permet.

### EC-09 Échec de la livraison à l'aéroport
- **Scénario** : l'hôte ne peut pas accéder à la zone de l'aéroport (contrôle, absence de permis) ou le guest ne trouve pas le véhicule.
- **Déclencheur** : pas de check-in à `T + 30 min` sur un POI aéroport ; signalement d'une partie.
- **Ce que fait Turo** : DOCUMENTÉ partiel — emplacement exact affiché 1 h avant ; livraison hors zone interdite (amendes 100/250 $) ; aéroport sans permis → point de rencontre hors emprise ; guidage in-app ; le cas « livraison échouée » lui-même : **NON DOCUMENTÉ** (INFÉRÉ : traité comme no-show hôte si le véhicule n'est pas présent) (SRC_G 2.3.5 ; SRC_H H124, H135).
- **Conséquences** : Locataire — attente, peut manquer son rendez-vous ; Hôte — pénalité no-show ou amende aéroport ; Paiements — remboursement des frais de livraison ; Réservation — retard ou `NO_SHOW_HOST` ; Support — coordination urgente.
- **Règles** : BR-PICKUP-09, BR-PRICE-09, BR-CXL-13.
- **[NOUS]** : partage de position en direct de l'hôte 30 min avant (opt-in) ; point de rencontre de repli défini dans `AirportPermit` ; si le véhicule n'est pas au point à `T + 30 min`, no-show hôte ; remboursement intégral de la livraison en cas de retard > 30 min même si le trip a lieu.
- **Critères d'acceptation** : Given une livraison à PTY, When le véhicule n'est pas géolocalisé dans la zone à `T + 30 min`, Then le guest peut déclencher `NO_SHOW_HOST` ; Given un retard de livraison de 45 min suivi d'un check-in, Then les frais de livraison sont remboursés automatiquement au guest et déduits de la part hôte.

### EC-10 Rappel de sécurité découvert
- **Scénario** : un rappel constructeur est publié pour un véhicule avec 3 trips à venir.
- **Déclencheur** : avis de rappel (base constructeur / déclaration).
- **Ce que fait Turo** : DOCUMENTÉ — email + SMS à l'hôte, véhicule restreint, retrait sous 72 h sinon plan annulé ; CA/HI : trips annulés 7 jours avant ou immédiatement ; annulation hôte sans pénalité ; levée via NHTSA ou justificatif (SRC_H H06, H07).
- **Conséquences** : Locataire — trip annulé, remboursé intégralement ; Hôte — perte de revenus, pas de pénalité ; Paiements — remboursements ; Réservation — `CANCELLED_BY_PLATFORM` (motif `SAFETY_RECALL`) ; Support — rebooking.
- **Règles** : BR-LIST-06, BR-CXL-14, BR-HP-03.
- **[NOUS]** : restriction immédiate des nouvelles réservations ; trips commençant dans < 7 jours : proposition de swap puis annulation ; trips au-delà : maintenus si la réparation est prouvée avant `T − 48 h`, sinon annulés.
- **Critères d'acceptation** : Given un véhicule avec un rappel ouvert enregistré, When un guest tente de réserver, Then l'erreur `VEHICLE_RESTRICTED` est renvoyée ; Given un trip à J+3, When aucune preuve de réparation n'est fournie à `T − 48 h`, Then le trip est annulé avec remboursement intégral, sans pénalité ni avis automatique pour l'hôte.

## B. Pendant le trip

### EC-11 Panne en cours de trip
- **Scénario** : voyant moteur et perte de puissance à 150 km de Panama City.
- **Déclencheur** : appel du guest à l'assistance.
- **Ce que fait Turo** : DOCUMENTÉ — assistance 24/7 incluse pour les pannes mécaniques (réparation sur place ou remorquage vers le lieu choisi par l'hôte) ; voyant : prévenir l'hôte, puis le support sans réponse sous 30 min ; panne liée à l'entretien facturée à l'hôte (60 $ / 350 $) ; fin anticipée causée par le véhicule : pas de frais carburant au guest ; swap pendant le trip via support ; remboursement des jours non utilisés : **NON DOCUMENTÉ** explicitement (SRC_G 7.1, 7.6, 6.5.4 ; SRC_H H97).
- **Conséquences** : Locataire — immobilisé, besoin de mobilité ; Hôte — frais de réparation et d'assistance ; Paiements — remboursement prorata (INFÉRÉ) ; Réservation — `TERMINATED_EARLY` ou swap ; Support — coordination.
- **Règles** : BR-PROT-05, BR-MOD-08, BR-FUEL-03, BR-MOD-04.
- **[NOUS]** : remboursement automatique des jours restants (prorata, trip fee compris) si la panne n'est pas imputable au guest ; proposition de swap/rebooking ; frais d'assistance imputés à l'hôte si l'expert conclut à un défaut d'entretien. Motif `TERM_BREAKDOWN_NOT_GUEST` (n° 22 de la table BR-CXL) ; `usedDays = max(1, ceil((terminatedAt − start − 29 min) / 24 h))` ; lignes journalières remboursées au prorata (P, promos, F, protection, assistance renforcée, conducteur additionnel, jeune conducteur) ; livraison et Extras non remboursés ; l'hôte garde sa part sur les jours utilisés, la livraison et les Extras (corrigé VERIF_09-M06).
- **Critères d'acceptation** :
  - Given un trip de 5 jours interrompu au jour 2 par une panne déclarée via l'assistance, When l'expert classe la panne « non imputable au guest », Then le trip passe à `TERMINATED_EARLY` (motif `TERM_BREAKDOWN_NOT_GUEST`) et les 3 jours restants (prix + trip fee + protection, taxes au prorata) sont remboursés, et aucune facture carburant/kilométrage n'est possible pour l'hôte.
  - Given le trip A de 08 (3 jours, 256,66), When la panne non imputable survient à `T + 20 h`, Then `usedDays = 1`, le guest est remboursé de **134,44** (dont taxes 6,44), l'hôte reçoit **71,25** et le net plateforme est de 47,75 (test T37 ; corrigé VERIF_09-M06).
  - Given une fin anticipée sans `TerminationReason`, When la transition est demandée, Then elle est refusée.

### EC-12 Accident
- **Scénario** : collision avec une moto à Asunción, véhicule non roulant, tiers blessé léger.
- **Déclencheur** : déclaration du guest.
- **Ce que fait Turo** : DOCUMENTÉ — rapport de police obligatoire, relever le tiers, ne pas continuer à rouler, déclarer sous 24 h ; remorquage gratuit après accident ; dépôt dommage (500 $ ou 3 000 $ si non roulant, selon plan) ; ordre de recouvrement tiers → assureur guest → guest ≤ plafond ; RC secondaire (SRC_G 7.5, 7.8–7.10, 3.4 ; TOS-GUEST).
- **Conséquences** : Locataire — dépôt dommage, reste à charge ≤ plafond, trip terminé ; Hôte — réclamation, franchise de son plan, immobilisation ; Paiements — dépôt dommage, facture finale ; Réservation — `TERMINATED_EARLY`, trips futurs du véhicule annulés/échangés ; Support — sinistre + assureur.
- **Règles** : BR-DAMAGE-01 → BR-DAMAGE-09, BR-PROT-04, BR-DAMAGE-13.
- **[NOUS]** : formulaire d'accident guidé (photos, constat Policía Caminera/PMT ou Tránsito, coordonnées du tiers) ; RC **primaire** via l'assureur partenaire ; trips futurs du véhicule : swap proposé puis annulation excusée ; PY : moto non assurée fréquente → recours direct impossible, la plateforme/l'assureur indemnise.
- **Critères d'acceptation** : Given une déclaration d'accident avec « véhicule non roulant », When elle est soumise, Then le véhicule passe à `RESTRICTED`, les trips futurs à < 7 jours reçoivent une proposition de swap, un dossier `REPORTED` est créé chez l'assureur partenaire et le guest voit son reste à charge maximal selon son plan.

### EC-13 Vol du véhicule
- **Scénario** : le véhicule disparaît d'un parking pendant le trip.
- **Déclencheur** : le guest signale la disparition.
- **Ce que fait Turo** : DOCUMENTÉ — plainte à la police ≤ 12 h après la découverte (CGU), rendre la clé d'origine ; enquête 30 jours ; clés laissées/véhicule ouvert → protection annulée ; hôte : plainte ≤ 24 h après instruction de Turo (TOS-GUEST, TOS-HOST ; SRC_G 7.12).
- **Conséquences** : Locataire — responsabilité ≤ plafond (illimitée si négligence) ; Hôte — perte totale potentielle (ACV) ; Paiements — dépôt dommage, règlement à J+30 ; Réservation — `TERMINATED_EARLY` → `VEHICLE_LOST` → `POST_TRIP`, et dossier vol SM-4 `THEFT_INVESTIGATION` (corrigé VERIF_04-A08 : plus d'impasse si le véhicule n'est pas retrouvé) ; Support — police, assureur, GPS.
- **Règles** : BR-DAMAGE-10, BR-DAMAGE-09, BR-PICKUP-11.
- **[NOUS]** : localisation GPS immédiate, signalement aux autorités (DIJ PA / Policía Nacional PY), alerte frontières (Paso Canoas, CDE) ; check-list « tengo la llave original » ; délai d'enquête aligné assureur.
- **Critères d'acceptation** : Given un signalement de vol, When le guest n'a pas téléversé la preuve de plainte dans les 12 h, Then le dossier est marqué « déclaration tardive » et le plafond de protection est suspendu en attente de revue ; Given un véhicule équipé GPS, When le vol est signalé, Then la dernière position et l'historique de 24 h sont joints automatiquement au dossier.

### EC-14 Clé perdue
- **Scénario** : le guest perd l'unique clé en cours de trip.
- **Déclencheur** : appel à l'assistance ou au support.
- **Ce que fait Turo** : DOCUMENTÉ — assistance (remorquage) gratuite avec l'option renforcée, sinon jusqu'à 199 $ ; remplacement de clé = réclamation dommage (prestataire de référence) ; aucun forfait publié (SRC_G 6.8.1–6.8.2, 7.2).
- **Conséquences** : Locataire — frais d'assistance + coût de la clé ≤ plafond (selon plan) ; Hôte — immobilisation ; Paiements — facture dommage ; Réservation — éventuellement `TERMINATED_EARLY` ; Support — coordination.
- **Règles** : BR-DAMAGE-12, BR-PROT-05.
- **[NOUS]** : forfait « clé » publié par classe ; l'hôte doit déclarer s'il dispose d'un double (permet une remise rapide) ; perte de revenus des trips suivants non imputée au guest.
- **Critères d'acceptation** : Given une déclaration « clé perdue », When le véhicule est de classe STANDARD, Then une facture forfaitaire `{param}` est proposée au guest (48/72 h pour payer ou contester) et les trips suivants du véhicule reçoivent une alerte de risque.

### EC-15 Télématique / GPS hors ligne
- **Scénario** : le boîtier GPS ne remonte plus de position depuis 12 h pendant un trip.
- **Déclencheur** : absence de ping au-delà d'un seuil.
- **Ce que fait Turo** : NON DOCUMENTÉ — GPS autorisé, données utilisables pour la récupération ; véhicule ≥ 125 000 $ sans tracker actif : retenue jusqu'à 20 % (SRC_H H15, H31). Comportement en cas de panne de tracker : inconnu.
- **Conséquences** : Locataire — aucune en principe ; Hôte — risque de non-couverture si le tracker est obligatoire ; Paiements — aucune ; Réservation — inchangée ; Support — alerte.
- **Règles** : BR-PICKUP-11, BR-GEO-02, BR-DAMAGE-11.
- **[NOUS]** : alerte hôte et ops à 2 h sans ping (4 h hors zones urbaines, couverture réseau faible au Chaco/Darién) ; message au guest pour vérifier ; si le véhicule était à < 50 km d'une frontière au dernier ping → escalade sécurité ; un tracker en panne > 24 h avant un trip bloque la réservation suivante des véhicules où il est obligatoire.
- **Critères d'acceptation** : Given un trip `IN_PROGRESS` dont le dernier ping date de 2 h en zone urbaine, Then une alerte est envoyée à l'hôte et à l'équipe ops ; Given un dernier ping à 30 km de Ponte da Amizade, When le silence dépasse 30 min, Then un incident de sécurité de priorité haute est créé.

### EC-16 Événements naturels (inondations, routes coupées)
- **Scénario** : crue au Chaco paraguayen ou glissement de terrain sur la Panaméricaine empêchant le retour à l'heure ou rendant le trip impossible.
- **Déclencheur** : déclaration d'événement par les autorités ; demande du guest.
- **Ce que fait Turo** : DOCUMENTÉ — circonstances exceptionnelles (catastrophe naturelle, état d'urgence) excusent les frais d'annulation, sans justificatif, sur contact du support ; prolongation : heure de retour étendue, kilométrage inchangé ; annulation hôte excusée pour catastrophe (SRC_G 4.1.8 ; SRC_H H87).
- **Conséquences** : Locataire — retard non facturé si excusé ; Hôte — trip suivant compromis ; Paiements — frais de retard annulés ; Réservation — extension forcée ; Support — volume élevé.
- **Règles** : BR-MOD-10, BR-RETURN-03, BR-HP-03, BR-CXL-09.
- **[NOUS]** : outil admin « événement régional » (zone géographique + période ; motif d'annulation `REGIONAL_EVENT` : remboursement intégral, gains hôte 0, aucune pénalité ; corrigé VERIF_04-A11) qui : excuse automatiquement les annulations et retards des trips concernés, prolonge les trips en cours sans frais (le temps additionnel est facturé au tarif journalier mais sans pénalité de retard), et notifie hôtes et guests ; la protection reste active pendant la prolongation forcée.
- **Critères d'acceptation** : Given un événement régional actif sur le département de Boquerón du 10 au 12, When un trip en cours dans cette zone dépasse sa fin prévue, Then aucun frais de retard n'est appliqué, la protection reste active et les jours supplémentaires sont facturés au prix journalier sans les 20 USD de pénalité.

## C. Fin du trip

### EC-17 Retard de 20 minutes
- **Scénario** : check-out 20 min après la fin prévue.
- **Déclencheur** : `checkout_at − E = 20 min`.
- **Ce que fait Turo** : DOCUMENTÉ — gratuit (0–29 min) (SRC_G 6.3.1).
- **Conséquences** : aucune.
- **Règles** : BR-RETURN-03.
- **[NOUS]** : identique.
- **Critères d'acceptation** : Given `E = 10:00`, When le check-out a lieu à 10:20, Then aucun frais n'est généré.

### EC-18 Retard de 1 h 15
- **Scénario** : check-out 75 min après la fin.
- **Déclencheur** : retard entre 30 min et 1 h 59.
- **Ce que fait Turo** : DOCUMENTÉ — ½ prix journalier moyen + 3 % ; signalement de l'hôte après 30 min, sous 24 h ; revue 48 h (SRC_G 6.3.1–6.3.2).
- **Conséquences** : Locataire — ½ jour ; Hôte — part du plan sur ce montant ; Paiements — facture débitée sur la carte ; Réservation — `RETURNED` avec frais ; Support — contestations éventuelles.
- **Règles** : BR-RETURN-03, BR-PRICE-15, BR-PROT-07.
- **[NOUS]** : détection automatique par horodatage du check-out ; facture créée automatiquement, contestable 72 h.
- **Critères d'acceptation** : Given `avgDayPriceHost` = 40 USD, `adminFeePct` = 5 % `{param}` (BR-PRICE-15 [NOUS] ; Turo : 3 %) et `disputeWindow` = 72 h `{param}` (BR-REIMB-02 [NOUS] ; Turo : 48 h), When le check-out a lieu 75 min après `E`, Then une facture de 20 + 5 % = 21,00 USD est créée et le guest dispose de 72 h pour payer ou contester (corrigé VERIF_04-A36).

### EC-19 Retard de 3 h (et conflit avec le trip suivant)
- **Scénario** : check-out 3 h après la fin ; un autre guest attendait le véhicule.
- **Déclencheur** : retard ≥ 2 h.
- **Ce que fait Turo** : DOCUMENTÉ — 1 prix journalier + 20 $ + 3 % ; protection peut être annulée ; l'hôte peut excuser l'annulation du trip suivant (« retard du trip précédent ») ou proposer un swap (SRC_G 6.3.1 ; SRC_H H87, H95).
- **Conséquences** : Locataire suivant — retard, swap ou annulation remboursée ; Hôte — gestion du conflit ; Paiements — facture de retard ; Réservation — trip suivant modifié/annulé ; Support — urgence.
- **Règles** : BR-RETURN-03, BR-MOD-08, BR-HP-03, BR-BOOK-05.
- **[NOUS]** : à `E + 30 min` sans check-out, alerte automatique au guest suivant et à l'hôte ; proposition de swap prioritaire ; si le trip suivant est annulé, les coûts de compensation du guest suivant (crédit) sont refacturés au guest en retard dans la limite de `{param}`.
- **Critères d'acceptation** : Given un trip suivant qui commence à `E + 2 h`, When le check-out n'a pas eu lieu à `E + 30 min`, Then l'hôte et le guest suivant sont notifiés et la fonction de swap est proposée à l'hôte ; When le check-out a lieu à `E + 3 h`, Then une facture de 1 jour + 20 USD + frais est générée.

### EC-20 Retard > 24 h / non-restitution
- **Scénario** : le guest ne rend pas le véhicule et ne répond plus.
- **Déclencheur** : `E + 24 h` sans check-out ni extension.
- **Ce que fait Turo** : DOCUMENTÉ — indemnisation supplémentaire de l'hôte fixée par Turo ; signalement de vol possible, 500 $ de frais administratifs, rapatriement aux frais du guest, protection annulée (SRC_G 6.3.1 ; TOS-GUEST).
- **Conséquences** : Locataire — risque pénal, frais élevés ; Hôte — perte d'usage ; Paiements — débits importants, souvent refusés ; Réservation — `UNRETURNED` ; Support — police, récupération.
- **Règles** : BR-RETURN-04, BR-DAMAGE-10, BR-TRUST-05.
- **[NOUS]** : escalade graduée (T+2 h, T+6 h, T+24 h) ; à T+24 h, dossier de plainte pré-rempli pour l'hôte ; suspension du compte du guest ; frais journaliers continus + forfait de récupération.
- **Critères d'acceptation** : Given un trip `OVERDUE` sans réponse du guest, When `E + 24 h` est atteint, Then le statut passe à `UNRETURNED`, le compte du guest est restreint, l'hôte reçoit un dossier de plainte pré-rempli (contrat, identité, dernière position GPS) et la protection est marquée suspendue.

### EC-21 Retour anticipé
- **Scénario** : le guest rend le véhicule 2 jours avant la fin.
- **Déclencheur** : check-out avant `E`.
- **Ce que fait Turo** : DOCUMENTÉ — ≤ 3 h : accord par message, pas de remboursement ; > 3 h : demande système (12 h) ; non approuvé : pas de remboursement, responsabilité des dommages jusqu'à `E` et des PV jusqu'à `E + 24 h` (SRC_G 5.6–5.7 ; BR-CXL-11).
- **Conséquences** : Locataire — pas de remboursement sans approbation, remise recalculée si approuvé (solde possible) ; Hôte — véhicule disponible plus tôt ; Paiements — éventuel solde dû ; Réservation — fin modifiée ; Support — questions.
- **Règles** : BR-MOD-04, BR-CXL-11, BR-RETURN-07.
- **[NOUS]** : demande de raccourcissement ≥ 24 h à l'avance sur tarif remboursable → remboursement des jours non utilisés ; check-out anticipé sans demande → la responsabilité du guest prend fin au **check-out validé par l'hôte** (photos), pas à `E`.
- **Critères d'acceptation** : Given un trip remboursable de 7 jours avec remise hebdo 15 %, When le guest raccourcit à 5 jours 48 h à l'avance, Then le prix est recalculé sans la remise hebdo (remise 3 jours applicable), et la différence (positive ou négative) est remboursée ou facturée ; Given un check-out anticipé non demandé, Then aucun remboursement n'est émis.

### EC-22 Dépassement de kilométrage
- **Scénario** : 1 300 km parcourus pour 750 km inclus.
- **Déclencheur** : relevé du compteur au check-out.
- **Ce que fait Turo** : DOCUMENTÉ — tarif = prix journalier ÷ distance journalière, figé à la réservation ; facture de l'hôte sous 72 h (H59, 2026-09-21, le plus récent ; les fenêtres par plan de H31/H32 sont contredites, OQ-BR-13 ; corrigé VERIF_04-A05) ; + 3 % ; guest 48 h pour payer/contester (SRC_G 6.4.2 ; SRC_H H25, H63 ; VERIF_01 V02).
- **Conséquences** : Locataire — facture ; Hôte — part du plan ; Paiements — débit ; Réservation — `POST_TRIP` ; Support — contestations de relevé.
- **Règles** : BR-MILEAGE-01/03, BR-PRICE-17, BR-REIMB-01.
- **[NOUS]** : facture générée automatiquement (OCR du compteur + télématique), validée par l'hôte.
- **Critères d'acceptation** : Given un prix journalier de 50 USD et 250 km/jour inclus (tarif 0,20 USD/km), When le check-out indique 550 km au-delà de l'inclus, Then une facture de 110,00 USD + frais est proposée à l'hôte pour validation et, après validation, envoyée au guest.

### EC-23 Carburant / batterie bas au retour
- **Scénario** : rendu à ¼ de réservoir au lieu de plein ; ou VE rendu à 15 % au lieu de 80 %.
- **Déclencheur** : photo de jauge au check-out.
- **Ce que fait Turo** : DOCUMENTÉ — carburant manquant + 10 $ + 3 %, reçu ≤ 72 h ; VE : barème (61–80 % d'écart → 20 $) + 10 $ + 20 $ si < 20 % ; prepaid refuel → rien (SRC_G 6.5.1–6.5.2).
- **Conséquences** : Locataire — facture ; Hôte — 100 % ; Paiements — débit ; Réservation — `POST_TRIP` ; Support — contestations.
- **Règles** : BR-FUEL-01, BR-FUEL-02, BR-FUEL-03 (cas non facturables), BR-EV-01, BR-REIMB-01.
- **[NOUS]** : facture auto sur la base du prix officiel du carburant × litres estimés (capacité du réservoir × écart en huitièmes) + frais fixes.
- **Critères d'acceptation** : Given un VE rendu à 15 % alors que le départ était à 80 % (écart 65 %), When l'hôte facture, Then le montant = 20 + 10 + 20 = 50 USD (barème Turo de référence) ; Given un trip avec Extra prepaid refuel, Then la création d'une facture carburant est impossible.

### EC-24 Péages ou amendes reçus des mois plus tard
- **Scénario** : une fotomulta ATTT arrive 4 mois après le trip ; un relevé Panapass montre des passages sans solde.
- **Déclencheur** : réception par l'hôte d'un avis.
- **Ce que fait Turo** : DOCUMENTÉ — facturation ≤ 90 jours, puis via support ≤ 30 jours après l'avis et ≤ 180 jours ; guest peut être sollicité jusqu'à ~185 jours ; 48 h pour payer/contester ; PV liés au véhicule non imputables (SRC_G 6.7.1–6.7.2 ; SRC_H H61, H64).
- **Conséquences** : Locataire — facture tardive sur une carte parfois expirée ; Hôte — avance l'amende ; Paiements — débit MIT, échec fréquent ; Réservation — le trip **reste `COMPLETED`**. La facture tardive est un objet SM-5 lié au trip, qui ne rouvre pas son état (corrigé VERIF_04-A08) ; Support — preuve de date/heure.
- **Règles** : BR-TT-02, BR-TT-03, BR-TT-05 (parking non refacturable), BR-PAY-09, BR-PAY-10.
- **[NOUS]** : délai 120 jours (+ 30 via support) ; rattachement automatique de l'infraction au trip par plaque + horodatage ; PA : infractions imputées au propriétaire (DE 11/2025) → refacturation contractuelle ; si la carte échoue → solde dû bloquant + relances.
- **Critères d'acceptation** : Given une amende datée pendant le trip X, When l'hôte la soumet 100 jours après la fin, Then la soumission directe est refusée et l'option « demande tardive via support » est proposée ; When elle est soumise 200 jours après, Then elle est refusée définitivement.

### EC-25 Animaux ou tabac
- **Scénario** : poils de chien abondants et odeur de cigarette avec cendres dans le cendrier.
- **Déclencheur** : signalement de l'hôte avec photos.
- **Ce que fait Turo** : DOCUMENTÉ — nettoyage 150 $ + 3 % (si poils importants, animal non autorisé) ; tabac 150 $ + 3 % (preuves : cendres, mégots, brûlures ; odeur seule insuffisante pour le nettoyage) ; signalement ≤ 72 h ; revue ~48 h ; récidive → fermeture (SRC_G 6.6.1–6.6.5).
- **Conséquences** : Locataire — jusqu'à 300 $ + frais ; Hôte — 100 % ; Paiements — débit ; Réservation — `IN_DISPUTE` si contesté ; Support — revue des photos.
- **Règles** : BR-CSP-01, BR-CSP-02, BR-CSP-04, BR-RETURN-05 (propreté au retour), BR-REIMB-05.
- **[NOUS]** : photos du check-out du guest opposables ; une seule pénalité « nettoyage » par trip, cumulable avec « tabac » ; animal autorisé via avenant → pas de pénalité pour poils normaux.
- **Critères d'acceptation** : Given un signalement tabac avec photo de cendres prise 10 h après la fin, When il est soumis 30 h après la fin, Then il est accepté en revue ; Given un signalement basé uniquement sur « odeur », Then il est refusé automatiquement pour la catégorie tabac.

## D. Paiements

### EC-26 Carte refusée à la réservation
- **Scénario** : autorisation refusée (fonds insuffisants, 3-D Secure échoué, carte Clave non acceptée).
- **Déclencheur** : réponse `declined` du PSP pendant le hold.
- **Ce que fait Turo** : INFÉRÉ — la réservation n'est pas créée (Book Instantly exige une autorisation) ; moyens acceptés/refusés documentés (SRC_G 2.6.7) ; pas de détail sur les nouvelles tentatives.
- **Conséquences** : Locataire — réservation impossible ; Hôte — aucune ; Paiements — aucun débit ; Réservation — hold libéré ; Support — faible.
- **Règles** : BR-PAY-01, BR-PAY-02, BR-BOOK-10.
- **[NOUS]** : message explicite selon le code de refus ; 3 tentatives max par hold ; proposer un autre moyen (Yappy/QR) pour le prix si une carte de garantie valide existe ; détection de carte testing (vélocité) → blocage.
- **Critères d'acceptation** : Given un hold actif, When l'autorisation est refusée 3 fois, Then le hold est libéré, le créneau redevient réservable immédiatement et l'utilisateur est bloqué pour ce véhicule pendant 30 min.

### EC-27 Carte refusée pour la caution
- **Scénario** : le prix du trip est payé par Yappy/QR mais la pré-autorisation de caution de 300 USD échoue sur la carte de débit.
- **Déclencheur** : échec de l'autorisation de caution (au checkout ou à `T − 24 h` si elle est différée).
- **Ce que fait Turo** : DOCUMENTÉ partiel — caution exigée selon classe/risque ; incompatible avec le BNPL ; carte obligatoire même avec carte cadeau ; comportement en cas d'échec de la caution : **NON DOCUMENTÉ** (INFÉRÉ : réservation bloquée) (SRC_G 2.5, 2.6.8).
- **Conséquences** : Locataire — trip menacé ; Hôte — incertitude ; Paiements — prix déjà encaissé ; Réservation — `CHECKIN_OPEN` ou `BOOKED`, avec `requirements_status = PENDING` (SM-1b ; corrigé VERIF_04-A07) ; Support — appels.
- **Règles** : BR-PAY-06, BR-VERIF-09, BR-CXL-07.
- **[NOUS]** : caution autorisée **au checkout** pour les réservations ≤ 7 jours avant le départ ; pour les autres, à `T − 48 h` avec rappel ; alternative : caution **versée** par QR/virement et restituée (si validé juridiquement) ; échec non résolu à `T − 2 h` → annulation avec le motif `PLATFORM_INCOMPLETE_STEPS` (règle BR-CXL-07), **sauf** si l'échec vient du PSP (panne) → motif `PSP_FAILURE`, remboursement intégral et compensation de l'hôte (corrigé VERIF_04-A11).
- **Critères d'acceptation** : Given un trip PREMIUM payé par QR avec caution à autoriser à `T − 48 h`, When l'autorisation échoue, Then le guest reçoit une demande de nouveau moyen avec échéance `T − 2 h` ; When rien n'est fourni à `T − 2 h`, Then `requirements_status = FAILED`, le trip passe à `CANCELLED_BY_PLATFORM` (motif `PLATFORM_INCOMPLETE_STEPS`) avec le remboursement partiel BR-CXL-06, et la notification indique la raison. Given le même cas où l'autorisation a échoué sur une erreur 5xx du PSP, Then le motif est `PSP_FAILURE` et le remboursement est intégral.

### EC-28 Carte refusée pour des frais post-trip
- **Scénario** : facture de dommages de 650 USD refusée ; carte expirée pour un péage tardif.
- **Déclencheur** : échec d'un débit MIT après les 48 h.
- **Ce que fait Turo** : DOCUMENTÉ — solde impayé bloquant (réservations, extensions) ; relances sur quelques semaines ; échéancier (dommages : ≤ 30 j après facture, 2/4/8 ou 4/6/8 mois) ; puis recouvrement et bureaux de crédit ; account updater (SRC_G 1.5.4, 6.9.3, 7.13 ; TOS-FEES).
- **Conséquences** : Locataire — compte bloqué, recouvrement ; Hôte — paiement retardé (dommages : Turo paie l'hôte indépendamment, INFÉRÉ) ; Paiements — `DebtBalance` ; Réservation — aucune ; Support — échéanciers.
- **Règles** : BR-PAY-09, BR-PAY-10, BR-DAMAGE-08, BR-ACC-10.
- **[NOUS]** : 3 tentatives de débit (J0, J+3, J+7) ; proposition d'échéancier dès le 1er échec ; l'hôte est payé par la plateforme selon le plan dans tous les cas pour les dommages (la plateforme porte le risque de recouvrement) ; pour les frais annexes, l'hôte est payé à l'encaissement.
- **Critères d'acceptation** :
  - Given une facture validée de 650 USD dont le débit échoue, When l'échec est constaté, Then un `DebtBalance` est créé, le compte du guest reçoit la restriction `UNPAID_BALANCE`, un lien d'échéancier (2, 4 ou 8 mois) est envoyé et 2 nouvelles tentatives sont planifiées à J+3 et J+7.
  - **Retenue d'annulation non encaissée** (corrigé VERIF_09-M01) : Given le trip A réservé à T−30 h en Pay now, autorisation expirée, When le guest annule à T−10 h et que le débit MIT de 69,22 est refusé, Then une dette de 69,22 est créée, aucun remboursement n'est émis, et les gains de l'hôte (45,00) sont inscrits `PENDING_COLLECTION` (test T29) ; When le guest règle ensuite 30,00, Then 19,50 deviennent versables à l'hôte et 25,50 restent en attente (test T32).

### EC-29 Panne du prestataire de paiement
- **Scénario** : le PSP (dLocal/Bancard) est indisponible pendant 40 min un vendredi soir.
- **Déclencheur** : timeouts / erreurs 5xx du PSP.
- **Ce que fait Turo** : NON DOCUMENTÉ.
- **Conséquences** : Locataire — impossible de réserver/prolonger ; Hôte — perte de réservations ; Paiements — risque de doubles débits ou d'autorisations orphelines ; Réservation — holds bloqués ; Support — pic.
- **Règles** : BR-BOOK-10, BR-PAY-02, BR-MOD-03.
- **[NOUS]** : abstraction multi-PSP avec bascule (failover) sur un second acquéreur pour les cartes ; idempotence par `hold_id`/`payment_intent_id` ; prolongation automatique des holds pendant l'incident (jusqu'à 20 min) ; extensions de trips en cours : **approbation provisoire** (le paiement est retenté après l'incident) pour ne pas mettre un guest en retard malgré lui ; réconciliation nocturne des autorisations orphelines (void automatique) ; débits différés (Pay later, capture) rejoués ; si un trip doit être annulé à cause de l'incident, le motif est `PSP_FAILURE` (remboursement intégral ; corrigé VERIF_04-A11).
- **Critères d'acceptation** : Given le PSP principal en erreur, When un guest soumet un paiement, Then la requête est routée vers le PSP secondaire ; Given deux soumissions identiques avec la même clé d'idempotence, Then une seule autorisation est créée ; Given une extension demandée pendant l'incident, Then elle est approuvée provisoirement et le retard n'est pas facturé si le paiement aboutit dans les 24 h.
  - **Remboursement rejoué** (corrigé VERIF_09-M04) : Given un règlement `(trip, segment, version 1)` dont le remboursement a expiré en *timeout* chez le PSP, When la boîte d'envoi rejoue l'opération avec la même clé `idem`, Then le PSP ne crée aucun second remboursement, le registre E1 contient une seule opération `REFUND` et SM-8 passe à `SENT` à réception du webhook (dédoublonné par `provider_event_id`).
  - **Clé et tentative** (corrigé VERIF_11-M1) : Given le remboursement T03 `SUBMITTED` sans réponse, When l'exécution est rejouée, Then `available_to_refund` = 256,66 − 187,44 = 69,22 = `owed`, aucun nouveau remboursement n'est calculé et la clé renvoyée est la même (`…:v1:REFUND:card:i1:a1`, test T51) ; Given un virement `FAILED` après **rejet confirmé**, When le guest fournit un autre compte, Then la même instance SM-8 est soumise avec `attempt_no` = 2 (`…:i1:a2`), que le PSP ne rejette pas comme doublon (test T52).

### EC-30 Remboursement partiel d'un trip payé en BNPL
- **Scénario** : trip payé par Affirm-like ; le guest annule hors fenêtre gratuite (retenue 1 jour) ou raccourcit.
- **Déclencheur** : remboursement partiel sur une transaction BNPL.
- **Ce que fait Turo** : DOCUMENTÉ — remboursements versés au financeur ; surcoûts sur la carte enregistrée ; pas de bascule après réservation ; échec de réservation → remboursement auto sous 20 min (SRC_G 2.6.5).
- **Conséquences** : Locataire — échéancier recalculé par le financeur (délai et visibilité hors plateforme) ; Hôte — part de la retenue ; Paiements — remboursement partiel au financeur ; Réservation — annulée ; Support — confusion (« je paie encore des échéances »).
- **Règles** : BR-PAY-05, BR-CXL-06, BR-PAY-08.
- **[NOUS]** : hors MVP ; si un BNPL est intégré : API de remboursement partiel obligatoire chez le financeur ; message au guest expliquant que le financeur ajuste les échéances ; aucun remboursement vers la carte de garantie.
- **Critères d'acceptation** : Given un trip BNPL de 300 USD annulé avec retenue de 100 USD, When le remboursement est émis, Then 200 USD (+ taxes au prorata) sont remboursés via l'API du financeur, aucune somme n'est remboursée sur la carte enregistrée, et le reçu affiche « reembolso enviado a {financeur} ».
  - (corrigé VERIF_09-M02) Le financeur est un moyen externe **natif** dans l'ordre d'imputation E2 de 08 : si le trip a aussi été payé en partie par crédit, la retenue est imputée d'abord sur le crédit promo, puis sur le crédit cash, puis sur le financeur.

### EC-31 Chargeback après le trip
- **Scénario** : 45 jours après un trip terminé sans incident, le guest conteste le débit auprès de sa banque (« service non reçu »).
- **Déclencheur** : notification de litige du PSP.
- **Ce que fait Turo** : DOCUMENTÉ — interdit par les CGU ; restriction du compte ; remboursements bloqués pendant la procédure (jusqu'à 90 jours) ; frais de chargeback refacturés ; recouvrement possible ; levée sur annulation du litige (SRC_G 1.5.3, 7.18 ; TOS-FEES).
- **Conséquences** : Locataire — compte restreint ; Hôte — risque de reprise des gains (INFÉRÉ : non documenté si Turo reprend les gains de l'hôte) ; Paiements — fonds gelés par l'acquéreur ; Réservation — trips futurs du guest bloqués ; Support — constitution du dossier.
- **Règles** : BR-PAY-11, BR-ACC-10, BR-PAYOUT-04.
- **[NOUS]** : dossier de contestation automatique (contrat signé, IP/appareil, photos check-in/out géolocalisées, messages, GPS) envoyé au PSP sous 5 jours ; **pas de reprise sur les gains de l'hôte** pour un trip réalisé (la plateforme porte le risque) ; trips futurs du guest annulés avec remboursement intégral.
  - **Règle unique de reprise** (corrigé VERIF_09-M05 ; tranche la contradiction avec la « reprise sur host_ledger » de SM-7) : (1) trip **réalisé** : pas de reprise, sauf décision SM-7 imputant la faute à l'hôte ; (2) gains d'**annulation ou de no-show** financés par la retenue du guest : reprise `max(0, hostPaidFromGuest − hostPayableFromGuest_after)` (E5 de 08 ; plafonnée à ce que l'hôte a reçu pour ce trip, limitée à la retenue ; montant perdu ramené dans la devise du trip au ratio de la capture d'origine ; débit au `host_ledger` de la devise du trip seulement ; corrigé VERIF_11-M2) sur le `host_ledger` si le chargeback est perdu dans `chargeback_window_days[psp][réseau]` (Bancard vPOS : 365 j ; autres : 180 j par défaut, À VALIDER) ; (3) compensation financée par la plateforme : jamais reprise. Les lots non émis du trip sont gelés (`ON_HOLD`) dès `chargeback_opened` ; les remboursements du trip passent en `BLOCKED_CHARGEBACK` (SM-8).
- **Critères d'acceptation** : Given un webhook `dispute.created` sur un trip `COMPLETED`, When il est reçu, Then le trip passe à `IN_DISPUTE` (transition `COMPLETED → IN_DISPUTE`, SM-1 ; un litige SM-7 est ouvert ; corrigé VERIF_04-A08), le compte du guest reçoit `CHARGEBACK_RESTRICTION`, un paquet de preuves PDF est généré et soumis via l'API du PSP, et le grand livre de l'hôte n'est pas débité.
  - Given les gains de no-show T05 (75,00) déjà versés, la retenue conservée étant `owed` = 256,66 − 138,22 = 118,44, When un chargeback portant sur ces 118,44 est **perdu** 60 jours après la capture (vPOS Bancard, fenêtre 365 j), Then le `host_ledger` est débité de floor(7 500 × 11 844 / 11 844) = **75,00** et le solde négatif suit SM-6b ; When un chargeback de 59,22 est perdu, Then la reprise vaut floor(7 500 × 5 922 / 11 844) = 37,50 ; When la notification de chargeback arrive après la fin de la fenêtre, Then aucune reprise n'est faite (corrigé VERIF_09-M05). Les deux résultats sont inchangés par la formule VERIF_11 : 75,00 − ⌊7 500 × 0 / 11 844⌋ = 75,00 et 75,00 − ⌊7 500 × 5 922 / 11 844⌋ = 37,50.
  - Given le trip A annulé à T−10 h (T03), 187,44 déjà remboursés et 45,00 versés à l'hôte, When un chargeback sur la capture entière de 256,66 est perdu, Then la reprise vaut **45,00** (et non 166,85), 187,44 sont inscrits en créance sur le guest (double remboursement, representment avec la preuve du remboursement) et 24,22 restent à la charge de la plateforme (test T53 ; corrigé VERIF_11-M2).
  - Given le trip A annulé à T−10 h (T03), le remboursement de 187,44 encore **non émis** (`BLOCKED_CHARGEBACK`) et les 45,00 de l'hôte gelés, When un chargeback sur la capture entière de 256,66 est perdu, Then le remboursement bloqué est annulé (`CANCELLED`, `refund_payable` éteint de 187,44), **aucune créance** n'est inscrite sur le guest, aucun débit MIT n'est tenté, la part hôte non versée est annulée et 24,22 restent à la charge de la plateforme ; When le chargeback perdu ne porte que sur 100,00, Then 100,00 du remboursement sont annulés et le reliquat de 87,44 est remboursé (nouvelle instance i2), la retenue et les 45,00 de l'hôte sont conservés (test T67 ; corrigé VERIF_12-F2).
  - Given un trip PYG débité en USD (capture 1 438 050 PYG = 200,00 USD) et 268 750 PYG versés à l'hôte, When un chargeback de 50,00 USD est perdu, Then `lost_trip` = 359 513 PYG, la reprise vaut **220 752 PYG** au `host_ledger` PYG de l'hôte, son solde USD n'est pas touché, et l'écart de change va à `fx_difference` (test T55 ; corrigé VERIF_11-M2).

### EC-32 Arrondis et devise PYG (sans décimales)
- **Scénario** : trip à Asunción : prix 350 000 PYG/j × 3, remise 5 %, trip fee 12 %, IVA 10 %, part hôte 75 %, remboursement partiel ½ jour.
- **Déclencheur** : tout calcul monétaire en PYG.
- **Ce que fait Turo** : DOCUMENTÉ partiel — montants arrondis à l'unité de devise la plus proche ; devise selon lieu de recherche/véhicule/hôte ; mêmes montants nominaux par devise (TOS-GENERAL) ; Turo n'opère dans aucune devise sans décimales (INFÉRÉ : PYG jamais géré).
- **Conséquences** : Locataire — écarts de 1 PYG entre écran, reçu et facture SIFEN ; Hôte — somme des parts ≠ total ; Paiements — rejet par un PSP si un montant décimal est envoyé en PYG ; Réservation — aucune ; Support — litiges sur les centimes inexistants.
- **Règles** : BR-PRICE-14, BR-PRICE-12, BR-CXL (pseudo-code : `roundHalfUp`, `allocHost`, taxe par ligne ; corrigé VERIF_09-m01, m06).
- **[NOUS]** : `amount_minor` entier, exposant PYG = 0 ; arrondi half-up par ligne ; taxes par ligne puis sommées (jamais taux × base agrégée) ; part hôte arrondie au plus proche, égalité exacte → plateforme (`allocHost`), la plateforme prenant le complément ; montants forfaitaires (pénalités, frais) définis en PYG ronds (multiples de 1 000) et non convertis depuis l'USD ; affichage `₲ 1.050.000` ; montants envoyés au PSP en entier.
- **Critères d'acceptation** :
  - Given prix = 1 050 000 PYG, remise 5 % = 52 500, net = 997 500, trip fee 12 % = 119 700, IVA 10 % sur (net + fee) = 111 720, When le total est calculé, Then total = 1 228 920 PYG, sans décimale, identique à l'écran, au reçu et à la facture électronique.
  - Given un montant à répartir de 997 500 PYG entre hôte (75 %) et plateforme (25 %), Then hôte = 748 125 et plateforme = 249 375, somme = 997 500.
  - Given une division produisant 0,5 PYG (ex. ½ jour de 332 501 PYG), Then le résultat est arrondi half-up (166 251) et le résidu est attribué selon la règle documentée.
  - Given une part hôte exacte de 0,75 × 333 334 = 250 000,5 PYG (trip D2, annulation tardive), When elle est arrondie, Then l'hôte reçoit **250 000** et la plateforme 83 334 (égalité exacte → plateforme ; test T40 ; corrigé VERIF_09-m04).
  - Given le trip D et un no-show à T + 70 min, Then remboursement 587 683, taxes remboursées 37 517, hôte 518 750, net 256 584, sans décimale (test T41).
  - Given une pénalité d'annulation hôte sur un trip PYG, Then elle vaut un montant PYG du barème `HOST_PENALTY[PYG]` (200 000 PYG à plus de 24 h, PROPOSÉ ; test T48), jamais une conversion de 25 USD (corrigé VERIF_09-m08).
  - Given une requête de paiement PYG, Then le champ envoyé au PSP ne contient aucun séparateur décimal.

### EC-33 Fuseaux horaires et heure d'été
- **Scénario** : guest américain réservant depuis Miami (UTC−4/−5) un véhicule à Panama (UTC−5) ; trip à Asunción au moment où l'ancien régime DST du Paraguay aurait changé l'heure ; serveur en UTC.
- **Déclencheur** : calcul de fenêtres (annulation, no-show, retard, check-in) et affichage.
- **Ce que fait Turo** : DOCUMENTÉ — fenêtres calculées dans le fuseau du véhicule (BR-CXL-00) ; affichage « EDT » observé dans une notification (EV-0014) ; gestion du DST : NON DOCUMENTÉE.
- **Conséquences** : Locataire — confusion d'heure de retrait, retards facturés à tort ; Hôte — no-show déclaré trop tôt ; Paiements — frais de retard erronés ; Réservation — fenêtres décalées d'1 h ; Support — litiges.
- **Règles** : BR-CXL-00, BR-RETURN-03, BR-PICKUP-04.
- **[NOUS]** : stockage UTC + `vehicle.timezone` IANA ; toutes les échéances calculées en heure locale du véhicule puis converties ; affichage toujours en heure du véhicule avec mention explicite (« hora de Panamá ») et rappel de l'heure de l'appareil si différente ; `America/Asuncion` = UTC−3 permanent (Ley 7354/2024, VERIF_01 §2.3) — vérifier la version tzdata ; tests de non-régression sur les dates de l'ancien changement d'heure paraguayen (octobre/mars).
- **Critères d'acceptation** : Given un véhicule à Asunción et un trip débutant le premier dimanche d'octobre à 00:30 locale (ancienne date de passage DST), When la fenêtre de no-show (60 min) est calculée, Then elle expire à 01:30 heure locale UTC−3, soit 04:30 UTC ; Given un guest dont l'appareil est en America/New_York, Then l'écran du trip affiche l'heure de Panama et l'étiquette « hora de Panamá ».

## E. Annulations et modifications

### EC-34 Extension en conflit avec la réservation suivante
- **Scénario** : le guest demande +2 jours alors qu'un autre trip commence dans 1 jour.
- **Déclencheur** : demande d'extension chevauchant un trip ou le tampon.
- **Ce que fait Turo** : DOCUMENTÉ — véhicule indisponible ou conflit avec le tampon : la demande ne peut même pas être soumise ; extension possible jusqu'à 24 h après la fin ; swap pendant le trip via support (SRC_G 5.2–5.3, 5.11).
- **Conséquences** : Locataire — doit rendre à l'heure ou changer de véhicule ; Hôte — opportunité de swap ; Paiements — aucun ; Réservation — inchangée ; Support — demandes de swap.
- **Règles** : BR-MOD-02, BR-MOD-03, BR-BOOK-05, BR-BOOK-10.
- **[NOUS]** : proposer l'extension **maximale possible** (jusqu'au début du tampon) + options : autre véhicule du même hôte ou véhicule similaire à proximité pour les jours restants (nouvelle réservation liée).
- **Critères d'acceptation** : Given un trip se terminant le 10 à 10:00, un tampon de 2 h et un trip suivant le 11 à 10:00, When le guest demande une fin au 12, Then la demande est refusée et l'interface propose une fin au plus tard le 11 à 08:00 ainsi que des véhicules alternatifs pour le 11–12.

### EC-35 Annulation de dernière minute par le guest
- **Scénario** : (a) réservation à J−5, annulation à `T − 3 h` ; (b) réservation à `T − 6 h`, annulation 40 min après ; (c) réservation à `T − 24 h 30`, annulation 50 min après.
- **Déclencheur** : annulation guest.
- **Ce que fait Turo** : DOCUMENTÉ — (a) hors fenêtre : retenue ½ ou 1 jour (b) dans l'heure suivant la réservation : gratuit (c) **ambigu** : seuil 24 h (policy) vs 25 h (help) (BR-CXL-01 ; VERIF_01 V06).
- **Conséquences** : Locataire — retenue variable ; Hôte — part de la retenue ; Paiements — remboursement partiel ; Réservation — `CANCELLED_BY_GUEST` ; Support — contestations.
- **Règles** : BR-CXL-01, BR-CXL-06, BR-CXL-02.
- **[NOUS]** : `lastMinuteThresholdHours = 25` ; afficher la date/heure exacte de fin de gratuité sur le reçu et dans l'écran d'annulation.
- **Critères d'acceptation** : Given (c) avec seuil 25 h, When l'annulation a lieu 50 min après la réservation, Then le remboursement est intégral ; Given (a) pour un trip de 3 jours, Then la retenue = 1 jour de prix + 1 jour de trip fee, calculés ligne par ligne, plus ½ livraison. Sont remboursés : le reste, la protection, les Extras, l'assistance renforcée, les frais de conducteur additionnel et la taxe au prorata de la base taxable remboursée. Pour le trip A de 08 : **187,44**, gains hôte 45,00, test T03. Given (b), Then le remboursement est intégral. Given une réservation à `T − 30 min` annulée à `T + 20 min`, Then l'annulation est tardive et non gratuite, car `freeUntil` = `min(bookedAt + 60 min, T)` (test T23 ; corrigé VERIF_04-A03, A04, A23).

### EC-36 Annulation de dernière minute par l'hôte
- **Scénario** : l'hôte annule 3 h avant le départ (il veut utiliser la voiture).
- **Déclencheur** : annulation hôte < 24 h.
- **Ce que fait Turo** : DOCUMENTÉ — guest remboursé intégralement + crédit de rebooking (discrétionnaire, 24 h pour une annulation moins de 24 h avant le départ ; jusqu'au départ entre 24 et 72 h ; corrigé VERIF_04-A15) ; hôte 50 $ ; avis automatique ; sanctions (≤ 20 trips : dépublication jusqu'au webinaire…) ; All-Star : frais annulés (BR-CXL-12/13 ; SRC_G 4.2.2–4.2.5).
- **Conséquences** : Locataire — remboursement, recherche urgente ; Hôte — pénalité + sanctions ; Paiements — remboursement + débit pénalité ; Réservation — `CANCELLED_BY_HOST` ; Support — rebooking.
- **Règles** : BR-CXL-12, BR-CXL-13, BR-HP-03, BR-REVIEW-06.
- **[NOUS]** : rebooking assisté avec crédit de compensation financé par la pénalité de l'hôte ; l'hôte doit choisir un motif ; motifs « exemptés » exigent une preuve.
- **Exemption** : l'exemption Turo « 1re annulation sur les 10 derniers trips réservés » s'applique précisément au cas d'un hôte sans annulation antérieure. La portée de cette exemption (frais, métriques, dépublication) n'est **pas documentée** chez Turo (OQ-BR-37). Le test applique la table de portée [NOUS] de BR-CXL-13 (corrigé VERIF_04-A06).
- **Critères d'acceptation** :
  - Given un hôte avec 8 trips réservés, `completed_trips` ≤ 20 (régime COMPTEUR) et **1 annulation hôte non excusée** déjà présente dans ses 10 derniers trips, ce qui rend l'exemption « 1re annulation » inapplicable ; aucune autre exemption n'est demandée. When il annule à `T − 3 h` (motif `HOST_CANCELLED`), Then :
    - le guest est remboursé à 100 % ;
    - 50 USD sont débités du `host_ledger`, car `start − cancelRequestedAt` = 3 h, qui n'est pas > 24 h ;
    - un avis automatique est publié ;
    - c'est la 2e annulation du régime COMPTEUR, donc toutes les annonces de l'hôte passent à `RESTRICTED` pendant **3 jours**.
  - Given un hôte avec 8 trips réservés et **0 annulation**. When il annule à `T − 3 h`, Then :
    - l'exemption « 1re annulation sur les 10 derniers trips réservés » est appliquée **avant** le débit ;
    - 0 USD est débité et aucune dépublication n'a lieu ;
    - l'annulation **compte** dans le compteur et dans le taux ;
    - l'avis automatique est publié (table de portée [NOUS]) ;
    - le guest est remboursé à 100 %.

### EC-37 L'hôte retire ou supprime une annonce avec des trips futurs
- **Scénario** : l'hôte vend sa voiture et veut la supprimer alors que 2 trips sont réservés.
- **Déclencheur** : action « unlist » / « delete » sur un véhicule ayant des trips `BOOKED`.
- **Ce que fait Turo** : DOCUMENTÉ partiel — snooze/unlist/suppression possibles, suppression définitive et non transférable ; l'hôte doit honorer chaque trip accepté ; effet sur les trips existants : **NON DOCUMENTÉ** (INFÉRÉ : l'hôte doit les annuler, avec pénalités) (SRC_H H21, H132, H133).
- **Conséquences** : Locataire — annulation ; Hôte — pénalités par trip ; Paiements — remboursements ; Réservation — `CANCELLED_BY_HOST` ; Support — explication.
- **Règles** : BR-LIST-09, BR-CXL-13, BR-HP-03.
- **[NOUS]** : unlist/delete bloqués tant que des trips futurs existent ; l'écran liste les trips et propose « échanger vers un autre véhicule » ou « annuler (pénalités : X) » ; un « snooze » n'affecte jamais les trips déjà réservés.
- **Critères d'acceptation** : Given un véhicule avec 2 trips `BOOKED`, When l'hôte clique sur « eliminar », Then l'action est refusée avec la liste des 2 trips et le coût d'annulation estimé ; When il snooze le véhicule, Then seules les nouvelles réservations sont bloquées.

### EC-38 Compte hôte suspendu pendant un trip
- **Scénario** : l'hôte est suspendu pour fraude alors que son véhicule est loué.
- **Déclencheur** : décision T&S sur le compte hôte.
- **Ce que fait Turo** : DOCUMENTÉ partiel — fermeture : préavis 30 j (ou 90 j après le dernier trip), immédiate en cas de fraude ; trips à plus de 72 h annulés sans gains ; trip en cours : **NON DOCUMENTÉ** (INFÉRÉ : maintenu) (SRC_H H107 ; BR-CXL-14).
- **Conséquences** : Locataire — incertitude sur la validité du trip et de la protection ; Hôte — versements gelés (INFÉRÉ) ; Paiements — versements en attente ; Réservation — trips futurs annulés ; Support — contacts guests.
- **Règles** : BR-HP-05, BR-TRUST-05, BR-PAYOUT-04, BR-CXL-14.
- **[NOUS]** : trip en cours **maintenu** avec protection active (sauf si le véhicule est déclaré volé/frauduleux → récupération organisée et remboursement intégral + relogement) ; trips futurs annulés avec remboursement intégral + crédit ; versements de l'hôte gelés jusqu'à la clôture de l'enquête.
- **Critères d'acceptation** : Given un hôte suspendu avec 1 trip `IN_PROGRESS` et 2 trips `BOOKED`, When la suspension est appliquée, Then le trip en cours reste `IN_PROGRESS` avec protection active, les 2 trips passent à `CANCELLED_BY_PLATFORM` (motif `HOST_ACCOUNT_CLOSED`, remboursement intégral, 0 gain hôte) et les versements de l'hôte passent à `ON_HOLD`.

### EC-39 Compte guest suspendu avec un trip à venir
- **Scénario** : un guest est restreint (chargeback sur un autre trip, comptes liés) alors qu'il a un trip dans 5 jours.
- **Déclencheur** : restriction/retrait d'approbation.
- **Ce que fait Turo** : DOCUMENTÉ partiel — approbation retirable a posteriori ; chargeback : réservation/extension impossibles ; fermeture du compte annule les trips avec frais normaux ; effet d'une **suspension** sur un trip déjà réservé : **NON DOCUMENTÉ** (INFÉRÉ : annulation par Turo, remboursement selon cause) (SRC_G 1.4.4, 1.5.3, 1.6.1).
- **Conséquences** : Locataire — trip annulé ; Hôte — perte du trip (gains selon BR-CXL-14) ; Paiements — remboursement ; Réservation — `CANCELLED_BY_PLATFORM` ; Support — appels.
- **Règles** : BR-TRUST-05, BR-VERIF-04, BR-CXL-14, BR-PAY-11.
- **[NOUS]** : suspension pour risque non prouvé → motif `RISK_SUSPENSION_UNPROVEN`, remboursement intégral ; faute avérée (fraude) → motif `GUEST_FRAUD_PROVEN`, retenue partielle BR-CXL-06. Dans les deux cas, l'hôte reçoit la part BR-CXL-14 si l'annulation intervient après `freeUntil`, c'est-à-dire moins de 24 h avant le départ dans le cas général (corrigé VERIF_04-A11).
- **Critères d'acceptation** : Given un guest avec un trip `BOOKED` à J+5, When son approbation est révoquée pour « comptes liés », Then le trip est annulé immédiatement (motif `RISK_SUSPENSION_UNPROVEN`), le guest est remboursé à 100 %, aucune faute n'étant prouvée, les gains de l'hôte sont de 0 car l'annulation intervient à J−5, avant `freeUntil`, et l'hôte est notifié avec proposition de remettre le créneau en ligne.

### EC-40 Accord hors plateforme entre hôte et guest
- **Scénario** : l'hôte propose au guest de prolonger « en efectivo » via WhatsApp, ou de réserver directement la prochaine fois.
- **Déclencheur** : détection de coordonnées/mots-clés dans la messagerie ; signalement.
- **Ce que fait Turo** : DOCUMENTÉ — marché gris interdit ; sanctions jusqu'à 5 500 $ ; modification hors système invalide et protection perdue ; exceptions (parking en liquide, Extra endommagé, dommage réglé hors Turo) (SRC_G 7.17, 5.1 ; SRC_H H118).
- **Conséquences** : Locataire — non couvert pendant la prolongation non déclarée ; Hôte — sinistre non couvert, sanctions ; Paiements — perte de commission ; Réservation — fin prévue dépassée (`OVERDUE`) ; Support — enquêtes.
- **Règles** : BR-TRUST-02, BR-TRUST-03, BR-MOD-01, BR-PROT-03.
- **[NOUS]** : masquage automatique des téléphones/emails/liens ; avertissement contextuel « una extensión fuera de la app no está asegurada » ; bouton d'extension proposé dans le fil ; retard non déclaré traité comme `OVERDUE` → frais et alerte ; sanction graduée (avertissement, pénalité, bannissement).
- **Critères d'acceptation** : Given un message contenant « +507 6123-4567 » ou « wa.me/ », When il est envoyé, Then le numéro/lien est masqué, l'expéditeur voit un avertissement et un compteur de violations est incrémenté ; Given 3 violations, Then le compte passe en revue T&S.

### EC-41 Réclamation dommage contestée
- **Scénario** : l'hôte réclame 1 200 USD pour un pare-chocs ; le guest affirme que le dommage était préexistant.
- **Déclencheur** : contestation du guest dans le dossier.
- **Ce que fait Turo** : DOCUMENTÉ — photos pré-trip prises ≤ 24 h avant et téléversées ≤ 24 h après le début, métadonnées obligatoires ; dommage préexistant : différence entre devis ; éligibilité ≤ 3 j ouvrés ; expertise tierce ; règlement direct : retrait du guest ≤ 20 jours (SRC_H H72–H78 ; SRC_G 7.8, 7.11).
- **Conséquences** : Locataire — dépôt dommage bloqué ; Hôte — attente ; Paiements — dépôt retenu ; Réservation — `IN_DISPUTE` ; Support — arbitrage.
- **Règles** : BR-DAMAGE-02, BR-DAMAGE-03, BR-DAMAGE-04, BR-DAMAGE-06, BR-PICKUP-03.
- **[NOUS]** : comparaison automatique des photos de départ et de retour par zone du véhicule ; décision motivée écrite (exigence ACODECO/SEDECO) ; recours une fois.
- **Critères d'acceptation** : Given des photos de départ du guest géolocalisées montrant la même rayure, When l'hôte déclare ce dommage, Then le dossier est marqué « préexistant probable » et la réclamation est refusée sauf aggravation prouvée par devis avant/après.

### EC-42 Représailles dans les avis
- **Scénario** : après une facture de nettoyage, le guest laisse 1★ ; l'hôte veut répondre en notant mal le guest.
- **Déclencheur** : avis soumis pendant un litige.
- **Ce que fait Turo** : DOCUMENTÉ — double aveugle (publication quand les deux ont noté ou J+10) ; texte ≥ 25 caractères pour 1–4★ ; retrait seulement pour extorsion, grossièreté, avis incité, données personnelles… ; réponse publique possible (SRC_G 8.1–8.5).
- **Conséquences** : Locataire — avis réciproque ; Hôte — impact sur All-Star et standards qualité (65–70 % de 5★) ; Paiements — aucun ; Réservation — aucune ; Support — demandes de retrait.
- **Règles** : BR-REVIEW-02, BR-REVIEW-05, BR-REVIEW-07, BR-HP-04.
- **[NOUS]** : avis non modifiable après publication ; chantage (« quito la reseña si anulas la factura ») = motif de retrait + sanction ; l'avis lié à une facture finalement annulée reste publié mais l'hôte peut répondre.
- **Critères d'acceptation** : Given les deux parties ayant soumis leur avis, Then les deux sont publiés simultanément ; Given un message de chantage détecté et confirmé par le support, When l'avis correspondant est signalé, Then il est retiré et l'auteur reçoit un avertissement.

### EC-43 Identité frauduleuse
- **Scénario** : réservation avec permis volé et selfie truqué (photo d'écran), carte volée ; objectif : voler le véhicule (pick-up Hilux).
- **Déclencheur** : signaux de risque (carte étrangère + IP VPN + compte neuf + réservation < 3 h + pick-up).
- **Ce que fait Turo** : DOCUMENTÉ — face match biométrique, screening à chaque réservation, Turo Risk Score, dépôt 200 $ si sélectionné, documents supplémentaires ; fausse identité = vol au sens des CGU (SRC_G 1.4 ; SRC_H S1 ; TOS-GUEST).
- **Conséquences** : Locataire (fraudeur) — bannissement, poursuites ; Hôte — risque de vol ; Paiements — chargeback de la carte volée ; Réservation — annulation ; Support — T&S.
- **Règles** : BR-VERIF-01, BR-VERIF-09, BR-TRUST-01, BR-ACC-03.
- **[NOUS]** : liveness actif (pas seulement selfie) ; vérification de la cédula via service officiel si disponible (À VALIDER) ; réservations PREMIUM/pick-up < 3 h par un compte neuf → revue manuelle obligatoire ; remise en main propre exigée au premier trip.
- **Critères d'acceptation** : Given un compte créé il y a 10 min, une carte émise hors du pays de l'IP et une réservation de pick-up commençant dans 2 h, When le checkout est soumis, Then la réservation est créée avec `requirements_status = PENDING` (SM-1b ; corrigé VERIF_04-A07) et les exigences `MANUAL_REVIEW` et `MIN_PROTECTION`, et la remise sans contact est désactivée.

### EC-44 Conducteur mineur ou trop jeune
- **Scénario** : un mineur de 17 ans utilise le compte de son parent ; ou un guest de 19 ans tente un véhicule de 25 000 USD.
- **Déclencheur** : âge déclaré/vérifié < seuil ; face match incohérent.
- **Ce que fait Turo** : DOCUMENTÉ — 18 ans minimum US (21 si > 20 000 $, 25 Deluxe, 30 Super Deluxe/Classic) ; âge à la réservation ; Premier interdit < 21 ; partage de compte interdit (SRC_G 1.2.1 ; VERIF_01 V10).
- **Conséquences** : Locataire — refus ; Hôte — aucune ; Paiements — aucun ; Réservation — bloquée ; Support — faible.
- **Règles** : BR-ACC-04, BR-VERIF-07, BR-ACC-03.
- **[NOUS]** : âge min. 21 (PA/PY) ; âge contrôlé sur la date de naissance du permis **et** à la date de début du trip ; selfie du check-in comparé au titulaire (un mineur ne passe pas le face-match).
- **Critères d'acceptation** : Given un compte dont le permis indique 19 ans, When il recherche, Then les véhicules sont filtrés et la réservation renvoie `AGE_CLASS_MISMATCH` ; Given un selfie de check-in ne correspondant pas au titulaire, Then le check-in échoue (EC-05).

## F. Spécifique Amérique latine

### EC-45 Tentative de sortie du territoire Paraguay → Brésil / Argentine / Bolivie
- **Scénario** : un guest prend un véhicule à Ciudad del Este et se dirige vers le Pont de l'Amitié (Foz do Iguaçu) ; ou vers Encarnación–Posadas, Clorinda, Pedro Juan Caballero (frontière sèche avec Ponta Porã), ou le Chaco vers la Bolivie.
- **Déclencheur** : géofence à 20 km d'un poste frontière ; contrôle douanier ; position GPS à l'étranger.
- **Ce que fait Turo** : DOCUMENTÉ par analogie — US↔CA autorisé, Mexique interdit ; le contrat sert de preuve d'autorisation ; aucun mécanisme de géofencing documenté (SRC_G 6.4.3, 10.2). Contexte PY : le Mercosur exige l'autorisation du loueur/propriétaire, notariée pour un tiers ; trafic de véhicules volés via le Chili/Brésil (13 §4.1, §4.7).
- **Conséquences** : Locataire — violation grave, protection annulée, risque de saisie ; Hôte — véhicule à l'étranger non assuré ; Paiements — pénalité ; Réservation — `UNRETURNED` potentiel ; Support — sécurité, coopération policière.
- **Règles** : BR-GEO-02, BR-PROT-03, BR-RETURN-04, BR-PICKUP-11.
- **[NOUS]** : sortie interdite par défaut (contrat, checkout, instructions en es/pt) ; géofences sur Ponte da Amizade, Ponte Tancredo Neves (Presidente Franco), Encarnación–Posadas, Puerto Falcón–Clorinda, Pedro Juan Caballero, Salto del Guairá, Infante Rivarola (Bolivie) ; à 20 km : notification WhatsApp + appel ; franchissement constaté : pénalité `{param}`, alerte hôte, procédure non-restitution, et coupure moteur à l'arrêt **seulement si validée juridiquement** ; annonces CDE/PJC : GPS obligatoire et caution renforcée ; option « Mercosur » (phase 2) avec autorisation notariée et RC internationale.
- **Critères d'acceptation** : Given un trip à CDE sans option Mercosur, When le GPS entre dans la géofence de 20 km du Pont de l'Amitié, Then une notification est envoyée au guest en es/pt et à l'équipe ops ; When la position est enregistrée au Brésil, Then un incident `BORDER_VIOLATION` est créé, l'hôte est alerté, la protection est marquée suspendue et la pénalité est facturée.

### EC-46 Tentative de sortie du territoire Panama → Costa Rica
- **Scénario** : un touriste veut faire Panama–Costa Rica par Paso Canoas ou Guabito–Sixaola.
- **Déclencheur** : géofence à 20 km de Paso Canoas / Sixaola ; demande au support.
- **Ce que fait Turo** : DOCUMENTÉ par analogie (frontière mexicaine interdite) ; contexte PA : exportation illégale de véhicules volés vers le Costa Rica, récupérations par GPS (12 §4).
- **Conséquences** : identiques à EC-45 ; en plus, le Costa Rica exige des documents d'importation temporaire et une assurance locale (INFÉRÉ, à valider).
- **Règles** : BR-GEO-02, BR-PROT-03, BR-RETURN-04.
- **[NOUS]** : sortie interdite sans exception au lancement ; géofences Paso Canoas, Guabito, Río Sereno ; message proactif dans la fiche des véhicules de Chiriquí/Bocas del Toro.
- **Critères d'acceptation** : Given un véhicule loué à David, When le GPS entre à 20 km de Paso Canoas, Then le guest reçoit « Está prohibido salir de Panamá con este vehículo » et l'ops est notifiée ; Given une demande d'extra « salida a Costa Rica », Then elle n'est pas proposée au catalogue.

### EC-47 L'assureur partenaire refuse la prise en charge d'un sinistre
- **Scénario** : l'assureur local refuse un sinistre (exclusion « usage locatif », conducteur non déclaré, route non revêtue, alcoolémie) alors que la plateforme avait vendu une protection « Total ».
- **Déclencheur** : décision `DECLINED` de l'assureur.
- **Ce que fait Turo** : NON APPLICABLE / NON DOCUMENTÉ — aux US, les protections sont des **contrats Turo** (Turo décide et paie au-delà des franchises) et la RC est une police Travelers ; il n'y a pas d'assureur tiers dont le refus laisserait le guest à découvert (SRC_G 3.1 ; SRC_H H31). Contexte PA/PY : polices auto excluant la location (avenant Ancón), absence d'assurance obligatoire au PY, responsabilité solidaire du propriétaire au PA (12 §3.2, 13 §3.3).
- **Conséquences** : Locataire — se croit couvert, se voit réclamer le dommage ; Hôte — non indemnisé ; Paiements — litige majeur ; Réservation — `IN_DISPUTE` ; Sinistre — SM-4 `INSURER_DECLINED` (corrigé VERIF_04-A09 : état désormais présent dans le diagramme) ; Support — crise, risque ACODECO/SEDECO et réputationnel.
- **Règles** : BR-PROT-01, BR-PROT-03, BR-PROT-04, BR-DAMAGE-04.
- **[NOUS]** : (1) aligner les exclusions affichées au checkout **mot pour mot** sur la police ; (2) états SM-4 `INSURER_DECLINED` → `PLATFORM_GUARANTEE_REVIEW` → région parallèle `SETTLEMENT` (hôte / guest) : si le refus est dû à une exclusion **non communiquée** au guest, la plateforme indemnise (garantie de bonne fin, réserve financière `{param}`) ; si le refus est dû à une faute du guest (exclusion communiquée), la responsabilité revient au guest sans plafond ; (3) recours contre l'assureur ; (4) audit trimestriel des refus.
- **Critères d'acceptation** : Given un dossier refusé par l'assureur pour « route non revêtue », When cette exclusion figurait dans le contrat accepté par le guest, Then le dossier passe de `INSURER_DECLINED` à `SETTLEMENT`, avec `GUEST_INVOICED` sans plafond dans la région guest et la décision de l'assureur jointe ; When l'exclusion n'apparaissait pas dans le contrat, Then le dossier passe à `PLATFORM_GUARANTEE_REVIEW` puis à `SETTLEMENT`. L'hôte est indemnisé par la plateforme selon son plan (région hôte `HOST_PAID`), indépendamment de la région guest. `CLOSED` n'est atteint que lorsque les deux régions sont terminées.

### EC-48 Amende imputée au propriétaire (Panama) après la fin du trip
- **Scénario** : une infraction ATTT est enregistrée au nom du propriétaire ; le paz y salvo de l'hôte est bloqué par des passages Panapass sans solde.
- **Déclencheur** : notification ATTT/ENA reçue par l'hôte.
- **Ce que fait Turo** : DOCUMENTÉ par analogie — transfert de responsabilité aux US pour les infractions à points, refacturation sinon (SRC_G 6.7.2).
- **Conséquences** : Locataire — facture tardive ; Hôte — démarches administratives, blocage du véhicule (paz y salvo) ; Paiements — refacturation ; Réservation — trip inchangé (`COMPLETED`) ; la facture SM-5 est liée au trip (corrigé VERIF_04-A08) ; Support — documentation.
- **Règles** : BR-TT-01, BR-TT-03, BR-REIMB-01.
- **[NOUS]** : exiger un Panapass avec solde minimum à chaque trip ; relevé Panapass rapproché automatiquement des dates du trip ; attestation de location (contrat + identité) fournie à l'hôte pour contester l'imputation lorsque la procédure le permet.
- **Critères d'acceptation** : Given une amende Panapass horodatée pendant le trip, When l'hôte la soumet avec l'avis, Then la facture inclut le montant + frais, et un PDF « constancia de arrendamiento » est généré pour l'hôte.

### EC-49 Paiement par QR/Yappy et remboursement
- **Scénario** : un trip payé par QR Bancard (PY) ou Yappy (PA) est annulé et doit être remboursé partiellement.
- **Déclencheur** : remboursement sur un moyen non réversible.
- **Ce que fait Turo** : NON APPLICABLE — Turo ne propose que des cartes/wallets réversibles ; remboursement impossible sur le moyen d'origine → crédit voyage (TOS-FEES).
- **Conséquences** : Locataire — attend un remboursement sur un moyen sans « refund » natif ; Hôte — aucune ; Paiements — virement sortant requis ; Réservation — annulée ; Support — collecte de coordonnées bancaires.
- **Règles** : BR-PAY-01, BR-PAY-08.
- **[NOUS]** : au paiement QR/Yappy, le guest choisit d'avance le mode de remboursement (crédit immédiat ou virement vers un compte à son nom) ; virement ACH Xpress / SIPAP sous 2 jours ouvrés (**P0-B seulement** ; en P0-A, virement de l'agence, 08 C08-11 ; VERIF_18-F13) ; vérification de titularité du compte.
  - (corrigé VERIF_09-M02, M03) Rail choisi selon E3 de 08 : `NATIVE_PARTIAL` si `supports_partial_refund[psp][méthode]` est validé (Yappy via Tilopay : inconnu, OQ-PAY-22 ; via PagueloFacil : non) ; Bancard vPOS (rollback total seulement) : `ROLLBACK_AND_RECHARGE` si la carte est tokenisée avec consentement MIT, sinon `BANK_TRANSFER` ; jamais de conversion en crédit sans accord. Si le trip a été payé en partie par carte et en partie par Yappy, la retenue est imputée d'abord sur Yappy (moyen non natif), pour limiter les virements sortants (test T33 : carte remboursée 150,00 en natif, Yappy 37,44 par virement).
- **Critères d'acceptation** : Given un trip payé par QR et annulé avec remboursement de 450 000 PYG, When le guest a choisi « virement », Then un payout SIPAP vers le compte vérifié est créé sous 2 jours ouvrés et son statut est visible dans le reçu ; When il a choisi « crédit », Then un crédit `credit_cash` non expirant de 450 000 PYG est créé immédiatement.
  - Given un remboursement Yappy sans choix enregistré, When le règlement est exécuté, Then SM-8 passe à `PENDING_CUSTOMER_CHOICE`, des relances partent à J+1, J+3 et J+7, et **aucun** crédit n'est créé automatiquement (corrigé VERIF_09-M03).

### EC-50 Touriste dépassant 90 jours de validité du permis étranger (Panama)
- **Scénario** : un touriste entré au Panama il y a 80 jours réserve un trip de 20 jours.
- **Déclencheur** : date d'entrée + 90 jours < fin du trip.
- **Ce que fait Turo** : NON APPLICABLE (règle locale) ; Turo exige un permis valide du début à la fin du trip (SRC_G 1.3.3, 1.3.6).
- **Conséquences** : Locataire — conduite illégale après J+90, protection nulle ; Hôte — risque ; Paiements — aucun ; Réservation — à refuser ou raccourcir ; Support — explication.
- **Règles** : BR-VERIF-02, BR-ACC-04.
- **[NOUS]** : pour un permis étranger au PA, saisie de la date d'entrée (tampon passeport) ; fin du trip limitée à entrée + 90 jours ; résident avec permis étranger refusé.
- **Critères d'acceptation** : Given un permis étranger et une date d'entrée au 2026-08-01, When le guest tente une fin de trip au 2026-11-05 (J+96), Then la réservation est refusée avec le motif « permiso extranjero válido 90 días » et la fin maximale proposée est le 2026-10-30.

### EC-51 Double réservation concurrente (course)
- **Scénario** : deux guests cliquent « Reservar » sur le même véhicule et les mêmes dates à 200 ms d'intervalle ; un troisième arrive via un import iCal tardif d'un loueur pro.
- **Déclencheur** : requêtes concurrentes sur un intervalle chevauchant.
- **Ce que fait Turo** : INFÉRÉ — acceptation selon disponibilité (H21) ; mécanisme de verrouillage non publié ; aucun hold de panier observé (BR-BOOK-10).
- **Conséquences** : Locataire perdant — erreur, autorisation à libérer ; Hôte — risque de double engagement ; Paiements — autorisations orphelines ; Réservation — un seul gagnant ; Support — plaintes.
- **Règles** : BR-BOOK-10, BR-BOOK-07, BR-BOOK-05.
- **[NOUS]** : contrainte d'exclusion `tstzrange` + hold de 10 min + idempotence + void automatique (BR-BOOK-10) ; conflit créé par un import iCal → le trip confirmé prime et l'hôte est alerté.
- **Critères d'acceptation** : Given 100 requêtes concurrentes de checkout sur le même créneau, Then exactement 1 hold est créé et 99 réponses `409 VEHICLE_UNAVAILABLE` sont renvoyées ; Given un hold expiré pendant un 3-D Secure et un autre guest ayant obtenu le créneau, When l'autorisation du premier aboutit, Then elle est annulée (void) dans les 5 min et le premier guest est notifié avec des alternatives ; Given un import iCal créant un blocage sur un trip confirmé, Then le blocage est rejeté et l'hôte reçoit une alerte de conflit.

### EC-52 Échec de paiement d'un segment mensuel (Pay as you go)
- **Scénario** : au 2e segment d'un trip de 90 jours, le débit échoue ; le guest garde le véhicule.
- **Déclencheur** : échec du débit du segment à l'échéance.
- **Ce que fait Turo** : DOCUMENTÉ — échec → trip raccourci et retour du véhicule ; véhicule non rendu après raccourcissement → peut être déclaré volé (SRC_G 2.6.4 ; TOS-GUEST).
- **Conséquences** : Locataire — fin anticipée imposée ; Hôte — perte de revenus prévus ; Paiements — segment impayé ; Réservation — fin ramenée à la fin du segment payé ; Support — relances.
- **Règles** : BR-PAY-04, BR-RETURN-04, BR-PAYOUT-03.
- **[NOUS]** : 2 relances sur 48 h, puis nouvelle fin = fin du segment payé + 24 h de grâce ; au-delà, procédure non-restitution (EC-20).
- **Critères d'acceptation** : Given un segment n°2 dont le débit échoue à J−5, When aucune régularisation n'a lieu à J−3, Then la fin du trip est fixée à la fin du segment n°1 + 24 h, le guest et l'hôte sont notifiés et le versement partiel suivant de l'hôte n'est pas émis.
  - (corrigé VERIF_09-M01) Given un trip de 60 jours (deux segments E de 1 412,40 chacun) dont seul le segment 1 est encaissé, When l'hôte annule à T−48 h, Then le remboursement en fonds vaut **1 412,40** (l'encaissé), l'échéance du segment 2 est annulée et la pénalité est de 25 (test T31) ; When c'est le guest qui annule à T−10 h, Then le règlement porte sur le segment 1 seul (`days` = 30) : remboursement 1 365,32, hôte 30,00 (test T30). La fin forcée pour impayé utilise le motif `TERM_PAYMENT_FAILURE` (n° 25).

### EC-53 Mauvaise route / zone exclue (routes non revêtues, Darién, Chaco)
- **Scénario** : un guest emmène une berline sur une piste du Darién ou du Chaco après la pluie ; dommages au soubassement.
- **Déclencheur** : sinistre ou données GPS dans une zone exclue.
- **Ce que fait Turo** : DOCUMENTÉ — tout-terrain interdit (annule la protection) ; dessous de pare-chocs et soubassement exclus côté hôte ; l'hôte ne peut pas restreindre la zone (SRC_G 7.16 ; SRC_H H31, H128).
- **Conséquences** : Locataire — responsabilité non plafonnée ; Hôte — dommages exclus de son plan ; Paiements — facture dommage ; Réservation — `IN_DISPUTE` ; Support — preuve GPS.
- **Règles** : BR-GEO-01, BR-PROT-03, BR-PROT-09, BR-TRUST-04.
- **[NOUS]** : zones exclues définies par l'hôte ou par défaut (polygones) affichées au checkout ; alerte GPS à l'entrée ; véhicules 4x4 labellisés exemptés selon la police.
- **Critères d'acceptation** : Given une berline avec exclusion « Darién », When le GPS entre dans le polygone, Then le guest reçoit une alerte et l'événement est horodaté dans le dossier du trip ; Given un sinistre ultérieur au soubassement, Then l'événement GPS est joint automatiquement à la réclamation.

---

### EC-54 Événements d'annulation concurrents et rejeux (corrigé VERIF_09-M04)
- **Scénario** : à T + 61 min, le guest clique « Annuler » pendant que l'hôte déclare le no-show ; le webhook de remboursement du PSP est livré deux fois ; le passage automatique à T + 72 h tourne alors qu'un règlement existe déjà.
- **Déclencheur** : deux événements qualifiants (ou plus) pour le même trip, ou un rejeu technique.
- **Ce que fait Turo** : NON DOCUMENTÉ.
- **Conséquences** : Locataire — risque de double remboursement ou de règlement contradictoire ; Hôte — gains versés deux fois ou annulés à tort ; Paiements — doublons chez le PSP ; Réservation — état SM-1 incohérent ; Support — litiges.
- **Règles** : BR-CXL-08 et règles de qualification 4 et 5 du modèle de règlement BR-CXL (08), SM-1 (invariant 4), SM-7, SM-8 ; 08 E4.
- **[NOUS]** : verrou de la ligne du trip ; un seul règlement par `(trip, segment, version)` ; premier événement validé sous verrou = version 1 ; événement incompatible suivant → `409 SETTLEMENT_EXISTS`, journalisé, et litige SM-7 s'il conteste ; clé d'idempotence sur chaque opération ; webhooks dédoublonnés par `(provider, provider_event_id)`.
- **Critères d'acceptation** :
  - Given le trip A sans check-in, When l'annulation du guest (T + 61 min) et la déclaration de no-show de l'hôte (T + 61 min) arrivent à 50 ms d'intervalle, Then un seul règlement existe (version 1, `GUEST_NO_SHOW`, 138,22 / 75,00), l'autre requête reçoit `409 SETTLEMENT_EXISTS`, et une seule opération `REFUND` de 138,22 figure au registre.
  - Given le même webhook `refund.succeeded` reçu deux fois, Then SM-8 ne change d'état qu'une fois et aucune écriture comptable n'est dupliquée.
  - Given une requalification SM-7 de T08 vers T07 après exécution du remboursement, Then la version 2 est créée, les écritures de la version 1 sont contre-passées (aucune modification), et un débit MIT de 118,44 est émis au guest ; la pénalité de 50 est annulée (test T36).
  - **Requalification avant exécution** (corrigé VERIF_11-M1) : Given T08 payé par Yappy avec le remboursement de 256,66 encore en `PENDING_CUSTOMER_CHOICE`, When SM-7 requalifie en T07, Then l'instance v1 passe `SUPERSEDED` et un seul remboursement de **138,22** est créé pour la version 2 (et non 256,66 + 138,22 = 394,88 ; test T49) ; Given le même cas avec le remboursement v1 déjà `SENT`, Then il n'est pas annulé et un débit MIT de 118,44 est émis (test T50).

### EC-55 Trip payé par plusieurs moyens (crédit, promo, wallet, carte) puis annulé (corrigé VERIF_09-M02)
- **Scénario** : un guest panaméen paie 256,66 avec 20,00 de crédit promo, 30,00 de carte cadeau (crédit cash), 56,66 par Yappy et 150,00 par carte, puis annule hors fenêtre gratuite.
- **Déclencheur** : remboursement partiel d'un paiement réparti.
- **Ce que fait Turo** : DOCUMENTÉ partiel — crédit promo limité au prix du véhicule ; remboursement impossible sur le moyen d'origine → crédit voyage (TOS-FEES ; BR-PAY-07) ; ordre d'imputation entre moyens : NON DOCUMENTÉ.
- **Conséquences** : Locataire — ne sait pas où est remboursé quoi ; Hôte — aucune (sa part ne dépend pas du moyen) ; Paiements — remboursements sur des rails hétérogènes, dont un sans remboursement partiel ; Réservation — annulée ; Support — explications.
- **Règles** : BR-PAY-01, BR-PAY-07, BR-PAY-08 ; 08 E2, E3, SM-8.
- **[NOUS]** : retenue imputée dans l'ordre crédit promo → crédit cash → moyens externes non natifs → moyens externes natifs ; le crédit promo n'est jamais converti en argent ; il est réémis (échéance au moins +30 j) pour sa part non consommée ; reçu détaillant le remboursement par moyen.
- **Critères d'acceptation** :
  - Given ce paiement réparti et le règlement T03 (remboursement 187,44, retenue 69,22), When le règlement est exécuté, Then la carte est remboursée de **150,00** (rail natif), Yappy de **37,44** (rail alternatif, consentement requis), le crédit cash de 0 et le crédit promo de 0 (test T33).
  - Given le même paiement et une annulation de l'hôte à T−30 h, Then la carte reçoit 150,00, Yappy 56,66, le crédit cash est recréé pour 30,00 et le crédit promo réémis pour 20,00 avec une échéance au moins égale à aujourd'hui + 30 j (test T34).
  - Given un trip PYG débité en USD sur une carte de débit (dLocal), When il est remboursé, Then le remboursement est émis en USD au ratio de la capture d'origine et l'écart de change est inscrit au compte `fx_difference`.
  - **Encaissé et crédits** (corrigé VERIF_11-M3) : les crédits utilisés comptent dans `collected_total` ; T33 : remboursement total 187,44, entièrement en fonds ; T34 : remboursement total 256,66, dont **206,66 en fonds** et 50,00 réémis en crédit. Given A payé par 200,00 de crédit cash et 56,66 par carte et le règlement T03, Then la carte est remboursée de 56,66, le crédit cash est recréé pour 130,78 et **aucun débit MIT** n'est émis (test T56).

### EC-56 Dommage signalé pendant que la caution est encore bloquée (corrigé VERIF_11-M4)
- **Scénario** : trip A avec caution de 300,00 pré-autorisée ; au retour, carburant manquant (12,00 au barème du contrat) ; 20 h après la fin, l'hôte signale une rayure.
- **Déclencheur** : `Claim` ouverte avant `release_at`.
- **Ce que fait Turo** : DOCUMENTÉ — la libération du dépôt (80 h : valeur Turo, non reprise ; nous : 72 h, jamais suspendue) est suspendue en cas de dommage signalé (BR-PAY-06, SRC_G 2.5).
- **Conséquences** : Locataire — fonds bloqués plus longtemps si la caution attend la Claim ; Hôte — croit que la caution couvre le dommage ; Paiements — autorisation qui expire à 5–7 jours chez les PSP accessibles ; Support — contestations ACODECO.
- **Règles** : BR-PAY-06, BR-PAY-09 bis (REQ-PAY-DMG-02, 04 à 07), SM-4, E3 de 08.
- **[NOUS]** (divergence volontaire) : la caution ne garantit que les frais annexes acceptés au checkout ; elle est décidée à `min(fin + 72 h, auth_expiry − 2 h)` sans attendre la Claim ; le dommage est un débit séparé sur la carte enregistrée, après notification sous 10 jours et accord (Mastercard, Amex) ou préavis de 20 jours (Visa).
- **Critères d'acceptation** :
  - Given ce trip chez un PSP à 7 jours (`auth_at` = T − 24 h), When la décision de caution a lieu à fin + 70 h, Then 12,00 sont capturés, 288,00 sont annulés (`VOID`) et la Claim reste ouverte sans effet sur la caution (test T57).
  - Given le même trip chez un PSP sans capture partielle, Then 300,00 sont annulés et 12,00 sont débités par MIT `DELAYED_CHARGES` (test T58).
  - Given la Claim acceptée et un devis de 180,00, When la notification est envoyée à J+4 sur une carte Visa sans accord du guest, Then aucun débit n'a lieu avant J+24, et jamais sur la caution.

### EC-57 Agence défaillante après avoir encaissé (P0-A) (ajouté A24-14)
- **Scénario** : en P0-A, l'agence encaisse le loyer (et parfois la caution) sur son propre PSP ; avant le départ, elle ne remet pas le véhicule (flotte saisie, cessation d'activité, faillite, disparition, compte PSP gelé), refuse ou ne peut pas rembourser, ou ses annonces étaient fictives.
- **Déclencheur** : no-show agence (EC-02) sans remboursement exécuté sous `agency_refund_deadline_business_days` (5 j ouvrés, UXQ-10) ; ou plusieurs signalements simultanés sur la même agence ; ou alerte PSP (compte gelé, rétrofacturations en série).
- **Ce que fait Turo** : NON APPLICABLE — Turo encaisse lui-même et reverse à l'hôte après le trip (BR-PAYOUT) ; ce risque n'existe pas sous cette forme chez Turo.
- **Conséquences** : Locataire — a payé sans véhicule, souvent touriste à l'aéroport ; recours seulement contre l'agence (la plateforme ne détient aucun fonds) ; Hôte — sans objet (c'est l'agence) ; Paiements — aucun fonds à rembourser côté plateforme ; recours du guest par chargeback carte (impossible pour Yappy / QR) ; Réservation — tous les trips futurs de l'agence deviennent incertains ; Support — pic de plaintes, risque ACODECO / SEDECO et réputationnel majeur pour la marketplace.
- **Règles** : BR-TRUST-09 (PROPOSÉ), BR-CXL-12 / BR-CXL-13 (annulation par l'hôte), BR-TRUST-05 (suspension), LEG-025 (exécution sous 5 j ouvrés, pénalité).
- **[NOUS] Comportement recommandé (PROPOSÉ)** : (1) **prévention** : KYB renforcé de l'agence (US-108 : existence légale, ancienneté, propriété ou contrat de la flotte, police flotte), plafond de prépaiement par agence nouvelle (`agency_new_prepay_cap_minor`, défaut : aucun prépaiement au-delà d'une journée de loyer pendant les 30 premiers trips, PROPOSÉ), paiement uniquement vers le compte PSP vérifié de l'agence (jamais un compte personnel) ; (2) **garantie** : dépôt de garantie ou garantie bancaire de l'agence au contrat-cadre, ou assurance de la plateforme couvrant la défaillance d'un partenaire (F-18), à valider par l'avocat et l'assureur (OQ-MK-11) ; (3) **détection** : suspension automatique des nouvelles réservations de l'agence au 2e no-show agence non remboursé en 30 jours, ou à l'alerte PSP ; (4) **réaction** : relogement du guest chez une autre agence (geste commercial plafonné, ADM-031), contact proactif de tous les guests à venir de l'agence, assistance au chargeback, dossier transmis à l'autorité si fraude ; (5) **transparence** : la fiche et le reçu disent que l'agence encaisse et reste responsable du remboursement.
- **Critères d'acceptation** :
  - Given une agence avec un no-show agence non remboursé à J+5 ouvrés, When un 2e cas survient en 30 jours, Then l'agence passe `SUSPENDED_NEW_BOOKINGS`, ses trips futurs sont listés à l'ops et chaque guest concerné reçoit une notification.
  - Given une agence de moins de 30 trips, When un guest réserve 5 jours, Then le montant payable à l'avance n'excède pas `agency_new_prepay_cap_minor` et le reste est dû au comptoir.
  - Given une agence dont le compte PSP vérifié n'est pas enregistré, When elle tente de publier une annonce, Then `AGENCY_PSP_ACCOUNT_NOT_VERIFIED`.

## G. Tableau de couverture (edge cases → règles BR)

| EC | Thème | Règles BR principales | Statut Turo |
|---|---|---|---|
| EC-01 | No-show guest | BR-CXL-08, BR-CXL-15, BR-CXL-16, BR-PICKUP-04, BR-PAY-06 | DOCUMENTÉ (part hôte sur la ½ livraison : NON DOCUMENTÉ, OQ-BR-36) |
| EC-02 | No-show hôte | BR-CXL-12, BR-CXL-13, BR-HP-03 | DOCUMENTÉ |
| EC-03 | Véhicule indisponible / swap | BR-MOD-08, BR-HP-03, BR-BOOK-10 | DOCUMENTÉ |
| EC-04 | Véhicule endommagé/sale au départ | BR-CXL-04, BR-PICKUP-03/06, BR-CSP-03, BR-DAMAGE-06 | DOCUMENTÉ |
| EC-05 | Autre personne envoyée | BR-PICKUP-07, BR-VERIF-07, BR-CXL-08 | DOCUMENTÉ |
| EC-06 | Conducteur additionnel | BR-VERIF-08, BR-PRICE-08, BR-ACC-04, BR-PROT-03 | DOCUMENTÉ |
| EC-07 | Échec de vérification | BR-VERIF-02/05/11, BR-CXL-07 | DOCUMENTÉ |
| EC-08 | Retard de vol | BR-CXL-09, BR-CXL-10, BR-MOD-02 | DOCUMENTÉ (2 formulations) |
| EC-09 | Livraison aéroport échouée | BR-PICKUP-09, BR-PRICE-09, BR-CXL-13 | partiel / NON DOCUMENTÉ |
| EC-10 | Rappel de sécurité | BR-LIST-06, BR-CXL-14, BR-HP-03 | DOCUMENTÉ |
| EC-11 | Panne en cours de trip | BR-PROT-05, BR-MOD-08, BR-FUEL-03, BR-MOD-04 | partiel (remboursement non documenté) |
| EC-12 | Accident | BR-DAMAGE-01→09/13, BR-PROT-04 | DOCUMENTÉ |
| EC-13 | Vol | BR-DAMAGE-09/10, BR-PICKUP-11 | DOCUMENTÉ (CGU) |
| EC-14 | Clé perdue | BR-DAMAGE-12, BR-PROT-05 | DOCUMENTÉ (pas de forfait) |
| EC-15 | GPS hors ligne | BR-PICKUP-11, BR-GEO-02, BR-DAMAGE-11 | NON DOCUMENTÉ |
| EC-16 | Événement naturel | BR-MOD-10, BR-RETURN-03, BR-HP-03, BR-CXL-09 | DOCUMENTÉ |
| EC-17/18/19/20 | Retards 20 min / 1 h 15 / 3 h / > 24 h | BR-RETURN-03/04, BR-MOD-08, BR-BOOK-05, BR-DAMAGE-10, BR-TRUST-05 | DOCUMENTÉ |
| EC-21 | Retour anticipé | BR-MOD-04, BR-CXL-11, BR-RETURN-07 | DOCUMENTÉ |
| EC-22 | Dépassement de kilométrage | BR-MILEAGE-01/03, BR-PRICE-17, BR-REIMB-01 | DOCUMENTÉ |
| EC-23 | Carburant / batterie | BR-FUEL-01/02, BR-EV-01, BR-REIMB-01 | DOCUMENTÉ |
| EC-24 | Péages/amendes tardifs | BR-TT-02/03, BR-PAY-09/10 | DOCUMENTÉ |
| EC-25 | Animaux / tabac | BR-CSP-01/02/04, BR-REIMB-05 | DOCUMENTÉ |
| EC-26 | Carte refusée (réservation) | BR-PAY-01/02, BR-BOOK-10 | INFÉRÉ |
| EC-27 | Carte refusée (caution) | BR-PAY-06, BR-VERIF-09, BR-CXL-07 | NON DOCUMENTÉ |
| EC-28 | Carte refusée (post-trip) | BR-PAY-09/10, BR-DAMAGE-08, BR-ACC-10 | DOCUMENTÉ |
| EC-29 | Panne PSP | BR-BOOK-10, BR-PAY-02, BR-MOD-03 | NON DOCUMENTÉ |
| EC-30 | Remboursement partiel BNPL | BR-PAY-05, BR-CXL-06, BR-PAY-08 | DOCUMENTÉ |
| EC-31 | Chargeback | BR-PAY-11, BR-ACC-10, BR-PAYOUT-04 | DOCUMENTÉ (effet hôte NON DOCUMENTÉ) |
| EC-32 | Arrondis PYG | BR-PRICE-14, BR-PRICE-12, BR-CXL | partiel (TOS) |
| EC-33 | Fuseaux / DST | BR-CXL-00, BR-RETURN-03, BR-PICKUP-04 | partiel |
| EC-34 | Extension en conflit | BR-MOD-02/03, BR-BOOK-05/10 | DOCUMENTÉ |
| EC-35 | Annulation tardive guest | BR-CXL-01/02/06 | DOCUMENTÉ (contradiction 24/25 h) |
| EC-36 | Annulation tardive hôte | BR-CXL-12/13, BR-HP-03, BR-REVIEW-06 | DOCUMENTÉ (portée des exemptions : NON DOCUMENTÉ, OQ-BR-37) |
| EC-37 | Annonce supprimée avec trips futurs | BR-LIST-09, BR-CXL-13, BR-HP-03 | NON DOCUMENTÉ |
| EC-38 | Hôte suspendu en cours de trip | BR-HP-05, BR-TRUST-05, BR-PAYOUT-04, BR-CXL-14 | partiel |
| EC-39 | Guest suspendu avec trip à venir | BR-TRUST-05, BR-VERIF-04, BR-CXL-14, BR-PAY-11 | NON DOCUMENTÉ |
| EC-40 | Accord hors plateforme | BR-TRUST-02/03, BR-MOD-01, BR-PROT-03 | DOCUMENTÉ |
| EC-41 | Réclamation contestée | BR-DAMAGE-02/03/04/06, BR-PICKUP-03 | DOCUMENTÉ |
| EC-42 | Représailles dans les avis | BR-REVIEW-02/05/07, BR-HP-04 | DOCUMENTÉ |
| EC-43 | Identité frauduleuse | BR-VERIF-01/09, BR-TRUST-01, BR-ACC-03 | DOCUMENTÉ (mécanismes INFÉRÉS) |
| EC-44 | Conducteur mineur / trop jeune | BR-ACC-04, BR-VERIF-07, BR-ACC-03 | DOCUMENTÉ |
| EC-45 | Sortie PY → BR/AR/BO | BR-GEO-02, BR-PROT-03, BR-RETURN-04, BR-PICKUP-11 | par analogie (Mexique) |
| EC-46 | Sortie PA → CR | BR-GEO-02, BR-PROT-03, BR-RETURN-04 | par analogie |
| EC-47 | Refus de l'assureur partenaire | BR-PROT-01/03/04, BR-DAMAGE-04 | NON APPLICABLE chez Turo |
| EC-48 | Amende imputée au propriétaire (PA) | BR-TT-01/03, BR-REIMB-01 | par analogie |
| EC-49 | Remboursement QR/Yappy | BR-PAY-01, BR-PAY-08 | NON APPLICABLE |
| EC-50 | Permis touriste 90 jours (PA) | BR-VERIF-02, BR-ACC-04 | NON APPLICABLE |
| EC-51 | Double réservation (course) | BR-BOOK-10, BR-BOOK-07, BR-BOOK-05 | INFÉRÉ |
| EC-52 | Échec de segment mensuel | BR-PAY-04, BR-RETURN-04, BR-PAYOUT-03 | DOCUMENTÉ |
| EC-53 | Zone exclue / tout-terrain | BR-GEO-01, BR-PROT-03/09, BR-TRUST-04 | DOCUMENTÉ |
| EC-54 | Événements concurrents / rejeux | BR-CXL (qualification 4–5), SM-1, SM-7, SM-8 | NON DOCUMENTÉ (corrigé VERIF_09-M04) |
| EC-55 | Paiement réparti puis annulé | BR-PAY-01/07/08, SM-8 | partiel (ordre d'imputation NON DOCUMENTÉ ; corrigé VERIF_09-M02) |
| EC-56 | Dommage signalé, caution encore bloquée | BR-PAY-06, BR-PAY-09 bis, SM-4 | DOCUMENTÉ (Turo suspend ; [NOUS] diverge, corrigé VERIF_11-M4) |
| EC-57 | Agence défaillante après avoir encaissé (P0-A) | BR-TRUST-09, BR-CXL-12/13, BR-TRUST-05 | NON APPLICABLE (ajouté A24-14 ; [NOUS] PROPOSÉ, OQ-MK-11) |

Sections BR sans edge case dédié (couvertes indirectement) : BR-COHOST (co-hôte agissant hors permissions → à ajouter en V2), BR-NOTIF (testée via les critères de chaque EC), BR-LIST-07 (inspection échue : variante d'EC-10).

## H. Edge cases dont le traitement par Turo reste non documenté

1. **EC-09** — livraison aéroport échouée (hôte bloqué à l'entrée, véhicule introuvable) : aucun article ; traitement INFÉRÉ comme no-show hôte.
2. **EC-11** — remboursement des jours non utilisés après une panne non imputable au guest.
3. **EC-15** — panne du tracker GPS pendant un trip (y compris pour les véhicules ≥ 125 000 $ où le tracker conditionne la couverture).
4. **EC-27** — échec de l'autorisation de caution après la réservation.
5. **EC-29** — indisponibilité du prestataire de paiement (holds, extensions, captures différées).
6. **EC-31** — effet d'un chargeback guest sur les gains déjà versés à l'hôte.
7. **EC-37** — sort des trips futurs quand l'hôte unliste ou supprime un véhicule.
8. **EC-38** — sort d'un trip **en cours** quand le compte de l'hôte est suspendu.
9. **EC-39** — sort d'un trip à venir quand le compte du guest est suspendu (hors fermeture volontaire et chargeback).
10. **EC-51** — mécanisme de verrouillage anti-double réservation (aucun hold observé ni documenté).
11. **EC-33** — gestion des changements d'heure (DST) dans les fenêtres d'annulation/no-show.
12. **EC-32** — devises sans décimale : Turo n'opère dans aucune (règle d'arrondi exacte non publiée même en USD).
13. **EC-47, EC-49, EC-50** — spécifiques LATAM, sans équivalent chez Turo (assureur tiers décideur, paiements non réversibles, validité 90 jours du permis touriste).
14. **EC-45/46/48** — seulement documentés par analogie (frontière mexicaine, transfert de responsabilité US).
15. **EC-01 / EC-05** — remboursement des frais de conducteur additionnel en cas de no-show, et part hôte sur la ½ livraison retenue depuis l'application de la part du plan à la livraison (08/10/2026) → OQ-BR-36, OQ-BR-38 (corrigé VERIF_04-A03, A12).
16. **EC-36** — portée d'une exemption d'annulation hôte (frais, métriques, dépublication, avis) → OQ-BR-37 (corrigé VERIF_04-A06).
17. **§0** — légalité même du P2P (OQ-BR-35, P0) : risque transverse, non documentable chez Turo (corrigé VERIF_04-A10).
18. **EC-54 / EC-55** — concurrence des événements d'annulation et répartition d'un remboursement entre plusieurs moyens de paiement (corrigé VERIF_09-M02, M04).
19. **EC-11** — règle de fin anticipée désormais spécifiée côté [NOUS] (motifs 22–26 de 08), toujours non documentée chez Turo (corrigé VERIF_09-M06).
