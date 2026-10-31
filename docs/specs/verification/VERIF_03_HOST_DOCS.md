# VERIF_03 — Audit indépendant de SRC_HOST_DOCS.md, 06_HOST_JOURNEYS.md et 10_INSURANCE_TRUST_AND_SAFETY.md

> **Auditeur :** agent indépendant. Je n'ai rédigé aucun des documents revus. **Date :** 2026-10-30.
> **Méthode :** 58 articles `help.turo.com/en_us/<slug>.md` re-téléchargés le 2026-10-30 (HTTP 200, version Markdown officielle) ; PDF officiel `support-resources.turo.com` des plans antérieurs au 07/01/2026 ; SEC EDGAR (S-1/A n°12 lu via WebFetch, lecture tronquée ; recherche plein texte EDGAR `efts.sec.gov` ; liste des dépôts RW) ; WebSearch pour les points secondaires.
> **Aucune tentative de contourner le 403 de turo.com** : pas de changement d'user-agent, ni proxy, ni cache, ni archive. `data.sec.gov` a renvoyé 403 (user-agent non déclaré). Je n'ai pas insisté et je suis passé par les pages EDGAR accessibles.
> Les affirmations OBSERVÉ / DIRECTEMENT TESTÉ de 06/10 ne peuvent pas être rejouées. Je n'ai vérifié que leur cohérence.
> Les fichiers revus **n'ont pas été modifiés**.

---

## 1. Tableau des constats

