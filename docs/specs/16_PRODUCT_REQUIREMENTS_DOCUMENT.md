# 16 — Product Requirements Document (PRD)

> **Statut : PROPOSÉ — version 5 du 2026-11-02 (révision P2P, US-057, demande de fusion S5 de `docs/team/impact/2026-11-02-pivot-p2p.md`).** Kmino est une place de marché de location de voitures **de particulier à particulier**, comme Turo : des particuliers louent leur propre voiture au Panama et au Paraguay ; **il n'y a aucune agence**, aucun comptoir, aucun loueur professionnel (DEC-FONDATEUR-13) ; par défaut, on fait **comme Turo** (DEC-FONDATEUR-14, 16) ; tout est livré en espagnol et en anglais (DEC-FONDATEUR-11). Changements de la version 5 : partie A réécrite (vision, personas, périmètre, non-objectifs, métriques, préconditions, NFR, conventions, catalogue des codes d'erreur, vecteurs TA08, TA10 et TA11 remplacés par des critères alignés sur les vecteurs par jambe TJ de 08) ; partie B recomposée selon les epics de 04 révision 6 (178 lignes P0) avec 15 fiches nouvelles ou fusionnées ; 17 fiches de lignes **HORS PRODUIT** retirées et portées en partie C ; parties C et D régénérées ; journal en D.7. Document de spécification destiné à l'équipe de build (équipe multi-agents Claude Code ; le fondateur, seul humain, est product owner, recette, comptes et juridique — DEC-FONDATEUR-05). Aucune ligne de code applicatif.
> **Règle de lecture (version 5)** : les termes agence, loueur, comptoir, flotte ou police flotte, contrat-cadre, mandat, commission (au sens de rémunération par une agence), KYB, P0-B, lot LB, « Bêta pilote » d'agence, ainsi que les identifiants `AGENCY_*`, `agency_*` et `counter_*`, ne désignent plus rien dans le produit. Ils ne subsistent que dans des passages marqués « historique » ou « sans objet », dans la table de correspondance A.8.2, dans la partie C (libellés de 04 marqués « (hist.) » et lignes HORS PRODUIT) et dans les journaux D.4 à D.6, antérieurs au 2026-11-02. Deux noms techniques sont **gardés parce que les contrôles de `tools/` les lisent** : la phase `P0-A` se lit **MVP = bêta P2P** (04 README, règle de lecture de la révision 6) ; la rubrique « Bêta pilote » des fiches se lit **tranche des lots 0 à 4 de la bêta P2P** (colonne `beta_pilote` de 04). Les écrans A01 à A13 ont le sens « espace hôte » de 10b v3 (US-059).
> **Sources lues** : `04_FEATURE_INVENTORY.csv` (révision 6) et son README ; `08_BUSINESS_RULES.md` révisé (US-055, US-056 : section E7 « Jambes explicites », vecteurs TJ01 à TJ21, Règle de blocage) ; `17_DATA_MODEL_AND_ARCHITECTURE.md` version 6 (US-056) ; `18_MVP_AND_ROADMAP.md` version 5 et `21_COVERAGE_MATRIX.csv` (US-054) ; `22_OPEN_QUESTIONS.md` révisé (US-053 : OQ-P2P-01 à 12) ; `10b_UX_UI_ANALYSIS.md` version 3 (US-059, écrans A01 à A13 de l'espace hôte) ; `docs/team/DECISIONS.md` (DEC-FONDATEUR-11 à 16) ; `docs/team/COMME_TURO.md`. Turo n'a pas été consulté à nouveau : chaque fait Turo renvoie à la source citée dans 04 ou 08. Tout ce qui n'existe pas chez Turo est **PROPOSÉ** ; chaque choix « comme Turo » propre au P2P est noté dans `docs/team/COMME_TURO.md`.
> **Règle de cohérence** : `04_FEATURE_INVENTORY.csv` reste la source de vérité du périmètre (phases, epics, lots, `beta_pilote`) ; `08_BUSINESS_RULES.md` celle des règles (BR, SM, vecteurs T01–T68 et TJ01–TJ21) ; `22_OPEN_QUESTIONS.md` celle des questions ouvertes. En cas d'écart, 04 et 18 font foi pour le build, 08 pour le calcul. Les entités, états, rôles, paramètres, événements et commandes des fiches portent les **noms de 17 v6** (correspondance en A.8.2). Les écrans cités sont ceux de 10b v3 §4.1 (rubrique « Source » de chaque fiche).
> **Écrans conçus sans observation de Turo** : les écrans de trip (remise, retour), de dommage et de litige, de vérification KYC, de calendrier, de gains et de versements (modules TRP, CLM, VER, CAL, PYO) sont des **conceptions nôtres** nourries par le centre d'aide de Turo (DOCUMENTÉ), pas des interfaces observées : aucun trip réel, aucune réclamation, aucun KYC ni espace hôte avec annonce n'a été vu (02 « Limites connues »).
> **Décisions du fondateur laissées OUVERTES** (ne jamais les trancher dans le code ni dans une fiche) : **DEC-FONDATEUR-01** (OQ-BR-41 : la plateforme indemnise-t-elle l'hôte quand l'annulation vient d'elle ? paramètre `platform_funded_host_compensation`, absent = `false`, fail-closed, vecteur T61) et **OQ-BR-04** (jours facturés, frontière retard / extension). Le pays de **lancement** n'est pas tranché ; les deux pays sont construits dès le départ (DEC-FONDATEUR-04). **Décisions prises** (22, « Décisions prises ») : DEC-FONDATEUR-02 (on construit d'abord ; les avis juridiques bloquent la **mise en service**, jamais le build), DEC-FONDATEUR-03 (PSP réel après le choix du pays ; build contre les ports et les adaptateurs `FAKE`), DEC-FONDATEUR-04 (Panama et Paraguay construits en même temps), DEC-FONDATEUR-05 à 10 (équipe multi-agents, design, transmissibilité, qualité, autonomie : epics E16 et E17), DEC-FONDATEUR-11 à 16 (bilingue ; place de marché P2P dès la bêta, aucune agence ; comme Turo par défaut ; jamais bloqué sur une question propre au P2P). Décisions produit encore ouvertes et paramétrées : moment du débit d'une réservation signalée (UXQ-08, défaut `REVIEW_BEFORE_CHARGE`) et retenue d'un no-show quand l'hôte est inéligible (OQ-BR-45 : défaut « comme Turo » = la retenue va à la jambe `PLATFORM`, avis consommation avant la mise en service). Liste complète : `22_OPEN_QUESTIONS.md`.

## Sommaire

- **Partie A** — Vue produit : vision, personas, périmètre, non-objectifs, métriques de succès, préconditions de mise en service, exigences non fonctionnelles, conventions (modules, rôles, codes d'erreur, notifications, vecteurs de test).
- **Partie B** — Fiches FEATURE des **178 lignes P0** de 04 révision 6 (phase technique `P0-A` = MVP, bêta P2P), epic par epic (E1 à E18 ; E14 et E15 font désormais partie de la bêta ; E18 = connecteurs réels du lot C). Quelques lignes d'un même epic sont regroupées dans une fiche ; chaque `feature_id` y est listé une fois.
- **Partie C** — Tableau compact des lignes P1, P2 et P3, puis des 24 lignes **`HORS`** (hors produit, DEC-FONDATEUR-13).
- **Partie D** — Matrice de traçabilité (feature → BR → EC → vecteurs → OQ), fiches dont la **mise en service** dépend de questions ouvertes, contrôles et journaux.

---

# PARTIE A — Vue produit

## A.1 Vision

Une place de marché de location de voitures **entre particuliers**, construite dès le départ pour le **Panama** et le **Paraguay** (pays de lancement à choisir, DEC-FONDATEUR-04), sur le modèle de Turo : un **hôte** particulier vérifié publie sa propre voiture, fixe son prix et ses disponibilités, et la remet en personne à un **voyageur** vérifié au lieu qu'il a choisi ; Kmino vérifie les deux parties, vend la protection de l'assureur partenaire, encaisse en tant que **marchand de référence** et répartit chaque paiement en **jambes** (08 E7). La plateforme reprend les mécanismes éprouvés de Turo (recherche, fiche, checkout une page, réservation instantanée par défaut, contrat par trip, photos de remise et de retour, règles d'annulation et de retard, avis réciproques en double aveugle, plans de gains de l'hôte ; 05, 06, 08) en les adaptant à un marché où :

- une part des voyageurs n'a **pas de carte de crédit** : le loyer peut être payé par Yappy si le PSP de place de marché le propose (PAY-004) ; la caution reste une autorisation sur carte tant qu'aucun autre rail n'est validé (PAY-011, 08 BR-PAY-06 ; 12 §1.5, §2) ;
- **WhatsApp** est le canal principal (NTF-002, VER-013 ; 15 IMP-06), mais les échanges hôte–voyageur restent dans la messagerie du trip (MSG-001, MSG-007) ;
- la **preuve** (photos horodatées des deux côtés, contrat, constancia, décisions motivées) protège contre les litiges et les plaintes ACODECO ou SEDECO (LEG-024, CLM-034) ;
- le cadre juridique impose de **construire tout le parcours P2P** (DEC-FONDATEUR-02) mais d'en fermer la **mise en service**, pays par pays, par quatre interrupteurs à `false` en production tant que l'avis ou le contrat manque : `p2p_private_hosts_enabled[pays]`, `insurer_contract_active[pays]`, `funds_holding_enabled[pays]` et `payouts_enabled[pays]` (08 « Règle de blocage », 17 §0.1, ADM-027).

**Modèle d'argent (PROPOSÉ, comme Turo ; 08 E7, 17 §0.1, ADR-045)** : le voyageur paie **Kmino**, marchand de référence, par un **PSP de place de marché** ; l'hôte y est **sous-marchand** (`psp_submerchant`) ; chaque opération porte le montant explicite de chaque jambe — `HOST` (part de l'hôte selon son plan), `INSURER` (prime de l'assureur partenaire), `TAX_THIRD_PARTY` (taxe collectée pour le compte d'un tiers, vide par défaut) et `PLATFORM` (trip fee, part de la plateforme, marge de protection, taxes propres de Kmino) —, calculé par le règlement et jamais réparti au prorata par le PSP. Mode d'exécution par pays (`collection_mode[pays]`) : variante A `SPLIT_AT_SOURCE` (le PSP crédite chaque bénéficiaire ; préférée) ou variante B `PLATFORM_MOR` (Kmino reçoit puis reverse ; exige `funds_holding_enabled[pays]`). **« Aucun fonds détenu »** : c'est vrai **en build et en `FAKE`**, et **en production tant que `funds_holding_enabled[pays]` vaut `false`** (même phrase que 17 §0.1) ; aucun repli vers un encaissement par l'hôte n'existe.

Proposition de valeur : pour le **voyageur**, un prix TTC affiché dès la recherche (SRC-042, divergence volontaire avec Turo qui affiche HT), une vérification d'identité unique, un contrat bilingue, une protection de l'assureur partenaire (niveau Básica toujours inclus) et une caution prise sur la carte et libérée automatiquement ; pour l'**hôte**, un revenu tiré d'une voiture souvent immobile, un espace hôte mobile (A02 à A13), des voyageurs vérifiés, une protection et une assistance par l'assureur partenaire selon son plan de gains, des versements après chaque trajet et des preuves exploitables en cas de dommage ; pour la **plateforme**, la jambe `PLATFORM` : trip fee payé par le voyageur (BR-PRICE-06), part de la plateforme selon le plan de l'hôte (BR-PROT-06, plan par défaut `ESTÁNDAR` 75 % pour l'hôte) et marge de distribution de la protection (BR-PRICE-11, BR-PROT-01).

## A.2 Personas

| ID | Persona | Contexte | Besoins principaux | Rôle technique | Phase |
|---|---|---|---|---|---|
| PER-01 | **Voyageur touriste** | Étranger de passage (≈ 28 % de nord-américains parmi les visiteurs, 12 §1.2), permis étranger, carte de crédit le plus souvent, téléphone en roaming data | Réserver depuis l'étranger, comprendre le prix TTC, la protection et la caution, être vérifié avant d'arriver, retrouver l'hôte au lieu convenu, contrat en anglais de courtoisie, règle des 90 jours du permis étranger (VER-007) | `GUEST` | P0-A |
| PER-02 | **Voyageur résident** | Panaméen, Paraguayen ou résident, cédula, permis local, souvent **sans carte de crédit** | Payer le loyer par Yappy si le PSP le propose, comprendre que la caution exige une carte, interface en espagnol, messagerie avec l'hôte | `GUEST` | P0-A |
| PER-03 | Sans objet (pivot P2P, DEC-FONDATEUR-13) : ancien persona « représentant d'une agence », historique | — | — | — | — |
| PER-04 | Sans objet (pivot P2P, DEC-FONDATEUR-13) : ancien persona « employé de remise d'une agence », historique ; la remise est faite par l'hôte (PER-08) | — | — | — | — |
| PER-05 | **Agent support** | Équipe es/en, WhatsApp Business, email, téléphone, horaires étendus (SUP-004) | Vue 360° du trip, de l'hôte et du voyageur, relais des messages, prise d'incidents (rendez-vous manqué, voiture refusée), gabarits de réponses | `SUPPORT_AGENT` | P0-A |
| PER-06 | **Finance plateforme** | Comptable ou contrôleur | Grand livre par jambe, relevés de gains des hôtes, factures du trip fee, bordereaux de l'assureur, rapprochement quotidien par jambe avec le relevé du PSP, avances de Kmino, taxes collectées | `FINANCE` | P0-A |
| PER-07 | **Admin / Ops plateforme** | Équipe opérations, responsable ops nommé (SUP-020) | Files KYC, vérification des hôtes et des véhicules, annonces, réservations à risque ; paramètres PA et PY ; annulations plateforme ; sinistres et litiges ; sécurité et exploitation | `OPS_AGENT`, `ADMIN` (`SUPERADMIN` : bris de glace) | P0-A |
| PER-08 | **Hôte particulier vérifié** | Personne physique (jamais une personne morale, 08 BR-ACC-06), ≥ 21 ans (`host_min_age_years`), propriétaire d'une ou de quelques voitures de particulier (plaque « particular »), téléphone mobile, peu de temps | S'inscrire et faire vérifier son identité, son profil fiscal et sa voiture (titre, plaque, châssis, prenda), publier une annonce, fixer prix et disponibilités, choisir son plan de gains, accepter ou refuser une demande (mode `REQUEST`), remettre et reprendre la voiture avec photos, déclarer un dommage, recevoir ses versements, noter le voyageur | `P2P_HOST` (compte d'hôte = `organization` `P2P_HOST_INDIVIDUAL`, 17 §2.3) | **P0-A** (activable seulement si les interrupteurs du pays le permettent) |
| PER-09 | **Co-hôte** | Proche ou voisin invité par l'hôte pour gérer certaines voitures | Gérer trips, calendrier et annonces des véhicules confiés ; jamais les gains ni les déclarations de sinistre (BR-COHOST-02) | `CO_HOST` (portée `vehicle_scope`) | P1 (FLT-001), comme Turo |

Acteur technique supplémentaire : `SYSTEM` (tâches planifiées, webhooks du PSP et de l'assureur, règles codées).

## A.3 Périmètre par phase

| Phase | Définition (04 README §3, 18 §1) | Lignes 04 | Ce que fait la plateforme | Ce qu'elle ne fait pas |
|---|---|---|---|---|
| **Tranche des lots 0 à 4** (première ouverture ; colonne `beta_pilote`, nom historique) | Première ouverture de la bêta P2P dans le pays de lancement : hôtes particuliers vérifiés un par un, voyageurs en volume limité, remise et retour en personne (18 §1.0) | 178 lignes P0-A : OUI 31, SIMPLIFIÉ 111, MANUEL 28, DIFFÉRÉ 8 | **142 lignes construites** : inscription et KYC du voyageur et de l'hôte, annonces, réservation, paiement par jambes, caution par carte, protections, remise et retour, versements (lots `ON_HOLD` tant que `payouts_enabled[pays]` = `false`), avis réciproques | Les 28 lignes MANUEL sont des procédures humaines de l'ops (rubrique « Bêta pilote » de chaque fiche) ; les 8 lignes DIFFÉRÉ arrivent au lot 5 |
| **P0-A** (nom technique) = **MVP, bêta P2P complète** | Bêta fermée P2P dans le pays de lancement, Panama et Paraguay construits | **178** (E1 à E18 ; lots 0 = 22, 1 = 47, 2 = 72, 3 = 32, 4 = 1, C = 4) | Tout le parcours de l'hôte et du voyageur, Kmino marchand de référence, jambes, caution, protections et plans de gains de l'assureur partenaire, trip fee, versements, taxes collectées, rapprochement par jambe | Détention de fonds de tiers en production tant que `funds_holding_enabled[pays]` = `false` ; aucune agence |
| Ouverture élargie | Bêta P2P complète ouverte à tout hôte particulier éligible du pays de lancement, après les critères S1 à S4 (18 §1.3) | — | — | Ce n'est pas le P1 |
| P1 | Version concurrentielle complète | 327 | Co-hôtes, remise sans contact, livraison, modifications de trip en libre-service, support 24/7, automatisations | — |
| P2 | Différenciation | 100 | — | — |
| P3 | Futur ou non applicable | 47 | — | — |
| `HORS` | **Lignes hors produit** (DEC-FONDATEUR-13 ; valeur `HORS` de `phase_mvp` depuis US-058) | 24 | — | Ni fiche ni story active (partie C.4, 19 §3.9) ; les réintroduire serait une décision nouvelle du fondateur |

Ancienne phase P0-B : **sans objet** (pivot P2P) ; ses lignes sont intégrées au MVP (E6, E11, E14, E15), sauf PAY-038, hors produit (18 §1.2).

Choix du pays de lancement (12 §10.3, **en attente**) : les deux pays étant construits (DEC-FONDATEUR-04), l'issue des avis ne détermine que le pays ouvert en premier, donc ses interrupteurs et les connecteurs réels du lot C (E18).

**Construction bi-pays (DEC-FONDATEUR-04)** : les fiches P0 sont communes aux deux pays ; leurs valeurs propres (devise, fuseau, taxe, pièces d'identité, numéro fiscal de l'hôte, textes juridiques, pénalités en unités mineures, vecteurs T48, T62, TJ08, TJ10 et TJ11 en PYG) sont des paramètres pays datés (ADM-014, ADM-031, PRC-020, PRC-021, NFR-16 ; 17 §7, ADR-024). Aucune ligne de 04 n'est dupliquée. Besoins réellement propres au Paraguay :

| Besoin | Ligne 04 | Phase | Traitement |
|---|---|---|---|
| Devise PYG sans décimale, affichage | I18N-005 | P0-A, lot 0 | vecteurs T48, T62, TJ08, TJ10, TJ11 en PYG ; fiche E13 |
| Facture électronique SIFEN (DNIT) du trip fee | FIN-003 | P0-A, lot 2 | port fiscal + adaptateur `FAKE` ; connecteur SIFEN réel au lot C (FIN-020) |
| IVA 10 % et règles fiscales PY | PRC-020 | P0-A | valeurs `tax_line_config` PY à fournir (OQ-BR-14) |
| RUC de l'hôte ; hôte sans RUC non activable tant qu'OQ-PAY-09 est ouverte | FIN-008, HST-049 | P0-A, lot 1 | `p2p_host_requires_tax_id[pays]` = `true` (OQ-P2P-07) |
| Cédula paraguayenne et permis PY dans le parcours KYC | VER-001, VER-005, VER-006 | P0-A | liste de pièces par pays (paramètre) |
| Fuseau `America/Asuncion` (UTC−3 permanent) | — (NFR-02, ADR-019, OQ-BR-20) | — | contrôle tzdata au démarrage |
| Interface en portugais pour les visiteurs brésiliens | aucune | — | nouvelle ligne P1 à créer dans 04 si le Paraguay est retenu |
| PSP de place de marché au Paraguay (Bancard, upay, dLocal : capacités bloquantes à valider) | PAY-001 | P0-A | lot C après le choix du pays : porte PAY-041, connecteur PAY-042 |
| Droit de la consommation SEDECO, Ley 7593/2025 (données) | LEG-010, LEG-011 | P0-A | textes par pays, avis avant la mise en service (DEC-FONDATEUR-02) |

**Effort (18 §5 fait foi)** : 18 version 5 donne la tranche des lots 0 à 4 à ≈ 190 à 370 jours-agent et la bêta P2P complète à ≈ 340 à 670 jours-agent (1 unité d'effort = 10 jours-agent) ; ordre de grandeur non mesuré, **aucune durée calendaire promise** avant la mesure du lot 0 ; recalcul après le chiffrage des stories par S6 (19). **Critères de passage** (17 §2.5, C-v3-08) : un paiement reçu sur un hold compensé ne crée jamais de trip et est remboursé ; un seul paiement convertit un hold, tout paiement en plus est remboursé ; limites de holds par voyageur tous hôtes et tous pays confondus ; aucun adaptateur `FAKE` dans la configuration ni l'image de production (C19) ; aucun interrupteur de mise en service à `true` sans décision écrite du fondateur et deux approbateurs (RLS-27).

## A.4 Non-objectifs (hors MVP, 18 §2)

- **Agences, loueurs professionnels, comptes de société, KYB, police flotte, contrat-cadre, mandats, encaissement par un tiers, caution prise au comptoir, interface de comptoir, outils et API de flotte** : **hors produit** (DEC-FONDATEUR-13) ; les 24 lignes `HORS` de 04 (partie C.4).
- Détention de fonds de tiers par Kmino en production tant que `funds_holding_enabled[pays]` = `false` (variante B, crédit cash, rail « débit puis remboursement » de la caution, avance au-delà du solde `PLATFORM`) : construite contre le `FAKE`, fermée en production.
- Co-hôtes (P1, FLT-001, comme Turo) ; remise sans contact par équipements, livraison, remise en zone aéroport hors point convenu, one-way (P1 ; OQ-P2P-05, OQ-MK-08).
- Option avec chauffeur (P3), VTC (rejeté) ; le Paraguay n'est **pas** un non-objectif : il est construit dès le départ (DEC-FONDATEUR-04).
- Applications natives iOS / Android (hors MVP ; le MVP est un web mobile-first avec PWA installable, DEC-FONDATEUR-06, DSN-006).
- Géofencing logiciel, télématique, coupure moteur (P1 / P2 ; coupure exclue, OQ-BR-17).
- Support humain 24/7, triage IA (P1).
- Modification, extension, échange de voiture en libre-service (P1 ; en bêta : ADM-006 par l'ops).
- Réponses publiques aux avis et profil public complet (P1 ; le profil public de l'hôte A13 est réduit en bêta).
- SSO Google/Apple, connexion par code (P1) ; prix par date, remises de durée, tarifs non remboursables, jeune conducteur, tarification dynamique (P1 / P2).
- ACH Xpress comme rail d'encaissement, BNPL, Apple / Google Pay ; recouvrement automatisé ; moteur de règles configurable, score de fraude (P1).
- Connecteurs PAC / SIFEN réels avant le choix du pays (lot C, FIN-020).
- API publique, marque blanche, actions en masse (P1, hors produit pour la part « flotte »).
- Parrainage, fidélité, cartes cadeaux (P1–P3) ; droits des personnes en libre-service et bannière de cookies (P1 ; aucun cookie non essentiel en bêta).

## A.5 Métriques de succès

**Critères de sortie de la bêta fermée** (18 §1.1, PROPOSÉS, à confirmer au point hebdomadaire ; DEC-FONDATEUR-14) :

| ID | Critère | Seuil |
|---|---|---|
| S1 | Hôtes actifs (vérifiés, au moins un trip par mois) | seuil à fixer avec la dotation de l'ops avant la mise en service (aucune valeur dans les specs) |
| S2 | Trips terminés sans double réservation ni remise de clés sur paiement non confirmé | ≥ 100 cumulés, **0** incident de ces deux types |
| S3 | Sinistres déclarés à l'assureur et instruits dans les délais de CLM-006 | 100 % |
| S4 | Écart de rapprochement par jambe (FIN-005) | 0 écart non expliqué sur deux cycles de versement |

**Critères d'arrêt ou de révision** (18 §1.1, PROPOSÉS) : avis défavorable reçu après l'ouverture sur OQ-BR-35, OQ-BR-16 ou la détention de fonds (arrêt des nouvelles réservations dans le pays concerné, ouverture du second pays, déjà construit) ; résiliation du contrat de l'assureur (`insurer_contract_active[pays]` repasse à `false`) ; perte d'une capacité bloquante du PSP.

**Indicateurs produit et opérationnels** (PROPOSÉS, mesurés dès la première ouverture) :

| ID | Indicateur | Cible proposée | Fiche source |
|---|---|---|---|
| M1 | Taux de conversion recherche → réservation confirmée | suivi, pas de cible avant 2 cycles | BKG-001 |
| M2 | Délai de revue KYC du voyageur (SLA) | ≤ 4 h ouvrées (90e centile) | ADM-002 |
| M3 | Délai de revue d'une réservation à risque | ≤ 2 h ouvrées | ADM-029 |
| M4 | Durée de la remise entre l'hôte et le voyageur, de l'arrivée au rendez-vous à la remise des clés (10b v3 M-REM-01) | **≤ 5 écrans et ≤ 10 min** ; retour < 8 min (PROPOSÉ, recalable) | TRP-002 |
| M5 | Délai d'envoi de la confirmation | ≤ 1 min | NTF-007 |
| M6 | Délai de première réponse du support | mesuré, cible fixée après 4 semaines | SUP-004 |
| M7 | Taux de faux positifs de la revue de risque | suivi | ADM-029 |
| M8 | Part des trips avec gabarit photo complet au départ et au retour, des deux côtés | ≥ 95 % | TRP-004 |
| M9 | Remboursements décidés exécutés par Kmino via le PSP le jour même (émission) | ≥ 99 % | PAY-021 |
| M10 | Délai de vérification d'un hôte et de sa première voiture (dossier complet → décision) | ≤ 2 j ouvrés (PROPOSÉ) | HST-049, ADM-004 |
| M11 | Versements émis à la date prévue (J+2 ouvrés, premier à J+5), hors lots gelés motivés | ≥ 98 % | PYO-002 |
| M12 | Taux de réponse de l'hôte aux demandes en mode `REQUEST` avant expiration (4 h) | suivi | HDB-002 |

## A.6 Préconditions de mise en service

Les IDs renvoient à `22_OPEN_QUESTIONS.md` (section « Pivot P2P » et questions reformulées par US-053) et aux préconditions C1 à C18 de 18 §3. **Aucune ne bloque le build** (DEC-FONDATEUR-02) : la colonne « Ce qui est bloqué » dit ce qui ne peut pas **ouvrir** sans la réponse ; le livrable correspondant est construit et testé contre les adaptateurs `FAKE` (DEC-FONDATEUR-03). **Aucune question n'est posée au fondateur** (DEC-FONDATEUR-14, 16) : chaque point ouvert porte un défaut « comme Turo » codé et marqué PROPOSÉ ; seuls restent les avis, les contrats et les dépenses.

| # (18 §3) | Précondition | OQ / ligne | Ce qui est bloqué (mise en service, jamais le build) |
|---|---|---|---|
| C1 | Un particulier peut louer sa voiture (plaque « particular ») par une plateforme sans requalification ; statut fiscal et commercial de l'hôte au Paraguay | **OQ-BR-35** | activation des hôtes du pays (`p2p_private_hosts_enabled[pays]` ; HST-049, LEG-021) |
| C2 | Protection du voyageur et plans de l'hôte = produit de l'assureur partenaire distribué par un courtier agréé ; qualification d'assurance ; contrat signé dans le pays | **OQ-BR-16**, **OQ-P2P-03**, OQ-P2P-12 | activation des hôtes et vente de protection (`insurer_contract_active[pays]`, `INSURER_CONTRACT_INACTIVE` ; PRT-001, PRT-007) |
| C3 | Fonds de tiers : casa de remesas, money transmitter, PSP au sens du BCP ? | **OQ-MK-02**, **OQ-MK-03**, **OQ-MK-04**, OQ-PAY-05, OQ-PAY-21 | variante B, crédit cash, caution « débit puis remboursement » (`funds_holding_enabled[pays]`) ; mise en service si la variante A est aussi requalifiée |
| C4 | Fiscalité de l'hôte (agent de retenue, RUC), taxe sur le trip fee et la marge, entité qui facture | **OQ-P2P-07**, OQ-PAY-09, OQ-BR-14, OQ-MK-06 | versements aux hôtes (`payouts_enabled[pays]` ; PYO-002, PYO-003) ; factures en production (FIN-002) |
| C5 | Véhicule financé (prenda) ; vérification de la plaque et du châssis | **OQ-BR-28**, OQ-P2P-02 | publication des véhicules financés (défaut : consentement écrit du créancier, `vehicle_financed_requires_lender_consent` = `true` ; HST-039) |
| C6 | Porte go / no-go du PSP de place de marché, par pays : capacités bloquantes de 17 §2.8 (sous-marchand particulier, montants par jambe, versement B2C en USD et PYG, libération différée, ajustement, reprise, MIT, remboursement partiel) | **PAY-041** ; OQ-PAY-02, 04, 05, 06, 08, 17, 19, 20, 21, 23 ; OQ-PAY-03 ; OQ-PAY-07, OQ-PAY-22 (Yappy) | connecteur réel (PAY-042) au lot C ; mise en service ; **aucun plan B** avec un encaissement par l'hôte |
| C7 | CGU du voyageur et de l'hôte, contrat de location hôte–voyageur ; validité des clauses ; retenue d'un no-show quand l'hôte est inéligible | **OQ-BR-24**, OQ-BR-45 | mise en service (LEG-001, BKG-018, TRP-015) |
| C8 | Permis étrangers et date d'entrée (art. 110 / 111) | **OQ-BR-21** | refus automatique (mode signalement en attendant ; VER-007) |
| C9 | Durées de conservation (KYC, biométrie, photos, adresse de l'hôte) | **OQ-BR-25** | paramètres de LEG-009 (valeurs prudentes en attendant) |
| C10 | Ley 81 : registre, transferts de biométrie hors Panama, notification de violation | **OQ-MK-09** | KYC réel en production (VER-029, lot C) |
| C11 | Positionnement de Kmino : intermédiaire et marchand de référence, jamais loueur (art. 288) | **OQ-MK-01** | textes (LEG-014) ; mise en service au Panama |
| C12 | Paraguay pays de lancement : statut PSP au BCP, PSP de place de marché | **OQ-MK-04**, OQ-PAY-08, OQ-PAY-10, OQ-PAY-11, OQ-PAY-23 | choix du Paraguay et son lot C |
| C13 | Valeurs de lancement de ADM-031 (âges, préavis, pénalités de l'hôte, plan par défaut, protection minimale, fenêtre d'avis, plafonds, réserve et avance de Kmino) | jalon **J-ADM-031** | mise en service ; valeurs de test pendant le build |
| C14 | Dotation du support et de l'ops (≈ 2,6 ETP de présence pour 7 h–22 h, 7 j/7, ou plage réduite) | SUP-020 | ouverture |
| C15 | Revue de sécurité sans vulnérabilité critique ou élevée ouverte (dont IDOR entre hôtes, RLS-1 à RLS-28) | ADM-033 | ouverture |
| C16 | Décision PWA seule ou enveloppe native, après test sur des téléphones d'hôtes et de voyageurs | TRP-056 | rien pour le build (PWA décidée) |
| C17 | Nom et identité de marque | DSN-001 ; DEC-MARQUE | publication du nom (`{brand_name}` en attendant) |
| C18 | Comptes externes au nom de l'entité du fondateur | PLT-002 | lot 0 (cloud, dépôt, domaine) ; lot C (PSP, KYC, e-facture) |

Gouvernance des interrupteurs (17 §0.1, ADR-046 ; PROPOSÉ) : un interrupteur ne passe à `true` que sur décision écrite du fondateur, par `config.cmd_request_go_live_switch` puis `config.cmd_approve_go_live_switch` exécutées par **deux personnes distinctes** ; tant qu'un second approbateur humain n'existe pas, aucun interrupteur ne peut passer à `true` (question de gouvernance de la passation US-056 ; bloque la mise en service, pas le build).

Sans objet (pivot P2P) : l'ancienne porte G0 (commission acceptée par des agences, OQ-MK-07), les polices flotte (OQ-MK-05), le contrat-cadre et le mandat d'opérations PSP, la caution restituée par une agence (forme initiale d'OQ-PAY-06) et les portes G1a, G1b et G2 de la version 4 : les avis correspondants sont repris ci-dessus comme conditions de mise en service.

## A.7 Exigences non fonctionnelles globales (NFR)

| ID | Domaine | Exigence | Vérification |
|---|---|---|---|
| NFR-01 | Argent | Tous les montants en **unités mineures entières** (`Money{amount_minor, currency}`), aucun flottant ; arrondi `roundHalfUp` par ligne, `allocHost` pour la jambe `HOST` (égalité exacte en faveur de la plateforme) ; taxe calculée par ligne puis sommée (BR-PRICE-14, BR-CXL-06) ; **Σ jambes = montant de chaque opération**, aucune jambe négative (`LEG_AMOUNT_NEGATIVE`), jamais de prorata (08 E7) | tests T40–T43, TA06, TJ01–TJ21 (`tools/check_legs.py`) |
| NFR-02 | Temps | Horodatages stockés en UTC + fuseau IANA du véhicule (`America/Panama`, `America/Asuncion`) ; toutes les fenêtres calculées côté serveur dans le fuseau du véhicule, horloge de la base `platform.now()` (BR-CXL-00, EC-33) | tests de bornes T02, T15 |
| NFR-03 | Idempotence | Toute commande à effet (paiement, remboursement, versement, ajustement de jambe, notification, transition d'état) porte une clé d'idempotence ; les webhooks sont dédupliqués ; un rejeu ne produit aucun double effet (BR-BOOK-10, EC-29, EC-54) | tests T51, T52 |
| NFR-04 | Concurrence | Contrainte d'exclusion sur l'occupation véhicule × intervalle ; conversion gardée du hold `CHECKOUT` ; aucune double réservation possible même sous charge concurrente (EC-51) | test de course (C1–C20) |
| NFR-05 | Sécurité | 2FA TOTP pour les rôles internes ; RBAC côté serveur et RLS `ENABLE` + `FORCE` sur toutes les tables (RLS-1 à RLS-28), aucun rôle applicatif `BYPASSRLS` ; isolation stricte entre comptes d'hôte (IDOR) ; référentiel OWASP ASVS niveau 2 ; secrets du PSP de Kmino dans un coffre / KMS, rotation documentée ; décisions FINANCE et interrupteurs à deux personnes (ADM-033, ADM-032, 17 §2.3) | rapport ADM-033 |
| NFR-06 | PCI DSS | Paiement uniquement par page ou champs hébergés du PSP (SAQ A visé) ; aucune donnée de carte stockée ni transitée (PAY-001) | revue ADM-033 |
| NFR-07 | Données personnelles | Ley 81/2019 et Ley 7593/2025 : consentements versionnés (LEG-002), consentement biométrique séparé (VER-004), registre et procédure de violation (LEG-010), journal des accès aux dossiers KYC et photos (ADM-032) ; **minimisation entre particuliers** : l'hôte voit le prénom, la photo, l'âge, la note et le statut de vérification du voyageur, jamais le numéro de permis ni l'image de la pièce (`host_guest_v`, VER-015) ; l'adresse exacte du lieu de remise n'est montrée qu'après confirmation et retirée de la vue du voyageur à la fin du trip + `review_window_days` ; données de préproduction synthétiques (ADM-034) | revue LEG-010 |
| NFR-08 | Audit | Journal d'audit en ajout seul pour toute action interne et tout changement d'interrupteur (qui, quoi, avant/après, quand, motif), conservé 5 ans sous réserve d'OQ-BR-25 (ADM-001) | test d'immuabilité |
| NFR-09 | Disponibilité / reprise | RPO ≤ 24 h, RTO ≤ 8 h (À DÉCIDER, ADM-035) ; sauvegardes quotidiennes chiffrées, test de restauration avant ouverture | rapport de restauration |
| NFR-10 | Environnements | Dev, préproduction, production séparés ; déploiement par pipeline avec migrations versionnées et retour arrière testé (ADM-034) ; aucun adaptateur `FAKE` actif en production | retour arrière exécuté ; C19 |
| NFR-11 | Langues | es (es-PA, es-PY) et en sur 100 % des chaînes, notifications, contrats et pages légales, livrés en même temps (DEC-FONDATEUR-11) ; aucune chaîne en dur ; clé manquante = échec du build ; version espagnole fait foi (I18N-003) | test automatisé de mélange de langues |
| NFR-12 | Mobile et connectivité | Parcours du voyageur et **espace hôte** utilisables à une main sur mobile (PWA ou enveloppe native selon TRP-056) ; photos compressées ≈ 1 600 px, ≤ 500 ko ; hors ligne de la remise et du retour au lot 5 (TRP-057) | grille d'appareils TRP-056 |
| NFR-13 | Performance | Recherche et fiche : réponse serveur ≤ 1 s au 95e centile (PROPOSÉ) ; occupation visible au calendrier ≤ 5 s (CAL-001) ; trip visible dans l'espace hôte ≤ 1 min (HDB-002) | test de charge simple |
| NFR-14 | Accessibilité | WCAG 2.2 niveau AA visé sur les parcours du voyageur et de l'hôte (PROPOSÉ ; dont 2.4.11 et 2.5.7, 10b §3.10) ; cibles tactiles de 48 px ; texte alternatif des photos (LST-002) | audit manuel |
| NFR-15 | Observabilité | Monitoring disponibilité, erreurs, files de notifications, webhooks PSP en échec, écarts de rapprochement par jambe, alertes (ADM-032) | alertes testées |
| NFR-16 | Paramétrage | Aucune valeur propre à un pays codée en dur ; toute valeur métier est un paramètre pays daté (`valid_from`), non rétroactif, figé dans le devis ; interrupteurs de mise en service absents = `false` (ADM-014, ADM-031, ADM-027) | revue de code |
| NFR-17 | Traçabilité | Chaque trip permet de retrouver la version exacte de chaque document accepté, du devis, des jambes, du contrat et des photos (LEG-002, PRC-025, CLM-034) | test de reconstitution |

## A.8 Conventions des fiches

**Modules génériques** (la correspondance exacte avec les modules techniques est dans 17) :

| Module générique | Codes 04 |
|---|---|
| Identité & vérification | ACC, VER |
| Catalogue & recherche | SRC, LST |
| Disponibilité & co-hôtes | CAL, FLT (FLT-001 co-hôtes, P1 ; les autres lignes FLT sont hors produit ou P1) |
| Réservation & contrat | BKG |
| Tarification & devis | PRC |
| Paiements | PAY |
| Opérations de trip | TRP |
| Communication & réputation | MSG, NTF, REV |
| Espace hôte & annonces | HST, HDB |
| Sinistres & protection | CLM, PRT |
| Back-office & exploitation | ADM, SUP |
| Finance & versements | FIN, PYO |
| Légal, données & localisation | LEG, I18N |
| Design & transmissibilité | DSN, PLT |

**Rôles** (rubrique Permissions ; noms de 17 §2.3, dont la matrice de permissions fait foi) : `GUEST` ; `P2P_HOST` (hôte particulier vérifié, titulaire de son compte d'hôte, activable seulement si les interrupteurs du pays le permettent) ; `CO_HOST` (portée `vehicle_scope`, P1 sauf story) ; `SUPPORT_AGENT`, `OPS_AGENT`, `FINANCE`, `ADMIN`, `SUPERADMIN` (bris de glace, double validation) ; `SYSTEM`. Une même personne peut être voyageur et hôte, mais ne réserve jamais sa propre voiture (`self_booking_forbidden` = `true`, OQ-P2P-09). L'hôte ne lit que la jambe `HOST` de ses trips, par le titulaire seulement (RLS-28). En première ouverture, `GUEST`, `P2P_HOST`, `OPS_AGENT` et `ADMIN` sont actifs (ADM-001 SIMPLIFIÉ). Historique (sans objet, DEC-FONDATEUR-13) : les rôles d'organisation de la version 4.

**Erreurs** : codes stables en `SCREAMING_SNAKE_CASE` **sans préfixe**, comme 08 BR-BOOK-11 et 17 (`409 VEHICLE_UNAVAILABLE`, `409 SETTLEMENT_EXISTS`, `409 INVALID_TRANSITION`) ; les codes de BR-BOOK-11 (`ACCOUNT_NOT_APPROVED`, `AGE_CLASS_MISMATCH`, `GUEST_OVERLAP`, `VEHICLE_RESTRICTED`…) sont repris tels quels ; message localisé es/en, jamais de détail technique au voyageur ni à l'hôte. Ce paragraphe est le **catalogue de référence** cité par 17 §4.5 (« 16 A.8 » ; 17 parle aussi de « 16 C.2 »). **Codes de la révision P2P** :

| Code | Origine | Quand |
|---|---|---|
| `LEG_AMOUNT_NEGATIVE` | 08 E7 règle 5, 17 | une jambe d'une capture ou d'un état réglé serait négative (code promo au-delà du plafond, TJ13) : opération refusée |
| `LEG_SUM_MISMATCH` | 17 §2.8 | Σ jambes ≠ montant de l'opération : commande refusée avant l'appel au PSP |
| `LEG_ALREADY_RELEASED` | 08 E7 règle 3 bis, 17 | réaffectation ou débit d'une jambe déjà libérée : avance de Kmino et créance au `host_ledger` (TJ18) |
| `DEPOSIT_RAIL_UNAVAILABLE` | 08 BR-PAY-06, T59 | aucun rail de caution valide pour la durée du trip : refus **affiché avant le paiement** |
| `HOST_PAYOUT_RAIL_UNAVAILABLE` | 08 Règle de blocage, 17 §0.1 | pays sans `SUPPORTS_B2C_PAYOUT` validée ou `p2p_private_hosts_enabled[pays]` = `false` : activation de l'hôte refusée |
| `INSURER_CONTRACT_INACTIVE` | 08 Règle de blocage, 17 §0.1 | `insurer_contract_active[pays]` = `false` : activation de l'hôte et vente de protection refusées |
| `SELF_BOOKING_FORBIDDEN` | PROPOSÉ (OQ-P2P-09) | réservation de sa propre voiture, y compris par un compte lié |
| `HOST_NOT_ACTIVATED` | PROPOSÉ | action d'hôte (publication, acceptation) avant l'activation du compte d'hôte |
| `HOST_ENTITY_NOT_ALLOWED` | PROPOSÉ (BR-ACC-06) | inscription d'une personne morale comme hôte |
| `HOST_UNDER_AGE` | PROPOSÉ (OQ-P2P-01) | âge < `host_min_age_years` |
| `HOST_TAX_ID_REQUIRED` | PROPOSÉ (OQ-P2P-07) | numéro fiscal manquant quand `p2p_host_requires_tax_id[pays]` = `true` |
| `HOST_SANCTIONS_HIT`, `HOST_SCREENING_MISSING` | PROPOSÉ (VER-028) | résultat positif ou absent du contrôle de sanctions de l'hôte |
| `VEHICLE_LENDER_CONSENT_REQUIRED` | PROPOSÉ (OQ-BR-28) | véhicule financé sans consentement écrit du créancier |
| `VEHICLE_TITLE_MISMATCH`, `VEHICLE_VIN_MISMATCH`, `VEHICLE_TITLE_FORBIDDEN`, `VEHICLE_DOCUMENT_REQUIRED` | PROPOSÉ (BR-LIST-01 à 03) | documents du véhicule non conformes |
| `PROTECTION_LEVEL_NOT_ELIGIBLE`, `PROTECTION_LEVEL_REQUIRED`, `INSURER_RC_BELOW_MINIMUM`, `EARNINGS_PLAN_NOT_AVAILABLE` | PROPOSÉ (BR-PROT) | protection ou plan de gains non éligibles |
| `REVIEW_TEXT_REQUIRED`, `REVIEW_ALREADY_SUBMITTED`, `MESSAGE_THREAD_CLOSED` | PROPOSÉ (BR-REVIEW, MSG-001) | avis et messagerie |
| `GO_LIVE_SECOND_APPROVER_REQUIRED`, `GO_LIVE_DECISION_REF_REQUIRED`, `LOCAL_NOTICE_MISSING` | PROPOSÉ (ADM-027, LEG-021) | changement d'interrupteur sans second approbateur distinct ou sans référence de décision ; avertissement local manquant |
| `INVOICE_WITHOUT_TRIP` | PROPOSÉ (FIN-018) | document fiscal sans trip rattaché |
| `REQUEST_EXPIRED`, `REQUEST_MODE_NOT_ALLOWED` | PROPOSÉ (HDB-002, OQ-P2P-10) | réponse de l'hôte après l'heure limite de 4 h ; mode `REQUEST` sur une annonce aéroport |
| `PENDING_ACTIVATION` | PROPOSÉ (19 US-123, US-058 ; fiche HST-049) | statut, pas un refus : dossier d'hôte approuvé alors que `p2p_private_hosts_enabled[pays]` = `false` ; l'hôte reste en attente d'activation (fail-closed), avec une explication en es et en |
| `VEHICLE_NOT_COVERED` | PROPOSÉ (19 US-124, repris de l'ancien US-108 ; fiche HST-019) | véhicule hors des critères du contrat de l'assureur partenaire (âge, valeur, usage) : soumission refusée |

**Action de console** (PROPOSÉ, 19 US-107, US-058) : pendant la bêta fermée, l'ops peut **créer un compte d'hôte** (`organization` `P2P_HOST_INDIVIDUAL` et `membership` `P2P_HOST` titulaire) par une `manual_action` motivée et journalisée (ADM-001, ADM-004) ; la vérification (`host_verification`, US-123) et les interrupteurs du pays s'appliquent ensuite comme pour une inscription en libre-service. Le code de cette action est à ajouter au catalogue de 17 §10.

Supprimés (sans objet, pivot P2P) : `AGENCY_LINK_LIMIT` et les codes propres au paiement par lien, au mandat, au KYB et à la police de l'ancienne version.

**Notifications** : les `EVT_…` des fiches sont des **clés de gabarit** du catalogue NTF-001, pas des événements de domaine ; chaque gabarit est déclenché par un événement canonique de 17 §4.5 (correspondance en A.8.2) ; canal WhatsApp si gabarit approuvé (NTF-002), sinon SMS (urgent) ou email (documents) ; chaque gabarit existe en espagnol et en anglais.

**Confiance** : `confirmé` = OBSERVÉ ou DIRECTEMENT TESTÉ chez Turo (sans transaction réelle) ; `documenté` = documentation Turo (centre d'aide, CGU) ; `inféré` = déduit ; `proposé` = notre conception, sans équivalent Turo. Quand la base Turo est documentée mais que notre adaptation est substantielle, la fiche l'indique.

**Bêta pilote** (nom technique de la rubrique, lu « tranche des lots 0 à 4 de la bêta P2P ») : valeur de la colonne `beta_pilote` de 04 révision 6 ; pour SIMPLIFIÉ et MANUEL, la procédure reprend la note de 04. Aucune agence pilote n'existe.

**Priorité produit** : `P0-A` (nom technique de la phase MVP = bêta P2P) suivi du ou des lots de 04 (`lot_p0a`).

**Complexité** : barème de 04 README §1 bis (faible 0,5–1,5 j-agent ; moyenne 1,5–2,5 ; élevée 3–8), plus `effort_ops` et `risque_legal_financier`.


### A.8.2 Noms canoniques (17 v6) et correspondance des notifications

Les noms des versions antérieures de ce PRD ont été remplacés dans tout le document par ceux de 17 v6. Les noms de données restés descriptifs dans une fiche (par ex. `no_show`, `risk_flag`, `penalty_line`, `cost_bearer`, `late_fee_grid`, `handover_location`, `vehicle_earnings_plan`) n'ont pas d'équivalent exact dans 17 : le nom de 17 §3.2 le plus proche fait foi au moment du code, et tout ajout passe par 17. Les lignes marquées « sans objet » sont **historiques** : elles servent à lire les anciennes versions.

| Nom des versions 1 à 4 | Nom canonique (17 v6) |
|---|---|
| `hold(…)` | `checkout_hold` (`kind` = `CHECKOUT` seul ; `status` `ACTIVE` / `PAYMENT_IN_FLIGHT` / `CONVERTED` / `EXPIRED` / `RELEASED` / `COMPENSATED` ; revue UXQ-08 = `review_required`) ; le `kind` `AGENCY_LINK` est sans objet |
| `vehicle_occupancy.type` (dont `ICAL`) | `vehicle_occupancy.kind ∈ {TRIP, HOLD, HOST_BLOCK, BUFFER}` + `source` |
| `company`, `company_id` | `organization` de type `P2P_HOST_INDIVIDUAL` (compte d'hôte, une personne physique), `org_id` |
| `payment_intent` | `payment_operation` + `payment_operation_leg` (montants par jambe) |
| `fleet_policy`, `insurance_policy`, `insurance_policy_vehicle` | sans objet ; `insurer`, `insurer_contract` (assureur partenaire, par pays) et éligibilité du véhicule |
| `framework_contract`, `master_agreement` | sans objet ; CGU de l'hôte (LEG-001) et contrat de location hôte–voyageur (`generated_document`) |
| `mandate`, `psp_mandate`, `psp_credential_use_log` | sans objet ; compte marchand de Kmino et `psp_submerchant` |
| `psp_gate` | porte PAY-041 + `psp_capability` (capacités bloquantes de 17 §2.8) |
| `identity_key` | `identity_document.number_bidx` |
| `upload_queue` | port `OfflineQueue` + `file_asset` |
| `deposit_record`, `counter_deposit_record` | sans objet ; caution = `payment_operation` de type `DEPOSIT_AUTH` sur le compte de Kmino |
| `payment_confirmation`, `agency_payment_confirmation` | sans objet ; preuve = `webhook_inbox` (signé) ou `getOperation` |
| `webhook_event` | `webhook_inbox` |
| `refund`, `agency_refund_task` | `refund_instance` (exécuté par Kmino, par jambe) ; la tâche de remboursement par un tiers est sans objet |
| `invoice` (commission) | `fiscal_document` (facture du trip fee, reçu des frais de l'hôte, avoir) |
| `statement`, `commission_statement`, `commission_rate_bps` | `host_earnings_statement` / `host_earnings_line` ; part de l'hôte = `hostSharePctFrozen` (plan) |
| `recon_run` | `reconciliation_run` (par jambe) |
| `import_job`, `fleet_import_job` | sans objet ; ajout de voiture par l'assistant (HST-005) |
| `screening` | `sanctions_screening` |
| `kyb_document`, `kyb_case`, `beneficial_owner` | sans objet ; `host_verification` + `file_asset` |
| `contract` | `generated_document` |
| `trip_photo` | `trip_inspection` + `inspection_photo` + `file_asset` |
| `host_ledger` | `host_ledger_state` + `journal_line` ; avance de Kmino `platform_advance` |
| `payout` | `payout_batch` / `payout_item` (lots par hôte, devise et type) |
| `idempotency_record` | `payment_operation.idempotency_key`, `inbox_receipt` |
| `AGENCY_COUNTER`, `SUPPORT`, `OPS` | `SUPPORT_AGENT`, `OPS_AGENT` ; les rôles `AGENCY_*` sont sans objet, remplacés par `P2P_HOST` et `CO_HOST` |
| `billing_day_tolerance_minutes` | `grace_minutes` (29) |
| `late_grace_minutes` | `overdue_detection_minutes` (30) |
| `free_cxl_hours` | `free_cancel_lead` |
| `agency_cxl_penalty_gt24h` / `_le24h` | `host_penalty` (paliers ; retenue sur les gains de l'hôte) |
| `business_name`, `trade_name` | sans objet (l'hôte s'affiche par son prénom) |
| `legal_last_names` | `legal_last_name` |
| `supports_*` | capacités `SUPPORTS_*` de `psp_capability` ; `SUPPORTS_SINGLE_USE_LINK` → `SUPPORTS_SINGLE_USE_ORDER` |
| `agency_link_hold_minutes`, `p0a_ineligible_no_show_outcome`, `agency_payment_dual_confirm_minor`, `agency_refund_deadline_business_days` | sans objet (17 §7.2) |
| `flagged_booking_payment_order` = `REVIEW_BEFORE_LINK` | `REVIEW_BEFORE_CHARGE` |
| `ERR_…` | codes sans préfixe (A.8) |

**Clés de gabarit de notification → événement de domaine de 17 §4.5** (« — » : aucun événement de domaine ; seul `EVT_OTP_CODE` reste sans événement, par conception : envoi synchrone) :

| Gabarit | Événement déclencheur (17 §4.5) |
|---|---|
| `EVT_ACCOUNT_RECHECK_REQUIRED` | `kyc.verification.status_changed` |
| `EVT_ACCOUNT_RESTRICTED` | `iam.restriction.applied` |
| `EVT_ACCOUNT_UNDER_REVIEW` | `risk.review.required` |
| `EVT_BOOKING_CANCELLED` | `trip.status_changed` (→ CANCELLED_*) |
| `EVT_BOOKING_CANCELLED_BY_HOST` | `trip.status_changed` (`HOST_CANCELLED`) |
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
| `EVT_CONTRACT_SIGNED` | `contract.document.signed` |
| `EVT_CREDIT_ISSUED` | `support.commercial_gesture.issued` |
| `EVT_DEPOSIT_AUTHORIZED` | `payment.operation.status_changed` (`DEPOSIT_AUTH`) |
| `EVT_DEPOSIT_RELEASED` | `deposit.decision.executed` |
| `EVT_DISPUTE_DECIDED` | `dispute.decided` |
| `EVT_DOCUMENT_REQUESTED` | `kyc.verification.status_changed` ou claim.status_changed |
| `EVT_EARNINGS_STATEMENT_ISSUED` | `finance.statement.issued` |
| `EVT_EMAIL_VERIFICATION` | `iam.user.registered` |
| `EVT_EVIDENCE_READY` | `evidence.bundle.generated` |
| `EVT_HOST_ACTIVATED` | `iam.organization.status_changed` (compte d'hôte) |
| `EVT_HOST_BALANCE_NEGATIVE` | `host_ledger.state_changed` |
| `EVT_HOST_DEBT_OPENED` | `settlement.advance.opened` |
| `EVT_HOST_SUSPENDED` | `iam.organization.status_changed` |
| `EVT_HOST_VERIFICATION_DECISION` | `host_verification.decided` (17 §3.2.2) |
| `EVT_ICAL_CONFLICT` | `booking.ical.conflict_detected` (P1 ; iCal hors produit en bêta) |
| `EVT_INSURER_BORDEREAU_ISSUED` | `insurer.bordereau.issued` |
| `EVT_INVOICE_REMINDER` | `invoice.status_changed` |
| `EVT_INVOICE_TO_GUEST` | `invoice.status_changed` |
| `EVT_KYC_APPROVED` | `kyc.verification.status_changed` |
| `EVT_KYC_MORE_INFO` | `kyc.verification.status_changed` |
| `EVT_KYC_REJECTED` | `kyc.verification.status_changed` |
| `EVT_LISTING_APPROVED` | `catalog.listing.status_changed` |
| `EVT_LISTING_REJECTED` | `catalog.listing.status_changed` |
| `EVT_LISTING_RESTRICTED` | `catalog.listing.status_changed` |
| `EVT_MESSAGE_FLAGGED` | `message.flagged` |
| `EVT_NEW_MESSAGE` | `message.posted` |
| `EVT_NO_SHOW_DECLARED` | `trip.cancellation.qualified` |
| `EVT_OFFLINE_SKEW` | `trip.offline.clock_skew_detected` |
| `EVT_OTP_CODE` | — (envoi synchrone `otp_challenge`) |
| `EVT_PAYMENT_CAPTURED` | `payment.operation.status_changed` |
| `EVT_PAYMENT_MISMATCH` | `payment.operation.status_changed` (montant ou jambes ≠ devis) |
| `EVT_PAYOUT_FAILED` | `payout.batch.status_changed` |
| `EVT_PAYOUT_ON_HOLD` | `payout.batch.status_changed` (`ON_HOLD`, dont `payouts_enabled[pays]` = `false`) |
| `EVT_PAYOUT_SENT` | `payout.batch.status_changed` |
| `EVT_PICKUP_REMINDER` | minuterie `scheduled_job` T−24 h |
| `EVT_POST_TRIP_CHARGED` | `payment.operation.status_changed` |
| `EVT_POST_TRIP_CHARGE_NOTICE` | `invoice.status_changed` |
| `EVT_PSP_FAILURE` | `payment.operation.status_changed` (`FAILED`) |
| `EVT_RECON_DISCREPANCY` | `finance.reconciliation.delta_exceeded` |
| `EVT_REFUND_CONFIRMED` | `refund.instance.status_changed` (`CONFIRMED`) |
| `EVT_REFUND_PLANNED` | `refund.instance.status_changed` (`PLANNED`) |
| `EVT_RETURN_REMINDER` | minuterie `scheduled_job` avant la fin |
| `EVT_REVIEW_INVITATION` | `trip.checkout.completed` |
| `EVT_REVIEW_PUBLISHED` | `review.published` |
| `EVT_REVIEW_SLA_BREACH` | `support.review_queue.sla_breached` |
| `EVT_TERMS_UPDATED` | `legal.document_template.published` |
| `EVT_TRIP_FEE_INVOICE_ISSUED` | `fiscal.document.status_changed` |
| `EVT_TRIP_OVERDUE` | `trip.overdue.detected` |
| `EVT_UNRETURNED_ESCALATION` | `trip.overdue.escalated` |
| `EVT_VEHICLE_DOCUMENT_EXPIRING` | `catalog.vehicle_document.expiring` |
| `EVT_VEHICLE_REFUSED` | `trip.cancellation.qualified` |

Gabarits sans objet (pivot P2P, historiques) : `EVT_AGENCY_BALANCE_NEGATIVE` (→ `EVT_HOST_BALANCE_NEGATIVE`), `EVT_BOOKING_CANCELLED_BY_AGENCY` (→ `EVT_BOOKING_CANCELLED_BY_HOST`), `EVT_COMMISSION_INVOICE_ISSUED` (→ `EVT_TRIP_FEE_INVOICE_ISSUED`), `EVT_COMMISSION_STATEMENT_ISSUED` (→ `EVT_EARNINGS_STATEMENT_ISSUED`), `EVT_KYB_DECISION` (→ `EVT_HOST_VERIFICATION_DECISION`), `EVT_ORGANIZATION_ACTIVATED` (→ `EVT_HOST_ACTIVATED`), `EVT_ORGANIZATION_SUSPENDED` (→ `EVT_HOST_SUSPENDED`), `EVT_ORGANIZATION_INVITED`, `EVT_TEAM_INVITE` (co-hôtes, P1), `EVT_MANDATE_REVOKED`, `EVT_MASTER_AGREEMENT_TO_SIGN`, `EVT_PAYMENT_CONFIRMATION_REQUIRED`, `EVT_REFUND_OVERDUE`, `EVT_IMPORT_DONE`, `EVT_POLICY_EXPIRED`, `EVT_POLICY_EXPIRING`, `EVT_ICAL_FAILING`. Les événements correspondants restés dans 17 §4.5 (`kyb.case.decided`, `insurance.policy.status_changed`) sont à retirer par une prochaine révision de 17 (écart noté dans la passation US-057).

### A.8.1 Vecteurs de test monétaires

- **T01–T27** (règlement d'annulation), **T28–T48** (exécution, multi-moyens, arrondis, PYG), **T49–T65** (supersession, chargeback, caution, ré-autorisation), **T69–T73** (déclencheurs de la caution, (révisé 2026-11-12, caution comme Turo)), **T66–T68** (imputation incrémentale des remboursements, chargeback sur remboursement bloqué, `attempt_no` des débits) : `08_BUSINESS_RULES.md`. Ils sont définis avec la **configuration de test** de 08 (parts 75 %, trip fee F, protection, `tax_line_config` de test) et valident le **moteur** de règlement (fonction pure). Toutes leurs colonnes s'appliquent au modèle P2P, y compris « Gains hôte » (= jambe `HOST` retenue) et « Net plateforme ». T17, T18, T20 et T61 dépendent de **DEC-FONDATEUR-01** (option A = `true` explicite ; option B = défaut).
- **TJ01–TJ21** (jambes explicites, USD et PYG, cas à une unité mineure) : 08 E7, valeurs produites par `tools/check_legs.py` ; ils valident les **montants par jambe** de chaque opération (capture, capture partielle, règlement, encaissement partiel, chargeback, cascade entre opérations, réaffectation, jambe déjà libérée, crédits). Les parts de l'assureur 7/10 et 1/2 sont des **valeurs de test**.
- **TA01–TA11** (propres à ce PRD, **PROPOSÉS**). TA01 à TA07 et TA09 gardent la configuration simplifiée « PA1 » (pas de trip fee, pas de protection, ITBMS 7 % sur le loyer seul) et donnent désormais la **jambe `HOST`** (`allocHost(retenu HT × 3/4)`, plan `ESTÁNDAR`) et la **jambe `PLATFORM`** (complément, taxe retenue comprise) au lieu de la commission de la version 4 ; recalculés le 2026-11-02 par un script `python -I` indépendant (Fractions, `roundHalfUp`, `allocHost`). TA08, TA10 et TA11 sont **remplacés** par des critères alignés sur les vecteurs par jambe TJ de 08 (passation US-055) : ils ne recalculent rien et renvoient aux valeurs de `tools/check_legs.py`. Règles appliquées : BR-CXL-01, BR-CXL-06 (j = 1 si > 2 jours, ½ sinon), BR-CXL-08 (no-show j = 2 si > 2 jours), BR-CXL-13 (annulation par l'hôte), taxe remboursée au prorata de la base taxable remboursée, 08 E7.

| # | Entrées | Résultat attendu |
|---|---|---|
| TA01 | Trip PA1 : 3 j, loyer 120,00, ITBMS 7 % = 8,40, total **128,40** ; annulation guest à T−2 j (≤ freeUntil) | remboursement 128,40 ; jambes retenues `HOST` 0,00, `PLATFORM` 0,00 |
| TA02 | PA1, annulation guest à T−10 h | retenu loyer 40,00 ; remboursement **85,60** (dont ITBMS 5,60) ; conservé TTC 42,80 = `HOST` **30,00** + `PLATFORM` **12,80** (10,00 + ITBMS retenu 2,80) ; équilibre 85,60 + 40,00 + 2,80 = 128,40 |
| TA03 | PA1, no-show guest déclaré par un hôte éligible (j = 2) | retenu 80,00 ; remboursement **42,80** (ITBMS 2,80) ; conservé 85,60 = `HOST` **60,00** + `PLATFORM` **25,60** |
| TA04 | PA1, **annulation par l'hôte** à T−30 h, puis à exactement T−24 h (BR-CXL-13) | remboursement intégral 128,40 dans les deux cas, exécuté par Kmino ; pénalité de l'hôte = `host_penalty` palier « > 24 h » puis palier « ≤ 24 h » (17 §7.2 ; valeurs ADM-031 **À DÉCIDER** ; valeurs de test 25,00 / 50,00 = référence Turo) **retenue sur ses gains** au `host_ledger`, jamais une jambe du trip ; borne : 24 h exactement → valeur « ≤ 24 h » |
| TA05 | Trip PA2 : 2 j, loyer 80,00, ITBMS 5,60, total 85,60 ; annulation guest à T−10 h (j = ½) | retenu 20,00 ; remboursement **64,20** (ITBMS 4,20) ; conservé 21,40 = `HOST` **15,00** + `PLATFORM` **6,40** |
| TA06 | Trip PA3 : 1 j, loyer 45,01, ITBMS roundHalfUp(315,07) = 3,15, total 48,16 ; annulation guest à T−10 h (j = ½) | retenu roundHalfUp(2 250,5) = **22,51** ; ITBMS remboursé roundHalfUp(315 × 2 250 / 4 501 = 157,46) = 1,57 ; remboursement **24,07** ; conservé 24,09 = `HOST` `allocHost(1 688,25)` = **16,88** + `PLATFORM` **7,21** |
| TA07 | Jours facturables, tolérance `grace_minutes` = 29 (valeur de 04 et 17 §7.2, **valeur de test provisoire tant qu'OQ-BR-04 est ouverte**) : 3 j 29 min ; 3 j 30 min ; 4 h | **3** ; **4** ; **1** (formule max(1, ceil((fin − début − tolérance)/24 h))). Si le fondateur retient une autre frontière, seul le paramètre change ; le test est paramétré et ses valeurs attendues sont recalculées |
| TA08 | **Remplacé (version 5)** : jambes d'une capture et d'un règlement, au lieu du relevé de commission de la version 4 (sans objet) — trip A de 08 en USD (TJ01, TJ02a, TJ02b), trip D en PYG (TJ08a, TJ08b), trip J en PYG à une unité mineure (TJ10a, TJ10b) et contre-exemple au prorata (TJ10c) | capture TJ01 : `HOST` 131,25, `INSURER` 25,50, `TAX_THIRD_PARTY` 0,00, `PLATFORM` 99,91, total 256,66 ; règlement T03 (TJ02b) : variations −86,25 / −25,50 / 0,00 / −75,69, Σ = −187,44 = − remboursement ; TJ08a : 787 500 / 105 000 / 0 / 545 550 = 1 438 050 PYG ; TJ10b : `HOST` −500 001 (`allocHost` à égalité exacte → 250 000 retenus) ; une ventilation au prorata par le PSP (TJ10c) est **refusée** (écart de 68 535 PYG sur la jambe `HOST`) ; encaissements partiels et crédits : TJ19, TJ20, TJ21 |
| TA09 | Plafond de crédit commercial ADM-007 non décidé (défaut 0) ; un agent OPS tente un crédit de 10,00 | refus `CREDIT_CAP_EXCEEDED`, action journalisée ; au-delà, un crédit imputé à la capture reste plafonné à la jambe `PLATFORM` (TJ21) |
| TA10 | **Remplacé (version 5)** : capture partielle **par jambe** d'une autorisation non capturée (PAY-006 ; T28, TJ03), au lieu de l'autorisation en mode « sous mandat » de la version 4 (sans objet) — trip A, autorisation 256,66 non capturée, annulation guest à T−10 h (j = 1, règlement = T03) | capture partielle de `owed` **69,22** portant directement les jambes retenues (TJ02a) : `HOST` **45,00**, `INSURER` 0,00, `TAX_THIRD_PARTY` 0,00, `PLATFORM` **24,22** ; `VOID` **187,44** ; aucun remboursement ensuite ; contrôle 69,22 + 187,44 = 256,66 ; une commande dont Σ jambes ≠ 69,22 est refusée (`LEG_SUM_MISMATCH`) |
| TA11 | **Remplacé (version 5)** : no-show d'un voyageur quand l'**hôte est inéligible** (pas de message tracé, 08 BR-CXL-08 ; T39, TJ05), au lieu des trois sorties de la variante d'agence de la version 4 (sans objet) — trip A capturé (TJ01), no-show j = 2 | jambes retenues (TJ05a) : `HOST` **0,00**, `INSURER` 0,00, `PLATFORM` **118,44** ; ordre de règlement (TJ05b) : `HOST` **−131,25**, `INSURER` **−25,50**, `TAX_THIRD_PARTY` 0,00, `PLATFORM` **+18,53** (réaffectation de la part de l'hôte, avant toute libération du versement, `SUPPORTS_PAYOUT_ADJUSTMENT`), Σ = −138,22 = − remboursement de **138,22** ; si la jambe `HOST` est déjà libérée : règle 3 bis (`LEG_ALREADY_RELEASED`, avance de Kmino et créance au `host_ledger`, TJ18). Défaut « comme Turo » PROPOSÉ ; avis consommation **OQ-BR-45** avant la mise en service |

---

# PARTIE B — Fiches FEATURE (MVP, bêta P2P ; phase technique P0-A)

Ordre : epics E1 à E18 de 04 README §4 (révision 6). Chaque fiche suit le format imposé (24 rubriques). Les fiches regroupées listent tous leurs `feature_id` dans la rubrique FEATURE ID. Les lignes `HORS` de 04 n'ont pas de fiche (partie C.4).

## E1 — Comptes, identité et KYC des voyageurs et des hôtes particuliers (P0-A, 15 lignes)

#### Fiche ACC-001 — Inscription par email et mot de passe
- **FEATURE ID** : ACC-001
- **Nom** : Inscription par email et mot de passe
- **Module** : Identité & vérification (ACC — Inscription)
- **Persona** : PER-01, PER-02 (visiteur qui devient guest) ; PER-08 (particulier qui crée son compte avant de devenir hôte, A01)
- **Objectif** : créer un compte unique et authentifiable, préalable à toute réservation et à toute inscription comme hôte.
- **Description** : formulaire prénom(s) et nom(s) tels que sur le permis (ACC-006), email, mot de passe, case CGU + confidentialité (LEG-001), opt-in marketing non pré-coché (LEG-002). Email vérifié par lien. Mot de passe haché (algorithme fixé dans 17). Un seul compte sert à voyager et à être hôte (comme chez Turo) ; le rôle `P2P_HOST` s'ajoute plus tard par HST-049, jamais par un second compte (ACC-014).
- **Déclencheur** : « Crear cuenta » / « Sign up » (clé `web.s15.signup` du catalogue de 10b §4.3, ajoutée en es, en et fr par US-060), tentative de réservation sans session, ou bouton `web.s14.becomeHost` « Publica tu auto » / « List your car » (A01) sans session.
- **Prérequis** : pages légales publiées (LEG-011) ; NTF-001 pour l'email.
- **Parcours principal** : 1) saisie ; 2) validation serveur (format email, mot de passe ≥ 10 caractères, PROPOSÉ) ; 3) compte `PENDING_EMAIL` ; 4) email de vérification ; 5) clic → `ACTIVE`, redirection vers VER-013 puis VER-001 (ou vers la liste de tâches de l'hôte A07 si l'inscription vient de A01).
- **Parcours alternatifs** : email déjà utilisé → réponse identique à un succès (anti-énumération) et email « vous avez déjà un compte » ; lien expiré (24 h, PROPOSÉ) → renvoi ; abandon → reprise à la connexion.
- **Règles métier** : BR-ACC-01 ; BR-ACC-03 (unicité, via ACC-014).
- **États** : SM-3 état initial `NOT_STARTED` ; compte `PENDING_EMAIL` → `ACTIVE` (PROPOSÉ).
- **Erreurs** : `AUTH_EMAIL_INVALID`, `AUTH_PASSWORD_WEAK`, `AUTH_TERMS_NOT_ACCEPTED`, `AUTH_LINK_EXPIRED`, `RATE_LIMITED`.
- **Données** : user_account(id, email, email_verified_at, password_hash, locale, created_at) ; consent (LEG-002).
- **Notifications** : `EVT_EMAIL_VERIFICATION` (email), langue du compte (es ou en).
- **Permissions** : public (création) ; rôle attribué `GUEST` ; `P2P_HOST` seulement après HST-049.
- **Dépendances** : aucune (LEG-001 en dépend).
- **Critères d'acceptation** : Given un visiteur, When il soumet un formulaire valide CGU cochées, Then un compte `PENDING_EMAIL` et un consentement versionné sont créés et l'email part en ≤ 1 min dans la langue choisie. Given CGU non cochées, When il soumet, Then `AUTH_TERMS_NOT_ACCEPTED` et aucun compte. Given un email existant, When il soumet, Then l'écran est identique à un succès.
- **Source** : 06 « Inscription » ; EV-0009 (rien soumis) ; écrans 10b : S15, A01.
- **Confiance** : confirmé (formulaire OBSERVÉ) ; vérification d'email et anti-énumération proposées.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : OUI.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : SSO Google/Apple, connexion par code (ACC-002 à ACC-004, P1).

#### Fiche ACC-006 — Nom légal identique au permis
- **FEATURE ID** : ACC-006
- **Nom** : Nom légal identique au permis
- **Module** : Identité & vérification (ACC — Identité)
- **Persona** : tous (guest et hôte)
- **Objectif** : concordance compte ↔ permis ↔ contrat hôte–voyageur ↔ constancia ↔ compte de versement de l'hôte.
- **Description** : champs `legal_first_name` et `legal_last_name` (texte, deux apellidos), libellé « tal como aparece en su licencia » / « as shown on your license ». Changement après approbation KYC = nouvelle revue. Pour un hôte, le nom légal doit aussi correspondre au titulaire du compte de versement (PYO-001) et au titre du véhicule ou à l'autorisation notariée (HST-049). Le voyageur et l'hôte voient l'un de l'autre le **prénom** seulement (minimisation, 17 §2.3).
- **Déclencheur** : inscription ; modification du nom.
- **Prérequis** : ACC-001.
- **Parcours principal** : saisie ; repris tel quel par VER-001 (comparaison du fournisseur), BKG-018 et LEG-026.
- **Parcours alternatifs** : nom différent du permis → `MORE_INFO_REQUIRED` ; modification après approbation → `RECHECK`, remise des trips bloquée jusqu'à décision ; pour un hôte, `RECHECK` suspend aussi l'activation (`host_verification` en `IN_REVIEW`) et les versements (lots `ON_HOLD`) (PROPOSÉ).
- **Règles métier** : BR-ACC-07.
- **États** : SM-3 `APPROVED` → `RECHECK`.
- **Erreurs** : `PROFILE_NAME_REQUIRED`, `PROFILE_NAME_LOCKED_PENDING_REVIEW`.
- **Données** : user_account.legal_first_name, user_account.legal_last_name, name_changed_at.
- **Notifications** : `EVT_ACCOUNT_RECHECK_REQUIRED`.
- **Permissions** : `GUEST`, `P2P_HOST` (son profil) ; `OPS_AGENT` (correction journalisée).
- **Dépendances** : aucune (VER-001 en dépend).
- **Critères d'acceptation** : Given un compte approuvé, When le nom change, Then SM-3 passe `RECHECK` et la remise des trips est bloquée. Given un contrat généré, When on le compare au compte, Then le nom est identique caractère pour caractère. Given un hôte actif, When son nom légal change, Then ses lots de versement passent `ON_HOLD` jusqu'à la nouvelle décision.
- **Source** : 06 « Inscription » ; 05 G-BOOK-01 ; écrans 10b : S15, S14.
- **Confiance** : confirmé (OBSERVÉ) ; double apellido et effet sur l'hôte proposés.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — champs nom/prénom avec mention « comme sur le permis » ; corrections par l'ops, journalisées.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : pré-remplissage par OCR du permis ; prénom d'usage affiché (BR-ACC-07).

#### Fiche ACC-014 — Un compte par personne
- **FEATURE ID** : ACC-014
- **Nom** : Un compte par personne (anti-doublon) et interdiction de l'auto-réservation
- **Module** : Identité & vérification (ACC — Anti-doublon)
- **Persona** : PER-07 (contrôle) ; PER-01, PER-02, PER-08 (effet)
- **Objectif** : empêcher les comptes multiples (contournement d'une restriction, fraude, EC-43) et empêcher un hôte de réserver son propre véhicule.
- **Description** : clés d'unicité hachées : email, téléphone E.164, n° de cédula/passeport, n° de permis, empreinte de carte si le PSP la renvoie. Collision → réservation bloquée, dossier en revue. Une même personne peut être voyageur et hôte avec **un seul compte** (comme chez Turo) ; elle ne peut jamais réserver un véhicule de son propre compte d'hôte, ni par un compte lié (même appareil, même carte, même pièce) : `self_booking_forbidden` = `true` (OQ-P2P-09, PROPOSÉ). Aucune compensation entre une dette de voyageur et des gains d'hôte sans accord écrit (OQ-P2P-09).
- **Déclencheur** : OTP (VER-013), approbation KYC (VER-001), pose du hold (BKG-014), paiement.
- **Prérequis** : VER-001.
- **Parcours principal** : nouvelle clé → recherche de collision → aucune : poursuite ; collision : `MANUAL_REVIEW` + signal ADM-029. À la pose du hold : le `org_id` du véhicule est comparé aux comptes d'hôte du guest et des comptes liés → refus si identique.
- **Parcours alternatifs** : numéro recyclé par l'opérateur → l'ops libère l'ancien après contrôle ; liens légitimes (même carte familiale) → décision ops tracée ; compte lié détecté après la réservation → trip annulé par la plateforme (BKG-035), remboursement intégral, compte en revue.
- **Règles métier** : BR-ACC-03 ; BR-VERIF-09 ; BR-TRUST-01 ; BR-TRUST-02.
- **États** : SM-3 `AUTO_CHECKS` → `MANUAL_REVIEW` (comptes liés).
- **Erreurs** : `ACCOUNT_DUPLICATE_PHONE`, `ACCOUNT_DUPLICATE_DOCUMENT`, `ACCOUNT_LINKED_REVIEW`, `SELF_BOOKING_FORBIDDEN` (PROPOSÉ).
- **Données** : `identity_document.number_bidx` (index aveugle HMAC, 17 §3.1.4) ; UQ partiel `user_account.phone_e164` sur numéro vérifié (17 §3.2.1) ; paramètre `self_booking_forbidden`.
- **Notifications** : `EVT_ACCOUNT_UNDER_REVIEW`.
- **Permissions** : `SYSTEM` (détection), `OPS_AGENT` (décision) ; la permission `booking.create` exclut toujours son propre véhicule (17 §2.3).
- **Dépendances** : VER-001.
- **Critères d'acceptation** : Given un numéro vérifié sur A, When B tente de le vérifier, Then `ACCOUNT_DUPLICATE_PHONE`. Given deux comptes au même n° de permis, When le second est approuvé par le fournisseur, Then il passe en revue et ne peut pas réserver. Given un hôte connecté, When il pose un hold sur un véhicule de son propre compte d'hôte, Then `SELF_BOOKING_FORBIDDEN` et aucun hold n'est créé. Given un compte lié à l'hôte par la même carte, When il tente la même réservation, Then `SELF_BOOKING_FORBIDDEN` et un signal ADM-029.
- **Source** : SRC_G 1.1.6 ; 11 EC-43 ; 22 OQ-P2P-09 ; écrans 10b : S15, S05.
- **Confiance** : documenté (principe) ; clés et auto-réservation proposées.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — clés email, téléphone et permis contrôlées par le serveur ; contrôle hôte / voyageur (`self_booking_forbidden`) à la pose du hold ; comptes liés (carte, appareil) repérés par l'ops à la revue KYC.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : empreinte d'appareil, fraude LATAM (SUP-019, P1).

#### Fiche VER-001 — Téléversement du permis recto/verso
- **FEATURE ID** : VER-001
- **Nom** : Téléversement du permis recto/verso
- **Module** : Identité & vérification (VER — Documents)
- **Persona** : PER-01, PER-02 ; PER-08 (KYC individuel de l'hôte, HST-049)
- **Objectif** : approbation de conduite avant le paiement ; identité vérifiée de l'hôte avant son activation.
- **Description** : photos du permis physique recto/verso (pas de scan ni de lien de stockage) via le parcours **hébergé** du fournisseur KYC (Metamap, Truora, Veriff : À VALIDER), qui inclut VER-002 et VER-005. Résultat reçu par webhook signé : référence, statut, scores, validité du permis. Aucune image dans la base applicative. Le build se fait contre l'adaptateur `FAKE` du port `IdentityProvider` (pièces PA et PY) ; connecteur réel au lot C (VER-029). Le même parcours sert au KYC individuel de l'hôte ; le PSP de place de marché fait en plus son propre KYC du sous-marchand (HST-049).
- **Déclencheur** : après OTP ; au plus tard avant le paiement (BKG-012) ; pour l'hôte, étape « identité » de la liste de tâches (A07).
- **Prérequis** : ACC-006 ; VER-004 ; registre LEG-010 validé avant production.
- **Parcours principal** : session fournisseur → capture → webhook → `AUTO_CHECKS` → `APPROVED` ou `MANUAL_REVIEW` (ADM-002) → notification.
- **Parcours alternatifs** : illisible → `MORE_INFO_REQUIRED` (sans réponse 15 j → `REJECTED`) ; permis expirant avant la fin du trip → refus au checkout ; webhook perdu → interrogation périodique du fournisseur (PROPOSÉ).
- **Règles métier** : BR-VERIF-01, BR-VERIF-02, BR-VERIF-04 (Turo : revue 24–48 h ; nous : SLA 4 h ouvrées), BR-VERIF-11.
- **États** : SM-3 `PHONE_VERIFIED` → `DOCS_SUBMITTED` → `AUTO_CHECKS` → `APPROVED` / `MANUAL_REVIEW` / `MORE_INFO_REQUIRED` ; `APPROVED` → `EXPIRED`.
- **Erreurs** : `KYC_SESSION_FAILED`, `KYC_DOCUMENT_UNREADABLE`, `KYC_LICENSE_EXPIRED`, `KYC_PROVIDER_UNAVAILABLE`.
- **Données** : `identity_verification`(user_id, provider, provider_session_ref, status, decision_reason_code, reviewed_by, approved_at, expires_at) ; `identity_document` (17 §3.2.2).
- **Notifications** : `EVT_KYC_APPROVED`, `EVT_KYC_MORE_INFO`, `EVT_KYC_REJECTED`.
- **Permissions** : `GUEST`, `P2P_HOST` (son dossier) ; `OPS_AGENT` (décision, accès journalisé ADM-032) ; l'hôte d'un trip ne voit que « vérifié / non vérifié » du voyageur, jamais le numéro ni l'image de la pièce (`host_guest_v`, 17 §2.3).
- **Dépendances** : ACC-006.
- **Critères d'acceptation** : Given `DOCS_SUBMITTED`, When le webhook signé « approved » arrive deux fois, Then une seule transition `APPROVED`. Given une signature invalide, When le webhook arrive, Then il est rejeté et journalisé. Given un permis expirant avant la fin du trip, When le guest paie, Then `KYC_LICENSE_EXPIRED`. Given l'hôte d'un trip, When il lit le dossier du voyageur, Then la réponse ne contient ni numéro de pièce ni image.
- **Source** : SRC_G 1.4.1–1.4.2 ; 17 §2.4 ; écrans 10b : S04, A07.
- **Confiance** : documenté ; fournisseur hébergé proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : OUI (parcours hébergé du fournisseur, adaptateur `FAKE` pendant le build).
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : vérification « par statut » (15 IMP-09).

#### Fiche VER-002 / VER-003 — Selfie avec liveness et face match
- **FEATURE ID** : VER-002, VER-003
- **Nom** : Selfie avec permis et liveness (VER-002) ; face match par prestataire tiers (VER-003)
- **Module** : Identité & vérification (VER — Biométrie)
- **Persona** : PER-01, PER-02, PER-08 (VER-002) ; PER-07 (VER-003)
- **Objectif** : prouver que le porteur du permis est la personne qui réserve, ou la personne qui s'inscrit comme hôte (EC-43).
- **Description** : VER-002 : selfie avec le permis à côté du visage, liveness actif (ajout proposé), dans la session du fournisseur. VER-003 : comparaison selfie ↔ photo du permis par le fournisseur ; la plateforme ne stocke que score, seuil et décision (scores C3). Même contrôle pour l'hôte que pour le conducteur (17 §2.4).
- **Déclencheur** : session KYC (VER-001).
- **Prérequis** : VER-004 ; LEG-010.
- **Parcours principal** : capture → liveness → face match → score ≥ seuil → `APPROVED` ; sinon `MANUAL_REVIEW`.
- **Parcours alternatifs** : échec de liveness → 2 nouvelles tentatives (PROPOSÉ) puis revue ; refus du consentement biométrique → pas de vérification, réservation et inscription comme hôte impossibles (message explicite).
- **Règles métier** : BR-VERIF-01 ; BR-VERIF-09 ; BR-VERIF-11.
- **États** : SM-3 `AUTO_CHECKS` → `APPROVED` / `MANUAL_REVIEW` ; `REJECTED` → `APPEAL` sous 15 j → `APPROVED` / `REJECTED_FINAL` ; fraude → `BANNED`.
- **Erreurs** : `KYC_LIVENESS_FAILED`, `KYC_FACE_MISMATCH`, `KYC_BIOMETRIC_CONSENT_MISSING`.
- **Données** : `liveness_check`(verification_id, liveness_score, face_match_score, result, provider_session_ref, retention_until) (17 §3.2.2).
- **Notifications** : comme VER-001.
- **Permissions** : `OPS_AGENT` (portail fournisseur, accès journalisé).
- **Dépendances** : VER-002 → VER-001 ; VER-003 → VER-002.
- **Critères d'acceptation** : Given aucun consentement biométrique, When le guest lance la vérification, Then aucune session n'est créée (`KYC_BIOMETRIC_CONSENT_MISSING`). Given un score sous le seuil, When le résultat arrive, Then `MANUAL_REVIEW` et la décision ops est motivée et journalisée.
- **Source** : SRC_G 1.4.2 ; 10 §5 ; 11 EC-43 ; écrans 10b : S04.
- **Confiance** : documenté (selfie, face match) ; liveness proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL (les deux) — inclus dans le parcours hébergé du fournisseur ; score lu par l'ops dans son portail ; décision consignée au dossier, pour le voyageur comme pour l'hôte.
- **Complexité** : moyenne ; ops faible ; risque **élevé** (biométrie).
- **Améliorations possibles** : selfie de contrôle à la remise (BR-VERIF-07).

#### Fiche VER-004 — Consentement biométrique et rétention
- **FEATURE ID** : VER-004
- **Nom** : Consentement biométrique et rétention
- **Module** : Identité & vérification (VER — Biométrie)
- **Persona** : PER-01, PER-02, PER-08
- **Objectif** : base légale explicite (Ley 81/2019 au Panama, Ley 7593/2025 au Paraguay) et durée bornée.
- **Description** : case séparée non pré-cochée, texte versionné es/en ; zéro copie d'image chez nous par défaut ; conservation ≤ 3 ans après la dernière interaction = plafond, défaut = durée la plus courte retenue par OQ-BR-25 ; scores classés C3 ; retrait = suppression demandée au fournisseur, attestation consignée.
- **Déclencheur** : avant la première session KYC.
- **Prérequis** : LEG-002 ; LEG-010.
- **Parcours principal** : affichage → acceptation → consent(type=BIOMETRIC, version) → VER-001.
- **Parcours alternatifs** : refus → explication, réservation et activation comme hôte impossibles ; retrait → purge tracée (manuelle pendant la tranche des lots 0 à 4).
- **Règles métier** : BR-VERIF-01 ; BR-ACC-09.
- **États** : consent `GIVEN` → `WITHDRAWN` (PROPOSÉ).
- **Erreurs** : `CONSENT_REQUIRED`.
- **Données** : consent(user_id, type, version, locale, accepted_at, ip, user_agent).
- **Notifications** : aucune.
- **Permissions** : `GUEST`, `P2P_HOST` ; `ADMIN` (purge journalisée).
- **Dépendances** : LEG-002.
- **Critères d'acceptation** : Given une nouvelle version du texte, When elle est publiée, Then toute nouvelle session exige cette version. Given un retrait, When l'ops le traite, Then la demande de purge au fournisseur est tracée avec date.
- **Source** : 10 §5 ; écrans 10b : S04.
- **Confiance** : documenté (politique Turo) ; adaptation Ley 81 et Ley 7593 proposée.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — case séparée, texte unique versionné en es et en en.
- **Complexité** : faible ; ops faible ; risque élevé.
- **Améliorations possibles** : droits des personnes en libre-service (LEG-005, P1).

#### Fiche VER-005 — Pièce d'identité cédula / passeport
- **FEATURE ID** : VER-005
- **Nom** : Pièce d'identité cédula / passeport
- **Module** : Identité & vérification (VER — Documents)
- **Persona** : PER-01 (passeport), PER-02 (cédula), PER-08 (cédula de l'hôte, personne physique)
- **Objectif** : identifier la personne au-delà du permis (contrat, constancia, amendes, numéro fiscal de l'hôte).
- **Description** : contrôle de la cédula ou du passeport dans la session du fournisseur ; collecte du statut (touriste / résident / visa spécial) pour VER-007. Liste de pièces par pays (paramètre : cédula PA, cédula PY, passeport). Pour l'hôte, la cédula sert aussi de rapprochement avec le titre du véhicule et le numéro fiscal (HST-049). Divergence : Turo n'exige le passeport que dans certains cas.
- **Déclencheur** : session KYC.
- **Prérequis** : VER-001.
- **Parcours principal** : choix du statut → document attendu → contrôle → stockage (type, pays, expiration).
- **Parcours alternatifs** : pièce expirée → `MORE_INFO_REQUIRED` ; nom différent du permis → revue.
- **Règles métier** : BR-VERIF-01 ; BR-ACC-06 (hôte personne physique).
- **États** : SM-3 (cycle de VER-001).
- **Erreurs** : `KYC_ID_DOCUMENT_MISSING`, `KYC_ID_EXPIRED`.
- **Données** : `identity_document`(doc_type, issuing_country, number_enc, number_bidx, expiry_date) ; `foreign_entry_declaration.residency_status`.
- **Notifications** : comme VER-001.
- **Permissions** : `OPS_AGENT` ; jamais de n° de pièce visible par l'autre partie du trip (hôte ou voyageur).
- **Dépendances** : VER-001.
- **Critères d'acceptation** : Given le statut « touriste », When la session démarre, Then le passeport est exigé. Given une pièce expirée, When le résultat arrive, Then `MORE_INFO_REQUIRED`.
- **Source** : 08 BR-VERIF-01 reco ; écrans 10b : S04, A07.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — inclus dans le parcours hébergé du fournisseur (VER-001) ; contrôle par l'ops de la pièce et du statut déclaré, consigné au dossier.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : lecture MRZ.

#### Fiche VER-006 — Règles des permis acceptés / refusés
- **FEATURE ID** : VER-006
- **Nom** : Règles des permis acceptés / refusés
- **Module** : Identité & vérification (VER — Règles permis)
- **Persona** : PER-07
- **Objectif** : liste fermée et versionnée des permis acceptés.
- **Description** : acceptés : permis permanents physiques ; refusés : numériques, photocopies, provisoires, IDP seul (référence Turo). Liste paramétrée par pays (ADM-014) ; IDP et permis non latins : OQ-BR-21.
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
- **Bêta pilote** : MANUEL — l'ops applique la liste versionnée lors de la revue KYC et consigne le motif de refus.
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
- **Parcours principal** : saisie → calcul serveur → dépassement : réservation en revue → décision ops (approuver, demander un document, refuser). **Moment du paiement** (UXQ-08, défaut fail-closed PROPOSÉ `flagged_booking_payment_order` = `REVIEW_BEFORE_CHARGE`, 17 §2.5) : hold `CHECKOUT` avec `review_required` = vrai, véhicule bloqué pendant la revue (`review_hold_minutes` = 120), **aucun débit** avant la décision ; approbation → prolongation unique du hold et paiement ; refus ou délai dépassé → hold `RELEASED` (`REVIEW_REJECTED`), aucun débit.
- **Parcours alternatifs** : date future ou incohérente → erreur ; BLOCK activé après l'avis → refus.
- **Règles métier** : BR-VERIF-02 ; BR-VERIF-09 ; BR-BOOK-10.
- **États** : SM-1b `PENDING` → `SATISFIED` / `FAILED` ; `checkout_hold` `ACTIVE` (`review_required`) → `RELEASED`.
- **Erreurs** : `KYC_ENTRY_DATE_INVALID`, `BOOKING_UNDER_REVIEW`, `KYC_FOREIGN_LICENSE_90D` (mode BLOCK).
- **Données** : `foreign_entry_declaration`(user_id, residency_status, entry_date, stamp_file_id, rule_result) ; `checkout_hold.review_required`.
- **Notifications** : `EVT_BOOKING_UNDER_REVIEW` (guest ; l'hôte voit un créneau « en attente ») ; tâche ops.
- **Permissions** : `GUEST` (saisie), `OPS_AGENT` (décision).
- **Dépendances** : VER-005 ; ADM-029.
- **Critères d'acceptation** : Given entrée le 01/11 et fin de trip le 31/01 (entrée + 91 j) en mode FLAG, When le guest valide le checkout, Then la réservation passe en revue avant tout débit, n'est pas refusée, et la décision ops est motivée et journalisée. Given le mode BLOCK, When le même cas se présente, Then `KYC_FOREIGN_LICENSE_90D`. Given fin à entrée + 90 j exactement, When il valide le checkout, Then aucun signalement (borne incluse, PROPOSÉ). Given une revue non faite en 120 min, When le délai expire, Then le hold est `RELEASED` et aucun débit n'existe.
- **Source** : 11 EC-50 ; 12 §3.4 ; 17 §2.5 ; écrans 10b : S04, S05, O01.
- **Confiance** : proposé (non applicable chez Turo).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : MANUEL — l'ops contrôle statut et date d'entrée à la revue de chaque réservation signalée, avant le débit ; option (10b §7) : deux champs simples (statut, date d'entrée) au checkout, sans règle, lus par l'ops, seulement si UXQ-03 conclut que le fournisseur KYC ne peut pas les collecter.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : OCR du tampon ; locations 1–3 mois (BKG-042, P2).

#### Fiche VER-013 — Vérification du téléphone par OTP
- **FEATURE ID** : VER-013
- **Nom** : Vérification du téléphone par OTP
- **Module** : Identité & vérification (VER — Téléphone)
- **Persona** : tous
- **Objectif** : joignabilité (indispensable au rendez-vous de remise entre particuliers) et anti-doublon.
- **Description** : code 6 chiffres par WhatsApp (si gabarit approuvé, NTF-002), repli SMS après 60 s ou échec ; valable 10 min ; 5 essais puis blocage 1 h. VoIP/virtuels refusés selon le type de ligne du fournisseur OTP ; type inconnu → accepté et signalé à ADM-029. Le numéro n'est jamais montré à l'autre partie du trip (messagerie MSG-001).
- **Déclencheur** : inscription ; changement de numéro.
- **Prérequis** : NTF-001 ; ACC-014.
- **Parcours principal** : saisie E.164 → envoi → code → `verified_at`.
- **Parcours alternatifs** : non reçu → renvoi SMS après 60 s ; 5 échecs → blocage ; numéro vérifié ailleurs → refus.
- **Règles métier** : BR-VERIF-06.
- **États** : SM-3 `NOT_STARTED` → `PHONE_VERIFIED`.
- **Erreurs** : `OTP_INVALID`, `OTP_EXPIRED`, `OTP_LOCKED`, `PHONE_VIRTUAL_REFUSED`, `ACCOUNT_DUPLICATE_PHONE`.
- **Données** : user_account.phone_e164, phone_verified_at, channel, line_type ; `otp_challenge`(hash, expires_at, attempts).
- **Notifications** : `EVT_OTP_CODE`.
- **Permissions** : tous comptes.
- **Dépendances** : NTF-001 ; ACC-014 ; ADM-029.
- **Critères d'acceptation** : Given un code émis à 10:00, When il est saisi à 10:11, Then `OTP_EXPIRED`. Given 5 codes faux, When un 6e est saisi, Then `OTP_LOCKED` 1 h. Given un échec WhatsApp, When 60 s passent, Then un SMS part. Given un numéro non vérifié, When le guest paie, Then BKG-012 bloque.
- **Source** : SRC_G 1.4.6 ; écrans 10b : S15.
- **Confiance** : documenté (SMS chez Turo) ; WhatsApp proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — OTP par SMS ou email ; WhatsApp après approbation Meta du gabarit.
- **Complexité** : faible ; ops faible ; risque moyen.
- **Améliorations possibles** : vérification silencieuse par opérateur.

#### Fiche VER-015 — Vérification du permis par l'hôte à la remise (6 points)
- **FEATURE ID** : VER-015
- **Nom** : Écran de vérification du permis par l'hôte à la remise (6 points)
- **Module** : Identité & vérification (VER — Remise)
- **Persona** : PER-08 (hôte) ; PER-01, PER-02 (voyageur contrôlé)
- **Objectif** : s'assurer, au rendez-vous de remise entre particuliers, que la personne présente est le conducteur vérifié.
- **Description** : dans l'écran de remise de l'espace hôte (A03, TRP-002), 6 cases obligatoires : nom identique au compte, date de naissance, photo, validité, restrictions, permis non provisoire ; affichage du résultat KYC (vérifié, date), du prénom et de la photo de profil du voyageur, **jamais** le numéro de la pièce ni son image (minimisation, `host_guest_v`, 17 §2.3). Refus → TRP-007 ou no-show du guest déclaré par l'hôte (TRP-015).
- **Déclencheur** : étape 1 de la remise (TRP-002), au lieu et à l'heure convenus.
- **Prérequis** : VER-001 ; trip `CHECKIN_OPEN`.
- **Parcours principal** : comparaison → 6 cases → étape suivante (photos de départ, TRP-004).
- **Parcours alternatifs** : case impossible → « permis non conforme » → remise stoppée, motif `HOST_CANCELLED_DUE_TO_GUEST` avec photo-preuve (`trip_identity_check` `TRIP_ID_FAILED`, preuve validée automatiquement, 17 §2.4) → qualification no-show guest (BR-CXL-12) ; sans preuve → requalifié `HOST_CANCELLED` (pénalité de l'hôte retenue sur ses gains, BR-CXL-13).
- **Règles métier** : BR-VERIF-07, BR-PICKUP-08, BR-PICKUP-07, BR-CXL-12, BR-CXL-08.
- **États** : SM-1 `CHECKIN_OPEN` → `IN_PROGRESS` ou → `NO_SHOW_GUEST` ; `trip_identity_check` `TRIP_ID_PENDING` → `TRIP_ID_OK` / `TRIP_ID_FAILED`.
- **Erreurs** : `CHECKIN_LICENSE_CHECK_INCOMPLETE`.
- **Données** : `trip_identity_check`(trip_id, status, checklist jsonb, checked_by_user_id, failure_subreason, evidence_file_ids) (17 §3.2.2).
- **Notifications** : `EVT_CHECKIN_REFUSED_LICENSE` (voyageur, ops).
- **Permissions** : `P2P_HOST` (permission `kyc.license_check_at_handover`) ; `CO_HOST` limité à ses véhicules (P1) ; `OPS_AGENT`.
- **Dépendances** : VER-001.
- **Critères d'acceptation** : Given 5 cases sur 6, When l'hôte continue, Then `CHECKIN_LICENSE_CHECK_INCOMPLETE`. Given l'écran de remise, When il s'affiche, Then aucun n° de pièce ni image de pièce n'est dans la réponse API. Given un refus avec photo-preuve, When le règlement est calculé, Then il suit T07 (configuration de test de 08) ; sans preuve, T08.
- **Source** : SRC_H H92, H94 ; TOS-HOST ; 17 §2.4 ; écrans 10b : A03.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — 6 cases à cocher sur l'écran de remise de l'hôte (A03), avec le résultat KYC affiché, sans rapprochement automatique.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : selfie de contrôle comparé au KYC (BR-VERIF-07).

#### Fiche VER-028 — Contrôle anti-blanchiment et listes de sanctions
- **FEATURE ID** : VER-028
- **Nom** : Contrôle anti-blanchiment et listes de sanctions des hôtes
- **Module** : Identité & vérification (VER — LBC)
- **Persona** : PER-07 ; PER-08 (sujet)
- **Objectif** : ne jamais activer ni verser à un hôte sanctionné.
- **Description** : filtrage de chaque hôte particulier (et de la personne autorisée par acte notarié à publier le véhicule d'un tiers) contre les listes ONU, OFAC et nationales du Panama et du Paraguay, à l'inscription et à chaque changement d'identité ou de compte de versement ; s'ajoute au KYC du PSP de place de marché (OQ-P2P-01). Statut de sujet obligé (Ley 23/2015, PA) À VALIDER.
- **Déclencheur** : vérification de l'hôte (HST-049) ; changement d'identité ou de compte de versement (PYO-001).
- **Prérequis** : VER-005.
- **Parcours principal** : recherche → résultat → consigné (source, date, auteur) dans le dossier `host_verification`.
- **Parcours alternatifs** : correspondance potentielle → escalade `ADMIN`, hôte non activé et lots de versement `ON_HOLD`.
- **Règles métier** : BR-ACC-06 ; aucune BR propre au filtrage dans 08.
- **États** : `sanctions_screening.result` `CLEAR` / `POTENTIAL_MATCH` / `CONFIRMED_MATCH`.
- **Erreurs** : `HOST_SANCTIONS_HIT`, `HOST_SCREENING_MISSING` (PROPOSÉS).
- **Données** : `sanctions_screening`(subject_type = `PERSON`, subject_id, lists_version, result, screened_at, reviewer) ; `host_verification.sanctions_screening_id`.
- **Notifications** : interne.
- **Permissions** : `OPS_AGENT`, `ADMIN`.
- **Dépendances** : VER-005.
- **Critères d'acceptation** : Given un hôte sans filtrage, When l'ops tente d'approuver sa vérification, Then `HOST_SCREENING_MISSING`. Given un résultat, When il est enregistré, Then source et date figurent au dossier. Given un changement de compte de versement non filtré, When un lot de versement est préparé, Then il reste `ON_HOLD`.
- **Source** : 12 §9.8 ; 17 §3.2.2 ; écrans 10b : A07, O01.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — recherche manuelle sur les listes par l'ops, consignée au dossier de vérification de l'hôte avant son activation.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : filtrage continu (VER-009, P1).

#### Fiche HST-049 / FIN-008 — Éligibilité P2P et onboarding fiscal de l'hôte particulier
- **FEATURE ID** : HST-049, FIN-008
- **Nom** : Éligibilité P2P et onboarding de l'hôte particulier (HST-049) ; profil fiscal de l'hôte (FIN-008)
- **Module** : Identité & vérification (HST — Éligibilité de l'hôte) ; Finance & facturation (FIN — Profil fiscal)
- **Persona** : PER-08 ; PER-07 (revue)
- **Objectif** : n'activer comme hôte qu'une personne physique vérifiée, majeure au sens de la plateforme, fiscalement identifiée, propriétaire (ou autorisée) d'un véhicule éligible, dans un pays dont la mise en service est ouverte.
- **Description** : depuis A01 (`web.s01.owner.cta` « Publica tu auto » / « List your car ») puis la liste de tâches A07 : (1) KYC individuel (VER-001 à VER-005) **et** KYC du sous-marchand par le PSP de place de marché (`psp_submerchant.kyc_status`, capacité `SUPPORTS_INDIVIDUAL_SUBMERCHANT`) ; (2) âge ≥ `host_min_age_years` = 21 (OQ-P2P-01) ; (3) **personne physique uniquement** (BR-ACC-06) : toute personne morale est refusée ; (4) filtrage sanctions (VER-028) ; (5) profil fiscal FIN-008 : cédula ou RUC et régime, collectés à l'inscription (`p2p_host_requires_tax_id[pays]` = `true`) ; au Paraguay, hôte sans RUC **non activable** tant qu'OQ-PAY-09 est ouverte (OQ-P2P-07) ; aide à l'obtention du RUC ; base du relevé fiscal annuel (BR-PAYOUT-05) ; (6) véhicule de particulier : titre au nom de l'hôte ou autorisation notariée, véhicule financé seulement avec le consentement écrit du créancier (`vehicle_financed_requires_lender_consent` = `true`, OQ-BR-28), inspection et âge (BR-LIST-01 à 03 ; détail dans HST-019 et HST-039) ; (7) CGU de l'hôte acceptées (LEG-001) ; (8) compte de versement au nom de l'hôte (PYO-001, lot 3). **Activation** (`organization` `P2P_HOST_INDIVIDUAL` passe `ACTIVE`) seulement si `host_verification.status` = `APPROVED`, sous-marchand `ACTIVE` chez le PSP **et** interrupteurs du pays `p2p_private_hosts_enabled[pays]` et `insurer_contract_active[pays]` à `true` (17 §0.1, §2.4). Le parcours est **construit** dès la bêta contre l'adaptateur PSP `FAKE` ; en production, les interrupteurs valent `false` tant que l'avis ou le contrat manque : l'hôte voit « pays pas encore ouvert » (`web.a07.waitingCountry`) (DEC-FONDATEUR-02, 13).
- **Déclencheur** : bouton `web.s14.becomeHost` « Publica tu auto » / « List your car » (S14, A01) ; changement d'identité, de numéro fiscal ou de compte de versement.
- **Prérequis** : ACC-001 ; VER-001 ; PYO-001 pour le versement (lot 3).
- **Parcours principal** : 1) A01 → création du compte d'hôte (`iam.organization.created`) et d'un dossier `host_verification` `OPEN` ; 2) A07 : identité, âge, profil fiscal, CGU, première voiture (A10) ; 3) dossier `IN_REVIEW` → revue ops (ADM-004) ; 4) `APPROVED` → si le PSP a validé le sous-marchand et que les interrupteurs du pays sont ouverts : compte d'hôte `ACTIVE` (`EVT_HOST_ACTIVATED`) ; sinon : `APPROVED` mais non activé, tâche « en attente du pays ».
- **Parcours alternatifs** : âge < 21 ans → refus `HOST_UNDER_AGE` ; déclaration d'une société ou d'un RUC de personne morale → refus `HOST_ENTITY_NOT_ALLOWED` ; numéro fiscal absent → `HOST_TAX_ID_REQUIRED` ; au PY sans RUC → dossier complet mais activation refusée tant qu'OQ-PAY-09 est ouverte ; véhicule financé sans consentement du créancier → `VEHICLE_LENDER_CONSENT_REQUIRED` (véhicule non publiable, l'hôte reste vérifiable) ; KYC du PSP refusé → `HOST_PAYOUT_RAIL_UNAVAILABLE` ; pays fermé → `HOST_NOT_ACTIVATED` (`p2p_private_hosts_enabled` = `false`) ou `INSURER_CONTRACT_INACTIVE` ; changement ultérieur d'identité ou de compte de versement → nouvelle revue partielle, lots `ON_HOLD`.
- **Règles métier** : BR-ACC-06 ; BR-LIST-01 ; BR-LIST-02 ; BR-LIST-03 ; BR-PAYOUT-05 ; BR-PROT-10.
- **États** : `host_verification` `OPEN` → `DOCS_PENDING` → `IN_REVIEW` → `APPROVED` / `REJECTED` ; `APPROVED` → `REVOKED` ; compte d'hôte (`organization.status`) `PENDING` → `PENDING_ACTIVATION` (dossier approuvé, pays fermé) → `ACTIVE` / `SUSPENDED` (PROPOSÉ, 17 §3.2.2 ; 19 US-123).
- **Erreurs** : `HOST_UNDER_AGE`, `HOST_ENTITY_NOT_ALLOWED`, `HOST_TAX_ID_REQUIRED`, `VEHICLE_LENDER_CONSENT_REQUIRED`, `HOST_NOT_ACTIVATED` (PROPOSÉS) ; statut `PENDING_ACTIVATION` (PROPOSÉ, A.8) ; `HOST_PAYOUT_RAIL_UNAVAILABLE`, `INSURER_CONTRACT_INACTIVE` (08, 17).
- **Données** : `organization`(kind = `P2P_HOST_INDIVIDUAL`, status, country_code) ; `host_verification`(org_id, user_id, status, identity_verification_id, age_ok, tax_id_checked_at, vehicle_title_checked, lender_consent_file_id, sanctions_screening_id, host_terms_consent_id, decided_by, decided_at) ; `psp_submerchant`(org_id, kyc_status) ; profil fiscal (tax_id_type, tax_id_enc, regime) ; paramètres `host_min_age_years`, `p2p_host_requires_tax_id[pays]`, `vehicle_financed_requires_lender_consent`, `p2p_private_hosts_enabled[pays]`, `insurer_contract_active[pays]` (17 §7.2).
- **Notifications** : `EVT_HOST_VERIFICATION_DECISION` (`host_verification.decided`), `EVT_HOST_ACTIVATED` (`iam.organization.status_changed`), `EVT_KYC_MORE_INFO`.
- **Permissions** : `GUEST` qui devient `P2P_HOST` (son dossier) ; `OPS_AGENT` (revue, `ops.review_listing_host`) ; les interrupteurs ne sont jamais modifiables depuis ce parcours (`config.go_live_switch`, deux personnes, 17 §0.1).
- **Dépendances** : HST-049 → FIN-008 ; FIN-008 → PYO-001.
- **Critères d'acceptation** : Given un candidat né il y a 20 ans, When il soumet son dossier, Then `HOST_UNDER_AGE` et aucun compte d'hôte actif. Given un candidat qui déclare une société, When il soumet, Then `HOST_ENTITY_NOT_ALLOWED`. Given un hôte au Paraguay sans RUC et OQ-PAY-09 ouverte, When l'ops approuve le reste du dossier, Then le compte d'hôte n'est pas activé. Given un dossier `APPROVED` et `p2p_private_hosts_enabled[pays]` absent, When l'activation est tentée, Then `HOST_NOT_ACTIVATED` (absent = `false`). Given les deux interrupteurs du pays à `true`, un sous-marchand `ACTIVE` et un dossier `APPROVED`, When l'activation est tentée, Then le compte d'hôte passe `ACTIVE` et `EVT_HOST_ACTIVATED` part en es ou en. Given un dossier d'hôte approuvé et `p2p_private_hosts_enabled[pays]` = `false`, When l'ops valide la vérification, Then le compte d'hôte passe `PENDING_ACTIVATION` (fail-closed), aucune annonce n'est publiable et l'hôte voit l'explication en es et en.
- **Source** : 08 BR-ACC-06, BR-LIST-01 à 03, BR-PAYOUT-05 ; 17 §2.4, §0.1 ; 22 OQ-P2P-01, OQ-P2P-07, OQ-BR-28, OQ-BR-35 ; écrans 10b : A01, A07, O01.
- **Confiance** : proposé (HST-049, solution de Turo adaptée : compte vérifié, 21 ans) ; documenté (FIN-008 : formulaire fiscal in-app chez Turo).
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : HST-049 SIMPLIFIÉ — inscription par A01 et A07, dossier revu par l'ops dans la console, activation bloquée par les interrupteurs du pays ; KYC du PSP simulé par l'adaptateur `FAKE`. FIN-008 SIMPLIFIÉ — cédula ou RUC et régime saisis, contrôle de format par pays ; relevé annuel au lot 5 (FIN-018).
- **Complexité** : élevée ; ops moyen ; risque élevé (statut juridique de l'hôte particulier, OQ-BR-35).
- **Améliorations possibles** : aide au RUC en ligne ; vérification du titre par registre quand il est consultable ; co-hôtes (FLT-001, P1).

## E2 — Recherche et fiche véhicule (P0-A, 15 lignes)

#### Fiche SRC-001 / SRC-002 — Recherche lieu + dates + heures, autocomplétion
- **FEATURE ID** : SRC-001, SRC-002
- **Nom** : Recherche lieu + dates + heures (SRC-001) ; autocomplete de lieux typé (SRC-002)
- **Module** : Catalogue & recherche (SRC — Barre de recherche)
- **Persona** : PER-01, PER-02
- **Objectif** : trouver un véhicule disponible près du bon endroit et au bon créneau.
- **Description** : champs « ¿Dónde? / Desde / Hasta » (date + heure, pas de 30 min, fuseau du pays : `America/Panama` ou `America/Asuncion`), bouton Buscar (ex-SRC-003 absorbé). SRC-002 : suggestions typées (aéroport, hôtel, adresse, ville) avec points d'intérêt car les adresses sont souvent sans numéro. Les résultats sont les véhicules des hôtes dont la **zone de remise** est proche du lieu choisi (l'adresse exacte reste masquée, LST-007).
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
- **Bêta pilote** : SRC-001 SIMPLIFIÉ — lieu choisi dans une liste de villes et de zones du pays ouvert, dates et heures ; SRC-002 DIFFÉRÉ — sans objet pour la tranche des lots 0 à 4 (la liste des zones remplace l'autocomplétion).
- **Complexité** : moyenne (×2) ; ops faible ; risque faible.
- **Améliorations possibles** : recherche par usage (SRC-046, P2) ; dates flexibles.

#### Fiche SRC-008 / SRC-012 — Liste de résultats, carte et tri
- **FEATURE ID** : SRC-008, SRC-012
- **Nom** : Liste de résultats + carte avec marqueurs de prix (SRC-008) ; tri des résultats (SRC-012)
- **Module** : Catalogue & recherche (SRC — Résultats, Tri)
- **Persona** : PER-01, PER-02
- **Objectif** : comparer les véhicules disponibles au prix réel.
- **Description** : liste paginée et carte ; chaque marqueur, placé sur la **zone approximative** de remise (jamais l'adresse exacte), affiche le **total TTC du séjour** (SRC-042) ; compteur de résultats ; état vide « aucun véhicule, modifiez vos critères » (ex-SRC-010). SRC-012 : tri par pertinence (défaut), prix croissant/décroissant, distance (absorbe SRC-014, SRC-015). Seules les annonces d'hôtes actifs dans un pays ouvert apparaissent.
- **Déclencheur** : recherche (SRC-001).
- **Prérequis** : SRC-042 ; disponibilité (CAL-011).
- **Parcours principal** : requête → véhicules `LISTED` sans occupation chevauchante, respectant préavis/horaires/durées → devis par véhicule (PRC-025) → liste + carte cohérentes → tri.
- **Parcours alternatifs** : 0 résultat → état vide ; devis impossible (paramètre manquant) → véhicule exclu et alerte ops.
- **Règles métier** : BR-PRICE-13 (transparence), BR-HP-07 (classement en recherche — référence ; pertinence simple : distance puis prix, PROPOSÉ), BR-BOOK-07.
- **États** : lecture de SM-2 (`LISTED` seulement).
- **Erreurs** : `SEARCH_NO_RESULTS` (état, pas une erreur bloquante), `QUOTE_UNAVAILABLE`.
- **Données** : résultat(vehicle_id, quote_id provisoire, total_ttc, distance à la zone).
- **Notifications** : aucune.
- **Permissions** : public.
- **Dépendances** : SRC-008 → SRC-001, SRC-042 ; SRC-012 → SRC-008.
- **Critères d'acceptation** : Given une recherche, When liste et carte s'affichent, Then elles montrent les mêmes véhicules et les mêmes totaux à l'unité mineure près. Given un véhicule réservé sur le créneau, When on cherche, Then il n'apparaît pas. Given le tri « prix croissant », When il est appliqué, Then l'ordre suit le total TTC. Given une annonce `LISTED` dans un pays où `insurer_contract_active[pays]` = `false`, When on cherche, Then elle n'apparaît pas.
- **Source** : 05 G-SEARCH-03, G-SEARCH-05 ; EV-0002 ; écrans 10b : S02.
- **Confiance** : confirmé (OBSERVÉ) ; total TTC proposé (Turo affiche HT).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SRC-008 SIMPLIFIÉ — liste sans carte ; SRC-012 DIFFÉRÉ — tri inutile pour quelques dizaines de véhicules.
- **Complexité** : moyenne / faible ; ops faible ; risque faible.
- **Améliorations possibles** : filtres complets (P1) ; classement par qualité de l'hôte (BR-HP-07).

#### Fiche SRC-011 — Carte résultat
- **FEATURE ID** : SRC-011
- **Nom** : Carte résultat
- **Module** : Catalogue & recherche (SRC — Résultats)
- **Persona** : PER-01, PER-02
- **Objectif** : donner sur une carte toutes les informations de décision.
- **Description** : champs obligatoires : photo principale, marque-modèle-année, catégorie, transmission, places, **prénom et photo de l'hôte**, note moyenne + nombre de trips ou badge « Nuevo » sans avis, **zone de remise** (adresse exacte après confirmation), **total TTC** du séjour (SRC-042) et prix/jour, **montant de la caution** par pré-autorisation sur carte (PAY-011).
- **Déclencheur** : affichage des résultats.
- **Prérequis** : SRC-008, SRC-042, PAY-011.
- **Parcours principal** : rendu de la carte → clic → fiche avec dates conservées.
- **Parcours alternatifs** : champ manquant → véhicule non publiable (validation à la publication, HST-016), jamais de champ vide affiché ; hôte sans photo → monogramme.
- **Règles métier** : BR-PRICE-13 ; BR-PAY-06 (caution affichée).
- **États** : —
- **Erreurs** : —
- **Données** : vue dénormalisée vehicle_card (prénom de l'hôte seulement, jamais son nom de famille ni son adresse).
- **Notifications** : —
- **Permissions** : public.
- **Dépendances** : SRC-008 ; PAY-011 ; SRC-042.
- **Critères d'acceptation** : Given un véhicule dont la classe ou le pays impose une caution de 200,00 (déclencheurs `CLASS` ou `COUNTRY` de 08 BR-PAY-06, seuls évalués avant le checkout, (révisé 2026-11-12, caution comme Turo)), When la carte s'affiche, Then le montant de la caution et le total TTC sont visibles ; sinon, aucun montant n'est affiché, seulement la mention générique « une caution peut être demandée selon le profil du conducteur » (T70 c). Given un véhicule sans avis, When la carte s'affiche, Then badge « Nuevo » et aucune note. Given un clic, When la fiche s'ouvre, Then les dates sont identiques. Given la réponse API de la carte, When elle est lue par un visiteur, Then elle ne contient ni l'adresse exacte ni le nom de famille de l'hôte.
- **Source** : 05 G-SEARCH-03 ; 03 §3 ; écrans 10b : S02.
- **Confiance** : confirmé (structure OBSERVÉE) ; champs caution/TTC proposés.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : favoris (P1) ; badge « hôte vérifié ».

#### Fiche SRC-042 — Affichage du total TTC
- **FEATURE ID** : SRC-042
- **Nom** : Affichage du total TTC
- **Module** : Catalogue & recherche (SRC — Prix affiché)
- **Persona** : PER-01, PER-02
- **Objectif** : afficher dès la recherche le prix réellement payé (transparence, ACODECO au Panama, SEDECO au Paraguay).
- **Description** : total = loyer des jours facturables + trip fee (PRC-012) + protection minimale obligatoire `BASICA` (PRT-011, `guest_protection_min_level`) + taxes par ligne (PRC-020) ; valeur issue du même moteur que le checkout (PRC-025), en unités mineures (USD à 2 décimales, PYG sans décimale). Divergence volontaire : Turo affiche HT.
- **Déclencheur** : recherche, fiche.
- **Prérequis** : PRC-021, PRC-025.
- **Parcours principal** : devis provisoire par véhicule → total TTC affiché → identique au checkout pour les mêmes entrées.
- **Parcours alternatifs** : paramètre de taxe ou grille de protection changé entre recherche et checkout → le checkout recalcule et affiche « le prix a changé ».
- **Règles métier** : BR-PRICE-13, BR-PRICE-12, BR-PRICE-14, BR-PRICE-06, BR-PRICE-11.
- **États** : devis `PROVISIONAL` (non figé).
- **Erreurs** : `QUOTE_UNAVAILABLE`.
- **Données** : quote provisoire (non persisté ou TTL court).
- **Notifications** : —
- **Permissions** : public.
- **Dépendances** : PRC-021.
- **Critères d'acceptation** : Given le trip A de 08 (total 256,66, TJ01), When il est cherché, Then le total affiché est 256,66 partout (carte, fiche, checkout). Given le trip D de 08 en PYG (TJ08a), When il est cherché, Then le total est 1 438 050 PYG sans décimale. Given un changement de taux, When le guest arrive au checkout, Then le nouveau total est affiché avec un avertissement avant paiement.
- **Source** : 08 BR-PRICE-13 reco ; 08 E7 (TJ01, TJ08a) ; écrans 10b : S02, S03.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — total TTC lu dans le devis (PRC-025), protection `BASICA` et trip fee compris, sans options facultatives.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : comparaison des niveaux de protection dès la recherche (PRC-026, P1).

#### Fiche LST-002 — Galerie de photos
- **FEATURE ID** : LST-002
- **Nom** : Galerie de photos
- **Module** : Catalogue & recherche (LST — Contenu)
- **Persona** : PER-01, PER-02
- **Objectif** : montrer fidèlement le véhicule.
- **Description** : photo principale choisie par l'hôte, galerie plein écran (balayage mobile, flèches ordinateur) de toutes les photos approuvées (HST-012, au moins 6) ; texte alternatif = marque, modèle, angle, en es et en ; tailles adaptées (≈ 200 ko liste, ≈ 600 ko plein écran). Aucune photo ne doit laisser lire l'adresse du domicile de l'hôte (plaque de rue, façade) : contrôle à la revue d'annonce (ADM-003).
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
- **Critères d'acceptation** : Given 8 photos approuvées, When la galerie s'ouvre, Then l'ordre est celui de l'hôte. Given une photo inaccessible, When la fiche se charge, Then les autres blocs s'affichent.
- **Source** : 05 G-LISTING-02 ; écrans 10b : S03.
- **Confiance** : confirmé (OBSERVÉ).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : vidéo 360°.

#### Fiche LST-003 / LST-020 — En-tête véhicule et bloc de l'hôte
- **FEATURE ID** : LST-003, LST-020
- **Nom** : En-tête véhicule (LST-003) ; bloc « Hosted by » de l'hôte (LST-020)
- **Module** : Catalogue & recherche (LST — Contenu, Hôte)
- **Persona** : PER-01, PER-02 ; PER-08 (profil affiché)
- **Objectif** : identifier le véhicule et la personne qui le loue, et donner des signaux de confiance entre particuliers.
- **Description** : LST-003 : marque, modèle, année, finition, note moyenne, nombre de trips, badge. LST-020 : **prénom et photo** (ou monogramme) de l'hôte, mention « identité vérifiée », note de l'hôte, nombre de trips, ancienneté (« membre depuis »), langues parlées, lien vers le profil public (A13). Jamais le nom de famille, le téléphone ni l'adresse (minimisation, 17 §2.3).
- **Déclencheur** : ouverture de la fiche.
- **Prérequis** : REV-010.
- **Parcours principal** : rendu à partir des agrégats REV-010 et du profil public de l'hôte.
- **Parcours alternatifs** : aucun avis → badge « Nuevo » ; hôte sans photo → monogramme.
- **Règles métier** : BR-REVIEW-03, BR-REVIEW-05, BR-HP-01 (référence All-Star : pas de badge d'hôte dans la bêta).
- **États** : —
- **Erreurs** : —
- **Données** : agrégats (REV-010) ; profil public de l'hôte (prénom, photo, created_at, langues, statut de vérification).
- **Notifications** : —
- **Permissions** : public.
- **Dépendances** : LST-003 → REV-010 ; LST-020 → REV-010.
- **Critères d'acceptation** : Given un véhicule à 4 trips notés, When la fiche s'affiche, Then la note est la moyenne des 4 et le nombre de trips correspond aux trips terminés. Given un hôte vérifié, When le bloc s'affiche, Then prénom, photo, « identité vérifiée » et ancienneté sont visibles et la réponse API ne contient ni nom de famille ni adresse.
- **Source** : 05 G-LISTING-02 ; écrans 10b : S03, A13.
- **Confiance** : confirmé (OBSERVÉ).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : LST-003 SIMPLIFIÉ — marque, modèle, année, catégorie ; LST-020 SIMPLIFIÉ — bloc de l'hôte réduit (prénom, photo, note, nombre de trips, « vérifié »), central dans une place de marché entre particuliers.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : badge d'hôte de qualité (REV-014, P1) ; taux de réponse.

#### Fiche LST-006 / LST-008 — Sélecteur de dates sur la fiche, dates indisponibles
- **FEATURE ID** : LST-006, LST-008
- **Nom** : Sélecteur de dates/heures sur la fiche (LST-006) ; gestion des dates indisponibles (LST-008)
- **Module** : Catalogue & recherche (LST — Réservation, Disponibilité)
- **Persona** : PER-01, PER-02
- **Objectif** : choisir un créneau réservable sans essai-erreur.
- **Description** : LST-006 : début et fin (date + heure, pas de 30 min, fuseau du pays), pré-remplis ; bornés par les horaires de remise et de retour déclarés par l'hôte, le préavis, les durées min/max (CAL-003) ; dates occupées grisées (CAL-011) ; toute modification relance le devis (PRC-025). LST-008 : message « non disponible du … au … » et ajustement automatique de l'heure de fin (règle exacte Turo à retester).
- **Déclencheur** : ouverture de la fiche ; modification des dates.
- **Prérequis** : CAL-003, CAL-011, PRC-025.
- **Parcours principal** : dates valides → devis → bouton « Reservar ».
- **Parcours alternatifs** : créneau hors horaires de l'hôte / chevauchement → refus avec raison ; LST-008 : fin proposée au dernier créneau libre (PROPOSÉ).
- **Règles métier** : BR-BOOK-03, BR-BOOK-04, BR-BOOK-06, BR-BOOK-07.
- **États** : —
- **Erreurs** : `DATES_OUTSIDE_HOURS`, `DATES_NOTICE_TOO_SHORT`, `DATES_UNAVAILABLE`, `DATES_DURATION`.
- **Données** : lecture vehicle_occupancy, horaires du lieu de remise, params.
- **Notifications** : —
- **Permissions** : public.
- **Dépendances** : LST-006 → CAL-003, CAL-011, PRC-025 ; LST-008 → CAL-011.
- **Critères d'acceptation** : Given un hôte qui remet entre 8 h et 18 h, When le guest choisit 19:00, Then `DATES_OUTSIDE_HOURS` avec motif. Given un trip existant du 10 au 12, When il choisit le 11, Then la date est grisée et non sélectionnable. Given un préavis de 3 h, When il choisit un départ dans 2 h, Then `DATES_NOTICE_TOO_SHORT`.
- **Source** : 05 G-LISTING-02 ; EV-0005 ; écrans 10b : S03.
- **Confiance** : confirmé (OBSERVÉ) ; ajustement automatique à retester.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : LST-006 OUI ; LST-008 DIFFÉRÉ — le sélecteur refuse simplement les dates occupées.
- **Complexité** : faible / moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : suggestion de véhicules alternatifs.

#### Fiche LST-007 — Lieu de remise de l'hôte
- **FEATURE ID** : LST-007
- **Nom** : Lieu de remise déclaré par l'hôte (zone puis adresse exacte)
- **Module** : Catalogue & recherche (LST — Lieu)
- **Persona** : PER-01, PER-02 ; PER-08 (déclare le lieu)
- **Objectif** : savoir où retrouver l'hôte, sans exposer son adresse avant la réservation.
- **Description** : avant réservation : quartier ou ville du **lieu de remise déclaré par l'hôte** (zone approximative sur la carte) ; après confirmation : adresse exacte, plan, horaires et instructions de rendez-vous (comme Turo, OQ-P2P-05). Un **lieu public** proche est proposé par défaut à l'hôte, son domicile restant un choix explicite (10b A10, `web.a10.meetPublic`). Remise **en personne** ; remise sans contact fermée (`p2p_contactless_handover_enabled` = `false`). La livraison (HST-034) et le changement de lieu sont P1. L'adresse exacte est retirée de la vue du voyageur à la fin du trip + `review_window_days` (17 §2.3).
- **Déclencheur** : fiche ; confirmation.
- **Prérequis** : HST-011.
- **Parcours principal** : affichage approximatif → après `BOOKED`, adresse exacte dans le trip et la confirmation (NTF-007).
- **Parcours alternatifs** : hôte empêché au lieu prévu → il propose un autre lieu par la messagerie (MSG-001), accepté par le voyageur, ou annule (BKG-032, annulation par l'hôte) ; lieu en zone aéroport → seulement sous permis, sinon point de rencontre hors emprise (OQ-MK-08).
- **Règles métier** : BR-BOOK-02 (masquage avant réservation), BR-BOOK-09, BR-PICKUP-09.
- **États** : visibilité dépend de SM-1 (≥ `BOOKED`).
- **Erreurs** : —
- **Données** : lieu de remise (org_id, vehicle_id, area, address_enc, lat/lng, hours, instructions).
- **Notifications** : adresse dans `EVT_BOOKING_CONFIRMED`.
- **Permissions** : public (zone) ; `GUEST` du trip (adresse exacte, jusqu'à la purge) ; `P2P_HOST` (écriture).
- **Dépendances** : HST-011.
- **Critères d'acceptation** : Given un visiteur non réservé, When il ouvre la fiche, Then l'adresse exacte n'est pas dans la réponse API. Given un trip `BOOKED`, When le guest l'ouvre, Then adresse, plan et horaires sont affichés. Given un trip terminé depuis plus de `review_window_days`, When le guest rouvre le trip, Then l'adresse exacte n'est plus affichée.
- **Source** : 05 G-LISTING-02 ; 22 OQ-P2P-05 ; écrans 10b : S03, S07, A11.
- **Confiance** : confirmé (OBSERVÉ ; modale d'édition non explorée).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — un seul lieu de remise par véhicule, zone affichée sur la fiche, adresse exacte révélée à la confirmation ; pas de livraison.
- **Complexité** : moyenne ; ops faible ; risque moyen (sécurité physique).
- **Améliorations possibles** : plusieurs lieux par véhicule ; points de remise aéroport (BKG-041, P1).

#### Fiche LST-010 — Résumé de la politique d'annulation
- **FEATURE ID** : LST-010
- **Nom** : Résumé de la politique d'annulation
- **Module** : Catalogue & recherche (LST — Politiques)
- **Persona** : PER-01, PER-02
- **Objectif** : informer avant le paiement de la date limite d'annulation gratuite.
- **Description** : texte calculé : « Cancelación gratuita hasta el {freeUntil} » à partir des paramètres du pays (ADM-031) et de BR-CXL-01 ; rappel des retenues hors fenêtre (BR-CXL-06). Politique **unique** de la plateforme, paramétrée par pays ; aucune politique propre à l'hôte (UXQ-07).
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
- **Confiance** : base confirmée (OBSERVÉ : date limite affichée au checkout) ; texte espagnol et calcul de `freeUntil` proposés.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — texte fixe de la politique d'annulation de la plateforme, en es et en en, avec la date limite calculée.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : tarif non remboursable (PRC-010, P1).

#### Fiche LST-012 — Distance incluse et prix du km supplémentaire
- **FEATURE ID** : LST-012
- **Nom** : Distance incluse et prix du km supplémentaire
- **Module** : Catalogue & recherche (LST — Kilométrage)
- **Persona** : PER-01, PER-02
- **Objectif** : rendre le coût kilométrique prévisible.
- **Description** : distance incluse par jour (ou « kilometraje ilimitado ») et prix du km supplémentaire configurés par l'hôte (HST-033), en km et dans la devise du pays (USD ou PYG) ; distance totale incluse = km/jour × jours facturables.
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
- **Bêta pilote** : SIMPLIFIÉ — valeurs saisies par l'hôte dans l'éditeur d'annonce (A10) affichées telles quelles.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : relevé kilométrique par télématique (TRP-055, P1).

#### Fiche LST-013 — Bloc assurance et protection
- **FEATURE ID** : LST-013
- **Nom** : Bloc protection (protections de l'assureur partenaire)
- **Module** : Catalogue & recherche (LST — Protection)
- **Persona** : PER-01, PER-02
- **Objectif** : dire clairement qui assure, ce qui est couvert et ce que le guest paie en cas de dommage.
- **Description** : plans de protection du voyageur vendus par Kmino pour l'**assureur partenaire** (PRT-001 : `BASICA` obligatoire, Estándar, Total), RC tiers incluse (PRT-003), franchise à la charge du voyageur selon le plan, exclusions principales, caution exigée et ses rails (PAY-011), lien vers le détail et mentions de l'assureur (PRT-013). Texte repris à l'identique dans le contrat (BKG-018). Bloc absent et annonce non réservable si `insurer_contract_active[pays]` = `false` ou si le véhicule n'est pas éligible au contrat en vigueur (17 §2.4). Absorbe PRT-004.
- **Déclencheur** : fiche, checkout.
- **Prérequis** : PRT-001, PRT-003, PAY-011.
- **Parcours principal** : rendu depuis le contrat d'assureur du pays (`insurer_contract`) et la grille de protection en vigueur.
- **Parcours alternatifs** : contrat d'assureur inactif → annonce non réservable (`INSURER_CONTRACT_INACTIVE`) ; véhicule devenu inéligible → annonce `BLOCKED_ELIGIBILITY`.
- **Règles métier** : BR-PROT-04, BR-PROT-01, BR-PROT-02, BR-PROT-03 (exclusions), BR-PAY-06.
- **États** : dépend de SM-2 (`LISTED` exige un véhicule éligible et un contrat d'assureur actif).
- **Erreurs** : `INSURER_CONTRACT_INACTIVE`.
- **Données** : `insurer`, `insurer_contract`(country_code, valid_from, valid_to, levels, deductibles, exclusions_es/en) ; `vehicle.insurer_eligibility`.
- **Notifications** : —
- **Permissions** : public.
- **Dépendances** : PRT-001 ; PRT-003 ; PAY-011.
- **Critères d'acceptation** : Given un contrat d'assureur actif, When la fiche s'affiche, Then assureur, niveaux, RC, franchises, exclusions et caution sont affichés et identiques au texte du contrat. Given `insurer_contract_active[pays]` = `false`, When on ouvre la fiche, Then le bloc est absent et le bouton de réservation renvoie `INSURER_CONTRACT_INACTIVE`.
- **Source** : 05 G-LISTING-02 ; 17 §2.4 ; 22 OQ-P2P-03, OQ-P2P-12 ; écrans 10b : S03.
- **Confiance** : confirmé (bloc OBSERVÉ chez Turo) ; montage avec l'assureur partenaire proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — bloc de texte saisi par l'ops depuis le contrat de l'assureur partenaire (assureur, niveaux, RC, franchises, caution), en es et en en.
- **Complexité** : faible ; ops faible ; risque moyen.
- **Améliorations possibles** : comparateur des niveaux de protection (P1).

## E3 — Disponibilité et calendrier de l'hôte (P0-A, 6 lignes)

#### Fiche CAL-011 — Table d'occupation unique
- **FEATURE ID** : CAL-011
- **Nom** : Table d'occupation unique
- **Module** : Disponibilité & calendrier (CAL — Intégrité)
- **Persona** : PER-07 (technique) ; effets pour tous
- **Objectif** : une seule source de vérité de la disponibilité, sans double réservation.
- **Description** : `vehicle_occupancy` : `kind ∈ {TRIP, HOLD, HOST_BLOCK, BUFFER}` et `source ∈ {CHECKOUT, MANUAL, ICAL, SYSTEM}` (un événement iCal est un `HOST_BLOCK` de source `ICAL`, iCal hors de la bêta), `period` semi-ouvert [début, fin + tampon), `active` seul prédicat de la **contrainte d'exclusion** GiST (PostgreSQL). Invariant **I-OCC** : tout trip non terminal possède exactement une occupation `TRIP` active (trigger de contrainte différé + requête de contrôle nocturne) ; une occupation de trip n'est jamais désactivée par l'expiration d'un hold. `BUFFER` est réservé aux tampons autonomes et n'est jamais produit par la conversion d'un hold. Écritures **uniquement par commandes** ; horloge de la base (`platform.now()`). Absorbe CAL-010 (blocage refusé s'il chevauche un trip confirmé). (17 §2.5)
- **Déclencheur** : hold, confirmation, blocage par l'hôte, annulation.
- **Prérequis** : aucun.
- **Parcours principal** : insertion dans une transaction ; conflit → rejet atomique.
- **Parcours alternatifs** : annulation → libération de l'intervalle ; trip terminé tôt → tampon recalculé.
- **Règles métier** : BR-BOOK-10, BR-BOOK-05, BR-BOOK-07.
- **États** : reflète SM-1 : occupation `HOLD` convertie en `TRIP` par la conversion gardée (BKG-014) ; `deactivated_reason` ∈ {`HOLD_EXPIRED`, `HOLD_RELEASED`, `HOLD_COMPENSATED`, `TRIP_TERMINAL`, `SHORTENED`, `BLOCK_REMOVED`}.
- **Erreurs** : `VEHICLE_UNAVAILABLE`.
- **Données** : `vehicle_occupancy`(id, vehicle_id, kind, source, period tstzrange, active, expires_at, deactivated_reason, ref_type, ref_id, ical_uid) (17 §3.2.4).
- **Notifications** : —
- **Permissions** : `SYSTEM` ; `app_api` sans aucun droit d'écriture directe (17 §2.3).
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given 100 tentatives concurrentes de hold sur le même intervalle, When elles s'exécutent, Then exactement une réussit et 99 reçoivent `409 VEHICLE_UNAVAILABLE` (EC-51 ; 17 test C1). Given un blocage chevauchant un trip confirmé, When l'hôte le crée, Then `VEHICLE_UNAVAILABLE`. Given une transaction qui laisse un trip `BOOKED` sans occupation `TRIP` active, When elle est validée, Then le trigger I-OCC l'annule (17 C12).
- **Source** : 08 BR-BOOK-10 ; 11 EC-51 ; 17 §2.5 (I-OCC, tests C1–C20), 17 §2.3 (RLS-1 à RLS-28), 17 §11 (L0-01 à L0-10), ADR-002 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé (mécanisme Turo inféré).
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — contrainte d'exclusion sur trips, holds et blocages de l'hôte ; tampon global ; pas d'événements iCal.
- **Complexité** : élevée ; ops faible ; risque moyen.
- **Améliorations possibles** : synchronisation iCal pour les hôtes qui louent aussi ailleurs (P3).

#### Fiche BKG-014 — Hold de checkout et anti-double réservation
- **FEATURE ID** : BKG-014
- **Nom** : Hold de checkout et anti-double réservation
- **Module** : Disponibilité & calendrier (BKG — Concurrence ; rattaché à E3)
- **Persona** : PER-01, PER-02 (effet) ; `SYSTEM`
- **Objectif** : réserver le créneau pendant le paiement, sans jamais créer un trip sans paiement ni garder un paiement sans trip.
- **Description** : `checkout_hold` (17 §2.5 ; 08 BR-BOOK-10) de type **`CHECKOUT` seul** (TTL `hold_ttl_minutes` = 10). Le hold pose une occupation `kind = HOLD` sous la contrainte d'exclusion (CAL-011). **État « paiement en cours »** (`PAYMENT_IN_FLIGHT`) dès la création de l'ordre auprès du PSP de place de marché : `payment_in_flight_until = min(création de l'ordre + TTL de l'ordre + marge, création du hold + hold_max_total_minutes = 20 min)`, exclu de l'expiration (ex. ordre Yappy de 300 s créé à 10:08 : véhicule bloqué jusqu'à 10:13 + marge) ; un moyen dont l'ordre dure plus que le hold n'est pas proposé. Un seul paiement en cours par hold ; au plus 2 holds vivants par guest (`max_active_holds_per_guest`). **Réservation signalée** (ADM-029, VER-007 ; UXQ-08, défaut PROPOSÉ `flagged_booking_payment_order` = `REVIEW_BEFORE_CHARGE`) : hold `CHECKOUT` avec `review_required` = vrai, TTL `review_hold_minutes` = 120, aucune intention de paiement avant la revue ; approbation → une seule prolongation ; refus ou délai dépassé → `RELEASED` (`REVIEW_REJECTED`). **Conversion atomique et gardée** à la preuve de paiement PAY-034 (webhook signé ou `getOperation`, avec montants par jambe ; 17 §2.5 étape 4) : verrou `FOR UPDATE` du hold, `UPDATE vehicle_occupancy SET kind = 'TRIP', active = true` (contrainte réévaluée), contrôles rejoués à la conversion (annonce `LISTED`, véhicule éligible au contrat d'assureur, hôte activable, guest éligible, devis inchangé, début non dépassé), création du trip `BOOKED`, de `guest_occupancy` et du lien `payment_operation_link` de la seule opération de conversion, I-OCC vérifié au commit. Paiement reçu **après expiration ou libération** : **ré-acquisition** si le créneau est libre (`booking.hold.reacquired`), sinon **compensation** (`hold_compensation`) **exécutée par Kmino** selon la capacité validée du PSP : void d'une autorisation, sinon remboursement intégral **par jambe** (`refund_instance`, SM-8) — sans trip, règlement ni pénalité. Le hold de lien de paiement des versions précédentes est sans objet (DEC-FONDATEUR-13). Absorbe BKG-010, BKG-015. (17 §2.5, ADR-002 ; 08 BR-BOOK-10 points 1 à 10)
- **Déclencheur** : clic « Pagar » ; preuve de paiement (webhook signé ou lecture `getOperation`) ; tâche d'expiration toutes les 60 s ; décision de revue ops.
- **Prérequis** : CAL-011 ; PAY-019.
- **Parcours principal** : `QUOTE` → `HOLD` (`checkout_hold` `ACTIVE`, 10 min) → ordre PSP créé (`PAYMENT_IN_FLIGHT`) → preuve PAY-034 → conversion gardée → `BOOKED` (`booking.hold.converted`, `booking.trip.booked`).
- **Parcours alternatifs** : (1) échéance sans paiement en cours → `EXPIRED`, créneau libéré, aucun règlement ; (2) preuve reçue après expiration, créneau libre → ré-acquisition, trip `BOOKED` ; (3) même cas, créneau repris entre-temps → compensation par capacité (17 §2.5 étape 5), guest notifié aussitôt (excuse, véhicules similaires, date d'émission du remboursement : écran S06 « paiement tardif »), alerte ops ; (4) deux holds chevauchants d'un même guest payés → un seul trip, le second paiement compensé (motif `GUEST_OVERLAP`) ; (5) rejeu de webhook ou lecture `getOperation` concurrente → le trip existant est renvoyé ; (6) libération d'un hold de revue refusé concurrente d'une preuve tardive → conversion **ou** compensation, jamais les deux ; (7) réponse PSP inconnue → même clé et lecture de l'opération ; sans lecture par référence marchande validée, aucune nouvelle tentative (escalade ops, hold conservé jusqu'à `payment_in_flight_until`) ; (8) hôte qui tente de réserver son propre véhicule → refus `SELF_BOOKING_FORBIDDEN` à la pose (ACC-014).
- **Règles métier** : BR-BOOK-10, BR-BOOK-08, BR-BOOK-11, BR-PAY-01.
- **États** : `checkout_hold.status` `ACTIVE` → `PAYMENT_IN_FLIGHT` → `CONVERTED` / `EXPIRED` / `RELEASED` / `COMPENSATED` (terminal) ; SM-1 `QUOTE` → `HOLD` → `BOOKED` (sur preuve de paiement) ou → `QUOTE` ; `hold_compensation` `OPEN` → `EXECUTING` → `DONE` / `ESCALATED`.
- **Erreurs** : `409 VEHICLE_UNAVAILABLE` (créneau pris, avec suggestions), `HOLD_EXPIRED`, `GUEST_OVERLAP`, `HOLD_LIMIT_REACHED` (plus de 2 holds vivants), `BOOKING_UNDER_REVIEW`, `SELF_BOOKING_FORBIDDEN` ; moyen de paiement non proposé si son ordre dépasse le hold (noms de référence).
- **Données** : `checkout_hold`(id, guest_user_id, vehicle_id, org_id, quote_id, occupancy_id, kind = `CHECKOUT`, status, expires_at, payment_in_flight_until, payment_attempts, converted_trip_id, review_required, reviewed_at) ; `vehicle_occupancy` (`HOLD` → `TRIP`) ; `guest_occupancy` (trips seulement) ; `payment_operation` (`hold_id`, `trip_id` nul avant conversion) et `payment_operation_leg` ; `payment_operation_link` ; `hold_compensation` ; `payment_disposition` (17 §3.2.4, §3.2.7).
- **Notifications** : écrans S05 (« hold expiré → relancer ») et S06 (`web.s06.verifying.title` « Pago en verificación » / « Verifying your payment », ordre Yappy expiré, paiement tardif) ; événements `booking.hold.created` / `.payment_in_flight` / `.expired` / `.released` / `.reacquired` / `.converted`, `booking.hold.compensation_required` (guest, hôte, alerte ops) ; hôte : créneau « en attente de paiement » ou « en revue » dans A05 et A06.
- **Permissions** : `GUEST` (commandes `booking.cmd_place_hold`, `booking.cmd_release_own_hold`), `SYSTEM` (`app_worker`) ; `OPS_AGENT` : revue des holds signalés et file des compensations ; l'hôte ne peut ni libérer ni prolonger un hold.
- **Dépendances** : CAL-011 ; PAY-019.
- **Critères d'acceptation** : Given un hold déjà compensé et un créneau redevenu libre, When une seconde preuve de paiement arrive pour ce hold, Then aucun trip n'est créé et le paiement est remboursé par Kmino (17 C13). Given un ordre payé deux fois, When les deux preuves arrivent, Then un seul trip et le second paiement est remboursé (`DUPLICATE_PAYMENT`, 17 C14). Given un hold H1 expiré puis un hold H2 du même guest sur le même créneau non payé, When la preuve de H1 arrive, Then H1 devient le trip, H2 est libéré et aucun remboursement n'est ouvert (17 C18). Given un guest connecté, When il tente de modifier l'échéance ou le statut de son hold hors des commandes, Then la base refuse et rien ne change (17 RLS-13). Given un hold `CHECKOUT` créé à 10:00 sans ordre PSP, When la tâche d'expiration tourne à 10:10, Then le hold est `EXPIRED` et le créneau réservable. Given un ordre Yappy de 300 s créé à 10:08, When un second guest pose un hold sur le même créneau à 10:11, Then il reçoit `409 VEHICLE_UNAVAILABLE` et le hold du premier reste `PAYMENT_IN_FLIGHT` (17 C5). Given une conversion qui a verrouillé le hold et une tâche d'expiration qui tourne avec `expires_at` dépassé, When la conversion est validée, Then le trip est `BOOKED` avec une occupation `TRIP` active (C2). Given un hold expiré sans concurrent, When la preuve de paiement arrive, Then ré-acquisition et trip `BOOKED` (C3). Given un hold expiré et un autre guest qui a converti le même créneau, When la preuve tardive arrive, Then aucun trip n'est créé, une `hold_compensation` est ouverte selon la capacité du PSP et une seule occupation reste active (C4). Given le même webhook reçu deux fois et une lecture `getOperation` du balayage simultanée, When ils sont traités, Then un seul trip existe (C6). Given un hold de revue refusé par l'ops et une preuve de paiement tardive concurrente, When les deux sont traités, Then soit conversion soit compensation, jamais les deux (C8). Given un hold signalé avec `review_required`, When le guest tente de lancer le paiement avant la revue, Then la commande est refusée et aucun débit n'existe. Given 100 poses de hold concurrentes, When elles s'exécutent, Then 1 hold et 99 `409 VEHICLE_UNAVAILABLE` (C1). Given le fuzz d'entrelacements C11 (≥ 10 000 exécutions), When il tourne, Then jamais deux occupations actives chevauchantes et 0 paiement `SUCCEEDED` sans trip ni compensation après 20 min (C11, C12).
- **Source** : 08 BR-BOOK-10 (points 1 à 10) ; 17 §2.5 (tests C1–C20), 17 §2.3 (RLS-1 à RLS-28), 17 §11 (L0-01 à L0-10), ADR-002 ; 10b §7 BKG-014 ; 11 EC-51 ; écrans 10b : S05, S06.
- **Confiance** : proposé (aucun hold observé chez Turo, INFÉRÉ).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — hold `CHECKOUT` seul et contrainte d'exclusion ; revue `review_required` avant tout débit ; conversion gardée à la preuve par webhook signé ou `getOperation` contre l'adaptateur `FAKE` ; compensation = void ou remboursement par jambe exécuté par Kmino ; état terminal `COMPENSATED` et `payment_disposition` ; lecture du PSP avant toute libération ; `disposition_sweeper` ; création et annulation du hold par commandes serveur seulement ; tests C1–C20 sous les rôles de production (17 §2.5, §10, §11).
- **Complexité** : élevée ; ops faible ; risque moyen.
- **Améliorations possibles** : file d'attente si le créneau se libère.

#### Fiche CAL-001 / CAL-002 — Calendrier par véhicule et blocages
- **FEATURE ID** : CAL-001, CAL-002
- **Nom** : Calendrier par véhicule (CAL-001) ; blocage journalier ou horaire (CAL-002)
- **Module** : Disponibilité & calendrier (CAL — Calendrier, Blocages)
- **Persona** : PER-08 (co-hôtes en P1)
- **Objectif** : voir et gérer l'occupation de chacun de ses véhicules depuis son téléphone.
- **Description** : CAL-001 : vue mois et semaine par véhicule des trips (statut, prénom du voyageur), holds en cours (« en attente de paiement » ou « en revue »), blocages manuels et tampons, lus dans CAL-011 ; actions : créer ou supprimer un blocage (CAL-002), ouvrir un trip ; porte l'étape « disponibilité » de l'annonce (ex-HST-010). CAL-002 : bloquer un ou plusieurs de ses véhicules par jour ou par heure. Un hôte peut avoir plusieurs véhicules (comme chez Turo), chacun avec son calendrier.
- **Déclencheur** : espace hôte (A06).
- **Prérequis** : HST-026, CAL-011.
- **Parcours principal** : consultation → création d'un blocage → commande serveur → insertion CAL-011 → disparition de la recherche.
- **Parcours alternatifs** : chevauchement avec un trip → refus ; suppression d'un blocage → créneau libéré.
- **Règles métier** : BR-BOOK-07.
- **États** : —
- **Erreurs** : `VEHICLE_UNAVAILABLE`, `FORBIDDEN`.
- **Données** : vehicle_occupancy (`HOST_BLOCK` : reason, created_by).
- **Notifications** : —
- **Permissions** : `P2P_HOST` (`calendar.block`, ses véhicules) ; `CO_HOST` limité à ses véhicules (P1) ; `OPS_AGENT` limité.
- **Dépendances** : CAL-001 → HST-026, CAL-011 ; CAL-002 → CAL-001.
- **Critères d'acceptation** : Given un trip confirmé, When le calendrier est rouvert, Then il apparaît en ≤ 5 s. Given un blocage chevauchant un trip, When il est créé, Then refus. Given un blocage du 10 au 12, When un guest cherche le 11, Then le véhicule est absent. Given un hôte A, When il tente de bloquer un véhicule de l'hôte B, Then 403 et rien n'est écrit (RLS).
- **Source** : SRC_H H23 ; écrans 10b : A06.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : CAL-001 SIMPLIFIÉ — liste des occupations par véhicule dans l'espace hôte, sans vue mois/semaine ; CAL-002 SIMPLIFIÉ — blocage par jour seulement.
- **Complexité** : moyenne / faible ; ops faible ; risque faible.
- **Améliorations possibles** : calendrier multi-véhicules et prix par date (P1).

#### Fiche CAL-003 / CAL-004 — Préavis minimum et tampon entre trips
- **FEATURE ID** : CAL-003, CAL-004
- **Nom** : Préavis minimum par véhicule (CAL-003) ; tampon entre trips (CAL-004)
- **Module** : Disponibilité & calendrier (CAL — Règles)
- **Persona** : PER-08
- **Objectif** : laisser à l'hôte le temps de préparer la voiture et de se rendre au lieu de remise.
- **Description** : CAL-003 : délai minimal entre réservation et début, par véhicule et par lieu de remise (absorbe CAL-005, CAL-006 : horaires et durées min/max) ; défaut 3 h, 12 h pour un lieu aéroport (ADM-031). CAL-004 : heures bloquées après chaque trip (défaut 2 h), aussi pour les extensions, matérialisées en `BUFFER` dans CAL-011.
- **Déclencheur** : recherche, sélecteur de dates, confirmation.
- **Prérequis** : CAL-001 (CAL-003), CAL-011 (CAL-004).
- **Parcours principal** : paramètre du véhicule ou défaut du pays → filtrage des créneaux.
- **Parcours alternatifs** : retour en retard → tampon décalé ; conflit avec le trip suivant → alerte à l'hôte et à l'ops (EC-19).
- **Règles métier** : BR-BOOK-04, BR-BOOK-05, BR-BOOK-06.
- **États** : —
- **Erreurs** : `DATES_NOTICE_TOO_SHORT`.
- **Données** : préavis, tampon, durées min/max par véhicule (`listing`) ; défauts par pays (`param_value`).
- **Notifications** : —
- **Permissions** : `P2P_HOST` (`catalog.pricing_availability`) ; défauts `ADMIN`.
- **Dépendances** : CAL-003 → CAL-001 ; CAL-004 → CAL-011.
- **Critères d'acceptation** : Given un tampon de 2 h et un retour à 12:00, When un guest cherche un départ à 13:00, Then le véhicule est indisponible ; à 14:00, disponible. Given un préavis de 3 h, When un départ dans 2 h 59 est demandé, Then refus.
- **Source** : SRC_H H22 ; écrans 10b : A06, A10.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : CAL-003 SIMPLIFIÉ — préavis réglé par l'hôte pour chaque véhicule, défaut du pays sinon ; CAL-004 SIMPLIFIÉ — tampon global du pays.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : préavis par jour de la semaine (P1).

## E4 — Réservation, contrat hôte–voyageur et checkout (P0-A, 13 lignes)

#### Fiche BKG-001 / BKG-006 — Checkout une page et détail du sous-total
- **FEATURE ID** : BKG-001, BKG-006
- **Nom** : Checkout sur une seule page (BKG-001) ; résumé et détail du sous-total (BKG-006)
- **Module** : Réservation & contrat (BKG — Checkout)
- **Persona** : PER-01, PER-02
- **Objectif** : réserver la voiture d'un hôte en une page, avec un prix détaillé et vérifiable.
- **Description** : BKG-001 (absorbe LST-023) : récapitulatif voiture, dates, zone du lieu de remise (adresse exacte après confirmation, BKG-016), conducteur (BKG-002), **choix du plan de protection** du voyageur (BKG-003, Básica présélectionnée, aucun refus total), Extras (P1), tarif, résumé, paiement, bouton collant « Pagar US$ … ». BKG-006 : sous-total cliquable → loyer × jours facturables, trip fee (PRC-012), protection, taxes par ligne (PRC-020), distance incluse, montant de la caution par carte (PAY-011, autorisée, non débitée), total TTC. Le voyageur paie **Kmino, marchand de référence**, par le PSP de place de marché ; le devis porte déjà le montant de chaque jambe (`HOST`, `INSURER`, `TAX_THIRD_PARTY`, `PLATFORM`, 08 E7), jamais affiché comme tel au voyageur. Mode `INSTANT` par défaut ; mode `REQUEST` seulement si l'hôte l'a choisi (demande expirée après 4 h, interdit sur une annonce aéroport ; OQ-P2P-10).
- **Déclencheur** : « Reservar » sur la fiche de la voiture.
- **Prérequis** : PRC-025 ; BKG-002 ; compte vérifié (BKG-012).
- **Parcours principal** : 1) devis figé (version, jambes calculées) ; 2) conducteur ; 3) plan de protection ; 4) contrôles BKG-012 ; 5) acceptations BKG-008, BKG-023, BKG-025 ; 6) hold `CHECKOUT` (BKG-014) ; 7) autorisation sur la page ou les champs hébergés du PSP de Kmino (PAY-006) ; 8) confirmation après preuve de paiement (BKG-022, PAY-034).
- **Parcours alternatifs** : non connecté → inscription puis retour au checkout avec les mêmes dates ; prix modifié depuis la fiche → bandeau « El precio cambió » / « The price changed » (clé `web.s05.priceChanged` du catalogue de 10b §4.3, ajoutée en es, en et fr par US-060) et nouvelle acceptation ; contrôle bloquant → message et code (BKG-012) ; mode `REQUEST` → la demande part à l'hôte, aucun débit avant son acceptation.
- **Règles métier** : BR-BOOK-01 (`INSTANT` par défaut), BR-PRICE-13, BR-PRICE-12, BR-PRICE-14, BR-PRICE-06, BR-PRICE-11, BR-BOOK-08 (un guest, une voiture à la fois).
- **États** : SM-1 `QUOTE` → `HOLD` → `BOOKED`.
- **Erreurs** : `QUOTE_EXPIRED`, `QUOTE_CHANGED`, codes de BKG-012, `HOLD_EXPIRED`.
- **Données** : quote (version figée, lignes et jambes), booking_draft(user_id, vehicle_id, quote_id, driver, protection_level).
- **Notifications** : aucune avant confirmation.
- **Permissions** : `GUEST` vérifié (`booking.create`, jamais sur son propre véhicule).
- **Dépendances** : BKG-001 → PRC-025, BKG-002 ; BKG-006 → PRC-025.
- **Critères d'acceptation** : Given le trip A de 08 (P 120,00, F 18,00, protection Estándar), When le détail est ouvert, Then la somme des lignes égale le total 256,66 au cent près et le devis porte les jambes de TJ01 (`HOST` 131,25, `INSURER` 25,50, `TAX_THIRD_PARTY` 0,00, `PLATFORM` 99,91). Given un devis plus ancien que sa durée de validité (PROPOSÉ 30 min), When le guest paie, Then `QUOTE_EXPIRED` et nouveau devis. Given un guest avec un trip en cours qui chevauche, When il réserve, Then refus (BR-BOOK-08).
- **Source** : 05 G-BOOK-01, G-BOOK-02 ; EV-0007 ; 08 E7 ; écrans 10b : S05.
- **Confiance** : confirmé (OBSERVÉ sans soumission) ; jambes proposées.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : BKG-001 SIMPLIFIÉ — checkout sans Extras, plan de protection à choisir parmi les niveaux actifs, autorisation sur la page hébergée du PSP de Kmino ; BKG-006 SIMPLIFIÉ — détail loyer, trip fee, protection, taxes, total.
- **Complexité** : moyenne / faible ; ops faible ; risque faible.
- **Améliorations possibles** : Extras (P1) ; réservation pour un conducteur additionnel (P1).

#### Fiche BKG-002 / BKG-025 — Conducteur principal et aptitude boîte manuelle
- **FEATURE ID** : BKG-002, BKG-025
- **Nom** : Formulaire du conducteur principal (BKG-002) ; confirmation d'aptitude boîte manuelle (BKG-025)
- **Module** : Réservation & contrat (BKG — Checkout)
- **Persona** : PER-01, PER-02
- **Objectif** : identifier le conducteur et sécuriser les voitures à boîte manuelle.
- **Description** : BKG-002 : prénom et nom du permis (pré-remplis depuis le compte), indicatif + mobile, email, tranche d'âge (18 → 55+). BKG-025 (absorbe ACC-020) : case obligatoire « sé conducir un vehículo manual » pour une voiture manuelle.
- **Déclencheur** : checkout.
- **Prérequis** : compte avec nom légal (ACC-006).
- **Parcours principal** : pré-remplissage → validation → (manuel : case) → suite.
- **Parcours alternatifs** : conducteur différent du titulaire du compte → refus en bêta (seul le titulaire conduit ; conducteur additionnel en P1).
- **Règles métier** : BR-ACC-02, BR-ACC-04 (âge minimum par classe), BR-ACC-08 (boîte manuelle), BR-PICKUP-07.
- **États** : —
- **Erreurs** : `DRIVER_MUST_BE_ACCOUNT_HOLDER`, `MANUAL_TRANSMISSION_NOT_CONFIRMED`.
- **Données** : booking.driver_snapshot(name, phone, email, age_band), booking.manual_confirmed_at.
- **Notifications** : —
- **Permissions** : `GUEST`.
- **Dépendances** : aucune dans 04 (BKG-012 dépend de BKG-025).
- **Critères d'acceptation** : Given une voiture manuelle, When la case n'est pas cochée, Then `MANUAL_TRANSMISSION_NOT_CONFIRMED`. Given un nom de conducteur différent du nom légal du compte, When le guest continue, Then `DRIVER_MUST_BE_ACCOUNT_HOLDER`.
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
- **Description** : BKG-008 : case « Acepto pagar el total, los Términos, la política de cancelación y la privacidad » ; versions enregistrées (LEG-002), y compris les règles de l'hôte affichées sur l'annonce. BKG-023 (absorbe LST-027) : rappel de l'interdiction de sortir du territoire (Costa Rica, EC-46) et des zones ou routes exclues (ex. Darién, routes non revêtues, EC-53 ; zones exclues par l'hôte si la voiture n'est pas 4x4, OQ-MK-12) avant paiement, repris au contrat.
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
- **Critères d'acceptation** : Given un checkout, When la case n'est pas cochée, Then le bouton de paiement est inactif et l'API renvoie `TERMS_NOT_ACCEPTED`. Given un trip confirmé, When on consulte ses consentements, Then on retrouve la version exacte des CGU, de la politique d'annulation, des règles de l'hôte et du texte géographique.
- **Source** : 05 G-BOOK-01 ; 11 EC-45, EC-46, EC-53 ; écrans 10b : S05.
- **Confiance** : confirmé (BKG-008 OBSERVÉ) ; BKG-023 proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : BKG-008 OUI ; BKG-023 SIMPLIFIÉ — texte fixe par pays au checkout, zones exclues par l'hôte reprises telles quelles.
- **Complexité** : faible ; ops faible ; risque moyen / faible.
- **Améliorations possibles** : géofencing défini par véhicule (TRP-054, P2).

#### Fiche BKG-012 — Contrôles bloquants à la réservation
- **FEATURE ID** : BKG-012
- **Nom** : Contrôles bloquants à la réservation
- **Module** : Réservation & contrat (BKG — Contrôles)
- **Persona** : PER-07 ; effets PER-01, PER-02, PER-08
- **Objectif** : empêcher toute réservation non conforme avant le paiement.
- **Description** : contrôles avec codes stables : KYC non approuvé ; âge minimum selon la classe (À DÉCIDER, défaut 21/25 ans, ADM-031 ; absorbe VER-025 et SRC-026) ; boîte manuelle non confirmée (BKG-025) ; réservation signalée (ADM-029) ; compte restreint (ADM-005) ; voiture restreinte ; chevauchement ; **auto-réservation** : un hôte ne réserve jamais sa propre voiture, ni par un compte lié (même appareil, même carte ; `self_booking_forbidden` = `true`, OQ-P2P-09, ACC-014) ; **hôte non activé** : la voiture n'est pas réservable si `p2p_private_hosts_enabled[pays]` ou `insurer_contract_active[pays]` vaut `false` ou si le compte d'hôte est suspendu (08 « Règle de blocage ») ; **caution impossible** : trip plus long que la validité de l'autorisation chez le PSP sans ré-autorisation validée ⇒ refus avant le paiement (BR-PAY-06, T59) ; code promo qui rendrait la jambe `PLATFORM` négative (08 E7 règle 5, TJ13).
- **Déclencheur** : avant création du hold.
- **Prérequis** : ADM-005, ADM-029, BKG-025, ADM-031.
- **Parcours principal** : évaluation séquentielle → tous OK → hold `CHECKOUT`.
- **Parcours alternatifs** : règle de risque → réservation signalée : hold `CHECKOUT` avec `review_required`, voiture bloquée `review_hold_minutes` = 120, aucun débit avant la décision de l'ops (`flagged_booking_payment_order` = `REVIEW_BEFORE_CHARGE`, UXQ-08) ; refus → motif compréhensible + code.
- **Règles métier** : BR-BOOK-11, BR-ACC-04, BR-ACC-10, BR-VERIF-09, BR-PAY-06.
- **États** : SM-1 `QUOTE` (refus) ; SM-1b `PENDING` (revue).
- **Erreurs** : `ACCOUNT_NOT_APPROVED`, `AGE_CLASS_MISMATCH`, `MANUAL_TRANSMISSION_NOT_CONFIRMED`, `BOOKING_UNDER_REVIEW`, `ACCOUNT_RESTRICTED`, `VEHICLE_RESTRICTED`, `GUEST_OVERLAP`, `SELF_BOOKING_FORBIDDEN`, `HOST_NOT_ACTIVATED`, `INSURER_CONTRACT_INACTIVE`, `DEPOSIT_RAIL_UNAVAILABLE`, `LEG_AMOUNT_NEGATIVE` (codes de 08 BR-BOOK-11 et 08 E7 quand ils existent ; les autres PROPOSÉS).
- **Données** : booking_check_log(quote_id, check, result, at).
- **Notifications** : —
- **Permissions** : `SYSTEM`.
- **Dépendances** : ADM-005 ; ADM-029 ; BKG-025 ; ADM-031.
- **Critères d'acceptation** : Given âge minimum 25 ans pour la classe Premium et un guest de 24 ans, When il réserve, Then `AGE_CLASS_MISMATCH`. Given un hôte qui tente de réserver sa propre voiture depuis son compte de voyageur, When il valide, Then `SELF_BOOKING_FORBIDDEN` et aucun hold. Given `insurer_contract_active[PA]` absent, When un guest réserve au Panama, Then `INSURER_CONTRACT_INACTIVE` et aucun paiement. Given un trip de 3 j + 25 min chez un PSP dont l'autorisation dure 168 h, sans ré-autorisation validée et avec `deposit_charge_cap` inconnu (`H_requise` = 168 h 25), When le guest valide, Then `DEPOSIT_RAIL_UNAVAILABLE` est affiché avant la page de paiement et la réservation est refusée pour cette durée (T59). Given le trip N et une promo plateforme de −90,00, When le guest applique le code, Then `LEG_AMOUNT_NEGATIVE` et le code est refusé (TJ13a).
- **Source** : 08 BR-BOOK-11, E7 ; écrans 10b : S04, S05.
- **Confiance** : documenté (base) ; codes et valeurs proposés.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — contrôles KYC vérifié, âge minimum, boîte manuelle, auto-réservation, interrupteurs du pays et caution seulement ; signalement traité par l'ops.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : moteur de règles configurable (ADM-011, P1).

#### Fiche BKG-016 — Lieux de prise et de retour
- **FEATURE ID** : BKG-016
- **Nom** : Lieux de prise et de retour déclarés par l'hôte
- **Module** : Réservation & contrat (BKG — Lieux)
- **Persona** : PER-01, PER-02, PER-08
- **Objectif** : fixer où la voiture est remise et rendue, sans exposer l'adresse de l'hôte avant la réservation.
- **Description** : l'hôte déclare un ou plusieurs points de rencontre sur l'annonce (A11) ; un lieu public proche est proposé par défaut, le domicile est un choix explicite ; avant réservation, seule la zone approximative est visible ; **adresse exacte après confirmation** (OQ-P2P-05) ; retour au même lieu par défaut ; one-way interdit (ex-BKG-017) ; remise **en personne** (`p2p_contactless_handover_enabled` = `false`) ; livraison et points d'intérêt en P1 (HST-034) ; aéroport selon BR-PICKUP-09 (OQ-MK-08).
- **Déclencheur** : publication de l'annonce (hôte) ; checkout (choix du point si plusieurs).
- **Prérequis** : HST-011.
- **Parcours principal** : point par défaut pré-sélectionné → retour identique → adresse exacte affichée sur S07 et dans le fil de messages après `BOOKED`.
- **Parcours alternatifs** : hôte avec plusieurs points → choix du guest parmi ceux de la voiture ; trip annulé → adresse retirée de la vue du guest.
- **Règles métier** : BR-BOOK-09, BR-PICKUP-09.
- **États** : —
- **Erreurs** : `ONE_WAY_NOT_ALLOWED`.
- **Données** : booking.pickup_location_id, return_location_id (= pickup en bêta) ; vehicle_location(vehicle_id, zone_label, exact_address chiffrée, kind).
- **Notifications** : adresse exacte jointe à `EVT_BOOKING_CONFIRMED`.
- **Permissions** : `P2P_HOST` (`catalog.listing_write`) ; `GUEST` (lecture de la zone, puis de l'adresse de son trip confirmé).
- **Dépendances** : HST-011.
- **Critères d'acceptation** : Given une demande avec retour différent, When elle est soumise, Then `ONE_WAY_NOT_ALLOWED`. Given une voiture affichée en recherche, When un guest sans trip confirmé lit la fiche, Then seule la zone approximative est renvoyée par l'API, jamais l'adresse exacte. Given un trip `BOOKED`, When le guest ouvre la confirmation, Then l'adresse exacte du point choisi est visible.
- **Source** : 05 G-BOOK ; SRC_G 2.3.1 ; écrans 10b : S03, S07, A11.
- **Confiance** : confirmé (OBSERVÉ) ; points multiples et lieu public par défaut proposés.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — un ou plusieurs points déclarés par l'hôte dans l'éditeur d'annonce, zone avant réservation et adresse exacte après confirmation ; pas de livraison.
- **Complexité** : moyenne ; ops moyen ; risque faible.
- **Améliorations possibles** : livraison (HST-034), aéroport (BKG-041), one-way (P1), remise sans contact (P1).

#### Fiche BKG-018 — Contrat de location par trip
- **FEATURE ID** : BKG-018
- **Nom** : Contrat de location hôte–voyageur par trip
- **Module** : Réservation & contrat (BKG — Contrat)
- **Persona** : PER-01, PER-02, PER-08
- **Objectif** : contrat opposable entre l'hôte particulier et le conducteur ; autorisation de conduite aux contrôles.
- **Description** : PDF par trip entre l'hôte (propriétaire, ou titulaire d'une autorisation notariée, BR-LIST-01) et le voyageur, en espagnol (version anglaise de courtoisie) ; Kmino est l'intermédiaire et **n'est pas partie** au contrat (LEG-014). Contenu : parties (prénom et nom de l'hôte, pièce masquée ; conducteur), voiture (plaque), période, lieu de remise, prix TTC, caution par carte et rails (PAY-011), plan de protection du voyageur et franchise, mentions de l'assureur partenaire (PRT-001, PRT-013), règles de l'hôte (non-fumeur, propreté, carburant, tout-terrain ; frais selon 08, ex-LST-021), grille de retard, interdiction de sortie du territoire. Régénéré à chaque modification ou ajout de conducteur ; versionné.
- **Déclencheur** : passage `BOOKED` ; modification par l'ops.
- **Prérequis** : LEG-011, PRT-001, PAY-011, LEG-014, LEG-002 ; modèle de contrat validé par l'avocat (OQ-BR-24, avant la mise en service).
- **Parcours principal** : génération → stockage immuable (empreinte) → envoi avec la confirmation → signature (BKG-019) avant la remise.
- **Parcours alternatifs** : modification (annulation + nouvelle réservation en bêta) → nouvelle version, l'ancienne conservée.
- **Règles métier** : BR-BOOK-12, BR-GEO-02, BR-FUEL-01, BR-CSP-02, BR-RETURN-03 (grille de retard affichée), BR-TT-03.
- **États** : contract `GENERATED` → `SIGNED` → `SUPERSEDED`.
- **Erreurs** : `CONTRACT_GENERATION_FAILED` (bloque la confirmation, alerte ops).
- **Données** : generated_document(trip_id, kind, version, lang, template_version, pdf_file_id, sha256, created_at).
- **Notifications** : pièce jointe de `EVT_BOOKING_CONFIRMED`.
- **Permissions** : `GUEST` du trip, `P2P_HOST` du compte d'hôte (`trip.read_org`), `OPS_AGENT`.
- **Dépendances** : LEG-011 ; PRT-001 ; PAY-011 ; LEG-014 ; LEG-002.
- **Critères d'acceptation** : Given un trip BOOKED, When le contrat est généré, Then il nomme l'hôte comme partie qui loue son propre véhicule et Kmino comme intermédiaire non partie, et contient plan de protection, franchise, caution, grille de retard et interdiction de sortie identiques à la fiche et au devis. Given une seconde génération, When elle a lieu, Then une nouvelle version est créée et l'ancienne reste consultable. Given un contrat non signé, When l'hôte tente de valider la remise (A03), Then refus.
- **Source** : SRC_G 10.2 ; écrans 10b : S07, S09, A03.
- **Confiance** : documenté (contrat par trip chez Turo) ; adaptation entre particuliers proposée.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : contrat consultable hors ligne (15 IMP-35, P1).

#### Fiche BKG-019 — Signature électronique horodatée du contrat
- **FEATURE ID** : BKG-019
- **Nom** : Signature électronique horodatée du contrat
- **Module** : Réservation & contrat (BKG — Contrat)
- **Persona** : PER-01, PER-02, PER-08
- **Objectif** : acceptation électronique conforme (Ley 51/2008 au Panama ; équivalent paraguayen à confirmer par l'avocat).
- **Description** : acceptation explicite (case + bouton) par le voyageur et par l'hôte, horodatage serveur, IP, user-agent, empreinte SHA-256 du PDF signé ; la même mécanique sert à l'acceptation des CGU de l'hôte (LEG-001).
- **Déclencheur** : après confirmation ; au plus tard à la remise, sur le téléphone du voyageur.
- **Prérequis** : BKG-018.
- **Parcours principal** : affichage du PDF → acceptation → enregistrement signature → contrat `SIGNED`.
- **Parcours alternatifs** : refus de signer → pas de remise, traitement no-show ou annulation selon le motif (BR-CXL-08).
- **Règles métier** : BR-BOOK-12.
- **États** : contract `GENERATED` → `SIGNED`.
- **Erreurs** : `CONTRACT_HASH_MISMATCH`, `CONTRACT_NOT_SIGNED`.
- **Données** : signature(contract_id, version, user_id, signed_at, ip, ua, sha256).
- **Notifications** : `EVT_CONTRACT_SIGNED` (copie par email aux deux parties).
- **Permissions** : `GUEST` du trip ; `P2P_HOST` titulaire du compte d'hôte.
- **Dépendances** : BKG-018.
- **Critères d'acceptation** : Given un PDF modifié après signature, When on recalcule l'empreinte, Then `CONTRACT_HASH_MISMATCH`. Given une signature, When le dossier CLM-034 est exporté, Then horodatage, IP et empreinte y figurent.
- **Source** : 08 BR-BOOK-12 reco ; écrans 10b : S05, S09.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — acceptation horodatée avec empreinte (case + horodatage serveur), sans prestataire de signature.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : prestataire de signature qualifiée si l'avocat l'exige.

#### Fiche BKG-022 — Écran et notification de confirmation
- **FEATURE ID** : BKG-022
- **Nom** : Écran et notification de confirmation
- **Module** : Réservation & contrat (BKG — Confirmation)
- **Persona** : PER-01, PER-02, PER-08
- **Objectif** : confirmer sans ambiguïté la réservation au voyageur et à l'hôte.
- **Description** : écran `web.s07.title` « ¡Reserva confirmada! » / « Your booking is confirmed! » avec numéro, voiture, dates, **adresse exacte du lieu de remise**, prénom de l'hôte et accès aux messages (S16), pièces à présenter (permis physique), montant de la caution autorisée, liens contrat et constancia ; notification NTF-007 au voyageur et à l'hôte (A02).
- **Déclencheur** : SM-1 → `BOOKED`, seulement après preuve de paiement (webhook signé ou `getOperation`, PAY-034).
- **Prérequis** : NTF-007.
- **Parcours principal** : preuve reçue → conversion gardée du hold → `booking.trip.booked` → écran (si le guest est revenu de la page du PSP) + notifications.
- **Parcours alternatifs** : retour du PSP avant la preuve → écran S06 `web.s06.verifying.title` « Pago en verificación » / « Verifying your payment » rafraîchi automatiquement (jamais « confirmé » avant la preuve, UX-27) ; échec → message et hold libéré ; mode `REQUEST` → état `web.s07.request.pending` (« {host_name} tiene hasta las {time} para responder… » / « {host_name} has until {time} to reply… ») jusqu'à la réponse de l'hôte (HDB-002).
- **Règles métier** : BR-BOOK-01.
- **États** : SM-1 `HOLD` → `BOOKED`.
- **Erreurs** : `PAYMENT_PENDING_CONFIRMATION` (état).
- **Données** : trip.booking_reference.
- **Notifications** : `EVT_BOOKING_CONFIRMED` (guest, hôte).
- **Permissions** : `GUEST` ; `P2P_HOST` (`trip.read_org`).
- **Dépendances** : NTF-007.
- **Critères d'acceptation** : Given un retour du PSP sans preuve reçue, When l'écran s'affiche, Then « en cours de confirmation » et aucune adresse exacte tant que le trip n'est pas BOOKED. Given la preuve signée avec ses montants par jambe, When elle arrive, Then l'écran passe à confirmé sans rechargement manuel et l'hôte reçoit la notification.
- **Source** : 08 BR-BOOK-01 ; 17 §4.5 ; écrans 10b : S06, S07, A02.
- **Confiance** : inféré.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — écran de confirmation et email (NTF-007) au voyageur, notification à l'hôte dans l'espace hôte.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : ajout au calendrier du guest (fichier .ics).

#### Fiche BKG-027 — Détail du trip (Manage trip)
- **FEATURE ID** : BKG-027
- **Nom** : Détail du trip (Manage trip)
- **Module** : Réservation & contrat (BKG — Mes voyages)
- **Persona** : PER-01, PER-02
- **Objectif** : accès en un point à tout ce qui concerne le trip.
- **Description** : reçu (FIN-002, sans valeur fiscale ; facture du trip fee quand elle existe), contrat, constancia, statut du paiement et de la caution, lieu de remise et horaires, hôte et messages, numéros d'aide (SUP-004), actions « annuler » (BKG-028), « signaler un problème » ; liste « Mis viajes » (à venir, passés, annulés). Absorbe BKG-026.
- **Déclencheur** : menu « Mis viajes ».
- **Prérequis** : trip existant.
- **Parcours principal** : liste → détail → téléchargement des documents.
- **Parcours alternatifs** : modification demandée → renvoi vers le support (P1 en libre-service).
- **Règles métier** : BR-MOD-01 (toute modification passe par un parcours unique ; ici le support en bêta).
- **États** : affichage de l'état SM-1.
- **Erreurs** : `FORBIDDEN` (trip d'un autre).
- **Données** : lecture trip, documents, payments.
- **Notifications** : —
- **Permissions** : `GUEST` propriétaire du trip.
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given un guest A, When il demande le trip de B, Then 403. Given un trip BOOKED, When il ouvre le détail, Then contrat, constancia et reçu sont téléchargeables.
- **Source** : SRC_G 4.1.4 ; 10.1 ; écrans 10b : S08, S09.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — page du trip : reçu, contrat, constancia, messages ; toute modification passe par le support.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : modifications et extensions en libre-service (TRP-020 à TRP-025, P1).

#### Fiche LEG-026 — Constancia de arrendamiento
- **FEATURE ID** : LEG-026
- **Nom** : Constancia de arrendamiento (PDF bilingue)
- **Module** : Légal, données & localisation (LEG — Contrat ; rattachée à E4)
- **Persona** : PER-01, PER-02, PER-08
- **Objectif** : document court présentable aux contrôles et pour contester une amende imputée au propriétaire.
- **Description** : PDF bilingue : hôte (propriétaire ou titulaire d'une autorisation ; pièce masquée), conducteur(s) (nom, pièce, permis), voiture (plaque), période exacte, lieu de remise, signature horodatée ; généré à la confirmation, régénéré à chaque modification ; téléchargeable par le voyageur et par l'hôte, mis en cache pour consultation hors ligne. Transfert d'amende au conducteur : OQ-BR-19 (P1).
- **Déclencheur** : `BOOKED` ; modification.
- **Prérequis** : BKG-018, BKG-019.
- **Parcours principal** : génération → stockage avec empreinte → lien dans la confirmation et le trip.
- **Parcours alternatifs** : amende reçue après le trip (EC-48) → l'hôte télécharge la constancia de la période depuis l'espace hôte.
- **Règles métier** : BR-TT-03.
- **États** : document versionné (`GENERATED` → `SUPERSEDED`).
- **Erreurs** : `DOCUMENT_GENERATION_FAILED`.
- **Données** : generated_document(trip_id, kind=CONSTANCIA, version, pdf_file_id, sha256).
- **Notifications** : jointe à `EVT_BOOKING_CONFIRMED`.
- **Permissions** : `GUEST` du trip, `P2P_HOST` (`trip.read_org`), `OPS_AGENT`.
- **Dépendances** : BKG-018 ; BKG-019.
- **Critères d'acceptation** : Given un trip BOOKED, When la constancia est ouverte, Then plaque, période exacte (fuseau du véhicule, `America/Panama` ou `America/Asuncion`) et identité du conducteur sont présentes en es et en, et la pièce de l'hôte est masquée. Given une recherche par plaque et date, When l'hôte la lance, Then il obtient la constancia du trip correspondant.
- **Source** : VERIF_07 NEW-05 ; 15 IMP-12 ; 11 EC-48 ; écrans 10b : S07, A05.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI.
- **Complexité** : faible ; ops faible ; risque moyen.
- **Améliorations possibles** : refacturation Panapass / ATTT (CLM-036, P1).

## E5 — Devis, taxes, trip fee et facturation (P0-A, 10 lignes)

#### Fiche PRC-001 — Prix journalier fixé par l'hôte
- **FEATURE ID** : PRC-001
- **Nom** : Prix journalier fixé par l'hôte
- **Module** : Tarification & devis (PRC — Prix de base)
- **Persona** : PER-08
- **Objectif** : l'hôte maîtrise le prix de sa voiture.
- **Description** : prix journalier HT par voiture, saisi par l'hôte dans l'éditeur d'annonce (A10) ou le calendrier (A06), en unités mineures de la devise du pays ; prix du trip = somme des prix journaliers des jours facturables (pas de remises en bêta). La part de l'hôte se calcule ensuite selon son plan (BR-PROT-06), jamais sur le trip fee.
- **Déclencheur** : création ou édition d'annonce.
- **Prérequis** : HST-005.
- **Parcours principal** : saisie → validation (> 0, plafond de cohérence PROPOSÉ) → prise en compte par les nouveaux devis seulement.
- **Parcours alternatifs** : modification avec trips confirmés → aucun effet sur leur devis figé.
- **Règles métier** : BR-PRICE-01, BR-PRICE-14.
- **États** : —
- **Erreurs** : `PRICE_INVALID`.
- **Données** : vehicle_price(vehicle_id, daily_price_minor, currency, valid_from).
- **Notifications** : —
- **Permissions** : `P2P_HOST` (`catalog.pricing_availability`) ; `CO_HOST` limité (P1).
- **Dépendances** : HST-005.
- **Critères d'acceptation** : Given un trip confirmé à 40,00/j, When l'hôte passe à 50,00, Then le trip garde 40,00 et une nouvelle recherche affiche 50,00. Given une voiture paraguayenne, When l'hôte saisit 250 000, Then le prix est stocké en PYG sans décimale.
- **Source** : SRC_H H29 ; 08 BR-PRICE-01 ; écrans 10b : A10, A06.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — prix journalier unique saisi par l'hôte dans l'éditeur d'annonce, modifiable par date dans le calendrier ; pas de remises.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : remises de durée, tarification intelligente (PRC-002, PRC-003, PRC-008, P1–P2).

#### Fiche PRC-012 — Frais de service guest (trip fee)
- **FEATURE ID** : PRC-012
- **Nom** : Trip fee (frais de service du voyageur)
- **Module** : Tarification & devis (PRC — Frais plateforme)
- **Persona** : PER-01, PER-02
- **Objectif** : revenu de Kmino sur chaque trip, comme chez Turo.
- **Description** : ligne F du devis appliquée telle quelle (08 BR-PRICE-06, Q-004) : barème publié en interne `clamp(base% × f(durée, anticipation, classe), min, max)`, MVP 15 % (≤ 6 j), 12 % (7–29 j), 8 % (≥ 30 j), minimum 5 USD / 35 000 PYG (`{param}`). Le trip fee et sa taxe vont **entièrement à la jambe `PLATFORM`** (08 E7) ; jamais partagés avec l'hôte ni avec l'assureur ; la taxe sur F est une dette propre de Kmino (`tax_payable`), jamais une jambe `TAX_THIRD_PARTY`. Remboursé dans les annulations gratuites ; retenu ligne par ligne sinon (BR-CXL-06). Facturé au voyageur par Kmino (FIN-018). Facturer le consommateur avant la mise en service suppose l'avis OQ-MK-01 (DEC-FONDATEUR-02 : bloque la mise en service, pas le build).
- **Déclencheur** : devis.
- **Prérequis** : PRC-025.
- **Parcours principal** : ligne `TRIP_FEE` dans le devis, taxable selon `tax_line_config`, affectée à `PLATFORM`.
- **Parcours alternatifs** : annulation hors fenêtre → F retenu ligne par ligne (T03 : 6,00 retenus) ; annulation gratuite → F remboursé.
- **Règles métier** : BR-PRICE-06, BR-CXL-06.
- **États** : —
- **Erreurs** : —
- **Données** : quote.lines[type=TRIP_FEE] ; settlement_leg (`PLATFORM`).
- **Notifications** : —
- **Permissions** : `ADMIN` (barème, paramètre pays daté).
- **Dépendances** : PRC-025.
- **Critères d'acceptation** : Given le trip A, When le devis est calculé, Then F = 18,00 et F n'entre dans aucune jambe autre que `PLATFORM` (TJ01). Given T03 (annulation guest, j = 1), When le règlement est calculé, Then 6,00 de F sont retenus et vont à `PLATFORM` (TJ02a). Given un trip PYG de 3 jours dont 15 % donnent moins de 35 000, When le devis est calculé, Then F = 35 000.
- **Source** : 05 G-BOOK-02, G-BOOK-06 ; EV-0007 ; EV-0026 ; 08 E7 ; écrans 10b : S03, S05.
- **Confiance** : confirmé (montants observés, taux recalculé) ; barème proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI.
- **Complexité** : moyenne ; ops faible ; risque élevé.
- **Améliorations possibles** : prix tout compris (PRC-026, P1).

#### Fiche PRC-020 — Moteur de taxes par marché (ITBMS, IVA)
- **FEATURE ID** : PRC-020
- **Nom** : Moteur de taxes par marché
- **Module** : Tarification & devis (PRC — Taxes)
- **Persona** : PER-06 ; effet guest
- **Objectif** : afficher et contractualiser un total TTC exact, et ranger chaque taxe dans la bonne jambe.
- **Description** : ITBMS 7 % (PA) et IVA 10 % (PY), paramètres datés ADM-014, calculés **ligne par ligne** ; table versionnée `tax_line_config(country_code, line_type, version)` avec, par groupe fiscal, le booléen `third_party` (défaut `false`, 08 BR-PRICE-12). La taxe sur le trip fee, la marge de protection et les frais de Kmino est une dette propre de Kmino (`tax_payable`, jambe `PLATFORM`) ; la taxe sur le loyer de l'hôte ne forme la jambe `TAX_THIRD_PARTY` que si l'avis OQ-BR-14 fait de Kmino le collecteur (`third_party` = `true`). Assiette exacte : OQ-BR-14, OQ-MK-06. Les deux pays sont construits (DEC-FONDATEUR-04).
- **Déclencheur** : chaque devis.
- **Prérequis** : PRC-021, ADM-014.
- **Parcours principal** : lignes taxables → taxe par ligne `roundHalfUp` → somme par groupe fiscal → affectation à la jambe selon `third_party`.
- **Parcours alternatifs** : changement de taux → nouveau `valid_from`, devis figés inchangés ; configuration absente → voiture non réservable.
- **Règles métier** : BR-PRICE-12, BR-PRICE-14, BR-CXL-06 (prorata de la taxe remboursée).
- **États** : —
- **Erreurs** : `TAX_CONFIG_MISSING` (devis impossible, voiture exclue).
- **Données** : tax_rate(country, code, rate, valid_from), tax_line_config(country_code, line_type, version, third_party).
- **Notifications** : —
- **Permissions** : `ADMIN` (configuration).
- **Dépendances** : PRC-021 ; ADM-014.
- **Critères d'acceptation** : Given P = 120,00 à 7 %, When le devis est calculé, Then ITBMS 8,40 (TA01). Given deux lignes de 10,05, When la taxe est calculée, Then 0,70 + 0,70 = 1,40 et non 1,41 (T43). Given le trip J3 avec une taxe de 10 % sur P marquée `third_party`, When le devis est capturé, Then la jambe `TAX_THIRD_PARTY` vaut 100 000 et les autres jambes sont celles de TJ10a (TJ11a). Given `third_party` = `false` partout, When le trip A est capturé, Then `TAX_THIRD_PARTY` = 0,00 (TJ01).
- **Source** : 05 G-BOOK-02 (formule de Floride vérifiée au centime) ; SRC_G 2.4.9 ; EV-0007 ; 08 E7 ; écrans 10b : — (traitement serveur).
- **Confiance** : confirmé (pour la Floride) ; formules Panama et Paraguay proposées.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — ITBMS ou IVA sur les lignes du devis, `third_party` à `false` partout tant qu'OQ-BR-14 est ouverte.
- **Complexité** : moyenne ; ops faible ; risque élevé.
- **Améliorations possibles** : taxes locales supplémentaires si un avis les impose (nouveau groupe fiscal, sans code).

#### Fiche PRC-021 — Arrondis et montants en unités mineures
- **FEATURE ID** : PRC-021
- **Nom** : Arrondis et montants en unités mineures
- **Module** : Tarification & devis (PRC — Devise)
- **Persona** : technique (toutes les fonctions monétaires)
- **Objectif** : exactitude au cent, aucun résidu perdu, même par jambe.
- **Description** : type `Money{amount_minor, currency}` ; ratios en fractions exactes ; `roundHalfUp` par ligne ; part de l'hôte par `allocHost` (au plus proche, égalité exacte → plateforme) ; prime de l'assureur et taxe par `roundHalfUp` ; `PLATFORM` reçoit le complément, donc Σ jambes = montant exact (08 E7 règle 8) ; PYG sans décimale (DEC-FONDATEUR-04).
- **Déclencheur** : tout calcul monétaire.
- **Prérequis** : aucun.
- **Parcours principal** : bibliothèque monétaire unique (`roundHalfUp`, `allocHost`), interdite de contournement (revue de code, lint).
- **Parcours alternatifs** : devise inconnue → erreur.
- **Règles métier** : BR-PRICE-14 ; BR-CXL-06 (taxe par ligne).
- **États** : —
- **Erreurs** : `CURRENCY_UNSUPPORTED`, `MONEY_CURRENCY_MISMATCH`, `LEG_SUM_MISMATCH`.
- **Données** : colonnes `*_minor` entières + `currency`.
- **Notifications** : —
- **Permissions** : —
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given les vecteurs T40, T42, T43 et TA06, When le moteur les rejoue, Then résultats identiques au cent (ou à l'unité PYG) près. Given le trip J (PYG), When la capture est ventilée, Then `allocHost(1 000 001 ; 3/4)` donne 750 001, l'assureur 280 001 et Σ jambes = 1 605 002 (TJ10a). Given l'addition de deux devises, When elle est tentée, Then `MONEY_CURRENCY_MISMATCH`.
- **Source** : TOS-GENERAL ; 08 BR-PRICE-14, E7 ; 11 EC-32 ; écrans 10b : — (traitement serveur).
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : OUI.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : —

#### Fiche PRC-025 — Moteur de devis versionné
- **FEATURE ID** : PRC-025
- **Nom** : Moteur de devis versionné
- **Module** : Tarification & devis (PRC — Moteur)
- **Persona** : technique ; effet tous
- **Objectif** : un seul calcul pour l'affichage, le contrat, les remboursements et les jambes.
- **Description** : prix journaliers × jours facturables (règle actuelle de 04 : max(1, ceil((fin − début − 29 min)/24 h)), ex-BKG-021 ; **paramètre `grace_minutes`, OQ-BR-04 ouverte**), trip fee (PRC-012), protection du voyageur (BR-PRICE-11), remises (P1), Extras (P1), distance incluse, taxes (PRC-020), montant de la caution (affiché, autorisé, non débité) ; part de l'hôte figée (`hostSharePctFrozen`, plan de l'hôte, défaut `ESTÁNDAR` 75 %) et parts de l'assureur figées (`insurerPremiumShareFrozen`, `insurerRoadsideShareFrozen`) ; jambes calculées par la fonction pure de règlement (08 E7) ; une version figée par réservation et par modification ; rejouable.
- **Déclencheur** : recherche (provisoire), checkout (figé), modification, annulation.
- **Prérequis** : PRC-001, PRC-020, PRC-021.
- **Parcours principal** : entrées (voiture, dates, plan, paramètres datés) → lignes → jambes → total → version figée liée au trip.
- **Parcours alternatifs** : paramètre manquant → `QUOTE_UNAVAILABLE` ; modification → nouvelle version, la précédente conservée.
- **Règles métier** : BR-PRICE-13, BR-MOD-06, BR-BOOK-03, BR-PRICE-17, BR-PROT-06, BR-CXL (règlement : `computeCancellationSettlement`).
- **États** : quote `PROVISIONAL` → `FROZEN` → `SUPERSEDED`.
- **Erreurs** : `QUOTE_UNAVAILABLE`, `QUOTE_EXPIRED`, `LEG_AMOUNT_NEGATIVE`.
- **Données** : quote(id, trip_id, version, inputs_snapshot, params_snapshot, lines[], legs[], total_minor, frozen_at).
- **Notifications** : —
- **Permissions** : `SYSTEM`.
- **Dépendances** : PRC-001 ; PRC-020 ; PRC-021.
- **Critères d'acceptation** : Given un devis figé, When il est rejoué avec ses entrées et paramètres, Then le total et chaque jambe sont identiques à l'unité mineure. Given TA07, When les jours facturables sont calculés, Then 3, 4 et 1. Given T01–T27, When le règlement est calculé à partir du devis figé, Then les remboursements, taxes et gains de l'hôte attendus sont obtenus, et pour T03 et T27 les jambes retenues sont celles de TJ02a et TJ08b. Given un plan de l'hôte modifié après la réservation, When le devis figé est rejoué, Then `hostSharePctFrozen` reste celui de la réservation.
- **Source** : 09 §3 (formule de référence) ; 08 BR-MOD-06 reco, E7 ; écrans 10b : S03, S05.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — devis versionné avec trip fee, protection et jambes, sans remises ni Extras.
- **Complexité** : élevée ; ops faible ; risque moyen.
- **Améliorations possibles** : remises, non remboursable, jeune conducteur (P1).

#### Fiche FIN-001 — Grand livre en partie double par jambe
- **FEATURE ID** : FIN-001
- **Nom** : Grand livre en partie double par jambe
- **Module** : Finance & facturation (FIN — Comptabilité)
- **Persona** : PER-06
- **Objectif** : comptabiliser sans perte chaque jambe de chaque opération, et distinguer les fonds de tiers des revenus de Kmino.
- **Description** : plan de comptes de 08 E4 et E7, écritures de référence de 17 §3.5 : produits de Kmino (trip fee, part plateforme du loyer, marge de protection) et taxe sur ses lignes (`tax_payable`) ; `host_payable` et `host_ledger` (dette envers les hôtes, créances, pénalités) ; `insurer_payable` (primes dues, séparé) ; `tax_third_party_payable` (vide par défaut) ; `psp_clearing` ; avances de Kmino (`platform_advance_clearing`) ; crédits accordés. **Variante A** (`SPLIT_AT_SOURCE`) : les comptes des tiers sont des **comptes d'ordre**, registre miroir des soldes tenus par le PSP, hors bilan de Kmino (08 E7 règle 11) ; **variante B** (`PLATFORM_MOR`, seulement si `funds_holding_enabled[pays]` = `true`) : comptes propres. Écritures par événement : capture → jambes ; règlement → variation signée par jambe ; réaffectation → `host_payable` vers la plateforme ; libération → versement ; bordereau → prime. Écritures immuables (correction par extourne), unités mineures, une devise par compte.
- **Déclencheur** : événements de paiement, de règlement, de libération, de versement et de bordereau.
- **Prérequis** : aucun.
- **Parcours principal** : événement → écriture équilibrée idempotente (clé = événement + version) → mise à jour de `trip_leg_balance`.
- **Parcours alternatifs** : requalification d'un trip (SM-7) → contre-passation puis nouvelle écriture (T36 en logique) ; réaffectation d'une jambe déjà libérée → avance de Kmino et créance au `host_ledger` (08 E7 règle 3 bis, TJ18).
- **Règles métier** : BR-PAYOUT-04, BR-PRICE-14 ; 08 « Exécution monétaire » E4, E7.
- **États** : —
- **Erreurs** : `LEDGER_UNBALANCED` (transaction rejetée), `LEDGER_DUPLICATE_EVENT` (idempotent, ignoré), `LEG_SUM_MISMATCH`.
- **Données** : journal_line(id, txn_id, account, debit_minor, credit_minor, currency, event_ref, created_at) ; trip_leg_balance(trip_id, segment_id, leg, balance_minor) ; settlement_leg.
- **Notifications** : —
- **Permissions** : `FINANCE` (lecture), `SYSTEM` (écriture par commande ; aucune écriture de table par les rôles applicatifs, 17 §2.3).
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given toute transaction, When elle est écrite, Then Σ débits = Σ crédits (test automatique). Given la capture du trip A, When elle est comptabilisée en variante A, Then `host_payable` 131,25, `insurer_payable` 25,50 et la part `PLATFORM` 99,91 apparaissent, les deux premiers en comptes d'ordre (TJ01). Given le règlement T39 d'un hôte inéligible, When il est comptabilisé, Then 18,53 passent de `host_payable` à la plateforme (TJ05b). Given un rejeu d'événement, When il arrive, Then aucune écriture en double.
- **Source** : 08 BR-PAYOUT-04 reco, E4, E7 ; 17 §2.9, §3.5 ; écrans 10b : — (outil interne).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : MANUEL — pas de grand livre en partie double dans la tranche : le règlement versionné porte les jambes dès le lot 0, `trip_leg_balance` et le `host_ledger` (PYO-007) servent les versements au lot 3, et la finance tient la comptabilité sur l'export des jambes ; grand livre complet au lot 5 (US-530 adaptée).
- **Complexité** : élevée ; ops moyen ; risque moyen.
- **Améliorations possibles** : export comptable (P1).

#### Fiche FIN-002 / FIN-003 — Facturation électronique : port fiscal PAC (Panama) et SIFEN (Paraguay)
- **FEATURE ID** : FIN-002, FIN-003
- **Nom** : Facturation électronique PAC (Panama) (FIN-002) ; facturation électronique SIFEN (Paraguay) (FIN-003)
- **Module** : Finance & facturation (FIN — Fiscalité)
- **Persona** : PER-06 ; PER-01, PER-02 (destinataires) ; PER-08 (reçu)
- **Objectif** : facture fiscale des services de Kmino au voyageur (trip fee, marge de protection, frais) et reçu des frais retenus à l'hôte.
- **Description** : port fiscal unique `EInvoicingProvider` : facture du trip fee et des frais de Kmino au voyageur, émise par l'entité qui facture (OQ-MK-06, OQ-BR-14), au Panama par un PAC (CUFE), au Paraguay par SIFEN (DNIT), en PYG sans décimale avec IVA 10 %. Kmino **ne facture pas le loyer** de l'hôte particulier (jambe `TAX_THIRD_PARTY` vide par défaut). Reçu détaillé du trip pour le voyageur (ex-PAY-029) **sans valeur fiscale** ; reçu des frais retenus sur la jambe de l'hôte (part plateforme du loyer selon le plan). Les deux sont construits au lot 2 contre un adaptateur `FAKE` (DEC-FONDATEUR-03) ; le connecteur réel du pays de lancement est livré au lot C (FIN-020, E18).
- **Déclencheur** : trip terminé ou règlement d'annulation (facture du trip fee retenu) ; clôture mensuelle (reçu de l'hôte, FIN-018).
- **Prérequis** : FIN-001 ; choix de l'entité qui facture.
- **Parcours principal** : facture → PAC ou SIFEN (adaptateur) → numéro d'autorité → PDF au voyageur.
- **Parcours alternatifs** : autorité indisponible → file de réessai, facture non envoyée avant validation ; correction → avoir.
- **Règles métier** : BR-PRICE-12, BR-PRICE-06, BR-PAYOUT-05.
- **États** : fiscal_document `DRAFT` → `ISSUED` → `CREDITED`.
- **Erreurs** : `PAC_REJECTED`, `PAC_UNAVAILABLE` (mêmes codes pour l'autorité SIFEN).
- **Données** : fiscal_document(id, customer_ref (voyageur ou hôte), kind (`TRIP_FEE_INVOICE`, `HOST_FEE_RECEIPT`, `CREDIT_NOTE`), trip_id, subtotal_minor, tax_minor, total_minor, currency, authority_ref, status).
- **Notifications** : `EVT_TRIP_FEE_INVOICE_ISSUED` (voyageur).
- **Permissions** : `FINANCE` ; `GUEST` (ses factures) ; `P2P_HOST` titulaire (ses reçus).
- **Dépendances** : FIN-002 → FIN-001 ; FIN-003 → FIN-001, FIN-002.
- **Critères d'acceptation** : Given un rejet de l'autorité, When il survient, Then la facture reste `DRAFT` avec le motif. Given le trip A terminé, When la facture du voyageur est émise, Then elle porte F 18,00 et la taxe sur F, et aucune ligne de loyer de l'hôte. Given un trip au Paraguay, When la facture est émise par l'adaptateur `FAKE`, Then elle est en PYG sans décimale avec IVA 10 % et aucun code propre au pays n'existe hors adaptateur.
- **Source** : 08 BR-PRICE-12 reco ; 12 §3.6 ; 13 (SIFEN) ; écrans 10b : S09, A08.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : MANUEL (les deux) — facture du trip fee émise par le comptable dans l'outil PAC (Panama) ou sur le portail de la DNIT (Paraguay) à partir de l'export des jambes `PLATFORM` ; reçu PDF de la plateforme sans valeur fiscale.
- **Complexité** : élevée ; ops moyen ; risque élevé.
- **Améliorations possibles** : facture du loyer pour le compte de l'hôte si un avis le permet (P1).

#### Fiche FIN-018 / PYO-013 — Facture du trip fee et relevé mensuel des gains de l'hôte
- **FEATURE ID** : FIN-018, PYO-013
- **Nom** : Facturation des frais de Kmino (FIN-018) ; relevé mensuel des gains de l'hôte (PYO-013)
- **Module** : Finance & facturation (FIN — Facturation ; PYO — Documents)
- **Persona** : PER-06, PER-08 ; PER-01, PER-02
- **Objectif** : facturer les revenus de Kmino là où ils naissent (jambe `PLATFORM`) et donner à l'hôte un relevé lisible de ce qu'il a gagné.
- **Description** : FIN-018 : Kmino facture au voyageur son trip fee (BR-PRICE-06) et ses frais, avec la taxe du pays (FIN-002) ; il remet à l'hôte un reçu des frais retenus sur sa jambe (part plateforme du loyer selon le plan, BR-PROT-06). **Aucune facture n'est adressée à un hôte pour sa part** : la part de l'hôte vient de son plan (`hostSharePctFrozen`, défaut `ESTÁNDAR` 75 %, OQ-P2P-11). PYO-013 : relevé mensuel par hôte (`host_earnings_statement`, lignes `host_earnings_line`) : trips terminés et annulés, jambe `HOST` par trip, pénalités d'annulation de l'hôte (BR-CXL-13, retenues sur ses gains au `host_ledger`), franchises, ajustements, versements effectués (PYO-002) et solde du `host_ledger` (PYO-007) ; base du relevé fiscal annuel (FIN-008). Les dettes de l'hôte se recouvrent par compensation sur ses versements (BR-PAYOUT-04), jamais par une facture.
- **Déclencheur** : FIN-018 : trip terminé ou règlement ; PYO-013 : clôture mensuelle (J+1 du mois suivant, PROPOSÉ).
- **Prérequis** : FIN-001, PAY-034, FIN-002 ; PYO-007, FIN-008.
- **Parcours principal** : clôture → calcul depuis `settlement_leg` → relevé `DRAFT` → contrôle finance → publication dans l'espace hôte (A08) → notification.
- **Parcours alternatifs** : contestation de l'hôte → ajustement par une nouvelle version de règlement ou une écriture motivée, relevé rectificatif ; correction d'une facture du voyageur → avoir.
- **Règles métier** : BR-PAYOUT-05, BR-PRICE-12, BR-PRICE-06, BR-PROT-06, BR-CXL-13, BR-PRICE-14.
- **États** : fiscal_document `DRAFT` → `ISSUED` → `CREDITED` ; host_earnings_statement `DRAFT` → `ISSUED` → `SUPERSEDED`.
- **Erreurs** : `STATEMENT_NOT_RECONCILED`, `INVOICE_WITHOUT_TRIP`.
- **Données** : host_earnings_statement(org_id, period_month, currency, host_leg_minor, penalties_minor, adjustments_minor, payouts_minor, ledger_balance_minor, status) ; host_earnings_line(statement_id, trip_id, host_leg_minor, kind) ; fiscal_document (FIN-002).
- **Notifications** : `EVT_EARNINGS_STATEMENT_ISSUED` (hôte, `finance.statement.issued`), `EVT_TRIP_FEE_INVOICE_ISSUED` (voyageur).
- **Permissions** : `FINANCE` (émission) ; `P2P_HOST` titulaire seulement (lecture de la jambe `HOST`, RLS-28 ; jamais un `CO_HOST`) ; `GUEST` (ses factures).
- **Dépendances** : FIN-018 → FIN-001, PAY-034, FIN-002 ; PYO-013 → PYO-007, FIN-008.
- **Critères d'acceptation** : Given le trip A terminé et le trip D terminé du même hôte dans deux devises, When le relevé est produit, Then deux relevés distincts, l'un avec `HOST` 131,25 (TJ01) et l'autre avec `HOST` 787 500 PYG (TJ08a), sans conversion. Given l'annulation T03 dans le mois, When le relevé est produit, Then une ligne `HOST` 45,00 (TJ02a) et aucune autre retenue que celles de son plan. Given les factures des voyageurs du mois, When la finance les totalise, Then le total facturé égale la somme des jambes `PLATFORM` facturables des trips du mois. Given un co-hôte, When il demande le relevé, Then 403.
- **Source** : VERIF_07 NEW-02 ; 08 BR-PAYOUT-05 reco, E7 ; 17 §2.10, §3.2 ; écrans 10b : A08, S09.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lots 2 et 3 : lot 2 pour FIN-018, lot 3 pour PYO-013)
- **Bêta pilote** : FIN-018 SIMPLIFIÉ — montants des jambes `PLATFORM` calculés par la plateforme, facture émise hors plateforme par le comptable (FIN-002 MANUEL) ; PYO-013 MANUEL — relevé mensuel des gains produit par export des jambes `HOST` et du `host_ledger` dans un tableur, envoyé à l'hôte par email.
- **Complexité** : moyenne ; ops moyen / faible ; risque élevé / moyen.
- **Améliorations possibles** : relevé fiscal annuel en libre-service (FIN-008, lot 5) ; export pour le comptable de l'hôte.

## E6 — Paiement par jambes (Kmino marchand de référence) et caution par carte (P0-A, 14 lignes)

#### Fiche PAY-001 — Abstraction du PSP de place de marché (PaymentProvider à jambes)
- **FEATURE ID** : PAY-001
- **Nom** : Abstraction du PSP de place de marché (`PaymentProvider`, montants par jambe)
- **Module** : Paiements (PAY — Architecture)
- **Persona** : technique ; PER-07 ; PER-06
- **Objectif** : encaisser chaque trip au nom de Kmino, marchand de référence, et répartir chaque opération en jambes explicites calculées par le règlement, sans qu'aucun code métier ne connaisse un PSP.
- **Description** : interface de 17 §2.8 : `createHostedPayment(amount, legs)`, `capture(amount, legs)`, `void`, `refund(amount, legs)`, `reallocate(legs)`, `chargeMIT(reason, amount, legs)`, `reauthorize`, `registerSubmerchant(host)` / `getSubmerchant`, `releaseLeg` / `holdLeg`, `payout(host, amount)`, `adjustPayout`, `transferFromPlatform`, `getOperation`, `listTransactions` / `listLegBalances`, `verifyAndParseWebhook`. Type commun `LegAmounts = { HOST, INSURER, TAX_THIRD_PARTY, PLATFORM }` en unités mineures `bigint` ; l'adaptateur vérifie Σ jambes = montant et chaque jambe ≥ 0 (sauf `reallocate`, de somme nulle) **avant** tout appel, sinon `LEG_SUM_MISMATCH` ou `LEG_AMOUNT_NEGATIVE` sans appel au PSP. Un seul compte marchand de Kmino par pays et par PSP (`psp_account.owner_type = PLATFORM`) ; chaque hôte est sous-marchand (`psp_submerchant`, KYC du PSP en plus du nôtre) ; l'assureur partenaire est bénéficiaire tiers. Le PSP ne calcule jamais de prorata (08 E7 règle 1 ; contre-exemple TJ10c, écart de 68 535 PYG sur la jambe `HOST`). Capacités dans `psp_capability` ; une capacité inconnue vaut « non » ; les capacités **bloquantes** (`SUPPORTS_SUBMERCHANT`, `SUPPORTS_INDIVIDUAL_SUBMERCHANT`, `SUPPORTS_MULTI_LEG_SPLIT` en variante A, `SUPPORTS_PER_LEG_AMOUNTS`, `SUPPORTS_B2C_PAYOUT`, `SUPPORTS_DELAYED_PAYOUT_RELEASE`, `SUPPORTS_PAYOUT_ADJUSTMENT`, `SUPPORTS_NEGATIVE_BALANCE_RECOVERY`, `SUPPORTS_PARTIAL_CAPTURE`, `SUPPORTS_REFUND`, `SUPPORTS_MIT`, `WEBHOOK_SIGNATURE_SCHEME`, `SUPPORTS_LOOKUP_BY_MERCHANT_REF`, `CHARGEBACK_NOTIFICATION_CHANNEL`) conditionnent l'activation de tout hôte du pays. Exécution par pays : `collection_mode[pays]` ∈ {`SPLIT_AT_SOURCE` (variante A, aucun fonds de tiers chez Kmino), `PLATFORM_MOR` (variante B, seulement si `funds_holding_enabled[pays]` = `true`)} ; les montants par jambe sont identiques dans les deux variantes. Paiement par page ou champs hébergés (SAQ A). **DEC-FONDATEUR-03** : seul l'adaptateur `FAKE` est construit avant le choix du pays ; il simule, en mode normal et en mode hostile, webhooks signés, refus reçus, réponses inconnues, ordre Yappy de 300 s, capacités présentes ou absentes, sous-marchand suspendu, jambe déjà libérée ; il n'est jamais actif en production (C19, ADR-032). Identifiants du compte de Kmino dans le coffre, déchiffrés seulement par le travailleur de commandes, chaque usage journalisé (17 §2.8).
- **Déclencheur** : toute opération de paiement, de remboursement, de réaffectation, de versement ou de webhook.
- **Prérequis** : coffre de secrets (ADM-032) ; règlement versionné (08 E1, E7).
- **Parcours principal** : commande métier avec `LegAmounts` issus du `settlement` ou de la capture → boîte d'envoi monétaire (`payment_command`, 17 §4.3) → contrôle indépendant du travailleur (montant et jambes = instance, Σ remboursements ≤ encaissé jambe par jambe) → adaptateur du PSP du pays → réponse normalisée → `payment_operation` et `payment_operation_leg` → journal.
- **Parcours alternatifs** : PSP indisponible (EC-29) → erreur normalisée, aucun état incohérent, réessai avec la même clé ; réponse inconnue → `UNKNOWN_OUTCOME`, lecture par `getOperation`, jamais de renvoi avec une nouvelle clé (08 E4) ; capacité bloquante absente ou retirée → aucun hôte activable dans le pays (`HOST_PAYOUT_RAIL_UNAVAILABLE`), lots `ON_HOLD`, revue ops et FINANCE (08 E7 règle 3 bis) ; capacité non bloquante absente → parade fail-closed de 17 §2.8 (ex. sans `SUPPORTS_VOID`, repli E3).
- **Règles métier** : BR-PAY-01 ; 08 E3 (rails et capacités par PSP), E4 (idempotence), E7 règles 1 à 11 (jambes explicites) ; Règle de blocage de 08.
- **États** : `payment_operation` `CREATED` → `SUBMITTED` → `SUCCEEDED` / `FAILED` / `UNKNOWN` ; `psp_submerchant.kyc_status` `PENDING` → `ACTIVE` / `SUSPENDED` / `REJECTED` ; SM-8 pour les remboursements.
- **Erreurs** : `PROVIDER_UNAVAILABLE`, `UNSUPPORTED_CAPABILITY`, `LEG_SUM_MISMATCH`, `LEG_AMOUNT_NEGATIVE`, `LEG_ALREADY_RELEASED`, `UNKNOWN_OUTCOME`, `HOST_PAYOUT_RAIL_UNAVAILABLE`.
- **Données** : `psp_account`(provider, country_code, environment, owner_type = `PLATFORM`, collection_mode, credentials_ref, webhook_secret_ref) ; `psp_capability` ; `psp_submerchant`(org_id, provider_submerchant_ref, kyc_status, payout_currency) ; `payment_operation` ; `payment_operation_leg`(operation_id, leg, amount_minor, beneficiary_ref) ; `payment_command` ; `audit_log` (usage des identifiants) (17 §3.2.7).
- **Notifications** : `EVT_PSP_FAILURE` (ops) ; alerte « aucun webhook reçu depuis `webhook_silence_alert_hours` ».
- **Permissions** : `SYSTEM` (travailleur de commandes) ; `ADMIN` (configuration des capacités, jamais des interrupteurs de mise en service) ; aucun humain ne lit les secrets en clair.
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given un second adaptateur, When il est ajouté, Then aucun module métier n'est modifié (revue de diff). Given une capture de 256,66 USD avec les jambes de TJ01 (`HOST` 131,25, `INSURER` 25,50, `TAX_THIRD_PARTY` 0,00, `PLATFORM` 99,91), When l'adaptateur `FAKE` la reçoit, Then une opération et quatre lignes `payment_operation_leg` dont la somme vaut 256,66 sont enregistrées. Given des jambes dont la somme vaut 256,65 pour un montant de 256,66, When la commande est préparée, Then `LEG_SUM_MISMATCH` et aucun appel au PSP. Given un PSP dont `SUPPORTS_PER_LEG_AMOUNTS` vaut `UNKNOWN`, When un hôte du pays demande son activation, Then `HOST_PAYOUT_RAIL_UNAVAILABLE` et l'hôte reste inactif. Given l'image ou la configuration de production, When un adaptateur `FAKE` y est déclaré, Then le service refuse de démarrer et la contrainte de base rejette la ligne (test C19, ADR-032). Given la base de données, When on la parcourt, Then aucun PAN ni CVV n'y figure.
- **Source** : 08 BR-PAY-01, E7 ; 17 §0.1, §2.8, ADR-045 ; 09b §5.2 ; analyse pivot §c.5 ; écrans 10b : S06.
- **Confiance** : proposé (montage de place de marché « comme Turo », mécanique de jambes nôtre).
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ — interface complète à `LegAmounts` et un seul adaptateur `FAKE` (modes normal et hostile, capacités configurables) ; aucun connecteur réel avant le lot C (PAY-042).
- **Complexité** : élevée ; ops moyen ; risque élevé.
- **Améliorations possibles** : routage entre PSP par coût et taux d'acceptation (P2).

#### Fiche PAY-002 / PAY-017 / PAY-018 — Cartes, refus et 3-D Secure
- **FEATURE ID** : PAY-002, PAY-017, PAY-018
- **Nom** : Cartes de crédit et de débit au nom du guest (PAY-002) ; gestion des refus de carte (PAY-017) ; authentification 3-D Secure (PAY-018)
- **Module** : Paiements (PAY — Moyens, Échecs, Sécurité)
- **Persona** : PER-01, PER-02
- **Objectif** : payer par carte sur le compte marchand de Kmino avec un bon taux d'acceptation et sans fraude.
- **Description** : PAY-002 (absorbe PAY-005) : Visa, Mastercard, Amex selon le PSP de place de marché du pays, crédit et débit ; prépayées refusées par BIN (référence Turo, sauf Revolut). PAY-017 : message selon le code de refus, 3 tentatives par hold `CHECKOUT`, moyen alternatif proposé, anti card-testing (3 refus en 1 h → règle ADM-029). PAY-018 : 3DS2 au premier paiement de chaque carte (CIT), sans friction ou avec challenge, dans la durée du hold `CHECKOUT` (`hold_max_total_minutes` = 20) ; échec ou abandon = refus, hold libéré ; disponibilité par PSP : OQ-PAY-03. La carte retenue devient l'instrument de la caution (PAY-011) et, avec consentement, du débit ultérieur (PAY-015).
- **Déclencheur** : paiement par carte au checkout (S05 → S06).
- **Prérequis** : PAY-001 ; BKG-014.
- **Parcours principal** : page hébergée du PSP sur le compte de Kmino → 3DS → autorisation (jambes de la capture, 08 E7 règle 2) → webhook signé → PAY-034 → conversion gardée du hold.
- **Parcours alternatifs** : refus → message localisé es / en et proposition d'un autre moyen (Yappy si `SUPPORTS_YAPPY_IN_MARKETPLACE`, PAY-004) ; 3e refus → hold bloqué ; carte prépayée → refus avant envoi si le BIN est connu.
- **Règles métier** : BR-PAY-01, BR-BOOK-10, BR-PAY-11 (chargeback : 3DS = transfert de responsabilité).
- **États** : SM-1 `HOLD` → `QUOTE` (refus) / `BOOKED` ; `checkout_hold` `ACTIVE` → `PAYMENT_IN_FLIGHT` → `CONVERTED` / `RELEASED`.
- **Erreurs** : `CARD_DECLINED_<code>`, `CARD_PREPAID_REFUSED`, `3DS_FAILED`, `PAYMENT_ATTEMPTS_EXCEEDED`.
- **Données** : payment_attempt(hold_id, method, decline_code, threeds_status, eci, liability_shift, at) ; `payment_instrument`(token_ref, network, funding, bin6, last4).
- **Notifications** : écran seulement.
- **Permissions** : `GUEST` (`booking.create`, jamais pour son propre véhicule).
- **Dépendances** : PAY-002 → PAY-001 ; PAY-017 → BKG-014 ; PAY-018 → PAY-001, BKG-014, PAY-017.
- **Critères d'acceptation** : Given 3 refus sur le même hold, When le guest tente une 4e fois, Then `PAYMENT_ATTEMPTS_EXCEEDED`. Given un 3DS échoué, When le webhook arrive, Then aucun trip `BOOKED` et le hold est libéré. Given aucune authentification ni exemption tracée par le PSP, When un paiement est reçu, Then il n'est pas accepté comme preuve (PAY-034). Given une carte prépayée dont le BIN est connu, When le guest la saisit, Then `CARD_PREPAID_REFUSED` avant tout appel d'autorisation.
- **Source** : SRC_G 2.6.7 (cartes) ; 11 EC-26 ; 08 BR-BOOK-10 ; écrans 10b : S05, S06.
- **Confiance** : documenté (cartes, PAY-002) ; refus et 3DS proposés (PAY-017, PAY-018 ; Turo INFÉRÉ).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : PAY-002 SIMPLIFIÉ — cartes acceptées par la page hébergée du PSP de place de marché (adaptateur `FAKE` en build) ; refus prépayées par BIN quand le PSP l'expose. PAY-017 DIFFÉRÉ et PAY-018 DIFFÉRÉ — messages de refus, limite de tentatives et 3-D Secure assurés par la page hébergée du PSP, aucun code propre avant le lot 5.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : Apple / Google Pay (P2).

#### Fiche PAY-004 — Yappy (et Clave) via le PSP de place de marché
- **FEATURE ID** : PAY-004
- **Nom** : Moyens locaux : Yappy (et Clave si confirmée) via le PSP de place de marché de Kmino
- **Module** : Paiements (PAY — Moyens)
- **Persona** : PER-02 (surtout)
- **Objectif** : permettre aux résidents sans carte de crédit de payer leur loyer, sans jamais intégrer Yappy en direct.
- **Description** : moyen `YAPPY` porté par le produit de place de marché du PSP du pays, seulement si `SUPPORTS_YAPPY_IN_MARKETPLACE` est validée (inconnue ⇒ non : carte seulement) ; Clave de même si le PSP la confirme (OQ-PAY-03). Pas de pré-autorisation : ordre push expirant en 5 min (`ORDER_TTL_SECONDS` = 300), jambes portées par l'ordre (08 E7 règle 2). Réservation confirmée **seulement** sur confirmation signée du PSP (PAY-034) ; une capture d'écran du guest ne vaut jamais preuve. ACH Xpress exclu comme rail d'encaissement (V6-15). Remboursement : par Kmino, par API si le PSP le permet ; sinon rail `BANK_TRANSFER` ordonné par Kmino et exécuté par le PSP vers un compte vérifié au nom du guest, avec son consentement (OQ-PAY-07, OQ-PAY-22) ; si ce rail passe par un compte de Kmino, il exige `funds_holding_enabled[pays]` (08 E3). La caution reste une autorisation sur carte (PAY-011) : Yappy n'est jamais un rail de caution.
- **Déclencheur** : choix « Yappy » au checkout.
- **Prérequis** : PAY-001, PAY-034, PAY-011.
- **Parcours principal** : ordre Yappy sur le compte de Kmino avec `LegAmounts` → le guest valide dans son application → IPN signé → conversion gardée → `BOOKED`.
- **Parcours alternatifs** : ordre expiré (5 min) → nouvel ordre dans la limite du hold ; IPN absent → aucune confirmation, hold expiré ; paiement arrivé après l'expiration du hold → compensation (BKG-014) ; capacité absente dans le pays → option non affichée.
- **Règles métier** : BR-PAY-01, BR-PAY-08 ; 08 E3 (Yappy = rail sans remboursement partiel natif connu), E7 règle 10 (cascade entre moyens).
- **États** : SM-1 `HOLD` → `BOOKED` ; SM-8 `PENDING_CUSTOMER_CHOICE` / `PENDING_BANK_DETAILS` pour un remboursement par virement.
- **Erreurs** : `YAPPY_ORDER_EXPIRED`, `PAYMENT_NOT_CONFIRMED`, `UNSUPPORTED_CAPABILITY`.
- **Données** : `payment_operation`(method = `YAPPY`, provider_ref, expires_at) ; `payment_operation_leg` ; `tender`(kind = `YAPPY`, is_native_refund).
- **Notifications** : écran ; `EVT_BOOKING_CONFIRMED` après l'IPN.
- **Permissions** : `GUEST`.
- **Dépendances** : PAY-001 ; PAY-034 ; PAY-011.
- **Critères d'acceptation** : Given un ordre Yappy non confirmé en 5 min, When le délai expire, Then l'ordre est caduc et aucun trip n'est `BOOKED`. Given un IPN signé valide, When il arrive deux fois, Then un seul passage `BOOKED`. Given le trip A payé comme T33 (carte 150,00 puis Yappy 56,66), When les encaissements sont ventilés, Then l'opération Yappy porte `HOST` 0,00, `INSURER` 6,75, `TAX_THIRD_PARTY` 0,00 et `PLATFORM` 49,91 (TJ15b). Given le règlement T03 du même trip, When le remboursement est réparti, Then l'instance Yappy de −37,44 ne débite que `PLATFORM` (TJ16b) et suit le rail alternatif si le remboursement API n'est pas validé.
- **Source** : 08 BR-PAY-01, E3, E7 ; 17 §2.8 « Yappy via PSP » ; 12 §2 ; 09b §2.1 ; écrans 10b : S05, S06.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : DIFFÉRÉ — Yappy proposé seulement par la page hébergée du PSP de place de marché si `SUPPORTS_YAPPY_IN_MARKETPLACE` est validée ; aucun code propre avant le lot 5.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : remboursement multi-rails (PAY-040, P1).

#### Fiche PAY-006 — Pay now (autorisation puis capture par jambes)
- **FEATURE ID** : PAY-006
- **Nom** : Pay now (autorisation puis capture, chaque jambe à son montant)
- **Module** : Paiements (PAY — Options)
- **Persona** : PER-01, PER-02
- **Objectif** : payer à la réservation tout en permettant d'annuler sans débit pendant la revue de risque.
- **Description** : Kmino, marchand de référence, autorise à la confirmation sur son compte du PSP de place de marché, puis **capture dès que la revue ADM-029 est passée et au plus tard sous 24 h** ; la capture porte `captureLegs(trip)` (08 E7 règle 2), chaque jambe ≥ 0. Une capture partielle d'une autorisation (annulation avant capture) porte directement les jambes réglées (TJ03) ; le reste est annulé (`VOID`). Kmino ne détient des fonds de tiers qu'en variante B et seulement si `funds_holding_enabled[pays]` = `true` ; en variante A, la jambe `HOST` reste chez le PSP jusqu'à `payout_at`. Réservation signalée (UXQ-08) : hold `CHECKOUT` avec `review_required`, `review_hold_minutes` = 120, `flagged_booking_payment_order` = `REVIEW_BEFORE_CHARGE` (aucun débit avant la revue). La capture différée de Turo (min(auth + 40 h, départ − 1 h)) n'est pas retenue (validité réelle des autorisations de 5 à 7 j, VERIF_08 V8-01).
- **Déclencheur** : confirmation d'un paiement par carte (PSP supportant l'autorisation).
- **Prérequis** : PAY-001 ; ADM-029.
- **Parcours principal** : autorisation → revue → `capture(amount, legs)` (clé d'idempotence) → `trip_leg_balance` alimenté par jambe → `BOOKED` reste.
- **Parcours alternatifs** : revue négative → `VOID` (aucun débit) ; annulation avant capture → capture partielle des jambes réglées et `VOID` du reste (TJ03, T28), ou `VOID` total puis nouveau débit MIT si `SUPPORTS_PARTIAL_CAPTURE` est absente (T64) ; autorisation expirée → dette et encaissements partiels (T29, règle 4) ; paiement sans créneau (BKG-014) → `VOID` de l'autorisation ou remboursement par Kmino.
- **Règles métier** : BR-PAY-02, BR-CXL (règlement), 08 E1 à E3, E7 règles 1 et 2.
- **États** : `payment_operation` `AUTHORIZED` → `CAPTURED` / `VOIDED`.
- **Erreurs** : `CAPTURE_FAILED`, `AUTH_EXPIRED`, `LEG_AMOUNT_NEGATIVE`.
- **Données** : `payment_operation`(authorized_at, captured_at, capture_deadline) ; `payment_operation_leg` ; `trip_leg_balance`(captured_minor par jambe).
- **Notifications** : `EVT_PAYMENT_CAPTURED` (interne).
- **Permissions** : `SYSTEM` ; `OPS_AGENT` (décision de revue).
- **Dépendances** : PAY-001 ; ADM-029.
- **Critères d'acceptation** : Given une autorisation à 10:00 et une revue approuvée à 11:00, When la tâche s'exécute, Then capture à 11:00 ± 5 min. Given aucune revue à 10:00 + 24 h, When le délai expire, Then alerte ops et capture bloquée (pas de capture automatique sans revue, PROPOSÉ). Given le trip A autorisé pour 256,66 et une revue passée, When la capture s'exécute, Then elle porte `HOST` 131,25, `INSURER` 25,50, `TAX_THIRD_PARTY` 0,00 et `PLATFORM` 99,91 (TJ01). Given TA10 (T28 : autorisation 256,66 non capturée, annulation guest à T − 10 h), When l'annulation est réglée, Then capture partielle de 69,22 avec `HOST` 45,00 et `PLATFORM` 24,22, `VOID` de 187,44 et aucun remboursement ensuite (TJ03). Given le trip D en PYG, When la capture s'exécute, Then 1 438 050 PYG répartis en `HOST` 787 500, `INSURER` 105 000, `TAX_THIRD_PARTY` 0 et `PLATFORM` 545 550 (TJ08a).
- **Source** : SRC_G 2.6.2 ; 2.6.6 ; 08 E7 ; 17 §2.5, §2.8 ; écrans 10b : S05, S06.
- **Confiance** : documenté (base) ; délais et jambes proposés.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — paiement par jambes sur le compte de Kmino (adaptateur `FAKE`) : autorisation puis capture après la revue ADM-029 ; capture partielle seulement si le PSP la déclare, sinon `VOID` et nouveau débit.
- **Complexité** : moyenne ; ops faible ; risque élevé.
- **Améliorations possibles** : Pay later (P1).

#### Fiche PAY-011 / PAY-012 / PAY-036 — Caution par carte, libération et fenêtre de rétention
- **FEATURE ID** : PAY-011, PAY-012, PAY-036
- **Nom** : Dépôt de garantie par pré-autorisation (PAY-011) ; libération automatique du dépôt (PAY-012) ; fenêtre de rétention de la caution et ré-autorisation (PAY-036)
- **Module** : Paiements (PAY — Dépôt)
- **Persona** : PER-01, PER-02 ; PER-06 ; PER-07
- **Objectif** : une caution prise par Kmino sur la carte du guest **seulement quand un déclencheur l'exige** (révisé 2026-11-12, caution comme Turo), limitée aux frais annexes, sans jamais dépasser la validité réelle de l'autorisation ni détenir de fonds de tiers sans avis.
- **Description** : **Caution conditionnelle (révisé 2026-11-12, caution comme Turo)** : comme chez Turo, aucune caution par défaut. Avant le checkout (fiche, recherche, devis d'un visiteur), seuls `COUNTRY` et `CLASS` sont évalués : montant affiché s'ils sont vrais, sinon mention générique. Au checkout, avant le paiement, la caution est exigée si au moins un déclencheur de 08 BR-PAY-06 est vrai (`deposit_always_required[pays]`, classe ∈ `deposit_trigger_classes[pays]`, plus jeune conducteur approuvé de moins de `deposit_young_driver_age[pays]` sur une classe ∈ `deposit_young_driver_classes[pays]`, signal de risque si `deposit_on_risk_flag[pays]` et seulement si `risk_control_deployed[pays]`) ; au checkout, un déclencheur inconnu ou un contrôle de risque déployé en panne vaut « vrai » ; le voyageur et l'hôte ne voient que le montant, jamais les déclencheurs ; une seule caution par trip (`deposit_amount[pays][classe]`, non cumulée) ; sans caution, aucun `deposit_hold` actif, aucun calcul de `H_requise` et jamais `DEPOSIT_RAIL_UNAVAILABLE`, les frais post-trip passant par MIT `DELAYED_CHARGES` sur la carte enregistrée (PAY-015). Ce qui suit vaut **pour un trip avec caution**. PAY-011 : caution autorisée par Kmino sur son compte du PSP de place de marché (`deposit_hold`), montant = formule des frais annexes de 08 BR-PAY-06, sans majoration (OQ-P2P-04) ; posée à `auth_at` (défaut `scheduled_start − 24 h`) ; elle ne garantit que les **frais annexes de la liste fermée** acceptée au checkout (carburant, retard, kilométrage, nettoyage, tabac, animaux, péages connus au retour), jamais un dommage, une franchise ni une amende reçue plus tard ; toute capture exige les preuves CLM-034. La caution n'est pas une jambe : un frais annexe capturé devient une ligne avec sa part hôte (100 % à l'hôte pour carburant, recharge, péages, nettoyage, tabac ; part du plan figée pour retard et kilométrage ; frais administratifs à `PLATFORM`). PAY-012 : libération automatique à fin + 72 h `{param}` (valeur Turo : 80 h, non reprise), sauf frais annexes facturés avant l'échéance ; jamais suspendue par une réclamation de dommage (T57). PAY-036 : forme en heures, qui prévaut : `H_requise = (scheduled_start − auth_at) + (scheduled_end − scheduled_start) + release_delay (72 h) + marge (0 h)` ; pré-autorisation unique si `H_requise ≤ V` (`provider_max_hold[psp][pays][réseau]`, inconnue ⇒ 0) ; au-delà, rails de 08 BR-PAY-06 dans l'ordre : (a) ré-autorisation à `auth_expiry − 24 h` si `SUPPORTS_REAUTH` est validée (OQ-PAY-17) ; (b) débit puis remboursement plafonné par `deposit_charge_cap[pays]` (inconnu ⇒ 0), ouvert en production seulement si `funds_holding_enabled[pays]` = `true` et l'avis OQ-PAY-06 favorable ; (c) sinon **réservation refusée avant le paiement**, avec les durées possibles affichées (`DEPOSIT_RAIL_UNAVAILABLE`, T59). L'ancien rail de caution prise en personne est supprimé (pivot P2P) ; une carte de crédit ne prolonge pas la validité d'une autorisation.
- **Déclencheur** : `auth_at` ; retour du véhicule ; échéance de validité ; modification du trip (recalcul de `H_requise`).
- **Prérequis** : PAY-006, PAY-036 (PAY-011) ; PAY-011 (PAY-012) ; ADM-014 (PAY-036).
- **Parcours principal** : évaluation des déclencheurs au devis et au checkout (révisé 2026-11-12, caution comme Turo) (aucun vrai : pas de caution, fin du parcours) → calcul de faisabilité au checkout → pré-autorisation à `auth_at` → retour → décision à fin + 70 h → capture partielle du dû avec ses jambes + `VOID` du reste (T57) → libération.
- **Parcours alternatifs** : pas de capture partielle → `VOID` total + débit MIT `DELAYED_CHARGES` (T58) ; trip trop long → ré-autorisation si validée, sinon rail (b) si ouvert, sinon refus avant le paiement (T59) ; refus de carte pour la caution (EC-27) → `FAILED` de SM-1b, motif `PSP_FAILURE` si panne ; jamais de capture après `auth_expiry`.
- **Règles métier** : BR-PAY-06, BR-PAY-08, BR-VERIF-09, BR-PAY-09 bis (dommages hors caution).
- **États** : `deposit_hold` `NOT_REQUIRED` (terminal, aucun trip avec caution, (révisé 2026-11-12, caution comme Turo)) ; `PLANNED` → `AUTHORIZED` → `PARTIALLY_CAPTURED` / `VOIDED` / `REFUNDED` / `EXPIRED` ; `mechanism` ∈ {`NOT_REQUIRED`, `PREAUTH_SINGLE`, `REAUTH`, `CHARGE_THEN_REFUND`, `REFUSED`} ; SM-1b.
- **Erreurs** : `DEPOSIT_AUTH_FAILED`, `DEPOSIT_RAIL_UNAVAILABLE` (affiché avant le paiement ; trips avec caution seulement), `UNSUPPORTED_CAPABILITY`, `PARAM_MISSING` (caution exigée sans `deposit_amount[pays][classe]`, (révisé 2026-11-12, caution comme Turo)).
- **Données** : `deposit_hold`(trip_id, mechanism [`NOT_REQUIRED` (révisé 2026-11-12, caution comme Turo)], triggers, amount_minor, currency, h_required_hours, v_hours_snapshot, auth_at, auth_expiry_at, release_at, decision_at, status) (17 §3.2.7).
- **Notifications** : `EVT_DEPOSIT_AUTHORIZED`, `EVT_DEPOSIT_RELEASED`.
- **Permissions** : `SYSTEM` ; `OPS_AGENT` (décision de capture d'un frais annexe prouvé).
- **Dépendances** : PAY-011 → PAY-006, PAY-036 ; PAY-012 → PAY-011 ; PAY-036 → ADM-014.
- **Critères d'acceptation** : Given T57, When la décision est prise à fin + 70 h, Then capture 12,00 et `VOID` 288,00, la réclamation n'ayant pas suspendu la libération. Given T58, When le PSP n'a pas `SUPPORTS_PARTIAL_CAPTURE`, Then `VOID` 300,00 puis débit MIT de 12,00. Given T59 (trip de 3 j + 25 min, validité 168 h, `SUPPORTS_REAUTH` absente, `funds_holding_enabled[pays]` = `false`), When la faisabilité est calculée au checkout, Then `DEPOSIT_RAIL_UNAVAILABLE` est affiché avec les durées possibles et aucun paiement n'est demandé. Given un dommage déclaré par l'hôte, When la caution arrive à son échéance, Then elle est libérée et le dommage suit PAY-015 (BR-PAY-09 bis). Given `deposit_charge_cap[pays]` absent, When le rail (b) est évalué, Then il est fermé. Given T69 (PA, `STANDARD`, conducteur de 35 ans, aucun signal) (révisé 2026-11-12, caution comme Turo), When le checkout s'affiche, Then aucune caution n'est affichée ni autorisée, et le carburant manquant de 12,00 est débité par MIT `DELAYED_CHARGES` avec la jambe `HOST` à 12,00. Given T70 (trip de T59 sans déclencheur), When la faisabilité est calculée, Then la réservation est acceptée sans `DEPOSIT_RAIL_UNAVAILABLE` ; Given T70 c (fiche d'un `PREMIUM` vue par un visiteur), When la fiche s'affiche, Then aucun montant, la mention générique seulement. Given T71 (PA, valeurs PROPOSÉES : conducteur de 29 ans sur `PREMIUM`, ou conducteur additionnel approuvé de 26 ans), When le checkout s'affiche, Then aucune caution n'est exigée, l'âge seul n'en déclenchant jamais (décision du fondateur du 2026-11-12) ; Given un pays qui active l'âge sur `{PREMIUM, LUXE}` (T71 d), When un conducteur de 29 ans réserve un `PREMIUM`, Then la caution est exigée. Given T72 (PY, contrôle de risque déployé : paramètre de déclencheur absent ou contrôle en panne), When le checkout s'affiche, Then la caution est exigée, et la réservation est refusée avant le paiement avec `PARAM_MISSING` si `deposit_amount[PY][classe]` est absent ; Given `risk_control_deployed[PY]` = `false` (T72 d), When le checkout s'affiche, Then `RISK` n'est pas évalué. Given T73, When le checkout s'affiche, Then le voyageur voit 1 500 000 PYG et aucun déclencheur. Given T73 (PY, trois déclencheurs vrais), When la caution est calculée, Then une seule caution de 1 500 000 PYG est prise.
- **Source** : SRC_G 2.5.1, 2.5.3 ; 08 BR-PAY-06 ; VERIF_08 V8-01, V8-02 ; 09b §4, §5.1 bis ; 11 EC-27, EC-56 ; écrans 10b : S03, S05, S09.
- **Confiance** : documenté (caution Turo, PAY-011, PAY-012) ; fenêtre de rétention proposée (PAY-036).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : PAY-011 SIMPLIFIÉ — déclencheurs évalués comme ci-dessus (révisé 2026-11-12, caution comme Turo) ; pré-autorisation unique seulement (rails (a) et (b) fermés), refus avant le paiement au-delà. PAY-012 SIMPLIFIÉ — libération planifiée à fin + 72 h, capture des frais annexes décidée par l'ops sur preuves. PAY-036 SIMPLIFIÉ — formule en heures avec `V` du `FAKE` ; refus `DEPOSIT_RAIL_UNAVAILABLE` affiché au checkout.
- **Complexité** : moyenne / faible / moyenne ; ops moyen / faible / faible ; risque élevé.
- **Améliorations possibles** : caution modulée par le risque (PAY-039, P1).

#### Fiche PAY-015 / PAY-037 — Carte enregistrée (MIT) et débits post-trip conformes aux réseaux
- **FEATURE ID** : PAY-015, PAY-037
- **Nom** : Carte enregistrée et débits ultérieurs (MIT) (PAY-015) ; consentement et notification des débits post-trip conformes aux réseaux (PAY-037)
- **Module** : Paiements (PAY — Carte stockée, Débits post-trip)
- **Persona** : PER-01, PER-02 ; PER-06 ; PER-07
- **Objectif** : débiter légalement, par jambes, les frais post-trip décidés, sans jamais toucher à la caution pour un dommage.
- **Description** : PAY-015 : carte enregistrée (credential-on-file) avec consentement explicite es / en au checkout (`mit_consent`, scopes `DELAYED_CHARGES`, `NO_SHOW`, `DAMAGE_SEPARATE`, `REAUTHORIZATION`) ; Kmino peut la débiter par `chargeMIT(reason, amount, legs)` (capacité `SUPPORTS_MIT`, **bloquante** pour l'activation d'un hôte) pour les frais de retard, les frais annexes validés, la part de dommage due par le guest selon son plan de protection et les frais administratifs. Jambes d'un débit de dommage (BR-PAY-09 bis) : `HOST` (réparation ou perte de l'hôte non couverte), `INSURER` (si l'assureur partenaire a déjà indemnisé l'hôte), `PLATFORM` (frais de traitement et sa taxe), montants donnés par la décision du dossier SM-4, jamais un prorata ; la franchise de l'hôte n'est jamais débitée au guest (ajustement de versement, 08 E7 règle 7). PAY-037 : consentement écrit au check-in ; dommage = transaction séparée après constat ; notification écrite sous 10 j après le retour ; préavis d'objection ≥ 20 j (Visa) ; débit au plus tard J+30 (Mastercard) ou J+90 (Visa) ; jamais de marge pour dommages dans l'autorisation estimée ; règles de la région LAC à valider (OQ-PAY-18). Un débit refusé crée une dette (`debt_balance`) ; ses encaissements partiels suivent 08 E7 règle 4 (cible cumulative par jambe, `PLATFORM` plafonnée, report, jamais d'incrément négatif).
- **Déclencheur** : décision CLM-006 / ADM-008 ; frais de retard ; facture annexe non contestée.
- **Prérequis** : PAY-002, LEG-002 (PAY-015) ; PAY-015 (PAY-037).
- **Parcours principal** : consentement → décision → notification → délai d'objection → `chargeMIT` avec jambes → succès → `trip_leg_balance` alimenté.
- **Parcours alternatifs** : refus de carte (EC-28) → dette guest (restriction `UNPAID_BALANCE`, relances J0 / J+3 / J+7, T29) ; encaissements partiels de la dette (TJ07, TJ17, TJ19) ; objection → litige SM-7 ; `SUPPORTS_MIT` absente → aucun hôte activable dans le pays.
- **Règles métier** : BR-PAY-09, BR-PAY-09 bis, BR-PAY-10, BR-REIMB-03, BR-ACC-10 ; 08 E7 règle 4.
- **États** : SM-5 (`CHARGED` → `PAID` / `UNPAID`) ; SM-8 ; `debt_balance` `OPEN` → `PARTIALLY_PAID` → `PAID`.
- **Erreurs** : `MIT_CONSENT_MISSING`, `MIT_NOTICE_PERIOD_NOT_ELAPSED`, `MIT_DEADLINE_PASSED`, `LEG_AMOUNT_NEGATIVE`.
- **Données** : `payment_instrument`, `mit_consent`(instrument_id, trip_id, scopes, network_tx_reference) ; post_trip_charge(trip_id, type, amount, notified_at, objection_until, charged_at) ; `payment_operation` (`MIT_CHARGE`, `DEBT_COLLECTION`) et `payment_operation_leg` ; `debt_balance`.
- **Notifications** : `EVT_POST_TRIP_CHARGE_NOTICE`, `EVT_POST_TRIP_CHARGED`.
- **Permissions** : `SYSTEM` ; décision `OPS_AGENT`.
- **Dépendances** : PAY-015 → PAY-002, LEG-002 ; PAY-037 → PAY-015.
- **Critères d'acceptation** : Given une notification envoyée il y a 15 j (Visa), When un débit est tenté, Then `MIT_NOTICE_PERIOD_NOT_ELAPSED`. Given T64, When un débit MIT est requis, Then 69,22 sont débités avec la clé d'idempotence de 08. Given T29, When le MIT est refusé, Then dette de 69,22 et restriction `UNPAID_BALANCE`. Given cette dette aux jambes de TJ02a, When le guest paie 30,00 puis 39,22, Then le premier encaissement porte `HOST` 19,50 et `PLATFORM` 10,50, le second `HOST` 25,50 et `PLATFORM` 13,72 (TJ07a, TJ07b). Given une dette de 256,66 aux jambes de TJ01, When le guest paie 256,65 puis 0,01, Then le premier encaissement porte `HOST` 131,24, `INSURER` 25,50, `PLATFORM` 99,91 et le second `HOST` 0,01, sans aucun incrément négatif (TJ19a, TJ19b). Given T68, When le débit MIT de 69,22 est refusé à J0, en timeout à J+3 puis accepté à J+7, Then une seule instance, clés a1, a2 et a3, et 69,22 débités une fois.
- **Source** : TOS-FEES ; SRC_G 6.9.1 ; 08 BR-PAY-09 bis, E7 règle 4 ; VERIF_08 V8-03, V8-15 ; 11 EC-28 ; écrans 10b : S12, A09.
- **Confiance** : documenté (PAY-015) ; proposé (PAY-037).
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : PAY-015 SIMPLIFIÉ — consentement MIT au checkout et débit unitaire par jambes sur décision ops ; relances de dette manuelles. PAY-037 SIMPLIFIÉ — notification et préavis par gabarit, délais réseaux contrôlés par le travailleur ; règles LAC à confirmer par le PSP.
- **Complexité** : moyenne ; ops faible / moyen ; risque élevé.
- **Améliorations possibles** : échéancier (BR-DAMAGE-08, P1).

#### Fiche PAY-019 — Idempotence des opérations de paiement
- **FEATURE ID** : PAY-019
- **Nom** : Idempotence des opérations de paiement
- **Module** : Paiements (PAY — Fiabilité)
- **Persona** : technique
- **Objectif** : aucun double débit, double remboursement, double réaffectation, double versement ou double confirmation.
- **Description** : clé d'idempotence **par tentative** avant la conversion : `hold:{hold_id}:{AUTH|CAPTURE|VOID}:a{attempt_no}` ; hors règlement : `{trip_id}:{segment_id}:v0-{origin_type}-{origin_id}:REFUND:{tender_id}:i{n}:a{m}` ; règlement : format de 08 E4 `trip:version:OP:moyen:instance:attempt` ; libération de jambe `release:{trip_id}:{segment_id}:{leg}:i{n}` ; ajustement `adjust:{host_ledger_entry_id}` ; transfert `ptransfer:{platform_advance_id}` ; sous-marchand `submerchant:{org_id}:a{n}` (17 §2.8). `attempt_no` + 1 seulement après un refus **reçu** ; réponse inconnue → même clé et lecture par `getOperation` ; jamais `hold_id` seul. Les `LegAmounts` envoyés sont ceux de `payment_operation_leg`, jamais recalculés à l'envoi. Webhooks dédupliqués par identifiant d'événement PSP (`webhook_inbox`) ; outbox transactionnelle.
- **Déclencheur** : toute opération PSP et tout webhook.
- **Prérequis** : PAY-001.
- **Parcours principal** : clé calculée → si déjà traitée, renvoi du résultat enregistré.
- **Parcours alternatifs** : timeout → rejeu avec la même clé (T51) ; échec confirmé → nouvelle tentative `attempt_no + 1` (T52).
- **Règles métier** : BR-BOOK-10 ; 08 E4.
- **États** : SM-8 (`SUBMITTED`, `FAILED` → attempt + 1) ; `payment_command` `PENDING` → `IN_FLIGHT` → `DONE` / `UNKNOWN`.
- **Erreurs** : `IDEMPOTENCY_CONFLICT` (même clé, contenu ou jambes différents).
- **Données** : `payment_operation.idempotency_key` (UQ), `payment_command`, `inbox_receipt` (17 §4.2–4.3).
- **Notifications** : —
- **Permissions** : `SYSTEM`.
- **Dépendances** : PAY-001.
- **Critères d'acceptation** : Given T51, When l'outbox rejoue un remboursement en timeout, Then 0 nouvelle opération et une seule `REFUND` au registre. Given T52, When un virement a échoué, Then même instance avec `attempt_no = 2`. Given la même clé avec des jambes différentes pour un même montant, When elle arrive, Then `IDEMPOTENCY_CONFLICT`. Given T68 (débit MIT de 69,22 refusé à J0, en timeout à J+3 puis refusé au rejeu, accepté à J+7), When les tentatives s'enchaînent, Then une seule instance, clés a1, a2 (rejouée à l'identique) et a3, et 69,22 débités une fois.
- **Source** : 08 BR-BOOK-10, E4 ; 11 EC-29, EC-54 ; 08 T68 ; 17 §2.8, §4.3 ; écrans 10b : S06.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ — clé d'idempotence sur la création des paiements, les captures, les remboursements et le traitement des webhooks ; libérations et ajustements au lot 3 avec les versements.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : —

#### Fiche PAY-021 — Remboursements par jambe sur le moyen d'origine
- **FEATURE ID** : PAY-021
- **Nom** : Remboursements par jambe, exécutés par Kmino sur le moyen d'origine
- **Module** : Paiements (PAY — Remboursements)
- **Persona** : PER-01, PER-02 ; PER-08 (voit l'effet sur ses gains) ; PER-07 ; PER-06
- **Objectif** : rembourser le bon montant, sur le bon rail, en débitant chaque jambe de son montant exact, avec preuve.
- **Description** : le montant remboursé et la **variation signée de chaque jambe** viennent du règlement versionné (BR-CXL, devis figé PRC-025 ; 08 E7 règle 3) ; Σ variations = − remboursement du guest. **Kmino exécute** chaque remboursement par le PSP de place de marché (`refund(amount, legs)`, SM-8) : avant capture, `VOID` ; après capture, remboursement avec un montant explicite par jambe (`SUPPORTS_PER_LEG_AMOUNTS`), jamais un prorata du PSP. Une variation positive (réaffectation, ex. hôte inéligible) passe d'abord par `reallocate(legs)` (`SUPPORTS_PAYOUT_ADJUSTMENT`, jambe source non libérée). Plusieurs instances : remplissage en cascade (08 E7 règle 10 : moyens natif → non natif → crédit cash → crédit promo ; jambes `HOST` → `INSURER` → `TAX_THIRD_PARTY` → `PLATFORM`), distinct de l'ordre d'absorption de E2. Jambe déjà libérée (versement fait) : la variation est portée sur `PLATFORM` **avant** l'appel et une créance est ouverte au `host_ledger` (règle 3 bis, `platform_advance` cause `RELEASED_LEG`) ; le guest n'attend jamais l'hôte. Yappy sans remboursement API : rail `BANK_TRANSFER` vers un compte vérifié au nom du guest, avec consentement (OQ-PAY-07, OQ-PAY-22). Crédit cash au lieu d'un remboursement : seulement si `funds_holding_enabled[pays]` = `true`. Délais bancaires de 3 à 10 j ouvrés affichés au guest ; seule la date d'émission est notifiée.
- **Déclencheur** : annulation (BKG-028, BKG-032, BKG-035), refus du véhicule (TRP-007), hôte défaillant (BR-TRUST-09), décision de litige.
- **Prérequis** : PAY-001, PRC-025.
- **Parcours principal** : règlement versionné (`settlement_leg`) → instances SM-8 `PLANNED` ventilées par la règle 10 → commande `refund` ou `VOID` avec `LegAmounts` → `SENT` → `CONFIRMED` (ARN ou référence PSP).
- **Parcours alternatifs** : rail sans remboursement natif → `PENDING_BANK_DETAILS` (compte vérifié au nom du guest) ; jambe `HOST` déjà libérée → règle 3 bis (`LEG_ALREADY_RELEASED` si l'appel était tenté sans report) ; `SUPPORTS_PAYOUT_ADJUSTMENT` absente → aucun hôte activable, lots `ON_HOLD` ; requalification → supersession (T49) ou débit et dette (T50) ; chargeback en cours → SM-8 `BLOCKED_CHARGEBACK` (T67).
- **Règles métier** : BR-PAY-08, BR-CXL-01, BR-CXL-06, BR-CXL-08, BR-CXL-12, BR-CXL-14, BR-TRUST-09 ; 08 E1 à E3, E7 règles 3, 3 bis et 10.
- **États** : SM-8 complet ; `trip_leg_balance` (refunded_minor, reallocated_in_minor, reallocated_out_minor par jambe).
- **Erreurs** : `REFUND_EXCEEDS_COLLECTED`, `LEG_ALREADY_RELEASED`, `LEG_SUM_MISMATCH`, `UNSUPPORTED_CAPABILITY`.
- **Données** : `refund_instance`(id, trip_id, segment_id, settlement_id, origin_type, origin_id, rail, executor = `PLATFORM_API`, amount_minor, status, attempt_no) ; `settlement_leg`(kept_minor, variation_minor) ; `payment_operation_leg` ; `trip_leg_balance` ; `platform_advance` (17 §3.2.7, §3.2.8).
- **Notifications** : `EVT_REFUND_PLANNED`, `EVT_REFUND_CONFIRMED` (date d'émission, jamais de réception) ; `EVT_HOST_DEBT_OPENED` (hôte, règle 3 bis).
- **Permissions** : `SYSTEM` (exécution) ; `OPS_AGENT` (suivi, coordonnées bancaires sur consentement) ; `FINANCE` (avances, plafonds) ; l'hôte ne lit que l'effet sur la jambe `HOST` de ses trips (RLS-28).
- **Dépendances** : PAY-001 ; PRC-025.
- **Critères d'acceptation** : Given le trip A capturé aux jambes de TJ01 et le règlement T03, When le remboursement de 187,44 est exécuté, Then la variation porte `HOST` −86,25, `INSURER` −25,50, `TAX_THIRD_PARTY` 0,00 et `PLATFORM` −75,69 (TJ02b). Given le même trip payé comme T33 (carte et Yappy), When la variation est ventilée, Then l'instance carte porte −150,00 dont `HOST` −86,25, `INSURER` −25,50, `PLATFORM` −38,25, et l'instance Yappy −37,44 sur `PLATFORM` seule (TJ16a, TJ16b). Given T39 (no-show, hôte inéligible), When le règlement s'exécute, Then une réaffectation de 18,53 de `HOST` vers `PLATFORM` est passée avant le remboursement de 138,22, et la variation nette vaut `HOST` −131,25, `INSURER` −25,50, `PLATFORM` +18,53 (TJ05b). Given T14 (hôte qui annule à T − 30 h), When le règlement s'exécute, Then le guest reçoit 256,66 (`HOST` −131,25, `INSURER` −25,50, `PLATFORM` −99,91) sans attendre l'hôte et la pénalité de 25,00 passe au `host_ledger` (TJ06). Given T05 exécuté avec 75,00 déjà versés à l'hôte puis requalifié en FULL, When le complément de 118,44 est ordonné, Then il est porté entièrement sur `PLATFORM` et une créance de 75,00 est ouverte au `host_ledger` (TJ18a, TJ18b). Given un remboursement supérieur à l'encaissé d'une jambe, When il est demandé, Then `REFUND_EXCEEDS_COLLECTED` et aucun appel au PSP.
- **Source** : SRC_G 2.6.9 ; 2.6.6 ; 08 BR-PAY-08, E2, E7 ; 11 EC-49, EC-55 ; 08 T66, T67 ; 17 §2.8, §2.9, §3.2.7 ; écrans 10b : S09, S10, A08.
- **Confiance** : documenté (délais) ; exécution par jambe proposée.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — remboursement par jambe exécuté par Kmino via le PSP (adaptateur `FAKE`), une instance par moyen ; rail `BANK_TRANSFER` traité par l'ops avec preuve ; la règle 3 bis est livrée avec les versements (lot 3).
- **Complexité** : élevée ; ops moyen ; risque élevé.
- **Améliorations possibles** : crédit immédiat ou virement vers un compte vérifié (PAY-040, P1).

#### Fiche PAY-034 — Preuve de paiement non réversible avant la remise des clés
- **FEATURE ID** : PAY-034
- **Nom** : Preuve de paiement non réversible par webhook signé avant la remise des clés
- **Module** : Paiements (PAY — Anti-fraude paiement)
- **Persona** : PER-08 (hôte qui remet la voiture) ; PER-01, PER-02 ; PER-07
- **Objectif** : aucun véhicule remis sur un paiement non confirmé (faux justificatifs Yappy, 12 §2), et aucun hôte en position de « confirmer » un paiement.
- **Description** : un paiement n'est reçu que sur **webhook ou IPN signé** du PSP de place de marché, ou sur lecture `getOperation` faisant foi (`proof_type` `WEBHOOK_SIGNED` / `POLL`), **avec les montants par jambe** quand le PSP les expose ; une capture d'écran du guest ne vaut jamais preuve et **aucun hôte ne peut confirmer un paiement**. La preuve émet `payment.received`, qui déclenche la conversion gardée du hold `CHECKOUT` (BKG-014) ; un montant ou des jambes différents du devis donnent `MISMATCH` et une revue ops, jamais une confirmation. La remise (A03, TRP-002) est bloquée tant que le paiement n'est pas confirmé. Paiement constaté manquant : seule l'ops le constate, sur preuve du PSP, avec double validation au-delà d'un seuil `{param}`.
- **Déclencheur** : réception d'un webhook ; lecture `getOperation` après timeout ; ouverture de la remise.
- **Prérequis** : PAY-001.
- **Parcours principal** : vérification de signature (`WEBHOOK_SIGNATURE_SCHEME`) → déduplication → opération `SUCCEEDED` avec jambes → `payment.received` → conversion gardée → remise autorisée.
- **Parcours alternatifs** : signature invalide → rejet, alerte ; montant ou jambes différents du devis → `MISMATCH`, revue ops ; webhook absent → lecture `getOperation` par notre clé si `SUPPORTS_LOOKUP_BY_MERCHANT_REF`, sinon par `provider_reference`, sinon escalade ops.
- **Règles métier** : BR-PAY-01, BR-TRUST-02, BR-BOOK-10.
- **États** : opération `SUCCEEDED` signée : preuve `NONE` → `CONFIRMED` / `MISMATCH`.
- **Erreurs** : `WEBHOOK_SIGNATURE_INVALID`, `PAYMENT_AMOUNT_MISMATCH`, `CHECKIN_PAYMENT_NOT_CONFIRMED`.
- **Données** : `webhook_inbox`(provider, provider_event_id, signature_valid, raw_body_enc, received_at) ; `payment_operation_event`(source `WEBHOOK` / `POLL`) ; `payment_operation_leg` (17 §3.2.7, §4.4).
- **Notifications** : `EVT_PAYMENT_MISMATCH` (ops).
- **Permissions** : `SYSTEM` ; `OPS_AGENT` (constat sur preuve du PSP, double validation) ; aucun droit de confirmation pour `P2P_HOST` ni `CO_HOST`.
- **Dépendances** : PAY-001.
- **Critères d'acceptation** : Given un webhook à signature falsifiée, When il arrive, Then rejet et aucun changement d'état. Given un trip non confirmé, When l'hôte ouvre la remise sur A03, Then `CHECKIN_PAYMENT_NOT_CONFIRMED`. Given un montant reçu de 256,65 pour un devis de 256,66, When le webhook arrive, Then `MISMATCH` et aucune conversion du hold. Given un compte `P2P_HOST`, When il tente de marquer un paiement comme reçu, Then l'action n'existe pas et la tentative d'appel est refusée et journalisée. Critère de sortie : 0 remise de clés sur paiement non confirmé.
- **Source** : VERIF_06 §3 idées 4–5 ; 09b §2.1 ; 12 §2 ; 17 §2.5, §4.4 ; écrans 10b : S06, A03.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI. Preuve par webhook signé ou `getOperation` avec jambes ; constat d'un paiement manquant par l'ops seule, sur preuve du PSP et double validation.
- **Complexité** : faible ; ops faible ; risque élevé.
- **Améliorations possibles** : —

## E7 — Onboarding de l'hôte particulier et annonces (P0-A, 12 lignes)

#### Fiche HST-050 — Catalogue de référence des véhicules
- **FEATURE ID** : HST-050
- **Nom** : Catalogue de référence des véhicules (marques, modèles, variantes)
- **Module** : Espace hôte & annonces (HST — Annonce)
- **Persona** : PER-08 ; PER-07
- **Objectif** : remplacer la saisie libre de la marque et du modèle par un choix dans un catalogue fiable, adapté au parc du Panama et du Paraguay, pour fiabiliser les caractéristiques affichées et les filtres.
- **Description** : catalogue maison `vehicle_make` / `vehicle_model` / `vehicle_variant` d'environ 150 modèles locaux (pick-ups, SUV, citadines, vans, marques chinoises, importations japonaises d'occasion au Paraguay) : carrosserie, places, portes, boîte, carburant, transmission intégrale, cylindrée, consommation ; amorcé par Wikidata (CC0) et le squelette NHTSA vPIC, valeurs EPA étiquetées « référence US » ; chaque ligne porte `source` et `license_note` ; `vehicle.variant_id` relie le véhicule de l'hôte (17 §3.2.3, ADR-034).
- **Déclencheur** : ajout d'une voiture par l'hôte dans l'assistant (A10) ; chargement de la graine par migration.
- **Prérequis** : aucun.
- **Parcours principal** : l'hôte (ou l'ops pour lui) choisit marque → modèle → année → finition ; les caractéristiques sont préremplies depuis la variante et restent modifiables au niveau du véhicule.
- **Parcours alternatifs** : modèle absent → « Autre » avec marque et modèle libres → demande d'ajout (ADM-036), véhicule en brouillon et non publiable (OQ-CAT-01) ; valeur EPA absente → champ vide, jamais bloquant.
- **Règles métier** : BR-LIST-04 ; règles du catalogue dans 17 ADR-034 (source et licence obligatoires, aucune aspiration de Turo, d'annonces ou de sites constructeurs, aucune photo de tiers).
- **États** : marque, modèle, variante `ACTIVE`, `PENDING_REVIEW`, `RETIRED`.
- **Erreurs** : `CATALOG_SOURCE_MISSING` (ligne sans source ni licence) ; `CATALOG_VARIANT_RETIRED`.
- **Données** : `vehicle_make`, `vehicle_model`, `vehicle_variant` (17 §3.2.3) ; `vehicle.variant_id`.
- **Notifications** : —
- **Permissions** : `ADMIN`, `OPS_AGENT` (écriture) ; lecture publique des noms et caractéristiques ; `P2P_HOST` (choix pour ses véhicules).
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given une ligne de graine sans `license_note`, When la migration est jouée, Then elle échoue et aucune ligne n'est chargée. Given un Toyota Hilux de la graine, When l'hôte le choisit dans A10, Then places, boîte, carburant et transmission intégrale sont préremplis. Given une consommation issue de l'EPA, When elle est affichée, Then elle porte la mention « référence US ».
- **Source** : `sources/SRC_VEHICLE_DATA.md` (§5, §6) ; 17 ADR-034 ; écrans 10b : A10.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — graine curée par l'ops et chargée par migration, sans écran d'administration ; l'hôte choisit dans la liste de l'assistant.
- **Complexité** : moyenne ; ops moyen (curation de la graine) ; risque faible (licences à valider, OQ-CAT-01).
- **Améliorations possibles** : décodage VIN en *best effort* (HST-007, P1) ; enrichissement sous licence (HST-051, P2) ; pages SEO par marque et modèle (SRC-033, P1).

#### Fiche ADM-036 — File d'ajout au catalogue véhicules
- **FEATURE ID** : ADM-036
- **Nom** : File d'ajout au catalogue véhicules
- **Module** : Back-office & exploitation (ADM — Files de revue ; rattachée à E7)
- **Persona** : PER-07 ; PER-08 (demandeur)
- **Objectif** : intégrer au catalogue les modèles que les hôtes ne trouvent pas, sans laisser publier un véhicule non rattaché.
- **Description** : `catalog_addition_request` alimentée par le choix « Autre » de l'assistant (HST-011) ; l'ops rapproche d'une variante existante, crée marque, modèle ou variante (source et licence obligatoires) ou refuse ; à l'approbation, le véhicule en attente reçoit `variant_id` ; délai `catalog_addition_sla_business_h` (PROPOSÉ 24 h ouvrées).
- **Déclencheur** : demande d'ajout créée par un hôte.
- **Prérequis** : HST-050.
- **Parcours principal** : demande → rapprochement ou création → approbation → rattachement du véhicule → notification à l'hôte.
- **Parcours alternatifs** : doublon d'une variante existante → fusion (`MERGED`) ; refus motivé → le véhicule reste en brouillon, non publiable.
- **Règles métier** : aucune règle de 08 ; 17 ADR-034.
- **États** : `OPEN` → `APPROVED` / `MERGED` / `REJECTED`.
- **Erreurs** : `CATALOG_REQUEST_DUPLICATE`.
- **Données** : `catalog_addition_request` (17 §3.2.3) ; `review_queue_item` de type `CATALOG_ADDITION`.
- **Notifications** : événement `catalog.addition_request.resolved` (17 §4.5) vers l'hôte demandeur.
- **Permissions** : `OPS_AGENT`, `ADMIN` ; `P2P_HOST` (créer une demande pour son véhicule).
- **Dépendances** : HST-050.
- **Critères d'acceptation** : Given un hôte qui saisit « Chery Tiggo 2 », absent du catalogue, When il enregistre le véhicule, Then une demande d'ajout est créée et l'annonce ne peut pas être soumise. Given la demande approuvée, When l'ops la clôt, Then le véhicule reçoit sa variante et l'hôte est notifié.
- **Source** : `sources/SRC_VEHICLE_DATA.md` §5 ; 17 ADR-034 ; écrans 10b : O01, A10.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — file traitée par l'ops dans la console O01, formulaire d'ajout minimal côté hôte.
- **Complexité** : faible ; ops moyen ; risque faible.
- **Améliorations possibles** : tableau de couverture du catalogue par marque et par pays ; demandes groupées par fréquence.

#### Fiche HST-005 — Assistant d'annonce
- **FEATURE ID** : HST-005
- **Nom** : Assistant d'annonce en étapes (inscription d'une voiture)
- **Module** : Espace hôte & annonces (HST — Assistant)
- **Persona** : PER-08
- **Objectif** : permettre à un particulier de publier sa voiture lui-même, étape par étape, avec reprise du brouillon.
- **Description** : progression nommée et brouillon ; étapes : véhicule (HST-011), documents (HST-039), photos (HST-012), prix par jour (PRC-001), distance incluse (HST-033), lieu de remise (adresse exacte, zone affichée ; un lieu public proposé par défaut, OQ-P2P-05), règles de l'hôte, mode de réservation (`INSTANT` par défaut, `REQUEST` au choix sauf annonce aéroport, OQ-P2P-10), disponibilité (CAL-003), plan de gains (HST-048), soumission en revue (HST-016). Les étapes 2 à 9 de Turo n'ont pas été observées (BLOQUÉ à l'étape VIN). Un hôte peut avoir plusieurs voitures, une annonce par voiture.
- **Déclencheur** : `web.s14.becomeHost` (S14) ou `web.a02.cars.add` (A02).
- **Prérequis** : compte vérifié de l'hôte (HST-049) ; HST-011, HST-039.
- **Parcours principal** : étapes → validation par étape → soumission → `PENDING_REVIEW`.
- **Parcours alternatifs** : abandon → brouillon repris à la connexion ; recommencer → `DELETED` (SM-2) ; pays fermé aux hôtes (`p2p_private_hosts_enabled[pays]` = `false`) → brouillon permis, soumission refusée avec `web.a07.waitingCountry`.
- **Règles métier** : BR-LIST-04, BR-LIST-01, BR-BOOK-01.
- **États** : SM-2 `DRAFT` → `PENDING_REVIEW`.
- **Erreurs** : `LISTING_STEP_INCOMPLETE`, `HOST_NOT_ACTIVATED`.
- **Données** : listing_draft(vehicle_id, step, data) ; listing.booking_mode (`INSTANT` / `REQUEST`, défaut `p2p_default_booking_mode`).
- **Notifications** : —
- **Permissions** : `P2P_HOST` (ses véhicules) ; `OPS_AGENT` (création pour l'hôte, journalisée).
- **Dépendances** : HST-011 ; HST-039.
- **Critères d'acceptation** : Given une annonce sans photos, When l'hôte la soumet, Then elle reste en brouillon avec l'étape manquante indiquée. Given un pays où `p2p_private_hosts_enabled` vaut `false`, When l'hôte soumet une annonce complète, Then `HOST_NOT_ACTIVATED` et l'annonce reste en brouillon. Given une annonce de lieu aéroport, When l'hôte choisit `REQUEST`, Then le choix est refusé et `INSTANT` est gardé.
- **Source** : 06 H-ONB-02 ; 08 BR-BOOK-01 ; écrans 10b : A10, A07.
- **Confiance** : confirmé (progression « 1 of 9 » OBSERVÉE) ; étapes ultérieures proposées.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — l'hôte publie lui-même sa voiture par l'assistant réduit (véhicule, documents, photos, prix, distance, lieu, soumission), ou l'ops la crée pour lui depuis la console en bêta.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : décodage VIN ; estimation du prix par zone (A01).

#### Fiche HST-011 — Détails du véhicule
- **FEATURE ID** : HST-011
- **Nom** : Détails du véhicule
- **Module** : Espace hôte & annonces (HST — Annonce)
- **Persona** : PER-08
- **Objectif** : données du véhicule complètes et uniques.
- **Description** : plaque (unique), VIN (ex-HST-006), marque, modèle, année et finition par le catalogue (HST-050), catégorie et classe de valeur (ex-HST-021), transmission, places, carburant, options, description et règles (ex-HST-046), **lieu de remise** de l'hôte (adresse exacte révélée au voyageur après confirmation, zone affichée avant ; ex-HST-003), instructions de remise et de retour (ex-TRP-011), dispositif GPS déclaré par l'hôte (BR-PICKUP-11).
- **Déclencheur** : assistant (HST-005).
- **Prérequis** : HST-050.
- **Parcours principal** : saisie → validations → enregistrement.
- **Parcours alternatifs** : plaque existante → refus ; adresse de remise hors des zones servies du pays → refus avec explication.
- **Règles métier** : BR-LIST-04, BR-ACC-05 (classes de valeur), BR-PICKUP-11 (dispositifs de suivi déclarés).
- **États** : SM-2 `DRAFT`.
- **Erreurs** : `VEHICLE_PLATE_DUPLICATE`, `VEHICLE_FIELD_REQUIRED`.
- **Données** : vehicle(id, org_id, plate, vin, variant_id, year, category, value_class, transmission, seats, fuel, gps_declared, handover_location_id, instructions_es/en) ; handover_location(address, zone_label, exact_revealed_after = `BOOKED`).
- **Notifications** : —
- **Permissions** : `P2P_HOST` (ses véhicules), `OPS_AGENT`.
- **Dépendances** : HST-050.
- **Critères d'acceptation** : Given une plaque déjà enregistrée, When un véhicule est créé, Then `VEHICLE_PLATE_DUPLICATE`. Given un champ obligatoire vide, When l'hôte soumet l'étape, Then une erreur est liée au champ. Given une annonce publiée, When un voyageur sans réservation confirmée consulte S03, Then seule la zone du lieu de remise est visible, jamais l'adresse exacte.
- **Source** : SRC_H §1.4 ; écrans 10b : A10, A11, S03.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — formulaire minimal dans l'assistant (plaque, VIN, variante du catalogue, lieu de remise, instructions) ; options et description courtes.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : intégration GPS (TRP-055, P1).

#### Fiche HST-012 — Photos d'annonce
- **FEATURE ID** : HST-012
- **Nom** : Photos d'annonce
- **Module** : Espace hôte & annonces (HST — Annonce)
- **Persona** : PER-08
- **Objectif** : photos fidèles et suffisantes de la voiture du particulier.
- **Description** : ≥ 6 obligatoires (Turo : ≥ 1, 10 recommandées), recadrage ~20 %, interdites : IA, banques d'images, texte, plaque lisible du voisin ou personnes reconnaissables ; ordre et photo principale choisis ; variantes de taille ; prises guidées dans A10 (BR-LIST-05).
- **Déclencheur** : assistant (HST-005).
- **Prérequis** : HST-005.
- **Parcours principal** : téléversement par l'hôte → contrôle format et poids → revue ops (HST-016).
- **Parcours alternatifs** : photo refusée en revue → motif et remplacement demandé.
- **Règles métier** : BR-LIST-05.
- **États** : photo `UPLOADED` → `APPROVED` / `REJECTED`.
- **Erreurs** : `PHOTO_FORMAT`, `PHOTO_MIN_COUNT`.
- **Données** : listing_photo.
- **Notifications** : —
- **Permissions** : `P2P_HOST` (ses annonces), `OPS_AGENT`.
- **Dépendances** : HST-005.
- **Critères d'acceptation** : Given 5 photos, When l'hôte soumet l'annonce, Then `PHOTO_MIN_COUNT`. Given une photo refusée par l'ops, When l'hôte ouvre A10, Then le motif du refus est affiché sur la photo.
- **Source** : SRC_H §1.4 ; écrans 10b : A10.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — photos téléversées par l'hôte dans l'assistant, sans recadrage guidé ; contrôle visuel par l'ops à la revue.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : détection automatique d'images de banque.

#### Fiche HST-016 / HST-026 — Soumission, revue et cycle de vie de l'annonce
- **FEATURE ID** : HST-016, HST-026
- **Nom** : Soumission et revue de l'annonce (HST-016) ; cycle de vie de l'annonce (HST-026)
- **Module** : Espace hôte & annonces (HST — Assistant, Statuts)
- **Persona** : PER-08 ; PER-07
- **Objectif** : seules des annonces revues, conformes et d'hôtes activés sont visibles.
- **Description** : HST-016 : revue manuelle de toutes les annonces au lancement (Turo : 24–48 h ; SLA ops 24 h, ADM-003), avec contrôle des documents du véhicule (HST-039) et de l'éligibilité (HST-019). HST-026 (absorbe HST-028) : statuts brouillon, en revue, listée, en pause, non listée, restreinte, retirée, supprimée. Publication possible seulement si l'hôte est vérifié, a accepté les CGU de l'hôte (LEG-001) et si `p2p_private_hosts_enabled[pays]` et `insurer_contract_active[pays]` valent `true`.
- **Déclencheur** : soumission par l'hôte ; actions de l'hôte et de l'ops ; événements (document du véhicule expiré, rappel constructeur).
- **Prérequis** : HST-012, HST-019 ; vérification de l'hôte (HST-049) ; CGU de l'hôte acceptées.
- **Parcours principal** : `DRAFT` → `PENDING_REVIEW` → `LISTED`.
- **Parcours alternatifs** : refus → `REJECTED` → correction ; retrait par l'hôte avec trips futurs → refusé tant que des trips existent (règle proposée, OQ-BR-29, EC-37) ; document expiré → `RESTRICTED` ; interrupteur du pays repassé à `false` → annonces non réservables, trips existants traités par l'ops.
- **Règles métier** : BR-LIST-08, BR-LIST-09, BR-LIST-01, BR-LIST-06.
- **États** : SM-2 complet.
- **Erreurs** : `LISTING_HAS_FUTURE_TRIPS`, `LISTING_TRANSITION_FORBIDDEN`, `HOST_NOT_ACTIVATED`, `INSURER_CONTRACT_INACTIVE`.
- **Données** : listing(vehicle_id, status, status_reason, changed_by, changed_at).
- **Notifications** : `EVT_LISTING_APPROVED`, `EVT_LISTING_REJECTED`, `EVT_LISTING_RESTRICTED`.
- **Permissions** : `P2P_HOST` (soumettre, mettre en pause, retirer ses annonces), `OPS_AGENT` (approuver, restreindre, permission `ops.review_listing_host`).
- **Dépendances** : HST-016 → HST-012, HST-019 ; HST-026 → HST-016.
- **Critères d'acceptation** : Given une transition absente de SM-2, When elle est demandée, Then `LISTING_TRANSITION_FORBIDDEN`. Given un trip futur, When l'hôte retire l'annonce, Then `LISTING_HAS_FUTURE_TRIPS`. Given `insurer_contract_active` à `false` dans le pays, When l'ops tente d'approuver une annonce, Then `INSURER_CONTRACT_INACTIVE` et l'annonce reste `PENDING_REVIEW`. Given chaque changement de statut, When il a lieu, Then il est journalisé avec motif.
- **Source** : SRC_H H12, §1.4 ; 08 BR-LIST-09, SM-2, « Règle de blocage » ; écrans 10b : A10, O01.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ (les deux) — soumission par l'hôte dans l'assistant, revue par l'ops dans la console O01 ; cycle de vie minimal (brouillon, en revue, listée, en pause, restreinte).
- **Complexité** : moyenne ; ops moyen / faible ; risque faible.
- **Améliorations possibles** : approbation automatique pour les hôtes établis (P1).

#### Fiche HST-019 — Éligibilité du véhicule
- **FEATURE ID** : HST-019
- **Nom** : Éligibilité du véhicule d'un particulier
- **Module** : Espace hôte & annonces (HST — Éligibilité)
- **Persona** : PER-08 ; PER-07
- **Objectif** : seuls des véhicules sûrs, légaux, appartenant à l'hôte ou autorisés, et couverts par l'assureur partenaire sont loués.
- **Description** : 08 BR-LIST-01 à 03, OQ-P2P-02 : titre au nom de l'hôte ou autorisation notariée du propriétaire ; plaque et numéro de châssis (VIN) rapprochés du titre et du registre quand il est consultable ; titres interdits (épave, perte totale, inondation, vol signalé) ; véhicule financé (prenda) publiable seulement avec le consentement écrit du créancier (`vehicle_financed_requires_lender_consent` = `true`, OQ-BR-28) ; âge ≤ 10 ans et < 200 000 km (valeurs À DÉCIDER dans ADM-031 ; Turo : ≤ 12 ans, valeur ≤ 200 000 $) ; revisado (PA) ou inspección técnica (PY) à jour ; véhicule hors catalogue non publiable (OQ-CAT-01). La plaque « particular » est la norme ; la question OQ-BR-35 ferme la mise en service par `p2p_private_hosts_enabled[pays]`, pas l'éligibilité.
- **Déclencheur** : soumission de l'annonce.
- **Prérequis** : HST-011, HST-039, ADM-031.
- **Parcours principal** : règles automatiques (âge, km, rapprochement plaque / VIN / titre) → contrôle ops des documents → éligible.
- **Parcours alternatifs** : non éligible → `BLOCKED_ELIGIBILITY` (SM-2) avec motif ; titre au nom d'un tiers sans autorisation → refus ; prenda sans consentement → refus jusqu'au dépôt du consentement.
- **Règles métier** : BR-LIST-01, BR-LIST-02, BR-LIST-03, BR-LIST-06, BR-LIST-07.
- **États** : SM-2 `DRAFT` → `BLOCKED_ELIGIBILITY`.
- **Erreurs** : `VEHICLE_TOO_OLD`, `VEHICLE_MILEAGE_TOO_HIGH`, `VEHICLE_TITLE_MISMATCH`, `VEHICLE_VIN_MISMATCH`, `VEHICLE_TITLE_FORBIDDEN`, `VEHICLE_LENDER_CONSENT_REQUIRED`, `VEHICLE_NOT_COVERED` (PROPOSÉ, 19 US-124 : hors des critères du contrat de l'assureur partenaire).
- **Données** : vehicle.odometer_km, title_owner_match, lien_declared, lender_consent_file_id, eligibility_check(by, at, result).
- **Notifications** : `EVT_LISTING_REJECTED` avec motif.
- **Permissions** : `OPS_AGENT` ; `P2P_HOST` (lecture du résultat et des motifs).
- **Dépendances** : HST-011 ; HST-039 ; ADM-031.
- **Critères d'acceptation** : Given un véhicule de 11 ans (seuil de test 10), When il est soumis, Then `VEHICLE_TOO_OLD`. Given un VIN qui diffère de celui du titre, When le contrôle tourne, Then `VEHICLE_VIN_MISMATCH` et l'annonce passe `BLOCKED_ELIGIBILITY`. Given un véhicule déclaré financé sans consentement écrit du créancier, When il est soumis, Then `VEHICLE_LENDER_CONSENT_REQUIRED`. Given un véhicule hors des critères du contrat de l'assureur partenaire du pays (âge, valeur ou usage), When il est soumis, Then `VEHICLE_NOT_COVERED` et l'annonce n'est pas publiable.
- **Source** : SRC_H §1.2–1.3 ; 08 BR-LIST-01 à 03 ; 22 OQ-P2P-02, OQ-BR-28 ; écrans 10b : A10, O01.
- **Confiance** : documenté (base) ; seuils et rapprochement proposés.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — âge et kilométrage contrôlés automatiquement ; titre, plaque, VIN et prenda vérifiés par l'ops sur liste de contrôle à partir des documents de HST-039.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : consultation des registres par API (Registro Público PA, DNRA PY) ; rappels constructeurs (BR-LIST-06).

#### Fiche HST-033 — Configuration de la distance incluse
- **FEATURE ID** : HST-033
- **Nom** : Configuration de la distance incluse
- **Module** : Espace hôte & annonces (HST — Kilométrage)
- **Persona** : PER-08
- **Objectif** : fixer le kilométrage vendu avec la voiture.
- **Description** : l'hôte choisit « kilométrage illimité » ou une distance incluse par jour (km) et un prix du km supplémentaire (devise du pays : USD ou PYG), par véhicule ; figé dans la réservation (ex-PRC-019). Proposition : 250 / 200 / 150 km par jour selon la classe.
- **Déclencheur** : assistant (HST-005) ; modification dans A11.
- **Prérequis** : HST-005.
- **Parcours principal** : saisie → validation → affichage LST-012.
- **Parcours alternatifs** : —
- **Règles métier** : BR-MILEAGE-01, BR-MILEAGE-02, BR-MILEAGE-04, BR-PRICE-17.
- **États** : —
- **Erreurs** : `MILEAGE_CONFIG_INVALID`.
- **Données** : mileage_policy(vehicle_id, unlimited, km_per_day, extra_km_price_minor, currency).
- **Notifications** : —
- **Permissions** : `P2P_HOST` (ses véhicules).
- **Dépendances** : HST-005.
- **Critères d'acceptation** : Given une modification de la distance incluse, When un trip a été confirmé avant, Then il garde l'ancienne configuration. Given un prix du km en PYG avec décimales, When l'hôte l'enregistre, Then `MILEAGE_CONFIG_INVALID`.
- **Source** : SRC_H §2 ; écrans 10b : A10, A11.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — distance incluse et prix du km saisis par l'hôte dans l'assistant, sans configuration par catégorie.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : facturation du dépassement in-app (P1).

#### Fiche HST-039 — Documents du véhicule
- **FEATURE ID** : HST-039
- **Nom** : Documents du véhicule (titre, plaque, inspection, prenda, assurance)
- **Module** : Espace hôte & annonces (HST — Documents)
- **Persona** : PER-08 ; PER-07
- **Objectif** : un dossier du véhicule complet et à jour, base de l'éligibilité (HST-019) et des documents à bord.
- **Description** : téléversés par l'hôte avec dates de validité : titre ou registro (registro único vehicular PA, cédula verde PY) au nom de l'hôte ou autorisation notariée du propriétaire ; photo de la plaque et du VIN ; revisado (PA) ou inspección técnica et habilitación (PY) ; déclaration de prenda et, s'il y en a une, consentement écrit du créancier (OQ-BR-28) ; au Panama, attestation de l'assurance obligatoire minimale (SOBAT) de l'hôte ; au Paraguay, déclaration d'une police personnelle hors trip (BR-PROT-10). La couverture pendant le trip vient de l'assureur partenaire (jambe `INSURER`), jamais d'une police de l'hôte. Documents à bord pendant le trip (BR-PICKUP-06).
- **Déclencheur** : ajout du véhicule ; renouvellements ; tâche quotidienne d'expiration.
- **Prérequis** : HST-011.
- **Parcours principal** : dépôt par l'hôte → revue ops → `VALID`.
- **Parcours alternatifs** : document expiré → annonce `RESTRICTED`, trips confirmés signalés à l'ops ; document illisible → `MORE_INFO_REQUIRED`.
- **Règles métier** : BR-PROT-10, BR-PICKUP-06, BR-LIST-01, BR-LIST-03.
- **États** : vehicle_document `SUBMITTED` → `VALID` → `EXPIRED` / `REJECTED`.
- **Erreurs** : `VEHICLE_DOCUMENT_EXPIRED`, `VEHICLE_DOCUMENT_REQUIRED`.
- **Données** : vehicle_document(vehicle_id, type ∈ {TITLE, OWNER_AUTHORIZATION, PLATE_VIN_PHOTO, INSPECTION, LIEN_DECLARATION, LENDER_CONSENT, COMPULSORY_INSURANCE}, file_id, valid_until).
- **Notifications** : `EVT_VEHICLE_DOCUMENT_EXPIRING`.
- **Permissions** : `P2P_HOST` (ses véhicules), `OPS_AGENT`.
- **Dépendances** : HST-011.
- **Critères d'acceptation** : Given un revisado expiré, When la tâche quotidienne tourne, Then l'annonce passe `RESTRICTED`. Given un véhicule sans titre ni autorisation du propriétaire, When l'hôte soumet l'annonce, Then `VEHICLE_DOCUMENT_REQUIRED`. Given une prenda déclarée, When le consentement du créancier manque, Then l'annonce ne peut pas être approuvée.
- **Source** : SRC_H §2 ; TOS-HOST ; 08 BR-PROT-10 ; écrans 10b : A10, A07.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — documents téléversés par l'hôte dans l'assistant, dates saisies et vérifiées par l'ops, alerte d'expiration par tâche quotidienne.
- **Complexité** : faible ; ops moyen ; risque moyen.
- **Améliorations possibles** : OCR des dates ; vérification de la prenda par API.

#### Fiche HDB-001 / HDB-002 — Espace hôte : accueil et réservations
- **FEATURE ID** : HDB-001, HDB-002
- **Nom** : Espace hôte : accueil (HDB-001) ; réservations de l'hôte (HDB-002)
- **Module** : Espace hôte & annonces (HDB — Tableau de bord, Trajets)
- **Persona** : PER-08
- **Objectif** : gérer ses locations depuis son téléphone.
- **Description** : HDB-001 (absorbe ACC-027, ACC-028) : accueil de l'espace hôte (A02) : prochaines remises et retours, gains du mois (jambe `HOST`), demandes en mode `REQUEST`, liste « Mis autos » / « My cars » (clé `web.a02.cars.title` du catalogue de 10b §4.3, ajoutée en es, en et fr par US-060 ; états `web.a02.cars.listed`, `.paused`, `.inReview`, `.suspended`), accès aux gains (A08), actions no-show et refus de remise. HDB-002 (A05) : onglets À venir / En cours / Terminés / Annulés ; colonnes n° de réservation, véhicule et plaque, voyageur (prénom, photo, note, statut de vérification ; jamais le numéro de permis ni l'image de la pièce, `host_guest_v`), début et fin, lieu de remise, statut du paiement (payé, en attente, remboursé), caution, gains estimés de la jambe `HOST` ; actions (ouvrir, remise, retour, écrire, annuler) ; filtres par véhicule et date. **Mode `REQUEST`** (08 BR-BOOK-01, recommandation LATAM ; OQ-P2P-10, comme Turo ; PROPOSÉ) : `INSTANT` reste le défaut (`p2p_default_booking_mode`) ; si l'hôte a choisi `REQUEST` pour une annonce, chaque demande apparaît en tête de A05 avec son **heure limite de 4 h** et les boutons `web.a05.accept` « Aceptar la solicitud » / « Accept request » et `web.a05.decline` « Rechazar la solicitud » / « Decline request » ; à l'envoi, le paiement du voyageur est seulement **autorisé** et le créneau est réservé à la demande (occupation `HOLD`, source de demande à typer dans 17) ; l'acceptation capture par jambes (PAY-006) et crée le trip ; le refus ou l'expiration libère le créneau et annule l'autorisation (`VOID`), sans débit, le voyageur voyant `web.error.requestExpired` et des voitures proches ; le mode `REQUEST` est **interdit sur une annonce aéroport**. BKG-011 (P2) ne garde que l'ancien flux de Turo à 8 h, non retenu.
- **Déclencheur** : connexion à l'espace hôte.
- **Prérequis** : compte vérifié (ACC-001) ; HDB-002 → HDB-001.
- **Parcours principal** : accueil → liste → ouverture d'un trip → action.
- **Parcours alternatifs** : `CO_HOST` (P1) → seulement les véhicules de sa portée, sans les gains ; aucune réservation → `web.a02.empty` ; demande `REQUEST` sans réponse à l'heure limite → expiration automatique (minuterie `scheduled_job`) ; refus → motif facultatif, aucune pénalité pour l'hôte.
- **Règles métier** : BR-COHOST-02 (permissions du co-hôte) ; aucune autre BR.
- **États** : affichage SM-1.
- **Erreurs** : `FORBIDDEN` (trip d'un autre hôte, 403 journalisé) ; `REQUEST_EXPIRED` (réponse après l'heure limite) ; `REQUEST_MODE_NOT_ALLOWED` (mode `REQUEST` sur une annonce aéroport) (PROPOSÉS).
- **Données** : vues trip_list par `org_id` ; `host_guest_v` ; montant de la jambe `HOST` seul (RLS-28 : titulaire seulement).
- **Notifications** : `EVT_BOOKING_REQUEST_RECEIVED` (hôte, avec l'heure limite), `EVT_BOOKING_REQUEST_EXPIRED` (voyageur, hôte), `EVT_BOOKING_CONFIRMED` à l'acceptation (clés PROPOSÉES).
- **Permissions** : `P2P_HOST` (`trip.read_org`) ; `CO_HOST` lim. (véhicules de sa portée, pas de gains).
- **Dépendances** : HDB-001 → ACC-001 ; HDB-002 → HDB-001.
- **Critères d'acceptation** : Given une confirmation à 10:00, When l'hôte rafraîchit A05 à 10:01, Then le trip apparaît. Given un trip d'un autre hôte, When l'hôte l'appelle par son identifiant, Then 403 et l'accès est journalisé. Given un trip confirmé, When l'hôte ouvre la fiche du voyageur, Then il voit prénom, photo, note et statut de vérification, mais jamais le numéro du permis. Given une demande `REQUEST` envoyée à 10:00, When l'hôte touche `web.a05.accept` à 12:30, Then l'autorisation est capturée par jambes, le trip passe `BOOKED` et le voyageur est notifié. Given une demande envoyée à 10:00, When l'hôte touche `web.a05.decline`, Then l'autorisation est annulée (`VOID`), le créneau est libéré, aucun montant n'est débité et le voyageur voit `web.error.requestDeclined` (distinct de `web.error.requestExpired` ; 10b §4.3, US-060). Given une demande envoyée à 10:00 sans réponse, When il est 14:00 à l'heure serveur, Then la demande expire, l'autorisation est annulée, le voyageur voit `web.error.requestExpired` et un clic de l'hôte sur `web.a05.accept` renvoie `REQUEST_EXPIRED`. Given une annonce aéroport, When l'hôte choisit le mode `REQUEST`, Then `REQUEST_MODE_NOT_ALLOWED` et l'annonce reste `INSTANT`.
- **Source** : SRC_H §7 (H110, H137) ; 17 §2.3 ; 08 BR-BOOK-01 ; 22 OQ-P2P-10 ; écrans 10b : A02, A05, A08.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lots 1 et 2 : lot 1 pour HDB-001, lot 2 pour HDB-002)
- **Bêta pilote** : HDB-001 SIMPLIFIÉ — accueil minimal (prochaines remises, gains du mois, accès aux réservations) ; HDB-002 OUI.
- **Complexité** : moyenne / faible ; ops faible ; risque faible.
- **Améliorations possibles** : tableau de revenus et simulateur (15 IMP-24) ; export CSV (P1).

## E8 — Trip : remise et retour entre particuliers, preuves (P0-A, 11 lignes)

#### Fiche TRP-002 — Remise et retour entre particuliers sur mobile
- **FEATURE ID** : TRP-002
- **Nom** : Check-in / check-out mobile entre l'hôte et le voyageur (PWA ; hors ligne dans TRP-057)
- **Module** : Opérations de trip (TRP — Check-in)
- **Persona** : PER-08 ; PER-01, PER-02
- **Objectif** : remise et retour guidés, prouvés et rapides, en personne, au lieu de remise convenu.
- **Description** : hôte et voyageur, chacun sur son téléphone, depuis le trip (A03 pour l'hôte, S09 · check-in pour le voyageur) : les 4 étapes de 10b v3 UX-41 : 1) arrivée au rendez-vous (`web.a03.arrived` « Ya llegué » / « I'm here ») ; 2) contrôle du permis physique par l'hôte en 6 points (VER-015, clés `web.a03.check.*`) ; 3) photos guidées des deux côtés avec carburant et compteur (TRP-004) ; 4) remise des clés (`web.a03.handover` « Entregar las llaves » / « Hand over the keys ») et signature si elle manque (BKG-019) ; le récapitulatif validé par les deux clôt l'étape 4. Cible M4 (10b v3 M-REM-01, PROPOSÉ) : **≤ 5 écrans et ≤ 10 min** de l'arrivée à la remise des clés, retour en moins de 8 min. Même parcours au retour (TRP-033, A04). Ouverture 24 h avant le début ou dès la réservation si plus tardive (ex-TRP-001). Remise sans contact fermée (`p2p_contactless_handover_enabled` = `false`, OQ-P2P-05). Photos ≈ 1 600 px, ≤ 500 ko. Technique selon TRP-056.
- **Déclencheur** : trip `CHECKIN_OPEN` ; arrivée des deux parties au lieu de remise.
- **Prérequis** : TRP-045, VER-015, PAY-034, TRP-056 ; contrat signé ; paiement confirmé et caution autorisée.
- **Parcours principal** : 4 étapes (UX-41) → validation des deux parties → `IN_PROGRESS` à l'heure serveur.
- **Parcours alternatifs** : étape incomplète → trip reste `CHECKIN_OPEN` ; paiement non confirmé → étape bloquée avec cause ; refus du véhicule par le voyageur (TRP-007) ; refus de remise par l'hôte (permis non conforme, VER-015) ; voyageur absent → no-show (TRP-015) ; hôte absent → `HOST_NO_SHOW` (TRP-015).
- **Règles métier** : BR-PICKUP-01, BR-PICKUP-02, BR-PICKUP-03, BR-PICKUP-04, BR-PICKUP-06, BR-PICKUP-07.
- **États** : SM-1 `BOOKED` → `CHECKIN_OPEN` → `IN_PROGRESS`.
- **Erreurs** : `CHECKIN_NOT_OPEN`, `CHECKIN_PAYMENT_NOT_CONFIRMED`, `CHECKIN_STEP_INCOMPLETE`, `CONTRACT_NOT_SIGNED`.
- **Données** : `trip_inspection`(trip_id, kind = OUT / IN, performed_by, status, fuel_level, odometer_km, started_at, completed_at_server) ; validations de l'hôte et du voyageur.
- **Notifications** : `EVT_CHECKIN_DONE` (voyageur, hôte).
- **Permissions** : `P2P_HOST` (`trip.checkin_checkout`, `kyc.license_check_at_handover`) ; `CO_HOST` lim. ; `GUEST` (sa part : photos et signature).
- **Dépendances** : TRP-045 ; VER-015 ; PAY-034 ; TRP-056.
- **Critères d'acceptation** : Given un check-in sans photos complètes, When l'hôte valide, Then le trip ne passe pas `IN_PROGRESS`. Given un trip réservé 3 h avant le départ, When il est confirmé, Then le check-in est ouvert immédiatement. Given un paiement sans preuve signée, When l'hôte ouvre A03, Then l'étape des clés est bloquée avec `CHECKIN_PAYMENT_NOT_CONFIRMED`. Given les deux validations, When la dernière est reçue, Then `IN_PROGRESS` prend l'heure serveur. Given une remise de test de bout en bout avec le gabarit complet de TRP-004 (plan HT4 de 10b v3), When l'hôte la conduit dans A03, Then elle tient en **5 écrans au plus et 10 min au plus** entre `web.a03.arrived` et `web.a03.handover`, et le retour dans A04 en moins de 8 min (M4).
- **Source** : 08 BR-PICKUP-01 reco ; 11 EC-15 ; écrans 10b : A03, A04, S09.
- **Confiance** : proposé (Turo : app native, DOCUMENTÉ).
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — en ligne seulement (réseau mobile au lieu de remise), parcours conduit par l'hôte dans A03 et A04, validation du voyageur dans S09.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : contrat consultable hors ligne (15 IMP-35, P1) ; remise sans contact avec équipements (P1-E10).

#### Fiche TRP-004 — Capture in-app avec gabarit d'angles et horodatage serveur
- **FEATURE ID** : TRP-004
- **Nom** : Capture in-app avec gabarit d'angles et horodatage serveur
- **Module** : Opérations de trip (TRP — Check-in)
- **Persona** : PER-08 ; PER-01, PER-02
- **Objectif** : preuve exploitable de l'état du véhicule (litiges, ACODECO, assureur partenaire), prise par l'hôte et par le voyageur.
- **Description** : capture dans l'app uniquement (pas d'import de galerie) ; gabarit d'angles d'**au moins 15 photos extérieures et 8 intérieures**, plus carburant et compteur, **de chaque côté** (hôte et voyageur), au départ et au retour : valeur de 10b v3 (UX-41, S09 · check-in, plan HT4 : au moins 23 photos de chaque côté), qui **fait foi pour l'UX**, et de 08 BR-PICKUP-03 (comme Turo) ; le gabarit de 20 photos de la version 4 est abandonné et les emplacements `slot_code` de `inspection_photo` (17 §3.2.10) sont à aligner par une révision de 17 ; la cible M4 (≤ 5 écrans, ≤ 10 min) se mesure avec ce gabarit (TRP-002) (absorbe TRP-003, TRP-005, TRP-006) ; chaque partie peut prendre le gabarit, la série de l'une ne remplace pas celle de l'autre ; heure serveur, géolocalisation, **SHA-256 calculé à la réception**. L'empreinte prouve l'intégrité depuis la réception, pas l'absence de retouche avant l'envoi.
- **Déclencheur** : étape 2 du check-in / check-out.
- **Prérequis** : TRP-002 ; TRP-056.
- **Parcours principal** : angle guidé → capture → envoi → empreinte → case cochée.
- **Parcours alternatifs** : photo floue → reprise ; dommage existant → annotation ; désaccord sur un dommage existant → annotation des deux séries, signalé au dossier.
- **Règles métier** : BR-PICKUP-03, BR-RETURN-01, BR-DAMAGE-02.
- **États** : photo `CAPTURED` → `RECEIVED` (empreinte).
- **Erreurs** : `PHOTO_TEMPLATE_INCOMPLETE`, `PHOTO_GALLERY_FORBIDDEN`.
- **Données** : `trip_inspection`(trip_id, kind, performed_by, status) ; `inspection_photo`(inspection_id, slot_code, file_id, taken_by_role ∈ {HOST, GUEST}) ; `file_asset`(sha256 à la réception, device_captured_at, server_received_at, source `IN_APP_CAMERA`) (17 §3.2.10, §3.2.13).
- **Notifications** : —
- **Permissions** : `P2P_HOST` et `GUEST` du trip ; `CO_HOST` lim. ; lecture `OPS_AGENT` (journalisée).
- **Dépendances** : TRP-002 ; TRP-056.
- **Critères d'acceptation** : Given la série de départ de l'hôte avec 15 extérieures, 7 intérieures, carburant et compteur (une intérieure manquante), When l'hôte valide, Then `PHOTO_TEMPLATE_INCOMPLETE`. Given la série complète de l'hôte (au moins 15 extérieures, 8 intérieures, carburant, compteur) et aucune photo du voyageur, When le voyageur valide sa part dans S09 · check-in, Then `PHOTO_TEMPLATE_INCOMPLETE` (la série de l'un ne remplace pas celle de l'autre). Given une photo reçue, When on recalcule l'empreinte du fichier stocké, Then elle est identique à celle enregistrée. Given une tentative d'import depuis la galerie, When le fichier est envoyé, Then `PHOTO_GALLERY_FORBIDDEN`.
- **Source** : 08 BR-PICKUP-03 reco ; écrans 10b : A03, A04, S09.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : OUI.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : inspection IA avant / après (CLM-035, P2).

#### Fiche TRP-007 — Refus du véhicule au départ
- **FEATURE ID** : TRP-007
- **Nom** : Refus du véhicule au départ par le voyageur
- **Module** : Opérations de trip (TRP — Check-in)
- **Persona** : PER-01, PER-02 ; PER-08
- **Objectif** : protéger le voyageur face à une voiture sale, non conforme ou dangereuse.
- **Description** : bouton `web.s09.refuse` « No acepto el auto » / « I don't accept the car » (S09) avant le check-in : photos, motif, contact support ; remboursement intégral exécuté par Kmino via le PSP, par jambe (BR-CXL-04, motif FULL ; PAY-021) ou relogement ; pénalité éventuelle de l'hôte retenue sur ses gains au `host_ledger` (BR-CXL-13), jamais une jambe du remboursement.
- **Déclencheur** : inspection au départ, au lieu de remise.
- **Prérequis** : TRP-002, VER-015.
- **Parcours principal** : refus → photos → ticket support → décision ops → `REFUSED_AT_PICKUP` → remboursement intégral (PAY-021) ou nouveau véhicule.
- **Parcours alternatifs** : check-in déjà fait → plus de refus possible (passer par un incident, CLM-002) ; refus jugé infondé par l'ops → retour au parcours de check-in ou annulation par le voyageur (BKG-028).
- **Règles métier** : BR-CXL-04, BR-CSP-03, BR-PICKUP-06, BR-CXL-13.
- **États** : SM-1 `CHECKIN_OPEN` → `REFUSED_AT_PICKUP`.
- **Erreurs** : `REFUSAL_AFTER_CHECKIN`.
- **Données** : refusal(trip_id, reason, photos[], decided_by).
- **Notifications** : `EVT_VEHICLE_REFUSED` (support, hôte).
- **Permissions** : `GUEST` ; décision `OPS_AGENT`.
- **Dépendances** : TRP-002 ; VER-015.
- **Critères d'acceptation** : Given un refus validé sur le trip A, When le règlement est calculé avec le motif FULL, Then le voyageur est remboursé de 256,66 et la variation par jambe est celle de TJ06 (jambes `HOST` −131,25, `INSURER` −25,50, `PLATFORM` −99,91). Given un check-in déjà validé, When le voyageur appuie sur « No acepto el auto », Then `REFUSAL_AFTER_CHECKIN`.
- **Source** : SRC_G 4.1.6 ; 6.6.4 ; 11 EC-04 ; 08 E7 ; écrans 10b : S09, A03.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — refus signalé au support depuis S09 et traité par l'ops : remboursement intégral exécuté par Kmino via le PSP (PAY-021) ou relogement sur une autre voiture.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : échange de véhicule (BR-MOD-08, P1).

#### Fiche TRP-015 — No-show du voyageur déclaré par l'hôte et no-show de l'hôte
- **FEATURE ID** : TRP-015
- **Nom** : Déclaration du no-show du voyageur par l'hôte ; signalement du no-show de l'hôte
- **Module** : Opérations de trip (TRP — No-show)
- **Persona** : PER-08 ; PER-01, PER-02
- **Objectif** : régler équitablement l'absence de l'une des deux parties au rendez-vous.
- **Description** : **no-show du voyageur** : déclaration par l'hôte après `noShowAt` = début + `noShowGraceMinutes` (défaut 60, OQ-BR-33), sous 72 h ; preuve : message de l'hôte tracé dans le fil du trip et attente de 15 min sans réponse (`hostMessageTraced`, 08 BR-CXL-08), présence au lieu de remise (géolocalisation proposée) ; à défaut, passage automatique à T+72 h (absorbe TRP-014). Hôte éligible : sa jambe `HOST` retenue suit T05 / TJ04a ; **hôte inéligible** (aucun message tracé) : le voyageur est retenu comme pour un no-show, mais toute la retenue va à la jambe `PLATFORM` (T39, TJ05), comme chez Turo ; l'avis consommation OQ-BR-45 bloque la mise en service, pas le build. **No-show de l'hôte** : le voyageur signale l'absence de l'hôte depuis S09, géolocalisé au lieu de remise ; motif `HOST_NO_SHOW`, remboursement intégral et pénalité de l'hôte retenue sur ses gains (BR-CXL-13, T26).
- **Déclencheur** : `START_WINDOW_EXPIRED` ; signalement du voyageur.
- **Prérequis** : TRP-045 ; messagerie du trip (MSG-001).
- **Parcours principal** : déclaration → contrôle des preuves → `NO_SHOW_GUEST` (ou `NO_SHOW_HOST`) → règlement (BR-CXL-08 ou BR-CXL-13) exécuté par jambe.
- **Parcours alternatifs** : le voyageur conteste → SM-7 ; check-in tardif accepté par l'hôte → `IN_PROGRESS` ; signalement d'absence de l'hôte horodaté avant l'annulation du voyageur → l'annulation requalifiée n'ouvre pas de gains à l'hôte.
- **Règles métier** : BR-CXL-08, BR-CXL-09, BR-CXL-13, BR-PICKUP-04, BR-CXL-15.
- **États** : SM-1 `CHECKIN_OPEN` → `START_WINDOW_EXPIRED` → `NO_SHOW_GUEST` / `NO_SHOW_HOST` ; SM-7.
- **Erreurs** : `NO_SHOW_TOO_EARLY`, `NO_SHOW_WINDOW_CLOSED`.
- **Données** : no_show(trip_id, side ∈ {GUEST, HOST}, declared_by, at, evidence[], host_message_traced) ; `settlement_leg`.
- **Notifications** : `EVT_NO_SHOW_DECLARED` (voyageur, hôte, ops).
- **Permissions** : `P2P_HOST` (`trip.declare_no_show`), `CO_HOST` lim. ; `GUEST` (signaler l'absence de l'hôte) ; `OPS_AGENT` ; `SYSTEM` (automatique).
- **Dépendances** : aucune dans 04 (utilise TRP-045).
- **Critères d'acceptation** : Given T+50 min (grâce 60), When l'hôte déclare, Then `NO_SHOW_TOO_EARLY`. Given T05 et T06, When le no-show est déclaré par l'hôte ou automatiquement, Then le résultat est identique (remboursement 138,22, jambe `HOST` retenue 75,00). Given T39 (aucun message de l'hôte tracé), When le no-show est réglé, Then le remboursement est 138,22, la jambe `HOST` retenue vaut 0,00 et la variation par jambe est celle de TJ05b (`HOST` −131,25, `INSURER` −25,50, `PLATFORM` +18,53). Given T26 (voyageur géolocalisé au lieu de remise à T+31 min, hôte absent), When l'absence est confirmée, Then remboursement intégral de 256,66 et pénalité de 150 retenue sur les gains de l'hôte.
- **Source** : SRC_H §6 ; 11 EC-01 ; 08 BR-CXL-08, E7 ; écrans 10b : A02, A05, S09.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — no-show signalé au support depuis le fil du trip par l'hôte ou le voyageur ; l'ops vérifie le message tracé et l'attente de 15 min, puis déclare le motif dans la console.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : géolocalisation des deux parties au lieu de remise.

#### Fiche TRP-033 — Retour avec photos des deux côtés
- **FEATURE ID** : TRP-033
- **Nom** : Check-out avec photos de retour
- **Module** : Opérations de trip (TRP — Check-out)
- **Persona** : PER-08 ; PER-01, PER-02
- **Objectif** : clôturer le trip au lieu de retour avec la preuve de l'état de la voiture.
- **Description** : extérieur, intérieur, carburant, compteur, clés ; heure serveur = fin effective ; même gabarit que le départ (TRP-004), pris par l'hôte et, s'il le souhaite, par le voyageur ; calcul du dépassement de km et du carburant affiché à l'hôte (A04) ; l'hôte peut demander des frais annexes avec preuve (`web.a04.addFee`, CLM-021) dans la liste fermée de BR-PAY-06 ; fenêtre de déclaration de dommage jusqu'à `claim_deadline` (CLM-001).
- **Déclencheur** : retour au lieu convenu.
- **Prérequis** : TRP-004.
- **Parcours principal** : photos → relevés → validation → `RETURNED` → `POST_TRIP` (dommage : `claim_deadline` = max(fin prévue, check-out) + 24 h) → `COMPLETED` ; la jambe `HOST` est libérée à `payout_at`.
- **Parcours alternatifs** : retour en retard → `OVERDUE` → `RETURNED` avec frais de retard (TRP-035) ; hôte injoignable au retour → l'ops ouvre un retour assisté et le voyageur prend seul le gabarit.
- **Règles métier** : BR-RETURN-01, BR-RETURN-02, BR-FUEL-01, BR-MILEAGE-03, BR-RETURN-07, BR-PAYOUT-02.
- **États** : SM-1 `IN_PROGRESS` / `OVERDUE` → `RETURNED` → `POST_TRIP` → `COMPLETED`.
- **Erreurs** : `PHOTO_TEMPLATE_INCOMPLETE`.
- **Données** : `trip_inspection`(kind = IN) ; trip.checkout_at.
- **Notifications** : `EVT_CHECKOUT_DONE` (voyageur, hôte) ; `EVT_REVIEW_INVITATION`.
- **Permissions** : `P2P_HOST` (`trip.checkin_checkout`), `CO_HOST` lim. ; `GUEST` (sa part).
- **Dépendances** : TRP-004.
- **Critères d'acceptation** : Given un check-out validé à 10:20 serveur, When il est enregistré, Then la fin effective est 10:20 et `claim_deadline` vaut 10:20 le lendemain si la fin prévue était plus tôt. Given un gabarit de retour incomplet, When l'hôte valide, Then `PHOTO_TEMPLATE_INCOMPLETE`.
- **Source** : SRC_G 6.2.2 ; 08 BR-DAMAGE-01 ; écrans 10b : A04, S09.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — même parcours et même gabarit que le départ, conduit par l'hôte dans A04 ; frais annexes saisis avec preuve, sans calcul automatique du carburant.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : kilométrage par télématique.

#### Fiche TRP-035 — Détection automatique du retard et grille de frais
- **FEATURE ID** : TRP-035
- **Nom** : Détection automatique du retard et grille de frais
- **Module** : Opérations de trip (TRP — Retard)
- **Persona** : PER-07 ; PER-01, PER-02 ; PER-08
- **Objectif** : réagir vite à un retard et appliquer une grille connue d'avance.
- **Description** : sans check-out à fin + `overdue_detection_minutes` (30 min, 17 §7.2 ; cohérent avec la franchise 0–29 min de la grille) → `OVERDUE`, alerte WhatsApp au voyageur et à l'hôte ; à +2 h → escalade TRP-038. Grille de 08 (valeurs par défaut dans ADM-031), une seule par pays, affichée au contrat ; frais débités au voyageur par Kmino (carte enregistrée, PAY-015) avec des montants explicites par jambe. Référence Turo : 0–29 min gratuit, ½ jour, 1 jour + 20 $. **OQ-BR-04 ouverte** (retard ou extension, frontière de jour) : valeurs paramétrées, non codées.
- **Déclencheur** : tâche planifiée (chaque minute, PROPOSÉ).
- **Prérequis** : TRP-033, ADM-031, PAY-015.
- **Parcours principal** : fin + grâce dépassée → `OVERDUE` → notifications → retour → frais calculés et proposés au voyageur (SM-5).
- **Parcours alternatifs** : retour avant l'escalade → `RETURNED` ; conflit avec le trip suivant du même véhicule (EC-19) → alerte ops pour relogement du voyageur suivant.
- **Règles métier** : BR-RETURN-03, BR-CXL-00, BR-BOOK-05.
- **États** : SM-1 `IN_PROGRESS` → `OVERDUE` → `RETURNED` / `UNRETURNED`.
- **Erreurs** : —
- **Données** : params `overdue_detection_minutes`, `late_fee_grid` par pays ; trip.overdue_at.
- **Notifications** : `EVT_TRIP_OVERDUE` (WhatsApp ou SMS au voyageur et à l'hôte), `EVT_RETURN_REMINDER` (H−2).
- **Permissions** : `SYSTEM`.
- **Dépendances** : TRP-033 ; ADM-031 ; PAY-015.
- **Critères d'acceptation** : Given une fin à 10:00 et `overdue_detection_minutes` = 30 (valeur de test ; la grille et la frontière retard / extension restent dépendantes d'OQ-BR-04), When il est 10:29, Then pas d'`OVERDUE` ; à 10:30, `OVERDUE` et alerte envoyée une seule fois au voyageur et à l'hôte (EC-17, EC-18). Given un changement de la valeur de grâce après décision OQ-BR-04, When il est publié, Then seuls les trips réservés ensuite l'appliquent.
- **Source** : SRC_G 6.3.1 ; 11 EC-17, EC-18, EC-19 ; écrans 10b : S09, A02, A11.
- **Confiance** : documenté (grille Turo) ; détection automatique proposée.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — détection `OVERDUE` et alertes automatiques ; frais de retard proposés par l'hôte dans A04 et validés par l'ops avant débit.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : extension en libre-service depuis l'alerte (P1).

#### Fiche TRP-038 — Procédure de non-restitution graduée
- **FEATURE ID** : TRP-038
- **Nom** : Procédure de non-restitution graduée entre particuliers
- **Module** : Opérations de trip (TRP — Non-restitution)
- **Persona** : PER-07, PER-08
- **Objectif** : aider l'hôte à récupérer sa voiture ou à déposer plainte, avec un dossier prêt.
- **Description** : 08 BR-RETURN-04 : T+2 h contact du voyageur et de l'hôte (appel, WhatsApp) ; T+6 h mise en demeure écrite (gabarit, au nom de l'hôte propriétaire) et demande de position GPS à l'hôte si la voiture en a un ; T+24 h plainte pré-remplie (DIJ au Panama, équivalent au Paraguay) fournie à l'hôte, qui la dépose, et déclaration à l'assureur partenaire (vol, SM-4). Frais selon le contrat de location hôte–voyageur (référence Turo 500 $). Récupération physique par Kmino exclue ; coupure moteur exclue (OQ-BR-17). Versement de l'hôte non bloqué par la procédure ; la protection du voyageur est annulée en cas de vol établi.
- **Déclencheur** : `OVERDUE` + 2 h.
- **Prérequis** : TRP-035.
- **Parcours principal** : tâches horodatées dans ADM-022 → `UNRETURNED` → retour (`RETURNED`) ou vol (`VEHICLE_LOST`, SM-4 vol).
- **Parcours alternatifs** : voyageur joint et retour promis → suivi sans escalade, décision tracée ; hôte injoignable → l'ops poursuit les étapes et conserve le dossier.
- **Règles métier** : BR-RETURN-04, BR-DAMAGE-10, BR-TRUST-05.
- **États** : SM-1 `OVERDUE` → `UNRETURNED` → `RETURNED` / `VEHICLE_LOST` ; SM-4 `THEFT_INVESTIGATION`.
- **Erreurs** : —
- **Données** : escalation(trip_id, step, at, by, documents[]).
- **Notifications** : `EVT_UNRETURNED_ESCALATION` (ops, hôte).
- **Permissions** : `OPS_AGENT` ; `P2P_HOST` (lecture du dossier et des gabarits de son trip).
- **Dépendances** : TRP-035.
- **Critères d'acceptation** : Given un trip `OVERDUE` depuis 2 h, When la tâche tourne, Then une tâche ops « contact » est créée et l'hôte est prévenu. Given 6 h de retard, When la tâche tourne, Then le gabarit de mise en demeure est généré au nom de l'hôte. Given 24 h de retard, When la tâche tourne, Then la plainte pré-remplie est remise à l'hôte et une déclaration de vol est ouverte en SM-4.
- **Source** : TOS-GUEST ; 11 EC-20 ; 08 BR-RETURN-04 ; écrans 10b : A02, S17.
- **Confiance** : documenté (frais Turo) ; escalade horaire proposée.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — étapes horodatées créées automatiquement dans ADM-022 ; contacts, mise en demeure et plainte préparés par l'ops avec des gabarits, remis à l'hôte.
- **Complexité** : moyenne ; ops élevé ; risque élevé.
- **Améliorations possibles** : intégration des GPS existants (TRP-055, P1).

#### Fiche TRP-045 — Machine à états du trip
- **FEATURE ID** : TRP-045
- **Nom** : Machine à états du trip
- **Module** : Opérations de trip (TRP — Cycle de vie)
- **Persona** : technique ; tous
- **Objectif** : un état unique et cohérent du trip, source de toutes les règles.
- **Description** : implémentation de SM-1 (QUOTE → HOLD → BOOKED → CHECKIN_OPEN → IN_PROGRESS → OVERDUE / RETURNED → POST_TRIP → COMPLETED / IN_DISPUTE, états d'annulation et de no-show terminaux) et de SM-1b (`requirements_status`). Invariants de 08 : IN_PROGRESS exige un check-in validé par l'hôte et le voyageur et l'approbation du conducteur ; pas d'annulation depuis IN_PROGRESS (→ TERMINATED_EARLY) ; état d'annulation = fonction du **motif qualifié**, jamais de l'initiateur ; règlement calculé une seule fois par (trip, segment, version) et exécuté par jambe (08 E7) ; requalification = écriture d'audit. En mode `REQUEST`, la demande expire à 4 h sans réponse de l'hôte. Absorbe TRP-046.
- **Déclencheur** : événements métier (paiement, check-in, check-out, horloge, décision ops).
- **Prérequis** : BKG-014.
- **Parcours principal** : transitions gardées, journalisées, idempotentes.
- **Parcours alternatifs** : transition interdite → rejet ; événements concurrents (EC-54) → verrou par trip, premier gagnant, second requalifié selon 08.
- **Règles métier** : BR-CXL (table de décision), BR-MOD, BR-RETURN-03, BR-RETURN-04, BR-PICKUP-01, BR-CXL-08, BR-BOOK-01.
- **États** : SM-1, SM-1b, SM-7 (requalification).
- **Erreurs** : `TRIP_TRANSITION_FORBIDDEN`, `TRIP_CONCURRENT_UPDATE`.
- **Données** : trip(id, state, requirements_status, version), trip_event(trip_id, from, to, reason, actor, at).
- **Notifications** : chaque transition publie un événement consommé par NTF-001.
- **Permissions** : `SYSTEM` ; transitions manuelles par `OPS_AGENT` (ADM-006) avec motif.
- **Dépendances** : BKG-014.
- **Critères d'acceptation** : Given un trip IN_PROGRESS, When une annulation est demandée, Then `TRIP_TRANSITION_FORBIDDEN`. Given deux événements d'annulation simultanés (EC-54), When ils sont traités, Then un seul règlement par version. Given T05 et T06, When le no-show est déclaré par l'hôte ou automatiquement, Then le règlement est identique (invariance à l'initiateur). Given T25, When une annulation du voyageur arrive à T+75 min, Then elle est requalifiée `GUEST_NO_SHOW`.
- **Source** : 08 SM-1 ; écrans 10b : S08, S09, A02, A05.
- **Confiance** : proposé (notre modèle, dérivé des règles documentées).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — états BOOKED, IN_PROGRESS, OVERDUE, COMPLETED, CANCELLED et no-show seulement ; litige suivi hors machine à états.
- **Complexité** : élevée ; ops faible ; risque moyen.
- **Améliorations possibles** : états de modification et d'extension (P1).

#### Fiche CLM-034 — Dossier de preuve exportable par trip
- **FEATURE ID** : CLM-034
- **Nom** : Dossier de preuve exportable par trip
- **Module** : Sinistres & protection (CLM — Preuves ; rattachée à E8)
- **Persona** : PER-07, PER-08, PER-01, PER-02
- **Objectif** : un dossier complet pour ACODECO ou SEDECO, les chargebacks et l'assureur partenaire.
- **Description** : contrat de location hôte–voyageur et constancia, versions des CGU acceptées, photos de départ et de retour des deux parties avec heure serveur et SHA-256, messages, journal d'événements du trip, décisions ; export PDF + ZIP avec manifeste des empreintes ; conservation selon LEG-009. Chaque partie ne reçoit que ses propres données personnelles et celles nécessaires au litige (minimisation, `host_guest_v`).
- **Déclencheur** : demande de l'ops, de l'hôte ou du voyageur ; ouverture d'un litige ou d'un sinistre.
- **Prérequis** : TRP-004, MSG-001, LEG-009.
- **Parcours principal** : génération asynchrone → lien de téléchargement signé et limité dans le temps.
- **Parcours alternatifs** : pièce manquante → listée comme absente dans le manifeste.
- **Règles métier** : BR-DAMAGE-04, BR-DAMAGE-02, BR-PAY-11.
- **États** : export `REQUESTED` → `READY` → `EXPIRED`.
- **Erreurs** : `EVIDENCE_EXPORT_FAILED`.
- **Données** : evidence_export(trip_id, manifest, sha256s, requested_by, expires_at).
- **Notifications** : `EVT_EVIDENCE_READY`.
- **Permissions** : `OPS_AGENT` ; `P2P_HOST` (ses trips, sans numéro de permis ni image de la pièce du voyageur) ; `GUEST` (ses trips, sans données d'autres personnes).
- **Dépendances** : TRP-004 ; MSG-001 ; LEG-009.
- **Critères d'acceptation** : Given un trip terminé, When l'export est généré, Then le manifeste liste chaque fichier avec son SHA-256 et chaque empreinte correspond au fichier. Given un trip avec 40 photos, contrat, constancia et 30 messages, When l'export est demandé, Then il est prêt en ≤ 10 min et son lien expire après 7 j (seuils PROPOSÉS). Given un export demandé par l'hôte, When il est généré, Then il ne contient ni le numéro du permis ni l'image de la pièce du voyageur.
- **Source** : VERIF_07 NEW-08 ; 12 §3.7 ; VERIF_06 V6-17 ; écrans 10b : A09, S12.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — export ZIP (photos, contrat, messages, journal) sans PDF mis en page, généré à la demande par l'ops.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : horodatage qualifié tiers.

#### Fiche TRP-056 — Évaluation du risque PWA sur iOS
- **FEATURE ID** : TRP-056
- **Nom** : Évaluation du risque PWA sur iOS (caméra, hors ligne) et repli
- **Module** : Opérations de trip (TRP — Check-in / check-out)
- **Persona** : équipe ; PER-08 ; PER-01, PER-02
- **Objectif** : décider la technique de capture avant de construire la preuve.
- **Description** : test de 1 à 2 semaines (lot 0) sur des iPhone et Android représentatifs des hôtes et des voyageurs des deux pays : capture caméra sans import de galerie, persistance du stockage hors ligne (purge iOS possible), envoi différé, géolocalisation, poids des photos. PWA décidée (17 ADR-039) ; décision écrite du **repli** à la fin du lot 0 (ADR-005, 22) : PWA seule, ou enveloppe native (Capacitor ou équivalent, publication sur les stores, revue Apple). Les hôtes et les voyageurs utilisent leur propre téléphone : aucun terminal fourni.
- **Déclencheur** : lot 0.
- **Prérequis** : grille d'appareils courants dans les deux pays.
- **Parcours principal** : grille de tests par appareil → résultats → décision consignée.
- **Parcours alternatifs** : résultats mitigés → combinaison (enveloppe native pour l'espace hôte, PWA pour le voyageur).
- **Règles métier** : BR-PICKUP-01 (Turo impose l'app native, DOCUMENTÉ), BR-PICKUP-03.
- **États** : decision `OPEN` → `DECIDED`.
- **Erreurs** : —
- **Données** : grille de résultats (document), decision_log.
- **Notifications** : —
- **Permissions** : équipe produit.
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given la grille, When elle est complétée, Then chaque appareil a un résultat pour chaque critère. Given aucune décision, When le lot 3 démarre, Then TRP-002 et TRP-004 ne démarrent pas.
- **Source** : VERIF_10 V10-12 ; écrans 10b : A03, A04, S09.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : OUI.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : —

#### Fiche TRP-057 — Mode hors ligne du check-in / check-out
- **FEATURE ID** : TRP-057
- **Nom** : Mode hors ligne du check-in / check-out
- **Module** : Opérations de trip (TRP — Check-in / check-out)
- **Persona** : PER-08 ; PER-01, PER-02
- **Objectif** : faire une remise ou un retour sans réseau, sans perdre la preuve.
- **Description** : photos et saisies stockées sur l'appareil et envoyées au retour du réseau ; horodatages appareil et serveur, écart > 2 h signalé ; file d'envoi visible ; reprise après fermeture de l'app ; technique selon TRP-056.
- **Déclencheur** : perte de réseau pendant le parcours, au lieu de remise ou de retour.
- **Prérequis** : TRP-002 ; TRP-056.
- **Parcours principal** : capture locale + empreinte sur l'appareil → reconnexion → envoi → comparaison des empreintes.
- **Parcours alternatifs** : empreintes différentes → photo marquée « intégrité non vérifiée » ; écart > 2 h → signal ops.
- **Règles métier** : BR-PICKUP-03, BR-RETURN-01.
- **États** : élément de la file locale `OfflineQueue` (port de 17, ADR-005) `PENDING` → `SENT` → `VERIFIED` / `MISMATCH` ; empreinte `file_asset.sha256` recalculée à la réception.
- **Erreurs** : `OFFLINE_STORAGE_UNAVAILABLE`, `PHOTO_HASH_MISMATCH`.
- **Données** : `file_asset`(device_sha256, device_captured_at, server_received_at, clock_skew_flag).
- **Notifications** : `EVT_OFFLINE_SKEW` (ops).
- **Permissions** : comme TRP-004.
- **Dépendances** : TRP-002 ; TRP-056.
- **Critères d'acceptation** : Given un check-out sans réseau, When l'appareil se reconnecte, Then toutes les photos sont reçues avec un SHA-256 identique à celui calculé sur l'appareil. Given un écart d'horloge de 3 h, When la photo est reçue, Then elle est signalée.
- **Source** : VERIF_07 F11 ; VERIF_10 V10-12 ; écrans 10b : A03, A04, S09.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — pas de mode hors ligne : remise et retour exigent le réseau mobile ; l'hôte choisit un lieu couvert (conseil affiché dans A11) ; sans réseau, le support reporte la remise vers un point couvert.
- **Complexité** : élevée ; ops faible ; risque moyen.
- **Améliorations possibles** : données critiques hors ligne pour le voyageur (15 IMP-35).

## E9 — Annulations, protections du voyageur et plans de gains de l'hôte (assureur partenaire) (P0-A, 14 lignes)

#### Fiche BKG-028 — Annulation par le guest en libre-service
- **FEATURE ID** : BKG-028
- **Nom** : Annulation par le guest en libre-service
- **Module** : Réservation & contrat (BKG — Annulation)
- **Persona** : PER-01, PER-02
- **Objectif** : annuler et connaître immédiatement le montant remboursé.
- **Description** : Mes voyages → Annuler ; écran de prévisualisation du règlement (montant remboursé TTC, dont taxes, délai d'émission) calculé par `computeCancellationSettlement` (BR-CXL, paramètres ADM-031) ; confirmation → exécution par Kmino, par le PSP, **jambe par jambe** (PAY-021, 08 E7 : variation signée de `HOST`, `INSURER`, `TAX_THIRD_PARTY`, `PLATFORM`, jamais de prorata). La part retenue de l'hôte reste sur la jambe `HOST` ; la protection non consommée est remboursée et la jambe `INSURER` débitée (TJ02). Absorbe BKG-029.
- **Déclencheur** : demande du guest.
- **Prérequis** : BKG-027, PAY-021.
- **Parcours principal** : prévisualisation → confirmation → `CANCELLED_BY_GUEST` → règlement versionné → instances de remboursement SM-8 planifiées par jambe.
- **Parcours alternatifs** : après `noShowAt` → requalifiée no-show (T25) ; tarif non remboursable : P1 ; exceptions (BR-CXL-09, BR-CXL-10) → via support ; jambe `HOST` déjà libérée → règle 3 bis de 08 E7 (avance de Kmino, créance au `host_ledger`).
- **Règles métier** : BR-CXL-00, BR-CXL-01, BR-CXL-03, BR-CXL-06, BR-CXL-08, BR-CXL-09, BR-CXL-10 ; 08 E7 règles 3 et 10.
- **États** : SM-1 `BOOKED` / `CHECKIN_OPEN` → `CANCELLED_BY_GUEST` (ou `NO_SHOW_GUEST` si requalifiée) ; SM-8.
- **Erreurs** : `CANCEL_NOT_ALLOWED_IN_PROGRESS`, `LEG_ALREADY_RELEASED` (traité par la règle 3 bis, jamais affiché au guest).
- **Données** : settlement(trip_id, version, reason, qualification, refund_minor, tax_refund_minor, retained_minor, penalty_minor, computed_at) ; `settlement_leg` (variation par jambe) ; `refund_instance`.
- **Notifications** : `EVT_BOOKING_CANCELLED` (guest, hôte), `EVT_REFUND_PLANNED`.
- **Permissions** : `GUEST` du trip (`trip.cancel_own`).
- **Dépendances** : BKG-027 ; PAY-021.
- **Critères d'acceptation** : Given le trip A annulé par le guest à T − 10 h (T03), When le règlement est calculé, Then le remboursement vaut 187,44 et la variation par jambe vaut `HOST` −86,25, `INSURER` −25,50, `TAX_THIRD_PARTY` 0,00, `PLATFORM` −75,69 (TJ02b). Given T02 (exactement T − 24 h), When le guest annule, Then remboursement intégral (borne incluse). Given T23 et T24, When la réservation est de dernière minute, Then `freeUntil = min(bookedAt + 60 min, start)`. Given T25, When l'annulation arrive à T + 75 min, Then requalification en no-show.
- **Source** : SRC_G 4.1.1–4.1.4 ; 08 E7 ; écrans 10b : S09, S10.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — annulation demandée au support et déclenchée par l'ops (ADM-006) avant l'écran S10 du lot 5 ; montant et jambes calculés par le moteur de règlement, jamais saisis par l'ops ; remboursement exécuté par Kmino via le PSP (PAY-021).
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : crédit de rebooking (P1).

#### Fiche BKG-032 — Annulation par l'hôte avec motif et pénalités
- **FEATURE ID** : BKG-032
- **Nom** : Annulation par l'hôte avec motif et pénalités
- **Module** : Réservation & contrat (BKG — Annulation)
- **Persona** : PER-08 (hôte particulier) ; PER-05 (support, relogement)
- **Objectif** : rembourser intégralement le voyageur et dissuader les annulations de l'hôte.
- **Description** : motif obligatoire ; voyageur remboursé **intégralement** par Kmino, jambe par jambe (motif FULL : variation négative de toutes les jambes, TJ06), sans attendre l'hôte, et aidé à rebooker par le support. Pénalité de l'hôte selon BR-CXL-13 (`host_penalty` par palier et par devise, valeurs ADM-031 **À DÉCIDER** ; valeurs de test 25 / 50 / 150 = référence Turo) : elle n'est **pas une jambe** ; elle est **retenue sur ses gains** par ajustement de versement au `host_ledger` (08 E7 règle 7, capacité `SUPPORTS_PAYOUT_ADJUSTMENT`). Motif « à cause du guest » avec preuve validée → no-show guest (T07) ; sans preuve → annulation de l'hôte (T08). Avis automatique d'annulation publié sur l'annonce dès la bêta (BR-REVIEW-06, 10b v3 §4.1 bis) ; recul en recherche et seuils de performance : P1 (BR-HP-03). L'éventuelle indemnisation de l'hôte par la plateforme reste ouverte (**DEC-FONDATEUR-01**, `platform_funded_host_compensation` absent = `false`, T61).
- **Déclencheur** : action de l'hôte dans l'espace hôte (A05 « Cancelar reserva »).
- **Prérequis** : BKG-028, ADM-031, PAY-021.
- **Parcours principal** : (10b v3 §4.1 bis) A05 → détail du trip → `web.a05.cancel` « Cancelar reserva » → motif obligatoire (liste fermée + texte) → avertissement `web.a05.cancelWarning` (remboursement intégral du voyageur, pénalité calculée par BR-CXL-13 et retenue sur les prochains gains, calendrier bloqué sur ces dates ; montant jamais écrit en dur) → confirmation explicite → `CANCELLED_BY_HOST` → remboursement intégral par jambe par Kmino → ligne de pénalité au `host_ledger`, avis automatique d'annulation sur l'annonce (BR-REVIEW-06) ; côté voyageur : notification immédiate et proposition de voitures proches. Trip déjà commencé : action indisponible, renvoi vers l'ops.
- **Parcours alternatifs** : exemption (BR-CXL-13, portée OQ-BR-37) → décision ops avant le débit ; no-show de l'hôte (absent 30 min après le début, T26) → `NO_SHOW_HOST`, pénalité 150 (valeur de test) ; gains futurs insuffisants → solde négatif du `host_ledger` (SM-6b) et `EVT_HOST_BALANCE_NEGATIVE`.
- **Règles métier** : BR-CXL-12, BR-CXL-13, BR-HP-03, BR-TRUST-09 ; 08 E7 règle 7.
- **États** : SM-1 → `CANCELLED_BY_HOST` / `NO_SHOW_GUEST` / `NO_SHOW_HOST` ; SM-6b.
- **Erreurs** : `CANCEL_REASON_REQUIRED`.
- **Données** : settlement (reason `HOST_CANCELLED`, `penalty_minor`) ; `settlement_leg` ; `host_ledger_state` + `journal_line` (débit de l'hôte, crédit `platform_penalty_revenue`).
- **Notifications** : `EVT_BOOKING_CANCELLED_BY_HOST` (guest, support), `EVT_HOST_BALANCE_NEGATIVE` si le solde devient négatif.
- **Permissions** : `P2P_HOST` (`trip.cancel_as_host`) ; `CO_HOST` limité à sa portée (P1) ; `OPS_AGENT` (exemption).
- **Dépendances** : BKG-028 ; ADM-031 ; PAY-021.
- **Critères d'acceptation** : Given le trip A, When l'hôte annule à T − 30 h (T14), Then le guest est remboursé de 256,66, les jambes varient de −131,25 / −25,50 / 0,00 / −99,91 (TJ06) et la pénalité de 25 est portée au `host_ledger`, pas sur une jambe. Given l'annulation à exactement T − 24 h (T15), When la pénalité est calculée, Then palier « ≤ 24 h » (50). Given T62, When la pénalité est stockée, Then elle l'est en unités mineures de la devise du pays (2 500 = 25,00 USD avec les valeurs de test). Given T07 et T08, When le motif « à cause du guest » est utilisé, Then la qualification dépend de la preuve validée.
- **Source** : SRC_G 4.2.5 ; SRC_H §6 ; 08 BR-TRUST-09 ; écrans 10b : A05.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — l'hôte demande l'annulation au support et l'ops la déclenche (ADM-006) ; remboursement intégral et pénalité calculés par le moteur ; pénalité portée au `host_ledger` et retenue sur les versements suivants.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : seuils de performance de l'hôte et recul en recherche (BR-HP-03, P1).

#### Fiche BKG-035 — Annulation par la plateforme
- **FEATURE ID** : BKG-035
- **Nom** : Annulation par la plateforme
- **Module** : Réservation & contrat (BKG — Annulation)
- **Persona** : PER-07
- **Objectif** : annuler pour sécurité, conformité ou défaillance, en disant qui paie.
- **Description** : motifs : T&S, rappel de sécurité, fermeture du compte de l'hôte, contrôle de remise incomplet, retard de revue, panne PSP ; par l'ops via ADM-006, motif obligatoire. Guest remboursé intégralement par Kmino, **jambe par jambe** (PAY-021), sauf `PLATFORM_INCOMPLETE_STEPS` imputable au guest (partiel, T16). Coût : l'hôte si la cause lui est imputable (pénalité ADM-031 au `host_ledger`), sinon geste commercial plafonné (ADM-007 ; plafond 0 tant que DEC-FONDATEUR-01 est ouverte, TA09). **Indemnisation de l'hôte par la plateforme : DEC-FONDATEUR-01 OUVERTE** — `platform_funded_host_compensation` absent = `false`. Remboursement Yappy : rail du PSP de place de marché si `SUPPORTS_YAPPY_IN_MARKETPLACE`, sinon rail de BR-PAY-08 (crédit cash fermé tant que `funds_holding_enabled[pays]` = `false`).
- **Déclencheur** : décision ops ; `FAILED` de SM-1b à T − 2 h.
- **Prérequis** : ADM-006, PAY-021, ADM-007, ADM-031.
- **Parcours principal** : motif → qualification → règlement → remboursement par jambe → imputation du coût (`cost_bearer`).
- **Parcours alternatifs** : compte de l'hôte fermé (T22) → remboursement intégral, aucun gain pour l'hôte ; sanction non prouvée → motif `RISK_SUSPENSION_UNPROVEN`.
- **Règles métier** : BR-CXL-07, BR-CXL-14, BR-LIST-06, BR-TRUST-05, BR-PAY-08.
- **États** : SM-1 → `CANCELLED_BY_PLATFORM` ; SM-1b `FAILED` ; SM-8.
- **Erreurs** : `CANCEL_REASON_REQUIRED`, `COST_BEARER_REQUIRED`.
- **Données** : settlement(reason, cost_bearer, platform_funded_host_compensation_flag_value) ; `settlement_leg` ; `refund_instance`.
- **Notifications** : `EVT_BOOKING_CANCELLED_BY_PLATFORM` (guest, hôte).
- **Permissions** : `OPS_AGENT` (motif, coût), `ADMIN`.
- **Dépendances** : ADM-006 ; PAY-021 ; ADM-007 ; ADM-031.
- **Critères d'acceptation** : Given T61(a) (paramètre absent), When `PLATFORM_REVIEW_DELAY` survient à T − 2 h, Then la compensation de l'hôte vaut 0,00. Given le paramètre `true` explicite (option A, non décidée), When T17, T18 et T20 sont rejoués, Then 45,00 / 45,00 / 75,00 (configuration de test), test désactivé tant que DEC-FONDATEUR-01 n'est pas tranchée. Given T16, When `PLATFORM_INCOMPLETE_STEPS` est imputable au guest, Then remboursement partiel de 187,44. Given T19 et T22, When l'annulation T&S a lieu à T − 30 h ou le compte de l'hôte est fermé, Then aucun gain pour l'hôte. Given chaque annulation plateforme, When elle est enregistrée, Then `cost_bearer` est renseigné et chaque instance de remboursement porte ses montants par jambe.
- **Source** : 08 BR-CXL-14 ; écrans 10b : S09, O01.
- **Confiance** : documenté (base) ; imputation du coût proposée.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — annulation plateforme par l'ops (ADM-006) ; remboursement calculé par le moteur, exécuté par Kmino via le PSP, jambe par jambe, et suivi par l'ops.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : relogement automatique.

#### Fiche PRT-001 / PRT-002 / BKG-003 / PRC-018 — Protections du voyageur : niveaux, éligibilité, choix au checkout et prix
- **FEATURE ID** : PRT-001, PRT-002, BKG-003, PRC-018
- **Nom** : Plans de protection du voyageur à 3 niveaux sans refus total (PRT-001) ; éligibilité des plans (PRT-002) ; choix du plan au checkout (BKG-003) ; prix des protections en % du prix journalier net (PRC-018)
- **Module** : Sinistres & protection (PRT — Protections guest) ; Réservation & contrat (BKG — Checkout) ; Tarification & devis (PRC — Protections)
- **Persona** : PER-01, PER-02 ; PER-07 (paramétrage avec l'assureur)
- **Objectif** : vendre au voyageur, pour le compte de l'assureur partenaire, une protection adaptée et toujours présente, au prix juste.
- **Description** : PRT-001 : 3 niveaux vendus par Kmino pour l'assureur partenaire (produit d'assurance distribué par un courtier agréé, hypothèse de BR-PROT-01, OQ-P2P-03) : **Básica** obligatoire (RC + franchise élevée), **Estándar**, **Total** ; **pas de refus total** (OQ-P2P-12, écart assumé avec Turo, adaptation LATAM de BR-PROT-02). PRT-002 : éligibilité par âge du conducteur et valeur du véhicule (référence Turo : plan sans reste à charge interdit aux moins de 21 ans et indisponible au-delà de 60 000 $ ; seuils par pays et par niveau `{param}`, fixés avec l'assureur). BKG-003 : niveaux affichés après saisie de l'âge, **Básica présélectionnée**, choix modifiable jusqu'au paiement. PRC-018 : prix = `% × prix journalier net` par niveau (référence Turo 65 / 40 / 25 %, BR-PRICE-11), avec plancher et plafond par jour, grille par pays fixée avec l'assureur ; la **prime due** = `roundHalfUp(protection × insurerPremiumShareFrozen)` va à la jambe `INSURER`, le reste (marge de distribution) à la jambe `PLATFORM` (08 BR-PRICE-11, E7, TJ01). Aucune vente sans contrat d'assureur actif dans le pays (`insurer_contract_active[pays]`).
- **Déclencheur** : checkout (S05) ; fiche du véhicule (S03, résumé).
- **Prérequis** : contrat de l'assureur (`insurer_contract`) et grille par pays (ADM-014) ; BKG-001.
- **Parcours principal** : saisie de l'âge → niveaux éligibles affichés avec prix par jour et reste à charge → Básica présélectionnée → choix → devis versionné (PRC-025) avec `insurerPremiumShareFrozen` figé → paiement par jambes (PAY-006).
- **Parcours alternatifs** : niveau inéligible (âge, valeur) → grisé avec la raison ; pays sans contrat actif → aucune réservation possible (`INSURER_CONTRACT_INACTIVE`) ; protection minimale relevée par le risque → PRT-011.
- **Règles métier** : BR-PROT-01, BR-PROT-02, BR-PROT-03, BR-PRICE-11, BR-ACC-04 ; 08 E7.
- **États** : devis `protection_level` figé à la réservation ; aucun changement après `BOOKED` (P1).
- **Erreurs** : `INSURER_CONTRACT_INACTIVE`, `PROTECTION_LEVEL_NOT_ELIGIBLE`, `PROTECTION_LEVEL_REQUIRED` (noms PROPOSÉS sauf le premier).
- **Données** : `insurer`, `insurer_contract` (pays, grille, `insurer_premium_share[niveau]`, période) ; quote_line(kind `PROTECTION`, level, amount_minor, insurerPremiumShareFrozen) ; `payment_operation_leg` (`INSURER`).
- **Notifications** : — (récapitulatif dans `EVT_BOOKING_CONFIRMED`).
- **Permissions** : `GUEST` (choix) ; `ADMIN` (grille, sur contrat signé).
- **Dépendances** : PRT-002, BKG-003, PRC-018 → PRT-001.
- **Critères d'acceptation** : Given le trip A avec protection 30,00 et `insurerPremiumShareFrozen` = 7/10 (valeur de test), When le paiement est capturé, Then la jambe `INSURER` reçoit 21,00 de prime plus 4,50 d'assistance, soit 25,50 (TJ01). Given un conducteur de 20 ans, When les niveaux s'affichent, Then le niveau Total est grisé et Básica reste présélectionnée. Given un voyageur qui tente de retirer toute protection, When il valide le checkout, Then `PROTECTION_LEVEL_REQUIRED` et aucun paiement. Given un pays où `insurer_contract_active` vaut `false` ou est absent, When un checkout est ouvert, Then `INSURER_CONTRACT_INACTIVE`. Given un prix journalier net de 38,76 et un taux de test de 40 %, When le prix est calculé, Then 15,50 par jour (BR-PRICE-11).
- **Source** : 10 §1 ; SRC_G 3.2–3.5, 3.13 ; 05 G-CHECKOUT ; écrans 10b : S03, S05.
- **Confiance** : confirmé (PRT-001, BKG-003 et PRC-018 OBSERVÉ chez Turo) ; documenté (PRT-002) ; niveaux et absence de refus proposés.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : PRT-001 SIMPLIFIÉ — 3 niveaux fixes par pays, grille saisie par l'ops depuis le contrat signé ; PRT-002 OUI ; BKG-003 SIMPLIFIÉ — Básica présélectionnée, choix parmi les niveaux éligibles, sans comparateur détaillé ; PRC-018 OUI.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : prix par profil de risque ; changement de niveau après réservation (P1).

#### Fiche PRT-003 / PRT-013 — RC tiers incluse et mentions de l'assureur
- **FEATURE ID** : PRT-003, PRT-013
- **Nom** : RC tiers incluse dans chaque trip (PRT-003) ; mentions de l'assureur et licences (PRT-013)
- **Module** : Sinistres & protection (PRT — Responsabilité civile, Légal)
- **Persona** : PER-01, PER-02, PER-08
- **Objectif** : garantir et afficher une RC conforme (Ley 68/2016 au minimum au Panama, équivalent au Paraguay).
- **Description** : PRT-003 : RC tiers incluse dans chaque trip par la protection de l'assureur partenaire, quel que soit le niveau choisi (Básica comprise, OQ-P2P-12) ; RC **primaire** proposée (BR-PROT-04, montant ≥ 100 000 USD `{param}`, OQ-BR-16) ; montant affiché sur la fiche et au contrat ; prime dans la jambe `INSURER`. PRT-013 : assureur et courtier cités, « Información legal », mentions de licences dans les pages statiques (LEG-011).
- **Déclencheur** : affichage de la fiche, du checkout, du contrat et des pages légales.
- **Prérequis** : PRT-001 ; LEG-011 ; `insurer_contract` actif.
- **Parcours principal** : montant de RC lu dans `insurer_contract` → affiché sur S03, S05 et au contrat (BKG-018) ; mentions publiées.
- **Parcours alternatifs** : contrat sous le minimum légal paramétré → contrat non activable ; contrat expiré → `insurer_contract_active[pays]` repasse à `false`, aucune nouvelle réservation.
- **Règles métier** : BR-PROT-01, BR-PROT-04.
- **États** : `insurer_contract` actif / expiré.
- **Erreurs** : `INSURER_CONTRACT_INACTIVE`, `INSURER_RC_BELOW_MINIMUM` (nom PROPOSÉ).
- **Données** : `insurer_contract.rc_amount_minor`, `insurer`.
- **Notifications** : —
- **Permissions** : `ADMIN` (saisie du contrat) ; `OPS_AGENT` (lecture).
- **Dépendances** : PRT-003 → PRT-001, PRT-013 ; PRT-013 → LEG-011.
- **Critères d'acceptation** : Given un contrat d'assureur avec une RC sous le minimum paramétré, When il est saisi, Then `INSURER_RC_BELOW_MINIMUM` et le contrat reste inactif. Given une fiche et le contrat du trip, When ils s'affichent, Then le montant de RC est identique et vient de `insurer_contract`. Given le niveau Básica, When le contrat est généré, Then la RC tiers y figure.
- **Source** : 10 §1, §5 ; SRC_G 3.8 ; écrans 10b : S03, S05.
- **Confiance** : confirmé (PRT-003 OBSERVÉ chez Turo) ; documenté (PRT-013).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : PRT-003 SIMPLIFIÉ — RC tiers de l'assureur partenaire, montant saisi par l'ops depuis le contrat signé et affiché tel quel ; PRT-013 SIMPLIFIÉ — mentions de l'assureur dans les pages statiques.
- **Complexité** : moyenne / faible ; ops moyen / faible ; risque élevé / moyen.
- **Améliorations possibles** : SLI optionnelle pour les voyageurs étrangers.

#### Fiche PRT-007 / PRT-008 / HST-048 — Plans de gains de l'hôte
- **FEATURE ID** : PRT-007, PRT-008, HST-048
- **Nom** : Plans de gains de l'hôte, part et franchise (PRT-007) ; plan par véhicule modifiable (PRT-008) ; choix du plan à l'onboarding (HST-048)
- **Module** : Sinistres & protection (PRT — Plans hôte) ; Espace hôte & annonces (HST — Onboarding)
- **Persona** : PER-08
- **Objectif** : fixer pour chaque véhicule la part de l'hôte et sa franchise, de façon lisible et figée par trip.
- **Description** : PRT-007 : plan **obligatoire par véhicule** (BR-PROT-06), grille de l'assureur partenaire par pays (part de l'hôte, franchise de l'hôte par sinistre) ; plan par défaut **`ESTÁNDAR` 75 %** (`host_default_plan` = `ESTÁNDAR`, OQ-P2P-11 ; Turo propose 70 % par défaut, écart assumé) ; la part figée à la réservation (`hostSharePctFrozen`) forme la jambe `HOST` (08 E7) ; aucune autre rémunération de la plateforme n'est prélevée sur l'hôte ; le plan `PRO` est sans objet. PRT-008 : modifiable à tout moment, **effet sur les nouveaux trips seulement**. HST-048 : le plan par défaut est attribué à l'onboarding (A10, A07) et expliqué (A01), modifiable ensuite (A11).
- **Déclencheur** : ajout d'un véhicule ; changement de plan par l'hôte.
- **Prérequis** : ADM-014 (grille par pays) ; contrat d'assureur (`insurer_contract`).
- **Parcours principal** : onboarding → plan `ESTÁNDAR` attribué et affiché (part, franchise) → l'hôte confirme ou change → chaque nouvelle réservation fige `hostSharePctFrozen`.
- **Parcours alternatifs** : changement de plan avec des trips à venir → les trips déjà réservés gardent leur part ; plan non proposé dans le pays → refus.
- **Règles métier** : BR-PROT-06, BR-PROT-07 (hors MVP, part figée dès le départ), BR-PROT-08.
- **États** : vehicle_earnings_plan(plan, valid_from) ; part figée par trip.
- **Erreurs** : `EARNINGS_PLAN_NOT_AVAILABLE` (nom PROPOSÉ).
- **Données** : vehicle.earnings_plan, plan_history(vehicle_id, plan, changed_at) ; booking.hostSharePctFrozen ; `settlement_leg` (`HOST`).
- **Notifications** : confirmation in-app du changement de plan.
- **Permissions** : `P2P_HOST` (`catalog.pricing_availability`) ; `ADMIN` (grille).
- **Dépendances** : PRT-007 → ADM-014 ; PRT-008, HST-048 → PRT-007.
- **Critères d'acceptation** : Given un nouveau véhicule sans choix de plan, When l'onboarding se termine, Then le plan vaut `ESTÁNDAR` et la part 75 %. Given le trip A réservé au plan `ESTÁNDAR`, When le paiement est capturé, Then la jambe `HOST` vaut 131,25 (TJ01). Given un trip réservé au plan `ESTÁNDAR` puis un changement de plan, When le trip est réglé, Then sa part reste 75 %. Given la liste des plans, When l'hôte l'ouvre, Then aucun plan `PRO` n'est proposé.
- **Source** : SRC_H H31–H35 ; 10 §3 ; 06 H-ACQ ; écrans 10b : A01, A07, A10, A11.
- **Confiance** : documenté ; part par défaut de 75 % proposée.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : PRT-007 SIMPLIFIÉ — un seul plan `ESTÁNDAR` actif par pays tant que l'assureur n'a pas tarifé d'autres plans, part et franchise lues dans la grille ; PRT-008 OUI ; HST-048 OUI.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : part variable selon l'anticipation (BR-PROT-07, P1) ; plans supplémentaires tarifés par l'assureur.

#### Fiche PRT-011 — Protection minimale imposée
- **FEATURE ID** : PRT-011
- **Nom** : Protection minimale imposée, refus interdit
- **Module** : Sinistres & protection (PRT — Règles)
- **Persona** : PER-01, PER-02 ; PER-07
- **Objectif** : garantir qu'aucun trip ne part sans protection et relever le minimum selon le risque.
- **Description** : niveau minimal par pays `guest_protection_min_level` = `BASICA` (OQ-P2P-12) ; aucun trip sans protection ; la plateforme peut relever le minimum (par exemple Estándar) selon le risque du voyageur ou du trip (BR-VERIF-09) ; en bêta, minimum fixe.
- **Déclencheur** : checkout.
- **Prérequis** : PRT-001.
- **Parcours principal** : lecture du minimum du pays → niveaux inférieurs masqués → choix au-dessus du minimum.
- **Parcours alternatifs** : paramètre absent → `BASICA` (fail-closed) ; minimum relevé par une règle de risque (P1) → niveaux inférieurs grisés avec explication.
- **Règles métier** : BR-PROT-01, BR-VERIF-09.
- **États** : —
- **Erreurs** : `PROTECTION_LEVEL_REQUIRED`.
- **Données** : param_value(`guest_protection_min_level`, pays) ; quote_line.protection_level.
- **Notifications** : —
- **Permissions** : `ADMIN` (paramètre) ; `SYSTEM`.
- **Dépendances** : PRT-001.
- **Critères d'acceptation** : Given `guest_protection_min_level` absent, When un checkout s'ouvre, Then le minimum appliqué est `BASICA`. Given un appel d'API sans niveau de protection, When la réservation est créée, Then `PROTECTION_LEVEL_REQUIRED`.
- **Source** : SRC_G 3.1 ; 08 BR-PROT-01 ; écrans 10b : S05.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI.
- **Complexité** : faible ; ops faible ; risque moyen.
- **Améliorations possibles** : minimum relevé automatiquement selon le score de risque (P1).

#### Fiche PRT-015 — Exclusions côté hôte et période couverte
- **FEATURE ID** : PRT-015
- **Nom** : Exclusions côté hôte et période couverte
- **Module** : Sinistres & protection (PRT — Plans hôte)
- **Persona** : PER-08 ; PER-07 (instruction des dossiers)
- **Objectif** : dire à l'hôte, avant tout sinistre, ce que couvre son plan et quand.
- **Description** : couverture de l'hôte = **période de réservation** (BR-PROT-09) ; exclusions de la grille de l'assureur (préexistant, usure, pannes mécaniques non causées par le guest, objets personnels, fausse information sur le véhicule) affichées dans l'espace hôte et dans les CGU de l'hôte ; à proposer à l’assureur : couvrir aussi les trajets de remise si l'assureur l'accepte ; utilisées par l'instruction des dossiers (CLM-006).
- **Déclencheur** : choix ou changement de plan ; ouverture d'un dossier de dommage.
- **Prérequis** : PRT-007.
- **Parcours principal** : affichage des exclusions avec le plan (A11) → reprise dans la décision du dossier (A09).
- **Parcours alternatifs** : dommage hors période ou exclu → dossier refusé avec la clause citée.
- **Règles métier** : BR-PROT-09, BR-PROT-03.
- **États** : —
- **Erreurs** : —
- **Données** : insurer_contract.exclusions (version) ; claim.coverage_decision.
- **Notifications** : —
- **Permissions** : `P2P_HOST` (lecture) ; `OPS_AGENT`.
- **Dépendances** : PRT-007.
- **Critères d'acceptation** : Given un dommage daté après la fin de la réservation, When le dossier est instruit, Then la décision cite la période couverte. Given un plan affiché, When on compare ses exclusions à celles du contrat de l'assureur, Then textes identiques et même version.
- **Source** : SRC_H H31, H27 ; écrans 10b : A09, A11.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : OUI.
- **Complexité** : faible ; ops moyen ; risque moyen.
- **Améliorations possibles** : couverture des trajets de livraison (P1-E9).

## E10 — Messagerie, notifications et avis réciproques (P0-A, 10 lignes)

#### Fiche MSG-001 / MSG-007 — Messagerie par trip et détection du marché gris
- **FEATURE ID** : MSG-001, MSG-007
- **Nom** : Messagerie hôte–voyageur par trip (MSG-001) ; détection du marché gris dans les messages (MSG-007)
- **Module** : Communication & réputation (MSG — Messagerie, Modération)
- **Persona** : PER-01, PER-02, PER-08, PER-05
- **Objectif** : organiser le rendez-vous de remise dans la plateforme et garder la trace ; empêcher les paiements hors plateforme.
- **Description** : MSG-001 (absorbe MSG-011) : fil par réservation, ouvert à la confirmation (BR-BOOK-02), indispensable au rendez-vous entre particuliers ; prénoms seulement ; consultable par le support ; partie du dossier de preuve et source de `hostMessageTraced` (BR-CXL-08). MSG-007 (absorbe MSG-004) : masquage des téléphones, emails et liens WhatsApp ; mots-clés (« efectivo », « por fuera ») → signal ops ; bandeau « paga solo en la plataforma ».
- **Déclencheur** : trip ≥ `BOOKED`.
- **Prérequis** : BKG-022.
- **Parcours principal** : message → filtres → stockage → notification du destinataire.
- **Parcours alternatifs** : coordonnées détectées → masquées avec avertissement ; récidive → restriction (ADM-005) ; après la fin du trip + `review_window_days` → fil en lecture seule.
- **Règles métier** : BR-BOOK-02, BR-TRUST-02, BR-TRUST-06.
- **États** : message `SENT` / `FLAGGED`.
- **Erreurs** : `MESSAGE_THREAD_CLOSED`.
- **Données** : message(trip_id, sender, body, masked_body, flags, at).
- **Notifications** : `EVT_NEW_MESSAGE`, `EVT_MESSAGE_FLAGGED` (ops).
- **Permissions** : participants du trip (`message.trip_thread`) ; `CO_HOST` limité à sa portée ; `SUPPORT_AGENT`, `OPS_AGENT` (lecture journalisée).
- **Dépendances** : MSG-001 → BKG-022 ; MSG-007 → MSG-001.
- **Critères d'acceptation** : Given « escríbeme al +507 6xxx-xxxx », When le message est envoyé, Then le numéro est masqué et le message signalé. Given un trip non réservé, When un visiteur tente d'écrire, Then refus. Given un hôte qui écrit au guest avant de déclarer un no-show, When le règlement est calculé, Then le message compte comme `hostMessageTraced`.
- **Source** : SRC_G 8.6 ; 05 G-INBOX-01 ; 08 BR-TRUST-02 reco ; 11 EC-40 ; écrans 10b : S16.
- **Confiance** : documenté (MSG-001) ; proposé (MSG-007).
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MSG-001 SIMPLIFIÉ — fil texte par trip ouvert à la confirmation, photo jointe en P1 ; MSG-007 SIMPLIFIÉ — masquage par expressions régulières et liste de mots-clés, relecture des signaux par le support.
- **Complexité** : moyenne ; ops faible / moyen ; risque faible / moyen.
- **Améliorations possibles** : questions avant réservation par relais masqué (15 IMP-08, P1).

#### Fiche NTF-001 — Moteur de notifications multicanal
- **FEATURE ID** : NTF-001
- **Nom** : Moteur de notifications multicanal
- **Module** : Communication & réputation (NTF — Moteur)
- **Persona** : technique ; tous
- **Objectif** : prévenir la bonne personne, sur le bon canal, une seule fois, en espagnol ou en anglais.
- **Description** : événements métier → table événement × destinataires × canaux × gabarit es/en. Catalogue de la bêta : compte vérifié / refusé, hôte activé, réservation confirmée / annulée, rappels J-1 et H-2 de la remise, H-2 du retour, retard détecté, check-in / check-out faits, réclamation ouverte / décidée, restriction, document du véhicule bientôt expiré, relevé des gains émis, versement envoyé ou retenu. Canaux : email, WhatsApp (NTF-002), repli SMS, in-app. Idempotence (événement, destinataire, canal), 3 réessais, journal. Absorbe NTF-016, NTF-018.
- **Déclencheur** : événement publié (17 §4.5).
- **Prérequis** : aucun.
- **Parcours principal** : événement → résolution des destinataires et de la langue → rendu → envoi → journal.
- **Parcours alternatifs** : échec → réessai ; WhatsApp indisponible → SMS ou email.
- **Règles métier** : BR-NOTIF (catalogue).
- **États** : notification `QUEUED` → `SENT` → `DELIVERED` / `FAILED`.
- **Erreurs** : `TEMPLATE_VARIABLE_MISSING` (bloque au build et aux tests).
- **Données** : notification(event_id, recipient, channel, template, locale, status, attempts).
- **Notifications** : (le moteur lui-même).
- **Permissions** : `SYSTEM` ; `ADMIN` (gabarits).
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given chaque événement du catalogue, When son gabarit est testé en es et en, Then aucune variable non résolue. Given un événement rejoué, When il est reçu, Then aucun doublon par destinataire et canal.
- **Source** : 08 BR-NOTIF ; SRC_G 10.9 ; écrans 10b : — (traitement serveur).
- **Confiance** : documenté (catalogue Turo) ; architecture proposée.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ — email et SMS ; catalogue réduit (compte vérifié, confirmation, annulation, rappel J-1, retard, versement envoyé ou retenu).
- **Complexité** : élevée ; ops faible ; risque faible.
- **Améliorations possibles** : push in-app (P1).

#### Fiche NTF-002 — Gabarits WhatsApp Business approuvés
- **FEATURE ID** : NTF-002
- **Nom** : Gabarits WhatsApp Business approuvés
- **Module** : Communication & réputation (NTF — Canal)
- **Persona** : tous
- **Objectif** : utiliser le canal principal du Panama et du Paraguay (15 IMP-06).
- **Description** : gabarits validés par Meta ; tant qu'ils ne sont pas approuvés ou en cas d'échec : SMS (OTP, rappels, retards) et email (confirmations, contrat, constancia, relevés). L'ouverture ne dépend pas de l'approbation Meta. Consentement aux messages transactionnels (LEG-002).
- **Déclencheur** : envoi NTF-001 sur le canal WhatsApp.
- **Prérequis** : NTF-001 ; compte WhatsApp Business et BSP.
- **Parcours principal** : gabarit approuvé → envoi → accusé.
- **Parcours alternatifs** : non approuvé ou échec → repli automatique vers SMS ou email.
- **Règles métier** : BR-NOTIF.
- **États** : template `SUBMITTED` → `APPROVED` / `REJECTED`.
- **Erreurs** : `WHATSAPP_TEMPLATE_NOT_APPROVED` (repli, non bloquant).
- **Données** : wa_template(name, locale, status, fallback_channel).
- **Notifications** : —
- **Permissions** : `ADMIN`.
- **Dépendances** : NTF-001.
- **Critères d'acceptation** : Given chaque gabarit WhatsApp, When il est créé, Then un équivalent SMS ou email testé existe. Given un échec de livraison, When il est remonté, Then l'envoi passe automatiquement au canal de repli.
- **Source** : 08 BR-NOTIF reco ; 15 IMP-06 ; écrans 10b : S05.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : DIFFÉRÉ — délai d'approbation Meta ; repli SMS et email.
- **Complexité** : moyenne ; ops moyen ; risque faible.
- **Améliorations possibles** : support WhatsApp-first (15 IMP-07).

#### Fiche NTF-007 / NTF-011 — Confirmation de réservation et notifications de trip
- **FEATURE ID** : NTF-007, NTF-011
- **Nom** : Notification de réservation confirmée (NTF-007) ; notifications de trip (NTF-011)
- **Module** : Communication & réputation (NTF — Réservation, Trip)
- **Persona** : PER-01, PER-02, PER-08
- **Objectif** : préparer le rendez-vous de remise ; réduire retards, absences et plaintes.
- **Description** : NTF-007 : à `BOOKED` — voyageur : WhatsApp + email avec récapitulatif, contrat et constancia (LEG-026), **adresse exacte du lieu de remise**, heure du rendez-vous, prénom de l'hôte, pièces à présenter (permis physique), caution autorisée (PAY-011), conseils de sécurité pour une rencontre entre particuliers ; hôte : notification et espace hôte (prénom, note et statut de vérification du voyageur, créneau, statut du paiement ; jamais le numéro de permis). NTF-011 : check-in ouvert, rappels de remise (J-1, H-2), rappel de fin (H-2).
- **Déclencheur** : transitions SM-1 ; horloge.
- **Prérequis** : NTF-001, TRP-045, LEG-026, PAY-011 ; TRP-002 (NTF-011).
- **Parcours principal** : événement → NTF-001.
- **Parcours alternatifs** : trip annulé avant un rappel → rappel supprimé.
- **Règles métier** : BR-BOOK-01, BR-PICKUP-01, BR-PICKUP-09, BR-NOTIF.
- **États** : SM-1.
- **Erreurs** : —
- **Données** : —
- **Notifications** : `EVT_BOOKING_CONFIRMED`, `EVT_CHECKIN_OPEN`, `EVT_PICKUP_REMINDER`, `EVT_RETURN_REMINDER`.
- **Permissions** : `SYSTEM`.
- **Dépendances** : NTF-007 → NTF-001, TRP-045, LEG-026, PAY-011 ; NTF-011 → NTF-001, TRP-002.
- **Critères d'acceptation** : Given un passage à `BOOKED`, When 1 min s'écoule, Then la confirmation est envoyée (M5) avec contrat, constancia et adresse exacte du lieu de remise, sans doublon si l'événement est rejoué. Given un trip annulé, When l'heure du rappel arrive, Then aucun rappel. Given la notification envoyée à l'hôte, When on inspecte son contenu, Then elle ne contient ni numéro de permis ni image de pièce.
- **Source** : 08 BR-NOTIF (NOTIF-02, NOTIF-11, NOTIF-12, NOTIF-13) ; écrans 10b : S07, A02.
- **Confiance** : inféré (canal, NTF-007) ; documenté (NTF-011).
- **Priorité produit** : P0-A (lots 2 et 3 : lot 2 pour NTF-007, lot 3 pour NTF-011)
- **Bêta pilote** : NTF-007 OUI ; NTF-011 DIFFÉRÉ — rappel de fin inclus dans le catalogue réduit de NTF-001.
- **Complexité** : faible ; ops faible ; risque faible.
- **Améliorations possibles** : suivi de vol pour les remises près de l'aéroport (P1).

#### Fiche REV-001 / REV-010 — Avis du voyageur et agrégats
- **FEATURE ID** : REV-001, REV-010
- **Nom** : Avis du voyageur sur le trip avec sous-notes (REV-001) ; note moyenne et nombre de trips (REV-010)
- **Module** : Communication & réputation (REV — Avis, Agrégats)
- **Persona** : PER-01, PER-02 ; PER-08 ; visiteurs
- **Objectif** : signal de qualité pour les voyageurs et retour pour l'hôte.
- **Description** : REV-001 (absorbe REV-003) : note 1–5 + propreté, communication, praticité, exactitude de l'annonce, entretien (BR-REVIEW-03) ; texte ≥ 25 caractères dès 3★ et moins (BR-REVIEW-04) ; fenêtre de **10 jours** après la fin (`review_window_days` = 10, BR-REVIEW-01) ; publication en double aveugle (REV-004). REV-010 : moyenne par véhicule et par hôte, affichée en recherche, sur la fiche et sur le profil public de l'hôte ; trip non noté exclu ; badge « Nuevo » sans avis.
- **Déclencheur** : `COMPLETED` → invitation.
- **Prérequis** : BKG-027.
- **Parcours principal** : invitation → notes → attente de publication (REV-004) → publication → recalcul des agrégats.
- **Parcours alternatifs** : avis abusif → retrait par l'ops (BR-REVIEW-07) ; fenêtre close → plus d'avis.
- **Règles métier** : BR-REVIEW-01, BR-REVIEW-03, BR-REVIEW-04, BR-REVIEW-05, BR-REVIEW-07.
- **États** : review `INVITED` → `SUBMITTED` → `PUBLISHED` / `EXPIRED` / `REMOVED`.
- **Erreurs** : `REVIEW_WINDOW_CLOSED`, `REVIEW_TEXT_REQUIRED`.
- **Données** : review(trip_id, author_role, overall, sub_scores, text, submitted_at, published_at), aggregates.
- **Notifications** : `EVT_REVIEW_INVITATION`, `EVT_REVIEW_PUBLISHED`.
- **Permissions** : `GUEST` du trip ; `OPS_AGENT` (modération).
- **Dépendances** : REV-001 → BKG-027 ; REV-010 → REV-001.
- **Critères d'acceptation** : Given 3 avis publiés (5, 4, 3) et 2 trips non notés, When l'agrégat est calculé, Then moyenne 4,0 et 5 trips. Given une note de 3★ sans texte, When le voyageur valide, Then `REVIEW_TEXT_REQUIRED`. Given J+10 après la fin, When le voyageur ouvre le formulaire, Then `REVIEW_WINDOW_CLOSED`.
- **Source** : SRC_G 8.1 ; 05 G-SEARCH-03, G-LISTING-02 ; écrans 10b : S02, S03, S13, A13.
- **Confiance** : documenté (REV-001) ; confirmé (REV-010 OBSERVÉ chez Turo).
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : REV-001 SIMPLIFIÉ — formulaire de notes et texte dans S13, publication en double aveugle avec REV-004 au lot 3 ; REV-010 SIMPLIFIÉ — nombre de trips et moyenne globale seulement, badge « Nuevo ».
- **Complexité** : moyenne / faible ; ops faible ; risque faible.
- **Améliorations possibles** : moyennes par sous-note, tri par note (P1).

#### Fiche REV-002 / REV-004 — Avis de l'hôte sur le voyageur et publication en double aveugle
- **FEATURE ID** : REV-002, REV-004
- **Nom** : Avis de l'hôte sur le voyageur (REV-002) ; publication en double aveugle (REV-004)
- **Module** : Communication & réputation (REV — Avis réciproques)
- **Persona** : PER-08 ; PER-01, PER-02
- **Objectif** : donner aux hôtes un signal fiable sur les voyageurs sans représailles (EC-42).
- **Description** : REV-002 : l'hôte note le voyageur (note globale, sous-notes ponctualité, état de restitution, communication, respect des règles ; BR-REVIEW-03) ; texte ≥ 25 caractères dès 3★ et moins (BR-REVIEW-04) ; notation facultative. REV-004 : fenêtre de **10 jours** pour les deux (`review_window_days` = 10, OQ-P2P-06) ; aucun des deux ne voit l'avis de l'autre avant la publication ; publication **quand les deux ont noté ou à J+10**, au premier des deux termes (BR-REVIEW-02) ; ni modification ni prolongation. Les avis de l'hôte sont **publics** sur le profil du voyageur et consultables par lui (droit d'accès, Ley 81). Une note ≤ 3★ de l'hôte empêche le voyageur de réserver de nouveau chez cet hôte (BR-REVIEW-05).
- **Déclencheur** : `COMPLETED` → invitation des deux parties.
- **Prérequis** : REV-001.
- **Parcours principal** : invitations → chacun note (A12 pour l'hôte, S13 pour le voyageur) → avis tenus en `SUBMITTED` → publication simultanée au premier terme → agrégats et blocage éventuel.
- **Parcours alternatifs** : une seule partie note → publication de son avis à J+10 ; aucune → rien ; avis contenant des données personnelles → masqué avant publication et signalé (BR-REVIEW-07).
- **Règles métier** : BR-REVIEW-01, BR-REVIEW-02, BR-REVIEW-03, BR-REVIEW-04, BR-REVIEW-05, BR-REVIEW-07.
- **États** : review `INVITED` → `SUBMITTED` → `PUBLISHED` / `EXPIRED` / `REMOVED`.
- **Erreurs** : `REVIEW_WINDOW_CLOSED`, `REVIEW_TEXT_REQUIRED`, `REVIEW_ALREADY_SUBMITTED`.
- **Données** : review(trip_id, author_role `HOST` / `GUEST`, overall, sub_scores, text, submitted_at, published_at) ; scheduled_job (publication à J+10) ; host_guest_block(host_org_id, guest_user_id).
- **Notifications** : `EVT_REVIEW_INVITATION`, `EVT_REVIEW_PUBLISHED`.
- **Permissions** : `P2P_HOST` (avis sur ses trips) ; `GUEST` (lecture des avis reçus) ; `OPS_AGENT` (modération).
- **Dépendances** : REV-002 → REV-001 ; REV-004 → REV-001, REV-002.
- **Critères d'acceptation** : Given l'hôte qui a noté à J+2 et le voyageur à J+5, When le voyageur valide, Then les deux avis sont publiés au même instant. Given seul l'hôte a noté, When J+10 est atteint, Then son avis est publié et la fenêtre se ferme pour le voyageur. Given un avis soumis et non publié, When l'autre partie consulte le trip, Then elle ne voit ni la note ni le texte. Given une note de l'hôte ≤ 3★ publiée, When le voyageur tente de réserver un véhicule de cet hôte, Then la réservation est refusée.
- **Source** : SRC_G 8.2, 8.3 ; SRC_H H101 ; 06 H-PERF-01 ; écrans 10b : A12, S13.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : REV-002 SIMPLIFIÉ — note globale et sous-notes, texte obligatoire dès 3★, sans réponse publique ; REV-004 SIMPLIFIÉ — publication par tâche planifiée à J+10 ou à la seconde soumission, sans rappel intermédiaire.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : réponses publiques aux avis (BR-REVIEW-06, P1) ; rappel à J+7.

## E11 — Dommages, sinistres et litiges entre particuliers (P0-A, 6 lignes)

#### Fiche CLM-001 / CLM-002 — Déclaration de dommage par l'hôte et d'incident par le voyageur
- **FEATURE ID** : CLM-001, CLM-002
- **Nom** : Déclaration de dommage par l'hôte (CLM-001) ; déclaration d'incident ou d'accident par le voyageur (CLM-002)
- **Module** : Sinistres & protection (CLM — Déclaration)
- **Persona** : PER-08 (CLM-001) ; PER-01, PER-02 (CLM-002)
- **Objectif** : ouvrir un dossier dans les délais, avec les preuves des deux côtés, et le transmettre à l'assureur partenaire.
- **Description** : CLM-001 (absorbe CLM-003) : l'hôte déclare depuis A04 ou A09 au plus tard à `claim_deadline` = max(fin prévue, check-out) + 24 h (BR-DAMAGE-01), avec photos de départ et de retour (TRP-004) et devis. CLM-002 : signalement immédiat (911, Tránsito, assureur partenaire ; SUP-004), formulaire guidé dans S11 (tiers, photos, police) sous 24 h ; seul le conducteur principal déclare. Le dossier est déclaré à l'assureur partenaire selon son contrat (`insurer_contract`) ; le versement de l'hôte du trip passe `ON_HOLD` pendant l'instruction (claim.status_changed).
- **Déclencheur** : retour avec dommage constaté ; incident pendant le trip.
- **Prérequis** : TRP-004 (CLM-001) ; SUP-004 (CLM-002).
- **Parcours principal** : formulaire → pièces → `REPORTED` → instruction CLM-006.
- **Parcours alternatifs** : hors délai ou sans photos valides → `REJECTED_LATE` ; vol → `THEFT_INVESTIGATION` sans délai (BR-DAMAGE-10).
- **Règles métier** : BR-DAMAGE-01, BR-DAMAGE-02, BR-DAMAGE-10, BR-PROT-05.
- **États** : SM-4 `REPORTED` / `THEFT_INVESTIGATION` / `REJECTED_LATE`.
- **Erreurs** : `CLAIM_DEADLINE_PASSED`, `CLAIM_EVIDENCE_MISSING`.
- **Données** : claim(id, trip_id, reported_by, kind, description, evidence[], reported_at, insurer_id).
- **Notifications** : `EVT_CLAIM_OPENED` (voyageur, hôte, ops).
- **Permissions** : `P2P_HOST` (CLM-001, titulaire seulement ; jamais un co-hôte, BR-COHOST-02) ; `GUEST` principal (CLM-002).
- **Dépendances** : CLM-001 → TRP-004 ; CLM-002 → SUP-004.
- **Critères d'acceptation** : Given une fin prévue à 10:00, un check-out à 10:00 et un délai de 24 h, When l'hôte déclare le lendemain à 10:01, Then `CLAIM_DEADLINE_PASSED`. Given une déclaration sans photos de départ et de retour, When elle est soumise, Then `CLAIM_EVIDENCE_MISSING`. Given une déclaration recevable, When elle est enregistrée, Then le lot de versement de l'hôte pour ce trip passe `ON_HOLD`.
- **Source** : SRC_H §5.4 ; 10 §3 ; SRC_G 7.5 ; TOS-GUEST ; 11 EC-12, EC-13 ; écrans 10b : A09, A04, S11, S17.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ (les deux) — déclaration de l'hôte dans A09 et d'incident du voyageur dans S11 par formulaire court avec photos ; transmission à l'assureur partenaire faite par l'ops.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : constat guidé in-app avec géolocalisation.

#### Fiche CLM-006 — Instruction d'un dossier de sinistre
- **FEATURE ID** : CLM-006
- **Nom** : Instruction d'un dossier de sinistre par l'ops, avec l'assureur partenaire
- **Module** : Sinistres & protection (CLM — Parcours)
- **Persona** : PER-07 ; PER-08 ; PER-01, PER-02
- **Objectif** : décision juste, motivée, dans des délais visibles, entre deux particuliers.
- **Description** : 1) recevabilité sous 2 j ouvrés (déclaration ≤ `claim_deadline`, photos de départ et de retour présentes) ; 2) pièces sous 15 j (devis, photos des deux côtés, constat, rapport de police) ; 3) dossier CLM-034 partagé avec le voyageur, qui répond ; 4) déclaration à l'assureur partenaire et décision écrite et motivée (ADM-008) ; 5) exécution par Kmino : ordre de recouvrement (BR-DAMAGE-06 : tiers responsable, puis assureur, puis voyageur dans la limite de son plan de protection) ; le débit du voyageur passe par la carte enregistrée (PAY-015, PAY-037), **jamais par la caution**, avec des montants par jambe donnés par la décision (BR-PAY-09 bis : `HOST` réparation non couverte, `INSURER` subrogation, `PLATFORM` frais de traitement) ; la franchise de l'hôte selon son plan (BR-PROT-06) est un ajustement de son versement, jamais débitée au voyageur. SM-4 simplifiée (ex-CLM-032 ; absorbe CLM-019).
- **Déclencheur** : CLM-001, CLM-002, contestation du voyageur.
- **Prérequis** : CLM-001, CLM-002, CLM-034, ADM-005, PAY-015.
- **Parcours principal** : `REPORTED` → `EVIDENCE_COLLECTION` → `PATH_CHOICE` → `ELIGIBILITY_REVIEW` → décision → `SETTLEMENT` (montants par jambe tracés) → `CLOSED` ; levée du gel du versement.
- **Parcours alternatifs** : pièces manquantes à J+15 → `INELIGIBLE` ; assureur partenaire refuse (EC-47) → `INSURER_DECLINED` → voyageur responsable dans la limite du contrat de location hôte–voyageur et de son plan ; dommage pendant que la caution est autorisée (EC-56) → la caution est libérée à son heure fixe, le dommage suit BR-PAY-09 bis ; jambe `HOST` déjà libérée → créance au `host_ledger` (règle 3 bis, TJ18).
- **Règles métier** : BR-DAMAGE-02, BR-DAMAGE-03, BR-DAMAGE-04, BR-DAMAGE-06, BR-DAMAGE-11, BR-PAY-09 bis, BR-PROT-06.
- **États** : SM-4 ; SM-6 (gel `ON_HOLD` du lot de l'hôte).
- **Erreurs** : `CLAIM_STEP_OVERDUE`, `CLAIM_DECISION_WITHOUT_EVIDENCE`, `LEG_SUM_MISMATCH`.
- **Données** : claim_step(claim_id, step, due_at, done_at, by), decision(claim_id, amount_minor, legs{HOST, INSURER, PLATFORM}, rationale, decided_by).
- **Notifications** : `EVT_CLAIM_EVIDENCE_REQUESTED`, `EVT_CLAIM_DECIDED`.
- **Permissions** : `OPS_AGENT` (instruction), `ADMIN` (décision au-delà d'un seuil, PROPOSÉ).
- **Dépendances** : CLM-001 ; CLM-002 ; CLM-034 ; ADM-005 ; PAY-015.
- **Critères d'acceptation** : Given chaque étape, When elle est franchie, Then elle est horodatée et son délai est visible dans ADM-005. Given un dossier sans photos de départ, When l'ops tente une décision de retenue, Then `CLAIM_DECISION_WITHOUT_EVIDENCE`. Given une décision dont la somme des jambes diffère du montant débité, When l'ordre est préparé, Then `LEG_SUM_MISMATCH` et aucun ordre n'est envoyé au PSP. Given une déclaration reçue un lundi à 09:00, When 2 j ouvrés passent sans décision de recevabilité, Then le dossier est signalé en retard le mercredi à 09:00. Given des pièces demandées à J0, When J+15 est atteint sans pièce, Then le dossier passe `INELIGIBLE`.
- **Source** : SRC_G 7.8 ; SRC_H §5.4 ; 08 BR-PAY-09 bis ; 11 EC-41, EC-47, EC-56 ; écrans 10b : S12, A09, O01.
- **Confiance** : documenté (parcours Turo) ; jambes et montage avec l'assureur proposés.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — instruction par l'ops avec le dossier CLM-034 et un gabarit de décision ; déclaration à l'assureur partenaire par email ; montants par jambe saisis par l'ops et contrôlés.
- **Complexité** : élevée ; ops élevé ; risque élevé.
- **Améliorations possibles** : expertise par l'assureur partenaire en ligne ; médiation (15 IMP-27).

#### Fiche CLM-021 — Frais annexes : paiement ou contestation par le voyageur
- **FEATURE ID** : CLM-021
- **Nom** : Paiement ou contestation des frais annexes par le voyageur sous 72 h (`invoice_guest_response_h`)
- **Module** : Sinistres & protection (CLM — Factures annexes)
- **Persona** : PER-01, PER-02 ; PER-08 ; PER-07
- **Objectif** : laisser au voyageur le temps de payer ou de contester un frais demandé par l'hôte avant tout débit.
- **Description** : l'hôte demande un frais annexe avec preuve (A04, `web.a04.addFee`) dans la liste fermée de BR-PAY-06 (carburant, retard, kilométrage, propreté, tabac, péage…) et dans la fenêtre de BR-REIMB-01 ; Turo : 48 h, puis la plateforme tranche et peut débiter la carte ; [NOUS] 72 h (`invoice_guest_response_h`), frais annexes seulement (les dommages suivent BR-PAY-09 bis et PAY-037) ; Kmino tranche à l'échéance et débite par la caution ou la carte enregistrée, avec des montants explicites par jambe (BR-PAY-06).
- **Déclencheur** : demande de frais annexe de l'hôte.
- **Prérequis** : CLM-006, PAY-015, PAY-037.
- **Parcours principal** : `AWAITING_GUEST` → paiement (`PAID`) ou contestation (`DISPUTED`) ou silence → `PLATFORM_DECISION` → `CHARGED`.
- **Parcours alternatifs** : débit refusé → `UNPAID` → relances → `PAYMENT_PLAN` / `COLLECTIONS` ; demande sans preuve → refusée avant notification.
- **Règles métier** : BR-REIMB-01, BR-REIMB-02, BR-REIMB-03, BR-PAY-10, BR-PAY-06.
- **États** : SM-5.
- **Erreurs** : `GUEST_RESPONSE_WINDOW_OPEN`, `CLAIM_EVIDENCE_MISSING`.
- **Données** : reimbursement_request (SM-5) ; jambes du débit (`payment_operation_leg`).
- **Notifications** : `EVT_INVOICE_TO_GUEST`, `EVT_INVOICE_REMINDER`.
- **Permissions** : `P2P_HOST` (demander), `GUEST` (payer, contester), `OPS_AGENT` (décider).
- **Dépendances** : CLM-006 ; PAY-015 ; PAY-037.
- **Critères d'acceptation** : Given un frais de carburant notifié à J0 10:00 et `invoice_guest_response_h` = 72, When il est J+3 09:59, Then aucun débit (`GUEST_RESPONSE_WINDOW_OPEN`). Given la même demande sans contestation, When il est J+3 10:00, Then Kmino peut trancher et l'ordre de débit porte des montants par jambe dont la somme égale le frais. Given une contestation avec preuves, When elle est déposée, Then SM-5 passe `DISPUTED`.
- **Source** : SRC_G 6.9.1 ; 08 BR-REIMB-02 ; écrans 10b : A04, S12.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — frais demandés par l'hôte avec preuve dans A04, notifiés par email au voyageur ; décision et débit déclenchés par l'ops à l'échéance de 72 h.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : paiement de solde in-app (PAY-025, P1).

#### Fiche ADM-008 — Arbitrage des litiges et factures contestées
- **FEATURE ID** : ADM-008
- **Nom** : Arbitrage des litiges et factures contestées
- **Module** : Back-office & exploitation (ADM — Litiges ; rattachée à E11)
- **Persona** : PER-07 ; PER-08 ; PER-01, PER-02
- **Objectif** : décision écrite et motivée envoyée aux deux particuliers.
- **Description** : SLA 5 j ouvrés ; gabarit de décision (faits, preuves, règle, montant, voies de recours externes) ; couvre aussi les contestations d'annulation ou de no-show (SM-7) et les frais annexes contestés (absorbe CLM-022) ; Kmino exécute la décision par le PSP, par jambe (variation signée, 08 E7 règle 3) ; si la jambe `HOST` est déjà libérée, Kmino avance et ouvre une créance au `host_ledger` (règle 3 bis, TJ18).
- **Déclencheur** : dossier CLM-006 instruit ; contestation SM-7 ; contestation de frais (CLM-021).
- **Prérequis** : CLM-006.
- **Parcours principal** : `OPENED` → `EVIDENCE` (72 h) → `DECIDED_UPHELD` / `DECIDED_REQUALIFIED` → `ADJUSTED` (recalcul du règlement, nouvelle version, ordre par jambe).
- **Parcours alternatifs** : requalification après remboursement déjà exécuté → T36 (delta), T49 (supersession), T50 (en vol) ; capacité `SUPPORTS_PAYOUT_ADJUSTMENT` absente → refus `HOST_PAYOUT_RAIL_UNAVAILABLE`, traitement par l'ops.
- **Règles métier** : BR-REIMB-03, BR-DAMAGE-04, BR-CXL (requalification).
- **États** : SM-7 ; SM-1 (écriture d'audit de requalification) ; SM-8 ; SM-6b (créance de l'hôte).
- **Erreurs** : `DECISION_RATIONALE_REQUIRED`, `LEG_ALREADY_RELEASED`, `HOST_PAYOUT_RAIL_UNAVAILABLE`.
- **Données** : dispute(trip_id, opened_by, reason, state, decision_ref) ; `settlement_leg` ; `platform_advance`.
- **Notifications** : `EVT_DISPUTE_DECIDED` (voyageur, hôte) ; `EVT_HOST_DEBT_OPENED`.
- **Permissions** : `OPS_AGENT`, `ADMIN`.
- **Dépendances** : CLM-006.
- **Critères d'acceptation** : Given une décision sans motif, When elle est enregistrée, Then `DECISION_RATIONALE_REQUIRED`. Given T36, When un no-show contesté est requalifié, Then le delta du voyageur −118,44 et la pénalité −50 sont calculés et une nouvelle version de règlement est créée, l'ancienne conservée. Given TJ18a (75,00 déjà versés à l'hôte), When la requalification en `HOST_CANCELLED` est exécutée, Then l'ordre porte 0,00 sur `HOST` et −118,44 sur `PLATFORM` et une créance de 75,00 est ouverte au `host_ledger` (TJ18b). Given T67 (a) (chargeback perdu sur la capture de 256,66 alors que le remboursement de 187,44 est encore `PLANNED`), When le chargeback est clos, Then l'instance de remboursement passe `CANCELLED` et rien n'est remboursé en plus du chargeback.
- **Source** : 08 BR-REIMB-03 reco. ; 08 T67, E7 ; écrans 10b : S12, A09, O01.
- **Confiance** : inféré.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — décision écrite par gabarit, envoyée par email aux deux parties ; exécution par l'ops (remboursement ou débit par jambe via le PSP).
- **Complexité** : moyenne ; ops élevé ; risque élevé.
- **Améliorations possibles** : médiation externe (15 IMP-27).

#### Fiche LEG-024 — Preuves et décisions motivées (pratique ACODECO)
- **FEATURE ID** : LEG-024
- **Nom** : Preuves et décisions motivées (pratique recommandée face à ACODECO et SEDECO)
- **Module** : Légal, données & localisation (LEG — Consommateur ; rattachée à E11)
- **Persona** : PER-07
- **Objectif** : résister aux plaintes de consommateurs entre particuliers.
- **Description** : toute retenue ou facturation post-trip repose sur les photos horodatées (TRP-004) et le dossier CLM-034 ; décisions écrites et motivées (ADM-008). Source (12 §3.7) : précédent de 2018 signalé par une colonne d'opinion, **pas une exigence réglementaire identifiée** ; Ley 45/2007 à vérifier (OQ-BR-24).
- **Déclencheur** : toute retenue ou tout frais demandé par l'hôte.
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
- **Critères d'acceptation** : Given une retenue sans photos de départ et de retour, When elle est décidée, Then elle est refusée (même contrôle que CLM-006).
- **Source** : 08 BR-PAY-06 reco ; 12 §3.7 ; écrans 10b : O01.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — règle de pratique appliquée par l'ops avant chaque décision de retenue ou de frais, sur liste de contrôle.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : —

## E12 — Back-office, support, risque et exploitation (P0-A, 19 lignes)

#### Fiche ADM-001 — Console admin avec RBAC, 2FA et journal d'audit
- **FEATURE ID** : ADM-001
- **Nom** : Console admin avec RBAC, 2FA et journal d'audit
- **Module** : Back-office & exploitation (ADM — Socle)
- **Persona** : PER-05, PER-06, PER-07
- **Objectif** : opérer la bêta P2P en sécurité et de façon traçable.
- **Description** : rôles internes de 17 §2.3 : `ADMIN` (tout le fonctionnel, paramètres pays ; les interrupteurs de mise en service seulement par la procédure à deux personnes d'ADM-027), `OPS_AGENT` (KYC, annonces, vérification des hôtes, trips, risque, sinistres), `SUPPORT_AGENT` (vue 360° en lecture, notes, actions de trip limitées), `FINANCE` (jambes, versements aux hôtes, factures du trip fee, bordereaux de l'assureur, avances, crédits), `SUPERADMIN` (rôles admin, bris de glace, double validation). Les rôles externes sont `GUEST`, `P2P_HOST` et `CO_HOST` (P1 sauf story). Matrice rôle × permission en base ; 2FA TOTP obligatoire pour tout rôle interne ; journal d'audit en ajout seul (qui, quoi, avant / après, quand, motif), conservé 5 ans sous réserve d'OQ-BR-25.
- **Déclencheur** : connexion interne.
- **Prérequis** : aucun.
- **Parcours principal** : connexion + TOTP → actions autorisées par la matrice → écriture au journal.
- **Parcours alternatifs** : action interdite → 403 journalisé ; perte du TOTP → réinitialisation par un autre admin, journalisée.
- **Règles métier** : aucune BR (interne) ; BR-TRUST-05 pour les restrictions.
- **États** : —
- **Erreurs** : `FORBIDDEN`, `2FA_REQUIRED`.
- **Données** : staff_user, role_permission(role, permission), audit_log (ajout seul) ; RLS par type d'acteur et par pays (17 §2.3).
- **Notifications** : —
- **Permissions** : définit les permissions (matrice de 17 §2.3, qui fait foi).
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given un rôle `SUPPORT_AGENT`, When il tente une annulation plateforme, Then 403 journalisé. Given le journal d'audit, When une mise à jour ou une suppression est tentée depuis l'application, Then elle est impossible. Given un `OPS_AGENT` d'un pays, When il lit un trip d'un autre pays sans portée, Then la lecture est refusée par la RLS.
- **Source** : 02 Limites (back-office Turo invisible) ; 17 §2.3 ; écrans 10b : O01.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ — console à deux rôles internes (`ADMIN`, `OPS_AGENT`) avec 2FA et journal d'audit ; les autres rôles internes sont construits avec leur story.
- **Complexité** : moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : outil de support du commerce intégré (ADM-010, P1).

#### Fiche ADM-002 / ADM-003 — Files de revue KYC et annonces
- **FEATURE ID** : ADM-002, ADM-003
- **Nom** : File de revue KYC (ADM-002) ; file de revue des annonces (ADM-003)
- **Module** : Back-office & exploitation (ADM — Files de revue)
- **Persona** : PER-07
- **Objectif** : décisions rapides et tracées sur les voyageurs, les hôtes et leurs voitures.
- **Description** : ADM-002 (absorbe VER-010) : comptes de voyageurs et d'hôtes en `MANUAL_REVIEW`, SLA 4 h ouvrées (M2). ADM-003 : annonces `PENDING_REVIEW` publiées par les hôtes, SLA 24 h ; contrôle des documents du véhicule (titre, plaque et VIN rapprochés du titre, consentement du créancier si véhicule financé : BR-LIST-01 à 03) ; inspection physique Premium / Luxe (PROPOSÉ, facultative en bêta).
- **Déclencheur** : entrée en file.
- **Prérequis** : ADM-001, VER-001 (ADM-002) ; HST-016 (ADM-003).
- **Parcours principal** : file triée par ancienneté → ouverture → décision motivée.
- **Parcours alternatifs** : SLA dépassé → alerte au responsable ops ; document du véhicule illisible → demande de pièce à l'hôte.
- **Règles métier** : BR-VERIF-04, BR-LIST-08, BR-LIST-01, BR-LIST-02.
- **États** : SM-3 (`MANUAL_REVIEW` → …) ; SM-2 (`PENDING_REVIEW` → …).
- **Erreurs** : `DECISION_RATIONALE_REQUIRED`.
- **Données** : review_task(type, ref, created_at, due_at, assignee, decision).
- **Notifications** : `EVT_REVIEW_SLA_BREACH` (ops) ; `EVT_LISTING_APPROVED`, `EVT_LISTING_REJECTED` (hôte).
- **Permissions** : `OPS_AGENT` (permission `ops.review_listing_host` pour les annonces).
- **Dépendances** : ADM-002 → ADM-001, VER-001 ; ADM-003 → HST-016.
- **Critères d'acceptation** : Given un dossier entré à 09:00 un jour ouvré, When 13:00 passe sans décision, Then une alerte part. Given une décision, When elle est enregistrée, Then motif et auteur figurent au journal. Given une annonce dont la plaque ne correspond pas au titre, When l'ops l'approuve, Then l'approbation est refusée tant que l'écart n'est pas levé.
- **Source** : 08 BR-VERIF-04 (revue 24–48 h chez Turo) ; 08 BR-LIST-08 ; écrans 10b : O01, A10.
- **Confiance** : inféré.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL (les deux) — revue KYC dans le portail du fournisseur, décision reportée dans la console ; annonces revues par l'ops dans la file avant publication, documents du véhicule contrôlés à la main.
- **Complexité** : moyenne ; ops élevé ; risque moyen / faible.
- **Améliorations possibles** : priorisation par date de départ.

#### Fiche ADM-004 — Revue de l'inscription des hôtes particuliers
- **FEATURE ID** : ADM-004
- **Nom** : Revue de l'inscription et de la vérification des hôtes particuliers
- **Module** : Back-office & exploitation (ADM — Onboarding de l'hôte)
- **Persona** : PER-07 ; PER-08 (sujet de la revue)
- **Objectif** : activer un hôte seulement quand sa vérification est complète et que son pays est ouvert aux hôtes.
- **Description** : file de revue `host_verification` (console O01) : KYC individuel (le nôtre, VER-001 à 005, et celui du PSP de place de marché), contrôle de sanctions (VER-028), personne physique seulement (BR-ACC-06), âge ≥ `host_min_age_years` (21), profil fiscal (cédula ou RUC, `p2p_host_requires_tax_id[pays]` = `true`, FIN-008), compte de versement et statut de sous-marchand chez le PSP (`psp_submerchant`), véhicule et documents (HST-049). Décision approuvée / à compléter / refusée, motivée. **Activation** du compte d'hôte seulement si `p2p_private_hosts_enabled[pays]` et `insurer_contract_active[pays]` valent `true` (08 Règle de blocage) ; sinon la vérification peut être approuvée mais le compte reste non activé.
- **Déclencheur** : hôte qui termine sa liste de tâches (A07).
- **Prérequis** : VER-028, HST-049.
- **Parcours principal** : liste de contrôle → décisions par élément → approbation → activation si le pays est ouvert.
- **Parcours alternatifs** : élément manquant → « à compléter » avec la liste ; demande d'une personne morale → refus ; pays fermé aux hôtes → vérification approuvée, compte en attente (`HOST_NOT_ACTIVATED`), message `web.a07.waitingCountry`.
- **Règles métier** : BR-ACC-06, BR-LIST-01.
- **États** : `host_verification` `PENDING` → `MORE_INFO_REQUIRED` / `APPROVED` / `REJECTED` ; compte d'hôte (`organization` `P2P_HOST_INDIVIDUAL`) non activé → actif seulement si les interrupteurs du pays le permettent.
- **Erreurs** : `ONBOARDING_INCOMPLETE`, `HOST_ENTITY_NOT_ALLOWED`, `HOST_UNDER_AGE`, `HOST_TAX_ID_REQUIRED`, `HOST_NOT_ACTIVATED`, `INSURER_CONTRACT_INACTIVE`, `HOST_PAYOUT_RAIL_UNAVAILABLE`.
- **Données** : host_verification(org_id, status, items[], decided_by, decided_at, rationale) ; psp_submerchant(org_id, status).
- **Notifications** : `EVT_HOST_VERIFICATION_DECISION` (`host_verification.decided`), `EVT_HOST_ACTIVATED`.
- **Permissions** : `OPS_AGENT` (revue, décision) ; aucune activation possible hors des interrupteurs, même par `ADMIN`.
- **Dépendances** : VER-028 ; HST-049.
- **Critères d'acceptation** : Given un hôte sans profil fiscal dans un pays où `p2p_host_requires_tax_id` vaut `true`, When l'ops approuve, Then `HOST_TAX_ID_REQUIRED`. Given une vérification approuvée et `p2p_private_hosts_enabled[pays]` = `false`, When l'activation est demandée, Then `HOST_NOT_ACTIVATED` et le compte reste non activé. Given `insurer_contract_active[pays]` absent, When l'activation est demandée, Then `INSURER_CONTRACT_INACTIVE` (absent vaut `false`).
- **Source** : 08 BR-ACC-06, Règle de blocage ; 17 §2.4, §0.1 ; analyse pivot §e.5 (NOUVELLE-01) ; écrans 10b : A07, O01.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : MANUEL — revue de chaque hôte par l'ops sur une liste de contrôle dans la console (KYC du fournisseur, sanctions, fiscalité, compte du PSP, véhicule) ; décision et motif saisis dans `host_verification`.
- **Complexité** : moyenne ; ops élevé ; risque moyen.
- **Améliorations possibles** : contrôles automatiques des pièces et du registre des véhicules (P1).

#### Fiche ADM-005 — Fiche utilisateur 360°
- **FEATURE ID** : ADM-005
- **Nom** : Fiche utilisateur 360°
- **Module** : Back-office & exploitation (ADM — Utilisateurs)
- **Persona** : PER-05, PER-07, PER-06
- **Objectif** : tout savoir d'un voyageur ou d'un hôte en un écran.
- **Description** : recherche ; profil, statut KYC (sans images), trips, paiements et jambes, messages, restrictions, notes internes (absorbe ADM-012, SUP-016, VER-023). Pour un hôte : véhicules, gains, versements, solde du `host_ledger`, indicateurs de contournement (réservations sur la plateforme rapportées aux jours disponibles, signaux de paiement hors plateforme dans la messagerie, MSG-007). Une même personne voyageur et hôte apparaît sous ses deux rôles (OQ-P2P-09). Restriction manuelle d'un compte (utilisée par BKG-012).
- **Déclencheur** : support, ops.
- **Prérequis** : ADM-001.
- **Parcours principal** : recherche → fiche → action (note, restriction avec motif).
- **Parcours alternatifs** : levée d'une restriction → motif obligatoire.
- **Règles métier** : BR-ACC-10, BR-TRUST-05.
- **États** : restriction `ACTIVE` / `LIFTED`.
- **Erreurs** : `FORBIDDEN`.
- **Données** : restriction(user_or_org, type, reason, by, at), internal_note ; vues `host_ledger_state`, `payout_batch`.
- **Notifications** : `EVT_ACCOUNT_RESTRICTED`.
- **Permissions** : `SUPPORT_AGENT` (lecture, notes), `OPS_AGENT` (restrictions), `FINANCE` (lecture financière, jambes).
- **Dépendances** : ADM-001.
- **Critères d'acceptation** : Given un compte restreint, When le voyageur réserve, Then `ACCOUNT_RESTRICTED` (BKG-012). Given chaque consultation d'un dossier KYC, When elle a lieu, Then elle est journalisée (ADM-032). Given un hôte restreint, When sa fiche est ouverte, Then ses annonces apparaissent fermées à la réservation.
- **Source** : 08 BR-ACC-10 ; écrans 10b : O01.
- **Confiance** : inféré.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — fiche en lecture : profil, KYC, trips, paiements ; pour un hôte, véhicules et solde du `host_ledger`.
- **Complexité** : moyenne ; ops moyen ; risque faible.
- **Améliorations possibles** : historique des contacts support.

#### Fiche ADM-006 — Gestion des trips par les agents
- **FEATURE ID** : ADM-006
- **Nom** : Gestion des trips par les agents
- **Module** : Back-office & exploitation (ADM — Trips)
- **Persona** : PER-07, PER-05
- **Objectif** : corriger un trip quand le libre-service n'existe pas encore.
- **Description** : modification forcée, annulation avec motif (BKG-035, et pour le compte du voyageur ou de l'hôte en bêta), fin forcée (`TERMINATED_EARLY` avec motif), swap, crédit (ADM-007). En bêta, modification = annulation + nouvelle réservation. Chaque règlement qui en découle est calculé par le moteur et exécuté jambe par jambe (08 E7).
- **Déclencheur** : demande support ; incident.
- **Prérequis** : ADM-001.
- **Parcours principal** : action → motif → transition SM-1 → règlement si applicable.
- **Parcours alternatifs** : fin anticipée non imputable au voyageur → `computeTerminationSettlement` (T37, T65) — OQ-BR-46 (jour minimum) ouverte.
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
- **Objectif** : réparer un incident vite, sans jamais faire supporter un geste à une jambe qui ne le doit pas.
- **Description** : Kmino, marchand de référence, rembourse le voyageur **jambe par jambe** par le PSP (PAY-021, SM-8, 08 E7 règle 10). L'agent peut (a) ordonner un remboursement **calculé par le règlement** (jamais un montant libre) ; (b) imputer un coût à l'hôte par ajustement de ses versements (`host_ledger`, BR-PAYOUT-04 ; exige `SUPPORTS_PAYOUT_ADJUSTMENT`, et une jambe `HOST` non libérée, sinon règle 3 bis) ; (c) accorder un crédit commercial plateforme plafonné par rôle et par mois (ADM-031 ; **défaut 0** tant que non décidé), **imputé à la jambe `PLATFORM`** ; à l'utilisation, les crédits sont plafonnés à la jambe `PLATFORM` de la capture (TJ21). Un crédit cash exige `funds_holding_enabled[pays]` = `true`.
- **Déclencheur** : incident, geste commercial.
- **Prérequis** : FIN-001, ADM-001, ADM-031, PAY-021.
- **Parcours principal** : choix (a / b / c) → montant → contrôle du plafond et des capacités → ordre par jambe → suivi SM-8.
- **Parcours alternatifs** : plafond dépassé → refus ou escalade `ADMIN` ; jambe `HOST` déjà libérée → avance de Kmino et créance au `host_ledger` (règle 3 bis, TJ18) ; crédit cash demandé dans un pays où `funds_holding_enabled` vaut `false` → refus.
- **Règles métier** : BR-PAY-07, BR-PAY-08, BR-PAYOUT-04.
- **États** : credit `ISSUED` → `USED` / `EXPIRED` ; SM-8 pour (a).
- **Erreurs** : `CREDIT_CAP_EXCEEDED`, `LEG_ALREADY_RELEASED`, `LEG_AMOUNT_NEGATIVE`.
- **Données** : credit(id, beneficiary, amount, reason, issued_by, cap_period) ; refund_instance ; payment_operation_leg.
- **Notifications** : `EVT_CREDIT_ISSUED`, `EVT_REFUND_PLANNED`.
- **Permissions** : `OPS_AGENT`, `FINANCE` dans les plafonds ; `ADMIN` au-delà ; avance hors plafond : `finance.platform_advance` à deux personnes (17 §2.9).
- **Dépendances** : FIN-001 ; ADM-001 ; ADM-031 ; PAY-021.
- **Critères d'acceptation** : Given TA09, When un crédit de 10,00 est tenté avec un plafond non décidé (0), Then `CREDIT_CAP_EXCEEDED` journalisé. Given TJ21, When le voyageur impute 120,00 de crédit cash sur une capture dont la jambe `PLATFORM` vaut 99,91, Then le crédit ne porte que 99,91 et la carte porte toutes les jambes non plateforme. Given un geste commercial, When il est exécuté, Then seule la jambe `PLATFORM` est débitée.
- **Source** : 08 BR-PAY-07 ; BR-PAY-08 ; 08 E7 règles 3 bis et 10 ; écrans 10b : O01.
- **Confiance** : inféré.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : MANUEL — l'ops ordonne le remboursement calculé par le règlement depuis la console (exécution par le PSP, en `FAKE` pendant le build) ; gestes commerciaux saisis à la main dans la limite du plafond, imputés à `PLATFORM`.
- **Complexité** : moyenne ; ops moyen ; risque moyen.
- **Améliorations possibles** : crédits du voyageur utilisables au checkout en libre-service (P1).

#### Fiche ADM-014 / ADM-031 — Paramétrage par pays et paramètres par défaut
- **FEATURE ID** : ADM-014, ADM-031
- **Nom** : Paramétrage par pays (ADM-014) ; annexe des paramètres de lancement par défaut, Panama et Paraguay (ADM-031)
- **Module** : Back-office & exploitation (ADM — Paramétrage)
- **Persona** : PER-07 (`ADMIN`)
- **Objectif** : aucune valeur métier codée en dur ; valeurs Panama et Paraguay décidées avant la mise en service (valeurs de test autorisées pendant le build, DEC-FONDATEUR-02).
- **Description** : ADM-014 (absorbe I18N-007, PRT-010) : table param(pays, clé, valeur, devise, valid_from, modifié_par) ; modification par `ADMIN`, journalisée, effective à valid_from, jamais rétroactive (le devis fige). Les quatre **interrupteurs de mise en service** (`p2p_private_hosts_enabled`, `insurer_contract_active`, `funds_holding_enabled`, `payouts_enabled`) et `collection_mode[pays]` sont des paramètres par pays, mais **ne s'écrivent pas** par cet écran : seulement par la procédure à deux personnes d'ADM-027. ADM-031 : valeurs de lancement **À DÉCIDER** au jalon J-ADM-031 : âge minimum 21 / 25 selon la classe ; âge minimal de l'hôte 21 (`host_min_age_years`, OQ-P2P-01) ; préavis 3 h ; tampon 2 h ; annulation gratuite 24 ou 25 h (OQ-BR-30) ; pénalités d'annulation de l'hôte (`host_penalty`, BR-CXL-13) ; grâce de retard 29 min (**OQ-BR-04 ouverte**) ; grâce no-show 60 min (OQ-BR-33) ; taxe 7 % au PA et 10 % au PY (OQ-BR-14) ; plan de l'hôte par défaut `ESTÁNDAR` 75 % (`host_default_plan`, OQ-P2P-11) ; protection minimale `BASICA` (`guest_protection_min_level`, OQ-P2P-12) ; fenêtre d'avis 10 j (`review_window_days`, OQ-P2P-06) ; mode de réservation `INSTANT` (`p2p_default_booking_mode`) ; `self_booking_forbidden` = `true` ; déclaration de dommage 24 h ; durée max 30 j ; plafonds de crédits ; seuil de solde négatif de l'hôte ; `platform_reserve_minor` et `host_advance_cap_minor` (défaut fail-closed : aucune avance) ; `platform_funded_host_compensation` **absent** (DEC-FONDATEUR-01 ouverte) ; `foreign_license_mode` FLAG.
- **Déclencheur** : configuration ; jalon.
- **Prérequis** : ADM-001 (ADM-014) ; ADM-014 (ADM-031).
- **Parcours principal** : proposition → validation du fondateur → chargement → effet à valid_from.
- **Parcours alternatifs** : clé requise absente → démarrage de l'application refusé en production (fail-closed), sauf `platform_funded_host_compensation` et les interrupteurs, dont l'absence vaut `false` ; tentative d'écrire un interrupteur par cet écran → refus.
- **Règles métier** : toutes les BR `{param}` ; BR-CXL-00, BR-CXL-01, BR-RETURN-03, BR-ACC-04, BR-CXL-13, BR-PROT-06.
- **États** : param `DRAFT` → `ACTIVE` (valid_from) → `SUPERSEDED`.
- **Erreurs** : `PARAM_MISSING`, `PARAM_RETROACTIVE`, `FORBIDDEN` (interrupteur hors procédure).
- **Données** : param_value(country, key, value, currency, valid_from, created_by, decision_ref).
- **Notifications** : —
- **Permissions** : `ADMIN` seulement ; interrupteurs : `config.go_live_switch` par ADM-027.
- **Dépendances** : ADM-014 → ADM-001 ; ADM-031 → ADM-014.
- **Critères d'acceptation** : Given une valeur avec valid_from passé, When elle est saisie, Then `PARAM_RETROACTIVE`. Given un trip réservé sous l'ancienne valeur, When la nouvelle entre en vigueur, Then son devis garde l'ancienne. Given une clé obligatoire manquante, When la production démarre, Then refus explicite. Given `platform_funded_host_compensation` absent, When T61 est rejoué, Then compensation 0. Given un `ADMIN` sur l'écran de paramétrage, When il écrit `payouts_enabled` à `true`, Then `FORBIDDEN` et la tentative est journalisée.
- **Source** : 08 Conventions (paramétrage pays), Règle de blocage ; 17 §7.2 ; VERIF_07 NEW-07, F10 ; 12 §3 ; écrans 10b : S10, A11.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0 pour ADM-014, lot 1 pour ADM-031)
- **Bêta pilote** : SIMPLIFIÉ (les deux) — paramètres dans un fichier de configuration versionné, sans écran ; valeurs ADM-031 chargées dedans ; interrupteurs à `false` en production.
- **Complexité** : moyenne / faible ; ops faible ; risque faible / moyen.
- **Améliorations possibles** : écran de paramétrage avec double validation pour toutes les clés.

#### Fiche ADM-022 — Tableau ops des véhicules en retard / non restitués
- **FEATURE ID** : ADM-022
- **Nom** : Tableau ops des véhicules en retard / non restitués
- **Module** : Back-office & exploitation (ADM — Trips)
- **Persona** : PER-07 ; PER-08 (informé)
- **Objectif** : suivre les escalades de TRP-038 entre l'hôte, le voyageur et l'assureur partenaire.
- **Description** : liste temps réel des trips `OVERDUE` / `UNRETURNED`, durée du retard, étape d'escalade (BR-RETURN-04), GPS déclaré par l'hôte (oui / non), contacts du voyageur et de l'hôte (numéros masqués), statut de la déclaration à l'assureur (NOUVELLE-18).
- **Déclencheur** : console ops.
- **Prérequis** : TRP-038, ADM-001.
- **Parcours principal** : liste → trip → étape suivante (contact, mise en demeure, plainte, déclaration à l'assureur).
- **Parcours alternatifs** : hôte injoignable → l'ops poursuit l'escalade seul.
- **Règles métier** : BR-RETURN-04.
- **États** : SM-1 `OVERDUE`, `UNRETURNED`.
- **Erreurs** : —
- **Données** : vue overdue_board.
- **Notifications** : `EVT_TRIP_OVERDUE`, `EVT_UNRETURNED_ESCALATION`.
- **Permissions** : `OPS_AGENT`.
- **Dépendances** : TRP-038 ; ADM-001.
- **Critères d'acceptation** : Given un trip qui passe `OVERDUE`, When le tableau est ouvert, Then il apparaît en ≤ 1 min avec son étape. Given un trip `UNRETURNED`, When l'étape d'escalade change, Then l'hôte reçoit `EVT_UNRETURNED_ESCALATION`.
- **Source** : 11 EC-20 ; écrans 10b : O01.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — tableau ops en liste filtrée (`OVERDUE`, `UNRETURNED`) avec étape d'escalade et contacts, sans carte GPS (NOUVELLE-18).
- **Complexité** : moyenne ; ops élevé ; risque moyen.
- **Améliorations possibles** : position GPS intégrée (P1).

#### Fiche ADM-027 — Interrupteurs par pays et par segment
- **FEATURE ID** : ADM-027
- **Nom** : Interrupteurs par pays et par segment (feature flags), dont les interrupteurs de mise en service
- **Module** : Back-office & exploitation (ADM — Paramétrage)
- **Persona** : PER-07 (`ADMIN`, `SUPERADMIN`) ; fondateur (décision écrite)
- **Objectif** : construire tout le parcours de l'hôte particulier et fermer la mise en service pays par pays, sans branche de code (DEC-FONDATEUR-02, ADR-046).
- **Description** : interrupteurs par pays et par segment (pays, villes, fonctionnalités) lus par l'application en fail-closed (valeur absente ou inconnue = `false`). Les quatre **interrupteurs de mise en service** (17 §0.1) : `p2p_private_hosts_enabled[pays]` (activation de tout hôte), `insurer_contract_active[pays]` (activation et vente de protection), `funds_holding_enabled[pays]` (variante B, crédit cash, rail b de la caution, avance au-delà de `PLATFORM`), `payouts_enabled[pays]` (versements) : `false` en production tant que l'avis ou le contrat manque ; `true` en préproduction et en test. La porte porte sur le **type de compte** (`organization` `P2P_HOST_INDIVIDUAL`) et le **pays**, jamais sur la présence d'un RUC. Changement d'un interrupteur de mise en service : seulement par `config.cmd_request_go_live_switch` puis `config.cmd_approve_go_live_switch`, par deux personnes distinctes, sur décision écrite du fondateur citée dans la demande, journalisé ; toute autre écriture est refusée par le trigger `param_value_go_live_guard` (RLS-27) ; **jamais par un agent** (DEC-FONDATEUR-15). Tant qu'un second approbateur humain n'existe pas, aucun interrupteur ne peut passer à `true` (fail-closed).
- **Déclencheur** : décision écrite du fondateur ; avis juridique, contrat d'assureur ou validation du PSP reçus.
- **Prérequis** : ADM-001.
- **Parcours principal** : demande (clé, pays, valeur, référence de la décision) → approbation par une seconde personne → nouvelle valeur effective → événement `config.param.changed` → journal.
- **Parcours alternatifs** : même personne pour la demande et l'approbation, même dans une autre session → refus ; écriture directe en base → refus et alerte ; clé absente → lue `false` ; interrupteur repassé à `false` → nouvelles activations et nouveaux versements bloqués, trips en cours inchangés.
- **Règles métier** : aucune BR propre ; applique la Règle de blocage de 08.
- **États** : demande `REQUESTED` → `APPROVED` / `REJECTED` ; valeur `false` ↔ `true` (versionnée, valid_from).
- **Erreurs** : `FORBIDDEN`, `GO_LIVE_SECOND_APPROVER_REQUIRED` (PROPOSÉ), `GO_LIVE_DECISION_REF_REQUIRED` (PROPOSÉ).
- **Données** : param_value (clés protégées désignées par un drapeau de `param_definition`) ; go_live_switch_request(key, country, value, decision_ref, requested_by, approved_by, at) ; audit_log.
- **Notifications** : alerte ops à chaque demande et à chaque bascule.
- **Permissions** : `config.go_live_switch` (`ADMIN` ou `SUPERADMIN`, deux personnes distinctes) ; aucun rôle applicatif ni travailleur ne peut écrire ces clés (RLS-27).
- **Dépendances** : ADM-001.
- **Critères d'acceptation** : Given `p2p_private_hosts_enabled` absent pour un pays, When l'application lit la valeur, Then elle obtient `false`. Given une demande et une approbation faites par la même personne, When l'approbation est soumise, Then `GO_LIVE_SECOND_APPROVER_REQUIRED` et la valeur ne change pas. Given un `UPDATE` direct de `payouts_enabled` à `true` sous `app_api`, When il est exécuté, Then il est refusé et journalisé (RLS-27). Given `funds_holding_enabled` à `true` au Paraguay et à `false` au Panama, When une variante B est demandée au Panama, Then elle est refusée.
- **Source** : 08 Règle de blocage ; 17 §0.1, §2.3, §7.2, ADR-046 ; analyse pivot §e.5 (NOUVELLE-11) ; écrans 10b : O01.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — interrupteurs en paramètres versionnés lus en fail-closed ; bascule par les deux commandes à deux personnes sans écran dédié, journalisée ; aucun interrupteur de segment hors pays.
- **Complexité** : moyenne ; ops faible ; risque élevé.
- **Améliorations possibles** : interrupteurs par ville et par segment de voyageur (P1).

#### Fiche ADM-029 — File de revue des réservations à risque
- **FEATURE ID** : ADM-029
- **Nom** : File de revue des réservations à risque
- **Module** : Back-office & exploitation (ADM — Risque)
- **Persona** : PER-07
- **Objectif** : arrêter la fraude avant la remise des clés (EC-43).
- **Description** : 5 à 10 règles codées en dur : compte < 24 h ; carte hors du pays de résidence déclaré ; permis étranger > entrée + 90 j ou résident à permis étranger (VER-007) ; pick-up, 4x4 ou Premium ; départ < 3 h ; 3 refus de carte en 1 h ; numéro virtuel (VER-013) ; même appareil ou carte sur plusieurs comptes, dont le compte de l'hôte du véhicule (auto-réservation, `self_booking_forbidden`). Règle déclenchée → réservation en revue (2 h ouvrées) : approuver, demander un document, annuler avec remboursement intégral. Défaut PROPOSÉ d'UXQ-08 : **revue avant le débit** — hold `CHECKOUT` avec `review_required`, véhicule bloqué `review_hold_minutes` = 120, `flagged_booking_payment_order` = `REVIEW_BEFORE_CHARGE`. Taux de faux positifs suivi (M7).
- **Déclencheur** : checkout ; signaux.
- **Prérequis** : ADM-001.
- **Parcours principal** : règles → `requirements_status = PENDING` → décision → `SATISFIED` puis débit, ou libération du hold.
- **Parcours alternatifs** : revue non faite avant la fin du blocage → hold libéré sans débit ; réservation déjà payée puis signalée (signal tardif) → revue non faite à T−2 h → `FAILED` → `CANCELLED_BY_PLATFORM` motif `PLATFORM_REVIEW_DELAY` (remboursement intégral par jambe ; compensation de l'hôte selon DEC-FONDATEUR-01, défaut 0, T61).
- **Règles métier** : BR-VERIF-09, BR-TRUST-01, BR-CXL-07.
- **États** : SM-1b ; SM-1 ; `checkout_hold` `ACTIVE` (`review_required`) → `CONVERTED` / `RELEASED`.
- **Erreurs** : `BOOKING_UNDER_REVIEW`, `SELF_BOOKING_FORBIDDEN`.
- **Données** : risk_flag(trip_id, rule, value), risk_decision(trip_id, decision, rationale, by, at).
- **Notifications** : `EVT_BOOKING_UNDER_REVIEW`, `EVT_DOCUMENT_REQUESTED`.
- **Permissions** : `OPS_AGENT`.
- **Dépendances** : ADM-001.
- **Critères d'acceptation** : Given un compte créé il y a 2 h réservant un 4x4 pour dans 2 h, When il valide le checkout, Then la réservation est en revue et aucun débit n'a lieu avant la décision (`REVIEW_BEFORE_CHARGE`). Given une décision, When elle est enregistrée, Then elle est motivée et journalisée. Given une revue non faite à T−2 h sur une réservation déjà payée, When la tâche tourne, Then annulation `PLATFORM_REVIEW_DELAY` avec remboursement intégral.
- **Source** : 11 EC-43 ; 17 §2.5 ; écrans 10b : S05, O01.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — toutes les réservations passent en revue humaine avant le débit ; les règles s'affichent comme indicateurs.
- **Complexité** : moyenne ; ops élevé ; risque moyen.
- **Améliorations possibles** : score de risque LATAM (15 IMP-18, P1).

#### Fiche ADM-032 / ADM-035 — Sauvegardes, monitoring, journal d'accès ; RPO/RTO et reprise
- **FEATURE ID** : ADM-032, ADM-035
- **Nom** : Sauvegardes, monitoring et journal d'accès (ADM-032) ; RPO / RTO et plan de reprise (ADM-035)
- **Module** : Back-office & exploitation (ADM — Exploitation)
- **Persona** : équipe technique ; PER-07
- **Objectif** : ne rien perdre, détecter vite, savoir reprendre.
- **Description** : ADM-032 : sauvegardes quotidiennes chiffrées (base et fichiers), test de restauration mensuel ; monitoring et alertes (disponibilité, erreurs, files de notifications, webhooks PSP en échec, écarts de rapprochement par jambe) ; journal des consultations de dossiers KYC, de photos et des données des hôtes (adresse, KYC) ; identifiants du compte marchand de Kmino chez le PSP en coffre / KMS, rotation documentée ; isolation des données entre hôtes par RLS. ADM-035 : RPO ≤ 24 h (cible ≤ 1 h si journaux de transactions), RTO ≤ 8 h (À DÉCIDER) ; plan de reprise écrit ; procédure d'incident de sécurité et de violation reliée au registre LEG-010 (notification selon OQ-MK-09) ; test de restauration chronométré avant l'ouverture.
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
- **Priorité produit** : P0-A (lot 0 pour ADM-032, lot 1 pour ADM-035)
- **Bêta pilote** : SIMPLIFIÉ (les deux) — sauvegardes gérées de l'hébergeur, alertes de base, journal d'accès aux dossiers KYC ; RPO 24 h / RTO 8 h et un test de restauration avant l'ouverture.
- **Complexité** : moyenne / faible ; ops faible ; risque élevé / moyen.
- **Améliorations possibles** : PITR, multi-région.

#### Fiche SUP-004 / SUP-011 — Ligne d'urgence, support en horaires étendus, bilingue
- **FEATURE ID** : SUP-004, SUP-011
- **Nom** : Ligne d'urgence et support en horaires étendus (SUP-004) ; support bilingue es / en (SUP-011)
- **Module** : Back-office & exploitation (SUP — Support)
- **Persona** : PER-05 ; PER-01, PER-02, PER-08
- **Objectif** : aide joignable pendant le trip, en es et en, pour le voyageur comme pour l'hôte.
- **Description** : SUP-004 (absorbe PRT-005, TRP-050) : WhatsApp Business + téléphone affichés sur la confirmation, le contrat et le trip ; support humain es / en en horaires étendus (ex. 7 h–22 h, 7 j/7) ; hors horaires, réponse automatique vers l'assistance routière de l'assureur partenaire (plan de protection, PRT-001) et vers le contact de l'hôte (numéro masqué, MSG-007) ; accident : 911, Tránsito, assureur (CLM-002) ; signalement de sécurité en cours de trip, y compris d'une rencontre de remise qui se passe mal. 24/7 humain : P1. SUP-011 : réponses types bilingues.
- **Déclencheur** : contact du voyageur ou de l'hôte.
- **Prérequis** : PRT-001 ; SUP-020 (dotation).
- **Parcours principal** : contact → ticket lié au trip → réponse → résolution.
- **Parcours alternatifs** : hors plage → message automatique ; urgence vitale → 911.
- **Règles métier** : BR-PROT-05.
- **États** : ticket `OPEN` → `PENDING` → `RESOLVED`.
- **Erreurs** : —
- **Données** : ticket(trip_id, channel, lang, first_response_at, resolved_at).
- **Notifications** : réponse automatique hors plage.
- **Permissions** : `SUPPORT_AGENT`.
- **Dépendances** : SUP-004 → PRT-001 ; SUP-011 → SUP-004.
- **Critères d'acceptation** : Given chaque trip, When la confirmation est envoyée, Then elle affiche les trois contacts (support, hôte par numéro masqué, assistance de l'assureur). Given un message hors plage, When il arrive, Then la réponse automatique part dans la langue du compte. Given les tickets, When on les mesure, Then le délai de première réponse est calculé (M6).
- **Source** : 10 §4 ; SRC_G 8.9 ; 12 §1.2 ; écrans 10b : S17, A02.
- **Confiance** : documenté (assistance Turo) ; organisation proposée.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SUP-004 SIMPLIFIÉ — plage réduite (ex. 8 h–20 h), hors plage renvoi vers l'assistance de l'assureur partenaire et vers l'hôte ; SUP-011 MANUEL — support humain es / en, réponses types dans un document partagé.
- **Complexité** : faible ; ops élevé ; risque moyen.
- **Améliorations possibles** : 24/7 et triage IA (15 IMP-07, P1).

#### Fiche SUP-020 — Plan de dotation du support et de l'exploitation
- **FEATURE ID** : SUP-020
- **Nom** : Plan de dotation du support et de l'exploitation
- **Module** : Back-office & exploitation (SUP — Dotation)
- **Persona** : fondateur ; responsable ops
- **Objectif** : ne publier aucune plage de support sans équipe pour la tenir.
- **Description** : prérequis opérationnel, pas un logiciel. 7 h–22 h, 7 j/7 = 105 h/semaine ≈ 2,6 ETP de présence (≈ 3 à 3,5 personnes) en plus de l'équipe de build ; charges récurrentes à chiffrer (KYC 4 h ouvrées, vérification des hôtes, revue des annonces, risque 2 h ouvrées, dommages entre particuliers et déclarations à l'assureur, rapprochement par jambe). Options : 8 h–20 h (84 h ≈ 2,1 ETP), sous-traitance, urgence hors plage confiée à l'assistance de l'assureur partenaire. Responsable ops nommé.
- **Déclencheur** : préparation de la mise en service.
- **Prérequis** : SUP-004.
- **Parcours principal** : plan → recrutement → planning → validation avant l'ouverture.
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
- **Bêta pilote** : MANUEL — planning de présence tenu par le responsable ops et validé avant l'ouverture ; aucun logiciel.
- **Complexité** : faible ; ops élevé ; risque moyen.
- **Améliorations possibles** : outil de planification.

#### Fiche ADM-033 — Revue de sécurité avant ouverture
- **FEATURE ID** : ADM-033
- **Nom** : Revue de sécurité avant ouverture
- **Module** : Back-office & exploitation (ADM — Sécurité)
- **Persona** : équipe ; prestataire
- **Objectif** : aucune vulnérabilité critique ou élevée à l'ouverture.
- **Description** : modèle de menaces (comptes, KYC et biométrie, webhooks PSP, identifiants du compte marchand de Kmino chez le PSP de place de marché, données des hôtes (adresse, KYC), interrupteurs de mise en service, console) ; revue ciblée OWASP ASVS niveau 2 (authentification, contrôle d'accès, téléversements, webhooks) ; test d'intrusion externe ou revue tierce ; portée PCI DSS (SAQ A) ; gestion des secrets ; isolation entre hôtes par RLS ; tests IDOR et RLS-1 à RLS-28 sous les rôles de production (17 §2.3).
- **Déclencheur** : lot 4 (avant l'ouverture).
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
- **Critères d'acceptation** : Given le rapport, When l'ouverture est décidée, Then 0 vulnérabilité critique ou élevée ouverte. Given un hôte connecté, When il demande un trip d'un autre hôte par son identifiant, Then la réponse est refusée (test IDOR). Given les tests RLS-1 à RLS-28, When ils tournent sous `app_api`, `app_worker` et `app_anon`, Then tous passent.
- **Source** : VERIF_10 V10-11, V10-05 ; 17 §2.3 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 4)
- **Bêta pilote** : SIMPLIFIÉ — revue ciblée interne (authentification, KYC, webhooks, secrets, interrupteurs) et tests RLS-1 à RLS-28 sous les rôles de production ; test d'intrusion externe avant l'ouverture élargie.
- **Complexité** : moyenne ; ops faible ; risque élevé.
- **Améliorations possibles** : bug bounty (P2).

#### Fiche ADM-034 — Préproduction et déploiement réversible
- **FEATURE ID** : ADM-034
- **Nom** : Préproduction et déploiement réversible
- **Module** : Back-office & exploitation (ADM — Environnements)
- **Persona** : équipe
- **Objectif** : tester sans données réelles et revenir en arrière.
- **Description** : dev, préproduction, production séparés (bases et stockages distincts) ; données synthétiques ou pseudonymisées (jamais de KYC réel) ; bacs à sable PSP et KYC ; adaptateurs `FAKE` jamais actifs en production (C19) ; interrupteurs de mise en service à `true` seulement en préproduction et en test ; gabarits de notification en mode test ; pipeline CI avec migrations versionnées ; retour arrière documenté.
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
- **Critères d'acceptation** : Given un déploiement en production, When il est lancé, Then il est passé par la préproduction. Given l'ouverture, When elle est demandée, Then un retour arrière a été exécuté au moins une fois. Given l'image de production, When un adaptateur `FAKE` y est déclaré, Then le service refuse de démarrer.
- **Source** : VERIF_10 V10-11 ; 17 §6.5 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ — une préproduction, déploiement scripté, retour arrière documenté.
- **Complexité** : moyenne ; ops faible ; risque faible.
- **Améliorations possibles** : environnements éphémères par branche.

## E13 — Légal, consentements, langues et pays (P0-A, 11 lignes)

#### Fiche LEG-001 / LEG-002 — CGU et consentements horodatés et versionnés
- **FEATURE ID** : LEG-001, LEG-002
- **Nom** : Acceptation des CGU (LEG-001) ; consentements horodatés et versionnés (LEG-002)
- **Module** : Légal, données & localisation (LEG — Consentements)
- **Persona** : tous
- **Objectif** : prouver, pour chaque trip, quelle version de chaque document a été acceptée par le voyageur et par l'hôte.
- **Description** : LEG-001 : case obligatoire à l'inscription et au checkout ; l'hôte accepte en plus les **CGU de l'hôte** avant sa première annonce. LEG-002 (absorbe LEG-003, LEG-004) : table consent(utilisateur, type, version, langue, accepted_at, ip, user_agent, contexte) ; documents versionnés : CGU du voyageur, CGU de l'hôte, confidentialité, consentement biométrique (VER-004), contrat de location hôte–voyageur (BKG-018), plan de protection et plan de gains choisis, opt-in marketing non pré-coché, messages WhatsApp / SMS transactionnels. Version majeure → ré-acceptation à la connexion suivante.
- **Déclencheur** : inscription, checkout, inscription comme hôte, signature, nouvelle version.
- **Prérequis** : ACC-001 (LEG-001) ; LEG-001 (LEG-002).
- **Parcours principal** : affichage de la version courante → acceptation → enregistrement.
- **Parcours alternatifs** : refus d'une nouvelle version majeure → accès limité (consultation des trips en cours, pas de nouvelle réservation ni de nouvelle annonce).
- **Règles métier** : BR-ACC-01.
- **États** : consent `GIVEN` / `WITHDRAWN` ; document_version `DRAFT` → `PUBLISHED` → `SUPERSEDED`.
- **Erreurs** : `TERMS_NOT_ACCEPTED`, `TERMS_REACCEPT_REQUIRED`.
- **Données** : consent ; legal_document(type, version, lang, published_at, hash).
- **Notifications** : `EVT_TERMS_UPDATED` (version majeure).
- **Permissions** : tous (acceptation) ; `ADMIN` (publication).
- **Dépendances** : LEG-001 → ACC-001 ; LEG-002 → LEG-001.
- **Critères d'acceptation** : Given un trip, When on consulte ses consentements, Then la version exacte de chaque document accepté par le voyageur et par l'hôte est retrouvée (NFR-17). Given une version majeure publiée, When le voyageur se reconnecte, Then `TERMS_REACCEPT_REQUIRED` avant toute réservation. Given un hôte qui n'a pas accepté les CGU de l'hôte, When il soumet une annonce, Then `TERMS_NOT_ACCEPTED`.
- **Source** : 06 Inscription ; 05 G-BOOK-01 ; 08 BR-ACC-01 reco ; écrans 10b : S05, S15, A07.
- **Confiance** : confirmé (LEG-001 OBSERVÉ) ; proposé (LEG-002).
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : LEG-001 OUI ; LEG-002 SIMPLIFIÉ — table de consentements versionnés, sans ré-acceptation forcée.
- **Complexité** : faible / moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : centre de préférences (P1).

#### Fiche LEG-009 / LEG-010 — Rétention, pseudonymisation, registre Ley 81
- **FEATURE ID** : LEG-009, LEG-010
- **Nom** : Rétention et pseudonymisation (LEG-009) ; registre des traitements et procédure de violation, Ley 81 (LEG-010)
- **Module** : Légal, données & localisation (LEG — Données personnelles)
- **Persona** : PER-07 (responsable des données)
- **Objectif** : conformité Ley 81/2019 (et Ley 7593/2025 au Paraguay) dès la première collecte biométrique.
- **Description** : LEG-009 : conservation légale des factures et pièces de sinistre, puis pseudonymisation ; durées prudentes en attendant OQ-BR-25 ; registres immuables effacés par crypto-shredding (destruction de la clé propre à la personne, ADR-026), jamais par modification ; l'adresse de l'hôte est retirée de la vue du voyageur à la fin du trip + `review_window_days`. LEG-010 : avant la première collecte en production, registre (finalités, bases légales, catégories dont biométrie, destinataires dont le PSP de place de marché et l'assureur partenaire, sous-traitants, transferts hors du pays et garanties, durées) ; responsable ou contact des données ; procédure de violation (détection, qualification, journal, notification à l'autorité et aux personnes, délais OQ-MK-09) reliée à ADM-035 ; clause de sous-traitance avec le fournisseur KYC ; registres `data_subject_request`, `security_incident` et `subprocessor` tenus avant la première collecte ; finalité **« remboursement par virement »** (coordonnées bancaires du voyageur collectées par Kmino pour un remboursement hors carte, jamais visibles de l'hôte) inscrite avec son responsable désigné (**UXQ-11 ouverte**). Validés par l'avocat.
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
- **Critères d'acceptation** : Given le registre non validé, When le KYC de production est activé, Then `KYC_PRODUCTION_BLOCKED_NO_REGISTER` (drapeau de configuration). Given un trip clos sans litige depuis la durée prévue, When la tâche s'exécute, Then les données sont pseudonymisées et la purge journalisée. Given un trip terminé depuis plus de `review_window_days`, When le voyageur ouvre le détail du trip, Then l'adresse exacte de l'hôte n'est plus affichée.
- **Source** : 08 BR-ACC-09 reco ; 12 §3.5 ; analyse pivot §e.5 (NOUVELLE-16) ; écrans 10b : S09, S14.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : LEG-009 SIMPLIFIÉ (chiffrement par clé de sujet dès le lot 0, destruction manuelle tracée) ; LEG-010 MANUEL — durées prudentes documentées, purge manuelle tracée ; registre et procédure tenus par le responsable des données.
- **Complexité** : moyenne / faible ; ops faible / moyen ; risque élevé.
- **Améliorations possibles** : droits des personnes en libre-service (LEG-005, P1).

#### Fiche LEG-011 / LEG-015 — Centre légal, litiges et droit applicable
- **FEATURE ID** : LEG-011, LEG-015
- **Nom** : Centre légal public (LEG-011) ; litiges et droit applicable (LEG-015)
- **Module** : Légal, données & localisation (LEG — Textes)
- **Persona** : tous
- **Objectif** : textes publics, versionnés, conformes au pays.
- **Description** : LEG-011 (absorbe I18N-010) : pages es / en versionnées par pays : CGU du voyageur, CGU de l'hôte, confidentialité, annulation, règles de location entre particuliers, mentions de l'assureur partenaire (PRT-013), non-discrimination, FAQ de bêta (SUP-001) ; textes par l'avocat. LEG-015 : droit du pays du trip (Panama ou Paraguay) ; médiation interne (ADM-008) puis voies externes (ACODECO ou SEDECO, tribunaux) ; **pas** de clause « définitive sans appel » ni d'arbitrage obligatoire avant OQ-BR-24 ; version acceptée rattachée à chaque trip.
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
- **Bêta pilote** : LEG-011 SIMPLIFIÉ — pages statiques CGU du voyageur et de l'hôte, confidentialité, annulation ; LEG-015 MANUEL — clause intégrée aux CGU statiques.
- **Complexité** : faible ; ops moyen / faible ; risque moyen.
- **Améliorations possibles** : historique des versions consultable.

#### Fiche LEG-014 — Positionnement d'intermédiaire entre particuliers
- **FEATURE ID** : LEG-014
- **Nom** : Positionnement d'intermédiaire entre particuliers
- **Module** : Légal, données & localisation (LEG — Qualification)
- **Persona** : tous
- **Objectif** : qualification réglementaire correcte de Kmino (art. 288, OQ-MK-01 ; qualification de la protection, OQ-BR-16).
- **Description** : Kmino est une place de marché **entre particuliers** : intermédiaire et **marchand de référence** pour l'encaissement (ADR-045), jamais bailleur ni partie au contrat de location, qui lie l'hôte et le voyageur (BKG-018) ; la protection est vendue par Kmino pour l'assureur partenaire, qui couvre (PRT-001, PRT-013). Mentions au checkout, au contrat, sur le reçu et dans les CGU ; positionnement inspiré de Turo, sans reprendre son texte ; formulation finale soumise aux avis OQ-MK-01 et OQ-BR-16.
- **Déclencheur** : affichage checkout, contrat, CGU, reçu.
- **Prérequis** : avis OQ-MK-01 (mise en service seulement).
- **Parcours principal** : mention fixe paramétrée par pays (texte validé).
- **Parcours alternatifs** : avis négatif dans un pays → pays non ouvert (interrupteurs ADM-027 à `false`), lancement dans l'autre pays (les deux sont construits, DEC-FONDATEUR-04).
- **Règles métier** : aucune BR ; TOS-GENERAL.
- **États** : —
- **Erreurs** : —
- **Données** : legal_document (mention).
- **Notifications** : —
- **Permissions** : `ADMIN`.
- **Dépendances** : aucune.
- **Critères d'acceptation** : Given le checkout, le contrat et le reçu, When ils sont rendus, Then la mention d'intermédiaire, l'identité de l'hôte (prénom et nom légal) comme partie au contrat et Kmino comme marchand de référence y figurent. Given le contrat de location, When il est généré, Then Kmino n'y figure pas comme bailleur.
- **Source** : TOS-GENERAL ; 17 ADR-045 ; écrans 10b : S03, S05.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : SIMPLIFIÉ — mention fixe au checkout, au contrat, sur le reçu et dans les CGU, texte par pays validé par l'avocat avant la mise en service.
- **Complexité** : faible ; ops faible ; risque élevé.
- **Améliorations possibles** : —

#### Fiche LEG-021 — Avertissements réglementaires locaux
- **FEATURE ID** : LEG-021
- **Nom** : Avertissements réglementaires locaux
- **Module** : Légal, données & localisation (LEG — Pays)
- **Persona** : PER-08 ; PER-01, PER-02
- **Objectif** : informer l'hôte et le voyageur des limites légales du partage de voiture entre particuliers dans leur pays, avant qu'ils s'engagent.
- **Description** : mentions par pays, versionnées, affichées à l'hôte (A01, A07, A10) et au voyageur (S03, S05) : au Panama, usage d'une voiture à plaque « particular » pour la location entre particuliers (OQ-BR-35) ; au Paraguay, statut fiscal de l'hôte et obligation de RUC selon l'avis (OQ-P2P-07, OQ-PAY-09) ; rappel que la protection est celle de l'assureur partenaire et que l'assurance personnelle de l'hôte peut exclure la location. Les mentions sont liées aux interrupteurs du pays (ADM-027) : tant que `p2p_private_hosts_enabled[pays]` vaut `false`, l'écran « devenir hôte » affiche que le pays n'est pas encore ouvert aux hôtes. Texte validé par l'avocat ; aucune constante de pays dans le code (contenu par pays).
- **Déclencheur** : ouverture d'A01, d'A07, de l'éditeur d'annonce, de la fiche voiture et du checkout.
- **Prérequis** : ADM-027 ; LEG-011.
- **Parcours principal** : lecture du pays → mention du pays en vigueur → acquittement par l'hôte dans sa liste de tâches (consentement LEG-002).
- **Parcours alternatifs** : mention absente pour un pays → l'inscription comme hôte est bloquée dans ce pays (fail-closed) ; nouvelle version → nouvel acquittement de l'hôte.
- **Règles métier** : aucune BR ; Règle de blocage de 08.
- **États** : legal_document(type = `LOCAL_NOTICE`) `DRAFT` → `PUBLISHED` → `SUPERSEDED`.
- **Erreurs** : `LOCAL_NOTICE_MISSING` (PROPOSÉ), `HOST_NOT_ACTIVATED`.
- **Données** : legal_document (par pays et par langue) ; consent (acquittement de l'hôte).
- **Notifications** : `EVT_TERMS_UPDATED` (nouvelle version).
- **Permissions** : public (lecture) ; `ADMIN` (publication).
- **Dépendances** : ADM-027.
- **Critères d'acceptation** : Given un hôte au Panama, When il ouvre sa liste de tâches, Then la mention sur la plaque « particular » est affichée en es ou en et doit être acquittée avant la soumission de la première annonce. Given un pays sans mention publiée, When un particulier commence l'inscription comme hôte, Then `LOCAL_NOTICE_MISSING` et l'inscription ne peut pas aboutir. Given `p2p_private_hosts_enabled[pays]` = `false`, When A01 est affiché, Then il indique que le pays n'est pas encore ouvert aux hôtes.
- **Source** : 04 LEG-021 ; 22 OQ-BR-35 ; écrans 10b : A01, A07, S03.
- **Confiance** : confirmé (avertissements locaux OBSERVÉS chez Turo) ; contenu par pays proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — une mention statique par pays et par langue sur A01, A07 et la fiche voiture, acquittée par l'hôte dans sa liste de tâches ; texte fourni par l'avocat.
- **Complexité** : faible ; ops faible ; risque élevé.
- **Améliorations possibles** : mentions par ville ou par type de véhicule.

#### Fiche I18N-003 / I18N-004 / I18N-005 — Espagnol et anglais, devises USD et PYG
- **FEATURE ID** : I18N-003, I18N-004, I18N-005
- **Nom** : Espagnol et anglais (I18N-003) ; devise USD (I18N-004) ; devise PYG sans décimale (I18N-005)
- **Module** : Légal, données & localisation (I18N — Langues et devises)
- **Persona** : tous
- **Objectif** : une expérience entièrement bilingue et des montants exacts dans les deux pays.
- **Description** : I18N-003 (absorbe I18N-006, 008, 009, 011) : es-PA, es-PY et en pour toutes les chaînes, notifications, contrats, pages légales, livrés **en même temps** ; langue choisie à l'inscription, sinon Accept-Language ; aucune chaîne en dur ; clé manquante = échec du build ; dates jj/mm/aaaa ; heures 24 h (es) / 12 h (en) ; km ; E.164 ; adresses sans code postal ; UTC + IANA `America/Panama` ou `America/Asuncion`. I18N-004 : USD en cents ; « US$ 1.234,56 » (es-PA) et « $1,234.56 » (en) ; arrondi par ligne (demi au supérieur) ; total = somme des lignes ; aucun taux de change. I18N-005 : PYG à exposant 0, aucune décimale stockée ni affichée, prix et forfaits saisis en PYG, arrondi d'affichage en multiples de 1 000 en paramètre pays. Les montants par jambe (08 E7) suivent les mêmes règles dans les deux devises.
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
- **Critères d'acceptation** : Given un écran en es, When le test automatisé le parcourt, Then aucune chaîne anglaise n'apparaît (et réciproquement). Given 1 234,56 US$, When affiché en es-PA, Then « US$ 1.234,56 » ; en en, « $1,234.56 ». Given TA01, When on additionne les lignes, Then 128,40 sur la fiche, le checkout, le contrat et le relevé. Given les vecteurs T48, T62 et TJ08a en PYG, When le règlement et les jambes sont calculés, Then les montants sont des entiers de PYG identiques aux attendus de 08 et le même parcours E2E passe en USD et en PYG.
- **Source** : 05 G-ACCOUNT-02 (9 locales observées) ; 08 Conventions, E7 ; TOS-GENERAL ; écrans 10b : S01, S02, S03, S14.
- **Confiance** : confirmé (I18N-003) ; documenté (I18N-004) ; proposé (I18N-005).
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ (I18N-003, I18N-004) — chaînes es / en limitées aux écrans et gabarits de la tranche ; format USD par langue ; OUI (I18N-005) — PYG construit tel que décrit.
- **Complexité** : moyenne / faible ; ops moyen / faible ; risque faible.
- **Améliorations possibles** : pt-BR (P2, visiteurs brésiliens au Paraguay).

## E14 — Versements aux hôtes et grand livre de l'hôte (P0-A, 4 lignes)

#### Fiche PYO-001 — Compte de versement de l'hôte et vérification
- **FEATURE ID** : PYO-001
- **Nom** : Compte de versement de l'hôte et vérification
- **Module** : Finance & facturation (PYO — Compte)
- **Persona** : PER-08 ; PER-06 ; PER-07
- **Objectif** : verser les gains de l'hôte sur un compte à son nom, vérifié avant le premier versement, ouvert chez le PSP comme sous-marchand.
- **Description** : compte bancaire ou portefeuille au nom de l'hôte, **personne physique** (BR-ACC-06 ; personne morale refusée), nom et cédula ou RUC concordants avec `host_verification` ; saisi à l'inscription (A07, comme chez Turo) et rattaché au sous-marchand du PSP (`registerSubmerchant`, KYC du PSP en plus du nôtre). Vérifié avant le premier versement ; changement de compte = reconnexion forte, nouvelle vérification et blocage 48 h (`change_hold_until`). Aucun hôte activable sans les capacités bloquantes du PSP du pays (17 §2.8, règle d'activation) ni si `p2p_private_hosts_enabled[pays]` ou `insurer_contract_active[pays]` vaut `false`. Au Paraguay, hôte sans RUC non activable tant qu'OQ-PAY-09 est ouverte (`p2p_host_requires_tax_id[pays]` = `true`, OQ-P2P-07). Un sous-marchand `SUSPENDED` chez le PSP suspend l'hôte chez nous (lots `ON_HOLD`, annonces `RESTRICTED`).
- **Déclencheur** : inscription de l'hôte ; modification du compte ; webhook du PSP sur le sous-marchand.
- **Prérequis** : VER-005 (identité de l'hôte).
- **Parcours principal** : saisie sur A07 → contrôle de concordance avec `host_verification` → `registerSubmerchant` → KYC du PSP → `psp_submerchant.kyc_status = ACTIVE` → compte `VERIFIED`.
- **Parcours alternatifs** : titulaire différent de l'hôte → refus ; KYC du PSP refusé → hôte non activable, motif affiché ; changement de compte → blocage 48 h des versements ; pays fermé → l'hôte voit `web.a07.waitingCountry`.
- **Règles métier** : BR-PAYOUT-01, BR-ACC-06.
- **États** : `payout_account.status` `PENDING` → `VERIFIED` / `REJECTED` ; `psp_submerchant.kyc_status` ; SM-6 (blocage).
- **Erreurs** : `PAYOUT_ACCOUNT_UNVERIFIED`, `PAYOUT_ACCOUNT_CHANGE_HOLD`, `HOST_PAYOUT_RAIL_UNAVAILABLE`, `HOST_TAX_ID_REQUIRED`, `HOST_ENTITY_NOT_ALLOWED`.
- **Données** : `payout_account`(org_id, country_code, currency, bank_code, account_number_enc, holder_name, holder_tax_id, verified_at, status, change_hold_until) ; `psp_submerchant` (17 §3.2.7, §3.2.9).
- **Notifications** : `EVT_HOST_VERIFICATION_DECISION` ; `EVT_HOST_ACTIVATED`.
- **Permissions** : `P2P_HOST` titulaire (`payout.manage_account` ; jamais un `CO_HOST`) ; `FINANCE`, `OPS_AGENT` (lecture masquée).
- **Dépendances** : VER-005.
- **Critères d'acceptation** : Given un compte dont le titulaire n'est pas l'hôte vérifié, When il est enregistré, Then refus et aucun sous-marchand créé. Given un changement de compte, When un versement est prévu dans les 48 h, Then il passe `ON_HOLD`. Given un hôte au Paraguay sans RUC et OQ-PAY-09 ouverte, When il demande l'activation, Then `HOST_TAX_ID_REQUIRED`. Given un sous-marchand passé `SUSPENDED` par le PSP, When le webhook est traité, Then l'hôte est suspendu, ses lots passent `ON_HOLD` et ses annonces `RESTRICTED`.
- **Source** : SRC_H §1.1 ; 08 BR-PAYOUT-01 ; 17 §2.8, §3.2.9 ; écrans 10b : A07, A08.
- **Confiance** : documenté (base Turo) ; sous-marchand proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ — saisie du compte à l'inscription et rattachement au sous-marchand du `FAKE` ; vérification de concordance par l'ops sur O01 ; blocage de 48 h automatique.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : vérification instantanée du compte par micro-dépôt (P1).

#### Fiche PYO-002 — Versements aux hôtes depuis la jambe HOST
- **FEATURE ID** : PYO-002
- **Nom** : Versements aux hôtes depuis la jambe `HOST` (lots par hôte, devise et type)
- **Module** : Finance & facturation (PYO — Rails)
- **Persona** : PER-08 ; PER-06
- **Objectif** : verser à l'hôte ses gains après le trajet, à date fixe, gelables en cas de litige.
- **Description** : le versement est exécuté **par le PSP**, sur ordre de Kmino, à partir des jambes `HOST` libérées (variante A : `releaseLeg` à `payout_at` puis `payout(host, amount)` ; variante B : ordre depuis le compte de Kmino, seulement si `funds_holding_enabled[pays]` = `true`). Calendrier (BR-PAYOUT-02, choix LATAM de 08 conservé, écart assumé avec Turo) : **J+2 ouvrés** après la fin, **premier versement à J+5** ; montant du lot = jambes `HOST` encaissées des trips du lot moins les ajustements de versement du `host_ledger` (pénalités, franchises, remboursements imputés, reprises ; 08 E7 règle 7). Lots par hôte, devise et type (`FINAL`, `CXL_EARNINGS`, `INVOICE_SHARE`). Gel `ON_HOLD` : litige, chargeback, réclamation ouverte, changement de compte, `payouts_enabled[pays]` = `false`. Rails du PSP : ACH Directo ou Xpress (plafond Xpress `ach_xpress_max_minor`) au Panama, SIPAP ou portefeuille au Paraguay.
- **Déclencheur** : `trip.checkout.completed` (fixe `payout_at`) ; lot quotidien.
- **Prérequis** : PYO-001, PAY-001.
- **Parcours principal** : `SCHEDULED` → `NETTING` → `READY` → `INITIATED` → `IN_TRANSIT` → `PAID`.
- **Parcours alternatifs** : litige ou chargeback → `ON_HOLD` ; rejet bancaire → `FAILED` → `ON_HOLD` ; net nul → `ZERO_NET` ; montant au-delà du plafond Xpress → fractionnement ou ACH Directo ; `payouts_enabled[pays]` = `false` → tous les lots du pays `ON_HOLD`.
- **Règles métier** : BR-PAYOUT-01, BR-PAYOUT-02, BR-PAYOUT-04 ; 08 E7 règles 6 et 7 ; SM-6.
- **États** : SM-6.
- **Erreurs** : `PAYOUT_ACCOUNT_UNVERIFIED`, `HOST_PAYOUT_RAIL_UNAVAILABLE`, `LEG_ALREADY_RELEASED`.
- **Données** : `payout_batch`(org_id, currency, kind, status, scheduled_for, gross_minor, netted_minor, net_minor, rail, idempotency_key) ; `payout_item`(trip_id, segment_id, leg = `HOST`, amount_minor) ; `trip_leg_balance.released_minor`.
- **Notifications** : `EVT_PAYOUT_SENT`, `EVT_PAYOUT_FAILED`, `EVT_PAYOUT_ON_HOLD`.
- **Permissions** : `SYSTEM` ; `FINANCE` (levée de gel motivée) ; `P2P_HOST` titulaire (lecture de ses lots, A08).
- **Dépendances** : PYO-001 ; PAY-001.
- **Critères d'acceptation** : Given le trip A réalisé aux jambes de TJ01 et terminé un lundi, When le lot est préparé, Then un lot `FINAL` de 131,25 USD est planifié à J+2 ouvrés (J+5 s'il s'agit du premier versement de l'hôte). Given une créance de 75,00 ouverte au `host_ledger` de cet hôte par TJ18b (jambe `HOST` déjà libérée), When son lot suivant est préparé, Then le lot porte la jambe `HOST` du trip (131,25, TJ01) et une ligne d'ajustement distincte de −75,00 (compensation SM-6b, règle 7), sans montant recalculé par la fiche ; une pénalité de l'hôte (25,00, TJ06) suit la même voie, hors jambes. Given le trip A réalisé et un chargeback ouvert puis perdu sur 256,66, When le litige est clos, Then aucune reprise sur l'hôte, le lot de 131,25 est dégelé et versé et toute la perte va à `PLATFORM` (TJ14b). Given `payouts_enabled[pays]` = `false`, When la tâche quotidienne s'exécute, Then aucun ordre de versement n'est émis et les lots restent `ON_HOLD`.
- **Source** : SRC_H §1.1 ; 08 BR-PAYOUT-01, 02, 04, E7 ; 12 §9.3 ; 17 §2.10, §3.2.9 ; écrans 10b : A08.
- **Confiance** : proposé (calendrier documenté chez Turo, J+2 / J+5 nôtre).
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — lots quotidiens par hôte calculés et ordonnés au `FAKE` ; en production, lots `ON_HOLD` tant que `payouts_enabled[pays]` = `false` ; levée de gel par FINANCE.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : versements partiels hebdomadaires (BR-PAYOUT-03, P1) ; rails alternatifs (PYO-017, P1).

#### Fiche PYO-003 — Versements aux particuliers (B2C) par le PSP
- **FEATURE ID** : PYO-003
- **Nom** : Versements B2C aux particuliers par le PSP de place de marché
- **Module** : Finance & facturation (PYO — Rails)
- **Persona** : PER-08 ; PER-06 ; PER-07
- **Objectif** : n'activer un hôte particulier que là où le PSP sait verser à un particulier dans la devise du pays.
- **Description** : versement d'un lot vers le compte bancaire ou le portefeuille d'une personne physique par `payout(host, amount)` ; capacité `SUPPORTS_B2C_PAYOUT` **par devise** (USD, PYG), **bloquante** (17 §2.8) : sans elle validée (`VALIDATED_*`), aucun hôte n'est activable dans ce pays (`HOST_PAYOUT_RAIL_UNAVAILABLE`). L'interrupteur `payouts_enabled[pays]` (absent = `false`, `false` en production tant que l'avis fiscal OQ-P2P-07 / OQ-PAY-09 manque) ferme tout versement : les lots restent `ON_HOLD` et l'hôte voit `web.a08.payoutsOff`. Le changement d'un interrupteur ne passe que par `config.cmd_request_go_live_switch` puis `config.cmd_approve_go_live_switch` (deux personnes, journal, jamais un agent ; DEC-FONDATEUR-15). Au Paraguay, hôte sans RUC non activable tant qu'OQ-PAY-09 est ouverte. Le PSP de chaque pays sort de la porte go / no-go du lot C (PAY-041).
- **Déclencheur** : demande d'activation d'un hôte ; lot de versement ; changement de capacité ou d'interrupteur.
- **Prérequis** : PYO-001.
- **Parcours principal** : lecture de `psp_capability` (`SUPPORTS_B2C_PAYOUT`, devise du pays) et de `payouts_enabled[pays]` → si validées : `payout` du lot `READY` → `INITIATED` → `PAID`.
- **Parcours alternatifs** : capacité `UNKNOWN` ou `DOCUMENTED` → traitée comme absente ; capacité retirée d'un PSP actif → lots `ON_HOLD`, nouvelles activations refusées, revue ops et FINANCE (08 E7 règle 3 bis) ; interrupteur à `false` → lots `ON_HOLD`, aucune perte de gains, versement à la réouverture.
- **Règles métier** : BR-PAYOUT-01, BR-PAYOUT-05 ; Règle de blocage de 08 ; SM-6.
- **États** : SM-6 (`ON_HOLD` tant que la capacité ou l'interrupteur manque).
- **Erreurs** : `HOST_PAYOUT_RAIL_UNAVAILABLE`, `UNSUPPORTED_CAPABILITY`, `HOST_TAX_ID_REQUIRED`.
- **Données** : `psp_capability`(provider, country_code, capability = `SUPPORTS_B2C_PAYOUT`, value par devise, status) ; `param_value` (`payouts_enabled`) ; `payout_batch`.
- **Notifications** : `EVT_PAYOUT_ON_HOLD` (hôte) ; alerte ops et FINANCE au retrait d'une capacité.
- **Permissions** : `SYSTEM` ; `ADMIN` (capacités) ; interrupteurs par `config.go_live_switch` sur décision écrite du fondateur seulement.
- **Dépendances** : PYO-001.
- **Critères d'acceptation** : Given un PSP dont `SUPPORTS_B2C_PAYOUT` vaut `UNKNOWN` en PYG, When un hôte paraguayen demande l'activation, Then `HOST_PAYOUT_RAIL_UNAVAILABLE` et l'hôte reste inactif. Given `payouts_enabled[pays]` absent de la configuration, When un lot `READY` est traité, Then il passe `ON_HOLD` et aucun appel `payout` n'est fait. Given une écriture directe de `payouts_enabled` hors des commandes dédiées, When elle est tentée, Then le trigger `param_value_go_live_guard` la refuse (RLS-27). Given la capacité retirée d'un PSP actif, When la configuration est rechargée, Then tous les lots du pays passent `ON_HOLD` et une alerte FINANCE est émise.
- **Source** : 08 BR-PAYOUT-01, Règle de blocage ; 17 §0.1, §2.8 ; analyse pivot §c.5 ; écrans 10b : A07, A08.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — capacité et interrupteur lus par pays depuis la configuration ; versements au `FAKE` en build ; en production, lots `ON_HOLD` tant que l'avis fiscal manque.
- **Complexité** : moyenne ; ops faible ; risque élevé.
- **Améliorations possibles** : choix du portefeuille de versement par l'hôte (P1).

#### Fiche PYO-007 — Grand livre de l'hôte, compensations et solde négatif
- **FEATURE ID** : PYO-007
- **Nom** : Grand livre de l'hôte (`host_ledger`), compensations, avances de Kmino et solde négatif
- **Module** : Finance & facturation (PYO — Grand livre)
- **Persona** : PER-06 ; PER-08
- **Objectif** : compenser pénalités, franchises, reprises et remboursements imputés sur les versements de l'hôte, sans jamais faire attendre le guest.
- **Description** : grand livre par hôte et par devise (`host_ledger_state` + `journal_line` du compte `host_ledger`) : jambe `HOST` des trips, pénalités d'annulation de l'hôte (BR-CXL-13, hors jambes), franchises de l'hôte selon son plan, remboursements imputés, reprises de chargeback (E5), créances de la règle 3 bis. Avant libération, chaque retenue est un **ajustement de versement** explicite (`adjustPayout`, `SUPPORTS_PAYOUT_ADJUSTMENT`) ; après versement, la reprise passe par les versements futurs de la même devise (`SUPPORTS_NEGATIVE_BALANCE_RECOVERY`, SM-6b), jamais par une écriture entre devises. Quand la jambe `HOST` est déjà libérée, Kmino avance la somme due au guest depuis la jambe `PLATFORM` du trip puis le solde `PLATFORM` du pays moins `platform_reserve_minor` (`platform_advance`, plafonné par `host_advance_cap_minor` ; solde insuffisant ⇒ ordre `PLANNED`, remboursement jamais réduit ; passage en perte seulement par FINANCE, deux personnes, `host_receivable_writeoff_days`). Solde négatif au-delà de 30 j ou d'un seuil ADM-031 : blocage des nouveaux versements et recouvrement (À DÉCIDER) ; aucune compensation entre une dette de l'hôte comme voyageur et ses gains sans accord écrit (OQ-P2P-09).
- **Déclencheur** : écritures FIN-001 ; règlement ; chargeback ; versement.
- **Prérequis** : FIN-001, PYO-002, ADM-031.
- **Parcours principal** : écriture → solde → compensation au versement suivant.
- **Parcours alternatifs** : reprise après chargeback (T53, T54, T55, TJ14a) ; créance de la règle 3 bis (TJ18) ; solde négatif durable → `DIRECT_DEBIT` → `PAYMENT_PLAN` / `COLLECTIONS` / `WRITTEN_OFF` ; plafond d'avance atteint → revue FINANCE (`finance.platform_advance`).
- **Règles métier** : BR-PAYOUT-04, BR-PAY-11, BR-CXL-13 ; 08 E1, E5, E7 règles 3 bis et 7.
- **États** : SM-6, SM-6b ; `platform_advance` `OPEN` → `RECOVERED` / `WRITTEN_OFF`.
- **Erreurs** : `LEG_ALREADY_RELEASED`, `UNSUPPORTED_CAPABILITY`.
- **Données** : `host_ledger_state`(org_id, currency, state, balance_minor, open_advances_minor) ; `journal_line` ; `platform_advance`(cause, amount_minor, funded_from, receivable_minor) ; `finance_approval` (17 §3.2.8, §3.2.9).
- **Notifications** : `EVT_HOST_BALANCE_NEGATIVE` ; `EVT_HOST_DEBT_OPENED`.
- **Permissions** : `FINANCE` (`finance.platform_advance`, double validation des avances hors plafond et des passages en perte) ; `P2P_HOST` titulaire (lecture de son solde, A08).
- **Dépendances** : FIN-001 ; PYO-002 ; ADM-031.
- **Critères d'acceptation** : Given T53, When un chargeback est perdu après le versement de 45,00, Then la reprise sur l'hôte vaut 45,00 (et non 166,85) et la ventilation porte `HOST` −45,00 et `PLATFORM` −211,66 (TJ14a). Given T54 (a) et (b), When le lot n'est pas émis puis est versé, Then reprise 0,00 puis 25,50. Given T55, When la capture est en USD pour un trip en PYG, Then reprise 220 752 PYG sans écriture entre devises. Given T41 exécuté avec 518 750 PYG déjà versés puis requalifié en FULL, When le complément de 850 367 PYG est ordonné, Then il est porté sur `PLATFORM` et une créance de 518 750 PYG est ouverte au `host_ledger` (TJ18c, TJ18d). Given un hôte dont `open_advances_minor` atteint `host_advance_cap_minor`, When une nouvelle avance est requise, Then l'ordre reste `PLANNED` et une demande FINANCE à deux validateurs est ouverte, sans réduire le remboursement dû.
- **Source** : TOS-HOST ; 08 BR-PAYOUT-04, E5, E7 ; 17 §2.9, §4.3 point 8 ; écrans 10b : A08.
- **Confiance** : documenté.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : SIMPLIFIÉ — grand livre de l'hôte, compensation au versement suivant et avances de la règle 3 bis automatisées ; recouvrement d'un solde négatif durable par l'ops et FINANCE, avec double validation.
- **Complexité** : élevée ; ops moyen ; risque élevé.
- **Améliorations possibles** : échéancier de remboursement proposé à l'hôte dans A08 (P1).

## E15 — Taxes collectées et rapprochement par jambe (P0-A, 2 lignes ; remontées par la révision 6 de 04)

#### Fiche FIN-004 — Collecte et reversement des taxes
- **FEATURE ID** : FIN-004
- **Nom** : Collecte et reversement de l'ITBMS (Panama) et de l'IVA (Paraguay)
- **Module** : Finance & facturation (FIN — Fiscalité)
- **Persona** : PER-06
- **Objectif** : remplir les obligations fiscales de Kmino, marchand de référence, sans jamais confondre sa propre taxe et celle d'un tiers.
- **Description** : Kmino collecte et reverse au fisc du pays (DGI au Panama, DNIT au Paraguay) la taxe sur **ses propres lignes** (trip fee, marge de protection, frais) : dette propre `tax_payable[pays][groupe]`, portée par la jambe `PLATFORM`. La taxe sur le loyer de l'hôte n'est collectée par Kmino que si l'avis OQ-BR-14 fait de lui le collecteur : groupe fiscal `third_party` = `true`, jambe `TAX_THIRD_PARTY`, compte `tax_third_party_payable`, reversée par `tax_remittance` ; **vide par défaut**. Une taxe pour compte de tiers n'est jamais réduite automatiquement par un chargeback (08 E7 règle 7). Affichage séparé au voyageur. Application exacte À VALIDER (OQ-BR-14, OQ-MK-06 ; bloque la mise en service, pas le build).
- **Déclencheur** : capture et règlement (montants) ; déclaration périodique.
- **Prérequis** : PRC-020.
- **Parcours principal** : taxe par ligne (PRC-020) → compte `tax_payable` ou `tax_third_party_payable` (FIN-001) → déclaration périodique → reversement.
- **Parcours alternatifs** : remboursement → taxe remboursée au prorata de la base remboursée (BR-CXL-06) ; chargeback → taxe tiers inchangée, perte portée par `PLATFORM` (TJ14).
- **Règles métier** : BR-PRICE-12, BR-PRICE-06, BR-CXL-06, BR-PAY-11.
- **États** : —
- **Erreurs** : `TAX_CONFIG_MISSING`.
- **Données** : tax_liability(country_code, period, group, third_party, collected_minor, refunded_minor, due_minor) ; tax_remittance.
- **Notifications** : —
- **Permissions** : `FINANCE`.
- **Dépendances** : PRC-020.
- **Critères d'acceptation** : Given T44 (deux groupes fiscaux), When le remboursement est réglé, Then taxe remboursée 8,80 et taxe retenue 5,40 (configuration de test). Given le trip J3 avec une taxe tiers de 100 000 annulé à T − 10 h, When le règlement est réglé, Then 66 667 de taxe tiers sont remboursés et 33 333 restent dus au fisc (TJ11b). Given une période, When elle est clôturée, Then la taxe à reverser de chaque groupe = taxe collectée − taxe remboursée, séparément pour `tax_payable` et `tax_third_party_payable`.
- **Source** : SRC_G 2.4.9 ; TOS-FEES (marketplace facilitator) ; 08 E7 ; écrans 10b : — (traitement serveur).
- **Confiance** : documenté (Turo collecte aux US) ; application au Panama et au Paraguay à valider.
- **Priorité produit** : P0-A (lot 2)
- **Bêta pilote** : MANUEL — déclaration et reversement par le comptable à partir de l'export des taxes par groupe et par jambe ; aucun groupe `third_party` tant qu'OQ-BR-14 est ouverte.
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : déclaration générée automatiquement (lot 5, US-710).

#### Fiche FIN-005 — Rapprochement PSP et banques par jambe
- **FEATURE ID** : FIN-005
- **Nom** : Rapprochement PSP et banques par jambe
- **Module** : Finance & facturation (FIN — Trésorerie)
- **Persona** : PER-06
- **Objectif** : vérifier chaque jour que ce que le PSP a crédité à chaque bénéficiaire égale ce que le règlement a calculé.
- **Description** : rapprochement quotidien, **par trip et par jambe**, entre le relevé du PSP de place de marché (encaissements, frais, remboursements, versements aux hôtes, crédits à l'assureur, variations de jambe) et `trip_leg_balance` / le grand livre (FIN-001) ; rapprochement du **bordereau de l'assureur** (`insurer_bordereau`, lignes par trip) avec la jambe `INSURER` ; contrôle des avances de Kmino (`platform_advance`). Écart → `reconciliation_item` et alerte FIN.
- **Déclencheur** : quotidien ; émission d'un bordereau.
- **Prérequis** : FIN-001.
- **Parcours principal** : import des relevés → appariement (référence d'opération, jambe, montant, date) → écarts → résolution motivée.
- **Parcours alternatifs** : écart non résolu sous 48 h → escalade `ADMIN` (PROPOSÉ) ; écart sur une jambe `HOST` non encore libérée → lot de versement de l'hôte `ON_HOLD` jusqu'à résolution.
- **Règles métier** : aucune BR propre ; contrôles de 08 E7 (règles 1, 10 et 11).
- **États** : reconciliation_run `RUNNING` → `MATCHED` / `DISCREPANCIES` → `CLOSED`.
- **Erreurs** : `RECON_STATEMENT_MISSING`, `RECON_FORMAT_INVALID`.
- **Données** : reconciliation_run(psp_account_id, source (PSP, BANK, INSURER), date, matched, unmatched, delta_pct_bps, status) ; reconciliation_item(run_id, trip_id, leg, expected_minor, observed_minor).
- **Notifications** : `EVT_RECON_DISCREPANCY` (finance), `EVT_INSURER_BORDEREAU_ISSUED`.
- **Permissions** : `FINANCE` (`finance.insurer_bordereau`).
- **Dépendances** : FIN-001.
- **Critères d'acceptation** : Given le trip A capturé et un relevé PSP qui crédite 131,25 à l'hôte, 25,50 à l'assureur et 99,91 à Kmino, When le rapprochement tourne, Then les trois jambes sont appariées sans écart (TJ01). Given un relevé où le PSP a ventilé le règlement de J au prorata, When le rapprochement tourne, Then un écart de 68 535 PYG est signalé sur la jambe `HOST` (TJ10c). Given un bordereau mensuel, When il est rapproché, Then sa somme égale la somme des jambes `INSURER` réglées des trips de la période.
- **Source** : 12 §9.12 ; 08 E7 ; 17 §2.9 ; écrans 10b : O01.
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 3)
- **Bêta pilote** : MANUEL — rapprochement quotidien par la finance : export des jambes par trip comparé au relevé du PSP et au bordereau de l'assureur dans un tableur ; automatisation au lot 5 (US-711).
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : rapprochement automatique par API du PSP.

## E16 — Fondations design, marque et contenus (P0-A, 7 lignes ; DEC-FONDATEUR-06 et 07)

> Aucun nom de marque ni style n'est figé dans le code : la marque est une donnée de thème (DSN-001). Toute valeur visuelle est une **donnée** publiée par le fondateur, jamais une constante du code (17 ADR-036). Le MVP est un web mobile-first avec PWA installable ; les applications natives sont hors MVP (17 ADR-039).

#### Fiche DSN-001 / DSN-002 / DSN-005 / DSN-006 / DSN-007 — Fondations design : identité, tokens, bibliothèque, PWA et revue
- **FEATURE ID** : DSN-001, DSN-002, DSN-005, DSN-006, DSN-007
- **Nom** : Naming et identité de marque (DSN-001) ; design tokens pilotés par les données (DSN-002) ; bibliothèque de composants et design system visible (DSN-005) ; web mobile-first responsive et PWA installable (DSN-006) ; revue UX/design indépendante et validation des écrans clés (DSN-007)
- **Module** : Design, marque & contenus (DSN — Identité, Thème, Design system, Plateforme cliente, Gouvernance design)
- **Persona** : fondateur (PER-07, rôle `ADMIN`) ; tous les personas pour le rendu
- **Objectif** : une identité choisie par le fondateur, appliquée partout sans code en dur, sur un web mobile-first installable, avec une qualité visuelle vérifiée par un relecteur indépendant (DEC-FONDATEUR-06, DEC-FONDATEUR-07).
- **Description** : DSN-001 : l'agent DESIGN propose des noms (domaine disponible, recherche d'antériorité de marque à faire valider au Panama, DIGERPI, et au Paraguay, DINAPI) puis des directions visuelles (logo, palette, typographies, ton) ; le fondateur choisit par écrit ; le résultat devient la première version publiée du thème ; `{brand_name}` reste un paramètre tant que l'antériorité n'est pas confirmée. DSN-002 : couleurs, typographies, rayons, espacements, ombres, logo et favicon sont des tokens lus depuis la version publiée `brand_version` (17 ADR-036), exposés en variables CSS, avec valeurs de repli embarquées ; contraste AA vérifié à la publication. DSN-005 : composants partagés (boutons, champs, carte voiture, prix TTC, étapes du checkout, cartes de l'espace hôte, états vides, erreurs, chargement) bâtis sur les tokens, documentés dans un catalogue consultable, captures de régression visuelle en CI. DSN-006 : conception d'abord à 360 px pour le voyageur **et pour l'hôte** (espace hôte utilisable à une main, remise et retour sur téléphone), puis tablette et desktop ; PWA installable (manifeste généré depuis le thème publié, icônes, service worker, écran hors ligne, file d'envoi des photos de TRP-057) ; aucune application native dans le MVP (17 ADR-039). DSN-007 : toute story visible est relue avant fusion par un relecteur UX/design indépendant de l'agent qui l'a codée (cohérence avec le design system, mobile-first, accessibilité AA, textes es / en, états d'erreur de 10b) ; les écrans clés sont validés par le fondateur au point hebdomadaire (DEC-FONDATEUR-10).
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
- **Critères d'acceptation** : Given un nom et une direction choisis par écrit par le fondateur, When la première version du thème est publiée, Then aucun nom ni couleur n'apparaît en dur dans le code (contrôle CI). Given une couleur primaire modifiée dans une version publiée, When une page est rechargée, Then toutes les pages l'affichent sans déploiement. Given une version au contraste insuffisant, When elle est soumise à publication, Then `BRAND_CONTRAST_INSUFFICIENT`. Given Android Chrome et iOS Safari, When l'audit PWA est exécuté, Then l'application est installable et les parcours E2E du voyageur et de l'hôte (remise et retour) passent sur un viewport mobile. Given une story visible sans rapport de revue design approuvé, When sa fusion est demandée, Then la porte CI la bloque.
- **Source** : DEC-FONDATEUR-06 et DEC-FONDATEUR-07 (23_RESEARCH_LOG, 2026-10-30) ; 17 ADR-036, ADR-039, ADR-040 ; écrans 10b : S01, S02, S03, S05, S06, A02, A03 (rendu thémé ; écrans clés soumis au fondateur).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : OUI (DSN-001, DSN-006, DSN-007) ; SIMPLIFIÉ (DSN-002 : un thème clair, tokens de couleur, typographie et logo ; DSN-005 : composants des écrans de la tranche des lots 0 à 4 seulement).
- **Complexité** : faible / moyenne / moyenne / moyenne / faible ; ops faible ; risque moyen (DSN-001, antériorité de marque) / faible.
- **Améliorations possibles** : mode sombre et variantes par pays ; applications natives (phase ultérieure, DEC-FONDATEUR-06).

#### Fiche DSN-003 / DSN-004 — Back-office « Apparence / Marque » et blocs de contenu éditables
- **FEATURE ID** : DSN-003, DSN-004
- **Nom** : Back-office « Apparence / Marque » (DSN-003) ; blocs de contenu éditables es / en (DSN-004)
- **Module** : Design, marque & contenus (DSN — Back-office, Contenus)
- **Persona** : fondateur (PER-07, rôle `ADMIN`)
- **Objectif** : le fondateur change l'apparence et les textes non juridiques quand il veut, sans développeur ni déploiement, avec retour arrière sûr (DEC-FONDATEUR-07).
- **Description** : DSN-003 : écran réservé au rôle `ADMIN` avec la permission `brand.publish` : nom de la marque, logo, palette, polices, images et textes d'accueil, gabarits email et WhatsApp ; prévisualisation en direct des écrans clés en mobile et desktop ; brouillon puis publication ; historique des versions (auteur, date, différences) ; retour arrière en un clic, qui crée une nouvelle version identique à la version choisie (jamais d'écrasement) ; chaque publication est journalisée (ADM-001). DSN-004 : textes marketing et d'aide non juridiques (accueil, « devenir hôte », bandeaux, FAQ courte, « comment ça marche » pour le voyageur et pour l'hôte) en blocs `content_block` par clé et par langue (es, en), avec brouillon, publication, versions et retour arrière ; un bloc absent dans une langue affiche la version es et est signalé. Les textes juridiques (CGU, contrat, politiques, avertissements LEG-021) et les montants ne sont **jamais** modifiables ici.
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
- **Source** : DEC-FONDATEUR-07 (23_RESEARCH_LOG, 2026-10-30) ; 17 ADR-036 ; écrans 10b : aucun (écran Apparence / Marque du back-office, O02 de 10b v3 ; prévisualisation des écrans S01, S02, S03, A01).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 1)
- **Bêta pilote** : SIMPLIFIÉ (les deux) — DSN-003 : logo, nom, palette, polices, image et texte d'accueil, prévisualisation, publication et retour arrière ; gabarits email et WhatsApp au lot 5 ; DSN-004 : blocs de l'accueil, de « devenir hôte » et de la FAQ courte, sans planification de publication.
- **Complexité** : élevée / moyenne ; ops faible ; risque moyen.
- **Améliorations possibles** : publication planifiée ; tests A/B de contenus (P2).

## E17 — Transmissibilité, qualité et gouvernance multi-agents (P0-A, 5 lignes, transverse ; DEC-FONDATEUR-05, 08, 09 et 10)

> Le build est fait par une équipe d'agents Claude Code ; le fondateur est le seul humain (DEC-FONDATEUR-05). Ces lignes sont transverses : elles s'appliquent à chaque story, et « documentation à jour » et « portes CI vertes » font partie de la Definition of Done.

#### Fiche PLT-001 / PLT-002 / PLT-003 — Transmissibilité : IaC, portabilité, comptes au nom du fondateur, documentation et passation
- **FEATURE ID** : PLT-001, PLT-002, PLT-003
- **Nom** : Infrastructure as Code, conteneurs et portabilité cloud (PLT-001) ; comptes, secrets et services au nom du fondateur (PLT-002) ; documentation de transmissibilité et checklist de passation (PLT-003)
- **Module** : Plateforme, qualité & transmissibilité (PLT — Portabilité, Comptes et secrets, Documentation)
- **Persona** : fondateur (PER-07) ; repreneur éventuel (développeur humain, autre IA, équipe sur son propre cloud)
- **Objectif** : pouvoir passer la main à tout moment sans perte (DEC-FONDATEUR-08).
- **Description** : PLT-001 : environnements (ADM-034) décrits en Infrastructure as Code et recréables depuis le dépôt ; services en conteneurs ; dépendances à un fournisseur cloud derrière un port (stockage objet, file, courriel, secrets) avec au moins un adaptateur de remplacement documenté ; export complet chiffré (base, objets, journaux d'audit) et restauration testée sur un autre compte (17 ADR-037). PLT-002 : chaque compte externe (cloud, domaine, dépôt, compte marchand du PSP de place de marché, KYC, e-facture, assureur partenaire, WhatsApp Business, courriel, monitoring) est ouvert au nom de l'entité du fondateur, propriétaire, les agents en accès délégué révocable ; registre versionné des comptes, variables et secrets (emplacement, propriétaire, rotation, jamais la valeur). PLT-003 : README, guide d'installation, conventions, ADR, contrat OpenAPI, schéma de base généré, inventaire PLT-002, runbooks (incident PSP, restauration, rotation de secrets, retour arrière, bascule d'un interrupteur de mise en service), stratégie de tests, procédure d'export et checklist de passation, tenus à jour par chaque story (17 §13).
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
- **Bêta pilote** : SIMPLIFIÉ (PLT-001 : IaC et conteneurs pour préproduction et production ; restauration sur un autre compte au lot 5) ; OUI (PLT-002, PLT-003).
- **Complexité** : moyenne / faible / moyenne ; ops faible ; risque moyen / élevé / faible.
- **Améliorations possibles** : exercice de passation annuel ; second fournisseur cloud actif.

#### Fiche PLT-004 / PLT-005 — Qualité et gouvernance multi-agents : stratégie de tests, portes CI, artefacts et revues
- **FEATURE ID** : PLT-004, PLT-005
- **Nom** : Stratégie de tests exhaustive et portes CI bloquantes (PLT-004) ; gouvernance multi-agents par artefacts versionnés (PLT-005)
- **Module** : Plateforme, qualité & transmissibilité (PLT — Qualité, Gouvernance)
- **Persona** : fondateur (PER-07) ; agents (orchestrateur, implémentation, vérificateurs, QA, DESIGN, red-team)
- **Objectif** : qualité « mission critique » sans développeur humain et avec une charge minimale pour le fondateur (DEC-FONDATEUR-05, DEC-FONDATEUR-09, DEC-FONDATEUR-10).
- **Description** : PLT-004 (17 §12, ADR-038) : unitaires ; intégration sur PostgreSQL réel ; contrats d'API ; E2E Playwright mobile et PWA ; parcours complets Panama / USD et Paraguay / PYG ; property-based et fuzz avec oracles monétaires (scripts de 08 : T01–T68, TJ01–TJ21, TA01–TA11) ; concurrence C1–C20 et L0-01 à L0-10 ; RLS-1 à RLS-28 sous les rôles de production ; tests fail-closed des interrupteurs de mise en service ; sécurité ; accessibilité ; régression visuelle ; charge ; résilience contre des adaptateurs `FAKE` hostiles (capacités présentes ou absentes) ; gabarits de notification ; migrations ; export et effacement ; portes CI bloquantes ; régression complète nocturne ; un agent QA indépendant de l'agent qui code écrit ou relit les tests d'acceptation ; chaque critère d'acceptation des fiches est tracé par identifiant de test. Les tests réduisent le risque sans prouver l'absence de bug : monitoring et triage après lancement (ADM-032). PLT-005 (17 §13, ADR-040) : orchestrateur, agents d'implémentation et vérificateurs indépendants (revue de code, QA, sécurité, logique monétaire sur un autre modèle, conformité d'architecture, design) communiquent par artefacts versionnés du dépôt (tableau des tâches, notes de passation, rapports de revue, registre des risques, registre des décisions avec valeur par défaut et date de décision, journal « comme Turo ») ; double revue pour l'argent, la sécurité et la réservation ; pré-mortem par lot ; red-team à chaque lot, y compris les fraudes entre particuliers, la jambe de l'assureur et les interrupteurs ; post-mortem par incident ; rapport de santé par session ; un point fondateur hebdomadaire regroupé (démo et 5 décisions au plus).
- **Déclencheur** : chaque fusion (portes CI) ; chaque nuit (régression) ; chaque lot (pré-mortem, red-team) ; chaque semaine (point fondateur).
- **Prérequis** : ADM-034 (PLT-004).
- **Parcours principal** : story → implémentation → tests → revue indépendante → portes CI vertes → fusion → rapport de santé ; décisions ouvertes regroupées au point hebdomadaire.
- **Parcours alternatifs** : porte rouge → fusion refusée ; décision non prise au point prévu → valeur par défaut de 22 appliquée et consignée ; question propre au P2P → solution de Turo appliquée, marquée PROPOSÉ et notée au journal « comme Turo » (DEC-FONDATEUR-16) ; désaccord entre agents → escalade à l'orchestrateur, puis au fondateur seulement pour une décision produit.
- **Règles métier** : toutes les BR testées par leurs vecteurs (08 T01–T68, TJ01–TJ21) ; aucune BR propre.
- **États** : revue `REQUESTED` → `APPROVED` / `CHANGES_REQUESTED` ; décision `OPEN` → `DEFAULT_APPLIED` / `DECIDED` (artefacts).
- **Erreurs** : —
- **Données** : suites de tests ; rapports CI ; tableau des tâches ; registres des risques et des décisions ; rapports de revue, de red-team, de pré-mortem et de post-mortem.
- **Notifications** : rapport hebdomadaire au fondateur ; alerte de régression nocturne (orchestrateur).
- **Permissions** : seul l'orchestrateur fusionne après revue indépendante et accord du fondateur ; le fondateur accepte la recette.
- **Dépendances** : PLT-004 → ADM-034 ; PLT-005 → aucune.
- **Critères d'acceptation** : Given une porte CI rouge, When la fusion est demandée, Then elle est refusée. Given une fusion touchant l'argent, la sécurité ou la réservation, When elle est proposée, Then deux revues indépendantes approuvées sont exigées, dont une sur un autre modèle pour l'argent et la RLS. Given chaque décision ouverte de 22, When le registre des décisions est lu, Then elle a une valeur par défaut et une date de décision. Given un critère d'acceptation d'une fiche P0, When la matrice de traçabilité des tests est générée, Then il est relié à au moins un identifiant de test.
- **Source** : DEC-FONDATEUR-05, DEC-FONDATEUR-09, DEC-FONDATEUR-10 (23_RESEARCH_LOG, 2026-10-30) ; 17 §11, §12, §13, ADR-038, ADR-040 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot 0)
- **Bêta pilote** : SIMPLIFIÉ (PLT-004 : unitaires, intégration, E2E des parcours de la tranche, C1–C20, RLS, oracles monétaires dont TJ ; charge, résilience et régression visuelle complètes au lot 5) ; OUI (PLT-005).
- **Complexité** : élevée / faible ; ops faible / moyen ; risque moyen.
- **Améliorations possibles** : tests de mutation ; chaos testing en préproduction.

## E18 — Connecteurs réels : lot C, après le choix du pays de lancement (P0-A, 4 lignes ; DEC-FONDATEUR-03, VERIF_18-F01)

> Chaque intégration externe se livre en deux temps : **port + adaptateur `FAKE`** dans le lot de sa ligne (lots 0 à 4, sans attendre aucune porte) ; **connecteur réel** au lot C, après le choix du pays de lancement et avant toute mise en service avec de vrais clients. Aucune ligne des lots 0 à 4 ne dépend d'une ligne du lot C (contrôle `tools/check_inventory.py`).

#### Fiche PAY-041 — Porte go / no-go du PSP de place de marché, par pays
- **FEATURE ID** : PAY-041
- **Nom** : Porte go / no-go du PSP de place de marché, par pays
- **Module** : Paiements (PAY — PSP)
- **Persona** : PER-07 ; fondateur
- **Objectif** : n'ouvrir un pays qu'avec un PSP de place de marché qui sait exécuter le modèle de Kmino (marchand de référence, hôtes sous-marchands, jambes explicites).
- **Description** : porte de mise en service du connecteur PSP réel, par pays (lot C : après le choix du pays de lancement, avant toute ouverture à de vrais clients ; DEC-FONDATEUR-02, 03, 04). Réponse écrite du PSP candidat sur **chaque capacité bloquante** de 17 §2.8 (sous-marchand particulier avec ou sans RUC `SUPPORTS_INDIVIDUAL_SUBMERCHANT`, montants par jambe `SUPPORTS_PER_LEG_AMOUNTS`, répartition multi-jambes, versement B2C en USD ou en PYG `SUPPORTS_B2C_PAYOUT`, libération différée, ajustement et réaffectation `SUPPORTS_PAYOUT_ADJUSTMENT`, reprise sur solde négatif, MIT, remboursement partiel) et compte de test ouvert. Candidats de 09b (dLocal Platforms, Bancard Marketplace, autres), tous NON VALIDÉS (OQ-PAY-04, OQ-PAY-08, OQ-PAY-20, OQ-PAY-21). Capacité inconnue = « non ». **Aucun plan B** avec encaissement par un tiers ou par l'hôte : à défaut, le pays n'ouvre pas. Les lots 0 à 4 se construisent contre l'adaptateur `FAKE` et n'attendent pas cette porte.
- **Déclencheur** : choix du pays de lancement par le fondateur.
- **Prérequis** : PAY-001.
- **Parcours principal** : questionnaire des capacités → réponses écrites et essais en sandbox → capacités `VALIDATED_*` dans `psp_capability` → décision par pays (PSP validé ou pays fermé) consignée → développement du connecteur réel (PAY-042).
- **Parcours alternatifs** : capacité bloquante absente → pays fermé (`p2p_private_hosts_enabled[pays]` reste `false`) ; capacité non bloquante absente → repli défini dans 17 §2.8 ; aucune réponse à la date fixée → pays fermé par défaut.
- **Règles métier** : aucune BR propre ; 08 E7 règles 1 et 10 (montants par jambe, jamais de prorata).
- **États** : décision de porte `OPEN` → `DECIDED_PSP` / `DECIDED_COUNTRY_CLOSED`, consignée en paramètre versionné et au journal d'audit ; capacités dans `psp_capability` (fail-closed).
- **Erreurs** : `PSP_GATE_NOT_DECIDED` (le connecteur réel ne peut pas être activé), `PSP_CAPABILITY_MISSING`.
- **Données** : decision_log(gate, country, decision, evidence_refs, decided_by, at) ; psp_capability(provider, country, capability, status).
- **Notifications** : —
- **Permissions** : `ADMIN` (consignation) ; décision du fondateur.
- **Dépendances** : PAY-001.
- **Critères d'acceptation** : Given la porte non décidée pour un pays, When un admin active le connecteur réel, Then `PSP_GATE_NOT_DECIDED`. Given `SUPPORTS_PER_LEG_AMOUNTS` inconnue pour le PSP d'un pays, When l'activation d'un hôte de ce pays est demandée, Then elle est refusée (`HOST_PAYOUT_RAIL_UNAVAILABLE`). Given l'image de production, When un adaptateur `FAKE` y est déclaré, Then le service refuse de démarrer (C19).
- **Source** : VERIF_10 V10-05 ; VERIF_18-F01 ; 09b §2.4, §5.2 ; 17 §2.8, ADR-045 ; analyse pivot §c.5 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot C)
- **Bêta pilote** : MANUEL — questionnaire des capacités envoyé par le fondateur au PSP candidat de chaque pays, réponses et essais consignés ; build contre l'adaptateur `FAKE` ; la porte est un critère de **mise en service** (17 C19).
- **Complexité** : moyenne ; ops moyen ; risque élevé.
- **Améliorations possibles** : second PSP validé par pays (PAY-020, P2).

#### Fiche PAY-042 / FIN-020 / VER-029 — Connecteurs réels du pays de lancement (PSP, facture électronique, KYC)
- **FEATURE ID** : PAY-042, FIN-020, VER-029
- **Nom** : Connecteur PSP réel du pays de lancement (PAY-042) ; connecteur réel de facture électronique du pays de lancement (FIN-020) ; connecteur réel du fournisseur KYC (VER-029)
- **Module** : Paiements (PAY — PSP) ; Finance & facturation (FIN — Fiscalité) ; Vérification (VER — Fournisseur)
- **Persona** : PER-07 ; PER-06
- **Objectif** : remplacer les adaptateurs `FAKE` par les services réels du pays retenu sans modifier le code métier.
- **Description** : PAY-042 : adaptateur réel du port `PaymentProvider` pour le PSP de place de marché retenu par la porte PAY-041, déclaré dans `psp_capability` : compte marchand de Kmino, hôtes sous-marchands (`psp_submerchant`), ordres à montants par jambe (`LegAmounts`), webhooks signés. FIN-020 : adaptateur réel du port fiscal (Panama : PAC agréé DGI ; Paraguay : SIFEN de la DNIT) derrière FIN-002 ou FIN-003, pour les factures du trip fee et de la marge de Kmino ; certificats au nom de l'entité du fondateur. VER-029 : adaptateur réel du port `IdentityProvider` (pièces du Panama et du Paraguay, permis étrangers), pour les voyageurs et les hôtes, sans copie biométrique conservée hors du fournisseur. Chaque connecteur passe la même suite de contrats que son `FAKE`, en sandbox puis en recette.
- **Déclencheur** : décision de la porte PAY-041 et choix du pays de lancement.
- **Prérequis** : PAY-001, PAY-019, PAY-034, PAY-041 (PAY-042) ; FIN-002, FIN-003 (FIN-020) ; VER-001 (VER-029).
- **Parcours principal** : sandbox du fournisseur → suite de contrats du port → recette → activation par pays.
- **Parcours alternatifs** : capacité absente → déclarée `false` dans `psp_capability`, repli défini par l'appelant ou pays fermé si la capacité est bloquante ; rejet de l'autorité fiscale → facture `DRAFT` avec motif ; fournisseur KYC indisponible → revue humaine dans la file KYC.
- **Règles métier** : BR-PAY-01 (PAY-042) ; BR-PRICE-12 (FIN-020) ; BR-VERIF-01 (VER-029).
- **États** : mêmes états que les ports (payment_operation, fiscal_document, identity_verification).
- **Erreurs** : `PSP_UNAVAILABLE`, `PSP_CAPABILITY_MISSING`, `LEG_SUM_MISMATCH`, `PAC_REJECTED`, `PAC_UNAVAILABLE`, `KYC_PROVIDER_UNAVAILABLE`.
- **Données** : psp_account, psp_capability, psp_submerchant, payment_operation_leg ; fiscal_document ; identity_verification (17).
- **Notifications** : `EVT_PSP_FAILURE` (ops).
- **Permissions** : `SYSTEM` ; `ADMIN` (activation par pays).
- **Dépendances** : PAY-042 → PAY-001, PAY-019, PAY-034, PAY-041 ; FIN-020 → FIN-002, FIN-003 ; VER-029 → VER-001.
- **Critères d'acceptation** : Given la suite de contrats d'un port, When elle est exécutée sur l'adaptateur `FAKE` puis sur le connecteur réel en sandbox, Then les résultats sont identiques. Given un ordre dont la somme des jambes diffère du montant, When il est envoyé au connecteur, Then `LEG_SUM_MISMATCH` et aucun appel au PSP. Given un webhook PSP à signature invalide, When il est reçu, Then il est rejeté et journalisé. Given une facture de trip fee de test, When elle est envoyée à l'environnement de test de l'autorité fiscale du pays retenu, Then elle est acceptée. Given une vérification KYC réelle, When elle se termine, Then aucune image biométrique n'est stockée hors du fournisseur.
- **Source** : DEC-FONDATEUR-03 ; VERIF_18-F01 ; 09b §5.2 ; 13 (SIFEN) ; 17 §2.8 ; écrans 10b : aucun (traitement serveur, outil interne ou page statique).
- **Confiance** : proposé.
- **Priorité produit** : P0-A (lot C)
- **Bêta pilote** : SIMPLIFIÉ (PAY-042 : un seul PSP de place de marché dans le pays de lancement, paiement par jambes + webhook) ; MANUEL (FIN-020 : facture émise par le comptable sur le portail du PAC ou de la DNIT ; VER-029 : revue humaine des pièces dans la file KYC).
- **Complexité** : élevée ; ops moyen ; risque élevé.
- **Améliorations possibles** : second PSP actif par pays (PAY-020, P2).

# PARTIE C — Lignes P1, P2, P3 et HORS PRODUIT (tableau compact)

Généré depuis `04_FEATURE_INVENTORY.csv` (**révision 6**, pivot P2P). Les epics E1 à E18 ne couvrent que le P0 : pour P1 à P3, la colonne « Epic » donne le **module** de 04 (le regroupement en epics est fait dans `19_DEVELOPMENT_BACKLOG.md`). Description = début de `description_courte` (tronquée à ~150 caractères, « … »). Aucune fiche complète pour ces lignes ; elles seront spécifiées avant leur phase. **Règle de lecture** : les **24 lignes `HORS`** de 04 (`phase_mvp` = `priorite_produit` = `HORS` depuis US-058) sont listées en C.4 : elles n'ont ni fiche ni story active (DEC-FONDATEUR-13 ; 19 §3.9) et les réintroduire serait une décision nouvelle du fondateur ; une description préfixée « (hist.) » reprend un libellé de 04 qui cite encore une agence, un loueur, un comptoir ou une flotte : ce libellé est **historique** et se lit « hôte » (04 README, règle de lecture de la révision 6, et colonne `notes`).


## C.1 — Phase P1 (327 lignes)

| feature_id | Nom | Epic (module) | Phase | Description (une ligne) | Dépendances clés |
|---|---|---|---|---|---|
| ACC-002 | Connexion / inscription Google (SSO) | ACC — Comptes & identité | P1 | Bouton « Continue with Google » à l'inscription et à la connexion. | ACC-001 |
| ACC-003 | Connexion / inscription Apple (SSO) | ACC — Comptes & identité | P1 | Bouton « Continue with Apple ». | ACC-001 |
| ACC-004 | Connexion par code à usage unique (SMS / WhatsApp) | ACC — Comptes & identité | P1 | Login sans mot de passe par code envoyé par SMS ou WhatsApp (repli SMS). | NTF-002 |
| ACC-005 | Authentification à deux facteurs (2FA) | ACC — Comptes & identité | P1 | Second facteur de connexion mentionné par la documentation. | ACC-004 |
| ACC-007 | Prénom d'usage (preferred first name) | ACC — Comptes & identité | P1 | Nom affiché choisi par l'utilisateur (surnom, identité de genre). | ACC-006 |
| ACC-009 | Correction du nom légal / date de naissance | ACC — Comptes & identité | P1 | Demande par formulaire, réponse sous 2–3 jours ouvrés. | ADM-005 |
| ACC-010 | Réservation sans compte préalable (checkout invité) | ACC — Comptes & identité | P1 | Le premier checkout collecte identité, contact, âge et paiement ; compte créé implicitement. | BKG-001 ; VER-013 |
| ACC-011 | Présélection de l'indicatif téléphonique par géo-IP | ACC — Comptes & identité | P1 | Indicatif et format de numéro pré-remplis selon le pays détecté (+507 observé). | — |
| ACC-013 | Mise à jour email, téléphone, mot de passe | ACC — Comptes & identité | P1 | Modification des coordonnées avec badges Verified. | VER-013 |
| ACC-015 | Graphe de comptes liés et refus définitif | ACC — Comptes & identité | P1 | Lien avec un compte banni = refus définitif ; graphe consulté à chaque réservation. | ACC-014 |
| ACC-017 | Profil public | ACC — Comptes & identité | P1 | Prénom d'usage, photo, date d'inscription, infos vérifiées, avis reçus. | — |
| ACC-018 | Édition du profil | ACC — Comptes & identité | P1 | Bouton Edit profile (photo et autres champs). | ACC-017 |
| ACC-019 | Badges d'informations vérifiées | ACC — Comptes & identité | P1 | Badges email et téléphone vérifiés sur le profil (« Build trust… »). | VER-013 |
| ACC-020 | Déclaration d'aptitude à la boîte manuelle | ACC — Comptes & identité | P1 | Question Oui/Non « expert en boîte manuelle ? » dans Account. | BKG-029 |
| ACC-021 | Statut d'approbation conducteur visible | ACC — Comptes & identité | P1 | Section « Approval status » (« You are approved »). | VER-009 |
| ACC-022 | Fermeture de compte en libre-service | ACC — Comptes & identité | P1 | Bouton « Close my account » ; annule les trips à venir avec frais normaux. | BKG-028 |
| ACC-023 | Garde-fous de fermeture | ACC — Comptes & identité | P1 | Impossible si réclamation en cours, solde dû ou < 72 h après la fin d'un trip. | ACC-022 ; ACC-025 |
| ACC-025 | Restrictions de compte (impayé, chargeback, échéancier) | ACC — Comptes & identité | P1 | Blocage des réservations/extensions tant qu'une dette, un chargeback ou un échéancier existe. | — |
| ACC-026 | Blocage silencieux guest ↔ hôte après note ≤ 3★ | ACC — Comptes & identité | P1 | Le guest noté ≤ 3★ ne peut plus réserver chez cet hôte, sans notification. | REV-002 |
| ACC-027 | Menu utilisateur connecté | ACC — Comptes & identité | P1 | Favorites, Trips, Inbox, Profile, Account, Earn, Gift cards, Get help, Legal, Log out. | — |
| ACC-028 | Menu hôte conditionnel | ACC — Comptes & identité | P1 | Les menus hôte apparaissent une fois une annonce créée. | HDB-001 |
| ACC-032 | Deep-link de retour après inscription | ACC — Comptes & identité | P1 | Paramètre next= ramène l'utilisateur à son action (ex. list-your-car). | ACC-001 |
| ACC-033 | Déconnexion et gestion de session | ACC — Comptes & identité | P1 | Lien Log out ; session persistante. | — |
| VER-009 | Screening à chaque réservation et en continu | VER — Vérification / KYC | P1 | Re-évaluation à la création, à chaque réservation, en continu ; approbation révocable. | ADM-011 |
| VER-010 | Délai de revue d'un compte en attente | VER — Vérification / KYC | P1 | Revue des documents généralement 24–48 h ; statut visible. | ADM-002 |
| VER-011 | Checklist post-réservation avec échéance | VER — Vérification / KYC | P1 | Confirmer téléphone, permis, choisir/refuser protection ; tout terminé à T−2 h. | — |
| VER-012 | Annulation automatique si checklist incomplète | VER — Vérification / KYC | P1 | Trip annulé par la plateforme avec remboursement partiel à T−2 h. | VER-011 |
| VER-014 | Re-vérification d'identité au check-in | VER — Vérification / KYC | P1 | Photo du permis (4 coins) + selfie à chaque trip ; photos réservées au check-in. | TRP-001 |
| VER-017 | Invitation et approbation de conducteurs additionnels | VER — Vérification / KYC | P1 | Jusqu'à 8, par lien ; chacun crée un compte, vérifie téléphone et permis. | VER-001 |
| VER-018 | Statut d'approbation des additionnels visible au principal | VER — Vérification / KYC | P1 | Approuvé / en attente / refusé, sans motif. | VER-017 |
| VER-019 | Exigences dynamiques selon le risque | VER — Vérification / KYC | P1 | Caution, autorisation, 2e moyen de paiement, protection minimale, documents ajoutés. | ADM-011 ; PAY-011 |
| VER-020 | Documents supplémentaires (passeport, justificatif de domicile, relevé) | VER — Vérification / KYC | P1 | Exigés pour classes chères, problème T&S ou comptes liés. | VER-019 |
| VER-022 | Interdiction pour l'hôte de collecter des documents | VER — Vérification / KYC | P1 | L'hôte ne peut rien collecter au-delà du permis ; la plateforme porte le KYC. | — |
| VER-023 | Notification de sanction et appel | VER — Vérification / KYC | P1 | Email citant la règle et la possibilité d'appel ; sans mention, décision définitive. | ADM-012 |
| VER-024 | Permis expirant pendant le trip | VER — Vérification / KYC | P1 | Copie à jour exigée avant le début. | VER-001 |
| VER-025 | Âge minimum selon la classe du véhicule | VER — Vérification / KYC | P1 | US 18/21/25/30 ans selon valeur et classe ; additionnels soumis aux mêmes seuils. | HST-021 |
| VER-026 | Expiration et révocation de l'approbation | VER — Vérification / KYC | P1 | États EXPIRED (permis expiré) et REVOKED (T&S, fraude) avec réouverture. | VER-009 |
| SRC-003 | Sélecteur d'heure par pas de 30 min | SRC — Recherche & découverte | P1 | Heures de Midnight à 11:30 PM par pas de 30 min. | SRC-001 |
| SRC-004 | Onglets de découverte (All / Airports / Monthly / Nearby / Delivered / Cities) | SRC — Recherche & découverte | P1 | Modes de découverte sous la barre de recherche. | SRC-001 |
| SRC-005 | Mode de recherche mensuel | SRC — Recherche & découverte | P1 | Prix /mois et dates mensuelles pré-calculées (searchDurationType, monthlyStartDate). | SRC-001 ; PAY-008 |
| SRC-006 | Recherche par aéroport (code IATA) | SRC — Recherche & découverte | P1 | Recherche « à » et « près de » l'aéroport, filtre de retrait. | SRC-002 |
| SRC-009 | Recherche en déplaçant la carte | SRC — Recherche & découverte | P1 | Paramètre isMapSearch : relance la recherche quand la carte bouge. | SRC-008 |
| SRC-010 | Compteur de résultats et état de fin de liste | SRC — Recherche & découverte | P1 | « 200+ cars available » ; message « No more cars… changez vos filtres ». | SRC-008 |
| SRC-013 | Barre de filtres rapides (chips) | SRC — Recherche & découverte | P1 | Price range, type, marque/modèle, années, sièges, consommation, carburant, livraison, self-driving, All filters. | SRC-008 |
| SRC-014 | Filtre de prix total hors taxes | SRC — Recherche & découverte | P1 | Minimum / maximum sur le prix total du séjour (pas le prix/jour). | SRC-013 |
| SRC-015 | Filtre par type de véhicule (2 niveaux) | SRC — Recherche & découverte | P1 | Catégorie → sous-type (berline, SUV compact, pick-up, fourgon…). | SRC-013 |
| SRC-016 | Filtres d'attributs véhicule | SRC — Recherche & découverte | P1 | Marque/modèle, années, sièges, consommation, transmission, carburant. | SRC-013 |
| SRC-017 | Filtre d'équipements (21 options) | SRC — Recherche & découverte | P1 | AWD, CarPlay, caméra, siège enfant, GPS, toll pass, pet friendly… | SRC-013 |
| SRC-018 | Filtre de kilométrage inclus | SRC — Recherche & découverte | P1 | Curseur « 100 mi/jour et plus ». | SRC-013 |
| SRC-019 | Filtre « livré à mon adresse » | SRC — Recherche & découverte | P1 | Toggle « Host brings the car to me » + champ adresse. | SRC-013 ; HST-034 |
| SRC-022 | Compteur live des résultats filtrés | SRC — Recherche & découverte | P1 | Bouton « View 200+ results » mis à jour selon les filtres. | SRC-013 |
| SRC-024 | Filtre « kilométrage illimité » | SRC — Recherche & découverte | P1 | Filtre absent chez Turo, demandé pour les road-trips. | SRC-013 |
| SRC-025 | Filtres spécifiques LATAM | SRC — Recherche & découverte | P1 | 4x4/tracción, doble cabina, paiement Yappy, livraison PTY, sortie de territoire (phase 2). | SRC-013 |
| SRC-026 | Âge du conducteur dans la recherche | SRC — Recherche & découverte | P1 | Paramètre age (défaut 30) qui conditionne prix et éligibilité. | VER-025 |
| SRC-027 | Recherches récentes sans connexion | SRC — Recherche & découverte | P1 | « Continue searching for cars » (lieu + dates de la dernière recherche). | SRC-001 |
| SRC-030 | Classement « Relevance » | SRC — Recherche & découverte | P1 | Paramètres, localisation, prix, livraison, notes, commitment rate, All-Star ; ML ; MAJ ~5 min. | REV-010 |
| SRC-031 | Pas d'annonces sponsorisées | SRC — Recherche & découverte | P1 | Aucun classement payant (règle publiée). | SRC-030 |
| SRC-032 | Masquage des véhicules non réservables pour l'utilisateur | SRC — Recherche & découverte | P1 | Véhicules incompatibles (âge, restriction, hôte bloquant) masqués ou marqués indisponibles. | BKG-017 |
| SRC-033 | Pages SEO de catalogue | SRC — Recherche & découverte | P1 | Catégorie × pays/ville, marque, modèle, aéroport, état ; index /makes /airports. | — |
| SRC-034 | URL de recherche normalisée et partageable | SRC — Recherche & découverte | P1 | Tous les paramètres de recherche dans l'URL. | SRC-001 |
| SRC-035 | Page d'accueil avec carrousels thématiques | SRC — Recherche & découverte | P1 | Carrousels aéroport, mensuel, luxe, marque, ville avec prix moyen/jour et total. | SRC-011 |
| SRC-040 | Attribution recherche → réservation (searchId) | SRC — Recherche & découverte | P1 | searchId et searchRegion propagés de la recherche à la fiche. | SRC-008 |
| SRC-041 | Prix « all-in » incluant la livraison aéroport | SRC — Recherche & découverte | P1 | En recherche aéroport, le prix affiché inclut la livraison. | PRC-017 |
| LST-001 | URL SEO de fiche véhicule et titre | LST — Fiche véhicule | P1 | /{pays}/{lang}/{catégorie}/{lieu}/{marque}/{modèle}/{id} ; title marque-modèle-ville-hôte. | — |
| LST-004 | Chips de caractéristiques | LST — Fiche véhicule | P1 | Sièges, carburant, consommation, boîte. | — |
| LST-009 | Trip Savings (remise de durée affichée) | LST — Fiche véhicule | P1 | Remise « 3 jours ou plus » visible avant le checkout. | PRC-008 |
| LST-014 | Signaler une annonce (Report listing) | LST — Fiche véhicule | P1 | Lien de signalement présent sur chaque fiche. | — |
| LST-015 | Équipements groupés par catégorie | LST — Fiche véhicule | P1 | Sécurité, connectivité, commodité, autres ; « See all N features ». | HST-011 |
| LST-016 | Bloc « Included with your trip » | LST — Fiche véhicule | P1 | (hist.) Sans comptoir, conducteurs ajoutables, fenêtre 2 h, pas de lavage, assistance 24/7. | — |
| LST-017 | Fenêtre de retrait de 2 heures | LST — Fiche véhicule | P1 | Pas besoin de modifier le trip sauf retard > 2 h. | TRP-014 |
| LST-018 | Liste des Extras sur la fiche | LST — Fiche véhicule | P1 | Nom, description, prix par trip, quantité disponible. | HST-031 |
| LST-019 | Avis sur la fiche | LST — Fiche véhicule | P1 | Note, nombre de notes, extraits, réponse publique de l'hôte, « See more ». | REV-001 |
| LST-021 | Règles de conduite (Rules of the road) | LST — Fiche véhicule | P1 | Non-fumeur 150 $, propreté 150 $, carburant, pas de tout-terrain. | — |
| LST-022 | Mention de télématique / collecte de données | LST — Fiche véhicule | P1 | Le véhicule peut collecter conduite et localisation partagées avec des tiers. | LEG-017 |
| LST-023 | Barre sticky prix + CTA | LST — Fiche véhicule | P1 | Barre fixe en bas d'écran mobile : total TTC du devis courant (PRC-025), prix barré si remise, bouton « Continuar ». Composant partagé avec le checkou… | BKG-001 |
| LST-024 | Véhicules similaires pour vos dates | LST — Fiche véhicule | P1 | Carrousel du même modèle ou similaires avec total du séjour. | SRC-030 |
| LST-026 | Zones de circulation exclues affichées | LST — Fiche véhicule | P1 | Zones interdites (Darién, routes non revêtues) visibles avant réservation. | TRP-043 |
| LST-027 | Interdiction de sortie du territoire affichée | LST — Fiche véhicule | P1 | Mention claire (Paso Canoas / Costa Rica) sur la fiche et au checkout. | BKG-023 |
| LST-028 | Frais de parking au retrait affichés | LST — Fiche véhicule | P1 | Champ structuré sur le lieu, visible avant réservation. | HST-034 |
| BKG-004 | Sélection des Extras (stepper borné par stock) | BKG — Réservation & checkout | P1 | Panneau par catégorie, quantité − 0 +, option « I don't want any extras ». | HST-031 |
| BKG-005 | Choix tarif remboursable / non remboursable | BKG — Réservation & checkout | P1 | Deux tarifs avec politiques d'annulation différentes. | — |
| BKG-007 | Saisie d'un code promo | BKG — Réservation & checkout | P1 | Lien « Ajouter un code promo » dans le résumé. | MKT-004 |
| BKG-009 | Bandeau de vérification post-réservation | BKG — Réservation & checkout | P1 | Avertit qu'il faudra fournir des informations sous peine d'annulation et de frais. | VER-011 |
| BKG-010 | Book Instantly universel | BKG — Réservation & checkout | P1 | Acceptation automatique de toute réservation compatible avec les réglages. | CAL-001 |
| BKG-013 | Pas de chevauchement de trips pour un guest | BKG — Réservation & checkout | P1 | Un guest, un véhicule à la fois ; pas de réservation pour autrui. | BKG-012 |
| BKG-015 | Remboursement automatique si la réservation échoue | BKG — Réservation & checkout | P1 | Paiement libéré/remboursé automatiquement sous 20 min. | BKG-014 |
| BKG-017 | Pas de one-way à la réservation | BKG — Réservation & checkout | P1 | Lieu de retour différent seulement après réservation, dans les options de l'hôte. | TRP-026 |
| BKG-020 | Trips > 30 jours en segments de 30 jours | BKG — Réservation & checkout | P1 | Renouvellement automatique de segments avec contrat propre. | — |
| BKG-021 | Calcul des jours facturables | BKG — Réservation & checkout | P1 | Tranche de 24 h entamée = 1 jour ; [NOUS] tolérance 59 min. | PRC-025 |
| BKG-024 | Numéro de vol au checkout et suivi | BKG — Réservation & checkout | P1 | Partage des infos de vol avec l'hôte ; [NOUS] suivi automatique par API. | TRP-012 |
| BKG-026 | Liste des trips à venir et historique | BKG — Réservation & checkout | P1 | Page Trips (/trips, /trips/history) avec état vide et CTA. | — |
| BKG-029 | Affichage de l'heure exacte de fin de gratuité | BKG — Réservation & checkout | P1 | Date/heure de fin d'annulation gratuite sur le reçu et l'écran d'annulation. | BKG-028 |
| BKG-030 | Grâce de 24 h sur tarif non remboursable | BKG — Réservation & checkout | P1 | Remboursement intégral 24 h après réservation, puis rien (caution libérée). | BKG-005 |
| BKG-031 | Annulation « mon hôte ne répond pas » | BKG — Réservation & checkout | P1 | Motif dédié ; un agent recontacte sous 48 h. | SUP-004 |
| BKG-033 | Revue automatique « uncomfortable with this trip » | BKG — Réservation & checkout | P1 | Annulation hôte pour sécurité/harcèlement envoyée en revue automatique au support. | ADM-008 |
| BKG-034 | Annulation d'un commun accord | BKG — Réservation & checkout | P1 | Remboursement intégral si accord prouvé ; l'hôte ne touche rien. | MSG-001 |
| BKG-036 | Rebooking assisté « Book another car » | BKG — Réservation & checkout | P1 | Lien vers véhicules similaires ; fonds disponibles 24 h comme crédit de rebooking. | LST-024 |
| BKG-038 | Exceptions pour circonstances exceptionnelles | BKG — Réservation & checkout | P1 | Décès, maladie, obligation légale, catastrophe ; sur demande au support avec justificatif. | ADM-008 |
| BKG-039 | Retard ou annulation de vol / train | BKG — Réservation & checkout | P1 | Prévenir l'hôte, demander une modification, justificatif ≤ 24 h après le début. | TRP-020 |
| BKG-040 | Le guest doit refuser d'annuler à la place de l'hôte | BKG — Réservation & checkout | P1 | Demande d'annulation par l'hôte traitée comme annulation hôte. | MSG-007 |
| PAY-005 | Carte « garantissable » obligatoire | PAY — Paiements | P1 | Une carte reste exigée même si un crédit/carte cadeau/BNPL couvre 100 %. | PAY-002 |
| PAY-008 | Pay as you go (trips > 30 jours) | PAY — Paiements | P1 | Versements égaux tous les 30 jours ; échec = trip raccourci. | BKG-020 ; PAY-015 |
| PAY-022 | Remboursement Yappy/QR par virement ou crédit | PAY — Paiements | P1 | Le guest choisit d'avance crédit immédiat ou virement ACH vers un compte à son nom. | PAY-004 |
| PAY-023 | Remboursement converti en crédit voyage | PAY — Paiements | P1 | Quand le moyen d'origine ne peut être remboursé. | MKT-002 |
| PAY-025 | Paiement des factures et soldes impayés in-app | PAY — Paiements | P1 | Page de paiement d'une facture ou d'un solde ; blocage tant que non payé. | ACC-025 |
| PAY-026 | Échéancier de paiement (payment plan) pour dettes | PAY — Paiements | P1 | Frais annexes et dommages en plusieurs échéances, sans intérêts ni frais ; confirmé par email. | PAY-025 |
| PAY-027 | Relances puis recouvrement | PAY — Paiements | P1 | (hist.) Plusieurs relances sur quelques semaines puis agence de recouvrement. | — |
| PAY-028 | Gestion des chargebacks | PAY — Paiements | P1 | Restriction immédiate du compte ; dossier de contestation auto (contrat, photos, GPS, messages). | ACC-025 ; ADM-008 |
| PAY-029 | Reçu détaillé du trip | PAY — Paiements | P1 | Reçu in-app mis à jour à chaque frais ou remboursement. | FIN-002 |
| PAY-031 | Échec d'un segment mensuel → raccourcissement | PAY — Paiements | P1 | Trip raccourci à la fin du segment payé + procédure non-restitution si besoin. | PAY-008 ; TRP-038 |
| PRC-002 | Prix personnalisés par date, plage ou ensemble de dates | PRC — Tarification | P1 | Prix spécifiques (week-end, saisons, fêtes) sur un ou plusieurs véhicules. | PRC-001 |
| PRC-008 | Remises de durée (3 j, 1, 2, 3 semaines, 1 mois) | PRC — Tarification | P1 | (hist.) Remises facultatives configurées par l'agence par palier (≥ 3 j, ≥ 7 j, ≥ 14 j, ≥ 30 j), en %, croissantes d'un palier au suivant, plafond 60 % ; appl… | PRC-001 |
| PRC-010 | Remise non remboursable 10 % (≥ 4 jours) | PRC — Tarification | P1 | Remise fixe intégrée à la ligne de base (−10 % du net). | BKG-005 |
| PRC-011 | Règle de cumul des remises | PRC — Tarification | P1 | Additive (10 % + 5 % = 15 %) vs séquentielle : deux versions chez Turo. | PRC-008 ; PRC-010 |
| PRC-013 | Trip fee nul pour trips ≥ 30 jours | PRC — Tarification | P1 | Supprimé pour les longues durées depuis 03/2025 (hors LA/NY). | PRC-012 |
| PRC-014 | Frais jeune conducteur | PRC — Tarification | P1 | 18–20 et 21–24 ans ; variables selon la durée ; non remboursables après trip. | VER-025 |
| PRC-015 | Frais de conducteur additionnel | PRC — Tarification | P1 | 5 $/jour plafonné à 25 $ par trip, sur la durée totale. | VER-017 |
| PRC-016 | Frais de livraison par lieu et livraison gratuite conditionnelle | PRC — Tarification | P1 | Gratuite ou payante jusqu'à un maximum par lieu ; gratuite au-delà d'une durée. | HST-034 |
| PRC-017 | Frais d'aéroport en pass-through | PRC — Tarification | P1 | Frais fixés par l'aéroport reversés sans marge (permit fee, concession recovery…). | ADM-019 |
| PRC-019 | Tarif du kilomètre supplémentaire calculé et figé | PRC — Tarification | P1 | Prix journalier ÷ distance journalière incluse, figé dans la réservation. | HST-033 |
| PRC-022 | Frais administratifs sur frais annexes | PRC — Tarification | P1 | 3 % ajoutés aux frais annexes traités par la plateforme. | CLM-019 |
| TRP-001 | Ouverture du check-in à T−24 h | TRP — Cycle de vie du trip | P1 | Le check-in devient possible 24 h avant le début. | BKG-022 |
| TRP-003 | Photos du véhicule au départ par le guest | TRP — Cycle de vie du trip | P1 | ≥ 15 extérieures et 8 intérieures + carburant + compteur, métadonnées, fenêtres 24 h. | TRP-002 |
| TRP-005 | Photos avant trip par l'hôte | TRP — Cycle de vie du trip | P1 | Photos de l'hôte, condition de toute réclamation. | TRP-004 |
| TRP-006 | Checklist de conformité du véhicule | TRP — Cycle de vie du trip | P1 | Immatriculation, assurance, carte d'incident à bord ; motifs de refus. | TRP-002 |
| TRP-008 | Modes de remise des clés | TRP — Cycle de vie du trip | P1 | En personne, boîte à clés, déverrouillage via app constructeur (clé physique à bord). | TRP-011 |
| TRP-011 | Instructions de retrait et de retour | TRP — Cycle de vie du trip | P1 | Envoyées par l'hôte après réservation (message programmé). | MSG-005 |
| TRP-012 | Emplacement exact aéroport et guidage | TRP — Cycle de vie du trip | P1 | Parking + photo affichés 1 h avant ; guidage in-app du terminal à la voiture. | ADM-019 |
| TRP-014 | Fenêtre de grâce et no-show guest | TRP — Cycle de vie du trip | P1 | No-show après 2 h (US) ; attente de 15 min après message de l'hôte. | TRP-015 |
| TRP-016 | Déclaration de no-show hôte par le guest | TRP — Cycle de vie du trip | P1 | Hôte/véhicule absent 30 min → annulation hôte + pénalité ; bouton « Anfitrión no llegó ». | BKG-036 |
| TRP-017 | Bouton « je suis en retard » | TRP — Cycle de vie du trip | P1 | Notifie l'hôte et étend la fenêtre de 30 min une fois. | TRP-014 |
| TRP-018 | Seul le conducteur principal retire et rend | TRP — Cycle de vie du trip | P1 | Envoyer quelqu'un d'autre = no-show ; non-approuvé = protection annulée. | VER-014 |
| TRP-020 | Demande de modification « Change trip » | TRP — Cycle de vie du trip | P1 | Dates, heures, lieu, durée ; accord hors app non valable. | BKG-027 |
| TRP-021 | Approbation automatique ou demande à l'hôte | TRP — Cycle de vie du trip | P1 | Auto si compatible ; sinon hôte 8 h (lieu) / 12 h (extension) ; silence = refus. | TRP-020 |
| TRP-022 | Extension de trip | TRP — Cycle de vie du trip | P1 | Avant, pendant, jusqu'à 24 h après la fin ; efface le retard ; prix et protection recalculés. | TRP-021 ; PRC-025 |
| TRP-023 | Extension en conflit : alternatives | TRP — Cycle de vie du trip | P1 | Proposer l'extension maximale ou un autre véhicule pour les jours restants. | TRP-022 |
| TRP-024 | Fin anticipée et raccourcissement | TRP — Cycle de vie du trip | P1 | ≤ 3 h : accord par message sans remboursement ; au-delà : demande système (12 h). | TRP-021 |
| TRP-025 | Recalcul et remboursement des différences | TRP — Cycle de vie du trip | P1 | Baisse de prix sur trip remboursable remboursée automatiquement. | PRC-025 |
| TRP-026 | Changement de lieu | TRP — Cycle de vie du trip | P1 | Réponse de l'hôte sous 8 h ; changement du seul retour = 50 % + 50 % des frais. | TRP-021 |
| TRP-027 | Échange de véhicule (swap) avant le trip | TRP — Cycle de vie du trip | P1 | Une fois, classe égale ou inférieure, conditions inchangées ; refus = remboursement intégral. | BKG-027 |
| TRP-028 | Swap pendant le trip | TRP — Cycle de vie du trip | P1 | Accord mutuel par message puis appel au support. | TRP-027 |
| TRP-029 | Changement de protection jusqu'au début | TRP — Cycle de vie du trip | P1 | Ajout, changement ou retrait avant l'heure de début. | PRT-001 |
| TRP-030 | Ajout/retrait d'Extras jusqu'au début | TRP — Cycle de vie du trip | P1 | Sans accord de l'hôte ; Extra non fourni remboursé. | BKG-004 |
| TRP-034 | Relevé carburant et compteur par OCR | TRP — Cycle de vie du trip | P1 | Lecture automatique du compteur et de la jauge en huitièmes. | TRP-033 |
| TRP-036 | Signalement du retard par l'hôte | TRP — Cycle de vie du trip | P1 | Après 30 min, sous 24 h ; revue support 48 h. | TRP-035 |
| TRP-037 | Alerte au guest suivant et swap prioritaire | TRP — Cycle de vie du trip | P1 | À fin + 30 min sans check-out, alerte et proposition de swap. | TRP-027 |
| TRP-039 | Retour non conforme | TRP — Cycle de vie du trip | P1 | Frais (50 $ + 3 %) si lieu, clé, lockbox ou réponse sous 2 h non respectés. | TRP-033 |
| TRP-040 | Zones de retour aéroport | TRP — Cycle de vie du trip | P1 | Liste affichée 24 h après le début, rappel 24 h avant la fin. | TRP-012 |
| TRP-041 | Fin du trip par la plateforme et récupération | TRP — Cycle de vie du trip | P1 | La plateforme peut mettre fin au trip et récupérer le véhicule. | ADM-006 |
| TRP-042 | Suivi GPS / télématique et règles des traqueurs | TRP — Cycle de vie du trip | P1 | GPS autorisé, AirTags interdits, caméra/audio avec consentement écrit. | LEG-017 |
| TRP-043 | Géofencing frontières et zones exclues | TRP — Cycle de vie du trip | P1 | Alertes près de Paso Canoas, Guabito, Río Sereno et zones exclues. | TRP-042 |
| TRP-046 | Fenêtres post-trip | TRP — Cycle de vie du trip | P1 | Dommage 24 h, factures 72–120 h, dépôt 80 h (valeur Turo, non reprise : 72 h, PAY-012), avis 10 j avant clôture. | TRP-045 |
| TRP-047 | Carte d'information d'incident à bord | TRP — Cycle de vie du trip | P1 | Carte Turo à bord (défaut = 100 $ de pénalité). | TRP-006 |
| TRP-048 | Suivi de livraison par l'hôte | TRP — Cycle de vie du trip | P1 | Statut de livraison, partage de position 30 min avant, point de repli. | TRP-012 |
| TRP-050 | Signalement d'un problème de sécurité en cours de trip | TRP — Cycle de vie du trip | P1 | Voyant ou problème : prévenir l'hôte puis le support si pas de réponse sous 30 min. | SUP-004 |
| TRP-051 | Panne : remboursement des jours non utilisés | TRP — Cycle de vie du trip | P1 | Prorata automatique si panne non imputable au guest + swap/rebooking. | PRT-005 |
| MSG-002 | Inbox à deux onglets (Messages / Notifications) | MSG — Messagerie | P1 | /inbox/messages et /inbox/notifications (flux Activity). | MSG-001 ; NTF-005 |
| MSG-003 | Envoi de photos dans la messagerie | MSG — Messagerie | P1 | Photos depuis galerie, Trip photos ou appareil. | MSG-001 |
| MSG-004 | Masquage des coordonnées avant réservation | MSG — Messagerie | P1 | Noms, numéros et lieux exacts révélés seulement après réservation. | MSG-001 |
| MSG-005 | Messages programmés de l'hôte | MSG — Messagerie | P1 | Instructions, règles, parking envoyés automatiquement après réservation ou à T−x. | MSG-001 |
| MSG-010 | Interdiction des photos d'identité dans la messagerie | MSG — Messagerie | P1 | Les photos de permis/selfie restent réservées au check-in. | MSG-003 |
| MSG-011 | Conservation de l'historique comme preuve | MSG — Messagerie | P1 | Toute communication passe par la plateforme (trace pour les litiges). | MSG-001 |
| NTF-003 | Matrice de préférences catégorie × canal | NTF — Notifications | P1 | (hist.) Trip et compte (email requis), messages, recommandations, offres, actualités × email/SMS. | NTF-001 |
| NTF-004 | Langue du compte pour les notifications | NTF — Notifications | P1 | 9 locales (dont es-US, pt-BR). | I18N-003 |
| NTF-005 | Flux d'activité (Notifications) | NTF — Notifications | P1 | Liste horodatée des événements du compte. | NTF-001 |
| NTF-006 | Tests automatisés des gabarits avec toutes les variables | NTF — Notifications | P1 | Évite les placeholders non résolus ({6} observé chez Turo). | NTF-001 |
| NTF-008 | Rappels de checklist avant échéance | NTF — Notifications | P1 | Rappels jusqu'à T−2 h (NOTIF-03) ; [NOUS] T−24 h, T−6 h, T−3 h. | VER-011 |
| NTF-009 | Notification d'ajout de conducteur additionnel | NTF — Notifications | P1 | « You're ready to drive… covered starting… primary must be present ». | VER-017 |
| NTF-010 | Notifications de paiement | NTF — Notifications | P1 | Débit différé, rappel Pay as you go J−3, échec et raccourcissement. | PAY-006 |
| NTF-012 | Notifications de modification | NTF — Notifications | P1 | Soumise, approuvée, refusée, expirée (8 h / 12 h) ; proposition de swap. | TRP-021 |
| NTF-013 | Notifications de factures annexes | NTF — Notifications | P1 | Facture reçue, rappel avant 48 h, contestation, décision. | CLM-021 |
| NTF-014 | Invitation à noter et publication | NTF — Notifications | P1 | Dès fin −3 h ; publication des deux avis. | REV-003 |
| NTF-015 | Notifications de sinistre | NTF — Notifications | P1 | Déclaration, contact du chargé de dossier, décompte, lien de paiement, échéancier. | CLM-006 |
| NTF-016 | Notifications de violation, suspension et appel | NTF — Notifications | P1 | Email + in-app lors d'une restriction ou suspension (ADM-005) : règle enfreinte, effet, durée, voie d'appel (une fois, sous 15 j). Événement du catalo… | VER-023 |
| NTF-017 | Alerte de rappel de sécurité (email + SMS) | NTF — Notifications | P1 | Rappel sur un véhicule avec restriction. | HST-023 |
| NTF-018 | Notifications de versement | NTF — Notifications | P1 | Notification à l'hôte d'un versement initié, payé, retenu (`ON_HOLD`) ou échoué. Événement du catalogue NTF-001 (fusion). | PYO-004 |
| REV-003 | Fenêtre de notation | REV — Avis & réputation | P1 | Fenêtre de notation du guest : du check-out à J+10, rappels à J+1 et J+7, formulaire fermé ensuite ; fenêtre hôte (P1) de même durée. Règle portée par… | TRP-046 |
| REV-005 | Texte obligatoire pour les notes basses | REV — Avis & réputation | P1 | Guest : ≥ 25 caractères de 1 à 4★ ; hôte : texte de 1 à 3★. | REV-001 |
| REV-006 | Réponse publique de l'hôte | REV — Avis & réputation | P1 | Réponse affichée sous l'avis. | LST-019 |
| REV-007 | Avis automatique d'annulation hôte | REV — Avis & réputation | P1 | Publié sur l'annonce avec le délai d'anticipation de l'annulation. | BKG-032 |
| REV-008 | Demande de retrait d'un avis | REV — Avis & réputation | P1 | Motifs limités, formulaire, examen unique, décision définitive. | ADM-017 |
| REV-012 | Avis reçus visibles sur le profil guest | REV — Avis & réputation | P1 | Section « Reviews from hosts » ou état vide. | ACC-017 |
| HST-001 | Landing d'acquisition hôte | HST — Onboarding hôte & annonces | P1 | Promesse de revenus, preuves sociales, protections, conseils, FAQ. | — |
| HST-003 | Pré-étape de localisation du véhicule | HST — Onboarding hôte & annonces | P1 | Adresse Google Places, saisie manuelle, épingle ajustable, confirmation. | SRC-002 |
| HST-004 | Blocage des pays/villes non ouverts | HST — Onboarding hôte & annonces | P1 | Message « pas encore lancé dans votre pays » ; Next désactivé. | ADM-027 |
| HST-006 | Identification par VIN | HST — Onboarding hôte & annonces | P1 | VIN 17 caractères, case « plus ancien que 1981 », aide « où le trouver ». | HST-005 |
| HST-007 | Décodage VIN et équipements par finition | HST — Onboarding hôte & annonces | P1 | Marque/modèle/année déduits ; équipements ajoutés selon la finition, non supprimables. | HST-006 |
| HST-009 | Étape d'opt-in aux trips mensuels | HST — Onboarding hôte & annonces | P1 | Activation des trips mensuels et de la remise associée. | HST-005 |
| HST-010 | Étape disponibilité du véhicule | HST — Onboarding hôte & annonces | P1 | (hist.) Contenu Turo non observé (BLOQUÉ). Chez nous, l'étape « disponibilité » de l'annonce reprend les réglages du lieu de l'agence : horaires de prise/reto… | CAL-001 |
| HST-015 | Étape engagements sécurité et qualité | HST — Onboarding hôte & annonces | P1 | (hist.) Contenu Turo non observé (BLOQUÉ). Chez nous, les engagements du loueur (sécurité, entretien, documents à jour, non-discrimination, aucun paiement hor… | HST-005 |
| HST-017 | Webinaire d'orientation obligatoire | HST — Onboarding hôte & annonces | P1 | Formation avant la première annonce. | HST-016 |
| HST-018 | Prérequis de l'hôte | HST — Onboarding hôte & annonces | P1 | 21 ans, assurance nommant le véhicule, autorisation du propriétaire, véhicule financé autorisé. | HST-049 |
| HST-020 | Titres interdits et historique | HST — Onboarding hôte & annonces | P1 | Salvage, rebuilt, inondation, compteur trafiqué interdits ; vérif gravámenes. | HST-019 |
| HST-021 | Classification de valeur du véhicule | HST — Onboarding hôte & annonces | P1 | Standard / Deluxe / Super Deluxe / Classic / Specialty via valeur marchande. | HST-011 |
| HST-023 | Rappels de sécurité par VIN | HST — Onboarding hôte & annonces | P1 | Annonce impossible si rappel ouvert ; retrait sous 72 h ; levée sur preuve. | HST-006 |
| HST-024 | Inspection annuelle de sécurité | HST — Onboarding hôte & annonces | P1 | À soumettre sous 14 jours ; échéance 12/6 mois ; retrait si manquée. | ADM-020 |
| HST-025 | Standards d'entretien | HST — Onboarding hôte & annonces | P1 | Batterie, plaquettes, pneus < 6 ans, voyants, impacts, clim. | HST-024 |
| HST-027 | Snooze avec remise en ligne automatique | HST — Onboarding hôte & annonces | P1 | Mise en pause jusqu'à une date. | HST-026 |
| HST-028 | Retrait/suppression bloqués s'il existe des trips futurs | HST — Onboarding hôte & annonces | P1 | Écran listant les trips : échanger ou annuler (avec pénalités). | HST-026 |
| HST-030 | Restriction automatique d'un véhicule endommagé | HST — Onboarding hôte & annonces | P1 | Véhicule dangereux restreint jusqu'à preuve de réparation. | HST-026 |
| HST-031 | Gestion des Extras par l'hôte | HST — Onboarding hôte & annonces | P1 | Catalogue fermé 50+ items, prix 0–999 $ par jour ou par trip, stock, prepaid refuel par défaut. | HST-005 |
| HST-032 | Extras locaux | HST — Onboarding hôte & annonces | P1 | Panapass prépayé, siège enfant, glacière, kit 4x4. | HST-031 |
| HST-034 | Paramètres de livraison | HST — Onboarding hôte & annonces | P1 | Jusqu'à 10 POI, rayon personnalisé, frais max par lieu, gratuité au-delà d'une durée. | HST-005 |
| HST-035 | Configuration de la livraison aéroport | HST — Onboarding hôte & annonces | P1 | Activer l'aéroport, prix, emplacement exact (niveau, rangée, photo). | HST-034 ; ADM-019 |
| HST-040 | Acceptation de la politique de tracking | HST — Onboarding hôte & annonces | P1 | Engagement sur les dispositifs de suivi avant mise en ligne. | HST-005 |
| HST-041 | Déclaration des dispositifs (GPS, caméra) | HST — Onboarding hôte & annonces | P1 | Dispositifs déclarés dans l'annonce. | HST-040 |
| HST-042 | Interdits dans l'annonce | HST — Onboarding hôte & annonces | P1 | Pas de téléphone, adresse, réseaux sociaux, frais ou cautions non prévus. | ADM-017 |
| HST-045 | FAQ véhicules financés / leasés | HST — Onboarding hôte & annonces | P1 | Vérifier que le contrat autorise l'autopartage. | HST-018 |
| HST-046 | Description, règles et instructions du véhicule | HST — Onboarding hôte & annonces | P1 | Texte libre et règles via messages programmés. | MSG-005 |
| HST-047 | OCR de la carte d'immatriculation | HST — Onboarding hôte & annonces | P1 | Pré-remplissage plaque/VIN/propriétaire depuis le registro vehicular. | HST-006 |
| CAL-005 | Durées minimale et maximale | CAL — Calendrier & disponibilité | P1 | Durées min/max en jours ; pas de max imposé (US). | CAL-001 |
| CAL-006 | Horaires de prise et de retour | CAL — Calendrier & disponibilité | P1 | Défaut 7 h–22 h semaine, 7 h–19 h week-end, par lieu. | CAL-001 |
| CAL-007 | Jours fériés nationaux | CAL — Calendrier & disponibilité | P1 | Calendrier des fériés par pays (horaires, prix). | CAL-006 |
| CAL-010 | Refus d'un blocage chevauchant un trip confirmé | CAL — Calendrier & disponibilité | P1 | L'hôte doit annuler ou échanger explicitement. | CAL-011 |
| CAL-012 | Préavis minimal imposé pour la classe Luxe | CAL — Calendrier & disponibilité | P1 | 24 h minimum (fraude des réservations immédiates). | CAL-003 |
| HDB-003 | Page de performance | HDB — Tableau de bord & performance hôte | P1 | Taux de 5★, annulations, entretien, propreté, volume (« Check your performance »). | HDB-001 |
| HDB-006 | Power Host / programme Flota Pro | HDB — Tableau de bord & performance hôte | P1 | (hist.) ≥ 4 véhicules, ≥ 36 000 $ ; Host Success, support dédié, avantages sinistres. | HDB-003 |
| HDB-007 | Seuils d'annulation et sanctions de visibilité | HDB — Tableau de bord & performance hôte | P1 | ≤ 20 trips : retrait jusqu'au webinaire ; > 20 : 5 % → 7 j, 10 % → fermeture. | BKG-032 |
| HDB-008 | Annulations excusées | HDB — Tableau de bord & performance hôte | P1 | Dommage du trip précédent, rebooking 24 h, 1re sur 10, sécurité, catastrophe, rappel. | HDB-007 |
| HDB-012 | Barème des pénalités hôte | HDB — Tableau de bord & performance hôte | P1 | Catalogue publié (fausse déclaration, marché gris, no-show, factures inéligibles…). | ADM-014 |
| HDB-013 | Fermeture du compte hôte par la plateforme | HDB — Tableau de bord & performance hôte | P1 | Préavis 30 j (immédiat si fraude), trips > 72 h annulés sans gains. | ADM-012 |
| HDB-015 | Avis reçus par l'hôte | HDB — Tableau de bord & performance hôte | P1 | Section avis dans Business ; réponse et demande de retrait. | REV-006 |
| HDB-018 | Occupation et revenus par véhicule | HDB — Tableau de bord & performance hôte | P1 | Taux d'occupation, RevPAD, revenu net par véhicule. | HDB-001 |
| PYO-004 | Calendrier des versements | PYO — Versements hôtes | P1 | Turo : 1er trip ~3 j ouvrés, suivants 3 h après la fin ; [NOUS] J+2, 1er J+5. | PYO-007 |
| PYO-005 | Versements regroupés (une opération par jour) | PYO — Versements hôtes | P1 | Regroupement quotidien des gains. | PYO-004 |
| PYO-006 | Versements partiels hebdomadaires (trips > 7 j) | PYO — Versements hôtes | P1 | Versement tous les 7 jours sans attendre la fin. | PYO-004 |
| PYO-008 | Retenue préventive en cas de litige | PYO — Versements hôtes | P1 | Retenue sur un versement si une réclamation guest contre l'hôte est ouverte. | PYO-007 |
| PYO-009 | Suspension des versements pour re-vérification | PYO — Versements hôtes | P1 | Versements suspendus si nouvelle vérification du compte nécessaire. | PYO-001 |
| PYO-010 | Gains par trip hors taxes (reçu hôte) | PYO — Versements hôtes | P1 | Détail des gains, frais plateforme, coût du plan. | PYO-007 |
| PYO-011 | Explication des écarts de versement | PYO — Versements hôtes | P1 | Plan, annulation, remboursements accordés, livraison gratuite, remises. | PYO-010 |
| PYO-012 | Export CSV et historique des transactions | PYO — Versements hôtes | P1 | Historique des mouvements de l'hôte (trips, jambe `HOST`, pénalités, ajustements, versements) filtrable par période, export CSV UTF-8 pour sa comptabi… | PYO-007 |
| PYO-016 | Machine à états du versement | PYO — Versements hôtes | P1 | SM-6 : calculé, retenu, initié, payé, échoué, repris. | PYO-007 |
| FLT-001 | Équipes d'hébergement et invitation de co-hôtes | FLT — co-hôtes et hôtes multi-véhicules | P1 | Équipes illimitées ; invitation valable 30 j ; co-hôte avec compte vérifié. Portée d'un co-hôte limitée aux véhicules assignés (`vehicle_scope`), vide… | ACC-001 |
| FLT-002 | Lots de permissions co-hôte | FLT — co-hôtes et hôtes multi-véhicules | P1 | « Trip management » et « Pricing & availability » ; sinistres, gains, réglages interdits. | FLT-001 |
| FLT-004 | Calendrier multi-véhicules | FLT — co-hôtes et hôtes multi-véhicules | P1 | (hist.) Vue flotte triable par prix, plaque, jours réservés. | CAL-001 |
| FLT-005 | Prix et blocages en masse | FLT — co-hôtes et hôtes multi-véhicules | P1 | Modifier prix et disponibilités de plusieurs véhicules à la fois. | FLT-004 |
| FLT-006 | Distances et remises en masse | FLT — co-hôtes et hôtes multi-véhicules | P1 | Paramètres kilométrage et remises appliqués à un groupe. | FLT-005 |
| FLT-007 | Groupes de véhicules par lieu | FLT — co-hôtes et hôtes multi-véhicules | P1 | (hist.) Rattacher des véhicules à des lieux (agences, POI). | HST-034 |
| FLT-009 | Exports CSV et iCal | FLT — co-hôtes et hôtes multi-véhicules | P1 | (hist.) Exports CSV des trips et des relevés de commission ; le flux iCal sortant par véhicule est déjà dans CAL-009. P1. | — |
| FLT-013 | Swap intra-flotte automatique | FLT — co-hôtes et hôtes multi-véhicules | P1 | (hist.) Échange entre véhicules d'une même flotte sans support, conducteurs transférés. | TRP-027 |
| CLM-003 | Preuves et délais des pièces | CLM — Réclamations, dommages & factures annexes | P1 | Photos dans les fenêtres 24 h, métadonnées, pièces sous 15 j, diagnostic sur en-tête. | CLM-001 |
| CLM-004 | Choix règlement direct vs dossier plateforme | CLM — Réclamations, dommages & factures annexes | P1 | Le devis saisi affiche ce que l'hôte toucherait dans chaque parcours. | CLM-001 |
| CLM-005 | Règlement direct avec le guest | CLM — Réclamations, dommages & factures annexes | P1 | Devis sous 72 h, plafond du plan guest, facture plateforme, retrait sous 20 j. | CLM-004 |
| CLM-008 | Ordre de recouvrement | CLM — Réclamations, dommages & factures annexes | P1 | Tiers responsable → assureur du guest → guest dans la limite du plan. | CLM-006 |
| CLM-009 | Frais de traitement de réclamation | CLM — Réclamations, dommages & factures annexes | P1 | Jusqu'à 150 $ (remboursés si un tiers assume 100 %). | CLM-006 |
| CLM-010 | Échéancier pour dommages | CLM — Réclamations, dommages & factures annexes | P1 | ≤ 5 000 $ : 2/4/8 mois ; > 5 000 $ : 4/6/8 mois ; sans intérêts. | PAY-026 |
| CLM-012 | Vol et disparition du véhicule | CLM — Réclamations, dommages & factures annexes | P1 | Plainte guest ≤ 12 h, clé d'origine rendue ; enquête 30 j. | TRP-042 |
| CLM-019 | Factures annexes de l'hôte | CLM — Réclamations, dommages & factures annexes | P1 | Carburant, km, péages, PV, recharge ; délais 72 h (ou fenêtre du plan) et preuves. | TRP-033 |
| CLM-020 | Génération automatique des factures carburant / km / retard | CLM — Réclamations, dommages & factures annexes | P1 | À partir des données de check-out ; l'hôte valide sous 72 h. | TRP-034 |
| CLM-022 | Contestation et escalade | CLM — Réclamations, dommages & factures annexes | P1 | Hôte 72 h pour annuler, réviser ou escalader ; sinon escalade automatique. | CLM-021 ; ADM-008 |
| CLM-023 | Signalements nettoyage et tabac | CLM — Réclamations, dommages & factures annexes | P1 | Signalement d'incident sous 72 h, forfait 150 $, revue ~48 h. | CLM-003 |
| CLM-024 | Factures inéligibles et pénalités | CLM — Réclamations, dommages & factures annexes | P1 | Usure, préexistant, doublons interdits ; 50/200/500 $ ; [NOUS] validation en amont. | CLM-019 |
| CLM-025 | Péages et amendes tardifs | CLM — Réclamations, dommages & factures annexes | P1 | Facturables sous 90 j, puis 180 j via support ; [NOUS] rattachement auto par plaque. | CLM-019 |
| CLM-026 | Attestation de location pour amendes imputées au propriétaire | CLM — Réclamations, dommages & factures annexes | P1 | Contrat + identité du conducteur pour contester (DE 11/2025). | BKG-018 |
| CLM-031 | Refus de l'assureur partenaire et revue de garantie | CLM — Réclamations, dommages & factures annexes | P1 | État INSURER_DECLINED → revue de garantie plateforme si exclusion non communiquée. | CLM-006 |
| CLM-032 | Machines à états réclamation et facture annexe | CLM — Réclamations, dommages & factures annexes | P1 | Machines à états SM-4 (réclamation) et SM-5 (facture annexe) de 08. En P0-A, seule une SM-4 simplifiée (OUVERTE → EN_INSTRUCTION → DÉCIDÉE → CLOSE / C… | CLM-006 |
| PRT-004 | Exclusions communes affichées | PRT — Protection & assurance | P1 | Intérieur, mécanique, km, péages, carburant, Extras ; violation = plafond annulé. | PRT-001 |
| PRT-005 | Assistance routière 24/7 de base | PRT — Protection & assurance | P1 | Pannes mécaniques et accidents ; autres interventions jusqu'à 199 $. | SUP-004 |
| PRT-006 | Assistance routière améliorée (add-on) | PRT — Protection & assurance | P1 | 2,99 $/j : crevaison, clés, batterie, carburant, remorquage. | PRT-005 |
| PRT-010 | Moteur de plans paramétrable par pays et assureur | PRT — Protection & assurance | P1 | Niveaux, prix, franchises, exclusions, éligibilité configurables. | ADM-014 |
| SUP-001 | Centre d'aide | SUP — Support, aide & trust & safety | P1 | (hist.) Bêta : FAQ statique bilingue publiée dans le centre légal (LEG-011) : réserver, pièces exigées, caution chez l'agence, annulation, urgence et accident… | — |
| SUP-002 | « Get help » : assistant IA puis agent humain | SUP — Support, aide & trust & safety | P1 | Assistant IA d'abord, agent humain sur demande. | SUP-001 |
| SUP-003 | Chats séparés vérification / facturation et historique | SUP — Support, aide & trust & safety | P1 | Fils dédiés avec historique visible. | ADM-010 |
| SUP-005 | Numéro WhatsApp Business vérifié unique | SUP — Support, aide & trust & safety | P1 | Un seul numéro officiel publié ; jamais de demande de paiement. | NTF-002 |
| SUP-006 | Page Trust & Safety publique | SUP — Support, aide & trust & safety | P1 | Screening, protections, bonnes pratiques, ligne d'urgence. | SUP-001 |
| SUP-007 | Domaines officiels, anti-spoofing, compte compromis | SUP — Support, aide & trust & safety | P1 | Liste des domaines, signalement de spoofing, adresse compte compromis. | SUP-001 |
| SUP-008 | Non-discrimination (tolérance zéro) | SUP — Support, aide & trust & safety | P1 | Politique et sanctions pouvant aller jusqu'au retrait. | ADM-012 |
| SUP-009 | Libre-service in-app (factures, signalements) | SUP — Support, aide & trust & safety | P1 | Actions sans contacter le support. | SUP-001 |
| SUP-010 | Contacts dédiés réclamations | SUP — Support, aide & trust & safety | P1 | Email sinistres et ligne urgente, réponse sous 2 j ouvrés. | ADM-009 |
| SUP-012 | Score de risque anti-fraude | SUP — Support, aide & trust & safety | P1 | Score qui filtre au paiement et déclenche des exigences. | ADM-011 |
| SUP-013 | reCAPTCHA et détection de comportements anormaux | SUP — Support, aide & trust & safety | P1 | Anti-spam/abus et cookies antifraude. | SUP-012 |
| SUP-015 | Catalogue des usages interdits | SUP — Support, aide & trust & safety | P1 | Vitesse, tout-terrain, courses, remorquage, VTC hors US, usage commercial, etc. | LEG-011 |
| SUP-016 | Restrictions et suspensions de compte | SUP — Support, aide & trust & safety | P1 | Déclencheurs : chargeback, impayé, violations, notes, discrimination, comptes liés. | ADM-012 |
| SUP-017 | Dommages-intérêts forfaitaires (marché gris, contournement) | SUP — Support, aide & trust & safety | P1 | 5 500 $ par manquement listé. | LEG-013 |
| ADM-009 | Gestion des dossiers sinistres | ADM — Back-office / admin [NOUS] | P1 | Dossier, pièces, lien assureur/expert, décompte, recouvrement. | CLM-006 |
| ADM-010 | Ticketing omnicanal | ADM — Back-office / admin [NOUS] | P1 | Tickets WhatsApp, email, chat, téléphone liés au trip et à l'utilisateur. | ADM-001 |
| ADM-011 | Moteur de règles de risque configurable | ADM — Back-office / admin [NOUS] | P1 | Règles (BIN, IP, âge du compte, classe, délai) → exigences ; journal explicable. | ADM-001 |
| ADM-012 | Sanctions, suspensions et appels | ADM — Back-office / admin [NOUS] | P1 | Création/levée de restrictions, notification, workflow d'appel par une autre personne. | ADM-005 |
| ADM-015 | Gestion des codes promo et campagnes | ADM — Back-office / admin [NOUS] | P1 | Création, règles d'usage, budget, suivi. | ADM-001 |
| ADM-017 | Modération des avis et des annonces | ADM — Back-office / admin [NOUS] | P1 | Traitement des demandes de retrait d'avis et contrôle des annonces. | ADM-001 |
| ADM-018 | Traitement des signalements d'annonce | ADM — Back-office / admin [NOUS] | P1 | File des « Report listing » avec actions. | LST-014 |
| ADM-019 | Gestion des aéroports et POI (AirportPermit) | ADM — Back-office / admin [NOUS] | P1 | Zones, curbside, frais, plafond de livraison, photos. | ADM-001 |
| ADM-020 | Gestion des rappels et inspections | ADM — Back-office / admin [NOUS] | P1 | Restriction, levée, suivi des échéances. | HST-023 |
| ADM-021 | Recouvrement des dettes | ADM — Back-office / admin [NOUS] | P1 | (hist.) Relances, échéanciers, transfert à une agence. | PAY-027 |
| ADM-023 | Tableau de bord KPIs marketplace | ADM — Back-office / admin [NOUS] | P1 | GMV, take rate, occupation, sinistralité, annulations, délais de revue. | FIN-001 |
| ADM-024 | Gestion des gabarits de notification | ADM — Back-office / admin [NOUS] | P1 | Édition et prévisualisation des gabarits par langue et canal. | NTF-006 |
| ADM-025 | Outil d'investigation des comptes liés | ADM — Back-office / admin [NOUS] | P1 | Graphe appareil, carte, adresse, téléphone. | ACC-015 |
| ADM-026 | Traitement des demandes de droits (accès, suppression) | ADM — Back-office / admin [NOUS] | P1 | Export, pseudonymisation, conservation légale des factures et sinistres. | ADM-001 |
| ADM-028 | Catalogues (Extras, équipements, types, classes) | ADM — Back-office / admin [NOUS] | P1 | Listes fermées gérées par l'admin. | ADM-001 |
| FIN-006 | Comptabilisation des revenus en net (agent) | FIN — Finance, comptabilité & fiscalité | P1 | Revenus = frais marketplace + services, la plateforme agissant comme agent. | FIN-001 |
| FIN-009 | Retenues à la source | FIN — Finance, comptabilité & fiscalité | P1 | Retenues sur services payés à l'entité US ; non-résidents. | FIN-001 |
| FIN-010 | Récapitulatif fiscal annuel de l'hôte | FIN — Finance, comptabilité & fiscalité | P1 | Synthèse annuelle des gains et frais. | PYO-012 |
| FIN-012 | Provisions (franchises impayées, fraude, chargebacks) | FIN — Finance, comptabilité & fiscalité | P1 | Provision en % du GMV et suivi. | FIN-001 |
| FIN-013 | Séparation crédit promotionnel / crédit en valeur | FIN — Finance, comptabilité & fiscalité | P1 | credit_promo (expirant) vs credit_cash (carte cadeau, remboursement). | MKT-002 |
| FIN-014 | Entité encaissante US + entité locale | FIN — Finance, comptabilité & fiscalité | P1 | (hist.) Encaissement via entité US (Stripe/dLocal), versements aux loueurs. | PAY-001 |
| FIN-015 | Exports comptables | FIN — Finance, comptabilité & fiscalité | P1 | Exports vers le logiciel comptable. | FIN-001 |
| I18N-001 | Structure d'URL pays/langue | I18N — Multi-pays, devise & langue | P1 | /{pays}/{langue}/… (ex. /pa/es/…) pour le référencement. P1 : en bêta, un seul pays, langue tirée de la préférence de compte. | — |
| I18N-002 | Sélecteur de langue | I18N — Multi-pays, devise & langue | P1 | Sélecteur dans le footer et préférence de compte. | I18N-003 |
| I18N-006 | Fuseau horaire du véhicule | I18N — Multi-pays, devise & langue | P1 | Stockage UTC + fuseau IANA ; affichage en heure du véhicule. | — |
| I18N-007 | Montants forfaitaires définis par devise | I18N — Multi-pays, devise & langue | P1 | Pénalités et frais définis par devise, jamais convertis à la volée. | ADM-014 |
| I18N-008 | Cohérence linguistique de l'interface | I18N — Multi-pays, devise & langue | P1 | Aucun mélange de langues (incohérence observée chez Turo). | I18N-003 |
| I18N-009 | Formats locaux | I18N — Multi-pays, devise & langue | P1 | Téléphone E.164, adresses sans code postal, séparateurs, dates. | — |
| I18N-010 | Pages légales par pays | I18N — Multi-pays, devise & langue | P1 | Pages légales propres au Panama (CGU, confidentialité, annulation, règles de location), rédigées par l'avocat local. Portées par LEG-011 (fusion). | LEG-011 |
| I18N-011 | Distances en kilomètres | I18N — Multi-pays, devise & langue | P1 | Toutes les distances en km (fiche, contrat, compteur, factures). Portée par I18N-003 (fusion). | — |
| MKT-002 | Crédit voyage (portefeuille) | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P1 | Code de crédit, solde, application automatique au prochain trip. | — |
| MKT-004 | Codes promo | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P1 | Usage unique, devise du pays, réservation initiale, non cumulables, sur le prix du véhicule. | ADM-015 |
| MKT-010 | Pages marketing (Why choose, How it works, Trust) | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P1 | Pages d'argumentaire et de fonctionnement. | — |
| LEG-003 | Opt-in marketing non pré-coché | LEG — Légal, consentements & données | P1 | Case marketing à l'inscription et au checkout. | LEG-002 |
| LEG-004 | Consentement aux messages automatiques (SMS / WhatsApp) | LEG — Légal, consentements & données | P1 | Fournir son numéro vaut consentement aux messages transactionnels. | NTF-002 |
| LEG-005 | Bannière et préférences cookies | LEG — Légal, consentements & données | P1 | Catégories nécessaires, performance, fonctionnalité, publicité ; lien « Cookie preferences ». | — |
| LEG-007 | Téléchargement de ses données en libre-service | LEG — Légal, consentements & données | P1 | Bêta : export manuel des données d'un utilisateur sur demande au support (modèle de réponse, délai légal à confirmer, OQ-BR-25). Bouton libre-service… | ADM-026 |
| LEG-008 | Demande de suppression des données | LEG — Légal, consentements & données | P1 | Distincte de la fermeture ; exclue si solde ou réclamation. | ADM-026 |
| LEG-012 | Conditions du payment plan | LEG — Légal, consentements & données | P1 | Pas un prêt, sans intérêts ni frais, défaut → recouvrement. | PAY-026 |
| LEG-013 | Clauses de dommages-intérêts forfaitaires | LEG — Légal, consentements & données | P1 | 5 500 $ par manquement (marché gris, contournement de suspension…). | — |
| LEG-016 | Licence sur le contenu utilisateur | LEG — Légal, consentements & données | P1 | Licence large sur photos, avis, descriptions. | LEG-011 |
| LEG-017 | Consentement à la télématique | LEG — Légal, consentements & données | P1 | Le guest autorise la collecte et informe conducteurs et passagers. | LEG-002 |
| LEG-019 | Absence de droit de rétractation | LEG — Légal, consentements & données | P1 | Seule la politique d'annulation s'applique. | LEG-011 |
| LEG-022 | Transparence du classement | LEG — Légal, consentements & données | P1 | Critères de classement publiés. | SRC-030 |
| PAY-039 | Caution modulée et « caution-assurance » | PAY — Paiements | P1 | Montant = base(classe) × multiplicateur(risque, historique) ; option de prime non remboursable couvrant la franchise via l'assureur partenaire. | PAY-011 ; PRT-001 |
| PAY-040 | Remboursement multi-rails (crédit immédiat ou virement vers un compte vérifié) | PAY — Paiements | P1 | Choix du mode de remboursement avant le paiement non réversible ; virement vers un compte au nom du guest ; repris de EC-49. | PAY-022 |
| PRC-026 | Prix « tout compris » avec protection minimale | PRC — Tarification | P1 | Prix affiché incluant taxes, frais et protection minimale obligatoire, après mesure de l'écart prix d'appel / prix final (mystery shopping, V6-06). | SRC-042 ; PRT-001 |
| TRP-053 | Clé perdue ou non restituée ; guest suspendu avec un trip à venir | TRP — Cycle de vie du trip | P1 | Procédures et frais pour une clé perdue (EC-14) et règle pour les trips à venir d'un guest suspendu (EC-39). | TRP-033 ; ADM-005 |
| PYO-017 | Rails de versement alternatifs et plafond ACH Xpress 5 000 $ | PYO — Versements hôtes | P1 | Fractionnement ou bascule vers ACH Directo / PSP au-delà de 5 000 $ par transaction ; rails de secours. | PYO-002 |
| SUP-019 | Fraude spécifique LATAM : faux justificatifs, liens frauduleux, faux documents, SIM-swap | SUP — Support, aide & trust & safety | P1 | Règles et contrôles contre les faux justificatifs Yappy/ACH, les liens de paiement frauduleux, les fausses cédulas et faux permis, le SIM-swap sur les… | ADM-029 ; PAY-034 |
| ACC-034 | B2B minimal : facture au RUC de l'entreprise et conducteur additionnel | ACC — Comptes & identité | P1 | (hist.) Réservation par un salarié avec facture de l'agence au RUC de l'entreprise et ajout d'un conducteur additionnel vérifié ; demande à valider en entreti… | BKG-002 |
| BKG-041 | Livraison aéroport via des points homologués hors emprise, suivi de vol | BKG — Réservation & checkout | P1 | (hist.) Remise hors comptoir à Tocumen/Albrook via des points homologués, avec suivi du vol ; seulement après OQ-MK-08. | HST-034 ; BKG-024 |
| CLM-036 | Refacturation Panapass / ATTT avec solde vérifié | CLM — Réclamations, dommages & factures annexes | P1 | Rapprochement des passages Panapass et des amendes ATTT avec le trip, refacturation et constancia ; délais de facturation selon SRC_G 6.7.1. | CLM-026 |

## C.2 — Phase P2 (100 lignes)

| feature_id | Nom | Epic (module) | Phase | Description (une ligne) | Dépendances clés |
|---|---|---|---|---|---|
| ACC-012 | Liaison a posteriori d'un compte Google | ACC — Comptes & identité | P2 | Lier un compte Google à un compte email existant depuis Account. | ACC-002 |
| ACC-016 | Gel des comptes multiples créés pour contourner | ACC — Comptes & identité | P2 | Créer un compte pour contourner un problème de connexion met tous les comptes en attente. | ACC-015 |
| ACC-024 | Réouverture de compte via support | ACC — Comptes & identité | P2 | Réouverture possible par le support ; demandes de tiers refusées. | ADM-005 |
| VER-008 | Consultation crédit, casier, historique de conduite | VER — Vérification / KYC | P2 | Vérifications via services tiers avec autorisation à l'inscription. | LEG-019 |
| VER-016 | Vérification manuelle du permis 1 h avant | VER — Vérification / KYC | P2 | Option de vérification manuelle par l'hôte peu avant le départ. | VER-015 |
| SRC-007 | Recherche à dates flexibles | SRC — Recherche & découverte | P2 | Paramètre flexibleType suggérant une recherche à dates flexibles. | SRC-001 |
| SRC-020 | Filtres de classe (Deluxe 25+, Super Deluxe 30+) et All-Star | SRC — Recherche & découverte | P2 | Toggles « Elevate your experience ». | SRC-013 |
| SRC-021 | Collections éditoriales curées | SRC — Recherche & découverte | P2 | 26 collections (électriques, 4x4, manuelles…) sous forme de tuiles filtrantes. | ADM-016 |
| SRC-023 | Filtres verts, accessibilité, pet friendly, siège enfant, self-driving | SRC — Recherche & découverte | P2 | Green Vehicles, Accessible, pet friendly, child seat, Self-driving. | SRC-013 |
| SRC-028 | « Inspiré de vos recherches récentes » | SRC — Recherche & découverte | P2 | Véhicules vus récemment proposés sur la home. | SRC-027 |
| SRC-029 | Encarts éditoriaux (nudges) dans la liste | SRC — Recherche & découverte | P2 | Urgence (« réservez tôt ») et réassurance (annulation gratuite). | SRC-008 |
| SRC-036 | Bloc SEO à onglets en home | SRC — Recherche & découverte | P2 | Types, marques & modèles, villes, aéroports, villes internationales, États. | SRC-033 |
| SRC-037 | Assistant conversationnel « Ask Turo » | SRC — Recherche & découverte | P2 | Chat flottant (restart / close) pour chercher et répondre. | SUP-002 |
| SRC-039 | API de recherche publique et deep links | SRC — Recherche & découverte | P2 | API lecture seule + deep links avec searchId pour attribution. | SRC-040 |
| SRC-044 | Listes de favoris nommées | SRC — Recherche & découverte | P2 | Cœur « Add to favorites » qui range dans des listes nommées (wishlist). | ACC-027 |
| SRC-045 | Ajouter / retirer un favori depuis carte ou fiche | SRC — Recherche & découverte | P2 | Bouton cœur sur la carte résultat, la home et la fiche. | SRC-044 |
| LST-005 | Badge « Bonne affaire » | LST — Fiche véhicule | P2 | Prix inférieur aux options similaires pour les mêmes dates. | PRC-025 |
| LST-011 | Encart « paiement flexible » | LST — Fiche véhicule | P2 | Aucune avance si tarif remboursable. | PAY-007 |
| LST-025 | Liens « Browse more {modèle} » | LST — Fiche véhicule | P2 | Liens SEO vers d'autres véhicules du modèle. | SRC-033 |
| BKG-011 | Mode demande (request to book) avec expiration | BKG — Réservation & checkout | P2 | Ancien flux : 8 h pour accepter, sinon véhicule similaire ou remboursement. | BKG-010 |
| BKG-037 | Crédit de rebooking discrétionnaire | BKG — Réservation & checkout | P2 | Crédit ponctuel selon la durée et le moment de l'annulation hôte. | MKT-002 |
| PAY-003 | Apple Pay / Google Pay avec carte de secours | PAY — Paiements | P2 | Wallets acceptés mais carte de secours obligatoire. | PAY-002 |
| PAY-007 | Pay later (débit différé) | PAY — Paiements | P2 | Tarif remboursable : débit 2 j ou 7 j avant le départ, sans frais. | PAY-015 |
| PAY-010 | Paiement en cuotas sans intérêt des émetteurs | PAY — Paiements | P2 | BNPL porté par la banque émettrice (cuotas). | PAY-001 |
| PAY-014 | Caution versée et restituée (QR / virement) | PAY — Paiements | P2 | Alternative à la pré-autorisation pour moyens non réversibles. | PAY-004 |
| PAY-016 | Account updater des réseaux | PAY — Paiements | P2 | Mise à jour automatique des cartes renouvelées. | PAY-015 |
| PAY-020 | Bascule (failover) vers un second acquéreur | PAY — Paiements | P2 | Prolongation des holds et bascule pendant une panne PSP. | PAY-001 |
| PAY-024 | Remboursement anticipé à la demande du guest | PAY — Paiements | P2 | Après annulation hôte, le guest peut demander le remboursement avant les 24 h de crédit. | BKG-036 |
| PAY-030 | Échec du débit différé → annulation sans pénalité | PAY — Paiements | P2 | Relance 24 h puis annulation automatique, créneau libéré, hôte notifié. | PAY-007 |
| PRC-004 | Prix recommandés et graphique « Future prices » | PRC — Tarification | P2 | (hist.) Recommandations sur 90 jours, mises à jour quotidiennement, bannières et push. | PRC-001 |
| PRC-005 | Alerte prix trop élevé (≥ 20 % au-dessus) | PRC — Tarification | P2 | Jours surlignés en jaune, risque de moindre visibilité. | PRC-004 |
| PRC-023 | Codes promo de l'hôte après trip | PRC — Tarification | P2 | 5, 10 ou 15 % plafonnés à 100 $, 90 jours, usage unique, proposés en notant le guest. | REV-002 |
| TRP-009 | Code de boîte à clés unique révélé après vérification | TRP — Cycle de vie du trip | P2 | Code changé à chaque trip, communiqué après vérification d'identité. | VER-014 |
| TRP-019 | Départ anticipé (≤ 1 h) | TRP — Cycle de vie du trip | P2 | Sans demande si hôte et véhicule prêts ; check-in obligatoire. | TRP-002 |
| TRP-031 | Prolongation pour circonstances exceptionnelles | TRP — Cycle de vie du trip | P2 | Heure de retour étendue via le support ; kilométrage inchangé. | ADM-013 |
| TRP-032 | Entretien pendant les trips longs | TRP — Cycle de vie du trip | P2 | > 30 j ou > 3 000 mi : entretien courant à la charge de l'hôte ; guest 2 semaines. | PAY-008 |
| TRP-044 | Alerte GPS hors ligne | TRP — Cycle de vie du trip | P2 | Alerte hôte/ops après 2 h sans ping (4 h hors zones urbaines). | TRP-042 |
| TRP-049 | Retour par un conducteur additionnel approuvé | TRP — Cycle de vie du trip | P2 | Divergence : réduit les retours manqués. | VER-017 |
| MSG-006 | Questions pré-réservation filtrées | MSG — Messagerie | P2 | Questions à l'hôte avant réservation avec masquage automatique des contacts. | MSG-007 |
| MSG-008 | Détection d'accords de modification hors système | MSG — Messagerie | P2 | Reconnaît « te la dejo hasta el lunes » et propose le bouton Change trip. | MSG-007 ; TRP-020 |
| MSG-009 | Détection des demandes de documents d'identité | MSG — Messagerie | P2 | Avertit quand un hôte demande cédula/passeport par message. | MSG-007 |
| MSG-012 | Consentement écrit caméra / audio par message | MSG — Messagerie | P2 | L'hôte obtient l'accord écrit du guest pour caméra intérieure ou audio. | MSG-001 |
| MSG-013 | Traduction automatique des messages | MSG — Messagerie | P2 | Traduction es ↔ en des fils. | MSG-001 |
| MSG-014 | Relais WhatsApp masqué | MSG — Messagerie | P2 | Messages de la plateforme relayés sur WhatsApp sans exposer les numéros. | NTF-002 |
| NTF-019 | Notifications de performance et sanctions d'annulation | NTF — Notifications | P2 | Statut All-Star, dépublication, webinaire requis, préavis de fermeture. | HDB-003 |
| NTF-020 | Notifications de recommandations de prix | NTF — Notifications | P2 | (hist.) Bannières mensuelles et push. | PRC-004 |
| NTF-022 | Notifications marketing (opt-in) | NTF — Notifications | P2 | (hist.) Offres, recommandations, actualités selon préférences. | LEG-003 |
| REV-009 | Détection de données personnelles avant publication | REV — Avis & réputation | P2 | Téléphones, noms complets masqués avant publication. | REV-004 |
| REV-011 | Exclusion des guests régulièrement mal notés | REV — Avis & réputation | P2 | Retrait des guests aux mauvaises notes répétées. | REV-002 ; ADM-012 |
| REV-013 | Avis multilingues et traduction | REV — Avis & réputation | P2 | Avis EN/ES affichés ; [NOUS] traduction. | REV-010 |
| HST-002 | Simulateur de revenus (Carculator) | HST — Onboarding hôte & annonces | P2 | Marché, marque/modèle/année → gains mensuels/annuels, slider de jours, top 10. | HST-001 |
| HST-013 | Détection de contacts dans les photos | HST — Onboarding hôte & annonces | P2 | Numéros de téléphone / QR WhatsApp détectés dans les images. | HST-012 |
| HST-029 | Annonce non transférable | HST — Onboarding hôte & annonces | P2 | Une annonce ne peut pas passer à un autre hôte. | HST-026 |
| HST-037 | Liaison du compte de péage | HST — Onboarding hôte & annonces | P2 | Transpondeur prioritaire sur la plaque, option « Don't track », facture auto. | CLM-025 |
| HST-043 | Host Hub (ressources, Hosting 101, Grow your business) | HST — Onboarding hôte & annonces | P2 | Centre de ressources hôtes et articles. | — |
| CAL-008 | Option 24/7 pour remise sans contact | CAL — Calendrier & disponibilité | P2 | Retrait à toute heure si boîte sécurisée ou serrure connectée. | TRP-009 |
| HDB-004 | Statut All-Star Host | HDB — Tableau de bord & performance hôte | P2 | Évaluation trimestrielle sur 365 j ; badge, filtre, annulation de frais, priorité. | HDB-003 |
| HDB-009 | Formation « annulations » pour remise en ligne | HDB — Tableau de bord & performance hôte | P2 | Webinaire puis remise en ligne sous 24–48 h. | HDB-007 |
| HDB-010 | Standards qualité sur 90 jours et fermeture | HDB — Tableau de bord & performance hôte | P2 | Seuil de 5★ (65 % → 70 %) ; en dessous, fermeture du compte. | HDB-003 |
| HDB-011 | Blocage automatique pour entretien insuffisant | HDB — Tableau de bord & performance hôte | P2 | Taux d'entretien bas sur 10 trips → blocage jusqu'à inspection. | HST-024 |
| HDB-016 | Business coaching / équipe Host Success | HDB — Tableau de bord & performance hôte | P2 | Conseil business (assurance, parking, financement). | HDB-006 |
| PYO-014 | Versements de sinistres (hôte, garage, créancier) | PYO — Versements hôtes | P2 | Paiement à l'hôte enregistré, au garage ou au créancier. | CLM-006 |
| PYO-015 | Versements maintenus après fermeture du compte | PYO — Versements hôtes | P2 | Versements par virement et récapitulatif fiscal annuel. | HDB-013 |
| FLT-008 | Changement de plan pour toute la flotte | FLT — co-hôtes et hôtes multi-véhicules | P2 | (hist.) Plan appliqué à tous les véhicules (effet nouveaux trips). | PRT-008 |
| CLM-007 | Dépôt dommage prélevé au guest | CLM — Réclamations, dommages & factures annexes | P2 | 500 $ (Standard, Minimum, Decline) ou 3 000 $ si non roulant ; aucun pour Premier. | CLM-006 |
| CLM-011 | Perte totale (ACV, titre, épave) | CLM — Réclamations, dommages & factures annexes | P2 | Perte totale si réparation > 75 % de l'ACV ; cession du titre ou valeur d'épave déduite. | CLM-006 |
| CLM-013 | Supplément de réparation par le garage | CLM — Réclamations, dommages & factures annexes | P2 | Déposé par le garage sous 45 j après le premier paiement. | CLM-006 |
| CLM-015 | Réseau de garages agréés et liste noire | CLM — Réclamations, dommages & factures annexes | P2 | Prestataires préférés, garages exclus pour facturation abusive. | CLM-006 |
| CLM-016 | Mode « reimbursement-only » | CLM — Réclamations, dommages & factures annexes | P2 | Fraude présumée : factures détaillées et preuves de paiement exigées. | CLM-006 |
| CLM-017 | Clés perdues traitées en réclamation | CLM — Réclamations, dommages & factures annexes | P2 | Remplacement de clé = réclamation dommage ; [NOUS] forfait publié par classe. | CLM-006 |
| CLM-018 | Crevaisons et pneus | CLM — Réclamations, dommages & factures annexes | P2 | Charge du guest si accident/vandalisme ; pneus défectueux ou ≥ 6 ans à la charge de l'hôte. | CLM-006 |
| CLM-027 | Forfait fourrière | CLM — Réclamations, dommages & factures annexes | P2 | 399 $ si la plateforme récupère un véhicule en fourrière par la faute du guest. | CLM-019 |
| CLM-030 | Comparaison automatique des photos départ / retour | CLM — Réclamations, dommages & factures annexes | P2 | Détection des nouveaux dommages par zone du véhicule. | TRP-004 |
| PRT-014 | Agence de courtage propre | PRT — Protection & assurance | P2 | (hist.) Turo Insurance Agency distribue les protections. | PRT-010 |
| PRT-016 | Assurance personnelle de l'hôte nommant le véhicule | PRT — Protection & assurance | P2 | Preuve d'assurance perso/commerciale exigée. | HST-039 |
| PRT-017 | Option perte de revenus pour hôtes pros | PRT — Protection & assurance | P2 | (hist.) Indemnité d'immobilisation après sinistre. | PRT-010 |
| SUP-014 | Détection des abus de promotions | SUP — Support, aide & trust & safety | P2 | Transactions promo entre proches interdites ; [NOUS] graphe appareil/adresse/carte. | ADM-025 |
| SUP-018 | Bonne pratique : un seul contact par problème | SUP — Support, aide & trust & safety | P2 | Les relances retardent le traitement ; [NOUS] dédoublonnage des tickets. | ADM-010 |
| ADM-013 | Déclaration d'événement régional | ADM — Back-office / admin [NOUS] | P2 | Zone + période : annulations excusées et prolongations sans frais automatiques. | ADM-006 |
| ADM-016 | Gestion des collections, home et pages SEO | ADM — Back-office / admin [NOUS] | P2 | Curation des collections et carrousels. | ADM-001 |
| ADM-030 | Vue « comme l'utilisateur » en lecture seule | ADM — Back-office / admin [NOUS] | P2 | Reproduire l'écran d'un utilisateur pour le support. | ADM-005 |
| FIN-007 | Reporting fiscal des revenus des hôtes | FIN — Finance, comptabilité & fiscalité | P2 | Déclarations plateformes (1099-K, DAC7, SERR) ; [NOUS] DGI si exigé. | FIN-008 |
| FIN-017 | Unit economics par trip et par véhicule | FIN — Finance, comptabilité & fiscalité | P2 | Revenu plateforme, frais PSP, provisions, support, assurance. | ADM-023 |
| I18N-012 | Crédits non convertibles entre pays | I18N — Multi-pays, devise & langue | P2 | Crédit libellé dans la devise du pays d'émission. | MKT-002 |
| MKT-003 | Choix d'appliquer ou non son crédit | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P2 | Le guest choisit d'utiliser son crédit (divergence). | MKT-002 |
| MKT-005 | Parrainage hôte | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P2 | 300 $ chacun après 3 trips ou 15 jours, dans certains marchés. | MKT-004 |
| MKT-006 | Parrainage guest | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P2 | Absent chez Turo depuis 2019. | MKT-004 |
| MKT-009 | Campagnes CRM email / WhatsApp | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P2 | Segmentation et campagnes selon consentement. | LEG-003 |
| MKT-012 | Bannière d'acquisition hôte dans le header | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P2 | « Earn up to $1,000 per month… ». | HST-001 |
| MKT-014 | Liens réseaux sociaux et stores | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P2 | Facebook, Instagram, TikTok, YouTube, App Store, Google Play. | — |
| MKT-016 | Témoignages et chiffres clés | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P2 | Témoignages d'hôtes, revenus moyens, nombre de véhicules. | HST-001 |
| MKT-017 | Partenariats hôtels, agences de voyage, compagnies aériennes | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P2 | (hist.) Canaux d'acquisition touristique (Tocumen). | SRC-039 |
| LEG-018 | Autorisation de consultation de rapports (crédit, casier) | LEG — Légal, consentements & données | P2 | Autorisation donnée à la création du compte (FCRA). | VER-008 |
| CLM-035 | Inspection de dommages assistée par IA (avant / après) | CLM — Réclamations, dommages & factures annexes | P2 | Comparaison automatique des photos de départ et de retour avec seuil de confiance et revue humaine. | CLM-030 |
| TRP-054 | Géofencing défini par véhicule et alertes graduées | TRP — Cycle de vie du trip | P2 | (hist.) Zones et frontières définies par l'agence, alertes graduées sur données GPS ; coupure moteur exclue (OQ-BR-17). | TRP-043 |
| ACC-035 | Comptes entreprises multi-conducteurs et politiques de dépense | ACC — Comptes & identité | P2 | Compte entreprise, conducteurs désignés, politiques de dépense, facturation centralisée. | ACC-034 |
| BKG-042 | Locations de 1 à 3 mois pour expatriés, contrôle art. 110/111 | BKG — Réservation & checkout | P2 | Trips mensuels avec paiement par échéances et contrôle du statut du conducteur. | PAY-008 ; VER-007 |
| SRC-046 | Recherche par usage et par destination | SRC — Recherche & découverte | P2 | Recherche par usage (plage, montagne, 4x4) et compatibilité de route. | SRC-001 |
| HST-051 | Enrichissement du catalogue véhicules par source sous licence | HST — Onboarding hôte & annonces | P2 | Après mesure de la couverture du catalogue en Bêta : base sous licence (JATO, Auto Care VCdb, Teoalida) ou décodeur VIN couvrant le Panama et le Parag… | HST-050 |
| MKT-018 | Distribution via les agrégateurs (Kayak, Rentcars) | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P2 | Flux d'inventaire vers les agrégateurs comme canal, à évaluer face à la concurrence des agrégateurs (14 §a.0). | — |

## C.3 — Phase P3 (47 lignes)

| feature_id | Nom | Epic (module) | Phase | Description (une ligne) | Dépendances clés |
|---|---|---|---|---|---|
| ACC-030 | Compte entreprise guest (réservation pour employés) | ACC — Comptes & identité | P3 | Une entreprise réserve pour des employés désignés conducteurs principaux. | ACC-001 |
| ACC-031 | Connexion avec un compte Uber | ACC — Comptes & identité | P3 | Réservation depuis l'app Uber avec identifiants Uber. | — |
| VER-021 | Validation du permis via Apple/Google Wallet | VER — Vérification / KYC | P3 | Permis numérique en wallet accepté pour vérifier, physique exigé au check-in. | — |
| SRC-038 | Distribution via assistants IA (app ChatGPT, connecteur Claude) | SRC — Recherche & découverte | P3 | Recherche de véhicules depuis un assistant ; réservation finalisée chez la plateforme. | SRC-039 |
| SRC-043 | Réservation via une app partenaire (Uber) | SRC — Recherche & découverte | P3 | Réservation depuis l'app Uber (US). | ACC-031 |
| PAY-009 | Pay over time (BNPL) | PAY — Paiements | P3 | Affirm/Klarna/Afterpay ; ≤ 30 j, sans dépôt ; remboursements chez le financeur. | PAY-001 |
| PAY-013 | Réduction du dépôt si assurance personnelle fournie | PAY — Paiements | P3 | −250 $ sur Deluxe/Super Deluxe si assurance perso fournie à la réservation. | PAY-011 |
| PAY-032 | Signalement aux bureaux de crédit | PAY — Paiements | P3 | Impayés signalés aux bureaux (US : Experian, Equifax, TransUnion). | PAY-027 |
| PRC-003 | Tarification dynamique appliquée à toutes les annonces | PRC — Tarification | P3 | Facteurs : modèle, valeur, recherches, historique, offre/demande, saison. | PRC-004 |
| PRC-006 | Tutoriel obligatoire avant de modifier ses prix | PRC — Tarification | P3 | Formation à la tarification dynamique exigée avant l'édition des prix. | PRC-003 |
| PRC-007 | Last-minute boost (+5 %) | PRC — Tarification | P3 | Majoration par défaut des réservations du jour même (< 24 h). | PRC-001 |
| PRC-009 | Minimums de remise imposés (3/5/10/15/20 %) | PRC — Tarification | P3 | Remises activées d'office avec minimums ; remise mensuelle recommandée 45 %. | PRC-008 |
| PRC-024 | Part hôte variable selon l'anticipation | PRC — Tarification | P3 | 65–100 % selon le délai de réservation dans 9 marchés US. | PRT-007 |
| TRP-010 | Déverrouillage à distance / serrure connectée | TRP — Cycle de vie du trip | P3 | (hist.) App constructeur ; serrures connectées pour flottes. | TRP-008 |
| TRP-013 | Crédit parking aéroport | TRP — Cycle de vie du trip | P3 | Crédit des heures de parking avant le début. | TRP-012 |
| NTF-021 | « Recent updates » (nouveautés produit) | NTF — Notifications | P3 | Rubrique in-app des nouveautés. | NTF-005 |
| HST-008 | Étape « Your goals » | HST — Onboarding hôte & annonces | P3 | Objectifs de l'hôte (contenu inconnu). | HST-005 |
| HST-014 | Programme de photographes professionnels | HST — Onboarding hôte & annonces | P3 | (hist.) Shooting optionnel ; la plateforme détient les droits. | HST-012 |
| HST-022 | Véhicules classiques et de spécialité (revue manuelle) | HST — Onboarding hôte & annonces | P3 | Revue approfondie et inspection. | HST-021 |
| HST-036 | Demande de permis aéroport | HST — Onboarding hôte & annonces | P3 | Formulaire pour demander un permis dans un aéroport non couvert. | HST-035 |
| HST-038 | Liaison du compte Tesla | HST — Onboarding hôte & annonces | P3 | Factures de Supercharge automatiques. | CLM-028 |
| HST-044 | Offres partenaires pour hôtes (Deals & discounts) | HST — Onboarding hôte & annonces | P3 | Réductions négociées (lockbox, pneus, vitrage). | HST-043 |
| CAL-013 | Dépassement de la durée max par extensions successives | CAL — Calendrier & disponibilité | P3 | Si l'hôte accepte une extension au-delà du max, le guest peut le dépasser à nouveau. | TRP-022 |
| HDB-005 | Code promo annuel All-Star | HDB — Tableau de bord & performance hôte | P3 | 100 $ après 4 trimestres consécutifs. | HDB-004 |
| HDB-014 | Host insights / newsletter selon le plan | HDB — Tableau de bord & performance hôte | P3 | Fréquence trimestrielle, semestrielle ou annuelle. | PRT-007 |
| HDB-017 | Business planner et « Top-earning cars » | HDB — Tableau de bord & performance hôte | P3 | (hist.) Outils de planification de flotte. | HST-002 |
| FLT-014 | Programme « revenu passif » | FLT — co-hôtes et hôtes multi-véhicules | P3 | Associe des propriétaires sans temps à des hôtes expérimentés. | FLT-001 |
| FLT-015 | Host Services (financement, assurance hors trajet) | FLT — co-hôtes et hôtes multi-véhicules | P3 | Services financiers et d'assurance pour hôtes. | HDB-006 |
| FLT-016 | Capteur de qualité d'air (preuve tabac) | FLT — co-hôtes et hôtes multi-véhicules | P3 | Capteur optionnel comme preuve objective. | TRP-042 |
| CLM-014 | Règles des pièces et du gardiennage | CLM — Réclamations, dommages & factures annexes | P3 | OEM si ≤ 2 ans et < 24 000 mi, sinon moins cher ; gardiennage ≤ 2 500 $. | CLM-006 |
| CLM-028 | Barème de recharge électrique | CLM — Réclamations, dommages & factures annexes | P3 | Écart de batterie 5–25 $ + 10 $ ; 20 $ si < 20 %. | CLM-019 |
| CLM-029 | Facturation en cours de trip (≥ 60 j) | CLM — Réclamations, dommages & factures annexes | P3 | Une facture ouverte à la fois pendant les trips longs. | CLM-019 |
| CLM-033 | Facturation après fermeture du compte hôte | CLM — Réclamations, dommages & factures annexes | P3 | Péages et PV 90 j, autres frais 72 h. | CLM-019 |
| PRT-012 | Assurance RC supplémentaire (SLI) | PRT — Protection & assurance | P3 | Option jusqu'à 300 000 $ (résidents US). | PRT-003 |
| PRT-018 | Retenue si absence de tracker (véhicules chers) | PRT — Protection & assurance | P3 | Jusqu'à 20 % de retenue si ≥ 125 000 $ sans tracker OEM actif. | TRP-042 |
| FIN-011 | Exonération de taxe a posteriori sur justificatif | FIN — Finance, comptabilité & fiscalité | P3 | Pas d'exonération au niveau du compte ; remboursement sur justificatif. | FIN-004 |
| FIN-016 | Réserves sinistres / assureur captif | FIN — Finance, comptabilité & fiscalité | P3 | Combinaison assurance tierce, rétention, captif, réserves. | FIN-012 |
| I18N-013 | Support oral en guaraní (Paraguay) | I18N — Multi-pays, devise & langue | P3 | Support téléphonique en guaraní. | SUP-011 |
| MKT-001 | Cartes cadeaux | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P3 | E-cartes 25–2 000 $, sans expiration, envoi programmable, versées en crédit. | MKT-002 |
| MKT-007 | Programme de fidélité guest | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P3 | Arrêté le 24/07/2025 ; jours bonus utilisables jusqu'à expiration. | MKT-002 |
| MKT-008 | Partenariats de fidélité co-brandés | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P3 | Citi/AAdvantage (crédit par trip), Qatar Avios. | MKT-002 |
| MKT-011 | Page « Weddings » et « Pitch a trip » | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P3 | Liens présents dans le footer et Trips. | MKT-010 |
| MKT-013 | Blog et communauté hôtes (OpenRoad) | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P3 | Blog et site d'advocacy. | — |
| MKT-015 | Segment partenaire dédié (Tesla FSD) | MKT — Marketing, parrainage, fidélité & cartes cadeaux | P3 | Page et bannière dédiées. | — |
| LEG-006 | « Do not sell or share my personal information » | LEG — Légal, consentements & données | P3 | Lien CCPA dans le footer. | LEG-005 |
| LEG-023 | Mentions des marques tierces | LEG — Légal, consentements & données | P3 | Mentions légales Apple/Google sur les équipements. | — |
| BKG-043 | Option « avec chauffeur » par mise en relation avec des transporteurs licenciés | BKG — Réservation & checkout | P3 | Mise en relation sans chauffeur fourni par la plateforme ; conditionnée à OQ-BR-15. | BKG-001 |

## C.4 — HORS PRODUIT (DEC-FONDATEUR-13) (24 lignes)

| feature_id | Nom | Epic (module) | Phase | Description (une ligne) | Dépendances clés |
|---|---|---|---|---|---|
| ACC-008 | Nom commercial affiché par l'hôte | ACC — Comptes & identité | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : L'hôte peut utiliser le prénom d'usage pour afficher son nom d'entreprise aux guests. | ACC-029 |
| ACC-029 | Compte personne morale (loueur, RUC) | ACC — Comptes & identité | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Compte au nom d'une société (RUC, représentant légal, Aviso de Operación). | — |
| VER-027 | Vérification des loueurs professionnels (KYB) | VER — Vérification / KYC | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : RUC, Aviso de Operación, représentant légal, polices flotte, compte bancaire de la société. | ACC-029 |
| LST-029 | Vitrine du loueur professionnel | LST — Fiche véhicule | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Page agence (logo, nom commercial, flotte, notes, conditions). | ACC-008 ; ACC-029 |
| CAL-009 | Synchronisation iCal entrante et sortante | CAL — Calendrier & disponibilité | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Import : l'agence saisit une URL iCal par véhicule, lue toutes les 15 min ; chaque VEVENT devient un blocage source=ical dans CAL-011. Conflit : si un… | CAL-011 |
| FLT-003 | Rôles fins (RBAC) pour flottes | FLT — co-hôtes et hôtes multi-véhicules | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Gérant, agent de remise, comptable ; déclaration de sinistre par un gérant. Représentant légal (AGENCY_OWNER : contrat-cadre, mandat PSP, membres) dis… | FLT-001 |
| FLT-010 | API partenaire pour loueurs | FLT — co-hôtes et hôtes multi-véhicules | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Disponibilités, prix, réservations, webhooks. | CAL-011 |
| FLT-011 | Import en masse d'annonces | FLT — co-hôtes et hôtes multi-véhicules | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Création de véhicules par CSV ou API. | HST-011 ; ADM-003 ; HST-050 ; ADM-036 |
| FLT-012 | Connecteur logiciels rent-a-car | FLT — co-hôtes et hôtes multi-véhicules | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Synchronisation avec les logiciels de gestion des loueurs. | FLT-010 |
| PRT-009 | Mode « police flotte du loueur » | PRT — Protection & assurance | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Chaque agence couvre ses véhicules par sa propre police commerciale ; la plateforme vérifie que la police couvre une location distribuée via une plate… | PRT-019 ; VER-027 |
| LEG-020 | Mandat de l'hôte à la plateforme (attorney-in-fact) | LEG — Légal, consentements & données | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Mandat donné par l'agence dans le contrat-cadre (LEG-025) : instruire les dossiers de dommage et de non-restitution, transmettre les pièces à son assu… | LEG-025 |
| PAY-033 | Mode « agence encaisse » (agence = marchand de référence) | PAY — Paiements | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Chaque agence est onboardée avec son propre compte PSP (Tilopay de préférence, cartes + Yappy ; sinon son PSP actuel). Mode (a) API, seulement avec un… | PAY-001 ; PAY-034 ; PAY-035 ; ADM-004 ; LEG-027 |
| FIN-019 | Rapprochement léger des revenus (commission vs encaissements de l'agence) | FIN — Finance, comptabilité & fiscalité | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Acteur : finance plateforme. Chaque mois, avant d'émettre la facture de commission (FIN-018) : import du relevé de transactions du compte PSP de l'age… | FIN-018 ; PAY-033 ; ADM-005 ; ADM-031 ; LEG-025 ; LEG-027 |
| LEG-025 | Contrat-cadre plateforme–loueur signé en ligne | LEG — Légal, consentements & données | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Signé avant la première annonce, versionné (LEG-002, BKG-019). Clauses : service d'intermédiation facturé au loueur ; le loueur est le loueur du véhic… | LEG-002 ; ACC-029 ; ADM-004 ; BKG-019 ; PRT-019 |
| PRT-019 | Dépôt et contrôle de la police flotte du loueur | PRT — Protection & assurance | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : L'agence téléverse sa police et une attestation de l'assureur confirmant la couverture d'une location distribuée par une plateforme tierce (OQ-MK-05)… | VER-027 |
| LEG-027 | Mandat écrit limité pour les opérations sur le compte PSP de l'agence | LEG — Légal, consentements & données | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Acteur : agence (représentant légal) et plateforme. Avant toute opération initiée par la plateforme sur le compte PSP de l'agence (création d'ordres o… | LEG-025 |
| TRP-052 | Interface agent comptoir (liste du jour, remise, retour) | TRP — Cycle de vie du trip | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Liste du jour par lieu (retraits et retours, statut paiement et KYC) ; check-in en 1 clic ; contrôle du permis (VER-015) ; saisie de la caution prise… | TRP-002 ; VER-015 ; FLT-003 ; PAY-035 ; TRP-004 |
| PAY-035 | Politique de caution de l'agence et options sans carte de crédit | PAY — Paiements | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : L'agence déclare par catégorie : montant de la caution, moyens acceptés au comptoir (pré-autorisation carte de crédit, carte de débit, espèces, Yappy… | ACC-029 |
| PAY-038 | Split de la commission à la source par le PSP | PAY — Paiements | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : L'ordre reste créé sur le compte de l'agence ; la commission est reversée à la plateforme par l'endpoint de split du PSP (Tilopay orders/liquidation/s… | FIN-018 ; PAY-033 |
| FLT-017 | Moteur de réservation en marque blanche (site et WhatsApp de l'agence) | FLT — co-hôtes et hôtes multi-véhicules | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Widget intégrable et lien aux couleurs de l'agence, branché sur le même inventaire et le même checkout ; attribution du canal pour la commission (taux… | BKG-001 ; PAY-033 |
| FLT-018 | API ouverte et connecteurs aux logiciels de location | FLT — co-hôtes et hôtes multi-véhicules | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Au-delà de FLT-010 : connecteurs vers les logiciels de gestion des agences pilotes, identifiés en entretiens avant le build (aucun identifié à ce jour… | FLT-010 |
| FLT-019 | Onboarding express : vérification des documents de l'entreprise en 48 h | FLT — co-hôtes et hôtes multi-véhicules | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Contrôle assisté des documents (RUC, Aviso de Operación, police) et import en masse avec photos ; objectif 48 h entre inscription et mise en ligne. | FLT-011 ; ADM-004 |
| REV-014 | Badge « Agencia verificada » et confiance qui réduit la caution | REV — Avis & réputation | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Badge attribué après KYB, police valide et N trips sans litige ; niveaux de confiance guest qui réduisent la caution exigée. | REV-010 ; VER-027 |
| TRP-055 | Intégration des GPS et télématiques déjà installés | TRP — Cycle de vie du trip | HORS PRODUIT | Hors produit (DEC-FONDATEUR-13), libellé historique : Connecteurs vers les GPS existants des agences (position, kilométrage, carburant), un connecteur par fournisseur. | TRP-042 |

# PARTIE D — Traçabilité

## D.1 Matrice feature → BR → EC → vecteurs de test → OQ

Générée par script (version 5, US-057, même logique que `tools/check_prd_structure.py`) à partir des fiches de la partie B (identifiants cités dans la fiche) et de la colonne `regles_liees` de 04 révision 6 : **une ligne par ligne P0 de 04 (178)**, aucune autre. Pour une fiche regroupée, les EC, vecteurs et OQ cités dans la fiche sont attribués à chacun de ses `feature_id`. « Phase » = `phase_mvp` de 04 (`P0-A` = MVP, bêta P2P). « Vecteurs » = T01–T68 de 08 et TA01–TA11 de A.8.1 ; les vecteurs par jambe TJ01–TJ21, cités dans les fiches, ne sont pas repris par la régénération. La colonne OQ fusionne les questions citées dans la fiche et celles de D.2 ; les questions `OQ-P2P-xx` de 22, citées dans les fiches, ne sont pas reprises par la régénération (motif `OQ-[A-Z]+-nn`).

| feature_id | Phase | Fiche | BR | EC | Vecteurs | OQ |
|---|---|---|---|---|---|---|
| ACC-001 | P0-A | ACC-001 — Inscription par email et mot de passe | BR-ACC-01, BR-ACC-03 | — | — | — |
| ACC-006 | P0-A | ACC-006 — Nom légal identique au permis | BR-ACC-07 | — | — | — |
| ACC-014 | P0-A | ACC-014 — Un compte par personne | BR-ACC-03, BR-TRUST-01, BR-TRUST-02, BR-VERIF-09 | EC-43 | — | — |
| VER-001 | P0-A | VER-001 — Téléversement du permis recto/verso | BR-VERIF-01, BR-VERIF-02, BR-VERIF-04, BR-VERIF-11 | — | — | OQ-MK-09 |
| VER-002 | P0-A | VER-002 / VER-003 — Selfie avec liveness et face match | BR-VERIF-01, BR-VERIF-07, BR-VERIF-09, BR-VERIF-11 | EC-43 | — | OQ-MK-09 |
| VER-003 | P0-A | VER-002 / VER-003 — Selfie avec liveness et face match | BR-VERIF-01, BR-VERIF-07, BR-VERIF-09, BR-VERIF-11 | EC-43 | — | OQ-MK-09 |
| VER-004 | P0-A | VER-004 — Consentement biométrique et rétention | BR-ACC-09, BR-VERIF-01 | — | — | OQ-BR-25, OQ-MK-09 |
| VER-005 | P0-A | VER-005 — Pièce d'identité cédula / passeport | BR-ACC-06, BR-VERIF-01 | — | — | OQ-MK-09 |
| VER-006 | P0-A | VER-006 — Règles des permis acceptés / refusés | BR-VERIF-02 | — | — | OQ-BR-21 |
| VER-007 | P0-A | VER-007 — Contrôle des 90 jours du permis étranger | BR-BOOK-10, BR-VERIF-02, BR-VERIF-09 | EC-50 | — | OQ-BR-21, UXQ-03, UXQ-08 |
| VER-013 | P0-A | VER-013 — Vérification du téléphone par OTP | BR-VERIF-06 | — | — | — |
| VER-015 | P0-A | VER-015 — Vérification du permis par l'hôte à la remise (6 points) | BR-CXL-08, BR-CXL-12, BR-CXL-13, BR-PICKUP-07, BR-PICKUP-08, BR-VERIF-07 | — | T07, T08 | — |
| VER-028 | P0-A | VER-028 — Contrôle anti-blanchiment et listes de sanctions | BR-ACC-06 | — | — | — |
| HST-049 | P0-A | HST-049 / FIN-008 — Éligibilité P2P et onboarding fiscal de l'hôte particulier | BR-ACC-06, BR-LIST-01, BR-LIST-02, BR-LIST-03, BR-PAYOUT-05, BR-PROT-10 | — | — | OQ-BR-16, OQ-BR-28, OQ-BR-35, OQ-PAY-09 |
| FIN-008 | P0-A | HST-049 / FIN-008 — Éligibilité P2P et onboarding fiscal de l'hôte particulier | BR-ACC-06, BR-LIST-01, BR-LIST-02, BR-LIST-03, BR-PAYOUT-05, BR-PROT-10 | — | — | OQ-BR-14, OQ-BR-28, OQ-BR-35, OQ-PAY-09 |
| SRC-001 | P0-A | SRC-001 / SRC-002 — Recherche lieu + dates + heures, autocomplétion | BR-BOOK-03, BR-BOOK-04, BR-BOOK-06 | — | — | — |
| SRC-002 | P0-A | SRC-001 / SRC-002 — Recherche lieu + dates + heures, autocomplétion | BR-BOOK-03, BR-BOOK-04, BR-BOOK-06 | — | — | — |
| SRC-008 | P0-A | SRC-008 / SRC-012 — Liste de résultats, carte et tri | BR-BOOK-07, BR-HP-07, BR-PRICE-13 | — | — | — |
| SRC-012 | P0-A | SRC-008 / SRC-012 — Liste de résultats, carte et tri | BR-BOOK-07, BR-HP-07, BR-PRICE-13 | — | — | — |
| SRC-011 | P0-A | SRC-011 — Carte résultat | BR-PAY-06, BR-PRICE-13 | — | T70 | — |
| SRC-042 | P0-A | SRC-042 — Affichage du total TTC | BR-PRICE-06, BR-PRICE-11, BR-PRICE-12, BR-PRICE-13, BR-PRICE-14 | — | — | — |
| LST-002 | P0-A | LST-002 — Galerie de photos | BR-LIST-05 | — | — | — |
| LST-003 | P0-A | LST-003 / LST-020 — En-tête véhicule et bloc de l'hôte | BR-HP-01, BR-REVIEW-03, BR-REVIEW-05 | — | — | — |
| LST-020 | P0-A | LST-003 / LST-020 — En-tête véhicule et bloc de l'hôte | BR-HP-01, BR-REVIEW-03, BR-REVIEW-05 | — | — | — |
| LST-006 | P0-A | LST-006 / LST-008 — Sélecteur de dates sur la fiche, dates indisponibles | BR-BOOK-03, BR-BOOK-04, BR-BOOK-06, BR-BOOK-07 | — | — | — |
| LST-008 | P0-A | LST-006 / LST-008 — Sélecteur de dates sur la fiche, dates indisponibles | BR-BOOK-03, BR-BOOK-04, BR-BOOK-06, BR-BOOK-07 | — | — | — |
| LST-007 | P0-A | LST-007 — Lieu de remise de l'hôte | BR-BOOK-02, BR-BOOK-09, BR-PICKUP-09 | — | — | OQ-MK-08 |
| LST-010 | P0-A | LST-010 — Résumé de la politique d'annulation | BR-CXL-00, BR-CXL-01, BR-CXL-06 | — | — | OQ-BR-30, UXQ-07 |
| LST-012 | P0-A | LST-012 — Distance incluse et prix du km supplémentaire | BR-MILEAGE-01, BR-MILEAGE-04, BR-PRICE-17 | — | — | — |
| LST-013 | P0-A | LST-013 — Bloc assurance et protection | BR-PAY-06, BR-PROT-01, BR-PROT-02, BR-PROT-03, BR-PROT-04 | — | — | OQ-BR-16 |
| CAL-011 | P0-A | CAL-011 — Table d'occupation unique | BR-BOOK-05, BR-BOOK-07, BR-BOOK-10 | EC-51 | — | — |
| BKG-014 | P0-A | BKG-014 — Hold de checkout et anti-double réservation | BR-BOOK-08, BR-BOOK-10, BR-BOOK-11, BR-PAY-01 | EC-51 | — | UXQ-08 |
| CAL-001 | P0-A | CAL-001 / CAL-002 — Calendrier par véhicule et blocages | BR-BOOK-07 | — | — | — |
| CAL-002 | P0-A | CAL-001 / CAL-002 — Calendrier par véhicule et blocages | BR-BOOK-07 | — | — | — |
| CAL-003 | P0-A | CAL-003 / CAL-004 — Préavis minimum et tampon entre trips | BR-BOOK-04, BR-BOOK-05, BR-BOOK-06 | EC-19 | — | — |
| CAL-004 | P0-A | CAL-003 / CAL-004 — Préavis minimum et tampon entre trips | BR-BOOK-04, BR-BOOK-05, BR-BOOK-06 | EC-19 | — | — |
| BKG-001 | P0-A | BKG-001 / BKG-006 — Checkout une page et détail du sous-total | BR-BOOK-01, BR-BOOK-08, BR-PRICE-06, BR-PRICE-11, BR-PRICE-12, BR-PRICE-13, BR-PRICE-14 | — | — | — |
| BKG-006 | P0-A | BKG-001 / BKG-006 — Checkout une page et détail du sous-total | BR-BOOK-01, BR-BOOK-08, BR-PRICE-06, BR-PRICE-11, BR-PRICE-12, BR-PRICE-13, BR-PRICE-14 | — | — | — |
| BKG-002 | P0-A | BKG-002 / BKG-025 — Conducteur principal et aptitude boîte manuelle | BR-ACC-02, BR-ACC-04, BR-ACC-08, BR-PICKUP-07, BR-VERIF-08 | — | — | — |
| BKG-025 | P0-A | BKG-002 / BKG-025 — Conducteur principal et aptitude boîte manuelle | BR-ACC-02, BR-ACC-04, BR-ACC-08, BR-PICKUP-07, BR-VERIF-08 | — | — | — |
| BKG-008 | P0-A | BKG-008 / BKG-023 — Acceptation des conditions et clauses géographiques | BR-ACC-01, BR-BOOK-12, BR-GEO-01, BR-GEO-02 | EC-45, EC-46, EC-53 | — | OQ-MK-12 |
| BKG-023 | P0-A | BKG-008 / BKG-023 — Acceptation des conditions et clauses géographiques | BR-ACC-01, BR-BOOK-12, BR-GEO-01, BR-GEO-02 | EC-45, EC-46, EC-53 | — | OQ-MK-12 |
| BKG-012 | P0-A | BKG-012 — Contrôles bloquants à la réservation | BR-ACC-04, BR-ACC-10, BR-BOOK-11, BR-PAY-06, BR-VERIF-09 | — | T59 | UXQ-08 |
| BKG-016 | P0-A | BKG-016 — Lieux de prise et de retour | BR-BOOK-09, BR-PICKUP-09 | — | — | OQ-MK-08 |
| BKG-018 | P0-A | BKG-018 — Contrat de location par trip | BR-BOOK-12, BR-CSP-02, BR-FUEL-01, BR-GEO-02, BR-LIST-01, BR-RETURN-03, BR-TT-03 | — | — | OQ-BR-24 |
| BKG-019 | P0-A | BKG-019 — Signature électronique horodatée du contrat | BR-BOOK-12, BR-CXL-08 | — | — | — |
| BKG-022 | P0-A | BKG-022 — Écran et notification de confirmation | BR-BOOK-01 | — | — | — |
| BKG-027 | P0-A | BKG-027 — Détail du trip (Manage trip) | BR-MOD-01 | — | — | — |
| LEG-026 | P0-A | LEG-026 — Constancia de arrendamiento | BR-TT-03 | EC-48 | — | OQ-BR-19 |
| PRC-001 | P0-A | PRC-001 — Prix journalier fixé par l'hôte | BR-PRICE-01, BR-PRICE-14, BR-PROT-06 | — | — | — |
| PRC-012 | P0-A | PRC-012 — Frais de service guest (trip fee) | BR-CXL-06, BR-PRICE-06 | — | T03 | OQ-BR-14, OQ-MK-01 |
| PRC-020 | P0-A | PRC-020 — Moteur de taxes par marché (ITBMS, IVA) | BR-CXL-06, BR-PRICE-12, BR-PRICE-14 | — | T43, TA01 | OQ-BR-14, OQ-MK-06 |
| PRC-021 | P0-A | PRC-021 — Arrondis et montants en unités mineures | BR-CXL-06, BR-PRICE-14 | EC-32 | T40, T42, T43, TA06 | — |
| PRC-025 | P0-A | PRC-025 — Moteur de devis versionné | BR-BOOK-03, BR-CXL, BR-MOD-06, BR-PRICE-11, BR-PRICE-13, BR-PRICE-17, BR-PROT-06 | — | T01, T03, T27, TA07 | OQ-BR-04 |
| FIN-001 | P0-A | FIN-001 — Grand livre en partie double par jambe | BR-PAYOUT-04, BR-PRICE-14 | — | T36, T39 | — |
| FIN-002 | P0-A | FIN-002 / FIN-003 — Facturation électronique : port fiscal PAC (Panama) et SIFEN (Paraguay) | BR-PAYOUT-05, BR-PRICE-06, BR-PRICE-12 | — | — | OQ-BR-14, OQ-MK-06 |
| FIN-003 | P0-A | FIN-002 / FIN-003 — Facturation électronique : port fiscal PAC (Panama) et SIFEN (Paraguay) | BR-PAYOUT-05, BR-PRICE-06, BR-PRICE-12 | — | — | OQ-BR-14, OQ-MK-06 |
| FIN-018 | P0-A | FIN-018 / PYO-013 — Facture du trip fee et relevé mensuel des gains de l'hôte | BR-CXL-13, BR-PAYOUT-04, BR-PAYOUT-05, BR-PRICE-06, BR-PRICE-12, BR-PRICE-14, BR-PROT-06 | — | T03 | OQ-BR-14, OQ-MK-06 |
| PYO-013 | P0-A | FIN-018 / PYO-013 — Facture du trip fee et relevé mensuel des gains de l'hôte | BR-CXL-13, BR-PAYOUT-04, BR-PAYOUT-05, BR-PRICE-06, BR-PRICE-12, BR-PRICE-14, BR-PROT-06 | — | T03 | OQ-MK-06 |
| PAY-001 | P0-A | PAY-001 — Abstraction du PSP de place de marché (PaymentProvider à jambes) | BR-PAY-01 | EC-29 | — | OQ-MK-02, OQ-MK-03, OQ-PAY-03 |
| PAY-002 | P0-A | PAY-002 / PAY-017 / PAY-018 — Cartes, refus et 3-D Secure | BR-BOOK-10, BR-PAY-01, BR-PAY-11 | EC-26 | — | OQ-PAY-03 |
| PAY-017 | P0-A | PAY-002 / PAY-017 / PAY-018 — Cartes, refus et 3-D Secure | BR-BOOK-10, BR-PAY-01, BR-PAY-11 | EC-26 | — | OQ-PAY-03 |
| PAY-018 | P0-A | PAY-002 / PAY-017 / PAY-018 — Cartes, refus et 3-D Secure | BR-BOOK-10, BR-PAY-01, BR-PAY-11 | EC-26 | — | OQ-PAY-03 |
| PAY-004 | P0-A | PAY-004 — Yappy (et Clave) via le PSP de place de marché | BR-PAY-01, BR-PAY-08 | — | T03, T33 | OQ-PAY-03, OQ-PAY-07, OQ-PAY-22 |
| PAY-006 | P0-A | PAY-006 — Pay now (autorisation puis capture par jambes) | BR-CXL, BR-PAY-02 | — | T28, T29, T64, TA10 | UXQ-08 |
| PAY-011 | P0-A | PAY-011 / PAY-012 / PAY-036 — Caution par carte, libération et fenêtre de rétention | BR-PAY-06, BR-PAY-08, BR-PAY-09 bis, BR-VERIF-09 | EC-27, EC-56 | T57, T58, T59, T69, T70, T71, T72, T73 | OQ-BR-12, OQ-PAY-02, OQ-PAY-04, OQ-PAY-06, OQ-PAY-17, OQ-PAY-19 |
| PAY-012 | P0-A | PAY-011 / PAY-012 / PAY-036 — Caution par carte, libération et fenêtre de rétention | BR-PAY-06, BR-PAY-08, BR-PAY-09 bis, BR-VERIF-09 | EC-27, EC-56 | T57, T58, T59, T69, T70, T71, T72, T73 | OQ-BR-12, OQ-PAY-02, OQ-PAY-04, OQ-PAY-06, OQ-PAY-17 |
| PAY-036 | P0-A | PAY-011 / PAY-012 / PAY-036 — Caution par carte, libération et fenêtre de rétention | BR-PAY-06, BR-PAY-08, BR-PAY-09 bis, BR-VERIF-09 | EC-27, EC-56 | T57, T58, T59, T69, T70, T71, T72, T73 | OQ-BR-12, OQ-PAY-02, OQ-PAY-04, OQ-PAY-06, OQ-PAY-17, OQ-PAY-19 |
| PAY-015 | P0-A | PAY-015 / PAY-037 — Carte enregistrée (MIT) et débits post-trip conformes aux réseaux | BR-ACC-10, BR-DAMAGE-08, BR-PAY-09, BR-PAY-09 bis, BR-PAY-10, BR-REIMB-03 | EC-28 | T29, T64, T68 | OQ-PAY-13, OQ-PAY-18 |
| PAY-037 | P0-A | PAY-015 / PAY-037 — Carte enregistrée (MIT) et débits post-trip conformes aux réseaux | BR-ACC-10, BR-DAMAGE-08, BR-PAY-09, BR-PAY-09 bis, BR-PAY-10, BR-REIMB-03 | EC-28 | T29, T64, T68 | OQ-BR-43, OQ-PAY-18 |
| PAY-019 | P0-A | PAY-019 — Idempotence des opérations de paiement | BR-BOOK-10 | EC-29, EC-54 | T51, T52, T68 | — |
| PAY-021 | P0-A | PAY-021 — Remboursements par jambe sur le moyen d'origine | BR-CXL, BR-CXL-01, BR-CXL-06, BR-CXL-08, BR-CXL-12, BR-CXL-14, BR-PAY-08, BR-TRUST-09 | EC-49, EC-55 | T03, T05, T14, T33, T39, T49, T50, T66, T67 | OQ-BR-44, OQ-PAY-07, OQ-PAY-22, UXQ-11 |
| PAY-034 | P0-A | PAY-034 — Preuve de paiement non réversible avant la remise des clés | BR-BOOK-10, BR-PAY-01, BR-TRUST-02 | — | — | — |
| HST-050 | P0-A | HST-050 — Catalogue de référence des véhicules | BR-LIST-04 | — | — | OQ-CAT-01 |
| ADM-036 | P0-A | ADM-036 — File d'ajout au catalogue véhicules | — | — | — | — |
| HST-005 | P0-A | HST-005 — Assistant d'annonce | BR-BOOK-01, BR-LIST-01, BR-LIST-04 | — | — | — |
| HST-011 | P0-A | HST-011 — Détails du véhicule | BR-ACC-05, BR-LIST-04, BR-PICKUP-11 | — | — | — |
| HST-012 | P0-A | HST-012 — Photos d'annonce | BR-LIST-05 | — | — | — |
| HST-016 | P0-A | HST-016 / HST-026 — Soumission, revue et cycle de vie de l'annonce | BR-LIST-01, BR-LIST-06, BR-LIST-08, BR-LIST-09 | EC-37 | — | OQ-BR-29 |
| HST-026 | P0-A | HST-016 / HST-026 — Soumission, revue et cycle de vie de l'annonce | BR-LIST-01, BR-LIST-06, BR-LIST-08, BR-LIST-09 | EC-37 | — | OQ-BR-29 |
| HST-019 | P0-A | HST-019 — Éligibilité du véhicule | BR-LIST-01, BR-LIST-02, BR-LIST-03, BR-LIST-06, BR-LIST-07 | — | — | OQ-BR-28, OQ-BR-35, OQ-CAT-01 |
| HST-033 | P0-A | HST-033 — Configuration de la distance incluse | BR-MILEAGE-01, BR-MILEAGE-02, BR-MILEAGE-04, BR-PRICE-17 | — | — | — |
| HST-039 | P0-A | HST-039 — Documents du véhicule | BR-LIST-01, BR-LIST-03, BR-PICKUP-06, BR-PROT-10 | — | — | OQ-BR-28 |
| HDB-001 | P0-A | HDB-001 / HDB-002 — Espace hôte : accueil et réservations | BR-BOOK-01, BR-COHOST-02 | — | — | — |
| HDB-002 | P0-A | HDB-001 / HDB-002 — Espace hôte : accueil et réservations | BR-BOOK-01, BR-COHOST-02 | — | — | — |
| TRP-002 | P0-A | TRP-002 — Remise et retour entre particuliers sur mobile | BR-PICKUP-01, BR-PICKUP-02, BR-PICKUP-03, BR-PICKUP-04, BR-PICKUP-06, BR-PICKUP-07 | EC-15 | — | — |
| TRP-004 | P0-A | TRP-004 — Capture in-app avec gabarit d'angles et horodatage serveur | BR-DAMAGE-02, BR-PICKUP-03, BR-RETURN-01 | — | — | — |
| TRP-007 | P0-A | TRP-007 — Refus du véhicule au départ | BR-CSP-03, BR-CXL-04, BR-CXL-13, BR-MOD-08, BR-PICKUP-06 | EC-04 | — | — |
| TRP-015 | P0-A | TRP-015 — No-show du voyageur déclaré par l'hôte et no-show de l'hôte | BR-CXL-08, BR-CXL-09, BR-CXL-13, BR-CXL-15, BR-PICKUP-04 | EC-01 | T05, T06, T26, T39 | OQ-BR-33, OQ-BR-45 |
| TRP-033 | P0-A | TRP-033 — Retour avec photos des deux côtés | BR-DAMAGE-01, BR-FUEL-01, BR-MILEAGE-03, BR-PAY-06, BR-PAYOUT-02, BR-RETURN-01, BR-RETURN-02, BR-RETURN-07 | — | — | — |
| TRP-035 | P0-A | TRP-035 — Détection automatique du retard et grille de frais | BR-BOOK-05, BR-CXL-00, BR-RETURN-03 | EC-17, EC-18, EC-19 | — | OQ-BR-04, OQ-BR-39 |
| TRP-038 | P0-A | TRP-038 — Procédure de non-restitution graduée | BR-DAMAGE-10, BR-RETURN-04, BR-TRUST-05 | EC-20 | — | OQ-BR-17 |
| TRP-045 | P0-A | TRP-045 — Machine à états du trip | BR-BOOK-01, BR-CXL, BR-CXL-08, BR-MOD, BR-PICKUP-01, BR-RETURN, BR-RETURN-03, BR-RETURN-04 | EC-54 | T05, T06, T25 | — |
| CLM-034 | P0-A | CLM-034 — Dossier de preuve exportable par trip | BR-DAMAGE-02, BR-DAMAGE-04, BR-PAY-11 | — | — | — |
| TRP-056 | P0-A | TRP-056 — Évaluation du risque PWA sur iOS | BR-PICKUP-01, BR-PICKUP-03 | — | — | — |
| TRP-057 | P0-A | TRP-057 — Mode hors ligne du check-in / check-out | BR-PICKUP-03, BR-RETURN-01 | — | — | — |
| BKG-028 | P0-A | BKG-028 — Annulation par le guest en libre-service | BR-CXL, BR-CXL-00, BR-CXL-01, BR-CXL-03, BR-CXL-06, BR-CXL-08, BR-CXL-09, BR-CXL-10 | — | T02, T03, T23, T24, T25 | OQ-BR-30, OQ-BR-38 |
| BKG-032 | P0-A | BKG-032 — Annulation par l'hôte avec motif et pénalités | BR-CXL-12, BR-CXL-13, BR-HP-03, BR-REVIEW-06, BR-TRUST-09 | — | T07, T08, T14, T15, T26, T61, T62 | OQ-BR-24, OQ-BR-37 |
| BKG-035 | P0-A | BKG-035 — Annulation par la plateforme | BR-CXL-07, BR-CXL-14, BR-LIST-06, BR-PAY-08, BR-TRUST-05 | — | T16, T17, T18, T19, T20, T22, T61, TA09 | OQ-BR-41 |
| PRT-001 | P0-A | PRT-001 / PRT-002 / BKG-003 / PRC-018 — Protections du voyageur : niveaux, éligibilité, choix au checkout et prix | BR-ACC-04, BR-PRICE-11, BR-PROT-01, BR-PROT-02, BR-PROT-03 | — | — | OQ-BR-16 |
| PRT-002 | P0-A | PRT-001 / PRT-002 / BKG-003 / PRC-018 — Protections du voyageur : niveaux, éligibilité, choix au checkout et prix | BR-ACC-04, BR-PRICE-11, BR-PROT-01, BR-PROT-02, BR-PROT-03 | — | — | OQ-BR-16 |
| BKG-003 | P0-A | PRT-001 / PRT-002 / BKG-003 / PRC-018 — Protections du voyageur : niveaux, éligibilité, choix au checkout et prix | BR-ACC-04, BR-PRICE-11, BR-PROT-01, BR-PROT-02, BR-PROT-03 | — | — | OQ-BR-16 |
| PRC-018 | P0-A | PRT-001 / PRT-002 / BKG-003 / PRC-018 — Protections du voyageur : niveaux, éligibilité, choix au checkout et prix | BR-ACC-04, BR-PRICE-11, BR-PROT-01, BR-PROT-02, BR-PROT-03 | — | — | OQ-BR-16 |
| PRT-003 | P0-A | PRT-003 / PRT-013 — RC tiers incluse et mentions de l'assureur | BR-PROT-01, BR-PROT-04 | — | — | OQ-BR-16 |
| PRT-013 | P0-A | PRT-003 / PRT-013 — RC tiers incluse et mentions de l'assureur | BR-PROT-01, BR-PROT-04 | — | — | OQ-BR-16 |
| PRT-007 | P0-A | PRT-007 / PRT-008 / HST-048 — Plans de gains de l'hôte | BR-PROT-06, BR-PROT-07, BR-PROT-08 | — | — | OQ-BR-16 |
| PRT-008 | P0-A | PRT-007 / PRT-008 / HST-048 — Plans de gains de l'hôte | BR-PROT-06, BR-PROT-07, BR-PROT-08 | — | — | OQ-BR-16 |
| HST-048 | P0-A | PRT-007 / PRT-008 / HST-048 — Plans de gains de l'hôte | BR-PROT-06, BR-PROT-07, BR-PROT-08 | — | — | OQ-BR-16 |
| PRT-011 | P0-A | PRT-011 — Protection minimale imposée | BR-PROT-01, BR-VERIF-09 | — | — | OQ-BR-16 |
| PRT-015 | P0-A | PRT-015 — Exclusions côté hôte et période couverte | BR-PROT-03, BR-PROT-09 | — | — | OQ-BR-16 |
| MSG-001 | P0-A | MSG-001 / MSG-007 — Messagerie par trip et détection du marché gris | BR-BOOK-02, BR-CXL-08, BR-TRUST-02, BR-TRUST-06 | EC-40 | — | — |
| MSG-007 | P0-A | MSG-001 / MSG-007 — Messagerie par trip et détection du marché gris | BR-BOOK-02, BR-CXL-08, BR-TRUST-02, BR-TRUST-06 | EC-40 | — | — |
| NTF-001 | P0-A | NTF-001 — Moteur de notifications multicanal | BR-NOTIF | — | — | — |
| NTF-002 | P0-A | NTF-002 — Gabarits WhatsApp Business approuvés | BR-NOTIF | — | — | — |
| NTF-007 | P0-A | NTF-007 / NTF-011 — Confirmation de réservation et notifications de trip | BR-BOOK-01, BR-NOTIF, BR-PICKUP-01, BR-PICKUP-09 | — | — | — |
| NTF-011 | P0-A | NTF-007 / NTF-011 — Confirmation de réservation et notifications de trip | BR-BOOK-01, BR-NOTIF, BR-PICKUP-01, BR-PICKUP-09 | — | — | — |
| REV-001 | P0-A | REV-001 / REV-010 — Avis du voyageur et agrégats | BR-REVIEW-01, BR-REVIEW-03, BR-REVIEW-04, BR-REVIEW-05, BR-REVIEW-07 | — | — | — |
| REV-010 | P0-A | REV-001 / REV-010 — Avis du voyageur et agrégats | BR-REVIEW-01, BR-REVIEW-03, BR-REVIEW-04, BR-REVIEW-05, BR-REVIEW-07 | — | — | — |
| REV-002 | P0-A | REV-002 / REV-004 — Avis de l'hôte sur le voyageur et publication en double aveugle | BR-REVIEW-01, BR-REVIEW-02, BR-REVIEW-03, BR-REVIEW-04, BR-REVIEW-05, BR-REVIEW-06, BR-REVIEW-07 | EC-42 | — | — |
| REV-004 | P0-A | REV-002 / REV-004 — Avis de l'hôte sur le voyageur et publication en double aveugle | BR-REVIEW-01, BR-REVIEW-02, BR-REVIEW-03, BR-REVIEW-04, BR-REVIEW-05, BR-REVIEW-06, BR-REVIEW-07 | EC-42 | — | — |
| CLM-001 | P0-A | CLM-001 / CLM-002 — Déclaration de dommage par l'hôte et d'incident par le voyageur | BR-COHOST-02, BR-DAMAGE-01, BR-DAMAGE-02, BR-DAMAGE-10, BR-PROT-05 | EC-12, EC-13 | — | — |
| CLM-002 | P0-A | CLM-001 / CLM-002 — Déclaration de dommage par l'hôte et d'incident par le voyageur | BR-COHOST-02, BR-DAMAGE-01, BR-DAMAGE-02, BR-DAMAGE-10, BR-PROT-05 | EC-12, EC-13 | — | — |
| CLM-006 | P0-A | CLM-006 — Instruction d'un dossier de sinistre | BR-DAMAGE-02, BR-DAMAGE-03, BR-DAMAGE-04, BR-DAMAGE-06, BR-DAMAGE-11, BR-PAY-09 bis, BR-PROT-06 | EC-41, EC-47, EC-56 | — | OQ-BR-16, OQ-BR-24 |
| CLM-021 | P0-A | CLM-021 — Frais annexes : paiement ou contestation par le voyageur | BR-PAY-06, BR-PAY-09 bis, BR-PAY-10, BR-REIMB-01, BR-REIMB-02, BR-REIMB-03 | — | — | OQ-PAY-18 |
| ADM-008 | P0-A | ADM-008 — Arbitrage des litiges et factures contestées | BR-CXL, BR-DAMAGE-04, BR-REIMB-03 | — | T36, T49, T50, T67 | — |
| LEG-024 | P0-A | LEG-024 — Preuves et décisions motivées (pratique ACODECO) | BR-PAY-06, BR-REIMB-03 | — | — | OQ-BR-24 |
| ADM-001 | P0-A | ADM-001 — Console admin avec RBAC, 2FA et journal d'audit | BR-TRUST-05 | — | — | OQ-BR-25 |
| ADM-002 | P0-A | ADM-002 / ADM-003 — Files de revue KYC et annonces | BR-LIST-01, BR-LIST-02, BR-LIST-08, BR-VERIF-04 | — | — | — |
| ADM-003 | P0-A | ADM-002 / ADM-003 — Files de revue KYC et annonces | BR-LIST-01, BR-LIST-02, BR-LIST-08, BR-VERIF-04 | — | — | — |
| ADM-004 | P0-A | ADM-004 — Revue de l'inscription des hôtes particuliers | BR-ACC-06, BR-LIST-01 | — | — | — |
| ADM-005 | P0-A | ADM-005 — Fiche utilisateur 360° | BR-ACC-10, BR-TRUST-05 | — | — | — |
| ADM-006 | P0-A | ADM-006 — Gestion des trips par les agents | BR-CXL-14, BR-MOD-04, BR-MOD-08, BR-TRUST-05 | — | T37, T65 | OQ-BR-46 |
| ADM-007 | P0-A | ADM-007 — Remboursements, gestes commerciaux et crédits | BR-PAY-07, BR-PAY-08, BR-PAYOUT-04 | — | TA09 | — |
| ADM-014 | P0-A | ADM-014 / ADM-031 — Paramétrage par pays et paramètres par défaut | BR-ACC-04, BR-CXL-00, BR-CXL-01, BR-CXL-13, BR-PROT-06, BR-RETURN-03 | — | T61 | OQ-BR-04, OQ-BR-14, OQ-BR-30, OQ-BR-33, OQ-BR-41 |
| ADM-031 | P0-A | ADM-014 / ADM-031 — Paramétrage par pays et paramètres par défaut | BR-ACC-04, BR-CXL-00, BR-CXL-01, BR-CXL-13, BR-PROT-06, BR-RETURN-03 | — | T61 | OQ-BR-04, OQ-BR-14, OQ-BR-30, OQ-BR-33, OQ-BR-41 |
| ADM-022 | P0-A | ADM-022 — Tableau ops des véhicules en retard / non restitués | BR-RETURN-04 | EC-20 | — | — |
| ADM-027 | P0-A | ADM-027 — Interrupteurs par pays et par segment | — | — | — | OQ-BR-16, OQ-BR-35, OQ-MK-02, OQ-PAY-09 |
| ADM-029 | P0-A | ADM-029 — File de revue des réservations à risque | BR-CXL-07, BR-TRUST-01, BR-VERIF-09 | EC-43 | T61 | OQ-BR-41, UXQ-08, UXQ-12 |
| ADM-032 | P0-A | ADM-032 / ADM-035 — Sauvegardes, monitoring, journal d'accès ; RPO/RTO et reprise | BR-ACC-09 | — | — | OQ-MK-09 |
| ADM-035 | P0-A | ADM-032 / ADM-035 — Sauvegardes, monitoring, journal d'accès ; RPO/RTO et reprise | BR-ACC-09 | — | — | OQ-MK-09 |
| SUP-004 | P0-A | SUP-004 / SUP-011 — Ligne d'urgence, support en horaires étendus, bilingue | BR-PROT-05 | — | — | — |
| SUP-011 | P0-A | SUP-004 / SUP-011 — Ligne d'urgence, support en horaires étendus, bilingue | BR-PROT-05 | — | — | — |
| SUP-020 | P0-A | SUP-020 — Plan de dotation du support et de l'exploitation | — | — | — | — |
| ADM-033 | P0-A | ADM-033 — Revue de sécurité avant ouverture | — | — | — | — |
| ADM-034 | P0-A | ADM-034 — Préproduction et déploiement réversible | — | — | — | — |
| LEG-001 | P0-A | LEG-001 / LEG-002 — CGU et consentements horodatés et versionnés | BR-ACC-01 | — | — | — |
| LEG-002 | P0-A | LEG-001 / LEG-002 — CGU et consentements horodatés et versionnés | BR-ACC-01 | — | — | — |
| LEG-009 | P0-A | LEG-009 / LEG-010 — Rétention, pseudonymisation, registre Ley 81 | BR-ACC-09, BR-VERIF-01 | — | — | OQ-BR-25, OQ-MK-09, UXQ-11 |
| LEG-010 | P0-A | LEG-009 / LEG-010 — Rétention, pseudonymisation, registre Ley 81 | BR-ACC-09, BR-VERIF-01 | — | — | OQ-BR-25, OQ-MK-09, UXQ-11 |
| LEG-011 | P0-A | LEG-011 / LEG-015 — Centre légal, litiges et droit applicable | BR-ACC-01, BR-CXL | — | — | OQ-BR-24 |
| LEG-015 | P0-A | LEG-011 / LEG-015 — Centre légal, litiges et droit applicable | BR-ACC-01, BR-CXL | — | — | OQ-BR-24 |
| LEG-014 | P0-A | LEG-014 — Positionnement d'intermédiaire entre particuliers | — | — | — | OQ-BR-16, OQ-MK-01 |
| LEG-021 | P0-A | LEG-021 — Avertissements réglementaires locaux | — | — | — | OQ-BR-35, OQ-PAY-09 |
| I18N-003 | P0-A | I18N-003 / I18N-004 / I18N-005 — Espagnol et anglais, devises USD et PYG | BR-CXL-00, BR-PRICE-14 | — | T48, T62, TA01 | — |
| I18N-004 | P0-A | I18N-003 / I18N-004 / I18N-005 — Espagnol et anglais, devises USD et PYG | BR-CXL-00, BR-PRICE-14 | — | T48, T62, TA01 | — |
| I18N-005 | P0-A | I18N-003 / I18N-004 / I18N-005 — Espagnol et anglais, devises USD et PYG | BR-CXL-00, BR-PRICE-14 | — | T48, T62, TA01 | — |
| PYO-001 | P0-A | PYO-001 — Compte de versement de l'hôte et vérification | BR-ACC-06, BR-PAYOUT-01 | — | — | OQ-PAY-05, OQ-PAY-09, OQ-PAY-20 |
| PYO-002 | P0-A | PYO-002 — Versements aux hôtes depuis la jambe HOST | BR-PAYOUT-01, BR-PAYOUT-02, BR-PAYOUT-03, BR-PAYOUT-04 | — | — | OQ-PAY-05, OQ-PAY-09, OQ-PAY-20, OQ-PAY-21 |
| PYO-003 | P0-A | PYO-003 — Versements aux particuliers (B2C) par le PSP | BR-PAYOUT-01, BR-PAYOUT-05 | — | — | OQ-PAY-05, OQ-PAY-09 |
| PYO-007 | P0-A | PYO-007 — Grand livre de l'hôte, compensations et solde négatif | BR-CXL-13, BR-PAY-11, BR-PAYOUT-04 | — | T41, T53, T54, T55 | OQ-MK-02, OQ-PAY-21 |
| FIN-004 | P0-A | FIN-004 — Collecte et reversement des taxes | BR-CXL-06, BR-PAY-11, BR-PRICE-06, BR-PRICE-12 | — | T44 | OQ-BR-14, OQ-MK-06 |
| FIN-005 | P0-A | FIN-005 — Rapprochement PSP et banques par jambe | — | — | — | — |
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
| PAY-041 | P0-A | PAY-041 — Porte go / no-go du PSP de place de marché, par pays | — | — | — | OQ-PAY-03, OQ-PAY-04, OQ-PAY-08, OQ-PAY-20, OQ-PAY-21, OQ-PAY-22 |
| PAY-042 | P0-A | PAY-042 / FIN-020 / VER-029 — Connecteurs réels du pays de lancement (PSP, facture électronique, KYC) | BR-PAY-01, BR-PRICE-12, BR-VERIF-01 | — | — | — |
| FIN-020 | P0-A | PAY-042 / FIN-020 / VER-029 — Connecteurs réels du pays de lancement (PSP, facture électronique, KYC) | BR-PAY-01, BR-PRICE-12, BR-VERIF-01 | — | — | — |
| VER-029 | P0-A | PAY-042 / FIN-020 / VER-029 — Connecteurs réels du pays de lancement (PSP, facture électronique, KYC) | BR-PAY-01, BR-PRICE-12, BR-VERIF-01 | — | — | — |

## D.2 Fiches dont la mise en service dépend de questions ouvertes

**Build autorisé partout** (DEC-FONDATEUR-02, aligné sur A.6) : aucune ligne de ce tableau n'attend un avis pour être construite et testée contre les adaptateurs `FAKE` (DEC-FONDATEUR-03) ; la question bloque seulement la **mise en service**, pays par pays, par les interrupteurs de 08 (« Règle de blocage ») et 17 §0.1, tous à `false` en production. Le mode dégradé indiqué est celui des fiches (jamais une décision prise à la place du fondateur ou de l'avocat). Version 4 : la mention « porte G2 : aucun build avant avis » de PAY-011, PAY-036 et des lignes de l'ex-P0-B est **supprimée** (contredisait DEC-FONDATEUR-02, analyse pivot §g.1 point 2).

| feature_id | Questions ouvertes | Effet / mode dégradé (build autorisé ; mise en service fermée) |
|---|---|---|
| VER-001 | OQ-MK-09 | KYC réel en production fermé tant que registre et transferts Ley 81 non validés ; build contre `FAKE` (VER-029 au lot C) |
| VER-002 | OQ-MK-09 | biométrie : idem VER-001 |
| VER-003 | OQ-MK-09 | biométrie : idem VER-001 |
| VER-004 | OQ-BR-25, OQ-MK-09 | durée de conservation provisoire (≤ 3 ans) |
| VER-005 | OQ-MK-09 | pièces d'identité transmises au fournisseur hors Panama |
| VER-006 | OQ-BR-21 | liste des permis : IDP et permis non latins non tranchés |
| VER-007 | OQ-BR-21, UXQ-03, UXQ-08 | mode signalement (FLAG) ; refus automatique interdit avant avis ; champs statut / date d'entrée au checkout si le fournisseur KYC ne peut pas les collecter |
| HST-049 | OQ-BR-35, OQ-BR-16, OQ-PAY-09 | activation de l'hôte fermée par `p2p_private_hosts_enabled[pays]` et `insurer_contract_active[pays]` (`HOST_PAYOUT_RAIL_UNAVAILABLE`, `INSURER_CONTRACT_INACTIVE`) ; défaut OQ-P2P-01 (21 ans, KYC du PSP, sanctions) |
| FIN-008 | OQ-PAY-09, OQ-BR-14 | au Paraguay, hôte sans RUC non activable tant qu'OQ-PAY-09 est ouverte (défaut OQ-P2P-07) |
| HST-019 | OQ-BR-35, OQ-BR-28 | véhicule de particulier publiable en build ; publication réelle fermée avec l'activation des hôtes |
| HST-039 | OQ-BR-28 | véhicule financé : consentement écrit du créancier exigé (`vehicle_financed_requires_lender_consent` = `true`, défaut OQ-P2P-02) |
| HST-026 | OQ-BR-29 | retrait d'annonce avec trips futurs |
| LST-010 | OQ-BR-30 | seuil dernière minute 24/25 h |
| LST-013 | OQ-BR-16 | texte de la protection de l'assureur partenaire ; vente fermée par `insurer_contract_active[pays]` |
| BKG-012 | UXQ-08 | réservation signalée : hold `CHECKOUT` `review_required`, revue avant le débit (`REVIEW_BEFORE_CHARGE`) ; les deux branches paramétrées |
| BKG-014 | UXQ-08 | durée de la revue `review_hold_minutes` = 120 (PROPOSÉ) ; hold `CHECKOUT` seul |
| BKG-018 | OQ-BR-24 | modèle de contrat de location hôte–voyageur validé par l'avocat |
| BKG-028 | OQ-BR-30, OQ-BR-38 | seuil dernière minute ; lignes annexes |
| BKG-032 | OQ-BR-37, OQ-BR-24 | portée des exemptions de l'hôte ; pénalités forfaitaires de l'hôte |
| BKG-035 | OQ-BR-41 (DEC-FONDATEUR-01) | indemnisation de l'hôte par la plateforme : défaut 0 (T61) ; tests T17/T18/T20 désactivés |
| PAY-001 | OQ-PAY-03, OQ-MK-02, OQ-MK-03 | adaptateur `FAKE` seulement jusqu'au choix du pays ; variante A seule tant que `funds_holding_enabled[pays]` = `false` |
| PAY-004 | OQ-PAY-07, OQ-PAY-22 | Yappy seulement si le PSP de place de marché a `SUPPORTS_YAPPY_IN_MARKETPLACE` (inconnue ⇒ non) ; remboursement Yappy |
| PAY-011 | OQ-PAY-02, OQ-PAY-04, OQ-PAY-06, OQ-PAY-17, OQ-PAY-19, OQ-BR-12 | caution construite (rails 1 à 4 de BR-PAY-06) ; rail « débit puis remboursement » fermé tant que `funds_holding_enabled[pays]` = `false` ; sans rail valide : `DEPOSIT_RAIL_UNAVAILABLE` avant le paiement (T59) |
| PAY-012 | OQ-PAY-02, OQ-PAY-04, OQ-PAY-17, OQ-BR-12 | idem PAY-011 |
| PAY-036 | OQ-PAY-02, OQ-PAY-04, OQ-PAY-17, OQ-PAY-19, OQ-BR-12 | idem PAY-011 ; fenêtre de rétention paramétrée |
| PAY-015 | OQ-PAY-13, OQ-PAY-18 | carte enregistrée et débits MIT construits ; `SUPPORTS_MIT` bloquante à la porte PAY-041 |
| PAY-037 | OQ-PAY-18, OQ-BR-43 | idem PAY-015 |
| PAY-018 | OQ-PAY-03 | disponibilité 3DS par PSP |
| PAY-021 | OQ-BR-44, OQ-PAY-07, OQ-PAY-22, UXQ-11 | remboursement Yappy ; échéance hors Yappy ; responsable des coordonnées bancaires du voyageur ; crédit cash fermé sans `funds_holding_enabled[pays]` |
| PRC-012 | OQ-MK-01, OQ-BR-14 | trip fee construit (BR-PRICE-06, jambe `PLATFORM`) ; formulation soumise à l'avis art. 288 ; taxe sur le trip fee |
| PRC-020 | OQ-BR-14, OQ-MK-06 | assiette ITBMS / IVA |
| PRC-025 | OQ-BR-04 (décision fondateur) | tolérance de jour facturé paramétrée (29 min provisoire) |
| TRP-015 | OQ-BR-33, OQ-BR-45 | grâce no-show 60 min ; hôte inéligible : retenue à la jambe `PLATFORM` (défaut « comme Turo », TJ05) ; avis consommation avant la mise en service |
| TRP-035 | OQ-BR-04 (décision fondateur), OQ-BR-39 | grâce de retard et frontière retard/extension paramétrées |
| TRP-038 | OQ-BR-17 | récupération de la voiture par la plateforme exclue |
| CLM-006 | OQ-BR-24, OQ-BR-16 | « décision définitive » non utilisée ; déclaration à l'assureur selon son contrat |
| CLM-021 | OQ-PAY-18 | débit MIT des frais annexes |
| PRT-001 | OQ-BR-16 | vente des protections fermée par `insurer_contract_active[pays]` ; défaut OQ-P2P-12 (3 niveaux, Básica obligatoire) |
| PRT-002 | OQ-BR-16 | idem PRT-001 |
| PRT-011 | OQ-BR-16 | idem PRT-001 (`guest_protection_min_level` = `BASICA`) |
| BKG-003 | OQ-BR-16 | idem PRT-001 |
| PRC-018 | OQ-BR-16 | grille de prix fixée avec l'assureur ; idem PRT-001 |
| PRT-003 | OQ-BR-16 | RC tiers par l'assureur partenaire ; idem PRT-001 |
| PRT-007 | OQ-BR-16 | plans de gains de l'hôte fermés avec l'activation des hôtes ; défaut OQ-P2P-11 (`ESTÁNDAR`) |
| PRT-008 | OQ-BR-16 | idem PRT-007 |
| PRT-015 | OQ-BR-16 | idem PRT-007 |
| HST-048 | OQ-BR-16 | idem PRT-007 |
| PYO-001 | OQ-PAY-05, OQ-PAY-09, OQ-PAY-20 | compte de versement construit ; activation fermée sans `SUPPORTS_B2C_PAYOUT` validée |
| PYO-002 | OQ-PAY-05, OQ-PAY-09, OQ-PAY-20, OQ-PAY-21 | versements construits ; lots `ON_HOLD` tant que `payouts_enabled[pays]` = `false` (défauts OQ-P2P-07, OQ-P2P-08) |
| PYO-003 | OQ-PAY-05, OQ-PAY-09 | idem PYO-002 ; `HOST_PAYOUT_RAIL_UNAVAILABLE` sans la capacité |
| PYO-007 | OQ-PAY-21, OQ-MK-02 | `host_ledger` construit ; avance de Kmino au-delà du solde `PLATFORM` fermée sans `funds_holding_enabled[pays]` |
| PYO-013 | OQ-MK-06 | mentions fiscales du relevé des gains |
| FIN-002 | OQ-MK-06, OQ-BR-14 | entité qui facture, PAC |
| FIN-004 | OQ-BR-14, OQ-MK-06 | jambe `TAX_THIRD_PARTY` paramétrée, vide par défaut |
| FIN-018 | OQ-MK-06, OQ-BR-14 | fiscalité du trip fee et des frais de l'hôte |
| ADM-006 | OQ-BR-46 | jour minimum en fin anticipée |
| ADM-014 | OQ-BR-41 (DEC-FONDATEUR-01) | clé `platform_funded_host_compensation` absente = `false` |
| ADM-027 | OQ-BR-35, OQ-BR-16, OQ-MK-02, OQ-PAY-09 | les quatre interrupteurs restent à `false` en production ; passage à `true` seulement sur décision écrite du fondateur et par deux personnes distinctes (RLS-27) |
| ADM-029 | OQ-BR-41, UXQ-08, UXQ-12 | annulation PLATFORM_REVIEW_DELAY : indemnisation de l'hôte défaut 0 ; moment du débit d'une réservation signalée ; refus après paiement remboursé par Kmino |
| ADM-031 | OQ-BR-04, OQ-BR-41 (DEC-FONDATEUR-01), OQ-BR-30, OQ-BR-33, OQ-BR-14 | valeurs À DÉCIDER au jalon J-ADM-031 |
| LEG-009 | OQ-BR-25 | durées prudentes en attendant |
| LEG-010 | OQ-MK-09, UXQ-11 | registre et délais de notification à valider par l'avocat |
| LEG-014 | OQ-MK-01 | formulation « intermédiaire entre particuliers » soumise à l'avis art. 288 |
| LEG-015 | OQ-BR-24 | pas de clause « définitive » ni d'arbitrage |
| LEG-021 | OQ-BR-35 | textes des avertissements par pays validés par l'avocat |
| LEG-024 | OQ-BR-24 | Ley 45/2007 à vérifier |
| LEG-026 | OQ-BR-19 | transfert d'amende au conducteur (P1) |
| PAY-041 | OQ-PAY-03, OQ-PAY-22 | porte go / no-go du PSP de place de marché à décider après le choix du pays, avant la mise en service (lot C) |

Total : **68** lignes P0 concernées, toutes **construites** ; aucune ligne n'attend un avis pour son build. Décisions du fondateur explicitement laissées ouvertes : **DEC-FONDATEUR-01** (OQ-BR-41) et **OQ-BR-04** ; décisions produit ouvertes et paramétrées : UXQ-08 et OQ-BR-45 (avis consommation). Questions sans objet depuis le pivot (22) : UXQ-02, UXQ-09, UXQ-10, OQ-MK-05, OQ-MK-07, OQ-MK-11.


## D.3 Contrôle automatique de couverture (2026-11-03, version 5 : révision P2P, US-057, après les revues du bloc)

Scripts **versionnés** de `tools/` (lancés par `scripts/ci/check-spec-tools.py`, attentes dans `tools/registry.json`) : `python -I -X utf8 tools/check_prd_structure.py` (couverture des 178 lignes P0 de 04 révision 6, 24 rubriques, Given/When/Then, partie C dont les 24 lignes `HORS`, existence de chaque identifiant cité — feature_id, BR, SM, EC, T, TA, OQ, UXQ, écrans 10b, ADR, DEC —, absence des noms de la version 1, régénération de D.1) et `python -I -X utf8 tools/verif15_struct.py` (mêmes contrôles, plus phase, lot et `beta_pilote` de chaque fiche contre 04). Sortie de `check_prd_structure.py` :

```
P0 dans 04 : 178 ; fiches : 128 ; feature_id couverts : 178 ; manquants : [] ; doublons : [] ; hors P0 : []
Fiches au format incomplet ou désordonné (24 rubriques) : []
Critères Given/When/Then déséquilibrés : []
Lignes P1-P3 : 498 ; absentes de la partie C : 0
BR : 137 distincts cités ; inconnus : []
SM : 10 distincts cités ; inconnus : []
EC : 33 distincts cités ; inconnus : []
T : 49 distincts cités ; inconnus : []
TA : 11 distincts cités ; inconnus : []
OQ : 54 distincts cités ; inconnus : []
UXQ : 8 distincts cités ; inconnus : []
écran : 31 distincts cités ; inconnus : []
ADR : 17 distincts cités ; inconnus : []
DEC : 15 distincts cités ; inconnus : []
feature_id cités inconnus de 04 : []
Noms de la version 1 encore présents : {}
D.1 : 178 lignes ; écarts avec la régénération : []
Fiches avec rubrique Source citant les écrans 10b : 128/128
RÉSULTAT : OK
```

`verif15_struct.py` : `sheets with heading problems 0`, `P0 missing from sheets: []`, `dup ids []`, `feature refs unknown []`, 0 écart de phase, de lot ou de `beta_pilote` avec 04, `sheets with non GWT-balanced AC 0`, `non-P0 in sheets: []`, `HORS without marker: []`, `HORS with sheet: []` (contrôles ajoutés le 2026-11-03 : une ligne P0 passée en `HORS`, ou une ligne `HORS` sans marqueur, fait échouer la porte). `tools/check_backlog.py` recompte aussi, depuis 04 et 19, les comptes de 21 (FINAL-FEAT-INV, FINAL-E0 à E18) ; `tools/check_inventory.py` contrôle le marqueur « HORS PRODUIT » et refuse la phase P0-B.

**Vecteurs TA** (réécrits le 2026-11-03 pour la version 5) : `tools/check_ta_consolidation.py` recalcule indépendamment les jambes `HOST` et `PLATFORM` de TA01 à TA06, contrôle TA04 (remboursement intégral, pénalité au `host_ledger`), relit les lignes TJ01, TJ02a, TJ02b, TJ03, TJ05a, TJ05b, TJ08a et TJ10b de 08 (Σ jambes = total, capture + void = autorisation, Σ variations = − remboursement), vérifie que chaque montant cité par TA08, TA10 et TA11 vient de ces lignes TJ et qu'aucun montant de la version 4 (commission, mandat, variante d'agence) ne subsiste ; `tools/verif15_ta.py` (auditeur, ne lit pas ce PRD) recalcule TA01 à TA07 et TA09. Sortie résumée de `check_ta_consolidation.py` :

```
TA01–TA06 — recalcul des jambes HOST et PLATFORM (configuration PA1)
Lignes TJ de 08 E7
Montants cités par TA08, TA10, TA11 : tous issus des lignes TJ
  OK  TA08 : 15 montants cités
  OK  TA10 : 6 montants cités
  OK  TA11 : 6 montants cités
RÉSULTAT : OK
```

Limites connues : les clés de gabarit `EVT_…` restent des noms de ce PRD (correspondance en A.8.2) ; une partie des noms de données descriptifs n'a pas d'équivalent exact dans 17 ; les références `TJxx` et `OQ-P2P-xx` des fiches ne sont pas contrôlées par `check_prd_structure.py` (motifs absents) : elles ont été vérifiées contre 08 et 22 par le script de l'auteur ; les vecteurs TA restent PROPOSÉS.

> **Historique (version 5, pivot P2P)** : les journaux D.4 à D.6 et la table « Contradictions résiduelles » décrivent les versions 2 à 4 de ce PRD, écrites pour le modèle d'agences abandonné (DEC-FONDATEUR-13) ; les fiches, holds, rôles, paramètres et vecteurs qu'ils citent (`AGENCY_LINK`, `p0a_ineligible_no_show_outcome`, TA10 et TA11 de la version 4, police flotte, comptoir, contrat-cadre, mandat, commission) sont **sans objet**. Ils sont gardés pour la traçabilité.

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

## D.7 Journal — révision P2P, version 5 (US-057, 2026-11-02)

Source : `docs/team/impact/2026-11-02-pivot-p2p.md` (§b.2, §e, §g ligne S5, §g.1) ; passations US-053 à US-056 et US-059 (écarts pour S5) ; 04 révision 6 ; 08 révisé ; 17 v6 ; 10b v3 ; DEC-FONDATEUR-11 à 16.

| # | Écart (analyse pivot §b.2 ou passation) | Correction dans 16 | Statut |
|---|---|---|---|
| S5-01 | A.1 « pro-first », proposition de valeur pour l'agence, « aucun fonds détenu » sans condition (§g.1 point 4) | A.1 réécrite : vision P2P comme Turo, modèle d'argent par jambes, « aucun fonds détenu » avec la phrase de 17 §0.1 | Appliqué |
| S5-02 | A.2 PER-03, PER-04 d'agence ; PER-08 en P2 | PER-03 et PER-04 sans objet ; PER-08 hôte particulier en P0, `P2P_HOST` ; PER-09 co-hôte (P1) | Appliqué |
| S5-03 | A.3 bêta d'agences, P0-B, P2 = P2P | une trajectoire : tranche des lots 0 à 4, puis bêta P2P complète (178 lignes) ; P0-B sans objet ; comptes de 04 révision 6 | Appliqué |
| S5-04 | A.4 : hôtes particuliers, trip fee, protections en non-objectifs ; police flotte | les agences et la détention de fonds en production deviennent les non-objectifs | Appliqué |
| S5-05 | A.5 critères S1 à S4 d'agences ; M4, M9, M10 | critères de 18 v5 §1.1 ; M4, M9 à M12 pour le P2P | Appliqué |
| S5-06 | A.6 portes G0, G1a, G1b, G2 et polices flotte ; « aucun build » | préconditions C1 à C18 de 18 v5 §3, **mise en service** seulement ; gouvernance des interrupteurs | Appliqué |
| S5-07 | A.7 NFR-05, NFR-07, NFR-12, NFR-14 (comptoir, secrets d'agence, l'agence voit le résultat KYC) | minimisation entre particuliers, RLS-1 à RLS-28, espace hôte | Appliqué |
| S5-08 | A.8 rôles `AGENCY_*`, `P2P_HOST` désactivé | rôles de 17 v6 §2.3 ; catalogue des codes d'erreur P2P (dont `LEG_AMOUNT_NEGATIVE`, `LEG_SUM_MISMATCH`, `LEG_ALREADY_RELEASED`, `DEPOSIT_RAIL_UNAVAILABLE`, `HOST_PAYOUT_RAIL_UNAVAILABLE`, `INSURER_CONTRACT_INACTIVE` ; `AGENCY_LINK_LIMIT` supprimé) | Appliqué |
| S5-09 | A.8.2 noms de 17 v2 à v4 (`AGENCY_LINK`, `master_agreement`, `psp_mandate`, `commission_statement`, `kyb_case`, `insurance_policy`…) | correspondance vers 17 v6, lignes historiques marquées « sans objet » ; gabarits renommés | Appliqué |
| S5-10 | A.8.1 TA08 (commission 12 %), TA10 (autorisation sous mandat), TA11 (`p0a_ineligible_no_show_outcome`) ; TA01 à TA06 avec commission (§g.1 point 1, US-055) | TA08 → TJ01, TJ02, TJ08, TJ10 (et TJ19 à TJ21) ; TA10 → TJ03 ; TA11 → TJ05 ; TA01 à TA06 donnent les jambes `HOST` et `PLATFORM` ; TA04 = annulation par l'hôte | Appliqué |
| S5-11 | Partie B : fiches E1, E5 à E9, E11, E13 d'agence ; E14 / E15 en P0-B | partie B recomposée selon 04 README §4 révision 6 ; 17 fiches HORS PRODUIT retirées (ACC-008, ACC-029, VER-027, CAL-009, FLT-001 / FLT-003, FIN-019, PAY-033, PAY-035, PAY-038, PRT-019, LEG-025, FLT-011, TRP-052, PRT-009, LEG-020, LEG-027) ; E14 et E15 en P0-A | Appliqué |
| S5-12 | 16 lignes P0 sans fiche (US-054) | fiches HST-049 / FIN-008, PYO-003, PRT-001 / PRT-002 / BKG-003 / PRC-018, PRT-007 / PRT-008 / HST-048, PRT-011, PRT-015, REV-002 / REV-004, ADM-027, LEG-021 | Appliqué |
| S5-13 | Écrans A01 à A13 au sens « agence » (US-059) | sens « espace hôte » de 10b v3 dans toutes les fiches | Appliqué |
| S5-14 | Codes et critères alignés sur 08 révisé et 17 v6 (hold `CHECKOUT` seul, jambes, interrupteurs, `host_verification`, `host_earnings_statement`) | critères Given / When / Then réécrits dans les fiches concernées | Appliqué |
| S5-15 | C.1, C.2 (lignes remontées), lignes HORS PRODUIT sans place | partie C régénérée depuis 04 révision 6 ; HORS PRODUIT en C.3 ; libellés historiques marqués « (hist.) » | Appliqué |
| S5-16 | D.1 : 29 écarts avec 04 | D.1 régénérée (178 lignes) | Appliqué |
| S5-17 | D.2 « aucun build avant avis » (§g.1 point 2) | D.2 réécrite : build autorisé partout, mise en service fermée par les interrupteurs, aligné sur A.6 et DEC-FONDATEUR-02 | Appliqué |
| S5-18 | `tools/check_ta_consolidation.py` et `tools/verif15_ta.py` recalculaient les TA08, TA10 et TA11 de la version 4 (commission, mandat, variante d'agence) | réécrits (2026-11-03) : recalcul indépendant des jambes de TA01 à TA06, invariants des lignes TJ de 08 pour TA08, TA10 et TA11, montants cités contrôlés contre les lignes TJ, montants de la version 4 interdits ; attentes de `registry.json` inchangées (`RÉSULTAT : OK`, `OK`) | Appliqué |
| S5-19 | PYO-002 : lot de 106,25 composé par la fiche, sans oracle | critère réécrit sur les seules valeurs des vecteurs TJ01, TJ18b et TJ06 (lot = jambe `HOST` 131,25, ajustement distinct de −75,00) | Appliqué |
| S5-20 | 04 : 24 lignes passées de P3 à `HORS` (US-058) | partie C.4 : les 24 lignes `HORS` ; A.3 (P3 = 47, `HORS` = 24) | Appliqué |
| S5-21 | codes et action PROPOSÉS de US-058 | A.8 : `PENDING_ACTIVATION`, `VEHICLE_NOT_COVERED`, création d'un compte d'hôte par `manual_action` | Appliqué |
| S5-22 | 10b v3 (US-059) : annulation par l'hôte depuis A05 (§4.1 bis), M-REM-01 | BKG-032 (parcours A05 « Cancelar reserva », avertissement, avis automatique) ; M4 = ≤ 5 écrans et ≤ 10 min, retour < 8 min | Appliqué |
| S5-23 | Revue UX du bloc (2026-11-03) n° 1 : gabarit de 20 photos contraire à 10b v3 | TRP-004 : au moins 15 extérieures et 8 intérieures, plus carburant et compteur, de chaque côté (10b v3 fait foi pour l'UX) ; 04 TRP-004 aligné ; `slot_code` de 17 à aligner | Appliqué |
| S5-24 | Revue UX n° 2 : mode `REQUEST` côté hôte sans critère | HDB-002 : acceptation, refus, heure limite de 4 h, expiration, interdiction sur une annonce aéroport, clés `web.a05.accept` / `web.a05.decline` ; M12 rattachée à HDB-002 ; critères repris dans 19 US-219 ; aucune ligne de 04 ne change de phase | Appliqué |
| S5-25 | Revue UX n° 3 à 5 : TRP-002 sans critère mesurable ; textes sans clé i18n ; « pago en confirmación » ; avis automatique de BKG-032 | TRP-002 : 4 étapes UX-41 et critère ≤ 5 écrans, ≤ 10 min ; clés de 10b §4.3 en es et en (clés manquantes PROPOSÉES) ; BKG-022 `web.s06.verifying.title` « Pago en verificación » ; BKG-032 : avis automatique dès la bêta | Appliqué |
| S5-26 | Revue QA : `PENDING_ACTIVATION` et `VEHICLE_NOT_COVERED` absents des fiches ; revue architecture : « agence » dans NTF-018 et PYO-012 | HST-049 (`PENDING_ACTIVATION`) et HST-019 (`VEHICLE_NOT_COVERED`) ; descriptions de NTF-018 et PYO-012 réécrites dans 04 | Appliqué |

Contrôles (sorties en D.3) : `python -I -X utf8 tools/check_prd_structure.py` et `python -I -X utf8 tools/verif15_struct.py`.
