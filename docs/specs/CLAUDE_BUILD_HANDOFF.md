# CLAUDE_BUILD_HANDOFF — Point d'entrée de la session de développement

> **Pour qui** : une nouvelle session Claude Code (sans aucune mémoire de la recherche) ou un développeur humain qui reprend. **Lire ce fichier en entier, puis suivre le §12 « Script de la première session ».**
> **Date** : 2026-10-30 ; **révision P2P du 2026-11-03** (US-060, demande de fusion S8 de `docs/team/impact/2026-11-02-pivot-p2p.md` : §1, §2, §3, §4.1 et §9 ; les autres sections gardent leur texte du 2026-10-30 et se lisent avec la règle de lecture du §1). **Statut** : PROPOSÉ, **audité (24)** et corrigé (24 « Suivi des corrections »). Ce document **n'invente rien** : il assemble et rend opérationnels 17 v6, 19 v3, 22, 18 v5, 16 v5, 10b v3 et 08 révisée (US-055) ; chaque règle renvoie à sa source, qui fait foi en cas d'écart. Ce qui est propre à ce document (chemins de fichiers d'équipe, gabarits, noms de commandes, prérequis du poste) est marqué **PROPOSÉ (handoff)** : l'orchestrateur le fige par un ADR dans le dépôt dès la première session.
> **Dossier de spécification** : `C:/Users/noamm/Documents/turo-audit-latam/research/turo-audit/` (appelé « dossier » ci-dessous ; voir `00_README.md`).

---

## 1. Mission et contraintes

**Mission.** Construire une place de marché de location de voitures **de particulier à particulier**, comme Turo, pour le **Panama** et le **Paraguay** : la **bêta P2P** (lots 0 à 5 révisés de 19 v3 ; tranche construite = lots 0 à 4), puis le **lot C** des connecteurs réels après le choix du pays et la **porte go / no-go du PSP de place de marché** (19 §2, US-603 ; 18 v5 §0). Modèle (DEC-FONDATEUR-13, 14) : **hôtes particuliers uniquement, aucune agence ni loueur professionnel** ; par défaut **comme Turo** (trip fee, plans de protection vendus par Kmino pour un assureur partenaire, part de l'hôte selon son plan, 08) ; le voyageur paie **Kmino, marchand de référence** ; un PSP de place de marché, **uniquement en `FAKE`** jusqu'au lot C, répartit chaque paiement en **jambes explicites** (`HOST`, `INSURER`, `TAX_THIRD_PARTY`, `PLATFORM`) calculées par le règlement (08 E7) ; l'hôte est versé après le trajet ; **aucun fonds de tiers détenu** : vrai en build et en `FAKE`, et en production tant que `funds_holding_enabled[pays]` vaut `false` (17 §0.1) ; remise et retour **entre personnes**, sur un lieu déclaré par l'hôte ; web mobile-first + PWA (ADR-039), **trilingue es / en / fr** (DEC-FONDATEUR-11 et 17).

**Règle de lecture** (pivot P2P) : toute mention restante d'agence, de loueur, de comptoir, de commission d'agence, de « Bêta pilote », de P0-A ou de P0-B dans les sections non révisées de ce fichier est **historique et hors produit** (DEC-FONDATEUR-13) ; « Bêta pilote » et « P0-A » se lisent « bêta P2P » ; « P0-B » se lit « fonction construite, fermée en production par un interrupteur par pays » (17 §0.1) ; « es / en » se lit « es / en / fr » (DEC-FONDATEUR-17).

**Contraintes non négociables** (sources entre parenthèses) :
1. **Aucun développeur humain** : équipe d'agents Claude Code ; le fondateur est le seul humain (product owner, recette, comptes, juridique) (DEC-FONDATEUR-05, 19 §1.5).
2. **Aucune fusion sans revues indépendantes** ; argent, RLS / rôles, `SECURITY DEFINER` et concurrence revus par une **autre famille de modèle** (19 §1.4 point 4, §1.9 point 4). L'orchestrateur fusionne seul **seulement si** toute la CI est verte et toutes les revues exigées sont APPROUVÉ ; jamais de push direct sur `main`, jamais de force-push (DEC-FONDATEUR-15, `docs/team/DECISIONS.md`).
3. **Aucun PSP réel avant le lot C** ; tout passe par les ports et des adaptateurs `FAKE`, **jamais actifs en production** (DEC-FONDATEUR-03, ADR-032, test C19).
4. **Deux pays de premier rang dès le premier jour** ; aucune constante propre à un pays dans le code ; tests en USD (PA) et en PYG sans décimale (PY) (DEC-FONDATEUR-04, ADR-024, ADR-033).
5. **Argent** en `bigint` d'unités mineures, `roundHalfUp` / `allocHost` uniques, règlement = fonction pure versionnée qui calcule **chaque jambe** ; toute commande vers le PSP porte le montant explicite de chaque jambe, jamais un prorata ; une capacité PSP inconnue vaut « non », une capacité **bloquante** inconnue rend l'hôte non activable (ADR-009, ADR-010, ADR-045, 08 E7, 17 §2.8, 19 §1.7).
6. **Réservation** : écritures par **commandes seulement** (ADR-035), occupation unique + contrainte d'exclusion GiST + conversion gardée (ADR-002), horloge = base (`platform.now()`, ADR-030) ; RLS `ENABLE` + `FORCE` sur toutes les tables ; aucun rôle applicatif `BYPASSRLS` (17 §2.3, ADR-027).
7. **Aucun secret de production chez les agents**, aucune donnée réelle dans un environnement accessible aux agents (19 §1.9 point 1).
8. **Aucune décision du fondateur prise à sa place** : coder la valeur par défaut fail-closed de 22, la marquer PROPOSÉ, continuer (22, DEC-FONDATEUR-10). Les **interrupteurs de mise en service par pays** (`p2p_private_hosts_enabled`, `insurer_contract_active`, `funds_holding_enabled`, `payouts_enabled`) valent `false` en production ; ils ne changent que sur décision écrite du fondateur, par la commande à deux personnes `config.cmd_request_go_live_switch` puis `config.cmd_approve_go_live_switch` (17 §0.1, ADR-046, RLS-27), **jamais par du code ni par un agent** ; la procédure de bascule (runbook PLT-003) s'écrit avec la story qui construit ces commandes.
9. **Documentation à jour dans la DoD de chaque story** ; comptes externes au nom du fondateur (DEC-FONDATEUR-08, 19 §1.4 point 6) ; tout texte visible livré **en es, en et fr** dans la même story (catalogue 10b §4.3, DEC-FONDATEUR-17).
10. **Comme Turo, sans copier Turo** : une question produit propre au P2P se tranche par la solution de Turo adaptée au PA / PY, marquée PROPOSÉ et inscrite dans `docs/team/COMME_TURO.md` (DEC-FONDATEUR-14, 16) ; aucune reprise de l'identité visuelle, des textes ou des données de Turo ; aucune aspiration de Turo, d'annonces ou de sites constructeurs (02, 17 ADR-034, `sources/SRC_VEHICLE_DATA.md`).
11. Les tests réduisent le risque **sans prouver l'absence de bug** : supervision, oracle de production C12 et triage après la mise en service (19 §1.8).

---

## 2. Carte des documents : qui fait foi pour quoi

| Sujet | Document qui fait foi | Quand le lire |
|---|---|---|
| **Règles métier, montants, trip fee, plans de protection, part de l'hôte, jambes, machines à états, vecteurs T01–T68 et TJ01–TJ21** | `08_BUSINESS_RULES.md` (BR-*, E1–E7, SM-1 à SM-8) | toute story qui calcule, rembourse, annule, change un état |
| **Architecture, modules, entités, RLS, paramètres, ADR, preuves L0, tests, gouvernance** | `17_DATA_MODEL_AND_ARCHITECTURE.md` v6 (§0.1 argent et interrupteurs, §2.3 rôles / RLS, §2.5 verrouillage, §3.2 entités, §4 événements, §6 pile, §7.2 paramètres, §8.1 ADR, §10 coupe de la bêta P2P, §11 L0, §12 tests, §13 gouvernance) | avant toute story ; noms d'entités et de paramètres |
| **Fonctionnalités, critères Given / When / Then, codes d'erreur, NFR, vecteurs TA01–TA11** | `16_PRODUCT_REQUIREMENTS_DOCUMENT.md` v5 (partie A, fiches partie B, matrice D.1) | la fiche de chaque feature citée par la story |
| **Ordre de construction, stories, DoR / DoD, modèle d'équipe, règles d'exploitation, portes de lot, tâches fondateur** | `19_DEVELOPMENT_BACKLOG.md` v3 (§1.1–§1.10, §2, §3, §4, §5, §6, §7) | en continu |
| **Décisions ouvertes, valeurs par défaut, échéances** | `22_OPEN_QUESTIONS.md` (« Décisions fondateur / produit en attente », « Décisions prises », « Pivot P2P » : OQ-P2P-01 à 12) ; choix « comme Turo » dans `docs/team/COMME_TURO.md` | avant toute story « Bloqué par (défaut) » |
| **Périmètre** (quelles lignes, phase, lot, tranche bêta) | `04_FEATURE_INVENTORY.csv` rév. 6 + README | pour vérifier une ligne |
| **UX, écrans, textes es / en / fr, accessibilité, fondations design** | `10b_UX_UI_ANALYSIS.md` v3 (§3 principes UX, §4 écrans S/A/O de la bêta P2P, §4.3 catalogue des textes, §8 design) | toute story « Revue design : OUI » |
| MVP, préconditions de mise en service, effort, risques | `18_MVP_AND_ROADMAP.md` v5 (§1, §3, §4, §5.0, §7, §11) | contexte, rapport L0 (US-027) |
| Cas limites | `11_EDGE_CASES_AND_FAILURES.md` (EC-xx) | tests de bord |
| Paiement PA / PY (contexte du lot C) | `09b_PAYMENT_PARTNERS_PA_PY.md` | lot C, `FAKE` à capacités simulées |
| Marchés, concurrence | 12, 13, 14 | contexte seulement |

**Règle d'arbitrage** : un écart entre ces documents se tranche par l'orchestrateur **avant** le code, est noté dans le document qui fait foi (et au registre des décisions du dépôt), jamais résolu silencieusement dans le code (19 §1.3 point 2).

---

## 3. Décisions du fondateur en vigueur

**Prises (2026-10-30 à 2026-11-03, 22 « Décisions prises » et `docs/team/DECISIONS.md` §1)** :

| ID | Contenu opérationnel |
|---|---|
| DEC-FONDATEUR-02 | construire d'abord ; les avis juridiques conditionnent la **mise en service**, pas le build ; comportements dépendant d'un avis construits en mode prudent paramétré |
| DEC-FONDATEUR-03 | PSP réel après le choix du pays ; build contre `PaymentProvider` + `FAKE` (webhooks signés, refus, réponses inconnues, ordres Yappy de 300 s, capacités présentes / absentes) |
| DEC-FONDATEUR-04 | PA et PY en parallèle : USD / PYG, `America/Panama` / `America/Asuncion`, ITBMS 7 % / IVA 10 % datés en paramètres, es / en / fr (DEC-FONDATEUR-17) |
| DEC-FONDATEUR-05 | aucun développeur humain ; équipe multi-agents ; aucune fusion sans revue indépendante |
| DEC-FONDATEUR-06 | agent DESIGN + relecteur UX indépendant ; web mobile-first + PWA ; pas d'app native au MVP |
| DEC-FONDATEUR-07 | design modifiable par le fondateur : jetons pilotés par les données, back-office « Apparence / Marque » (brouillon, publication, historique, retour arrière), blocs de contenu es / en / fr |
| DEC-FONDATEUR-08 | transmissibilité totale : IaC, conteneurs, ports, comptes au nom du fondateur, runbooks, export, checklist de passation, doc dans la DoD |
| DEC-FONDATEUR-09 | tests exhaustifs, portes CI bloquantes, agent QA indépendant, régression nocturne |
| DEC-FONDATEUR-10 | autonomie maximale, artefacts versionnés, escalade minimale avec défauts, point hebdomadaire, rigueur mission critique |
| DEC-FONDATEUR-11 | produit bilingue es / en, livré ensemble dans chaque story ; complété par DEC-FONDATEUR-17 |
| DEC-FONDATEUR-12 | positionnement visible de place de marché de particulier à particulier ; Kmino n'apparaît jamais comme un loueur |
| DEC-FONDATEUR-13 | P2P dès la bêta, **aucune agence**, hôtes particuliers uniquement ; modèle économique de Turo (08) ; assurance par contrat Kmino avec un assureur partenaire ; avis juridiques avant la mise en service |
| DEC-FONDATEUR-14 | **faire comme Turo** par défaut ; seuls contrats, dépenses et juridique vont au fondateur ; parcours d'argent de Turo, montage par PSP de place de marché en `FAKE` |
| DEC-FONDATEUR-15 | fusion autonome par l'orchestrateur de **toutes** les PR, seulement si toute la CI est verte et toutes les revues exigées APPROUVÉ ; garde-fous compensatoires pour `.github/`, `scripts/ci/`, `scripts/team/` et `review-requirements.json` (revue sécurité au SHA fusionné, job `revues` vérifié dans le diff) ; jamais de push direct, de force-push ni d'interrupteur passé à `true` |
| DEC-FONDATEUR-16 | ne jamais rester bloqué sur une question propre au P2P : solution de Turo adaptée, marquée PROPOSÉ, inscrite dans `docs/team/COMME_TURO.md` |
| DEC-FONDATEUR-17 | produit **trilingue** es / en / fr livré ensemble dans chaque story (catalogues `es`, `en`, `fr` de `packages/i18n`, maquettes, notifications) ; textes juridiques français relus par l'avocat avant la mise en service |

**En attente** : liste et défauts au §9 (copie de 22, qui fait foi). DEC-FONDATEUR-01 reste ouverte (§9).

---

## 4. Modèle d'exploitation de l'équipe d'agents

### 4.1 Rôles (19 §1.5, 17 §13)

| Rôle | Responsabilités | Ne fait jamais |
|---|---|---|
| **Orchestrateur (tech lead)** | lit le backlog ; vérifie la DoR ; découpe ; assigne ; crée branche + worktree par story ; exige les revues ; **seul à fusionner**, sans accord PR par PR, si toute la CI est verte et toutes les revues exigées APPROUVÉ (DEC-FONDATEUR-15) ; tient tableau, registre des décisions et des risques ; répond aux questions entre agents ; prépare le point hebdomadaire (démo + ≤ 5 décisions) ; déclenche les déploiements par le pipeline (§4.7) ; écrit le rapport de santé de chaque session ; limite le parallélisme à ce que vérificateurs, budget et fondateur absorbent | fusionner sans les revues ; trancher une décision du fondateur ; détenir un secret de production |
| **Agent back-end** | modules NestJS, commandes, travailleurs pg-boss, ports et adaptateurs | modifier RLS ou rôles sans revue sécurité |
| **Agent données / base** | schéma, migrations SQL, contraintes, RLS, fonctions `SECURITY DEFINER`, preuves L0, tests de concurrence | écrire du SQL métier avec `now()` |
| **Agent front-end** | Next.js (voyageur, espace hôte mobile, back-office), PWA, i18n es / en / fr | créer un composant hors bibliothèque sans l'agent design |
| **Agent intégrations** | adaptateurs `FAKE` (normal et hostile), puis connecteurs réels au lot C | activer un connecteur réel avant LC |
| **Agent DESIGN** | naming et identité (propositions), jetons, bibliothèque de composants, maquettes avant implémentation, mouvement, règles photo ; ne copie pas Turo | valider seul son travail |
| **Vérificateurs indépendants** | revue de code ; **QA** (écrit les tests d'acceptation depuis 16 sans lire d'abord l'implémentation) ; **sécurité** ; **argent** (recalcule avec l'oracle, invariants E1–E7 et jambes) ; **architecture** ; **UX / design** (WCAG 2.2 AA, 360 px, PWA, textes es, en et fr) | réécrire la story ; utiliser le code testé comme oracle |
| **Red team** | attaque à chaque porte de lot (abus, fraude P2P, IDOR entre hôtes, jambes et interrupteurs contournés, données personnelles) ; lecture seule | corriger lui-même |
| **Fondateur (humain)** | décisions (§9), comptes et secrets (19 §6), acceptation, juridique, identité et écrans clés | coder |

### 4.2 Familles de modèles (19 §1.9 point 4 ; paramètres `team.model.*`)

- **Famille A** (Claude, modèle le plus capable disponible dans Claude Code) : orchestrateur, implémentation, design ; revues ordinaires par une **autre instance sans contexte partagé** (de préférence un autre modèle de la famille).
- **Famille B** (modèle d'un **autre fournisseur**, choisi au lot 0 par l'orchestrateur, approuvé par le fondateur, budget F-15) : vérificateurs **argent**, **sécurité RLS / rôles / `SECURITY DEFINER`**, **concurrence** (US-011, US-022 à US-025, US-043), re-vérification avant production (US-408), red team. Invoquée comme **job de CI** sur la demande de fusion ; clé d'API = secret de CI que les agents ne lisent pas.
- **Famille B indisponible** : revue par un autre modèle de la famille A, marquée « revue dégradée » au registre ; fusion possible pour la préproduction seulement ; revue B **rejouée avant toute production** ; au-delà de 5 jours ouvrés, escalade au point hebdomadaire.
- L'**oracle** (US-016) est écrit par un agent distinct de celui du moteur (US-017) et recoupé avec les scripts Python de `tools/`.

### 4.3 Cycle d'une story (19 §1.5, §1.3, §1.4)

1. **DoR** (orchestrateur) : dépendances fusionnées ; critères cohérents avec 16 ; vecteurs existants (variantes PYG produites par l'oracle et reportées dans 08) ; entités nommées dans 17 §3.2 ; défaut codé et nom de paramètre pour chaque décision ouverte ; maquette approuvée si UI ; tâches fondateur préalables faites.
2. **Branche et worktree** (PROPOSÉ (handoff), conventions fixées par US-001) :
   ```bash
   git switch main && git pull --ff-only
   git worktree add ../wt/US-006 -b story/US-006-preuves-l0-01-03-08 main
   # ... travail dans ../wt/US-006, commits fréquents poussés sur la branche
   git push -u origin story/US-006-preuves-l0-01-03-08
   # après fusion par l'orchestrateur :
   git worktree remove ../wt/US-006 && git branch -d story/US-006-preuves-l0-01-03-08
   ```
   Un worktree et une branche par story ; **jamais deux agents sur la même migration** ; chaque commit porte en pied le rôle et le modèle (`Agent-Role: back-end`, `Agent-Model: <modèle>`), 19 §1.9 point 6.
3. **Maquette** (agent design) si `Revue design : OUI`.
4. **Implémentation + tests** : unitaires, intégration sur **PostgreSQL réel en conteneur**, **tests sous les rôles de production** (`app_api`, `app_worker`, `app_anon` ; jamais `migrator` ni superutilisateur ; assertion L0-05 en tête), variantes PA et PY, `FAKE` normal et hostile.
5. **Revues indépendantes** jointes à la demande de fusion : code, QA, architecture ; + argent (famille B) si un montant bouge ; + sécurité (famille B pour RLS / rôles / `SECURITY DEFINER` / concurrence) ; + design si visible. Écarts → retour à l'étape 4.
6. **Fusion** par l'orchestrateur (portes CI vertes, rapports joints, CODEOWNERS), déploiement automatique en **préproduction**.
7. **Démo et acceptation** du fondateur au point hebdomadaire (story visible) ou rapport de tests lisible (story technique).
8. **Note de passation** et documentation à jour (DoD point 6).

### 4.4 Artefacts entre agents (seul canal ; tout dans le dépôt)

19 fixe le dossier `docs/team/`, `docs/team/OPERATING_RULES.md`, `docs/team/RESUME_HERE.md` et `docs/team/sessions/` ; les autres chemins et les gabarits ci-dessous sont **PROPOSÉS (handoff)** et créés par **US-029**.

| Artefact | Chemin | Tenu par |
|---|---|---|
| Point de reprise du dépôt | `docs/team/RESUME_HERE.md` | orchestrateur, à chaque fin de session |
| Règles d'exploitation (protégé, CODEOWNERS fondateur) | `docs/team/OPERATING_RULES.md` | orchestrateur, avant la première fusion (US-029, US-050) |
| Tableau des stories | `docs/team/BOARD.md` | orchestrateur |
| Registre des décisions (décisions de 22 + défauts appliqués + décisions techniques) | `docs/team/DECISIONS.md` | orchestrateur |
| ADR du dépôt (report dans 17 §8.1) | `docs/adr/ADR-NNN-<titre>.md` | auteur + agent architecture |
| Notes de passation | `docs/team/handoffs/US-xxx.md` | agent de la story |
| Rapports de revue | `docs/team/reviews/US-xxx/<role>-<date>.md` (lien dans la demande de fusion) | vérificateurs |
| Registre des risques | `docs/team/RISKS.md` | orchestrateur (+ red team, pré-mortems) |
| Questions entre agents | `docs/team/QUESTIONS.md` | tout agent pose ; l'orchestrateur répond |
| Rapport de santé par session | `docs/team/health/AAAA-MM-JJ-<session>.md` | orchestrateur |
| Journal de session (piste d'audit) | `docs/team/sessions/AAAA-MM-JJ-<agent>.md` | chaque agent |
| Portes de lot (pré-mortem, red team, post-mortem) | `docs/team/gates/<lot>/premortem.md`, `redteam.md`, `postmortem.md` | orchestrateur + red team |
| Post-mortem d'incident (≤ 5 jours ouvrés) | `docs/team/incidents/AAAA-MM-JJ-<titre>.md` | orchestrateur |
| Point hebdomadaire | `docs/team/weekly/AAAA-Wnn.md` | orchestrateur |

**Gabarits (PROPOSÉS ; à copier tels quels par US-029)**

`docs/team/BOARD.md`
```markdown
| Story | Titre | Lot | Pts | Statut | Agent (rôle/modèle) | Branche | Revues obtenues | Usage consommé | Bloqué par / défaut |
|---|---|---|---|---|---|---|---|---|---|
| US-001 | Dépôt et conventions | L0 | 3 | TODO | — | — | — | — | ADR-001 PROPOSÉ |
```
Statuts : `TODO`, `READY` (DoR OK), `IN_PROGRESS`, `IN_REVIEW`, `CHANGES_REQUESTED`, `MERGED`, `ACCEPTED`, `BLOCKED`, `PAUSED_USAGE_LIMIT` (19 §1.9 point 3).

`docs/team/handoffs/US-xxx.md`
```markdown
# Passation US-xxx — <titre>   (date, agent, modèle)
- Fait : …
- Reste : …
- Prochaine commande exacte : `…`
- Pièges / hypothèses : …
- Paramètres créés (17 §7.2) : …   Entités / migrations : …
- Tests ajoutés et état : …   Décisions prises (ADR / DECISIONS) : …
```

`docs/team/reviews/US-xxx/<role>-<date>.md`
```markdown
# Revue <code|QA|argent|sécurité|architecture|design> — US-xxx — <date>
Relecteur : <rôle> / <modèle> (famille A|B ; « revue dégradée » si B indisponible)
Entrées : diff <sha>, story, vecteurs, critères
| # | Gravité (CRITIQUE/MAJEUR/MINEUR) | Constat | Preuve (fichier:ligne, test) | Décision |
Verdict : APPROUVÉ | CHANGEMENTS DEMANDÉS
```

`docs/team/DECISIONS.md`
```markdown
| ID (22 ou TECH-nnn) | Question | Défaut appliqué (paramètre = valeur) | Depuis | Décider avant | Statut (OUVERTE/TRANCHÉE/DÉFAUT MAINTENU) | Tranché par / date | Lien ADR |
```

`docs/team/RISKS.md`
```markdown
| ID | Risque | Probabilité | Impact | Parade | Propriétaire | Statut | Source (pré-mortem, red team, incident) |
```

`docs/team/QUESTIONS.md`
```markdown
| Q-nnn | Date | De (agent) | Story | Question | Réponse (orchestrateur) | Escaladée au fondateur ? (oui → ID de 22) |
```

`docs/team/health/AAAA-MM-JJ-<session>.md`
```markdown
# Rapport de santé — <date> — <session>
- main : vert/rouge   - Tests : n passés / n échoués ; couverture STL/PRC/PAY/AVL/Money : x % ; mutation : x %
- Stories : en cours […], bloquées […], fusionnées […]
- Risques ouverts majeurs : …   - Escalades en attente (≤ 5 au point hebdo) : …
- Usage consommé / budget du lot : x / y (seuils 70 / 90 / 100 %)   - Interruptions (limite d'usage) : …
```

### 4.5 Escalade et point hebdomadaire (19 §1.5, 22 « Règle d'escalade »)

- Les agents **décident seuls de tout ce qui est technique** dans le cadre de 17 (nouvelle décision d'architecture = ADR revu par l'agent architecture).
- **On n'escalade que** : (a) les actions réservées à un humain (19 §6 : comptes, secrets, contrats, juridique, tests réels) ; (b) les décisions produit de 22 / 19 §5. Chaque escalade a un **défaut** : le travail continue avec lui.
- **Point fondateur hebdomadaire unique** (F-06) : démo en préproduction + **5 décisions au plus**, choisies par l'orchestrateur parmi les échéances « Décider avant » les plus proches, chacune avec contexte, options, recommandation, défaut en vigueur ; acceptation des stories ; approbation des déploiements soumis à accord (§4.7) ; lecture des post-mortems de lot. Une décision non tranchée à échéance **garde le défaut**, consigné dans `DECISIONS.md`.
- **Hors du point** : seulement un incident de production ou une action humaine qui bloque le chemin critique.

### 4.6 Protocole de limite d'usage et de reprise (19 §1.9 point 3)

- **Budget du lot** = points du lot × usage mesuré par point (mesuré sur les 20 premiers points du lot 0, US-027) × 1,3 ; plafonds mensuel et journalier fixés par le fondateur (F-15).
- **Seuils** : 70 % du plafond journalier → alerte ; 90 % → arrêt des tâches non critiques, régression nocturne minimale (C11 à 1 000, parcours dorés, oracle) ; 100 % → point de reprise et arrêt.
- **Priorités quand le quota baisse** : (1) `main` rouge ou incident ; (2) chemin critique (19 §4.2) ; (3) revues qui débloquent une fusion ; (4) le reste.
- **Coupe-circuit** : 3 échecs sur la même erreur (`agent_max_attempts_per_task` = 3) ou 2× l'usage prévu → l'agent s'arrête, écrit « BLOQUÉ » dans sa passation ; l'orchestrateur réassigne, découpe ou escalade.
- **Reprise** : (a) commits poussés à chaque étape sur la branche de story + passation à jour ; (b) à l'avertissement, finir ou annuler l'étape atomique (jamais une migration à moitié appliquée), pousser, passer la story en `PAUSED_USAGE_LIMIT` avec l'heure de reprise ; (c) la nouvelle session lit `docs/team/RESUME_HERE.md`, le tableau et la passation, **relance les tests de la branche** avant de continuer ; (d) le rapport de santé consigne l'interruption. Exercice fait une fois au lot 0 (US-050).

### 4.7 Moindre privilège et déploiement (19 §1.9 points 1, 2, 5, 6)

| Acteur | Dépôt | Préproduction | Production | Secrets |
|---|---|---|---|---|
| Agents (implémentation, design, vérificateurs) | branche de story seulement, aucun push sur `main` | déploiement auto depuis `main` ; lecture via `app_api` sur graines synthétiques PA / PY | **aucun accès** | secrets de test et clés `FAKE` injectés par la CI |
| Red team | lecture seule | comptes de test | aucun | aucun |
| Orchestrateur | fusion par demande de fusion | relance des déploiements | **déclenche** le pipeline de production (porte ci-dessous) | aucun secret de production (OIDC courte durée côté pipeline) |
| Pipeline CI / CD | — | — | seul détenteur du droit de déployer ; `migrator` uniquement dans le job de migration | lecture au coffre pendant le job |
| Fondateur | propriétaire, MFA | — | propriétaire des comptes ; bris de glace journalisé | propriétaire du coffre et du séquestre (F-13) |

**Porte de production** : CI verte sur le commit exact ; passage en préproduction ; rapport « go » de re-vérification (US-408) ; **accord du fondateur** dans l'environnement protégé `production` pour les **5 premiers déploiements** (`founder_approval_first_prod_deploys` = 5) puis, jusqu'à la fin de la recette pilote, pour toute version avec migration de données ou destructive, changement de RLS / rôles, ou du moteur de règlement / `Money` / devis. Retour arrière possible par l'orchestrateur sans accord préalable (notifié). **Branches** : `main` protégée (pas de push direct ni force-push, historique linéaire, statuts et rapports requis) ; CODEOWNERS sur migrations, RLS, `SECURITY DEFINER`, modules STL / PAY / PRC / AVL, `Money`, IaC, workflows et `OPERATING_RULES.md`. **Piste d'audit** : journaux de session dans `docs/team/sessions/`, journaux GitHub et hébergeur conservés ≥ 1 an.

### 4.8 Portes de lot (19 §1.10)

Chaque lot (L0 à L5, LC, LB) se termine par : pré-mortem au démarrage ; red team du lot en préproduction (aucun constat critique ou élevé ouvert) ; post-mortem de lot ; post-mortem de chaque incident sous 5 jours ouvrés ; exercice de restauration chronométré (US-051), revue des accès des agents, budget d'usage comparé au réel. Stories porteuses : **US-049** (L0, accent argent / RLS / concurrence / C19), US-122 (L1), US-222 (L2), US-313 (L3), US-407 (L4), US-540 (L5), US-608 (LC), US-712 (LB).

### 4.9 Mécanique de l'équipe dans Claude Code : lancement, coordination, reprise (ajouté A24-10 ; PROPOSÉ (handoff))

Principe : **une session Claude Code = l'orchestrateur** ; les autres rôles sont des **sous-agents** lancés par lui depuis cette session. Rien ne suppose une mémoire entre sessions : tout l'état est dans le dépôt (§4.4).

**Fichiers de consignes (créés par US-029, revus par US-050)**
- `CLAUDE.md` à la racine du dépôt : mission en 10 lignes, contraintes du §1, carte du §2, commandes du §7, interdits (secrets, `main`, `now()` dans le SQL métier), lien vers `docs/team/OPERATING_RULES.md`. Court (≤ 2 pages) : il est lu par chaque agent.
- `docs/team/roles/<rôle>.md` (orchestrateur, back-end, données, front-end, intégrations, design, revue-code, QA, sécurité, argent, architecture, UX, red-team) : responsabilités et « ne fait jamais » du §4.1, entrées à lire, sortie attendue (fichier exact), format de rapport (§4.4). Une consigne de lancement d'agent **cite ce fichier** au lieu de le recopier.

**Lancement d'un agent par l'orchestrateur (outil Agent de Claude Code)**
- Chaque story est confiée à un sous-agent par l'outil **Agent**, avec : nom stable `US-xxx-<rôle>` (ex. `US-006-donnees`) ; consigne = « lis `CLAUDE.md`, `docs/team/roles/<rôle>.md`, la story US-xxx de `docs/specs/19…`, la passation `docs/team/handoffs/US-xxx.md` si elle existe ; travaille dans ta branche ; termine par la passation et un rapport » ; périmètre explicite (fichiers ou modules autorisés).
- **Isolation** : implémentation avec `isolation: "worktree"` (un worktree Git par agent, cohérent avec §4.3 point 2) ; vérificateurs en lecture seule sur la branche de la story, **sans le contexte de l'auteur** (nouvel agent, pas une copie de la conversation), avec seulement la story, le diff et les vecteurs.
- **Parallélisme** : agents lancés **en arrière-plan** (plusieurs appels Agent dans le même message) pour les stories indépendantes de 19 §4.3 ; plafond par défaut **3 agents d'implémentation + leurs vérificateurs** (`team.max_parallel_impl` = 3, PROPOSÉ), révisé après US-027 selon l'usage mesuré.
- **Coordination** : l'orchestrateur reçoit la notification de fin, lit le **rapport** (pas les journaux complets), et relance au besoin le même agent par **SendMessage** (nom ou identifiant) pour une correction, ce qui conserve son contexte ; une question d'un agent va dans `docs/team/QUESTIONS.md` et l'orchestrateur répond par SendMessage. Jamais deux agents sur la même migration ni sur le même fichier de configuration.
- **Artefacts produits par agent** : commits sur `story/US-xxx-…` (pied `Agent-Role`, `Agent-Model`), `docs/team/handoffs/US-xxx.md`, rapport `docs/team/reviews/US-xxx/<rôle>-<date>.md`, journal `docs/team/sessions/AAAA-MM-JJ-<agent>.md`. L'orchestrateur met à jour `BOARD.md` à chaque transition de statut.
- **Hygiène de contexte** : un agent ne lit d'un gros document que la section citée par sa story (17 §2.3 / §2.5 seulement pour les stories qui les touchent, A24-18) ; un rapport fait ≤ 1 page ; l'orchestrateur résume dans `BOARD.md`, il ne garde pas les sorties brutes.
- **Famille B depuis la CI** : job GitHub Actions déclenché sur la demande de fusion portant l'étiquette `review:money` ou `review:security` ; il envoie à l'API du fournisseur B la story, le diff et les vecteurs (jamais de secret ni de donnée réelle), écrit le rapport dans `docs/team/reviews/` par un commit du compte machine (§4.10) et échoue si le verdict n'est pas APPROUVÉ. Clé d'API = secret d'environnement CI ; fournisseur, coût par revue et conditions de conservation des données envoyées : choisis au lot 0, approuvés par le fondateur (F-15).

**Reprise après une limite d'usage ou une coupure (complète §4.6)**
- **Points de contrôle** (fichiers versionnés) : `docs/team/RESUME_HERE.md` (prochaine action exacte, agents en cours avec leur branche, heure de reprise), `BOARD.md` (statuts, dont `PAUSED_USAGE_LIMIT`), `docs/team/handoffs/US-xxx.md` (prochaine commande exacte), dernier rapport de santé.
- **Qui relance** : par défaut **le fondateur** rouvre une session Claude Code dans le dépôt (`claude --continue` pour reprendre la dernière conversation, ou une nouvelle session) et écrit « reprends selon `docs/team/RESUME_HERE.md` » ; option : une tâche planifiée de Claude Code à l'heure de réinitialisation du quota, avec la même consigne, configurée par le fondateur s'il le souhaite (F-15).
- **Ce que relit la session qui reprend** : `CLAUDE.md`, `docs/team/RESUME_HERE.md`, `BOARD.md`, les passations des stories `IN_PROGRESS` / `PAUSED_USAGE_LIMIT`, les questions ouvertes de `QUESTIONS.md` ; **pas** tout le dossier de spécification.
- **Étapes idempotentes** : `git fetch`, puis pour chaque story en pause `git worktree list` (recréer le worktree s'il manque, jamais de `--force` sur du travail non poussé) ; relancer les tests de la branche ; une migration est soit entièrement appliquée et commitée, soit absente (jamais partielle, §4.6 b) ; une revue interrompue est **relancée en entier** par un nouvel agent ; une fusion n'est refaite que si `main` ne contient pas déjà le commit. Les sous-agents d'une session interrompue sont considérés comme perdus : on repart de leur dernier commit poussé et de leur passation.
- **Exercice** : une reprise à froid simulée au lot 0 (US-050), consignée dans le rapport de santé.

### 4.10 Identité GitHub des agents et protection des branches (ajouté A24-11 ; PROPOSÉ (handoff), décision F-01)

- **Problème** : « revue ≠ auteur », CODEOWNERS et approbation de l'environnement `production` n'ont de sens que si l'auteur des commits n'est pas aussi l'approbateur humain.
- **Options** : (A) commits des agents sous l'identité git configurée du **compte du fondateur** (`git config user.name` / `user.email`), fusions et approbations manuelles par le fondateur ; (B) **compte machine appartenant au fondateur** (`<code>-bot`, membre de l'organisation, MFA, jeton à grain fin limité au dépôt, durée ≤ 30 jours) ou GitHub App de l'organisation, utilisé par les agents et la CI ; le fondateur reste seul approbateur humain.
- **Défaut retenu (fail-closed)** : **option B**. Les agents committent et ouvrent les demandes de fusion sous le compte machine ; le pied `Agent-Role` / `Agent-Model` distingue les rôles ; les rapports de revue indépendante sont des fichiers versionnés exigés par un statut CI (« revue présente, relecteur ≠ auteur », vérifié sur les pieds de commit et les rapports, US-050) ; l'**approbation humaine** (CODEOWNERS sur les chemins sensibles, environnement `production`) est réservée au **compte du fondateur**. Tant que F-01 n'est pas fait : option A en local, aucune fusion vers une branche distante protégée.
- **Protection de `main`** : demande de fusion obligatoire, statuts CI requis (§7), historique linéaire, ni push direct ni force-push (bot compris), conversations résolues, CODEOWNERS = fondateur sur migrations, RLS, `SECURITY DEFINER`, STL / PAY / PRC / AVL, `Money`, IaC, workflows, `OPERATING_RULES.md` et `CLAUDE.md` ; environnement `production` avec le fondateur comme approbateur requis.
- **Plan GitHub** : les règles de protection et les approbateurs d'environnement sur un **dépôt privé** peuvent exiger un plan payant : à vérifier sur la page des offres de GitHub au moment de F-01 et à inscrire au budget F-15. **Première fusion** : US-001 est fusionnée avant que la CI (US-002) et les règles (US-029, US-050) existent ; elle est revue par un vérificateur, **approuvée explicitement par le fondateur** et consignée comme exception dans `DECISIONS.md`.

---

## 5. Prérequis du poste Windows du fondateur

État **constaté le 2026-10-30** sur le poste (`git --version`, `node -v`, etc.) : **Git 2.55** présent ; **Node.js v22.23.2** et npm présents ; **Python 3.12.10** présent ; **absents** : Docker, WSL (« Le Sous-système Windows pour Linux n'est pas installé »), pnpm, PostgreSQL client (`psql`), GitHub CLI (`gh`). Les installations demandant des droits administrateur ou modifiant le système sont des **actions du fondateur** (les agents ne modifient pas les réglages système).

| # (PROPOSÉ, handoff) | Prérequis | Pourquoi | Qui | Avant |
|---|---|---|---|---|
| P-01 | **WSL 2** (`wsl --install`, redémarrage) | moteur de Docker Desktop | fondateur (admin) | US-005 |
| P-02 | **Docker Desktop** (moteur WSL 2) ; vérifier ses conditions de licence pour l'entité | PostgreSQL réel en conteneur (≥ 16, `btree_gist`), Testcontainers, banc L0 | fondateur | US-005 |
| P-03 | **Node.js LTS** : la v22 est installée ; l'orchestrateur fige la version par ADR (fichier `.nvmrc` / `engines`) et vérifie qu'elle est encore une LTS maintenue | TypeScript, NestJS, Next.js | orchestrateur (ADR), fondateur si mise à jour | US-001 |
| P-04 | **pnpm** via `corepack enable` (monorepo pnpm + Turborepo, 17 §6.1) | gestion des paquets | orchestrateur (commande utilisateur) | US-001 |
| P-05 | **GitHub CLI** (`gh`) et authentification du fondateur | dépôt, demandes de fusion, CI | fondateur | US-001 / US-002 (F-01) |
| P-06 | **Python 3** (présent) | oracles monétaires exécutés en CI et en local (`python -I`) | — | US-016 |
| P-07 | Repli si Docker est impossible : **PostgreSQL 16+ natif** (même version majeure que la production visée) avec `btree_gist` ; Testcontainers ne fonctionnera pas, le banc devra pointer sur cette instance | banc L0 | fondateur | US-005 |
| P-08 | Playwright et navigateurs (`pnpm exec playwright install`) | e2e mobile / PWA | agent QA | US-041 |

Note : les preuves L0 exigent une **connexion directe sans pooler** et des tests sous les rôles de production (17 §11) ; la CI (GitHub Actions, 17 §6.1) doit aussi les exécuter, le poste local ne suffit pas comme preuve.

---

## 6. Lot 0 : plan de démarrage pas à pas

Le lot 0 compte 49 stories et 222 points (19 §7). **Les preuves PostgreSQL L0-01 à L0-09 sont les premiers tests d'acceptation** ; L0-10 est simulé par le `FAKE` tant que le PSP réel n'est pas connu (17 §11). Un échec d'une preuve **bloque le lot 2** et déclenche une révision de 17 §2.3 / §2.5 et de l'estimation.

| Étape | Stories (ordre) | Actions fondateur nécessaires avant | Sortie vérifiable |
|---|---|---|---|
| 0 | Poste prêt | **F-15** (budget IA et accès famille B), P-01 à P-05 | `docker run --rm postgres:16 postgres --version` OK ; `gh auth status` OK |
| 1 | **US-001** dépôt, monolithe modulaire, conventions (ADR-001 acté) ; **US-028** naming et identité (en parallèle dès le jour 1) | **F-01** organisation GitHub et accès des agents | dépôt avec modules, conventions écrites ; propositions de noms livrées au fondateur |
| 2 | **US-029** artefacts d'équipe (§4.4) et `OPERATING_RULES.md` v1 ; **US-002** CI ; **US-014** i18n ; **US-015** `Money` ; **US-026** test PWA iOS | — | première fusion avec rapports de revue joints (contrôle CI) ; T40, T42, T43, TA06 rejoués par `Money` |
| 3 | **US-003** environnements, IaC, déploiement réversible ; puis **US-050** règles d'exploitation appliquées ; **US-037** inventaires | **F-02** compte cloud, facturation, alertes, coffre ; **F-03** sous-domaine technique et e-mail d'envoi | préproduction déployable depuis `main` ; protection de branche, CODEOWNERS, environnement `production` avec approbateur |
| 4 | **US-005** banc PostgreSQL, rôles de production, horloge de la base (**L0-05** partiel, **L0-06**) | P-01, P-02 (ou P-07) | rôles `migrator`, `app_api`, `app_worker`, `app_anon`, propriétaires `NOLOGIN` ; `platform.now()` `VOLATILE` |
| 5 | **US-006** preuves **L0-01, L0-03, L0-08** → **US-007** preuves **L0-02, L0-04** | — | tableau de 17 §11 tenu ligne par ligne (codes `23P01`, `40P01`, `23505`, p95 < 300 ms) |
| 6 | **US-016** oracle indépendant (autre agent que US-017) ; **US-013** configuration PA / PY ; **US-008**, **US-009**, **US-010** | — | `tools/` porté : 48/48 (T01–T48), T49–T68, TA01–TA11 |
| 7 | **US-011** RLS par acteur et par pays + `SECURITY DEFINER` (**L0-05**, **L0-07** partiel) ; **US-012** console interne | revue famille B disponible (F-15) | RLS-1 à RLS-20 vertes sous les rôles de production |
| 8 | **US-017** moteur de règlement test-first → **US-018** → **US-019** `PaymentProvider` + `FAKE` → **US-022** → **US-023** → **US-024** conversion gardée (**L0-07**, **L0-10** simulé) → **US-025** fuzz C11 et oracle C12 (**L0-09**) | — | C1–C20 verts ; fuzz C11 à 1 000 en CI |
| 9 | Design : **US-030** → US-031, **US-032**, **US-033** (maquettes à approuver), **US-034**, **US-048** coquille PWA | **F-05** choix du nom et de la direction ; **F-20** antériorité, domaine | nom et thème publiés comme données (DEC-MARQUE, défaut `{brand_name}`) |
| 10 | Documentation et qualité : US-035, US-038 à US-043, US-046, US-047, US-020, US-021, US-004, US-051, US-052 | **F-04** comptes SMS / e-mail, cartes, suivi d'erreurs | régression nocturne et tableau de bord QA |
| 11 | **US-049** porte du lot 0 (pré-mortem, red team, post-mortem) ; **US-027** rapport des preuves L0 et **première mesure de vitesse** | **F-06** point hebdomadaire ; **F-16** premiers hôtes particuliers et second approbateur humain (19 v3 §6) | rapport L0 lisible par le fondateur ; projection de date publiée dans 18 §5.3 ; la porte G0 (OQ-MK-07) est **sans objet** (pivot P2P, 18 v5) |

Démarrages parallèles possibles (19 §4.3) : jour 1 US-001, US-028 ; dès US-001 : US-002, US-014, US-015, US-026, US-029 ; dès US-002 : US-005, US-038, US-039, US-040, US-003 ; dès US-005 : US-006, US-008, US-009, US-010, US-013. Le **cœur monétaire** (US-015 → US-016 → US-017 → US-018 → US-024) avance en parallèle dès le début (presque critique). Chemin critique vers la fin du build Bêta : 122 points, 24 stories (19 §4.2).

---

## 7. Portes qualité et stratégie de tests (résumé de 19 §1.8 et 17 §12)

| Niveau | Contenu | Quand |
|---|---|---|
| Unitaire | fonctions pures, transitions SM-1 à SM-8 générées depuis 08 (Vitest, horloge virtuelle) | chaque story |
| Intégration | PostgreSQL **réel** en conteneur (Testcontainers), rôles de production, outbox, pg-boss | chaque story touchant la base |
| Oracles et vecteurs dorés | T01–T68, TA01–TA11 en USD et PYG ; propriétés et fuzz (fast-check) contre l'oracle ; mutation ≥ 80 % sur règlement, `Money`, devis | chaque story argent ; 10 000 cas la nuit |
| Concurrence | C1–C20, L0-01 à L0-09 ; fuzz C11 1 000 en CI, ≥ 10 000 la nuit | chaque fusion |
| Isolation | RLS-1 à RLS-28, IDOR entre hôtes et entre voyageurs, matrice d'autorisations | chaque fusion |
| Contrats | OpenAPI ; même suite de contrats pour chaque port sur `FAKE` puis sur le connecteur réel (lot C) | chaque story API |
| E2E | Playwright 360 / 390 px, téléphone de l'hôte et du voyageur, PWA installée ; parcours dorés PA / USD et PY / PYG avec `FAKE` normal et hostile | chaque story visible ; complet la nuit |
| Sécurité, accessibilité, visuel, gabarits, migrations, données personnelles, charge, résilience, rapprochement | voir 19 §1.8 | selon 19 §1.8 |

**Portes CI bloquantes** : lint (frontières de modules, `now()` interdit dans le SQL métier, pas de SQL dynamique), types, unitaires, échantillon d'oracles, intégration, RLS, C1–C20 (fuzz réduit), contrats sur `FAKE`, e2e touchés, axe et visuel touchés, secrets, dépendances ; revues indépendantes versionnées ; L0-01 à L0-10 bloquants au lot 0 puis à chaque migration du schéma de réservation. **Seuils PROPOSÉS** : STL, PRC, PAY, AVL, `Money` ≥ 95 % lignes / 90 % branches ; autres back-end ≥ 85 % ; front ≥ 75 % ; 0 violation axe bloquante ; 0 vulnérabilité critique ou élevée.

**Commandes** — noms **PROPOSÉS (handoff)**, figés par US-002 / US-039 dans le `package.json` racine et documentés (US-039) :
```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck
pnpm test:unit
pnpm test:int            # PostgreSQL réel (Testcontainers)
pnpm test:l0             # L0-01..L0-09 sous les rôles de production
pnpm test:rls            # RLS-1..RLS-20
pnpm test:concurrency    # C1..C20, C11 à 1 000
pnpm test:money          # vecteurs T/TA + oracles Python (python -I)
pnpm test:e2e            # Playwright mobile / PWA, PA et PY
pnpm test:nightly        # régression complète (C11 10 000, propriétés, mutation, résilience, charge)
```
**Commandes réelles disponibles dès maintenant** (dossier de spécification) : `00_README.md` §4 (ex. `python -I -X utf8 tools/check_backlog.py`).

---

## 8. Vecteurs monétaires et oracles à porter dans le code

| Source | Contenu | Oracle existant (à exécuter tel quel en CI, `python -I`) | Attendu |
|---|---|---|---|
| 08 BR-CXL, E1–E6 | **T01–T48** (annulations, no-show, crédits, taxes par ligne, PYG) | `tools/verif11_settlement.py` (auditeur), `tools/independent_settlement_check.py` | 48 / 48, 0 écart |
| 08 E1, E4, E5, SM-8 | **T49–T65** (supersession, idempotence, chargeback, caution) | `tools/verif12_t49plus.py` (auditeur), `tools/check_t49plus.py` | 38 / 38 ; 0 écart |
| 08 E2, F2, F4 (VERIF_12) | **T66–T68** (imputation incrémentale, chargeback sur remboursement bloqué, `attempt_no`) | `tools/check_t66_68.py`, `tools/check_verif12_fixes.py` | OK ; 0 écart |
| 08 E7 (US-055, US-056) | **TJ01–TJ21** (montants par jambe `HOST`, `INSURER`, `TAX_THIRD_PARTY`, `PLATFORM`, en USD et en PYG) | `tools/check_legs.py` | 58 / 58, 0 écart |
| 16 A.8.1 (v5) | **TA01–TA11** par jambe, renvoyés aux lignes TJ de 08 | `tools/verif15_ta.py`, `tools/check_ta_consolidation.py` | OK |

Règles de portage (US-016, US-015, 17 §12) :
1. Copier le dossier de spécification **avec `tools/`** dans le dépôt (PROPOSÉ (handoff) : `docs/specs/`, instantané daté et non modifié hors demande de fusion approuvée) ; `check_t66_68.py` et `check_ta_consolidation.py` lisent 08 et 16 depuis le dossier parent de `tools/` : garder cette disposition.
2. L'oracle reste en **Python exécuté en CI** ; ses sorties sont comparées au moteur TypeScript ; **jamais** de valeur attendue tirée du code testé.
3. Toute **variante PYG** d'un vecteur est produite par l'oracle et **reportée dans 08** (`T…-PY`) avant d'être assertée ; T48 / T62 en PYG non normatifs (OQ-BR-24) ; T55 sans variante (critères US-016).
4. Exemple de contrôle rapide : T27 (PYG) = `(1000367, 75033, 268750, 131416)` selon `tools/verify_cxl_tests.py` (script historique qui imprime sans asserter ; le vecteur est revérifié par les oracles ci-dessus).
5. `tools/verify_cxl_tests.py` est **déclassé** (n'asserte rien) : ne pas le compter comme oracle.

---

## 9. Décisions ouvertes et défauts que les agents doivent appliquer

Copie opérationnelle de 22 (qui fait foi) et de 19 v3 §5 (révision P2P, US-060). Chaque défaut est un **paramètre** (17 §7.2), fail-closed, marqué PROPOSÉ ; les deux branches sont testées quand c'est indiqué. Une question **produit** propre au P2P ne s'ajoute pas ici : elle se tranche « comme Turo » (DEC-FONDATEUR-14, 16) et s'inscrit dans `docs/team/COMME_TURO.md`.

| Décision | Défaut codé | Stories | Décider avant |
|---|---|---|---|
| DEC-MARQUE (DSN-001) | **Kmino** (`{brand_name}`, donnée de thème) et direction Lienzo · Tinta, choisies par le fondateur et révisables sans développement (`docs/team/DECISIONS.md`) | US-028, US-030, toutes les UI | tranchée (révisable) |
| Approbation des écrans clés (DSN-007) | la story UI attend (DoR point 6) ; les stories sans UI avancent | US-033, stories UI des lots 1 à 3 | avant chaque story UI concernée |
| ADR-005 (TRP-056) : repli de la remise et du retour entre personnes si la PWA échoue sur iOS | PWA en ligne (ADR-039) | US-026 → US-524 | fin du lot 0 |
| OQ-CAT-01 (g) véhicule sans variante | **décidé** : jamais publiable ; file d'ajout | US-113, US-114 | — |
| OQ-BR-04 jours facturés | `grace_minutes` = 29 ; `overdue_detection_minutes` = 30 | US-202, US-305, US-110 | point avant le lot 2 (J-ADM-031) |
| UXQ-08 ordre revue / débit | `flagged_booking_payment_order = REVIEW_BEFORE_CHARGE` (deux branches testées) | US-209, US-023 | point avant le lot 2 |
| UXQ-03 statut et date d'entrée | contrôle par l'ops à la revue (deux champs au checkout) | US-209, US-503 | avant le lot 2 |
| J-ADM-031, OQ-BR-30 / 33 / 46 / 37 / 38 | valeurs PROPOSÉES de 17 §7.2 (25 h, 60 min, 1 jour, pénalités de l'hôte de test 25,00 / 50,00) | US-110, US-017, US-215, US-307, US-518 | point avant le lot 2 ; définitives avant la mise en service |
| DEC-FONDATEUR-01 (OQ-BR-41) | `platform_funded_host_compensation = false` ; T17, T18, T20 désactivés | US-017, US-110, US-215, US-518, US-521 | avant la recette du lot 2 ; au plus tard avant la mise en service |
| OQ-BR-45 no-show quand l'hôte est inéligible | retenue à la jambe `PLATFORM`, comme Turo (T38, T39, TJ05) ; reste l'avis consommation | US-017, US-307, US-522 | avant la mise en service |
| UXQ-04 tú / usted (et registre français) | « tú » interface, « usted » contrat ; en français, tutoiement dans l'interface et vouvoiement dans le contrat (10b §4.3, PROPOSÉ, US-060) | US-014 et textes | avant la recette de la bêta (test V0) |
| UXQ-12 refus après paiement | remboursement intégral par Kmino, annoncé avant paiement | US-209, US-224 | avant la mise en service |
| UXQ-07 politique d'annulation | unique par pays (comme Turo) | US-519 | revue en P1 |
| OQ-BR-47 montants de caution par classe | formule frais annexes de 08 BR-PAY-06 | US-701, US-225 | avant la mise en service |
| OQ-P2P-01 à 12 (22 « Pivot P2P ») | défauts « comme Turo » de 22, paramètres de 17 §7.2 (ex. `host_min_age_years` = 21, `p2p_default_booking_mode` = `INSTANT`, `review_window_days` = 10) | stories de 19 v3 | avis avant la mise en service, sans escalade produit |
| DEC-PAYS | aucun pays choisi ; les deux construits sur `FAKE` ; lot C non démarré | US-601 à US-608 | avant le lot C |
| ADR-013 / OQ-MK-06 entité qui facture | facture émise hors plateforme par le comptable | US-217, US-531, US-604 | avant LC |
| Porte go / no-go du PSP de place de marché (PAY-041) | aucune capacité bloquante validée ⇒ aucun hôte activable (`HOST_PAYOUT_RAIL_UNAVAILABLE`) | US-603, US-607 | avant la mise en service |
| Interrupteurs de mise en service par pays (`p2p_private_hosts_enabled`, `insurer_contract_active`, `funds_holding_enabled`, `payouts_enabled`) | `false` en production (absent ⇒ `false`) ; changement seulement par la commande à deux personnes (RLS-27), jamais par du code | US-125, US-607 | pays par pays, sur décision écrite, après avis, contrat de l'assureur et porte go / no-go |
| Second approbateur humain (décisions FINANCE et interrupteurs) | aucune action à deux personnes possible : interrupteurs à `false`, aucun bordereau émis, aucune avance hors plafond | US-101, US-125, US-224, US-227, US-709 | avant la mise en service (bloque la mise en service, pas le build) |
| `platform_reserve_minor`, `host_advance_cap_minor` par pays et devise | `BLOCK` : aucune avance au-delà de la jambe `PLATFORM` du trip | US-224, US-709 | avant la mise en service |
| DEC-NATIVE | aucune application native | P2 / P3 | après la bêta fermée |
| Décisions techniques (ADR-001, ADR-006, ADR-021…) | **décidées par les agents** (orchestrateur + architecture), consignées en ADR | US-001, US-003, US-010 | lot 0 |

**Sans objet (pivot P2P, DEC-FONDATEUR-13)**, gardées dans 22 avec leur raison : OQ-MK-05, OQ-MK-07 (remplacée par OQ-P2P-11 : part de l'hôte selon son plan), OQ-MK-11, UXQ-02, UXQ-09 (hold `AGENCY_LINK`), UXQ-10 et la variante P0-A d'OQ-BR-45.

Avis juridiques (OQ-MK-01, -02, -03, -04, -06, -09, OQ-BR-14, -16, -21, -24, -25, -35, OQ-PAY-*) : **pas des décisions du fondateur** ; ils conditionnent la mise en service (DEC-FONDATEUR-02, 18 §3) et l'ouverture des interrupteurs. En attendant : modes prudents paramétrés (ex. VER-007 et contrôle des 90 jours en signalement, ADR-023).

---

## 10. Limites connues et ce qui ne se prouve qu'en code

1. **Aucun DDL, aucune politique RLS, aucune transaction de 17 n'a été exécuté** (aucun PostgreSQL sur les postes de rédaction et d'audit, 17 §11) : la conception de 17 §2.3 / §2.5 (exclusion GiST, ré-acquisition, triggers différés I-OCC, `SKIP LOCKED`, RLS par acteur, `SECURITY DEFINER`, `platform.now()`) n'est **qu'une hypothèse** jusqu'à L0-01..L0-09.
2. **Concurrence** : interblocages (`40P01`), latences (p95 de pose < 300 ms) et invariants du fuzz C11 ne se mesurent que sur un PostgreSQL réel, sous les rôles de production, sans pooler.
3. **PSP** : marges, TTL des ordres, ordre des webhooks, idempotence, unicité d'un lien, `cancelOrder` : hypothèses simulées par le `FAKE` (L0-10) jusqu'au bac à sable du PSP choisi.
4. **PWA iOS** : capture caméra sans galerie, purge du stockage hors ligne, géolocalisation : à tester sur des téléphones d'hôtes et de voyageurs (US-026).
5. **Vitesse de l'équipe d'agents** : inconnue ; mesurée au lot 0 (US-027). Les estimations en jours-agent (18 §5.0) sont des ordres de grandeur non mesurés.
6. **Turo** : app native et back-office non observés ; parcours de trip seulement DOCUMENTÉS (pas de réservation réelle) ; étapes 2 à 9 du wizard hôte BLOQUÉES (02 « Limites connues », 06).
7. **Marchés** : valeur face aux agrégateurs et commission acceptable non démontrées (12 §10.4) ; licences NHTSA / EPA du catalogue À VALIDER (OQ-CAT-01 a–b).
8. **Incohérences résiduelles repérées pendant la rédaction de ce handoff : toutes corrigées après l'audit 24** : A24-01 (18 aligné sur 22 : G0 au premier point hebdomadaire après le lot 0, entretiens F-16 pendant le lot 0, coût du lot 0 assumé) ; A24-02 (17 §6.2, 16 et 18 alignés sur ADR-039 : PWA décidée, repli du comptoir décidé à la fin du lot 0) ; A24-03 (19 §4.2 : lot LC à 52 points, comme 19 §7). Plus aucune lecture opérationnelle de substitution n'est nécessaire.

---

## 11. Transmissibilité (DEC-FONDATEUR-08, PLT-001 à PLT-005, 17 §13, ADR-037)

- **Documentation dans la DoD de chaque story** : README du module, OpenAPI régénérée, schéma et historique des migrations, ADR (et report dans 17 §8.1), inventaire des variables et secrets (**noms seulement**), runbook, glossaire ES / FR / EN, CHANGELOG, paramètres dans 17 §7.2. Critère : un agent qui n'a pas écrit la story peut la reprendre avec ces seuls documents.
- **Comptes au nom du fondateur** (ou de son entité, F-14) : GitHub, cloud, domaine, SMS / e-mail, cartes, KYC, PSP, WhatsApp ; les agents n'ont qu'un accès délégué révocable ; registre des comptes et de leur propriété (US-037).
- **Portabilité** : IaC (Terraform ou OpenTofu), conteneurs, ports pour tout service cloud (US-036), export complet des données.
- **Checklist de passation** (accès, secrets transmis hors dépôt, commandes de déploiement, décisions ouvertes, dette connue) **exercée** sur une copie avant l'ouverture (US-406, F-13).
- **Aucune information de projet hors dépôt** : tout état utile est dans `docs/team/` et les documents ; aucune mémoire de session n'est supposée.

---

## 12. Script de la première session (premières heures)

À suivre dans l'ordre par la session qui ouvre le build (rôle : **orchestrateur**).

1. **Lire** (≈ 1 h ; ≈ 300 Ko ≈ 90 k tokens selon 24 A24-18 : lire 17 §2.3 / §2.5 en entier seulement à la story qui les touche) : ce fichier en entier ; `00_README.md` ; 19 §1 (tout) et §2 ; 17 §0, §1, §2.3, §2.5, §11, §12, §13 ; 22 « Décisions fondateur / produit en attente » ; les stories US-001 à US-052 de 19 §3.1 (titres, dépendances, critères des stories de l'étape 1–5 du §6).
2. **Vérifier le dossier** : exécuter les contrôles de `00_README.md` §4 ; tous doivent donner le résultat indiqué. Un échec = consigner et prévenir le fondateur avant d'aller plus loin (le dossier a peut-être été modifié).
3. **Vérifier le poste** : `git --version`, `node -v`, `corepack --version`, `python --version`, `docker version`, `gh auth status`. Pour chaque absence (P-01 à P-05 du §5), écrire au fondateur **une seule liste** d'actions avec la commande ou le lien d'installation ; ne pas installer soi-même ce qui demande des droits administrateur.
4. **Vérifier les préalables fondateur** : F-15 (budget, accès famille B), F-01 (organisation GitHub). S'ils manquent : continuer en local (étapes 5–7) et les inscrire comme escalade du premier point hebdomadaire ; marquer la famille B « revue dégradée » en attendant.
5. **Créer le dépôt** (US-001) : dépôt du fondateur (F-01 ; identité des agents selon §4.10 ; première fusion approuvée explicitement par le fondateur), clone local hors du dossier de recherche (PROPOSÉ : `C:/Users/noamm/Documents/<nom-de-code>/`) ; monorepo pnpm + Turborepo ; squelette NestJS + Next.js ; copie de l'instantané de spécification dans `docs/specs/` (avec `tools/`) ; ADR-001 (monolithe modulaire) et un ADR « chemins d'équipe et gabarits » reprenant le §4.4.
6. **Créer les artefacts d'équipe** (US-029) : `docs/team/RESUME_HERE.md`, `OPERATING_RULES.md` v1 (copie de §4.6 et §4.7 = 19 §1.9), `BOARD.md` pré-rempli avec les 49 stories du lot 0 = US-001 à US-052 **sauf US-036, US-044, US-045** (lot 1) (statut `TODO`), `DECISIONS.md` pré-rempli avec le tableau du §9 (statut `OUVERTE`, défaut appliqué), `RISKS.md` amorcé par 18 §7 et 17 §8.2, `QUESTIONS.md` vide, premier rapport de santé.
7. **Ouvrir le pré-mortem du lot 0** (`docs/team/gates/L0/premortem.md`) : au moins les risques « preuve L0 en échec », « famille B indisponible », « Docker absent sur le poste », « limite d'usage », « fondateur indisponible pour DEC-MARQUE ».
8. **Lancer en parallèle** (mécanique du §4.9 : outil Agent, worktrees, arrière-plan) : US-028 (agent design : 3 à 5 noms, 2 à 3 directions, recherche de domaine ; le fondateur choisit) et, dès US-001 fusionnée, US-002 (CI), US-015 (`Money`), US-014, US-026.
9. **Préparer US-005 puis US-006** (preuves L0) dès que Docker (ou P-07) est disponible : ce sont les **premiers tests d'acceptation** du projet.
10. **Clore la session** : passations à jour, `BOARD.md`, rapport de santé, `docs/team/RESUME_HERE.md` (prochaine action exacte), préparation de l'ordre du jour du premier point hebdomadaire (démo de ce qui existe, escalades groupées : F-15, F-01, F-02, P-01/P-02, DEC-MARQUE à venir).

---

## 13. Checklist : ce handoff est-il complet ? (cochée après l'audit 24 et ses corrections)

- [x] Mission (P2P, comme Turo, aucune agence), modèle d'argent par jambes et contraintes non négociables énoncés avec leurs sources (§1 ; révision P2P, US-060)
- [x] Carte des documents et document qui fait foi par sujet (§2) ; règle d'arbitrage des écarts
- [x] Décisions prises (DEC-FONDATEUR-02 à 17) et décisions ouvertes avec défaut, paramètre et échéance (§3, §9) — identiques à 22 et à 19 v3 §5 (révision P2P, US-060)
- [x] Rôles, familles de modèles A / B, cycle de story avec worktrees et branches (§4.1–§4.3)
- [x] Artefacts entre agents avec chemins et gabarits (§4.4) ; US-029 les crée
- [x] Escalade, point hebdomadaire, protocole de limite d'usage, moindre privilège, porte de déploiement, portes de lot (§4.5–§4.8)
- [x] Mécanique Claude Code (lancement, coordination, reprise) et identité GitHub des agents (§4.9, §4.10 ; ajoutés après 24 A24-10, A24-11)
- [x] Prérequis du poste Windows avec état constaté et actions fondateur (§5)
- [x] Plan du lot 0 ordonné, preuves L0-01..L0-10 en premiers tests d'acceptation, F-xx avant chaque étape (§6)
- [x] Stratégie de tests, portes CI, seuils, commandes (§7)
- [x] Vecteurs T01–T68, TA01–TA11 et oracles à porter, avec règles de portage (§8)
- [x] Limites, éléments prouvables seulement en code, incohérences résiduelles signalées (§10)
- [x] Transmissibilité (§11) et script de première session (§12)
- [x] Tous les contrôles de `00_README.md` §4 passent sur le dossier livré
- [x] Audit contradictoire `24_FINAL_AUDIT_AND_GAPS.md` fait et ses corrections reportées ici
