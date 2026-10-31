# VERIF_10 — Audit indépendant du périmètre MVP reconstruit (04 révision 2, 15 v2, 18 v1)

> Auditeur indépendant (n'a pas rédigé ces fichiers). Revus sans modification : `04_FEATURE_INVENTORY.csv` (649 lignes, 16 colonnes), `04_FEATURE_INVENTORY_README.md`, `tools/check_inventory.py`, `15_PRODUCT_IMPROVEMENTS.md` (v2), `18_MVP_AND_ROADMAP.md` (v1). Contexte lu : VERIF_06, VERIF_07, VERIF_08, `08` (lecture seule), `09b`, `12` §10, `22`. Contrôles Python faits avec `python -I`, script indépendant écrit pour l'occasion (non fourni par l'auteur). Date : 2026-10-30.

## 0. Verdict

Le périmètre est **cohérent et solide sur le plan formel** (tous mes contrôles de structure passent ; les corrections de VERIF_06 et VERIF_07 sont réellement appliquées pour tous les CRITIQUE et la grande majorité des MAJEUR ; les 3 rejets sont justifiés). Le P0-A est **faisable sans détention de fonds par la plateforme**, mais pas « sans licence ni question ouverte » : il repose sur trois réponses externes (OQ-MK-02 lecture b, OQ-PAY-03, OQ-MK-01) dont la durée est inconnue, et sur un PSP unique (Tilopay) non validé pour le Panama.

Le point faible principal est **l'estimation** : 18 donne 21–42 semaines-équipe (5 à 10 mois calendaires pour une équipe), alors que le lead a annoncé au fondateur « 8–14 semaines de codage, bêta fermée ≈ 3 mois, bêta publique 4–5 mois ». Les deux ne sont pas réconciliables sans changer le périmètre. Les deuxièmes faiblesses : la chronologie du chemin critique (l'avis art. 288 arrive après un tiers à la moitié du build), des lacunes d'exploitation (support, sécurité, Ley 81, rapprochement des commissions) et des dépendances fonctionnelles non déclarées dans 04.

Comptes : **1 CRITIQUE, 11 MAJEUR, 7 MINEUR**.

## 1. Constats

| # | Gravité | Axe | Constat | Fichier / lignes | Correction proposée |
|---|---|---|---|---|---|
| V10-01 | **CRITIQUE** | Estimation | **Deux estimations contradictoires circulent.** 18 §5 : P0-A ≈ 21–42 semaines-équipe, « soit 5 à 10 mois pour une seule équipe » ; le tableau des lots (§6) confond semaine-équipe et semaine calendaire (fin du lot 5 à S21–S42). Le lead a dit au fondateur « 8–14 semaines de codage », bêta fermée ≈ 3 mois, bêta publique 4–5 mois. La borne basse de 18 (21) dépasse la borne haute du lead (14) ; rapport 2,6 à 3 entre les deux fourchettes. La « bêta publique » n'est définie nulle part dans 18 : P0-A + P0-B + P1 = 51–97 semaines-équipe (≈ 12 à 22 mois), incompatible avec 4–5 mois. Aucun des deux chiffres n'est une mesure (aucune vélocité observée). | 18 §0, §5, §6 ; message du lead | Adopter l'énoncé unique de §4 ci-dessous ; retirer « bêta publique 4–5 mois » ou la définir (nombre d'agences, périmètre) ; recaler après le lot 1 sur la vélocité mesurée. |
| V10-02 | MAJEUR | Estimation | **P1 sous-estimé par ligne.** P0-A : 137 lignes pour 21–42 sem. (0,15–0,31 sem./ligne) ; P1 : 343 lignes pour 25–45 (0,07–0,13 sem./ligne, 2 à 2,5 fois moins). P1 contient pourtant des lignes lourdes (moteur de risque, API, marque blanche, modifications/extensions/swap de trip, chargebacks, support 24/7, télématique). « Beaucoup de règles simples » n'est pas étayé. P0-B : 13 lignes pour 5–10 sem. (0,38–0,77/ligne), donc l'asymétrie est dans P1. | 18 §5 | Estimer P1 par epic comme P0-A, ou marquer la fourchette « non estimée de façon comparable » ; ne pas l'utiliser pour une date de bêta publique. |
| V10-03 | MAJEUR | Chemin critique | **Incohérence sur l'échéance de l'avis art. 288 (C2).** Texte : l'avis doit arriver « avant le lot 3 », « au plus tard vers S9 à S18 ». Diagramme §4 : C2 → C7 (textes) → L1, et C7 conditionne la signature des agences pendant le lot 1 (S5,5–S11). Donc C2 est requis avant la fin du lot 1, pas du lot 2. Plus fondamentalement, le build démarre à S0 en parallèle de l'avis : les lots 0–2 consomment ≈ 9–18 semaines-équipe (≈ 43 % de l'effort) avant la réponse binaire qui peut faire basculer vers le Paraguay (PYG, SIFEN, Bancard, textes). 18 §7 dit « lots 0 à 2 largement indépendants du pays » : faux pour PRC-020 (ITBMS), VER-027 (RUC, Aviso), PRC-025, FIN-002 (PAC), I18N-004, LEG-025, ADM-031. | 18 §4 (texte et diagramme), §7 | Fixer une échéance explicite de C2 (avant le lot 1 pour LEG-025/VER-027) ou plafonner la dépense avant l'avis (lot 0 + socle seulement) ; chiffrer la part du lot 0–2 réutilisable au Paraguay. |
| V10-04 | MAJEUR | Faisabilité P0-A | **OQ-MK-02 (lecture b) est une condition du GO Panama dans 12 §10.3** (« ce flux n'est pas une activité de casa de remesas »), mais 18 la relègue à une « lecture » : absente de la porte G1 du diagramme §6 et de la liste des préconditions P0-A du README §3 ; C3 « bloque : confirmation du P0-A » seulement. PAY-033 le reconnaît en note (« montage à confirmer par OQ-MK-01/OQ-MK-02 »). Le P0-A n'est donc pas « sans licence » tant que l'avocat n'a pas répondu ; le résumé de 18 §0 l'affirme sans réserve. | 18 §0, §3 C3, §6 G1 ; 04 README §3 ; 12 §10.3 | Ajouter OQ-MK-02 (lecture P0-A) à G1 et aux préconditions P0-A ; reformuler §0 : « sans détention de fonds, sous réserve de l'avis ». |
| V10-05 | MAJEUR | Faisabilité P0-A | **Quasi-custody / dépendances PSP non validées.** (a) PAY-001/PAY-033/PAY-021 : la plateforme stocke les identifiants API du compte marchand de chaque agence, crée les ordres et **exécute les remboursements** sur ce compte ; LEG-020 écrit « pas de mandat d'encaissement ». Une action de paiement exécutée au nom d'un tiers sans mandat écrit ni validation du PSP est un point à trancher (OQ-PAY-03 ne pose que la question de l'endpoint). (b) Tilopay est basé au Costa Rica, tarifs publics « très probablement costariciens », entité panaméenne inconnue (09b §2.4) : PSP **unique** pour le P0-A, secours dLocal non validé pour le Panama et sans Clave en direct. (c) Yappy : aucune API de remboursement trouvée, voie Tilopay inconnue (OQ-PAY-22) ; or PAY-021 suppose un remboursement manuel par l'agence ; OQ-PAY-22 et OQ-PAY-07 sont **P1** dans 22 alors que le P0-A en dépend (18 ne cite OQ-PAY-22 que dans C11 / P0-B). (d) PCI : la portée (SAQ A, champs hébergés) n'est écrite nulle part. (e) Stockage des identifiants : seul ADM-032 dit « secrets chiffrés ». | 04 PAY-001, PAY-021, PAY-033, LEG-020, ADM-032 ; 22 ; 09b §2.4 | Ajouter au contrat-cadre (LEG-025) un mandat limité d'exécution de remboursements, avec accord du PSP ; remonter OQ-PAY-22/07 en P0-A dans 22 ; préciser portée PCI et gestion des secrets (KMS, rotation, isolation par agence) dans ADM-032 ou PAY-001. |
| V10-06 | MAJEUR | Intégrité du revenu | **La seule recette du P0-A n'est pas contrôlable.** FIN-018 facture sur « les trips synchronisés » ; PAY-033 interdit le paiement au comptoir mais rien ne l'empêche ; le mode (b) (lien de paiement + confirmation de l'agence sous 2 h) et PAY-034 (« ou sur confirmation de l'agence ») reposent sur la déclaration de l'agence. Le rapprochement (FIN-005) est P0-B. Aucune ligne P0-A n'importe un relevé du PSP de l'agence pour le comparer aux trips ; aucun contrôle du contournement après la première location. Le recouvrement est limité à la suspension à J+30 (FIN-018). | 04 FIN-018, PAY-033, PAY-034, FIN-005 | Ajouter en P0-A un rapprochement léger : import mensuel du relevé PSP de l'agence (ou lecture API en lecture seule) comparé aux trips ; clause d'audit dans LEG-025 ; indicateur « réservations par agence vs capacité » dans ADM-005. |
| V10-07 | MAJEUR | Faisabilité P0-A | **Décisions de la plateforme sans levier financier.** CLM-006/ADM-008 produisent une « décision écrite et motivée » alors que la plateforme ne détient ni loyer ni caution : le règlement dépend de la coopération de l'agence (qui détient la caution du guest) ; le guest n'a de recours que le chargeback ou ACODECO. BKG-035 (annulation par la plateforme) et BKG-032 : le remboursement intégral passe par PAY-021 sur le compte de l'agence, sans règle sur qui supporte le coût ni sur ce qui se passe si l'agence refuse ou si le paiement est un Yappy non réversible. « Décision définitive » : validité non établie (OQ-BR-24). | 04 CLM-006, ADM-008, BKG-032, BKG-035, PAY-021 | Écrire dans LEG-025 : exécution obligatoire des décisions, délai, pénalité sur la facture de commission (seul levier) ; décrire le cas « annulation plateforme + Yappy ». |
| V10-08 | MAJEUR | Dépendances | **Le graphe de 04 est propre (0 inversion, 0 cycle) mais incomplet.** Les cycles ont été rompus en gardant un seul sens (README §6) ; 41 lignes P0-A citent dans leur description un autre identifiant P0-A absent de `dependances`. Dans le séquencement en lots de 18 (affectation reconstruite par moi), **16 de ces mentions placent la ligne avant sa cible**, dont : PRT-019 et E7 (lot 1) « revue par l'ops (ADM-004) », mais ADM-004 est en lot 3 ; VER-007/VER-013 (lot 1) routent vers ADM-029 (lot 3) ; HST-005 (assistant d'annonce, lot 1) utilise CAL-003 et PRC-001 (lot 2) ; TRP-002 (lot 4) ne déclare pas TRP-004/PAY-034 qui le bloquent. L'affirmation de 18 §6 « aucune ligne n'est placée avant une ligne dont elle dépend » n'est vraie que pour les arêtes déclarées. Conséquence : l'onboarding d'une agence n'est pas démontrable de bout en bout avant la fin du lot 3 (≈ S14–S27,5). | 04 `dependances` ; 18 §6 | Déclarer les arêtes manquantes (ou documenter le sens retenu) ; avancer ADM-004 et une version minimale d'ADM-029 au lot 1 ; reformuler l'affirmation de 18 §6. |
| V10-09 | MAJEUR | Conformité | **Ley 81/2019 insuffisamment traitée pour un P0 qui collecte de la biométrie.** Le P0-A collecte selfie, liveness, face match, cédula/passeport (E1) et envoie ces données à un fournisseur KYC (probablement hors Panama). Or LEG-010 (registre, responsable des données, **procédure de violation**) est **P1** ; LEG-007/008 (droits des personnes) sont P1 ; 12 « Questions à l'avocat » n° 7 (enregistrement, transferts hors Panama, GPS et biométrie, notification de violation) n'a pas de OQ dédiée en P0. 22 garde OQ-BR-25 (rétention) en **P1** et OQ-BR-21 en **P1**, alors que 18 §3 (C8, C9) et 15 IMP-46 les disent « P0 recommandé » ; README §9 admet que 22 n'a pas été repriorisé. 18 ne cite ni Ley 81 ni transfert international ni procédure d'incident. | 04 LEG-010, LEG-007 ; 18 §3 C9 ; 22 ; 12 | Remonter LEG-010 (version minimale : registre, contact, procédure de violation) en P0-A ; créer une OQ « Ley 81 : transferts, enregistrement, violation » en P0 ; aligner la priorité dans 22. |
| V10-10 | MAJEUR | Exploitation | **L'exploitation n'est ni chiffrée ni dotée.** SUP-004 promet un support humain « horaires étendus, par ex. 7 h–22 h, 7 j/7 » : 15 h × 7 j = 105 h de présence par semaine, soit ≈ 2,6 ETP de présence avant congés, alors que l'équipe décrite est 2 développeurs + 0,5 ETP produit/QA. S'ajoutent la revue KYC/KYB, ADM-029 (délai de 2 h ouvrées), l'instruction des dommages (CLM-006), la facturation et le recouvrement. 15 K.3 (C) liste ces postes sans ordre de grandeur ; 18 ne dit pas qui les tient. | 04 SUP-004, SUP-011, ADM-029 ; 18 §5 ; 15 K.3 (C) | Chiffrer en heures/semaine pour 5–10 agences ; réduire la plage ou la sous-traiter aux agences (urgence) ; nommer un responsable ops dans le plan. |
| V10-11 | MAJEUR | Sécurité / qualité | **Revue de sécurité, QA et environnements : une phrase.** 18 §5 prévoit « revue de sécurité avant la bêta » et un poste « Durcissement, QA, sécurité, pilote » de 2–4 sem. qui contient aussi la recette avec les agences, la formation des comptoirs et la restauration testée. Aucune ligne de 04 ne décrit l'environnement de préproduction ni la gestion des secrets ; pas de test d'intrusion, pas de RPO/RTO, pas de procédure d'incident, pas de plan de retour arrière du déploiement. Le socle (1,5–3 sem.) cite « environnements » sans livrable. | 18 §5, §6 lot 5 ; 04 ADM-032 | Ajouter un lot « sécurité » avec livrables (menaces, test d'intrusion externe ou revue ciblée, secrets, RPO/RTO) ; séparer la recette agence du durcissement. |
| V10-12 | MAJEUR | Technique | **Risque PWA non instruit.** TRP-002/TRP-004 exigent photos dans l'app **uniquement** (« pas d'import de galerie »), hors ligne, horodatage et empreinte, sur des appareils de comptoir inconnus. Sur iOS, une PWA ne garantit pas l'interdiction d'import de galerie via l'entrée fichier, le stockage hors ligne peut être purgé, la synchronisation en arrière-plan est limitée. 18 écrit « pas d'app store » implicitement mais n'évalue ni l'enveloppe native (Capacitor ou équivalent) ni son coût (publication stores, revue Apple). C'est le cœur de la preuve de litige (CLM-034). | 04 TRP-002, TRP-004 ; 18 E8 | Prévoir un test de faisabilité de 1 à 2 semaines au lot 0 sur les appareils réels des agences ; décider PWA seule ou enveloppe native avant le lot 4. |
| V10-13 | MINEUR | Application VERIF_07 | Résidus : F04 à F07 non appliqués (déclaré au README §9) ; **4 lignes P0 restent « DIRECTEMENT TESTÉ »** (BKG-002, BKG-006, PRC-012, PRC-020) ; PRC-020 décrit le calcul d'ITBMS Panama (7 %, assiette À VALIDER), tel que VERIF_07 F05 l'avait signalé ; **53 des 150 lignes P0 sont PROPOSÉ** ; 54 descriptions P0 font moins de 80 caractères (FLT-011 : 37) sans critère d'acceptation. | 04 | Requalifier PRC-020 ; compléter les 54 descriptions avant le lot concerné. |
| V10-14 | MINEUR | 15 v2 | Corrections VERIF_06 appliquées (120 marques « corrigé VERIF_06 »), mais résidus : IMP-02 §4 « preuve obligatoire » (l. 67) et formules « preuve opposable » (l. 237) contredisent la correction V6-05 (pratique recommandée) ; K.0 n'inclut pas OQ-BR-25 dans la porte P0-A alors qu'IMP-46 dit « à remonter en P0 » ; deux vérités de phase subsistent pour IMP-33/34 (P1 dans 15, P2 dans 04), documentées plutôt que corrigées ; V6-10 (saisie des scores) n'est traité que par un avertissement, les notes sont inchangées (acceptable, le score ne pilote plus le P0). | 15 l. 67, 237, K.0, K.2 | Corriger les trois formulations ; aligner IMP-33/34 sur 04. |
| V10-15 | MINEUR | Mermaid | Les deux diagrammes sont **valides à la lecture** (nœuds `{{" "}}`, `(["…"])`, `["…"]`, étiquettes d'arête entre guillemets, aucune parenthèse hors guillemets, chaînes `A --> B --> C` correctes) ; non compilés. Sémantique incomplète : le diagramme §4 omet C3 (OQ-MK-02), C8–C10, C12, le fournisseur KYC, l'approbation Meta des gabarits ; G0 (S-4 à S0) suppose 5–10 entretiens et un mystery shopping en 4 semaines sans justification. | 18 §4, §6 | Ajouter les nœuds manquants ; justifier ou élargir G0. |
| V10-16 | MINEUR | Roadmap | Critères de sortie de bêta « à fixer » (aucun seuil) ; pas de seuil d'arrêt (kill criteria) ; point mort non calculé (15 K.3 le reconnaît). | 18 §1.1, §7 | Fixer 4 seuils chiffrables avant le lot 3 (agences actives, trips terminés, délai d'ouverture d'un compte PSP, commission effective). |
| V10-17 | MINEUR | Formulation | VER-028 (P0-A) parle encore de « bénéficiaires de versements » alors que le P0-A ne verse rien ; ADM-007 (c) « crédit commercial plateforme » est une dépense de la plateforme sans plafond chiffré (ADM-031 « à décider »). | 04 VER-028, ADM-007 | Reformuler ; plafonds avant l'ouverture. |
| V10-18 | MINEUR | Sources multiples | 08 n'est pas aligné (BR-PAY-06, BR-REIMB-03) : 04/18 font foi par déclaration. Tant que 08 contredit PAY-036/PAY-037, un lecteur du seul 08 implémenterait l'ancien seuil de caution et le délai de 48 h. | 08, 18 §8 | Bandeau d'avertissement en tête de 08. |
| V10-19 | MINEUR | Valeurs Panama | F10 appliqué par ADM-031, mais toutes ses valeurs restent « À DÉCIDER » : un développeur peut les paramétrer, pas les figer ; la date de décision n'est pas dans le chemin critique (18 §4). | 04 ADM-031 ; 18 | Ajouter la décision ADM-031 comme jalon avant le lot 3. |

## 2. Question 1 — VERIF_06 et VERIF_07 réellement appliqués ?

### 2.1 VERIF_06 (CRITIQUE et MAJEUR échantillonnés)

| Constat | Gravité d'origine | Appliqué dans 15 v2 / 18 ? | Preuve | Reste |
|---|---|---|---|---|
| V6-01 portes juridiques | CRITIQUE | **Oui** | K.0 (3 portes), 25 marques « corrigé V6-01 » | OQ-BR-25 manquant dans K.0 (V10-14) |
| V6-02 flux « plateforme encaisse » | CRITIQUE | **Oui** | P0-A/P0-B définis (l. 11) ; 04 PAY-033, FIN-018 | — |
| V6-03 modèle de coût | MAJEUR | **Oui** | USD retirés ; (A) en sem.-équipe, (B)/(C) listés (41 marques) | — |
| V6-04 300–560 k$ | MAJEUR | **Oui** | fourchette retirée avec le calcul 295–564 | — |
| V6-05 ACODECO | MAJEUR | **Presque** | « pratique recommandée » dans IMP-02/10/27 | l. 67 et 237 (V10-14) |
| V6-06 prix 5–9 vs 35–55 $ | MAJEUR | **Oui** | l. 121, 135 | — |
| V6-07 / V6-09 géofencing, aéroport | MAJEUR | **Oui** | IMP-16 « lite », IMP-17 P1, IMP-25 P1 | — |
| V6-08 support 24/7 | MAJEUR | **Oui** | IMP-07 « lite », SUP-004 rescopé | dotation non chiffrée (V10-10) |
| V6-10 saisie des scores | MAJEUR | **Partiel** | avertissement en K.2 | notes inchangées |
| V6-11 unit economics P2P | MAJEUR | **Oui** | IMP-14/18/24 | — |
| V6-12 facture PAC | MAJEUR | **Oui** | IMP-13 l. 305, FIN-002 | — |
| V6-13 permis 90 jours | MAJEUR | **Oui dans 15/04, non dans 22** | VER-007 en signalement | OQ-BR-21 encore P1 dans 22 (V10-09) |
| 10 idées manquantes | — | **Oui** | IMP-40 à IMP-49 = §3.1 à §3.10 | IMP-47/49 sans ligne P0 (normal) |

### 2.2 VERIF_07

| Constat | Gravité | Appliqué ? | Preuve |
|---|---|---|---|
| F01 modèle d'encaissement | CRITIQUE | **Oui** | PAY-033, FIN-018 ; PAY-011/012/015, PYO-001/002/007, FIN-004/005 en P0-B |
| F02 paiements locaux / caution | CRITIQUE | **Oui** | PAY-004 P0-A, PAY-034, PAY-035 (caution chez l'agence) |
| F03 P0 non fermé, cycles | CRITIQUE | **Oui, vérifié** | mon script : 0 dépendance vers une phase plus tardive, 0 cycle (graphe complet) ; limite : arêtes déclarées seulement (V10-08) |
| F04–F07 preuves | MAJEUR | **Non** (déclaré §9) | 4 « DIRECTEMENT TESTÉ » en P0 |
| F08 ACODECO | MAJEUR | **Oui** | LEG-024 renommée « pratique recommandée », TRP-004 |
| F09 source 15 jamais citée | MAJEUR | **Partiel** | 27 mentions « IMP- » dans le CSV, 3 lignes P0 les citent en `source` |
| F10 valeurs US | MAJEUR | **Partiel** | valeurs Panama dans ADM-031 mais « À DÉCIDER » ; références Turo en USD conservées en notes (BKG-032, TRP-038, HST-019) |
| F11 barème complexité | MAJEUR | **Non** | aucun barème |
| F12 descriptions vagues, lignes BLOQUÉ en P0 | MAJEUR | **Partiel** | aucune ligne BLOQUÉ/NON EXPLORÉ en P0 ; 54 descriptions < 80 caractères |
| 143/146 rétrogradations, 5 promotions | — | **Oui** | arithmétique README vérifiée : 275 − 143 + 5 − 1 + 14 = 150 ; écart +9 vs VERIF_07 explicable (3 rejets + FLT-011 + 6 lignes en plus − REV-004) |

### 2.3 Les 3 rejets sont-ils justifiés ?

- **HST-033 (maintenu P0-A)** : justifié. LST-012 (P0) affiche la distance incluse, PRC-019 y est fusionné ; sans configuration, le contrat et la facture n'ont pas de valeur. Dépendance HST-005 déclarée.
- **NTF-002 (maintenu P0-A)** : justifié, avec une réserve. WhatsApp porte les OTP (VER-013) et le canal transactionnel, mais l'approbation des gabarits par Meta est un délai externe inconnu ; il faut un repli SMS/e-mail déclaré dans NTF-001 pour ne pas bloquer l'ouverture (non écrit).
- **FIN-005 (maintenu P0, rangé en P0-B)** : justifié (rapprochement indispensable dès qu'il y a des fonds de tiers). Mais cela laisse **le P0-A sans aucun rapprochement** (V10-06).

## 3. Question 2 — Contrôles Python

### 3.1 Script de l'auteur : `python -I tools/check_inventory.py`

Résultat : **RÉSULTAT : OK**. Sortie : 649 lignes, 16 colonnes, tous champs entre guillemets, IDs uniques, 668 dépendances, 0 inconnue, 0 inversion, 0 cycle, 15 epics, 150/150 lignes P0 couvertes, plus longue chaîne 11.

Limites du script : il ne lit que les arêtes déclarées ; il ne vérifie ni l'affectation aux lots de 18, ni les identifiants cités dans 15 et 18, ni le contenu des lignes (mentions non déclarées), ni la présence de CA.

### 3.2 Mes contrôles indépendants (script écrit pour l'audit)

| Contrôle | Résultat |
|---|---|
| Colonnes | 16 pour 649 lignes (aucune ligne irrégulière) |
| Répartition `phase_mvp` | P0-A 137 / P0-B 13 / P1 343 / P2 109 / P3 47 : **identique** au README et à 18 |
| IDs uniques | oui |
| Dépendances inexistantes | 0 ; aucune chaîne de dépendances sans motif d'ID |
| Auto-dépendances | 0 |
| P0-A dépendant de P0-B ou de P1+ | **0** |
| P0-B dépendant de P1+ | **0** |
| Inversions de phase (toutes phases) | 0 |
| Cycles (graphe complet, DFS) | 0 |
| Plus longue chaîne P0 | 11 niveaux, dernier nœud LEG-024 ; **la chaîne citée par 18 §4 est exacte** (10 arêtes vérifiées une à une) |
| Epics | 15 lus ; 150 IDs, tous uniques, tous P0 ; la phase de chaque epic = phase de chaque ligne ; sommes E1–E13 = 137, E14–E15 = 13 |
| Identifiants cités dans 15 et 18 | 67 et 150 identifiants, 0 inconnu |
| Listes P1/P2/P3 de 18 §6 | une seule discordance : SUP-004 (P0-A), marquée « reliquat » par 18 |
| §2 de 18 « hors périmètre » | 2 lignes P0-A citées (SUP-004, FIN-002), toutes deux déclarées « reliquat » |
| Affectation aux lots (reconstruite à partir des listes de 18) | 12 + 37 + 28 + 37 + 23 = 137 ; chaque ligne P0-A dans exactement un lot ; **0 inversion sur les arêtes déclarées** |
| Arêtes non déclarées (mentions dans la description) | 41 lignes P0-A concernées, 16 mentions avec inversion de lot (V10-08) |
| Sommes d'effort 18 §5 | lots : 2–4,5 / 3,5–6,5 / 3,5–7 / 5–9,5 / 5–10,5 / 2–4 = 21–42 ; epics : 21 à 41,5 ; cohérent |
| Champs vides | `dependances` 56, `regles_liees` 10, `notes` 243 (pas anormal) |

## 4. Question 3 — P0-A est-il faisable sans détention de fonds ?

**Oui sur la conception, avec cinq réserves.** Aucune ligne P0-A ne dépend d'une ligne P0-B ; le contrôle de mots-clés (détient, versement, payout, escrow, licence, remesa, OQ-MK-02/03, OQ-PAY) sur les 137 lignes ne trouve aucune ligne qui exige une garde de fonds, des versements ou une licence : PAY-006 (« la plateforme ne détient pas les fonds »), PAY-021, ADM-007, CLM-006, FIN-001 (GMV encaissé par les agences hors bilan), TRP-035 (frais de retard encaissés par l'agence), PAY-035 (caution chez l'agence) sont écrites dans ce sens. Les mentions de « versement » ou « payout » dans VER-028, FIN-001, PYO-013, FIN-018 sont des restes de formulation ou des références au P0-B.

Réserves (déjà détaillées au §1) :
1. OQ-MK-02 (lecture b) est une condition de GO dans 12 §10.3 (V10-04).
2. La plateforme exécute des opérations sur les comptes PSP des agences sans mandat écrit (V10-05).
3. PSP unique, non validé pour le Panama ; remboursement Yappy inconnu (V10-05).
4. Si l'avis Tilopay conduit à percevoir la commission par **split à la source** (endpoint évoqué dans OQ-PAY-03), la plateforme reçoit des fonds : c'est PAY-038, qui est P0-B ; la facturation mensuelle (FIN-018) est la seule voie P0-A compatible.
5. Les décisions de litige n'ont pas de levier (V10-07) et le revenu n'est pas rapproché (V10-06).

## 5. Question 4 — Réconciliation des estimations

### 5.1 Ce que 18 appelle une « semaine-équipe »

18 §5 : 1 semaine-équipe = **une semaine de 2 développeurs full-stack (dont un senior) travaillant avec Claude Code, ~0,5 ETP produit/QA, design ponctuel** ; chaque changement relu par un humain ; revue de sécurité avant la bêta. L'IA accélère le code applicatif, les écrans et les tests, **pas** les intégrations tierces, les allers-retours avec les agences, la recette ni les textes juridiques. Le tableau des lots traite ensuite la semaine-équipe comme une **semaine calendaire** (S) sans marge : 21–42 semaines = 5 à 10 mois. Sont **hors** de cet effort : les délais externes (avis juridiques, assureur, comptes PSP des agences, Meta, contrat KYC), l'exploitation (support, ops), la rédaction des textes juridiques, la vente et l'onboarding des agences.

### 5.2 Ce que dit le lead

« 8–14 semaines de codage » pour une bêta fermée avec Claude Code ; bêta fermée ≈ 3 mois ; bêta publique 4–5 mois ; validations externes = vrai goulot. La formulation sépare correctement codage et goulot externe (point juste), mais le chiffre de codage est 2,6 à 3 fois inférieur à 18, sans hypothèse écrite.

### 5.3 Lequel est le plus défendable ?

- **Rapport lignes / semaines** : 137 lignes en 21–42 semaines-équipe = 3,3 à 6,5 lignes livrées par semaine d'équipe ; 8–14 semaines imposerait 10 à 17 lignes par semaine, y compris KYC avec liveness, abstraction PSP avec webhooks, PWA hors ligne, contrat PDF signé, grand livre, facturation et back-office à rôles. Indicateur grossier, non une mesure : 45 lignes sont de complexité faible, 82 moyenne, 10 élevée (colonne `complexite_tech`).
- **Ce qui rend les 8–14 semaines plausibles** : un périmètre réduit à une « tranche mince » (par exemple 60 à 80 lignes, sans iCal, sans connecteur PAC, back-office minimal, ops manuelles, une seule agence, un seul PSP) ou une vélocité IA nettement supérieure à celle supposée, non démontrée ici.
- **Conclusion** : la fourchette de 18 est la plus défendable **pour le P0-A tel que défini** (137 lignes, 13 epics) ; elle est large (facteur 2) à dessein. Les 8–14 semaines ne tiennent que comme **borne optimiste d'une tranche mince**, qui n'existe pas encore dans 04. Ni l'une ni l'autre ne reflète les délais externes.

### 5.4 Énoncé unique proposé (à utiliser tel quel auprès du fondateur)

> **Hypothèses.** Équipe de 2 développeurs full-stack (dont 1 senior) plus ~0,5 ETP produit/QA ; Claude Code utilisé en continu pour le code applicatif, les tests et les migrations ; relecture humaine de chaque changement ; 1 semaine-équipe = 1 semaine calendaire de cette équipe, sans marge pour congés, retours en arrière ni attentes. Les délais externes, l'exploitation (support, ops) et la rédaction juridique ne sont pas inclus.
>
> **Effort de build.** Bêta fermée P0-A complète (137 lignes de 04, 13 epics) : **≈ 21 à 42 semaines-équipe**, soit **5 à 10 mois calendaires** pour une équipe ; 2 à 4 de ces semaines sont la recette avec les agences et la revue de sécurité. P0-B : ≈ 5 à 10 semaines-équipe, seulement après avis. P1 : ordre de grandeur non comparable (voir V10-02). La mention « 8 à 14 semaines de codage » ne vaut que pour une **tranche mince à définir ligne par ligne** (non estimée) ; elle ne doit pas être donnée comme la durée du P0-A.
>
> **Calendrier d'ouverture.** Date d'ouverture = le plus tardif de (fin du build) et (dernier prérequis externe : avis art. 288 / OQ-MK-02, attestation des polices flotte, comptes Tilopay des agences pilotes, textes signés), plus la recette pilote. Aucun délai externe n'est connu ; il faut les demander aux cabinets, à l'assureur et à Tilopay avant d'annoncer une date. Les validations ne s'additionnent pas au build si elles sont lancées à S-4 en parallèle, mais l'avis art. 288 doit précéder la signature des agences (lot 1).
>
> **Bêta publique.** Non définie dans 18 ; P0-A + P0-B + P1 ≈ 51 à 97 semaines-équipe (≈ 12 à 22 mois) : « 4–5 mois » n'est pas compatible. À redéfinir (par exemple : P0-A avec davantage d'agences) ou à retirer.
>
> **Recalage.** Mesurer la vélocité réelle à la fin du lot 1 (S ≈ 5,5–11) et republier la fourchette.

## 6. Question 5 — Qualité de la feuille de route

| Sujet | Évaluation |
|---|---|
| Chemin critique | La chaîne technique (11 niveaux) est exacte. La chaîne externe est incomplète et contradictoire sur C2 (V10-03) ; OQ-MK-02 absent de G1 (V10-04) ; ADM-031 (valeurs) absent. |
| Dépendances externes | Bien listées en §3 (12 préconditions, qui, ce qui est bloqué) ; aucune durée, aucun propriétaire nommé, pas de repli si Tilopay refuse ou tarde. |
| Séquencement des 6 lots | Cohérent sur les arêtes déclarées. Problèmes : le lot 1 (identité et agences) est livré sans file d'examen (ADM-004 en lot 3) ni règles de risque (ADM-029 en lot 3) ; la première démonstration de bout en bout n'arrive qu'à la fin du lot 3 ; le lot 5 mélange durcissement, recette, formation et sécurité (V10-08, V10-11). |
| Sécurité | Une ligne dans le lot 5 (V10-11). |
| Protection des données Ley 81 | LEG-010 en P1, OQ non prioritaire (V10-09). |
| Observabilité, sauvegardes | ADM-032 (sauvegardes quotidiennes, test de restauration mensuel, alertes webhooks PSP) : bon niveau minimal ; RPO/RTO absents. |
| Préproduction | Absente en tant que livrable. |
| App store | Non prévu (PWA) ; le risque iOS n'est pas instruit (V10-12). |
| Support / ops | Non dotés (V10-10). |
| Rapprochement du revenu | Absent en P0-A (V10-06). |
| Mermaid | Syntaxe valide à la lecture (V10-15). |
| Risques §7 | Pertinents ; manquent : refus ou lenteur de Tilopay, fraude par contournement, PWA iOS, charge ops. |

## 7. Ce qui est bien fait (pour mémoire)

Cohérence exemplaire entre 04, 18 et le README (comptes, epics, listes de phases) ; correction de VERIF_06/07 traçable ligne par ligne (« Dépendances corrigées », « Description initiale ») ; honnêteté sur ce qui n'est pas appliqué (README §9) ; coûts USD inventés retirés ; P0-A/P0-B séparés avec leurs portes ; chaîne critique exacte ; plus aucune ligne BLOQUÉ en P0.

## 8. Verdict

**GO conditionnel pour utiliser 04 et 18 comme base de cadrage du build du P0-A**, après correction des points ci-dessous. Ne pas communiquer de date au fondateur avant l'énoncé de §5.4.

Priorités avant le lot 0 : (1) V10-01 énoncé d'estimation unique ; (2) V10-03/04 échéance de l'avis art. 288 et OQ-MK-02 dans G1 ; (3) V10-05 mandat et validation du PSP pour exécuter paiements et remboursements sur le compte des agences ; (4) V10-09 Ley 81 (LEG-010 minimal en P0-A). Avant le lot 3 : V10-06, V10-07, V10-10. Avant le lot 4 : V10-11, V10-12.

Fichiers revus non modifiés.
