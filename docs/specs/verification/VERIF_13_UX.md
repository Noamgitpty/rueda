# VERIF_13 — Audit indépendant de 10b_UX_UI_ANALYSIS.md (UX/UI de Turo, principes et exigences UX, 24 écrans P0-A, parcours, métriques, plan de test pilote)

> Auditeur indépendant (UX + produit), 2026-10-30. Fichiers revus **non modifiés**. Sources comparées : 03, 05, 06, 08 (BR-PAY-06, BR-PAY-08, BR-VERIF-10, BR-CXL-01/06/07), 09b (§2.1 Yappy), 12 §3.4/§3.7, 15 (IMP-xx cités), 18 (§0, §1.0–1.3), 04_FEATURE_INVENTORY.csv (147 lignes P0-A + 13 P0-B ; analyse par `python -I`), SRC_GUEST_DOCS (§1.4, §2.5, §4.1, §8) pour les rattachements DOCUMENTÉ.
> Méthode : lecture intégrale de 10b ; contrôle de 34 citations de constats sur Turo ; liste des lignes P0-A à implication d'interface projetée sur les 24 écrans ; contrôle des identifiants UX-01..63 (63 présents, aucune lacune) et des 24 écrans (14 S + 9 A + 1 O = 24, confirmé) ; contrôle des 7 blocs Mermaid (crochets, accolades, guillemets équilibrés) ; croisement des exigences avec 04/08/09b/18.

## 0. Verdict

**GO CONDITIONNEL.** Le document est solide : constats Turo très majoritairement exacts et correctement étiquetés, desktop et apps natives correctement déclarés NON OBSERVÉS, aucune reprise de l'identité visuelle de Turo, accessibilité formulée comme exigence, Mermaid syntaxiquement valide. **0 CRITIQUE, 8 MAJEUR, 14 MINEUR.** Les MAJEUR sont des incohérences avec 04/18 (vérification avant paiement non tenable en P0-A, phases Bêta, caution P0-A, Yappy), des écrans P0-A manquants et un plan de test qui vise des fonctions absentes de la Bêta. À corriger avant que 10b serve de base de conception.

## 1. Constats

### MAJEUR

**V13-01 — Le principe n° 2 « Éligibilité avant paiement » (§3.0, UX-32, A4) n'est pas tenable avec le périmètre 04/18 en P0-A et en Bêta.**
04 VER-007 (Bêta MANUEL) : « l'ops contrôle statut et date d'entrée à la revue de chaque réservation » ; dépassement des 90 jours ou résident avec permis étranger = « signalement en revue manuelle (ADM-029), pas de refus automatique » avant l'avis OQ-BR-21. BKG-012 liste « réservation en revue (ADM-029) » parmi les contrôles bloquants *avant paiement*, sans dire que le lien de paiement attend la décision. 10b §3.0 écrit « Personne ne paie un trip qu'il n'a pas le droit de conduire » ; UX-35 et le flux 4.2.2 (branche `T3 -->|non, P0-A| T4 --> S`) laissent le guest poursuivre jusqu'au checkout avec un simple avertissement. C'est exactement le scénario que A4/§1.4 présentent comme le pire (refus après paiement). *Correction* : soit le lien de paiement n'est émis qu'après décision de l'ops pour les cas signalés (état « en attente de validation », sans débit), soit reformuler le principe (« sauf cas signalés, remboursés intégralement si refus »), et le lier à BR-CXL-07 (remboursement intégral quand le retard vient de notre file de revue, `PLATFORM_REVIEW_DELAY`).

**V13-02 — Étiquetage de phase de la vérification par statut : UX-33/34/35 et S04 sont marqués [Bêta] alors que 04 les met en MANUEL ou les délègue au fournisseur.**
VER-007 (collecte statut + date d'entrée + règle des 90 jours) : « Bêta pilote MANUEL ». VER-002/003/005 (selfie/liveness, face match, pièce d'identité) : MANUEL, « inclus dans le parcours hébergé du fournisseur KYC ». 10b UX-33 : « [Bêta] (VER-007 en signalement) » ; UX-35 : « [Bêta] (signalement) » ; S04 [Bêta] : « statut (UX-33) … progression 4 étapes ». Le « mode signalement » est la forme P0-A, pas la forme Bêta. UXQ-03 reconnaît que le fournisseur hébergé n'accepte peut-être pas la question de statut, ce qui confirme que ce n'est pas un livrable Bêta acquis. *Correction* : marquer UX-33/35 [P0-A] avec « Bêta : saisie du statut/de l'entrée sur un formulaire simple de notre côté, décision ops », ou ajouter la ligne au périmètre construit de 04.

