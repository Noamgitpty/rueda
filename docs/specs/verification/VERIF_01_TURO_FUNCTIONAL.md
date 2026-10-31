# VERIF_01 — Audit indépendant : parcours, règles métier, prix, assurance, CGU

- **Date :** 2026-10-30
- **Auditeur :** agent indépendant. Il n'a pas rédigé les documents audités.
- **Fichiers audités :** 05_GUEST_JOURNEYS.md, 06_HOST_JOURNEYS.md, 08_BUSINESS_RULES.md, 09_PRICING_PAYMENTS_AND_PAYOUTS.md, 10_INSURANCE_TRUST_AND_SAFETY.md, sources/SRC_TOS_NOTES.md.
- **Référentiel croisé :** sources/SRC_GUEST_DOCS.md, plus une relecture directe d'articles help.turo.com en `.md`.
- **Méthode :**
  - turo.com n'a **pas** été consulté, puisqu'il renvoie 403 aux accès automatisés. Aucun contournement n'a été tenté.
  - Les affirmations qui ne reposent que sur des pages turo.com (cancellation policy, terms, insurance, all-star, host-hub, how-turo-works, trust-and-safety, additional-policies) sont marquées **« non vérifiable »**, sauf quand un article help.turo.com les corrobore ou les contredit.
  - Les constats OBSERVÉ / DIRECTEMENT TESTÉ n'ont pas été rejoués. Seules leur cohérence interne et leur arithmétique ont été contrôlées.
- **Gravité :**
  - **CRITIQUE** : erreur qui fausserait directement l'implémentation.
  - **MAJEUR** : règle fausse, contredite ou gravement incomplète.
  - **MINEUR** : imprécision, étiquetage ou traçabilité.

---

## 1. Tableau des constats

