# RESUME_HERE — Point de reprise de la mission

> Lire ce fichier EN PREMIER à chaque nouvelle session. Puis `23_RESEARCH_LOG.md` (dernières entrées) et `21_COVERAGE_MATRIX.csv`.

## DOSSIER FINAL, PRÊT POUR LE LOT 0 SOUS CONDITIONS (2026-10-30, après l'audit 24 et ses corrections) — À LIRE EN PRIORITÉ

**Statut** : audit contradictoire final `24_FINAL_AUDIT_AND_GAPS.md` fait (0 CRITIQUE, 12 MAJEUR, 13 MINEUR) ; corrections appliquées et suivies dans sa section « Suivi des corrections » ; les 18 scripts de `tools/` passent (`python -I -X utf8`, 00_README §4). Point d'entrée du build : `CLAUDE_BUILD_HANDOFF.md` (§12, avec §4.9 mécanique Claude Code et §4.10 identité GitHub). Fondateur : `01_EXECUTIVE_SUMMARY.md` (§9 charge estimée).

**Conditions avant de lancer le lot 0 (actions du fondateur)** : F-15 (budget IA, famille B) ; F-01 (organisation GitHub, compte machine des agents, plan GitHub) ; poste Windows (WSL 2 + Docker Desktop ou PostgreSQL 16 natif, pnpm, gh) ; validation de sa disponibilité réelle (19 §6.1 : 15–25 h / semaine au démarrage).