**V13-03 — Caution : UX-21 promet « qué no cubre : los daños no se cobran de este depósito » en Bêta/P0-A, alors que la règle BR-PAY-06 « frais annexes seulement » est la règle de la caution de la plateforme (P0-B) et que PAY-035 ne déclare pas de liste de couverture.**
BR-PAY-06 / REQ-PAY-DMG-02 : caution = garantie limitée aux frais annexes acceptés, pré-autorisation par la plateforme, libération à heure fixe. 10b §3.5 le reconnaît (« en P0-A, c'est l'agence qui prend et restitue … PAY-035 »). Or 04 PAY-035 : l'agence déclare *montant, moyens acceptés, délai de restitution* ; la caution est « prise et restituée par l'agence, hors plateforme » ; « toute retenue passe par CLM-006 avec preuves » (CLM-006 = instruction de dossier plateforme, donc voie dommage). Aucun champ « ce que la caution couvre » ni interdiction de retenir un dommage. UX-21 (réponse 4 et 5) exige donc un affichage que ni PAY-035 ni 08 n'imposent à l'agence en P0-A : promesse faite au guest que la plateforme ne peut pas garantir (ACODECO, 12 §3.7). *Correction* : ajouter à PAY-035 (et au contrat-cadre) la liste fermée « couvre / ne couvre pas » comme champ obligatoire de l'agence, ou ne l'afficher en P0-A que si l'agence l'a déclarée ; sinon afficher « selon la politique de {agencia} ».

**V13-04 — Flux Yappy (UX-26 à 29, S06, flux 4.2.1) : l'expiration de 5 minutes de l'ordre Yappy et la durée du hold ne sont pas traitées ; exemple de hold incohérent avec 04.**
09b §2.1 et 04 PAY-004 : « ordre Yappy expirant en 5 min », confirmation par IPN, pas d'API de remboursement trouvée. 04 BKG-014 : hold de 10 min. 10b §3.12 : « Tu reserva queda guardada 15 minutos » (exemple « Paiement refusé ») ; UX-27 : bouton « Pagar de nuevo » désactivé tant qu'un paiement est « en attente », sans borne ; le flux 4.2.1 boucle `M --> J` (« délai dépassé → en vérification ») sans sortie (ni contact support, ni expiration de l'ordre, ni relance d'un nouvel ordre). Conséquence : un guest dont l'ordre Yappy a expiré peut rester bloqué ; ou, inversement, un paiement tardif arrive après expiration du hold (réservation déjà libérée) sans branche de remboursement. *Correction* : décrire le cycle ordre Yappy (5 min) / hold (10 min) / page PSP, l'état « ordre expiré, rien n'a été débité, générer un nouvel ordre », la branche « paiement reçu après expiration du hold » (remboursement ou réservation si disponible), et aligner l'exemple de 15 min.