| ID | Fichier:section | Affirmation | Problème | Gravité | Preuve / URL | Correction proposée |
|---|---|---|---|---|---|---|
| V01 | 08:Pseudo-algorithme `computeGuestCancellationRefund` | `if actor in {HOST, PLATFORM} … return FULL_REFUND` ; `NON_REFUNDABLE` après 24 h → `ZERO` | Le pseudo-code contient **trois erreurs**.<br>(a) Il contredit BR-CXL-07 du même fichier : quand Turo annule pour étapes post-réservation non faites, le remboursement est **partiel**. Or l'algorithme rend tout le montant à tout acteur PLATFORM.<br>(b) Il contredit SRC_GUEST_DOCS 4.2.1 : en non remboursable, aucun remboursement quand le host annule à cause du guest (problème au départ, permis). L'algorithme rend pourtant tout dès que l'acteur est HOST.<br>(c) `ZERO` en non remboursable oublie la libération du dépôt de garantie (SRC 4.1.3 « puis plus rien (sauf dépôt) »). Il oublie aussi les taxes au prorata. | CRITIQUE | 08 BR-CXL-07 ; SRC_GUEST_DOCS 4.1.3, 4.2.1 ; https://help.turo.com/en_us/guest-trip-start-failures-HJUfENeVq.md (« Non-refundable trips … no refund », dépôt remboursé) | Distinguer `PLATFORM_TRUST_SAFETY` (remboursement intégral) de `PLATFORM_INCOMPLETE_STEPS` (remboursement partiel). Ajouter l'exception NR « annulation hôte imputable au guest ». Toujours libérer `deposit`. Recalculer les taxes sur le montant remboursé. |
| V02 | 05:G-LISTING-02 n°11 ; 09:§1 | « kilométrage inclus par trip et **prix du mile supplémentaire fixés par l'hôte** » ; 09 : « prix au mile supplémentaire (hôte) » | **Faux selon la documentation.** C'est Turo qui calcule le prix du mile supplémentaire : prix journalier ÷ distance journalière, au moment de la réservation, remises comprises. L'hôte choisit seulement la distance (au-dessus des minimums Turo) et s'il facture ou non le dépassement.<br>Les 0,22 $/mi observés ne se réconcilient pas non plus avec le prix journalier du checkout : 41,03 / 200 = 0,205 ; 38,76 / 200 = 0,194. Les dates diffèrent peut-être (prix dynamique). | MAJEUR | https://help.turo.com/en_us/distance-limits-and-additional-distance-SkWUrEgVc.md (MAJ 2026-06-29) : « We calculate cost per mi/km … by dividing your daily price by your daily distance » | Corriger en « distance fixée par l'hôte (≥ minimum Turo) ; tarif du dépassement **calculé par la plateforme** ». Noter les dates de la fiche observée pour pouvoir réconcilier les 0,22 $. |
| V03 | 06:H-MONTHLY | « Remise mensuelle optimisée = 45 % → limite de distance réduite de **1 800 miles/mois** » | **Incomplet et trompeur.** Aux US, le minimum mensuel est de **3 300 mi** (110/j) pour un véhicule standard. Les **1 800 mi** ne valent que pour les Deluxe et Super Deluxe. La page host-hub citée n'est pas vérifiable (403). | MAJEUR | Même article help (minimums mensuels : US Standard 3 300 mi ; Deluxe et Super Deluxe 1 800 mi ; seuil ≥ 45 %) ; SRC_GUEST_DOCS 6.4.1 | Remplacer par le barème complet : journalier 200/100/75 mi, hebdo 1 050 mi si remise ≥ 15 %, mensuel 3 300 ou 1 800 mi si remise ≥ 45 %. |
| V04 | 05:G-BOOK-02 (inférence fiscale) ; 09:§1 | « taux marginal 7 % + composante fixe ≈ 5,13 $ (probable surtaxe de location floridienne par jour) » | Les 5,13 $ supposent implicitement que le trip fee **n'est pas taxé** (13,27 − 7 % × 116,28 = 5,13). Ce montant ne correspond à aucune base légale (1,71 $/j).<br>Un modèle alternatif colle **au centime** aux trois mesures : **7 % du sous-total complet, trip fee compris + surtaxe P2P floridienne de 1 $/jour, elle-même taxée à 7 %** (3 × 1 × 1,07 = 3,21 $).<br>Vérification : 0,07 × 143,68 + 3,21 = 13,27 ; 0,07 × 203,68 + 3,21 = 17,47 ; 0,07 × 293,68 + 3,21 = 23,77.<br>La surtaxe P2P de Floride est bien de **1 $/jour** (et non 2 $, qui est le tarif des loueurs). Elle est soumise à la taxe de vente. | MAJEUR (inférence fausse, quoique marquée INFÉRÉ) | Fla. Stat. 212.0606(3) : https://m.flsenate.gov/Statutes/212.0606 (« surcharge of $1 per day ») ; arithmétique ci-contre | Remplacer par « taxe = 7 % × (prix + trip fee + jeune conducteur) + 1 $/j de surtaxe P2P taxée ». **Conséquence produit** : le trip fee est taxable en Floride, ce qui confirme que la plateforme collecte en tant que marketplace facilitator (SRC 2.4.9). |
| V05 | 05:G-BOOK-01 n°5 et G-BOOK-02 ; 08:BR-CXL-02 ; 09:§1 | Non remboursable « Économisez 15 $US. Offre limitée dans le temps » ; écart « ≈ −9 % (OBSERVÉ) » ; décomposition « tarif non remboursable » sans ligne de remise NR | La règle documentée n'est **pas reprise** : « All hosts offer a **10 %** non-refundable trip discount for trips booked **four or more days** in advance ». Les remises s'additionnent (10 % + 5 % = 15 %).<br>La décomposition G-BOOK-02, présentée comme celle du tarif NR, ne montre **aucune ligne de remise NR**. Soit la remise est fondue dans la ligne « 3 jours », soit la décomposition est celle du tarif remboursable. Non réconcilié : le sous-total remboursable reconstitué vaut (172,41 − 3,21) / 1,07 = 158,13 $, soit un écart HT de 14,45 $.<br>« Offre limitée dans le temps » contredit le caractère permanent de la règle (habillage marketing ?). | MAJEUR | https://help.turo.com/en_us/trip-pricing-ByXmVNgN5.md (MAJ 2026-04-16) ; SRC_GUEST_DOCS 2.4.2, 2.7.1 | Ajouter la règle BR « NR = −10 % sur le prix journalier, uniquement si la réservation a lieu ≥ 4 jours avant le départ, cumul additif ». Re-tester le checkout en relevant la décomposition des **deux** tarifs. |
| V06 | 08:BR-CXL-01 vs BR-CXL-14 vs pseudo-algorithme | BR-CXL-01 et l'algorithme : seuil **24 h** ; BR-CXL-14 : « trip réservé **< 25 h** avant le départ » | Le même fichier se contredit. Les sources officielles divergent aussi : l'article guest dit 24 h, l'article hôte dit 25 h (« booked less than 25 hours before the start »). Pour une réservation faite entre 24 et 25 h avant le départ, la règle est ambiguë. | MAJEUR | https://help.turo.com/en_us/canceling-a-trip-with-your-host-HJyUE4xN9.md (24 h) ; https://help.turo.com/en_us/trips-canceled-by-guests-or-turo-BkGMU4gV9.md (MAJ 2026-09-11 : 25 h) ; SRC_GUEST_DOCS §11.1 | Signaler l'écart dans BR-CXL-01. Pour [NOUS], fixer un seul paramètre `lastMinuteThresholdHours`. Inscrire le point en question ouverte. |
| V07 | 06:H-AIRPORT ; 08:BR-HOSTSHARE ; 10:§3 | 06 : « l'hôte touche **90 % des frais de livraison** pour les trips aéroport (≠ part du plan) » ; 10 : part du plan sur « trip + livraison + Extras » | **Les sources officielles se contredisent**, et 08 présente les deux versions comme DOCUMENTÉ. Le centre d'aide (MAJ 2026-10-19) indique que, pour les hôtes US et CA, la livraison et les Extras suivent la part du plan, ou la part variable. Il réserve les 90 % à l'Australie et au Royaume-Uni. La page host-hub airport-delivery (non lisible, 403) annoncerait 90 % pour chaque trip aéroport. | MAJEUR | https://help.turo.com/en_us/earnings-and-host-share-r1zDrNlNc.md ; https://help.turo.com/en_us/how-vehicle-delivery-works-hosts-B1HUH4eVq.md | Garder les deux versions, datées, en question ouverte. Ne pas présenter 90 % comme la règle US sans mention de la contradiction. |
| V08 | 09:§1 ; 08:BR-AGE ; 05:G-BOOK-02 | Frais jeune conducteur « 18–20 : 50 $/j ; 21–24 : 20 $/j » présentés comme barème fixe (09 : « plateforme, mesuré ») | **Généralisation abusive** à partir d'un seul trip de 3 jours. Turo indique que ces frais varient selon la durée et d'autres facteurs. Les sources tierces avancent 30 $/j pour les 21–24 ans, voire 20 % du prix. L'arithmétique de la mesure est juste : +150 / 3 = 50 ; +60 / 3 = 20.<br>Fait utile à ajouter : ces frais **ne font pas varier le trip fee** (écarts de sous-total exactement 150 et 60). Ils ne s'appliquent ni aux conducteurs additionnels, ni au Canada. | MAJEUR | https://help.turo.com/en_us/trip-costs-Syxm4NeNq.md (« under the age of 25 », aucun montant) ; SRC_GUEST_DOCS 2.4.6–2.4.7 | Écrire « observé sur 1 trip de 3 jours ». Tester au moins un trip de 7 jours et un de 30 jours avant de modéliser. |
| V09 | 10:§1 | « Les prix dépendent **probablement de la valeur du véhicule** » ; 10 PROPOSÉ « % du prix du trip ou fonction de la valeur » | L'arithmétique tranche : les prix observés valent **exactement 65 % / 40 % / 25 % du prix journalier net du trip, hors trip fee** (116,28 / 3 = 38,76 $). En effet, 0,65 × 38,76 = 25,19 ; 0,40 × 38,76 = 15,50 ; 0,25 × 38,76 = 9,69. Cela confirme les pourcentages tiers de SRC 3.13.<br>Le **plancher tiers de 10 $/jour pour Minimum est en revanche contredit** (9,69 < 10). Ces chiffres expliquent aussi pourquoi les prix sont identiques à 22 et 30 ans : la base exclut les frais jeune conducteur. | MAJEUR | Calcul ; SRC_GUEST_DOCS 3.13 ; https://help.turo.com/en_us/summary-and-cost-of-protection-plans-or-us-guests-BJSgBNgVq.md (aucun barème publié) | Écrire « prix = % du prix journalier net (65/40/25 observés ; Minimum = 25 % si trip < 250 $) — INFÉRÉ fort ». Retirer le plancher de 10 $. Tester un véhicule à plus de 60 000 $ et un trip de plus de 250 $. |
| V10 | 08:BR-AGE ; 05:G-SEARCH-02 | « âge minimum 18 ans » ; Deluxe 25+ et Super Deluxe 30+ seulement | **Règle d'âge incomplète.** La documentation ajoute **21 ans** pour un véhicule de plus de 20 000 $, et **30 ans** pour les Classic et Specialty. L'âge s'apprécie **à la date de réservation**. Les seuils de valeur sont Deluxe 45–85 k$ et Super Deluxe > 85 k$. Un dépôt de 750 $ s'applique aux Deluxe pour les moins de 30 ans et à tous les Super Deluxe. Premier est **interdit aux moins de 21 ans** et aux véhicules de plus de 60 000 $. | MAJEUR | SRC_GUEST_DOCS 1.2.1–1.2.4, 2.5.1, 3.2 ; https://help.turo.com/en_us/summary-and-cost-of-protection-plans-or-us-guests-BJSgBNgVq.md (« Premier … isn't available to drivers under 21 ») | Compléter BR-AGE avec une matrice âge × classe de véhicule × plan × dépôt. |
| V11 | 08 (en-tête BR-CXL), 06 (H-PERF, H-MONTHLY, H-AIRPORT, H-ACQ), 05 (G-HOW), 10 (§3–§5), SRC_TOS_NOTES | Pages turo.com « DOCUMENTÉ — lu le 2026-10-30 » | **Traçabilité insuffisante.** SRC_GUEST_DOCS 12.2 constate que ces pages renvoient 403 aux accès automatisés et que /insurance n'a « pas été tentée ». Ces pages ont donc été lues par le navigateur intégré, mais le mode d'accès n'est indiqué nulle part. Seule la page cancellation (EV-0011) figure dans 20_EVIDENCE_REGISTER. Insurance, all-star, monthly-trips, airport-delivery, how-turo-works, trust-and-safety, additional-policies et terms n'y figurent pas. **Non vérifiable par l'audit.** | MAJEUR | 20_EVIDENCE_REGISTER.csv ; SRC_GUEST_DOCS §12.2 | Créer une entrée EV par page (URL, date de révision, mode « navigateur intégré, lecture humaine »). Recouper chaque chiffre avec un article help quand il en existe un. |
| V12 | 06:H-PERF-01 | Avantage « promo code **$100/an** » | Le code n'est attribué qu'aux hôtes qui gardent le statut **4 trimestres consécutifs**, et il est **valable 180 jours**. Deux précisions manquent aussi : les taux se calculent **trips non notés inclus**, et le compte doit être **sans violation active**. Les autres seuils sont confirmés. | MINEUR | https://help.turo.com/en_us/all-star-host-program-r18TBExV5.md (MAJ 2026-04-21) | Corriger le libellé de l'avantage et ajouter ces deux critères. |
| V13 | 10:§3 | « Délai supplémentaire distance/carburant +2 j / +1 j / 0 » | Cohérent, mais sous forme relative. Les valeurs absolues officielles sont **5 j (120 h) / 4 j (96 h) / 3 j (72 h)** après la fin du trip. | MINEUR | https://help.turo.com/en_us/earnings-plans-in-brief-us-hosts-ryy_U4gE9.md (MAJ 2026-05-21) | Donner les valeurs absolues. |
| V14 | 10:§3 ; 08:BR-HOSTSHARE | Part variable 65–80 / 75–90 / 85–100 dans 9 marchés | Confirmé. Il manque les tranches (0–2 j, 3–13 j, 14–27 j, 28+ j) et le fait que la part variable s'applique aussi aux **frais de distance supplémentaire, d'usage additionnel et de retard**. La part n'est pas modifiée par un changement fait après la réservation. | MINEUR | https://help.turo.com/en_us/earnings-and-host-share-r1zDrNlNc.md (MAJ 2026-10-19) | Ajouter la table des tranches. |
| V15 | 09:§2 | « Le Trip fee guest n'est pas partagé (INFÉRÉ) » | Le point est documenté : la part hôte est un pourcentage du « trip price », et le trip fee est un frais Turo. | MINEUR | https://help.turo.com/en_us/trip-costs-Syxm4NeNq.md ; earnings-and-host-share | Passer en DOCUMENTÉ. |
| V16 | 10:§3 « Lecture business » ; 09:§1 | « trip fee ~24 % » | Généralisation d'un seul cas. Le trip fee est un pourcentage **variable** : il est plus élevé pour un véhicule cher, un trip court ou une réservation tardive. Il serait nul pour les trips de 30 jours ou plus, information connue seulement par un extrait. | MINEUR | trip-costs (MAJ 2026-10-28) | Écrire « 23,6 % sur l'exemple observé ; variable ». |
| V17 | 10:§1 | Assistance de base : interventions facturées sans l'add-on « INFÉRÉ » | Le point est documenté : « jusqu'à 199 $ » par service sans l'assistance renforcée, fourrière 399 $, frais « gone on arrival » de 40 $. | MINEUR | SRC_GUEST_DOCS 7.2–7.3 (help:roadside-assistance-or-us-guests-BJBiEVgE9) | Passer en DOCUMENTÉ avec les montants. |
| V18 | 05:G-BOOK-01 n°7 | BNPL « fournisseur NON IDENTIFIÉ » | Le point est documenté : **Affirm, Klarna (WebBank), Afterpay**, pour des trips de 30 jours ou moins se terminant dans les 120 jours, **sans dépôt**. | MINEUR | SRC_GUEST_DOCS 2.5.4, 2.6.5 | Mettre à jour la ligne et ajouter les conditions d'éligibilité. |
| V19 | 05:G-HOW vs 06:H-AIRPORT | « **100+** aéroports US/Canada » vs « permis dans **170+** aéroports » | Contradiction entre fichiers, chacun citant une page turo.com différente. Autre écart : la landing hôte dit « nearly a third of trips … **start** at the airport », alors que 06 écrit « commencent **et finissent** ». | MINEUR | 05 l.174 ; 06 l.10 et l.78 | Garder les deux chiffres avec leur source et leur date. Aligner la formulation sur « start ». |
| V20 | 08:BR-CXL-08 ; 08:Définitions | Région « 30 min = **tous les autres pays** → s'appliquerait au Panama/Paraguay » | Le centre d'aide dit « Australia and France ». L'extrapolation au Panama et au Paraguay est une spéculation : Turo n'y opère pas. | MINEUR | https://help.turo.com/en_us/guest-trip-start-failures-HJUfENeVq.md (MAJ 2026-09-15) | Écrire « AU/FR (help) ; “autres pays” (policy, non vérifiable) ». Marquer l'extrapolation comme INFÉRÉ. |
| V21 | 08:BR-CXL-08 / BR-CXL-15 | Liste des déclencheurs et des remboursements en cas de no-show | **Incomplet.** Il manque :<br>• le déclencheur « permis non téléversé **1 h avant** le départ, sans rencontre possible avec l'hôte » ;<br>• le remboursement de l'**assistance renforcée** ;<br>• le fait qu'un trip non remboursable en no-show ne donne aucun remboursement ;<br>• l'attente de 15 min de l'hôte après son message.<br>Ces points concernent aussi l'algorithme. | MINEUR | guest-trip-start-failures ; SRC_GUEST_DOCS 4.1.5 | Compléter. |
| V22 | 08:BR-CXL-07 | « Délai exact : cf. SRC_GUEST_DOCS » | Le délai est connu : tout doit être terminé **2 h avant le départ**. La checklist post-réservation n'existe que si la réservation a lieu plus de 3 h avant le départ ; sinon, les étapes se font pendant le checkout. | MINEUR | SRC_GUEST_DOCS 1.4.5, 3.10, 4.2.6 | Intégrer ces délais. |
| V23 | 08:BR-CXL-10 | « prévenir l'hôte au moins 1 h avant » ; « notifier Turo dans les 24 h autour du début » | Le centre d'aide dit « écrire à l'hôte **avant le départ** » et « justificatif au support **au plus tard 24 h après l'heure de début** ». Les formulations divergent. | MINEUR | SRC_GUEST_DOCS 4.1.7 (help:managing-a-flight-delay-or-cancellation-BkGUVNx4q) | Citer les deux versions et retenir la version help pour la spécification. |
| V24 | 08:BR-CXL-14 | Gains de l'hôte quand Turo annule (1 j / ½ j si moins de 24 h, sinon 0) | **Non vérifiable** (cancellation policy en 403). L'article help ne couvre que l'annulation pour fermeture du compte de l'hôte, qui donne **0 gain quel que soit le moment**. Ce cas manque dans 08. | MINEUR | trips-canceled-by-guests-or-turo-BkGMU4gV9 | Ajouter le cas « fermeture de compte hôte » et laisser le reste « policy, non recoupé ». |
| V25 | 08:BR-CXL-13 | Exemption de pénalités : All-Star seulement | **Incomplet.** Il manque :<br>• le barème de dépublication pour un hôte de 20 trips ou moins (1re annulation → webinar, 2e → 3 jours, 3e → fermeture) ;<br>• les seuils de 5 % (7 jours + webinar) et 10 % (fermeture) ;<br>• les autres exemptions : 1re annulation sur 10, rebooking du même guest sous 24 h, rappel de sécurité, catastrophe ;<br>• le recul dans la recherche. | MINEUR | SRC_GUEST_DOCS 4.2.5 | Compléter. |
| V26 | 06:H-MONTHLY | Entretien « trip **≥ 30 jours** » | La documentation dit **plus de 30 jours ou plus de 3 000 mi**. Elle prévoit aussi l'option swap et la fin du trip en cas de refus. | MINEUR | SRC_GUEST_DOCS 5.12 | Corriger. |
| V27 | 05:G-SEARCH-05 | « Collections (26 observées) » | La liste n'en compte que **25**. | MINEUR | Comptage manuel | Corriger le nombre ou ajouter la collection manquante. |
| V28 | 05:G-SEARCH-02 | `monthlyStartDate/EndDate` « pré-calculés (+3 mois) » | L'arithmétique montre que `monthlyStartDate` = 13/11/2026, soit la **date du jour + 14 j**, indépendamment des dates recherchées (10/12). La durée de +3 mois est juste. | MINEUR | Calcul (30/10 + 14 j = 13/11) | Préciser « début = J+14, fin = début + 3 mois — INFÉRÉ ». |
| V29 | 05:G-BOOK-02 | « Taxes (« TVA ») » | « TVA » est une traduction de l'interface française. Aux US, il s'agit de sales tax et de surtaxe P2P, pas de TVA. | MINEUR | — | Écrire « sales tax (libellé traduit “TVA”) ». |
| V30 | 05:G-SEARCH-01 ; 05:G-BOOK-01 ; 06:H-TOOLS-01 ; 10:§5 | Mécanisme de stockage « cookie/localStorage » ; « indicatif déduit de la géolocalisation IP » ; « zones ≈ DMA Nielsen » ; « Turo a créé sa propre agence de courtage **pour distribuer** les protections » | Ce sont des **inférences sur l'implémentation interne ou l'intention**, non étiquetées, ou noyées dans un bloc OBSERVÉ. L'indicatif peut aussi venir de la locale ou du fuseau du navigateur. | MINEUR | — | Ajouter « (INFÉRÉ) » à chacune. |
| V31 | 06:H-ACQ | « $6.6B de revenus hôtes **cumulés** » « au 31/10/2025, 12 derniers mois » | Ambigu : s'agit-il d'un cumul historique ou des 12 derniers mois ? Arithmétique vérifiée : 10 489 / 12 = 874 ; × 3 = 31 467 ; × 5 = 52 445. | MINEUR | — | Relire la mention et préciser. |
| V32 | SRC_TOS_NOTES:TOS-GUEST (RC Canada) | Assureur canadien « **Economical** » | SRC_GUEST_DOCS 3.15 cite « **Definity** ». Economical est devenu Definity : le nom est daté et incohérent entre fichiers. | MINEUR | SRC_GUEST_DOCS 3.15 | Écrire « Definity (ex-Economical) ». |
| V33 | SRC_TOS_NOTES:Plan vs TOS-GENERAL | Plan « Dispute resolution (US / Canada / France / Australia / reste du monde) » ; puis « UK → droit anglais » | Incohérence interne : le Royaume-Uni est absent du plan. **Non vérifiable** (terms en 403). | MINEUR | — | Relire la section concernée. |
| V34 | SRC_TOS_NOTES:TOS-REG vs 06:Inscription | CGU : « compte = … **téléphone mobile** … » ; observé : « Pas de téléphone … à l'inscription » | Écart entre la règle contractuelle et le formulaire. Le téléphone est collecté plus tard (checkout, vérification par short code, SRC 1.4.6). Ce n'est pas une erreur, mais l'écart doit être signalé. | MINEUR | SRC_GUEST_DOCS 1.1.1, 1.4.6 | Ajouter une note de réconciliation. |
| V35 | SRC_TOS_NOTES:TOS-ELIG | Hôte : 21 ans minimum, 18 ans au Royaume-Uni et en France | Le minimum US de 21 ans est corroboré. L'exception UK/FR n'a pas été vérifiée. | — (info) | https://help.turo.com/en_us/listing-a-vehicle-us-ryVXrEeVq.md (extrait de recherche) | Aucune correction pour le seuil US. |
| V36 | 06, 08, 09, 10 | Références à `22_OPEN_QUESTIONS`, `SRC_HOST_DOCS.md`, `10_INSURANCE` | Ces fichiers n'existent pas, ou portent un autre nom (10_INSURANCE_TRUST_AND_SAFETY.md). | MINEUR | `ls` du dossier | Créer les fichiers ou corriger les liens. |
| V37 | 05:G-BOOK ; 20_EVIDENCE_REGISTER | `vehicleId=3389909`, URL `/kissimmee-fl/toyota/rav4/1391638`, plus « 9 years of hosting », All-Star, Miami | **Vie privée :** aucun nom, téléphone ni email de tiers n'apparaît dans les fichiers audités. En revanche, l'identifiant d'annonce combiné à la ville, au modèle et à l'ancienneté **ré-identifie un hôte particulier**. | MINEUR | grep e-mails, téléphones et identifiants sur les 6 fichiers et le CSV | Pseudonymiser (« Annonce A — SUV compact 2022, Miami ») et garder les identifiants hors des livrables partagés. Les numéros et emails Turo de SRC_GUEST_DOCS (support, claims) sont institutionnels et non personnels. |
| V38 | SRC_GUEST_DOCS (référentiel) 4.1.5 vs 7.2 | Assistance renforcée « remboursée en no-show » vs « achat **non remboursable** » | Incohérence interne au référentiel. L'article guest-trip-start-failures confirme le remboursement en cas de no-show. | MINEUR | guest-trip-start-failures | Préciser dans SRC 7.2 : non remboursable une fois le trip commencé (INFÉRÉ). |

