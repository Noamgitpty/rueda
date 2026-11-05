# Changelog

Toutes les modifications notables du projet « rueda » (marque Kmino) sont consignées ici. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), en français ; catégories : Ajouté, Modifié, Corrigé, Retiré, Obsolète, Sécurité. Les versions suivront [SemVer](https://semver.org/lang/fr/) à partir de la première mise en production.

- **Résumé pour le fondateur** : [`docs/NOTES_DE_VERSION.md`](docs/NOTES_DE_VERSION.md), en langage courant.
- **Pendant le développement**, chaque PR ajoute un fragment `changelog.d/<branche>.md` au lieu de modifier ce fichier (aucun conflit entre PR parallèles) ; le job CI `changelog` l'exige dès qu'une PR touche du code livré. Format et exemptions : [`changelog.d/README.md`](changelog.d/README.md), ADR-085.
- **À chaque mise en production**, l'orchestrateur verse les fragments ici (`node scripts/ci/changelog.mjs release --version x.y.z --date AAAA-MM-JJ`), sous une section de version, avec les numéros de PR.

Chaque entrée cite sa story (`US-xxx`) et sa demande de fusion (`#n`).

## [Non publié]

Aucune mise en production n'a encore eu lieu. Les entrées ci-dessous reconstituent l'historique de `main` au 2026-11-04 (75 PR fusionnées, la dernière étant la PR #75), d'après `git log --merges` et les titres des PR fusionnées ; les fragments de `changelog.d/` s'y ajoutent à la prochaine version.

### Lot L0 — Socle, preuves PostgreSQL et cœur sûr

#### Socle du dépôt et intégration continue

- Ajouté : monorepo pnpm + Turborepo, monolithe modulaire et conventions, avec les artefacts de coordination de l'équipe d'agents (US-001, US-029, #1)
- Ajouté : intégration continue GitHub Actions — qualité, base de données, oracles, revues, secrets, dépendances, diagrammes (US-002, #2)
- Ajouté : environnements, infrastructure as code et déploiement réversible (US-003, #73)
- Ajouté : sauvegardes hors compte, supervision et journal d'accès aux données personnelles (US-004, #76)
- Ajouté : guide d'installation depuis zéro avec docker compose, rejoué en CI, et README par module (US-035, #60)

#### Base de données et preuves L0

- Ajouté : banc PostgreSQL 16, rôles de production et horloge de la base `platform.now()` (US-005, #18)
- Ajouté : preuves L0-01, L0-03 et L0-08 — exclusion, ré-acquisition, triggers I-OCC, index uniques (US-006, #31)
- Ajouté : preuves L0-02 et L0-04 — concurrence, verrou par véhicule, plan de l'expiration (US-007, #40)
- Corrigé : tests L0 de concurrence robustes au budget de connexions (US-007, #51)
- Corrigé : cascade d'interblocages de l'injection L0-02 bornée (US-007, #54)
- Corrigé : mesure stable du p95 de C1 avec verrou (US-007, #71)
- Corrigé : trois instabilités de CI — injection L0-02, guide d'installation, `proto.test.tsx` (US-007, #74)
- Ajouté : outbox transactionnelle, événements et tâches planifiées (US-008, #34)
- Ajouté : journal d'audit chaîné, magasin de preuves et clés par sujet (US-009, #33)
- Sécurité : RLS par type d'acteur et par pays, commandes `SECURITY DEFINER` (US-011, #38)
- Corrigé : plan de `trip_staff_read` prouvé sans horloge murale (US-011, #47)
- Sécurité : rôle `P2P_HOST`, RLS de l'hôte, tables d'argent et minimisation des données du voyageur (US-062, #52)
- Ajouté : fuzz d'entrelacements C11 et oracle de production C12 (US-025, #58)
- Ajouté : tests de migrations et de données personnelles (US-046, #75)

#### Argent et règlement

- Ajouté : primitives monétaires `Money`, `roundHalfUp` et `allocHost` en unités mineures (US-015, #4)
- Ajouté : oracle indépendant et harnais des vecteurs dorés (US-016, #29)
- Ajouté : moteur de règlement des annulations, sous-ensemble bêta, écrit test d'abord (US-017, #37)
- Ajouté : règlements persistés, versions, supersession et jambes (US-018, #43)
- Ajouté : propriétés monétaires comparées à l'oracle et tests de mutation (US-042, #70)

#### Réservation

- Ajouté : table d'occupation unique — blocages de l'hôte, tampons, cloisonnement (US-022, #45)
- Ajouté : holds de checkout et commandes de réservation (US-023, #53)
- Ajouté : conversion gardée, ré-acquisition et compensation (US-024, #56)

#### Paiements et adaptateurs FAKE

- Ajouté : port `PaymentProvider`, adaptateur `FAKE` et idempotence (US-019, #42)
- Corrigé : détecteur de numéro de carte sans faux positif sur les identifiants `evt-<uuid>` (US-019, #48)
- Ajouté : autres ports et adaptateurs `FAKE` (US-020, #44)
- Ajouté : port `PaymentProvider` de place de marché — sous-marchands, jambes, versement — en `FAKE` normal et hostile (US-061, #55)

#### Comptes, sécurité et console interne

- Ajouté : comptes, sessions et port d'authentification (US-010, #35)
- Sécurité : console interne avec TOTP du staff, rôles et journal (US-012, #49)
- Sécurité : limitation de débit et anti-abus — OTP, SMS et e-mail, recherche publique, API (US-052, US-021, #65)
- Sécurité : tests de sécurité automatisés et matrice d'autorisations (US-043, #69)

#### Notifications

- Ajouté : moteur de notifications e-mail et SMS (US-021, #46)

#### Pays et langues

- Ajouté : configuration pays Panama et Paraguay en données (US-013, #32)
- Ajouté : internationalisation espagnol / anglais et formats (US-014, #3)
- Ajouté : français, troisième langue (US-014, #26)
- Ajouté : portugais du Brésil, quatrième langue (US-014, US-032, US-034, #61)

#### Design, marque et site web

- Ajouté : évaluation PWA sur iOS, page de test et protocole du fondateur (US-026, #5)
- Ajouté : naming et identité — Kmino, direction Señal, proposée (US-028, #8)
- Modifié : design Kmino blanc épuré Lienzo et maquettes P2P bilingues (US-028, #10)
- Ajouté : jetons de design comme source unique et thème (US-030, #30)
- Ajouté : règles de mouvement, de micro-interactions et de photos (US-031, #59)
- Ajouté : bibliothèque de composants vivante `@rueda/ui` et vitrine `/ui` (US-032, #41)
- Ajouté : socle de marque modifiable — thème versionné et contenus (US-034, #57)
- Ajouté : coquille web mobile-first et PWA installable (US-048, #62)
- Ajouté : prototype cliquable du parcours voyageur S01–S09, S15, S17 (US-033, #63)
- Ajouté : prototype de l'espace hôte A01–A13, console O01 et compte S14 (US-033, #68)

#### Tests et documentation

- Ajouté : tests de contrat d'API et e2e Playwright mobiles et PWA (US-041, #64)
- Ajouté : documentation d'architecture, d'API, de schéma et glossaire synchronisés par la CI (US-038, #72)
- Ajouté : inventaires des variables, des secrets et des comptes, contrôlés par la CI (US-037, #77)

#### Spécification P2P (révision des specs)

- Modifié : décisions et questions ouvertes (22) pour le modèle de particulier à particulier (US-053, #16)
- Modifié : règles d'argent (08) et vecteurs par jambe pour le modèle P2P (US-055, #19)
- Modifié : architecture (17 v6) pour le modèle P2P (US-056, #20)
- Modifié : UX (10b v3) pour le modèle P2P (US-059, #22)
- Modifié : périmètre, exigences produit et backlog pour le modèle P2P (US-054, US-057, US-058, #24)
- Modifié : CLAUDE.md, handoff et reliquats ; fin de la révision P2P des specs (US-060, #27)

#### Gouvernance de l'équipe d'agents

- Ajouté : règles de revue — paquets money et i18n, revues requises par story (US-050, #6)
- Modifié : registre — EXC-001 tranchée, BOARD et RESUME_HERE après les PR #1 à #6 (#7)
- Modifié : registre — F-01 tranchée, compte machine Projetapploccar (#9)
- Modifié : pivot P2P — analyse d'impact, DEC-FONDATEUR-13/14, Q-002 à Q-004 tranchées (#11)
- Modifié : check-reviews reconnaît les alias `revue-<rôle>` comme relecteurs (US-050, #12)
- Modifié : Tinta (révisable), DEC-FONDATEUR-15 (fusion autonome) et 16 (débloquer comme Turo) (#13)
- Ajouté : revues des stories de révision P2P des specs US-053 à US-060 (US-050, #14)
- Modifié : exclusion de la fusion autonome pour la CI et les scripts de contrôle (#15)
- Sécurité : contrôle des revues durci — revue périmée, relecteur auteur, scripts pris sur la base (US-050, #17)
- Modifié : registre des oracles en données (`docs/specs/tools/registry.json`) ; COMME_TURO partagé (US-050, #21)
- Modifié : fusion autonome de toutes les PR, décision du fondateur (#23)
- Modifié : DEC-FONDATEUR-17, produit trilingue es / en / fr (#25)
- Ajouté : revues exigées et propriétaires des paquets du lot 0 (US-050, #28)
- Modifié : stories avec textes visibles propriétaires de `packages/i18n` (US-050, #36)
- Modifié : stories qui ajoutent des règles de lint propriétaires de `packages/config` (US-050, #39)
- Modifié : US-012 propriétaire de `packages/db` (US-050, #50)
