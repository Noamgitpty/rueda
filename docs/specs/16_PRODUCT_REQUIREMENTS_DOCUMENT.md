# 16 — Product Requirements Document (PRD)

> **Statut : PROPOSÉ — version 4 du 2026-10-30 (passe de cohérence finale VERIF_18 ; décisions DEC-FONDATEUR-05 à 10 ; nouveaux epics E16 à E18 ; journal en D.6).** Version 3 (alignement v4 sur 17 v4 : changements C-v3-01 à C-v3-18 et C-v4-01 à C-v4-08 de l'annexe C de 17, contradictions résiduelles R1–R12 traitées, catalogue véhicules ajouté ; marques « (aligné v4) » ; journal en D.5). Version 2 : consolidation 04/08/16/17 et correction VERIF_15 (journal en D.4). Document de spécification destiné à l'équipe de build (équipe multi-agents Claude Code : orchestrateur, agents d'implémentation, vérificateurs indépendants, agent DESIGN, agent QA ; le fondateur, seul humain, est product owner, recette, comptes et juridique — DEC-FONDATEUR-05). Aucune ligne de code applicatif.
> **Sources lues** : `RESUME_HERE.md`, `04_FEATURE_INVENTORY.csv` (révision 3) et `04_FEATURE_INVENTORY_README.md`, `05_GUEST_JOURNEYS.md`, `06_HOST_JOURNEYS.md`, `08_BUSINESS_RULES.md`, `09_PRICING_PAYMENTS_AND_PAYOUTS.md`, `09b_PAYMENT_PARTNERS_PA_PY.md`, `10_INSURANCE_TRUST_AND_SAFETY.md`, `11_EDGE_CASES_AND_FAILURES.md`, `15_PRODUCT_IMPROVEMENTS.md`, `18_MVP_AND_ROADMAP.md`, `22_OPEN_QUESTIONS.md` ; depuis la version 2 : `10b_UX_UI_ANALYSIS.md` v2 (écrans S01–S17, A01–A13, O01, exigences UX-xx, questions UXQ) et `17_DATA_MODEL_AND_ARCHITECTURE.md` v2 (§2.5, annexes A et C) (consolidé VERIF_15-F2, F9). Turo n'a pas été consulté à nouveau : chaque fait Turo renvoie à la source citée dans 04 (`05 G-…`, `06 H-…`, `SRC_G`, `SRC_H`, `TOS-…`, `EV-…`). Tout ce qui n'existe pas chez Turo est **PROPOSÉ**.
> **Règle de cohérence** : `04_FEATURE_INVENTORY.csv` reste la source de vérité du périmètre (phases, epics, lots, `beta_pilote`) ; `08_BUSINESS_RULES.md` celle des règles (BR, SM, vecteurs T01–T68) ; `22_OPEN_QUESTIONS.md` celle des questions ouvertes. En cas d'écart, 04 et 18 font foi pour le build, 08 pour le calcul. Le modèle de données et l'architecture sont décrits dans `17_DATA_MODEL_AND_ARCHITECTURE.md` : depuis la version 2, les entités, états, rôles, paramètres, événements et codes d'erreur des fiches portent les **noms canoniques de 17** (correspondance en A.8.2) ; les modules restent génériques (A.8). Les écrans cités sont ceux de 10b §4.1 (rubrique « Source » de chaque fiche).
> **Écrans conçus sans observation de Turo** (ajouté constat 24-08) : les écrans de trip (check-in, check-out, extension), de réclamation et de litige, de vérification KYC, de calendrier et de versements (modules TRP, CLM, VER, CAL, PYO) sont des **conceptions nôtres** nourries par le centre d'aide de Turo (DOCUMENTÉ), **pas des benchmarks d'interfaces observées** : aucun trip réel, aucune réclamation, aucun KYC ni tableau de bord hôte avec annonce n'a été vu (02 « Limites connues »).
> **Décisions fondateur laissées OUVERTES** (ne jamais les trancher dans le code ni dans une fiche) : **DEC-FONDATEUR-01** (OQ-BR-41 : la plateforme indemnise-t-elle le loueur quand l'annulation vient d'elle ? paramètre `platform_funded_host_compensation`, absent = **false**, fail-closed, vecteur T61) et **OQ-BR-04** (jours facturés, frontière retard / extension ; proposition en cours : tolérance 29 min de 04, ou frontière de jour à +2 h et frais de retard ≥ coût d'extension, selon RESUME_HERE). Le pays de **lancement** (Panama GO CONDITIONNEL, ou Paraguay) n'est pas tranché non plus ; les deux pays sont construits dès le départ (DEC-FONDATEUR-04). **Décisions fondateur prises le 2026-10-30** (22, « Décisions prises ») : **DEC-FONDATEUR-02** — on construit d'abord ; les avis juridiques (OQ-MK-01, OQ-MK-02, OQ-MK-05, OQ-MK-06, OQ-MK-09, OQ-BR-24…) deviennent un **préalable à l'ouverture à de vrais clients**, plus un préalable au build ; **DEC-FONDATEUR-03** — l'intégration d'un PSP réel est reportée au choix du pays : le build se fait contre l'abstraction `PaymentProvider` (PAY-001) avec un adaptateur fictif / bac à sable (`psp_account.provider = FAKE`), tous les adaptateurs propres à un PSP (Tilopay, Yappy, Bancard vPOS, upay, dLocal) sont différés. **DEC-FONDATEUR-04** (2026-10-30) — la plateforme est construite **dès le départ pour le Panama et le Paraguay** : le pays est une configuration (USD / PYG sans décimale, `America/Panama` / `America/Asuncion`, ITBMS 7 % / IVA 10 % en paramètres datés, cédula PA / PY et passeport, es / en, pt plus tard pour les visiteurs brésiliens au Paraguay) ; les intégrations réelles (PSP, facturation électronique PAC / SIFEN, juridique) restent différées (DEC-FONDATEUR-03) et le pays de **lancement** reste à choisir. **DEC-FONDATEUR-05 à 10** (2026-10-30) — aucun développeur humain, build par une équipe multi-agents Claude Code, le fondateur seul humain (05) ; agent DESIGN dédié et relecteur UX/design indépendant, web mobile-first et PWA installable dans le MVP, applications natives plus tard (06) ; design modifiable à tout moment par le fondateur : tokens pilotés par les données, back-office « Apparence / Marque », blocs de contenu es/en, bibliothèque de composants, « Naming & identité » en premier (07) ; transmissibilité totale : IaC, conteneurs, portabilité, comptes au nom du fondateur, runbooks, checklist de passation (08) ; tests exhaustifs et portes CI bloquantes, agent QA indépendant (09) ; autonomie des agents, communication par artefacts versionnés, point fondateur hebdomadaire, valeur par défaut pour chaque décision, red-team, pré-mortem et post-mortem (10) : fiches des epics E16 et E17. Décisions produit encore ouvertes et paramétrées : TTL du hold `AGENCY_LINK` (UXQ-09, ADR-025, PROPOSÉ 120 min), moment du paiement d'une réservation signalée (UXQ-08), sort de la retenue quand l'agence est inéligible en P0-A (OQ-BR-45, défaut `REFUND_GUEST`). Liste complète : `22_OPEN_QUESTIONS.md`, section « Décisions fondateur / produit en attente ».

## Sommaire

- **Partie A** — Vue produit : vision, personas, périmètre par phase, non-objectifs, métriques de succès, préconditions juridiques par phase, exigences non fonctionnelles globales, conventions (modules, rôles, erreurs, vecteurs de test).
- **Partie B** — Fiches FEATURE des 179 lignes P0-A et P0-B de 04, epic par epic (E1 à E18 ; E14 et E15 = P0-B ; E18 = connecteurs réels du lot C). Quelques micro-lignes d'un même epic sont regroupées dans une fiche ; chaque `feature_id` y est listé et couvert.
- **Partie C** — Tableau compact des lignes P1, P2 et P3.
- **Partie D** — Matrice de traçabilité (feature → BR → EC → vecteurs → OQ) et liste des fiches bloquées par des questions ouvertes.

---

# PARTIE A — Vue produit

## A.1 Vision

Une place de marché de location de véhicules pour l'Amérique latine, construite dès le départ pour le **Panama** et le **Paraguay** (pays de lancement à choisir, DEC-FONDATEUR-04), en mode **pro-first** : d'abord des **agences de location professionnelles** (plaques commerciales, Aviso de Operación, police flotte) qui distribuent leur flotte via la plateforme, ensuite (P2) des **hôtes particuliers vérifiés** (P2P). La plateforme reprend les mécanismes éprouvés de Turo (recherche, fiche, checkout une page, contrat par trip, photos de check-in, règles d'annulation et de retard ; 05, 06, 08) en les adaptant à un marché où :

- une part des clients n'a **pas de carte de crédit** (Yappy, Clave, caution sans carte : PAY-004, PAY-035 ; 12 §1.5, §2) ;
- **WhatsApp** est le canal principal (NTF-002, VER-013 ; 15 IMP-06) ;
- la **preuve** (photos horodatées, contrat, constancia, décisions motivées) protège contre les litiges et les plaintes ACODECO (LEG-024, CLM-034) ;
- le cadre juridique impose une montée en charge par portes : **P0-A** = l'agence encaisse sur son propre compte PSP, la plateforme facture une commission et **ne détient aucun fonds** ; **P0-B** = la plateforme encaisse, détient la caution et reverse, **seulement après avis juridiques** (12 §10.3 ; 18 §1).

Proposition de valeur : pour le **guest**, un prix TTC affiché dès la recherche (SRC-042, divergence volontaire avec Turo qui affiche HT), une vérification d'identité unique, un contrat bilingue et une caution compatible avec ses moyens ; pour l'**agence**, un canal de distribution supplémentaire sans changer de PSP, un outil comptoir rapide (≤ 5 écrans, ≤ 10 min par remise, TRP-052) et des preuves exploitables ; pour la **plateforme**, une commission mensuelle (défaut 12 %, OQ-MK-07) sans risque de détention de fonds de tiers en phase 0.

## A.2 Personas

| ID | Persona | Contexte | Besoins principaux | Rôle technique | Phase |
|---|---|---|---|---|---|
| PER-01 | **Guest touriste** | Étranger de passage (≈ 28 % de nord-américains parmi les visiteurs, 12 §1.2), permis étranger, carte de crédit le plus souvent, téléphone en roaming data | Réserver depuis l'étranger, comprendre le prix TTC et la caution, être vérifié avant d'arriver, contrat en anglais de courtoisie, règle des 90 jours du permis étranger (VER-007) | `GUEST` | P0-A |
| PER-02 | **Guest résident** | Panaméen ou résident, cédula, permis panaméen, souvent **sans carte de crédit**, paie par Yappy | Payer par Yappy, caution par débit, espèces ou Yappy restitué (filtre « sin tarjeta de crédito »), interface en espagnol | `GUEST` | P0-A |
| PER-03 | **Agence — gérant / représentant légal** | Société (RUC), 10 à 300 véhicules, déjà présente sur d'autres canaux, compte PSP existant | KYB rapide, import CSV de flotte, contrat-cadre clair, encaissement sur son propre compte, relevé et facture de commission compréhensibles, pas de double réservation | `AGENCY_OWNER` (représentant légal : contrat-cadre, mandat PSP, membres) ; `AGENCY_MANAGER` (+ `AGENCY_ACCOUNTANT` pour la comptabilité) | P0-A |
| PER-04 | **Agent comptoir de l'agence** | Employé au comptoir, tablette ou smartphone (iOS ou Android), wifi du comptoir | Liste du jour, contrôle du permis en 6 points, photos guidées, saisie de la caution prise, signature, check-out, le tout en ≤ 10 min | `AGENCY_COUNTER_AGENT` | P0-A |
| PER-05 | **Agent support** | Équipe es/en, WhatsApp Business, email, téléphone, horaires étendus (SUP-004) | Vue 360° du trip et des personnes, relais des messages, prise d'incidents, gabarits de réponses | `SUPPORT_AGENT` | P0-A |
| PER-06 | **Finance plateforme** | Comptable ou contrôleur | Calcul de la commission, relevés, facture PAC, rapprochement mensuel avec le relevé PSP de l'agence, avoirs, relances | `FINANCE` | P0-A (P0-B : fonds de tiers, versements, ITBMS collecté) |
| PER-07 | **Admin / Ops plateforme** | Équipe opérations, responsable ops nommé (SUP-020) | Files KYC, KYB, annonces, réservations à risque ; paramètres Panama ; annulations plateforme ; litiges ; sécurité et exploitation | `OPS_AGENT`, `ADMIN` | P0-A |
| PER-08 | **Hôte particulier vérifié (P2P)** | Particulier propriétaire d'un véhicule | Éligibilité du véhicule, onboarding fiscal, protection | (à définir) | **P2** seulement (OQ-BR-35, OQ-BR-16, OQ-BR-28) — hors de ce PRD détaillé |

Acteur technique supplémentaire : `SYSTEM` (tâches planifiées, webhooks PSP, moteur de règles codées en dur).

## A.3 Périmètre par phase

| Phase | Définition (04 README §3, 18 §1) | Lignes 04 | Ce que fait la plateforme | Ce qu'elle ne fait pas |
|---|---|---|---|---|
| **Bêta pilote** | Tranche mince du P0-A : 1 à 2 agences du pays de lancement (choix en attente), flotte importée par l'ops, remise au comptoir, volume limité | 166 lignes P0-A dont OUI 25, SIMPLIFIÉ 71, MANUEL 58, DIFFÉRÉ 12 (passe VERIF_18 : + I18N-005, FIN-003, epics E16 à E18) | 96 lignes construites ; paiement par **lien du PSP de l'agence** (PAY-033 mode b) | Les 58 lignes MANUEL sont des procédures humaines (décrites dans chaque fiche, champ « Bêta pilote ») |
| **P0-A** | Bêta fermée, 5 à 10 agences, **l'agence encaisse** | 166 (E1 à E13, E16 à E18 ; lots 0 = 22, 1 = 50, 2 = 65, 3 = 24, 4 = 1, C = 4) | Recherche, KYC, réservation, contrat, devis TTC, ordre de paiement sur le compte PSP de l'agence (sous mandat LEG-027), preuve de paiement par webhook, check-in/out, preuves, annulations calculées, litiges instruits, **commission facturée mensuellement** | Aucune détention de fonds, aucune caution plateforme, aucun frais de service guest, aucun versement |
| **P0-B** | La plateforme encaisse, après avis | 13 (E14, E15) | Encaissement, caution avec fenêtre de rétention, débits post-trip conformes aux réseaux, versements J+2, ITBMS collecté, rapprochement quotidien, ou split de commission à la source | Démarré seulement si avis favorables **et** besoin constaté (18 §1.2) |
| Ouverture élargie | P0-A complet ouvert à toute agence qualifiée (≥ 10), après S1–S4 | — | — | Ce n'est pas le P1 |
| P1 | Version concurrentielle complète dans le pays de lancement | 342 | Automatisations, modifications de trip en libre-service, 24/7, API, marque blanche, livraison, protections guest si OQ-BR-16 | — |
| P2 | P2P vérifié, différenciation | 108 | — | — |
| P3 | Futur ou non applicable | 47 | — | — |

Choix du pays de lancement (12 §10.3, **en attente**) : si OQ-MK-01 est négatif sans montage viable, le lancement a lieu au Paraguay (PYG, SIFEN, Bancard vPOS, upay). Les deux pays étant construits (DEC-FONDATEUR-04), ce choix ne change que la configuration activée et les connecteurs réels du lot C (E18).

**Construction bi-pays (DEC-FONDATEUR-04, 2026-10-30 ; ajouté par la consolidation)** : le P0-A est construit pour le Panama **et** le Paraguay en même temps ; le paragraphe ci-dessus ne décrit qu'un choix de **lancement**. Les fiches P0 restent communes aux deux pays : leurs valeurs propres (devise, fuseau, taxe, pièces d'identité, textes juridiques, pénalités en unités mineures, T48 / T62 en PYG) sont des paramètres pays datés (ADM-014, ADM-031, PRC-020, PRC-021, NFR-16 ; 17 §7, ADR-024). Aucune ligne de 04 n'est dupliquée. Besoins **réellement propres au Paraguay**, reclassés dans 04 par la passe VERIF_18 (04 et 18 font foi) :

| Besoin | Ligne 04 existante | Phase actuelle | Proposition |
|---|---|---|---|
| Devise PYG sans décimale, pas d'arrondi PYG, affichage | I18N-005 | **P0-A, lot 0 (appliqué, VERIF_18-F02)** | vecteurs T48, T62 en PYG ; fiche E13 |
| Facture électronique SIFEN (DNIT) de la commission | FIN-003 | **P0-A, lot 2 (appliqué)** | port fiscal + adaptateur `FAKE` ; connecteur SIFEN réel au lot C (FIN-020) |
| IVA 10 % et règles fiscales PY | PRC-020 (moteur de taxes par marché) | P0-A | valeurs `tax_line_config` PY à fournir (OQ-BR-14) |
| Cédula paraguayenne et permis PY dans le parcours KYC | VER-001, VER-005, VER-006 | P0-A | liste de pièces par pays (paramètre) ; aucune ligne nouvelle |
| Fuseau `America/Asuncion` (UTC−3 permanent) | — (NFR-02, ADR-019, OQ-BR-20) | — | contrôle tzdata au démarrage, aucune ligne nouvelle |
| Interface en portugais pour les visiteurs brésiliens | aucune | — | **nouvelle ligne P1 à créer dans 04** si le Paraguay est retenu (non créée ici) |
| Adaptateurs Bancard vPOS, upay (QR / Pix) | PAY-001 (abstraction) | P0-A | lot C après le choix du pays : porte PAY-041, connecteur PAY-042 |
| Droit de la consommation SEDECO, Ley 7593/2025 (données) | LEG-010, LEG-011 | P0-A | textes par pays, avis avant ouverture (DEC-FONDATEUR-02) |

**Effort (passe VERIF_18, DEC-FONDATEUR-05 ; 18 §5 fait foi)** : « Bêta pilote (deux pays construits, connecteurs réels exclus) : **≈ 170 à 300 jours-agent** d'effort (1 unité d'effort = 10 jours-agent ; un jour-agent = une journée de travail d'un agent d'implémentation, tests et revue indépendante compris) ; P0-A complet (166 lignes, non négociables de 17 inclus, lot C exclu) : **≈ 320 à 640 jours-agent** ; ordre de grandeur non mesuré. **Aucune durée calendaire n'est promise** : elle sera mesurée après le lot 0 ; les goulots sont la revue du fondateur (point hebdomadaire), les limites d'usage des agents et la mise en place externe (comptes, PSP, KYC, avis juridiques). » Contexte historique seulement : la v4 annonçait « ≈ 16 à 28 semaines-équipe, ≈ 4 à 7 mois pour 2 développeurs assistés par IA » ; cette hypothèse d'équipe humaine est abandonnée (DEC-FONDATEUR-05). Non compris : lot des connecteurs réels après le choix du pays (DEC-FONDATEUR-03), avis juridiques et porte PAY-041 (critères de mise en service, DEC-FONDATEUR-02), recette avec les agences pilotes. **Critères de passage ajoutés** (C-v3-08, aligné v4) : un paiement reçu sur un hold compensé ne crée **jamais** de trip et est remboursé ; un seul paiement convertit un hold, tout paiement en plus est remboursé ; limites par guest toutes agences et tous pays confondus ; aucun adaptateur `FAKE` dans la configuration ni l'image de production.

## A.4 Non-objectifs (hors P0, 18 §2)

- Encaissement, détention de fonds, caution et versements par la plateforme **en P0-A** (→ P0-B).
- Frais de service facturés au guest (PRC-012, P0-B, OQ-MK-01).
- Plans de protection guest, garantie hôte, protection minimale imposée (P1 si OQ-BR-16) : en P0, la **police flotte de l'agence** couvre (PRT-009).
- Hôtes particuliers (P2), option avec chauffeur (P3), VTC (rejeté) ; le Paraguay n'est **pas** un non-objectif : il est construit dès le départ (DEC-FONDATEUR-04).
- Applications natives iOS / Android (hors MVP, phase ultérieure à décider ; le MVP est un web mobile-first avec PWA installable, DEC-FONDATEUR-06, DSN-006).
- Livraison, remise à l'aéroport hors comptoir, one-way (P1, OQ-MK-08).
- Géofencing logiciel, télématique, coupure moteur (P1/P2 ; coupure exclue, OQ-BR-17).
- Support humain 24/7, triage IA (P1).
- Modification, extension, échange de véhicule en libre-service (P1 ; en bêta : ADM-006 par l'ops).
- Avis de l'hôte sur le guest, double aveugle, profil public (P1).
- SSO Google/Apple, connexion par code (P1) ; remises de durée, tarifs non remboursables, jeune conducteur, tarification dynamique (P1/P2).
- ACH Xpress comme rail d'encaissement, BNPL, Apple/Google Pay ; recouvrement automatisé ; moteur de règles configurable, score de fraude (P1).
- Facturation électronique **pour le compte** de l'agence (P1 après avis) ; connecteurs PAC / SIFEN réels avant le choix du pays (lot C, FIN-020).
- API publique, marque blanche, onboarding express 48 h, actions en masse (P1).
- Parrainage, fidélité, cartes cadeaux (P1–P3) ; droits des personnes en libre-service et bannière de cookies (P1 ; aucun cookie non essentiel en bêta).

## A.5 Métriques de succès

**Critères de sortie de la bêta fermée** (18 §1.1, PROPOSÉS, seuils à valider avec les agences avant la mise en service) :

| ID | Critère | Seuil |
|---|---|---|
| S1 | Agences actives (contrat signé, police vérifiée, ≥ 1 trip/mois) | ≥ 3 |
| S2 | Trips terminés sans double réservation ni remise de clés sur paiement non confirmé | ≥ 100 cumulés, **0** incident de ces deux types |
| S3 | Délai médian d'ouverture ou de connexion du compte PSP d'une agence | ≤ 15 jours ouvrés |
| S4 | Commission effective (facturée et payée, sur loyer HT), sur ≥ 2 cycles | ≥ 10 % (hypothèse 12 %, OQ-MK-07) |

**Critères d'arrêt ou de révision** (18 §1.1) : < 2 agences actives 3 mois après l'ouverture ; commission effective < 8 % ; écart de rapprochement FIN-019 > 10 % des trips sur deux mois consécutifs ; avis défavorable sur OQ-MK-01 ou OQ-MK-02 après l'ouverture (arrêt des nouvelles réservations, lancement dans l'autre pays).

**Indicateurs produit et opérationnels** (PROPOSÉS, mesurés dès la bêta pilote) :

| ID | Indicateur | Cible proposée | Fiche source |
|---|---|---|---|
| M1 | Taux de conversion recherche → réservation confirmée | suivi, pas de cible avant 2 cycles | BKG-001 |
| M2 | Délai de revue KYC (SLA) | ≤ 4 h ouvrées (90e centile) | ADM-002 |
| M3 | Délai de revue d'une réservation à risque | ≤ 2 h ouvrées | ADM-029 |
| M4 | Durée d'une remise au comptoir | ≤ 10 min, ≤ 5 écrans | TRP-052 |
| M5 | Délai d'envoi de la confirmation | ≤ 1 min | NTF-007 |
| M6 | Délai de première réponse du support | mesuré, cible fixée après 4 semaines | SUP-004 |
| M7 | Taux de faux positifs de la revue de risque | suivi | ADM-029 |
| M8 | Part des trips avec gabarit photo complet au départ et au retour | ≥ 95 % | TRP-004 |
| M9 | Remboursements décidés exécutés par l'agence sous 5 j ouvrés | ≥ 95 % | PAY-021, LEG-025 |
| M10 | Factures de commission émises avec rapprochement de la période | 100 % | FIN-019 |

## A.6 Préconditions juridiques et opérationnelles par phase

Les IDs renvoient à `22_OPEN_QUESTIONS.md` ; les portes G0/G1a/G1b/G2 et C1–C17 à 18 §3–§4.

> **Effet des décisions fondateur du 2026-10-30** (ajouté, consolidation) : **DEC-FONDATEUR-02** — les avis juridiques ne bloquent plus le **build** des lots ; ils bloquent l'**ouverture à de vrais clients** (bêta pilote comprise) ; la colonne « Ce qui est bloqué » ci-dessous se lit donc « livrable construit et testé, mise en service bloquée » pour les lignes juridiques (G1a, G1b, OQ-MK-05, OQ-MK-06, OQ-MK-09, OQ-BR-24, OQ-BR-21, OQ-PAY-06). **DEC-FONDATEUR-03** — aucun connecteur PSP réel avant le choix du pays : PAY-001 est construit avec un adaptateur fictif / bac à sable (`FAKE`) qui simule webhooks signés, refus, réponses inconnues, ordres Yappy de 300 s et capacités `psp_capability` ; la porte PAY-041 et les questions OQ-PAY-03, OQ-PAY-07, OQ-PAY-22, OQ-PAY-13 bloquent l'adaptateur réel et l'ouverture, pas le build. 18 n'est pas modifié par cette passe (son ordre des portes reste à mettre à jour).

| Phase | Précondition | OQ / ligne | Ce qui est bloqué |
|---|---|---|---|
| Avant build (G0) | Commission acceptée, part des réservations confiée | **OQ-MK-07** | décision de lancer le build |
| Mise en service (G1a) | Avis **préliminaire** écrit art. 288 (« representación o agencia ») et casa de remesas lecture b | **OQ-MK-01**, **OQ-MK-02** (b) | mise en service des lots 1 et suivants (bêta pilote comprise) ; le build du lot 1 n'attend pas (**DEC-FONDATEUR-02**) |
| Mise en service (G1b) | Avis **définitif** sur les mêmes points | OQ-MK-01, OQ-MK-02 (b) | mise en service de la réservation, du contrat et du paiement (lot 2) ; aucun effet sur le build (**DEC-FONDATEUR-02**) |
| P0-A | Polices flotte couvrant la distribution par plateforme (attestation) | **OQ-MK-05** | publication des annonces (PRT-019), ouverture |
| P0-A | ITBMS commission/loyer, retenue 12,5 %, facture de l'agence, entité qui facture | **OQ-MK-06**, OQ-BR-14, OQ-PAY-15 | facture de commission (FIN-018, FIN-002) |
| P0-A | Tilopay : ordre sur le compte de l'agence, Yappy, Clave, tarifs, entité ; remboursement Yappy | **OQ-PAY-03**, **OQ-PAY-22**, **OQ-PAY-07**, OQ-PAY-13 ; porte PAY-041 | connecteur API (PAY-033 mode a) ; ouverture (**DEC-FONDATEUR-03** : connecteur réel différé au choix du pays ; build sur adaptateur `FAKE`) |
| P0-A | CGU, contrat de location, contrat-cadre avec mandat LEG-027 ; validité des clauses pénales et de la décision « définitive » | **OQ-BR-24**, OQ-PAY-03 | signature des agences (LEG-025), ouverture |
| P0-A | Permis étrangers, preuve de la date d'entrée, art. 110/111 | **OQ-BR-21** | refus automatique (mode signalement en attendant) |
| P0-A | Durées de conservation | **OQ-BR-25** | paramètres LEG-009 (valeurs prudentes en attendant) |
| P0-A | Caution Yappy / virement restituée par l'agence | OQ-PAY-06 | option « Yappy restitué » de PAY-035 |
| P0-A | Ley 81 : registre, transferts de biométrie hors Panama, notification de violation | **OQ-MK-09** | KYC en production (lot 1), ouverture |
| P0-A | Valeurs Panama et Paraguay de ADM-031 | jalon J-ADM-031 | mise en service (valeurs de test autorisées pendant le build, DEC-FONDATEUR-02) |
| P0-A | Dotation support (≈ 2,6 ETP de présence pour 7 h–22 h, 7 j/7) | SUP-020 | ouverture |
| P0-A | Revue de sécurité sans vulnérabilité critique/élevée ouverte | ADM-033 | ouverture |
| P0-A | Décision PWA / natif / terminal fourni | TRP-056 | lot 3 |
| P0-B (G2) | Casa de remesas, MTL si entité US, PSP détenteur des fonds, split, validité des pré-autorisations, débit local/MIT, règles réseaux LAC, préfinancement | **OQ-MK-02**, **OQ-MK-03**, **OQ-PAY-02**, **OQ-PAY-04**, **OQ-PAY-05**, **OQ-PAY-13**, **OQ-PAY-15**, **OQ-PAY-17**, **OQ-PAY-18**, **OQ-PAY-21**, OQ-PAY-19, **OQ-BR-12** (a–d), OQ-BR-14 | tout P0-B |
| Lancement au Paraguay (si retenu) | Statut PSP au BCP, Bancard vPOS / upay, risque ueno | OQ-MK-04, OQ-PAY-08, OQ-PAY-10, OQ-PAY-11, OQ-PAY-12, OQ-PAY-23 | connecteurs réels PY du lot C (porte PAY-041, PAY-042) ; le build PY n'attend pas (DEC-FONDATEUR-03/04) |

## A.7 Exigences non fonctionnelles globales (NFR)

| ID | Domaine | Exigence | Vérification |
|---|---|---|---|
| NFR-01 | Argent | Tous les montants en **unités mineures entières** (`Money{amount_minor, currency}`), aucun flottant ; arrondi `roundHalfUp` par ligne ; taxe calculée par ligne puis sommée (BR-PRICE-14, BR-CXL-06) | tests T40–T43, TA06 |
| NFR-02 | Temps | Horodatages stockés en UTC + fuseau IANA du véhicule (`America/Panama`, UTC−5 sans heure d'été) ; toutes les fenêtres calculées côté serveur dans le fuseau du véhicule (BR-CXL-00, EC-33) | tests de bornes T02, T15 |
| NFR-03 | Idempotence | Toute commande à effet (paiement, remboursement, notification, transition d'état) porte une clé d'idempotence ; les webhooks sont dédupliqués ; un rejeu ne produit aucun double effet (BR-BOOK-10, EC-29, EC-54) | tests T51, T52 |
| NFR-04 | Concurrence | Contrainte d'exclusion sur l'occupation véhicule × intervalle ; aucune double réservation possible même sous charge concurrente (EC-51) | test de course |
| NFR-05 | Sécurité | 2FA TOTP pour les rôles internes ; RBAC côté serveur ; référentiel OWASP ASVS niveau 2 sur authentification, contrôle d'accès, téléversements, webhooks ; secrets PSP des agences dans un coffre/KMS, isolés par agence, rotation documentée (ADM-033, ADM-032) | rapport ADM-033 |
| NFR-06 | PCI DSS | Paiement uniquement par page ou champs hébergés du PSP (SAQ A visé) ; aucune donnée de carte stockée ni transitée (PAY-001) | revue ADM-033 |
| NFR-07 | Données personnelles | Ley 81/2019 : consentements versionnés (LEG-002), consentement biométrique séparé (VER-004), registre et procédure de violation (LEG-010), journal des accès aux dossiers KYC et photos (ADM-032), minimisation (l'agence voit le résultat KYC, pas le n° de pièce : VER-015) ; données de préproduction synthétiques (ADM-034) | revue LEG-010 |
| NFR-08 | Audit | Journal d'audit en ajout seul pour toute action interne (qui, quoi, avant/après, quand, motif), conservé 5 ans sous réserve d'OQ-BR-25 (ADM-001) | test d'immuabilité |
| NFR-09 | Disponibilité / reprise | RPO ≤ 24 h, RTO ≤ 8 h (À DÉCIDER, ADM-035) ; sauvegardes quotidiennes chiffrées, test de restauration avant ouverture | rapport de restauration |
| NFR-10 | Environnements | Dev, préproduction, production séparés ; déploiement par pipeline avec migrations versionnées et retour arrière testé (ADM-034) | retour arrière exécuté |
| NFR-11 | Langues | es-PA et en sur 100 % des chaînes, notifications, contrats et pages légales ; aucune chaîne en dur ; clé manquante = échec du build ; version espagnole fait foi (I18N-003) | test automatisé de mélange de langues |
| NFR-12 | Mobile et connectivité | Parcours guest et comptoir utilisables sur mobile (PWA ou enveloppe native selon TRP-056) ; photos compressées ≈ 1 600 px, ≤ 500 ko ; hors ligne du check-in/out en P0-A complet (TRP-057) | grille d'appareils TRP-056 |
| NFR-13 | Performance | Recherche et fiche : réponse serveur ≤ 1 s au 95e centile pour la flotte pilote (PROPOSÉ) ; occupation visible au calendrier ≤ 5 s (CAL-001) ; trip visible chez l'agence ≤ 1 min (HDB-002) | test de charge simple |
| NFR-14 | Accessibilité | WCAG 2.2 niveau AA visé sur les parcours guest, agence et comptoir (PROPOSÉ ; dont 2.4.11 et 2.5.7, 10b §3.10 ; VERIF_19-m1) ; texte alternatif des photos (LST-002) | audit manuel |
| NFR-15 | Observabilité | Monitoring disponibilité, erreurs, files de notifications, webhooks PSP en échec, alertes (ADM-032) | alertes testées |
| NFR-16 | Paramétrage | Aucune valeur américaine codée en dur ; toute valeur métier est un paramètre pays daté (`valid_from`), non rétroactif, figé dans le devis (ADM-014, ADM-031) | revue de code |
| NFR-17 | Traçabilité | Chaque trip permet de retrouver la version exacte de chaque document accepté, du devis, du contrat et des photos (LEG-002, PRC-025, CLM-034) | test de reconstitution |

## A.8 Conventions des fiches

**Modules génériques** (la correspondance exacte avec les modules techniques est dans 17) :

| Module générique | Codes 04 |
|---|---|
| Identité & vérification | ACC, VER |
| Catalogue & recherche | SRC, LST |
| Disponibilité & flotte | CAL, FLT |
| Réservation & contrat | BKG |
| Tarification & devis | PRC |
| Paiements | PAY |
| Opérations de trip | TRP |
| Communication & réputation | MSG, NTF, REV |
| Espace agence & annonces | HST, HDB |
| Sinistres & protection | CLM, PRT |
| Back-office & exploitation | ADM, SUP |
| Finance & facturation | FIN, PYO |
| Légal, données & localisation | LEG, I18N |

**Rôles** (Permissions ; noms canoniques de 17 §2.3, dont la matrice de permissions fait foi ; consolidé VERIF_15-F9) : `GUEST` ; `AGENCY_OWNER` (représentant légal : contrat-cadre LEG-025, mandat LEG-027, connexion PSP, membres), `AGENCY_MANAGER`, `AGENCY_COUNTER_AGENT`, `AGENCY_ACCOUNTANT`, `CO_HOST` (portée `vehicle_scope`) ; `SUPPORT_AGENT`, `OPS_AGENT`, `FINANCE`, `ADMIN`, `SUPERADMIN` (bris de glace, double validation) ; `SYSTEM` ; `P2P_HOST` désactivé (P2). En bêta pilote, un seul rôle agence (FLT-003 MANUEL) et deux rôles internes (`ADMIN`, `OPS_AGENT`, ADM-001 SIMPLIFIÉ).

**Erreurs** : codes stables en `SCREAMING_SNAKE_CASE` **sans préfixe**, comme 08 BR-BOOK-11 et 17 (`409 VEHICLE_UNAVAILABLE`, `409 SETTLEMENT_EXISTS`, `409 INVALID_TRANSITION`) ; les codes de BR-BOOK-11 (`ACCOUNT_NOT_APPROVED`, `AGE_CLASS_MISMATCH`, `GUEST_OVERLAP`, `VEHICLE_RESTRICTED`…) sont repris tels quels ; les autres sont des noms de référence PROPOSÉS (le préfixe `ERR_` de la version 1 est supprimé, consolidé VERIF_15-F9) ; message localisé es/en, jamais de détail technique au guest.

**Notifications** : les `EVT_…` des fiches sont des **clés de gabarit** du catalogue NTF-001, pas des événements de domaine ; chaque gabarit est déclenché par un événement canonique de 17 §4.5 (correspondance en A.8.2) ; les fiches du flux de réservation citent directement les événements de 17 (`booking.hold.*`, `booking.trip.booked`) ; canal WhatsApp si gabarit approuvé (NTF-002), sinon SMS (urgent) ou email (documents).

**Confiance** : `confirmé` = OBSERVÉ ou DIRECTEMENT TESTÉ chez Turo (sans transaction réelle) ; `documenté` = documentation Turo (centre d'aide, CGU) ; `inféré` = déduit ; `proposé` = notre conception, sans équivalent Turo. Quand la base Turo est documentée mais que notre adaptation est substantielle, la fiche l'indique (« base documentée, adaptation proposée »).

**Bêta pilote** : valeur de la colonne `beta_pilote` de 04 ; pour SIMPLIFIÉ et MANUEL, la procédure reprend la note de 04. Les lignes P0-B n'ont pas de valeur (sans objet).

**Complexité** : barème de 04 README §1 bis (faible 0,5–1,5 j-dev ; moyenne 1,5–2,5 ; élevée 3–8), plus `effort_ops` et `risque_legal_financier`.


### A.8.2 Noms canoniques (17 v2) et correspondance des notifications (ajouté, consolidé VERIF_15-F9)

Les noms de la version 1 de ce PRD ont été remplacés dans tout le document par ceux de 17. Les noms de données restés descriptifs dans une fiche (par ex. `no_show`, `risk_flag`, `penalty_line`, `cost_bearer`, `late_fee_grid`, `booking_check_log`) n'ont pas d'équivalent exact dans 17 : le nom de 17 §3.2 le plus proche fait foi au moment du code, et tout ajout passe par 17.

| Nom de la version 1 | Nom canonique (17) |
|---|---|
| `hold(…)` | `checkout_hold` (`kind` `CHECKOUT` / `AGENCY_LINK`, `status` `ACTIVE` / `PAYMENT_IN_FLIGHT` / `CONVERTED` / `EXPIRED` / `RELEASED`) |
| `vehicle_occupancy.type` (dont `ICAL`) | `vehicle_occupancy.kind ∈ {TRIP, HOLD, HOST_BLOCK, BUFFER}` + `source ∈ {CHECKOUT, MANUAL, ICAL, SYSTEM}` |
| `company`, `company_id` | `organization`, `org_id` |
| `payment_intent` | `payment_operation` (+ `payment_operation_link`) |
| `fleet_policy` | `insurance_policy` (+ `insurance_policy_vehicle`) |
| `framework_contract` | `master_agreement` |
| `mandate` | `psp_mandate` |
| `psp_gate` | décision ADR-004 + `psp_capability` |
| `identity_key` | `identity_document.number_bidx` |
| `upload_queue` | port `OfflineQueue` + `file_asset` |
| `deposit_record` | `counter_deposit_record` |
| `payment_confirmation` | `agency_payment_confirmation` |
| `webhook_event` | `webhook_inbox` |
| `refund` | `refund_instance` (+ `agency_refund_task` en P0-A) |
| `invoice` (commission) | `fiscal_document` |
| `statement` | `commission_statement` |
| `recon_run` | `reconciliation_run` |
| `import_job` | `fleet_import_job` |
| `screening` | `sanctions_screening` |
| `kyb_document` | `kyb_case` + `file_asset` |
| `contract` | `generated_document` |
| `trip_photo` | `trip_inspection` + `inspection_photo` + `file_asset` |
| `host_ledger` | `host_ledger_state` + `journal_line` |
| `payout` | `payout_batch` / `payout_item` |
| `idempotency_record` | `payment_operation.idempotency_key`, `inbox_receipt` |
| `AGENCY_COUNTER`, `SUPPORT`, `OPS` | `AGENCY_COUNTER_AGENT`, `SUPPORT_AGENT`, `OPS_AGENT` ; ajout de `AGENCY_OWNER`, `CO_HOST`, `SUPERADMIN` |
| `billing_day_tolerance_minutes` | `grace_minutes` (29) |
| `late_grace_minutes` | `overdue_detection_minutes` (30) |
| `free_cxl_hours` | `free_cancel_lead` |
| `agency_cxl_penalty_gt24h` / `_le24h` | `host_penalty` (paliers) |
| `business_name` | `trade_name` |
| `legal_last_names` | `legal_last_name` |
| `supports_*` | capacités `SUPPORTS_*` de `psp_capability` |
| `ERR_…` | codes sans préfixe (ci-dessus) |

**Clés de gabarit de notification → événement de domaine de 17 §4.5** (« — » : aucun événement de domaine ; depuis 17 v4, seul `EVT_OTP_CODE` reste sans événement, par conception : envoi synchrone) :

| Gabarit | Événement déclencheur (17 §4.5) |
|---|---|
| `EVT_ACCOUNT_RECHECK_REQUIRED` | `kyc.verification.status_changed` |
| `EVT_ACCOUNT_RESTRICTED` | `iam.restriction.applied` |
| `EVT_ACCOUNT_UNDER_REVIEW` | `risk.review.required` |
| `EVT_AGENCY_BALANCE_NEGATIVE` | `host_ledger.state_changed` |
| `EVT_BOOKING_CANCELLED` | `trip.status_changed` (→ CANCELLED_*) |
| `EVT_BOOKING_CANCELLED_BY_AGENCY` | `trip.status_changed` |
| `EVT_BOOKING_CANCELLED_BY_PLATFORM` | `trip.status_changed` |
| `EVT_BOOKING_CONFIRMED` | `booking.trip.booked` |
| `EVT_BOOKING_UNDER_REVIEW` | `risk.review.required` |
| `EVT_CHECKIN_DONE` | `trip.checkin.validated` |
| `EVT_CHECKIN_OPEN` | minuterie `scheduled_job` T−24 h → trip.status_changed |
| `EVT_CHECKIN_REFUSED_LICENSE` | `kyc.trip_identity.failed` |
| `EVT_CHECKOUT_DONE` | `trip.checkout.completed` |
| `EVT_CLAIM_DECIDED` | `claim.status_changed` |
| `EVT_CLAIM_EVIDENCE_REQUESTED` | `claim.status_changed` |
| `EVT_CLAIM_OPENED` | `claim.status_changed` |
| `EVT_COMMISSION_INVOICE_ISSUED` | `fiscal.document.status_changed` |
| `EVT_COMMISSION_STATEMENT_ISSUED` | `finance.statement.issued` |
| `EVT_CONTRACT_SIGNED` | `contract.document.signed` |
| `EVT_CREDIT_ISSUED` | `support.commercial_gesture.issued` (ajouté à 17 §4.5 v4, aligné v4 — R7) |
| `EVT_DEPOSIT_AUTHORIZED` | `payment.operation.status_changed` (`DEPOSIT_AUTH`, P0-B) |
| `EVT_DEPOSIT_RELEASED` | `deposit.decision.executed` (P0-B) |
| `EVT_DISPUTE_DECIDED` | `dispute.decided` |
| `EVT_DOCUMENT_REQUESTED` | `kyc.verification.status_changed` ou claim.status_changed |
| `EVT_EMAIL_VERIFICATION` | `iam.user.registered` |
| `EVT_EVIDENCE_READY` | `evidence.bundle.generated` |
| `EVT_ICAL_CONFLICT` | `booking.ical.conflict_detected` |
| `EVT_ICAL_FAILING` | `booking.ical.feed_failing` (ajouté à 17 §4.5 v4, aligné v4 — R7) |
| `EVT_IMPORT_DONE` | `catalog.fleet_import.completed` (ajouté à 17 §4.5 v4, aligné v4 — R7) |
| `EVT_INVOICE_REMINDER` | `invoice.status_changed` |
| `EVT_INVOICE_TO_GUEST` | `invoice.status_changed` |
| `EVT_KYB_DECISION` | `kyb.case.decided` |
| `EVT_KYC_APPROVED` | `kyc.verification.status_changed` |
| `EVT_KYC_MORE_INFO` | `kyc.verification.status_changed` |
| `EVT_KYC_REJECTED` | `kyc.verification.status_changed` |
| `EVT_LISTING_APPROVED` | `catalog.listing.status_changed` |
| `EVT_LISTING_REJECTED` | `catalog.listing.status_changed` |
| `EVT_LISTING_RESTRICTED` | `catalog.listing.status_changed` |
| `EVT_MANDATE_REVOKED` | `legal.mandate.status_changed` |
| `EVT_MASTER_AGREEMENT_TO_SIGN` | `contract.document.generated` |
| `EVT_MESSAGE_FLAGGED` | `message.flagged` |
| `EVT_NEW_MESSAGE` | `message.posted` |
| `EVT_NO_SHOW_DECLARED` | `trip.cancellation.qualified` |
| `EVT_OFFLINE_SKEW` | `trip.offline.clock_skew_detected` (ajouté à 17 §4.5 v4, aligné v4 — R7) |
| `EVT_ORGANIZATION_ACTIVATED` | `kyb.case.decided` |
| `EVT_ORGANIZATION_INVITED` | `iam.organization.invited` (ajouté à 17 §4.5 v4, aligné v4 — R7) |
| `EVT_ORGANIZATION_SUSPENDED` | `iam.organization.status_changed` (ajouté à 17 §4.5 v4, aligné v4 — R7) |
| `EVT_OTP_CODE` | — (envoi synchrone `otp_challenge`) |
| `EVT_PAYMENT_CAPTURED` | `payment.operation.status_changed` |
| `EVT_PAYMENT_CONFIRMATION_REQUIRED` | `booking.hold.created` (`kind = AGENCY_LINK`) |
| `EVT_PAYMENT_MISMATCH` | `payment.operation.status_changed` (montant ≠ devis) |
| `EVT_PAYOUT_FAILED` | `payout.batch.status_changed` |
| `EVT_PAYOUT_SENT` | `payout.batch.status_changed` |
| `EVT_PICKUP_REMINDER` | minuterie `scheduled_job` T−24 h |
| `EVT_POLICY_EXPIRED` | `insurance.policy.status_changed` |
| `EVT_POLICY_EXPIRING` | `insurance.policy.status_changed` |
| `EVT_POST_TRIP_CHARGED` | `payment.operation.status_changed` (P0-B) |
| `EVT_POST_TRIP_CHARGE_NOTICE` | `invoice.status_changed` (P0-B) |
| `EVT_PSP_FAILURE` | `payment.operation.status_changed` (`FAILED`) |
| `EVT_RECON_DISCREPANCY` | `finance.reconciliation.delta_exceeded` |
| `EVT_REFUND_CONFIRMED` | `refund.instance.status_changed` (`CONFIRMED`) |
| `EVT_REFUND_OVERDUE` | `refund.agency_task.overdue` |
| `EVT_REFUND_PLANNED` | `refund.instance.status_changed` (`PLANNED`) |
| `EVT_RETURN_REMINDER` | minuterie `scheduled_job` avant la fin |
| `EVT_REVIEW_INVITATION` | `trip.checkout.completed` |
| `EVT_REVIEW_SLA_BREACH` | `support.review_queue.sla_breached` (ajouté à 17 §4.5 v4, aligné v4 — R7) |
| `EVT_TEAM_INVITE` | `iam.membership.invited` (ajouté à 17 §4.5 v4, aligné v4 — R7) |
| `EVT_TERMS_UPDATED` | `legal.document_template.published` (ajouté à 17 §4.5 v4, aligné v4 — R7) |
| `EVT_TRIP_OVERDUE` | `trip.overdue.detected` |
| `EVT_UNRETURNED_ESCALATION` | `trip.overdue.escalated` |
| `EVT_VEHICLE_DOCUMENT_EXPIRING` | `catalog.vehicle_document.expiring` (ajouté à 17 §4.5 v4, aligné v4 — R7) |
| `EVT_VEHICLE_REFUSED` | `trip.cancellation.qualified` |

### A.8.1 Vecteurs de test monétaires

- **T01–T27** (règlement d'annulation), **T28–T48** (exécution, multi-moyens, arrondis, PYG), **T49–T65** (supersession, chargeback, caution, ré-autorisation), **T66–T68** (imputation incrémentale des remboursements, chargeback sur remboursement bloqué, `attempt_no` des débits ; cités par PAY-021, ADM-008, PAY-019, PAY-015 / PAY-037, consolidé VERIF_15-F5) : `08_BUSINESS_RULES.md`. Ils sont définis avec la **configuration de test** de 08 (parts 75 %, trip fee F, protection, `tax_line_config` de test). En P0-A, ils valident le **moteur** de règlement (fonction pure) ; les colonnes « Remb. guest TTC », « dont taxes » et « Pénalité » s'appliquent telles quelles, les colonnes « Gains hôte » et « Net plateforme » ne s'appliquent qu'au mode P0-B (en P0-A, la part retenue reste à l'agence et la commission s'y applique). T17, T18, T20 et T61 dépendent de **DEC-FONDATEUR-01** (option A = `true` explicite ; option B = défaut).
- **TA01–TA11** (ajoutés par ce PRD, **PROPOSÉS** ; TA10 et TA11 ajoutés par la version 2, consolidé VERIF_15-F3, F4, recalculés à la main puis par `tools/check_ta_consolidation.py`, script versionné écrit à partir du texte ci-dessous) : configuration P0-A (pas de frais guest, pas de protection, ITBMS 7 % sur le loyer seul, commission 12 % sur la part HT conservée par l'agence). Recalculés à la main puis par un script `python -I` indépendant (Fractions, `roundHalfUp`) le 2026-10-30 : identiques. Règles appliquées : BR-CXL-01, BR-CXL-06 (j = 1 si > 2 jours, ½ sinon), BR-CXL-08 (no-show j = 2 si > 2 jours), taxe remboursée au prorata de la base taxable remboursée.

| # | Entrées | Résultat attendu |
|---|---|---|
| TA01 | Trip PA1 : 3 j, loyer 120,00, ITBMS 7 % = 8,40, total **128,40** ; annulation guest à T−2 j (≤ freeUntil) | remboursement 128,40 ; part conservée 0,00 ; commission 0,00 |
| TA02 | PA1, annulation guest à T−10 h | retenu loyer 40,00 ; remboursement **85,60** (dont ITBMS 5,60) ; conservé TTC 42,80 ; commission **4,80** ; équilibre 85,60 + 40,00 + 2,80 = 128,40 |
| TA03 | PA1, no-show guest constaté (j = 2) | retenu 80,00 ; remboursement **42,80** (ITBMS 2,80) ; commission **9,60** |
| TA04 | PA1, annulation par l'agence à T−30 h, puis à exactement T−24 h | remboursement 128,40 dans les deux cas ; pénalité agence = `host_penalty` palier « > 24 h » puis palier « ≤ 24 h » (17 §7.2) (valeurs ADM-031 **À DÉCIDER** ; valeurs de test 25,00 / 50,00 = référence Turo BR-CXL-13) portée sur la facture de commission ; borne : 24 h exactement → valeur « ≤ 24 h » |
| TA05 | Trip PA2 : 2 j, loyer 80,00, ITBMS 5,60, total 85,60 ; annulation guest à T−10 h (j = ½) | retenu 20,00 ; remboursement **64,20** (ITBMS 4,20) ; commission **2,40** |
| TA06 | Trip PA3 : 1 j, loyer 45,01, ITBMS roundHalfUp(315,07) = 3,15, total 48,16 ; annulation guest à T−10 h (j = ½) | retenu roundHalfUp(2 250,5) = **22,51** ; ITBMS remboursé roundHalfUp(315 × 2 250 / 4 501 = 157,46) = 1,57 ; remboursement **24,07** ; conservé 24,09 ; commission roundHalfUp(270,12) = **2,70** |
| TA07 | Jours facturables, tolérance `grace_minutes` = 29 (valeur de 04 et 17 §7.2, **valeur de test provisoire, dépendante du paramètre tant qu'OQ-BR-04 est ouverte**, consolidé VERIF_15-F12) : 3 j 29 min ; 3 j 30 min ; 4 h | **3** ; **4** ; **1** (formule max(1, ceil((fin − début − tolérance)/24 h))). Si le fondateur retient une autre frontière (ex. `billing_boundary_minutes` = 120), seul le paramètre change ; le test est paramétré et ses valeurs attendues sont recalculées |
| TA08 | Relevé mensuel d'une agence : trips terminés à loyer HT 120,00, 80,00, 45,01 + annulation TA02 (part conservée 40,00) ; taux 12 % | commissions par ligne 14,40 + 9,60 + 5,40 + 4,80 = **34,20** ; arrondi par ligne puis somme ; TA01 n'apparaît pas (commission 0) |
| TA09 | Plafond de crédit commercial ADM-007 non décidé (défaut 0) ; un agent OPS tente un crédit de 10,00 | refus `CREDIT_CAP_EXCEEDED`, action journalisée |
| TA10 | PA1 en **P0-A, mode (a) sous mandat** (PAY-006) : réservation à T−30 h (> 25 h : `freeUntil` = T−24 h), **autorisation 128,40 non capturée** (capture différée par PAY-006 : revue ADM-029 ou délai ≤ 24 h) ; annulation guest à T−10 h (hors fenêtre, j = 1, règlement = TA02) | dû `owed` = 40,00 + ITBMS conservé 2,80 = 42,80 ; **capture partielle 42,80**, **void 85,60** ; remboursement en fonds **0,00** ; commission **4,80** ; contrôle 42,80 + 85,60 = 128,40. Variantes : capture déjà faite → remboursement 85,60 par l'API sous mandat ou par l'agence (PAY-021) ; Bêta (paiement immédiat par lien, PAY-006 DIFFÉRÉ) → aucun void possible, remboursement 85,60 exécuté par l'agence |
| TA11 | PA1, **no-show** (j = 2, > 2 jours) déclaré **sans message tracé** de l'agence (agence inéligible, 08 BR-CXL-08) ; paramètre `p0a_ineligible_no_show_outcome` | absent ou `REFUND_GUEST` (défaut fail-closed PROPOSÉ) : retenu **0,00**, remboursement **128,40** (ITBMS 8,40) exécuté par l'agence, commission **0,00** ; `PROTOCOL_PENALTY` : retenu 80,00, remboursement **42,80** (ITBMS 2,80), conservé TTC par l'agence 85,60, pénalité facturée **80,00**, commission 0,00 ; `AGENCY_KEEPS` : retenu 80,00, remboursement 42,80, commission **9,60** (= TA03). **Décision ouverte OQ-BR-45** |

---

# PARTIE B — Fiches FEATURE (P0-A et P0-B)

Ordre : epics E1 à E15 de 04 README §4. Chaque fiche suit le format imposé (24 rubriques). Les fiches regroupées listent tous leurs `feature_id` dans la rubrique FEATURE ID.

## E1 — Comptes, identité, KYC et KYB (P0-A, 16 lignes)

#### Fiche ACC-001 — Inscription par email et mot de passe
- **FEATURE ID** : ACC-001
- **Nom** : Inscription par email et mot de passe
- **Module** : Identité & vérification (ACC — Inscription)
- **Persona** : PER-01, PER-02 (visiteur qui devient guest) ; représentant de PER-03 invité par l'ops
- **Objectif** : créer un compte unique et authentifiable, préalable à toute réservation.
- **Description** : formulaire prénom(s) et nom(s) tels que sur le permis (ACC-006), email, mot de passe, case CGU + confidentialité (LEG-001), opt-in marketing non pré-coché (LEG-002). Email vérifié par lien. Mot de passe haché (algorithme fixé dans 17).
- **Déclencheur** : « Crear cuenta / Sign up » ou tentative de réservation sans session.
- **Prérequis** : pages légales publiées (LEG-011) ; NTF-001 pour l'email.
- **Parcours principal** : 1) saisie ; 2) validation serveur (format email, mot de passe ≥ 10 caractères, PROPOSÉ) ; 3) compte `PENDING_EMAIL` ; 4) email de vérification ; 5) clic → `ACTIVE`, redirection vers VER-013 puis VER-001.
- **Parcours alternatifs** : email déjà utilisé → réponse identique à un succès (anti-énumération) et email « vous avez déjà un compte » ; lien expiré (24 h, PROPOSÉ) → renvoi ; abandon → reprise à la connexion.
- **Règles métier** : BR-ACC-01 ; BR-ACC-03 (unicité, via ACC-014).
- **États** : SM-3 état initial `NOT_STARTED` ; compte `PENDING_EMAIL` → `ACTIVE` (PROPOSÉ).
- **Erreurs** : `AUTH_EMAIL_INVALID`, `AUTH_PASSWORD_WEAK`, `AUTH_TERMS_NOT_ACCEPTED`, `AUTH_LINK_EXPIRED`, `RATE_LIMITED`.
- **Données** : user(id, email, email_verified_at, password_hash, locale, created_at) ; consent (LEG-002).
- **Notifications** : `EVT_EMAIL_VERIFICATION` (email).
- **Permissions** : public (création) ; rôle attribué `GUEST`.
- **Dépendances** : aucune (LEG-001 en dépend).
- **Critères d'acceptation** : Given un visiteur, When il soumet un formulaire valide CGU cochées, Then un compte `PENDING_EMAIL` et un consentement versionné sont créés et l'email part en ≤ 1 min. Given CGU non cochées, When il soumet, Then `AUTH_TERMS_NOT_ACCEPTED` et aucun compte. Given un email existant, When il soumet, Then l'écran est identique à un succès.
- **Source** : 06 « Inscription » ; EV-0009 (rien soumis) ; écrans 10b : S15.
- **Confiance** : confirmé (formulaire OBSERVÉ) ; vérification d'email et anti-énumération proposées.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : OUI.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : SSO Google/Apple, connexion par code (ACC-002 à ACC-004, P1).

#### Fiche ACC-006 — Nom légal identique au permis
- **FEATURE ID** : ACC-006
- **Nom** : Nom légal identique au permis
- **Module** : Identité & vérification (ACC — Identité)
- **Persona** : tous
- **Objectif** : concordance compte ↔ permis ↔ contrat ↔ constancia.
- **Description** : champs `legal_first_name` et `legal_last_name` (texte, deux apellidos), libellé « tal como aparece en su licencia ». Changement après approbation KYC = nouvelle revue.
- **Déclencheur** : inscription ; modification du nom.
- **Prérequis** : ACC-001.
- **Parcours principal** : saisie ; repris tel quel par VER-001 (comparaison du fournisseur), BKG-018 et LEG-026.
- **Parcours alternatifs** : nom différent du permis → `MORE_INFO_REQUIRED` ; modification après approbation → `RECHECK`, check-in des trips bloqué jusqu'à décision (PROPOSÉ).
- **Règles métier** : BR-ACC-07.
- **États** : SM-3 `APPROVED` → `RECHECK`.
- **Erreurs** : `PROFILE_NAME_REQUIRED`, `PROFILE_NAME_LOCKED_PENDING_REVIEW`.
- **Données** : user_account.legal_first_name, user_account.legal_last_name, name_changed_at.
- **Notifications** : `EVT_ACCOUNT_RECHECK_REQUIRED`.
- **Permissions** : `GUEST` (son profil) ; `OPS_AGENT` (correction journalisée).
- **Dépendances** : aucune (VER-001 en dépend).
- **Critères d'acceptation** : Given un compte approuvé, When le nom change, Then SM-3 passe `RECHECK` et le check-in est bloqué. Given un contrat généré, When on le compare au compte, Then le nom est identique caractère pour caractère.
- **Source** : 06 « Inscription » ; 05 G-BOOK-01 ; écrans 10b : S15.
- **Confiance** : confirmé (OBSERVÉ) ; double apellido proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — champs nom/prénom avec mention « comme sur le permis » ; corrections par l'ops.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : pré-remplissage par OCR du permis.

#### Fiche ACC-008 — Nom commercial affiché par l'agence
- **FEATURE ID** : ACC-008
- **Nom** : Nom commercial affiché par l'hôte (agence)
- **Module** : Identité & vérification (ACC — Identité)
- **Persona** : PER-03
- **Objectif** : afficher le nom commercial, distinct de la raison sociale.
- **Description** : champ `business_name` du compte société (ACC-029) — divergence volontaire : Turo détourne le prénom d'usage. Affiché sur carte résultat et fiche ; le contrat porte aussi raison sociale et RUC.
- **Déclencheur** : création ou édition du compte société.
- **Prérequis** : ACC-029.
- **Parcours principal** : saisie → contrôle ops (cohérence avec l'Aviso de Operación) → publication.
- **Parcours alternatifs** : nom trompeur ou marque tierce → refus motivé.
- **Règles métier** : BR-ACC-07.
- **États** : modifiable seulement si société `ACTIVE` ou `KYB_PENDING`.
- **Erreurs** : `BUSINESS_NAME_REQUIRED`, `BUSINESS_NAME_REJECTED`.
- **Données** : organization.trade_name, legal_name, tax_id_ruc.
- **Notifications** : aucune.
- **Permissions** : `AGENCY_MANAGER` (proposition), `OPS_AGENT` (validation).
- **Dépendances** : ACC-029.
- **Critères d'acceptation** : Given une agence approuvée, When un guest ouvre une fiche, Then il voit `business_name` ; au contrat, `legal_name` + RUC.
- **Source** : 05 G-ACCOUNT-02 ; écrans 10b : S02.
- **Confiance** : confirmé (principe OBSERVÉ) ; champ distinct proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — nom commercial saisi par l'ops.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : logo ; badge « Agencia verificada » (REV-014, P1).

#### Fiche ACC-014 — Un compte par personne
- **FEATURE ID** : ACC-014
- **Nom** : Un compte par personne (anti-doublon)
- **Module** : Identité & vérification (ACC — Anti-doublon)
- **Persona** : PER-07 (contrôle) ; tous (effet)
- **Objectif** : empêcher les comptes multiples (contournement d'une restriction, fraude, EC-43).
- **Description** : clés d'unicité hachées : email, téléphone E.164, n° de cédula/passeport, n° de permis, empreinte de carte si le PSP la renvoie. Collision → réservation bloquée, dossier en revue.
- **Déclencheur** : OTP (VER-013), approbation KYC (VER-001), paiement.
- **Prérequis** : VER-001.
- **Parcours principal** : nouvelle clé → recherche de collision → aucune : poursuite ; collision : `MANUAL_REVIEW` + signal ADM-029.
- **Parcours alternatifs** : numéro recyclé par l'opérateur → l'ops libère l'ancien après contrôle ; liens légitimes (même carte familiale) → décision ops tracée.
- **Règles métier** : BR-ACC-03 ; BR-VERIF-09 ; BR-TRUST-01.
- **États** : SM-3 `AUTO_CHECKS` → `MANUAL_REVIEW` (comptes liés).
- **Erreurs** : `ACCOUNT_DUPLICATE_PHONE`, `ACCOUNT_DUPLICATE_DOCUMENT`, `ACCOUNT_LINKED_REVIEW`.
- **Données** : `identity_document.number_bidx` (index aveugle HMAC, 17 §3.1.4) ; UQ partiel `user_account.phone_e164` sur numéro vérifié (17 §3.2.1).
- **Notifications** : `EVT_ACCOUNT_UNDER_REVIEW`.
- **Permissions** : `SYSTEM` (détection), `OPS_AGENT` (décision).
- **Dépendances** : VER-001.
- **Critères d'acceptation** : Given un numéro vérifié sur A, When B tente de le vérifier, Then `ACCOUNT_DUPLICATE_PHONE`. Given deux comptes au même n° de permis, When le second est approuvé par le fournisseur, Then il passe en revue et ne peut pas réserver.
- **Source** : SRC_G 1.1.6 ; 11 EC-43 ; écrans 10b : S15.
- **Confiance** : documenté (principe) ; clés proposées.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — doublons (email, téléphone, permis) repérés par l'ops à la revue KYC.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : empreinte d'appareil, fraude LATAM (SUP-019, P1).

#### Fiche ACC-029 — Compte personne morale (loueur, RUC)
- **FEATURE ID** : ACC-029
- **Nom** : Compte personne morale (loueur, RUC)
- **Module** : Identité & vérification (ACC — Compte pro)
- **Persona** : PER-03
- **Objectif** : représenter l'agence comme loueur, marchand de référence et débiteur de la commission.
- **Description** : raison sociale, nom commercial (ACC-008), RUC + DV, Aviso de Operación, comptoirs, représentant légal (personne vérifiée), contacts opérations / comptabilité / urgence, taux de commission. Rattache utilisateurs (FLT-001) et véhicules.
- **Déclencheur** : pré-inscription d'une agence sélectionnée par le fondateur.
- **Prérequis** : aucun ; KYB par VER-027.
- **Parcours principal** : 1) l'ops crée l'agence et invite le représentant ; 2) compte personnel (ACC-001) ; 3) fiche société complétée ; 4) file KYB (VER-027, ADM-004).
- **Parcours alternatifs** : changement de représentant → VER-028 ; plusieurs comptoirs → plusieurs lieux (HST-011).
- **Règles métier** : BR-ACC-06 ; BR-LIST-01.
- **États** : société `DRAFT` → `KYB_PENDING` → `KYB_APPROVED` → `ACTIVE` (contrat LEG-025 + PSP PAY-033) / `SUSPENDED` / `CLOSED` (PROPOSÉ).
- **Erreurs** : `ORGANIZATION_RUC_INVALID`, `ORGANIZATION_RUC_DUPLICATE`, `ORGANIZATION_NOT_ACTIVE`.
- **Données** : organization(id, kind, legal_name, trade_name, tax_id_ruc, tax_id_dv, aviso_operacion_no, status, commission_rate_bps, suspended_reason) ; représentant légal = `membership.role = AGENCY_OWNER`.
- **Notifications** : `EVT_ORGANIZATION_INVITED`, `EVT_KYB_DECISION`.
- **Permissions** : `OPS_AGENT` (création), `AGENCY_MANAGER` (édition avant KYB).
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given un RUC déjà enregistré, When l'ops crée une agence, Then `ORGANIZATION_RUC_DUPLICATE`. Given une agence non `ACTIVE`, When un véhicule est soumis ou réservé, Then `ORGANIZATION_NOT_ACTIVE`.
- **Source** : 08 BR-ACC-06 reco ; 12 §10.3 ; écrans 10b : A07.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — compte société créé par l'ops, sans parcours d'inscription.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : comptes entreprises clients (ACC-034, P1).

#### Fiche VER-001 — Téléversement du permis recto/verso
- **FEATURE ID** : VER-001
- **Nom** : Téléversement du permis recto/verso
- **Module** : Identité & vérification (VER — Documents)
- **Persona** : PER-01, PER-02
- **Objectif** : approbation de conduite avant le paiement.
- **Description** : photos du permis physique recto/verso (pas de scan ni de lien de stockage) via le parcours **hébergé** du fournisseur KYC (Metamap, Truora, Veriff : À VALIDER), qui inclut VER-002 et VER-005. Résultat reçu par webhook signé : référence, statut, scores, validité du permis. Aucune image dans la base applicative.
- **Déclencheur** : après OTP ; au plus tard avant le paiement (BKG-012).
- **Prérequis** : ACC-006 ; VER-004 ; registre LEG-010 validé avant production.
- **Parcours principal** : session fournisseur → capture → webhook → `AUTO_CHECKS` → `APPROVED` ou `MANUAL_REVIEW` (ADM-002) → notification.
- **Parcours alternatifs** : illisible → `MORE_INFO_REQUIRED` (sans réponse 15 j → `REJECTED`) ; permis expirant avant la fin du trip → refus au checkout ; webhook perdu → interrogation périodique du fournisseur (PROPOSÉ).
- **Règles métier** : BR-VERIF-01, BR-VERIF-02, BR-VERIF-04 (Turo : revue 24–48 h ; nous : SLA 4 h ouvrées), BR-VERIF-11.
- **États** : SM-3 `PHONE_VERIFIED` → `DOCS_SUBMITTED` → `AUTO_CHECKS` → `APPROVED` / `MANUAL_REVIEW` / `MORE_INFO_REQUIRED` ; `APPROVED` → `EXPIRED`.
- **Erreurs** : `KYC_SESSION_FAILED`, `KYC_DOCUMENT_UNREADABLE`, `KYC_LICENSE_EXPIRED`, `KYC_PROVIDER_UNAVAILABLE`.
- **Données** : kyc_check(user_id, provider, provider_ref, status, license_country, license_expiry, decision_by, decided_at).
- **Notifications** : `EVT_KYC_APPROVED`, `EVT_KYC_MORE_INFO`, `EVT_KYC_REJECTED`.
- **Permissions** : `GUEST` (son dossier) ; `OPS_AGENT` (décision, accès journalisé ADM-032) ; agence : « vérifié / non vérifié » seulement.
- **Dépendances** : ACC-006.
- **Critères d'acceptation** : Given `DOCS_SUBMITTED`, When le webhook signé « approved » arrive deux fois, Then une seule transition `APPROVED`. Given une signature invalide, When le webhook arrive, Then il est rejeté et journalisé. Given un permis expirant avant la fin du trip, When le guest paie, Then `KYC_LICENSE_EXPIRED`.
- **Source** : SRC_G 1.4.1–1.4.2 ; écrans 10b : S04.
- **Confiance** : documenté ; fournisseur hébergé proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : OUI (parcours hébergé du fournisseur).
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : vérification « par statut » (15 IMP-09).

#### Fiche VER-002 / VER-003 — Selfie avec liveness et face match
- **FEATURE ID** : VER-002, VER-003
- **Nom** : Selfie avec permis et liveness (VER-002) ; face match par prestataire tiers (VER-003)
- **Module** : Identité & vérification (VER — Biométrie)
- **Persona** : PER-01, PER-02 (VER-002) ; PER-07 (VER-003)
- **Objectif** : prouver que le porteur du permis est la personne qui réserve (EC-43).
- **Description** : VER-002 : selfie avec le permis à côté du visage, liveness actif (ajout proposé), dans la session du fournisseur. VER-003 : comparaison selfie ↔ photo du permis par le fournisseur ; la plateforme ne stocke que score, seuil et décision.
- **Déclencheur** : session KYC (VER-001).
- **Prérequis** : VER-004 ; LEG-010.
- **Parcours principal** : capture → liveness → face match → score ≥ seuil → `APPROVED` ; sinon `MANUAL_REVIEW`.
- **Parcours alternatifs** : échec de liveness → 2 nouvelles tentatives (PROPOSÉ) puis revue ; refus du consentement biométrique → pas de vérification, réservation impossible (message explicite).
- **Règles métier** : BR-VERIF-01 ; BR-VERIF-09 ; BR-VERIF-11.
- **États** : SM-3 `AUTO_CHECKS` → `APPROVED` / `MANUAL_REVIEW` ; `REJECTED` → `APPEAL` sous 15 j → `APPROVED` / `REJECTED_FINAL` ; fraude → `BANNED`.
- **Erreurs** : `KYC_LIVENESS_FAILED`, `KYC_FACE_MISMATCH`, `KYC_BIOMETRIC_CONSENT_MISSING`.
- **Données** : kyc_check.liveness_result, face_match_score, threshold_version.
- **Notifications** : comme VER-001.
- **Permissions** : `OPS_AGENT` (portail fournisseur, accès journalisé).
- **Dépendances** : VER-002 → VER-001 ; VER-003 → VER-002.
- **Critères d'acceptation** : Given aucun consentement biométrique, When le guest lance la vérification, Then aucune session n'est créée (`KYC_BIOMETRIC_CONSENT_MISSING`). Given un score sous le seuil, When le résultat arrive, Then `MANUAL_REVIEW` et la décision ops est motivée et journalisée.
- **Source** : SRC_G 1.4.2 ; 10 §5 ; 11 EC-43 ; écrans 10b : S04.
- **Confiance** : documenté (selfie, face match) ; liveness proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL (les deux) — inclus dans le parcours hébergé du fournisseur ; score lu par l'ops dans son portail ; décision consignée.
- **Complexité** : moyenne ; ops faible ; risque **élevé** (biométrie).
- **Améliorations possibles** : selfie de contrôle au check-in (BR-VERIF-07).

#### Fiche VER-004 — Consentement biométrique et rétention
- **FEATURE ID** : VER-004
- **Nom** : Consentement biométrique et rétention
- **Module** : Identité & vérification (VER — Biométrie)
- **Persona** : PER-01, PER-02
- **Objectif** : base légale explicite (Ley 81/2019) et durée bornée.
- **Description** : case séparée non pré-cochée, texte versionné es/en ; conservation ≤ 3 ans après la dernière interaction (10 §5 ; durée finale OQ-BR-25) ; retrait = suppression demandée au fournisseur.
- **Déclencheur** : avant la première session KYC.
- **Prérequis** : LEG-002 ; LEG-010.
- **Parcours principal** : affichage → acceptation → consent(type=BIOMETRIC, version) → VER-001.
- **Parcours alternatifs** : refus → explication, réservation impossible ; retrait → purge tracée (manuelle en P0-A).
- **Règles métier** : BR-VERIF-01 ; BR-ACC-09.
- **États** : consent `GIVEN` → `WITHDRAWN` (PROPOSÉ).
- **Erreurs** : `CONSENT_REQUIRED`.
- **Données** : consent(user_id, type, version, locale, accepted_at, ip, user_agent).
- **Notifications** : aucune.
- **Permissions** : `GUEST` ; `ADMIN` (purge journalisée).
- **Dépendances** : LEG-002.
- **Critères d'acceptation** : Given une nouvelle version du texte, When elle est publiée, Then toute nouvelle session exige cette version. Given un retrait, When l'ops le traite, Then la demande de purge au fournisseur est tracée avec date.
- **Source** : 10 §5 ; écrans 10b : S04.
- **Confiance** : documenté (politique Turo) ; adaptation Ley 81 proposée.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — case séparée, texte unique versionné.
- **Complexité** : faible ; ops faible ; risque élevé.
- **Améliorations possibles** : droits des personnes en libre-service (LEG-005, P1).

#### Fiche VER-005 — Pièce d'identité cédula / passeport
- **FEATURE ID** : VER-005
- **Nom** : Pièce d'identité cédula / passeport
- **Module** : Identité & vérification (VER — Documents)
- **Persona** : PER-01 (passeport), PER-02 (cédula)
- **Objectif** : identifier la personne au-delà du permis (contrat, constancia, amendes).
- **Description** : contrôle de la cédula ou du passeport dans la session du fournisseur ; collecte du statut (touriste / résident / visa spécial) pour VER-007. Divergence : Turo n'exige le passeport que dans certains cas.
- **Déclencheur** : session KYC.
- **Prérequis** : VER-001.
- **Parcours principal** : choix du statut → document attendu → contrôle → stockage (type, pays, expiration).
- **Parcours alternatifs** : pièce expirée → `MORE_INFO_REQUIRED` ; nom différent du permis → revue.
- **Règles métier** : BR-VERIF-01.
- **États** : SM-3 (cycle de VER-001).
- **Erreurs** : `KYC_ID_DOCUMENT_MISSING`, `KYC_ID_EXPIRED`.
- **Données** : kyc_check.id_doc_type, id_doc_country, id_doc_expiry, residency_status.
- **Notifications** : comme VER-001.
- **Permissions** : `OPS_AGENT` ; jamais de n° de pièce visible par l'agence.
- **Dépendances** : VER-001.
- **Critères d'acceptation** : Given le statut « touriste », When la session démarre, Then le passeport est exigé. Given une pièce expirée, When le résultat arrive, Then `MORE_INFO_REQUIRED`.
- **Source** : 08 BR-VERIF-01 reco ; écrans 10b : S04.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — inclus dans le parcours hébergé du fournisseur (VER-001) ; contrôle par l'ops.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : lecture MRZ.

#### Fiche VER-006 — Règles des permis acceptés / refusés
- **FEATURE ID** : VER-006
- **Nom** : Règles des permis acceptés / refusés
- **Module** : Identité & vérification (VER — Règles permis)
- **Persona** : PER-07
- **Objectif** : liste fermée et versionnée des permis acceptés.
- **Description** : acceptés : permis permanents physiques ; refusés : numériques, photocopies, provisoires, IDP seul (référence Turo). Liste paramétrée (ADM-014) ; IDP et permis non latins : OQ-BR-21.
- **Déclencheur** : décision KYC.
- **Prérequis** : VER-001.
- **Parcours principal** : type renvoyé par le fournisseur → comparaison → accepté ou refus motivé.
- **Parcours alternatifs** : type inconnu → revue manuelle.
- **Règles métier** : BR-VERIF-02.
- **États** : SM-3 `AUTO_CHECKS` → `REJECTED` / `MANUAL_REVIEW`.
- **Erreurs** : `KYC_LICENSE_TYPE_REFUSED`.
- **Données** : license_rule(version, country, type, accepted, valid_from).
- **Notifications** : `EVT_KYC_REJECTED` avec motif.
- **Permissions** : `ADMIN` (liste), `OPS_AGENT` (application).
- **Dépendances** : VER-001.
- **Critères d'acceptation** : Given un permis provisoire, When il est soumis, Then refus motivé. Given une nouvelle version de liste, When elle est publiée, Then elle ne s'applique qu'aux décisions postérieures.
- **Source** : SRC_G 1.3.1–1.3.6 ; écrans 10b : S04.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — l'ops applique la liste lors de la revue KYC.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : règles Mercosur (Paraguay, P2).

#### Fiche VER-007 — Contrôle des 90 jours du permis étranger
- **FEATURE ID** : VER-007
- **Nom** : Contrôle des 90 jours du permis étranger (Panama)
- **Module** : Identité & vérification (VER — Règles permis)
- **Persona** : PER-01 ; PER-07
- **Objectif** : éviter qu'un touriste conduise au-delà de la validité de son permis étranger (art. 110 du Reglamento de Tránsito, sources secondaires ; art. 111 à valider).
- **Description** : statut + date d'entrée déclarée (photo du tampon facultative). Fin du trip > entrée + 90 j, ou résident avec seulement un permis étranger → **signalement** en revue manuelle (ADM-029), **jamais de refus automatique** tant qu'OQ-BR-21 n'est pas tranchée. Paramètre `foreign_license_mode` = FLAG (défaut) | BLOCK.
- **Déclencheur** : checkout d'un guest à permis étranger.
- **Prérequis** : VER-005 ; ADM-029.
- **Parcours principal** : saisie → calcul serveur → dépassement : réservation en revue → décision ops (approuver, demander un document, annuler avec remboursement intégral). **Moment du paiement : UXQ-08 ouverte** (consolidé VERIF_15-F2(ii)) — option 10b (P0-A, principe n° 2) : revue **avant** l'émission du lien ou de l'ordre de paiement, véhicule bloqué pendant la revue (`checkout_hold.review_required`) ; option alternative : paiement puis revue, remboursement intégral par l'agence en cas de refus (UXQ-12 en Bêta).
- **Parcours alternatifs** : date future ou incohérente → erreur ; BLOCK activé après l'avis → refus.
- **Règles métier** : BR-VERIF-02 ; BR-VERIF-09.
- **États** : SM-1b `PENDING` → `SATISFIED` / `FAILED` ; SM-1 → `CANCELLED_BY_PLATFORM` si l'ops annule.
- **Erreurs** : `KYC_ENTRY_DATE_INVALID`, `BOOKING_UNDER_REVIEW`, `KYC_FOREIGN_LICENSE_90D` (mode BLOCK).
- **Données** : traveler_status(user_id, residency_status, entry_date, entry_stamp_file_ref) ; flag `FOREIGN_LICENSE_90D`.
- **Notifications** : `EVT_BOOKING_UNDER_REVIEW` ; tâche ops.
- **Permissions** : `GUEST` (saisie), `OPS_AGENT` (décision).
- **Dépendances** : VER-005 ; ADM-029.
- **Critères d'acceptation** : Given entrée le 01/11 et fin de trip le 31/01 (entrée + 91 j) en mode FLAG, When le guest valide le checkout, Then la réservation passe en revue (avant le paiement si UXQ-08 retient l'option 10b, après sinon), n'est pas refusée, et la décision ops est motivée et journalisée. Given le mode BLOCK, When le même cas se présente, Then `KYC_FOREIGN_LICENSE_90D`. Given fin à entrée + 90 j exactement, When il valide le checkout, Then aucun signalement (borne incluse, PROPOSÉ).
- **Source** : 11 EC-50 ; 12 §3.4 ; écrans 10b : S04, S05, O01.
- **Confiance** : proposé (non applicable chez Turo).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : MANUEL — l'ops contrôle statut et date d'entrée à la revue de chaque réservation. Option (10b §7) : deux champs simples (statut, date d'entrée) au checkout, sans règle, lus par l'ops, seulement si UXQ-03 conclut que le fournisseur KYC ne peut pas les collecter.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : OCR du tampon ; locations 1–3 mois (BKG-042, P2).

#### Fiche VER-013 — Vérification du téléphone par OTP
- **FEATURE ID** : VER-013
- **Nom** : Vérification du téléphone par OTP
- **Module** : Identité & vérification (VER — Téléphone)
- **Persona** : tous
- **Objectif** : joignabilité et anti-doublon.
- **Description** : code 6 chiffres par WhatsApp (si gabarit approuvé, NTF-002), repli SMS après 60 s ou échec ; valable 10 min ; 5 essais puis blocage 1 h. VoIP/virtuels refusés selon le type de ligne du fournisseur OTP ; type inconnu → accepté et signalé à ADM-029.
- **Déclencheur** : inscription ; changement de numéro.
- **Prérequis** : NTF-001 ; ACC-014.
- **Parcours principal** : saisie E.164 → envoi → code → `verified_at`.
- **Parcours alternatifs** : non reçu → renvoi SMS après 60 s ; 5 échecs → blocage ; numéro vérifié ailleurs → refus.
- **Règles métier** : BR-VERIF-06.
- **États** : SM-3 `NOT_STARTED` → `PHONE_VERIFIED`.
- **Erreurs** : `OTP_INVALID`, `OTP_EXPIRED`, `OTP_LOCKED`, `PHONE_VIRTUAL_REFUSED`, `ACCOUNT_DUPLICATE_PHONE`.
- **Données** : phone(user_id, e164, verified_at, channel, line_type) ; otp(hash, expires_at, attempts).
- **Notifications** : `EVT_OTP_CODE`.
- **Permissions** : tous comptes.
- **Dépendances** : NTF-001 ; ACC-014 ; ADM-029.
- **Critères d'acceptation** : Given un code émis à 10:00, When il est saisi à 10:11, Then `OTP_EXPIRED`. Given 5 codes faux, When un 6e est saisi, Then `OTP_LOCKED` 1 h. Given un échec WhatsApp, When 60 s passent, Then un SMS part. Given un numéro non vérifié, When le guest paie, Then BKG-012 bloque.
- **Source** : SRC_G 1.4.6 ; écrans 10b : S15.
- **Confiance** : documenté (SMS chez Turo) ; WhatsApp proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — OTP par SMS ou email ; WhatsApp après approbation Meta.
- **Complexité** : faible ; ops faible ; risque moyen.
- **Améliorations possibles** : vérification silencieuse par opérateur.

#### Fiche VER-015 — Vérification du permis au comptoir (6 points)
- **FEATURE ID** : VER-015
- **Nom** : Écran de vérification du permis par l'agent (6 points)
- **Module** : Identité & vérification (VER — Check-in)
- **Persona** : PER-04
- **Objectif** : s'assurer au départ que la personne présente est le conducteur vérifié.
- **Description** : dans l'interface comptoir (TRP-052), 6 cases obligatoires : nom identique au compte, date de naissance, photo, validité, restrictions, permis non provisoire ; affichage du résultat KYC (vérifié, date) sans n° de pièce. Refus → TRP-007 ou no-show.
- **Déclencheur** : étape 1 du check-in (TRP-002).
- **Prérequis** : VER-001 ; trip `CHECKIN_OPEN`.
- **Parcours principal** : comparaison → 6 cases → étape suivante.
- **Parcours alternatifs** : case impossible → « permis non conforme » → check-in stoppé, motif `HOST_CANCELLED_DUE_TO_GUEST` avec photo-preuve → validation ops → qualification no-show guest (BR-CXL-12) ; sans preuve validée → requalifié `HOST_CANCELLED`.
- **Règles métier** : BR-VERIF-07, BR-PICKUP-08, BR-PICKUP-07, BR-CXL-12, BR-CXL-08.
- **États** : SM-1 `CHECKIN_OPEN` → `IN_PROGRESS` ou → `NO_SHOW_GUEST`.
- **Erreurs** : `CHECKIN_LICENSE_CHECK_INCOMPLETE`.
- **Données** : checkin_step(trip_id, step=LICENSE, checks[6], agent_id, server_ts).
- **Notifications** : `EVT_CHECKIN_REFUSED_LICENSE` (ops).
- **Permissions** : `AGENCY_COUNTER_AGENT`, `AGENCY_MANAGER`.
- **Dépendances** : VER-001.
- **Critères d'acceptation** : Given 5 cases sur 6, When l'agent continue, Then `CHECKIN_LICENSE_CHECK_INCOMPLETE`. Given l'écran comptoir, When il s'affiche, Then aucun n° de pièce n'est visible. Given un refus prouvé et validé, When le règlement est calculé, Then il suit T07 (configuration de test de 08) et TA03 (P0-A) ; sans preuve validée, T08 et TA04.
- **Source** : SRC_H H92, H94 ; TOS-HOST ; écrans 10b : A03.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — 6 cases à cocher sur l'écran comptoir, sans rapprochement automatique.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : selfie de contrôle comparé au KYC.

#### Fiche VER-027 — Vérification des loueurs professionnels (KYB)
- **FEATURE ID** : VER-027
- **Nom** : Vérification des loueurs professionnels (KYB)
- **Module** : Identité & vérification (VER — KYB)
- **Persona** : PER-03 ; PER-07
- **Objectif** : n'admettre que des agences légalement établies et assurées.
- **Description** : RUC, Aviso de Operación, identité du représentant légal (KYC), polices flotte (PRT-019), compte bancaire de la société (utile en P0-B). Absorbe FIN-008 et HST-018.
- **Déclencheur** : société `KYB_PENDING`.
- **Prérequis** : ACC-029.
- **Parcours principal** : dépôt des pièces → checklist ops → filtrage sanctions (VER-028) → décision motivée (ADM-004).
- **Parcours alternatifs** : pièce expirée → « à compléter » ; changement de représentant → revue partielle.
- **Règles métier** : BR-ACC-06 ; BR-LIST-01.
- **États** : `KYB_PENDING` → `KYB_APPROVED` / `KYB_INCOMPLETE` / `KYB_REJECTED`.
- **Erreurs** : `KYB_DOCUMENT_MISSING`, `KYB_DOCUMENT_EXPIRED`.
- **Données** : kyb_case(org_id, status, legal_rep_user_id, documents → file_asset, decided_by, decided_at).
- **Notifications** : `EVT_KYB_DECISION`.
- **Permissions** : `AGENCY_MANAGER` (dépôt), `OPS_AGENT` (revue).
- **Dépendances** : ACC-029.
- **Critères d'acceptation** : Given une checklist incomplète, When l'ops tente d'approuver, Then refus. Given une décision, When elle est enregistrée, Then motif et auteur sont journalisés.
- **Source** : 12 §10.3 ; 12 §9.8 ; écrans 10b : A07.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — documents reçus et vérifiés par l'ops, statut saisi dans la console.
- **Complexité** : moyenne ; ops **élevé** ; risque moyen.
- **Améliorations possibles** : onboarding express 48 h (FLT-019, P1).

#### Fiche VER-028 — Contrôle anti-blanchiment et listes de sanctions
- **FEATURE ID** : VER-028
- **Nom** : Contrôle anti-blanchiment et listes de sanctions
- **Module** : Identité & vérification (VER — LBC)
- **Persona** : PER-07
- **Objectif** : ne pas contracter avec une agence ou un représentant sanctionné.
- **Description** : filtrage des agences, représentants légaux et bénéficiaires effectifs (ONU, OFAC, listes panaméennes) à l'onboarding et à chaque changement de représentant. Statut de sujet obligé (Ley 23/2015) À VALIDER. En P0-A, aucun bénéficiaire de versement.
- **Déclencheur** : KYB ; changement de représentant.
- **Prérequis** : VER-027.
- **Parcours principal** : recherche → résultat → consigné (source, date, auteur).
- **Parcours alternatifs** : correspondance potentielle → escalade `ADMIN`, agence non activée.
- **Règles métier** : aucune BR dans 08 (« — »).
- **États** : screening `CLEAR` / `POTENTIAL_MATCH` / `CONFIRMED_MATCH`.
- **Erreurs** : `KYB_SANCTIONS_HIT`, `KYB_SCREENING_MISSING`.
- **Données** : sanctions_screening(subject_type, subject_id, lists_version, result, screened_at, reviewer).
- **Notifications** : interne.
- **Permissions** : `OPS_AGENT`, `ADMIN`.
- **Dépendances** : VER-027.
- **Critères d'acceptation** : Given une agence sans screening, When l'ops l'active, Then `KYB_SCREENING_MISSING`. Given un résultat, When il est enregistré, Then source et date figurent au dossier.
- **Source** : 12 §9.8 ; écrans 10b : A07.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — recherche manuelle sur les listes, consignée au dossier.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : screening continu (VER-009, P1) ; bénéficiaires de versements (P0-B).

## E2 — Recherche et fiche véhicule (P0-A, 15 lignes)

#### Fiche SRC-001 / SRC-002 — Recherche lieu + dates + heures, autocomplétion
- **FEATURE ID** : SRC-001, SRC-002
- **Nom** : Recherche lieu + dates + heures (SRC-001) ; autocomplete de lieux typé (SRC-002)
- **Module** : Catalogue & recherche (SRC — Barre de recherche)
- **Persona** : PER-01, PER-02
- **Objectif** : trouver un véhicule disponible au bon endroit et au bon créneau.
- **Description** : champs « ¿Dónde? / Desde / Hasta » (date + heure, pas de 30 min, fuseau America/Panama), bouton Buscar (ex-SRC-003 absorbé). SRC-002 : suggestions typées (aéroport, hôtel, adresse, ville) avec points d'intérêt car les adresses panaméennes sont souvent sans numéro ; en P0, les résultats sont les comptoirs des agences proches du lieu choisi.
- **Déclencheur** : page d'accueil ou résultats.
- **Prérequis** : véhicules `LISTED` (HST-026), occupation (CAL-011).
- **Parcours principal** : lieu → dates/heures → recherche → SRC-008 avec paramètres dans l'URL (dates conservées jusqu'à la fiche).
- **Parcours alternatifs** : fin ≤ début → message ; début dans le passé → refus ; aucune suggestion → saisie libre géocodée.
- **Règles métier** : BR-BOOK-03 (durée et granularité), BR-BOOK-04 (préavis), BR-BOOK-06 (horaires).
- **États** : aucun (lecture).
- **Erreurs** : `SEARCH_DATES_INVALID`, `SEARCH_LOCATION_REQUIRED`, `SEARCH_DURATION_EXCEEDED` (> durée max ADM-031, 30 j).
- **Données** : search_query(location, lat/lng, start_at, end_at, tz) — non persistée sauf analytics anonymisée.
- **Notifications** : aucune.
- **Permissions** : public.
- **Dépendances** : SRC-002 → SRC-001.
- **Critères d'acceptation** : Given début 10:00 et fin 09:30 le même jour, When le visiteur cherche, Then `SEARCH_DATES_INVALID`. Given une recherche valide, When il ouvre une fiche, Then les dates sont pré-remplies (LST-006). Given « Tocumen » saisi, When les suggestions s'affichent, Then le type « aeropuerto » est indiqué.
- **Source** : 05 G-SEARCH-01, G-SEARCH-02 ; EV-0001 ; 06 H-ONB-02 ; écrans 10b : S01.
- **Confiance** : confirmé (OBSERVÉ).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SRC-001 SIMPLIFIÉ — lieu choisi dans la liste des comptoirs pilotes, dates et heures ; SRC-002 DIFFÉRÉ — sans objet (la liste des comptoirs remplace l'autocomplétion).
- **Complexité** : moyenne (×2) ; ops faible ; risque faible.
- **Améliorations possibles** : recherche par usage (SRC-046, P2) ; dates flexibles.

#### Fiche SRC-008 / SRC-012 — Liste de résultats, carte et tri
- **FEATURE ID** : SRC-008, SRC-012
- **Nom** : Liste de résultats + carte avec marqueurs de prix (SRC-008) ; tri des résultats (SRC-012)
- **Module** : Catalogue & recherche (SRC — Résultats, Tri)
- **Persona** : PER-01, PER-02
- **Objectif** : comparer les véhicules disponibles au prix réel.
- **Description** : liste paginée et carte ; chaque marqueur affiche le **total TTC du séjour** (SRC-042) ; compteur de résultats ; état vide « aucun véhicule, modifiez vos critères » (ex-SRC-010). SRC-012 : tri par pertinence (défaut), prix croissant/décroissant, distance (absorbe SRC-014, SRC-015). Filtre « sin tarjeta de crédito » (PAY-035).
- **Déclencheur** : recherche (SRC-001).
- **Prérequis** : SRC-042 ; disponibilité (CAL-011).
- **Parcours principal** : requête → véhicules `LISTED` sans occupation chevauchante, respectant préavis/horaires/durées → devis par véhicule (PRC-025) → liste + carte cohérentes → tri.
- **Parcours alternatifs** : 0 résultat → état vide ; devis impossible (paramètre manquant) → véhicule exclu et alerte ops.
- **Règles métier** : BR-PRICE-13 (transparence), BR-HP-07 (classement en recherche — référence ; pertinence simple en P0 : distance puis prix, PROPOSÉ), BR-BOOK-07.
- **États** : lecture de SM-2 (`LISTED` seulement).
- **Erreurs** : `SEARCH_NO_RESULTS` (état, pas une erreur bloquante), `QUOTE_UNAVAILABLE`.
- **Données** : résultat(vehicle_id, quote_id provisoire, total_ttc, distance).
- **Notifications** : aucune.
- **Permissions** : public.
- **Dépendances** : SRC-008 → SRC-001, SRC-042 ; SRC-012 → SRC-008.
- **Critères d'acceptation** : Given une recherche, When liste et carte s'affichent, Then elles montrent les mêmes véhicules et les mêmes totaux au cent près. Given un véhicule réservé sur le créneau, When on cherche, Then il n'apparaît pas. Given le tri « prix croissant », When il est appliqué, Then l'ordre suit le total TTC.
- **Source** : 05 G-SEARCH-03, G-SEARCH-05 ; EV-0002 ; écrans 10b : S02.
- **Confiance** : confirmé (OBSERVÉ) ; total TTC proposé (Turo affiche HT).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SRC-008 SIMPLIFIÉ — liste sans carte ; SRC-012 DIFFÉRÉ — tri inutile pour quelques dizaines de véhicules.
- **Complexité** : moyenne / faible ; ops faible ; risque faible.
- **Améliorations possibles** : filtres complets (P1) ; classement par qualité de l'agence.

#### Fiche SRC-011 — Carte résultat
- **FEATURE ID** : SRC-011
- **Nom** : Carte résultat
- **Module** : Catalogue & recherche (SRC — Résultats)
- **Persona** : PER-01, PER-02
- **Objectif** : donner sur une carte toutes les informations de décision.
- **Description** : photo principale, marque-modèle-année, catégorie, transmission, places, nom commercial de l'agence, note moyenne + nombre de trips ou badge « Nuevo », lieu de retrait, **total TTC** et prix/jour, **montant de la caution** et mention « sin tarjeta de crédito » si la politique de l'agence le permet (PAY-035).
- **Déclencheur** : affichage des résultats.
- **Prérequis** : SRC-008, SRC-042, PAY-035.
- **Parcours principal** : rendu de la carte → clic → fiche avec dates conservées.
- **Parcours alternatifs** : champ manquant → véhicule non publiable (validation à la publication, HST-016), jamais de champ vide affiché.
- **Règles métier** : BR-PRICE-13 ; BR-PAY-06 (caution affichée).
- **États** : —
- **Erreurs** : —
- **Données** : vue dénormalisée vehicle_card.
- **Notifications** : —
- **Permissions** : public.
- **Dépendances** : SRC-008 ; PAY-035 ; SRC-042.
- **Critères d'acceptation** : Given un véhicule d'une agence acceptant la caution par débit, When la carte s'affiche, Then « sin tarjeta de crédito » et le montant de la caution sont visibles. Given un véhicule sans avis, When la carte s'affiche, Then badge « Nuevo » et aucune note. Given un clic, When la fiche s'ouvre, Then les dates sont identiques.
- **Source** : 05 G-SEARCH-03 ; 03 §3 ; écrans 10b : S02.
- **Confiance** : confirmé (structure OBSERVÉE) ; champs caution/TTC proposés.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : favoris (P1) ; badge « Agencia verificada ».

#### Fiche SRC-042 — Affichage du total TTC
- **FEATURE ID** : SRC-042
- **Nom** : Affichage du total TTC
- **Module** : Catalogue & recherche (SRC — Prix affiché)
- **Persona** : PER-01, PER-02
- **Objectif** : afficher dès la recherche le prix réellement payé (transparence, ACODECO).
- **Description** : total = loyer des jours facturables + ITBMS (PRC-020) + toute protection obligatoire (aucune en P0) ; valeur issue du même moteur que le checkout (PRC-025). Divergence volontaire : Turo affiche HT.
- **Déclencheur** : recherche, fiche.
- **Prérequis** : PRC-021, PRC-025.
- **Parcours principal** : devis provisoire par véhicule → total TTC affiché → identique au checkout pour les mêmes entrées.
- **Parcours alternatifs** : paramètre de taxe changé entre recherche et checkout → le checkout recalcule et affiche « le prix a changé ».
- **Règles métier** : BR-PRICE-13, BR-PRICE-12, BR-PRICE-14.
- **États** : devis `PROVISIONAL` (non figé).
- **Erreurs** : `QUOTE_UNAVAILABLE`.
- **Données** : quote provisoire (non persisté ou TTL court).
- **Notifications** : —
- **Permissions** : public.
- **Dépendances** : PRC-021.
- **Critères d'acceptation** : Given le trip PA1 (TA01), When il est cherché, Then le total affiché est 128,40 US$ partout (carte, fiche, checkout). Given un changement de taux, When le guest arrive au checkout, Then le nouveau total est affiché avec un avertissement avant paiement.
- **Source** : 08 BR-PRICE-13 reco ; écrans 10b : S02, S03.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — total TTC lu dans le devis (PRC-025), sans protection obligatoire.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : prix tout compris avec protection minimale (PRC-026, P1).

#### Fiche LST-002 — Galerie de photos
- **FEATURE ID** : LST-002
- **Nom** : Galerie de photos
- **Module** : Catalogue & recherche (LST — Contenu)
- **Persona** : PER-01, PER-02
- **Objectif** : montrer fidèlement le véhicule.
- **Description** : photo principale choisie par l'agence, galerie plein écran (balayage mobile, flèches ordinateur) de toutes les photos approuvées (HST-012, au moins 6) ; texte alternatif = marque, modèle, angle ; tailles adaptées (≈ 200 ko liste, ≈ 600 ko plein écran).
- **Déclencheur** : ouverture de la fiche.
- **Prérequis** : HST-012.
- **Parcours principal** : affichage de la principale → ouverture de la galerie → navigation.
- **Parcours alternatifs** : photo en erreur → vignette de remplacement, fiche intacte.
- **Règles métier** : BR-LIST-05.
- **États** : —
- **Erreurs** : —
- **Données** : listing_photo(vehicle_id, order, url_variants, alt_es, alt_en, approved).
- **Notifications** : —
- **Permissions** : public.
- **Dépendances** : HST-012.
- **Critères d'acceptation** : Given 8 photos approuvées, When la galerie s'ouvre, Then l'ordre est celui de l'agence. Given une photo inaccessible, When la fiche se charge, Then les autres blocs s'affichent.
- **Source** : 05 G-LISTING-02 ; écrans 10b : S03.
- **Confiance** : confirmé (OBSERVÉ).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : vidéo 360°.

#### Fiche LST-003 / LST-020 — En-tête véhicule et bloc agence
- **FEATURE ID** : LST-003, LST-020
- **Nom** : En-tête véhicule (LST-003) ; bloc « Hosted by » / agence (LST-020)
- **Module** : Catalogue & recherche (LST — Contenu, Hôte)
- **Persona** : PER-01, PER-02
- **Objectif** : identifier le véhicule et l'agence et donner des signaux de confiance.
- **Description** : LST-003 : marque, modèle, année, finition, note moyenne, nombre de trips, badge. LST-020 : nom commercial de l'agence, note, nombre de trips, ancienneté sur la plateforme.
- **Déclencheur** : ouverture de la fiche.
- **Prérequis** : REV-010 ; ACC-008.
- **Parcours principal** : rendu à partir des agrégats REV-010.
- **Parcours alternatifs** : aucun avis → badge « Nuevo ».
- **Règles métier** : BR-REVIEW-03, BR-REVIEW-05, BR-HP-01 (référence All-Star : pas de badge hôte en P0).
- **États** : —
- **Erreurs** : —
- **Données** : agrégats (REV-010) ; organization.trade_name, organization.created_at.
- **Notifications** : —
- **Permissions** : public.
- **Dépendances** : LST-003 → REV-010 ; LST-020 → ACC-008, REV-010.
- **Critères d'acceptation** : Given un véhicule à 4 trips notés, When la fiche s'affiche, Then la note est la moyenne des 4 et le nombre de trips correspond aux trips terminés.
- **Source** : 05 G-LISTING-02 ; écrans 10b : S03.
- **Confiance** : confirmé (OBSERVÉ).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : LST-003 SIMPLIFIÉ — marque, modèle, année, catégorie ; LST-020 DIFFÉRÉ — nom de l'agence déjà dans l'en-tête.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : badge « Agencia verificada » (REV-014, P1).

#### Fiche LST-006 / LST-008 — Sélecteur de dates sur la fiche, dates indisponibles
- **FEATURE ID** : LST-006, LST-008
- **Nom** : Sélecteur de dates/heures sur la fiche (LST-006) ; gestion des dates indisponibles (LST-008)
- **Module** : Catalogue & recherche (LST — Réservation, Disponibilité)
- **Persona** : PER-01, PER-02
- **Objectif** : choisir un créneau réservable sans essai-erreur.
- **Description** : LST-006 : début et fin (date + heure, pas de 30 min, America/Panama), pré-remplis ; bornés par horaires du lieu, préavis, durées min/max (CAL-003) ; dates occupées grisées (CAL-011) ; toute modification relance le devis (PRC-025). LST-008 : message « non disponible du … au … » et ajustement automatique de l'heure de fin (règle exacte Turo à retester).
- **Déclencheur** : ouverture de la fiche ; modification des dates.
- **Prérequis** : CAL-003, CAL-011, PRC-025.
- **Parcours principal** : dates valides → devis → bouton « Reservar ».
- **Parcours alternatifs** : créneau hors horaires / chevauchement → refus avec raison ; LST-008 : fin proposée au dernier créneau libre (PROPOSÉ).
- **Règles métier** : BR-BOOK-03, BR-BOOK-04, BR-BOOK-06, BR-BOOK-07.
- **États** : —
- **Erreurs** : `DATES_OUTSIDE_HOURS`, `DATES_NOTICE_TOO_SHORT`, `DATES_UNAVAILABLE`, `DATES_DURATION`.
- **Données** : lecture vehicle_occupancy, location_hours, params.
- **Notifications** : —
- **Permissions** : public.
- **Dépendances** : LST-006 → CAL-003, CAL-011, PRC-025 ; LST-008 → CAL-011.
- **Critères d'acceptation** : Given un comptoir ouvert 8 h–18 h, When le guest choisit 19:00, Then `DATES_OUTSIDE_HOURS` avec motif. Given un trip existant du 10 au 12, When il choisit le 11, Then la date est grisée et non sélectionnable. Given un préavis de 3 h, When il choisit un départ dans 2 h, Then `DATES_NOTICE_TOO_SHORT`.
- **Source** : 05 G-LISTING-02 ; EV-0005 ; écrans 10b : S03.
- **Confiance** : confirmé (OBSERVÉ) ; ajustement automatique à retester.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : LST-006 OUI ; LST-008 DIFFÉRÉ — le sélecteur refuse simplement les dates occupées.
- **Complexité** : faible / moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : suggestion de véhicules alternatifs.

#### Fiche LST-007 — Lieu de retrait de l'agence
- **FEATURE ID** : LST-007
- **Nom** : Lieu de retrait de l'agence (approximatif puis exact)
- **Module** : Catalogue & recherche (LST — Lieu)
- **Persona** : PER-01, PER-02
- **Objectif** : savoir où retirer le véhicule.
- **Description** : avant réservation : quartier ou ville du comptoir ; après réservation : adresse exacte, plan, horaires, instructions (HST-011). Livraison et changement de lieu : P1 (HST-034).
- **Déclencheur** : fiche ; confirmation.
- **Prérequis** : HST-011.
- **Parcours principal** : affichage approximatif → après BOOKED, adresse exacte dans le trip et la confirmation (NTF-007).
- **Parcours alternatifs** : comptoir fermé exceptionnellement → l'agence doit annuler ou proposer une alternative via le support.
- **Règles métier** : BR-BOOK-02 (masquage avant réservation), BR-BOOK-09.
- **États** : visibilité dépend de SM-1 (≥ `BOOKED`).
- **Erreurs** : —
- **Données** : location(org_id, name, area, address, lat/lng, hours, instructions).
- **Notifications** : adresse dans `EVT_BOOKING_CONFIRMED`.
- **Permissions** : public (approximatif) ; `GUEST` du trip (exact).
- **Dépendances** : HST-011.
- **Critères d'acceptation** : Given un visiteur non réservé, When il ouvre la fiche, Then l'adresse exacte n'est pas dans la réponse API. Given un trip BOOKED, When le guest l'ouvre, Then adresse, plan et horaires sont affichés.
- **Source** : 05 G-LISTING-02 ; écrans 10b : S03.
- **Confiance** : confirmé (OBSERVÉ ; modale d'édition non explorée).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — adresse du comptoir affichée dès la fiche (lieu public de l'agence).
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : points de remise aéroport homologués (BKG-041, P1).

#### Fiche LST-010 — Résumé de la politique d'annulation
- **FEATURE ID** : LST-010
- **Nom** : Résumé de la politique d'annulation
- **Module** : Catalogue & recherche (LST — Politiques)
- **Persona** : PER-01, PER-02
- **Objectif** : informer avant le paiement de la date limite d'annulation gratuite.
- **Description** : texte calculé : « Cancelación gratuita hasta el {freeUntil} » à partir des paramètres (ADM-031) et de BR-CXL-01 ; rappel des retenues hors fenêtre (BR-CXL-06).
- **Déclencheur** : fiche, checkout.
- **Prérequis** : ADM-031.
- **Parcours principal** : calcul de `freeUntil` pour les dates choisies → affichage.
- **Parcours alternatifs** : réservation à moins de 25 h (`lastMinuteThreshold`) → « gratuite pendant 1 h après la réservation ».
- **Règles métier** : BR-CXL-01, BR-CXL-06, BR-CXL-00.
- **États** : —
- **Erreurs** : —
- **Données** : params `free_cancel_lead`, `last_minute_threshold`.
- **Notifications** : —
- **Permissions** : public.
- **Dépendances** : ADM-031.
- **Critères d'acceptation** : Given un départ le 14/01 10:00 réservé 5 j avant, When la fiche s'affiche, Then « gratuite jusqu'au 13/01 10:00 » (cohérent avec l'observation Turo). Given un départ dans 20 h, When la fiche s'affiche, Then « gratuite pendant 1 h après la réservation ».
- **Source** : 05 G-LISTING-02 ; écrans 10b : S03, S05, S10.
- **Confiance** : base confirmée (OBSERVÉ : date limite affichée au checkout) ; texte espagnol et calcul de `freeUntil` proposés (consolidé VERIF_15-F14).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — texte fixe de la politique d'annulation.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : tarif non remboursable (PRC-010, P1).

#### Fiche LST-012 — Distance incluse et prix du km supplémentaire
- **FEATURE ID** : LST-012
- **Nom** : Distance incluse et prix du km supplémentaire
- **Module** : Catalogue & recherche (LST — Kilométrage)
- **Persona** : PER-01, PER-02
- **Objectif** : rendre le coût kilométrique prévisible.
- **Description** : distance incluse par jour (ou « kilometraje ilimitado ») et prix du km supplémentaire configurés par l'agence (HST-033), en km et USD ; distance totale incluse = km/jour × jours facturables.
- **Déclencheur** : fiche, checkout, contrat.
- **Prérequis** : HST-033.
- **Parcours principal** : lecture de la configuration figée dans le devis → affichage.
- **Parcours alternatifs** : illimité → aucun prix de km.
- **Règles métier** : BR-MILEAGE-01, BR-MILEAGE-04, BR-PRICE-17.
- **États** : —
- **Erreurs** : —
- **Données** : quote.included_km, quote.extra_km_price_minor.
- **Notifications** : —
- **Permissions** : public.
- **Dépendances** : HST-033.
- **Critères d'acceptation** : Given 200 km/j et 3 jours facturables, When le checkout s'affiche, Then « 600 km incluidos » et le même prix du km sur la fiche, le checkout, le contrat et la facture ; aucune valeur en miles.
- **Source** : 05 G-LISTING-02 ; écrans 10b : S03.
- **Confiance** : confirmé (OBSERVÉ, en miles chez Turo).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — valeurs de l'import affichées.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : relevé kilométrique par télématique (TRP-055, P1).

#### Fiche LST-013 — Bloc assurance et protection
- **FEATURE ID** : LST-013
- **Nom** : Bloc assurance et protection (police flotte de l'agence)
- **Module** : Catalogue & recherche (LST — Protection)
- **Persona** : PER-01, PER-02
- **Objectif** : dire clairement qui assure, ce qui est couvert et ce que le guest paie en cas de dommage.
- **Description** : assureur de la police flotte et n° masqué (PRT-019), RC tiers incluse (PRT-003), franchise dommages et vol à la charge du locataire, exclusions principales, caution exigée, moyens acceptés et liste « couvre / ne couvre pas » déclarée par l'agence, dont « dommages : oui / non » (PAY-035 ; bloc UX-21 de 10b, consolidé VERIF_15-F2(i)), lien vers le détail. Bloc absent et annonce non publiable si la police est expirée. Texte repris à l'identique dans le contrat (BKG-018). Absorbe PRT-004.
- **Déclencheur** : fiche, checkout.
- **Prérequis** : PRT-009, PRT-019, PAY-035.
- **Parcours principal** : rendu depuis les données de police vérifiées.
- **Parcours alternatifs** : police expirée → annonce dépubliée (PRT-019).
- **Règles métier** : BR-PROT-04, BR-PROT-01, BR-PROT-03 (exclusions), BR-PAY-06.
- **États** : dépend de SM-2 (`LISTED` exige police valide).
- **Erreurs** : —
- **Données** : insurance_policy(insurer, policy_no_masked, valid_from, valid_to, rc_amount, deductible_damage, deductible_theft, exclusions_es/en).
- **Notifications** : —
- **Permissions** : public.
- **Dépendances** : PRT-009 ; PRT-019 ; PAY-035.
- **Critères d'acceptation** : Given une police valide, When la fiche s'affiche, Then assureur, n° masqué, RC, franchises, exclusions, caution et liste « couvre / ne couvre pas » sont affichés et identiques au texte du contrat. Given une police expirée hier, When on ouvre la fiche, Then l'annonce n'est plus accessible en recherche.
- **Source** : 05 G-LISTING-02 ; écrans 10b : S03.
- **Confiance** : confirmé (bloc OBSERVÉ chez Turo) ; contenu police flotte proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — bloc de texte saisi par l'ops depuis la police (assureur, RC, franchise, caution).
- **Complexité** : faible ; ops faible ; risque moyen.
- **Améliorations possibles** : protection guest optionnelle (PRT-001, P1 si OQ-BR-16).

## E3 — Disponibilité, calendrier et flotte (P0-A, 9 lignes)

#### Fiche CAL-011 — Table d'occupation unique
- **FEATURE ID** : CAL-011
- **Nom** : Table d'occupation unique
- **Module** : Disponibilité & flotte (CAL — Intégrité)
- **Persona** : PER-07 (technique) ; effets pour tous
- **Objectif** : une seule source de vérité de la disponibilité, sans double réservation.
- **Description** : `vehicle_occupancy` : `kind ∈ {TRIP, HOLD, HOST_BLOCK, BUFFER}` et `source ∈ {CHECKOUT, MANUAL, ICAL, SYSTEM}` (un événement iCal est un `HOST_BLOCK` de source `ICAL`), `period` semi-ouvert [début, fin + tampon), `active` seul prédicat de la **contrainte d'exclusion** GiST (PostgreSQL). Invariant **I-OCC** : tout trip non terminal possède exactement une occupation `TRIP` active (trigger de contrainte différé + requête de contrôle nocturne) ; une occupation de trip n'est jamais désactivée par l'expiration d'un hold. `BUFFER` est réservé aux tampons autonomes et n'est jamais produit par la conversion d'un hold. Absorbe CAL-010 (blocage refusé s'il chevauche un trip confirmé). (consolidé VERIF_15-F1, F9 ; 17 §2.5)
- **Déclencheur** : hold, confirmation, blocage, import iCal, annulation.
- **Prérequis** : aucun.
- **Parcours principal** : insertion dans une transaction ; conflit → rejet atomique.
- **Parcours alternatifs** : annulation → libération de l'intervalle ; trip terminé tôt → tampon recalculé.
- **Règles métier** : BR-BOOK-10, BR-BOOK-05, BR-BOOK-07.
- **États** : reflète SM-1 : occupation `HOLD` convertie en `TRIP` par la conversion gardée (BKG-014) ; `deactivated_reason` ∈ {`HOLD_EXPIRED`, `HOLD_RELEASED`, `TRIP_TERMINAL`, `SHORTENED`, `BLOCK_REMOVED`}.
- **Erreurs** : `VEHICLE_UNAVAILABLE`.
- **Données** : `vehicle_occupancy`(id, vehicle_id, kind, source, period tstzrange, active, expires_at, deactivated_reason, ref_type, ref_id, ical_uid) (17 §3.2.4).
- **Notifications** : —
- **Permissions** : `SYSTEM`.
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given 100 tentatives concurrentes de hold sur le même intervalle, When elles s'exécutent, Then exactement une réussit et 99 reçoivent `409 VEHICLE_UNAVAILABLE` (EC-51 ; 17 test C1). Given un blocage chevauchant un trip confirmé, When l'agence le crée, Then `VEHICLE_UNAVAILABLE`. Given une transaction qui laisse un trip `BOOKED` sans occupation `TRIP` active, When elle est validée, Then le trigger I-OCC l'annule (17 C12).
- **Source** : 08 BR-BOOK-10 ; 11 EC-51. ; 17 §2.5 (I-OCC, tests C1–C20), 17 §2.3 (RLS-1 à RLS-20), 17 §11 (L0-01 à L0-10), ADR-002 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé (mécanisme Turo inféré).
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — contrainte d'exclusion sur trips, holds et blocages ; tampon global ; pas d'événements iCal.
- **Complexité** : élevée ; ops faible ; risque moyen.
- **Améliorations possibles** : connecteurs aux logiciels de location (FLT-018, P1).

#### Fiche BKG-014 — Hold de checkout et anti-double réservation
- **FEATURE ID** : BKG-014
- **Nom** : Hold de checkout et anti-double réservation
- **Module** : Disponibilité & flotte (BKG — Concurrence ; rattaché à E3)
- **Persona** : PER-01, PER-02 (effet) ; `SYSTEM`
- **Objectif** : réserver le créneau pendant le paiement.
- **Description** : `checkout_hold` (17 §2.5 ; 08 BR-BOOK-10) de deux types : **`CHECKOUT`** (mode a, TTL `hold_ttl_minutes` = 10) et **`AGENCY_LINK`** (mode b, lien de paiement du PSP de l'agence ; TTL `agency_link_hold_minutes` PROPOSÉ 120 min — **décision produit ouverte UXQ-09**, ADR-025 ; au plus 1 par guest, KYC approuvé, agence en opt-in `agency_link_enabled` ; aucun trip, contrat ni NTF-007 avant la preuve). Le hold pose une occupation `kind = HOLD` sous la contrainte d'exclusion (CAL-011). **État « paiement en cours »** (`PAYMENT_IN_FLIGHT`) dès la création de l'ordre PSP : `payment_in_flight_until = min(création de l'ordre + TTL de l'ordre + marge, création du hold + hold_max_total_minutes = 20 min)`, exclu de l'expiration (ex. ordre Yappy de 300 s créé à 10:08 : véhicule bloqué jusqu'à 10:13 + marge, au-delà des 10 min) ; un moyen dont l'ordre dure plus que le hold n'est pas proposé. Un seul paiement en cours par hold ; au plus 2 holds vivants par guest (`max_active_holds_per_guest`), dont 1 `AGENCY_LINK`. **Conversion atomique et gardée** à la preuve PAY-034 (17 §2.5 étape 4) : verrou `FOR UPDATE` du hold, `UPDATE vehicle_occupancy SET kind = 'TRIP', active = true` (la contrainte d'exclusion est réévaluée ; jamais un simple changement de `kind` d'une ligne inactive), création du trip `BOOKED`, de `guest_occupancy` et des liens `payment_operation_link`, I-OCC vérifié au commit. Paiement reçu **après expiration ou libération** : **ré-acquisition** sous la contrainte si le créneau est libre (trip confirmé, `booking.hold.reacquired`), sinon **compensation** (`hold_compensation`) selon la capacité validée du PSP : void d'une autorisation ; remboursement API sous mandat LEG-027 ; remboursement intégral par l'agence (`agency_refund_task`) pour un débit capturé, dont le paiement immédiat par lien de la Bêta ; Yappy par virement de l'agence sous 5 j ouvrés — sans trip, règlement, pénalité ni commission. Absorbe BKG-010, BKG-015. (consolidé VERIF_15-F1, F2(iii) ; 17 §2.5, ADR-002, ADR-025 ; 08 BR-BOOK-10 points 1–10 ; 10b §7 BKG-014)
- **Déclencheur** : clic « Pagar » (hold `CHECKOUT`) ; émission du lien de paiement de l'agence (hold `AGENCY_LINK`) ; preuve de paiement (webhook signé, IPN confirmé ou confirmation de l'agence) ; tâche d'expiration toutes les 60 s ; libération par l'agence.
- **Prérequis** : CAL-011 ; PAY-019.
- **Parcours principal** : `QUOTE` → `HOLD` (`checkout_hold` `ACTIVE`, 10 min) → ordre PSP créé (`PAYMENT_IN_FLIGHT`) → preuve PAY-034 → conversion gardée → `BOOKED` (`booking.hold.converted`, `booking.trip.booked`) ; mode b : `HOLD` `AGENCY_LINK` (120 min PROPOSÉ) → lien → webhook signé ou confirmation de l'agence → conversion gardée → `BOOKED`.
- **Parcours alternatifs** : (1) échéance sans paiement en cours → `EXPIRED`, créneau libéré, aucun règlement ; (2) preuve reçue après expiration ou libération, créneau libre → ré-acquisition, trip `BOOKED` ; (3) même cas, créneau repris entre-temps → compensation par capacité (17 §2.5 étape 5), guest notifié aussitôt (excuse, véhicules similaires, date d'émission du remboursement : écran S06 « paiement tardif »), alerte ops ; (4) deux holds chevauchants d'un même guest payés → un seul trip, le second paiement compensé (motif `GUEST_OVERLAP`) ; (5) rejeu de webhook ou double confirmation → le trip existant est renvoyé ; (6) libération d'un `AGENCY_LINK` concurrente de la preuve → conversion **ou** compensation, jamais les deux ; (7) réponse PSP inconnue → même clé et lecture de l'opération ; sans lecture par référence marchande validée, aucune nouvelle tentative (escalade ops, hold conservé jusqu'à `payment_in_flight_until`). Le hold prolongé (2 h + 10 min) de la version 1 est supprimé (consolidé VERIF_15-F1).
- **Règles métier** : BR-BOOK-10, BR-BOOK-08, BR-BOOK-11, BR-PAY-01.
- **États** : `checkout_hold.status` `ACTIVE` → `PAYMENT_IN_FLIGHT` → `CONVERTED` / `EXPIRED` / `RELEASED` ; SM-1 `QUOTE` → `HOLD` → `BOOKED` (sur preuve de paiement) ou → `QUOTE` ; `hold_compensation` `OPEN` → `EXECUTING` → `DONE` / `ESCALATED`.
- **Erreurs** : `409 VEHICLE_UNAVAILABLE` (créneau pris, avec suggestions), `HOLD_EXPIRED`, `GUEST_OVERLAP`, `HOLD_LIMIT_REACHED` (plus de 2 holds vivants ou plus d'un `AGENCY_LINK`), moyen de paiement non proposé si son ordre dépasse le hold (noms de référence).
- **Données** : `checkout_hold`(id, guest_user_id, vehicle_id, org_id, quote_id, occupancy_id, kind, status, expires_at, payment_in_flight_until, payment_attempts, converted_trip_id, review_required) ; `vehicle_occupancy` (`HOLD` → `TRIP`) ; `guest_occupancy` (trips seulement) ; `payment_operation` (`hold_id`, `trip_id` nul avant conversion) et `payment_operation_link` ; `hold_compensation` (17 §3.2.4, §3.2.7).
- **Notifications** : écrans S05 (« hold expiré → relancer ») et S06 (« Pago en verificación », ordre Yappy expiré, paiement tardif) ; événements `booking.hold.created` / `.payment_in_flight` / `.expired` / `.released` / `.reacquired` / `.converted`, `booking.hold.compensation_required` (guest, agence, alerte ops) ; agence : liste « liens en attente » (`AGENCY_LINK`).
- **Permissions** : `GUEST`, `SYSTEM` ; `AGENCY_OWNER`, `AGENCY_MANAGER`, `AGENCY_COUNTER_AGENT` (ses lieux) : `hold.release_agency_link` ; `OPS_AGENT` : file des compensations.
- **Dépendances** : CAL-011 ; PAY-019.
- **Critères d'acceptation** : Given un hold déjà compensé et un créneau redevenu libre, When une seconde preuve de paiement arrive pour ce hold, Then aucun trip n'est créé et le paiement est remboursé (aligné v4, C-v3-08, 17 C13). Given un lien payé deux fois, When les deux preuves arrivent, Then un seul trip et le second paiement est remboursé (`DUPLICATE_PAYMENT`, 17 C14). Given un hold H1 expiré puis un hold H2 du même guest sur le même créneau non payé, When la preuve de H1 arrive, Then H1 devient le trip, H2 est libéré et aucun remboursement n'est ouvert (17 C18). Given un guest connecté, When il tente de modifier l'échéance ou le statut de son hold hors des commandes, Then la base refuse et rien ne change (17 RLS-13). Given un hold `CHECKOUT` créé à 10:00 sans ordre PSP, When la tâche d'expiration tourne à 10:10, Then le hold est `EXPIRED` et le créneau réservable. Given un ordre Yappy de 300 s créé à 10:08, When un second guest pose un hold sur le même créneau à 10:11, Then il reçoit `409 VEHICLE_UNAVAILABLE` et le hold du premier reste `PAYMENT_IN_FLIGHT` (17 C5). Given une conversion qui a verrouillé le hold et une tâche d'expiration qui tourne avec `expires_at` dépassé, When la conversion est validée, Then le trip est `BOOKED` avec une occupation `TRIP` active (C2). Given un hold expiré sans concurrent, When la preuve de paiement arrive, Then ré-acquisition et trip `BOOKED` (C3). Given un hold expiré et un autre guest qui a converti le même créneau, When la preuve tardive arrive, Then aucun trip n'est créé, une `hold_compensation` est ouverte selon la capacité du PSP et une seule occupation reste active (C4). Given le même webhook reçu deux fois et une confirmation de l'agence simultanée, When ils sont traités, Then un seul trip existe (C6). Given 100 poses de hold concurrentes, When elles s'exécutent, Then 1 hold et 99 `409 VEHICLE_UNAVAILABLE` (C1). Given le fuzz d'entrelacements C11 (≥ 10 000 exécutions), When il tourne, Then jamais deux occupations actives chevauchantes et 0 paiement `SUCCEEDED` sans trip ni compensation après 20 min (C11, C12).
- **Source** : 08 BR-BOOK-10 (points 1–10, consolidé) ; 17 §2.5 (tests C1–C20), 17 §2.3 (RLS-1 à RLS-20), 17 §11 (L0-01 à L0-10), ADR-002, ADR-025 ; 10b §7 BKG-014 (VERIF_13-V13-04) ; 11 EC-51 ; écrans 10b : S05, S06.
- **Confiance** : proposé (aucun hold observé chez Turo, INFÉRÉ).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — hold `AGENCY_LINK` seul (mode b, PAY-033) et contrainte d'exclusion ; conversion gardée ; compensation = remboursement par l'agence ; état terminal `COMPENSATED` et `payment_disposition` ; libération en deux temps ou différée ; lecture du PSP avant toute libération ; `disposition_sweeper` ; création et annulation du hold par commandes serveur seulement ; tests C1–C20 sous les rôles de production (aligné v4, 17 §2.5, §10, §11).
- **Complexité** : élevée ; ops faible ; risque moyen.
- **Améliorations possibles** : file d'attente si le créneau se libère.

#### Fiche CAL-001 / CAL-002 — Calendrier par véhicule et blocages
- **FEATURE ID** : CAL-001, CAL-002
- **Nom** : Calendrier par véhicule (CAL-001) ; blocage journalier ou horaire (CAL-002)
- **Module** : Disponibilité & flotte (CAL — Calendrier, Blocages)
- **Persona** : PER-03, PER-04 (selon rôle FLT-003)
- **Objectif** : voir et gérer l'occupation de chaque véhicule.
- **Description** : CAL-001 : vue mois/semaine par véhicule (trips avec statut et conducteur, holds, blocages, tampons, événements iCal) lue dans CAL-011 ; porte l'étape « disponibilité » de l'annonce (ex-HST-010). CAL-002 : bloquer un ou plusieurs véhicules par jour ou par heure.
- **Déclencheur** : espace agence.
- **Prérequis** : HST-026, CAL-011, FLT-003.
- **Parcours principal** : consultation → création d'un blocage → insertion CAL-011 → disparition de la recherche.
- **Parcours alternatifs** : chevauchement avec un trip → refus ; suppression d'un blocage → créneau libéré.
- **Règles métier** : BR-BOOK-07.
- **États** : —
- **Erreurs** : `VEHICLE_UNAVAILABLE`, `FORBIDDEN_LOCATION`.
- **Données** : vehicle_occupancy (HOST_BLOCK : reason, created_by).
- **Notifications** : —
- **Permissions** : `AGENCY_MANAGER` (tous lieux), `AGENCY_COUNTER_AGENT` (lecture de ses lieux).
- **Dépendances** : CAL-001 → HST-026, CAL-011, FLT-003 ; CAL-002 → CAL-001.
- **Critères d'acceptation** : Given un trip confirmé, When le calendrier est rouvert, Then il apparaît en ≤ 5 s. Given un blocage chevauchant un trip, When il est créé, Then refus. Given un blocage du 10 au 12, When un guest cherche le 11, Then le véhicule est absent.
- **Source** : SRC_H H23 ; écrans 10b : A06.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : CAL-001 SIMPLIFIÉ — liste des occupations par véhicule, sans vue mois/semaine ; CAL-002 SIMPLIFIÉ — blocage par jour seulement.
- **Complexité** : moyenne / faible ; ops faible ; risque faible.
- **Améliorations possibles** : calendrier multi-véhicules et actions en masse (FLT-004/005, P1).

#### Fiche CAL-003 / CAL-004 — Préavis minimum et tampon entre trips
- **FEATURE ID** : CAL-003, CAL-004
- **Nom** : Préavis minimum par lieu (CAL-003) ; tampon entre trips (CAL-004)
- **Module** : Disponibilité & flotte (CAL — Règles)
- **Persona** : PER-03
- **Objectif** : laisser à l'agence le temps de préparer le véhicule.
- **Description** : CAL-003 : délai minimal entre réservation et début, par lieu (absorbe CAL-005, CAL-006 : horaires et durées min/max) ; défaut 3 h (ADM-031). CAL-004 : heures bloquées après chaque trip (défaut 2 h), aussi pour les extensions, matérialisées en BUFFER dans CAL-011.
- **Déclencheur** : recherche, sélecteur de dates, confirmation.
- **Prérequis** : CAL-001 (CAL-003), CAL-011 (CAL-004).
- **Parcours principal** : paramètre lieu/véhicule ou défaut → filtrage des créneaux.
- **Parcours alternatifs** : retour en retard → tampon décalé ; conflit avec le trip suivant → alerte ops (EC-19).
- **Règles métier** : BR-BOOK-04, BR-BOOK-05, BR-BOOK-06.
- **États** : —
- **Erreurs** : `DATES_NOTICE_TOO_SHORT`.
- **Données** : location.notice_minutes, location.buffer_minutes, min/max duration.
- **Notifications** : —
- **Permissions** : `AGENCY_MANAGER` ; défauts `ADMIN`.
- **Dépendances** : CAL-003 → CAL-001 ; CAL-004 → CAL-011.
- **Critères d'acceptation** : Given un tampon de 2 h et un retour à 12:00, When un guest cherche un départ à 13:00, Then le véhicule est indisponible ; à 14:00, disponible. Given un préavis de 3 h, When un départ dans 2 h 59 est demandé, Then refus.
- **Source** : SRC_H H22 ; écrans 10b : A10.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : CAL-003 MANUEL — préavis global fixé dans les paramètres (ADM-014) ; CAL-004 SIMPLIFIÉ — tampon global.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : préavis aéroport 12 h quand la remise aéroport existera (P1).

#### Fiche CAL-009 — Synchronisation iCal entrante et sortante
- **FEATURE ID** : CAL-009
- **Nom** : Synchronisation iCal entrante et sortante
- **Module** : Disponibilité & flotte (CAL — Synchronisation)
- **Persona** : PER-03
- **Objectif** : éviter les doubles réservations avec les autres canaux de l'agence.
- **Description** : import : URL iCal par véhicule lue toutes les 15 min ; chaque VEVENT → blocage `source=ical` dans CAL-011. Conflit avec un trip confirmé : le trip reste prioritaire, l'événement est marqué en conflit, alerte agence + ops. Export : URL secrète par véhicule (trips et holds, sans données personnelles). 3 échecs consécutifs → alerte.
- **Déclencheur** : tâche planifiée ; configuration par l'agence.
- **Prérequis** : CAL-011.
- **Parcours principal** : lecture → diff → upsert des blocages → suppression des événements disparus.
- **Parcours alternatifs** : flux invalide → alerte ; conflit → alerte et résolution hors plateforme.
- **Règles métier** : BR-BOOK-07, BR-BOOK-10.
- **États** : ical_feed `OK` / `FAILING` / `DISABLED`.
- **Erreurs** : `ICAL_URL_INVALID`, `ICAL_FETCH_FAILED`.
- **Données** : ical_feed(vehicle_id, url_encrypted, last_ok_at, failures), ical_event(uid, range, conflict).
- **Notifications** : `EVT_ICAL_CONFLICT`, `EVT_ICAL_FAILING` (agence + ops).
- **Permissions** : `AGENCY_MANAGER`.
- **Dépendances** : CAL-011.
- **Critères d'acceptation** : Given un événement ajouté chez l'agence à 10:00, When 15 min passent, Then le créneau n'est plus réservable. Given un événement chevauchant un trip confirmé, When il est importé, Then le trip est conservé et une alerte part. Given l'URL d'export, When on la lit, Then aucun nom ni téléphone n'apparaît.
- **Source** : SRC_H §8 (export) ; 08 BR-BOOK-07 reco (import) ; écrans 10b : A06.
- **Confiance** : documenté (export) ; import proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — l'agence bloque elle-même (CAL-002) les dates vendues ailleurs ; engagement écrit.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : API et connecteurs (FLT-018, P1).

#### Fiche FLT-001 / FLT-003 — Équipes de l'agence et rôles
- **FEATURE ID** : FLT-001, FLT-003
- **Nom** : Équipes d'hébergement et invitation (FLT-001) ; rôles fins RBAC pour flottes (FLT-003)
- **Module** : Disponibilité & flotte (FLT — Équipes)
- **Persona** : PER-03, PER-04
- **Objectif** : donner à chaque employé de l'agence l'accès strictement nécessaire.
- **Description** : FLT-001 : invitation d'employés (valable 30 j) avec compte vérifié ; l'agence (titulaire) reste responsable, factures à son nom. FLT-003 : rôles gérant (`AGENCY_MANAGER`), agent de remise (`AGENCY_COUNTER_AGENT`, limité à ses lieux), comptable (`AGENCY_ACCOUNTANT`) ; déclaration de sinistre par un gérant.
- **Déclencheur** : gestion de l'équipe.
- **Prérequis** : ACC-029.
- **Parcours principal** : invitation → acceptation → attribution du rôle et des lieux.
- **Parcours alternatifs** : invitation expirée → renvoi ; départ d'un employé → révocation immédiate des sessions.
- **Règles métier** : BR-COHOST-01, BR-COHOST-02.
- **États** : membership `INVITED` → `ACTIVE` → `REVOKED`.
- **Erreurs** : `INVITE_EXPIRED`, `FORBIDDEN`.
- **Données** : membership(org_id, user_id, role, location_scope, vehicle_scope, status, invite_expires_at).
- **Notifications** : `EVT_TEAM_INVITE`.
- **Permissions** : `AGENCY_MANAGER` gère l'équipe.
- **Dépendances** : FLT-001 → ACC-029 ; FLT-003 → FLT-001.
- **Critères d'acceptation** : Given un agent limité au lieu A, When il ouvre la liste des trips, Then il ne voit que le lieu A (HDB-002). Given une révocation, When l'ex-employé rappelle l'API, Then 403.
- **Source** : SRC_H §8 ; TOS-HOST ; 08 BR-COHOST-02 reco ; écrans 10b : A13.
- **Confiance** : documenté (équipes) ; rôles fins proposés.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL (les deux) — comptes des employés créés par l'ops ; un seul rôle agence.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : SSO de l'agence (P2).

## E4 — Réservation, contrat et checkout (P0-A, 13 lignes)

#### Fiche BKG-001 / BKG-006 — Checkout une page et détail du sous-total
- **FEATURE ID** : BKG-001, BKG-006
- **Nom** : Checkout sur une seule page (BKG-001) ; résumé et détail du sous-total (BKG-006)
- **Module** : Réservation & contrat (BKG — Checkout)
- **Persona** : PER-01, PER-02
- **Objectif** : réserver en une page, avec un prix détaillé et vérifiable.
- **Description** : BKG-001 (absorbe LST-023) : récapitulatif véhicule/dates/lieu, conducteur (BKG-002), protection (en P0 : bloc police flotte, LST-013), Extras (P1), tarif, résumé, paiement, CTA collant « Pagar US$ … ». BKG-006 : sous-total cliquable → lignes loyer × jours facturables, ITBMS par ligne, distance incluse, caution déclarée (non encaissée en P0-A), total TTC. Achat instantané (pas de demande à l'agence).
- **Déclencheur** : « Reservar » sur la fiche.
- **Prérequis** : PRC-025 ; BKG-002 ; compte vérifié (BKG-012).
- **Parcours principal** : 1) devis figé (version) ; 2) conducteur ; 3) contrôles BKG-012 ; 4) acceptations BKG-008/BKG-023/BKG-025 ; 5) hold (BKG-014) ; 6) paiement sur le compte PSP de l'agence (PAY-033) ; 7) confirmation (BKG-022).
- **Parcours alternatifs** : non connecté → inscription puis retour au checkout avec les mêmes dates ; prix modifié depuis la fiche → bandeau « le prix a changé » et nouvelle acceptation ; contrôle bloquant → message et code (BKG-012).
- **Règles métier** : BR-BOOK-01 (Book Instantly), BR-PRICE-13, BR-PRICE-12, BR-PRICE-14, BR-BOOK-08 (un guest, un véhicule à la fois).
- **États** : SM-1 `QUOTE` → `HOLD` → `BOOKED`.
- **Erreurs** : `QUOTE_EXPIRED`, `QUOTE_CHANGED`, codes de BKG-012, `HOLD_EXPIRED`.
- **Données** : quote(version figée), booking_draft(user_id, vehicle_id, quote_id, driver).
- **Notifications** : aucune avant confirmation.
- **Permissions** : `GUEST` vérifié.
- **Dépendances** : BKG-001 → PRC-025, BKG-002 ; BKG-006 → PRC-025.
- **Critères d'acceptation** : Given le trip PA1, When le détail est ouvert, Then loyer 120,00 + ITBMS 8,40 = 128,40 et la somme des lignes égale le total au cent près (TA01, I18N-004). Given un devis plus ancien que sa durée de validité (PROPOSÉ 30 min), When le guest paie, Then `QUOTE_EXPIRED` et nouveau devis. Given un guest avec un trip en cours qui chevauche, When il réserve, Then refus (BR-BOOK-08).
- **Source** : 05 G-BOOK-01, G-BOOK-02 ; EV-0007 ; écrans 10b : S05.
- **Confiance** : confirmé (OBSERVÉ sans soumission).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : BKG-001 SIMPLIFIÉ — checkout sans Extras ni protection, paiement par redirection vers le lien du PSP ; BKG-006 SIMPLIFIÉ — détail loyer, ITBMS, total.
- **Complexité** : moyenne / faible ; ops faible ; risque faible.
- **Améliorations possibles** : Extras (BKG-003, P1) ; réservation pour un conducteur additionnel (P1).

#### Fiche BKG-002 / BKG-025 — Conducteur principal et aptitude boîte manuelle
- **FEATURE ID** : BKG-002, BKG-025
- **Nom** : Formulaire du conducteur principal (BKG-002) ; confirmation d'aptitude boîte manuelle (BKG-025)
- **Module** : Réservation & contrat (BKG — Checkout)
- **Persona** : PER-01, PER-02
- **Objectif** : identifier le conducteur et sécuriser les véhicules à boîte manuelle.
- **Description** : BKG-002 : prénom/nom du permis (pré-remplis depuis le compte), indicatif + mobile, email, tranche d'âge (18 → 55+). BKG-025 (absorbe ACC-020) : case obligatoire « sé conducir un vehículo manual » pour un véhicule manuel.
- **Déclencheur** : checkout.
- **Prérequis** : compte avec nom légal (ACC-006).
- **Parcours principal** : pré-remplissage → validation → (manuel : case) → suite.
- **Parcours alternatifs** : conducteur différent du titulaire du compte → refus en P0 (seul le titulaire conduit ; conducteur additionnel en P1).
- **Règles métier** : BR-ACC-02, BR-ACC-04 (âge minimum par classe), BR-ACC-08 (boîte manuelle), BR-PICKUP-07.
- **États** : —
- **Erreurs** : `DRIVER_MUST_BE_ACCOUNT_HOLDER`, `MANUAL_TRANSMISSION_NOT_CONFIRMED`.
- **Données** : booking.driver_snapshot(name, phone, email, age_band), booking.manual_confirmed_at.
- **Notifications** : —
- **Permissions** : `GUEST`.
- **Dépendances** : aucune dans 04 (BKG-012 dépend de BKG-025).
- **Critères d'acceptation** : Given un véhicule manuel, When la case n'est pas cochée, Then `MANUAL_TRANSMISSION_NOT_CONFIRMED`. Given un nom de conducteur différent du nom légal du compte, When le guest continue, Then `DRIVER_MUST_BE_ACCOUNT_HOLDER`.
- **Source** : 05 G-BOOK-01 ; EV-0007 (relevé sans soumission) ; 08 BR-ACC-08 reco ; écrans 10b : S05.
- **Confiance** : confirmé (BKG-002 OBSERVÉ) ; BKG-025 proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI (les deux).
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : conducteurs additionnels (BR-VERIF-08, P1).

#### Fiche BKG-008 / BKG-023 — Acceptation des conditions et clauses géographiques
- **FEATURE ID** : BKG-008, BKG-023
- **Nom** : Acceptation du montant et des conditions (BKG-008) ; clauses géographiques au checkout (BKG-023)
- **Module** : Réservation & contrat (BKG — Checkout)
- **Persona** : PER-01, PER-02
- **Objectif** : consentement éclairé et traçable avant paiement.
- **Description** : BKG-008 : case « Acepto pagar el total, los Términos, la política de cancelación y la privacidad » ; versions enregistrées (LEG-002). BKG-023 (absorbe LST-027) : rappel de l'interdiction de sortir du territoire (Costa Rica, EC-46) et des zones/routes exclues (ex. Darién, routes non revêtues, EC-53) avant paiement, repris au contrat.
- **Déclencheur** : checkout.
- **Prérequis** : LEG-002 ; BKG-001.
- **Parcours principal** : affichage → cases → enregistrement consent(type=CHECKOUT_TERMS, version) avec le quote_id.
- **Parcours alternatifs** : case non cochée → paiement impossible.
- **Règles métier** : BR-BOOK-12, BR-GEO-01, BR-GEO-02, BR-ACC-01.
- **États** : —
- **Erreurs** : `TERMS_NOT_ACCEPTED`.
- **Données** : consent(…, context=checkout, quote_id).
- **Notifications** : —
- **Permissions** : `GUEST`.
- **Dépendances** : BKG-008 → LEG-002 ; BKG-023 → BKG-001.
- **Critères d'acceptation** : Given un checkout, When la case n'est pas cochée, Then le bouton de paiement est inactif et l'API renvoie `TERMS_NOT_ACCEPTED`. Given un trip confirmé, When on consulte ses consentements, Then on retrouve la version exacte des CGU, de la politique d'annulation et du texte géographique.
- **Source** : 05 G-BOOK-01 ; 11 EC-45, EC-46, EC-53 ; écrans 10b : S05.
- **Confiance** : confirmé (BKG-008 OBSERVÉ) ; BKG-023 proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : BKG-008 OUI ; BKG-023 SIMPLIFIÉ — texte fixe au checkout.
- **Complexité** : faible ; ops faible ; risque moyen / faible.
- **Améliorations possibles** : géofencing défini par véhicule (TRP-054, P2).

#### Fiche BKG-012 — Contrôles bloquants à la réservation
- **FEATURE ID** : BKG-012
- **Nom** : Contrôles bloquants à la réservation
- **Module** : Réservation & contrat (BKG — Contrôles)
- **Persona** : PER-07 ; effets PER-01/02
- **Objectif** : empêcher toute réservation non conforme avant le paiement.
- **Description** : contrôles avec codes stables : KYC non approuvé ; âge minimum selon la classe (À DÉCIDER, défaut 21/25 ans, ADM-031 ; absorbe VER-025 et SRC-026) ; boîte manuelle non confirmée (BKG-025) ; réservation en revue (ADM-029) ; compte restreint (ADM-005) ; véhicule restreint ; chevauchement ; agence suspendue (impayé de commission, FIN-018).
- **Déclencheur** : avant création du hold.
- **Prérequis** : ADM-005, ADM-029, BKG-025, ADM-031.
- **Parcours principal** : évaluation séquentielle → tous OK → hold.
- **Parcours alternatifs** : règle de risque → réservation « en revue » (ADM-029) ; **UXQ-08 ouverte** : sans lien de paiement jusqu'à la décision de l'ops (option 10b, véhicule bloqué, délai 2 h ouvrées) ou paiement puis revue avec remboursement intégral si refus ; refus → motif compréhensible + code (consolidé VERIF_15-F2(ii)).
- **Règles métier** : BR-BOOK-11, BR-ACC-04, BR-ACC-10, BR-VERIF-09.
- **États** : SM-1 `QUOTE` (refus) ; SM-1b `PENDING` (revue).
- **Erreurs** : `ACCOUNT_NOT_APPROVED`, `AGE_CLASS_MISMATCH`, `MANUAL_TRANSMISSION_NOT_CONFIRMED`, `BOOKING_UNDER_REVIEW`, `ACCOUNT_RESTRICTED`, `VEHICLE_RESTRICTED`, `GUEST_OVERLAP`, `ORGANIZATION_SUSPENDED` (codes de 08 BR-BOOK-11 quand ils existent ; consolidé VERIF_15-F9).
- **Données** : booking_check_log(quote_id, check, result, at).
- **Notifications** : —
- **Permissions** : `SYSTEM`.
- **Dépendances** : ADM-005 ; ADM-029 ; BKG-025 ; ADM-031.
- **Critères d'acceptation** : Given âge minimum 25 ans pour la classe Premium et un guest de 24 ans, When il réserve, Then `AGE_CLASS_MISMATCH`. Given chaque contrôle, When il échoue, Then un code stable et un message es/en sont renvoyés. Given les valeurs ADM-031 non décidées, When le lot 2 démarre, Then le déploiement est bloqué (jalon J-ADM-031).
- **Source** : 08 BR-BOOK-11 ; écrans 10b : S04, S05.
- **Confiance** : documenté (base) ; codes et valeurs proposés.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — contrôles KYC vérifié, âge minimum et boîte manuelle seulement.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : moteur de règles configurable (ADM-011, P1).

#### Fiche BKG-016 — Lieux de prise et de retour
- **FEATURE ID** : BKG-016
- **Nom** : Lieux de prise et de retour
- **Module** : Réservation & contrat (BKG — Lieux)
- **Persona** : PER-01, PER-02, PER-03
- **Objectif** : fixer où le véhicule est remis et rendu.
- **Description** : lieux = comptoirs de l'agence ; retour au même lieu par défaut ; one-way interdit (ex-BKG-017) ; livraison et POI en P1 (HST-034).
- **Déclencheur** : checkout (choix si plusieurs comptoirs).
- **Prérequis** : HST-011.
- **Parcours principal** : lieu du véhicule pré-sélectionné → retour identique.
- **Parcours alternatifs** : agence à plusieurs comptoirs → choix parmi ceux où le véhicule est rattaché.
- **Règles métier** : BR-BOOK-09.
- **États** : —
- **Erreurs** : `ONE_WAY_NOT_ALLOWED`.
- **Données** : booking.pickup_location_id, return_location_id (= pickup en P0).
- **Notifications** : —
- **Permissions** : `GUEST`.
- **Dépendances** : HST-011.
- **Critères d'acceptation** : Given une demande avec retour différent, When elle est soumise, Then `ONE_WAY_NOT_ALLOWED`.
- **Source** : 05 G-BOOK ; SRC_G 2.3.1 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : confirmé (OBSERVÉ) ; restriction P0 proposée.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : DIFFÉRÉ — un comptoir par agence, lieu porté par le véhicule.
- **Complexité** : moyenne ; ops moyen ; risque faible.
- **Améliorations possibles** : livraison (HST-034), aéroport (BKG-041), one-way (P1).

#### Fiche BKG-018 — Contrat de location par trip
- **FEATURE ID** : BKG-018
- **Nom** : Contrat de location par trip
- **Module** : Réservation & contrat (BKG — Contrat)
- **Persona** : PER-01, PER-02, PER-03
- **Objectif** : contrat opposable entre l'agence (loueur) et le conducteur ; autorisation de conduite aux contrôles.
- **Description** : PDF en espagnol (anglais de courtoisie), parties (agence, RUC ; conducteur), véhicule, période, lieu, prix TTC, caution, moyens et liste « couvre / ne couvre pas » (PAY-035, consolidé VERIF_15-F2(i)), franchise et police flotte (PRT-019, texte de LST-013), règles de conduite et frais de l'agence (non-fumeur, propreté, carburant, tout-terrain ; ex-LST-021), interdiction de sortie du territoire ; mention que la plateforme n'est pas partie (LEG-014). Régénéré à chaque modification ; versionné.
- **Déclencheur** : passage `BOOKED` ; modification par l'ops.
- **Prérequis** : LEG-011, PRT-019, PAY-035, LEG-014, LEG-002 ; modèle de contrat validé par l'avocat (OQ-BR-24).
- **Parcours principal** : génération → stockage immuable (empreinte) → envoi avec la confirmation → signature (BKG-019) avant check-in.
- **Parcours alternatifs** : modification (annulation + nouvelle réservation en bêta) → nouvelle version, l'ancienne conservée.
- **Règles métier** : BR-BOOK-12, BR-GEO-02, BR-FUEL-01, BR-CSP-02, BR-RETURN-03 (grille de retard affichée), BR-TT-03.
- **États** : contract `GENERATED` → `SIGNED` → `SUPERSEDED`.
- **Erreurs** : `CONTRACT_GENERATION_FAILED` (bloque la confirmation, alerte ops).
- **Données** : generated_document(trip_id, kind, version, lang, template_version, pdf_file_id, sha256, created_at).
- **Notifications** : pièce jointe de `EVT_BOOKING_CONFIRMED`.
- **Permissions** : `GUEST` du trip, `AGENCY_*` de l'agence, `OPS_AGENT`.
- **Dépendances** : LEG-011 ; PRT-019 ; PAY-035 ; LEG-014 ; LEG-002.
- **Critères d'acceptation** : Given un trip BOOKED, When le contrat est généré, Then il contient raison sociale + RUC, n° de police masqué, franchise, caution, grille de retard et interdiction de sortie, identiques à la fiche et au devis. Given une seconde génération, When elle a lieu, Then une nouvelle version est créée et l'ancienne reste consultable. Given un contrat non signé, When l'agent tente le check-in, Then refus.
- **Source** : SRC_G 10.2 ; écrans 10b : S07, S09.
- **Confiance** : documenté (contrat par trip chez Turo) ; adaptation loueur proposée.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : contrat consultable hors ligne (15 IMP-35, P1).

#### Fiche BKG-019 — Signature électronique horodatée du contrat
- **FEATURE ID** : BKG-019
- **Nom** : Signature électronique horodatée du contrat
- **Module** : Réservation & contrat (BKG — Contrat)
- **Persona** : PER-01, PER-02, PER-03 (contrat-cadre)
- **Objectif** : acceptation électronique conforme (Ley 51/2008).
- **Description** : acceptation explicite (case + bouton), horodatage serveur, IP, user-agent, empreinte SHA-256 du PDF signé ; utilisée aussi pour le contrat-cadre (LEG-025).
- **Déclencheur** : après confirmation ; au plus tard au check-in (sur l'appareil du comptoir si besoin).
- **Prérequis** : BKG-018.
- **Parcours principal** : affichage du PDF → acceptation → enregistrement signature → contrat `SIGNED`.
- **Parcours alternatifs** : refus de signer → pas de check-in, traitement no-show / annulation selon le motif (BR-CXL-08).
- **Règles métier** : BR-BOOK-12.
- **États** : contract `GENERATED` → `SIGNED`.
- **Erreurs** : `CONTRACT_HASH_MISMATCH`, `CONTRACT_NOT_SIGNED`.
- **Données** : signature(contract_id, version, user_id, signed_at, ip, ua, sha256).
- **Notifications** : `EVT_CONTRACT_SIGNED` (copie par email).
- **Permissions** : `GUEST` du trip ; représentant légal pour le contrat-cadre.
- **Dépendances** : BKG-018.
- **Critères d'acceptation** : Given un PDF modifié après signature, When on recalcule l'empreinte, Then `CONTRACT_HASH_MISMATCH`. Given une signature, When le dossier CLM-034 est exporté, Then horodatage, IP et empreinte y figurent.
- **Source** : 08 BR-BOOK-12 reco ; écrans 10b : S05.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — acceptation horodatée avec empreinte (case + horodatage serveur), sans prestataire de signature.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : prestataire de signature qualifiée si l'avocat l'exige.

#### Fiche BKG-022 — Écran et notification de confirmation
- **FEATURE ID** : BKG-022
- **Nom** : Écran et notification de confirmation
- **Module** : Réservation & contrat (BKG — Confirmation)
- **Persona** : PER-01, PER-02, PER-03
- **Objectif** : confirmer sans ambiguïté la réservation aux deux parties.
- **Description** : écran « ¡Reserva confirmada! » avec n° de réservation, véhicule, dates, lieu exact, pièces à présenter, caution exigée, liens contrat et constancia ; notification NTF-007.
- **Déclencheur** : SM-1 → `BOOKED` (après preuve de paiement PAY-034).
- **Prérequis** : NTF-007.
- **Parcours principal** : webhook confirmé → `BOOKED` → écran (si le guest est revenu de la page PSP) + notifications.
- **Parcours alternatifs** : retour du PSP avant le webhook → écran « paiement en cours de confirmation » rafraîchi automatiquement ; échec → message et hold libéré.
- **Règles métier** : BR-BOOK-01.
- **États** : SM-1 `HOLD` → `BOOKED`.
- **Erreurs** : `PAYMENT_PENDING_CONFIRMATION` (état).
- **Données** : trip.booking_reference.
- **Notifications** : `EVT_BOOKING_CONFIRMED` (guest, agence).
- **Permissions** : `GUEST`, `AGENCY_*`.
- **Dépendances** : NTF-007.
- **Critères d'acceptation** : Given un retour du PSP sans webhook reçu, When l'écran s'affiche, Then « en cours de confirmation » et aucune adresse exacte tant que le trip n'est pas BOOKED. Given le webhook, When il arrive, Then l'écran passe à confirmé sans rechargement manuel.
- **Source** : 08 BR-NOTIF NOTIF-02 ; écrans 10b : S07.
- **Confiance** : inféré.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — écran de confirmation et email (NTF-007).
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : ajout au calendrier du guest (fichier .ics).

#### Fiche BKG-027 — Détail du trip (Manage trip)
- **FEATURE ID** : BKG-027
- **Nom** : Détail du trip (Manage trip)
- **Module** : Réservation & contrat (BKG — Mes trips)
- **Persona** : PER-01, PER-02
- **Objectif** : accès en un point à tout ce qui concerne le trip.
- **Description** : reçu (FIN-002, sans valeur fiscale), contrat, constancia, statut du paiement, lieu et horaires, numéros d'aide (SUP-004), actions « annuler » (BKG-028), « signaler un problème » ; liste « Mes trips » (à venir, passés, annulés). Absorbe BKG-026.
- **Déclencheur** : menu « Mis viajes ».
- **Prérequis** : trip existant.
- **Parcours principal** : liste → détail → téléchargement des documents.
- **Parcours alternatifs** : modification demandée → renvoi vers le support (P1 en libre-service).
- **Règles métier** : BR-MOD-01 (toute modification passe par un parcours unique ; ici le support en P0).
- **États** : affichage de l'état SM-1.
- **Erreurs** : `FORBIDDEN` (trip d'un autre).
- **Données** : lecture trip, documents, payments.
- **Notifications** : —
- **Permissions** : `GUEST` propriétaire du trip.
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given un guest A, When il demande le trip de B, Then 403. Given un trip BOOKED, When il ouvre le détail, Then contrat, constancia et reçu sont téléchargeables.
- **Source** : SRC_G 4.1.4 ; 10.1 ; écrans 10b : S09.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — page du trip : reçu, contrat, constancia ; toute modification passe par le support.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : modifications et extensions en libre-service (TRP-020 à TRP-025, P1).

#### Fiche LEG-026 — Constancia de arrendamiento
- **FEATURE ID** : LEG-026
- **Nom** : Constancia de arrendamiento (PDF bilingue)
- **Module** : Légal, données & localisation (LEG — Contrat ; rattachée à E4)
- **Persona** : PER-01, PER-02, PER-03
- **Objectif** : document court présentable aux contrôles et pour contester une amende imputée au propriétaire.
- **Description** : PDF bilingue : agence (RUC), conducteur(s) (nom, pièce, permis), véhicule (plaque), période exacte, lieu, signature horodatée ; généré à la confirmation, régénéré à chaque modification ; téléchargeable, mis en cache pour consultation hors ligne. Transfert d'amende au conducteur : OQ-BR-19 (P1).
- **Déclencheur** : `BOOKED` ; modification.
- **Prérequis** : BKG-018, BKG-019.
- **Parcours principal** : génération → stockage avec empreinte → lien dans la confirmation et le trip.
- **Parcours alternatifs** : amende reçue après le trip (EC-48) → l'agence télécharge la constancia de la période.
- **Règles métier** : BR-TT-03.
- **États** : document versionné (`GENERATED` → `SUPERSEDED`).
- **Erreurs** : `DOCUMENT_GENERATION_FAILED`.
- **Données** : constancia(trip_id, version, pdf_ref, sha256).
- **Notifications** : jointe à `EVT_BOOKING_CONFIRMED`.
- **Permissions** : `GUEST` du trip, `AGENCY_*`, `OPS_AGENT`.
- **Dépendances** : BKG-018 ; BKG-019.
- **Critères d'acceptation** : Given un trip BOOKED, When la constancia est ouverte, Then plaque, période exacte (fuseau America/Panama) et identité du conducteur sont présentes en es et en. Given une recherche par plaque et date, When l'agence la lance, Then elle obtient la constancia du trip correspondant.
- **Source** : VERIF_07 NEW-05 ; 15 IMP-12 ; 11 EC-48 ; écrans 10b : S07.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI.
- **Complexité** : faible ; ops faible ; risque moyen.
- **Améliorations possibles** : refacturation Panapass/ATTT (CLM-036, P1).

## E5 — Devis, taxes, commission et facturation (P0-A, 10 lignes)

#### Fiche PRC-001 — Prix journalier fixé par l'agence
- **FEATURE ID** : PRC-001
- **Nom** : Prix journalier fixé par l'hôte (agence)
- **Module** : Tarification & devis (PRC — Prix de base)
- **Persona** : PER-03
- **Objectif** : l'agence maîtrise son prix.
- **Description** : prix journalier HT par véhicule (ou catégorie), en unités mineures ; prix du trip = somme des prix journaliers des jours facturables (pas de remises en P0).
- **Déclencheur** : création/édition d'annonce ; import CSV.
- **Prérequis** : HST-005 (ou FLT-011).
- **Parcours principal** : saisie → validation (> 0, plafond de cohérence PROPOSÉ) → prise en compte par les nouveaux devis seulement.
- **Parcours alternatifs** : modification avec trips confirmés → aucun effet sur leur devis figé.
- **Règles métier** : BR-PRICE-01, BR-PRICE-14.
- **États** : —
- **Erreurs** : `PRICE_INVALID`.
- **Données** : vehicle_price(vehicle_id, daily_price_minor, currency, valid_from).
- **Notifications** : —
- **Permissions** : `AGENCY_MANAGER` ; `OPS_AGENT` (import).
- **Dépendances** : HST-005.
- **Critères d'acceptation** : Given un trip confirmé à 40,00/j, When l'agence passe à 50,00, Then le trip garde 40,00 et une nouvelle recherche affiche 50,00.
- **Source** : SRC_H H29 ; 08 BR-PRICE-01 ; écrans 10b : A10.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — prix journalier saisi dans l'import CSV ou par l'ops.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : prix par date, remises de durée, tarification intelligente (PRC-002/003/008, P1–P2).

#### Fiche PRC-021 — Arrondis et montants en unités mineures
- **FEATURE ID** : PRC-021
- **Nom** : Arrondis et montants en unités mineures
- **Module** : Tarification & devis (PRC — Devise)
- **Persona** : technique (toutes les fonctions monétaires)
- **Objectif** : exactitude au cent, aucun résidu perdu.
- **Description** : type `Money{amount_minor, currency}` ; ratios en fractions exactes ; `roundHalfUp` par ligne ; allocation d'un partage au plus proche, égalité → plateforme (allocHost, P0-B) ; PYG sans décimales (phase PY).
- **Déclencheur** : tout calcul monétaire.
- **Prérequis** : aucun.
- **Parcours principal** : bibliothèque monétaire unique, interdite de contournement (revue de code).
- **Parcours alternatifs** : devise inconnue → erreur.
- **Règles métier** : BR-PRICE-14 ; BR-CXL-06 (taxe par ligne).
- **États** : —
- **Erreurs** : `CURRENCY_UNSUPPORTED`, `MONEY_CURRENCY_MISMATCH`.
- **Données** : colonnes `*_minor` entières + `currency`.
- **Notifications** : —
- **Permissions** : —
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given les vecteurs T40, T42, T43 et TA06, When le moteur les rejoue, Then résultats identiques au cent (ou à l'unité PYG) près. Given l'addition de deux devises, When elle est tentée, Then `MONEY_CURRENCY_MISMATCH`.
- **Source** : TOS-GENERAL ; 08 BR-PRICE-14 ; 11 EC-32 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : OUI.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : —

#### Fiche PRC-020 — Moteur de taxes par marché (ITBMS)
- **FEATURE ID** : PRC-020
- **Nom** : Moteur de taxes par marché
- **Module** : Tarification & devis (PRC — Taxes)
- **Persona** : PER-06 ; effet guest
- **Objectif** : afficher et contractualiser un total TTC exact.
- **Description** : ITBMS 7 % (paramètre ADM-014) calculé **ligne par ligne** sur le loyer (et les Extras en P1) ; table versionnée `tax_line_config[pays][type_de_ligne]`. En P0-A, l'ITBMS du loyer est **collecté par l'agence** : la plateforme calcule et affiche seulement. Assiette exacte : OQ-BR-14, OQ-MK-06. Seule la formule Panama est en P0.
- **Déclencheur** : chaque devis.
- **Prérequis** : PRC-021, ADM-014.
- **Parcours principal** : lignes taxables → taxe par ligne roundHalfUp → somme par groupe fiscal.
- **Parcours alternatifs** : changement de taux → nouveau `valid_from`, devis figés inchangés.
- **Règles métier** : BR-PRICE-12, BR-PRICE-14, BR-CXL-06 (prorata de la taxe remboursée).
- **États** : —
- **Erreurs** : `TAX_CONFIG_MISSING` (devis impossible, véhicule exclu).
- **Données** : tax_rate(country, code, rate, valid_from), tax_line_config(version).
- **Notifications** : —
- **Permissions** : `ADMIN` (configuration).
- **Dépendances** : PRC-021 ; ADM-014.
- **Critères d'acceptation** : Given P = 120,00 à 7 %, When le devis est calculé, Then ITBMS 8,40 (TA01). Given deux lignes de 10,05, When la taxe est calculée, Then 0,70 + 0,70 = 1,40 et non 1,41 (T43). Given deux groupes fiscaux, When une annulation est réglée, Then T44 est reproduit.
- **Source** : 05 G-BOOK-02 (formule de Floride vérifiée au centime) ; SRC_G 2.4.9 ; EV-0007 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : confirmé (pour la Floride) ; formule Panama proposée.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — ITBMS 7 % sur le loyer seulement.
- **Complexité** : moyenne ; ops faible ; risque élevé.
- **Améliorations possibles** : — (IVA 10 % du Paraguay : valeurs `tax_line_config` PY dès le départ, DEC-FONDATEUR-04, OQ-BR-14).

#### Fiche PRC-025 — Moteur de devis versionné
- **FEATURE ID** : PRC-025
- **Nom** : Moteur de devis versionné
- **Module** : Tarification & devis (PRC — Moteur)
- **Persona** : technique ; effet tous
- **Objectif** : un seul calcul pour l'affichage, le contrat, les remboursements et la commission.
- **Description** : prix journaliers × jours facturables (règle actuelle de 04 : max(1, ceil((fin − début − 29 min)/24 h)), ex-BKG-021 ; **paramètre `grace_minutes`, OQ-BR-04 ouverte**), remises (P1), Extras (P1), distance incluse, ITBMS (PRC-020), caution déclarée (affichée, non encaissée en P0-A) ; une version figée par réservation et par modification ; fonction pure rejouable.
- **Déclencheur** : recherche (provisoire), checkout (figé), modification, annulation.
- **Prérequis** : PRC-001, PRC-020, PRC-021.
- **Parcours principal** : entrées (véhicule, dates, paramètres datés) → lignes → total → version figée liée au trip.
- **Parcours alternatifs** : paramètre manquant → `QUOTE_UNAVAILABLE` ; modification → nouvelle version, la précédente conservée.
- **Règles métier** : BR-PRICE-13, BR-MOD-06, BR-BOOK-03, BR-PRICE-17, BR-CXL (règlement : `computeCancellationSettlement`).
- **États** : quote `PROVISIONAL` → `FROZEN` → `SUPERSEDED`.
- **Erreurs** : `QUOTE_UNAVAILABLE`, `QUOTE_EXPIRED`.
- **Données** : quote(id, trip_id, version, inputs_snapshot, params_snapshot, lines[], total_minor, frozen_at).
- **Notifications** : —
- **Permissions** : `SYSTEM`.
- **Dépendances** : PRC-001 ; PRC-020 ; PRC-021.
- **Critères d'acceptation** : Given un devis figé, When il est rejoué avec ses entrées et paramètres, Then le total est identique au cent. Given TA07, When les jours facturables sont calculés, Then 3, 4 et 1. Given T01–T27 et TA01–TA06, When le règlement est calculé à partir du devis figé, Then les remboursements et taxes attendus sont obtenus.
- **Source** : 09 §3 (formule de référence) ; 08 BR-MOD-06 reco ; écrans 10b : S03, S05.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — devis versionné sans remises ni Extras.
- **Complexité** : élevée ; ops faible ; risque moyen.
- **Améliorations possibles** : remises, non remboursable, jeune conducteur (P1).

#### Fiche FIN-001 — Grand livre en partie double
- **FEATURE ID** : FIN-001
- **Nom** : Grand livre en partie double
- **Module** : Finance & facturation (FIN — Comptabilité)
- **Persona** : PER-06
- **Objectif** : comptabiliser sans perte les créances de commission (P0-A) puis les fonds de tiers (P0-B).
- **Description** : plan P0-A : commission à recevoir par agence, produit de commission, ITBMS sur commission si applicable (OQ-MK-06), pénalités dues par l'agence, crédits accordés, encaissements de commission ; comptes d'ordre pour le GMV encaissé par les agences (hors bilan). Écritures : trip terminé → commission due ; annulation → commission sur la part conservée ; facture → créance ; paiement → lettrage. P0-B ajoute fonds de tiers, cautions, PSP à recevoir, dettes envers les agences. Écritures immuables (correction par extourne), montants en unités mineures.
- **Déclencheur** : événements de trip, facture, paiement.
- **Prérequis** : aucun.
- **Parcours principal** : événement → écriture équilibrée idempotente (clé = événement + version).
- **Parcours alternatifs** : requalification d'un trip (SM-7) → contre-passation puis nouvelle écriture (T36 en logique).
- **Règles métier** : BR-PAYOUT-04, BR-PRICE-14 ; 08 « Exécution monétaire » E4.
- **États** : —
- **Erreurs** : `LEDGER_UNBALANCED` (transaction rejetée), `LEDGER_DUPLICATE_EVENT` (idempotent, ignoré).
- **Données** : ledger_entry(id, txn_id, account, debit_minor, credit_minor, currency, event_ref, created_at).
- **Notifications** : —
- **Permissions** : `FINANCE` (lecture), `SYSTEM` (écriture).
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given toute transaction, When elle est écrite, Then Σ débits = Σ crédits (test automatique). Given TA08, When le mois est clôturé, Then commission à recevoir = 34,20. Given un rejeu d'événement, When il arrive, Then aucune écriture en double.
- **Source** : 08 BR-PAYOUT-04 reco ; écrans 10b : A08.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : MANUEL — pas de grand livre : commission calculée par FIN-018 et tenue par le comptable.
- **Complexité** : élevée ; ops moyen ; risque moyen.
- **Améliorations possibles** : export comptable (P1).

#### Fiche FIN-002 / FIN-003 — Facturation électronique : port fiscal PAC (Panama) et SIFEN (Paraguay)
- **FEATURE ID** : FIN-002, FIN-003
- **Nom** : Facturation électronique PAC (Panama) (FIN-002) ; facturation électronique SIFEN (Paraguay) (FIN-003)
- **Module** : Finance & facturation (FIN — Fiscalité)
- **Persona** : PER-06 ; PER-03
- **Objectif** : facture fiscale de la commission ; aide à la facture du loyer par l'agence.
- **Description** : connecteur PAC pour la facture de commission si l'entité qui facture est panaméenne (OQ-MK-06, OQ-BR-14), sinon facture de l'entité étrangère. En P0-A, la plateforme **n'émet pas** la facture du loyer : export par trip (lignes, ITBMS, client) compatible avec le PAC de l'agence. Reçu détaillé pour le guest (ex-PAY-029) **sans valeur fiscale**. Facturation pour compte (mandat) : P1. FIN-003 (promue P0-A par la passe VERIF_18, DEC-FONDATEUR-04) : même port fiscal pour la facture SIFEN (DNIT) de la commission d'une agence paraguayenne, en PYG avec IVA 10 %. Les deux sont construits au lot 2 contre un adaptateur `FAKE` (DEC-FONDATEUR-03) ; le connecteur réel du pays de lancement est livré au lot C (FIN-020, E18).
- **Déclencheur** : facture mensuelle (FIN-018) ; trip terminé (export).
- **Prérequis** : FIN-001 ; choix de l'entité qui facture.
- **Parcours principal** : facture → PAC → CUFE/numéro → PDF.
- **Parcours alternatifs** : PAC indisponible → file de réessai, facture non envoyée avant validation.
- **Règles métier** : BR-PRICE-12, BR-PAYOUT-05.
- **États** : invoice `DRAFT` → `ISSUED` → `PAID` / `CREDITED`.
- **Erreurs** : `PAC_REJECTED`, `PAC_UNAVAILABLE` (mêmes codes pour l'autorité SIFEN).
- **Données** : fiscal_document(id, customer_id (organisation), kind, period, subtotal_minor, tax_minor, total_minor, authority_ref, status).
- **Notifications** : `EVT_COMMISSION_INVOICE_ISSUED`.
- **Permissions** : `FINANCE`.
- **Dépendances** : FIN-001.
- **Critères d'acceptation** : Given un rejet PAC, When il survient, Then la facture reste `DRAFT` avec le motif. Given un trip terminé, When l'agence demande l'export, Then lignes et ITBMS égalent le devis figé. Given une agence paraguayenne, When sa facture de commission est émise par l'adaptateur `FAKE`, Then elle est en PYG sans décimale avec IVA 10 % et aucun code propre au pays n'existe hors adaptateur.
- **Source** : 08 BR-PRICE-12 reco ; 12 §3.6 ; 13 (SIFEN) ; écrans 10b : A08.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : MANUEL (les deux) — facture de commission émise par le comptable dans son outil (PAC) ou sur le portail de la DNIT (SIFEN) selon le pays du pilote.
- **Complexité** : élevée ; ops moyen ; risque élevé.
- **Améliorations possibles** : facture pour le compte de l'agence (P1).

#### Fiche FIN-018 / PYO-013 — Facturation de la commission et relevé mensuel
- **FEATURE ID** : FIN-018, PYO-013
- **Nom** : Facturation de la commission aux agences (FIN-018) ; relevé mensuel et facture de commission (PYO-013)
- **Module** : Finance & facturation (FIN — Commission ; PYO — Documents)
- **Persona** : PER-06, PER-03
- **Objectif** : seul revenu du P0-A.
- **Description** : taux par agence (défaut 12 %, fourchette 10–20 %, OQ-MK-07) sur le loyer HT des trips terminés du mois ; annulation : commission sur la part conservée par l'agence ; pénalités d'annulation agence (BKG-032) et avoirs (ADM-007) en lignes séparées. PYO-013 : relevé (trips terminés et annulés, loyer HT, commission, pénalités, crédits, total ; gains par trip, ex-PYO-010). Facture (FIN-002). Échéance 15 j, relance J+7, **suspension des nouvelles réservations** de l'agence à J+30 d'impayé. Paiement par virement ou lien.
- **Déclencheur** : clôture mensuelle (J+1 du mois suivant, PROPOSÉ), après rapprochement FIN-019.
- **Prérequis** : FIN-001, PAY-033, FIN-002, FIN-019 (rapprochement de la période).
- **Parcours principal** : clôture → relevé → contrôle finance → facture → envoi → paiement → lettrage.
- **Parcours alternatifs** : contestation de l'agence → avoir ; impayé → relance J+7, suspension J+30 (BKG-012 `ORGANIZATION_SUSPENDED`), levée au paiement.
- **Règles métier** : BR-PAYOUT-05, BR-PRICE-12, BR-CXL-13 (pénalités), BR-PRICE-14.
- **États** : invoice `DRAFT` → `ISSUED` → `OVERDUE` → `PAID` / `CREDITED` ; société `ACTIVE` ↔ `SUSPENDED`.
- **Erreurs** : `STATEMENT_NOT_RECONCILED`, `INVOICE_WITHOUT_STATEMENT`.
- **Données** : commission_line(trip_id, base_minor, rate, amount_minor), commission_statement(org_id, period_month, rent_ht_minor, commission_minor, penalties_minor, credits_minor, total_due_minor, status).
- **Notifications** : `EVT_COMMISSION_STATEMENT_ISSUED`, `EVT_COMMISSION_INVOICE_ISSUED`, `EVT_INVOICE_REMINDER`, `EVT_ORGANIZATION_SUSPENDED`.
- **Permissions** : `FINANCE` (émission), `AGENCY_MANAGER` / `AGENCY_ACCOUNTANT` (lecture).
- **Dépendances** : FIN-018 → FIN-001, PAY-033, FIN-002 ; PYO-013 → FIN-018.
- **Critères d'acceptation** : Given TA08, When le relevé est produit, Then 34,20 et une ligne par trip arrondie. Given TA02, When l'annulation est dans le mois, Then commission 4,80 sur 40,00. Given aucune facture sans relevé, When la finance tente d'émettre, Then `INVOICE_WITHOUT_STATEMENT`. Given 30 j d'impayé, When la tâche s'exécute, Then l'agence est suspendue pour les nouvelles réservations et ses trips confirmés sont maintenus.
- **Source** : VERIF_07 NEW-02 ; 12 §9.12, §10.3 ; 09b §5.1 ; 08 BR-PAYOUT-05 reco ; écrans 10b : A08.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : FIN-018 SIMPLIFIÉ — relevé et montant calculés par la plateforme, facture émise hors plateforme par le comptable ; PYO-013 MANUEL — relevé produit par export du journal des commissions dans un tableur.
- **Complexité** : moyenne ; ops moyen / faible ; risque élevé / moyen.
- **Améliorations possibles** : split de commission à la source (PAY-038, P0-B).

#### Fiche FIN-019 — Rapprochement léger des revenus
- **FEATURE ID** : FIN-019
- **Nom** : Rapprochement léger des revenus (commission vs encaissements de l'agence)
- **Module** : Finance & facturation (FIN — Rapprochement)
- **Persona** : PER-06
- **Objectif** : détecter le contournement et sécuriser la seule recette du P0-A.
- **Description** : chaque mois, avant FIN-018 : import du relevé de transactions du compte PSP de l'agence (CSV fourni ou lecture API en lecture seule si PSP et mandat LEG-027 le permettent) ; rapprochement avec les trips synchronisés : paiements sans trip, trips sans paiement, montants divergents, remboursements non tracés. Indicateur « réservations plateforme vs véhicules listés et jours disponibles » dans ADM-005 ; clause d'audit (LEG-025) ; seuil d'écart ADM-031.
- **Déclencheur** : clôture mensuelle.
- **Prérequis** : FIN-018, PAY-033, ADM-005, ADM-031, LEG-025, LEG-027.
- **Parcours principal** : import → appariement (référence d'ordre, montant, date) → rapport → écarts > seuil → tâche ops.
- **Parcours alternatifs** : relevé non fourni → facture bloquée, relance ; écarts répétés → critère d'arrêt (> 10 % deux mois).
- **Règles métier** : aucune BR (proposé, VERIF_10 V10-06) ; BR-TRUST-02 (marché gris) en contexte.
- **États** : reconciliation `PENDING_STATEMENT` → `MATCHED` / `DISCREPANCIES` → `CLOSED`.
- **Erreurs** : `RECON_STATEMENT_MISSING`, `RECON_FORMAT_INVALID`.
- **Données** : reconciliation_run(psp_account_id, scope, period, source, matched, unmatched_platform, unmatched_psp, delta_pct_bps, threshold_bps, status).
- **Notifications** : `EVT_RECON_DISCREPANCY` (ops, finance).
- **Permissions** : `FINANCE`, `OPS_AGENT`.
- **Dépendances** : FIN-018 ; PAY-033 ; ADM-005 ; ADM-031 ; LEG-025 ; LEG-027.
- **Critères d'acceptation** : Given 10 trips synchronisés et un export PSP de 11 paiements dont un de 128,40 sans trip, When le rapprochement tourne, Then un écart « paiement sans trip » est signalé et une tâche ops ouverte si le seuil est dépassé. Given une période non rapprochée, When la finance émet la facture, Then `STATEMENT_NOT_RECONCILED`.
- **Source** : VERIF_10 V10-06 ; écrans 10b : A08.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — rapprochement mensuel par l'ops : export du relevé PSP comparé aux trips dans un tableur.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : lecture API quotidienne ; FIN-005 en P0-B.

## E6 — Paiements « agence encaisse » et caution chez l'agence (P0-A, 11 lignes)

#### Fiche PAY-001 — Abstraction multi-PSP (PaymentProvider)
- **FEATURE ID** : PAY-001
- **Nom** : Abstraction multi-PSP (PaymentProvider)
- **Module** : Paiements (PAY — Architecture)
- **Persona** : technique ; PER-07
- **Objectif** : changer ou ajouter un PSP sans toucher au code métier ; ne jamais recevoir de fonds en P0-A.
- **Description** : interface `authorize`, `capture`, `void`, `refund`, `createPaymentLink`, `verifyWebhook`, capacités déclarées (`SUPPORTS_PARTIAL_CAPTURE`, `SUPPORTS_REFUND`, `SUPPORTS_3DS`…). En P0-A chaque agence connecte **son** compte marchand (Tilopay en primaire ; BAC/PagueloFacil en secours selon PAY-041) par identifiants API chiffrés ; la plateforme crée les ordres sur le compte de l'agence. En P0-B, comptes de la plateforme. Paiement par page/champs hébergés (SAQ A). Secrets en coffre/KMS isolés par agence ; opérations initiées par la plateforme seulement sous mandat LEG-027. **DEC-FONDATEUR-03** (2026-10-30) : seul un adaptateur fictif / bac à sable (`FAKE`) est construit avant le choix du pays ; il doit couvrir tous les comportements testés (webhook signé, refus reçu, réponse inconnue, ordre Yappy de 300 s, capture partielle présente ou absente, remboursement absent) ; les adaptateurs Tilopay, Yappy, Bancard vPOS, upay et dLocal sont différés au lot C (PAY-042, après la porte PAY-041 ; E18). Un `FAKE` n'est jamais actif en production (17 ADR-032, test C19).
- **Déclencheur** : toute opération de paiement.
- **Prérequis** : coffre de secrets (ADM-032).
- **Parcours principal** : appel métier → adaptateur du PSP de l'agence → réponse normalisée → journal.
- **Parcours alternatifs** : PSP indisponible (EC-29) → erreur normalisée, aucun état incohérent, réessai idempotent ; capacité absente → repli défini par l'appelant (ex. mode b).
- **Règles métier** : BR-PAY-01 ; 08 « Exécution monétaire » E3 (rails et capacités par PSP).
- **États** : payment_operation `CREATED` → `PENDING` → `SUCCEEDED` / `FAILED` / `REFUNDED` (PROPOSÉ ; correspondance SM-8 pour les remboursements).
- **Erreurs** : `PSP_UNAVAILABLE`, `PSP_CAPABILITY_MISSING`, `PSP_CREDENTIALS_INVALID`, `MANDATE_REQUIRED`.
- **Données** : psp_account(org_id, provider, credentials_ref (coffre), capabilities, status) ; payment_operation ; psp_call_log(mandate_id, op, request_hash, response_code).
- **Notifications** : `EVT_PSP_FAILURE` (ops).
- **Permissions** : `SYSTEM` ; `ADMIN` (configuration) ; aucun humain ne lit les secrets en clair.
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given un second adaptateur, When il est ajouté, Then aucun module métier n'est modifié (revue de diff). Given une agence sans mandat en vigueur, When un ordre API est demandé, Then `MANDATE_REQUIRED` et aucun appel PSP. Given la base de données, When on la parcourt, Then aucun PAN ni CVV n'y figure. Given l'image ou la configuration de production, When un adaptateur `FAKE` y est déclaré, Then le service refuse de démarrer et la contrainte de base rejette la ligne (test C19, 17 ADR-032).
- **Source** : 08 BR-PAY-01 reco ; 12 §10.3 ; 09b §5.2 ; écrans 10b : S06.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ — interface et un seul adaptateur « lien de paiement + confirmation ».
- **Complexité** : élevée ; ops moyen ; risque élevé.
- **Améliorations possibles** : routage multi-PSP par coût et taux d'acceptation (P2).

#### Fiche PAY-002 / PAY-017 / PAY-018 — Cartes, refus et 3-D Secure
- **FEATURE ID** : PAY-002, PAY-017, PAY-018
- **Nom** : Cartes de crédit et débit au nom du guest (PAY-002) ; gestion des refus de carte (PAY-017) ; authentification 3-D Secure (PAY-018)
- **Module** : Paiements (PAY — Moyens, Échecs, Sécurité)
- **Persona** : PER-01, PER-02
- **Objectif** : payer par carte avec un taux d'acceptation élevé et sans fraude.
- **Description** : PAY-002 (absorbe PAY-005) : Visa/Mastercard/Amex (selon le PSP de l'agence) crédit et débit ; prépayées refusées par BIN (référence Turo, sauf Revolut). PAY-017 : message selon le code de refus, 3 tentatives par hold, moyen alternatif, anti card-testing (3 refus en 1 h → règle ADM-029). PAY-018 : 3DS2 au premier paiement de chaque carte (CIT), sans friction ou avec challenge, dans le hold de 10 min ; échec ou abandon = refus, hold libéré ; disponibilité par PSP : OQ-PAY-03.
- **Déclencheur** : paiement par carte au checkout.
- **Prérequis** : PAY-001 ; BKG-014.
- **Parcours principal** : page hébergée du PSP → 3DS → autorisation → webhook → PAY-034.
- **Parcours alternatifs** : refus → message localisé + proposition Yappy (PAY-004) ; 3e refus → blocage du hold ; carte prépayée → refus avant envoi si le BIN est connu.
- **Règles métier** : BR-PAY-01, BR-BOOK-10, BR-PAY-11 (chargeback : 3DS = transfert de responsabilité).
- **États** : SM-1 `HOLD` → `QUOTE` (refus) / `BOOKED`.
- **Erreurs** : `CARD_DECLINED_<code>`, `CARD_PREPAID_REFUSED`, `3DS_FAILED`, `PAYMENT_ATTEMPTS_EXCEEDED`.
- **Données** : payment_attempt(hold_id, method, decline_code, threeds_status, eci, liability_shift, at).
- **Notifications** : écran seulement.
- **Permissions** : `GUEST`.
- **Dépendances** : PAY-002 → PAY-001 ; PAY-017 → BKG-014 ; PAY-018 → PAY-001, BKG-014, PAY-017.
- **Critères d'acceptation** : Given 3 refus sur le même hold, When le guest tente une 4e fois, Then `PAYMENT_ATTEMPTS_EXCEEDED`. Given un 3DS échoué, When le webhook arrive, Then aucune réservation BOOKED et le hold est libéré. Given aucune authentification ni exemption tracée, When un paiement est reçu, Then il n'est pas accepté comme preuve (PAY-034).
- **Source** : SRC_G 2.6.7 (cartes) ; 11 EC-26 ; 08 BR-BOOK-10 ; écrans 10b : S06.
- **Confiance** : documenté (cartes) ; refus et 3DS proposés (Turo INFÉRÉ).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : DIFFÉRÉ (les trois) — cartes, refus et 3-D Secure assurés par la page hébergée du PSP de l'agence, aucun code.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : Apple/Google Pay (P2).

#### Fiche PAY-004 — Yappy (et Clave) via le PSP de l'agence
- **FEATURE ID** : PAY-004
- **Nom** : Moyens locaux : Yappy (et Clave si confirmée) via le PSP de l'agence
- **Module** : Paiements (PAY — Moyens)
- **Persona** : PER-02 (surtout)
- **Objectif** : permettre aux résidents sans carte de crédit de réserver.
- **Description** : paiement du loyer par Yappy via le compte Tilopay de l'agence (ordre expirant en 5 min, confirmation par IPN) ; Clave si le PSP de l'agence la confirme (OQ-PAY-03). ACH Xpress exclu en P0-A. Réservation confirmée **seulement** à réception de la confirmation PSP (PAY-034). Remboursement : par l'agence par virement avec preuve téléversée, tracé par la plateforme (OQ-PAY-07, OQ-PAY-22). Caution selon PAY-035.
- **Déclencheur** : choix « Yappy » au checkout.
- **Prérequis** : PAY-001, PAY-034, PAY-035.
- **Parcours principal** : ordre Yappy → le guest valide dans son app → IPN signé → BOOKED.
- **Parcours alternatifs** : ordre expiré (5 min) → nouvel ordre dans la limite du hold ; IPN absent → aucune confirmation, hold expiré ; capture d'écran envoyée par le guest → refusée comme preuve.
- **Règles métier** : BR-PAY-01, BR-PAY-08 ; 08 E3 (Yappy = rail sans remboursement partiel natif).
- **États** : SM-1 `HOLD` → `BOOKED` ; SM-8 `PENDING_BANK_DETAILS` pour un remboursement par virement.
- **Erreurs** : `YAPPY_ORDER_EXPIRED`, `PAYMENT_NOT_CONFIRMED`.
- **Données** : payment_operation(method=YAPPY, provider_ref, expires_at).
- **Notifications** : écran ; `EVT_BOOKING_CONFIRMED` après IPN.
- **Permissions** : `GUEST`.
- **Dépendances** : PAY-001 ; PAY-034 ; PAY-035.
- **Critères d'acceptation** : Given un ordre Yappy non confirmé en 5 min, When le délai expire, Then l'ordre est caduc et le trip n'est pas BOOKED. Given un IPN signé valide, When il arrive deux fois, Then un seul passage BOOKED. Given T33/T34 (configuration de test), When un trip payé partiellement par Yappy est annulé, Then la part Yappy suit le rail alternatif (virement) et non un remboursement natif.
- **Source** : 08 BR-PAY-01 reco ; 12 §2 ; 09b §2.1 ; écrans 10b : S06.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : DIFFÉRÉ — Yappy proposé par la page de paiement du PSP de l'agence s'il l'offre, aucun code.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : remboursement multi-rails (PAY-040, P1).

#### Fiche PAY-006 — Pay now (autorisation puis capture)
- **FEATURE ID** : PAY-006
- **Nom** : Pay now (autorisation puis capture)
- **Module** : Paiements (PAY — Options)
- **Persona** : PER-01, PER-02
- **Objectif** : payer à la réservation tout en permettant d'annuler sans frais pendant la revue de risque.
- **Description** : sur le compte de l'agence : autorisation à la confirmation, **capture dès que la revue ADM-029 est passée et au plus tard sous 24 h** ; la plateforme ne détient pas les fonds. La capture différée de Turo (min(auth + 40 h, départ − 1 h)) n'est pas retenue (validité réelle des autorisations 5 à 7 j, VERIF_08 V8-01).
- **Déclencheur** : confirmation d'un paiement par carte (PSP supportant l'autorisation).
- **Prérequis** : PAY-001 ; ADM-029.
- **Parcours principal** : auth → revue → capture (clé d'idempotence) → BOOKED reste.
- **Parcours alternatifs** : revue négative → void (aucun débit) ; annulation avant capture → capture partielle de la retenue + void du reste (TA10 en P0-A ; T28 pour le moteur) ou void + nouveau débit si capture partielle absente (T64, P0-B pour le MIT) ; autorisation expirée → T29 (P0-B). Paiement sans créneau (BKG-014) : void de l'autorisation ; en Bêta (paiement immédiat par lien), aucun void possible : remboursement par l'agence (PAY-021) (consolidé 17-C04-13, A12).
- **Règles métier** : BR-PAY-02, BR-CXL (règlement), 08 E1–E3.
- **États** : payment_operation `AUTHORIZED` → `CAPTURED` / `VOIDED`.
- **Erreurs** : `CAPTURE_FAILED`, `AUTH_EXPIRED`.
- **Données** : payment_operation.authorized_at, captured_at, capture_deadline.
- **Notifications** : `EVT_PAYMENT_CAPTURED` (interne).
- **Permissions** : `SYSTEM` sous mandat LEG-027.
- **Dépendances** : PAY-001 ; ADM-029.
- **Critères d'acceptation** : Given une autorisation à 10:00 et une revue approuvée à 11:00, When la tâche s'exécute, Then capture à 11:00 ± 5 min. Given aucune revue à 10:00 + 24 h, When le délai expire, Then alerte ops et capture bloquée (pas de capture automatique sans revue, PROPOSÉ). Given TA10 (P0-A : autorisation 128,40 non capturée, annulation guest à T−10 h), When l'annulation est réglée, Then capture partielle 42,80, void 85,60, remboursement en fonds 0,00 et commission 4,80 (consolidé VERIF_15-F4). Given T28 (configuration de test de 08, moteur seulement), When il est rejoué, Then capture partielle 69,22 et void 187,44.
- **Source** : SRC_G 2.6.2 ; 2.6.6 ; écrans 10b : S06.
- **Confiance** : documenté (base) ; délais proposés.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : DIFFÉRÉ — paiement immédiat par lien ; pas d'autorisation puis capture.
- **Complexité** : moyenne ; ops faible ; risque élevé.
- **Améliorations possibles** : Pay later (P1).

#### Fiche PAY-019 — Idempotence des opérations de paiement
- **FEATURE ID** : PAY-019
- **Nom** : Idempotence des opérations de paiement
- **Module** : Paiements (PAY — Fiabilité)
- **Persona** : technique
- **Objectif** : aucun double débit, double remboursement ou double confirmation.
- **Description** : clé d'idempotence **par tentative** avant la conversion : `hold:{hold_id}:{AUTH|CAPTURE|LINK|VOID}:a{attempt_no}` ; hors règlement : `{trip_id}:{segment_id}:v0-{origin_type}-{origin_id}:REFUND:{tender_id}:i{n}:a{m}` ; règlement : format de 08 E4 `trip:version:OP:moyen:instance:attempt` ; `attempt_no` + 1 seulement après un refus **reçu** ; jamais `hold_id` seul (consolidé 17-C04-3 ; 08 E4) ; webhooks dédupliqués par identifiant d'événement PSP (`webhook_inbox`) ; outbox transactionnelle.
- **Déclencheur** : toute opération PSP et tout webhook.
- **Prérequis** : PAY-001.
- **Parcours principal** : clé calculée → si déjà traitée, renvoi du résultat enregistré.
- **Parcours alternatifs** : timeout → rejeu avec la même clé (T51) ; échec confirmé → nouvelle tentative `attempt_no + 1` (T52).
- **Règles métier** : BR-BOOK-10 ; 08 E4.
- **États** : SM-8 (SUBMITTED, FAILED → attempt + 1).
- **Erreurs** : `IDEMPOTENCY_CONFLICT` (même clé, contenu différent).
- **Données** : `payment_operation.idempotency_key` (UQ), `payment_command`, `inbox_receipt` (17 §4.2–4.3).
- **Notifications** : —
- **Permissions** : `SYSTEM`.
- **Dépendances** : PAY-001.
- **Critères d'acceptation** : Given T51, When l'outbox rejoue un remboursement en timeout, Then 0 nouvelle opération et une seule `REFUND` au registre. Given T52, When un virement a échoué, Then même instance avec `attempt_no = 2`. Given la même clé avec un montant différent, When elle arrive, Then `IDEMPOTENCY_CONFLICT`. Given T68 (débit MIT de 69,22 refusé à J0, en timeout à J+3 puis refusé au rejeu, accepté à J+7), When les tentatives s'enchaînent, Then une seule instance, clés a1, a2 (rejouée à l'identique) et a3, et 69,22 débités une fois (consolidé VERIF_15-F5).
- **Source** : 08 BR-BOOK-10 ; 11 EC-29, EC-54. ; 08 T68 ; écrans 10b : S06.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ — clé d'idempotence sur la création du lien et le traitement des webhooks.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : —

#### Fiche PAY-021 — Remboursements sur le moyen d'origine
- **FEATURE ID** : PAY-021
- **Nom** : Remboursements sur le moyen d'origine
- **Module** : Paiements (PAY — Remboursements)
- **Persona** : PER-01, PER-02 ; PER-03 ; PER-07
- **Objectif** : rembourser le bon montant, sur le bon rail, avec preuve.
- **Description** : montant calculé par la plateforme (BR-CXL, devis figé PRC-025) ; exécution par API sur le compte de l'agence (void avant capture) **seulement sous mandat LEG-027** ; sinon l'agence exécute dans son back-office et la plateforme suit ; Yappy : l'agence rembourse par virement, preuve téléversée, **sous 5 j ouvrés**. Délais bancaires de 3 à 10 j ouvrés affichés. Exécution par l'agence modélisée (`agency_refund_task`, 17 §3.2.7) : tâche dans la vue agence **A12 « remboursements à exécuter »** (montant calculé par la plateforme, non modifiable ; rail ; échéance contractuelle : Yappy 5 j ouvrés, autres rails selon **UXQ-10**), preuve téléversée, confirmation par `refund.confirm_agency_execution`, pénalité LEG-025 en cas de retard ; le statut alimente S09 et S10 côté guest ; coordonnées bancaires du guest chiffrées pour l'agence et purgées à la preuve (UXQ-11) (consolidé VERIF_15-F2(v) ; 17-C04-4 ; 10b §7).
- **Déclencheur** : annulation (BKG-028/032/035), refus du véhicule (TRP-007), décision de litige.
- **Prérequis** : PAY-001, PRC-025, LEG-027.
- **Parcours principal** : règlement versionné → instance SM-8 `PLANNED` → API (mode a) ou tâche agence (mode b) → `SENT` → `CONFIRMED` (ARN ou preuve).
- **Parcours alternatifs** : rail sans remboursement natif → `PENDING_BANK_DETAILS` (compte vérifié au nom du guest) ; dépassement de 5 j ouvrés → relance, pénalité sur la facture de commission (LEG-025) ; requalification → supersession (T49) ou débit/dette (T50, P0-B).
- **Règles métier** : BR-PAY-08, BR-CXL-01, BR-CXL-06, BR-CXL-12, BR-CXL-14 ; 08 E1–E3.
- **États** : SM-8 complet.
- **Erreurs** : `MANDATE_REQUIRED`, `REFUND_EXCEEDS_COLLECTED`, `REFUND_PROOF_MISSING`.
- **Données** : `refund_instance`(id, trip_id, segment_id, settlement_id, origin_type, origin_id, rail, executor, amount_minor, status, attempt_no) ; `agency_refund_task`(refund_instance_id, org_id, rail, status, deadline_at, proof_file_id, proof_reference, confirmed_by) (17 §3.2.7).
- **Notifications** : `EVT_REFUND_PLANNED`, `EVT_REFUND_CONFIRMED`, `EVT_REFUND_OVERDUE` (agence, ops) ; événements `refund.agency_task.opened` / `.overdue` / `.proof_uploaded`.
- **Permissions** : `SYSTEM` (API sous mandat) ; `AGENCY_OWNER`, `AGENCY_MANAGER`, `AGENCY_ACCOUNTANT` (preuve, `refund.confirm_agency_execution`) ; `OPS_AGENT` (suivi, vérification de la preuve).
- **Dépendances** : PAY-001 ; PRC-025 ; LEG-027.
- **Critères d'acceptation** : Given TA02, When l'annulation est réglée, Then un remboursement de 85,60 est planifié et visible du guest, de l'agence et de l'ops. Given un remboursement supérieur à l'encaissé, When il est demandé, Then `REFUND_EXCEEDS_COLLECTED` (invariant `refund_committed ≤ collected_total`). Given un paiement Yappy, When 5 j ouvrés passent sans preuve, Then `EVT_REFUND_OVERDUE`. Given T01–T05, T14, T15, When ils sont rejoués, Then les remboursements guest TTC attendus sont obtenus. Given une agence sans mandat LEG-027 et un remboursement de 85,60 dû (TA02), When le règlement est calculé, Then aucune opération n'est émise par la plateforme sur le compte de l'agence, une tâche est ouverte dans A12 et la plateforme ne fait que suivre la preuve (consolidé VERIF_15-F13). Given T66 (a) (configuration de test de 08 : version 2 ramenant la retenue à 19,22 après une version 1 exécutée), When la version 2 est exécutée, Then le complément de 50,00 est imputé de façon incrémentale (Yappy 19,22 + crédit 30,00 ; le crédit n'existe qu'en P0-B) (consolidé VERIF_15-F5).
- **Source** : SRC_G 2.6.9 ; 2.6.6 ; 11 EC-49, EC-55. ; 08 T66 ; 17 §2.8, §3.2.7 ; 10b A12 ; écrans 10b : S10, A12.
- **Confiance** : documenté (délais) ; exécution agence proposée.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : MANUEL — l'agence rembourse dans son back-office PSP le montant calculé par la plateforme ; l'ops consigne la preuve.
- **Complexité** : moyenne ; ops faible ; risque élevé.
- **Améliorations possibles** : crédit immédiat ou virement vers un compte vérifié (PAY-040, P1).

#### Fiche PAY-033 — Mode « agence encaisse »
- **FEATURE ID** : PAY-033
- **Nom** : Mode « agence encaisse » (agence = marchand de référence)
- **Module** : Paiements (PAY — Modèle d'encaissement)
- **Persona** : PER-03, PER-01, PER-02, PER-07
- **Objectif** : fonder la bêta sans détention de fonds (pas de casa de remesas, 12 §10.3).
- **Description** : chaque agence est onboardée avec son compte PSP. **Mode (a) API** — seulement avec mandat LEG-027 en vigueur, accord du PSP et porte PAY-041 franchie : la plateforme crée l'ordre sur le compte de l'agence, reçoit le webhook signé, synchronise le trip. **Mode (b) repli** : lien de paiement du PSP de l'agence + webhook signé ou confirmation par l'agence (`AGENCY_OWNER` / `AGENCY_MANAGER`) ; le créneau est tenu par un hold `AGENCY_LINK` (TTL `agency_link_hold_minutes` PROPOSÉ 120 min, **décision produit UXQ-09**, BKG-014) ; sans preuve à l'échéance : **libération du hold** (aucun trip n'existe, donc ni annulation ni motif BR-CXL) (consolidé VERIF_15-F1 ; 17 A8, ADR-025). Paiement au comptoir non accepté. Caution chez l'agence (PAY-035).
- **Déclencheur** : checkout.
- **Prérequis** : PAY-001, PAY-034, PAY-035, ADM-004, LEG-027, PAY-041 ; organisation `ACTIVE`.
- **Parcours principal** : (a) ordre → page PSP → webhook → conversion gardée → `BOOKED` ; (b) hold `AGENCY_LINK` → lien PSP de l'agence (généré par l'agence ou par l'adaptateur) → paiement → webhook si disponible, sinon confirmation de l'agence (double confirmation au-delà de `agency_payment_dual_confirm_minor`) → conversion gardée → `BOOKED`.
- **Parcours alternatifs** : pas de preuve à l'échéance du hold `AGENCY_LINK` (b) → `EXPIRED` (ou `RELEASED` par l'agence), créneau libéré, message « No se confirmó tu pago; si se te cobró, {agencia} te lo reembolsa » ; paiement apparu ensuite → ré-acquisition ou compensation (BKG-014) ; mandat révoqué → bascule automatique en mode b. Alternative non retenue (ADR-025) : trip `BOOKED` impayé annulé avec un motif `PAYMENT_NOT_CONFIRMED`, qui exigerait d'amender SM-1 et BR-CXL.
- **Règles métier** : BR-PAY-01, BR-TRUST-02 (marché gris), BR-BOOK-10.
- **États** : `checkout_hold` (`kind = AGENCY_LINK` en mode b) `ACTIVE` → `CONVERTED` / `EXPIRED` / `RELEASED` ; SM-1 `HOLD` → `BOOKED` ; mode d'encaissement de l'organisation (`collection_mode`, ADR-003 ; mode a ou b selon `psp_account.mandate_id`).
- **Erreurs** : `ORGANIZATION_PSP_NOT_CONNECTED`, `PAYMENT_NOT_CONFIRMED`, `MANDATE_REQUIRED`.
- **Données** : `psp_account`, `psp_mandate`, `checkout_hold`, `agency_payment_confirmation`(hold_id, operation_id, org_id, confirmed_by, second_confirmed_by, psp_reference, amount_minor, evidence_file_id, at) (17 §3.2.7).
- **Notifications** : `EVT_PAYMENT_CONFIRMATION_REQUIRED` (agence : liste « liens en attente ») ; `booking.hold.expired` / `.released` (guest, écran S06).
- **Permissions** : `AGENCY_OWNER`, `AGENCY_MANAGER` (`payment.confirm_agency` ; jamais `AGENCY_COUNTER_AGENT` seul, qui peut seulement proposer) ; `OPS_AGENT` (saisie au nom de l'agence sur preuve écrite, double validation, 17 §2.3) ; `SYSTEM`.
- **Dépendances** : PAY-001 ; PAY-034 ; PAY-035 ; ADM-004 ; LEG-027 ; PAY-041.
- **Critères d'acceptation** : Given le mode b et un hold `AGENCY_LINK` sans preuve à son échéance (120 min, valeur de test du paramètre), When la tâche s'exécute, Then le hold passe `EXPIRED`, le créneau est libéré et aucun trip, contrat ni `booking.trip.booked` n'a été émis. Given une confirmation soumise par un `AGENCY_COUNTER_AGENT` seul, When elle est enregistrée, Then elle reste une proposition et aucun trip n'est créé. Given un trip sans preuve de paiement, When on tente BOOKED, Then refus. Given le relevé de commission, When il est calculé, Then il ne contient que des trips synchronisés. Given une agence sans mandat, When le mode a est demandé, Then `MANDATE_REQUIRED`.
- **Source** : VERIF_07 NEW-01 ; 12 §9.3, §10.1, §10.3 ; 09b §5.1–5.2 ; VERIF_08 §5. ; 17 §2.5, ADR-025, annexe A8 ; écrans 10b : S06, A05.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : (aligné v4, C-v3-16) lien à usage unique préféré quand le PSP l'offre ; un seul paiement convertit le hold, tout paiement en plus est remboursé. SIMPLIFIÉ — mode (b) seulement : lien de paiement du PSP de l'agence + webhook ou confirmation de l'agence ; aucune opération initiée par la plateforme sur le compte de l'agence.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : split à la source (PAY-038, P0-B).

#### Fiche PAY-034 — Preuve de paiement non réversible avant remise des clés
- **FEATURE ID** : PAY-034
- **Nom** : Preuve de paiement non réversible par webhook avant remise des clés
- **Module** : Paiements (PAY — Anti-fraude paiement)
- **Persona** : PER-04, PER-03, PER-07
- **Objectif** : aucun véhicule remis sur un paiement non confirmé (faux justificatifs Yappy, 12 §2).
- **Description** : un paiement n'est reçu que sur webhook/IPN signé du PSP de l'agence, ou sur confirmation de l'agence dans son back-office PSP ; une capture d'écran du guest ne vaut jamais preuve. Check-in bloqué (TRP-002) tant que non confirmé. La confirmation de l'agence est réservée à `AGENCY_OWNER` / `AGENCY_MANAGER`, avec double confirmation au-delà de `agency_payment_dual_confirm_minor` ; jamais l'agent de comptoir seul (consolidé 17-C04-5). La preuve déclenche la conversion gardée du hold (BKG-014).
- **Déclencheur** : réception d'un webhook ; confirmation agence ; ouverture du check-in.
- **Prérequis** : PAY-001.
- **Parcours principal** : vérification de signature → paiement `SUCCEEDED` → `payment_confirmed = true`.
- **Parcours alternatifs** : signature invalide → rejet, alerte ; montant différent du devis → `MISMATCH`, revue ops.
- **Règles métier** : BR-PAY-01, BR-TRUST-02.
- **États** : `agency_payment_confirmation` ou opération `SUCCEEDED` signée : `NONE` → `CONFIRMED` / `MISMATCH`.
- **Erreurs** : `WEBHOOK_SIGNATURE_INVALID`, `PAYMENT_AMOUNT_MISMATCH`, `CHECKIN_PAYMENT_NOT_CONFIRMED`.
- **Données** : `webhook_inbox`(provider, event_id, signature_ok, raw_body_enc, received_at) ; `agency_payment_confirmation` (17 §3.2.7, §4.4).
- **Notifications** : `EVT_PAYMENT_MISMATCH` (ops).
- **Permissions** : `SYSTEM` ; `AGENCY_OWNER`, `AGENCY_MANAGER` (`payment.confirm_agency`) ; `OPS_AGENT` sur preuve écrite, double validation.
- **Dépendances** : PAY-001.
- **Critères d'acceptation** : Given un webhook à signature falsifiée, When il arrive, Then rejet et aucun changement d'état. Given un trip non confirmé, When l'agent ouvre le check-in, Then `CHECKIN_PAYMENT_NOT_CONFIRMED`. Given un montant reçu de 120,00 pour un devis de 128,40, When il arrive, Then `MISMATCH`. Critère S2 : 0 remise de clés sur paiement non confirmé.
- **Source** : VERIF_06 §3 idées 4–5 ; 09b §2.1 ; 12 §2 ; écrans 10b : S06, A03.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI. (aligné v4, C-v3-16, R3) La confirmation enregistre chaque paiement vu pour le lien ; voie de repli ops sur preuve écrite de l'agence, double validation (même règle dans 04 PAY-034 et 08 BR-BOOK-10 point 9).
- **Complexité** : faible ; ops faible ; risque élevé.
- **Améliorations possibles** : —

#### Fiche PAY-035 — Politique de caution de l'agence et options sans carte de crédit
- **FEATURE ID** : PAY-035
- **Nom** : Politique de caution de l'agence et options sans carte de crédit
- **Module** : Paiements (PAY — Caution P0-A)
- **Persona** : PER-03, PER-01, PER-02, PER-04
- **Objectif** : caution transparente, compatible avec une clientèle sans carte de crédit, sans détention par la plateforme.
- **Description** : l'agence déclare par catégorie : montant, moyens acceptés au comptoir (pré-autorisation carte de crédit, carte de débit, espèces, Yappy ou virement restitué), délai de restitution. Affiché sur carte résultat, fiche, checkout, contrat ; filtre « sin tarjeta de crédito ». Prise et restituée par l'agence ; l'agent saisit au check-in le montant et le moyen réellement pris (TRP-052). Licéité Yappy/virement : OQ-PAY-06. Champ **obligatoire** de la déclaration : liste fermée « ce que la caution couvre / ne couvre pas » (carburant, retard, kilométrage, nettoyage / tabac / animaux, péages, **dommages : oui / non**), affichée dans le bloc « Depósito de garantía » de S02/S03 et S05 (UX-21 : cuánto, quién lo retiene, cómo, qué cubre, qué no cubre, cuándo vuelve) et dans le contrat ; sans ce champ, aucune promesse de couverture n'est affichée et l'annonce n'est pas publiable ; même liste au contrat-cadre (LEG-025) (consolidé VERIF_15-F2(i) ; 10b §7, UXQ-02).
- **Déclencheur** : configuration par l'agence ; affichage ; check-in.
- **Prérequis** : ACC-029.
- **Parcours principal** : déclaration → revue ops → affichage → saisie au comptoir.
- **Parcours alternatifs** : moyen non déclaré présenté au comptoir → refus par l'agent ou accord tracé ; retenue → CLM-006 avec preuves (jamais une décision unilatérale tracée par la plateforme sans dossier).
- **Règles métier** : BR-PAY-06 (référence de la caution ; seuil remplacé par PAY-036 en P0-B), BR-VERIF-09.
- **États** : `counter_deposit_record` `DECLARED` → `TAKEN` → `RETURNED` / `RETAINED_PENDING_CLAIM` (PROPOSÉ).
- **Erreurs** : `DEPOSIT_POLICY_MISSING` (annonce non publiable).
- **Données** : `deposit_policy`(org_id, category, amount_minor, currency, accepted_methods[], return_delay_hours, no_credit_card_ok, liste « couvre / ne couvre pas » dont `damage_covered`, valid_from) ; `counter_deposit_record`(trip_id, method, amount_minor, taken_by, taken_at, returned_at, retained_minor) (17 §3.2.3, §3.2.7 ; liste de couverture présente dans 17 v4 : `covered_items`, `excluded_items`, `covers_damage`, aligné v4 — R4).
- **Notifications** : caution rappelée dans `EVT_BOOKING_CONFIRMED`.
- **Permissions** : `AGENCY_MANAGER` (politique), `AGENCY_COUNTER_AGENT` (saisie).
- **Dépendances** : ACC-029.
- **Critères d'acceptation** : Given une agence acceptant la carte de débit, When un guest filtre « sin tarjeta de crédito », Then ses véhicules apparaissent. Given un check-in, When l'agent ne saisit pas la caution prise, Then le check-in ne se termine pas. Given une politique modifiée, When un trip confirmé existe, Then son contrat garde l'ancienne version. Given une politique sans liste « couvre / ne couvre pas », When l'agence publie l'annonce, Then `DEPOSIT_POLICY_MISSING` et aucune mention de couverture n'apparaît sur S03 (consolidé VERIF_15-F2(i)).
- **Source** : VERIF_07 F02 ; VERIF_06 §3 idée 9 ; 09b §5.1 ; 12 §1.5, §2 ; écrans 10b : S02, A03, A11.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI.
- **Complexité** : faible ; ops faible ; risque élevé.
- **Améliorations possibles** : caution modulée ou caution-assurance (PAY-039, P1).

## E7 — Onboarding agence, polices flotte et annonces (P0-A, 15 lignes)

#### Fiche PRT-019 — Dépôt et contrôle de la police flotte
- **FEATURE ID** : PRT-019
- **Nom** : Dépôt et contrôle de la police flotte du loueur
- **Module** : Sinistres & protection (PRT — Polices flotte ; rattachée à E7)
- **Persona** : PER-03 ; PER-07
- **Objectif** : aucune annonce publiée sans police valide couvrant la distribution par plateforme (condition 6 de 12 §10.3).
- **Description** : police + attestation de l'assureur (couverture d'une location distribuée par plateforme tierce, OQ-MK-05) : assureur, n°, validité, véhicules couverts (plaques ou flotte), RC, franchises, exclusions. Revue ops (ADM-004). Alertes J-30 et J-7 ; à l'expiration, **dépublication automatique** des annonces concernées.
- **Déclencheur** : onboarding ; renouvellement ; tâche quotidienne d'expiration.
- **Prérequis** : VER-027.
- **Parcours principal** : dépôt → revue → saisie des champs → liaison aux véhicules → publication possible.
- **Parcours alternatifs** : attestation « plateforme » absente → refus ; expiration avec trips confirmés futurs → annonce `RESTRICTED`, trips signalés à l'ops (annulation plateforme BKG-035 si non renouvelée avant le départ).
- **Règles métier** : BR-PROT-01, BR-PROT-04, BR-PROT-10, BR-LIST-01.
- **États** : insurance_policy `SUBMITTED` → `VERIFIED` → `EXPIRING` → `EXPIRED` / `REJECTED` ; SM-2 `LISTED` → `RESTRICTED`.
- **Erreurs** : `POLICY_MISSING_PLATFORM_CLAUSE`, `POLICY_EXPIRED`, `VEHICLE_NOT_COVERED`.
- **Données** : insurance_policy (voir LST-013) + covered_vehicles[], documents.
- **Notifications** : `EVT_POLICY_EXPIRING` (J-30, J-7), `EVT_POLICY_EXPIRED` (agence, ops).
- **Permissions** : `AGENCY_MANAGER` (dépôt), `OPS_AGENT` (vérification).
- **Dépendances** : VER-027.
- **Critères d'acceptation** : Given une police expirée à minuit, When la tâche s'exécute, Then toutes les annonces liées passent `RESTRICTED` et disparaissent de la recherche. Given un véhicule hors des plaques couvertes, When il est soumis, Then `VEHICLE_NOT_COVERED`. Given une police à J-30, When la tâche tourne, Then l'alerte part une seule fois.
- **Source** : VERIF_07 NEW-04 ; 12 §9.4, §10.3 ; 10 ; écrans 10b : S17.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — police et attestation contrôlées par l'ops, dates saisies, alerte d'expiration dans l'agenda ops.
- **Complexité** : faible ; ops moyen ; risque élevé.
- **Améliorations possibles** : vérification auprès de l'assureur par API (P2).

#### Fiche LEG-025 — Contrat-cadre plateforme–loueur
- **FEATURE ID** : LEG-025
- **Nom** : Contrat-cadre plateforme–loueur signé en ligne
- **Module** : Légal, données & localisation (LEG — Relation loueur ; rattachée à E7)
- **Persona** : PER-03 ; PER-07
- **Objectif** : relation juridique claire et seul levier financier de la plateforme.
- **Description** : signé avant la première annonce, versionné (LEG-002, BKG-019). Clauses : intermédiation facturée au loueur ; loueur = loueur et marchand de référence ; commission (FIN-018) ; parité de prix et non-contournement ; SLA ; police flotte (PRT-019) ; sous-traitance des données ; mandat (LEG-020) et mandat PSP limité (LEG-027) ; **exécution obligatoire des décisions de litige et des remboursements sous 5 j ouvrés**, à défaut pénalité/avoir sur la facture de commission ; audit des relevés PSP (FIN-019) ; engagements qualité (ex-HST-015) ; résiliation. Texte par l'avocat (OQ-MK-01, OQ-BR-24).
- **Déclencheur** : onboarding (après KYB).
- **Prérequis** : LEG-002, ACC-029, ADM-004, BKG-019, PRT-019.
- **Parcours principal** : envoi → lecture → signature du représentant légal → société `ACTIVE` (avec PSP).
- **Parcours alternatifs** : nouvelle version majeure → re-signature exigée avant toute nouvelle annonce ; résiliation → annonces dépubliées, trips confirmés traités au cas par cas.
- **Règles métier** : BR-LIST-01, BR-BOOK-13 (canaux tiers, parité), BR-TRUST-02.
- **États** : master_agreement `SENT` → `SIGNED` → `SUPERSEDED` / `TERMINATED`.
- **Erreurs** : `FRAMEWORK_CONTRACT_NOT_SIGNED`.
- **Données** : master_agreement(org_id, version, signed_by, signed_at, sha256).
- **Notifications** : `EVT_MASTER_AGREEMENT_TO_SIGN`.
- **Permissions** : représentant légal (`AGENCY_MANAGER` désigné).
- **Dépendances** : LEG-002 ; ACC-029 ; ADM-004 ; BKG-019 ; PRT-019.
- **Critères d'acceptation** : Given une agence sans contrat signé en vigueur, When une annonce est soumise ou publiée, Then `FRAMEWORK_CONTRACT_NOT_SIGNED`. Given une décision de litige non exécutée à J+5 ouvrés, When la tâche tourne, Then une ligne de pénalité est proposée sur la facture de commission.
- **Source** : VERIF_07 NEW-03 ; 12 §10.3 ; 15 IMP-14, IMP-40 ; écrans 10b : A07.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : MANUEL — contrat-cadre signé hors ligne (PDF), version consignée par l'ops.
- **Complexité** : faible ; ops moyen ; risque élevé.
- **Améliorations possibles** : signature qualifiée.

#### Fiche HST-005 — Wizard d'annonce
- **FEATURE ID** : HST-005
- **Nom** : Wizard d'annonce en étapes
- **Module** : Espace agence & annonces (HST — Wizard)
- **Persona** : PER-03
- **Objectif** : créer une annonce complète, véhicule par véhicule, avec reprise du brouillon.
- **Description** : progression + brouillon ; étapes : véhicule (HST-011), photos (HST-012), prix (PRC-001), distance (HST-033), disponibilité (CAL-003), documents (HST-039), soumission (HST-016). Les étapes 2 à 9 de Turo n'ont pas été observées (BLOQUÉ à l'étape VIN).
- **Déclencheur** : « Agregar vehículo ».
- **Prérequis** : HST-011, HST-039 ; société active.
- **Parcours principal** : étapes → validation par étape → soumission.
- **Parcours alternatifs** : abandon → brouillon ; recommencer → `DELETED` (SM-2).
- **Règles métier** : BR-LIST-04.
- **États** : SM-2 `DRAFT`.
- **Erreurs** : `LISTING_STEP_INCOMPLETE`.
- **Données** : listing_draft(vehicle_id, step, data).
- **Notifications** : —
- **Permissions** : `AGENCY_MANAGER`.
- **Dépendances** : HST-011 ; HST-039.
- **Critères d'acceptation** : Given une annonce sans photos, When elle est soumise, Then elle reste en brouillon avec l'étape manquante indiquée.
- **Source** : 06 H-ONB-02 ; écrans 10b : A10.
- **Confiance** : confirmé (progression « 1 of 9 » OBSERVÉE) ; étapes ultérieures proposées.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — annonces créées par l'ops par import CSV (FLT-011), sans wizard.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : décodage VIN.

#### Fiche HST-011 — Détails du véhicule
- **FEATURE ID** : HST-011
- **Nom** : Détails du véhicule
- **Module** : Espace agence & annonces (HST — Annonce)
- **Persona** : PER-03
- **Objectif** : données véhicule complètes et uniques.
- **Description** : plaque (unique), VIN (ex-HST-006), marque, modèle, année, catégorie et classe de valeur (ex-HST-021), transmission, places, carburant, options, description et règles (ex-HST-046), lieu de rattachement (comptoir, ex-HST-003), instructions de retrait/retour (ex-TRP-011), GPS déclaré par l'agence (P0 « lite » du géofencing).
- **Déclencheur** : wizard ; import CSV.
- **Prérequis** : HST-050.
- **Parcours principal** : saisie → validations → enregistrement.
- **Parcours alternatifs** : plaque existante → refus.
- **Règles métier** : BR-LIST-04, BR-ACC-05 (classes de valeur), BR-PICKUP-11 (dispositifs de suivi déclarés).
- **États** : SM-2 `DRAFT`.
- **Erreurs** : `VEHICLE_PLATE_DUPLICATE`, `VEHICLE_FIELD_REQUIRED`.
- **Données** : vehicle(id, org_id, plate, vin, make, model, year, category, value_class, transmission, seats, fuel, gps_declared, location_id, instructions_es/en).
- **Notifications** : —
- **Permissions** : `AGENCY_MANAGER`, `OPS_AGENT`.
- **Dépendances** : HST-050.
- **Critères d'acceptation** : Given une plaque déjà enregistrée, When un véhicule est créé, Then `VEHICLE_PLATE_DUPLICATE`. Given un champ obligatoire vide, When on soumet, Then erreur par champ.
- **Source** : SRC_H §1.4 ; écrans 10b : A10.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — modèle de données alimenté par l'import CSV, sans formulaire ; marque, modèle, année et finition rattachés au catalogue de référence (HST-050) par `variant_id` (aligné v4).
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : intégration GPS (TRP-055, P1).

#### Fiche HST-012 — Photos d'annonce
- **FEATURE ID** : HST-012
- **Nom** : Photos d'annonce
- **Module** : Espace agence & annonces (HST — Annonce)
- **Persona** : PER-03
- **Objectif** : photos fidèles et suffisantes.
- **Description** : ≥ 6 obligatoires (Turo : ≥ 1, 10 recommandées), recadrage ~20 %, interdites : IA, banques d'images, texte ; ordre et photo principale choisis ; variantes de taille.
- **Déclencheur** : wizard ; import.
- **Prérequis** : HST-005.
- **Parcours principal** : téléversement → contrôle format/poids → revue ops (HST-016).
- **Parcours alternatifs** : photo refusée en revue → motif.
- **Règles métier** : BR-LIST-05.
- **États** : photo `UPLOADED` → `APPROVED` / `REJECTED`.
- **Erreurs** : `PHOTO_FORMAT`, `PHOTO_MIN_COUNT`.
- **Données** : listing_photo.
- **Notifications** : —
- **Permissions** : `AGENCY_MANAGER`, `OPS_AGENT`.
- **Dépendances** : HST-005.
- **Critères d'acceptation** : Given 5 photos, When l'annonce est soumise, Then `PHOTO_MIN_COUNT`.
- **Source** : SRC_H §1.4 ; écrans 10b : A10.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — photos chargées par l'ops avec l'import (FLT-011).
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : détection automatique d'images de banque.

#### Fiche HST-016 / HST-026 — Soumission, revue et cycle de vie de l'annonce
- **FEATURE ID** : HST-016, HST-026
- **Nom** : Soumission et revue de l'annonce (HST-016) ; cycle de vie de l'annonce (HST-026)
- **Module** : Espace agence & annonces (HST — Wizard, Statuts)
- **Persona** : PER-03 ; PER-07
- **Objectif** : seules des annonces revues et conformes sont visibles.
- **Description** : HST-016 : revue manuelle de toutes les annonces au lancement (Turo : 24–48 h ; SLA ops 24 h, ADM-003). HST-026 (absorbe HST-028) : statuts brouillon, en revue, listée, snoozée, non listée, restreinte, retirée, supprimée.
- **Déclencheur** : soumission ; actions agence/ops ; événements (police expirée, rappel).
- **Prérequis** : HST-012, HST-019 ; contrat-cadre signé ; police valide.
- **Parcours principal** : `DRAFT` → `PENDING_REVIEW` → `LISTED`.
- **Parcours alternatifs** : refus → `REJECTED` → correction ; retrait par l'agence avec trips futurs → refusé tant que des trips existent (règle proposée, OQ-BR-29, EC-37) ; police expirée → `RESTRICTED`.
- **Règles métier** : BR-LIST-08, BR-LIST-09, BR-LIST-01, BR-LIST-06.
- **États** : SM-2 complet.
- **Erreurs** : `LISTING_HAS_FUTURE_TRIPS`, `LISTING_TRANSITION_FORBIDDEN`.
- **Données** : listing(vehicle_id, status, status_reason, changed_by, changed_at).
- **Notifications** : `EVT_LISTING_APPROVED`, `EVT_LISTING_REJECTED`, `EVT_LISTING_RESTRICTED`.
- **Permissions** : `AGENCY_MANAGER` (soumettre, snoozer, retirer), `OPS_AGENT` (approuver, restreindre).
- **Dépendances** : HST-016 → HST-012, HST-019 ; HST-026 → HST-016.
- **Critères d'acceptation** : Given une transition absente de SM-2, When elle est demandée, Then `LISTING_TRANSITION_FORBIDDEN`. Given un trip futur, When l'agence retire l'annonce, Then `LISTING_HAS_FUTURE_TRIPS`. Given chaque changement de statut, When il a lieu, Then il est journalisé avec motif.
- **Source** : SRC_H H12, §1.4 ; 08 BR-LIST-09, SM-2 ; écrans 10b : A10.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL (les deux) — revue par l'ops, statut changé dans la console.
- **Complexité** : moyenne ; ops moyen / faible ; risque faible.
- **Améliorations possibles** : approbation automatique pour agences établies (P1).

#### Fiche HST-019 — Éligibilité du véhicule
- **FEATURE ID** : HST-019
- **Nom** : Éligibilité du véhicule
- **Module** : Espace agence & annonces (HST — Éligibilité)
- **Persona** : PER-03 ; PER-07
- **Objectif** : seuls des véhicules sûrs, légaux et couverts sont loués.
- **Description** : âge ≤ 10 ans, < 200 000 km, plaque commerciale de location, revisado et documents à jour (HST-039), couvert par la police flotte (PRT-019) ; valeurs À DÉCIDER dans ADM-031 (Turo : ≤ 12 ans, valeur ≤ 200 000 $). Contrôles manuels ≈ 5–10 min par véhicule ou par échantillon à l'import.
- **Déclencheur** : soumission.
- **Prérequis** : HST-011, PRT-019, HST-039, ADM-031.
- **Parcours principal** : règles automatiques (âge, km) → contrôle ops des documents → éligible.
- **Parcours alternatifs** : non éligible → `BLOCKED_ELIGIBILITY` (SM-2).
- **Règles métier** : BR-LIST-02, BR-LIST-03, BR-LIST-06, BR-LIST-07.
- **États** : SM-2 `DRAFT` → `BLOCKED_ELIGIBILITY`.
- **Erreurs** : `VEHICLE_TOO_OLD`, `VEHICLE_MILEAGE_TOO_HIGH`, `VEHICLE_PLATE_NOT_COMMERCIAL`, `VEHICLE_NOT_COVERED`.
- **Données** : vehicle.odometer_km, plate_type, eligibility_check(by, at, result).
- **Notifications** : `EVT_LISTING_REJECTED` avec motif.
- **Permissions** : `OPS_AGENT`.
- **Dépendances** : HST-011 ; PRT-019 ; HST-039 ; ADM-031.
- **Critères d'acceptation** : Given un véhicule de 11 ans (seuil 10), When il est soumis, Then `VEHICLE_TOO_OLD`. Given une plaque « particular », When il est soumis, Then `VEHICLE_PLATE_NOT_COMMERCIAL`.
- **Source** : SRC_H §1.2–1.3 ; écrans 10b : A10.
- **Confiance** : documenté (base) ; seuils proposés.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — éligibilité vérifiée par l'ops sur liste de contrôle.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : vérification des rappels constructeurs (BR-LIST-06).

#### Fiche HST-033 — Configuration de la distance incluse
- **FEATURE ID** : HST-033
- **Nom** : Configuration de la distance incluse
- **Module** : Espace agence & annonces (HST — Kilométrage)
- **Persona** : PER-03
- **Objectif** : fixer le kilométrage vendu.
- **Description** : « kilometraje ilimitado » ou km/jour + prix du km supplémentaire (USD), par véhicule ou catégorie ; figé dans la réservation (ex-PRC-019). Proposition : 250/200/150 km/j selon la classe.
- **Déclencheur** : wizard ; import.
- **Prérequis** : HST-005.
- **Parcours principal** : saisie → validation → affichage LST-012.
- **Parcours alternatifs** : —
- **Règles métier** : BR-MILEAGE-01, BR-MILEAGE-02, BR-MILEAGE-04, BR-PRICE-17.
- **États** : —
- **Erreurs** : `MILEAGE_CONFIG_INVALID`.
- **Données** : mileage_policy(vehicle_or_category, unlimited, km_per_day, extra_km_price_minor).
- **Notifications** : —
- **Permissions** : `AGENCY_MANAGER`.
- **Dépendances** : HST-005.
- **Critères d'acceptation** : Given une modification, When un trip est confirmé avant, Then il garde l'ancienne configuration.
- **Source** : SRC_H §2 ; écrans 10b : A10.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — distance et prix du km saisis dans l'import CSV.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : facturation du dépassement in-app (P1).

#### Fiche HST-039 — Documents du véhicule et attestation d'assurance
- **FEATURE ID** : HST-039
- **Nom** : Documents du véhicule et attestation d'assurance
- **Module** : Espace agence & annonces (HST — Documents)
- **Persona** : PER-03 ; PER-07
- **Objectif** : documents légaux à jour à bord et dans le dossier.
- **Description** : carte grise (registro), revisado, attestation d'assurance (SOBAT minimum au Panama) téléversés avec dates de validité ; à bord du véhicule.
- **Déclencheur** : onboarding du véhicule ; renouvellements.
- **Prérequis** : VER-027.
- **Parcours principal** : dépôt → revue ops → valide.
- **Parcours alternatifs** : document expiré → annonce `RESTRICTED`.
- **Règles métier** : BR-PROT-10, BR-PICKUP-06.
- **États** : vehicle_document `SUBMITTED` → `VALID` → `EXPIRED`.
- **Erreurs** : `VEHICLE_DOCUMENT_EXPIRED`.
- **Données** : vehicle_document(vehicle_id, type, file_ref, valid_until).
- **Notifications** : `EVT_VEHICLE_DOCUMENT_EXPIRING`.
- **Permissions** : `AGENCY_MANAGER`, `OPS_AGENT`.
- **Dépendances** : VER-027.
- **Critères d'acceptation** : Given un revisado expiré, When la tâche quotidienne tourne, Then l'annonce passe `RESTRICTED`.
- **Source** : SRC_H §2 ; TOS-HOST ; écrans 10b : A10.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — documents reçus et vérifiés par l'ops.
- **Complexité** : faible ; ops moyen ; risque faible.
- **Améliorations possibles** : OCR des dates.

#### Fiche HST-050 — Catalogue de référence des véhicules
- **FEATURE ID** : HST-050
- **Nom** : Catalogue de référence des véhicules (marques, modèles, variantes)
- **Module** : Onboarding hôte & annonces (HST — Annonce ; rattachée à E7)
- **Persona** : PER-03 ; PER-07
- **Objectif** : remplacer la saisie libre de la marque et du modèle par un choix dans un catalogue fiable, adapté au parc du Panama et du Paraguay, pour fiabiliser l'import, les caractéristiques affichées et les filtres.
- **Description** : catalogue maison `vehicle_make` / `vehicle_model` / `vehicle_variant` d'environ 150 modèles locaux (pick-ups, SUV, citadines, vans, marques chinoises, importations japonaises d'occasion au Paraguay) : carrosserie, places, portes, boîte, carburant, transmission intégrale, cylindrée, consommation ; amorcé par Wikidata (CC0) et le squelette NHTSA vPIC, valeurs EPA étiquetées « référence US » ; chaque ligne porte `source` et `license_note` ; `vehicle.variant_id` relie le véhicule de l'agence (17 §3.2.3, ADR-034).
- **Déclencheur** : création d'un véhicule (wizard ou import CSV) ; chargement de la graine par migration.
- **Prérequis** : aucun.
- **Parcours principal** : l'agence (ou l'ops) choisit marque → modèle → année → finition ; les caractéristiques sont préremplies depuis la variante et restent modifiables au niveau du véhicule.
- **Parcours alternatifs** : modèle absent → « Autre » avec marque et modèle libres → demande d'ajout (ADM-036), véhicule en brouillon ; valeur EPA absente → champ vide, jamais bloquant.
- **Règles métier** : BR-LIST-04 (données requises du wizard, lien inscrit dans 04 le 2026-10-30, résidu VERIF_18-F17) ; règles du catalogue dans 17 ADR-034 (source et licence obligatoires, aucune aspiration de Turo, d'annonces ou de sites constructeurs, aucune photo de tiers).
- **États** : marque, modèle, variante `ACTIVE`, `PENDING_REVIEW`, `RETIRED`.
- **Erreurs** : `CATALOG_SOURCE_MISSING` (ligne sans source ni licence) ; `CATALOG_VARIANT_RETIRED`.
- **Données** : `vehicle_make`, `vehicle_model`, `vehicle_variant` (17 §3.2.3) ; `vehicle.variant_id`.
- **Notifications** : —
- **Permissions** : `ADMIN`, `OPS_AGENT` (écriture) ; lecture publique des noms et caractéristiques.
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given une ligne de graine sans `license_note`, When la migration est jouée, Then elle échoue et aucune ligne n'est chargée. Given un Toyota Hilux de la graine, When l'agence le choisit, Then places, boîte, carburant et transmission intégrale sont préremplis. Given une consommation issue de l'EPA, When elle est affichée, Then elle porte la mention « référence US ».
- **Source** : `sources/SRC_VEHICLE_DATA.md` (§5, §6) ; 17 ADR-034 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — graine curée par l'ops chargée par migration, sans écran d'administration.
- **Complexité** : moyenne ; ops moyen (curation de la graine) ; risque faible (licences à valider, OQ-CAT-01).
- **Améliorations possibles** : décodage VIN en *best effort* (HST-007, P1) ; enrichissement sous licence (HST-051, P2) ; pages SEO par marque et modèle (SRC-033, P1).

#### Fiche ADM-036 — File d'ajout au catalogue véhicules
- **FEATURE ID** : ADM-036
- **Nom** : File d'ajout au catalogue véhicules
- **Module** : Back-office (ADM — Files de revue ; rattachée à E7)
- **Persona** : PER-07
- **Objectif** : intégrer au catalogue les modèles que les agences ne trouvent pas, sans laisser publier un véhicule non rattaché.
- **Description** : `catalog_addition_request` alimentée par « Autre » (HST-011) et par les lignes non reconnues de l'import (FLT-011) ; l'ops rapproche d'une variante existante, crée marque, modèle ou variante (source et licence obligatoires) ou refuse ; à l'approbation, le véhicule en attente reçoit `variant_id` ; délai `catalog_addition_sla_business_h` (PROPOSÉ 24 h ouvrées).
- **Déclencheur** : demande d'ajout créée.
- **Prérequis** : HST-050.
- **Parcours principal** : demande → rapprochement ou création → approbation → rattachement du véhicule → notification au demandeur.
- **Parcours alternatifs** : doublon d'une variante existante → fusion (`MERGED`) ; refus motivé → le véhicule reste en brouillon.
- **Règles métier** : aucune règle de 08 ; 17 ADR-034.
- **États** : `OPEN` → `APPROVED` / `MERGED` / `REJECTED`.
- **Erreurs** : `CATALOG_REQUEST_DUPLICATE`.
- **Données** : `catalog_addition_request` (17 §3.2.3) ; `review_queue_item` de type `CATALOG_ADDITION`.
- **Notifications** : événement `catalog.addition_request.resolved` (17 §4.5) vers le demandeur.
- **Permissions** : `OPS_AGENT`, `ADMIN`.
- **Dépendances** : HST-050.
- **Critères d'acceptation** : Given une ligne d'import « Chery Tiggo 2 » absente du catalogue, When l'import est appliqué, Then une demande d'ajout est créée et aucune annonce n'est publiée pour ce véhicule. Given la demande approuvée, When l'ops la clôt, Then le véhicule reçoit sa variante et le demandeur est notifié.
- **Source** : `sources/SRC_VEHICLE_DATA.md` §5 ; 17 ADR-034 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — file traitée par l'ops dans la console, formulaire d'ajout minimal.
- **Complexité** : faible ; ops moyen ; risque faible.
- **Améliorations possibles** : tableau de couverture du catalogue par marque et par pays ; demandes groupées par fréquence.

#### Fiche FLT-011 — Import en masse d'annonces
- **FEATURE ID** : FLT-011
- **Nom** : Import en masse d'annonces (CSV)
- **Module** : Disponibilité & flotte (FLT — Intégrations ; rattachée à E7)
- **Persona** : PER-03 ; PER-07
- **Objectif** : onboarder 10 à 300 véhicules sans saisie unitaire.
- **Description** : CSV (gabarit versionné) : véhicule (HST-011), prix (PRC-001), distance (HST-033), lieu, photos (URL ou archive), documents ; validation ligne par ligne, rapport d'erreurs, création en `DRAFT` puis revue (ADM-003). API : P1 (FLT-010).
- **Déclencheur** : téléversement par l'agence ou l'ops.
- **Prérequis** : HST-011, ADM-003.
- **Parcours principal** : upload → simulation (dry-run) → rapport → confirmation → création.
- **Parcours alternatifs** : erreurs partielles → lignes valides créées, lignes invalides rapportées ; réimport → mise à jour par plaque (idempotent).
- **Règles métier** : BR-LIST-04.
- **États** : import_job `UPLOADED` → `VALIDATED` → `APPLIED` / `FAILED`.
- **Erreurs** : `IMPORT_SCHEMA`, `IMPORT_ROW_INVALID` (par ligne).
- **Données** : fleet_import_job(id, org_id, file_ref, rows_ok, rows_ko, report_ref).
- **Notifications** : `EVT_IMPORT_DONE`.
- **Permissions** : `AGENCY_MANAGER`, `OPS_AGENT`.
- **Dépendances** : HST-011 ; ADM-003 ; HST-050 ; ADM-036.
- **Critères d'acceptation** : Given un CSV de 50 lignes dont 3 invalides, When il est appliqué, Then 47 véhicules en `DRAFT` et un rapport des 3 erreurs. Given le même CSV réimporté, When il est appliqué, Then aucun doublon (clé = plaque).
- **Source** : 12 §10.3 (pro-first) ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — import CSV lancé par l'ops, rapport d'erreurs en fichier ; chaque ligne rapprochée du catalogue (HST-050), lignes non reconnues envoyées à la file d'ajout (ADM-036), jamais publiées (aligné v4).
- **Complexité** : moyenne ; ops moyen ; risque faible.
- **Améliorations possibles** : API et onboarding express 48 h (FLT-010, FLT-019, P1).

#### Fiche HDB-001 / HDB-002 — Tableau de bord et liste des trips de l'agence
- **FEATURE ID** : HDB-001, HDB-002
- **Nom** : Tableau de bord hôte (HDB-001) ; liste des trips de l'hôte (HDB-002)
- **Module** : Espace agence & annonces (HDB — Tableau de bord, Trajets)
- **Persona** : PER-03, PER-04
- **Objectif** : piloter l'activité de l'agence sur la plateforme.
- **Description** : HDB-001 (absorbe ACC-027, ACC-028) : accès trips, véhicules, lieux, relevés, mises à jour récentes. HDB-002 : onglets À venir / En cours / Terminés / Annulés ; colonnes n° de réservation, véhicule et plaque, conducteur, début/fin, lieu, statut du paiement (payé chez l'agence, en attente, remboursé), caution déclarée, actions (ouvrir, check-in, contacter) ; filtres lieu/date ; export CSV en P1.
- **Déclencheur** : connexion à l'espace agence.
- **Prérequis** : ACC-029 ; FLT-003.
- **Parcours principal** : liste → ouverture d'un trip → action.
- **Parcours alternatifs** : agent comptoir → seulement ses lieux.
- **Règles métier** : BR-COHOST-02 (permissions) ; aucune autre BR.
- **États** : affichage SM-1.
- **Erreurs** : `FORBIDDEN_LOCATION`.
- **Données** : vues trip_list par société et lieu.
- **Notifications** : —
- **Permissions** : `AGENCY_MANAGER` (tout), `AGENCY_COUNTER_AGENT` (ses lieux), `AGENCY_ACCOUNTANT` (relevés).
- **Dépendances** : HDB-001 → ACC-029 ; HDB-002 → HDB-001, FLT-003.
- **Critères d'acceptation** : Given une confirmation à 10:00, When l'agence rafraîchit à 10:01, Then le trip apparaît. Given un agent du lieu A, When il appelle la liste du lieu B, Then `FORBIDDEN_LOCATION`.
- **Source** : SRC_H §7 (H110, H137) ; écrans 10b : A02, A05.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1 / lot 2)
- **Bêta pilote** : HDB-001 MANUEL — pas de tableau de bord, l'agence utilise la liste des trips ; HDB-002 OUI.
- **Complexité** : moyenne / faible ; ops faible ; risque faible.
- **Améliorations possibles** : tableau de revenus et simulateur (15 IMP-24).

## E8 — Trip : remise, retour et preuves (P0-A, 12 lignes)

#### Fiche TRP-045 — Machine à états du trip
- **FEATURE ID** : TRP-045
- **Nom** : Machine à états du trip
- **Module** : Opérations de trip (TRP — Cycle de vie)
- **Persona** : technique ; tous
- **Objectif** : un état unique et cohérent du trip, source de toutes les règles.
- **Description** : implémentation de SM-1 (QUOTE → HOLD → BOOKED → CHECKIN_OPEN → IN_PROGRESS → OVERDUE / RETURNED → POST_TRIP → COMPLETED / IN_DISPUTE, états d'annulation et de no-show terminaux) et de SM-1b (`requirements_status`). Invariants de 08 : IN_PROGRESS exige check-in validé + approbation conducteur ; pas d'annulation depuis IN_PROGRESS (→ TERMINATED_EARLY) ; état d'annulation = fonction du **motif qualifié** ; règlement calculé une seule fois par (trip, segment, version) ; requalification = écriture d'audit. Absorbe TRP-046.
- **Déclencheur** : événements métier (paiement, check-in, check-out, horloge, décision ops).
- **Prérequis** : BKG-014.
- **Parcours principal** : transitions gardées, journalisées, idempotentes.
- **Parcours alternatifs** : transition interdite → rejet ; événements concurrents (EC-54) → verrou par trip, premier gagnant, second requalifié selon 08.
- **Règles métier** : BR-CXL (table de décision), BR-MOD, BR-RETURN-03, BR-RETURN-04, BR-PICKUP-01, BR-CXL-08.
- **États** : SM-1, SM-1b, SM-7 (requalification).
- **Erreurs** : `TRIP_TRANSITION_FORBIDDEN`, `TRIP_CONCURRENT_UPDATE`.
- **Données** : trip(id, state, requirements_status, version), trip_event(trip_id, from, to, reason, actor, at).
- **Notifications** : chaque transition publie un événement consommé par NTF-001.
- **Permissions** : `SYSTEM` ; transitions manuelles par `OPS_AGENT` (ADM-006) avec motif.
- **Dépendances** : BKG-014.
- **Critères d'acceptation** : Given un trip IN_PROGRESS, When une annulation est demandée, Then `TRIP_TRANSITION_FORBIDDEN`. Given deux événements d'annulation simultanés (EC-54), When ils sont traités, Then un seul règlement par version. Given T05 et T06, When le no-show est déclaré par l'agence ou automatiquement, Then le règlement est identique (invariance à l'initiateur). Given T25, When une annulation guest arrive à T+75 min, Then elle est requalifiée `GUEST_NO_SHOW`.
- **Source** : 08 SM-1 ; écrans 10b : S08, S09, A02.
- **Confiance** : proposé (notre modèle, dérivé des règles documentées).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — états BOOKED, IN_PROGRESS, OVERDUE, COMPLETED, CANCELLED seulement ; litige suivi hors machine à états.
- **Complexité** : élevée ; ops faible ; risque moyen.
- **Améliorations possibles** : états de modification/extension (P1).

#### Fiche TRP-056 — Évaluation du risque PWA sur iOS
- **FEATURE ID** : TRP-056
- **Nom** : Évaluation du risque PWA sur iOS (caméra, hors ligne) et repli
- **Module** : Opérations de trip (TRP — Check-in / check-out)
- **Persona** : équipe ; PER-04
- **Objectif** : décider la technique de capture avant de construire la preuve.
- **Description** : test de 1 à 2 semaines (lot 0) sur les appareils réels des agences pilotes : capture caméra sans import de galerie, persistance du stockage hors ligne (purge iOS possible), envoi différé, géolocalisation, poids des photos. PWA décidée (17 ADR-039) ; décision écrite du **repli** à la fin du lot 0 (ADR-005, 22 ; constat 24-02) : PWA seule ; enveloppe native (Capacitor ou équivalent, publication stores, revue Apple) ; ou terminal Android fourni au comptoir.
- **Déclencheur** : lot 0.
- **Prérequis** : accès aux appareils des agences pilotes.
- **Parcours principal** : grille de tests par appareil → résultats → décision consignée.
- **Parcours alternatifs** : résultats mitigés → combinaison (natif pour l'agent, PWA pour le guest).
- **Règles métier** : BR-PICKUP-01 (Turo impose l'app native, DOCUMENTÉ), BR-PICKUP-03.
- **États** : decision `OPEN` → `DECIDED`.
- **Erreurs** : —
- **Données** : grille de résultats (document), decision_log.
- **Notifications** : —
- **Permissions** : équipe produit.
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given la grille, When elle est complétée, Then chaque appareil a un résultat pour chaque critère. Given aucune décision, When le lot 3 démarre, Then TRP-002 et TRP-004 ne démarrent pas.
- **Source** : VERIF_10 V10-12 ; écrans 10b : A03, A04.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : OUI.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : —

#### Fiche TRP-002 — Check-in / check-out mobile
- **FEATURE ID** : TRP-002
- **Nom** : Check-in / check-out mobile (PWA ; hors ligne dans TRP-057)
- **Module** : Opérations de trip (TRP — Check-in)
- **Persona** : PER-04 ; PER-01, PER-02
- **Objectif** : remise et retour guidés, prouvés et rapides.
- **Description** : écrans : 1) identité et permis (VER-015) ; 2) photos guidées (TRP-004) ; 3) carburant et compteur ; 4) caution prise (PAY-035), remise des clés et signature (BKG-019 si non signée) ; 5) récapitulatif. Même parcours au retour (TRP-033). Ouverture 24 h avant le début ou dès la réservation si plus tardive (ex-TRP-001). Photos ≈ 1 600 px, ≤ 500 ko. Technique selon TRP-056.
- **Déclencheur** : trip `CHECKIN_OPEN` ; arrivée du guest.
- **Prérequis** : TRP-045, VER-015, PAY-034, TRP-056 ; contrat signé.
- **Parcours principal** : 5 écrans → validation → `IN_PROGRESS` à l'heure serveur.
- **Parcours alternatifs** : étape incomplète → trip reste `CHECKIN_OPEN` ; paiement non confirmé → bloqué ; refus du véhicule (TRP-007) ; guest absent → no-show (TRP-015).
- **Règles métier** : BR-PICKUP-01, BR-PICKUP-02, BR-PICKUP-03, BR-PICKUP-04, BR-PICKUP-06, BR-PICKUP-07.
- **États** : SM-1 `BOOKED` → `CHECKIN_OPEN` → `IN_PROGRESS`.
- **Erreurs** : `CHECKIN_NOT_OPEN`, `CHECKIN_PAYMENT_NOT_CONFIRMED`, `CHECKIN_STEP_INCOMPLETE`, `CONTRACT_NOT_SIGNED`.
- **Données** : checkin(trip_id, kind=OUT|IN, steps[], fuel_level, odometer_km, agent_id, started_at, completed_at_server).
- **Notifications** : `EVT_CHECKIN_DONE` (guest, agence).
- **Permissions** : `AGENCY_COUNTER_AGENT`, `AGENCY_MANAGER` ; `GUEST` (photos et signature).
- **Dépendances** : TRP-045 ; VER-015 ; PAY-034 ; TRP-056.
- **Critères d'acceptation** : Given un check-in sans photos complètes, When l'agent valide, Then le trip ne passe pas `IN_PROGRESS`. Given un trip réservé 3 h avant le départ, When il est confirmé, Then le check-in est ouvert immédiatement. Given une file d'envoi en attente, When l'écran s'affiche, Then elle est visible.
- **Source** : 08 BR-PICKUP-01 reco ; 11 EC-15 ; écrans 10b : A03.
- **Confiance** : proposé (Turo : app native, DOCUMENTÉ).
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — en ligne seulement (wifi du comptoir), parcours de l'agent comptoir.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : contrat consultable hors ligne (15 IMP-35, P1) ; remise sans contact (P2).

#### Fiche TRP-004 — Capture in-app avec gabarit d'angles et horodatage serveur
- **FEATURE ID** : TRP-004
- **Nom** : Capture in-app avec gabarit d'angles et horodatage serveur
- **Module** : Opérations de trip (TRP — Check-in)
- **Persona** : PER-04 ; PER-01, PER-02
- **Objectif** : preuve exploitable de l'état du véhicule (litiges, ACODECO, assureur).
- **Description** : capture dans l'app uniquement (pas d'import de galerie) ; gabarit fixe de **20 photos** : 12 extérieures + 6 intérieures + carburant + compteur (emplacements `slot_code` de `inspection_photo`, 17 §3.2.10), au départ et au retour ; divergence volontaire avec 08 BR-PICKUP-03 (référence Turo : ≥ 15 extérieures + 8 intérieures) pour tenir la remise en ≤ 10 min (TRP-052) (consolidé VERIF_15-F6) (absorbe TRP-003, TRP-005, TRP-006) ; heure serveur, géolocalisation, **SHA-256 calculé à la réception**. L'empreinte prouve l'intégrité depuis la réception, pas l'absence de retouche avant l'envoi.
- **Déclencheur** : étape 2 du check-in / check-out.
- **Prérequis** : TRP-002 ; TRP-056.
- **Parcours principal** : angle guidé → capture → envoi → empreinte → case cochée.
- **Parcours alternatifs** : photo floue → reprise ; dommage existant → annotation.
- **Règles métier** : BR-PICKUP-03, BR-RETURN-01, BR-DAMAGE-02.
- **États** : photo `CAPTURED` → `RECEIVED` (empreinte).
- **Erreurs** : `PHOTO_TEMPLATE_INCOMPLETE`, `PHOTO_GALLERY_FORBIDDEN`.
- **Données** : `trip_inspection`(trip_id, kind, performed_by, status) ; `inspection_photo`(inspection_id, slot_code, file_id) ; `file_asset`(sha256 à la réception, device_captured_at, server_received_at, source `IN_APP_CAMERA`) (17 §3.2.10, §3.2.13).
- **Notifications** : —
- **Permissions** : `AGENCY_COUNTER_AGENT`, `GUEST` du trip ; lecture `OPS_AGENT` (journalisée).
- **Dépendances** : TRP-002 ; TRP-056.
- **Critères d'acceptation** : Given 19 photos sur 20 au départ (photo du compteur manquante), When l'agent valide, Then `PHOTO_TEMPLATE_INCOMPLETE`. Given une photo reçue, When on recalcule l'empreinte du fichier stocké, Then elle est identique à celle enregistrée. Indicateur M8 ≥ 95 %.
- **Source** : 08 BR-PICKUP-03 reco ; écrans 10b : A03, A04.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : OUI.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : inspection IA avant/après (CLM-035, P2).

#### Fiche TRP-057 — Mode hors ligne du check-in / check-out
- **FEATURE ID** : TRP-057
- **Nom** : Mode hors ligne du check-in / check-out
- **Module** : Opérations de trip (TRP — Check-in / check-out)
- **Persona** : PER-04 ; PER-01, PER-02
- **Objectif** : faire une remise ou un retour sans réseau, sans perdre la preuve.
- **Description** : photos et saisies stockées sur l'appareil et envoyées au retour du réseau ; horodatages appareil et serveur, écart > 2 h signalé ; file d'envoi visible ; reprise après fermeture de l'app ; technique selon TRP-056.
- **Déclencheur** : perte de réseau pendant le parcours.
- **Prérequis** : TRP-002 ; TRP-056.
- **Parcours principal** : capture locale + empreinte sur l'appareil → reconnexion → envoi → comparaison des empreintes.
- **Parcours alternatifs** : empreintes différentes → photo marquée « intégrité non vérifiée » ; écart > 2 h → signal ops.
- **Règles métier** : BR-PICKUP-03, BR-RETURN-01.
- **États** : élément de la file locale `OfflineQueue` (port de 17, ADR-005) `PENDING` → `SENT` → `VERIFIED` / `MISMATCH` ; empreinte `file_asset.sha256` recalculée à la réception.
- **Erreurs** : `OFFLINE_STORAGE_UNAVAILABLE`, `PHOTO_HASH_MISMATCH`.
- **Données** : trip_photo.device_sha256, device_ts, server_ts, clock_skew_flag.
- **Notifications** : `EVT_OFFLINE_SKEW` (ops).
- **Permissions** : comme TRP-004.
- **Dépendances** : TRP-002 ; TRP-056.
- **Critères d'acceptation** : Given un check-out sans réseau, When l'appareil se reconnecte, Then toutes les photos sont reçues avec SHA-256 identique à celui calculé sur l'appareil. Given un écart d'horloge de 3 h, When la photo est reçue, Then elle est signalée.
- **Source** : VERIF_07 F11 ; VERIF_10 V10-12 ; écrans 10b : A03, A04.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — pas de hors ligne : check-in et check-out au comptoir avec le wifi de l'agence.
- **Complexité** : élevée ; ops faible ; risque moyen.
- **Améliorations possibles** : données critiques hors ligne pour le guest (15 IMP-35).

#### Fiche TRP-052 — Interface agent comptoir
- **FEATURE ID** : TRP-052
- **Nom** : Interface agent comptoir (liste du jour, remise, retour)
- **Module** : Opérations de trip (TRP — Comptoir)
- **Persona** : PER-04
- **Objectif** : rendre la remise rapide (≤ 5 écrans, ≤ 10 min).
- **Description** : liste du jour par lieu (retraits et retours, statut paiement et KYC) ; check-in en 1 clic ; VER-015 ; saisie de la caution prise (montant, moyen) selon PAY-035 ; photos (TRP-004) ; signature ; check-out.
- **Déclencheur** : ouverture de l'espace comptoir.
- **Prérequis** : TRP-002, VER-015, FLT-003, PAY-035, TRP-004.
- **Parcours principal** : liste → trip → parcours TRP-002 → retour à la liste.
- **Parcours alternatifs** : guest en retard → affichage du compte à rebours `noShowAt` ; paiement non confirmé → bouton désactivé avec motif.
- **Règles métier** : BR-PICKUP-01, BR-PICKUP-04, BR-PICKUP-05.
- **États** : SM-1 (lecture et transitions via TRP-002).
- **Erreurs** : `FORBIDDEN_LOCATION`, `DEPOSIT_NOT_RECORDED`.
- **Données** : vue daily_board(location_id, date).
- **Notifications** : —
- **Permissions** : `AGENCY_COUNTER_AGENT` (ses lieux).
- **Dépendances** : TRP-002 ; VER-015 ; FLT-003 ; PAY-035 ; TRP-004.
- **Critères d'acceptation** : Given le pilote, When on mesure 20 remises, Then médiane ≤ 10 min et ≤ 5 écrans (M4). Given un check-in sans caution saisie, When l'agent termine, Then `DEPOSIT_NOT_RECORDED`.
- **Source** : VERIF_07 NEW-06 ; 15 IMP-19 ; écrans 10b : A03.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — liste du jour, check-in/out, saisie de la caution.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : console Pro multi-agences (15 IMP-19, P1).

#### Fiche TRP-007 — Refus du véhicule au départ
- **FEATURE ID** : TRP-007
- **Nom** : Refus du véhicule au départ
- **Module** : Opérations de trip (TRP — Check-in)
- **Persona** : PER-01, PER-02
- **Objectif** : protéger le guest face à un véhicule sale ou dangereux.
- **Description** : bouton « No acepto el vehículo » avant check-in : photos, motif, contact support ; remboursement intégral (BR-CXL-04) ou relogement.
- **Déclencheur** : inspection au départ.
- **Prérequis** : TRP-002, VER-015.
- **Parcours principal** : refus → photos → ticket support → décision ops → `REFUSED_AT_PICKUP` → remboursement intégral (PAY-021) ou nouveau véhicule.
- **Parcours alternatifs** : check-in déjà fait → plus de refus possible (passer par un incident).
- **Règles métier** : BR-CXL-04, BR-CSP-03, BR-PICKUP-06.
- **États** : SM-1 `CHECKIN_OPEN` → `REFUSED_AT_PICKUP`.
- **Erreurs** : `REFUSAL_AFTER_CHECKIN`.
- **Données** : refusal(trip_id, reason, photos[], decided_by).
- **Notifications** : `EVT_VEHICLE_REFUSED` (support, agence).
- **Permissions** : `GUEST` ; décision `OPS_AGENT`.
- **Dépendances** : TRP-002 ; VER-015.
- **Critères d'acceptation** : Given un refus validé, When le règlement est calculé, Then remboursement 128,40 pour PA1 (TA01-équivalent, motif FULL) et pénalité éventuelle de l'agence selon ADM-031.
- **Source** : SRC_G 4.1.6 ; 6.6.4 ; 11 EC-04 ; écrans 10b : S09, A03.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — refus signalé au support et traité par l'ops (remboursement par l'agence ou relogement).
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : échange de véhicule (BR-MOD-08, P1).

#### Fiche TRP-015 — Déclaration de no-show guest par l'agence
- **FEATURE ID** : TRP-015
- **Nom** : Déclaration de no-show guest par l'hôte (agence)
- **Module** : Opérations de trip (TRP — No-show)
- **Persona** : PER-04, PER-03
- **Objectif** : régler équitablement l'absence du guest.
- **Description** : déclaration après `noShowAt` = début + `noShowGraceMinutes` (défaut 60, OQ-BR-33), sous 72 h ; preuve : message tracé + présence au comptoir (géolocalisation proposée) ; à défaut, déclaration automatique à T+72 h (absorbe TRP-014). Éligibilité de l'agence à la retenue : message tracé dans le fil du trip et attente de 15 min (08 BR-CXL-08 ; T38, T39 pour le modèle P0-B). **P0-A, agence inéligible** (la plateforme ne détient aucun fonds, la retenue ne peut pas « revenir à la plateforme ») : paramètre `p0a_ineligible_no_show_outcome`, défaut **`REFUND_GUEST`** (PROPOSÉ, fail-closed : no-show non établi selon le protocole ⇒ retenue 0, remboursement intégral exécuté par l'agence, commission 0 ; valeur absente ou inconnue ⇒ `REFUND_GUEST`) ; alternatives `PROTOCOL_PENALTY` (retenue appliquée, pénalité égale à la retenue HT portée sur la facture de commission ; dépend d'OQ-BR-24 et OQ-MK-06) et `AGENCY_KEEPS` (non recommandée : supprime l'incitation au protocole) ; **décision ouverte OQ-BR-45** ; vecteur TA11 (consolidé VERIF_15-F3 ; 08 BR-CXL-08 variante P0-A).
- **Déclencheur** : `START_WINDOW_EXPIRED`.
- **Prérequis** : TRP-045.
- **Parcours principal** : déclaration → preuves → `NO_SHOW_GUEST` → règlement (BR-CXL-08).
- **Parcours alternatifs** : le guest conteste → SM-7 ; check-in tardif accepté par l'agence → `IN_PROGRESS`.
- **Règles métier** : BR-CXL-08, BR-CXL-09, BR-PICKUP-04, BR-CXL-15.
- **États** : SM-1 `CHECKIN_OPEN` → `START_WINDOW_EXPIRED` → `NO_SHOW_GUEST` ; SM-7.
- **Erreurs** : `NO_SHOW_TOO_EARLY`, `NO_SHOW_WINDOW_CLOSED`.
- **Données** : no_show(trip_id, declared_by, at, evidence[]). ; paramètre `p0a_ineligible_no_show_outcome`.
- **Notifications** : `EVT_NO_SHOW_DECLARED` (guest, ops).
- **Permissions** : `AGENCY_COUNTER_AGENT`, `AGENCY_MANAGER` ; `SYSTEM` (automatique).
- **Dépendances** : aucune dans 04 (utilise TRP-045).
- **Critères d'acceptation** : Given T+50 min (grâce 60), When l'agence déclare, Then `NO_SHOW_TOO_EARLY`. Given T05/T06, When le no-show est déclaré, Then résultat identique quel que soit l'initiateur. Given PA1 en P0-A, When no-show, Then remboursement 42,80 (TA03). Given TA11 (PA1, no-show déclaré sans message tracé, paramètre absent), When le no-show est réglé, Then retenue 0,00, remboursement 128,40 exécuté par l'agence et commission 0,00 ; avec `PROTOCOL_PENALTY` explicite : remboursement 42,80 et pénalité 80,00 ; avec `AGENCY_KEEPS` : remboursement 42,80 et commission 9,60 (consolidé VERIF_15-F3).
- **Source** : SRC_H §6 ; 11 EC-01 ; écrans 10b : A02, A05.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — no-show déclaré au support, constaté par l'ops.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : géolocalisation de l'agent au comptoir.

#### Fiche TRP-033 — Check-out avec photos de retour
- **FEATURE ID** : TRP-033
- **Nom** : Check-out avec photos de retour
- **Module** : Opérations de trip (TRP — Check-out)
- **Persona** : PER-04 ; PER-01, PER-02
- **Objectif** : clôturer le trip avec la preuve de l'état au retour.
- **Description** : extérieur, intérieur, carburant, compteur, clés ; heure serveur = fin effective ; même gabarit que le départ (TRP-004) ; calcul du dépassement de km et du carburant affiché à l'agence (facturés par l'agence en P0-A).
- **Déclencheur** : retour au comptoir.
- **Prérequis** : TRP-004.
- **Parcours principal** : photos → relevés → validation → `RETURNED` → `POST_TRIP` (fenêtres : dommage 24 h, ADM-031).
- **Parcours alternatifs** : retour en retard → `OVERDUE` → `RETURNED` avec frais de l'agence (TRP-035).
- **Règles métier** : BR-RETURN-01, BR-RETURN-02, BR-FUEL-01, BR-MILEAGE-03, BR-RETURN-07.
- **États** : SM-1 `IN_PROGRESS` / `OVERDUE` → `RETURNED` → `POST_TRIP` → `COMPLETED`.
- **Erreurs** : `PHOTO_TEMPLATE_INCOMPLETE`.
- **Données** : checkin(kind=IN).
- **Notifications** : `EVT_CHECKOUT_DONE` (guest, agence).
- **Permissions** : `AGENCY_COUNTER_AGENT`.
- **Dépendances** : TRP-004.
- **Critères d'acceptation** : Given un check-out à 10:20 serveur, When il est validé, Then la fin effective est 10:20 et la commission du trip devient due à `COMPLETED`.
- **Source** : SRC_G 6.2.2 ; écrans 10b : A04.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — même parcours et même gabarit que le départ.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : kilométrage par télématique.

#### Fiche TRP-035 — Détection automatique du retard et grille de frais
- **FEATURE ID** : TRP-035
- **Nom** : Détection automatique du retard et grille de frais
- **Module** : Opérations de trip (TRP — Retard)
- **Persona** : PER-07 ; PER-01, PER-02 ; PER-03
- **Objectif** : réagir vite à un retard et appliquer une grille connue d'avance.
- **Description** : sans check-out à fin + `overdue_detection_minutes` (30 min, 04 et 17 §7.2 ; cohérent avec la franchise 0–29 min de la grille ; consolidé VERIF_15-F9) → `OVERDUE`, alerte guest et agence ; à +2 h → escalade TRP-038. Grille = celle de l'agence, défauts ADM-031, affichée au contrat ; en P0-A facturée et encaissée par l'agence. Référence Turo : 0–29 min gratuit, ½ jour, 1 jour + 20 $. **OQ-BR-04 ouverte** (retard vs extension, frontière de jour) : valeurs paramétrées, non codées.
- **Déclencheur** : tâche planifiée (chaque minute, PROPOSÉ).
- **Prérequis** : TRP-033, ADM-031.
- **Parcours principal** : fin + grâce dépassée → `OVERDUE` → notifications → retour → frais calculés pour information.
- **Parcours alternatifs** : retour avant l'escalade → `RETURNED` ; conflit avec le trip suivant (EC-19) → alerte ops pour relogement.
- **Règles métier** : BR-RETURN-03, BR-CXL-00, BR-BOOK-05.
- **États** : SM-1 `IN_PROGRESS` → `OVERDUE` → `RETURNED` / `UNRETURNED`.
- **Erreurs** : —
- **Données** : params `overdue_detection_minutes`, `late_fee_grid` par agence ; trip.overdue_at.
- **Notifications** : `EVT_TRIP_OVERDUE` (WhatsApp/SMS guest, agence), `EVT_RETURN_REMINDER` (H-2).
- **Permissions** : `SYSTEM`.
- **Dépendances** : TRP-033 ; ADM-031.
- **Critères d'acceptation** : Given une fin à 10:00 et `overdue_detection_minutes` = 30 (valeur de test du paramètre ; la grille et la frontière retard / extension restent dépendantes d'OQ-BR-04, consolidé VERIF_15-F12), When il est 10:29, Then pas d'OVERDUE ; à 10:30, OVERDUE et alerte envoyée une seule fois (EC-17, EC-18). Given un changement de la valeur de grâce après décision OQ-BR-04, When il est publié, Then seuls les trips réservés ensuite l'appliquent.
- **Source** : SRC_G 6.3.1 ; 11 EC-17, EC-18, EC-19 ; écrans 10b : A11.
- **Confiance** : documenté (grille Turo) ; détection automatique proposée.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — détection OVERDUE et alerte ; grille appliquée par l'agence.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : extension en libre-service depuis l'alerte (P1).

#### Fiche TRP-038 — Procédure de non-restitution graduée
- **FEATURE ID** : TRP-038
- **Nom** : Procédure de non-restitution graduée
- **Module** : Opérations de trip (TRP — Non-restitution)
- **Persona** : PER-07, PER-03
- **Objectif** : récupérer le véhicule ou outiller la plainte de l'agence.
- **Description** : manuelle en bêta : T+2 h contact guest et agence ; T+6 h mise en demeure écrite (gabarit) et demande de position GPS à l'agence si le véhicule en a un ; T+24 h plainte pré-remplie (DIJ) fournie à l'agence, qui la dépose. Frais selon le contrat de l'agence (référence Turo 500 $). Récupération par la plateforme exclue (OQ-BR-17). Mises en demeure au nom de l'agence sous mandat LEG-020.
- **Déclencheur** : `OVERDUE` + 2 h.
- **Prérequis** : TRP-035.
- **Parcours principal** : tâches horodatées dans ADM-022 → `UNRETURNED` → retour (`RETURNED`) ou vol (`VEHICLE_LOST`, SM-4 vol).
- **Parcours alternatifs** : guest joint et retour promis → suivi sans escalade, décision tracée.
- **Règles métier** : BR-RETURN-04, BR-DAMAGE-10, BR-TRUST-05.
- **États** : SM-1 `OVERDUE` → `UNRETURNED` → `RETURNED` / `VEHICLE_LOST` ; SM-4 `THEFT_INVESTIGATION`.
- **Erreurs** : —
- **Données** : escalation(trip_id, step, at, by, documents[]).
- **Notifications** : `EVT_UNRETURNED_ESCALATION` (ops, agence).
- **Permissions** : `OPS_AGENT`.
- **Dépendances** : TRP-035.
- **Critères d'acceptation** : Given un trip OVERDUE depuis 2 h, When la tâche tourne, Then une tâche ops « contact » est créée ; à 6 h, le gabarit de mise en demeure est généré ; à 24 h, la plainte pré-remplie.
- **Source** : TOS-GUEST ; 11 EC-20 ; écrans 10b : A02.
- **Confiance** : documenté (frais Turo) ; escalade horaire proposée.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — procédure manuelle avec gabarits.
- **Complexité** : moyenne ; ops élevé ; risque élevé.
- **Améliorations possibles** : intégration des GPS existants (TRP-055, P1).

#### Fiche CLM-034 — Dossier de preuve exportable par trip
- **FEATURE ID** : CLM-034
- **Nom** : Dossier de preuve exportable par trip
- **Module** : Sinistres & protection (CLM — Preuves ; rattachée à E8)
- **Persona** : PER-07, PER-03, PER-01/02
- **Objectif** : un dossier complet pour ACODECO, chargebacks, assureur.
- **Description** : contrat et constancia, versions des CGU acceptées, photos départ/retour avec heure serveur et SHA-256, messages, journal d'événements du trip, décisions ; export PDF + ZIP avec manifeste des empreintes ; conservation selon LEG-009.
- **Déclencheur** : demande ops/agence/guest ; ouverture d'un litige.
- **Prérequis** : TRP-004, MSG-001, LEG-009.
- **Parcours principal** : génération asynchrone → lien de téléchargement signé et limité dans le temps.
- **Parcours alternatifs** : pièce manquante → listée comme absente dans le manifeste.
- **Règles métier** : BR-DAMAGE-04, BR-DAMAGE-02, BR-PAY-11.
- **États** : export `REQUESTED` → `READY` → `EXPIRED`.
- **Erreurs** : `EVIDENCE_EXPORT_FAILED`.
- **Données** : evidence_export(trip_id, manifest, sha256s, requested_by, expires_at).
- **Notifications** : `EVT_EVIDENCE_READY`.
- **Permissions** : `OPS_AGENT` ; `AGENCY_MANAGER` (ses trips) ; `GUEST` (ses trips, sans données d'autres personnes).
- **Dépendances** : TRP-004 ; MSG-001 ; LEG-009.
- **Critères d'acceptation** : Given un trip terminé, When l'export est généré, Then le manifeste liste chaque fichier avec son SHA-256 et chaque empreinte correspond au fichier. Given un trip avec 40 photos, contrat, constancia et 30 messages, When l'export est demandé, Then il est prêt en ≤ 10 min et son lien expire après 7 j (seuils PROPOSÉS ; consolidé VERIF_15-F7).
- **Source** : VERIF_07 NEW-08 ; 12 §3.7 ; VERIF_06 V6-17 ; écrans 10b : A09.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — export ZIP (photos, contrat, messages, journal) sans PDF mis en page.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : horodatage qualifié tiers.

## E9 — Annulations et protection (police flotte) (P0-A, 6 lignes)

#### Fiche BKG-028 — Annulation par le guest en libre-service
- **FEATURE ID** : BKG-028
- **Nom** : Annulation par le guest en libre-service
- **Module** : Réservation & contrat (BKG — Annulation)
- **Persona** : PER-01, PER-02
- **Objectif** : annuler et connaître immédiatement le remboursement.
- **Description** : Mes trips → Annuler ; écran de prévisualisation du règlement (montant remboursé TTC, ITBMS, délai bancaire) calculé par `computeCancellationSettlement` (BR-CXL, paramètres ADM-031) ; confirmation → exécution PAY-021. Absorbe BKG-029.
- **Déclencheur** : demande du guest.
- **Prérequis** : BKG-027, PAY-021.
- **Parcours principal** : prévisualisation → confirmation → `CANCELLED_BY_GUEST` → remboursement planifié.
- **Parcours alternatifs** : après `noShowAt` → requalifiée no-show (T25) ; tarif non remboursable : P1 ; exceptions (BR-CXL-09/10) → via support.
- **Règles métier** : BR-CXL-01, BR-CXL-03, BR-CXL-06, BR-CXL-08, BR-CXL-09, BR-CXL-10, BR-CXL-00.
- **États** : SM-1 `BOOKED` / `CHECKIN_OPEN` → `CANCELLED_BY_GUEST` (ou `NO_SHOW_GUEST` si requalifiée) ; SM-8.
- **Erreurs** : `CANCEL_NOT_ALLOWED_IN_PROGRESS`.
- **Données** : settlement(trip_id, version, reason, qualification, refund_minor, tax_refund_minor, retained_minor, penalty_minor, computed_at).
- **Notifications** : `EVT_BOOKING_CANCELLED` (guest, agence).
- **Permissions** : `GUEST` du trip.
- **Dépendances** : BKG-027 ; PAY-021.
- **Critères d'acceptation** : Given TA01, TA02, TA05, TA06, When l'annulation a lieu aux horodatages indiqués, Then les remboursements sont 128,40 / 85,60 / 64,20 / 24,07. Given T02 (exactement T−24 h), When le guest annule, Then remboursement intégral (borne incluse). Given T23 et T24, When la réservation est de dernière minute, Then `freeUntil = min(bookedAt + 60 min, start)`. Given T25, When l'annulation arrive à T+75 min, Then requalification no-show.
- **Source** : SRC_G 4.1.1–4.1.4 ; écrans 10b : S10.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ (aligné v4, C-v3-01) — annulation demandée au support et déclenchée par l'ops (ADM-006) ; montant calculé par le moteur de règlement (sous-ensemble Bêta), jamais saisi par l'ops ; exécution par l'agence (PAY-021).
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : crédit de rebooking (P1).

#### Fiche BKG-032 — Annulation par l'agence avec motif et pénalités
- **FEATURE ID** : BKG-032
- **Nom** : Annulation par l'hôte (agence) avec motif et pénalités
- **Module** : Réservation & contrat (BKG — Annulation)
- **Persona** : PER-03
- **Objectif** : rembourser intégralement le guest et dissuader les annulations d'agence.
- **Description** : motif obligatoire ; guest remboursé intégralement (PAY-021) et aidé à rebooker par le support ; pénalité = montant ADM-031 (À DÉCIDER ; référence Turo 25/50 $ selon délai, 150 $ no-show agence) portée sur la facture de commission (FIN-018). Motif « à cause du guest » avec preuve validée → no-show guest (T07) ; sans preuve → annulation agence (T08). Pas d'avis automatique ni de recul en recherche en bêta.
- **Déclencheur** : action de l'agence.
- **Prérequis** : BKG-028, ADM-031, PAY-021, FIN-018.
- **Parcours principal** : motif → confirmation → `CANCELLED_BY_HOST` → remboursement → ligne de pénalité.
- **Parcours alternatifs** : exemption (BR-CXL-13, portée OQ-BR-37) → décision ops ; no-show agence (absente à T+30 min, T26) → `NO_SHOW_HOST`.
- **Règles métier** : BR-CXL-12, BR-CXL-13, BR-HP-03.
- **États** : SM-1 → `CANCELLED_BY_HOST` / `NO_SHOW_GUEST` / `NO_SHOW_HOST`.
- **Erreurs** : `CANCEL_REASON_REQUIRED`.
- **Données** : settlement (penalty_minor), penalty_line(org_id, trip_id, amount, status).
- **Notifications** : `EVT_BOOKING_CANCELLED_BY_AGENCY` (guest, support).
- **Permissions** : `AGENCY_MANAGER`.
- **Dépendances** : BKG-028 ; ADM-031 ; PAY-021 ; FIN-018.
- **Critères d'acceptation** : Given TA04, When l'agence annule à T−30 h puis à exactement T−24 h, Then remboursement 128,40 et pénalités `gt24h` puis `le24h` (borne incluse côté « ≤ 24 h », T14/T15). Given T62, When la pénalité est stockée, Then en unités mineures (2 500 = 25,00 USD avec les valeurs de test). Given T07/T08, When le motif « à cause du guest » est utilisé, Then la qualification dépend de la preuve validée.
- **Source** : SRC_G 4.2.5 ; SRC_H §6 ; écrans 10b : A05.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ (aligné v4, C-v3-01) — annulation par l'agence via le support, déclenchée par l'ops ; remboursement et pénalité calculés par le moteur, pénalité portée au relevé de commission.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : seuils de performance agence (BR-HP-03, P1).

#### Fiche BKG-035 — Annulation par la plateforme
- **FEATURE ID** : BKG-035
- **Nom** : Annulation par la plateforme
- **Module** : Réservation & contrat (BKG — Annulation)
- **Persona** : PER-07
- **Objectif** : annuler pour sécurité, conformité ou défaillance, en disant qui paie.
- **Description** : motifs : T&S, rappel de sécurité, fermeture du compte de l'agence, checklist incomplète, retard de revue, panne PSP ; par l'ops via ADM-006, motif obligatoire. Guest remboursé intégralement (sauf `PLATFORM_INCOMPLETE_STEPS` imputable au guest : partiel, T16) sur le compte PSP de l'agence (PAY-021). Coût : agence si cause imputable (pénalité ADM-031), sinon avoir commercial plafonné (ADM-007 ; **plafond 0 tant que DEC-FONDATEUR-01 est ouverte**, TA09 ; consolidé VERIF_15-F11). **Indemnisation de l'agence par la plateforme : DEC-FONDATEUR-01 OUVERTE** — paramètre `platform_funded_host_compensation` absent = false. Yappy : l'agence rembourse par virement sous 5 j ouvrés avec preuve, à défaut pénalité et escalade (LEG-025).
- **Déclencheur** : décision ops ; FAILED de SM-1b à T−2 h.
- **Prérequis** : ADM-006, PAY-021, ADM-007, ADM-031.
- **Parcours principal** : motif → qualification → règlement → remboursement → imputation du coût.
- **Parcours alternatifs** : agence fermée (T22) → remboursement intégral, aucun gain ; sanction non prouvée → motif `RISK_SUSPENSION_UNPROVEN`.
- **Règles métier** : BR-CXL-14, BR-CXL-07, BR-LIST-06, BR-TRUST-05.
- **États** : SM-1 → `CANCELLED_BY_PLATFORM` ; SM-1b `FAILED`.
- **Erreurs** : `CANCEL_REASON_REQUIRED`, `COST_BEARER_REQUIRED`.
- **Données** : settlement(reason, cost_bearer, platform_funded_host_compensation_flag_value).
- **Notifications** : `EVT_BOOKING_CANCELLED_BY_PLATFORM` (guest, agence).
- **Permissions** : `OPS_AGENT` (motif, coût), `ADMIN`.
- **Dépendances** : ADM-006 ; PAY-021 ; ADM-007 ; ADM-031.
- **Critères d'acceptation** : Given T61(a) (paramètre absent), When `PLATFORM_REVIEW_DELAY` à T−2 h, Then compensation agence 0,00. Given le paramètre `true` explicite (option A, non décidée), When T17/T18/T20 sont rejoués, Then 45,00 / 45,00 / 75,00 (configuration de test) — ce test reste désactivé tant que DEC-FONDATEUR-01 n'est pas tranchée. Given T16, When `PLATFORM_INCOMPLETE_STEPS` imputable au guest, Then remboursement partiel 187,44. Given T19 et T22, When annulation T&S à T−30 h ou fermeture de compte, Then aucun gain agence. Given chaque annulation plateforme, When elle est enregistrée, Then `cost_bearer` est renseigné.
- **Source** : 08 BR-CXL-14 ; écrans 10b : S09.
- **Confiance** : documenté (base) ; imputation du coût proposée.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ (aligné v4, C-v3-01) — annulation plateforme par l'ops (ADM-006) ; remboursement calculé par le moteur, exécuté par l'agence et suivi par l'ops.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : relogement automatique.

#### Fiche PRT-009 — Mode « police flotte du loueur »
- **FEATURE ID** : PRT-009
- **Nom** : Mode « police flotte du loueur »
- **Module** : Sinistres & protection (PRT — Pro)
- **Persona** : PER-03 ; PER-07
- **Objectif** : couvrir chaque trip par l'assurance commerciale de l'agence, sans vendre de protection en P0.
- **Description** : chaque agence couvre ses véhicules par sa police ; la plateforme vérifie la clause « plateforme » (OQ-MK-05, PRT-019) et reprend franchises et exclusions sur la fiche et au contrat. Contrôle ops ≈ 1–2 h par agence et par police ; alerte 30 j avant expiration.
- **Déclencheur** : onboarding ; renouvellement.
- **Prérequis** : PRT-019, VER-027.
- **Parcours principal** : lecture → saisie dans PRT-019 → affichage LST-013 → contrat BKG-018.
- **Parcours alternatifs** : refus de l'assureur sur un sinistre (EC-47) → le guest reste responsable dans la limite du contrat de l'agence ; dossier CLM-006.
- **Règles métier** : BR-PROT-06 (plans hôte US, référence non reprise), BR-PROT-01, BR-PROT-03, BR-PROT-04.
- **États** : insurance_policy (voir PRT-019).
- **Erreurs** : voir PRT-019.
- **Données** : insurance_policy.
- **Notifications** : voir PRT-019.
- **Permissions** : `OPS_AGENT`.
- **Dépendances** : PRT-019 ; VER-027.
- **Critères d'acceptation** : Given un véhicule sans police vérifiée, When il est publié, Then refus. Given la fiche et le contrat, When on compare franchises et exclusions, Then textes identiques.
- **Source** : 12 §9.4 ; SRC_H §8 (programme BYOI ancien, semble supprimé) ; écrans 10b : S03.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : MANUEL — vérification de la clause « plateforme » par l'ops sur l'attestation.
- **Complexité** : moyenne ; ops élevé ; risque élevé.
- **Améliorations possibles** : assureur partenaire (IMP-14, P1 si OQ-BR-16).

#### Fiche PRT-003 / PRT-013 — RC tiers incluse et mentions de l'assureur
- **FEATURE ID** : PRT-003, PRT-013
- **Nom** : RC tiers incluse dans chaque trip (PRT-003) ; mentions de l'assureur et licences (PRT-013)
- **Module** : Sinistres & protection (PRT — Responsabilité civile, Légal)
- **Persona** : PER-01, PER-02, PER-03
- **Objectif** : garantir et afficher une RC conforme (Ley 68/2016 au minimum).
- **Description** : PRT-003 : RC tiers couverte par la police flotte, vérifiée à l'onboarding et au renouvellement (PRT-019), montant affiché sur la fiche et au contrat ; aucune RC fournie par la plateforme en P0 (OQ-BR-16 ; proposition RC primaire ≥ 100 000 USD). PRT-013 : assureur cité, « Información legal », mentions de licences dans les pages statiques.
- **Déclencheur** : affichage fiche, contrat, pages légales.
- **Prérequis** : PRT-009, PRT-019 ; LEG-011.
- **Parcours principal** : montant RC saisi → affiché ; mentions publiées.
- **Parcours alternatifs** : RC inférieure au minimum légal → police refusée.
- **Règles métier** : BR-PROT-04, BR-PROT-01.
- **États** : —
- **Erreurs** : `POLICY_RC_BELOW_MINIMUM`.
- **Données** : insurance_policy.rc_amount_minor.
- **Notifications** : —
- **Permissions** : `OPS_AGENT`.
- **Dépendances** : PRT-003 → PRT-009, PRT-019 ; PRT-013 → LEG-011.
- **Critères d'acceptation** : Given une police avec RC sous le minimum paramétré, When elle est vérifiée, Then `POLICY_RC_BELOW_MINIMUM`. Given une fiche, When elle s'affiche, Then le montant de RC est celui du contrat.
- **Source** : 10 §1, §5 ; SRC_G 3.8 ; écrans 10b : S03.
- **Confiance** : confirmé (PRT-003 OBSERVÉ chez Turo) ; documenté (PRT-013).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : PRT-003 MANUEL — montant de RC saisi par l'ops dans le bloc LST-013 ; PRT-013 SIMPLIFIÉ — mentions dans les pages statiques.
- **Complexité** : moyenne / faible ; ops moyen / faible ; risque élevé / moyen.
- **Améliorations possibles** : protections guest (P1).

## E10 — Messagerie, notifications et avis (P0-A, 8 lignes)

#### Fiche NTF-001 — Moteur de notifications multicanal
- **FEATURE ID** : NTF-001
- **Nom** : Moteur de notifications multicanal
- **Module** : Communication & réputation (NTF — Moteur)
- **Persona** : technique ; tous
- **Objectif** : prévenir la bonne personne, sur le bon canal, une seule fois.
- **Description** : événements métier → table événement × destinataires × canaux × gabarit es/en. Catalogue P0-A : compte vérifié/refusé, réservation confirmée/annulée, rappels J-1 et H-2 du retrait, H-2 du retour, retard détecté, check-in/check-out faits, réclamation ouverte/décidée, restriction, police bientôt expirée, relevé et facture émis. Canaux : email, WhatsApp (NTF-002), repli SMS, in-app. Idempotence (événement, destinataire, canal), 3 réessais, journal. Absorbe NTF-016, NTF-018.
- **Déclencheur** : événement publié.
- **Prérequis** : aucun.
- **Parcours principal** : événement → résolution des destinataires et de la langue → rendu → envoi → journal.
- **Parcours alternatifs** : échec → réessai ; WhatsApp indisponible → SMS/email.
- **Règles métier** : BR-NOTIF (catalogue).
- **États** : notification `QUEUED` → `SENT` → `DELIVERED` / `FAILED`.
- **Erreurs** : `TEMPLATE_VARIABLE_MISSING` (bloque au build/test).
- **Données** : notification(event_id, recipient, channel, template, locale, status, attempts).
- **Notifications** : (le moteur lui-même).
- **Permissions** : `SYSTEM` ; `ADMIN` (gabarits).
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given chaque événement du catalogue, When son gabarit est testé en es et en, Then aucune variable non résolue. Given un événement rejoué, When il est reçu, Then aucun doublon par destinataire et canal.
- **Source** : 08 BR-NOTIF ; SRC_G 10.9 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : documenté (catalogue Turo) ; architecture proposée.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ — email et SMS ; catalogue réduit (compte vérifié, confirmation, annulation, rappel J-1, retard).
- **Complexité** : élevée ; ops faible ; risque faible.
- **Améliorations possibles** : push in-app (P1).

#### Fiche NTF-002 — Gabarits WhatsApp Business approuvés
- **FEATURE ID** : NTF-002
- **Nom** : Gabarits WhatsApp Business approuvés
- **Module** : Communication & réputation (NTF — Canal)
- **Persona** : tous
- **Objectif** : utiliser le canal principal du Panama (15 IMP-06).
- **Description** : gabarits validés par Meta ; tant qu'ils ne sont pas approuvés ou en cas d'échec : SMS (OTP, rappels, retards) et email (confirmations, contrat, constancia, relevés). L'ouverture ne dépend pas de l'approbation Meta. Consentement aux messages transactionnels (LEG-002).
- **Déclencheur** : envoi NTF-001 sur canal WhatsApp.
- **Prérequis** : NTF-001 ; compte WhatsApp Business et BSP.
- **Parcours principal** : gabarit approuvé → envoi → accusé.
- **Parcours alternatifs** : non approuvé / échec → repli automatique vers SMS ou email.
- **Règles métier** : BR-NOTIF.
- **États** : template `SUBMITTED` → `APPROVED` / `REJECTED`.
- **Erreurs** : `WHATSAPP_TEMPLATE_NOT_APPROVED` (repli, pas bloquant).
- **Données** : wa_template(name, locale, status, fallback_channel).
- **Notifications** : —
- **Permissions** : `ADMIN`.
- **Dépendances** : NTF-001.
- **Critères d'acceptation** : Given chaque gabarit WhatsApp, When il est créé, Then un équivalent SMS ou email testé existe. Given un échec de livraison, When il est remonté, Then l'envoi passe automatiquement au canal de repli.
- **Source** : 08 BR-NOTIF reco ; 15 IMP-06 ; écrans 10b : S05.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : DIFFÉRÉ — délai d'approbation Meta ; repli SMS/email.
- **Complexité** : moyenne ; ops moyen ; risque faible.
- **Améliorations possibles** : support WhatsApp-first (15 IMP-07).

#### Fiche NTF-007 / NTF-011 — Confirmation de réservation et notifications de trip
- **FEATURE ID** : NTF-007, NTF-011
- **Nom** : Notification de réservation confirmée (NTF-007) ; notifications de trip (NTF-011)
- **Module** : Communication & réputation (NTF — Réservation, Trip)
- **Persona** : PER-01, PER-02, PER-03
- **Objectif** : réduire retards, absences et plaintes.
- **Description** : NTF-007 : à `BOOKED` — guest : WhatsApp + email avec récapitulatif, contrat, constancia (LEG-026), adresse exacte, horaires, pièces à présenter, caution (PAY-035) ; agence : email + tableau de bord (conducteur, véhicule, créneau, statut du paiement). NTF-011 : check-in ouvert, rappels de retrait (J-1, H-2), zones de retour, rappel de fin (H-2).
- **Déclencheur** : transitions SM-1 ; horloge.
- **Prérequis** : NTF-001, TRP-045, LEG-026, PAY-035 ; TRP-002 (NTF-011).
- **Parcours principal** : événement → NTF-001.
- **Parcours alternatifs** : trip annulé avant un rappel → rappel supprimé.
- **Règles métier** : BR-BOOK-01, BR-PICKUP-01, BR-PICKUP-09, BR-NOTIF.
- **États** : SM-1.
- **Erreurs** : —
- **Données** : —
- **Notifications** : `EVT_BOOKING_CONFIRMED`, `EVT_CHECKIN_OPEN`, `EVT_PICKUP_REMINDER`, `EVT_RETURN_REMINDER`.
- **Permissions** : `SYSTEM`.
- **Dépendances** : NTF-007 → NTF-001, TRP-045, LEG-026, PAY-035 ; NTF-011 → NTF-001, TRP-002.
- **Critères d'acceptation** : Given un passage BOOKED, When 1 min s'écoule, Then la confirmation est envoyée (M5) avec contrat et constancia, sans doublon si l'événement est rejoué ; échec WhatsApp → SMS. Given un trip annulé, When l'heure du rappel arrive, Then aucun rappel.
- **Source** : 08 BR-NOTIF (NOTIF-02, NOTIF-11/12/13) ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : inféré (canal) / documenté (NTF-011).
- **Priorité produit** : P0-A (lot 2 / lot 3)
- **Bêta pilote** : NTF-007 OUI ; NTF-011 DIFFÉRÉ — rappel de fin inclus dans le catalogue réduit de NTF-001.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : suivi de vol (P1).

#### Fiche MSG-001 / MSG-007 — Messagerie par trip et détection du marché gris
- **FEATURE ID** : MSG-001, MSG-007
- **Nom** : Messagerie guest–agence par trip (MSG-001) ; détection du marché gris dans les messages (MSG-007)
- **Module** : Communication & réputation (MSG — Messagerie, Modération)
- **Persona** : PER-01, PER-02, PER-03, PER-05
- **Objectif** : communiquer dans la plateforme et garder la trace ; empêcher les paiements hors plateforme.
- **Description** : MSG-001 (absorbe MSG-011) : fil par réservation, ouvert après réservation, consultable par le support ; partie du dossier de preuve. MSG-007 (absorbe MSG-004) : masquage des téléphones, emails, liens WhatsApp ; mots-clés (« efectivo », « por fuera ») → signal ops.
- **Déclencheur** : trip ≥ `BOOKED`.
- **Prérequis** : BKG-022.
- **Parcours principal** : message → filtres → stockage → notification du destinataire.
- **Parcours alternatifs** : coordonnées détectées → masquées avec avertissement ; récidive → restriction (ADM-005).
- **Règles métier** : BR-BOOK-02, BR-TRUST-02, BR-TRUST-06.
- **États** : message `SENT` / `FLAGGED`.
- **Erreurs** : —
- **Données** : message(trip_id, sender, body, masked_body, flags, at).
- **Notifications** : `EVT_NEW_MESSAGE`, `EVT_MESSAGE_FLAGGED` (ops).
- **Permissions** : participants du trip ; `SUPPORT_AGENT`, `OPS_AGENT` (lecture journalisée).
- **Dépendances** : MSG-001 → BKG-022 ; MSG-007 → MSG-001.
- **Critères d'acceptation** : Given « escríbeme al +507 6xxx-xxxx », When le message est envoyé, Then le numéro est masqué et le message signalé. Given un trip non réservé, When un visiteur tente d'écrire, Then refus.
- **Source** : SRC_G 8.6 ; 05 G-INBOX-01 ; 08 BR-TRUST-02 reco ; 11 EC-40 ; écrans 10b : S16.
- **Confiance** : documenté (MSG-001) ; proposé (MSG-007).
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL (les deux) — échanges relayés par le support (WhatsApp Business, email), journalisés dans la fiche du trip ; relecture par le support.
- **Complexité** : moyenne ; ops faible / moyen ; risque faible / moyen.
- **Améliorations possibles** : relais masqué avant réservation (15 IMP-08, P1).

#### Fiche REV-001 / REV-010 — Avis du guest et agrégats
- **FEATURE ID** : REV-001, REV-010
- **Nom** : Avis du guest sur le trip avec sous-notes (REV-001) ; note moyenne et nombre de trips (REV-010)
- **Module** : Communication & réputation (REV — Avis, Agrégats)
- **Persona** : PER-01, PER-02 ; visiteurs
- **Objectif** : signal de qualité pour les guests et retour pour l'agence.
- **Description** : REV-001 (absorbe REV-003) : note 1–5 + propreté, communication, praticité, exactitude, entretien ; texte facultatif (BR-REVIEW-04 référence) ; fenêtre après `COMPLETED`. REV-010 : moyenne par véhicule et par agence ; trip non noté exclu ; badge « Nuevo » sans avis.
- **Déclencheur** : `COMPLETED` → invitation.
- **Prérequis** : BKG-027.
- **Parcours principal** : invitation → notes → publication → recalcul des agrégats.
- **Parcours alternatifs** : avis abusif → retrait par l'ops (BR-REVIEW-07) ; fenêtre close → plus d'avis.
- **Règles métier** : BR-REVIEW-01, BR-REVIEW-03, BR-REVIEW-05, BR-REVIEW-07.
- **États** : review `INVITED` → `PUBLISHED` / `EXPIRED` / `REMOVED`.
- **Erreurs** : `REVIEW_WINDOW_CLOSED`.
- **Données** : review(trip_id, overall, sub_scores, text, published_at), aggregates.
- **Notifications** : `EVT_REVIEW_INVITATION`.
- **Permissions** : `GUEST` du trip ; `OPS_AGENT` (modération).
- **Dépendances** : REV-001 → BKG-027 ; REV-010 → REV-001.
- **Critères d'acceptation** : Given 3 avis (5, 4, 3) et 2 trips non notés, When l'agrégat est calculé, Then moyenne 4,0 et 5 trips.
- **Source** : SRC_G 8.1 ; 05 G-SEARCH-03, G-LISTING-02 ; écrans 10b : S02, S13.
- **Confiance** : documenté / confirmé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : REV-001 MANUEL — questionnaire de satisfaction envoyé par email après le trip ; REV-010 SIMPLIFIÉ — nombre de trips seulement, badge « Nuevo ».
- **Complexité** : moyenne / faible ; ops faible ; risque faible.
- **Améliorations possibles** : avis de l'agence, double aveugle (REV-002, REV-004, P1).

## E11 — Dommages et litiges de base (P0-A, 5 lignes)

#### Fiche CLM-001 / CLM-002 — Déclarations de dommage (agence) et d'incident (guest)
- **FEATURE ID** : CLM-001, CLM-002
- **Nom** : Déclaration de dommage par l'hôte/agence (CLM-001) ; déclaration d'incident/accident par le guest (CLM-002)
- **Module** : Sinistres & protection (CLM — Déclaration)
- **Persona** : PER-03, PER-04 (CLM-001) ; PER-01, PER-02 (CLM-002)
- **Objectif** : ouvrir un dossier dans les délais avec les preuves.
- **Description** : CLM-001 (absorbe CLM-003) : au plus tard 24 h après la fin du trip (ADM-031), photos avant/après (TRP-004), devis. CLM-002 : signalement immédiat (911, Tránsito, assureur ; SUP-004), formulaire guidé (tiers, photos, police) sous 24 h ; seul le conducteur principal déclare.
- **Déclencheur** : check-out avec dommage constaté ; incident pendant le trip.
- **Prérequis** : TRP-004 (CLM-001) ; SUP-004 (CLM-002).
- **Parcours principal** : formulaire → pièces → `REPORTED` → CLM-006.
- **Parcours alternatifs** : hors délai ou sans photos valides → `REJECTED_LATE` ; vol → `THEFT_INVESTIGATION`.
- **Règles métier** : BR-DAMAGE-01, BR-DAMAGE-02, BR-DAMAGE-10, BR-PROT-05.
- **États** : SM-4 `REPORTED` / `THEFT_INVESTIGATION` / `REJECTED_LATE`.
- **Erreurs** : `CLAIM_DEADLINE_PASSED`, `CLAIM_EVIDENCE_MISSING`.
- **Données** : claim(id, trip_id, reported_by, kind, description, evidence[], reported_at).
- **Notifications** : `EVT_CLAIM_OPENED` (guest, agence, ops).
- **Permissions** : `AGENCY_MANAGER` (CLM-001, un gérant déclare) ; `GUEST` principal (CLM-002).
- **Dépendances** : CLM-001 → TRP-004 ; CLM-002 → SUP-004.
- **Critères d'acceptation** : Given une fin de trip à 10:00 et un délai de 24 h, When l'agence déclare le lendemain à 10:01, Then `CLAIM_DEADLINE_PASSED`. Given une déclaration sans photos de départ et de retour, When elle est soumise, Then `CLAIM_EVIDENCE_MISSING`.
- **Source** : SRC_H §5.4 ; 10 §3 ; SRC_G 7.5 ; TOS-GUEST ; 11 EC-12, EC-13 ; écrans 10b : S11, S17.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL (les deux) — dommage par email au support avec photos ; incident par téléphone ou WhatsApp, consigné par l'ops.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : constat guidé in-app avec géolocalisation.

#### Fiche CLM-006 — Instruction d'un dossier plateforme
- **FEATURE ID** : CLM-006
- **Nom** : Instruction d'un dossier plateforme
- **Module** : Sinistres & protection (CLM — Parcours)
- **Persona** : PER-07
- **Objectif** : décision juste, motivée, dans des délais visibles.
- **Description** : 1) recevabilité sous 2 j ouvrés (déclaration ≤ 24 h, photos présentes) ; 2) pièces sous 15 j (devis, photos, constat, rapport de police) ; 3) dossier CLM-034 partagé avec le guest, qui répond ; 4) décision écrite et motivée (ADM-008) ; 5) transmission à l'assureur de la police flotte si couvert. En P0-A, la plateforme n'encaisse rien : règlement entre guest et agence (caution prise par l'agence) ; l'agence exécute la décision sous 5 j ouvrés (LEG-025), à défaut pénalité/avoir ; le guest garde ses voies externes (chargeback, ACODECO) ; « décision définitive » non utilisée avant OQ-BR-24. SM-4 simplifiée (ex-CLM-032 ; absorbe CLM-019).
- **Déclencheur** : CLM-001, CLM-002, contestation du guest.
- **Prérequis** : CLM-001, CLM-002, CLM-034, ADM-005.
- **Parcours principal** : `REPORTED` → `EVIDENCE_COLLECTION` → `PATH_CHOICE` → `ELIGIBILITY_REVIEW` → décision → `SETTLEMENT` (montant tracé) → `CLOSED`.
- **Parcours alternatifs** : pièces manquantes à J+15 → `INELIGIBLE` ; assureur refuse (EC-47) → `INSURER_DECLINED` → guest responsable selon le contrat de l'agence ; dommage pendant que la caution est retenue par l'agence (EC-56) → la caution n'est retenue qu'au montant décidé.
- **Règles métier** : BR-DAMAGE-02, BR-DAMAGE-03, BR-DAMAGE-04, BR-DAMAGE-06, BR-DAMAGE-11, BR-REIMB-03 (délai remplacé en P0-B par PAY-037).
- **États** : SM-4 (sans région de versement hôte en P0-A).
- **Erreurs** : `CLAIM_STEP_OVERDUE`, `CLAIM_DECISION_WITHOUT_EVIDENCE`.
- **Données** : claim_step(claim_id, step, due_at, done_at, by), decision(claim_id, amount_minor, rationale, decided_by).
- **Notifications** : `EVT_CLAIM_EVIDENCE_REQUESTED`, `EVT_CLAIM_DECIDED`.
- **Permissions** : `OPS_AGENT` (instruction), `ADMIN` (décision au-delà d'un seuil, PROPOSÉ).
- **Dépendances** : CLM-001 ; CLM-002 ; CLM-034 ; ADM-005.
- **Critères d'acceptation** : Given chaque étape, When elle est franchie, Then elle est horodatée et son délai est visible dans ADM-005. Given un dossier sans photos de départ, When l'ops tente une décision de retenue, Then `CLAIM_DECISION_WITHOUT_EVIDENCE`. Given une décision non exécutée par l'agence à J+5 ouvrés, When la tâche tourne, Then une pénalité est proposée. Given une déclaration reçue un lundi à 09:00, When 2 j ouvrés passent sans décision de recevabilité, Then le dossier est signalé en retard le mercredi à 09:00. Given des pièces demandées à J0, When J+15 est atteint sans pièce, Then le dossier passe `INELIGIBLE` (consolidé VERIF_15-F7).
- **Source** : SRC_G 7.8 ; SRC_H §5.4 ; 11 EC-41, EC-47, EC-56 ; écrans 10b : S12, A09.
- **Confiance** : documenté (parcours Turo) ; adaptation P0-A proposée.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — instruction par l'ops avec le dossier CLM-034 et un gabarit de décision.
- **Complexité** : élevée ; ops élevé ; risque élevé.
- **Améliorations possibles** : expertise par assureur partenaire ; médiation (15 IMP-27).

#### Fiche ADM-008 — Arbitrage des litiges et factures contestées
- **FEATURE ID** : ADM-008
- **Nom** : Arbitrage des litiges et factures contestées
- **Module** : Back-office & exploitation (ADM — Litiges ; rattachée à E11)
- **Persona** : PER-07
- **Objectif** : décision écrite et motivée envoyée aux deux parties.
- **Description** : SLA 5 j ouvrés ; gabarit de décision (faits, preuves, règle, montant, voies de recours externes) ; couvre aussi les contestations d'annulation ou de no-show (SM-7) et les factures annexes contestées (absorbe CLM-022).
- **Déclencheur** : dossier CLM-006 instruit ; contestation SM-7.
- **Prérequis** : CLM-006.
- **Parcours principal** : `OPENED` → `EVIDENCE` (72 h) → `DECIDED_UPHELD` / `DECIDED_REQUALIFIED` → `ADJUSTED` (recalcul du règlement, nouvelle version).
- **Parcours alternatifs** : requalification après remboursement déjà exécuté → T36 (delta), T49 (supersession), T50 (en vol) ; en P0-A le delta est demandé à l'agence ou au guest, sans débit plateforme.
- **Règles métier** : BR-REIMB-03, BR-DAMAGE-04, BR-CXL (requalification).
- **États** : SM-7 ; SM-1 (écriture d'audit de requalification) ; SM-8.
- **Erreurs** : `DECISION_RATIONALE_REQUIRED`.
- **Données** : dispute(trip_id, opened_by, reason, state, decision_ref).
- **Notifications** : `EVT_DISPUTE_DECIDED` (guest, agence).
- **Permissions** : `OPS_AGENT`, `ADMIN`.
- **Dépendances** : CLM-006.
- **Critères d'acceptation** : Given une décision sans motif, When elle est enregistrée, Then `DECISION_RATIONALE_REQUIRED`. Given T36, When un no-show contesté est requalifié, Then le delta guest −118,44 et pénalité −50 sont calculés (configuration de test) et une nouvelle version de règlement est créée, l'ancienne conservée. Given T67 (a) (chargeback perdu sur la capture de 256,66 alors que le remboursement de 187,44 est encore `PLANNED`), When le chargeback est clos, Then l'instance de remboursement passe `CANCELLED` et rien n'est remboursé en plus du chargeback (configuration de test de 08 ; consolidé VERIF_15-F5).
- **Source** : 08 BR-REIMB-03 reco. ; 08 T67 ; écrans 10b : S12, A09.
- **Confiance** : inféré.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — décision écrite par gabarit, envoyée par email aux deux parties.
- **Complexité** : moyenne ; ops élevé ; risque élevé.
- **Améliorations possibles** : médiation externe (15 IMP-27).

#### Fiche LEG-024 — Preuves et décisions motivées (pratique ACODECO)
- **FEATURE ID** : LEG-024
- **Nom** : Preuves et décisions motivées (pratique recommandée face à ACODECO)
- **Module** : Légal, données & localisation (LEG — Consommateur ; rattachée à E11)
- **Persona** : PER-07
- **Objectif** : résister aux plaintes de consommateurs.
- **Description** : toute retenue ou facturation post-trip repose sur les photos horodatées (TRP-004) et le dossier CLM-034 ; décisions écrites et motivées (ADM-008). Source (12 §3.7) : précédent de 2018 signalé par une colonne d'opinion, **pas une exigence réglementaire identifiée** ; Ley 45/2007 à vérifier (OQ-BR-24).
- **Déclencheur** : toute retenue.
- **Prérequis** : TRP-004, ADM-008, CLM-034.
- **Parcours principal** : contrôle « preuve présente » avant toute décision de retenue.
- **Parcours alternatifs** : —
- **Règles métier** : BR-PAY-06, BR-REIMB-03.
- **États** : —
- **Erreurs** : `CLAIM_DECISION_WITHOUT_EVIDENCE`.
- **Données** : —
- **Notifications** : —
- **Permissions** : `OPS_AGENT`.
- **Dépendances** : TRP-004 ; ADM-008 ; CLM-034.
- **Critères d'acceptation** : Given une retenue sans photos de départ et de retour, When elle est décidée, Then refus (même contrôle que CLM-006).
- **Source** : 08 BR-PAY-06 reco ; 12 §3.7 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — règle de pratique appliquée par l'ops.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : —

## E12 — Back-office, support, risque et exploitation (P0-A, 18 lignes)

#### Fiche ADM-001 — Console admin avec RBAC, 2FA et journal d'audit
- **FEATURE ID** : ADM-001
- **Nom** : Console admin avec RBAC, 2FA et journal d'audit
- **Module** : Back-office & exploitation (ADM — Socle)
- **Persona** : PER-05, PER-06, PER-07
- **Objectif** : opérer la bêta en sécurité et de façon traçable.
- **Description** : rôles `ADMIN` (tout), `OPS_AGENT` (KYC, annonces, trips, risque, sinistres), `SUPPORT_AGENT` (vue 360° en lecture, notes, actions de trip limitées), `FINANCE` (commissions, factures, crédits). Matrice rôle × action en base. 2FA TOTP obligatoire. Journal d'audit en ajout seul (qui, quoi, avant/après, quand, motif), 5 ans sous réserve d'OQ-BR-25.
- **Déclencheur** : connexion interne.
- **Prérequis** : aucun.
- **Parcours principal** : connexion + TOTP → actions autorisées → journal.
- **Parcours alternatifs** : action interdite → 403 journalisé ; perte du TOTP → réinitialisation par un autre admin, journalisée.
- **Règles métier** : aucune BR (interne) ; BR-TRUST-05 pour les restrictions.
- **États** : —
- **Erreurs** : `FORBIDDEN`, `2FA_REQUIRED`.
- **Données** : staff_user, role_permission(role, action), audit_log(append-only).
- **Notifications** : —
- **Permissions** : définit les permissions.
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given un rôle `SUPPORT_AGENT`, When il tente une annulation plateforme, Then 403 journalisé. Given le journal, When une mise à jour ou suppression est tentée depuis l'application, Then elle est impossible.
- **Source** : 02 Limites (back-office Turo invisible) ; écrans 10b : A13.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ — console à deux rôles (admin, ops) avec 2FA et journal d'audit.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : outil de support du commerce intégré (ADM-010, P1).

#### Fiche ADM-002 / ADM-003 — Files de revue KYC et annonces
- **FEATURE ID** : ADM-002, ADM-003
- **Nom** : File de revue KYC (ADM-002) ; file de revue des annonces (ADM-003)
- **Module** : Back-office & exploitation (ADM — Files de revue)
- **Persona** : PER-07
- **Objectif** : décisions rapides et tracées.
- **Description** : ADM-002 (absorbe VER-010) : comptes en `MANUAL_REVIEW`, SLA 4 h ouvrées (M2). ADM-003 : annonces `PENDING_REVIEW`, SLA 24 h ; inspection physique Premium/Luxe (PROPOSÉ, facultative en bêta).
- **Déclencheur** : entrée en file.
- **Prérequis** : ADM-001, VER-001 (ADM-002) ; HST-016 (ADM-003).
- **Parcours principal** : file triée par ancienneté → ouverture → décision motivée.
- **Parcours alternatifs** : SLA dépassé → alerte au responsable ops.
- **Règles métier** : BR-VERIF-04, BR-LIST-08.
- **États** : SM-3 (`MANUAL_REVIEW` → …) ; SM-2 (`PENDING_REVIEW` → …).
- **Erreurs** : `DECISION_RATIONALE_REQUIRED`.
- **Données** : review_task(type, ref, created_at, due_at, assignee, decision).
- **Notifications** : `EVT_REVIEW_SLA_BREACH` (ops).
- **Permissions** : `OPS_AGENT`.
- **Dépendances** : ADM-002 → ADM-001, VER-001 ; ADM-003 → HST-016.
- **Critères d'acceptation** : Given un dossier entré à 09:00 un jour ouvré, When 13:00 passe sans décision, Then alerte. Given une décision, When elle est enregistrée, Then motif et auteur figurent au journal.
- **Source** : 08 BR-VERIF-04 (revue 24–48 h chez Turo) ; 08 BR-LIST-08 ; écrans 10b : O01.
- **Confiance** : inféré.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL (les deux) — revue KYC dans le portail du fournisseur, décision reportée dans la console ; contrôle des annonces par l'ops lors de l'import.
- **Complexité** : moyenne ; ops élevé ; risque moyen / faible.
- **Améliorations possibles** : priorisation par date de départ.

#### Fiche ADM-004 — Onboarding et KYB des loueurs
- **FEATURE ID** : ADM-004
- **Nom** : Onboarding et KYB des loueurs
- **Module** : Back-office & exploitation (ADM — Onboarding pro)
- **Persona** : PER-07
- **Objectif** : activer une agence seulement quand tout est en ordre.
- **Description** : file d'onboarding : RUC, Aviso de Operación, représentant légal, police flotte (PRT-019), compte PSP (PAY-033), contrat-cadre (LEG-025), sanctions (VER-028) ; décision approuvée / à compléter / refusée, motivée. Activation = KYB + police + contrat + PSP.
- **Déclencheur** : agence `KYB_PENDING`.
- **Prérequis** : VER-027, VER-028, PRT-019.
- **Parcours principal** : checklist → décisions partielles → activation.
- **Parcours alternatifs** : étape manquante → « à compléter » avec liste.
- **Règles métier** : BR-ACC-06, BR-LIST-01.
- **États** : société (voir ACC-029).
- **Erreurs** : `ONBOARDING_INCOMPLETE`.
- **Données** : onboarding_checklist(org_id, items[], status).
- **Notifications** : `EVT_KYB_DECISION`, `EVT_ORGANIZATION_ACTIVATED`.
- **Permissions** : `OPS_AGENT` ; activation `ADMIN` (PROPOSÉ).
- **Dépendances** : VER-027 ; VER-028 ; PRT-019.
- **Critères d'acceptation** : Given une agence sans contrat signé ou sans PSP confirmé, When on l'active, Then `ONBOARDING_INCOMPLETE`.
- **Source** : 12 §10.3 ; écrans 10b : A07, O01.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — onboarding suivi sur liste de contrôle, statut saisi dans la console.
- **Complexité** : moyenne ; ops élevé ; risque moyen.
- **Améliorations possibles** : onboarding express 48 h (P1).

#### Fiche ADM-005 — Fiche utilisateur 360°
- **FEATURE ID** : ADM-005
- **Nom** : Fiche utilisateur 360°
- **Module** : Back-office & exploitation (ADM — Utilisateurs)
- **Persona** : PER-05, PER-07, PER-06
- **Objectif** : tout savoir d'un guest ou d'une agence en un écran.
- **Description** : recherche ; profil, statut KYC (sans images), trips, paiements, messages, restrictions, notes internes (absorbe ADM-012, SUP-016, VER-023). Pour une agence : indicateur « réservations plateforme vs véhicules listés et jours disponibles » et écarts de rapprochement (FIN-019). Restriction manuelle d'un compte (utilisée par BKG-012).
- **Déclencheur** : support, ops.
- **Prérequis** : ADM-001.
- **Parcours principal** : recherche → fiche → action (note, restriction avec motif).
- **Parcours alternatifs** : levée d'une restriction → motif obligatoire.
- **Règles métier** : BR-ACC-10, BR-TRUST-05.
- **États** : restriction `ACTIVE` / `LIFTED`.
- **Erreurs** : `FORBIDDEN`.
- **Données** : restriction(user_or_company, type, reason, by, at), internal_note.
- **Notifications** : `EVT_ACCOUNT_RESTRICTED`.
- **Permissions** : `SUPPORT_AGENT` (lecture, notes), `OPS_AGENT` (restrictions), `FINANCE` (lecture financière).
- **Dépendances** : ADM-001.
- **Critères d'acceptation** : Given un compte restreint, When le guest réserve, Then `ACCOUNT_RESTRICTED` (BKG-012). Given chaque consultation d'un dossier KYC, When elle a lieu, Then elle est journalisée (ADM-032).
- **Source** : 08 BR-ACC-10 ; écrans 10b : O01.
- **Confiance** : inféré.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — fiche en lecture : profil, KYC, trips, paiements.
- **Complexité** : moyenne ; ops moyen ; risque faible.
- **Améliorations possibles** : historique des contacts support.

#### Fiche ADM-006 — Gestion des trips par les agents
- **FEATURE ID** : ADM-006
- **Nom** : Gestion des trips par les agents
- **Module** : Back-office & exploitation (ADM — Trips)
- **Persona** : PER-07, PER-05
- **Objectif** : corriger un trip quand le libre-service n'existe pas encore.
- **Description** : modification forcée, annulation avec motif (BKG-035 et pour compte du guest/agence en bêta), fin forcée (TERMINATED_EARLY avec motif 22–26), swap, crédit (ADM-007). En bêta, modification = annulation + nouvelle réservation.
- **Déclencheur** : demande support ; incident.
- **Prérequis** : ADM-001.
- **Parcours principal** : action → motif → transition SM-1 → règlement si applicable.
- **Parcours alternatifs** : fin anticipée non imputable au guest → `computeTerminationSettlement` (T37, T65) — OQ-BR-46 (jour minimum) ouverte.
- **Règles métier** : BR-CXL-14, BR-MOD-08, BR-MOD-04, BR-TRUST-05.
- **États** : SM-1 (y compris `TERMINATED_EARLY`).
- **Erreurs** : `TERMINATION_REASON_REQUIRED`, `TRIP_TRANSITION_FORBIDDEN`.
- **Données** : trip_event (actor=staff, reason).
- **Notifications** : selon la transition.
- **Permissions** : `OPS_AGENT` ; `SUPPORT_AGENT` (actions limitées).
- **Dépendances** : ADM-001.
- **Critères d'acceptation** : Given une fin forcée sans motif, When elle est demandée, Then `TERMINATION_REASON_REQUIRED`. Given T37, When une panne non imputable à T+20 h est enregistrée, Then le remboursement attendu de la configuration de test est obtenu.
- **Source** : 08 BR-CXL-14 ; BR-TRUST-05 ; écrans 10b : O01.
- **Confiance** : inféré.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — annulation avec motif et fin forcée ; modification = annulation + nouvelle réservation.
- **Complexité** : moyenne ; ops moyen ; risque faible.
- **Améliorations possibles** : modifications en libre-service (P1).

#### Fiche ADM-007 — Remboursements, gestes commerciaux et crédits
- **FEATURE ID** : ADM-007
- **Nom** : Remboursements, gestes commerciaux et crédits
- **Module** : Back-office & exploitation (ADM — Finance)
- **Persona** : PER-07, PER-06
- **Objectif** : réparer un incident sans détenir de fonds en P0-A.
- **Description** : (a) avoir sur la commission de l'agence ; (b) demande de remboursement à l'agence et suivi (PAY-021) ; (c) crédit commercial plateforme plafonné par rôle et par mois (ADM-031 ; **défaut 0** tant que non décidé). Remboursements directs : P0-B.
- **Déclencheur** : incident, geste commercial.
- **Prérequis** : FIN-001, ADM-001, ADM-031.
- **Parcours principal** : choix (a/b/c) → montant → contrôle du plafond → écriture → suivi.
- **Parcours alternatifs** : plafond dépassé → refus ou escalade `ADMIN`.
- **Règles métier** : BR-PAY-07, BR-PAY-08.
- **États** : credit `ISSUED` → `USED` / `EXPIRED` ; SM-8 pour (b).
- **Erreurs** : `CREDIT_CAP_EXCEEDED`.
- **Données** : credit(id, beneficiary, amount, reason, issued_by, cap_period).
- **Notifications** : `EVT_CREDIT_ISSUED`.
- **Permissions** : `OPS_AGENT`, `FINANCE` dans les plafonds ; `ADMIN` au-delà.
- **Dépendances** : FIN-001 ; ADM-001 ; ADM-031.
- **Critères d'acceptation** : Given TA09, When un crédit de 10,00 est tenté avec un plafond non décidé (0), Then `CREDIT_CAP_EXCEEDED` journalisé.
- **Source** : 08 BR-PAY-07 ; BR-PAY-08 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : inféré.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : MANUEL — avoirs portés sur la facture de commission par le comptable ; demandes de remboursement à l'agence par email.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : crédits guests utilisables au checkout (P1).

#### Fiche ADM-014 / ADM-031 — Paramétrage par pays et paramètres Panama par défaut
- **FEATURE ID** : ADM-014, ADM-031
- **Nom** : Paramétrage par pays (ADM-014) ; annexe des paramètres Panama par défaut (ADM-031)
- **Module** : Back-office & exploitation (ADM — Paramétrage)
- **Persona** : PER-07 (`ADMIN`)
- **Objectif** : aucune valeur métier codée en dur ; valeurs Panama et Paraguay décidées avant la mise en service (valeurs de test autorisées pendant le build, DEC-FONDATEUR-02).
- **Description** : ADM-014 (absorbe I18N-007, PRT-010) : table param(pays, clé, valeur, devise, valid_from, modifié_par) ; modification par `ADMIN`, journalisée, effective à valid_from, jamais rétroactive (le devis fige). ADM-031 : valeurs de lancement **À DÉCIDER** au jalon J-ADM-031 : âge minimum 21/25 ; préavis 3 h ; tampon 2 h ; annulation gratuite 24 h, seuil dernière minute 25 h (OQ-BR-30) ; pénalités agence ; grâce de retard 29 min (**OQ-BR-04 ouverte**) ; grâce no-show 60 min (OQ-BR-33) ; ITBMS 7 % (OQ-BR-14) ; commission 12 % (OQ-MK-07) ; déclaration de dommage 24 h ; durée max 30 j ; plafonds de crédits ; seuil de rapprochement ; `platform_funded_host_compensation` **absent** (DEC-FONDATEUR-01 ouverte) ; `grace_minutes` 29 ; `foreign_license_mode` FLAG.
- **Déclencheur** : configuration ; jalon.
- **Prérequis** : ADM-001 (ADM-014) ; ADM-014 (ADM-031).
- **Parcours principal** : proposition → validation fondateur → chargement → effet à valid_from.
- **Parcours alternatifs** : clé requise absente → démarrage de l'application refusé en production (fail-closed), sauf `platform_funded_host_compensation` dont l'absence vaut false.
- **Règles métier** : toutes les BR `{param}` ; BR-CXL-00, BR-CXL-01, BR-RETURN-03, BR-ACC-04, BR-CXL-13.
- **États** : param `DRAFT` → `ACTIVE` (valid_from) → `SUPERSEDED`.
- **Erreurs** : `PARAM_MISSING`, `PARAM_RETROACTIVE`.
- **Données** : param(country, key, value, currency, valid_from, created_by, decision_ref).
- **Notifications** : —
- **Permissions** : `ADMIN` seulement.
- **Dépendances** : ADM-014 → ADM-001 ; ADM-031 → ADM-014.
- **Critères d'acceptation** : Given une valeur avec valid_from passé, When elle est saisie, Then `PARAM_RETROACTIVE`. Given un trip réservé sous l'ancienne valeur, When la nouvelle entre en vigueur, Then son devis garde l'ancienne. Given une clé obligatoire manquante, When la production démarre, Then refus explicite. Given `platform_funded_host_compensation` absent, When T61 est rejoué, Then compensation 0.
- **Source** : 08 Conventions (paramétrage pays) ; VERIF_07 NEW-07, F10 ; 12 §3 ; écrans 10b : S10, A11.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0 / lot 1)
- **Bêta pilote** : SIMPLIFIÉ (les deux) — paramètres dans un fichier de configuration versionné, sans écran ; valeurs ADM-031 chargées dedans.
- **Complexité** : moyenne / faible ; ops faible ; risque faible / moyen.
- **Améliorations possibles** : écran de paramétrage avec double validation.

#### Fiche ADM-022 — Tableau ops des véhicules en retard / non restitués
- **FEATURE ID** : ADM-022
- **Nom** : Tableau ops des véhicules en retard / non restitués
- **Module** : Back-office & exploitation (ADM — Opérations)
- **Persona** : PER-07
- **Objectif** : piloter les escalades de TRP-038.
- **Description** : liste temps réel des trips `OVERDUE` / `UNRETURNED`, durée du retard, étape d'escalade, GPS déclaré (oui/non), contacts.
- **Déclencheur** : console ops.
- **Prérequis** : TRP-038, ADM-001.
- **Parcours principal** : liste → trip → étape suivante.
- **Parcours alternatifs** : —
- **Règles métier** : BR-RETURN-04.
- **États** : SM-1 `OVERDUE`, `UNRETURNED`.
- **Erreurs** : —
- **Données** : vue overdue_board.
- **Notifications** : —
- **Permissions** : `OPS_AGENT`.
- **Dépendances** : TRP-038 ; ADM-001.
- **Critères d'acceptation** : Given un trip qui passe OVERDUE, When le tableau est ouvert, Then il apparaît en ≤ 1 min avec son étape.
- **Source** : 11 EC-20 ; écrans 10b : O01.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — retards suivis par l'ops à partir du filtre OVERDUE de la console.
- **Complexité** : moyenne ; ops élevé ; risque moyen.
- **Améliorations possibles** : position GPS intégrée (P1).

#### Fiche ADM-029 — File de revue des réservations à risque
- **FEATURE ID** : ADM-029
- **Nom** : File de revue des réservations à risque
- **Module** : Back-office & exploitation (ADM — Risque)
- **Persona** : PER-07
- **Objectif** : arrêter la fraude avant la remise des clés (EC-43).
- **Description** : 5 à 10 règles codées en dur : compte < 24 h ; carte hors du pays de résidence déclaré ; permis étranger > entrée + 90 j ou résident à permis étranger (VER-007) ; pick-up, 4x4 ou Premium ; départ < 3 h ; 3 refus de carte en 1 h ; numéro virtuel (VER-013) ; même appareil ou carte sur plusieurs comptes. Règle déclenchée → réservation en revue (2 h ouvrées) : approuver, demander un document, annuler avec remboursement intégral. Taux de faux positifs suivi (M7).
- **Déclencheur** : checkout ; signaux.
- **Prérequis** : ADM-001.
- **Parcours principal** : règles → `requirements_status = PENDING` → décision → `SATISFIED` ou annulation.
- **Parcours alternatifs** : **UXQ-08 ouverte** : lien de paiement émis seulement après la décision (option 10b) ou paiement puis revue (consolidé VERIF_15-F2(ii)) ; revue non faite avant T−2 h → `FAILED` → `CANCELLED_BY_PLATFORM` motif `PLATFORM_REVIEW_DELAY` (remboursement intégral ; compensation agence selon DEC-FONDATEUR-01, défaut 0, T61).
- **Règles métier** : BR-VERIF-09, BR-TRUST-01, BR-CXL-07.
- **États** : SM-1b ; SM-1.
- **Erreurs** : `BOOKING_UNDER_REVIEW`.
- **Données** : risk_flag(trip_id, rule, value), risk_decision(trip_id, decision, rationale, by, at).
- **Notifications** : `EVT_BOOKING_UNDER_REVIEW`, `EVT_DOCUMENT_REQUESTED`.
- **Permissions** : `OPS_AGENT`.
- **Dépendances** : ADM-001.
- **Critères d'acceptation** : Given un compte créé il y a 2 h réservant un 4x4 pour dans 2 h, When il valide le checkout, Then la réservation est en revue (lien de paiement émis après la décision si UXQ-08 retient l'option 10b). Given une décision, When elle est enregistrée, Then elle est motivée et journalisée. Given une revue non faite à T−2 h, When la tâche tourne, Then annulation `PLATFORM_REVIEW_DELAY` avec remboursement intégral.
- **Source** : 11 EC-43 ; écrans 10b : S05, O01.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — toutes les réservations passent en revue humaine ; les règles s'affichent comme indicateurs.
- **Complexité** : moyenne ; ops élevé ; risque moyen.
- **Améliorations possibles** : score de risque LATAM (15 IMP-18, P1).

#### Fiche ADM-032 / ADM-035 — Sauvegardes, monitoring, journal d'accès ; RPO/RTO et reprise
- **FEATURE ID** : ADM-032, ADM-035
- **Nom** : Sauvegardes, monitoring et journal d'accès aux données personnelles (ADM-032) ; objectifs RPO/RTO, plan de reprise et procédure d'incident (ADM-035)
- **Module** : Back-office & exploitation (ADM — Exploitation)
- **Persona** : équipe technique ; PER-07
- **Objectif** : ne rien perdre, détecter vite, savoir reprendre.
- **Description** : ADM-032 : sauvegardes quotidiennes chiffrées (base et fichiers), test de restauration mensuel ; monitoring et alertes (disponibilité, erreurs, files de notifications, webhooks PSP en échec) ; journal des consultations de dossiers KYC et de photos ; secrets PSP en coffre/KMS isolés par agence, rotation documentée. ADM-035 : RPO ≤ 24 h (cible ≤ 1 h si journaux de transactions), RTO ≤ 8 h (À DÉCIDER) ; plan de reprise écrit ; procédure d'incident de sécurité et de violation reliée au registre LEG-010 (notification selon OQ-MK-09) ; test de restauration chronométré avant ouverture.
- **Déclencheur** : continu ; incident.
- **Prérequis** : ADM-001 ; ADM-034 ; LEG-010.
- **Parcours principal** : sauvegarde → vérification → alerte si échec ; incident → qualification → journal → notification si violation.
- **Parcours alternatifs** : échec de sauvegarde → alerte immédiate.
- **Règles métier** : aucune BR (exploitation) ; BR-ACC-09 (données).
- **États** : incident `DETECTED` → `QUALIFIED` → `CONTAINED` → `NOTIFIED` / `CLOSED`.
- **Erreurs** : —
- **Données** : backup_run, restore_test(rpo_measured, rto_measured), access_log(staff, resource, at), incident.
- **Notifications** : alertes techniques.
- **Permissions** : `ADMIN`.
- **Dépendances** : ADM-032 → ADM-001 ; ADM-035 → ADM-032, ADM-034, LEG-010.
- **Critères d'acceptation** : Given l'ouverture de la bêta, When elle est demandée, Then un rapport de test de restauration avec RPO et RTO mesurés existe. Given une consultation d'un dossier KYC, When elle a lieu, Then elle est au journal d'accès. Given un webhook PSP en échec 3 fois, When il échoue, Then une alerte part.
- **Source** : VERIF_07 NEW-17 ; Ley 81/2019 (12 §3.5) ; VERIF_10 V10-11 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0 / lot 1)
- **Bêta pilote** : SIMPLIFIÉ (les deux) — sauvegardes gérées de l'hébergeur, alertes de base, journal d'accès aux dossiers KYC ; RPO 24 h / RTO 8 h et un test de restauration avant l'ouverture.
- **Complexité** : moyenne / faible ; ops faible ; risque élevé / moyen.
- **Améliorations possibles** : PITR, multi-région.

#### Fiche ADM-033 — Revue de sécurité avant ouverture
- **FEATURE ID** : ADM-033
- **Nom** : Revue de sécurité avant ouverture (menaces, test ciblé, secrets, portée PCI)
- **Module** : Back-office & exploitation (ADM — Sécurité)
- **Persona** : équipe ; prestataire
- **Objectif** : aucune vulnérabilité critique ou élevée à l'ouverture.
- **Description** : modèle de menaces (comptes, KYC/biométrie, webhooks PSP, identifiants PSP des agences, console) ; revue ciblée OWASP ASVS niveau 2 (authentification, contrôle d'accès, téléversements, webhooks) ; test d'intrusion externe ou revue tierce ; portée PCI DSS (SAQ A) ; gestion des secrets.
- **Déclencheur** : lot 4 (avant ouverture).
- **Prérequis** : ADM-001, ADM-032, ADM-034, ADM-035, PAY-001.
- **Parcours principal** : revue → rapport → corrections → re-test.
- **Parcours alternatifs** : vulnérabilité élevée → ouverture repoussée.
- **Règles métier** : aucune BR.
- **États** : —
- **Erreurs** : —
- **Données** : rapport (document).
- **Notifications** : —
- **Permissions** : `ADMIN`.
- **Dépendances** : ADM-001 ; ADM-032 ; ADM-034 ; ADM-035 ; PAY-001.
- **Critères d'acceptation** : Given le rapport, When l'ouverture est décidée, Then 0 vulnérabilité critique ou élevée ouverte.
- **Source** : VERIF_10 V10-11, V10-05 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 4)
- **Bêta pilote** : SIMPLIFIÉ — revue ciblée interne (authentification, KYC, webhooks, secrets) ; test d'intrusion externe avant l'ouverture élargie. (aligné v4, C-v3-04) RLS par type d'acteur et par pays pour le staff, commandes serveur sans écriture de table du guest, tests IDOR et RLS-1 à RLS-20 sous les rôles de production (17 §2.3, §11).
- **Complexité** : moyenne ; ops faible ; risque élevé.
- **Améliorations possibles** : bug bounty (P2).

#### Fiche ADM-034 — Préproduction et déploiement réversible
- **FEATURE ID** : ADM-034
- **Nom** : Environnements de préproduction (staging) et déploiement réversible
- **Module** : Back-office & exploitation (ADM — Exploitation)
- **Persona** : équipe
- **Objectif** : tester sans données réelles et revenir en arrière.
- **Description** : dev, préproduction, production séparés (bases et stockages distincts) ; données synthétiques ou pseudonymisées (jamais de KYC réel) ; bacs à sable PSP et KYC ; gabarits de notification en mode test ; pipeline CI avec migrations versionnées ; retour arrière documenté.
- **Déclencheur** : lot 0.
- **Prérequis** : aucun.
- **Parcours principal** : merge → CI → préproduction → recette → production.
- **Parcours alternatifs** : régression → retour arrière.
- **Règles métier** : aucune BR.
- **États** : —
- **Erreurs** : —
- **Données** : —
- **Notifications** : —
- **Permissions** : équipe.
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given un déploiement en production, When il est lancé, Then il est passé par la préproduction. Given l'ouverture, When elle est demandée, Then un retour arrière a été exécuté au moins une fois.
- **Source** : VERIF_10 V10-11 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ — une préproduction, déploiement scripté, retour arrière documenté.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : environnements éphémères par branche.

#### Fiche SUP-004 / SUP-011 — Ligne d'urgence, support en horaires étendus, bilingue
- **FEATURE ID** : SUP-004, SUP-011
- **Nom** : Ligne d'urgence et support en horaires étendus (SUP-004) ; support multilingue espagnol / anglais (SUP-011)
- **Module** : Back-office & exploitation (SUP — Urgence, Aide)
- **Persona** : PER-05 ; PER-01, PER-02, PER-03
- **Objectif** : aide joignable pendant le trip, en es et en.
- **Description** : SUP-004 (absorbe PRT-005, TRP-050) : WhatsApp Business + téléphone affichés sur la confirmation, le contrat et le trip ; support humain es/en en horaires étendus (ex. 7 h–22 h, 7 j/7) ; hors horaires, réponse automatique vers l'assistance routière de l'assureur de la police flotte (PRT-019) et le numéro d'urgence de l'agence ; accident : 911, Tránsito, assureur (CLM-002) ; signalement de sécurité. 24/7 humain : P1. SUP-011 : réponses types bilingues.
- **Déclencheur** : contact du guest ou de l'agence.
- **Prérequis** : PRT-019 ; SUP-020 (dotation).
- **Parcours principal** : contact → ticket lié au trip → réponse → résolution.
- **Parcours alternatifs** : hors plage → message automatique ; urgence vitale → 911.
- **Règles métier** : BR-PROT-05.
- **États** : ticket `OPEN` → `PENDING` → `RESOLVED`.
- **Erreurs** : —
- **Données** : ticket(trip_id, channel, lang, first_response_at, resolved_at).
- **Notifications** : réponse automatique hors plage.
- **Permissions** : `SUPPORT_AGENT`.
- **Dépendances** : SUP-004 → PRT-019 ; SUP-011 → SUP-004.
- **Critères d'acceptation** : Given chaque trip, When la confirmation est envoyée, Then elle affiche les trois numéros (support, agence, assistance). Given un message hors plage, When il arrive, Then la réponse automatique part dans la langue du compte. Given les tickets, When on les mesure, Then le délai de première réponse est calculé (M6).
- **Source** : 10 §4 ; SRC_G 8.9 ; 12 §1.2 ; écrans 10b : S17.
- **Confiance** : documenté (assistance Turo) ; organisation proposée.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SUP-004 SIMPLIFIÉ — plage réduite (ex. 8 h–20 h) et numéro d'urgence de l'agence hors plage ; SUP-011 MANUEL — support humain es/en, réponses types dans un document partagé.
- **Complexité** : faible ; ops élevé ; risque moyen.
- **Améliorations possibles** : 24/7 et triage IA (15 IMP-07, P1).

#### Fiche SUP-020 — Plan de dotation du support et de l'exploitation
- **FEATURE ID** : SUP-020
- **Nom** : Plan de dotation du support et de l'exploitation (prérequis d'ouverture)
- **Module** : Back-office & exploitation (SUP — Exploitation)
- **Persona** : fondateur ; responsable ops
- **Objectif** : ne publier aucune plage de support sans équipe pour la tenir.
- **Description** : prérequis opérationnel, pas un logiciel. 7 h–22 h, 7 j/7 = 105 h/semaine ≈ 2,6 ETP de présence (≈ 3 à 3,5 personnes) en plus de l'équipe de build ; charges récurrentes à chiffrer (KYC 4 h ouvrées, KYB, annonces, risque 2 h ouvrées, dommages, facturation, rapprochement). Options : 8 h–20 h (84 h ≈ 2,1 ETP), sous-traitance, urgence hors plage confiée aux agences et à l'assureur. Responsable ops nommé.
- **Déclencheur** : porte G1b (recrutement).
- **Prérequis** : SUP-004.
- **Parcours principal** : plan → recrutement → planning → validation avant ouverture.
- **Parcours alternatifs** : dotation insuffisante → plage publiée réduite.
- **Règles métier** : aucune BR.
- **États** : —
- **Erreurs** : —
- **Données** : planning (document).
- **Notifications** : —
- **Permissions** : —
- **Dépendances** : SUP-004.
- **Critères d'acceptation** : Given la plage publiée, When l'ouverture est demandée, Then un planning de présence la couvre et a été validé.
- **Source** : VERIF_10 V10-10 ; 15 K.3 (C) ; écrans 10b : S17.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — planning de présence ; aucun logiciel.
- **Complexité** : faible ; ops élevé ; risque moyen.
- **Améliorations possibles** : outil de planification.

## E13 — Légal, consentements, langues et pays (P0-A, 12 lignes)

#### Fiche LEG-001 / LEG-002 — CGU et consentements horodatés et versionnés
- **FEATURE ID** : LEG-001, LEG-002
- **Nom** : Acceptation des CGU et de la confidentialité (LEG-001) ; consentements horodatés et versionnés (LEG-002)
- **Module** : Légal, données & localisation (LEG — Consentements)
- **Persona** : tous
- **Objectif** : prouver, pour chaque trip, quelle version de chaque document a été acceptée.
- **Description** : LEG-001 : case obligatoire à l'inscription et au checkout. LEG-002 (absorbe LEG-003, LEG-004) : table consent(utilisateur, type, version, langue, accepted_at, ip, user_agent, contexte) ; documents versionnés : CGU guest, confidentialité, consentement biométrique, contrat de location, contrat-cadre, opt-in marketing non pré-coché, messages WhatsApp/SMS transactionnels. Version majeure → ré-acceptation à la connexion suivante.
- **Déclencheur** : inscription, checkout, signature, nouvelle version.
- **Prérequis** : ACC-001 (LEG-001) ; LEG-001 (LEG-002).
- **Parcours principal** : affichage de la version courante → acceptation → enregistrement.
- **Parcours alternatifs** : refus d'une nouvelle version majeure → accès limité (consultation des trips en cours, pas de nouvelle réservation).
- **Règles métier** : BR-ACC-01.
- **États** : consent `GIVEN` / `WITHDRAWN` ; document_version `DRAFT` → `PUBLISHED` → `SUPERSEDED`.
- **Erreurs** : `TERMS_NOT_ACCEPTED`, `TERMS_REACCEPT_REQUIRED`.
- **Données** : consent ; legal_document(type, version, lang, published_at, hash).
- **Notifications** : `EVT_TERMS_UPDATED` (version majeure).
- **Permissions** : tous (acceptation) ; `ADMIN` (publication).
- **Dépendances** : LEG-001 → ACC-001 ; LEG-002 → LEG-001.
- **Critères d'acceptation** : Given un trip, When on consulte ses consentements, Then la version exacte de chaque document accepté est retrouvée (NFR-17). Given une version majeure publiée, When le guest se reconnecte, Then `TERMS_REACCEPT_REQUIRED` avant toute réservation.
- **Source** : 06 Inscription ; 05 G-BOOK-01 ; 08 BR-ACC-01 reco ; écrans 10b : S05, S15.
- **Confiance** : confirmé (LEG-001 OBSERVÉ) ; proposé (LEG-002).
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : LEG-001 OUI ; LEG-002 SIMPLIFIÉ — table de consentements versionnés, sans ré-acceptation forcée.
- **Complexité** : faible / moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : centre de préférences (P1).

#### Fiche LEG-009 / LEG-010 — Rétention, pseudonymisation, registre Ley 81
- **FEATURE ID** : LEG-009, LEG-010
- **Nom** : Politique de rétention et pseudonymisation (LEG-009) ; registre des traitements et DPO (LEG-010)
- **Module** : Légal, données & localisation (LEG — Données)
- **Persona** : PER-07 (responsable des données)
- **Objectif** : conformité Ley 81/2019 dès la première collecte biométrique.
- **Description** : LEG-009 : conservation légale des factures et pièces de sinistre, puis pseudonymisation ; durées prudentes en attendant OQ-BR-25. LEG-010 : avant la première collecte en production, registre (finalités, bases légales, catégories dont biométrie, destinataires, sous-traitants, transferts hors du Panama et garanties, durées) ; responsable ou contact des données ; procédure de violation (détection, qualification, journal, notification à l'autorité et aux personnes, délais OQ-MK-09) reliée à ADM-035 ; clause de sous-traitance avec le fournisseur KYC. Validés par l'avocat. LEG-009 : registres immuables effacés par crypto-shredding (destruction de la clé propre à la personne, ADR-026), jamais par modification. LEG-010 : registres `data_subject_request`, `security_incident` et `subprocessor` tenus avant la première collecte ; finalité **« remboursement par virement »** (coordonnées bancaires du guest collectées pour un remboursement Yappy, vue A12) inscrite avec son responsable désigné (**UXQ-11 ouverte**) (consolidé VERIF_15-F2(iv) ; 17-C04-10 ; 10b §7).
- **Déclencheur** : avant le KYC en production ; tâches de purge.
- **Prérequis** : LEG-002 ; LEG-009 (pour LEG-010).
- **Parcours principal** : registre validé → KYC activé ; tâche de purge → pseudonymisation tracée.
- **Parcours alternatifs** : dossier en litige → gel de la purge jusqu'à la clôture.
- **Règles métier** : BR-ACC-09, BR-VERIF-01.
- **États** : retention_job `SCHEDULED` → `DONE` ; data_hold `ACTIVE` / `RELEASED`.
- **Erreurs** : `KYC_PRODUCTION_BLOCKED_NO_REGISTER`.
- **Données** : retention_policy(category, duration, legal_basis, version) ; processing_register (document) ; purge_log.
- **Notifications** : —
- **Permissions** : `ADMIN`.
- **Dépendances** : LEG-009 → LEG-002 ; LEG-010 → LEG-002, LEG-009.
- **Critères d'acceptation** : Given le registre non validé, When le KYC de production est activé, Then `KYC_PRODUCTION_BLOCKED_NO_REGISTER` (drapeau de configuration). Given un trip clos sans litige depuis la durée prévue, When la tâche s'exécute, Then les données sont pseudonymisées et la purge journalisée.
- **Source** : 08 BR-ACC-09 reco ; 12 §3.5 ; écrans 10b : A12.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : LEG-009 SIMPLIFIÉ (aligné v4, C-v3-02 : chiffrement par clé de sujet dès le lot 0, destruction manuelle tracée) ; LEG-010 MANUEL — durées prudentes documentées, purge manuelle tracée ; registre et procédure tenus par le responsable des données.
- **Complexité** : moyenne / faible ; ops faible / moyen ; risque élevé.
- **Améliorations possibles** : droits des personnes en libre-service (LEG-005, P1).

#### Fiche LEG-011 / LEG-015 — Centre légal, litiges et droit applicable
- **FEATURE ID** : LEG-011, LEG-015
- **Nom** : Centre légal (LEG-011) ; résolution des litiges et droit applicable (LEG-015)
- **Module** : Légal, données & localisation (LEG — Documents, Litiges)
- **Persona** : tous
- **Objectif** : textes publics, versionnés, conformes au Panama.
- **Description** : LEG-011 (absorbe I18N-010) : pages es/en versionnées : CGU guest, confidentialité, annulation, règles de location, non-discrimination, FAQ de bêta (SUP-001) ; textes par l'avocat. LEG-015 : droit panaméen ; médiation interne (ADM-008) puis voies externes (ACODECO, tribunaux de Panamá) ; **pas** de clause « définitive sans appel » ni d'arbitrage obligatoire avant OQ-BR-24 ; version acceptée rattachée à chaque trip.
- **Déclencheur** : publication.
- **Prérequis** : aucun (LEG-011) ; LEG-011, LEG-002 (LEG-015).
- **Parcours principal** : texte validé → publication versionnée → lien dans les écrans.
- **Parcours alternatifs** : —
- **Règles métier** : BR-CXL (politique d'annulation publiée), BR-ACC-01.
- **États** : legal_document (voir LEG-002).
- **Erreurs** : —
- **Données** : legal_document.
- **Notifications** : `EVT_TERMS_UPDATED`.
- **Permissions** : public (lecture), `ADMIN` (publication).
- **Dépendances** : LEG-015 → LEG-011, LEG-002.
- **Critères d'acceptation** : Given une page légale, When elle est servie, Then elle porte sa version et sa date et existe en es et en (la version espagnole fait foi). Given le texte des CGU, When on le recherche, Then « definitiva e inapelable » n'y figure pas tant qu'OQ-BR-24 est ouverte.
- **Source** : 08 BR-CXL (pages sœurs) ; TOS-GENERAL ; SRC_G 7.19 ; écrans 10b : S15.
- **Confiance** : confirmé (LEG-011) ; documenté (LEG-015).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : LEG-011 SIMPLIFIÉ — pages statiques CGU, confidentialité, annulation ; LEG-015 MANUEL — clause intégrée aux CGU statiques.
- **Complexité** : faible ; ops moyen / faible ; risque moyen.
- **Améliorations possibles** : historique des versions consultable.

#### Fiche LEG-014 — Positionnement d'intermédiaire
- **FEATURE ID** : LEG-014
- **Nom** : Positionnement d'intermédiaire (« not a rental car company »)
- **Module** : Légal, données & localisation (LEG — Positionnement)
- **Persona** : tous
- **Objectif** : qualification réglementaire correcte (art. 288, OQ-MK-01).
- **Description** : la plateforme est un service d'intermédiation facturé au loueur ; l'agence est le loueur, le marchand de référence et la partie au contrat ; mentions au checkout, au contrat et dans les CGU ; formulation finale soumise à l'avis OQ-MK-01.
- **Déclencheur** : affichage checkout, contrat, CGU, reçu.
- **Prérequis** : avis OQ-MK-01.
- **Parcours principal** : mention fixe paramétrée (texte validé).
- **Parcours alternatifs** : avis négatif → lancement dans l'autre pays (12 §10.3 ; les deux pays sont construits, DEC-FONDATEUR-04).
- **Règles métier** : aucune BR ; TOS-GENERAL.
- **États** : —
- **Erreurs** : —
- **Données** : legal_document (mention).
- **Notifications** : —
- **Permissions** : `ADMIN`.
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given le checkout, le contrat et le reçu, When ils sont rendus, Then la mention d'intermédiaire et l'identité du loueur (raison sociale, RUC) y figurent.
- **Source** : TOS-GENERAL ; écrans 10b : S03.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — mention fixe au checkout, au contrat et dans les CGU.
- **Complexité** : faible ; ops faible ; risque élevé.
- **Améliorations possibles** : —

#### Fiche LEG-020 — Mandat de l'agence à la plateforme
- **FEATURE ID** : LEG-020
- **Nom** : Mandat de l'hôte (agence) à la plateforme (attorney-in-fact)
- **Module** : Légal, données & localisation (LEG — Mandat)
- **Persona** : PER-03 ; PER-07
- **Objectif** : permettre à la plateforme d'instruire et de transmettre au nom de l'agence.
- **Description** : dans le contrat-cadre : instruire les dossiers de dommage et de non-restitution, transmettre les pièces à l'assureur, envoyer les mises en demeure au nom de l'agence. **Pas** de mandat d'encaissement en P0-A ; opérations PSP = LEG-027. Absorbe l'ex-HST-015.
- **Déclencheur** : signature du contrat-cadre.
- **Prérequis** : LEG-025.
- **Parcours principal** : clause signée → actions CLM-006, TRP-038 autorisées.
- **Parcours alternatifs** : mandat révoqué → la plateforme ne peut plus agir au nom de l'agence (instruction interne seulement).
- **Règles métier** : BR-PROT-10.
- **États** : mandate(type=CLAIMS) `ACTIVE` / `REVOKED`.
- **Erreurs** : `MANDATE_REQUIRED`.
- **Données** : psp_mandate(org_id, document_id, allowed_operations, version, signed_at, revoked_at).
- **Notifications** : —
- **Permissions** : `OPS_AGENT`.
- **Dépendances** : LEG-025.
- **Critères d'acceptation** : Given un mandat révoqué, When l'ops génère une mise en demeure au nom de l'agence, Then `MANDATE_REQUIRED`.
- **Source** : TOS-HOST ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : MANUEL — clause du contrat-cadre signé hors ligne.
- **Complexité** : faible ; ops faible ; risque élevé.
- **Améliorations possibles** : —

#### Fiche LEG-027 — Mandat écrit limité pour les opérations PSP
- **FEATURE ID** : LEG-027
- **Nom** : Mandat écrit limité pour les opérations sur le compte PSP de l'agence
- **Module** : Légal, données & localisation (LEG — Contrat loueur)
- **Persona** : PER-03 (représentant légal) ; PER-07
- **Objectif** : aucune opération initiée par la plateforme sur le compte d'une agence sans autorisation écrite.
- **Description** : annexe au contrat-cadre : liste fermée des opérations (création d'ordres ou de liens, void, remboursement par API), montants bornés par le calcul de la plateforme (BR-CXL, PRC-025), journalisation, révocation à tout moment, aucune réception ni détention de fonds ; accord écrit du PSP sur l'usage des identifiants API par un tiers (OQ-PAY-03). Sans mandat ni accord : mode (b).
- **Déclencheur** : onboarding PSP.
- **Prérequis** : LEG-025.
- **Parcours principal** : signature → mandat `ACTIVE` → chaque appel PSP porte `mandate_id`.
- **Parcours alternatifs** : révocation → passage immédiat en mode b ; opération hors liste → refus.
- **Règles métier** : BR-PAY-08.
- **États** : mandate(type=PSP_OPS) `ACTIVE` / `REVOKED` / `EXPIRED`.
- **Erreurs** : `MANDATE_REQUIRED`, `MANDATE_OPERATION_NOT_ALLOWED`, `MANDATE_AMOUNT_EXCEEDED`.
- **Données** : mandate(…, allowed_ops[]), psp_call_log.mandate_id.
- **Notifications** : `EVT_MANDATE_REVOKED` (ops).
- **Permissions** : représentant légal ; `SYSTEM`.
- **Dépendances** : LEG-025.
- **Critères d'acceptation** : Given une agence sans mandat en vigueur, When un appel d'ordre ou de remboursement est demandé, Then aucun appel API (`MANDATE_REQUIRED`). Given un remboursement supérieur au montant calculé, When il est demandé, Then `MANDATE_AMOUNT_EXCEEDED`. Given chaque appel, When il a lieu, Then il est journalisé avec l'identifiant du mandat.
- **Source** : VERIF_10 V10-05 ; 09b §5.2 ; écrans 10b : A07.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : MANUEL — sans objet en mode (b) ; clause d'autorisation limitée insérée dans le contrat-cadre signé.
- **Complexité** : faible ; ops moyen ; risque élevé.
- **Améliorations possibles** : —

#### Fiche I18N-003 / I18N-004 / I18N-005 — Espagnol et anglais, devises USD et PYG
- **FEATURE ID** : I18N-003, I18N-004, I18N-005
- **Nom** : Espagnol et anglais au lancement (I18N-003) ; devise USD au Panama (I18N-004) ; devise PYG au Paraguay (I18N-005)
- **Module** : Légal, données & localisation (I18N — Langue, Devise)
- **Persona** : tous
- **Objectif** : une expérience entièrement localisée et des montants exacts.
- **Description** : I18N-003 (absorbe I18N-006, 008, 009, 011) : es-PA et en pour toutes les chaînes, notifications, contrats, pages légales ; langue choisie à l'inscription, sinon Accept-Language ; aucune chaîne en dur ; clé manquante = échec du build ; dates jj/mm/aaaa ; heures 24 h (es) / 12 h (en) ; km ; E.164 ; adresses sans code postal ; UTC + IANA America/Panama. I18N-004 : USD en cents ; « US$ 1.234,56 » (es-PA) et « $1,234.56 » (en) ; arrondi par ligne (demi au supérieur) ; total = somme des lignes ; aucun taux de change. I18N-005 (promue P0-A par la passe VERIF_18, DEC-FONDATEUR-04) : PYG à exposant 0, aucune décimale stockée ni affichée, prix et forfaits saisis en PYG, arrondi d'affichage en multiples de 1 000 en paramètre pays ; locales es-PA, es-PY et en ; fuseau `America/Asuncion` à côté de `America/Panama`.
- **Déclencheur** : rendu de tout écran et document.
- **Prérequis** : PRC-021 (I18N-004, I18N-005).
- **Parcours principal** : clés de traduction → rendu selon la locale.
- **Parcours alternatifs** : clé manquante → build en échec.
- **Règles métier** : BR-PRICE-14, BR-CXL-00.
- **États** : —
- **Erreurs** : —
- **Données** : user.locale ; fichiers de traduction.
- **Notifications** : toutes, dans la langue du compte.
- **Permissions** : —
- **Dépendances** : I18N-004 → PRC-021 ; I18N-005 → PRC-021.
- **Critères d'acceptation** : Given un écran en es, When le test automatisé le parcourt, Then aucune chaîne anglaise (et réciproquement). Given 1 234,56 US$, When affiché en es-PA, Then « US$ 1.234,56 » ; en en, « $1,234.56 ». Given TA01, When on additionne les lignes, Then 128,40 sur la fiche, le checkout, le contrat et le relevé. Given les vecteurs T48 et T62 en PYG, When le règlement est calculé, Then les montants sont des entiers de PYG identiques aux attendus de 08 et le même parcours E2E passe en USD et en PYG.
- **Source** : 05 G-ACCOUNT-02 (9 locales observées) ; 08 Conventions ; TOS-GENERAL ; écrans 10b : S01, S02, S03, S14.
- **Confiance** : confirmé (I18N-003) ; documenté (I18N-004).
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ (I18N-003, I18N-004) — chaînes es/en limitées aux écrans et gabarits de la tranche ; format USD par langue ; OUI (I18N-005) — PYG construit tel que décrit.
- **Complexité** : moyenne / faible ; ops moyen / faible ; risque faible.
- **Améliorations possibles** : pt-BR (P2, visiteurs brésiliens au Paraguay).

## E14 — Encaissement plateforme, caution et débits post-trip (P0-B, 8 lignes)

> **Porte G2** : aucune de ces fiches n'est construite avant les avis OQ-MK-02, OQ-MK-03 (si entité US), OQ-PAY-05 et la validation PSP (OQ-PAY-02, OQ-PAY-04, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21). BR-PAY-06 (seuil de pré-autorisation) et BR-REIMB-03 (48 h) sont **remplacés pour le build** par PAY-036 et PAY-037 (04 README §9). Rubrique « Bêta pilote » : sans objet (P0-B).

#### Fiche PAY-011 / PAY-012 / PAY-036 — Caution plateforme, libération et fenêtre de rétention
- **FEATURE ID** : PAY-011, PAY-012, PAY-036
- **Nom** : Dépôt de garantie (PAY-011) ; libération automatique du dépôt (PAY-012) ; fenêtre de rétention de la caution et ré-autorisation (PAY-036)
- **Module** : Paiements (PAY — Dépôt, Caution P0-B)
- **Persona** : PER-01, PER-02 ; PER-06
- **Objectif** : caution détenue par la plateforme sans dépasser la validité réelle des autorisations.
- **Description** : PAY-011 : caution autorisée sur la carte du guest, montant selon classe et risque ; posée à `auth_at` (défaut J-1) et libérée 72 h après le retour (valeur Turo : 80 h, non reprise), jamais suspendue par une réclamation ; elle ne garantit que les **frais annexes de la liste fermée** acceptée au checkout (08 BR-PAY-06) ; toute retenue de ces frais exige les preuves CLM-034. PAY-012 : libération automatique à fin + 72 h `{param}`, sauf frais annexes de la liste fermée facturés avant l'échéance ; la caution n'est **jamais** suspendue par une Claim, une facture ou des frais d'assistance (T57) ; un dommage est recouvré séparément sur la carte enregistrée (REQ-PAY-DMG-02 à 07, BR-PAY-09 bis), jamais sur la caution. PAY-036 : forme en heures, qui prévaut (08 BR-PAY-06) : `H_requise = (scheduled_start − auth_at) + (scheduled_end − scheduled_start) + release_delay (72 h) + marge (0 h)` ; pré-autorisation unique si `H_requise ≤ V` (validité contractuelle `provider_max_hold[psp][pays][réseau]`, inconnue ⇒ 0) ; repère d'affichage seulement : durée du trip + 4 j ≤ V (trips ≤ 3 j à 7 j de validité ; 3 j + 25 min échoue, T59) ; au-delà : ré-autorisation planifiée à `auth_expiry − 24 h` (MIT REAUTHORIZATION, incrémentale Mastercard, nouvelle autorisation Visa) si validée, ou débit puis remboursement plafonné par `deposit_charge_cap[pays]` (inconnu ⇒ 0, rail interdit ; frais non restitués OQ-PAY-19), sinon caution au comptoir ou carte de crédit exigée ; validité par PSP dans ADM-014.
- **Déclencheur** : J-1/H-1 ; retour ; échéance de validité.
- **Prérequis** : PAY-006, PAY-036, CLM-034 (PAY-011) ; PAY-011 (PAY-012) ; ADM-014 (PAY-036).
- **Parcours principal** : calcul de faisabilité → pré-autorisation → retour → décision à fin + 70 h → capture partielle du dû + void du reste (T57) → libération.
- **Parcours alternatifs** : pas de capture partielle → void total + débit MIT (T58) ; trip trop long → ré-autorisation si validée, sinon débit plafonné, sinon caution au comptoir ou carte de crédit exigée (T59) ; refus de carte pour la caution (EC-27) → `FAILED` de SM-1b, motif `PSP_FAILURE` si panne.
- **Règles métier** : BR-PAY-06 (référence, seuil remplacé), BR-PAY-08, BR-VERIF-09, BR-PAY-09 bis.
- **États** : deposit `PLANNED` → `AUTHORIZED` → `PARTIALLY_CAPTURED` / `VOIDED` / `REAUTHORIZED` (PROPOSÉ) ; SM-1b.
- **Erreurs** : `DEPOSIT_AUTH_FAILED`, `DEPOSIT_WINDOW_EXCEEDED`, `PSP_CAPABILITY_MISSING`.
- **Données** : deposit(trip_id, amount, psp, auth_at, valid_until, released_at, captured_minor).
- **Notifications** : `EVT_DEPOSIT_AUTHORIZED`, `EVT_DEPOSIT_RELEASED`.
- **Permissions** : `SYSTEM` ; `OPS_AGENT` (décision de retenue).
- **Dépendances** : PAY-011 → PAY-006, PAY-036, CLM-034 ; PAY-012 → PAY-011 ; PAY-036 → ADM-014.
- **Critères d'acceptation** : Given T57, When la décision est prise à fin + 70 h, Then capture 12,00 et void 288,00, la Claim n'ayant pas suspendu la libération. Given T58, When le PSP n'a pas `supports_partial_capture`, Then void 300,00 puis MIT 12,00. Given T59 (3 j + 25 min, validité 168 h), When la faisabilité est calculée, Then pas de pré-autorisation unique.
- **Source** : SRC_G 2.5.1, 2.5.3 ; VERIF_08 V8-01, V8-02 ; 09b §4 ; 11 EC-27, EC-56 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : documenté (caution Turo) ; fenêtre proposée.
- **Priorité produit** : P0-B
- **Bêta pilote** : sans objet (P0-B).
- **Complexité** : moyenne / faible / moyenne ; ops moyen / faible / faible ; risque élevé.
- **Améliorations possibles** : caution modulée (PAY-039, P1).

#### Fiche PAY-015 / PAY-037 — Carte enregistrée (MIT) et débits post-trip conformes aux réseaux
- **FEATURE ID** : PAY-015, PAY-037
- **Nom** : Carte enregistrée et débits ultérieurs (MIT) (PAY-015) ; consentement et notification des débits post-trip conformes aux réseaux (PAY-037)
- **Module** : Paiements (PAY — Carte stockée, Débits post-trip)
- **Persona** : PER-01, PER-02 ; PER-06 ; PER-07
- **Objectif** : débiter légalement les frais post-trip décidés.
- **Description** : PAY-015 : carte débitable pour frais de retard, cautions, réclamations, frais admin ; consentement credential-on-file explicite en espagnol. PAY-037 : consentement écrit du porteur au check-in ; dommage = transaction séparée après constat ; notification écrite sous 10 j après le retour ; préavis d'objection ≥ 20 j (Visa) ; débit au plus tard J+30 (Mastercard) ou J+90 (Visa) ; jamais de marge pour dommages dans l'autorisation estimée ; règles LAC À VALIDER (OQ-PAY-18).
- **Déclencheur** : décision CLM-006/ADM-008 ; frais de retard.
- **Prérequis** : PAY-002, LEG-002 (PAY-015) ; PAY-015 (PAY-037).
- **Parcours principal** : consentement → décision → notification → délai d'objection → débit MIT → succès.
- **Parcours alternatifs** : refus de carte (EC-28) → dette guest (`DebtBalance`, restriction `UNPAID_BALANCE`, relances J0/J+3/J+7, T29) ; objection → litige SM-7.
- **Règles métier** : BR-PAY-09, BR-PAY-09 bis, BR-PAY-10, BR-REIMB-03 (remplacé), BR-ACC-10.
- **États** : SM-5 (`CHARGED` → `PAID` / `UNPAID`) ; SM-8.
- **Erreurs** : `MIT_CONSENT_MISSING`, `MIT_NOTICE_PERIOD_NOT_ELAPSED`, `MIT_DEADLINE_PASSED`.
- **Données** : card_on_file(user_id, psp_token, consent_id), post_trip_charge(trip_id, type, amount, notified_at, objection_until, charged_at).
- **Notifications** : `EVT_POST_TRIP_CHARGE_NOTICE`, `EVT_POST_TRIP_CHARGED`.
- **Permissions** : `SYSTEM` ; décision `OPS_AGENT`.
- **Dépendances** : PAY-015 → PAY-002, LEG-002 ; PAY-037 → PAY-015.
- **Critères d'acceptation** : Given une notification envoyée il y a 15 j (Visa), When un débit est tenté, Then `MIT_NOTICE_PERIOD_NOT_ELAPSED`. Given T50 et T64, When un débit MIT est requis, Then 118,44 et 69,22 avec les clés d'idempotence de 08. Given T29, When le MIT est refusé, Then dette de 69,22 et restriction. Given T68, When le débit MIT de 69,22 est refusé à J0, en timeout à J+3 puis accepté à J+7, Then une seule instance, clés a1, a2 et a3, et 69,22 débités une fois (consolidé VERIF_15-F5).
- **Source** : TOS-FEES ; SRC_G 6.9.1 ; VERIF_08 V8-03, V8-15 ; 11 EC-28 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : documenté (PAY-015) ; proposé (PAY-037).
- **Priorité produit** : P0-B
- **Bêta pilote** : sans objet (P0-B).
- **Complexité** : moyenne ; ops faible / moyen ; risque élevé.
- **Améliorations possibles** : échéancier (BR-DAMAGE-08, P1).

#### Fiche CLM-021 — Paiement ou contestation par le guest
- **FEATURE ID** : CLM-021
- **Nom** : Paiement ou contestation par le guest sous 72 h (`invoice_guest_response_h`)
- **Module** : Sinistres & protection (CLM — Factures annexes)
- **Persona** : PER-01, PER-02 ; PER-07
- **Objectif** : laisser au guest le temps de payer ou de contester avant un débit.
- **Description** : Turo : 48 h, puis la plateforme tranche et peut débiter la carte ; [NOUS] 72 h ; en P0-B, le délai est **subordonné à PAY-037** (notification, préavis d'objection ≥ 20 j Visa) ; en P0-A, décision tracée, règlement entre guest et agence.
- **Déclencheur** : facture annexe ou décision de dommage.
- **Prérequis** : CLM-006, PAY-015, PAY-037.
- **Parcours principal** : `AWAITING_GUEST` → paiement (`PAID`) ou contestation (`DISPUTED`) ou silence → `PLATFORM_DECISION` → `CHARGED`.
- **Parcours alternatifs** : débit refusé → `UNPAID` → relances → `PAYMENT_PLAN` / `COLLECTIONS`.
- **Règles métier** : BR-REIMB-02, BR-REIMB-03, BR-REIMB-01, BR-PAY-10.
- **États** : SM-5.
- **Erreurs** : `GUEST_RESPONSE_WINDOW_OPEN`.
- **Données** : reimbursement_request (SM-5).
- **Notifications** : `EVT_INVOICE_TO_GUEST`, `EVT_INVOICE_REMINDER`.
- **Permissions** : `GUEST` (payer, contester), `OPS_AGENT` (décider).
- **Dépendances** : CLM-006 ; PAY-015 ; PAY-037.
- **Critères d'acceptation** : Given une facture de frais annexes notifiée à J0 10:00 et `invoice_guest_response_h` = 72, When il est J+3 09:59, Then aucun débit ; à J+3 10:00 la plateforme peut trancher (P0-B, sous réserve de PAY-037 ; consolidé VERIF_15-F7, 17 A7) (`GUEST_RESPONSE_WINDOW_OPEN`). Given une contestation avec preuves, When elle est déposée, Then SM-5 passe `DISPUTED`.
- **Source** : SRC_G 6.9.1 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : documenté.
- **Priorité produit** : P0-B
- **Bêta pilote** : sans objet (P0-B).
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : paiement de solde in-app (PAY-025, P1).

#### Fiche PAY-038 — Split de la commission à la source
- **FEATURE ID** : PAY-038
- **Nom** : Split de la commission à la source par le PSP
- **Module** : Paiements (PAY — Commission P0-B)
- **Persona** : PER-06, PER-03
- **Objectif** : prélever la commission sans créance à recouvrer.
- **Description** : l'ordre reste sur le compte de l'agence ; la commission est reversée à la plateforme par l'endpoint de split du PSP (Tilopay orders/liquidation/split) au lieu de la facture mensuelle ; activé par agence après OQ-PAY-03 et OQ-PAY-15 (compatibilité avec la facture électronique de l'agence).
- **Déclencheur** : paiement d'un trip pour une agence en mode split.
- **Prérequis** : FIN-018, PAY-033.
- **Parcours principal** : ordre avec split → liquidation → commission reçue → lettrage.
- **Parcours alternatifs** : annulation → split ajusté selon le règlement ; PSP sans split → facture FIN-018.
- **Règles métier** : BR-PAYOUT-05.
- **États** : organization.commission_mode `INVOICE` | `SPLIT`.
- **Erreurs** : `PSP_CAPABILITY_MISSING`.
- **Données** : split(trip_id, amount_minor, psp_ref).
- **Notifications** : —
- **Permissions** : `ADMIN` (activation).
- **Dépendances** : FIN-018 ; PAY-033.
- **Critères d'acceptation** : Given une agence en mode split, When le relevé mensuel est produit, Then il est identique à FIN-018 et ne crée aucune créance (TA08 : 34,20 prélevés à la source).
- **Source** : 09b §5.2 ; VERIF_08 §2 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-B
- **Bêta pilote** : sans objet (P0-B).
- **Complexité** : moyenne ; ops faible ; risque élevé.
- **Améliorations possibles** : —

#### Fiche PRC-012 — Frais de service guest (trip fee)
- **FEATURE ID** : PRC-012
- **Nom** : Trip fee (frais de service guest)
- **Module** : Tarification & devis (PRC — Frais plateforme)
- **Persona** : PER-01, PER-02
- **Objectif** : second revenu, seulement si la plateforme peut facturer le consommateur.
- **Description** : Turo : pourcentage variable (valeur, anticipation, durée), ≈ 22–24 % mesuré (OBSERVÉ, recalcul) ; [NOUS] table publiée 15 % / 12 % / 8 % + minimum. **0 en P0-A**. P0-B après OQ-MK-01 (art. 288), OQ-MK-02, OQ-PAY-05.
- **Déclencheur** : devis.
- **Prérequis** : PRC-025.
- **Parcours principal** : ligne F dans le devis, taxable selon `tax_line_config`, non partagée avec l'agence.
- **Parcours alternatifs** : annulation → retenue de F selon BR-CXL-06 (T03 : F 6,00 retenu).
- **Règles métier** : BR-PRICE-06, BR-CXL-06.
- **États** : —
- **Erreurs** : —
- **Données** : quote.lines[type=TRIP_FEE].
- **Notifications** : —
- **Permissions** : `ADMIN` (barème).
- **Dépendances** : PRC-025.
- **Critères d'acceptation** : Given le mode P0-A, When un devis est calculé, Then F = 0. Given le mode P0-B et T03, When l'annulation est réglée, Then la part de F retenue est 6,00.
- **Source** : 05 G-BOOK-02, G-BOOK-06 ; EV-0007 ; EV-0026 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : confirmé (montants observés, taux recalculé).
- **Priorité produit** : P0-B
- **Bêta pilote** : sans objet (P0-B).
- **Complexité** : moyenne ; ops faible ; risque élevé.
- **Améliorations possibles** : prix tout compris (PRC-026, P1).

## E15 — Versements, ITBMS collecté et rapprochement (P0-B, 5 lignes)

#### Fiche PYO-001 / PYO-002 — Compte de versement et versements ACH aux sociétés
- **FEATURE ID** : PYO-001, PYO-002
- **Nom** : Compte de versement et vérification (PYO-001) ; versements aux sociétés par ACH Panama (PYO-002)
- **Module** : Finance & facturation (PYO — Compte, Rails)
- **Persona** : PER-03 ; PER-06
- **Objectif** : reverser aux agences les sommes encaissées pour leur compte.
- **Description** : PYO-001 : compte bancaire au nom de la société (RUC concordant), vérifié avant le premier versement ; changement = nouvelle vérification et blocage 48 h. PYO-002 (absorbe PYO-004) : ACH via le PSP retenu (dLocal, Localpayment) ou une banque locale, J+2 ouvrés après le trip (BR-PAYOUT-02), retenue possible en cas de litige ; ACH Xpress ≤ 5 000 $ par transaction.
- **Déclencheur** : trip terminé ; lot quotidien.
- **Prérequis** : VER-027 (PYO-001) ; PYO-001, PAY-001 (PYO-002).
- **Parcours principal** : `SCHEDULED` → `NETTING` → `READY` → `INITIATED` → `IN_TRANSIT` → `PAID`.
- **Parcours alternatifs** : litige / chargeback → `ON_HOLD` ; rejet bancaire → `FAILED` → `ON_HOLD` ; montant > 5 000 $ en Xpress → fractionnement ou ACH Directo.
- **Règles métier** : BR-PAYOUT-01, BR-PAYOUT-02, BR-PAYOUT-04.
- **États** : SM-6.
- **Erreurs** : `PAYOUT_ACCOUNT_UNVERIFIED`, `PAYOUT_ACCOUNT_CHANGE_HOLD`.
- **Données** : payout_account(org_id, bank, account_masked, verified_at), payout_batch(id, org_id, net_minor, status) / payout_item.
- **Notifications** : `EVT_PAYOUT_SENT`, `EVT_PAYOUT_FAILED`.
- **Permissions** : `AGENCY_MANAGER` (compte), `FINANCE`.
- **Dépendances** : PYO-001 → VER-027 ; PYO-002 → PYO-001, PAY-001.
- **Critères d'acceptation** : Given un changement de compte, When un versement est prévu dans les 48 h, Then il passe `ON_HOLD`. Given un chargeback ouvert, When le lot est préparé, Then le versement du trip est `ON_HOLD`.
- **Source** : SRC_H §1.1 ; 08 BR-PAYOUT-01 ; 12 §9.3 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : documenté (base Turo) ; rails proposés.
- **Priorité produit** : P0-B
- **Bêta pilote** : sans objet (P0-B).
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : rails alternatifs (PYO-017, P1).

#### Fiche PYO-007 — Grand livre agence, compensations et solde négatif
- **FEATURE ID** : PYO-007
- **Nom** : Grand livre hôte (agence), compensations et solde négatif
- **Module** : Finance & facturation (PYO — Grand livre)
- **Persona** : PER-06 ; PER-03
- **Objectif** : compenser pénalités, reprises et remboursements sur les versements.
- **Description** : grand livre par agence : gains nets, pénalités, remboursements, crédits ; solde négatif compensé sur les versements suivants ; au-delà de 30 j ou d'un seuil ADM-031 : facture à l'agence et blocage des nouveaux versements (À DÉCIDER). Porte SM-6 (ex-PYO-016) et SM-6b.
- **Déclencheur** : écritures FIN-001 ; versement.
- **Prérequis** : FIN-001, PYO-002, ADM-031.
- **Parcours principal** : écriture → solde → netting au versement.
- **Parcours alternatifs** : reprise après chargeback (T53, T54, T55) ; solde négatif durable → `DIRECT_DEBIT` → `PAYMENT_PLAN` / `COLLECTIONS` / `WRITTEN_OFF`.
- **Règles métier** : BR-PAYOUT-04, BR-PAY-11 ; 08 E1, E5.
- **États** : SM-6, SM-6b.
- **Erreurs** : —
- **Données** : host_ledger_state(org_id, currency, state) et écritures `journal_line` du compte `host_payable`.
- **Notifications** : `EVT_AGENCY_BALANCE_NEGATIVE`.
- **Permissions** : `FINANCE`.
- **Dépendances** : FIN-001 ; PYO-002 ; ADM-031.
- **Critères d'acceptation** : Given T53, When un chargeback est perdu après versement de 45,00, Then reprise 45,00 (et non 166,85). Given T54(a)/(b), When le lot n'est pas émis / est versé, Then reprise 0,00 / 25,50. Given T55, When la capture est en USD pour un trip en PYG, Then reprise 220 752 PYG sans écriture entre devises.
- **Source** : TOS-HOST ; 08 BR-PAYOUT-04 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : documenté.
- **Priorité produit** : P0-B
- **Bêta pilote** : sans objet (P0-B).
- **Complexité** : élevée ; ops moyen ; risque élevé.
- **Améliorations possibles** : —

#### Fiche FIN-004 — Collecte et reversement de l'ITBMS
- **FEATURE ID** : FIN-004
- **Nom** : Collecte et reversement de la TVA locale (ITBMS)
- **Module** : Finance & facturation (FIN — Fiscalité)
- **Persona** : PER-06
- **Objectif** : remplir les obligations fiscales d'une plateforme encaissante.
- **Description** : collecte de l'ITBMS sur les montants encaissés par la plateforme et reversement à la DGI ; affichage séparé ; application exacte À VALIDER (OQ-BR-14, OQ-MK-06). En P0-A, l'agence collecte l'ITBMS du loyer.
- **Déclencheur** : encaissement ; déclaration périodique.
- **Prérequis** : PRC-020.
- **Parcours principal** : taxe par ligne (PRC-020) → compte de taxe à reverser (FIN-001) → déclaration.
- **Parcours alternatifs** : remboursement → taxe remboursée au prorata (BR-CXL-06).
- **Règles métier** : BR-PRICE-12, BR-CXL-06.
- **États** : —
- **Erreurs** : `TAX_CONFIG_MISSING`.
- **Données** : tax_liability(period, amount).
- **Notifications** : —
- **Permissions** : `FINANCE`.
- **Dépendances** : PRC-020.
- **Critères d'acceptation** : Given T44 (deux groupes fiscaux), When le remboursement est réglé, Then taxe remboursée 8,80 et taxe retenue 5,40 (configuration de test). Given une période, When elle est clôturée, Then la taxe à reverser = taxe collectée − taxe remboursée.
- **Source** : SRC_G 2.4.9 ; TOS-FEES (marketplace facilitator) ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : documenté (Turo collecte aux US) ; application Panama à valider.
- **Priorité produit** : P0-B
- **Bêta pilote** : sans objet (P0-B).
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : —

#### Fiche FIN-005 — Rapprochement PSP et banques
- **FEATURE ID** : FIN-005
- **Nom** : Rapprochement PSP et banques
- **Module** : Finance & facturation (FIN — Trésorerie)
- **Persona** : PER-06
- **Objectif** : contrôle quotidien des fonds de tiers.
- **Description** : rapprochement quotidien des encaissements, frais, remboursements et versements entre relevés PSP/banque et grand livre (FIN-001) ; écarts → tâches.
- **Déclencheur** : quotidien.
- **Prérequis** : FIN-001.
- **Parcours principal** : import des relevés → appariement → écarts → résolution.
- **Parcours alternatifs** : écart non résolu sous 48 h → escalade `ADMIN` (PROPOSÉ).
- **Règles métier** : aucune BR.
- **États** : recon_run (voir FIN-019).
- **Erreurs** : `RECON_STATEMENT_MISSING`.
- **Données** : recon_run(source=PSP|BANK, date, matched, unmatched).
- **Notifications** : `EVT_RECON_DISCREPANCY`.
- **Permissions** : `FINANCE`.
- **Dépendances** : FIN-001.
- **Critères d'acceptation** : Given un relevé PSP du jour, When il est rapproché, Then chaque mouvement est apparié ou listé en écart ; Σ fonds de tiers au grand livre = solde PSP ± écarts expliqués.
- **Source** : 12 §9.12 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-B
- **Bêta pilote** : sans objet (P0-B).
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : rapprochement automatique par API.

## E16 — Fondations design, marque et contenus (P0-A, 7 lignes ; DEC-FONDATEUR-06 et 07)

> Ajouté par la passe de cohérence finale VERIF_18 (2026-10-30). Aucun nom de marque ni style n'existe encore : la première story est « Naming & identité » (DSN-001). Toute valeur visuelle est une **donnée** publiée par le fondateur, jamais une constante du code (17 ADR-036). Le MVP est un web mobile-first avec PWA installable ; les applications natives sont hors MVP (17 ADR-039).

#### Fiche DSN-001 / DSN-002 / DSN-005 / DSN-006 / DSN-007 — Fondations design : identité, tokens, bibliothèque, PWA et revue
- **FEATURE ID** : DSN-001, DSN-002, DSN-005, DSN-006, DSN-007
- **Nom** : Naming et identité de marque (DSN-001) ; design tokens pilotés par les données (DSN-002) ; bibliothèque de composants et design system visible (DSN-005) ; web mobile-first responsive et PWA installable (DSN-006) ; revue UX/design indépendante et validation des écrans clés (DSN-007)
- **Module** : Design, marque & contenus (DSN — Identité, Thème, Design system, Plateforme cliente, Gouvernance design)
- **Persona** : fondateur (PER-07, rôle `ADMIN`) ; tous les personas pour le rendu
- **Objectif** : une identité choisie par le fondateur, appliquée partout sans code en dur, sur un web mobile-first installable, avec une qualité visuelle vérifiée par un relecteur indépendant (DEC-FONDATEUR-06, DEC-FONDATEUR-07).
- **Description** : DSN-001 : l'agent DESIGN propose 3 à 5 noms (domaine disponible, recherche d'antériorité de marque à faire valider au Panama, DIGERPI, et au Paraguay, DINAPI) puis 2 à 3 directions visuelles (logo, palette, typographies, ton) ; le fondateur choisit par écrit ; le résultat devient la première version publiée du thème ; `{brand_name}` reste un paramètre tant que l'antériorité n'est pas confirmée. DSN-002 : couleurs, typographies, rayons, espacements, ombres, logo et favicon sont des tokens lus depuis la version publiée `brand_version` (17 ADR-036), exposés en variables CSS, avec valeurs de repli embarquées ; contraste AA vérifié à la publication. DSN-005 : composants partagés (boutons, champs, carte véhicule, prix TTC, étapes du checkout, états vides, erreurs, chargement) bâtis sur les tokens, documentés dans un catalogue consultable (états, variantes, accessibilité), captures de régression visuelle en CI. DSN-006 : conception d'abord à 360 px, puis tablette du comptoir et desktop ; PWA installable (manifeste généré depuis le thème publié, icônes, service worker, écran hors ligne, file d'envoi des photos de TRP-057) ; aucune application native dans le MVP (17 ADR-039). DSN-007 : toute story visible est relue avant fusion par un relecteur UX/design indépendant de l'agent qui l'a codée (cohérence avec le design system, mobile-first, accessibilité AA, textes es/en, états d'erreur de 10b) ; les écrans clés sont validés par le fondateur au point hebdomadaire (DEC-FONDATEUR-10).
- **Déclencheur** : démarrage du lot 0 (DSN-001 en premier) ; toute story visible (DSN-007) ; chaque rendu (DSN-002).
- **Prérequis** : DSN-002 (DSN-005, DSN-006) ; TRP-056 (DSN-006) ; DSN-005 (DSN-007).
- **Parcours principal** : propositions de noms et de directions → choix du fondateur → saisie en version de thème publiée → composants du catalogue → écrans mobile-first → revue design indépendante → validation des écrans clés.
- **Parcours alternatifs** : antériorité de marque douteuse → nom provisoire conservé en paramètre, aucune publication externe du nom ; lecture du thème impossible → valeurs de repli embarquées et alerte ops ; régression visuelle non approuvée → fusion bloquée.
- **Règles métier** : aucune BR de 08 (fonctionnalités [NOUS], DEC-FONDATEUR-06 et 07).
- **États** : thème `DRAFT` → `PUBLISHED` → `ARCHIVED` (`brand_version`, 17 ADR-036) ; revue design `REQUESTED` → `APPROVED` / `CHANGES_REQUESTED` (artefact du dépôt, 17 ADR-040).
- **Erreurs** : `BRAND_CONTRAST_INSUFFICIENT` (publication refusée), `BRAND_VERSION_UNAVAILABLE` (repli).
- **Données** : brand_version(id, version, status, tokens_json, logo_asset_id, published_at, published_by) ; brand_asset(id, kind, storage_ref, checksum) ; catalogue de composants versionné dans le dépôt ; rapports de revue design (artefacts).
- **Notifications** : —
- **Permissions** : `ADMIN` avec la permission `brand.publish` (fondateur) pour publier ; lecture publique de la version publiée.
- **Dépendances** : DSN-002 → aucune ; DSN-001 → aucune ; DSN-005 → DSN-002 ; DSN-006 → DSN-002, TRP-056 ; DSN-007 → DSN-005.
- **Critères d'acceptation** : Given un nom et une direction choisis par écrit par le fondateur, When la première version du thème est publiée, Then aucun nom ni couleur n'apparaît en dur dans le code (contrôle CI). Given une couleur primaire modifiée dans une version publiée, When une page est rechargée, Then toutes les pages l'affichent sans déploiement. Given une version au contraste insuffisant, When elle est soumise à publication, Then `BRAND_CONTRAST_INSUFFICIENT`. Given Android Chrome et iOS Safari, When l'audit PWA est exécuté, Then l'application est installable et les parcours E2E guest et comptoir passent sur un viewport mobile. Given une story visible sans rapport de revue design approuvé, When sa fusion est demandée, Then la porte CI la bloque.
- **Source** : DEC-FONDATEUR-06 et DEC-FONDATEUR-07 (23_RESEARCH_LOG, 2026-10-30) ; 17 ADR-036, ADR-039, ADR-040 ; écrans 10b : S01, S02, S03, S05, S06 (rendu thémé ; écrans clés soumis au fondateur).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : OUI (DSN-001, DSN-006, DSN-007) ; SIMPLIFIÉ (DSN-002 : un thème clair, tokens de couleur, typographie et logo ; DSN-005 : composants des écrans de la Bêta seulement).
- **Complexité** : faible / moyenne / moyenne / moyenne / faible ; ops faible ; risque moyen (DSN-001, antériorité de marque) / faible.
- **Améliorations possibles** : mode sombre et variantes par pays ; applications natives (phase ultérieure, DEC-FONDATEUR-06).

#### Fiche DSN-003 / DSN-004 — Back-office « Apparence / Marque » et blocs de contenu éditables
- **FEATURE ID** : DSN-003, DSN-004
- **Nom** : Back-office « Apparence / Marque » (DSN-003) ; blocs de contenu éditables es / en (DSN-004)
- **Module** : Design, marque & contenus (DSN — Back-office, Contenus)
- **Persona** : fondateur (PER-07, rôle `ADMIN`)
- **Objectif** : le fondateur change l'apparence et les textes non juridiques quand il veut, sans développeur ni déploiement, avec retour arrière sûr (DEC-FONDATEUR-07).
- **Description** : DSN-003 : écran réservé au rôle `ADMIN` avec la permission `brand.publish` : nom de la marque, logo, palette, polices, images et textes d'accueil, gabarits email et WhatsApp ; prévisualisation en direct des écrans clés en mobile et desktop ; brouillon puis publication ; historique des versions (auteur, date, différences) ; retour arrière en un clic, qui crée une nouvelle version identique à la version choisie (jamais d'écrasement) ; chaque publication est journalisée (ADM-001). DSN-004 : textes marketing et d'aide non juridiques (accueil, bandeaux, FAQ courte, « comment ça marche ») en blocs `content_block` par clé et par langue (es, en), avec brouillon, publication, versions et retour arrière ; un bloc absent dans une langue affiche la version es et est signalé. Les textes juridiques (CGU, contrat, politiques, LEG) et les montants ne sont **jamais** modifiables ici.
- **Déclencheur** : action du fondateur dans le back-office.
- **Prérequis** : DSN-002, DSN-005, ADM-001, NTF-001 (DSN-003) ; DSN-002, ADM-001, I18N-003 (DSN-004).
- **Parcours principal** : ouvrir Apparence / Marque → modifier en brouillon → prévisualiser → publier → la version publiée est lue au rendu suivant.
- **Parcours alternatifs** : contraste insuffisant ou bloc obligatoire vide → publication refusée ; erreur constatée après publication → retour à la version N−1 ; deux brouillons concurrents → le second éditeur voit le conflit de version et recharge.
- **Règles métier** : aucune BR de 08 ; textes juridiques hors périmètre (LEG-001, LEG-011).
- **États** : `brand_version` et `content_block` : `DRAFT` → `PUBLISHED` → `ARCHIVED` ; une seule version publiée par clé et par langue.
- **Erreurs** : `BRAND_CONTRAST_INSUFFICIENT`, `CONTENT_BLOCK_REQUIRED_MISSING`, `VERSION_CONFLICT`, `FORBIDDEN`.
- **Données** : brand_version ; brand_asset ; content_block(key, locale, version, status, body, published_at, published_by) (17 ADR-036) ; audit_log.
- **Notifications** : —
- **Permissions** : `ADMIN` + `brand.publish` (publier, revenir en arrière) ; `ADMIN` (brouillon) ; aucun autre rôle.
- **Dépendances** : DSN-003 → DSN-002, DSN-005, ADM-001, NTF-001 ; DSN-004 → DSN-002, ADM-001, I18N-003.
- **Critères d'acceptation** : Given une version brouillon, When un visiteur ouvre le site, Then il voit la version publiée et seule la prévisualisation montre le brouillon. Given une version N publiée, When le fondateur revient à N−1, Then l'apparence N−1 est rétablie en moins d'une minute sans déploiement et une version N+1 identique à N−1 est journalisée. Given un bloc es modifié et publié, When la page est rechargée, Then le nouveau texte s'affiche et la version précédente reste restaurable. Given un utilisateur sans `brand.publish`, When il tente de publier, Then `FORBIDDEN`.
- **Source** : DEC-FONDATEUR-07 (23_RESEARCH_LOG, 2026-10-30) ; 17 ADR-036 ; écrans 10b : aucun (écran Apparence / Marque du back-office à ajouter à 10b ; prévisualisation des écrans S01, S02, S03).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ (les deux) — DSN-003 : logo, nom, palette, polices, image et texte d'accueil, prévisualisation, publication et retour arrière, gabarits email et WhatsApp au P0-A complet ; DSN-004 : blocs de l'accueil et de la FAQ courte, sans planification de publication.
- **Complexité** : élevée / moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : publication planifiée ; tests A/B de contenus (P2).

## E17 — Transmissibilité, qualité et gouvernance multi-agents (P0-A, 5 lignes, transverse ; DEC-FONDATEUR-05, 08, 09 et 10)

> Ajouté par la passe VERIF_18. Le build est fait par une équipe d'agents Claude Code ; le fondateur est le seul humain (DEC-FONDATEUR-05). Ces lignes sont transverses : elles s'appliquent à chaque story, et « documentation à jour » et « portes CI vertes » font partie de la Definition of Done.

#### Fiche PLT-001 / PLT-002 / PLT-003 — Transmissibilité : IaC, portabilité, comptes au nom du fondateur, documentation et passation
- **FEATURE ID** : PLT-001, PLT-002, PLT-003
- **Nom** : Infrastructure as Code, conteneurs et portabilité cloud (PLT-001) ; comptes, secrets et services au nom du fondateur (PLT-002) ; documentation de transmissibilité et checklist de passation (PLT-003)
- **Module** : Plateforme, qualité & transmissibilité (PLT — Portabilité, Comptes et secrets, Documentation)
- **Persona** : fondateur (PER-07) ; repreneur éventuel (développeur humain, autre IA, équipe sur son propre cloud)
- **Objectif** : pouvoir passer la main à tout moment sans perte (DEC-FONDATEUR-08).
- **Description** : PLT-001 : environnements (ADM-034) décrits en Infrastructure as Code et recréables depuis le dépôt ; services en conteneurs ; dépendances à un fournisseur cloud derrière un port (stockage objet, file, courriel, secrets) avec au moins un adaptateur de remplacement documenté ; export complet chiffré (base, objets, journaux d'audit) et restauration testée sur un autre compte (17 ADR-037). PLT-002 : chaque compte externe (cloud, domaine, dépôt, PSP, KYC, e-facture, WhatsApp Business, courriel, monitoring) est ouvert au nom de l'entité du fondateur, propriétaire, les agents en accès délégué révocable ; registre versionné des comptes, variables et secrets (emplacement, propriétaire, rotation, jamais la valeur). PLT-003 : README, guide d'installation, conventions, ADR, contrat OpenAPI, schéma de base généré, inventaire PLT-002, runbooks (incident PSP, restauration, rotation de secrets, retour arrière), stratégie de tests, procédure d'export et checklist de passation, tenus à jour par chaque story (17 §13).
- **Déclencheur** : lot 0 ; puis chaque story (Definition of Done) ; exercice de passation avant l'ouverture.
- **Prérequis** : ADM-034 (PLT-001) ; PLT-002 (PLT-003).
- **Parcours principal** : dépôt → commande unique d'IaC → environnement complet → documentation générée et relue → exercice de passation sur une copie.
- **Parcours alternatifs** : service sans port de remplacement → ADR exigé avant adoption ; variable lue mais absente du registre → CI en échec ; secret détecté dans le dépôt → CI en échec et rotation immédiate.
- **Règles métier** : aucune BR de 08 (DEC-FONDATEUR-08).
- **États** : —
- **Erreurs** : `CONFIG_VARIABLE_UNREGISTERED` (CI), `SECRET_IN_REPOSITORY` (CI).
- **Données** : fichiers IaC et conteneurs du dépôt ; registre des comptes et variables (sans valeurs) ; documentation versionnée ; artefact d'export chiffré.
- **Notifications** : alerte de rotation de secret échue (ops).
- **Permissions** : fondateur propriétaire de tous les comptes ; agents en accès délégué révocable ; aucun agent ne lit un secret en clair hors exécution.
- **Dépendances** : PLT-001 → ADM-034 ; PLT-002 → aucune ; PLT-003 → PLT-002.
- **Critères d'acceptation** : Given le dépôt seul et un compte cloud vide, When la commande documentée est lancée, Then un environnement de préproduction complet est recréé. Given le registre des variables, When la CI compare les variables lues par l'application, Then la couverture est de 100 %. Given une équipe tierce et une copie du dépôt, When elle suit la checklist de passation, Then elle redéploie et restaure les données sans aide.
- **Source** : DEC-FONDATEUR-08 (23_RESEARCH_LOG, 2026-10-30) ; 17 ADR-037, §13 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ (PLT-001 : IaC et conteneurs pour préproduction et production ; restauration sur un autre compte au P0-A complet) ; OUI (PLT-002, PLT-003).
- **Complexité** : moyenne / faible / moyenne ; ops faible ; risque moyen / élevé / faible.
- **Améliorations possibles** : exercice de passation annuel ; second fournisseur cloud actif.

#### Fiche PLT-004 / PLT-005 — Qualité et gouvernance multi-agents : stratégie de tests, portes CI, artefacts et revues
- **FEATURE ID** : PLT-004, PLT-005
- **Nom** : Stratégie de tests exhaustive et portes CI bloquantes (PLT-004) ; gouvernance multi-agents par artefacts versionnés (PLT-005)
- **Module** : Plateforme, qualité & transmissibilité (PLT — Qualité, Gouvernance)
- **Persona** : fondateur (PER-07) ; agents (orchestrateur, implémentation, vérificateurs, QA, DESIGN, red-team)
- **Objectif** : qualité « mission critique » sans développeur humain et avec une charge minimale pour le fondateur (DEC-FONDATEUR-05, DEC-FONDATEUR-09, DEC-FONDATEUR-10).
- **Description** : PLT-004 (17 §12, ADR-038) : unitaires ; intégration sur PostgreSQL réel ; contrats d'API ; E2E Playwright mobile et PWA ; parcours complets Panama / USD et Paraguay / PYG ; property-based et fuzz avec oracles monétaires (scripts de 08 : T01–T68, TA01–TA11) ; concurrence C1–C20 et L0-01 à L0-10 ; RLS-1 à RLS-20 sous les rôles de production ; sécurité ; accessibilité ; régression visuelle ; charge ; résilience contre des adaptateurs `FAKE` hostiles ; gabarits de notification ; migrations ; export et effacement ; portes CI bloquantes ; régression complète nocturne ; un agent QA indépendant de l'agent qui code écrit ou relit les tests d'acceptation ; chaque critère d'acceptation des fiches est tracé par identifiant de test. Les tests réduisent le risque sans prouver l'absence de bug : monitoring et triage après lancement (ADM-032). PLT-005 (17 §13, ADR-040) : orchestrateur, agents d'implémentation et vérificateurs indépendants (revue de code, QA, sécurité, logique monétaire sur un autre modèle, conformité d'architecture, design) communiquent par artefacts versionnés du dépôt (tableau des tâches, notes de passation, rapports de revue, registre des risques, registre des décisions avec valeur par défaut et date de décision) ; double revue pour l'argent, la sécurité et la réservation ; pré-mortem par lot ; red-team à chaque lot ; post-mortem par incident ; rapport de santé par session ; un point fondateur hebdomadaire regroupé (démo et 5 décisions au plus).
- **Déclencheur** : chaque fusion (portes CI) ; chaque nuit (régression) ; chaque lot (pré-mortem, red-team) ; chaque semaine (point fondateur).
- **Prérequis** : ADM-034 (PLT-004).
- **Parcours principal** : story → implémentation → tests → revue indépendante → portes CI vertes → fusion → rapport de santé ; décisions ouvertes regroupées au point hebdomadaire.
- **Parcours alternatifs** : porte rouge → fusion refusée ; décision non prise au point prévu → valeur par défaut de 22 appliquée et consignée ; désaccord entre agents → escalade à l'orchestrateur, puis au fondateur seulement pour une décision produit.
- **Règles métier** : toutes les BR testées par leurs vecteurs (08 T01–T68) ; aucune BR propre.
- **États** : revue `REQUESTED` → `APPROVED` / `CHANGES_REQUESTED` ; décision `OPEN` → `DEFAULT_APPLIED` / `DECIDED` (artefacts).
- **Erreurs** : —
- **Données** : suites de tests ; rapports CI ; tableau des tâches ; registres des risques et des décisions ; rapports de revue, de red-team, de pré-mortem et de post-mortem.
- **Notifications** : rapport hebdomadaire au fondateur ; alerte de régression nocturne (orchestrateur).
- **Permissions** : seul l'orchestrateur fusionne après revue indépendante ; le fondateur accepte la recette.
- **Dépendances** : PLT-004 → ADM-034 ; PLT-005 → aucune.
- **Critères d'acceptation** : Given une porte CI rouge, When la fusion est demandée, Then elle est refusée. Given une fusion touchant l'argent, la sécurité ou la réservation, When elle est proposée, Then deux revues indépendantes approuvées sont exigées. Given chaque décision ouverte de 22, When le registre des décisions est lu, Then elle a une valeur par défaut et une date de décision. Given un critère d'acceptation d'une fiche P0, When la matrice de traçabilité des tests est générée, Then il est relié à au moins un identifiant de test.
- **Source** : DEC-FONDATEUR-05, DEC-FONDATEUR-09, DEC-FONDATEUR-10 (23_RESEARCH_LOG, 2026-10-30) ; 17 §11, §12, §13, ADR-038, ADR-040 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ (PLT-004 : unitaires, intégration, E2E des parcours de la Bêta, C1–C20, RLS, oracles monétaires ; charge, résilience et régression visuelle complètes au P0-A complet) ; OUI (PLT-005).
- **Complexité** : élevée / faible ; ops faible / moyen ; risque moyen.
- **Améliorations possibles** : tests de mutation ; chaos testing en préproduction.

## E18 — Connecteurs réels : lot C, après le choix du pays de lancement (P0-A, 4 lignes ; DEC-FONDATEUR-03, VERIF_18-F01)

> Ajouté par la passe VERIF_18. Chaque intégration externe se livre en deux temps : **port + adaptateur `FAKE`** dans le lot de sa ligne (lots 0 à 4, sans attendre aucune porte) ; **connecteur réel** au lot C, après le choix du pays de lancement et avant toute mise en service avec de vrais clients. Aucune ligne des lots 0 à 4 ne dépend d'une ligne du lot C (contrôle `tools/check_inventory.py`).

#### Fiche PAY-041 — Porte de validation du PSP du pays de lancement et PSP de secours
- **FEATURE ID** : PAY-041
- **Nom** : Porte de validation du PSP du pays de lancement et PSP de secours
- **Module** : Paiements (PAY — PSP)
- **Persona** : PER-07 ; fondateur ; PER-03
- **Objectif** : ne pas dépendre d'un PSP unique non validé, au Panama comme au Paraguay.
- **Description** : porte de mise en service du connecteur PSP réel (lot C : après le choix du pays de lancement, avant toute ouverture à de vrais clients ; DEC-FONDATEUR-02, DEC-FONDATEUR-03, DEC-FONDATEUR-04). Panama : Tilopay, PSP basé au Costa Rica, dont l'entité et la licence au Panama, les tarifs, l'ordre sur le compte de l'agence et le remboursement Yappy ne sont pas validés (OQ-PAY-03, OQ-PAY-22). Paraguay : Bancard vPOS (cartes et caution) et upay (QR) non validés (OQ-PAY-08, OQ-PAY-10, OQ-PAY-12). Porte : réponse écrite du PSP retenu et compte de test ouvert pour une agence pilote, avant le développement du connecteur réel (PAY-042). À défaut à la date fixée : (1) mode (b) sur le PSP actuel de chaque agence ; (2) évaluation d'un second PSP API du pays (Panama : PagueloFacil, BAC Credomatic ; dLocal non validé pour le Panama) via PAY-001. Les lots 0 à 4 se construisent contre l'adaptateur `FAKE` et n'attendent pas cette porte.
- **Déclencheur** : choix du pays de lancement par le fondateur.
- **Prérequis** : PAY-001.
- **Parcours principal** : collecte des réponses → décision (PSP validé / mode b / second PSP) → enregistrée → développement du connecteur réel.
- **Parcours alternatifs** : réponse partielle (ex. Yappy non remboursable) → mode a pour les cartes, remboursement Yappy par l'agence ; aucune réponse à la date fixée → mode b par défaut.
- **Règles métier** : aucune BR (proposé, VERIF_10 V10-05).
- **États** : décision de porte (ADR-004 ; pas d'entité dédiée dans 17) `OPEN` → `DECIDED_PSP` / `DECIDED_MODE_B` / `DECIDED_SECOND_PSP`, consignée en paramètre versionné et au journal d'audit ; capacités validées dans `psp_capability` (fail-closed).
- **Erreurs** : `PSP_GATE_NOT_DECIDED` (le connecteur réel du mode a ne peut pas être activé).
- **Données** : decision_log(gate, country, decision, evidence_refs, decided_by, at).
- **Notifications** : —
- **Permissions** : `ADMIN`.
- **Dépendances** : PAY-001.
- **Critères d'acceptation** : Given la porte non décidée, When un admin active le mode a pour une agence, Then `PSP_GATE_NOT_DECIDED`. Given une agence pilote, When elle est activée, Then un moyen d'encaissement confirmé est enregistré. Given l'image de production, When un adaptateur `FAKE` y est déclaré, Then le service refuse de démarrer (test C19).
- **Source** : VERIF_10 V10-05 ; VERIF_18-F01 ; 09b §2.4, §5.2 ; écrans 10b : A07.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot C)
- **Bêta pilote** : MANUEL — validation écrite du PSP de chaque agence pilote obtenue par le fondateur ; mode (b) par défaut ; build contre l'adaptateur `FAKE` ; la porte est un critère de **mise en service** (17 C19).
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : —

#### Fiche PAY-042 / FIN-020 / VER-029 — Connecteurs réels du pays de lancement (PSP, facture électronique, KYC)
- **FEATURE ID** : PAY-042, FIN-020, VER-029
- **Nom** : Connecteur PSP réel du pays de lancement (PAY-042) ; connecteur réel de facture électronique du pays de lancement (FIN-020) ; connecteur réel du fournisseur KYC (VER-029)
- **Module** : Paiements (PAY — PSP) ; Finance & facturation (FIN — Fiscalité) ; Vérification (VER — Fournisseur)
- **Persona** : PER-07 ; PER-06 ; PER-03
- **Objectif** : remplacer les adaptateurs `FAKE` par les services réels du pays retenu sans modifier le code métier.
- **Description** : PAY-042 : adaptateur réel du port `PaymentProvider` pour le PSP retenu par la porte PAY-041 (Panama : Tilopay cartes + Yappy, Clave si confirmée ; Paraguay : Bancard vPOS, upay), déclaré dans `psp_capability`, sur les comptes des agences sous mandat LEG-027. FIN-020 : adaptateur réel du port fiscal (Panama : PAC agréé DGI ; Paraguay : SIFEN de la DNIT) derrière FIN-002 ou FIN-003, certificats au nom de l'entité du fondateur. VER-029 : adaptateur réel du port `IdentityProvider` (pièces du Panama et du Paraguay, permis étrangers), sans copie biométrique conservée hors du fournisseur. Chaque connecteur passe la même suite de contrats que son `FAKE`, en sandbox puis en recette.
- **Déclencheur** : décision de la porte PAY-041 et choix du pays de lancement.
- **Prérequis** : PAY-001, PAY-019, PAY-034, PAY-041 (PAY-042) ; FIN-002, FIN-003 (FIN-020) ; VER-001 (VER-029).
- **Parcours principal** : sandbox du fournisseur → suite de contrats du port → recette avec une agence pilote → activation par pays.
- **Parcours alternatifs** : capacité absente (ex. capture partielle) → déclarée `false` dans `psp_capability`, repli défini par l'appelant ; rejet de l'autorité fiscale → facture `DRAFT` avec motif ; fournisseur KYC indisponible → revue humaine dans la file KYC.
- **Règles métier** : BR-PAY-01 (PAY-042) ; BR-PRICE-12 (FIN-020) ; BR-VERIF-01 (VER-029).
- **États** : mêmes états que les ports (payment_operation, fiscal_document, identity_verification).
- **Erreurs** : `PSP_UNAVAILABLE`, `PSP_CAPABILITY_MISSING`, `PAC_REJECTED`, `PAC_UNAVAILABLE`, `KYC_PROVIDER_UNAVAILABLE`.
- **Données** : psp_account, psp_capability ; fiscal_document ; identity_verification (17).
- **Notifications** : `EVT_PSP_FAILURE` (ops).
- **Permissions** : `SYSTEM` ; `ADMIN` (activation par pays).
- **Dépendances** : PAY-042 → PAY-001, PAY-019, PAY-034, PAY-041 ; FIN-020 → FIN-002, FIN-003 ; VER-029 → VER-001.
- **Critères d'acceptation** : Given la suite de contrats d'un port, When elle est exécutée sur l'adaptateur `FAKE` puis sur le connecteur réel en sandbox, Then les résultats sont identiques. Given un webhook PSP à signature invalide, When il est reçu, Then il est rejeté et journalisé. Given une facture de commission de test, When elle est envoyée à l'environnement de test de l'autorité fiscale du pays retenu, Then elle est acceptée. Given une vérification KYC réelle, When elle se termine, Then aucune image biométrique n'est stockée hors du fournisseur.
- **Source** : DEC-FONDATEUR-03 ; VERIF_18-F01 ; 09b §5.2 ; 13 (SIFEN) ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot C)
- **Bêta pilote** : SIMPLIFIÉ (PAY-042 : un seul PSP du pays de lancement, lien de paiement + webhook) ; MANUEL (FIN-020 : facture émise par le comptable sur le portail du PAC ou de la DNIT ; VER-029 : revue humaine des pièces dans la file KYC).
- **Complexité** : élevée ; ops moyen ; risque élevé.
- **Améliorations possibles** : second PSP actif par pays (PAY-020, P2).

---

# PARTIE C — Lignes P1, P2 et P3 (tableau compact)

Généré depuis `04_FEATURE_INVENTORY.csv` (révision 3). Les epics E1–E15 ne couvrent que le P0 : pour P1–P3, la colonne « Epic » donne le **module** de 04 (le regroupement en epics sera fait dans `19_DEVELOPMENT_BACKLOG`). Description = début de `description_courte` (tronquée à ~150 caractères, « … »). Aucune fiche complète pour ces lignes ; elles seront spécifiées avant leur phase.


## C.1 — Phase P1 (342 lignes)

| feature_id | Nom | Epic (module) | Phase | Description (une ligne) | Dépendances clés |
|---|---|---|---|---|---|
| ACC-002 | Connexion / inscription Google (SSO) | ACC | P1 | Bouton « Continue with Google » à l'inscription et à la connexion. | ACC-001 |
| ACC-003 | Connexion / inscription Apple (SSO) | ACC | P1 | Bouton « Continue with Apple ». | ACC-001 |
| ACC-004 | Connexion par code à usage unique (SMS / WhatsApp) | ACC | P1 | Login sans mot de passe par code envoyé par SMS ou WhatsApp (repli SMS). | NTF-002 |
| ACC-005 | Authentification à deux facteurs (2FA) | ACC | P1 | Second facteur de connexion mentionné par la documentation. | ACC-004 |
| ACC-007 | Prénom d'usage (preferred first name) | ACC | P1 | Nom affiché choisi par l'utilisateur (surnom, identité de genre). | ACC-006 |
| ACC-009 | Correction du nom légal / date de naissance | ACC | P1 | Demande par formulaire, réponse sous 2–3 jours ouvrés. | ADM-005 |
| ACC-010 | Réservation sans compte préalable (checkout invité) | ACC | P1 | Le premier checkout collecte identité, contact, âge et paiement ; compte créé implicitement. | BKG-001 ; VER-013 |
| ACC-011 | Présélection de l'indicatif téléphonique par géo-IP | ACC | P1 | Indicatif et format de numéro pré-remplis selon le pays détecté (+507 observé). | — |
| ACC-013 | Mise à jour email, téléphone, mot de passe | ACC | P1 | Modification des coordonnées avec badges Verified. | VER-013 |
| ACC-015 | Graphe de comptes liés et refus définitif | ACC | P1 | Lien avec un compte banni = refus définitif ; graphe consulté à chaque réservation. | ACC-014 |
| ACC-017 | Profil public | ACC | P1 | Prénom d'usage, photo, date d'inscription, infos vérifiées, avis reçus. | — |
| ACC-018 | Édition du profil | ACC | P1 | Bouton Edit profile (photo et autres champs). | ACC-017 |
| ACC-019 | Badges d'informations vérifiées | ACC | P1 | Badges email et téléphone vérifiés sur le profil (« Build trust… »). | VER-013 |
| ACC-020 | Déclaration d'aptitude à la boîte manuelle | ACC | P1 | Question Oui/Non « expert en boîte manuelle ? » dans Account. | BKG-029 |
| ACC-021 | Statut d'approbation conducteur visible | ACC | P1 | Section « Approval status » (« You are approved »). | VER-009 |
| ACC-022 | Fermeture de compte en libre-service | ACC | P1 | Bouton « Close my account » ; annule les trips à venir avec frais normaux. | BKG-028 |
| ACC-023 | Garde-fous de fermeture | ACC | P1 | Impossible si réclamation en cours, solde dû ou < 72 h après la fin d'un trip. | ACC-022 ; ACC-025 |
| ACC-025 | Restrictions de compte (impayé, chargeback, échéancier) | ACC | P1 | Blocage des réservations/extensions tant qu'une dette, un chargeback ou un échéancier existe. | — |
| ACC-026 | Blocage silencieux guest ↔ hôte après note ≤ 3★ | ACC | P1 | Le guest noté ≤ 3★ ne peut plus réserver chez cet hôte, sans notification. | REV-002 |
| ACC-027 | Menu utilisateur connecté | ACC | P1 | Favorites, Trips, Inbox, Profile, Account, Earn, Gift cards, Get help, Legal, Log out. | — |
| ACC-028 | Menu hôte conditionnel | ACC | P1 | Les menus hôte apparaissent une fois une annonce créée. | HDB-001 |
| ACC-032 | Deep-link de retour après inscription | ACC | P1 | Paramètre next= ramène l'utilisateur à son action (ex. list-your-car). | ACC-001 |
| ACC-033 | Déconnexion et gestion de session | ACC | P1 | Lien Log out ; session persistante. | — |
| VER-009 | Screening à chaque réservation et en continu | VER | P1 | Re-évaluation à la création, à chaque réservation, en continu ; approbation révocable. | ADM-011 |
| VER-010 | Délai de revue d'un compte en attente | VER | P1 | Revue des documents généralement 24–48 h ; statut visible. | ADM-002 |
| VER-011 | Checklist post-réservation avec échéance | VER | P1 | Confirmer téléphone, permis, choisir/refuser protection ; tout terminé à T−2 h. | — |
| VER-012 | Annulation automatique si checklist incomplète | VER | P1 | Trip annulé par la plateforme avec remboursement partiel à T−2 h. | VER-011 |
| VER-014 | Re-vérification d'identité au check-in | VER | P1 | Photo du permis (4 coins) + selfie à chaque trip ; photos réservées au check-in. | TRP-001 |
| VER-017 | Invitation et approbation de conducteurs additionnels | VER | P1 | Jusqu'à 8, par lien ; chacun crée un compte, vérifie téléphone et permis. | VER-001 |
| VER-018 | Statut d'approbation des additionnels visible au principal | VER | P1 | Approuvé / en attente / refusé, sans motif. | VER-017 |
| VER-019 | Exigences dynamiques selon le risque | VER | P1 | Caution, autorisation, 2e moyen de paiement, protection minimale, documents ajoutés. | ADM-011 ; PAY-011 |
| VER-020 | Documents supplémentaires (passeport, justificatif de domicile, relevé) | VER | P1 | Exigés pour classes chères, problème T&S ou comptes liés. | VER-019 |
| VER-022 | Interdiction pour l'hôte de collecter des documents | VER | P1 | L'hôte ne peut rien collecter au-delà du permis ; la plateforme porte le KYC. | — |
| VER-023 | Notification de sanction et appel | VER | P1 | Email citant la règle et la possibilité d'appel ; sans mention, décision définitive. | ADM-012 |
| VER-024 | Permis expirant pendant le trip | VER | P1 | Copie à jour exigée avant le début. | VER-001 |
| VER-025 | Âge minimum selon la classe du véhicule | VER | P1 | US 18/21/25/30 ans selon valeur et classe ; additionnels soumis aux mêmes seuils. | HST-021 |
| VER-026 | Expiration et révocation de l'approbation | VER | P1 | États EXPIRED (permis expiré) et REVOKED (T&S, fraude) avec réouverture. | VER-009 |
| SRC-003 | Sélecteur d'heure par pas de 30 min | SRC | P1 | Heures de Midnight à 11:30 PM par pas de 30 min. | SRC-001 |
| SRC-004 | Onglets de découverte (All / Airports / Monthly / Nearby / Delivered / Cities) | SRC | P1 | Modes de découverte sous la barre de recherche. | SRC-001 |
| SRC-005 | Mode de recherche mensuel | SRC | P1 | Prix /mois et dates mensuelles pré-calculées (searchDurationType, monthlyStartDate). | SRC-001 ; PAY-008 |
| SRC-006 | Recherche par aéroport (code IATA) | SRC | P1 | Recherche « à » et « près de » l'aéroport, filtre de retrait. | SRC-002 |
| SRC-009 | Recherche en déplaçant la carte | SRC | P1 | Paramètre isMapSearch : relance la recherche quand la carte bouge. | SRC-008 |
| SRC-010 | Compteur de résultats et état de fin de liste | SRC | P1 | « 200+ cars available » ; message « No more cars… changez vos filtres ». | SRC-008 |
| SRC-013 | Barre de filtres rapides (chips) | SRC | P1 | Price range, type, marque/modèle, années, sièges, consommation, carburant, livraison, self-driving, All filters. | SRC-008 |
| SRC-014 | Filtre de prix total hors taxes | SRC | P1 | Minimum / maximum sur le prix total du séjour (pas le prix/jour). | SRC-013 |
| SRC-015 | Filtre par type de véhicule (2 niveaux) | SRC | P1 | Catégorie → sous-type (berline, SUV compact, pick-up, fourgon…). | SRC-013 |
| SRC-016 | Filtres d'attributs véhicule | SRC | P1 | Marque/modèle, années, sièges, consommation, transmission, carburant. | SRC-013 |
| SRC-017 | Filtre d'équipements (21 options) | SRC | P1 | AWD, CarPlay, caméra, siège enfant, GPS, toll pass, pet friendly… | SRC-013 |
| SRC-018 | Filtre de kilométrage inclus | SRC | P1 | Curseur « 100 mi/jour et plus ». | SRC-013 |
| SRC-019 | Filtre « livré à mon adresse » | SRC | P1 | Toggle « Host brings the car to me » + champ adresse. | SRC-013 ; HST-034 |
| SRC-022 | Compteur live des résultats filtrés | SRC | P1 | Bouton « View 200+ results » mis à jour selon les filtres. | SRC-013 |
| SRC-024 | Filtre « kilométrage illimité » | SRC | P1 | Filtre absent chez Turo, demandé pour les road-trips. | SRC-013 |
| SRC-025 | Filtres spécifiques LATAM | SRC | P1 | 4x4/tracción, doble cabina, paiement Yappy, livraison PTY, sortie de territoire (phase 2). | SRC-013 |
| SRC-026 | Âge du conducteur dans la recherche | SRC | P1 | Paramètre age (défaut 30) qui conditionne prix et éligibilité. | VER-025 |
| SRC-027 | Recherches récentes sans connexion | SRC | P1 | « Continue searching for cars » (lieu + dates de la dernière recherche). | SRC-001 |
| SRC-030 | Classement « Relevance » | SRC | P1 | Paramètres, localisation, prix, livraison, notes, commitment rate, All-Star ; ML ; MAJ ~5 min. | REV-010 |
| SRC-031 | Pas d'annonces sponsorisées | SRC | P1 | Aucun classement payant (règle publiée). | SRC-030 |
| SRC-032 | Masquage des véhicules non réservables pour l'utilisateur | SRC | P1 | Véhicules incompatibles (âge, restriction, hôte bloquant) masqués ou marqués indisponibles. | BKG-017 |
| SRC-033 | Pages SEO de catalogue | SRC | P1 | Catégorie × pays/ville, marque, modèle, aéroport, état ; index /makes /airports. | — |
| SRC-034 | URL de recherche normalisée et partageable | SRC | P1 | Tous les paramètres de recherche dans l'URL. | SRC-001 |
| SRC-035 | Page d'accueil avec carrousels thématiques | SRC | P1 | Carrousels aéroport, mensuel, luxe, marque, ville avec prix moyen/jour et total. | SRC-011 |
| SRC-040 | Attribution recherche → réservation (searchId) | SRC | P1 | searchId et searchRegion propagés de la recherche à la fiche. | SRC-008 |
| SRC-041 | Prix « all-in » incluant la livraison aéroport | SRC | P1 | En recherche aéroport, le prix affiché inclut la livraison. | PRC-017 |
| LST-001 | URL SEO de fiche véhicule et titre | LST | P1 | /{pays}/{lang}/{catégorie}/{lieu}/{marque}/{modèle}/{id} ; title marque-modèle-ville-hôte. | — |
| LST-004 | Chips de caractéristiques | LST | P1 | Sièges, carburant, consommation, boîte. | — |
| LST-009 | Trip Savings (remise de durée affichée) | LST | P1 | Remise « 3 jours ou plus » visible avant le checkout. | PRC-008 |
| LST-014 | Signaler une annonce (Report listing) | LST | P1 | Lien de signalement présent sur chaque fiche. | — |
| LST-015 | Équipements groupés par catégorie | LST | P1 | Sécurité, connectivité, commodité, autres ; « See all N features ». | HST-011 |
| LST-016 | Bloc « Included with your trip » | LST | P1 | Sans comptoir, conducteurs ajoutables, fenêtre 2 h, pas de lavage, assistance 24/7. | — |
| LST-017 | Fenêtre de retrait de 2 heures | LST | P1 | Pas besoin de modifier le trip sauf retard > 2 h. | TRP-014 |
| LST-018 | Liste des Extras sur la fiche | LST | P1 | Nom, description, prix par trip, quantité disponible. | HST-031 |
| LST-019 | Avis sur la fiche | LST | P1 | Note, nombre de notes, extraits, réponse publique de l'hôte, « See more ». | REV-001 |
| LST-021 | Règles de conduite (Rules of the road) | LST | P1 | Non-fumeur 150 $, propreté 150 $, carburant, pas de tout-terrain. | — |
| LST-022 | Mention de télématique / collecte de données | LST | P1 | Le véhicule peut collecter conduite et localisation partagées avec des tiers. | LEG-017 |
| LST-023 | Barre sticky prix + CTA | LST | P1 | Barre fixe en bas d'écran mobile : total TTC du devis courant (PRC-025), prix barré si remise, bouton « Continuar ». Composant partagé avec le … | BKG-001 |
| LST-024 | Véhicules similaires pour vos dates | LST | P1 | Carrousel du même modèle ou similaires avec total du séjour. | SRC-030 |
| LST-026 | Zones de circulation exclues affichées | LST | P1 | Zones interdites (Darién, routes non revêtues) visibles avant réservation. | TRP-043 |
| LST-027 | Interdiction de sortie du territoire affichée | LST | P1 | Mention claire (Paso Canoas / Costa Rica) sur la fiche et au checkout. | BKG-023 |
| LST-028 | Frais de parking au retrait affichés | LST | P1 | Champ structuré sur le lieu, visible avant réservation. | HST-034 |
| LST-029 | Vitrine du loueur professionnel | LST | P1 | Page agence (logo, nom commercial, flotte, notes, conditions). | ACC-008 ; ACC-029 |
| BKG-003 | Choix du plan de protection au checkout | BKG | P1 | Plans affichés après saisie de l'âge ; refus possible. | PRT-001 |
| BKG-004 | Sélection des Extras (stepper borné par stock) | BKG | P1 | Panneau par catégorie, quantité − 0 +, option « I don't want any extras ». | HST-031 |
| BKG-005 | Choix tarif remboursable / non remboursable | BKG | P1 | Deux tarifs avec politiques d'annulation différentes. | — |
| BKG-007 | Saisie d'un code promo | BKG | P1 | Lien « Ajouter un code promo » dans le résumé. | MKT-004 |
| BKG-009 | Bandeau de vérification post-réservation | BKG | P1 | Avertit qu'il faudra fournir des informations sous peine d'annulation et de frais. | VER-011 |
| BKG-010 | Book Instantly universel | BKG | P1 | Acceptation automatique de toute réservation compatible avec les réglages. | CAL-001 |
| BKG-013 | Pas de chevauchement de trips pour un guest | BKG | P1 | Un guest, un véhicule à la fois ; pas de réservation pour autrui. | BKG-012 |
| BKG-015 | Remboursement automatique si la réservation échoue | BKG | P1 | Paiement libéré/remboursé automatiquement sous 20 min. | BKG-014 |
| BKG-017 | Pas de one-way à la réservation | BKG | P1 | Lieu de retour différent seulement après réservation, dans les options de l'hôte. | TRP-026 |
| BKG-020 | Trips > 30 jours en segments de 30 jours | BKG | P1 | Renouvellement automatique de segments avec contrat propre. | — |
| BKG-021 | Calcul des jours facturables | BKG | P1 | Tranche de 24 h entamée = 1 jour ; [NOUS] tolérance 59 min. | PRC-025 |
| BKG-024 | Numéro de vol au checkout et suivi | BKG | P1 | Partage des infos de vol avec l'hôte ; [NOUS] suivi automatique par API. | TRP-012 |
| BKG-026 | Liste des trips à venir et historique | BKG | P1 | Page Trips (/trips, /trips/history) avec état vide et CTA. | — |
| BKG-029 | Affichage de l'heure exacte de fin de gratuité | BKG | P1 | Date/heure de fin d'annulation gratuite sur le reçu et l'écran d'annulation. | BKG-028 |
| BKG-030 | Grâce de 24 h sur tarif non remboursable | BKG | P1 | Remboursement intégral 24 h après réservation, puis rien (caution libérée). | BKG-005 |
| BKG-031 | Annulation « mon hôte ne répond pas » | BKG | P1 | Motif dédié ; un agent recontacte sous 48 h. | SUP-004 |
| BKG-033 | Revue automatique « uncomfortable with this trip » | BKG | P1 | Annulation hôte pour sécurité/harcèlement envoyée en revue automatique au support. | ADM-008 |
| BKG-034 | Annulation d'un commun accord | BKG | P1 | Remboursement intégral si accord prouvé ; l'hôte ne touche rien. | MSG-001 |
| BKG-036 | Rebooking assisté « Book another car » | BKG | P1 | Lien vers véhicules similaires ; fonds disponibles 24 h comme crédit de rebooking. | LST-024 |
| BKG-038 | Exceptions pour circonstances exceptionnelles | BKG | P1 | Décès, maladie, obligation légale, catastrophe ; sur demande au support avec justificatif. | ADM-008 |
| BKG-039 | Retard ou annulation de vol / train | BKG | P1 | Prévenir l'hôte, demander une modification, justificatif ≤ 24 h après le début. | TRP-020 |
| BKG-040 | Le guest doit refuser d'annuler à la place de l'hôte | BKG | P1 | Demande d'annulation par l'hôte traitée comme annulation hôte. | MSG-007 |
| PAY-005 | Carte « garantissable » obligatoire | PAY | P1 | Une carte reste exigée même si un crédit/carte cadeau/BNPL couvre 100 %. | PAY-002 |
| PAY-008 | Pay as you go (trips > 30 jours) | PAY | P1 | Versements égaux tous les 30 jours ; échec = trip raccourci. | BKG-020 ; PAY-015 |
| PAY-022 | Remboursement Yappy/QR par virement ou crédit | PAY | P1 | Le guest choisit d'avance crédit immédiat ou virement ACH vers un compte à son nom. | PAY-004 |
| PAY-023 | Remboursement converti en crédit voyage | PAY | P1 | Quand le moyen d'origine ne peut être remboursé. | MKT-002 |
| PAY-025 | Paiement des factures et soldes impayés in-app | PAY | P1 | Page de paiement d'une facture ou d'un solde ; blocage tant que non payé. | ACC-025 |
| PAY-026 | Échéancier de paiement (payment plan) pour dettes | PAY | P1 | Frais annexes et dommages en plusieurs échéances, sans intérêts ni frais ; confirmé par email. | PAY-025 |
| PAY-027 | Relances puis recouvrement | PAY | P1 | Plusieurs relances sur quelques semaines puis agence de recouvrement. | — |
| PAY-028 | Gestion des chargebacks | PAY | P1 | Restriction immédiate du compte ; dossier de contestation auto (contrat, photos, GPS, messages). | ACC-025 ; ADM-008 |
| PAY-029 | Reçu détaillé du trip | PAY | P1 | Reçu in-app mis à jour à chaque frais ou remboursement. | FIN-002 |
| PAY-031 | Échec d'un segment mensuel → raccourcissement | PAY | P1 | Trip raccourci à la fin du segment payé + procédure non-restitution si besoin. | PAY-008 ; TRP-038 |
| PRC-002 | Prix personnalisés par date, plage ou ensemble de dates | PRC | P1 | Prix spécifiques (week-end, saisons, fêtes) sur un ou plusieurs véhicules. | PRC-001 |
| PRC-008 | Remises de durée (3 j, 1, 2, 3 semaines, 1 mois) | PRC | P1 | Remises facultatives configurées par l'agence par palier (≥ 3 j, ≥ 7 j, ≥ 14 j, ≥ 30 j), en %, croissantes d'un palier au suivant, plafond 60 % ; … | PRC-001 |
| PRC-010 | Remise non remboursable 10 % (≥ 4 jours) | PRC | P1 | Remise fixe intégrée à la ligne de base (−10 % du net). | BKG-005 |
| PRC-011 | Règle de cumul des remises | PRC | P1 | Additive (10 % + 5 % = 15 %) vs séquentielle : deux versions chez Turo. | PRC-008 ; PRC-010 |
| PRC-013 | Trip fee nul pour trips ≥ 30 jours | PRC | P1 | Supprimé pour les longues durées depuis 03/2025 (hors LA/NY). | PRC-012 |
| PRC-014 | Frais jeune conducteur | PRC | P1 | 18–20 et 21–24 ans ; variables selon la durée ; non remboursables après trip. | VER-025 |
| PRC-015 | Frais de conducteur additionnel | PRC | P1 | 5 $/jour plafonné à 25 $ par trip, sur la durée totale. | VER-017 |
| PRC-016 | Frais de livraison par lieu et livraison gratuite conditionnelle | PRC | P1 | Gratuite ou payante jusqu'à un maximum par lieu ; gratuite au-delà d'une durée. | HST-034 |
| PRC-017 | Frais d'aéroport en pass-through | PRC | P1 | Frais fixés par l'aéroport reversés sans marge (permit fee, concession recovery…). | ADM-019 |
| PRC-018 | Prix des protections en % du prix journalier net | PRC | P1 | Premier 65 % / Standard 40 % / Minimum 25 % du prix journalier net. | PRT-001 |
| PRC-019 | Tarif du kilomètre supplémentaire calculé et figé | PRC | P1 | Prix journalier ÷ distance journalière incluse, figé dans la réservation. | HST-033 |
| PRC-022 | Frais administratifs sur frais annexes | PRC | P1 | 3 % ajoutés aux frais annexes traités par la plateforme. | CLM-019 |
| TRP-001 | Ouverture du check-in à T−24 h | TRP | P1 | Le check-in devient possible 24 h avant le début. | BKG-022 |
| TRP-003 | Photos du véhicule au départ par le guest | TRP | P1 | ≥ 15 extérieures et 8 intérieures + carburant + compteur, métadonnées, fenêtres 24 h. | TRP-002 |
| TRP-005 | Photos avant trip par l'hôte | TRP | P1 | Photos de l'hôte, condition de toute réclamation. | TRP-004 |
| TRP-006 | Checklist de conformité du véhicule | TRP | P1 | Immatriculation, assurance, carte d'incident à bord ; motifs de refus. | TRP-002 |
| TRP-008 | Modes de remise des clés | TRP | P1 | En personne, boîte à clés, déverrouillage via app constructeur (clé physique à bord). | TRP-011 |
| TRP-011 | Instructions de retrait et de retour | TRP | P1 | Envoyées par l'hôte après réservation (message programmé). | MSG-005 |
| TRP-012 | Emplacement exact aéroport et guidage | TRP | P1 | Parking + photo affichés 1 h avant ; guidage in-app du terminal à la voiture. | ADM-019 |
| TRP-014 | Fenêtre de grâce et no-show guest | TRP | P1 | No-show après 2 h (US) ; attente de 15 min après message de l'hôte. | TRP-015 |
| TRP-016 | Déclaration de no-show hôte par le guest | TRP | P1 | Hôte/véhicule absent 30 min → annulation hôte + pénalité ; bouton « Anfitrión no llegó ». | BKG-036 |
| TRP-017 | Bouton « je suis en retard » | TRP | P1 | Notifie l'hôte et étend la fenêtre de 30 min une fois. | TRP-014 |
| TRP-018 | Seul le conducteur principal retire et rend | TRP | P1 | Envoyer quelqu'un d'autre = no-show ; non-approuvé = protection annulée. | VER-014 |
| TRP-020 | Demande de modification « Change trip » | TRP | P1 | Dates, heures, lieu, durée ; accord hors app non valable. | BKG-027 |
| TRP-021 | Approbation automatique ou demande à l'hôte | TRP | P1 | Auto si compatible ; sinon hôte 8 h (lieu) / 12 h (extension) ; silence = refus. | TRP-020 |
| TRP-022 | Extension de trip | TRP | P1 | Avant, pendant, jusqu'à 24 h après la fin ; efface le retard ; prix et protection recalculés. | TRP-021 ; PRC-025 |
| TRP-023 | Extension en conflit : alternatives | TRP | P1 | Proposer l'extension maximale ou un autre véhicule pour les jours restants. | TRP-022 |
| TRP-024 | Fin anticipée et raccourcissement | TRP | P1 | ≤ 3 h : accord par message sans remboursement ; au-delà : demande système (12 h). | TRP-021 |
| TRP-025 | Recalcul et remboursement des différences | TRP | P1 | Baisse de prix sur trip remboursable remboursée automatiquement. | PRC-025 |
| TRP-026 | Changement de lieu | TRP | P1 | Réponse de l'hôte sous 8 h ; changement du seul retour = 50 % + 50 % des frais. | TRP-021 |
| TRP-027 | Échange de véhicule (swap) avant le trip | TRP | P1 | Une fois, classe égale ou inférieure, conditions inchangées ; refus = remboursement intégral. | BKG-027 |
| TRP-028 | Swap pendant le trip | TRP | P1 | Accord mutuel par message puis appel au support. | TRP-027 |
| TRP-029 | Changement de protection jusqu'au début | TRP | P1 | Ajout, changement ou retrait avant l'heure de début. | PRT-001 |
| TRP-030 | Ajout/retrait d'Extras jusqu'au début | TRP | P1 | Sans accord de l'hôte ; Extra non fourni remboursé. | BKG-004 |
| TRP-034 | Relevé carburant et compteur par OCR | TRP | P1 | Lecture automatique du compteur et de la jauge en huitièmes. | TRP-033 |
| TRP-036 | Signalement du retard par l'hôte | TRP | P1 | Après 30 min, sous 24 h ; revue support 48 h. | TRP-035 |
| TRP-037 | Alerte au guest suivant et swap prioritaire | TRP | P1 | À fin + 30 min sans check-out, alerte et proposition de swap. | TRP-027 |
| TRP-039 | Retour non conforme | TRP | P1 | Frais (50 $ + 3 %) si lieu, clé, lockbox ou réponse sous 2 h non respectés. | TRP-033 |
| TRP-040 | Zones de retour aéroport | TRP | P1 | Liste affichée 24 h après le début, rappel 24 h avant la fin. | TRP-012 |
| TRP-041 | Fin du trip par la plateforme et récupération | TRP | P1 | La plateforme peut mettre fin au trip et récupérer le véhicule. | ADM-006 |
| TRP-042 | Suivi GPS / télématique et règles des traqueurs | TRP | P1 | GPS autorisé, AirTags interdits, caméra/audio avec consentement écrit. | LEG-017 |
| TRP-043 | Géofencing frontières et zones exclues | TRP | P1 | Alertes près de Paso Canoas, Guabito, Río Sereno et zones exclues. | TRP-042 |
| TRP-046 | Fenêtres post-trip | TRP | P1 | Dommage 24 h, factures 72–120 h, dépôt 80 h (valeur Turo, non reprise : 72 h, PAY-012), avis 10 j avant clôture. | TRP-045 |
| TRP-047 | Carte d'information d'incident à bord | TRP | P1 | Carte Turo à bord (défaut = 100 $ de pénalité). | TRP-006 |
| TRP-048 | Suivi de livraison par l'hôte | TRP | P1 | Statut de livraison, partage de position 30 min avant, point de repli. | TRP-012 |
| TRP-050 | Signalement d'un problème de sécurité en cours de trip | TRP | P1 | Voyant ou problème : prévenir l'hôte puis le support si pas de réponse sous 30 min. | SUP-004 |
| TRP-051 | Panne : remboursement des jours non utilisés | TRP | P1 | Prorata automatique si panne non imputable au guest + swap/rebooking. | PRT-005 |
| MSG-002 | Inbox à deux onglets (Messages / Notifications) | MSG | P1 | /inbox/messages et /inbox/notifications (flux Activity). | MSG-001 ; NTF-005 |
| MSG-003 | Envoi de photos dans la messagerie | MSG | P1 | Photos depuis galerie, Trip photos ou appareil. | MSG-001 |
| MSG-004 | Masquage des coordonnées avant réservation | MSG | P1 | Noms, numéros et lieux exacts révélés seulement après réservation. | MSG-001 |
| MSG-005 | Messages programmés de l'hôte | MSG | P1 | Instructions, règles, parking envoyés automatiquement après réservation ou à T−x. | MSG-001 |
| MSG-010 | Interdiction des photos d'identité dans la messagerie | MSG | P1 | Les photos de permis/selfie restent réservées au check-in. | MSG-003 |
| MSG-011 | Conservation de l'historique comme preuve | MSG | P1 | Toute communication passe par la plateforme (trace pour les litiges). | MSG-001 |
| NTF-003 | Matrice de préférences catégorie × canal | NTF | P1 | Trip et compte (email requis), messages, recommandations, offres, actualités × email/SMS. | NTF-001 |
| NTF-004 | Langue du compte pour les notifications | NTF | P1 | 9 locales (dont es-US, pt-BR). | I18N-003 |
| NTF-005 | Flux d'activité (Notifications) | NTF | P1 | Liste horodatée des événements du compte. | NTF-001 |
| NTF-006 | Tests automatisés des gabarits avec toutes les variables | NTF | P1 | Évite les placeholders non résolus ({6} observé chez Turo). | NTF-001 |
| NTF-008 | Rappels de checklist avant échéance | NTF | P1 | Rappels jusqu'à T−2 h (NOTIF-03) ; [NOUS] T−24 h, T−6 h, T−3 h. | VER-011 |
| NTF-009 | Notification d'ajout de conducteur additionnel | NTF | P1 | « You're ready to drive… covered starting… primary must be present ». | VER-017 |
| NTF-010 | Notifications de paiement | NTF | P1 | Débit différé, rappel Pay as you go J−3, échec et raccourcissement. | PAY-006 |
| NTF-012 | Notifications de modification | NTF | P1 | Soumise, approuvée, refusée, expirée (8 h / 12 h) ; proposition de swap. | TRP-021 |
| NTF-013 | Notifications de factures annexes | NTF | P1 | Facture reçue, rappel avant 48 h, contestation, décision. | CLM-021 |
| NTF-014 | Invitation à noter et publication | NTF | P1 | Dès fin −3 h ; publication des deux avis. | REV-003 |
| NTF-015 | Notifications de sinistre | NTF | P1 | Déclaration, contact du chargé de dossier, décompte, lien de paiement, échéancier. | CLM-006 |
| NTF-016 | Notifications de violation, suspension et appel | NTF | P1 | Email + in-app lors d'une restriction ou suspension (ADM-005) : règle enfreinte, effet, durée, voie d'appel (une fois, sous 15 j). Événement du … | VER-023 |
| NTF-017 | Alerte de rappel de sécurité (email + SMS) | NTF | P1 | Rappel sur un véhicule avec restriction. | HST-023 |
| NTF-018 | Notifications de versement | NTF | P1 | Notification à l'agence d'un versement initié, payé ou échoué (P0-B uniquement ; en P0-A il n'y a pas de versement). Événement du catalogue NTF-001 … | PYO-004 |
| REV-002 | Avis de l'hôte sur le guest | REV | P1 | Note globale + texte obligatoire si 1–3★ ; non obligatoire. | REV-003 |
| REV-003 | Fenêtre de notation | REV | P1 | Fenêtre de notation du guest : du check-out à J+10, rappels à J+1 et J+7, formulaire fermé ensuite ; fenêtre hôte (P1) de même durée. Règle portée … | TRP-046 |
| REV-004 | Publication en double aveugle | REV | P1 | Publication quand les deux ont noté ou à J+10. | REV-003 |
| REV-005 | Texte obligatoire pour les notes basses | REV | P1 | Guest : ≥ 25 caractères de 1 à 4★ ; hôte : texte de 1 à 3★. | REV-001 |
| REV-006 | Réponse publique de l'hôte | REV | P1 | Réponse affichée sous l'avis. | LST-019 |
| REV-007 | Avis automatique d'annulation hôte | REV | P1 | Publié sur l'annonce avec le délai d'anticipation de l'annulation. | BKG-032 |
| REV-008 | Demande de retrait d'un avis | REV | P1 | Motifs limités, formulaire, examen unique, décision définitive. | ADM-017 |
| REV-012 | Avis reçus visibles sur le profil guest | REV | P1 | Section « Reviews from hosts » ou état vide. | ACC-017 |
| HST-001 | Landing d'acquisition hôte | HST | P1 | Promesse de revenus, preuves sociales, protections, conseils, FAQ. | — |
| HST-003 | Pré-étape de localisation du véhicule | HST | P1 | Adresse Google Places, saisie manuelle, épingle ajustable, confirmation. | SRC-002 |
| HST-004 | Blocage des pays/villes non ouverts | HST | P1 | Message « pas encore lancé dans votre pays » ; Next désactivé. | ADM-027 |
| HST-006 | Identification par VIN | HST | P1 | VIN 17 caractères, case « plus ancien que 1981 », aide « où le trouver ». | HST-005 |
| HST-007 | Décodage VIN et équipements par finition | HST | P1 | Marque/modèle/année déduits ; équipements ajoutés selon la finition, non supprimables. | HST-006 |
| HST-009 | Étape d'opt-in aux trips mensuels | HST | P1 | Activation des trips mensuels et de la remise associée. | HST-005 |
| HST-010 | Étape disponibilité du véhicule | HST | P1 | Contenu Turo non observé (BLOQUÉ). Chez nous, l'étape « disponibilité » de l'annonce reprend les réglages du lieu de l'agence : horaires de … | CAL-001 |
| HST-015 | Étape engagements sécurité et qualité | HST | P1 | Contenu Turo non observé (BLOQUÉ). Chez nous, les engagements du loueur (sécurité, entretien, documents à jour, non-discrimination, aucun paiement … | HST-005 |
| HST-017 | Webinaire d'orientation obligatoire | HST | P1 | Formation avant la première annonce. | HST-016 |
| HST-018 | Prérequis de l'hôte | HST | P1 | 21 ans, assurance nommant le véhicule, autorisation du propriétaire, véhicule financé autorisé. | VER-027 |
| HST-020 | Titres interdits et historique | HST | P1 | Salvage, rebuilt, inondation, compteur trafiqué interdits ; vérif gravámenes. | HST-019 |
| HST-021 | Classification de valeur du véhicule | HST | P1 | Standard / Deluxe / Super Deluxe / Classic / Specialty via valeur marchande. | HST-011 |
| HST-023 | Rappels de sécurité par VIN | HST | P1 | Annonce impossible si rappel ouvert ; retrait sous 72 h ; levée sur preuve. | HST-006 |
| HST-024 | Inspection annuelle de sécurité | HST | P1 | À soumettre sous 14 jours ; échéance 12/6 mois ; retrait si manquée. | ADM-020 |
| HST-025 | Standards d'entretien | HST | P1 | Batterie, plaquettes, pneus < 6 ans, voyants, impacts, clim. | HST-024 |
| HST-027 | Snooze avec remise en ligne automatique | HST | P1 | Mise en pause jusqu'à une date. | HST-026 |
| HST-028 | Retrait/suppression bloqués s'il existe des trips futurs | HST | P1 | Écran listant les trips : échanger ou annuler (avec pénalités). | HST-026 |
| HST-030 | Restriction automatique d'un véhicule endommagé | HST | P1 | Véhicule dangereux restreint jusqu'à preuve de réparation. | HST-026 |
| HST-031 | Gestion des Extras par l'hôte | HST | P1 | Catalogue fermé 50+ items, prix 0–999 $ par jour ou par trip, stock, prepaid refuel par défaut. | HST-005 |
| HST-032 | Extras locaux | HST | P1 | Panapass prépayé, siège enfant, glacière, kit 4x4. | HST-031 |
| HST-034 | Paramètres de livraison | HST | P1 | Jusqu'à 10 POI, rayon personnalisé, frais max par lieu, gratuité au-delà d'une durée. | HST-005 |
| HST-035 | Configuration de la livraison aéroport | HST | P1 | Activer l'aéroport, prix, emplacement exact (niveau, rangée, photo). | HST-034 ; ADM-019 |
| HST-040 | Acceptation de la politique de tracking | HST | P1 | Engagement sur les dispositifs de suivi avant mise en ligne. | HST-005 |
| HST-041 | Déclaration des dispositifs (GPS, caméra) | HST | P1 | Dispositifs déclarés dans l'annonce. | HST-040 |
| HST-042 | Interdits dans l'annonce | HST | P1 | Pas de téléphone, adresse, réseaux sociaux, frais ou cautions non prévus. | ADM-017 |
| HST-045 | FAQ véhicules financés / leasés | HST | P1 | Vérifier que le contrat autorise l'autopartage. | HST-018 |
| HST-046 | Description, règles et instructions du véhicule | HST | P1 | Texte libre et règles via messages programmés. | MSG-005 |
| HST-047 | OCR de la carte d'immatriculation | HST | P1 | Pré-remplissage plaque/VIN/propriétaire depuis le registro vehicular. | HST-006 |
| CAL-005 | Durées minimale et maximale | CAL | P1 | Durées min/max en jours ; pas de max imposé (US). | CAL-001 |
| CAL-006 | Horaires de prise et de retour | CAL | P1 | Défaut 7 h–22 h semaine, 7 h–19 h week-end, par lieu. | CAL-001 |
| CAL-007 | Jours fériés nationaux | CAL | P1 | Calendrier des fériés par pays (horaires, prix). | CAL-006 |
| CAL-010 | Refus d'un blocage chevauchant un trip confirmé | CAL | P1 | L'hôte doit annuler ou échanger explicitement. | CAL-011 |
| CAL-012 | Préavis minimal imposé pour la classe Luxe | CAL | P1 | 24 h minimum (fraude des réservations immédiates). | CAL-003 |
| HDB-003 | Page de performance | HDB | P1 | Taux de 5★, annulations, entretien, propreté, volume (« Check your performance »). | HDB-001 |
| HDB-006 | Power Host / programme Flota Pro | HDB | P1 | ≥ 4 véhicules, ≥ 36 000 $ ; Host Success, support dédié, avantages sinistres. | HDB-003 |
| HDB-007 | Seuils d'annulation et sanctions de visibilité | HDB | P1 | ≤ 20 trips : retrait jusqu'au webinaire ; > 20 : 5 % → 7 j, 10 % → fermeture. | BKG-032 |
| HDB-008 | Annulations excusées | HDB | P1 | Dommage du trip précédent, rebooking 24 h, 1re sur 10, sécurité, catastrophe, rappel. | HDB-007 |
| HDB-012 | Barème des pénalités hôte | HDB | P1 | Catalogue publié (fausse déclaration, marché gris, no-show, factures inéligibles…). | ADM-014 |
| HDB-013 | Fermeture du compte hôte par la plateforme | HDB | P1 | Préavis 30 j (immédiat si fraude), trips > 72 h annulés sans gains. | ADM-012 |
| HDB-015 | Avis reçus par l'hôte | HDB | P1 | Section avis dans Business ; réponse et demande de retrait. | REV-006 |
| HDB-018 | Occupation et revenus par véhicule | HDB | P1 | Taux d'occupation, RevPAD, revenu net par véhicule. | HDB-001 |
| PYO-004 | Calendrier des versements | PYO | P1 | Turo : 1er trip ~3 j ouvrés, suivants 3 h après la fin ; [NOUS] J+2, 1er J+5. | PYO-007 |
| PYO-005 | Versements regroupés (une opération par jour) | PYO | P1 | Regroupement quotidien des gains. | PYO-004 |
| PYO-006 | Versements partiels hebdomadaires (trips > 7 j) | PYO | P1 | Versement tous les 7 jours sans attendre la fin. | PYO-004 |
| PYO-008 | Retenue préventive en cas de litige | PYO | P1 | Retenue sur un versement si une réclamation guest contre l'hôte est ouverte. | PYO-007 |
| PYO-009 | Suspension des versements pour re-vérification | PYO | P1 | Versements suspendus si nouvelle vérification du compte nécessaire. | PYO-001 |
| PYO-010 | Gains par trip hors taxes (reçu hôte) | PYO | P1 | Détail des gains, frais plateforme, coût du plan. | PYO-007 |
| PYO-011 | Explication des écarts de versement | PYO | P1 | Plan, annulation, remboursements accordés, livraison gratuite, remises. | PYO-010 |
| PYO-012 | Export CSV et historique des transactions | PYO | P1 | Historique des mouvements de l'agence (trips, commissions, pénalités, crédits ; versements en P0-B) filtrable par période, export CSV UTF-8 pour sa … | PYO-007 |
| PYO-016 | Machine à états du versement | PYO | P1 | SM-6 : calculé, retenu, initié, payé, échoué, repris. | PYO-007 |
| FLT-002 | Lots de permissions co-hôte | FLT | P1 | « Trip management » et « Pricing & availability » ; sinistres, gains, réglages interdits. | FLT-001 |
| FLT-004 | Calendrier multi-véhicules | FLT | P1 | Vue flotte triable par prix, plaque, jours réservés. | CAL-001 |
| FLT-005 | Prix et blocages en masse | FLT | P1 | Modifier prix et disponibilités de plusieurs véhicules à la fois. | FLT-004 |
| FLT-006 | Distances et remises en masse | FLT | P1 | Paramètres kilométrage et remises appliqués à un groupe. | FLT-005 |
| FLT-007 | Groupes de véhicules par lieu | FLT | P1 | Rattacher des véhicules à des lieux (agences, POI). | HST-034 |
| FLT-009 | Exports CSV et iCal | FLT | P1 | Exports CSV des trips et des relevés de commission ; le flux iCal sortant par véhicule est déjà dans CAL-009. P1. | CAL-009 |
| FLT-010 | API partenaire pour loueurs | FLT | P1 | Disponibilités, prix, réservations, webhooks. | CAL-011 |
| FLT-013 | Swap intra-flotte automatique | FLT | P1 | Échange entre véhicules d'une même flotte sans support, conducteurs transférés. | TRP-027 |
| CLM-003 | Preuves et délais des pièces | CLM | P1 | Photos dans les fenêtres 24 h, métadonnées, pièces sous 15 j, diagnostic sur en-tête. | CLM-001 |
| CLM-004 | Choix règlement direct vs dossier plateforme | CLM | P1 | Le devis saisi affiche ce que l'hôte toucherait dans chaque parcours. | CLM-001 |
| CLM-005 | Règlement direct avec le guest | CLM | P1 | Devis sous 72 h, plafond du plan guest, facture plateforme, retrait sous 20 j. | CLM-004 |
| CLM-008 | Ordre de recouvrement | CLM | P1 | Tiers responsable → assureur du guest → guest dans la limite du plan. | CLM-006 |
| CLM-009 | Frais de traitement de réclamation | CLM | P1 | Jusqu'à 150 $ (remboursés si un tiers assume 100 %). | CLM-006 |
| CLM-010 | Échéancier pour dommages | CLM | P1 | ≤ 5 000 $ : 2/4/8 mois ; > 5 000 $ : 4/6/8 mois ; sans intérêts. | PAY-026 |
| CLM-012 | Vol et disparition du véhicule | CLM | P1 | Plainte guest ≤ 12 h, clé d'origine rendue ; enquête 30 j. | TRP-042 |
| CLM-019 | Factures annexes de l'hôte | CLM | P1 | Carburant, km, péages, PV, recharge ; délais 72 h (ou fenêtre du plan) et preuves. | TRP-033 |
| CLM-020 | Génération automatique des factures carburant / km / retard | CLM | P1 | À partir des données de check-out ; l'hôte valide sous 72 h. | TRP-034 |
| CLM-022 | Contestation et escalade | CLM | P1 | Hôte 72 h pour annuler, réviser ou escalader ; sinon escalade automatique. | CLM-021 ; ADM-008 |
| CLM-023 | Signalements nettoyage et tabac | CLM | P1 | Signalement d'incident sous 72 h, forfait 150 $, revue ~48 h. | CLM-003 |
| CLM-024 | Factures inéligibles et pénalités | CLM | P1 | Usure, préexistant, doublons interdits ; 50/200/500 $ ; [NOUS] validation en amont. | CLM-019 |
| CLM-025 | Péages et amendes tardifs | CLM | P1 | Facturables sous 90 j, puis 180 j via support ; [NOUS] rattachement auto par plaque. | CLM-019 |
| CLM-026 | Attestation de location pour amendes imputées au propriétaire | CLM | P1 | Contrat + identité du conducteur pour contester (DE 11/2025). | BKG-018 |
| CLM-031 | Refus de l'assureur partenaire et revue de garantie | CLM | P1 | État INSURER_DECLINED → revue de garantie plateforme si exclusion non communiquée. | CLM-006 |
| CLM-032 | Machines à états réclamation et facture annexe | CLM | P1 | Machines à états SM-4 (réclamation) et SM-5 (facture annexe) de 08. En P0-A, seule une SM-4 simplifiée (OUVERTE → EN_INSTRUCTION → DÉCIDÉE → CLOSE / … | CLM-006 |
| PRT-001 | Plans de protection guest (3 niveaux + refus) | PRT | P1 | Premier (0 $), Standard (500 $), Minimum (3 000 $), Decline. | — |
| PRT-002 | Éligibilité des plans | PRT | P1 | Premier interdit < 21 ans et indisponible > 60 000 $. | PRT-001 |
| PRT-004 | Exclusions communes affichées | PRT | P1 | Intérieur, mécanique, km, péages, carburant, Extras ; violation = plafond annulé. | PRT-001 |
| PRT-005 | Assistance routière 24/7 de base | PRT | P1 | Pannes mécaniques et accidents ; autres interventions jusqu'à 199 $. | SUP-004 |
| PRT-006 | Assistance routière améliorée (add-on) | PRT | P1 | 2,99 $/j : crevaison, clés, batterie, carburant, remorquage. | PRT-005 |
| PRT-010 | Moteur de plans paramétrable par pays et assureur | PRT | P1 | Niveaux, prix, franchises, exclusions, éligibilité configurables. | ADM-014 |
| PRT-011 | Protection minimale imposée / refus interdit | PRT | P1 | La plateforme restreint les plans ou interdit de décliner selon le risque. | VER-019 |
| SUP-001 | Centre d'aide | SUP | P1 | Bêta : FAQ statique bilingue publiée dans le centre légal (LEG-011) : réserver, pièces exigées, caution chez l'agence, annulation, urgence et … | — |
| SUP-002 | « Get help » : assistant IA puis agent humain | SUP | P1 | Assistant IA d'abord, agent humain sur demande. | SUP-001 |
| SUP-003 | Chats séparés vérification / facturation et historique | SUP | P1 | Fils dédiés avec historique visible. | ADM-010 |
| SUP-005 | Numéro WhatsApp Business vérifié unique | SUP | P1 | Un seul numéro officiel publié ; jamais de demande de paiement. | NTF-002 |
| SUP-006 | Page Trust & Safety publique | SUP | P1 | Screening, protections, bonnes pratiques, ligne d'urgence. | SUP-001 |
| SUP-007 | Domaines officiels, anti-spoofing, compte compromis | SUP | P1 | Liste des domaines, signalement de spoofing, adresse compte compromis. | SUP-001 |
| SUP-008 | Non-discrimination (tolérance zéro) | SUP | P1 | Politique et sanctions pouvant aller jusqu'au retrait. | ADM-012 |
| SUP-009 | Libre-service in-app (factures, signalements) | SUP | P1 | Actions sans contacter le support. | SUP-001 |
| SUP-010 | Contacts dédiés réclamations | SUP | P1 | Email sinistres et ligne urgente, réponse sous 2 j ouvrés. | ADM-009 |
| SUP-012 | Score de risque anti-fraude | SUP | P1 | Score qui filtre au paiement et déclenche des exigences. | ADM-011 |
| SUP-013 | reCAPTCHA et détection de comportements anormaux | SUP | P1 | Anti-spam/abus et cookies antifraude. | SUP-012 |
| SUP-015 | Catalogue des usages interdits | SUP | P1 | Vitesse, tout-terrain, courses, remorquage, VTC hors US, usage commercial, etc. | LEG-011 |
| SUP-016 | Restrictions et suspensions de compte | SUP | P1 | Déclencheurs : chargeback, impayé, violations, notes, discrimination, comptes liés. | ADM-012 |
| SUP-017 | Dommages-intérêts forfaitaires (marché gris, contournement) | SUP | P1 | 5 500 $ par manquement listé. | LEG-013 |
| ADM-009 | Gestion des dossiers sinistres | ADM | P1 | Dossier, pièces, lien assureur/expert, décompte, recouvrement. | CLM-006 |
| ADM-010 | Ticketing omnicanal | ADM | P1 | Tickets WhatsApp, email, chat, téléphone liés au trip et à l'utilisateur. | ADM-001 |
| ADM-011 | Moteur de règles de risque configurable | ADM | P1 | Règles (BIN, IP, âge du compte, classe, délai) → exigences ; journal explicable. | ADM-001 |
| ADM-012 | Sanctions, suspensions et appels | ADM | P1 | Création/levée de restrictions, notification, workflow d'appel par une autre personne. | ADM-005 |
| ADM-015 | Gestion des codes promo et campagnes | ADM | P1 | Création, règles d'usage, budget, suivi. | ADM-001 |
| ADM-017 | Modération des avis et des annonces | ADM | P1 | Traitement des demandes de retrait d'avis et contrôle des annonces. | ADM-001 |
| ADM-018 | Traitement des signalements d'annonce | ADM | P1 | File des « Report listing » avec actions. | LST-014 |
| ADM-019 | Gestion des aéroports et POI (AirportPermit) | ADM | P1 | Zones, curbside, frais, plafond de livraison, photos. | ADM-001 |
| ADM-020 | Gestion des rappels et inspections | ADM | P1 | Restriction, levée, suivi des échéances. | HST-023 |
| ADM-021 | Recouvrement des dettes | ADM | P1 | Relances, échéanciers, transfert à une agence. | PAY-027 |
| ADM-023 | Tableau de bord KPIs marketplace | ADM | P1 | GMV, take rate, occupation, sinistralité, annulations, délais de revue. | FIN-001 |
| ADM-024 | Gestion des gabarits de notification | ADM | P1 | Édition et prévisualisation des gabarits par langue et canal. | NTF-006 |
| ADM-025 | Outil d'investigation des comptes liés | ADM | P1 | Graphe appareil, carte, adresse, téléphone. | ACC-015 |
| ADM-026 | Traitement des demandes de droits (accès, suppression) | ADM | P1 | Export, pseudonymisation, conservation légale des factures et sinistres. | ADM-001 |
| ADM-027 | Feature flags par pays et segment | ADM | P1 | Activer pays, villes, pro vs P2P, fonctionnalités. | ADM-001 |
| ADM-028 | Catalogues (Extras, équipements, types, classes) | ADM | P1 | Listes fermées gérées par l'admin. | ADM-001 |
| FIN-006 | Comptabilisation des revenus en net (agent) | FIN | P1 | Revenus = frais marketplace + services, la plateforme agissant comme agent. | FIN-001 |
| FIN-008 | Profil fiscal de l'hôte | FIN | P1 | Formulaire in-app (W-9/W-8 chez Turo) ; [NOUS] RUC/cédula, régime. | PYO-001 |
| FIN-009 | Retenues à la source | FIN | P1 | Retenues sur services payés à l'entité US ; non-résidents. | FIN-001 |
| FIN-010 | Récapitulatif fiscal annuel de l'hôte | FIN | P1 | Synthèse annuelle des gains et frais. | PYO-012 |
| FIN-012 | Provisions (franchises impayées, fraude, chargebacks) | FIN | P1 | Provision en % du GMV et suivi. | FIN-001 |
| FIN-013 | Séparation crédit promotionnel / crédit en valeur | FIN | P1 | credit_promo (expirant) vs credit_cash (carte cadeau, remboursement). | MKT-002 |
| FIN-014 | Entité encaissante US + entité locale | FIN | P1 | Encaissement via entité US (Stripe/dLocal), versements aux loueurs. | PAY-001 |
| FIN-015 | Exports comptables | FIN | P1 | Exports vers le logiciel comptable. | FIN-001 |
| I18N-001 | Structure d'URL pays/langue | I18N | P1 | /{pays}/{langue}/… (ex. /pa/es/…) pour le référencement. P1 : en bêta, un seul pays, langue tirée de la préférence de compte. | — |
| I18N-002 | Sélecteur de langue | I18N | P1 | Sélecteur dans le footer et préférence de compte. | I18N-003 |
| I18N-006 | Fuseau horaire du véhicule | I18N | P1 | Stockage UTC + fuseau IANA ; affichage en heure du véhicule. | — |
| I18N-007 | Montants forfaitaires définis par devise | I18N | P1 | Pénalités et frais définis par devise, jamais convertis à la volée. | ADM-014 |
| I18N-008 | Cohérence linguistique de l'interface | I18N | P1 | Aucun mélange de langues (incohérence observée chez Turo). | I18N-003 |
| I18N-009 | Formats locaux | I18N | P1 | Téléphone E.164, adresses sans code postal, séparateurs, dates. | — |
| I18N-010 | Pages légales par pays | I18N | P1 | Pages légales propres au Panama (CGU, confidentialité, annulation, règles de location), rédigées par l'avocat local. Portées par LEG-011 (fusion). | LEG-011 |
| I18N-011 | Distances en kilomètres | I18N | P1 | Toutes les distances en km (fiche, contrat, compteur, factures). Portée par I18N-003 (fusion). | — |
| MKT-002 | Crédit voyage (portefeuille) | MKT | P1 | Code de crédit, solde, application automatique au prochain trip. | — |
| MKT-004 | Codes promo | MKT | P1 | Usage unique, devise du pays, réservation initiale, non cumulables, sur le prix du véhicule. | ADM-015 |
| MKT-010 | Pages marketing (Why choose, How it works, Trust) | MKT | P1 | Pages d'argumentaire et de fonctionnement. | — |
| LEG-003 | Opt-in marketing non pré-coché | LEG | P1 | Case marketing à l'inscription et au checkout. | LEG-002 |
| LEG-004 | Consentement aux messages automatiques (SMS / WhatsApp) | LEG | P1 | Fournir son numéro vaut consentement aux messages transactionnels. | NTF-002 |
| LEG-005 | Bannière et préférences cookies | LEG | P1 | Catégories nécessaires, performance, fonctionnalité, publicité ; lien « Cookie preferences ». | — |
| LEG-007 | Téléchargement de ses données en libre-service | LEG | P1 | Bêta : export manuel des données d'un utilisateur sur demande au support (modèle de réponse, délai légal à confirmer, OQ-BR-25). Bouton libre-service … | ADM-026 |
| LEG-008 | Demande de suppression des données | LEG | P1 | Distincte de la fermeture ; exclue si solde ou réclamation. | ADM-026 |
| LEG-012 | Conditions du payment plan | LEG | P1 | Pas un prêt, sans intérêts ni frais, défaut → recouvrement. | PAY-026 |
| LEG-013 | Clauses de dommages-intérêts forfaitaires | LEG | P1 | 5 500 $ par manquement (marché gris, contournement de suspension…). | — |
| LEG-016 | Licence sur le contenu utilisateur | LEG | P1 | Licence large sur photos, avis, descriptions. | LEG-011 |
| LEG-017 | Consentement à la télématique | LEG | P1 | Le guest autorise la collecte et informe conducteurs et passagers. | LEG-002 |
| LEG-019 | Absence de droit de rétractation | LEG | P1 | Seule la politique d'annulation s'applique. | LEG-011 |
| LEG-022 | Transparence du classement | LEG | P1 | Critères de classement publiés. | SRC-030 |
| FLT-017 | Moteur de réservation en marque blanche (site et WhatsApp de l'agence) | FLT | P1 | Widget intégrable et lien aux couleurs de l'agence, branché sur le même inventaire et le même checkout ; attribution du canal pour la commission … | BKG-001 ; PAY-033 |
| FLT-018 | API ouverte et connecteurs aux logiciels de location | FLT | P1 | Au-delà de FLT-010 : connecteurs vers les logiciels de gestion des agences pilotes, identifiés en entretiens avant le build (aucun identifié à ce … | FLT-010 |
| FLT-019 | Onboarding express : vérification des documents de l'entreprise en 48 h | FLT | P1 | Contrôle assisté des documents (RUC, Aviso de Operación, police) et import en masse avec photos ; objectif 48 h entre inscription et mise en ligne. | FLT-011 ; ADM-004 |
| REV-014 | Badge « Agencia verificada » et confiance qui réduit la caution | REV | P1 | Badge attribué après KYB, police valide et N trips sans litige ; niveaux de confiance guest qui réduisent la caution exigée. | REV-010 ; VER-027 |
| PAY-039 | Caution modulée et « caution-assurance » | PAY | P1 | Montant = base(classe) × multiplicateur(risque, historique) ; option de prime non remboursable couvrant la franchise via l'assureur partenaire. | PAY-011 ; PRT-001 |
| PAY-040 | Remboursement multi-rails (crédit immédiat ou virement vers un compte vérifié) | PAY | P1 | Choix du mode de remboursement avant le paiement non réversible ; virement vers un compte au nom du guest ; repris de EC-49. | PAY-022 |
| PRC-026 | Prix « tout compris » avec protection minimale | PRC | P1 | Prix affiché incluant taxes, frais et protection minimale obligatoire, après mesure de l'écart prix d'appel / prix final (mystery shopping, V6-06). | SRC-042 ; PRT-001 |
| TRP-053 | Clé perdue ou non restituée ; guest suspendu avec un trip à venir | TRP | P1 | Procédures et frais pour une clé perdue (EC-14) et règle pour les trips à venir d'un guest suspendu (EC-39). | TRP-033 ; ADM-005 |
| PYO-017 | Rails de versement alternatifs et plafond ACH Xpress 5 000 $ | PYO | P1 | Fractionnement ou bascule vers ACH Directo / PSP au-delà de 5 000 $ par transaction ; rails de secours. | PYO-002 |
| SUP-019 | Fraude spécifique LATAM : faux justificatifs, liens frauduleux, faux documents, SIM-swap | SUP | P1 | Règles et contrôles contre les faux justificatifs Yappy/ACH, les liens de paiement frauduleux, les fausses cédulas et faux permis, le SIM-swap sur … | ADM-029 ; PAY-034 |
| ACC-034 | B2B minimal : facture au RUC de l'entreprise et conducteur additionnel | ACC | P1 | Réservation par un salarié avec facture de l'agence au RUC de l'entreprise et ajout d'un conducteur additionnel vérifié ; demande à valider en … | BKG-002 |
| BKG-041 | Livraison aéroport via des points homologués hors emprise, suivi de vol | BKG | P1 | Remise hors comptoir à Tocumen/Albrook via des points homologués, avec suivi du vol ; seulement après OQ-MK-08. | HST-034 ; BKG-024 |
| CLM-036 | Refacturation Panapass / ATTT avec solde vérifié | CLM | P1 | Rapprochement des passages Panapass et des amendes ATTT avec le trip, refacturation et constancia ; délais de facturation selon SRC_G 6.7.1. | CLM-026 |
| TRP-055 | Intégration des GPS et télématiques déjà installés | TRP | P1 | Connecteurs vers les GPS existants des agences (position, kilométrage, carburant), un connecteur par fournisseur. | TRP-042 |

## C.2 — Phase P2 (108 lignes)

| feature_id | Nom | Epic (module) | Phase | Description (une ligne) | Dépendances clés |
|---|---|---|---|---|---|
| ACC-012 | Liaison a posteriori d'un compte Google | ACC | P2 | Lier un compte Google à un compte email existant depuis Account. | ACC-002 |
| ACC-016 | Gel des comptes multiples créés pour contourner | ACC | P2 | Créer un compte pour contourner un problème de connexion met tous les comptes en attente. | ACC-015 |
| ACC-024 | Réouverture de compte via support | ACC | P2 | Réouverture possible par le support ; demandes de tiers refusées. | ADM-005 |
| VER-008 | Consultation crédit, casier, historique de conduite | VER | P2 | Vérifications via services tiers avec autorisation à l'inscription. | LEG-019 |
| VER-016 | Vérification manuelle du permis 1 h avant | VER | P2 | Option de vérification manuelle par l'hôte peu avant le départ. | VER-015 |
| SRC-007 | Recherche à dates flexibles | SRC | P2 | Paramètre flexibleType suggérant une recherche à dates flexibles. | SRC-001 |
| SRC-020 | Filtres de classe (Deluxe 25+, Super Deluxe 30+) et All-Star | SRC | P2 | Toggles « Elevate your experience ». | SRC-013 |
| SRC-021 | Collections éditoriales curées | SRC | P2 | 26 collections (électriques, 4x4, manuelles…) sous forme de tuiles filtrantes. | ADM-016 |
| SRC-023 | Filtres verts, accessibilité, pet friendly, siège enfant, self-driving | SRC | P2 | Green Vehicles, Accessible, pet friendly, child seat, Self-driving. | SRC-013 |
| SRC-028 | « Inspiré de vos recherches récentes » | SRC | P2 | Véhicules vus récemment proposés sur la home. | SRC-027 |
| SRC-029 | Encarts éditoriaux (nudges) dans la liste | SRC | P2 | Urgence (« réservez tôt ») et réassurance (annulation gratuite). | SRC-008 |
| SRC-036 | Bloc SEO à onglets en home | SRC | P2 | Types, marques & modèles, villes, aéroports, villes internationales, États. | SRC-033 |
| SRC-037 | Assistant conversationnel « Ask Turo » | SRC | P2 | Chat flottant (restart / close) pour chercher et répondre. | SUP-002 |
| SRC-039 | API de recherche publique et deep links | SRC | P2 | API lecture seule + deep links avec searchId pour attribution. | SRC-040 |
| SRC-044 | Listes de favoris nommées | SRC | P2 | Cœur « Add to favorites » qui range dans des listes nommées (wishlist). | ACC-027 |
| SRC-045 | Ajouter / retirer un favori depuis carte ou fiche | SRC | P2 | Bouton cœur sur la carte résultat, la home et la fiche. | SRC-044 |
| LST-005 | Badge « Bonne affaire » | LST | P2 | Prix inférieur aux options similaires pour les mêmes dates. | PRC-025 |
| LST-011 | Encart « paiement flexible » | LST | P2 | Aucune avance si tarif remboursable. | PAY-007 |
| LST-025 | Liens « Browse more {modèle} » | LST | P2 | Liens SEO vers d'autres véhicules du modèle. | SRC-033 |
| BKG-011 | Mode demande (request to book) avec expiration | BKG | P2 | Ancien flux : 8 h pour accepter, sinon véhicule similaire ou remboursement. | BKG-010 |
| BKG-037 | Crédit de rebooking discrétionnaire | BKG | P2 | Crédit ponctuel selon la durée et le moment de l'annulation hôte. | MKT-002 |
| PAY-003 | Apple Pay / Google Pay avec carte de secours | PAY | P2 | Wallets acceptés mais carte de secours obligatoire. | PAY-002 |
| PAY-007 | Pay later (débit différé) | PAY | P2 | Tarif remboursable : débit 2 j ou 7 j avant le départ, sans frais. | PAY-015 |
| PAY-010 | Paiement en cuotas sans intérêt des émetteurs | PAY | P2 | BNPL porté par la banque émettrice (cuotas). | PAY-001 |
| PAY-014 | Caution versée et restituée (QR / virement) | PAY | P2 | Alternative à la pré-autorisation pour moyens non réversibles. | PAY-004 |
| PAY-016 | Account updater des réseaux | PAY | P2 | Mise à jour automatique des cartes renouvelées. | PAY-015 |
| PAY-020 | Bascule (failover) vers un second acquéreur | PAY | P2 | Prolongation des holds et bascule pendant une panne PSP. | PAY-001 |
| PAY-024 | Remboursement anticipé à la demande du guest | PAY | P2 | Après annulation hôte, le guest peut demander le remboursement avant les 24 h de crédit. | BKG-036 |
| PAY-030 | Échec du débit différé → annulation sans pénalité | PAY | P2 | Relance 24 h puis annulation automatique, créneau libéré, hôte notifié. | PAY-007 |
| PRC-004 | Prix recommandés et graphique « Future prices » | PRC | P2 | Recommandations sur 90 jours, mises à jour quotidiennement, bannières et push. | PRC-001 |
| PRC-005 | Alerte prix trop élevé (≥ 20 % au-dessus) | PRC | P2 | Jours surlignés en jaune, risque de moindre visibilité. | PRC-004 |
| PRC-023 | Codes promo de l'hôte après trip | PRC | P2 | 5, 10 ou 15 % plafonnés à 100 $, 90 jours, usage unique, proposés en notant le guest. | REV-002 |
| TRP-009 | Code de boîte à clés unique révélé après vérification | TRP | P2 | Code changé à chaque trip, communiqué après vérification d'identité. | VER-014 |
| TRP-019 | Départ anticipé (≤ 1 h) | TRP | P2 | Sans demande si hôte et véhicule prêts ; check-in obligatoire. | TRP-002 |
| TRP-031 | Prolongation pour circonstances exceptionnelles | TRP | P2 | Heure de retour étendue via le support ; kilométrage inchangé. | ADM-013 |
| TRP-032 | Entretien pendant les trips longs | TRP | P2 | > 30 j ou > 3 000 mi : entretien courant à la charge de l'hôte ; guest 2 semaines. | PAY-008 |
| TRP-044 | Alerte GPS hors ligne | TRP | P2 | Alerte hôte/ops après 2 h sans ping (4 h hors zones urbaines). | TRP-042 |
| TRP-049 | Retour par un conducteur additionnel approuvé | TRP | P2 | Divergence : réduit les retours manqués. | VER-017 |
| MSG-006 | Questions pré-réservation filtrées | MSG | P2 | Questions à l'hôte avant réservation avec masquage automatique des contacts. | MSG-007 |
| MSG-008 | Détection d'accords de modification hors système | MSG | P2 | Reconnaît « te la dejo hasta el lunes » et propose le bouton Change trip. | MSG-007 ; TRP-020 |
| MSG-009 | Détection des demandes de documents d'identité | MSG | P2 | Avertit quand un hôte demande cédula/passeport par message. | MSG-007 |
| MSG-012 | Consentement écrit caméra / audio par message | MSG | P2 | L'hôte obtient l'accord écrit du guest pour caméra intérieure ou audio. | MSG-001 |
| MSG-013 | Traduction automatique des messages | MSG | P2 | Traduction es ↔ en des fils. | MSG-001 |
| MSG-014 | Relais WhatsApp masqué | MSG | P2 | Messages de la plateforme relayés sur WhatsApp sans exposer les numéros. | NTF-002 |
| NTF-019 | Notifications de performance et sanctions d'annulation | NTF | P2 | Statut All-Star, dépublication, webinaire requis, préavis de fermeture. | HDB-003 |
| NTF-020 | Notifications de recommandations de prix | NTF | P2 | Bannières mensuelles et push. | PRC-004 |
| NTF-022 | Notifications marketing (opt-in) | NTF | P2 | Offres, recommandations, actualités selon préférences. | LEG-003 |
| REV-009 | Détection de données personnelles avant publication | REV | P2 | Téléphones, noms complets masqués avant publication. | REV-004 |
| REV-011 | Exclusion des guests régulièrement mal notés | REV | P2 | Retrait des guests aux mauvaises notes répétées. | REV-002 ; ADM-012 |
| REV-013 | Avis multilingues et traduction | REV | P2 | Avis EN/ES affichés ; [NOUS] traduction. | REV-010 |
| HST-002 | Simulateur de revenus (Carculator) | HST | P2 | Marché, marque/modèle/année → gains mensuels/annuels, slider de jours, top 10. | HST-001 |
| HST-013 | Détection de contacts dans les photos | HST | P2 | Numéros de téléphone / QR WhatsApp détectés dans les images. | HST-012 |
| HST-029 | Annonce non transférable | HST | P2 | Une annonce ne peut pas passer à un autre hôte. | HST-026 |
| HST-037 | Liaison du compte de péage | HST | P2 | Transpondeur prioritaire sur la plaque, option « Don't track », facture auto. | CLM-025 |
| HST-043 | Host Hub (ressources, Hosting 101, Grow your business) | HST | P2 | Centre de ressources hôtes et articles. | — |
| HST-048 | Choix du plan de gains à l'onboarding | HST | P2 | Plan par défaut attribué, modifiable ensuite. | PRT-007 |
| CAL-008 | Option 24/7 pour remise sans contact | CAL | P2 | Retrait à toute heure si boîte sécurisée ou serrure connectée. | TRP-009 |
| HDB-004 | Statut All-Star Host | HDB | P2 | Évaluation trimestrielle sur 365 j ; badge, filtre, annulation de frais, priorité. | HDB-003 |
| HDB-009 | Formation « annulations » pour remise en ligne | HDB | P2 | Webinaire puis remise en ligne sous 24–48 h. | HDB-007 |
| HDB-010 | Standards qualité sur 90 jours et fermeture | HDB | P2 | Seuil de 5★ (65 % → 70 %) ; en dessous, fermeture du compte. | HDB-003 |
| HDB-011 | Blocage automatique pour entretien insuffisant | HDB | P2 | Taux d'entretien bas sur 10 trips → blocage jusqu'à inspection. | HST-024 |
| HDB-016 | Business coaching / équipe Host Success | HDB | P2 | Conseil business (assurance, parking, financement). | HDB-006 |
| PYO-003 | Versements aux particuliers | PYO | P2 | Stripe Global Payouts (entité US) ou dLocal pour les hôtes P2P. | PYO-001 |
| PYO-014 | Versements de sinistres (hôte, garage, créancier) | PYO | P2 | Paiement à l'hôte enregistré, au garage ou au créancier. | CLM-006 |
| PYO-015 | Versements maintenus après fermeture du compte | PYO | P2 | Versements par virement et récapitulatif fiscal annuel. | HDB-013 |
| FLT-008 | Changement de plan pour toute la flotte | FLT | P2 | Plan appliqué à tous les véhicules (effet nouveaux trips). | PRT-008 |
| FLT-012 | Connecteur logiciels rent-a-car | FLT | P2 | Synchronisation avec les logiciels de gestion des loueurs. | FLT-010 |
| CLM-007 | Dépôt dommage prélevé au guest | CLM | P2 | 500 $ (Standard, Minimum, Decline) ou 3 000 $ si non roulant ; aucun pour Premier. | CLM-006 |
| CLM-011 | Perte totale (ACV, titre, épave) | CLM | P2 | Perte totale si réparation > 75 % de l'ACV ; cession du titre ou valeur d'épave déduite. | CLM-006 |
| CLM-013 | Supplément de réparation par le garage | CLM | P2 | Déposé par le garage sous 45 j après le premier paiement. | CLM-006 |
| CLM-015 | Réseau de garages agréés et liste noire | CLM | P2 | Prestataires préférés, garages exclus pour facturation abusive. | CLM-006 |
| CLM-016 | Mode « reimbursement-only » | CLM | P2 | Fraude présumée : factures détaillées et preuves de paiement exigées. | CLM-006 |
| CLM-017 | Clés perdues traitées en réclamation | CLM | P2 | Remplacement de clé = réclamation dommage ; [NOUS] forfait publié par classe. | CLM-006 |
| CLM-018 | Crevaisons et pneus | CLM | P2 | Charge du guest si accident/vandalisme ; pneus défectueux ou ≥ 6 ans à la charge de l'hôte. | CLM-006 |
| CLM-027 | Forfait fourrière | CLM | P2 | 399 $ si la plateforme récupère un véhicule en fourrière par la faute du guest. | CLM-019 |
| CLM-030 | Comparaison automatique des photos départ / retour | CLM | P2 | Détection des nouveaux dommages par zone du véhicule. | TRP-004 |
| PRT-007 | Plans de gains hôte (part / franchise) | PRT | P2 | 70 %/250 $, 80 %/1 500 $, 90 %/2 750 $ ; RC 750 000 $. | PRT-010 |
| PRT-008 | Plan par véhicule modifiable | PRT | P2 | Modifiable à tout moment, effet sur les nouveaux trips. | PRT-007 |
| PRT-014 | Agence de courtage propre | PRT | P2 | Turo Insurance Agency distribue les protections. | PRT-010 |
| PRT-015 | Exclusions côté hôte et période couverte | PRT | P2 | Couverture = période de réservation ; livraison RC seule ; usure ≤ 3". | PRT-007 |
| PRT-016 | Assurance personnelle de l'hôte nommant le véhicule | PRT | P2 | Preuve d'assurance perso/commerciale exigée. | HST-039 |
| PRT-017 | Option perte de revenus pour hôtes pros | PRT | P2 | Indemnité d'immobilisation après sinistre. | PRT-010 |
| SUP-014 | Détection des abus de promotions | SUP | P2 | Transactions promo entre proches interdites ; [NOUS] graphe appareil/adresse/carte. | ADM-025 |
| SUP-018 | Bonne pratique : un seul contact par problème | SUP | P2 | Les relances retardent le traitement ; [NOUS] dédoublonnage des tickets. | ADM-010 |
| ADM-013 | Déclaration d'événement régional | ADM | P2 | Zone + période : annulations excusées et prolongations sans frais automatiques. | ADM-006 |
| ADM-016 | Gestion des collections, home et pages SEO | ADM | P2 | Curation des collections et carrousels. | ADM-001 |
| ADM-030 | Vue « comme l'utilisateur » en lecture seule | ADM | P2 | Reproduire l'écran d'un utilisateur pour le support. | ADM-005 |
| FIN-007 | Reporting fiscal des revenus des hôtes | FIN | P2 | Déclarations plateformes (1099-K, DAC7, SERR) ; [NOUS] DGI si exigé. | FIN-008 |
| FIN-017 | Unit economics par trip et par véhicule | FIN | P2 | Revenu plateforme, frais PSP, provisions, support, assurance. | ADM-023 |
| I18N-012 | Crédits non convertibles entre pays | I18N | P2 | Crédit libellé dans la devise du pays d'émission. | MKT-002 |
| MKT-003 | Choix d'appliquer ou non son crédit | MKT | P2 | Le guest choisit d'utiliser son crédit (divergence). | MKT-002 |
| MKT-005 | Parrainage hôte | MKT | P2 | 300 $ chacun après 3 trips ou 15 jours, dans certains marchés. | MKT-004 |
| MKT-006 | Parrainage guest | MKT | P2 | Absent chez Turo depuis 2019. | MKT-004 |
| MKT-009 | Campagnes CRM email / WhatsApp | MKT | P2 | Segmentation et campagnes selon consentement. | LEG-003 |
| MKT-012 | Bannière d'acquisition hôte dans le header | MKT | P2 | « Earn up to $1,000 per month… ». | HST-001 |
| MKT-014 | Liens réseaux sociaux et stores | MKT | P2 | Facebook, Instagram, TikTok, YouTube, App Store, Google Play. | — |
| MKT-016 | Témoignages et chiffres clés | MKT | P2 | Témoignages d'hôtes, revenus moyens, nombre de véhicules. | HST-001 |
| MKT-017 | Partenariats hôtels, agences de voyage, compagnies aériennes | MKT | P2 | Canaux d'acquisition touristique (Tocumen). | SRC-039 |
| LEG-018 | Autorisation de consultation de rapports (crédit, casier) | LEG | P2 | Autorisation donnée à la création du compte (FCRA). | VER-008 |
| LEG-021 | Avertissements réglementaires locaux | LEG | P2 | Mention des lois locales limitant le P2P (CA, OR). | HST-001 |
| CLM-035 | Inspection de dommages assistée par IA (avant / après) | CLM | P2 | Comparaison automatique des photos de départ et de retour avec seuil de confiance et revue humaine. | CLM-030 |
| TRP-054 | Géofencing défini par véhicule et alertes graduées | TRP | P2 | Zones et frontières définies par l'agence, alertes graduées sur données GPS ; coupure moteur exclue (OQ-BR-17). | TRP-043 ; TRP-055 |
| ACC-035 | Comptes entreprises multi-conducteurs et politiques de dépense | ACC | P2 | Compte entreprise, conducteurs désignés, politiques de dépense, facturation centralisée. | ACC-034 |
| BKG-042 | Locations de 1 à 3 mois pour expatriés, contrôle art. 110/111 | BKG | P2 | Trips mensuels avec paiement par échéances et contrôle du statut du conducteur. | PAY-008 ; VER-007 |
| SRC-046 | Recherche par usage et par destination | SRC | P2 | Recherche par usage (plage, montagne, 4x4) et compatibilité de route. | SRC-001 |
| HST-051 | Enrichissement du catalogue véhicules par source sous licence | HST | P2 | Base sous licence ou décodeur VIN couvrant le Panama et le Paraguay, photos sous licence, après mesure de la couverture en Bêta (aligné v4, 17 ADR-034). | HST-050 |
| HST-049 | Éligibilité P2P et onboarding fiscal de l'hôte particulier | HST | P2 | Véhicule de particulier : nantissement (prenda) ou consentement du prêteur, inspection, âge ; aide au RUC et relevé annuel ; automatisations hôtes de … | FIN-008 ; PYO-003 |
| MKT-018 | Distribution via les agrégateurs (Kayak, Rentcars) | MKT | P2 | Flux d'inventaire vers les agrégateurs comme canal, à évaluer face à la concurrence des agrégateurs (14 §a.0). | FLT-010 |

## C.3 — Phase P3 (47 lignes)

| feature_id | Nom | Epic (module) | Phase | Description (une ligne) | Dépendances clés |
|---|---|---|---|---|---|
| ACC-030 | Compte entreprise guest (réservation pour employés) | ACC | P3 | Une entreprise réserve pour des employés désignés conducteurs principaux. | ACC-029 |
| ACC-031 | Connexion avec un compte Uber | ACC | P3 | Réservation depuis l'app Uber avec identifiants Uber. | — |
| VER-021 | Validation du permis via Apple/Google Wallet | VER | P3 | Permis numérique en wallet accepté pour vérifier, physique exigé au check-in. | — |
| SRC-038 | Distribution via assistants IA (app ChatGPT, connecteur Claude) | SRC | P3 | Recherche de véhicules depuis un assistant ; réservation finalisée chez la plateforme. | SRC-039 |
| SRC-043 | Réservation via une app partenaire (Uber) | SRC | P3 | Réservation depuis l'app Uber (US). | ACC-031 |
| PAY-009 | Pay over time (BNPL) | PAY | P3 | Affirm/Klarna/Afterpay ; ≤ 30 j, sans dépôt ; remboursements chez le financeur. | PAY-001 |
| PAY-013 | Réduction du dépôt si assurance personnelle fournie | PAY | P3 | −250 $ sur Deluxe/Super Deluxe si assurance perso fournie à la réservation. | PAY-011 |
| PAY-032 | Signalement aux bureaux de crédit | PAY | P3 | Impayés signalés aux bureaux (US : Experian, Equifax, TransUnion). | PAY-027 |
| PRC-003 | Tarification dynamique appliquée à toutes les annonces | PRC | P3 | Facteurs : modèle, valeur, recherches, historique, offre/demande, saison. | PRC-004 |
| PRC-006 | Tutoriel obligatoire avant de modifier ses prix | PRC | P3 | Formation à la tarification dynamique exigée avant l'édition des prix. | PRC-003 |
| PRC-007 | Last-minute boost (+5 %) | PRC | P3 | Majoration par défaut des réservations du jour même (< 24 h). | PRC-001 |
| PRC-009 | Minimums de remise imposés (3/5/10/15/20 %) | PRC | P3 | Remises activées d'office avec minimums ; remise mensuelle recommandée 45 %. | PRC-008 |
| PRC-024 | Part hôte variable selon l'anticipation | PRC | P3 | 65–100 % selon le délai de réservation dans 9 marchés US. | PRT-007 |
| TRP-010 | Déverrouillage à distance / serrure connectée | TRP | P3 | App constructeur ; serrures connectées pour flottes. | TRP-008 |
| TRP-013 | Crédit parking aéroport | TRP | P3 | Crédit des heures de parking avant le début. | TRP-012 |
| NTF-021 | « Recent updates » (nouveautés produit) | NTF | P3 | Rubrique in-app des nouveautés. | NTF-005 |
| HST-008 | Étape « Your goals » | HST | P3 | Objectifs de l'hôte (contenu inconnu). | HST-005 |
| HST-014 | Programme de photographes professionnels | HST | P3 | Shooting optionnel ; la plateforme détient les droits. | HST-012 |
| HST-022 | Véhicules classiques et de spécialité (revue manuelle) | HST | P3 | Revue approfondie et inspection. | HST-021 |
| HST-036 | Demande de permis aéroport | HST | P3 | Formulaire pour demander un permis dans un aéroport non couvert. | HST-035 |
| HST-038 | Liaison du compte Tesla | HST | P3 | Factures de Supercharge automatiques. | CLM-028 |
| HST-044 | Offres partenaires pour hôtes (Deals & discounts) | HST | P3 | Réductions négociées (lockbox, pneus, vitrage). | HST-043 |
| CAL-013 | Dépassement de la durée max par extensions successives | CAL | P3 | Si l'hôte accepte une extension au-delà du max, le guest peut le dépasser à nouveau. | TRP-022 |
| HDB-005 | Code promo annuel All-Star | HDB | P3 | 100 $ après 4 trimestres consécutifs. | HDB-004 |
| HDB-014 | Host insights / newsletter selon le plan | HDB | P3 | Fréquence trimestrielle, semestrielle ou annuelle. | PRT-007 |
| HDB-017 | Business planner et « Top-earning cars » | HDB | P3 | Outils de planification de flotte. | HST-002 |
| FLT-014 | Programme « revenu passif » | FLT | P3 | Associe des propriétaires sans temps à des hôtes expérimentés. | FLT-001 |
| FLT-015 | Host Services (financement, assurance hors trajet) | FLT | P3 | Services financiers et d'assurance pour hôtes. | HDB-006 |
| FLT-016 | Capteur de qualité d'air (preuve tabac) | FLT | P3 | Capteur optionnel comme preuve objective. | TRP-042 |
| CLM-014 | Règles des pièces et du gardiennage | CLM | P3 | OEM si ≤ 2 ans et < 24 000 mi, sinon moins cher ; gardiennage ≤ 2 500 $. | CLM-006 |
| CLM-028 | Barème de recharge électrique | CLM | P3 | Écart de batterie 5–25 $ + 10 $ ; 20 $ si < 20 %. | CLM-019 |
| CLM-029 | Facturation en cours de trip (≥ 60 j) | CLM | P3 | Une facture ouverte à la fois pendant les trips longs. | CLM-019 |
| CLM-033 | Facturation après fermeture du compte hôte | CLM | P3 | Péages et PV 90 j, autres frais 72 h. | CLM-019 |
| PRT-012 | Assurance RC supplémentaire (SLI) | PRT | P3 | Option jusqu'à 300 000 $ (résidents US). | PRT-003 |
| PRT-018 | Retenue si absence de tracker (véhicules chers) | PRT | P3 | Jusqu'à 20 % de retenue si ≥ 125 000 $ sans tracker OEM actif. | TRP-042 |
| FIN-011 | Exonération de taxe a posteriori sur justificatif | FIN | P3 | Pas d'exonération au niveau du compte ; remboursement sur justificatif. | FIN-004 |
| FIN-016 | Réserves sinistres / assureur captif | FIN | P3 | Combinaison assurance tierce, rétention, captif, réserves. | FIN-012 |
| I18N-013 | Support oral en guaraní (Paraguay) | I18N | P3 | Support téléphonique en guaraní. | SUP-011 |
| MKT-001 | Cartes cadeaux | MKT | P3 | E-cartes 25–2 000 $, sans expiration, envoi programmable, versées en crédit. | MKT-002 |
| MKT-007 | Programme de fidélité guest | MKT | P3 | Arrêté le 24/07/2025 ; jours bonus utilisables jusqu'à expiration. | MKT-002 |
| MKT-008 | Partenariats de fidélité co-brandés | MKT | P3 | Citi/AAdvantage (crédit par trip), Qatar Avios. | MKT-002 |
| MKT-011 | Page « Weddings » et « Pitch a trip » | MKT | P3 | Liens présents dans le footer et Trips. | MKT-010 |
| MKT-013 | Blog et communauté hôtes (OpenRoad) | MKT | P3 | Blog et site d'advocacy. | — |
| MKT-015 | Segment partenaire dédié (Tesla FSD) | MKT | P3 | Page et bannière dédiées. | — |
| LEG-006 | « Do not sell or share my personal information » | LEG | P3 | Lien CCPA dans le footer. | LEG-005 |
| LEG-023 | Mentions des marques tierces | LEG | P3 | Mentions légales Apple/Google sur les équipements. | — |
| BKG-043 | Option « avec chauffeur » par mise en relation avec des transporteurs licenciés | BKG | P3 | Mise en relation sans chauffeur fourni par la plateforme ; conditionnée à OQ-BR-15. | BKG-001 |

# PARTIE D — Traçabilité

## D.1 Matrice feature → BR → EC → vecteurs de test → OQ

Générée par script à partir des fiches de la partie B (identifiants cités dans la fiche) et de la colonne `regles_liees` de 04. Pour une fiche regroupée, les EC, vecteurs et OQ cités dans la fiche sont attribués à chacun de ses `feature_id`. « TA » = vecteurs P0-A de ce PRD (A.8.1). **Version 2** : matrice régénérée par `tools/check_prd_structure.py` (découpage des fiches aux titres `####` **et** `##`, ce qui corrige l'attribution erronée de I18N-003 / I18N-004, consolidé VERIF_15-F8) ; la colonne OQ inclut les questions UX `UXQ-xx` de 22. La colonne OQ fusionne les questions citées dans la fiche et les questions bloquantes de D.2.

| feature_id | Phase | Fiche | BR | EC | Vecteurs | OQ |
|---|---|---|---|---|---|---|
| ACC-001 | P0-A | ACC-001 — Inscription par email et mot de passe | BR-ACC-01, BR-ACC-03 | — | — | — |
| ACC-006 | P0-A | ACC-006 — Nom légal identique au permis | BR-ACC-07 | — | — | — |
| ACC-008 | P0-A | ACC-008 — Nom commercial affiché par l'agence | BR-ACC-07 | — | — | — |
| ACC-014 | P0-A | ACC-014 — Un compte par personne | BR-ACC-03, BR-TRUST-01, BR-VERIF-09 | EC-43 | — | — |
| ACC-029 | P0-A | ACC-029 — Compte personne morale (loueur, RUC) | BR-ACC-06, BR-LIST-01 | — | — | — |
| VER-001 | P0-A | VER-001 — Téléversement du permis recto/verso | BR-VERIF-01, BR-VERIF-02, BR-VERIF-04, BR-VERIF-11 | — | — | OQ-MK-09 |
| VER-002 | P0-A | VER-002 / VER-003 — Selfie avec liveness et face match | BR-VERIF-01, BR-VERIF-07, BR-VERIF-09, BR-VERIF-11 | EC-43 | — | OQ-MK-09 |
| VER-003 | P0-A | VER-002 / VER-003 — Selfie avec liveness et face match | BR-VERIF-01, BR-VERIF-07, BR-VERIF-09, BR-VERIF-11 | EC-43 | — | OQ-MK-09 |
| VER-004 | P0-A | VER-004 — Consentement biométrique et rétention | BR-ACC-09, BR-VERIF-01 | — | — | OQ-BR-25, OQ-MK-09 |
| VER-005 | P0-A | VER-005 — Pièce d'identité cédula / passeport | BR-VERIF-01 | — | — | OQ-MK-09 |
| VER-006 | P0-A | VER-006 — Règles des permis acceptés / refusés | BR-VERIF-02 | — | — | OQ-BR-21 |
| VER-007 | P0-A | VER-007 — Contrôle des 90 jours du permis étranger | BR-VERIF-02, BR-VERIF-09 | EC-50 | — | OQ-BR-21, UXQ-03, UXQ-08, UXQ-12 |
| VER-013 | P0-A | VER-013 — Vérification du téléphone par OTP | BR-VERIF-06 | — | — | — |
| VER-015 | P0-A | VER-015 — Vérification du permis au comptoir (6 points) | BR-CXL-08, BR-CXL-12, BR-PICKUP-07, BR-PICKUP-08, BR-VERIF-07 | — | T07, T08, TA03, TA04 | — |
| VER-027 | P0-A | VER-027 — Vérification des loueurs professionnels (KYB) | BR-ACC-06, BR-LIST-01 | — | — | — |
| VER-028 | P0-A | VER-028 — Contrôle anti-blanchiment et listes de sanctions | — | — | — | — |
| SRC-001 | P0-A | SRC-001 / SRC-002 — Recherche lieu + dates + heures, autocomplétion | BR-BOOK-03, BR-BOOK-04, BR-BOOK-06 | — | — | — |
| SRC-002 | P0-A | SRC-001 / SRC-002 — Recherche lieu + dates + heures, autocomplétion | BR-BOOK-03, BR-BOOK-04, BR-BOOK-06 | — | — | — |
| SRC-008 | P0-A | SRC-008 / SRC-012 — Liste de résultats, carte et tri | BR-BOOK-07, BR-HP-07, BR-PRICE-13 | — | — | — |
| SRC-011 | P0-A | SRC-011 — Carte résultat | BR-PAY-06, BR-PRICE-13 | — | — | — |
| SRC-012 | P0-A | SRC-008 / SRC-012 — Liste de résultats, carte et tri | BR-BOOK-07, BR-HP-07, BR-PRICE-13 | — | — | — |
| SRC-042 | P0-A | SRC-042 — Affichage du total TTC | BR-PRICE-12, BR-PRICE-13, BR-PRICE-14 | — | TA01 | — |
| LST-002 | P0-A | LST-002 — Galerie de photos | BR-LIST-05 | — | — | — |
| LST-003 | P0-A | LST-003 / LST-020 — En-tête véhicule et bloc agence | BR-HP-01, BR-REVIEW-03, BR-REVIEW-05 | — | — | — |
| LST-006 | P0-A | LST-006 / LST-008 — Sélecteur de dates sur la fiche, dates indisponibles | BR-BOOK-03, BR-BOOK-04, BR-BOOK-06, BR-BOOK-07 | — | — | — |
| LST-007 | P0-A | LST-007 — Lieu de retrait de l'agence | BR-BOOK-02, BR-BOOK-09 | — | — | — |
| LST-008 | P0-A | LST-006 / LST-008 — Sélecteur de dates sur la fiche, dates indisponibles | BR-BOOK-03, BR-BOOK-04, BR-BOOK-06, BR-BOOK-07 | — | — | — |
| LST-010 | P0-A | LST-010 — Résumé de la politique d'annulation | BR-CXL-00, BR-CXL-01, BR-CXL-06 | — | — | OQ-BR-30 |
| LST-012 | P0-A | LST-012 — Distance incluse et prix du km supplémentaire | BR-MILEAGE-01, BR-MILEAGE-04, BR-PRICE-17 | — | — | — |
| LST-013 | P0-A | LST-013 — Bloc assurance et protection | BR-PAY-06, BR-PROT-01, BR-PROT-03, BR-PROT-04 | — | — | OQ-BR-16, OQ-MK-05 |
| LST-020 | P0-A | LST-003 / LST-020 — En-tête véhicule et bloc agence | BR-HP-01, BR-REVIEW-03, BR-REVIEW-05 | — | — | — |
| BKG-001 | P0-A | BKG-001 / BKG-006 — Checkout une page et détail du sous-total | BR-BOOK-01, BR-BOOK-08, BR-PRICE-12, BR-PRICE-13, BR-PRICE-14 | — | TA01 | — |
| BKG-002 | P0-A | BKG-002 / BKG-025 — Conducteur principal et aptitude boîte manuelle | BR-ACC-02, BR-ACC-04, BR-ACC-08, BR-PICKUP-07, BR-VERIF-08 | — | — | — |
| BKG-006 | P0-A | BKG-001 / BKG-006 — Checkout une page et détail du sous-total | BR-BOOK-01, BR-BOOK-08, BR-PRICE-12, BR-PRICE-13, BR-PRICE-14 | — | TA01 | — |
| BKG-008 | P0-A | BKG-008 / BKG-023 — Acceptation des conditions et clauses géographiques | BR-ACC-01, BR-BOOK-12, BR-GEO-01, BR-GEO-02 | EC-45, EC-46, EC-53 | — | — |
| BKG-012 | P0-A | BKG-012 — Contrôles bloquants à la réservation | BR-ACC-04, BR-ACC-10, BR-BOOK-11, BR-VERIF-09 | — | — | UXQ-08 |
| BKG-014 | P0-A | BKG-014 — Hold de checkout et anti-double réservation | BR-BOOK-08, BR-BOOK-10, BR-BOOK-11, BR-PAY-01 | EC-51 | — | UXQ-09 |
| BKG-016 | P0-A | BKG-016 — Lieux de prise et de retour | BR-BOOK-09 | — | — | — |
| BKG-018 | P0-A | BKG-018 — Contrat de location par trip | BR-BOOK-12, BR-CSP-02, BR-FUEL-01, BR-GEO-02, BR-RETURN-03, BR-TT-03 | — | — | OQ-BR-24 |
| BKG-019 | P0-A | BKG-019 — Signature électronique horodatée du contrat | BR-BOOK-12, BR-CXL-08 | — | — | — |
| BKG-022 | P0-A | BKG-022 — Écran et notification de confirmation | BR-BOOK-01, BR-NOTIF | — | — | — |
| BKG-023 | P0-A | BKG-008 / BKG-023 — Acceptation des conditions et clauses géographiques | BR-ACC-01, BR-BOOK-12, BR-GEO-01, BR-GEO-02 | EC-45, EC-46, EC-53 | — | — |
| BKG-025 | P0-A | BKG-002 / BKG-025 — Conducteur principal et aptitude boîte manuelle | BR-ACC-02, BR-ACC-04, BR-ACC-08, BR-PICKUP-07, BR-VERIF-08 | — | — | — |
| BKG-027 | P0-A | BKG-027 — Détail du trip (Manage trip) | BR-MOD-01 | — | — | — |
| BKG-028 | P0-A | BKG-028 — Annulation par le guest en libre-service | BR-CXL, BR-CXL-00, BR-CXL-01, BR-CXL-03, BR-CXL-06, BR-CXL-08, BR-CXL-09, BR-CXL-10 | — | T02, T23, T24, T25, TA01, TA02, TA05, TA06 | OQ-BR-30, OQ-BR-38 |
| BKG-032 | P0-A | BKG-032 — Annulation par l'agence avec motif et pénalités | BR-CXL-12, BR-CXL-13, BR-HP-03 | — | T07, T08, T14, T15, T26, T62, TA04 | OQ-BR-24, OQ-BR-37 |
| BKG-035 | P0-A | BKG-035 — Annulation par la plateforme | BR-CXL-07, BR-CXL-14, BR-LIST-06, BR-TRUST-05 | — | T16, T17, T18, T19, T20, T22, T61, TA09 | OQ-BR-41 |
| PAY-001 | P0-A | PAY-001 — Abstraction multi-PSP (PaymentProvider) | BR-PAY-01 | EC-29 | — | OQ-PAY-03 |
| PAY-002 | P0-A | PAY-002 / PAY-017 / PAY-018 — Cartes, refus et 3-D Secure | BR-BOOK-10, BR-PAY-01, BR-PAY-11 | EC-26 | — | OQ-PAY-03 |
| PAY-004 | P0-A | PAY-004 — Yappy (et Clave) via le PSP de l'agence | BR-PAY-01, BR-PAY-08 | — | T33, T34 | OQ-PAY-03, OQ-PAY-07, OQ-PAY-22 |
| PAY-006 | P0-A | PAY-006 — Pay now (autorisation puis capture) | BR-CXL, BR-PAY-02 | — | T28, T29, T64, TA10 | — |
| PAY-011 | P0-B | PAY-011 / PAY-012 / PAY-036 — Caution plateforme, libération et fenêtre de rétention | BR-PAY-06, BR-PAY-08, BR-PAY-09 bis, BR-VERIF-09 | EC-27, EC-56 | T57, T58, T59 | OQ-BR-12, OQ-MK-02, OQ-MK-03, OQ-PAY-02, OQ-PAY-04, OQ-PAY-05, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-19, OQ-PAY-21 |
| PAY-012 | P0-B | PAY-011 / PAY-012 / PAY-036 — Caution plateforme, libération et fenêtre de rétention | BR-PAY-06, BR-PAY-08, BR-PAY-09 bis, BR-VERIF-09 | EC-27, EC-56 | T57, T58, T59 | OQ-BR-12, OQ-MK-02, OQ-MK-03, OQ-PAY-02, OQ-PAY-04, OQ-PAY-05, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-19, OQ-PAY-21 |
| PAY-015 | P0-B | PAY-015 / PAY-037 — Carte enregistrée (MIT) et débits post-trip conformes aux réseaux | BR-ACC-10, BR-DAMAGE-08, BR-PAY-09, BR-PAY-09 bis, BR-PAY-10, BR-REIMB-03 | EC-28 | T29, T50, T64, T68 | OQ-BR-12, OQ-MK-02, OQ-MK-03, OQ-PAY-02, OQ-PAY-04, OQ-PAY-05, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21 |
| PAY-017 | P0-A | PAY-002 / PAY-017 / PAY-018 — Cartes, refus et 3-D Secure | BR-BOOK-10, BR-PAY-01, BR-PAY-11 | EC-26 | — | OQ-PAY-03 |
| PAY-018 | P0-A | PAY-002 / PAY-017 / PAY-018 — Cartes, refus et 3-D Secure | BR-BOOK-10, BR-PAY-01, BR-PAY-11 | EC-26 | — | OQ-PAY-03 |
| PAY-019 | P0-A | PAY-019 — Idempotence des opérations de paiement | BR-BOOK-10 | EC-29, EC-54 | T51, T52, T68 | — |
| PAY-021 | P0-A | PAY-021 — Remboursements sur le moyen d'origine | BR-CXL, BR-CXL-01, BR-CXL-06, BR-CXL-12, BR-CXL-14, BR-PAY-08 | EC-49, EC-55 | T01, T05, T14, T15, T49, T50, T66, TA02 | OQ-BR-44, OQ-PAY-07, OQ-PAY-22, UXQ-10, UXQ-11 |
| PRC-001 | P0-A | PRC-001 — Prix journalier fixé par l'agence | BR-PRICE-01, BR-PRICE-14 | — | — | — |
| PRC-012 | P0-B | PRC-012 — Frais de service guest (trip fee) | BR-CXL-06, BR-PRICE-06 | — | T03 | OQ-BR-12, OQ-MK-01, OQ-MK-02, OQ-MK-03, OQ-PAY-02, OQ-PAY-04, OQ-PAY-05, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21 |
| PRC-020 | P0-A | PRC-020 — Moteur de taxes par marché (ITBMS) | BR-CXL-06, BR-PRICE-12, BR-PRICE-14 | — | T43, T44, TA01 | OQ-BR-14, OQ-MK-06 |
| PRC-021 | P0-A | PRC-021 — Arrondis et montants en unités mineures | BR-CXL-06, BR-PRICE-14 | EC-32 | T40, T42, T43, TA06 | — |
| PRC-025 | P0-A | PRC-025 — Moteur de devis versionné | BR-BOOK-03, BR-CXL, BR-MOD-06, BR-PRICE-13, BR-PRICE-17 | — | T01, T27, TA01, TA06, TA07 | OQ-BR-04 |
| TRP-002 | P0-A | TRP-002 — Check-in / check-out mobile | BR-PICKUP-01, BR-PICKUP-02, BR-PICKUP-03, BR-PICKUP-04, BR-PICKUP-06, BR-PICKUP-07 | EC-15 | — | — |
| TRP-004 | P0-A | TRP-004 — Capture in-app avec gabarit d'angles et horodatage serveur | BR-DAMAGE-02, BR-PICKUP-03, BR-RETURN-01 | — | — | — |
| TRP-007 | P0-A | TRP-007 — Refus du véhicule au départ | BR-CSP-03, BR-CXL-04, BR-MOD-08, BR-PICKUP-06 | EC-04 | TA01 | — |
| TRP-015 | P0-A | TRP-015 — Déclaration de no-show guest par l'agence | BR-CXL-08, BR-CXL-09, BR-CXL-15, BR-PICKUP-04 | EC-01 | T05, T06, T38, T39, TA03, TA11 | OQ-BR-24, OQ-BR-33, OQ-BR-45, OQ-MK-06 |
| TRP-033 | P0-A | TRP-033 — Check-out avec photos de retour | BR-FUEL-01, BR-MILEAGE-03, BR-RETURN-01, BR-RETURN-02, BR-RETURN-07 | — | — | — |
| TRP-035 | P0-A | TRP-035 — Détection automatique du retard et grille de frais | BR-BOOK-05, BR-CXL-00, BR-RETURN-03 | EC-17, EC-18, EC-19 | — | OQ-BR-04, OQ-BR-39 |
| TRP-038 | P0-A | TRP-038 — Procédure de non-restitution graduée | BR-DAMAGE-10, BR-RETURN-04, BR-TRUST-05 | EC-20 | — | OQ-BR-17 |
| TRP-045 | P0-A | TRP-045 — Machine à états du trip | BR-CXL, BR-CXL-08, BR-MOD, BR-PICKUP-01, BR-RETURN, BR-RETURN-03, BR-RETURN-04 | EC-54 | T05, T06, T25 | — |
| MSG-001 | P0-A | MSG-001 / MSG-007 — Messagerie par trip et détection du marché gris | BR-BOOK-02, BR-TRUST-02, BR-TRUST-06 | EC-40 | — | — |
| MSG-007 | P0-A | MSG-001 / MSG-007 — Messagerie par trip et détection du marché gris | BR-BOOK-02, BR-TRUST-02, BR-TRUST-06 | EC-40 | — | — |
| NTF-001 | P0-A | NTF-001 — Moteur de notifications multicanal | BR-NOTIF | — | — | — |
| NTF-002 | P0-A | NTF-002 — Gabarits WhatsApp Business approuvés | BR-NOTIF | — | — | — |
| NTF-007 | P0-A | NTF-007 / NTF-011 — Confirmation de réservation et notifications de trip | BR-BOOK-01, BR-NOTIF, BR-PICKUP-01, BR-PICKUP-09 | — | — | — |
| NTF-011 | P0-A | NTF-007 / NTF-011 — Confirmation de réservation et notifications de trip | BR-BOOK-01, BR-NOTIF, BR-PICKUP-01, BR-PICKUP-09 | — | — | — |
| REV-001 | P0-A | REV-001 / REV-010 — Avis du guest et agrégats | BR-REVIEW-01, BR-REVIEW-03, BR-REVIEW-04, BR-REVIEW-05, BR-REVIEW-07 | — | — | — |
| REV-010 | P0-A | REV-001 / REV-010 — Avis du guest et agrégats | BR-REVIEW-01, BR-REVIEW-03, BR-REVIEW-04, BR-REVIEW-05, BR-REVIEW-07 | — | — | — |
| HST-005 | P0-A | HST-005 — Wizard d'annonce | BR-LIST-04 | — | — | — |
| HST-011 | P0-A | HST-011 — Détails du véhicule | BR-ACC-05, BR-LIST-04, BR-PICKUP-11 | — | — | — |
| HST-012 | P0-A | HST-012 — Photos d'annonce | BR-LIST-05 | — | — | — |
| HST-016 | P0-A | HST-016 / HST-026 — Soumission, revue et cycle de vie de l'annonce | BR-LIST-01, BR-LIST-06, BR-LIST-08, BR-LIST-09 | EC-37 | — | OQ-BR-29 |
| HST-019 | P0-A | HST-019 — Éligibilité du véhicule | BR-LIST-02, BR-LIST-03, BR-LIST-06, BR-LIST-07 | — | — | — |
| HST-026 | P0-A | HST-016 / HST-026 — Soumission, revue et cycle de vie de l'annonce | BR-LIST-01, BR-LIST-06, BR-LIST-08, BR-LIST-09 | EC-37 | — | OQ-BR-29 |
| HST-033 | P0-A | HST-033 — Configuration de la distance incluse | BR-MILEAGE-01, BR-MILEAGE-02, BR-MILEAGE-04, BR-PRICE-17 | — | — | — |
| HST-039 | P0-A | HST-039 — Documents du véhicule et attestation d'assurance | BR-PICKUP-06, BR-PROT-10 | — | — | — |
| CAL-001 | P0-A | CAL-001 / CAL-002 — Calendrier par véhicule et blocages | BR-BOOK-07 | — | — | — |
| CAL-002 | P0-A | CAL-001 / CAL-002 — Calendrier par véhicule et blocages | BR-BOOK-07 | — | — | — |
| CAL-003 | P0-A | CAL-003 / CAL-004 — Préavis minimum et tampon entre trips | BR-BOOK-04, BR-BOOK-05, BR-BOOK-06 | EC-19 | — | — |
| CAL-004 | P0-A | CAL-003 / CAL-004 — Préavis minimum et tampon entre trips | BR-BOOK-04, BR-BOOK-05, BR-BOOK-06 | EC-19 | — | — |
| CAL-009 | P0-A | CAL-009 — Synchronisation iCal entrante et sortante | BR-BOOK-07, BR-BOOK-10 | — | — | — |
| CAL-011 | P0-A | CAL-011 — Table d'occupation unique | BR-BOOK-05, BR-BOOK-07, BR-BOOK-10 | EC-51 | — | — |
| HDB-001 | P0-A | HDB-001 / HDB-002 — Tableau de bord et liste des trips de l'agence | BR-COHOST-02 | — | — | — |
| HDB-002 | P0-A | HDB-001 / HDB-002 — Tableau de bord et liste des trips de l'agence | BR-COHOST-02 | — | — | — |
| PYO-001 | P0-B | PYO-001 / PYO-002 — Compte de versement et versements ACH aux sociétés | BR-PAYOUT-01, BR-PAYOUT-02, BR-PAYOUT-04 | — | — | OQ-BR-12, OQ-MK-02, OQ-MK-03, OQ-PAY-02, OQ-PAY-04, OQ-PAY-05, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21 |
| PYO-002 | P0-B | PYO-001 / PYO-002 — Compte de versement et versements ACH aux sociétés | BR-PAYOUT-01, BR-PAYOUT-02, BR-PAYOUT-04 | — | — | OQ-BR-12, OQ-MK-02, OQ-MK-03, OQ-PAY-02, OQ-PAY-04, OQ-PAY-05, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21 |
| PYO-007 | P0-B | PYO-007 — Grand livre agence, compensations et solde négatif | BR-PAY-11, BR-PAYOUT-04 | — | T53, T54, T55 | OQ-BR-12, OQ-MK-02, OQ-MK-03, OQ-PAY-02, OQ-PAY-04, OQ-PAY-05, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21 |
| PYO-013 | P0-A | FIN-018 / PYO-013 — Facturation de la commission et relevé mensuel | BR-CXL-13, BR-PAYOUT-05, BR-PRICE-12, BR-PRICE-14 | — | TA02, TA08 | OQ-MK-06, OQ-MK-07 |
| FLT-001 | P0-A | FLT-001 / FLT-003 — Équipes de l'agence et rôles | BR-COHOST-01, BR-COHOST-02 | — | — | — |
| FLT-003 | P0-A | FLT-001 / FLT-003 — Équipes de l'agence et rôles | BR-COHOST-01, BR-COHOST-02 | — | — | — |
| HST-050 | P0-A | HST-050 — Catalogue de référence des véhicules | BR-LIST-04 | — | — | OQ-CAT-01 |
| ADM-036 | P0-A | ADM-036 — File d'ajout au catalogue véhicules | — | — | — | — |
| FLT-011 | P0-A | FLT-011 — Import en masse d'annonces | BR-LIST-04 | — | — | — |
| CLM-001 | P0-A | CLM-001 / CLM-002 — Déclarations de dommage (agence) et d'incident (guest) | BR-DAMAGE-01, BR-DAMAGE-02, BR-DAMAGE-10, BR-PROT-05 | EC-12, EC-13 | — | — |
| CLM-002 | P0-A | CLM-001 / CLM-002 — Déclarations de dommage (agence) et d'incident (guest) | BR-DAMAGE-01, BR-DAMAGE-02, BR-DAMAGE-10, BR-PROT-05 | EC-12, EC-13 | — | — |
| CLM-006 | P0-A | CLM-006 — Instruction d'un dossier plateforme | BR-DAMAGE-02, BR-DAMAGE-03, BR-DAMAGE-04, BR-DAMAGE-06, BR-DAMAGE-11, BR-REIMB-03 | EC-41, EC-47, EC-56 | — | OQ-BR-24 |
| CLM-021 | P0-B | CLM-021 — Paiement ou contestation par le guest | BR-PAY-10, BR-REIMB-01, BR-REIMB-02, BR-REIMB-03 | — | — | OQ-BR-12, OQ-MK-02, OQ-MK-03, OQ-PAY-02, OQ-PAY-04, OQ-PAY-05, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21 |
| PRT-003 | P0-A | PRT-003 / PRT-013 — RC tiers incluse et mentions de l'assureur | BR-PROT-01, BR-PROT-04 | — | — | OQ-BR-16 |
| PRT-009 | P0-A | PRT-009 — Mode « police flotte du loueur » | BR-PROT-01, BR-PROT-03, BR-PROT-04, BR-PROT-06 | EC-47 | — | OQ-BR-16, OQ-MK-05 |
| PRT-013 | P0-A | PRT-003 / PRT-013 — RC tiers incluse et mentions de l'assureur | BR-PROT-01, BR-PROT-04 | — | — | OQ-BR-16 |
| SUP-004 | P0-A | SUP-004 / SUP-011 — Ligne d'urgence, support en horaires étendus, bilingue | BR-PROT-05 | — | — | — |
| SUP-011 | P0-A | SUP-004 / SUP-011 — Ligne d'urgence, support en horaires étendus, bilingue | BR-PROT-05 | — | — | — |
| ADM-001 | P0-A | ADM-001 — Console admin avec RBAC, 2FA et journal d'audit | BR-TRUST-05 | — | — | OQ-BR-25 |
| ADM-002 | P0-A | ADM-002 / ADM-003 — Files de revue KYC et annonces | BR-LIST-08, BR-VERIF-04 | — | — | — |
| ADM-003 | P0-A | ADM-002 / ADM-003 — Files de revue KYC et annonces | BR-LIST-08, BR-VERIF-04 | — | — | — |
| ADM-004 | P0-A | ADM-004 — Onboarding et KYB des loueurs | BR-ACC-06, BR-LIST-01 | — | — | — |
| ADM-005 | P0-A | ADM-005 — Fiche utilisateur 360° | BR-ACC-10, BR-TRUST-05 | — | — | — |
| ADM-006 | P0-A | ADM-006 — Gestion des trips par les agents | BR-CXL-14, BR-MOD-04, BR-MOD-08, BR-TRUST-05 | — | T37, T65 | OQ-BR-46 |
| ADM-007 | P0-A | ADM-007 — Remboursements, gestes commerciaux et crédits | BR-PAY-07, BR-PAY-08 | — | TA09 | — |
| ADM-008 | P0-A | ADM-008 — Arbitrage des litiges et factures contestées | BR-CXL, BR-DAMAGE-04, BR-REIMB-03 | — | T36, T49, T50, T67 | — |
| ADM-014 | P0-A | ADM-014 / ADM-031 — Paramétrage par pays et paramètres Panama par défaut | BR-ACC-04, BR-CXL-00, BR-CXL-01, BR-CXL-13, BR-RETURN-03 | — | T61 | OQ-BR-04, OQ-BR-14, OQ-BR-30, OQ-BR-33, OQ-BR-41, OQ-MK-07 |
| ADM-022 | P0-A | ADM-022 — Tableau ops des véhicules en retard / non restitués | BR-RETURN-04 | EC-20 | — | — |
| ADM-029 | P0-A | ADM-029 — File de revue des réservations à risque | BR-CXL-07, BR-TRUST-01, BR-VERIF-09 | EC-43 | T61 | OQ-BR-41, UXQ-08, UXQ-12 |
| FIN-001 | P0-A | FIN-001 — Grand livre en partie double | BR-PAYOUT-04, BR-PRICE-14 | — | T36, TA08 | OQ-MK-06 |
| FIN-002 | P0-A | FIN-002 / FIN-003 — Facturation électronique : port fiscal PAC (Panama) et SIFEN (Paraguay) | BR-PAYOUT-05, BR-PRICE-12 | — | — | OQ-BR-14, OQ-MK-06 |
| FIN-004 | P0-B | FIN-004 — Collecte et reversement de l'ITBMS | BR-CXL-06, BR-PRICE-12 | — | T44 | OQ-BR-12, OQ-BR-14, OQ-MK-02, OQ-MK-03, OQ-MK-06, OQ-PAY-02, OQ-PAY-04, OQ-PAY-05, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21 |
| FIN-005 | P0-B | FIN-005 — Rapprochement PSP et banques | — | — | — | OQ-BR-12, OQ-MK-02, OQ-MK-03, OQ-PAY-02, OQ-PAY-04, OQ-PAY-05, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21 |
| I18N-003 | P0-A | I18N-003 / I18N-004 / I18N-005 — Espagnol et anglais, devises USD et PYG | BR-CXL-00, BR-PRICE-14 | — | T48, T62, TA01 | — |
| I18N-004 | P0-A | I18N-003 / I18N-004 / I18N-005 — Espagnol et anglais, devises USD et PYG | BR-CXL-00, BR-PRICE-14 | — | T48, T62, TA01 | — |
| LEG-001 | P0-A | LEG-001 / LEG-002 — CGU et consentements horodatés et versionnés | BR-ACC-01 | — | — | — |
| LEG-002 | P0-A | LEG-001 / LEG-002 — CGU et consentements horodatés et versionnés | BR-ACC-01 | — | — | — |
| LEG-009 | P0-A | LEG-009 / LEG-010 — Rétention, pseudonymisation, registre Ley 81 | BR-ACC-09, BR-VERIF-01 | — | — | OQ-BR-25, OQ-MK-09, UXQ-11 |
| LEG-010 | P0-A | LEG-009 / LEG-010 — Rétention, pseudonymisation, registre Ley 81 | BR-ACC-09, BR-VERIF-01 | — | — | OQ-BR-25, OQ-MK-09, UXQ-11 |
| LEG-011 | P0-A | LEG-011 / LEG-015 — Centre légal, litiges et droit applicable | BR-ACC-01, BR-CXL | — | — | OQ-BR-24 |
| LEG-014 | P0-A | LEG-014 — Positionnement d'intermédiaire | — | — | — | OQ-MK-01 |
| LEG-015 | P0-A | LEG-011 / LEG-015 — Centre légal, litiges et droit applicable | BR-ACC-01, BR-CXL | — | — | OQ-BR-24 |
| LEG-020 | P0-A | LEG-020 — Mandat de l'agence à la plateforme | BR-PROT-10 | — | — | — |
| LEG-024 | P0-A | LEG-024 — Preuves et décisions motivées (pratique ACODECO) | BR-PAY-06, BR-REIMB-03 | — | — | OQ-BR-24 |
| PAY-033 | P0-A | PAY-033 — Mode « agence encaisse » | BR-BOOK-10, BR-CXL, BR-PAY-01, BR-TRUST-02 | — | — | OQ-MK-01, OQ-MK-02, OQ-PAY-03, UXQ-08, UXQ-09 |
| FIN-018 | P0-A | FIN-018 / PYO-013 — Facturation de la commission et relevé mensuel | BR-CXL-13, BR-PAYOUT-05, BR-PRICE-12, BR-PRICE-14 | — | TA02, TA08 | OQ-BR-14, OQ-MK-06, OQ-MK-07 |
| FIN-019 | P0-A | FIN-019 — Rapprochement léger des revenus | BR-TRUST-02 | — | — | — |
| LEG-025 | P0-A | LEG-025 — Contrat-cadre plateforme–loueur | BR-BOOK-13, BR-LIST-01, BR-TRUST-02 | — | — | OQ-BR-24, OQ-MK-01 |
| PRT-019 | P0-A | PRT-019 — Dépôt et contrôle de la police flotte | BR-LIST-01, BR-PROT-01, BR-PROT-04, BR-PROT-10 | — | — | OQ-MK-05 |
| LEG-026 | P0-A | LEG-026 — Constancia de arrendamiento | BR-TT-03 | EC-48 | — | OQ-BR-19 |
| LEG-027 | P0-A | LEG-027 — Mandat écrit limité pour les opérations PSP | BR-CXL, BR-PAY-08 | — | — | OQ-BR-24, OQ-MK-01, OQ-MK-02, OQ-PAY-03 |
| TRP-052 | P0-A | TRP-052 — Interface agent comptoir | BR-PICKUP-01, BR-PICKUP-04, BR-PICKUP-05 | — | — | — |
| ADM-031 | P0-A | ADM-014 / ADM-031 — Paramétrage par pays et paramètres Panama par défaut | BR-ACC-04, BR-CXL-00, BR-CXL-01, BR-CXL-13, BR-RETURN-03 | — | T61 | OQ-BR-04, OQ-BR-14, OQ-BR-30, OQ-BR-33, OQ-BR-41, OQ-MK-07 |
| CLM-034 | P0-A | CLM-034 — Dossier de preuve exportable par trip | BR-DAMAGE-02, BR-DAMAGE-04, BR-PAY-11 | — | — | — |
| PAY-034 | P0-A | PAY-034 — Preuve de paiement non réversible avant remise des clés | BR-BOOK-10, BR-PAY-01, BR-TRUST-02 | — | — | — |
| PAY-035 | P0-A | PAY-035 — Politique de caution de l'agence et options sans carte de crédit | BR-PAY-06, BR-VERIF-09 | — | — | OQ-PAY-06, UXQ-02 |
| ADM-032 | P0-A | ADM-032 / ADM-035 — Sauvegardes, monitoring, journal d'accès ; RPO/RTO et reprise | BR-ACC-09 | — | — | OQ-MK-09 |
| ADM-033 | P0-A | ADM-033 — Revue de sécurité avant ouverture | — | — | — | — |
| ADM-034 | P0-A | ADM-034 — Préproduction et déploiement réversible | — | — | — | — |
| ADM-035 | P0-A | ADM-032 / ADM-035 — Sauvegardes, monitoring, journal d'accès ; RPO/RTO et reprise | BR-ACC-09 | — | — | OQ-MK-09 |
| PAY-036 | P0-B | PAY-011 / PAY-012 / PAY-036 — Caution plateforme, libération et fenêtre de rétention | BR-PAY-06, BR-PAY-08, BR-PAY-09 bis, BR-VERIF-09 | EC-27, EC-56 | T57, T58, T59 | OQ-BR-12, OQ-MK-02, OQ-MK-03, OQ-PAY-02, OQ-PAY-04, OQ-PAY-05, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-19, OQ-PAY-21 |
| PAY-037 | P0-B | PAY-015 / PAY-037 — Carte enregistrée (MIT) et débits post-trip conformes aux réseaux | BR-ACC-10, BR-DAMAGE-08, BR-PAY-09, BR-PAY-09 bis, BR-PAY-10, BR-REIMB-03 | EC-28 | T29, T50, T64, T68 | OQ-BR-12, OQ-BR-43, OQ-MK-02, OQ-MK-03, OQ-PAY-02, OQ-PAY-04, OQ-PAY-05, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21 |
| PAY-038 | P0-B | PAY-038 — Split de la commission à la source | BR-PAYOUT-05 | — | TA08 | OQ-BR-12, OQ-MK-02, OQ-MK-03, OQ-PAY-02, OQ-PAY-03, OQ-PAY-04, OQ-PAY-05, OQ-PAY-13, OQ-PAY-15, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21 |
| PAY-041 | P0-A | PAY-041 — Porte de validation du PSP du pays de lancement et PSP de secours | — | — | — | OQ-PAY-03, OQ-PAY-08, OQ-PAY-10, OQ-PAY-12, OQ-PAY-22 |
| SUP-020 | P0-A | SUP-020 — Plan de dotation du support et de l'exploitation | — | — | — | — |
| TRP-056 | P0-A | TRP-056 — Évaluation du risque PWA sur iOS | BR-PICKUP-01, BR-PICKUP-03 | — | — | — |
| TRP-057 | P0-A | TRP-057 — Mode hors ligne du check-in / check-out | BR-PICKUP-03, BR-RETURN-01 | — | — | — |
| FIN-003 | P0-A | FIN-002 / FIN-003 — Facturation électronique : port fiscal PAC (Panama) et SIFEN (Paraguay) | BR-PAYOUT-05, BR-PRICE-12 | — | — | OQ-BR-14, OQ-MK-06 |
| I18N-005 | P0-A | I18N-003 / I18N-004 / I18N-005 — Espagnol et anglais, devises USD et PYG | BR-CXL-00, BR-PRICE-14 | — | T48, T62, TA01 | — |
| DSN-001 | P0-A | DSN-001 / DSN-002 / DSN-005 / DSN-006 / DSN-007 — Fondations design : identité, tokens, bibliothèque, PWA et revue | — | — | — | — |
| DSN-002 | P0-A | DSN-001 / DSN-002 / DSN-005 / DSN-006 / DSN-007 — Fondations design : identité, tokens, bibliothèque, PWA et revue | — | — | — | — |
| DSN-005 | P0-A | DSN-001 / DSN-002 / DSN-005 / DSN-006 / DSN-007 — Fondations design : identité, tokens, bibliothèque, PWA et revue | — | — | — | — |
| DSN-006 | P0-A | DSN-001 / DSN-002 / DSN-005 / DSN-006 / DSN-007 — Fondations design : identité, tokens, bibliothèque, PWA et revue | — | — | — | — |
| DSN-007 | P0-A | DSN-001 / DSN-002 / DSN-005 / DSN-006 / DSN-007 — Fondations design : identité, tokens, bibliothèque, PWA et revue | — | — | — | — |
| DSN-003 | P0-A | DSN-003 / DSN-004 — Back-office « Apparence / Marque » et blocs de contenu éditables | — | — | — | — |
| DSN-004 | P0-A | DSN-003 / DSN-004 — Back-office « Apparence / Marque » et blocs de contenu éditables | — | — | — | — |
| PLT-001 | P0-A | PLT-001 / PLT-002 / PLT-003 — Transmissibilité : IaC, portabilité, comptes au nom du fondateur, documentation et passation | — | — | — | — |
| PLT-002 | P0-A | PLT-001 / PLT-002 / PLT-003 — Transmissibilité : IaC, portabilité, comptes au nom du fondateur, documentation et passation | — | — | — | — |
| PLT-003 | P0-A | PLT-001 / PLT-002 / PLT-003 — Transmissibilité : IaC, portabilité, comptes au nom du fondateur, documentation et passation | — | — | — | — |
| PLT-004 | P0-A | PLT-004 / PLT-005 — Qualité et gouvernance multi-agents : stratégie de tests, portes CI, artefacts et revues | — | — | T01, T68, TA01, TA11 | — |
| PLT-005 | P0-A | PLT-004 / PLT-005 — Qualité et gouvernance multi-agents : stratégie de tests, portes CI, artefacts et revues | — | — | T01, T68, TA01, TA11 | — |
| PAY-042 | P0-A | PAY-042 / FIN-020 / VER-029 — Connecteurs réels du pays de lancement (PSP, facture électronique, KYC) | BR-PAY-01, BR-PRICE-12, BR-VERIF-01 | — | — | — |
| FIN-020 | P0-A | PAY-042 / FIN-020 / VER-029 — Connecteurs réels du pays de lancement (PSP, facture électronique, KYC) | BR-PAY-01, BR-PRICE-12, BR-VERIF-01 | — | — | — |
| VER-029 | P0-A | PAY-042 / FIN-020 / VER-029 — Connecteurs réels du pays de lancement (PSP, facture électronique, KYC) | BR-PAY-01, BR-PRICE-12, BR-VERIF-01 | — | — | — |

## D.2 Fiches bloquées ou en mode dégradé par des questions ouvertes

Une fiche « bloquée » ne doit pas être livrée dans sa version définitive avant la réponse ; le mode dégradé indiqué est celui des fiches (jamais une décision prise à la place du fondateur ou de l'avocat). Toutes les fiches du lot 2 dépendent en outre de l'avis définitif OQ-MK-01 / OQ-MK-02 (lecture b) (porte G1b) et celles du lot 1 de l'avis préliminaire (G1a), **pour leur mise en service** et non pour leur build (DEC-FONDATEUR-02).

| feature_id | Questions ouvertes | Effet / mode dégradé |
|---|---|---|
| VER-001 | OQ-MK-09 | KYC en production bloqué tant que registre et transferts Ley 81 non validés |
| VER-002 | OQ-MK-09 | biométrie : idem VER-001 |
| VER-003 | OQ-MK-09 | biométrie : idem VER-001 |
| VER-004 | OQ-BR-25, OQ-MK-09 | durée de conservation provisoire (≤ 3 ans) |
| VER-005 | OQ-MK-09 | pièces d'identité transmises au fournisseur hors Panama |
| VER-006 | OQ-BR-21 | liste des permis : IDP et permis non latins non tranchés |
| VER-007 | OQ-BR-21, UXQ-03, UXQ-08 | mode signalement (FLAG) ; refus automatique interdit avant avis ; idem ADM-029 ; champs statut / date d'entrée au checkout si le fournisseur KYC ne peut pas les collecter (consolidé VERIF_15) |
| LST-010 | OQ-BR-30 | seuil dernière minute 24/25 h |
| LST-013 | OQ-MK-05 | texte de la police |
| BKG-018 | OQ-BR-24 | modèle de contrat validé par l'avocat |
| BKG-028 | OQ-BR-30, OQ-BR-38 | seuil dernière minute ; lignes annexes |
| BKG-032 | OQ-BR-37, OQ-BR-24 | portée des exemptions ; pénalités forfaitaires |
| BKG-035 | OQ-BR-41 (DEC-FONDATEUR-01) | compensation agence par la plateforme : défaut 0 (T61) ; tests T17/T18/T20 désactivés |
| PAY-001 | OQ-PAY-03 ; — (DEC-FONDATEUR-03, décision prise) | accord du PSP sur l'usage des identifiants API ; adaptateur `FAKE` seulement jusqu'au choix du pays (consolidé VERIF_15) |
| PAY-004 | OQ-PAY-03, OQ-PAY-07, OQ-PAY-22 | Clave et remboursement Yappy |
| PAY-011 | OQ-MK-02, OQ-MK-03, OQ-PAY-05, OQ-PAY-02, OQ-PAY-04, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21, OQ-BR-12 | porte G2 : aucun build avant avis et validation PSP |
| PAY-012 | OQ-MK-02, OQ-MK-03, OQ-PAY-05, OQ-PAY-02, OQ-PAY-04, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21, OQ-BR-12 | porte G2 : aucun build avant avis et validation PSP |
| PAY-015 | OQ-MK-02, OQ-MK-03, OQ-PAY-05, OQ-PAY-02, OQ-PAY-04, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21, OQ-BR-12 | porte G2 : aucun build avant avis et validation PSP |
| PAY-018 | OQ-PAY-03 | disponibilité 3DS par PSP |
| PAY-021 | OQ-BR-44, OQ-PAY-07, OQ-PAY-22, UXQ-10, UXQ-11 | remboursement Yappy par virement de l'agence ; échéance contractuelle hors Yappy à fixer ; responsable des coordonnées bancaires du guest (consolidé VERIF_15) |
| PRC-012 | OQ-MK-02, OQ-MK-03, OQ-PAY-05, OQ-PAY-02, OQ-PAY-04, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21, OQ-BR-12, OQ-MK-01 | porte G2 : aucun build avant avis et validation PSP |
| PRC-020 | OQ-BR-14, OQ-MK-06 | assiette ITBMS (loyer seul en bêta) |
| PRC-025 | OQ-BR-04 (décision fondateur) | tolérance de jour facturé paramétrée (29 min provisoire) |
| TRP-015 | OQ-BR-33, OQ-BR-45 | grâce no-show 60 min ; retenue si agence inéligible ; P0-A : défaut `REFUND_GUEST` (fail-closed), alternatives `PROTOCOL_PENALTY` / `AGENCY_KEEPS` (TA11) (consolidé VERIF_15) |
| TRP-035 | OQ-BR-04 (décision fondateur), OQ-BR-39 | grâce de retard et frontière retard/extension paramétrées |
| TRP-038 | OQ-BR-17 | récupération du véhicule par la plateforme exclue |
| HST-026 | OQ-BR-29 | retrait d'annonce avec trips futurs |
| PYO-001 | OQ-MK-02, OQ-MK-03, OQ-PAY-05, OQ-PAY-02, OQ-PAY-04, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21, OQ-BR-12 | porte G2 : aucun build avant avis et validation PSP |
| PYO-002 | OQ-MK-02, OQ-MK-03, OQ-PAY-05, OQ-PAY-02, OQ-PAY-04, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21, OQ-BR-12 | porte G2 : aucun build avant avis et validation PSP |
| PYO-007 | OQ-MK-02, OQ-MK-03, OQ-PAY-05, OQ-PAY-02, OQ-PAY-04, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21, OQ-BR-12 | porte G2 : aucun build avant avis et validation PSP |
| PYO-013 | OQ-MK-06 | mentions fiscales du relevé |
| CLM-006 | OQ-BR-24 | « décision définitive » non utilisée |
| CLM-021 | OQ-MK-02, OQ-MK-03, OQ-PAY-05, OQ-PAY-02, OQ-PAY-04, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21, OQ-BR-12, OQ-PAY-18 | porte G2 : aucun build avant avis et validation PSP |
| PRT-003 | OQ-BR-16 | pas de RC plateforme en P0 |
| PRT-009 | OQ-MK-05 | idem |
| ADM-006 | OQ-BR-46 | jour minimum en fin anticipée |
| ADM-014 | OQ-BR-41 (DEC-FONDATEUR-01) | clé platform_funded_host_compensation absente = false |
| ADM-029 | OQ-BR-41, UXQ-08, UXQ-12 | annulation PLATFORM_REVIEW_DELAY : compensation agence défaut 0 ; moment du paiement d'une réservation signalée ; refus après paiement en Bêta (remboursement par l'agence) (consolidé VERIF_15) |
| FIN-002 | OQ-MK-06, OQ-BR-14 | entité qui facture, PAC |
| FIN-004 | OQ-MK-02, OQ-MK-03, OQ-PAY-05, OQ-PAY-02, OQ-PAY-04, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21, OQ-BR-12, OQ-BR-14, OQ-MK-06 | porte G2 : aucun build avant avis et validation PSP |
| FIN-005 | OQ-MK-02, OQ-MK-03, OQ-PAY-05, OQ-PAY-02, OQ-PAY-04, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21, OQ-BR-12 | porte G2 : aucun build avant avis et validation PSP |
| LEG-009 | OQ-BR-25 | durées prudentes en attendant |
| LEG-010 | OQ-MK-09, UXQ-11 | registre et délais de notification à valider par l'avocat ; finalité « remboursement par virement » : responsable à désigner (consolidé VERIF_15) |
| LEG-014 | OQ-MK-01 | formulation soumise à l'avis art. 288 |
| LEG-015 | OQ-BR-24 | pas de clause « définitive » ni d'arbitrage |
| LEG-024 | OQ-BR-24 | Ley 45/2007 à vérifier |
| PAY-033 | OQ-MK-01, OQ-MK-02, OQ-PAY-03, UXQ-08, UXQ-09 | mode (a) API interdit avant mandat, accord PSP et porte PAY-041 ; hold `AGENCY_LINK` paramétré ; revue avant émission du lien si UXQ-08 retient l'option 10b (consolidé VERIF_15) |
| FIN-018 | OQ-MK-07, OQ-MK-06, OQ-BR-14 | taux de commission et fiscalité de la commission |
| LEG-025 | OQ-MK-01, OQ-BR-24 | texte du contrat-cadre |
| PRT-019 | OQ-MK-05 | aucune annonce sans attestation « plateforme » |
| LEG-026 | OQ-BR-19 | transfert d'amende au conducteur (P1) |
| LEG-027 | OQ-PAY-03, OQ-MK-01, OQ-MK-02, OQ-BR-24 | texte du mandat par l'avocat |
| ADM-031 | OQ-BR-04, OQ-BR-41 (DEC-FONDATEUR-01), OQ-BR-30, OQ-BR-33, OQ-BR-14, OQ-MK-07 | valeurs À DÉCIDER au jalon J-ADM-031 |
| PAY-035 | OQ-PAY-06, UXQ-02 | option « Yappy/virement restitué » suspendue ; liste « couvre / ne couvre pas » déclarée par chaque agence pilote ; sans elle, aucune promesse affichée (consolidé VERIF_15) |
| PAY-036 | OQ-MK-02, OQ-MK-03, OQ-PAY-05, OQ-PAY-02, OQ-PAY-04, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21, OQ-BR-12, OQ-PAY-19 | porte G2 : aucun build avant avis et validation PSP |
| PAY-037 | OQ-MK-02, OQ-MK-03, OQ-PAY-05, OQ-PAY-02, OQ-PAY-04, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21, OQ-BR-12, OQ-BR-43 | porte G2 : aucun build avant avis et validation PSP |
| PAY-038 | OQ-MK-02, OQ-MK-03, OQ-PAY-05, OQ-PAY-02, OQ-PAY-04, OQ-PAY-13, OQ-PAY-17, OQ-PAY-18, OQ-PAY-21, OQ-BR-12, OQ-PAY-03, OQ-PAY-15 | porte G2 : aucun build avant avis et validation PSP |
| PAY-041 | OQ-PAY-03, OQ-PAY-22 | porte à décider après le choix du pays de lancement, avant la mise en service (lot C) |
| BKG-014 | UXQ-09 | TTL du hold `AGENCY_LINK` = paramètre `agency_link_hold_minutes` PROPOSÉ 120 (ADR-025) ; construit, valeur à confirmer (consolidé VERIF_15) |
| BKG-012 | UXQ-08 | option « lien de paiement après la décision de l'ops » ou « paiement puis revue » : les deux branches paramétrées (consolidé VERIF_15) |

Total : **60** lignes P0 concernées (dont 13 P0-B bloquées en bloc par la porte G2). Décisions fondateur explicitement laissées ouvertes : **DEC-FONDATEUR-01** (OQ-BR-41) et **OQ-BR-04** ; décisions produit ouvertes et paramétrées : UXQ-08, UXQ-09 (ADR-025), OQ-BR-45 (P0-A). Décisions prises le 2026-10-30 : DEC-FONDATEUR-02 (avis juridiques avant l'ouverture, plus avant le build) et DEC-FONDATEUR-03 (PSP réel après le choix du pays). Questions UX de 10b v2 (UXQ-xx) ajoutées à cette table par la version 2 (consolidé VERIF_15-F2).


## D.3 Contrôle automatique de couverture (2026-10-30, version 4 : sortie de la passe VERIF_18)

Scripts **versionnés** (consolidé VERIF_15-F10) : `python -I tools/check_prd_structure.py` (couverture, 24 rubriques, Given/When/Then, partie C, existence de chaque identifiant cité — feature_id, BR, SM, EC, T, TA, OQ, UXQ, écrans 10b, ADR, DEC —, absence des noms de la version 1, régénération de D.1) et `python -I tools/check_ta_consolidation.py` (recalcul de TA10 et TA11 à partir du texte des règles, comparaison avec A.8.1). Sorties :

```
P0 dans 04 : 179 ; fiches : 134 ; feature_id couverts : 179 ; manquants : [] ; doublons : [] ; hors P0 : []
Fiches au format incomplet ou désordonné (24 rubriques) : []
Critères Given/When/Then déséquilibrés : []
Lignes P1-P3 : 497 ; absentes de la partie C : 0
BR : 131 distincts cités ; inconnus : []
SM : 10 distincts cités ; inconnus : []
EC : 32 distincts cités ; inconnus : []
T : 50 distincts cités ; inconnus : []
TA : 11 distincts cités ; inconnus : []
OQ : 52 distincts cités ; inconnus : []
UXQ : 7 distincts cités ; inconnus : []
écran : 31 distincts cités ; inconnus : []
ADR : 17 distincts cités ; inconnus : []
DEC : 10 distincts cités ; inconnus : []
feature_id cités inconnus de 04 : []
Noms de la version 1 encore présents : {}
D.1 : 179 lignes ; écarts avec la régénération : []
Fiches avec rubrique Source citant les écrans 10b : 134/134
RÉSULTAT : OK
---
  OK  AGENCY_KEEPS commission: 9,60 (attendu 9,60)
Comparaison avec le texte de 16 A.8.1
  OK  TA10 : montants écrits ['0,00', '128,40', '2,80', '4,80', '40,00', '42,80', '85,60']
  OK  TA11 : montants écrits ['0,00', '128,40', '2,80', '42,80', '8,40', '80,00', '85,60', '9,60']
  TA10 cité 7 fois dans le PRD
  TA11 cité 10 fois dans le PRD
  08 cite « 16 TA11 » : oui
RÉSULTAT : OK
```

Limites connues : les clés de gabarit `EVT_…` restent des noms de ce PRD (17 n'a pas de catalogue de gabarits ; correspondance en A.8.2) ; une partie des noms de données descriptifs n'a pas d'équivalent exact dans 17 (A.8.2) ; 18 n'a pas été modifié par cette passe (portes juridiques et ordre des lots à relire à la lumière de DEC-FONDATEUR-02, -03 et -04) ; les vecteurs TA01–TA11 restent PROPOSÉS ; audit indépendant de cette version 2 à prévoir (règle de la mission).

## D.4 Journal de consolidation — VERIF_15, 10b v2, 17 v2 (2026-10-30)

| Constat | Gravité | Correction | Emplacement | Statut |
|---|---|---|---|---|
| F1 | MAJEUR | conversion atomique et gardée sous la contrainte d'exclusion, ré-acquisition, compensation par capacité, « paiement en cours », 2 holds par guest, tâche de 60 s, 100 requêtes concurrentes, tests C1–C12 ; hold `AGENCY_LINK` (ADR-025) à la place du hold de 2 h 10 | BKG-014, CAL-011, PAY-033, PAY-034 | Corrigé |
| F2 | MAJEUR | 10b v2 dans les sources ; écrans 10b dans la rubrique Source des 127 fiches ; caution « couvre / ne couvre pas » (UX-21) ; « paiement en cours » (S06) ; revue avant le lien de paiement laissée **ouverte** (UXQ-08 / UXQ-09) ; finalité « remboursement par virement » (UXQ-11) ; vue A12 | PAY-035, LST-013, BKG-018, BKG-014, VER-007, BKG-012, ADM-029, LEG-009 / LEG-010, PAY-021, D.2 | Corrigé |
| F3 | MAJEUR | sort P0-A de la retenue quand l'agence est inéligible : `p0a_ineligible_no_show_outcome`, défaut `REFUND_GUEST` (PROPOSÉ, fail-closed), alternatives chiffrées ; **décision ouverte OQ-BR-45** ; vecteur TA11 ; règle dans 08 BR-CXL-08 | TRP-015, A.8.1, D.2 | Corrigé (décision ouverte) |
| F4 | MAJEUR | vecteur P0-A TA10 (capture 42,80, void 85,60) dans l'AC de PAY-006 ; T28 gardé pour le moteur | PAY-006, A.8.1 | Corrigé |
| F5 | MINEUR | T66–T68 cités | A.8.1, PAY-021, ADM-008, PAY-019, PAY-015 / PAY-037 | Corrigé |
| F6 | MINEUR | gabarit de 20 photos, AC « 19 sur 20 », divergence avec 08 BR-PICKUP-03 notée | TRP-004 | Corrigé |
| F7 | MINEUR | AC à valeur : 2 j ouvrés / J+15, 72 h, export ≤ 10 min (PROPOSÉ) | CLM-006, CLM-021, CLM-034 | Corrigé |
| F8 | MINEUR | D.1 régénérée, découpage aux titres `##` : I18N-003 / I18N-004 sans les BR et OQ de l'epic E14 | D.1 | Corrigé |
| F9 | MINEUR | noms canoniques de 17 dans tout le document (entités, rôles dont `AGENCY_OWNER`, `kind` / `source`, paramètres, codes d'erreur sans préfixe, événements) ; table A.8.2 | tout le document | Corrigé |
| F10 | MINEUR | scripts de l'auteur versionnés | `tools/check_prd_structure.py`, `tools/check_ta_consolidation.py` | Corrigé |
| F11 | MINEUR | « plafond 0 tant que DEC-FONDATEUR-01 est ouverte » | BKG-035 | Corrigé |
| F12 | MINEUR | TA07 et AC de TRP-035 marqués valeurs de test dépendantes du paramètre | A.8.1, TRP-035 | Corrigé |
| F13 | MINEUR | AC « sans mandat : exécution par l'agence, suivi seul par la plateforme » | PAY-021 | Corrigé |
| F14 | MINEUR | « base confirmée, texte proposé » | LST-010 | Corrigé |
| DEC-FONDATEUR-02, -03, -04 | — | décisions prises le 2026-10-30 reportées (avis juridiques avant l'ouverture et non avant le build ; PSP réel après le choix du pays, adaptateur `FAKE` ; construction Panama + Paraguay) | en-tête, A.3, A.6, PAY-001, PAY-041, D.2 | Reporté |

## Contradictions résiduelles (17 v2 et 10b v2, non modifiés par cette passe)

Relevées pendant la consolidation ; 17 et 10b sont en cours de revérification et n'ont pas été modifiés. À arbitrer lors de leur prochaine révision. **Statut au 2026-10-30 (alignement v4)** : voir la table « Traitement des contradictions R1–R12 » en D.5 ; la table ci-dessous est conservée pour l'historique.

| # | Fichier | Contradiction ou manque | Position retenue dans 04 / 08 / 16 |
|---|---|---|---|
| R1 | 10b §4.1, écran S06 (colonne Erreur) | « mode b sans confirmation sous 2 h → annulation notifiée » : contredit ADR-025 et 17 annexe A8 (aucun trip avant la preuve, donc rien à annuler) | libération du hold `AGENCY_LINK`, message « No se confirmó tu pago… » (PAY-033, BKG-014) |
| R2 | 10b §7 (BKG-014) et UXQ-09 | parlent d'un blocage « au-delà des 10 min du hold » jusqu'au délai de 2 h du mode b, alors que 17 modélise un hold `AGENCY_LINK` distinct de TTL 120 min (pas une prolongation) | hold `AGENCY_LINK` distinct ; valeur = UXQ-09 |
| R3 | 17 §2.3 (`payment.confirm_agency`) vs 17 annexe C (C04-5) | la matrice autorise aussi `OPS_AGENT` (sur preuve écrite, double validation) et `ADMIN` ; C04-5, 04 PAY-034 et 08 BR-BOOK-10 point 9 ne citent que `AGENCY_OWNER` / `AGENCY_MANAGER` | 16 suit la matrice de 17 (voie ops mentionnée dans PAY-033 / PAY-034) ; 04 et 08 à compléter si la voie ops est confirmée |
| R4 | 17 §3.2.3 `deposit_policy` | aucun attribut pour la liste fermée « couvre / ne couvre pas » ni « dommages : oui / non » (10b §7 PAY-035, désormais dans 04 PAY-035) | attribut à ajouter à 17 (16 PAY-035 le signale) |
| R5 | 17 §3.2.4 `checkout_hold.review_required` (UXQ-08) | si UXQ-08 retient « revue avant le lien », le véhicule doit rester bloqué ≈ 2 h ouvrées sans paiement : ni le type de hold ni son TTL ne sont définis (le hold `CHECKOUT` dure 10 min) | décision UXQ-08 d'abord, puis type ou TTL à ajouter à 17 §2.5 |
| R6 | 17 §3.2.10 `inspection_photo.slot_code` | liste « 12 extérieures, 6 intérieures, `FUEL`, `ODOMETER`, `KEY`… » : l'emplacement `KEY` n'est pas dans le gabarit de 20 photos de 04 / 16 TRP-004 | gabarit de 20 photos ; `KEY` optionnel à confirmer |
| R7 | 17 §4.5 | pas de catalogue de gabarits de notification ; 11 gabarits de 16 n'ont pas d'événement de domaine (A.8.2, lignes « — ») | clés `EVT_…` conservées comme gabarits ; événements à ajouter à 17 |
| R8 | 17 (général) | pas de catalogue de codes d'erreur en dehors de `VEHICLE_UNAVAILABLE`, `SETTLEMENT_EXISTS`, `INVALID_TRANSITION` et des codes de BR-BOOK-11 | codes de 16 = noms de référence sans préfixe (A.8) |
| R9 | 17 §7.2 | paramètre `p0a_ineligible_no_show_outcome` (nouveau dans 08 BR-CXL-08) absent du registre des paramètres | à ajouter, défaut `REFUND_GUEST` |
| R10 | 17 §7.2 | `grace_minutes` = 29 (« jours facturés et retard ») et `overdue_detection_minutes` = 30 décrivent la même frontière du retard sous deux noms (> 29 min ⇔ ≥ 30 min) | 16 utilise `overdue_detection_minutes` pour le passage `OVERDUE`, `grace_minutes` pour les jours facturés ; un seul nom à garder dans 17 |
| R11 | 17 §0 et §10 / 18 | l'ordre des portes (avis juridiques avant le lot 1) et la seule pile PSP Tilopay ne reflètent pas DEC-FONDATEUR-02, -03 et -04 (non modifiés sur instruction) | 16 A.3 / A.6 et 22 portent les décisions ; 17 et 18 à mettre à jour |
| R12 | 17 **v3** (correction VERIF_16, publiée pendant cette passe, non encore auditée) | cette consolidation suit 17 **v2** comme demandé. 17 v3 ajoute : état terminal `COMPENSATED` et table `payment_disposition` (conversion **ou** compensation, exclusives) — une preuve tardive sur un hold déjà compensé ne crée **jamais** de trip (C13) ; une seule opération convertit un hold, `DUPLICATE_PAYMENT`, `SUPPORTS_SINGLE_USE_LINK` (C14) ; `PAYMENT_IN_FLIGHT` posé **avant** l'appel PSP et libération différée tant qu'un ordre vit (C15) ; horloge `platform.now()`, verrou par véhicule (C16) ; DEC-FONDATEUR-02/03/04 en ADR-031 à ADR-033 ; annexe C v3 (C-v3-01 à C-v3-18) | compatible avec BKG-014 / 08 BR-BOOK-10 (aucune règle de 16 ne convertit un hold compensé), mais **non reporté** : appliquer C-v3-01 à C-v3-18 à 04, 08 et 16 après l'audit de 17 v3 |

## D.5 Journal d'alignement v4 (2026-10-30)

Source : `17_DATA_MODEL_AND_ARCHITECTURE.md` v4 (annexe C : C-v3-01 à C-v3-18, C-v4-01 à C-v4-08 ; ADR-034 ; §11) ; `verification/VERIF_17_ARCH_V3.md`. Fiches modifiées : BKG-014, PAY-033, PAY-034, PAY-035, PAY-041, ADM-033, BKG-028, BKG-032, BKG-035, LEG-009 / LEG-010, HST-011, FLT-011 ; fiches ajoutées : HST-050, ADM-036 (catalogue véhicules, demande du fondateur) ; D.1 régénérée.

**Traitement des contradictions R1–R12**

| # | Traitement | Statut |
|---|---|---|
| R1 | 10b S06 : « annulation notifiée » remplacée par la libération du hold `AGENCY_LINK` et le message « No se confirmó tu pago… » | Résolu (10b) |
| R2 | 10b §7 et UXQ-09 : hold `AGENCY_LINK` distinct, de TTL `agency_link_hold_minutes`, et non prolongation du hold de 10 min | Résolu (10b, 22) ; valeur = UXQ-09 **ouverte** |
| R3 | voie ops de confirmation (preuve écrite, double validation) ajoutée à 04 PAY-034 et 08 BR-BOOK-10 point 9 | Résolu |
| R4 | `deposit_policy.covered_items`, `excluded_items`, `covers_damage` ajoutés à 17 §3.2.3 | Résolu |
| R5 | hold de revue défini **conditionnellement** dans 17 §2.5 et 08 (`review_required`, `review_hold_minutes`) | Résolu sur la forme ; UXQ-08 **ouverte** |
| R6 | `KEY` optionnel, hors du gabarit de 20 photos (17 §3.2.10) | Résolu |
| R7 | événements ajoutés à 17 §4.5 ; A.8.2 complétée | Résolu (sauf `EVT_OTP_CODE`, synchrone par conception) |
| R8 | 17 adopte les codes de 16 A.8 comme catalogue de référence | Résolu |
| R9 | `p0a_ineligible_no_show_outcome` ajouté à 17 §7.2 (défaut `REFUND_GUEST`) | Résolu ; OQ-BR-45 **ouverte** |
| R10 | `grace_minutes` = jours facturés ; `overdue_detection_minutes` = passage `OVERDUE` ; contrôle `= grace_minutes + 1` tant qu'OQ-BR-04 est ouverte | Résolu ; OQ-BR-04 **ouverte** |
| R11 | 17 v4 (ADR-031 à 033, §9, §10) et 18 v4 reflètent DEC-FONDATEUR-02/03/04 | Résolu |
| R12 | C-v3-01 à C-v3-18 appliqués à 04, 08, 16 (17 v4 audité par VERIF_17, corrections v4 reportées) | Résolu |

Contrôles : `python -I tools/check_prd_structure.py` et `python -I tools/check_ta_consolidation.py` (sorties dans `verification/VERIFICATION_LOG.md`).

## D.6 Journal — passe de cohérence finale VERIF_18 et DEC-FONDATEUR-05 à 10 (2026-10-30)

Source : `verification/VERIF_18_GLOBAL_CONSISTENCY.md` ; décisions DEC-FONDATEUR-05 à 10 (`23_RESEARCH_LOG.md`, `22_OPEN_QUESTIONS.md`) ; 04 révision 5 (676 lignes : P0-A 166, P0-B 13, P1 342, P2 108, P3 47 ; Bêta OUI 25, SIMPLIFIÉ 71, MANUEL 58, DIFFÉRÉ 12 = 96 construites ; lots 0 = 22, 1 = 50, 2 = 65, 3 = 24, 4 = 1, C = 4).

| Constat | Correction dans 16 | Statut |
|---|---|---|
| F-01 lot des connecteurs réels | epic E18 (lot C) : fiche PAY-041 déplacée de E6 et réécrite (porte du PSP du pays retenu, plus « au début du lot 2 ») ; fiche PAY-042 / FIN-020 / VER-029 ; PAY-001 renvoie au lot C | Appliqué |
| F-02 DEC-FONDATEUR-04 | A.1, A.3, A.4, A.6 : Panama et Paraguay construits dès le départ, « choix du pays de lancement » en attente, « bascule » retirée ; I18N-005 (fiche I18N-003/004/005) et FIN-003 (fiche FIN-002/003) en P0-A, retirées de la partie C | Appliqué |
| F-04, F-05 caution | fiche PAY-011 / PAY-012 / PAY-036 : forme en heures, marge 0 h, T59 ; libération jamais suspendue ; dommage sur la carte enregistrée (REQ-PAY-DMG-02 à 07) ; retenue limitée aux frais annexes de la liste fermée | Appliqué |
| F-07 plan de tests | CAL-011, BKG-014 : C1–C20, RLS-1 à RLS-20, L0-01 à L0-10 | Appliqué |
| F-14 comptes | en-tête (T01–T68, 179 lignes P0), A.3, C.2 | Appliqué |
| F-20 portes juridiques | A.6 : G1a, G1b et J-ADM-031 bloquent la mise en service, pas le build ; D.2 idem | Appliqué |
| F-22 PAY-001 | critère « aucun `FAKE` en production » (C19) | Appliqué |
| F-24 « 80 h » | TRP-046 (partie C) et PAY-011 étiquetés « valeur Turo, non reprise » | Appliqué |
| Unité d'effort (16:72) | effort en jours-agent ; aucune durée calendaire promise avant la mesure du lot 0 ; ancien énoncé en semaines-équipe gardé comme contexte (DEC-FONDATEUR-05) | Appliqué |
| DEC-FONDATEUR-05 à 10 | en-tête ; epics E16 (fiches DSN-001/002/005/006/007 et DSN-003/004) et E17 (fiches PLT-001/002/003 et PLT-004/005) ; applications natives en non-objectif | Appliqué |
| D.5 R1 « Résolu (10b) » | le corps de 10b gardait le mode b « sous 2 h, sinon annulation » (VERIF_18-F06) ; corrigé dans 10b par la même passe | Réouvert puis corrigé (10b) |

Contrôle : `python -I tools/check_prd_structure.py` → RÉSULTAT OK (sortie en D.3).