---

## 2. Confirmé (vérifié positivement)

### 2.1 Arithmétique (recalculée)

- **G-BOOK-02 :**
  - 123,08 − 6,80 = 116,28 ;
  - + 27,40 = 143,68 ;
  - + 13,27 = 156,95 ;
  - 123,08 / 3 = 41,03 $/j ;
  - remise 6,80 / 123,08 = 5,5 % ;
  - trip fee 27,40 / 116,28 = 23,6 %.
- **Tarif remboursable :** 172,41 − 156,95 = 15,46 $, soit +9,85 % par rapport au non remboursable, ou −8,97 % dans l'autre sens.
- **Frais jeune conducteur :** +150 $ et +60 $ sur 3 jours, soit 50 $/j et 20 $/j. Les écarts de taxes valent exactement 7 % (10,50 et 4,20).
- **Exemple 09 :** 116,28 × 0,8 = 93,02 ; × 0,2 = 23,26 ; + 27,40 = 50,66 ; / 143,68 = 35,3 %.
- **Revenus hôte (06) :** 10 489 / 12 = 874 ; × 3 = 31 467 ; × 5 = 52 445.
- **Features :** 21 fonctionnalités comptées (05:G-SEARCH-05).

### 2.2 Recoupé avec help.turo.com

- **Fenêtre d'annulation gratuite :** 24 h avant le départ, ou 1 h après la réservation si celle-ci est faite à moins de 24 h. Retenue de ½ jour ou 1 jour moyen (prix + trip fee) selon la durée ; 50 % de la livraison remboursée. Source : https://help.turo.com/en_us/canceling-a-trip-with-your-host-HJyUE4xN9.md
- **Gains de l'hôte en non remboursable :** gains complets si le guest annule plus de 24 h après la réservation, rien dans les 24 h. Source : https://help.turo.com/en_us/trips-canceled-by-guests-or-turo-BkGMU4gV9.md
- **No-show du guest :** 2 h aux US, au Canada et au Royaume-Uni. Retenue de 2 jours moyens (trip de plus de 2 jours) ou de 75 % d'un jour (2 jours ou moins). Protection, Extras, dépôt, frais jeune conducteur et 50 % de la livraison sont remboursés. Source : https://help.turo.com/en_us/guest-trip-start-failures-HJUfENeVq.md
- **Plans guest :** Premier 0 $, Standard 500 $, Minimum 3 000 $. Exclusion des dommages intérieurs et mécaniques (10 §1). Source : https://help.turo.com/en_us/summary-and-cost-of-protection-plans-or-us-guests-BJSgBNgVq.md
- **Plans hôte :**
  - More peace of mind : 70 %, franchise 250 $ ;
  - Balanced : 80 %, franchise 1 500 $ ;
  - More earnings : 90 %, franchise 2 750 $ ;
  - RC jusqu'à 750 000 $ ; New York : 300 000 $ pour More peace of mind, minima P2P de l'État pour les autres plans ;
  - perte totale plafonnée à 200 000 $.

  Sources : https://help.turo.com/en_us/earnings-plans-in-brief-us-hosts-ryy_U4gE9.md et https://help.turo.com/en_us/earnings-plans-in-detail-us-hosts-ByMOIVxEc.md