**Lacunes réelles restantes (aucune recherche documentaire ne les lève)** :
1. Avis juridiques PA / PY (art. 288, casa de remesas, statut PSP, données, CGU) et **F-21 / OQ-MK-10** : reprise fonctionnelle des règles de Turo et méthode de recherche (lecture en masse de help.turo.com = zone grise) ; devis pendant le lot 0, avis avant la mise en service.
2. Viabilité commerciale (OQ-MK-07) : 10 à 20 entretiens de loueurs pendant le lot 0 ; G0 au premier point après le lot 0 (coût d'un G0 négatif ≈ 111 jours-agent).
3. Exécution de PostgreSQL : preuves L0-01..L0-10 jamais exécutées.
4. PSP réel (après DEC-PAYS), assurance (attestations des polices, F-18), garantie en cas de défaillance d'agence (OQ-MK-11, EC-57).
5. PWA iOS sur appareils réels (US-026).
6. Observations de Turo non rejouées par un tiers ; chiffres de Turo issus d'un seul trajet ; trip réel, réclamation, KYC, desktop et app native jamais observés (rejeu humain facultatif ≈ 2–3 h).
7. Vitesse des agents, coût d'usage et charge réelle du fondateur : mesurés seulement à US-027.

## (historique) ÉTAT AU 2026-10-30 après la passe du rédacteur technique final, avant l'audit 24

**Dossier** : `C:/Users/noamm/Documents/turo-audit-latam/research/turo-audit/`. Organisation, statuts et commandes : **`00_README.md`**. Pour construire : **`CLAUDE_BUILD_HANDOFF.md`**. Pour le fondateur : **`01_EXECUTIVE_SUMMARY.md`**.

**Fait (tous audités au moins une fois, sauf les trois fichiers d'entrée créés le 2026-10-30)** :
- Recherche : 02, 03, 05, 06, 09, 09b, 10, 11, 12, 13, 14, 15, `sources/` (dont SRC_VEHICLE_DATA, note d'alignement sur 17 ajoutée), 20, 21 (lignes `FINAL-*` : statut final par epic E0–E18 et par domaine).
- Spécification : 04 rév. 5 (676 lignes ; HST-050 lié à BR-LIST-04), 08 (règles, E1–E6, SM-1..SM-8, T01–T68), 10b v2 (m5 de VERIF_19 appliqué), 16 v4, 17 v5, 18 v4, 19 v2 (178 stories, 853 pts), 22 (DEC-FONDATEUR-02..10 prises ; décisions ouvertes avec défaut et échéance).
- Audits VERIF_01 à VERIF_19 traités (`verification/VERIFICATION_LOG.md`).
- Contrôles : tous les scripts de `tools/` passent avec `python -I -X utf8` (liste et résultats attendus : 00_README §4). `tools/verif19_backlog.py` a reçu une mise à jour **structurelle uniquement** (totaux lus dans 19 §7, stories déplacées de 19 §1.1 acceptées) → 0 erreur.
- Nouveaux fichiers d'entrée : `00_README.md`, `01_EXECUTIVE_SUMMARY.md`, `CLAUDE_BUILD_HANDOFF.md`.

**Décisions du fondateur** : prises = DEC-FONDATEUR-02 à 10 ; **en attente** (défauts codés, ne jamais trancher à sa place) = DEC-FONDATEUR-01, OQ-BR-04, OQ-BR-45, OQ-MK-07, DEC-PAYS (pays de lancement, avant le lot C), DEC-MARQUE, UXQ-02/03/04/07/08/09/10/12, J-ADM-031, DEC-NATIVE (22).

**Reste à faire** :
1. **Audit contradictoire final** `24_FINAL_AUDIT_AND_GAPS.md` par un agent indépendant (autre modèle de préférence) sur tout le dossier, en priorité 00, 01 et `CLAUDE_BUILD_HANDOFF.md` (non encore audités), et les incohérences résiduelles listées en HANDOFF §10 point 8 (G0 avant / après le lot 0 entre 18 §4 et 22 ; 17 §6.2 PWA « en attente » contre ADR-039 ; 19 §4.2 « LC 49 points » contre 52 en §7).
2. **Appliquer ses corrections** (avec rejeu de tous les contrôles de 00_README §4) et mettre à jour ce fichier, 23 et 21.
3. Ensuite : le build démarre selon `CLAUDE_BUILD_HANDOFF.md` §12 (actions fondateur préalables : F-15, F-01, poste Windows : WSL 2 + Docker Desktop, pnpm, GitHub CLI).

## (historique) ÉTAT AU 2026-10-30 (fin de journée, avant la passe finale)
Dossier projet : `C:/Users/noamm/Documents/turo-audit-latam/research/turo-audit/` (déplacé depuis le dossier temporaire de la session).

Livrables existants (tous audités au moins une fois — voir `verification/VERIFICATION_LOG.md`) :
- 02 méthodologie · 03 sitemap · 04 inventaire (649 lignes, colonne `phase_mvp` P0-A/P0-B/P1–P3) + README + `tools/check_inventory.py`
- 05/06 parcours guest/host (observations directes) · 08 règles métier (~200 règles ; BR-CXL + « Exécution monétaire » E1–E6 ; machines à états SM-1..SM-8 ; tests T01–T65)
- 09 pricing · 09b partenaires de paiement PA/PY · 10 assurance/trust · 11 edge cases (57 depuis EC-57) · 12 Panama (matrice go/no-go, GO CONDITIONNEL) · 13 Paraguay · 14 concurrence · 15 améliorations (49 idées) · 18 MVP & roadmap v1 · 20 preuves · 21 couverture · 22 questions ouvertes · 23 journal
- `tools/` : `verif11_settlement.py` (indépendant, 48/48), `independent_settlement_check.py`, `check_t49plus.py` (à revérifier, VERIF_12), `verify_cxl_tests.py` (déclassé : n'asserte rien)


DÉCISIONS PRISES PAR LE FONDATEUR (2026-10-30) :
- DEC-FONDATEUR-02 : développer d'abord ; avis juridiques avant la mise en ligne avec de vrais clients (pas avant le build).
- DEC-FONDATEUR-03 : paiements réels reportés jusqu'au choix du pays ; tout le reste se développe contre l'abstraction PaymentProvider avec un adaptateur factice ; pays = configuration (Panama/Paraguay).
- DEC-FONDATEUR-10 : autonomie maximale des agents, communication par artefacts versionnés, escalade minimale avec valeurs par défaut, un point fondateur hebdomadaire, rigueur mission critique (double revue, red-team, pré/post-mortem).
- DEC-FONDATEUR-09 : tests exhaustifs unitaires/intégration/E2E/parcours complets PA+PY/concurrence/sécurité/accessibilité/visuel/charge/résilience ; portes CI bloquantes ; agent QA indépendant.
- DEC-FONDATEUR-08 : transmissibilité totale (documentation maximale, portabilité cloud, comptes au nom du fondateur, checklist de passation) ; « doc à jour » dans la DoD de chaque story.
- DEC-FONDATEUR-07 : design modifiable à tout moment par le fondateur (tokens pilotés par données, back-office Apparence/Marque avec prévisualisation, publication et retour arrière). Pas encore de nom de marque. À reporter dans 04/16/17.
- DEC-FONDATEUR-06 : agent DESIGN dédié + relecteur UX/design indépendant ; web mobile-first + PWA dans le MVP ; apps natives plus tard.
- DEC-FONDATEUR-05 : AUCUN développeur humain ; développement 100 % Claude Code en équipe multi-agents (orchestrateur + implémentation + vérificateurs indépendants) ; le fondateur = product owner, recette, comptes, juridique.
- DEC-FONDATEUR-04 : Panama ET Paraguay développés simultanément dès le départ (deux configurations de premier rang, tests USD et PYG).

Décisions fondateur EN ATTENTE (ne jamais trancher à sa place) :
- DEC-FONDATEUR-01 : la plateforme indemnise-t-elle l'hôte quand l'annulation vient d'elle ? (paramètre par défaut = false)
- OQ-BR-04 : retard vs extension (proposition : frontière de jour à +2 h ; frais de retard ≥ coût d'extension)
- Pays : Panama GO CONDITIONNEL (avis art. 288 + casa de remesas) ; bascule Paraguay si avis négatif.

En cours à la fin de la session :
- Correction VERIF_10 sur 18/04/15/22 : estimation unique (P0-A = 21–42 semaines-équipe = 2 devs dont 1 senior + 0,5 produit/QA avec Claude Code, hors délais externes) ; « Bêta pilote » mince ; avis juridique avant le gros du build ; ajouts Ley 81, mandat agences, support, sécurité, préprod, PWA iOS.
- VERIF_12 : contre-vérification indépendante des tests T49–T65.

Consolidation en attente : reporter dans 04 les changements listés en 10b §7 et 17 Annexe A (voir 23, dernière ligne [Consolidation à faire]).
Nouveaux livrables : 10b UX v2 (audité VERIF_13, corrigé), 17 architecture v1 (audit VERIF_14 en cours). 16 PRD en rédaction.
Reste à produire : 16_PRODUCT_REQUIREMENTS_DOCUMENT (fiches FEATURE au format imposé, au moins P0-A/P0-B), 17_DATA_MODEL_AND_ARCHITECTURE, 19_DEVELOPMENT_BACKLOG (epics, user stories, critères), analyse UX, 00_README, 01_EXECUTIVE_SUMMARY, 24_FINAL_AUDIT_AND_GAPS (audit contradictoire final), CLAUDE_BUILD_HANDOFF.md — chacun audité par un agent indépendant (règle utilisateur ; alterner les modèles, ex. Sonnet).
Règles permanentes : aucun contournement de blocage (turo.com renvoie 403 aux agents) ; aucune donnée personnelle de tiers ; aucune action engageante sur le compte Turo de l'utilisateur.

## Objectif de la mission
Reverse engineering fonctionnel exhaustif de Turo (turo.com) pour concevoir une marketplace de location de véhicules entre particuliers/pros en Amérique latine (lancement : Panama, Paraguay). Livrables = base de connaissances + spécifications exploitables directement par une future session Claude Code (cf. `CLAUDE_BUILD_HANDOFF.md`). AUCUN code applicatif à ce stade.

## Contraintes non négociables
- Pas de réservation payante, pas d'annonce publique réelle, pas de contact avec d'autres utilisateurs, pas de modification de paramètres sensibles du compte, pas d'acceptation d'engagement juridique/financier sans accord explicite de l'utilisateur.
- Ne jamais contourner de protection technique. Ne pas collecter de données personnelles de tiers (noms d'hôtes, photos de profil, etc. → anonymiser).
- Statuts de preuve stricts : DIRECTEMENT TESTÉ / OBSERVÉ / DOCUMENTÉ / INFÉRÉ / PROPOSÉ / BLOQUÉ / NON EXPLORÉ.
- Rédaction en français.

## Environnement
- Navigateur : navigateur intégré de l'app Claude (outils `mcp__Claude_Browser__*`). L'utilisateur se connecte lui-même à son compte Turo dans ce navigateur (session persistante).
- Claude in Chrome également disponible mais non utilisé (choix : navigateur intégré).
- Turo affiché par défaut : https://turo.com/us/en (marché US). Autres marchés : AU, CA (EN/FR), FR, UK.

## Phases
| # | Phase | Statut |
|---|---|---|
| 0 | Setup, accès navigateur, structure dossiers | TERMINÉ (2026-10-30) |
| 1 | Cartographie initiale (sitemap public) | TERMINÉ (base) |
| 2 | Parcours locataire (public puis connecté) | EN COURS — public quasi fait ; connecté fait (menu, account, trips vides, inbox, notifications, favoris, profil) ; pas de trip réel |
| 3 | Parcours propriétaire (host) | EN COURS — pages publiques faites ; wizard 9 étapes relevé, arrêt à l étape VIN (VIN réel nécessaire) |
| 4 | Règles métier, documentation officielle, edge cases | FAIT (08 : 197 règles + 6 machines à états ; 11 : 53 cas ; 22 : 35 questions) — audit VERIF_04 en cours |
| 5 | Marchés Panama / Paraguay | FAIT + corrigé (VERIF_02) ; 14 créé ; recommandation provisoire PANAMA pro-first — audit VERIF_05 en cours |
| 6 | Améliorations produit (≥30 idées) | EN COURS (agent) + 04_FEATURE_INVENTORY en cours (agent) |
| 7 | PRD, architecture, data model, roadmap, backlog | NON COMMENCÉ |
| 8 | Audit contradictoire + rapport final + CLAUDE_BUILD_HANDOFF | NON COMMENCÉ |

## Pages explorées
Voir `03_SITEMAP_AND_NAVIGATION.md` et `20_EVIDENCE_REGISTER.csv`.

## Blocages
- Connexion OK (2026-10-30). Wizard annonce bloqué à l étape VIN : besoin d un VIN réel de l utilisateur (sans soumission finale) ou documentation help center.

## Fichiers produits à ce stade
02, 03, 05, 06, 08 (BR-CXL complet), 09, 10, 12, 13, 20, 21, 23, sources/SRC_COMPETITORS.md, sources/SRC_TOS_NOTES.md (CGU US lues intégralement par sections) (+ en attente d'agents : sources/SRC_GUEST_DOCS.md, sources/SRC_HOST_DOCS.md).
Pages légales lues : terms, cancellation, additional-policies, turotravels, community-guidelines. Restent : privacy, nondiscrimination, promotional-credit (gift cards), protection plans incorporés (US guest/host).

## Vérifications
Voir verification/VERIFICATION_LOG.md (VERIF_01..03 traités ; 04, 05 en cours). Règle utilisateur : tout livrable est audité par un agent indépendant avant d'être considéré fiable.

## Prochaine action précise (mise à jour)
1. Traiter VERIF_04 (règles/edge cases) et VERIF_05 (décision pays).
2. Auditer 04 et 15 à leur retour.
3. Puis Phase 7 : 16 PRD (fiches FEATURE au format imposé), 17 data model & architecture, 18 roadmap, 19 backlog ; puis 10 UX (analyse UX dans 05/16), 01, 00, 24, CLAUDE_BUILD_HANDOFF.md.

## (ancienne) Prochaine action précise
1. Intégrer les rapports des agents (guest docs, host docs, Panama) dans 08/09/10/11.
2. Fiche véhicule : ouvrir modales (photos, annulation, assurance, report listing, livraison).
3. Tester recherche aéroport + mensuel + dates flexibles ; layout desktop.
4. Dès que l'utilisateur est connecté : menu compte, profil, paramètres, favoris, messagerie, trips (lecture seule) ; flux list-your-car jusqu'avant publication.
5. Puis : 08 règles métier, 11 edge cases, 15 améliorations, 16 PRD, 17 architecture, 18/19 roadmap/backlog, CLAUDE_BUILD_HANDOFF.md.
