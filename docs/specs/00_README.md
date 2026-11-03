# 00 — Lisez-moi du dossier de recherche et de spécification

> **État au 2026-10-30 (fin de rédaction)**. Dossier : `C:/Users/noamm/Documents/turo-audit-latam/research/turo-audit/`. Rédigé en français. Aucune ligne de code applicatif n'existe encore : ce dossier est la **base de connaissances et la spécification** d'une marketplace de location de véhicules (type Turo) pour le **Panama** et le **Paraguay**.
> **État final** : audit contradictoire final `24_FINAL_AUDIT_AND_GAPS.md` fait (0 CRITIQUE, 12 MAJEUR, 13 MINEUR) et corrections appliquées (24 « Suivi des corrections »). Dossier **prêt pour le lot 0 sous conditions** ; lacunes du monde réel au §7 et dans `RESUME_HERE.md`.
> **Révision P2P terminée (2026-11-03, US-053 à US-060, demandes de fusion S1 à S8 de `docs/team/impact/2026-11-02-pivot-p2p.md`)** : le produit est une place de marché **de particulier à particulier**, comme Turo, au Panama et au Paraguay ; **hôtes particuliers uniquement, aucune agence ni loueur professionnel** (DEC-FONDATEUR-13) ; par défaut, on fait comme Turo (DEC-FONDATEUR-14, 16, `docs/team/COMME_TURO.md`) ; le voyageur paie **Kmino, marchand de référence**, par un PSP de place de marché en `FAKE` jusqu'au lot C, qui répartit chaque paiement en jambes explicites (08 E7) ; aucun fonds de tiers détenu en build, en `FAKE` et en production tant que `funds_holding_enabled[pays]` = `false` (17 §0.1) ; remise et retour entre personnes ; produit **trilingue es / en / fr** (DEC-FONDATEUR-17). Ordre : bêta P2P (lots 0 à 5 de 19 v3), puis lot C après le choix du pays et la porte go / no-go du PSP. Le dossier vit désormais dans le dépôt (`docs/specs/`). **Règle de lecture** : dans les sections non révisées de ce fichier, « P0-A » et « Bêta pilote » se lisent « bêta P2P », « P0-B » se lit « fonction construite, fermée en production par un interrupteur par pays » ; toute mention d'agence, de loueur ou de comptoir est historique et hors produit.

## 1. À quoi sert ce dossier

1. **Comprendre Turo** par rétro-ingénierie *fonctionnelle* (observation de l'interface publique et du compte du fondateur, lecture des politiques et du centre d'aide ; aucune décompilation, **aucun contournement réussi** (tentatives consignées, §6), aucune donnée personnelle de tiers ; méthode : `02_RESEARCH_METHODOLOGY.md`).
2. **Décider où et comment lancer** : marchés Panama et Paraguay, partenaires de paiement, concurrence, recommandation **GO CONDITIONNEL** (12 §10.3).
3. **Spécifier le produit à construire** : inventaire des fonctionnalités (04), règles métier et vecteurs de test monétaires (08), PRD (16), architecture et modèle de données (17), MVP et feuille de route (18), backlog de user stories (19), décisions ouvertes (22).
4. **Permettre à une équipe d'agents Claude Code** (aucun développeur humain, DEC-FONDATEUR-05) de démarrer le build sans mémoire de cette recherche : point d'entrée **`CLAUDE_BUILD_HANDOFF.md`**.

## 2. Organisation du dossier

Statuts des documents : **PROPOSÉ** = conception de notre produit, non validée sur le terrain ; **EN COURS** = document de recherche resté ouvert (observations partielles) ; **audité** = relu par un agent indépendant (rapport dans `verification/`), corrections appliquées et journalisées. « v4 », « rév. 5 » = version courante.