- **Exclusions des plans hôte :** usure, perte de revenus d'hébergement, véhicule de remplacement. Photos de fin de trip dans les 24 h (10 §3). Source : earnings-plans-in-detail (lien ci-dessus).
- **Part de l'hôte appliquée à la livraison et aux Extras aux US et au Canada :** confirme 10 §3 et contredit 06 sur l'aéroport (voir V07). Part variable dans les 9 marchés, de 65 à 100 %. Source : https://help.turo.com/en_us/earnings-and-host-share-r1zDrNlNc.md
- **All-Star :**
  - ≥ 85 % de notes 5★ ;
  - taux d'annulation ≤ 3 % ;
  - maintenance et propreté ≥ 80 % ;
  - 20 trips, ou 80 jours de trip sur 5 trips ;
  - évaluation trimestrielle sur 365 jours ;
  - frais d'annulation annulés et filtre de recherche dédié.

  Source : https://help.turo.com/en_us/all-star-host-program-r18TBExV5.md
- **Paiements partiels hebdomadaires pour les trips de plus de 7 jours** (06 H-MONTHLY, 08). Source : https://help.turo.com/en_us/getting-paid-SyALrVeN9.md (extrait de recherche)
- **Les prix de recherche incluent tous les frais obligatoires.** Trip fee non remboursable. Frais de conducteur additionnel : 5 $/j, plafonnés à 25 $. Source : https://help.turo.com/en_us/trip-costs-Syxm4NeNq.md
- **Checkout sans compte préalable aux US** (05 G-BOOK-01), cohérent avec SRC_GUEST_DOCS 1.1.1. Source : help:booking-a-car-in-the-us-H1gxVVeE9
- **Annulation gratuite remboursable « jusqu'au 13 janv. » pour un départ le 14 janv.** : cohérent avec la règle des 24 h. **Fenêtre de retrait de 2 h** : cohérente avec le seuil de no-show de 2 h. Amendes tabac et nettoyage de 150 $ (SRC 6.6).
- **Pénalités d'annulation de l'hôte :** 25 $, 50 $, et 150 $ pour un no-show (BR-CXL-13), cohérentes avec SRC_GUEST_DOCS 4.2.5.

