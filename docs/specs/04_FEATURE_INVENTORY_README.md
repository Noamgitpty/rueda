# 04 — Inventaire des fonctionnalités : mode d'emploi

> Fichier de données : `04_FEATURE_INVENTORY.csv` (UTF-8 sans BOM, séparateur virgule, tous les champs entre guillemets, fins de ligne `\n`).
> **Révision 2 du 2026-10-30** : application de l'audit `verification/VERIF_07_FEATURE_INVENTORY.md` (P0 réduit, nouvelles lignes, dépendances), du découpage P0-A / P0-B issu de `12_PANAMA_MARKET.md` §10.3 (« l'agence encaisse » en Phase 0), de `verification/VERIF_06_IMPROVEMENTS.md` et de `09b_PAYMENT_PARTNERS_PA_PY.md` / `verification/VERIF_08_PAYMENTS.md` (piles PSP, règle de caution). Nouvelle colonne `phase_mvp`. Contrôle automatique : `tools/check_inventory.py` (§7). Feuille de route correspondante : `18_MVP_AND_ROADMAP.md`. `08_BUSINESS_RULES.md` n'a pas été modifié (audit en cours) : les écarts sont signalés dans les notes des lignes (ex. PAY-036, PAY-037).
> Version 1 rédigée le 2026-10-30 à partir de RESUME_HERE, 02, 03, 05, 06, 08, 09, 10, 11, 21, sources/SRC_GUEST_DOCS, SRC_HOST_DOCS, SRC_TOS_NOTES et 12 §9–§10. Turo n'a pas été consulté à nouveau : chaque fonctionnalité Turo cite son fichier source. Tout ce qui n'existe pas chez Turo est marqué PROPOSÉ. La révision 2 ajoute comme sources 09b, 15, 20, VERIF_06, VERIF_07 et VERIF_08.
> **Révision 3 du 2026-10-30 (corrigé VERIF_10)** : application de `verification/VERIF_10_MVP_ROADMAP.md`. Trois colonnes ajoutées (`lot_p0a`, `beta_pilote`, `risque_legal_financier`, §1) ; barème de complexité, d'effort ops et de risque (§1 bis, VERIF_07 F11) ; 9 nouvelles lignes P0-A (LEG-027 mandat d'opérations PSP, FIN-019 rapprochement des revenus, SUP-020 dotation du support, ADM-033 revue de sécurité, ADM-034 préproduction, ADM-035 RPO/RTO, TRP-056 risque PWA iOS, TRP-057 hors ligne scindé de TRP-002, PAY-041 porte PSP) et LEG-010 promue (Ley 81) ; 41 lignes à mentions non déclarées traitées (§6 bis) ; 4 lignes P0 « DIRECTEMENT TESTÉ » requalifiées ; contrôle automatique étendu (§7). Chaque modification de ligne est marquée « (corrigé VERIF_10-<ID>) » dans `notes`.
> **Révision 4 du 2026-10-30 (consolidation 04/08/16/17)** : report des 13 changements de l'annexe C de `17_DATA_MODEL_AND_ARCHITECTURE.md` (C04-1 à C04-13) et des 6 changements de `10b_UX_UI_ANALYSIS.md` §7 dans 22 lignes du CSV (descriptions, un nom, notes) ; aucune ligne ajoutée ni supprimée, aucune phase, lot, valeur `beta_pilote` ou dépendance modifiés ; 19 colonnes inchangées. Détail et sortie du contrôle : §10.
> **Révision 5 du 2026-10-30 (passe de cohérence finale VERIF_18 + DEC-FONDATEUR-04 à 10)** : application de `verification/VERIF_18_GLOBAL_CONSISTENCY.md` (F-01 lot `C` des connecteurs réels, F-02 Paraguay dès le départ, F-04/F-05 caution, F-07 critères C1–C20 / RLS-1–20 / L0, F-08 comptes et sortie d'outil régénérés une seule fois) et des décisions fondateur DEC-FONDATEUR-05 à 10 : 15 lignes créées (DSN-001 à DSN-007 « Fondations design », PLT-001 à PLT-005 « Transmissibilité, qualité et gouvernance multi-agents », PAY-042, FIN-020, VER-029 « connecteurs réels » au lot C), 2 lignes promues P2 → P0-A (I18N-005 PYG, FIN-003 SIFEN en interface), PAY-041 passée au lot C. Détail : §11. Le script `tools/check_inventory.py` accepte désormais la valeur de lot `C` (ordonnée après le lot 4) et libelle l'estimation en unités d'effort de 10 jours-agent (modification structurelle signalée).
> **Révision 6 du 2026-11-02 (pivot P2P, US-054, paquet S2)** : Kmino est une **place de marché de particulier à particulier**, hôtes particuliers uniquement, dès la bêta (DEC-FONDATEUR-13, 14, 16) ; **aucune agence ni aucun loueur professionnel dans le produit**. 16 lignes remontées de P1 / P2 et 12 lignes de l'ancien P0-B intégrées au MVP (P0-B vide, lot LB supprimé) ; 24 lignes propres au modèle agence marquées **HORS PRODUIT (DEC-FONDATEUR-13)**, conservées pour la traçabilité ; descriptions des lignes du MVP réécrites pour l'hôte particulier ; valeurs `beta_pilote` revues pour la bêta P2P. Détail, méthode et limites : §12. Source : `docs/team/impact/2026-11-02-pivot-p2p.md` §e.
> **Règle de lecture (révision 6)** : les révisions 2 à 5 ci-dessus et les sections §5, §6, §6 bis, §9, §10 et §11 sont **historiques** : elles décrivent le modèle « pro-first » abandonné, où des agences encaissaient. Dans le CSV, chaque ligne qui cite encore une agence, un loueur ou un comptoir porte en tête de `notes` la marque « Rév. 6 (pivot P2P, DEC-FONDATEUR-13) », qui qualifie ces mentions d'historiques, ou la marque « HORS PRODUIT ». Les noms techniques `P0-A`, `lot_p0a` et `beta_pilote` sont gardés parce que les contrôles de `tools/` les lisent : `P0-A` se lit **MVP, bêta P2P** ; `beta_pilote` se lit **tranche des lots 0 à 4 de la bêta P2P** ; aucune « agence pilote » n'existe.
> Cadre produit (révision 6) : place de marché **entre particuliers**, comme Turo : des particuliers louent leur propre voiture ; Kmino est l'intermédiaire et le marchand de référence de l'encaissement (PSP de place de marché, `FAKE` seulement jusqu'au lot C), l'hôte est versé après le trajet, la protection est vendue par Kmino pour l'assureur partenaire. Construite pour le **Panama et le Paraguay en même temps** (DEC-FONDATEUR-04, USD et PYG) ; le **choix du pays de lancement reste en attente** (22). Build par une équipe multi-agents Claude Code, le fondateur étant le seul humain (DEC-FONDATEUR-05).

## 1. Colonnes

| Colonne | Contenu |
|---|---|
| `feature_id` | `MOD-NNN`. Identifiant stable, réutilisable dans le PRD et le backlog. Les nouvelles lignes continuent la numérotation du module (ex. `PAY-033`). |
| `module` | Code + libellé (26 modules ; DSN et PLT ajoutés en révision 5). |
| `sous_module` | Regroupement fonctionnel dans le module. |
| `nom` | Nom court de la fonctionnalité. |
| `persona` | Guest (voyageur), Hôte (particulier), Co-hôte, Admin / Ops, Support, Finance, Visiteur, Tous. La valeur historique « Hôte pro (loueur) » ne subsiste que sur des lignes HORS PRODUIT ou marquées révision 6. |
| `description_courte` | Ce que fait la fonctionnalité. Pour les lignes P0 réécrites : acteur, déclencheur, règle, données et critère d'acceptation (CA). La description d'origine est conservée dans `notes`. |
| `turo_statut_preuve` | DIRECTEMENT TESTÉ / OBSERVÉ / DOCUMENTÉ / INFÉRÉ / PROPOSÉ / BLOQUÉ / NON EXPLORÉ. |
| `source` | Référence (`05 G-…`, `06 H-…`, `EV-xxxx`, `SRC_G x.y`, `SRC_H §x`, `TOS-xxx`, `11 EC-xx`, `12 §x`, `VERIF_07 NEW-xx`, `15 IMP-xx`). |
| `regles_liees` | Règles métier de `08_BUSINESS_RULES.md` (`BR-…`, `SM-…`). |
| `dependances` | Autres `feature_id` nécessaires. Contrôle automatique : toutes existent, aucune ne pointe vers une phase plus tardive, aucun cycle (§6–§7). |
| `priorite_produit` | **P0** = MVP sûr et légal : la bêta P2P, Panama et Paraguay construits (révision 6 : toutes les lignes P0 sont P0-A). **P1** = version concurrentielle complète. **P2** = différenciation. **P3** = futur ou non applicable, et lignes **HORS PRODUIT (DEC-FONDATEUR-13)** (révision 6 : faute d'une valeur dédiée acceptée par `tools/check_inventory.py`, voir §12). |
| `complexite_tech` | faible / moyenne / élevée. |
| `effort_ops` | faible / moyen / élevé (charge humaine récurrente). |
| `pertinence_latam` | élevée / moyenne / faible / non applicable. |
| `notes` | Écart volontaire par rapport à Turo (`[NOUS]`), point à valider, et **journal des changements** de la révision 2 : rétrogradation, fusion (« FUSIONNÉ dans X »), promotion, réécriture (description initiale), dépendances corrigées (« avant … »), phase P0-B (porte juridique). |
| **`phase_mvp`** | **P0-A**, **P0-B**, **P1**, **P2**, **P3** (définitions §3). Une ligne `priorite_produit = P0` est P0-A ou P0-B ; sinon `phase_mvp = priorite_produit`. Révision 6 : `P0-A` = MVP (bêta P2P) ; `P0-B` est vide (le lot LB est supprimé). |
| **`lot_p0a`** (révision 3 ; `C` en révision 5) | Lot de construction du P0-A, `0` à `4` (18 §6), ou `C` = lot des **connecteurs réels** (PSP, e-facture, KYC) livré après le choix du pays de lancement et avant la mise en service (DEC-FONDATEUR-03, VERIF_18-F01) ; une intégration se livre en deux temps : port + adaptateur `FAKE` dans le lot de sa ligne, connecteur réel au lot C. Vide hors P0-A. Contrôle : aucune ligne n'est dans un lot antérieur à celui d'une ligne dont elle dépend (corrigé VERIF_10-V10-08). |
| **`beta_pilote`** (révision 3 ; relu en révision 6) | Traitement de la ligne dans la **tranche des lots 0 à 4 de la bêta P2P** (première ouverture, 18 §1.0 ; nom de colonne historique) ; vide hors P0-A. **OUI** = construite telle que décrite ; **SIMPLIFIÉ** = version réduite, décrite en note « Bêta pilote SIMPLIFIÉ : … » (libellé historique des notes) ; **MANUEL** = non construite, remplacée par une opération manuelle décrite en note ; **DIFFÉRÉ** = non construite ni remplacée (sans objet pour la tranche des lots 0 à 4 ou assurée par la page du PSP), livrée au lot 5 (reste de la bêta fermée). Contrôle : une ligne OUI ou SIMPLIFIÉ ne dépend jamais d'une ligne DIFFÉRÉ (corrigé VERIF_10-V10-01). |
| **`risque_legal_financier`** (révision 3) | faible / moyen / élevé (barème §1 bis), évalué pour toutes les lignes P0 (178 en révision 6 ; les lignes remontées sont évaluées en révision 6) et les lignes citées par VERIF_07 F11 ; « non évalué » ailleurs (corrigé VERIF_10-V10-13, VERIF_07 F11). |

Choix documenté (corrigé VERIF_10-V10-01) : la Bêta pilote est portée par une **colonne** plutôt que par une étiquette dans `notes`, pour être contrôlable par script (valeurs fermées, dépendances, estimation) ; la raison de chaque valeur autre que OUI est écrite dans `notes`.

### 1 bis. Barèmes (corrigé VERIF_10-V10-13, VERIF_07 F11)

| Colonne | faible | moyenne / moyen | élevée / élevé |
|---|---|---|---|
| `complexite_tech` (effort de build par ligne, en jours-développeur assistés par Claude Code, tests et relecture compris) | 0,5–1,5 j-dev | 1,5–2,5 j-dev | 3–8 j-dev (intégration tierce, contrainte forte, hors ligne) |
| `effort_ops` (charge humaine **récurrente** pour 5 à 10 agences ; ne mesure pas le risque) | < 1 h/semaine | 1–5 h/semaine | > 5 h/semaine |
| `risque_legal_financier` (conséquence d'une erreur) | sans conséquence juridique ni monétaire directe | réparable à coût limité (remboursement, plainte individuelle) | qualification réglementaire, fonds de tiers, données sensibles (biométrie), responsabilité contractuelle ou perte non plafonnée |

**Unité (révision 5, DEC-FONDATEUR-05)** : il n'y a plus de développeurs humains ; « j-dev » se lit **jour-agent** (une journée de travail d'un agent d'implémentation Claude Code, tests et revue indépendante compris) et **1 unité d'effort = 10 jours-agent** (ex-« semaine-équipe » = 2 développeurs × 5 jours, conservée comme contexte historique). Aucune unité n'a de valeur calendaire : la durée sera mesurée après le lot 0 (18 §5). Historique : le barème de complexité a été **calibré** pour que la somme des 147 lignes P0-A de la révision 3, plus les forfaits de socle (1,5–3) et de durcissement et recette interne (1–2), redonne la fourchette par epic de 18 §5 (21–42) : il ne mesure rien et sera remplacé par la vélocité observée au recalage de fin de lot 1 (18 §5). Pour la Bêta pilote, une ligne SIMPLIFIÉ compte un niveau de complexité en dessous (élevée → moyenne, moyenne → faible, faible → 0,25–0,75 j-dev) et une ligne MANUEL ou DIFFÉRÉ compte 0 ; forfaits réduits : socle 1–2, recette interne 0,5–1. Recodage F11 : `effort_ops` de FIN-014, PRT-003, PRT-014, MKT-017 et CLM-015 passe d'« élevé » à « moyen » (le niveau élevé exprimait un risque, désormais dans `risque_legal_financier`) ; contrôles manuels de PRT-009 et HST-019 décrits en note ; TRP-002 scindée (hors ligne → TRP-057, TRP-002 passe en complexité moyenne).

Conventions : `[NOUS]` signale notre recommandation. Les montants Turo sont donnés pour référence ; les valeurs de lancement du Panama sont dans `ADM-031` (annexe des paramètres, « À DÉCIDER » tant qu'elles ne sont pas arrêtées) et chargées dans `ADM-014`. Une ligne « FUSIONNÉ dans X » reste dans le fichier (identifiant stable) mais son besoin P0 est décrit dans X ; elle ne garde que son reliquat P1.

## 2. Comptes

**Total : 676 fonctionnalités** (613 + 36 nouvelles en révision 2 + 9 en révision 3 + 3 du catalogue véhicules en v4 + 15 en révision 5 ; aucune ligne ajoutée ni supprimée en révision 6) dans 26 modules. Comptes régénérés par `tools/check_inventory.py` (sortie complète au §7).

| Phase | Lignes | Lecture |
|---|---|---|
| **P0-A** | **178** | **MVP = bêta P2P**, hôtes particuliers, Panama et Paraguay construits (révision 6 : 166 − 15 lignes hors produit − FLT-001 passée en P1 + 16 lignes remontées de P1 / P2 + 12 lignes de l'ex-P0-B, hors PAY-038) |
| P0-B | 0 | vide depuis la révision 6 (lot LB supprimé ; était 13 : 12 intégrées au P0-A, PAY-038 hors produit) |
| P1 | 327 | (342 − 9 remontées − 7 hors produit + FLT-001) |
| P2 | 100 | (108 − 7 remontées − FLT-012 hors produit) |
| P3 | 71 | **47 options** + **24 lignes HORS PRODUIT (DEC-FONDATEUR-13)** (notes commençant par « HORS PRODUIT ») |
| **Total** | **676** | P0 = 178 (179 en révision 5, 162 en v4, 150 en révision 2, 275 en version 1) |

**Lots du P0-A** (révision 6) : lot 0 = 22, lot 1 = 47, lot 2 = 72, lot 3 = 32, lot 4 = 1, **lot C = 4** (PAY-041, PAY-042, FIN-020, VER-029). **Tranche des lots 0 à 4 de la bêta P2P** (colonne `beta_pilote`, 178 lignes P0-A) : OUI 31, SIMPLIFIÉ 112, MANUEL 27, DIFFÉRÉ 8, soit **143 lignes construites**. Historique : 96 construites en révision 5 (modèle agence), 82 en v4, 76 en révision 3.

Passage de 275 à 150 lignes P0 (révision 2) : 275 − 143 rétrogradations de VERIF_07 appliquées (sur 146 ; 3 rejetées, §5.2) + 5 promotions (PAY-004, NTF-011, VER-028, LEG-020 de VERIF_07 ; FLT-011 par jugement) − 1 rétrogradation propre (REV-004) + 14 nouvelles lignes P0 = **150**. VERIF_07 visait 141 : l'écart de +9 vient des 3 rejets, de FLT-011, des 6 lignes P0 ajoutées en plus de NEW-01 à NEW-08 (PAY-034 à PAY-038, ADM-032) et de REV-004 en moins.

### Par module et par phase

Révision 6 : la colonne P0-B est vide et la colonne « hors produit » isole, dans le P3, les lignes HORS PRODUIT.

| Module | Total | P0-A | P1 | P2 | P3 (options) | Hors produit (P3) |
|---|---|---|---|---|---|---|
| ACC — Comptes & identité | 35 | 3 | 24 | 4 | 2 | 2 |
| VER — Vérification / KYC | 29 | 11 | 14 | 2 | 1 | 1 |
| SRC — Recherche & découverte | 46 | 6 | 26 | 12 | 2 | 0 |
| LST — Fiche véhicule | 29 | 9 | 16 | 3 | 0 | 1 |
| BKG — Réservation & checkout | 43 | 17 | 22 | 3 | 1 | 0 |
| PAY — Paiements | 42 | 16 | 12 | 8 | 3 | 3 |
| PRC — Tarification | 26 | 6 | 12 | 3 | 5 | 0 |
| TRP — Cycle de vie du trip | 57 | 10 | 36 | 7 | 2 | 2 |
| MSG — Messagerie | 14 | 2 | 6 | 6 | 0 | 0 |
| NTF — Notifications | 22 | 4 | 14 | 3 | 1 | 0 |
| REV — Avis & réputation | 14 | 4 | 6 | 3 | 0 | 1 |
| HST — Onboarding hôte & annonces | 51 | 11 | 28 | 6 | 6 | 0 |
| CAL — Calendrier & disponibilité | 13 | 5 | 5 | 1 | 1 | 1 |
| HDB — Tableau de bord & performance hôte | 18 | 2 | 8 | 5 | 3 | 0 |
| PYO — Versements hôtes | 17 | 5 | 10 | 2 | 0 | 0 |
| FLT — Flotte / pro / co-hôtes | 19 | 0 | 8 | 1 | 3 | 7 |
| CLM — Réclamations, dommages & factures annexes | 36 | 5 | 17 | 10 | 4 | 0 |
| PRT — Protection & assurance | 19 | 8 | 4 | 3 | 2 | 2 |
| SUP — Support, aide & trust & safety | 20 | 3 | 15 | 2 | 0 | 0 |
| ADM — Back-office / admin [NOUS] | 36 | 18 | 15 | 3 | 0 | 0 |
| FIN — Finance, comptabilité & fiscalité | 20 | 8 | 7 | 2 | 2 | 1 |
| I18N — Multi-pays, devise & langue | 13 | 3 | 8 | 1 | 1 | 0 |
| MKT — Marketing, parrainage, fidélité & cartes cadeaux | 18 | 0 | 3 | 9 | 6 | 0 |
| LEG — Légal, consentements & données | 27 | 10 | 11 | 1 | 2 | 3 |
| DSN — Design, marque & contenus | 7 | 7 | 0 | 0 | 0 | 0 |
| PLT — Plateforme, qualité & transmissibilité | 5 | 5 | 0 | 0 | 0 | 0 |
| **Total** | **676** | **178** | **327** | **100** | **47** | **24** |

Le module FLT garde son libellé historique « Flotte / pro / co-hôtes » : il ne contient plus que des outils d'hôte (co-hôtes, plusieurs véhicules) et des lignes hors produit.

### Par statut de preuve

| Statut | Nombre |
|---|---|
| DIRECTEMENT TESTÉ | 6 (12 en révision 2 ; aucune ligne P0) |
| OBSERVÉ | 132 |
| DOCUMENTÉ | 324 |
| INFÉRÉ | 21 |
| PROPOSÉ | 188 (125 + 36 + 9 nouvelles lignes, + 3 en v4, + 15 en révision 5) |
| BLOQUÉ | 4 |
| NON EXPLORÉ | 1 |

Requalifications de preuve (corrigé VERIF_10-V10-13, VERIF_07 F04–F05) : les 4 lignes P0 encore « DIRECTEMENT TESTÉ » passent en OBSERVÉ (BKG-002 et BKG-006 : champs relevés sans soumission, EV-0007 ; PRC-012 : taux de 22–24 % recalculé sur des montants observés, EV-0007 et EV-0026 ; PRC-020 : seule la formule de Floride a été recalculée, l'ITBMS Panama est PROPOSÉ) ; PRC-018 et HST-002 (recalcul, outil consulté) aussi ; BKG-005, PAY-007 et PRC-010 citent désormais EV-0026 (retest connecté) et restent DIRECTEMENT TESTÉ. F06 et F07 (OBSERVÉ sans EV, DOCUMENTÉ de seconde main, lignes hors P0 pour l'essentiel) restent non appliqués (§9) ; le type d'EV-0025 dans `20_EVIDENCE_REGISTER.csv` n'est pas modifié (hors périmètre de cette passe).

## 3. Phases MVP et préconditions juridiques

| Phase | Définition | Préconditions (questions de `22_OPEN_QUESTIONS.md`) |
|---|---|---|
| **P0-A** (révision 6) | **MVP = bêta P2P** : place de marché entre particuliers dans le pays de lancement, hôtes particuliers dès le départ (DEC-FONDATEUR-13). Le voyageur paie **Kmino, marchand de référence**, par un PSP de place de marché ; chaque paiement est réparti en **jambes** calculées par le règlement (`HOST`, `INSURER`, `PLATFORM`, `TAX_THIRD_PARTY` ; PAY-001, PAY-006, PAY-021) ; **caution par carte** (PAY-011, PAY-036) ; **protections du voyageur et plans de gains de l'hôte** vendus par Kmino pour l'assureur partenaire (PRT-001, PRT-007) ; **trip fee** (PRC-012) ; **versements aux hôtes** après le trajet (PYO-001 à PYO-007) ; remise et retour **entre particuliers** (TRP-002, VER-015) ; avis réciproques (REV-002, REV-004). Kmino ne détient des fonds de tiers que si `funds_holding_enabled[pays]` = `true` (avis requis) ; tous les interrupteurs de mise en service sont à `false` en production (ADM-027). | **Construction** : aucune (DEC-FONDATEUR-02). **Mise en service** (22, section « Pivot P2P ») : OQ-BR-35 (plaque « particular », statut de l'hôte), OQ-BR-16 et OQ-P2P-03 (qualification de la protection, contrat de l'assureur), OQ-BR-28 (prenda), OQ-PAY-09 et OQ-P2P-07 (fiscalité des hôtes, RUC), OQ-MK-02, OQ-MK-03, OQ-MK-04 (détention de fonds), OQ-MK-01, OQ-MK-06, OQ-MK-09, OQ-BR-14, OQ-BR-21, OQ-BR-24, OQ-BR-25 ; porte go / no-go du PSP de place de marché par pays (PAY-041, capacités de l'analyse pivot §c.5 ; OQ-PAY-02, 04, 05, 06, 08, 17, 19, 20, 21, 23). Prérequis opérationnels : dotation du support (SUP-020), revue de sécurité (ADM-033). |
| P0-B | **Vide depuis la révision 6.** Historique : « la plateforme encaisse », phase ouverte après avis dans le modèle agence ; ses lignes sont intégrées au P0-A (encaissement par Kmino dès la bêta, en `FAKE`), sauf PAY-038, hors produit. | — |
| P1 | Version concurrentielle complète dans le pays de lancement (automatisations, modifications de trip, support 24/7, livraison, co-hôtes FLT-001 / FLT-002, remise sans contact). | OQ-MK-08 (aéroport), OQ-BR-17, OQ-BR-19. |
| P2 | Ouverture commerciale du second pays (déjà construit, DEC-FONDATEUR-04), différenciation. Le P2P n'est plus en P2 : il est le MVP. | OQ-MK-04, OQ-PAY-08 à 12 (Paraguay, s'il n'est pas retenu au lancement). |
| P3 | Futur ou non applicable ; **lignes HORS PRODUIT (DEC-FONDATEUR-13)**, sans story. | — |

**Décisions fondateur du 2026-10-30 (consolidation, révision 4 ; historique, à lire avec DEC-FONDATEUR-13 à 16 du 2026-11-02)** :
- **DEC-FONDATEUR-02** : on construit d'abord ; les avis juridiques de la colonne « Préconditions » ci-dessus (OQ-MK-01, OQ-MK-02, OQ-MK-05, OQ-MK-06, OQ-MK-09, OQ-BR-21, OQ-BR-24, OQ-BR-25, OQ-PAY-06…) deviennent un **préalable à la mise en service avec de vrais clients** (Bêta pilote comprise), plus un préalable au build. Les lots se construisent ; leur ouverture reste bloquée.
- **DEC-FONDATEUR-03** : intégration d'un PSP réel reportée au choix du pays ; PAY-001 est construit avec un adaptateur fictif / bac à sable (`FAKE`) ; PAY-041 et les adaptateurs Tilopay, Yappy, Bancard vPOS, upay, dLocal sont différés (ils bloquent l'ouverture, pas le build). Aucune phase, aucun lot ni aucune valeur `beta_pilote` n'est modifié par cette décision.
- **DEC-FONDATEUR-04** : Panama **et** Paraguay sont construits en même temps ; le pays est une configuration (USD / PYG, fuseaux `America/Panama` / `America/Asuncion`, ITBMS 7 % / IVA 10 %, pièces d'identité, langues `es-PA`, `es-PY`, `en`). Les lignes P0 sont communes aux deux pays (aucun doublon). **Appliqué en révision 5 (VERIF_18-F02)** : I18N-005 (PYG) → P0-A, lot 0 ; FIN-003 (SIFEN) → P0-A en interface (port + `FAKE`, lot 2 ; connecteur réel au lot C, FIN-020) ; les besoins P0 du fuseau (I18N-006) et des forfaits par devise (I18N-007) restent fusionnés dans I18N-003 et ADM-014, désormais explicitement bi-pays ; I18N-013 (guaraní) reste P3.
- **DEC-FONDATEUR-05** : aucun développeur humain ; build par une équipe multi-agents Claude Code (orchestrateur, agents d'implémentation, vérificateurs indépendants) ; le fondateur est product owner, recette, comptes et juridique. Effet sur 04 : unités d'effort en jours-agent (§1 bis) ; PLT-005.
- **DEC-FONDATEUR-06 / 07** : agent DESIGN dédié et relecteur UX/design indépendant ; web mobile-first + PWA installable dans le MVP, apps natives plus tard ; design modifiable à tout moment par le fondateur (tokens pilotés par les données, back-office « Apparence / Marque », blocs de contenu es/en, bibliothèque de composants) ; pas encore de nom : DSN-001 « Naming et identité » d'abord. Epic E16 (DSN-001 à DSN-007).
- **DEC-FONDATEUR-08 / 09 / 10** : transmissibilité totale (IaC, conteneurs, portabilité, comptes au nom du fondateur, runbooks, checklist de passation ; « documentation à jour » dans la Definition of Done), tests exhaustifs et portes CI bloquantes avec agent QA indépendant, autonomie des agents par artefacts versionnés avec valeur par défaut pour chaque décision et point fondateur hebdomadaire. Epic transverse E17 (PLT-001 à PLT-005).

**Choix du pays de lancement (en attente, 12 §10.3, 22)** : les deux pays étant construits (DEC-FONDATEUR-04), l'issue des avis (OQ-MK-01 au Panama ; OQ-MK-04, OQ-PAY-08 à 12 au Paraguay) ne détermine plus que le **pays ouvert en premier** et donc les connecteurs réels du lot C (PSP, e-facture PAC ou SIFEN, KYC) ; aucune ligne ne change de phase à ce moment.

## 4. Epics du P0

Chaque ligne P0 appartient à un seul epic ; le tableau est lu par `tools/check_inventory.py` (couverture exacte contrôlée).

| Epic | Phase | Lignes | IDs |
|---|---|---|---|
| E1 Comptes, identité et KYC des voyageurs et des hôtes particuliers | P0-A | 15 | ACC-001, ACC-006, ACC-014, VER-001, VER-002, VER-003, VER-004, VER-005, VER-006, VER-007, VER-013, VER-015, VER-028, HST-049, FIN-008 |
| E2 Recherche et fiche véhicule | P0-A | 15 | SRC-001, SRC-002, SRC-008, SRC-011, SRC-012, SRC-042, LST-002, LST-003, LST-006, LST-007, LST-008, LST-010, LST-012, LST-013, LST-020 |
| E3 Disponibilité et calendrier de l'hôte | P0-A | 6 | CAL-001, CAL-002, CAL-003, CAL-004, CAL-011, BKG-014 |
| E4 Réservation, contrat hôte–voyageur et checkout | P0-A | 13 | BKG-001, BKG-002, BKG-006, BKG-008, BKG-012, BKG-016, BKG-018, BKG-019, BKG-022, BKG-023, BKG-025, BKG-027, LEG-026 |
| E5 Devis, taxes, trip fee et facturation | P0-A | 10 | PRC-001, PRC-012, PRC-020, PRC-021, PRC-025, FIN-001, FIN-002, FIN-003, FIN-018, PYO-013 |
| E6 Paiement par jambes (Kmino marchand de référence) et caution par carte | P0-A | 14 | PAY-001, PAY-002, PAY-004, PAY-006, PAY-011, PAY-012, PAY-015, PAY-017, PAY-018, PAY-019, PAY-021, PAY-034, PAY-036, PAY-037 |
| E7 Onboarding de l'hôte particulier et annonces | P0-A | 12 | HST-050, ADM-036, HST-005, HST-011, HST-012, HST-016, HST-019, HST-026, HST-033, HST-039, HDB-001, HDB-002 |
| E8 Trip : remise et retour entre particuliers, preuves | P0-A | 11 | TRP-002, TRP-004, TRP-007, TRP-015, TRP-033, TRP-035, TRP-038, TRP-045, CLM-034, TRP-056, TRP-057 |
| E9 Annulations, protections du voyageur et plans de gains de l'hôte (assureur partenaire) | P0-A | 14 | BKG-028, BKG-032, BKG-035, BKG-003, PRT-001, PRT-002, PRT-003, PRT-007, PRT-008, PRT-011, PRT-013, PRT-015, PRC-018, HST-048 |
| E10 Messagerie, notifications et avis réciproques | P0-A | 10 | MSG-001, MSG-007, NTF-001, NTF-002, NTF-007, NTF-011, REV-001, REV-002, REV-004, REV-010 |
| E11 Dommages, sinistres et litiges entre particuliers | P0-A | 6 | CLM-001, CLM-002, CLM-006, CLM-021, ADM-008, LEG-024 |
| E12 Back-office, support, risque et exploitation | P0-A | 19 | ADM-001, ADM-002, ADM-003, ADM-004, ADM-005, ADM-006, ADM-007, ADM-014, ADM-022, ADM-027, ADM-029, ADM-031, ADM-032, SUP-004, SUP-011, SUP-020, ADM-033, ADM-034, ADM-035 |
| E13 Légal, consentements, langues et pays | P0-A | 11 | LEG-001, LEG-002, LEG-009, LEG-011, LEG-014, LEG-015, LEG-021, I18N-003, I18N-004, LEG-010, I18N-005 |
| E14 Versements aux hôtes et grand livre de l'hôte (ex-P0-B, révision 6) | P0-A | 4 | PYO-001, PYO-002, PYO-003, PYO-007 |
| E15 Taxes collectées et rapprochement par jambe (ex-P0-B, révision 6) | P0-A | 2 | FIN-004, FIN-005 |
| E16 Fondations design, marque et contenus (DEC-FONDATEUR-06/07) | P0-A | 7 | DSN-001, DSN-002, DSN-003, DSN-004, DSN-005, DSN-006, DSN-007 |
| E17 Transmissibilité, qualité et gouvernance multi-agents (DEC-FONDATEUR-05/08/09/10, transverse) | P0-A | 5 | PLT-001, PLT-002, PLT-003, PLT-004, PLT-005 |
| E18 Connecteurs réels — lot C, après le choix du pays de lancement (DEC-FONDATEUR-03, VERIF_18-F01) | P0-A | 4 | PAY-041, PAY-042, FIN-020, VER-029 |

Révision 6 (pivot P2P) : E1 sans ACC-008, ACC-029, VER-027, avec HST-049 et FIN-008 ; E3 sans CAL-009, FLT-001, FLT-003 ; E5 sans FIN-019, avec PRC-012 ; E6 « paiement par jambes » sans PAY-033 et PAY-035, avec PAY-011, PAY-012, PAY-015, PAY-036, PAY-037 ; E7 sans FLT-011, LEG-025, PRT-019 ; E8 sans TRP-052 ; E9 sans PRT-009, avec les protections et les plans de gains (BKG-003, PRT-001, PRT-002, PRT-007, PRT-008, PRT-011, PRT-015, PRC-018, HST-048) ; E10 avec REV-002 et REV-004 ; E11 avec CLM-021 ; E12 avec ADM-027 ; E13 sans LEG-020 ni LEG-027, avec LEG-021 ; E14 et E15 passent en P0-A (versements aux hôtes avec PYO-003 ; taxes et rapprochement) ; 178 lignes P0-A. Historique — Révision 3 (corrigé VERIF_10) : E5 + FIN-019, E6 + PAY-041, E8 + TRP-056 et TRP-057, E12 + SUP-020, ADM-033, ADM-034, ADM-035, E13 + LEG-010 et LEG-027 ; E1 à E13 = 147 lignes. Révision 5 (VERIF_18) : E5 + FIN-003, E13 + I18N-005, PAY-041 déplacée de E6 vers E18 ; nouveaux epics E16 (design, 7), E17 (transmissibilité et qualité, 5), E18 (connecteurs réels, lot C, 4) ; E1 à E13 + E16 à E18 = 166 lignes P0-A.

Les 13 epics de VERIF_07 §3.2 sont conservés pour le P0-A (E1 à E13, recomposés : les lignes de paiement plateforme passent en E14/E15, les nouvelles lignes NEW-01 à NEW-08 sont réparties dans leur epic au lieu d'un « E14 Nouvelles lignes »).

**Paiements locaux dans la bêta P2P** (révision 6) : un résident sans carte de crédit peut payer son loyer par Yappy si le PSP de place de marché le propose (PAY-004, capacité `SUPPORTS_YAPPY_IN_MARKETPLACE`, inconnue ⇒ non), avec confirmation par webhook (PAY-034) ; la caution reste une autorisation sur carte (PAY-011), faute de rail validé sans carte (le rail du comptoir est supprimé). ACH Xpress est exclu (VERIF_06 V6-15). Le paragraphe de la révision 5 (caution prise par une agence) est historique.

## 5. Application de VERIF_07

> **Historique (révision 6)** : §5 à §6 bis décrivent les révisions 2 et 3, faites pour le modèle agence abandonné (DEC-FONDATEUR-13) ; les lignes citées ont depuis été réécrites, remontées ou marquées HORS PRODUIT (§12).

### 5.1 Appliqué

- **Rétrogradations §3.3** : 143 lignes sur 146 passent P0 → P1 (Fusion 69, Reportable 43, Manuel bêta 22, Juridique/auto 9 ; les 3 rejets, §5.2 : HST-033 et NTF-002 « Reportable », FIN-005 « Manuel bêta »). Chaque ligne porte la raison dans `notes`. Les 69 lignes fusionnées portent « FUSIONNÉ dans X » et leur cible porte « Absorbe (fusion VERIF_07) : … » ; le besoin P0 absorbé est repris dans la description de la cible lorsqu'il était utile (ex. BKG-012 reprend l'âge minimum de VER-025 et SRC-026, TRP-002 l'ouverture à T−24 h de TRP-001, TRP-004 les photos de TRP-003/005/006, BKG-018 les règles de conduite de LST-021, SUP-004 l'assistance routière de PRT-005 et le signalement de TRP-050, I18N-003 les formats et fuseaux d'I18N-006/008/009/011).
- **Promotions §3.4** : PAY-004 (conditionnel PSP), NTF-011, VER-028, LEG-020.
- **Nouvelles lignes §5** (identifiants dans le module concerné) :

| VERIF_07 | ID | Phase | Fonctionnalité |
|---|---|---|---|
| NEW-01 | PAY-033 | P0-A | Mode « agence encaisse » |
| NEW-02 | FIN-018 | P0-A | Facturation de la commission aux agences |
| NEW-03 | LEG-025 | P0-A | Contrat-cadre plateforme–loueur |
| NEW-04 | PRT-019 | P0-A | Dépôt et contrôle de la police flotte |
| NEW-05 | LEG-026 | P0-A | Constancia de arrendamiento |
| NEW-06 | TRP-052 | P0-A | Interface agent comptoir |
| NEW-07 | ADM-031 | P0-A | Paramètres Panama par défaut |
| NEW-08 | CLM-034 | P0-A | Dossier de preuve exportable |
| NEW-09 | FLT-017 | P1 | Marque blanche |
| NEW-10 | FLT-018 | P1 | API ouverte et connecteurs |
| NEW-11 | FLT-019 | P1 | Onboarding express 48 h (l'import CSV est P0-A via FLT-011) |
| NEW-12 | REV-014 | P1 | Badge « Agencia verificada » |
| NEW-13 | PAY-039 | P1 | Caution modulée / caution-assurance |
| NEW-14 | PAY-040 | P1 | Remboursement multi-rails |
| NEW-15 | PRC-026 | P1 | Prix tout compris avec protection minimale |
| NEW-16 | TRP-053 | P1 | Clé perdue ; guest suspendu avec trip à venir |
| NEW-17 | ADM-032 | **P0-A** | Sauvegardes, monitoring, journal d'accès |
| NEW-18 | PYO-017 | P1 | Rails de versement alternatifs, plafond ACH Xpress |
| NEW-19 | CLM-035 | P2 | Inspection IA |
| NEW-20 | TRP-054 | P2 | Géofencing défini par véhicule |
| NEW-21 | TRP-055 | **P1** | Intégration des GPS existants |
| NEW-22 | BKG-041 | **P1** | Livraison aéroport via points homologués |
| NEW-23 | CLM-036 | **P1** | Refacturation Panapass / ATTT |
| NEW-24 | ACC-034 + ACC-035 | **P1** + P2 | B2B minimal ; comptes entreprises complets |
| NEW-25 | BKG-042 | P2 | Locations de 1 à 3 mois |
| NEW-26 | SRC-046 | P2 | Recherche par usage |
| NEW-27 | HST-049 | **P2** | Éligibilité P2P et onboarding fiscal de l'hôte |
| NEW-28 | BKG-043 | P3 | Option avec chauffeur |

Lignes ajoutées en plus de VERIF_07 : **PAY-034** (preuve de paiement non réversible, VERIF_06 §3 idées 4–5, P0-A), **PAY-035** (politique de caution de l'agence et options sans carte de crédit, VERIF_07 F02 / VERIF_06 §3 idée 9, P0-A), **PAY-036** (fenêtre de rétention de la caution, VERIF_08 V8-01, P0-B), **PAY-037** (débits post-trip conformes aux réseaux, VERIF_08 V8-03, P0-B), **PAY-038** (split de commission à la source, 09b §5.2, P0-B), **SUP-019** (fraude LATAM, VERIF_06 §3 idée 4, P1), **MKT-018** (distribution via agrégateurs, VERIF_06 §3 idée 8, P2).

### 5.2 Rejeté ou modifié (jugement, avec raison)

| Ligne | Proposition VERIF_07 | Décision | Raison |
|---|---|---|---|
| HST-033 | P0 → P1 | **maintenu P0-A** | LST-012 (P0) affiche la distance incluse et PRC-019 y est fusionné ; sans cette configuration simple, la fiche, le contrat et la facture n'ont pas de valeur. |
| NTF-002 | P0 → P1 | **maintenu P0-A** | WhatsApp est le canal transactionnel principal au Panama (15 IMP-06, P0 minimal de VERIF_06 §4) et porte les OTP de VER-013. |
| FIN-005 | P0 → P1 | **maintenu P0, en P0-B** | Dès que la plateforme détient des fonds de tiers, le rapprochement quotidien est un contrôle de base ; sans objet en P0-A. |
| REV-004 | maintenu P0 | **P1** | Le double aveugle suppose deux avis ; l'avis de l'hôte (REV-002) est P1. |
| FLT-011 | P1 (NEW-11) | **P0-A** (import CSV seul) | 5 à 10 agences de 10 à 300 véhicules ne se saisissent pas une à une dans le wizard ; dépendance à l'API FLT-010 retirée. |
| NEW-17 | P1 | **P0-A** (ADM-032) | Une bêta qui stocke KYC, photos et identifiants PSP doit avoir sauvegardes, alertes et journal d'accès. |
| NEW-21, NEW-22, NEW-23 | P2 | **P1** | Alignement sur VERIF_06 (V6-07 connecteurs GPS en P1, V6-09 aéroport en P1) et sur 15 IMP-26 (P1). |
| NEW-24 | P2 | **scindé** P1 / P2 | VERIF_06 §3 idée 10 : un B2B minimal (facture au RUC, conducteur additionnel) peut être P1. |
| NEW-27 | P3 | **P2** | L'ouverture P2P est P2 dans 04 ; ses prérequis d'éligibilité ne peuvent pas être plus tardifs. |
| SUP-004 | maintenu P0 | **maintenu P0-A, rescopé** | Ligne d'urgence + horaires étendus ; support humain 24/7 en P1 (VERIF_06 V6-08). |
| PAY-011, PAY-012, PAY-015, PRC-012, PYO-001, PYO-002, PYO-007, FIN-004, CLM-021 | maintenus P0 | **P0-B** | Encaissement, caution, débits ou versements par la plateforme : conditionnés aux avis (§3). |
| HST-048, PRT-008, PRT-015 | (P1, inversion signalée) | **P2** | Dépendent des plans de gains hôte P2P (PRT-007, P2) : reclassés avec lui au lieu de couper la dépendance. |

## 6. Dépendances : inversions et cycles

**État initial** (version 1) : 22 dépendances inversées (16 depuis des lignes P0), 36 cycles (35 paires bilatérales + 1 triangle BKG-005 → PRC-011 → PRC-010 → BKG-005), 0 dépendance inconnue.

**Corrections** (84 modifications de dépendances, chacune notée « Dépendances corrigées (18) : avant … » dans `notes`) :

- *Redirection vers la cible de fusion* : une ligne P0 qui dépendait d'une ligne fusionnée dépend désormais de la cible (ex. LST-006 → CAL-003 au lieu de CAL-006 ; HST-039 → VER-027 au lieu de HST-018 ; NTF-011 → TRP-002 au lieu de TRP-001) ; une auto-dépendance créée par la fusion est supprimée (BKG-027, TRP-015, HST-011, BKG-025, LEG-011).
- *Inversions de VERIF_07 §4* : dépendance de confort retirée ou remplacée par une ligne P0 (ACC-008 → ACC-029 ; BKG-002 sans ACC-011 ; LST-007 et BKG-016 → HST-011 au lieu de la livraison HST-034 ; LST-010 → BKG-028 ; BKG-032 sans HDB-011 ; TRP-038 sans TRP-042 ; CLM-006 sans ADM-009 ; LST-012 → HST-033 ; VER-015 → VER-001 ; PAY-004 sans PAY-022 ; PAY-011 sans VER-019) ou ligne reclassée avec sa dépendance (PRC-011, TRP-016, TRP-027, HST-042, CLM-012 rétrogradés par VERIF_07 ; HST-048, PRT-008, PRT-015 en P2).
- *Inversions nées du nouveau découpage* : LST-013 → PRT-009/PRT-019/PAY-035 au lieu des plans guest PRT-001 ; BKG-012 → ADM-005/ADM-029 au lieu d'ACC-025 ; VER-013 → NTF-002 au lieu d'ACC-004 ; FLT-003 → FLT-001 ; ADM-029 → ADM-001 (règles codées en dur) au lieu du moteur ADM-011 ; LEG-009 → LEG-002 ; LST-020 → ACC-008/REV-010 ; SUP-004 et SUP-011 sans ADM-010 ; PRC-020 sans FIN-004 (P0-B) ; P1 → P2/P3 : VER-022, LST-009, HDB-006.
- *Cycles rompus* en gardant un seul sens, celui de la ligne dérivée vers la ligne de base : VER-001 → ACC-006 ; VER-003 → VER-002 ; VER-027 → ACC-029 et ADM-004 → VER-027 ; ADM-002 → VER-001 ; ADM-003 → HST-016 ; ADM-022 → TRP-038 ; FIN-004 → PRC-020 ; ADM-008 → CLM-006 ; ADM-025 → ACC-015 ; REV-012 → ACC-017 ; PAY-025 et PAY-028 → ACC-025 ; NTF-008 → VER-011 ; NTF-009 → VER-017 ; PAY-008 → BKG-020 ; NTF-012 → TRP-021 ; ADM-018 → LST-014 ; REV-006 → LST-019 ; PRC-018 → PRT-001 ; PRC-010 → BKG-005 et PRC-011 → PRC-010 (BKG-005 ne dépend plus de PRC-011) ; FIN-013 → MKT-002 ; LEG-012 → PAY-026 ; ADM-021 → PAY-027 ; FLT-013 → TRP-027 ; ADM-020 → HST-023 ; SUP-017 → LEG-013 ; LEG-008 → ADM-026. Les paires internes à une fusion (BKG-001↔LST-023, BKG-023↔LST-027, ACC-028↔HDB-001, VER-010↔ADM-002, ADM-008↔CLM-022, TRP-014↔TRP-015, I18N-010↔LEG-011) disparaissent avec la redirection.

**État final (révision 2)** : 0 dépendance inversée (toutes phases), 0 cycle parmi les lignes P0 et 0 cycle sur tout le graphe ; plus longue chaîne de dépendances P0 : 11 niveaux.

### 6 bis. Révision 3 : mentions non déclarées et ordre des lots (corrigé VERIF_10-V10-08)

VERIF_10 a trouvé **41 lignes P0-A** dont la description cite une autre ligne P0-A absente de `dependances`, dont **16 inversions d'ordre de lot** dans le séquencement de 18 v1 (ex. PRT-019 et E7 au lot 1 « revue par l'ops (ADM-004) », ADM-004 au lot 3 ; VER-007/VER-013 vers ADM-029 au lot 3 ; HST-005 vers CAL-003 et PRC-001 au lot 2 ; TRP-002 sans TRP-004 ni PAY-034). Traitement, ligne par ligne (journal « Dépendances corrigées (corrigé VERIF_10-V10-08) » ou « Réf. non bloquante : … (corrigé VERIF_10-V10-08) » dans `notes`) :

- **Dépendance ajoutée** quand la mention est bloquante et ne crée pas de cycle (ex. VER-007 → ADM-029 ; VER-013 → ACC-014, ADM-029 ; SRC-008, SRC-011 → SRC-042 ; LST-006 → CAL-011, PRC-025 ; BKG-012 → ADM-031 ; BKG-018 → LEG-014, LEG-002 ; BKG-032 → PAY-021, FIN-018 ; PAY-004 → PAY-035 ; PAY-006 → ADM-029 ; PAY-018 → BKG-014, PAY-017 ; PAY-021 → PRC-025 ; **TRP-002 → VER-015, PAY-034** ; NTF-007 → LEG-026, PAY-035 ; HST-005 → HST-039 ; HST-019 → HST-039, ADM-031 ; CAL-001 → CAL-011, FLT-003 ; HDB-002 → FLT-003 ; CLM-006 → ADM-005 ; PRT-003, SUP-004 → PRT-019 ; SUP-011 → SUP-004 ; ADM-007 → ADM-031 ; LEG-015 → LEG-002 ; PAY-033 → PAY-034, PAY-035 ; FIN-018 → FIN-002 ; LEG-025 → BKG-019, PRT-019 ; TRP-052 → PAY-035, TRP-004 ; CLM-034 → LEG-009).
- **Sens inversé documenté** quand la ligne citée dépend déjà de la ligne qui la cite (ex. VER-015 cite TRP-052, qui dépend de VER-015) : « Réf. non bloquante » avec le sens retenu.
- **Référence non bloquante** quand l'ajout créerait un cycle ou ne bloque pas la construction (ex. HST-005 cite CAL-003, en aval via CAL-001 → HST-026 → HST-016 → HST-012 → HST-005 ; LST-013 cite le contrat BKG-018, qui reprend son texte ; LEG-015 cite l'outil ADM-008).
- **Sens d'onboarding retourné** : ADM-004 (file d'onboarding et KYB) ne dépend plus de PAY-033 ni de LEG-025 ; ce sont PAY-033 et LEG-025 qui dépendent d'ADM-004 et ajoutent leurs étapes à la file. ADM-004 et une version minimale d'ADM-029 passent au **lot 1** ; une agence n'est activée qu'avec contrat signé et compte PSP (lot 2).
- **WhatsApp non bloquant** : VER-013 dépend de NTF-001 (canal avec repli SMS) et non plus de NTF-002 (corrigé VERIF_10-§2.3).

Les lots du P0-A sont désormais une **colonne** (`lot_p0a`) calculée à partir d'un lot minimal par ligne (18 §6) relevé au lot maximal de ses dépendances : 0 inversion de lot. Le contrôle des mentions (§7) porte sur toutes les lignes P0 : 0 mention non documentée, 54 « Réf. non bloquante » documentées. Plus longue chaîne P0 : 13 niveaux (11 en révision 2) : ACC-029 → VER-027 → PRT-019 → BKG-018 → BKG-019 → LEG-026 → NTF-007 → BKG-022 → MSG-001 → CLM-034 → CLM-006 → ADM-008 → LEG-024 (l'arête ajoutée BKG-018 → PRT-019 fait partir la chaîne du KYB de l'agence).

## 7. Contrôle automatique

Commande (depuis le dossier `turo-audit`) : `python -I tools/check_inventory.py`. Le script vérifie l'encodage, les 19 colonnes, les guillemets, l'unicité et le format des IDs, la cohérence `priorite_produit` / `phase_mvp`, l'existence des dépendances, l'absence d'inversion et de cycle, la couverture des epics du §4 et, depuis la révision 3 (corrigé VERIF_10-V10-08, V10-01, V10-13) : **les identifiants P0 cités dans une description P0 sans figurer dans `dependances`** (chacun doit être une dépendance ou une « Réf. non bloquante » documentée dans `notes`), l'ordre des lots (`lot_p0a`), les valeurs de `beta_pilote` (aucune ligne construite ne dépend d'une ligne DIFFÉRÉ), les valeurs de `risque_legal_financier`, l'estimation au barème du §1 bis et le nombre de descriptions P0 courtes (avertissement). Sortie du 2026-10-30 après la révision 3 :

Sortie à jour (révision 6, 2026-11-02) :

```
Fichier : 04_FEATURE_INVENTORY.csv — 676 lignes de données
Colonnes : 19 (attendu 19) ; lignes au mauvais format : 0
Tous les champs entre guillemets : oui
Identifiants uniques : oui ; mal formés : 0 ; module/préfixe incohérents : 0
Cohérence priorite_produit / phase_mvp : oui
Dépendances : 759 au total ; inconnues : 0 ; auto-dépendances : 0 ; inversées (toutes phases) : 0
Cycles parmi les lignes P0 : 0 ; cycles sur tout le graphe : 0
Plus longue chaîne de dépendances P0 : 14 niveaux

Répartition par phase_mvp :
  P0-A   178
  P0-B     0
  P1     327
  P2     100
  P3      71
  total 676

P0 par module (P0-A / P0-B) :
  ACC     3 /  0
  ADM    18 /  0
  BKG    17 /  0
  CAL     5 /  0
  CLM     5 /  0
  DSN     7 /  0
  FIN     8 /  0
  HDB     2 /  0
  HST    11 /  0
  I18N    3 /  0
  LEG    10 /  0
  LST     9 /  0
  MSG     2 /  0
  NTF     4 /  0
  PAY    16 /  0
  PLT     5 /  0
  PRC     6 /  0
  PRT     8 /  0
  PYO     5 /  0
  REV     4 /  0
  SRC     6 /  0
  SUP     3 /  0
  TRP    10 /  0
  VER    11 /  0

Statut de preuve (toutes lignes) :
  DOCUMENTÉ          324
  PROPOSÉ            188
  OBSERVÉ            132
  INFÉRÉ             21
  DIRECTEMENT TESTÉ  6
  BLOQUÉ             4
  NON EXPLORÉ        1

Epics lus dans le README : 18 ; lignes P0 couvertes : 178/178

Mentions d'un ID P0 dans une description P0 hors `dependances` : 0 non documentée(s) ; 34 documentées « Réf. non bloquante »
Lots du P0-A : lot 0 = 22, lot 1 = 47, lot 2 = 72, lot 3 = 32, lot 4 = 1, lot C = 4 ; inversions de lot : 0
Bêta pilote : OUI 31, SIMPLIFIÉ 112, MANUEL 27, DIFFÉRÉ 8 ; dépendances vers DIFFÉRÉ : 0
Risque juridique / financier des lignes P0 : moyen 68, faible 64, élevé 46

Estimation par barème (unités d'effort : 1 unité = 10 jours-agent, ex-« semaine-équipe » ; ordre de grandeur, barème calibré, non mesuré, sans valeur calendaire) :
  P0-A complet (178 lignes) : lignes 23.6–48.1 + socle 1,5–3 + durcissement et recette interne 1–2 = 26.1–53.1
  Bêta pilote (143 lignes construites) : lignes 8.5–21.4 + socle réduit 1–2 + recette interne 0,5–1 = 10.0–24.4
  P0-B (lignes seules, hors certification PSP et conformité) : 0.0–0.0
  P1 (327 lignes, même barème que le P0-A, lignes seules) : 32.9–71.2
Avertissement (non bloquant) : 47 descriptions P0 de moins de 80 caractères, à compléter avant leur lot

RÉSULTAT : OK
```

Le libellé « Bêta pilote » de la sortie désigne la tranche des lots 0 à 4 de la bêta P2P ; la ligne « P0-B » vaut 0 (phase vide) ; le changement de libellé du script est demandé (§12).

## 8. Fonctionnalités structurantes du MVP (bêta P2P, révision 6)

| # | ID | Fonctionnalité | Pourquoi |
|---|---|---|---|
| 1 | PAY-001 / PAY-006 / PAY-021 | Paiement et remboursement par jambes, Kmino marchand de référence | Modèle de Turo (DEC-FONDATEUR-14) ; le PSP ne calcule jamais un prorata (analyse pivot §c.2) |
| 2 | PAY-041 | Porte go / no-go du PSP de place de marché, par pays | Risque n° 1 : aucun PSP validé ; aucun plan B avec des agences |
| 3 | HST-049 / ADM-004 / VER-028 | Inscription, KYC et sanctions de l'hôte particulier | Fraude, LBC/FT (OQ-P2P-01) |
| 4 | HST-019 / HST-039 | Éligibilité du véhicule d'un particulier (titre, prenda, VIN) | Véhicule volé ou nanti (OQ-P2P-02, OQ-BR-28) |
| 5 | PRT-001 / PRT-003 / PRT-007 | Protections du voyageur, RC, plans de gains de l'hôte | Produit de l'assureur partenaire ; aucun hôte sans contrat signé |
| 6 | PAY-011 / PAY-036 | Caution par carte, fenêtre de rétention | Rail du comptoir supprimé (OQ-P2P-04) |
| 7 | PAY-015 / PAY-037 | Carte enregistrée, débits post-trip | Recouvrement des dommages et des frais (bloquant, `SUPPORTS_MIT`) |
| 8 | PYO-001 / PYO-002 / PYO-003 / PYO-007 | Versements aux hôtes, `host_ledger` | L'hôte est versé après le trajet ; interrupteur `payouts_enabled[pays]` |
| 9 | ADM-027 / LEG-021 | Interrupteurs de mise en service par pays | Avis juridiques et contrats avant toute ouverture (DEC-FONDATEUR-02) |
| 10 | TRP-002 / TRP-004 / VER-015 | Remise et retour entre particuliers, photos des deux côtés | Plus de comptoir ; preuve des litiges |
| 11 | MSG-001 / MSG-007 | Messagerie hôte–voyageur, détection du marché gris | Rendez-vous et contournement |
| 12 | REV-001 / REV-002 / REV-004 | Avis réciproques en double aveugle, 10 jours | Confiance entre particuliers (OQ-P2P-06) |
| 13 | CLM-006 / TRP-038 | Sinistres, vol et non-restitution | Risques propres au P2P (08 BR-RETURN-04, BR-DAMAGE) |
| 14 | BKG-014 / CAL-011 | Hold de checkout, occupation unique | Anti-double réservation |
| 15 | PRC-025 / PRC-012 | Devis versionné, trip fee | Même calcul pour affichage, contrat, remboursement et jambes |
| 16 | BKG-018 / LEG-026 / LEG-014 | Contrat hôte–voyageur, constancia, positionnement d'intermédiaire | Kmino n'est jamais loueur |
| 17 | CLM-034 | Dossier de preuve | Plaintes ACODECO / SEDECO, chargebacks, assureur |
| 18 | ADM-001 / ADM-032 / ADM-033 / ADM-035 | Console, audit, sécurité, reprise | Exploitation sûre de la bêta |
| 19 | LEG-010 | Registre Ley 81 et procédure de violation | Biométrie et adresse de l'hôte (minimisation) |
| 20 | SUP-020 / TRP-056 | Dotation du support, risque PWA iOS | Prérequis d'exploitation et de qualité |

La table de la révision 5 (agence qui encaisse, contrat-cadre, police flotte, iCal, interface de comptoir) est historique : ses lignes sont HORS PRODUIT.

## 9. Limites et suites

- Appliqué en révision 3 (corrigé VERIF_10-V10-13) : F04–F05 pour les lignes « DIRECTEMENT TESTÉ » (§2), F11 (colonne `risque_legal_financier`, barèmes §1 bis, recodage, scission de TRP-002).
- Non traité (VERIF_07) : F06–F07 (OBSERVÉ sans EV, DOCUMENTÉ de seconde main), F13 au-delà des fusions de §3.3 (doublons FIN-002 / PAY-029 / PYO-013 traités, autres non), F14 (réaffectation de modules), F15 (liens vers EC et BR manquants).
- IMP-33 et IMP-34 sont désormais en P2 dans 15 comme BKG-042 et SRC-046 ici (corrigé VERIF_10-V10-14) ; **04 et 18 font foi pour le build**.
- `08_BUSINESS_RULES.md` n'a pas été modifié (hors périmètre de cette passe ; le bandeau d'avertissement proposé par VERIF_10-V10-18 reste à poser lors de sa révision) : BR-PAY-06 (seuil de pré-autorisation) et BR-REIMB-03 (48 h) sont contredits par VERIF_08 et remplacés, pour le build, par PAY-036 et PAY-037.
- 22 est repriorisé (corrigé VERIF_10) : OQ-BR-21, OQ-BR-25, OQ-PAY-07 et OQ-PAY-22 passent en P0 ; OQ-MK-09 (Ley 81 : transferts, enregistrement, violation) est ajoutée en P0.
- Reste (VERIF_10-V10-13, non bloquant) : 43 descriptions P0 (51 avant la révision 4) font moins de 80 caractères sans critère d'acceptation ; règle : chacune est complétée avant le début de son lot (`lot_p0a`), le script les compte à chaque passage.

## 10. Révision 4 — consolidation avec 17 v2 et 10b v2 (2026-10-30)

Chaque ligne modifiée porte dans `notes` la mention « Consolidation 04/08/16/17 du 2026-10-30 (origine) » et, quand la description a été réécrite, la description précédente.

| Origine | Ligne(s) | Changement |
|---|---|---|
| 17-C04-1 (A8, ADR-025) | PAY-033 | mode (b) : « sinon annulation automatique » → hold `AGENCY_LINK` (TTL `agency_link_hold_minutes` PROPOSÉ 120 min, **décision produit UXQ-09**), libération du hold, aucun trip ni contrat avant la preuve |
| 17-C04-2 ; 10b §7 BKG-014 | BKG-014 | état « paiement en cours » (`PAYMENT_IN_FLIGHT`, borne 20 min), hold `AGENCY_LINK`, conversion gardée, ré-acquisition, compensation par capacité (void, remboursement API, remboursement par l'agence, Yappy par virement), critère C1–C12 |
| 17-C04-3 | PAY-019 | clé d'idempotence par tentative `hold:{hold_id}:…:a{n}` |
| 17-C04-4 ; 10b §7 PAY-021/LEG-025 | PAY-021, LEG-025 | tâche de remboursement exécutée par l'agence (échéance par rail, vue « remboursements à exécuter », preuve, confirmation, pénalité) ; délai contractuel pour tous les rails (UXQ-10) ; liste « couvre / ne couvre pas » reprise au contrat-cadre |
| 17-C04-5 | PAY-034 | confirmation de l'agence réservée à `AGENCY_OWNER` / `AGENCY_MANAGER`, double confirmation au-delà d'un seuil |
| 17-C04-6 (A7) | CLM-021 | nom « sous 72 h » ; paramètre `invoice_guest_response_h` |
| 17-C04-7 (A10) | ADM-001 | extension à 12 rôles (2 en Bêta pilote) |
| 17-C04-8 | FLT-001, FLT-003 | `vehicle_scope` des co-hôtes, `AGENCY_OWNER`, RLS obligatoire |
| 17-C04-9 | VER-002, VER-003, VER-004 | zéro copie d'image, rétention chez le fournisseur, « ≤ 3 ans » = plafond, scores en C3 |
| 17-C04-10 ; 10b §7 LEG-010 | LEG-009, LEG-010 | crypto-shredding ; registres `data_subject_request`, `security_incident`, `subprocessor` ; finalité « remboursement par virement » (UXQ-11) |
| 17-C04-11 | ADM-035 | registre des incidents, Multi-AZ, astreinte |
| 17-C04-12 (A1, A2) | PRC-021, PAY-012 | arrondi au plus proche (pas un plus grand reste) ; libération à fin + 72 h, jamais suspendue par une réclamation |
| 17-C04-13 (A12) ; VERIF_15-F4 | PAY-006 | compensation Bêta = remboursement, jamais un void ; vecteur P0-A 16 TA10 |
| 10b §7 PAY-035 | PAY-035 | liste fermée « couvre / ne couvre pas », dont « dommages : oui / non » ; sans elle, aucune promesse de couverture affichée |
| 10b §7 BKG-012 / ADM-029 | BKG-012, ADM-029 | option « lien de paiement après la décision de l'ops » liée à **UXQ-08, décision ouverte** (rédigée comme option, non appliquée) |
| 10b §7 VER-007 | VER-007 (notes) | option Bêta « deux champs au checkout » conditionnée à UXQ-03 |

Non reporté : aucun point de l'annexe A de 17 ne demande d'autre changement dans 04 (A3–A6, A8–A9, A11, A13–A15 concernent 08, 09b ou 17).

Sortie de `python -I tools/check_inventory.py` après la révision 4 (2026-10-30) :

(sortie de la révision 4 retirée en révision 5, VERIF_18-F08 : la sortie à jour figure une seule fois au §7)

## 11. Révision 5 — passe de cohérence finale VERIF_18 et décisions fondateur 05 à 10 (2026-10-30)

Chaque ligne modifiée porte dans `notes` la mention « Passe de cohérence finale VERIF_18 du 2026-10-30 (constat) » et, quand la description a été réécrite, la description précédente.

| Constat / décision | Ligne(s) | Changement |
|---|---|---|
| VERIF_18-F01 (lot des connecteurs réels) | PAY-041, PAY-033, PAY-001, FIN-002, VER-001 ; PAY-042, FIN-020, VER-029 créées | valeur de lot `C` (après le choix du pays, avant la mise en service) ; PAY-041 au lot C et généralisée au PSP du pays retenu (Bancard vPOS / upay au Paraguay, OQ-PAY-08/10/12) ; PAY-033 ne dépend plus de PAY-041 (référence non bloquante) ; un connecteur réel par famille (PSP, e-facture, KYC) au lot C |
| VERIF_18-F02 (DEC-FONDATEUR-04) | I18N-005, FIN-003, PRC-021, I18N-003, ADM-014 | I18N-005 et FIN-003 promues P0-A ; « phase PY » retiré ; `es-PY`, fuseau `America/Asuncion`, forfaits PYG explicités |
| VERIF_18-F04, F05 | PAY-036, PAY-011, PAY-012 | forme en heures, marge 0 h, T59 ; marge d'un jour supprimée ; caution limitée aux frais annexes de la liste fermée, jamais suspendue, dommage recouvré sur la carte enregistrée (REQ-PAY-DMG-02 à 07) |
| VERIF_18-F07 | BKG-014, ADM-033 | CA : C1–C20, RLS-1 à RLS-20, L0-01 à L0-10 sous les rôles de production |
| VERIF_18-F08 | README §2, §4, §7, §10 | comptes régénérés ; sortie d'outil unique |
| VERIF_18-F15, F17, F20, F24 | BKG-012, HST-050, ADM-031, TRP-046 | EC-44 / EC-05 cités ; BR-LIST-04 cité ; jalon ADM-031 lu « avant la mise en service » ; « 80 h » étiqueté valeur Turo |
| DEC-FONDATEUR-06 / 07 | DSN-001 à DSN-007 (E16) | naming et identité d'abord, tokens pilotés par les données, back-office « Apparence / Marque » (prévisualisation, brouillon / publication, historique, retour arrière), blocs de contenu es/en, bibliothèque de composants, web mobile-first + PWA, revue UX indépendante ; cœur en Bêta SIMPLIFIÉ |
| DEC-FONDATEUR-05 / 08 / 09 / 10 | PLT-001 à PLT-005 (E17, transverse) | IaC, conteneurs et portabilité ; comptes et secrets au nom du fondateur ; documentation et checklist de passation ; stratégie de tests et portes CI ; gouvernance multi-agents par artefacts |

Effort (barème, unités de 10 jours-agent, sans valeur calendaire) : P0-A complet 24,4–49,9 ; Bêta pilote 7,5–17,5. Ces sommes de lignes ne couvrent pas les éléments non négociables de 17 : l'énoncé à communiquer est celui de 18 §5.

## 12. Révision 6 — pivot P2P (US-054, 2026-11-02)

**Source** : `docs/team/impact/2026-11-02-pivot-p2p.md` §e (stories retirées, remontées, adaptées, nouvelles, séquence) et §g.1 point 7 ; décisions DEC-FONDATEUR-13 à 16 (`docs/team/DECISIONS.md`, 22 « Décisions prises »). Chaque ligne modifiée porte en tête de `notes` la mention « Rév. 6 (pivot P2P, DEC-FONDATEUR-13, 2026-11-02) » ou « HORS PRODUIT (DEC-FONDATEUR-13) » ; les descriptions réécrites remplacent celles de la révision 5, conservées dans l'historique Git.

| Changement | Lignes | Règle appliquée |
|---|---|---|
| **HORS PRODUIT** (P3, sans story ; 24) | ex-P0-A : VER-027, PRT-019, PRT-009, LEG-025, LEG-020, LEG-027, PAY-033, PAY-035, ACC-029, ACC-008, FLT-003, FLT-011, CAL-009, TRP-052, FIN-019 ; ex-P0-B : PAY-038 ; ex-P1 : LST-029, REV-014, FLT-010, FLT-017, FLT-018, FLT-019, TRP-055 ; ex-P2 : FLT-012 | §e.1 et §e.2 de l'analyse : KYB, police flotte, contrat-cadre, mandats, encaissement par un tiers, caution d'agence, split de commission, comptoir, équipes et outils de flotte de loueur. **Aucune ligne supprimée** |
| P0-A → P1 (comme Turo) | FLT-001 | co-hôtes invités par un hôte, comme Turo (`docs/team/COMME_TURO.md`) ; équipes de loueur hors produit |
| **Remontées** de P1 / P2 (16) | P2 : HST-049, PYO-003, PRT-007, PRT-008, PRT-015, HST-048, LEG-021 ; P1 : PRT-001, PRT-002, PRT-011, BKG-003, PRC-018, REV-002, REV-004, FIN-008, ADM-027 | §e.3 de l'analyse (« 19 lignes de 04 », dont PAY-011, PAY-012 et PAY-036, déjà P0) ; lot = lot de la story de §e.5 / §e.6, relevé au lot de ses dépendances |
| **Ex-P0-B intégrées** (12) | PAY-011, PAY-012, PAY-015, PAY-036, PAY-037, PRC-012, CLM-021, PYO-001, PYO-002, PYO-007, FIN-004, FIN-005 | §e.3 (US-701 à US-704, US-706 à US-711 remontées ; LB supprimé) |
| Descriptions réécrites ou ajustées pour l'hôte particulier | 73 lignes du MVP (dont 19 remontées ou intégrées) | voir les notes ; les noms de paramètres et de capacités nouveaux sont PROPOSÉS (17 §7.2 et §2.8, demande de fusion S4) |
| `beta_pilote` revue | 26 lignes (BKG-016, MSG-001, MSG-007, REV-001, TRP-038, CLM-001, CLM-002, CLM-006, ADM-022, PAY-021, PAY-006, PAY-002, HST-019, HST-039, HST-005, HST-012, HST-016, HST-026, HST-033, PRC-001, HDB-001, CAL-003, ACC-014, FIN-001, PRT-003, LST-020) | ce que l'ops faisait à la place d'une agence est désormais construit (stories remontées ou NOUVELLE-xx de §e.5) |
| Persona « Hôte pro (loueur) » → « Hôte » | 30 lignes du produit (P1 à P3 surtout) | un hôte particulier peut avoir plusieurs véhicules, comme chez Turo ; la valeur historique ne reste que sur les lignes HORS PRODUIT |
| Dépendances modifiées (37) | P0-A : VER-028, SRC-011, LST-013, LST-020, BKG-018, BKG-032, PAY-004, PAY-011, PAY-021, TRP-035, NTF-007, REV-002, REV-004, HST-019, HST-039, CAL-001, HDB-001, HDB-002, PYO-001, PYO-013, CLM-006, PRT-003, PRT-007, PRT-011, SUP-004, ADM-004, ADM-007, FIN-003, LEG-021, FIN-018, HST-049 ; hors P0 : ACC-030, HST-018, FLT-001, FLT-009, TRP-054, MKT-018 | une dépendance vers une ligne hors produit, vers le lien de paiement d'une agence ou vers une ligne P1 / P2 est remplacée par la ligne P2P équivalente, ou passée en « Réf. non bloquante » documentée dans `notes` ; quelques dépendances P2P ajoutées (PAY-015, PAY-021, PYO-007, FIN-002) |

**Lecture des lots et de la bêta** : `lot_p0a` reste le lot minimal de chaque ligne (0 à 4, ou C) ; les stories du lot 5 de 19 (US-710, US-711, NOUVELLE-15) portent des lignes dont la tranche des lots 0 à 4 est MANUEL (FIN-004, FIN-005, PYO-013). Les écarts entre le lot de 04 et celui des stories de 19 seront rapprochés par S6.

**Limites connues de la révision 6** (à reprendre par les demandes de fusion indiquées) :

1. **Couplage avec 16 et 19** : `tools/check_prd_structure.py`, `tools/verif15_struct.py`, `tools/check_backlog.py` et `tools/verif19_backlog.py` comparent 04 aux fiches de 16 et aux stories de 19. Tant que S5 (16 : fiches des lignes remontées, matrice D.1) et S6 (19 : stories des lignes remontées ou intégrées, IDs des NOUVELLE-xx, LB supprimé) ne sont pas faits, ces quatre contrôles échouent ; `tools/check_inventory.py` passe. Détail des écarts : `docs/team/handoffs/US-054.md`.
2. **Valeur « hors produit »** : `tools/check_inventory.py` n'accepte que P0-A à P3 ; les lignes hors produit sont donc rangées en P3 avec la marque « HORS PRODUIT » en tête de `notes`. Demandé (hors de cette story, `tools/` étant modifié en parallèle par US-055) : une valeur `HORS` de `phase_mvp` / `priorite_produit` exclue des comptes et des contrôles d'inversion, et le libellé « tranche des lots 0 à 4 » au lieu de « Bêta pilote ».
3. Les 498 lignes P1 à P3 qui ne sont pas réécrites gardent leur texte ; celles qui citent une agence, un loueur ou un comptoir portent la marque de lecture historique.