| Fichier | Contenu (une ligne) | Statut |
|---|---|---|
| `00_README.md` | Ce fichier : organisation, vocabulaire, contrôles, ordre de lecture, limites | audité (24) ; corrigé |
| `01_EXECUTIVE_SUMMARY.md` | Synthèse pour le fondateur : Turo, notre produit, marché, MVP, effort, risques, décisions, prochaines actions | audité (24) ; corrigé |
| `02_RESEARCH_METHODOLOGY.md` | Principes, conformité aux CGU de Turo (récit corrigé, « Constat A24-04 / A24-05 »), statuts de preuve, outils, limites, règle d'audit indépendant | à jour ; relu via VERIF_01 ; corrigé après 24 |
| `03_SITEMAP_AND_NAVIGATION.md` | Cartographie des pages publiques de turo.com (US) | EN COURS (base de la phase 1) |
| `04_FEATURE_INVENTORY.csv` | **Source de vérité du périmètre** : 676 fonctionnalités, colonnes `phase_mvp` (P0-A = bêta P2P 178, P1 327, P2 100, P3 47, HORS 24 « HORS PRODUIT », P0-B vide), `lot_p0a`, `beta_pilote`, `risque_legal_financier` | rév. 6 (pivot P2P, US-054) ; audité VERIF_07, 10, 18, 19 (rév. 5) ; `check_inventory.py` OK |
| `04_FEATURE_INVENTORY_README.md` | Colonnes, barèmes, comptes, epics E1–E18, préconditions, journal des révisions | rév. 6 ; audité avec 04 (rév. 5) |
| `05_GUEST_JOURNEYS.md` | Parcours locataire observés (non connecté puis connecté, US, mobile web) | EN COURS ; audité VERIF_01 |
| `06_HOST_JOURNEYS.md` | Parcours hôte observés (landing, wizard jusqu'à l'étape VIN) | EN COURS ; audité VERIF_01, VERIF_03 |
| `07_…` | **Numéro non attribué** (aucun fichier 07 dans le dossier ; aucune référence ailleurs) | — |
| `08_BUSINESS_RULES.md` | **Règles métier faisant foi** (~200 règles BR-*, trip fee, plans de protection, part de l'hôte, exécution monétaire E1–E7 dont les **jambes explicites**, machines à états SM-1 à SM-8, vecteurs T01–T68 et TJ01–TJ21) | révisé P2P (US-055, US-056) ; audité VERIF_04, 09, 11, 12, 18 ; journaux de correction en fin de fichier |
| `09_PRICING_PAYMENTS_AND_PAYOUTS.md` | Composantes du prix Turo observées, formule reconstituée | EN COURS ; audité VERIF_01 |
| `09b_PAYMENT_PARTNERS_PA_PY.md` | Partenaires de paiement Panama / Paraguay, règles réseaux de la caution, architecture de paiement recommandée | audité VERIF_08, VERIF_12 |
| `10_INSURANCE_TRUST_AND_SAFETY.md` | Plans de protection guest, plans de gains hôte, confiance et sécurité de Turo | EN COURS ; audité VERIF_01, VERIF_03 |
| `10b_UX_UI_ANALYSIS.md` | Analyse UX de Turo, principes et exigences UX, écrans de la bêta P2P (voyageur S, espace hôte A, back-office O), flux, catalogue des textes **es / en / fr** (§4.3), plan de tests, fondations design (§8) | v3 (pivot P2P, US-059 ; `fr` ajouté par US-060) ; audité VERIF_13 (v2) |
| `11_EDGE_CASES_AND_FAILURES.md` | 57 cas limites (EC-xx) en Given / When / Then (EC-57 ajouté après 24) | audité VERIF_04 ; EC-57 PROPOSÉ |
| `12_PANAMA_MARKET.md` | Marché Panama, matrice go / no-go, **recommandation GO CONDITIONNEL** (§10.3) | audité VERIF_02, VERIF_05 |
| `13_PARAGUAY_MARKET.md` | Marché Paraguay (repli explicite, construit en parallèle) | audité VERIF_02, VERIF_05 |
| `14_COMPETITIVE_ANALYSIS.md` | Concurrents, leçons des échecs, positionnement | audité VERIF_05 |
| `15_PRODUCT_IMPROVEMENTS.md` | 49 idées d'amélioration (IMP-01..49), classement, 10 avantages concurrentiels | PROPOSÉ ; audité VERIF_06, VERIF_10 |
| `16_PRODUCT_REQUIREMENTS_DOCUMENT.md` | **PRD faisant foi pour les fonctionnalités** : partie A (vision P2P, personas, NFR, codes d'erreur A.8, vecteurs TA01–TA11 par jambe), partie B (128 fiches P0), partie C (P1–P3, C.4 = 24 lignes HORS), partie D (traçabilité) | PROPOSÉ v5 (pivot P2P, US-057) ; audité VERIF_15, 18, 19 (v4) ; `check_prd_structure.py` OK |
| `17_DATA_MODEL_AND_ARCHITECTURE.md` | **Architecture faisant foi** : modèle d'argent et interrupteurs par pays (§0.1), modules, rôles et RLS, verrouillage hold / trip (dont la demande `REQUEST`), entités, événements, pile technique, paramètres (§7.2), ADR, preuves L0 (§11), tests (§12), gouvernance (§13) | PROPOSÉ v6 (pivot P2P, US-056 ; complément US-060) ; audité VERIF_14, 16, 17, 18, 19 (v5) ; **DDL jamais exécuté** |
| `18_MVP_AND_ROADMAP.md` | MVP (bêta P2P : tranche des lots 0 à 4, puis lot 5 ; lot C), hors périmètre (agences), préconditions de mise en service, chemin critique, effort en jours-agent, risques | PROPOSÉ v5 (pivot P2P, US-054) ; audité VERIF_10, 18, 19 (v4) |
| `19_DEVELOPMENT_BACKLOG.md` | **Backlog faisant foi** : 205 stories (186 actives, 19 hors produit) / 921 points, lots L0–L5, LC (lot LB supprimé par la révision P2P) ; modèle d'équipe IA, DoR / DoD, tests, règles d'exploitation, portes de lot, décisions et tâches fondateur F-01..F-21, charge du fondateur (§6.1) | v3 (révision P2P, US-058) ; audité VERIF_19 (v2) ; `check_backlog.py` et `verif19_backlog.py` OK |
| `20_EVIDENCE_REGISTER.csv` | Registre des preuves EV-0001… (observations, lectures) | à jour au 2026-10-30 |
| `21_COVERAGE_MATRIX.csv` | Matrice de couverture (parcours observés, puis statut final par epic et par domaine, lignes `FINAL-*`) | mise à jour pour le pivot P2P (US-054) |
| `22_OPEN_QUESTIONS.md` | **Décisions et questions ouvertes faisant foi** (OQ-*, OQ-P2P-01 à 12, UXQ-*, DEC-FONDATEUR-01 à 17, DEC-PAYS, DEC-MARQUE, DEC-NATIVE) avec valeur par défaut et échéance | révisé P2P (US-053 ; DEC-FONDATEUR-17 reportée par US-060) ; audité VERIF_04, 18, 19 |
| `23_RESEARCH_LOG.md` | Journal chronologique de la mission | à jour |
| `24_FINAL_AUDIT_AND_GAPS.md` | Audit contradictoire final et lacunes ; « Suivi des corrections » en fin de fichier | fait (agent indépendant) ; corrections suivies |
| `CLAUDE_BUILD_HANDOFF.md` | **Point d'entrée de la session de développement** : mission P2P, carte des documents, décisions, modèle d'équipe, plan de démarrage du lot 0, portes qualité, premières heures ; mécanique Claude Code et identité GitHub (§4.9, §4.10) | audité (24) ; §1, §2, §3, §4.1 et §9 révisés P2P (US-060) |
| `RESUME_HERE.md` | Point de reprise de la mission de recherche (état, reste à faire) ; l'état du build est dans `docs/team/RESUME_HERE.md` | à jour (révision P2P, US-060) |

**Dossiers**

| Dossier | Contenu |
|---|---|
| `sources/` | Notes de sources : `SRC_GUEST_DOCS.md` (centre d'aide côté guest), `SRC_HOST_DOCS.md` (732 articles hôte lus), `SRC_TOS_NOTES.md` (CGU US, paraphrasées), `SRC_COMPETITORS.md`, `SRC_VEHICLE_DATA.md` (sources du catalogue véhicules ; note d'alignement sur les noms de 17 ajoutée le 2026-10-30) |
| `verification/` | `VERIFICATION_LOG.md` (journal de tous les audits) et 19 rapports `VERIF_01_TURO_FUNCTIONAL.md` … `VERIF_19_BACKLOG_FINAL.md` ; sorties de scripts d'audit (`verif18_*_output.txt`, `verif19_backlog_output.txt`) |
| `tools/` | Scripts Python de contrôle (structure des documents et oracles monétaires), §4 |

**Qui fait foi en cas d'écart** : périmètre → 04 ; règles et montants (trip fee, plans de protection, part de l'hôte, jambes) → 08 ; fonctionnalités et critères → 16 ; architecture et noms d'entités → 17 ; ordre de construction → 19 ; décisions → 22 (et `docs/team/DECISIONS.md`) ; textes visibles es / en / fr → 10b §4.3. Les documents de recherche (05, 06, 09, 10, 12, 13) décrivent Turo et les marchés ; ils ne spécifient pas notre produit.

## 3. Vocabulaire des statuts de preuve

| Statut | Sens |
|---|---|
| **DIRECTEMENT TESTÉ** | manipulé par nous dans l'interface de Turo (sans action engageante) |
| **OBSERVÉ** | vu à l'écran, sans manipulation complète |
| **DOCUMENTÉ** | lu dans une politique ou un article officiel de Turo (date de lecture indiquée) |
| **DOCUMENTÉ-SECONDAIRE** | presse, agrégateurs, sites d'entreprises, cabinets (marchés, concurrence) |
| **CONFIRMÉ** | source primaire officielle (statistique publique, texte de loi, documentation d'un fournisseur) |
| **INFÉRÉ** | déduction de l'analyste |
| **PROPOSÉ** | notre conception (« [NOUS] »), non validée |
| **À VALIDER** | point juridique, fiscal, assurantiel ou fournisseur à faire confirmer par un professionnel |
| **BLOQUÉ** | inaccessible sans action interdite (ex. VIN réel, réservation payante) |
| **NON EXPLORÉ** | pas encore regardé |

Marques de traçabilité : « (corrigé VERIF_xx-ID) » = correction issue d'un audit ; « (aligné v4) » = passe d'alignement ; EV-xxxx = preuve du registre 20.

## 4. Lancer tous les contrôles

Depuis le dossier du projet, sous Windows (Git Bash ou PowerShell). `-I` isole Python (n'importe aucun fichier du dossier courant) ; **`-X utf8` est nécessaire sur la console Windows** (sinon `verif18_stale.py` échoue en affichant le caractère « → » ; constaté le 2026-10-30, Python 3.12).

```bash
cd "C:/Users/noamm/Documents/turo-audit-latam/research/turo-audit"
# Structure des documents
python -I -X utf8 tools/check_inventory.py          # 04 : colonnes, phases (HORS avec marqueur « HORS PRODUIT », P0-B refusée), epics, dépendances, lots, barèmes -> RÉSULTAT : OK
python -I -X utf8 tools/check_prd_structure.py      # 16 v5 : 178 lignes P0 couvertes par 128 fiches, partie C (dont 24 HORS), références, D.1 -> RÉSULTAT : OK
python -I -X utf8 tools/check_backlog.py            # 19 : 205 stories (lot HORS), couverture P0, dépendances, chemins critiques ; comptes de 21 (FINAL-FEAT-INV, FINAL-E0 à E18) contre 04 et 19 -> RÉSULTAT : OK
python -I -X utf8 tools/verif19_backlog.py          # 19 (contrôle indépendant de l'auditeur) -> ERREURS 0
python -I -X utf8 tools/verif18_crossref.py         # identifiants cités et définis entre documents -> 0 cité sans définition, hors 2 faux positifs connus (« SM-x » dans 17, « SHA-256 » pris pour une feature)
python -I -X utf8 tools/verif18_stale.py            # restes de noms obsolètes (écrit verification/verif18_stale_output.txt) ; lecture humaine
python -I -X utf8 tools/verif15_struct.py           # 04 / 16 : comptes et équilibre Given/When/Then ; lignes HORS : marqueur « HORS PRODUIT », aucune fiche (auditeur VERIF_15)
python -I -X utf8 tools/verif15_conf.py             # 16 : statuts de preuve par fiche (auditeur VERIF_15)
# Oracles monétaires (valeurs attendues des vecteurs de 08 et 16)
python -I -X utf8 tools/verif11_settlement.py              # T01–T48, oracle indépendant de l'auditeur VERIF_11 -> 48 vecteurs, 0 écart (+ fuzz informatif)
python -I -X utf8 tools/independent_settlement_check.py    # T01–T48, second oracle -> ECARTS sur T01-T48 : 0
python -I -X utf8 tools/verif12_t49plus.py                 # T49–T65, oracle de l'auditeur VERIF_12 -> 38/38
python -I -X utf8 tools/check_t49plus.py                   # T49–T65 (rédacteur) -> écarts = 0
python -I -X utf8 tools/check_verif12_fixes.py             # corrections VERIF_12 (E2 incrémental, T66–T68 partiels) -> 0 écart
python -I -X utf8 tools/check_t66_68.py                    # T66–T68 -> RÉSULTAT : OK
python -I -X utf8 tools/check_ta_consolidation.py          # TA01–TA11 de 16 v5 (jambes, renvois aux TJ de 08) -> RÉSULTAT : OK
python -I -X utf8 tools/check_legs.py                      # TJ01–TJ21, jambes explicites (08 E7, US-055, US-056) -> RÉSULTAT : OK
python -I -X utf8 tools/verif15_ta.py                      # TA01–TA07, TA09 de 16 v5, jambes (auditeur) -> OK
python -I -X utf8 tools/export_golden_vectors.py           # export des vecteurs dorés T01–T68, TJ01–TJ21, TA01–TA11 pour @rueda/money/golden-vectors (US-016) ; compare golden_vectors.json à l'export régénéré (--write pour le réécrire) -> RÉSULTAT : OK
python -I -X utf8 tools/verify_cxl_tests.py                # historique (T01–T27) : imprime, n'asserte rien (déclassé) ; ne pas compter comme contrôle
```

Boucle unique (Git Bash) : `for f in tools/*.py; do echo "== $f"; python -I -X utf8 "$f" | tail -2; done`.

**Registre des oracles (US-050).** La CI (`scripts/ci/check-spec-tools.py`) lit les résultats attendus ci-dessus dans [`tools/registry.json`](tools/registry.json). Pour chaque script, ce fichier donne les motifs qui doivent apparaître (`require`), ceux qui ne doivent pas apparaître (`forbid`) et, pour les oracles comptés, le nombre de vecteurs (`counts`). Pour ajouter un oracle ou un vecteur, il suffit de modifier les specs :

1. ajouter le script dans `tools/` et sa ligne dans le bloc ci-dessus ;
2. l'inscrire dans `tools/registry.json` (ou y relever le compte, par exemple `check_legs.py` : `"vecteurs": 58` et le motif `… : 58 ; vecteurs calculés : 58`) ;
3. lancer `python -I -X utf8 scripts/ci/check-spec-tools.py --specs docs/specs`, qui doit afficher `RÉSULTAT : OK`.

Ce chemin ne touche pas `scripts/ci/`. Le registre exige une revue argent et une revue sécurité (`docs/team/review-requirements.json`). Il ne contient que des attentes : il ne peut ni exclure un script, ni retirer un oracle plancher, ni annuler un compte obligatoire. Il peut en revanche relâcher un motif, d'où la revue sécurité. Ce qui suit reste dans le script et ne change que par une PR qui touche `scripts/ci/`, sous les garde-fous de DEC-FONDATEUR-15 (revue sécurité au SHA fusionné, `docs/ops/CI.md`) :

- la liste des scripts exclus (`EXCLUDED`) ;
- la liste plancher des oracles qui doivent figurer au registre ;
- les comptes obligatoires (≥ 1) ;
- l'interdiction d'une trace Python.

Un registre absent, illisible ou vide fait échouer le contrôle, de même qu'une clé inconnue ou en double, un script absent ou hors de `tools/`, un motif `require` qui accepte une sortie vide, ou un script de `tools/` qui n'est classé nulle part.

État du 2026-10-30 après la passe finale : **tous les scripts ci-dessus s'exécutent sans erreur et donnent le résultat indiqué** (`verif19_backlog.py` a reçu une mise à jour **structurelle uniquement** : totaux lus dans 19 §7 et stories déplacées de 19 §1.1 acceptées ; voir 19 §7 et 23).

## 5. Ordre de lecture

**Développeur ou session Claude Code** (construire) :
1. `CLAUDE_BUILD_HANDOFF.md` (en entier, avec son « script de première session ») ;
2. `19_DEVELOPMENT_BACKLOG.md` §1 (mode d'emploi, modèle d'équipe, DoD, règles d'exploitation, portes de lot), §2, puis le lot en cours ;
3. `17_DATA_MODEL_AND_ARCHITECTURE.md` §0 (dont §0.1, argent et interrupteurs) à §2, §2.5 (verrouillage), §3, §7.2, §11, §12, §13, puis le module touché ;
4. `08_BUSINESS_RULES.md` : BR-CXL, BR-PROT, « Exécution monétaire » E1–E7 (jambes), BR-PAY-06, SM-1 à SM-8, vecteurs T01–T68 et TJ01–TJ21 ;
5. `16_PRODUCT_REQUIREMENTS_DOCUMENT.md` partie A puis la fiche de chaque feature de la story ;
6. `22_OPEN_QUESTIONS.md` « Décisions fondateur / produit en attente » et « Pivot P2P » (défauts à coder) ; `docs/team/COMME_TURO.md` ;
7. `10b_UX_UI_ANALYSIS.md` §3, §4 et §8 pour toute story visible ; `04` et son README pour le périmètre ; `18` §1–§4 pour le contexte.

**Fondateur** (décider et agir) :
1. `01_EXECUTIVE_SUMMARY.md` ;
2. `22_OPEN_QUESTIONS.md` « Décisions fondateur / produit en attente » et « Décisions prises » ;
3. `19_DEVELOPMENT_BACKLOG.md` §5 (points de décision), §6 (tâches F-01 à F-21) et §6.1 (charge estimée par semaine) ;
4. `18_MVP_AND_ROADMAP.md` §0, §1.0, §3 (préconditions de mise en service), §5.0 (énoncé d'effort), §7 (risques) ;
5. `12_PANAMA_MARKET.md` §10.3 (recommandation de pays) et `13_PARAGUAY_MARKET.md` synthèse ;
6. `CLAUDE_BUILD_HANDOFF.md` §5 (prérequis du poste Windows) et §7 (point hebdomadaire).

## 6. Règles permanentes du dossier

- Aucune action engageante sur le compte Turo du fondateur, aucune donnée personnelle de tiers, **interdiction de contourner un blocage**. **Ce qui s'est réellement passé** (02 « Constat A24-04 / A24-05 », 23) : (a) deux agents ont chacun tenté une fois de changer d'user-agent contre le 403 de turo.com ; l'environnement l'a bloqué ; rien n'a été obtenu ; la page a été supprimée : **aucun contournement réussi, tentatives consignées** ; (b) un agent a lu les CGU de Turo via une copie archivée tierce, alors qu'elles avaient déjà été lues directement dans le navigateur intégré (EV-0024) ; rien n'en a été retenu ; (c) des agents ont lu environ 732 articles publics de help.turo.com via leurs versions `.md` publiques pour extraire et paraphraser des règles ; seuls des résumés paraphrasés sont conservés (aucune copie brute dans le projet, vérifié) ; `help.turo.com/robots.txt` renvoyait « Not found » le 2026-10-30 (contrôle dans le navigateur) ; les CGU de Turo interdisent la récupération systématique pour constituer une collection ou une base de données : cette lecture en masse est une **zone grise**, signalée à l'avocat du fondateur (F-21, OQ-MK-10, A24-13). Plus aucune lecture en masse.
- Tout livrable est audité par un agent indépendant avant d'être tenu pour fiable (02, `verification/`).
- Ne jamais trancher une décision du fondateur à sa place : coder la valeur par défaut fail-closed de 22 et la marquer PROPOSÉ.

## 7. Limites à ne pas oublier (ajouté après l'audit 24)

- **Observations de Turo non rejouées par un tiers** (A24-06) : tous les constats OBSERVÉ / DIRECTEMENT TESTÉ viennent d'une seule session du 2026-10-30 dans le navigateur intégré ; les 19 audits et l'audit final n'ont pas pu les rejouer (403) ; aucune capture n'est conservée. Rejeu humain recommandé (≈ 2 à 3 h, lecture seule).
- **Chiffres de Turo issus d'un seul trajet** (A24-07) : trip fee (27,40 $ sur 116,28 $ net, 23,6 %) et protections (25,19 / 15,50 / 9,69 $ par jour) mesurés sur un seul véhicule (VEH-B), un trajet de 3 jours ; la non-linéarité du trip fee et les pourcentages généraux sont **INFÉRÉS** ; ils ne sont pas des paramètres de notre produit.
- **Parcours jamais observés** (A24-08) : trip réel (check-in, check-out, extension), réclamations et dommages, vérification KYC, tableau de bord hôte avec annonce, messagerie, wizard hôte après le VIN, desktop, application native, back-office : **documentés seulement** (centre d'aide) ; nos écrans de remise entre personnes, d'espace hôte, de litige et de KYC sont des conceptions nôtres.
- **Conception non exécutée** : aucun DDL de 17 n'a tourné (preuves L0 au lot 0) ; vitesse des agents et charge réelle du fondateur (19 §6.1) non mesurées ; offre d'hôtes particuliers non mesurée, avis juridiques, contrat d'assureur partenaire et PSP de place de marché non obtenus (OQ-MK-07, posée pour des agences, est sans objet).