### 2.3 Hors Turo

- **Fuseaux horaires (BR-CXL-00) :** Panama en UTC−5 sans heure d'été. Paraguay en **UTC−3 permanent**, loi promulguée en octobre 2024 (Ley 7354/2024). Sources : https://timeanddate.com/news/time/paraguay-abolish-dst-2024.html ; https://lists.iana.org/hyperkitty/list/tz@iana.org/thread/LXAN4PAEWYEWQJVYGSJ5NPIWWYQ2NHFZ/
- **Floride :** surtaxe P2P de 1 $/jour (Fla. Stat. 212.0606(3)) et taux de 6 % (État) + 1 % (comté de Miami-Dade). Source : https://m.flsenate.gov/Statutes/212.0606

### 2.4 Non vérifiables (pages turo.com en 403, aucun recoupement help trouvé)

- Statistiques de la landing hôte (6,6 Md$, 340 000 véhicules).
- Chiffres des trips mensuels (−61 %, −68 %, 40 %) et des trips aéroport (+21 %, −34 %, −33 %).
- Mois d'évaluation All-Star.
- Agent de sinistres « sous 1 à 3 jours ».
- Clauses des CGU : 500 $ de frais administratifs pour vol, plainte sous 12 h, Stripe Connect, dommages-intérêts forfaitaires de 5 500 $. Ce dernier montant est cependant corroboré par le help center (SRC 7.17).
- Politiques additionnelles (biométrie, Turo Insurance Agency).