| ID | Fichier : section | Affirmation | Problème | Gravité | Preuve / URL | Correction proposée |
|---|---|---|---|---|---|---|
| F01 | 06 : H-MONTHLY | Une remise mensuelle « optimisée » de 45 % débloque une limite réduite de **1 800 miles/mois**. | Contredit H25 et SRC §3.1. Aux US, le minimum mensuel est de **3 300 mi/mois** pour un véhicule Standard. 1 800 mi/mois ne vaut que pour Deluxe et Super Deluxe (en km pour FR/UK). La page marketing lue dans le navigateur visait peut-être un autre segment, ou 06 l'a mal transcrite. Ce chiffre sert à modéliser l'économie des trajets mensuels. | MAJEUR | https://help.turo.com/en_us/distance-limits-and-additional-distance-SkWUrEgVc.md (« US (Standard vehicles): 3,300 mi/month » ; « US (Deluxe and Super Deluxe vehicles): 1,800 mi/month ») | Remplacer par « 3 300 mi/mois (Standard US) ; 1 800 mi/mois (Deluxe / Super Deluxe US) » et signaler l'écart avec la page marketing. |
| F02 | 06 : H-AIRPORT | L'hôte touche **90 % des frais de livraison** pour les trajets aéroport, ce qui diffère de la part du plan. | Périmé. Pour les trajets réservés **depuis le 8 octobre 2026**, les hôtes US et CA touchent sur la livraison et les Extras **la part de leur plan** (ou la part variable). Le taux de 90 % ne reste valable qu'en AU et au UK. SRC §4.2 est correct ; 06 le contredit. | MAJEUR | https://help.turo.com/en_us/how-vehicle-delivery-works-hosts-B1HUH4eVq.md (paraphrase, A24-21 : pour les trips réservés depuis le 8 oct. 2026, les hôtes US et CA gardent sur la livraison la part de leur plan de gains) ; https://help.turo.com/en_us/earnings-and-host-share-r1zDrNlNc.md | Corriger : « Depuis le 08/10/2026 (US/CA) : part du plan, soit 70/80/90 % ou la part variable. 90 % seulement en AU/UK. » Si la page aéroport affiche encore 90 %, l'indiquer comme contenu marketing non mis à jour. |
| F03 | 10 : §3, « Lecture business » | Commission hôte de « 10–30 % selon la franchise ». | Incomplet. Dans les 9 marchés à part variable, la commission va de **0 % (More earnings, 28 jours ou plus) à 35 % (More peace of mind, 0–2 jours)**. | MINEUR | https://help.turo.com/en_us/earnings-and-host-share-r1zDrNlNc.md (tableau 80/90/100 … 65/75/85) | Écrire : « 10–30 % en standard ; 0–35 % en part variable ». |
| F04 | SRC : §11, point 12 | « La grille actuelle va de 10 à 30 %, et jusqu'à 0 % en part variable. » | Même omission : en part variable, la borne haute est **35 %** (part hôte de 65 % à 0–2 jours). | MINEUR | idem H33 | Écrire « 0 à 35 % en part variable ». |
| F05 | 10 : §3, « Lecture business » | « trip fee ~24 % ». | Aucun chiffre sourcé. SRC §3.3 ne donne qu'un pourcentage variable (H124), avec une fourchette de 2,5 à 100 % chez Sacra (DOC-2). Le taux de 24 % semble provenir d'un seul checkout observé, sans que ce soit dit. | MINEUR | SRC §3.3 (H124, P2) | Retirer ce chiffre, ou le marquer « observé sur 1 checkout (n=1) » avec sa référence. |
| F06 | 10 : §3, processus dommages | Un agent contacte l'hôte « sous 1 à 3 jours ». | Simplification. H72 indique **24 heures ouvrées**, H75 **2 à 3 jours ouvrés** (contradiction déjà notée en SRC §11.7). 10 fusionne les deux sans le préciser. | MINEUR | https://help.turo.com/en_us/reporting-and-resolving-damage-or-us-hosts-SymY8VlN5.md ; https://help.turo.com/en_us/contacting-claims-or-hosts-rya5IVlN5.md | Écrire « 24 h ouvrées (H72) à 2–3 jours ouvrés (H75) ». |
| F07 | SRC : §6 (ligne « Turo Go ») et §11, point 14 | Turo Go est « absent du centre d'aide actuel ». | Inexact. Le résumé de l'article H90 (guest no-show) mentionne encore « Turo Go guest … 12 hours » (métadonnée héritée). Le terme figure aussi dans le S-1/A n°12 (confirmé). | MINEUR | https://help.turo.com/en_us/how-to-manage-a-guest-no-show-SkNzL4g4q.md (ligne de résumé) | Écrire : « ne survit que dans un résumé hérité (H90) ; aucun article dédié ». |
| F08 | SRC : §7, Power Host | Seuils « tenus 3 mois » mentionnés pour l'**AU seulement**. | Le UK et le CA exigent aussi que les seuils soient tenus « for a period of three or more months ». Pas les US. | MINEUR | https://help.turo.com/en_us/power-host-program-or-uk-BypWE7JSc.md ; https://help.turo.com/en_us/power-host-program-rkzbtKnN5.md | Appliquer « tenus ≥ 3 mois » à UK, CA et AU. |
| F09 | SRC : §7, Power Host | Le CA n'est pas détaillé, mais l'avantage US « vitrage 100 $ / pneus 200 $ » est présenté sans nuance. | Aux US, l'avantage vaut « regardless of the earnings plan ». Au Canada, il est réservé aux sinistres « More earnings plan claims only ». Risque de généralisation. | MINEUR | H102 ; H104 (liens ci-dessus) | Ajouter la nuance pour le Canada. |
| F10 | SRC : §5.3, ligne Carburant | Délai « 72 h (H59) ; selon le plan US, 72 / 96 / 120 h (H31) ». | La contradiction est réelle et documentée : H59 (màj 21/09/2026), H62 et H63 (29/07/2026) disent 72 h, sans plan, alors que H31 (18/08/2026) et H32 (21/05/2026) disent 5, 4 ou 3 jours. La conclusion INF « le plan semble l'emporter » n'est pas démontrée, puisque l'article le plus récent (H59) dit 72 h. | MINEUR | https://help.turo.com/en_us/reimbursement-invoice-guidelines-hosts-SyCDS4eVc.md ; https://help.turo.com/en_us/earnings-plans-in-brief-us-hosts-ryy_U4gE9.md | Garder la contradiction ouverte. Pour la conception, retenir 72 h comme plancher sûr, avec une extension conditionnelle selon le plan. |
| F11 | SRC : §2 vs §8 | P1 (communiqué de presse Turo du 26/06/2024) est classé **DOC-2** en §2 mais **DOC** en §8. | Étiquetage incohérent pour une même source. Un communiqué émis par Turo est une source officielle (DOC), même lu via un résumé. | MINEUR | SRC §2 (ligne W1/P1) ; §8 (ligne Turo Host Services) | Uniformiser : P1 = DOC (communiqué, lu via résumé) ; W1 = DOC-2 (extrait). |
| F12 | SRC : §4.1 | La part variable s'applique « à partir du 02/04/2026 ». | Non vérifiable directement (pages turo.com en 403). Les extraits de recherche sur les annonces Turo évoquent un déploiement de la part variable « starting March 31 » dans ces marchés. La date du 02/04 n'est donc pas confirmée. | MINEUR | WebSearch : turo.com/blog/news/introducing-earnings-plans/ (extrait uniquement) | Écrire « fin mars / début avril 2026 (DOC-2, à confirmer) ». |
| F13 | SRC : §3.4 (S1, S3) | Exemple S-1 : mensualités de 6 256 $/an, profit cumulé de 7 123 $ sur 3 ans, 2,7×. | Arithmétique **non reproductible** à partir des hypothèses citées. Un prêt de 24 300 $ (27 000 $ moins 10 % d'apport) à 7,5 % sur 60 mois donne **≈ 487 $/mois, soit 5 843 $/an**, et non 6 256 $. Le résultat d'exploitation annuel ressort à 10 658 − 1 106 − (2 223 à 3 203) − 6 256 = **93 à 1 073 $/an**, soit 279 à 3 219 $ sur 3 ans. Le chiffre de 7 123 $ suppose donc une valeur résiduelle ou des capitaux propres dans le véhicule, que SRC ne mentionne pas. Enfin, 7 123 / 2 700 = **2,64×** et non 2,7×. Ce sont des illustrations (images) que je n'ai pas pu lire. | MINEUR | https://www.sec.gov/Archives/edgar/data/1514587/000162828024047889/hosting-economics_072524a.jpg (non lisible ici) | Ajouter : « inclut probablement la valeur résiduelle ; hypothèses de financement incluant taxes et frais ». Ne pas réutiliser ces chiffres comme référence d'économie hôte sans relire l'image. |
| F14 | 06 : H-PERF-01, H-MONTHLY, H-AIRPORT ; 10 : §3, §4, §5 | Sections marquées « DOCUMENTÉ — https://turo.com/... ». | Ces pages renvoient 403 aux outils, et SRC §12 (W5) les déclare « **non lues** ». Elles ont été lues dans le navigateur, ce qui est donc une observation non rejouable, sans capture archivée référencée. L'étiquette DOCUMENTÉ masque cette fragilité, et SRC et 06/10 se contredisent sur l'état de lecture des mêmes URL. | MINEUR | SRC §12 W5 (« 403, non lus ») | Étiqueter « DOCUMENTÉ (lu dans le navigateur le 2026-10-30, non rejouable) ». Mettre à jour W5 dans SRC et y référencer les captures d'écran. |
| F15 | SRC : §3.4 / §11.17 vs 06 : H-TOOLS-01 | SRC : contenu du Carculator « non vérifiable (403) ». 06 : Carculator « DIRECTEMENT TESTÉ » via l'iframe resources.turo.com. | Pas de contradiction de fond, mais SRC n'est pas à jour : le Carculator a été testé dans le navigateur. Les méthodologies divergent aussi : SRC (W4, UK) cite un ROI basé sur le prêt, 06 (US) cite la moyenne de TMV > 10 000 $, années 2020 et plus, 08/2025–08/2026. | MINEUR | 06 H-TOOLS-01 ; SRC W4 | Citer 06 dans SRC §3.4 et préciser que les méthodologies diffèrent selon le pays. |
| F16 | 06 : H-PERF-01 | Power Host : « Critères à documenter ». | Ils sont déjà documentés dans SRC §7 (H102–H105). Incohérence de consolidation entre fichiers. | MINEUR | https://help.turo.com/en_us/power-host-program-or-us-ry1laC6Nc.md | Renvoyer vers SRC §7. |
| F17 | SRC : §6, annulations | « 20 trajets ou moins » / « Plus de 20 trajets ». | Nuance perdue : la source dit « 20 or fewer **booked** trips » d'un côté et « more than 20 **completed** trips » de l'autre. Les bases de comptage diffèrent. | MINEUR | https://help.turo.com/en_us/canceling-a-trip-with-your-guest-hosts-HkkzLVlE5.md | Préciser « réservés » et « complétés ». |
| F18 | SRC : §7, Standards qualité | « En dessous : **fermeture du compte**. » | Le texte de H10 dit « accounts removed », mais le tableau dit « Deadline to avoid hosting restriction ». Le vocabulaire de la source est ambigu entre retrait et restriction. Le résumé est acceptable, mais l'ambiguïté devrait être signalée. | MINEUR | https://help.turo.com/en_us/quality-standards-SJ10p9JEJl.md | Ajouter « (H10 alterne entre "removed" et "restriction") ». |

**Données personnelles de tiers :** aucune trouvée. Tous les e-mails et numéros présents (claims@turo.com, powerhostsupport@turo.com, (415) 508-0283, +1 415-965-4525, +1 415-849-3398) sont des coordonnées professionnelles de Turo publiées dans le centre d'aide. Le « compte Turo 566544 » chez Safelite est un identifiant d'entreprise, pas une donnée personnelle. L'adresse d'aéroport MIA citée dans 06 est publique.

**Contradiction signalée par l'appelant (jours de délai supplémentaires) : COHÉRENTE.** 06/10 donnent +2 / +1 / 0 jour supplémentaire ; SRC donne 5 / 4 / 3 jours (120 / 96 / 72 h). Avec une base de 72 h (3 jours), on obtient 3 + 2 = 5, 3 + 1 = 4 et 3 + 0 = 3, ce qui correspond exactement à H32. Aucune correction nécessaire, mais les deux fichiers devraient indiquer explicitement la base de 72 h.

---

## 2. Arithmétique recalculée

| Calcul | Résultat | Verdict |
|---|---|---|
| Exemple S-1 « Anatomy of a booking » : 60 (véhicule) + 15 (services guest) + 12 (frais marketplace guest) + 7 (remboursements) + 6 (taxes) | 100 $ | OK |
| Part hôte du prix véhicule : 51 / 60 | 85 % | OK |
| Frais hôte : 4,50 / 60 | 7,5 % (× 2 = 15 %) | OK |
| Part hôte du GBV : (51 + 7) / 100 | 58 % | OK |
| Part Turo du GBV : (4,50 + 4,50 + 15 + 12) / 100 | 36 % (+ 6 % de taxes = 100 %) | OK |
| Kilomètre supplémentaire : 300 $ / 600 mi | 0,50 $/mi | OK (H25) |
| Distance hebdomadaire sous la remise de 15 % : 200 × 7 | 1 400 mi | OK (H25) |
| Simulateur 06 : 874 × 12 | 10 488 $ (affiché 10 489 $) | Écart d'arrondi, acceptable |
| 3 voitures et 5 voitures : 10 489 × 3 et × 5 | 31 467 $ et 52 445 $ | OK |
| Commission = 100 − part hôte (US standard) | 30 / 20 / 10 % | OK |
| Commission en part variable | 0 à 35 % | Voir F03 / F04 |
| Prêt S-1 de 24 300 $, 7,5 %, 60 mois | 486,92 $/mois, soit 5 843 $/an (≠ 6 256 $) | Voir F13 |
| Multiple S-1 : 7 123 / 2 700 | 2,64× (≠ 2,7×) | Voir F13 |
| Nombre d'amendements S-1/A (EDGAR) | 12 (du 20/05/2022 au 14/11/2024) | OK |

---

## 3. Liste « confirmé » (affirmations DOCUMENTÉ vérifiées contre la source officielle)

**Plans hôte et part hôte**
1. 3 plans US : More peace of mind 70 % / 250 $, Balanced 80 % / 1 500 $, More earnings 90 % / 2 750 $ ; RC 750 000 $ (NY : 300 000 $ sur Peace of mind, minimums légaux sinon) ; délais de 5 / 4 / 3 jours ; newsletter trimestrielle, semestrielle ou annuelle. https://help.turo.com/en_us/earnings-plans-in-brief-us-hosts-ryy_U4gE9.md
2. Plans en vigueur depuis le 07/01/2026 ; NY aux minimums légaux depuis le 17/06/2026 (1 250 000 $ avant) ; Travelers, Constitution State Services ; Turo Insurance Agency (415) 508-0283 ; Washington = assurance achetée par Turo ; usure extérieure ≤ 3" exclue, même cumulée ; pneus de 6 ans ou plus exclus ; gardiennage plafonné à 2 500 $ ; retenue de 20 % au-delà de 125 000 $ sans tracker OEM. https://help.turo.com/en_us/earnings-plans-in-detail-us-hosts-ByMOIVxEc.md
3. Plans antérieurs : 60 / 75 / 80 / 85 / 90 ; franchises 0 / 250 / 750 / 1 625 / 2 500 $ ; RC de 750 000 $ (NY 1 250 000 $) ; usure extérieure couverte sur le plan 60 seulement. https://support-resources.turo.com/protection/us-host-protection-plans-available-before-1726.pdf
4. Part variable dans 9 marchés : 80/90/100, 75/85/95, 70/80/90 et 65/75/85 selon les tranches 28 j et plus, 14–27 j, 3–13 j et 0–2 j ; s'applique aussi au kilométrage supplémentaire, à l'usage additionnel et aux retards ; maintenue en cas d'échange de véhicule. Reversés à 100 % : carburant, recharge, PV, péages, nettoyage et tabac. AU/UK : 90 % sur la livraison et les Extras. https://help.turo.com/en_us/earnings-and-host-share-r1zDrNlNc.md
5. Livraison et Extras à la part du plan pour les trajets réservés depuis le 08/10/2026 (US/CA) et le 19/10/2026 (FR) ; plus de 50 Extras éligibles. https://help.turo.com/en_us/how-vehicle-delivery-works-hosts-B1HUH4eVq.md ; https://help.turo.com/en_us/how-extras-work-hosts-rkKLHExEc.md
6. Plan par défaut : US, AU et CA « More peace of mind », FR plan 85, UK Balanced ; un plan est obligatoire pour chaque véhicule. https://help.turo.com/en_us/updating-a-vehicle-earnings-plan-rJS2S4eNq.md
7. UK : 60 % / £0, 70 % / £250, 80 % / £1 750 ; plafond £70 000 ; véhicule de courtoisie £350 ; perte de revenus £300. https://help.turo.com/en_us/earnings-plans-in-brief-uk-hosts-ByiuUNl4c.md
8. CA : 85 % / 2 000, 75 % / 250, 65 % / 0 ; RC de 2 M CA$ ; plafond de 150 000 CA$ ; remplacement jusqu'à 500 CA$. https://help.turo.com/en_us/earnings-plans-in-brief-canada-hosts-HyN_U4eVc.md
9. AU : 65 % / 100, 75 % / 750, 85 % / 2 500 ; RC de 20 M A$ ; Turo Travels Mutual ; Picnic Licensing (AFSL 532540) ; plans en vigueur depuis le 31/03/2026 ; plafond A$200 000. https://help.turo.com/en_us/earnings-plans-au-hosts-rkPsWGdHi.md
10. FR : plan 80 à 0 €, 85 à 500 €, 90 à 1 000 € ; RC matérielle 100 M€, incendie 2 M€ ; plafond 150 000 € ; restriction possible des plans 80 et 85. https://help.turo.com/en_us/protection-plans-in-brief-france-hosts-rJiEbwZa2.md

**Book Instantly, remises, kilométrage**
11. Book Instantly : acceptation automatique selon les disponibilités ; l'hôte doit honorer les trajets ; frais d'annulation jusqu'à 50 $. https://help.turo.com/en_us/using-book-instantly-BJvHz8yIq.md
12. Remises de durée activées d'office, minimums de 3 / 5 / 10 / 15 / 20 % ; non-remboursable de 10 % à partir de 4 jours d'avance, non modifiable ; application séquentielle ; Pay as you go au-delà de 30 jours ; codes post-trajet de 5 / 10 / 15 %, plafond 100 $, 90 jours. https://help.turo.com/en_us/offering-discounts-rJJHrVxVq.md
13. Kilométrage journalier minimum : US/UK 200 / 100 / 75 mi ; FR 200 / 150 / 100 km ; AU/CA 300 / 200 / 100 km ; hebdomadaire 1 050 mi à partir de 15 % de remise ; mensuel 3 300 mi (Standard US) ou 1 800 mi (Deluxe) à partir de 45 %. https://help.turo.com/en_us/distance-limits-and-additional-distance-SkWUrEgVc.md
14. Classes Deluxe / Super Deluxe : seuils US, AU, CA, FR et UK ; FR 7 ans de permis. https://help.turo.com/en_us/deluxe-class-and-super-deluxe-class-eligibility-Syv7H4lV5.md

**Éligibilité et onboarding**
15. US : 21 ans minimum ; webinaire d'orientation obligatoire avant la mise en ligne ; plaque, marque, modèle, année ; 10 photos conseillées. https://help.turo.com/en_us/listing-a-vehicle-us-ryVXrEeVq.md
16. Mise en ligne sous 24 à 48 h après le webinaire. https://help.turo.com/en_us/orientation-webinar-us-hosts-rkmw4DTnWe.md
17. Véhicule US : 12 ans maximum ; moins de 130 000 mi (peut rester au-delà s'il est en excellent état) ; 200 000 $ maximum ; titre clean, jamais déclaré en perte totale ; 16 places ou plus interdites (CA : 10) ; box trucks sauf en Oregon ; plaques concessionnaire interdites ; vignette NY. https://help.turo.com/en_us/vehicles-we-accept-rylmrNl45.md
18. Box trucks : sans freins pneumatiques ; 10 000 lb (NY, SC) et 14 000 lb ailleurs. https://help.turo.com/en_us/box-trucks-hosts-Sk111wtlkl.md
19. FR : 18 ans minimum ; 12 ans maximum à la mise en ligne ; 18 ans maximum pour rester depuis le 06/01/2026 ; 150 000 € ; moins de 300 000 km. https://help.turo.com/en_us/vehicle-eligibility-france-r1nVktcan.md
20. UK : 18 ans minimum ; 12 ans ; £70 000 ; 130 000 mi ; 9 places. https://help.turo.com/en_us/meeting-vehicle-requirements-or-uk-Syu3iEgv9.md
21. CA : provinces et Yukon ; 200 000 km ; 150 000 CA$ ; plus de 9 places interdites. https://help.turo.com/en_us/meeting-vehicle-requirements-or-canada-ryYjTRW8c.md
22. AU : 21 ans minimum ; spécialité entre 12 et 25 ans. https://help.turo.com/en_us/vehicle-eligibility-au-Hy7rf1yBi.md
23. Rappels : retrait sous 72 h ; CA/HI : annulation 7 jours avant. https://help.turo.com/en_us/safety-recall-regulations-B1DELEgE5.md
24. Inspection annuelle à soumettre sous 14 jours ; liste des États exemptés ; 6 mois pour les autres nouvelles annonces. https://help.turo.com/en_us/annual-vehicle-safety-inspections-ByJmUVg4c.md
25. Horaires par défaut : 7h–22h en semaine, 7h–19h le week-end. https://help.turo.com/en_us/setting-your-car's-availability-BkpBSVxVq.md
26. Photos : au moins 1 ; recadrage d'environ 20 % ; IA et photos de stock interdites. https://help.turo.com/en_us/listing-photos-guide-rJBHuRQSh.md

**Versements et Stripe**
27. Premier trajet : environ 3 jours ouvrés ; trajets suivants : 3 h ; partiel tous les 7 jours au-delà d'une semaine ; 1 versement par jour ; banque 3 à 5 jours ouvrés. https://help.turo.com/en_us/getting-paid-SyALrVeN9.md
28. Compte Stripe créé à la première annonce ; vérification en moins d'une minute. https://help.turo.com/en_us/setting-up-an-account-to-get-paid-HJVvHNeNq.md

**Remboursements et sinistres**
29. Kilométrage, recharge, carburant : 72 h ; péages et PV : 90 jours ; nettoyage et tabac : 72 h ; retards : 72 h ; guest : 48 h pour payer ; hôte : 72 h en cas de contestation ; facturation en cours de trajet à partir de 60 jours. https://help.turo.com/en_us/reimbursement-invoice-guidelines-hosts-SyCDS4eVc.md
30. Péages : 90 jours ; tardifs sous 30 jours après l'avis et dans les 180 jours ; facture automatique 7 jours après le trajet. https://help.turo.com/en_us/how-to-charge-guests-for-tolls-hosts-SkCOrNlE9.md
31. Carburant : manquant + 10 $ ; ticket de 72 h maximum. https://help.turo.com/en_us/how-to-charge-guests-for-vehicle-refueling-hosts-S1d_r4xV5.md
32. Dommage déclaré sous 24 h ; pièces sous 15 jours ; métadonnées date, heure et géolocalisation ; photos 24 h avant et après. https://help.turo.com/en_us/reporting-damage-Bk7aIWhHi.md
33. Contact sous 24 h ouvrées ; éligibilité en 3 jours ouvrés ; vol jusqu'à 30 jours ; inspection sur place de 5 à 7 jours. https://help.turo.com/en_us/reporting-and-resolving-damage-or-us-hosts-SymY8VlN5.md
34. Équipe sinistres : du lundi au samedi, 5h–17h PT ; +1 (415) 965-4525 ; 2 jours ouvrés. https://help.turo.com/en_us/contacting-claims-or-hosts-rya5IVlN5.md
35. Retard : signalement après 30 min et sous 24 h. https://help.turo.com/en_us/reporting-a-late-return-H15iBExV5.md

**Annulations, performance, comptes**
36. Annulation hôte : 25 $ à plus de 24 h, 50 $ à moins ; 20 trajets ou moins : webinaire, puis retrait 3 jours, puis fermeture ; plus de 20 : 5 % → 7 jours (+ webinaire selon le pays), 10 % → fermeture (FR : 15 %) ; frais annulés pour les All-Star ; rappel US sans pénalité. https://help.turo.com/en_us/canceling-a-trip-with-your-guest-hosts-HkkzLVlE5.md
37. Barème de frais : absence de l'hôte 150 $ (FR 100 €) ; profiteering 250 $ ; marché gris 150 $ + 5 500 $ ; factures inéligibles 50 / 200 / 500 $ ; avertissement puis 500 / 1 000 $ ; fausse déclaration 200 à 2 000 $ ; aéroport 100 / 250 $. https://help.turo.com/en_us/host-fees-r1aIIExV5.md
38. Guest absent : 2 h (US/CA/UK) ou 30 min (AU/FR) ; 15 min de délai de réponse ; signalement sous 72 h ; 75 % d'une journée ou 2 journées ; ½ livraison. https://help.turo.com/en_us/how-to-manage-a-guest-no-show-SkNzL4g4q.md
39. Annulation guest : non remboursable annulé plus de 24 h après la réservation → gains complets ; ½ journée ou 1 journée ; ½ livraison. https://help.turo.com/en_us/trips-canceled-by-guests-or-turo-hosts-BkGMU4gV9.md
40. All-Star : 20 trajets ou 80 jours sur 5 trajets ; 85 / 80 / 80 % ; 3 % d'annulations ou moins ; 365 jours ; code de 100 $ après 4 trimestres, valable 180 jours ; règle rétroactive du 08/10/2024. https://help.turo.com/en_us/all-star-host-program-r18TBExV5.md
41. Power Host US : 4 véhicules ; 36 000 $ ; support 7j/7 6h–20h PT ; vitrage 100 $, pneus 200 $ ; sinistres en 2 à 3 jours ouvrés. UK : 3 véhicules, £10 000. CA : 3 véhicules, 20 000 CA$. AU : 4 véhicules, A$15 000. https://help.turo.com/en_us/power-host-program-or-us-ry1laC6Nc.md (+ articles UK, CA, AU cités en F08)
42. Standards qualité : 65 % (14/09/2026), 67,5 % (04/01/2027), 70 % (26/04/2027) ; entretien supérieur à 50 % puis 60 % sur les 10 derniers trajets ; batterie 12,1 V ; pneus 4/32" et moins de 6 ans. https://help.turo.com/en_us/quality-standards-SJ10p9JEJl.md
43. Fermeture de compte : au moins 30 jours de préavis, ou 90 jours après le dernier trajet ; trajets à plus de 72 h annulés sans gains ; facturation 90 jours ou 72 h ; anomalie « Last update: 2026-11-9 » confirmée. https://help.turo.com/en_us/turo-initiated-account-closures-hosts-H1VFT5tQp.md
44. Co-hôtes : 2 lots de permissions non séparables ; liste des permissions et des interdits ; hôte principal responsable ; invitation de 30 jours ; custodian à réinviter. https://help.turo.com/en_us/permissions-for-hosting-teams-Sklzc59oT.md ; https://help.turo.com/en_us/create-a-hosting-team-rk_2ODtop.md
45. Parrainage : 300 $ chacun. https://help.turo.com/en_us/faqs-host-referral-program-us-BkFI1rLbMl.md

**SEC**
46. S-1/A n°12 (14/11/2024) : environ 150 000 hôtes, 350 000 véhicules, 3,5 M guests, plus de 16 000 villes (« actif » = au moins 1 trajet sur 12 mois) ; GBV 351,6 / 335,9 / 1 256,4 / 2 061,0 / 2 409,7 M$ et 1 980,3 M$ sur 9 mois 2024 ; 24,4 M jours (2023) ; chiffre d'affaires 469,0 (+213 %), 746,6 (+59 %), 879,7 (+18 %) et 722,0 M$ (+8 %) ; résultat net 154,7 / 14,7 / 19,4 M$ ; marge brute 54,3 / 51,4 / 46,3 % ; marge de contribution 25,4 % (2023) ; Risk Score US avril 2020, CA juin 2023 ; 34 % / 7 % / 89 % / 57 % ; 973 employés ; OuiCar en mai 2022 ; Turo Go mentionné. https://www.sec.gov/Archives/edgar/data/1514587/000162828024047889/turoinc-sx1a12.htm
47. Présence dans sx1a12 confirmée par la recherche plein texte EDGAR (termes seulement, chiffres exacts non lus) : « 84% of our active hosts », « 104 … operations and support … 973 », « Hiyacar », « captive » + « Washington », « July 2021 » + « take rate ». https://efts.sec.gov/LATEST/search-index?q=%2284%25%20of%20our%20active%20hosts%22&ciks=0001514587
48. Formulaire RW du **13/02/2025** (n° 0001628280-25-005472) ; 12 amendements S-1/A entre le 20/05/2022 et le 14/11/2024 ; S-1 initial du 10/01/2022. https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001514587&type=RW ; Renaissance Capital (secondaire, même date).

---

## 4. Lacunes (non vérifiable ou non vérifié)

- **Illustrations du S-1 (S2 « Anatomy of a booking », S3 « hosting economics »)** : images servies par sec.gov, non lisibles ici. L'arithmétique de S2 est cohérente ; celle de S3 n'est pas reproductible (F13). **Non vérifiable.**
- **Valeurs exactes du S-1** pour 84 %, 104 employés, hausse du take rate en juillet 2021, assureur captif, support 24/7 US/CA/AU et liste des concurrents : seule la présence des termes a été confirmée par la recherche plein texte (la lecture WebFetch est tronquée). **Partiellement vérifié.**
- **Pages turo.com** (blog Book Instantly W1, earn W3, Carculator W4, host-hub, all-star-host, insurance, trust-and-safety, additional-policies) : 403. Non contourné. Les contenus de 06/10 qui en dépendent sont **non vérifiables** (dont $6.6B, 3.6M, 28 000 villes, 170+ aéroports, −61 % / −68 %, +21 % / −34 % / −33 %).
- **Dates du 31/03/2026 (renommage en « earnings plans ») et du 02/04/2026 (part variable)** : le 31/03 est cohérent avec H38 (AU) et avec des extraits de recherche ; le 02/04 n'est pas confirmé (F12).
- **Sources secondaires** (Sacra P2 : 958 M$, 140 000 hôtes, commission de 25 %, licenciements ; P3 Kyte ; P4 Uber ; P6–P8 API et outils) : non revérifiées, déjà correctement étiquetées DOC-2.
- **Chiffre de 165 000 hôtes au 30/06/2024 (§11.11)** : non vérifié (il faudrait le S-1/A n°11).
- **Articles non re-téléchargés** (environ 80 des H-refs, dont H04, H09, H14, H15, H24, H31 en partie, H44, H52–H58, H64–H67, H69, H70, H76–H82, H92–H100, H106, H110–H139) : non vérifiés dans cet audit.
- **H127** (lois P2P, 26 États) : lu partiellement selon SRC lui-même ; non vérifié.