**V13-05 — Des écrans P0-A orientés utilisateur manquent parmi les 24 (voir tableau de couverture §3).**
Les plus lourds : (a) inscription / connexion / OTP du guest (ACC-001, LEG-001, VER-013, ACC-014) : aucun écran S ; l'OTP (UX-38) n'est rattaché à aucun écran ; (b) messagerie guest–agence par trip (MSG-001, MSG-007) : aucun écran, ni dans S09 ; (c) éditeur d'annonce de l'agence (HST-005/011/012/016/019/026/033/039) : A06 ne liste que « liste, statut, calendrier, blocages » ; (d) paramétrage de la politique de caution, des conditions et horaires de l'agence (PAY-035, LST-010, ADM-031) : n'apparaît que comme étape du flux 4.2.3, sans écran, alors que S02/S03/S05 en dépendent ; (e) vue agence de l'exécution des remboursements (PAY-021, 4.2.5 étape J « l'agence exécute… statut émis puis confirmé ») : pas d'écran où l'agence voit le montant à rembourser, le rail, et saisit la preuve (c'est le seul point de contrôle de l'argent du guest en P0-A) ; (f) annulation par l'agence, no-show, refus du véhicule (BKG-032, TRP-015, TRP-007). *Correction* : ajouter au moins S15 (compte/OTP), S16 (messages du trip), A10 (éditeur d'annonce), A11 (politiques de l'agence), A12 (remboursements à exécuter), et des actions sur S09/A03/A05.

**V13-06 — Annulation : 10b renvoie à « la politique de l'agence » alors que 04/08 la paramètrent côté plateforme ; aucune fenêtre n'est reliée à BR-CXL.**
S10 et flux 4.2.5 : « selon la politique de l'agence et la date » ; UX-54 : « Después, {agencia} retiene US$ 45.00 » (montant fixe). 04 LST-010 : « le résumé affiche la politique paramétrée (ADM-031) » ; Bêta : « texte fixe » ; BKG-028 Bêta : l'ops calcule « selon la politique affichée ». 08 BR-CXL-01/06 : fenêtre gratuite calculée avec `lastMinuteThreshold` (25 h, OQ-BR-30) et `min(…, trip.start)`, retenue en « journée moyenne » non monotone (50/25/33/25 %), pas un montant fixe. 10b ne dit jamais qui définit la politique (plateforme, agence, ou les deux) ni ne rattache « date et heure de fin de gratuité » à la formule de BR-CXL-01 ; UX-19/3.0 n° 3 (« une date, pas une règle ») suppose cette formule. De plus, la « date d'émission » du remboursement (S10, 4.2.5 étape C, I) n'est pas garantie en P0-A : l'agence exécute (PAY-021 MANUEL) ; aucun délai d'exécution agence n'est cité. *Correction* : citer BR-CXL-01/06/07 et l'option « politique unique plateforme » ; remplacer l'exemple à 45 US$ ; prévoir un SLA agence d'exécution des remboursements (contrat-cadre) avant d'afficher une date d'émission.

**V13-07 — Statut OBSERVÉ attribué à des constats non observés ensemble (superposition des couches flottantes).**
A14, §1.13 (« Éléments sticky et flottants superposés — OBSERVÉ ») et §1.12 (« empilement de trois éléments flottants (barre sticky, assistant flottant, bannière cookies, 03 §3) ») : 05/03 observent, à des écrans différents, la barre sticky (fiche, G-LISTING-02 #20, checkout), l'assistant flottant (résultats, G-SEARCH-03) et la bannière cookies (accueil, 03 §3). Aucune capture de superposition n'est consignée ; « trois » éléments mais quatre cités. C'est INFÉRÉ. Le besoin UX-05 reste valable mais A14 et la ligne 1.13 doivent passer INFÉRÉ. Autres statuts à corriger : voir V13-09.

**V13-08 — Plan de test pilote (§5.2) : tâches impossibles avec la Bêta construite et échantillon incompatible avec 1 à 2 agences.**
(a) V1 « fin du build Bêta » sur « produit réel » : T6 (« retrouver l'adresse du comptoir et les documents en mode avion ») exige UX-06 [P0-A] et le hors ligne, que 04 déclare absent en Bêta (TRP-057 MANUEL, « pas de hors ligne ») ; T7 (annuler) : BKG-028 MANUEL (l'ops annule) ; A2 (« coupure réseau simulée ») : TRP-057 ; A4 (« ouvrir un dossier de dommage ») : CLM-001/002 MANUEL (email/téléphone). Ces tâches ne peuvent passer qu'en V0 (prototype) ou V3 (P0-A complet). (b) T5 (« payer par Yappy puis revenir ») : UXQ-01 non résolue, Yappy n'est proposé que si la page PSP de l'agence l'offre et rien ne dit qu'un mode test Yappy existe en préproduction. (c) Recrutement : 4–6 agents de comptoir et 2–3 gérants « des agences pilotes » alors que la Bêta compte 1 à 2 agences (18 §1.0) ; 5 touristes anglophones à l'arrivée PTY par vague avec « forfait étranger ou wifi » : faisable mais non planifié. (d) Seuils « ≥ 90 % » et « 100 % des agents » sur n = 5 à 19 : une seule erreur fait basculer le critère ; à exprimer en nombre de succès avec intervalle ou à abaisser. *Correction* : attribuer chaque tâche à la vague où la fonction existe ; réduire le nombre d'agents/gérants à ce que 1–2 agences peuvent fournir (observation répétée plutôt que recrutement).

### MINEUR

**V13-09 — Statuts et rattachements Turo à corriger (échantillon, voir §2).** (i) F2/W3 « indicatif pré-rempli selon la géolocalisation IP » étiqueté OBSERVÉ : seul le pré-remplissage PA +507 est observé, la cause « IP » est une déduction de 05 (« déduit »). (ii) §1.13 « curseur de kilométrage » OBSERVÉ : 05 G-SEARCH-05 dit « curseur probable ». (iii) W6/§1.3 « compteur live » : seul « View 200+ results » est relevé (valeur plafonnée), le caractère dynamique n'est pas démontré. (iv) F7 « téléphone et date de naissance demandés plus tard » : 06 le déduit (« collectés plus tard (checkout / vérification) »). (v) P8 « all-in pricing » DOCUMENTÉ rattaché à H-AIRPORT : la formule n'existe pas dans 06 H-AIRPORT ; elle est dans 08 BR-PRICE-13. (vi) NO2/§1.8 « 9 locales » : 05 G-ACCOUNT-02 en liste 8 (en-US, en-AU, en-CA, en-GB, es-US, fr-CA, fr-FR, pt-BR) tout en écrivant « 9 » : à répercuter comme écart de la source. (vii) C1 : la cause (langue du navigateur vs locale de l'URL) est une inférence rangée dans une ligne OBSERVÉ. (viii) §1.13 « boutons icône avec nom accessible » OBSERVÉ : 05 donne un libellé, pas la preuve d'un nom accessible exposé.

**V13-10 — Caution P0-B : formulations à aligner sur BR-PAY-06.** UX-22 affiche `release_at = fin + 72 h`, mais 08 décide à `min(release_at, auth_expiry − 2 h)` (la date réelle peut être plus tôt ; la retenue notifiée ≥ 48 h avant doit alors suivre) ; UX-25 « en revue (avec date de décision) » peut laisser croire à une suspension alors que BR-PAY-06 : « jamais suspendue par une Claim » ; UX-21/23 « débit puis remboursement » est interdit tant que `deposit_charge_cap[pays]` est inconnu (inconnu ⇒ 0). Marquer ces options « sous réserve de validation PSP ».

**V13-11 — Écarts de valeurs avec 04.** UX-38 renvoi du code « après 30 s » (VER-013 : repli SMS après 60 s, validité 10 min, 5 essais) ; M-CTR-01 / critère de test « check-in < 12 min » contre TRP-052 « ≤ 5 écrans et ≤ 10 min par remise » ; UX-38 « WhatsApp d'abord » [P0-A] mais VER-013 Bêta = SMS/email (cohérent) — seul le délai de renvoi diffère.

**V13-12 — Contenu des écrans non aligné sur SRC-011/REV-010/BKG-023/BKG-025.** S02 (cartes) n'affiche ni note ni nombre de trips ni badge « Nuevo » (SRC-011, REV-010 Bêta « nombre de trips seulement »). S05 (checkout) omet la case obligatoire de confirmation boîte manuelle (BKG-025, OUI) et le rappel des clauses géographiques/sortie du territoire (BKG-023, SIMPLIFIÉ « texte fixe »).

**V13-13 — Marquages de phase internes incohérents.** S09 et S08 [Bêta] citent « contenu critique en cache (UX-06) » / « en cache hors ligne » alors que UX-06 est [P0-A] et la Bêta est en ligne seulement ; S05 [Bêta] contient « opt-in WhatsApp séparé » alors que NTF-002 est DIFFÉRÉ en Bêta (repli SMS/email) ; UX-05 [Bêta] parle de « bannière de consentement » alors que 18 (§2) : pas de bannière en Bêta (aucun cookie non essentiel, P1).

**V13-14 — Écran agent et minimisation des données.** UX-37 : « L'agence ne voit que "Verificado ✓" … jamais les pièces (BR-VERIF-10) ». BR-VERIF-10 interdit à l'hôte de *collecter* des documents ; il ne dit pas que l'agence ne voit rien. UX-41 demande de contrôler le permis physique « contre les données vérifiées », et VER-015 prévoit 6 points (nom, date de naissance, photo, validité, restrictions, permis temporaire ; pas le numéro de cédula). Préciser exactement ce que l'agent voit.

**V13-15 — UX-61 (SMS) trop général.** « UCS-2 dès qu'un caractère accentué est présent » : é, è, ù, ì, ò, ñ, ü figurent dans l'alphabet GSM-7 ; á, í, ó, ú (très fréquents en espagnol) n'y sont pas. Conclusion pratique (budget de segments à 70 caractères pour la plupart des messages) correcte ; énoncé à nuancer.

**V13-16 — Flux Mermaid : syntaxe valide, trous de logique.** 4.2.1 : boucle `M --> J` sans sortie ; aucune branche « paiement reçu après expiration du hold » ; pas d'état « ordre PSP expiré ». 4.2.4 : `D1` (escalade) sans retour ; si l'ops refuse, rien n'indique l'issue (annulation, remboursement). 4.2.5 : l'étape J (exécution par l'agence) n'a pas de retour d'état vers la plateforme (voir V13-05 e).

**V13-17 — Collisions de nomenclature.** Anti-modèles « A1…A15 » (§2.2, cités « anti-A9 », « anti-A10 ») et écrans agence « A01…A09 » ; risque de confusion à la lecture et dans 22.

**V13-18 — En-tête « Sources lues ».** Ne cite ni 04_FEATURE_INVENTORY.csv ni 09b alors que les exigences portent des identifiants 04 (UX-xx renvoie à 04) et que le flux Yappy aurait dû reprendre 09b (expiration 5 min, pas de remboursement API). À ajouter, avec la relecture V13-04.

**V13-19 — P0-A et collecte de coordonnées bancaires.** UX-31/4.2.5 (étape F1) : la plateforme collecte les coordonnées bancaires du guest pour que l'agence rembourse par virement. Données financières personnelles hors contrat de traitement décrit ; renvoyer à LEG-010/Ley 81 et dire qui est responsable du traitement (plateforme ou agence).

**V13-20 — Parcours de vérification : IDP.** 4.2.2 omet l'IDP (à valider, 12 §3.4, « sources contradictoires ») ; UX-34 le mentionne « seulement si la règle l'exige » : cohérent, mais la catégorie « visa spécial » est donnée sans réserve dans l'écran (UX-33 : « visa de trabajador remoto » en exemple), alors que 12 §3.4 la qualifie « vraisemblablement … À VALIDER ». Ajouter « À VALIDER » à l'exemple ou le retirer du texte guest tant que OQ-BR-21 est ouvert.

**V13-21 — Écrans ops.** O01 agrège files KYC, risque, retards ; ADM-003 (annonces), ADM-004 (KYB), ADM-007 (remboursements/gestes), ADM-008 (arbitrage), CLM-006 (instruction), ADM-022 (retards GPS) n'ont pas de description propre. Acceptable si l'écran ops est hors périmètre « utilisateur », à déclarer.

**V13-22 — Accessibilité du plan de test.** 2–3 utilisateurs de lecteur d'écran par vague au Panama : recrutement difficile ; prévoir un expert d'accessibilité en plus (déjà V3 audit WCAG complet, bien).

## 2. Contrôle des citations sur Turo (34 contrôlées)

Légende : OK = exact et statut correct ; Δ = écart (voir finding).

| # | Citation 10b | Référence | Résultat |
|---|---|---|---|
| 1 | N1 URL hiérarchique + ID | 03 §1, G-LISTING-01 | OK |
| 2 | N2 header (logo, recherche, Earn, Ask Turo, menu) | 03 §2 | OK (« au-dessus » : ordre de liste seulement) |
| 3 | N3 menu connecté | G-ACCOUNT-01 | OK |
| 4 | N4 Inbox 2 onglets | G-INBOX-01 | OK |
| 5 | N5 modes + « Continue searching » sans compte | G-SEARCH-01 | OK |
| 6 | N7 `sign-up?next=` | H-ONB | OK |
| 7 | N8 wizard 1 of 9 | H-ONB-02 | OK |
| 8 | §1.2 21 blocs, ordre 5–12, 15, 19, 20 | G-LISTING-02 | OK |
| 9 | §1.3 âge 30 dans l'URL ; écart +60/+150 $ | G-SEARCH-02, G-BOOK-02 | OK |
| 10 | F1 checkout invité | G-BOOK-01 | OK |
| 11 | F2 indicatif selon IP | G-BOOK-01 | Δ cause inférée (V13-09 i) |
| 12 | F3 bandeau post-réservation | G-BOOK-01 | OK |
| 13 | F4/F5 vérification 24–48 h, 2 h avant départ | SRC_G 1.4.4–1.4.5 | OK (DOCUMENTÉ) ; BR-CXL-07 ajoute remboursement partiel |
| 14 | F6 2 vs 3 options | G-BOOK-01 #7, G-BOOK-06 | OK |
| 15 | F7 inscription Apple/Google/email, opt-in non pré-coché | H-ONB | OK ; « plus tard » inféré |
| 16 | FO3 pas de 30 min, 12 h | G-LISTING-02 #5 | OK |
| 17 | FO6 Next désactivé | H-ONB-02 | OK |
| 18 | E1 indisponibilité + toast, mélange FR/EN | G-LISTING-02 #7 | OK |
| 19 | E2 pays non opéré | H-ONB-02 | OK |
| 20 | E3 fin de liste | G-SEARCH-03 | OK |
| 21 | NO1 matrice, email obligatoire | G-ACCOUNT-02 §2 | OK |
| 22 | NO2 9 locales | G-ACCOUNT-02 | Δ 8 listées (V13-09 vi) |
| 23 | NO3 placeholder `{6}` | G-INBOX-01 | OK |
| 24 | §1.9 réponse publique de l'hôte, ancienneté, Report listing, télématique | G-LISTING-02 #13, #17–#19 | OK |
| 25 | P1–P3 prix barré / total HT / TTC checkout | G-SEARCH-03, G-BOOK-01 #9 | OK |
| 26 | P4 trip fee, âge | G-BOOK-02, G-BOOK-06 | OK |
| 27 | P5 remise non remboursable intégrée à la base | G-BOOK-06 | OK |
| 28 | P7 nudges (3) | G-SEARCH-03, G-LISTING-02 #4, G-BOOK-01 #5 | OK |
| 29 | P8 livraison incluse « all-in » | « H-AIRPORT » | Δ absent de 06 (08 BR-PRICE-13) |
| 30 | §1.11 annulation fiche / liste / checkout | G-LISTING-02 #9, G-SEARCH-03, G-BOOK-01 #5 | OK |
| 31 | §1.11 protection « aucun reste à charge… sauf mécaniques et intérieurs », « excess basis » | 10 §1 | OK |
| 32 | §1.12 mobile web ~530 px ; desktop NON OBSERVÉ | 05 en-tête | OK, bien déclaré |
| 33 | §1.13 / A14 superposition de couches | 03 §3, G-SEARCH-03, G-LISTING-02 #20 | Δ non observé ensemble (V13-07) |
| 34 | C5/§1.11 24 h/25 h, 1 800/3 300 mi, 90 % | SRC_G 4.1.1, H-AIRPORT, H-MONTHLY | OK |

Autres : « Turo is not an insurance company » rattaché à H-ACQ (texte de la page, DOCUMENTÉ) : OK. 80 h de libération : SRC_G 2.5.3 / BR-PAY-06 : OK. « Aucune réservation, aucun check-in… réalisés » : conforme à 05. Le document n'attribue pas à Turo d'accessibilité mesurée : OK.

## 3. Couverture des écrans P0-A (04, 147 lignes P0-A + 13 P0-B ; implications d'interface)

Répartition des 147 lignes P0-A par persona (script `python -I`) : Admin/Ops 43, Guest 36, Visiteur 20, Hôte 21 + Hôte pro 15, Tous 7, Finance 4, Support 1. Lignes à interface guest/agence projetées ci-dessous (les lignes moteur ou légales internes sont exclues).

| Groupe de lignes 04 | Écran(s) 10b | Couverture |
|---|---|---|
| SRC-001/008/011/042, LST-002/003/006/007/010/012/013, REV-010 | S01, S02, S03 | Couvert ; S02 sans note/trips (V13-12) |
| LST-008, SRC-002, SRC-012, LST-020, BKG-016 (DIFFÉRÉ Bêta) | S01/S03 (§3.12) | Couvert (P0-A) |
| ACC-001, ACC-006, LEG-001/002, VER-013 (inscription, CGU, OTP), ACC-014 | — | **MANQUE** (V13-05 a) |
| VER-001/004/005/007, VER-002/003 | S04 | Couvert ; phases à corriger (V13-02) |
| BKG-001/002/006/008/012/014/018/019, BKG-023, BKG-025 | S05 | Couvert sauf BKG-023/025 (V13-12) |
| PAY-004, PAY-033/034/019, PAY-002/006/017/018 (page PSP) | S06 | Couvert ; expiration Yappy (V13-04) |
| BKG-022, NTF-007, LEG-026 | S07 | Couvert |
| BKG-027, TRP-045 (statut) | S08, S09 | Couvert |
| BKG-028 (annulation guest), PAY-021 | S10 | Couvert côté guest ; **manque vue agence de l'exécution** (V13-05 e) |
| CLM-002, CLM-001, CLM-006 | S11, A04, A09 | Couvert |
| REV-001 | S13 | Couvert |
| Compte, canaux, langue (I18N-003/004, ACC-008) | S14 | Couvert |
| Messagerie MSG-001, MSG-007 | — | **MANQUE** |
| TRP-007 (refus du véhicule), TRP-015 (no-show), BKG-032 (annulation agence), TRP-035 (retard : vue guest) | actions non décrites sur S09/A03/A05 | **MANQUE** (actions) |
| SUP-004, SUP-011 (aide, urgence, support es/en) | contact urgence dans S09 seulement | Partiel : pas d'écran « Aide » |
| LEG-011 (centre légal), PRT-013 (assureur, licences) | — (S03 « police flotte ») | **MANQUE** : pages publiques/légales |
| VER-015, TRP-052, TRP-002/004/033/057, PAY-035 (saisie de la caution), CLM-034 | A02, A03, A04 | Couvert |
| HST-005/011/012/016/019/026/033/039, CAL-001/002/003/004/009, FLT-011, PRC-001 | A06 | **Partiel** : pas d'éditeur d'annonce, pas de gestion iCal (V13-05 c) |
| PAY-035, LST-010 (politique de caution/annulation de l'agence) | — | **MANQUE** : écran de configuration (V13-05 d) |
| ACC-029, VER-027, PRT-019, LEG-025/027, HDB-001, HDB-002 | A07, A05 | Couvert (tâches, listes) |
| FLT-001, FLT-003 (équipes, rôles) | flux 4.2.3 (K) seulement | **MANQUE** : écran Équipe et rôles |
| PYO-013, FIN-018/019 | A08 | Couvert |
| ADM-001/002/003/004/005/006/007/008/022/029 | O01 | Partiel (V13-21) |
| PAY-011/012/015 (P0-B) | UX-25 « Tu depósito » sans écran numéroté | Hors liste P0-A ; à numéroter en P0-B |

Écrans proposés à ajouter : S15 inscription/connexion/OTP ; S16 messages du trip ; S17 aide/urgence ; A10 éditeur d'annonce ; A11 politiques de l'agence (caution, annulation, horaires, comptoirs) ; A12 remboursements à exécuter ; A13 équipe et rôles. Nombre d'écrans vérifié : 24 (S01–S14, A01–A09, O01).

## 4. Points vérifiés sans écart

- **Identité visuelle** : aucune palette, typographie, iconographie ou nom propriétaire de Turo recommandé ; règle d'identité en en-tête et principe n° 8 ; les libellés de Turo (« Book trip », « Ask Turo », « Included with your trip », All-Star) n'apparaissent qu'en citation d'analyse ; les exigences utilisent des libellés propres (« Precio final », « Hoy en mostrador »). Pas de finding.
- **Deposit wording vs BR-PAY-06 (P0-B)** : liste fermée des frais annexes, « daños no se cobran », avertissement 3–10 jours ouvrés, « émis » jamais « reçu », notification ≥ 48 h avant : conformes à 08 (réserves V13-03, V13-10).
- **Yappy via PSP de l'agence, marchand = agence, webhook avant confirmation, pas de custodie plateforme en P0-A** (UX-26/27, S06, §3.6, UX-31 « calcul plateforme, exécution agence », UX-30 P0-B) : conforme à 18 §0/§1.0 et PAY-033/034.
- **Vérification : minuterie Turo** (2 h avant départ) décrite comme DOCUMENTÉ ; notre exigence est inversée (avant paiement), cohérente avec IMP-09, sous réserve de V13-01.
- **Accessibilité** : toutes les mentions WCAG 2.2 AA sont des exigences (§3.10) ; le §1.13 est étiqueté INFÉRÉ « aucun audit outillé », avec formulations conditionnelles. Critères cités exacts (2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8, 1.4.10, 1.4.1, 3.1.2, 4.1.3, 3.3.1/3.3.2).
- **Mermaid** : 7 blocs, crochets/accolades/guillemets équilibrés, identifiants de nœuds valides (`OK`, `NO` acceptables), étiquettes d'arêtes entre `|…|` valides, chaînes `-->` multiples valides, texte avec `>`, `≤`, `<br/>` placé entre guillemets. Pas d'erreur de syntaxe relevée à la lecture (aucun rendu exécuté). Trous de logique : V13-16.
- **Phases cohérentes** : UX-07 (en ligne Bêta, hors ligne P0-A), UX-15 (total TTC sans protection obligatoire, SRC-042 Bêta/PRC-026 P1), UX-39 (pas de remise de clés sans webhook, TRP-002), S10/S11 (« Bêta via ops/email »), A06 CSV : conformes à 04/18.
- Identifiants cités dans 04 : tous existent (40 vérifiés), phases exactes, y compris PAY-011/036 en P0-B et PRC-008/PRC-026 en P1.

## 5. Faisabilité du plan de test pilote (§5.2) — synthèse

| Élément | Verdict |
|---|---|
| Objectifs, vagues V0–V3, mesures (SEQ, UMUX-Lite), gravité 1–4, restitution sous 5 j | Réaliste |
| Consentement Ley 81/2019, données de test, pas de vrais documents | Réaliste ; préciser le jeu de documents de test pour T4 (tampon à 80 jours) |
| T1–T4, T8 guest en V1 | Faisables |
| T5 (Yappy), T6 (mode avion), T7 (annulation), A2, A4 | Non faisables en V1/V2 sur la Bêta (V13-08) |
| Recrutement agents/gérants | Dépasse 1–2 agences (V13-08 c) |
| Seuils ≥ 90 % / 100 % | Statistiquement fragiles (V13-08 d) |
| Métriques M-DEP-01 (cautions libérées à date) | Mesurable en P0-A seulement si l'agence saisit le statut (UX-25 Bêta) : le dire |

## 6. Actions demandées à l'auteur (ordre de priorité)

1. V13-01 + V13-02 : décider du moment du paiement pour les cas signalés ; corriger les phases de UX-33/35/S04.
2. V13-03 : champ « couvre / ne couvre pas » dans PAY-035 ou retrait de la promesse en P0-A.
3. V13-04 : cycle Yappy (5 min / 10 min / hold) et branches d'erreur.
4. V13-05 : ajouter les écrans listés §3.
5. V13-06 : relier l'annulation à BR-CXL et trancher qui fixe la politique.
6. V13-07 + V13-09 : corriger les statuts OBSERVÉ en INFÉRÉ.
7. V13-08 : réaffecter les tâches de test aux vagues où elles existent.
8. Mineurs V13-10 à V13-22.