---

## 3. Lacunes : fonctionnalités présentes dans SRC_GUEST_DOCS mais absentes de 05, 06 et 08 (to-do priorisée)

### P0 — indispensables au MVP et aux règles de paiement et de risque

1. **Dépôt de garantie** (SRC 2.5) :
   - montants : 750 $, 500 $ (New York), 250 $, 200 $ (système de sécurité) ;
   - seul le plus élevé s'applique ;
   - remise de 250 $ avec assurance personnelle ;
   - libération 80 h après la fin ;
   - incompatible avec le BNPL.
2. **Options et calendrier de paiement** (SRC 2.6) :
   - Pay now : débit 40 h après l'autorisation ou 1 h avant le départ ;
   - Pay later : débit 2 ou 7 jours avant ;
   - Pay as you go : segments de 30 jours, échec de paiement → trip raccourci ;
   - Pay over time ;
   - autorisation ≠ débit ;
   - moyens acceptés et refusés (Revolut seul prépayé accepté ; PayPal refusé).
3. **Vérification « approved to drive »** (SRC 1.3–1.4) :
   - permis physique obligatoire, permis refusés, conducteurs étrangers ;
   - selfie avec le permis ;
   - screening à chaque réservation ;
   - checklist post-réservation avec échéance 2 h avant le départ.
4. **Remise non remboursable de 10 % et condition des 4 jours** (V05), avec cumul additif des remises.
5. **Matrice d'âge complète** (V10) et restrictions de Premier.
6. **Conducteurs additionnels** (SRC 2.9) :
   - jusqu'à 8 conducteurs ;
   - 5 $/j plafonnés à 25 $ ;
   - le conducteur principal prend et rend le véhicule ;
   - responsabilité solidaire ;
   - règles de remboursement.
7. **Modifications** (SRC 5) :
   - acceptation automatique ;
   - extension jusqu'à 24 h après la fin, 12 h de réponse, prix recalculé ;
   - fin anticipée (3 h) ;
   - changement de lieu (8 h, 50/50) ;
   - swap.
8. **Check-in et check-out** (SRC 6.1–6.2) :
   - ouverture 24 h avant ;
   - 15 photos extérieures et 8 intérieures avec métadonnées ;
   - règles des clés et des boîtes à clés ;
   - retour non conforme : 50 $.
9. **Frais annexes** (SRC 6.3–6.9) :
   - retard : 30 min → ½ jour, 2 h → 1 jour + 20 $ ;
   - kilométrage (V02, V03) ;
   - carburant : +10 $ ;
   - barème de recharge VE ;
   - péages et PV : 90 / 180 / 185 jours ;
   - fourrière : 399 $ ;
   - contestation de facture : 48 h pour le guest, 72 h pour l'hôte ;
   - pénalités pour factures non éligibles.
10. **Sinistres** (SRC 7.7–7.13) :
    - déclaration de l'hôte sous 24 h ;
    - parcours de la réclamation ;
    - frais de traitement de 150 à 575 $ ;
    - ordre de recouvrement ;
    - règlement direct en 20 jours ;
    - vol : 30 jours ;
    - échéancier en 2, 4 ou 8 mois.

### P1 — confiance, qualité, marketplace

11. **Avis** (SRC 8.1–8.5) :
    - fenêtre de 10 jours, publication en double aveugle ;
    - sous-notes ;
    - texte obligatoire de 1 à 4★ ;
    - une note ≤ 3★ bloque le guest chez cet hôte ;
    - critères de retrait d'un avis.
12. **Messagerie seulement après réservation** (SRC 2.1.5, 8.6) et interdiction du marché gris (SRC 7.17).
13. **Usages interdits** (SRC 7.16) : VTC et livraison autorisés selon l'État, usage commercial interdit. **Passage de frontière** (SRC 6.4.3), à transposer pour Paraguay→Brésil/Argentine (déjà proposé en 05).
14. **Barème des sanctions hôte et exemptions** (V25). **Crédit de rebooking** (SRC 4.2.3). **Circonstances exceptionnelles** (SRC 4.1.8–4.1.9).
15. **Mode de réservation** (SRC 2.1, 2.2) :
    - Book Instantly généralisé ;
    - réglages de l'hôte : préavis, battement entre trips, durée min et max ;
    - segments de 30 jours ;
    - one-way seulement après la réservation.
16. **Aéroports** (SRC 2.3.4–2.3.6) : frais d'aéroport reversés intégralement, affichage de l'emplacement 1 h avant, crédit parking.
17. **Compte** (SRC 1.1.6, 1.5, 1.6) : un compte par personne, suspension et appel, chargeback, fermeture et suppression des données.
18. **Télématique** : AirTags interdits, caméra intérieure soumise au consentement du guest (SRC 6.1.6).

### P2 — croissance et distribution

19. Promotions, crédit voyage, cartes cadeaux, fin du programme de fidélité, parrainage hôte (SRC 2.7.4–2.7.7, 9.1–9.4).
20. Partenariats et canaux : Uber, ChatGPT et Claude, Citi/AAdvantage, Qatar Avios (SRC 9.5–9.6, 10.6–10.7).
21. Reçu détaillé et contrat de partage par segment (SRC 10.1–10.2) ; support avec assistant IA puis agent humain, et chats spécialisés (SRC 8.7).
22. Côté hôte : tout le flux de création d'annonce reste BLOQUÉ (06 H-ONB). SRC_HOST_DOCS est attendu, avec en priorité l'éligibilité des véhicules, les standards de qualité et le calendrier.

---

## 4. Synthèse des comptes

**CRITIQUE : 1** (V01) · **MAJEUR : 10** (V02–V11) · **MINEUR : 26** (V12–V34, V36–V38) · information : 1 (V35)
