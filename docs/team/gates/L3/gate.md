# Décision de porte du lot 3 — PROPOSÉE (2026-11-23)

> **Porte du lot 3** : 19 US-313, critères 1 à 4 ; 19 §1.10 points 1 à 5. Modèle : porte du lot 2, [`../L2/gate.md`](../L2/gate.md). Rédigé par l'agent de porte (red team / porte de lot, `claude-opus-5-5`). **Verdict PROPOSÉ : NON FRANCHIE, en attente de #302** (§7). La décision finale revient à l'orchestrateur après les revues ; rien n'est déclaré au BOARD par cette PR, et la porte n'est **jamais** déclarée franchie par l'agent de porte. Post-mortem : [`postmortem.md`](postmortem.md). Index de la red team : [`redteam.md`](redteam.md).

## 1. Constats critiques et élevés

| Constat         | Gravité PROPOSÉE | Correctif (PR, fusion)                                 | Preuve verte                                                                           | Statut      |
| --------------- | ---------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------- |
| **F-L3-SIN-01** | **critique**     | #300, 2026-11-23 09:43Z (`000e4d24`), 0181, ADR-201    | `rt-l3-06-sinistres` › RT-L3-S04 (`it.fails` inversé, `TRAFFIC_DUPLICATE`)             | **CORRIGÉ** |
| **F-L3-SIN-02** | **critique**     | #300                                                   | `rt-l3-06-sinistres:409` (aucune exécution à la seconde), plafond du pays              | **CORRIGÉ** |
| **F-L3-SIN-03** | **critique**     | #303, 2026-11-23 14:36Z (`ed16b711`), 0183, ADR-203    | `rt-l3-11-variantes` (« ancien `it.fails`, inversé ») ; `l0-us318s2-traffic-canonical` | **CORRIGÉ** |
| **F-L3-SIN-05** | **critique**     | #303                                                   | `rt-l3-11-variantes` (compte d'hôte, `TRAFFIC_DUPLICATE`)                              | **CORRIGÉ** |
| F-L3-PRE-01     | élevée           | #291, 2026-11-22 19:22Z (`be5e1026`), 0176, ADR-196    | `rt-l3-01-preuves` › RT-L3-P03 ; `l0-us303-photo-fingerprint`                          | **CORRIGÉ** |
| F-L3-PRE-02     | élevée           | #291                                                   | `l3-photo-exif.test.ts` (aucun `it.fails` restant)                                     | **CORRIGÉ** |
| F-L3-FRA-01     | élevée           | #299, 2026-11-23 10:47Z (`9aa0def0`), 0182, ADR-202    | `rt-l3-05-frais-annexes:216` (inversé en test de comportement)                         | **CORRIGÉ** |
| F-L3-SIN-04     | élevée           | #303 (`traffic_trip_charge_max_minor`, revue de l'ops) | `rt-l3-11-variantes` (seuil cumulé)                                                    | **CORRIGÉ** |
| **F-L3-FRA-03** | **élevée**       | **#302**, ouverte (brouillon, tête `0f70b3a3`)         | `rt-l3-11-variantes:533` toujours en `it.fails` (PA et PY)                             | **OUVERT**  |
| **F-L3-PRE-04** | **élevée**       | **#302**                                               | `l3-photo-variantes.test.ts:165` toujours en `it.fails`                                | **OUVERT**  |
| F-L3-PRE-03     | moyenne          | suite d'US-709 (N-473), non commencée                  | `rt-l3-03-versements:305` en `it.fails` (PA et PY)                                     | ouvert      |
| F-L3-DON-01     | moyenne          | suite d'US-525 (N-500), non commencée                  | `rt-l3-08-donnees:253` en `it.fails` (PA et PY)                                        | ouvert      |
| F-L3-FRA-02     | moyenne          | #299                                                   | `rt-l3-05-frais-annexes:274` (inversé)                                                 | CORRIGÉ     |

- [x] **Critiques** : les quatre (SIN-01, 02, 03, 05) sont corrigés et fusionnés (#300, #303) ; leurs `it.fails` sont inversés sur `main`.
- [ ] **Élevés** : quatre sur six sont corrigés (PRE-01, PRE-02, FRA-01, SIN-04) ; **F-L3-FRA-03** et **F-L3-PRE-04** restent ouverts tant que **#302** n'est pas fusionnée et rejouée verte sur `main`. État de #302 à la relecture (2026-11-23), tête `0f70b3a3`, 17 statuts de CI verts, revues delta en cours ; à la tête précédente `664b158f` (run `45194290492`), « qualité » et « guide d'installation » étaient en échec. Ce n'est pas une fusion : la porte reste en attente.
- Moyens ouverts, hors du critère 4 (qui ne retient que les critiques et les élevés) : F-L3-PRE-03 (aucun montant imputé à tort : jambes gelées sans issue) et F-L3-DON-01 (contournements de la messagerie servis en clair), chacun avec sa suite ; à corriger avant l'ouverture des versements (N-473) et avant l'ouverture d'un pays (N-500), PROPOSÉ.
- Aucun constat n'a été ajouté par cette partie : aucun test, aucun `it.fails`.

## 2. CI de `main`

| Point                                    | Valeur                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Run de référence                         | **`45196021804`**, push sur `main` à `ed16b711` (fusion de #303), 2026-11-23 14:36Z                                                                                                                                                                                                                                |
| Job « base de données » (`137766553847`) | **vert** (fin 14:49Z) : `test:int` 8 fichiers, 70 tests, puis 30 fichiers, 261 verts et 6 « expected fail » (écarts connus du parcours doré d'US-312, N-464 à N-466) ; `test:l0` : **194 fichiers, 3 258 verts, 6 expected fail, 2 ignorés** ; les onze fichiers `redteam/l3` et `redteam-l3-versements.int` verts |
| Les 6 « expected fail » de `test:l0`     | `it.fails` de F-L3-FRA-03 (`rt-l3-11:533`), F-L3-DON-01 (`rt-l3-08:253`), F-L3-PRE-03 (`rt-l3-03:305`), chacun en PA et en PY. Au run `45182399473` (`d5d5113d`, avant #303) : 14                                                                                                                                  |
| Autres jobs                              | « qualité », restauration, rotation des secrets, déploiement local, oracles, moteur d'argent, gitleaks, audit, OpenTofu, mmdc : verts ; « guide d'installation », e2e, mutation et fuzz encore en cours à l'écriture (le dernier run complet, `45182399473` sur `d5d5113d`, est vert sur ses 15 jobs)              |

## 3. Critères de sortie

| Critère                                                                                                  | Preuve                                                                                                                                                                                             | Statut                                                     |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| US-313 c1 : pré-mortem commité, risques au registre                                                      | [`premortem.md`](premortem.md) (#265, `10310420`) ; `RISKS.md`, « Risques du lot 3 » (60 lignes)                                                                                                   | [x]                                                        |
| US-313 c2 : scénarios de remise et de preuves joués, chaque constat en bogue ou en story avec sa gravité | les huit scénarios joués (`postmortem.md` §7 ; l'hôte qui lit la pièce : `rt-l3-01` › RM04 / H08, `rt-l3-08` › H08 / D01) ; 13 constats, chacun avec sa gravité, sa suite (N-471 à N-500) ou sa PR | [x] avec écart (CI contre le `FAKE`, pas de préproduction) |
| US-313 c3 : ex-porte LB contre le `FAKE` en PA et PY ; T53 / T55 verts ; aucun appel `payout`            | `redteam-l3-versements.int` (V01, V03 : `totalCalls` = 0) ; `rt-l3-03` (V07 : T53 45,00, T55 220 752 PYG ; V08) ; `rt-l3-07` (V08 à deux travailleurs, V09) ; `rt-l3-10` (versement gelé)          | [x]                                                        |
| US-313 c4 : post-mortem commité                                                                          | [`postmortem.md`](postmortem.md) : points, bogues échappés, incidents, limites d'usage, règles, registre ligne par ligne                                                                           | [x] (cette PR)                                             |
| US-313 c4 : exercice de restauration rejoué (US-051)                                                     | §5                                                                                                                                                                                                 | [x]                                                        |
| US-313 c4 / §1.10 point 2 : aucun constat critique ou élevé ouvert                                       | §1 : F-L3-FRA-03 et F-L3-PRE-04 ouverts                                                                                                                                                            | [ ] **en attente de #302**                                 |
| §1.10 point 4 : post-mortem de chaque incident sous 5 jours                                              | **0 fiche pour 10 incidents** (`postmortem.md` §3)                                                                                                                                                 | [ ] écart (règle 6 du lot 0)                               |
| §1.10 point 5 : revue des accès des agents                                                               | non refaite par cette partie (dernier relevé : porte du lot 2, `../L2/gate.md` §3)                                                                                                                 | [ ] bloquant pour la production (GL-05)                    |
| §1.10 point 5 : budget d'usage du lot comparé au réel                                                    | impossible (F-15) ; 38 h sans activité non expliquées (`postmortem.md` §4)                                                                                                                         | [ ] écart                                                  |
| Famille B (19 US-313, notes)                                                                             | non jouée : red team `claude-sonnet-5-5`, correctifs `claude-opus-5-5` (TECH-007, « revue dégradée »)                                                                                              | [ ] écart (TECH-007)                                       |
| Nuits                                                                                                    | rouges chaque nuit du 2026-11-19 au 2026-11-23 (gitleaks, tableau QA) ; gitleaks vert sur `main`                                                                                                   | [ ] ouvert (accord du fondateur)                           |

Les points [ ] autres que « aucun constat critique ou élevé ouvert » sont les écarts des portes des lots 1 et 2 ; ils n'ont pas retenu ces portes et restent bloquants pour la production.

## 4. Ce qui reste avant de franchir la porte (liste exacte)

1. **Fusion de #302** (US-706 suite, preuves 2 : frais abandonné par fait, copie photo canonique), avec ses revues exigées APPROUVÉ et une CI verte ; l'`it.fails` de F-L3-FRA-03 (`rt-l3-11:533`, PA et PY) et celui de F-L3-PRE-04 (`l3-photo-variantes.test.ts:165`) inversés en `it` sans toucher à l'attaque.
2. **Un run de `main` après #302** dont `test:l0` ne compte plus que les 4 « expected fail » des deux moyens (F-L3-PRE-03, F-L3-DON-01), et dont « qualité » ne compte plus celui de F-L3-PRE-04.
3. Restauration verte sur ce run (elle est rejouée à chaque push).

Rien d'autre ne retient le critère 4. Restent ouverts, **sans retenir la porte** (PROPOSÉ) : F-L3-PRE-03 (N-473) et F-L3-DON-01 (N-500), moyens ; les scénarios reportés (RT-L3-H02, H03, H05, H06, H07, H10 à H13, V11 : saisie du KPI, M04 : capture de la caution), avec leur raison (`postmortem.md` §7).

**Limite (PROPOSÉ)** : trois correctifs ont récidivé (PRE-04 après #291, FRA-03 après #299, SIN-03 et SIN-05 après #300). Pourtant, **aucune passe de variantes n'a visé #303** (SIN-03 à 05), et **aucune ne visera #302** avant sa fusion. La passe de porte (#301) n'a attaqué que #291, #299 et #300. Recommandation PROPOSÉE : une passe de variantes de la red team contre #303 et #302 **avant l'ouverture d'un pays**. Elle n'est pas exigée par 19 §1.10 (« corrigé et rejoué ») et ne retient pas la porte.

## 5. Exercice de restauration rejoué (US-051, 19 §1.10 point 5)

Job CI « reprise — restauration chronométrée (RTO, RPO) » (`bash scripts/ops/restore-drill.sh`, runbook `docs/ops/BACKUP_RESTORE.md` exécuté tel quel), joué à chaque PR, à chaque push sur `main` et chaque nuit. Rejoué **sans PostgreSQL ni Docker local**, sans toucher à `.github/` ni à `scripts/`.

| Champ                            | Valeur                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date et run                      | 2026-11-23, mesure à 14:37:32Z ; run `45196021804` (push sur `main`), job `137766554028`, **vert** (14:36:32Z → 14:37:54Z) ; artefact `restauration-rapport` (`restauration.json`)                                                                                                                                     |
| SHA de `main`                    | `ed16b711b2ff1f07f8f6223086d7ed8f0fc479de` (fusion de #303) ; 184 migrations de production, dernière `0183`                                                                                                                                                                                                            |
| RTO mesuré / cible               | **3,03 s** (maximum : instant T 3,03 s, au plus récent 3,02 s) / cibles PROPOSÉES d'US-112 : **14 400 s** par scénario ; exigence **28 800 s** (17 §6.4)                                                                                                                                                               |
| RPO mesuré / cible               | **6,90 s** (« perte de l'instance ») / cible PROPOSÉE **900 s** ; exigence **86 400 s** ; « instant T » : 0,18 s ; dernière vague non archivée : 0 / 6 lignes rendues                                                                                                                                                  |
| Intégrité après restauration     | **3 386 lignes** à l'instant T (3 217 au lot 2) ; restauration 1,53 s et 1,50 s ; vérification 0,42 s ; bascule de l'API 1,09 s et 1,10 s ; sauvegarde 0,77 s ; `restore-verify` OK : 22 rôles, aucun SUPERUSER ni BYPASSRLS, **172 tables en ENABLE + FORCE**, jambes et soldes cohérents, chaîne d'audit, C12 à zéro |
| Écart avec la référence d'US-051 | Référence : run `41828640740` (2026-11-04, `9d6f745`), RTO 2,87 s, RPO 6,57 s. `vsBaseline` = **1,06** (RTO) et **1,05** (RPO), sous le seuil de régression (facteur 10, marge 60 s)                                                                                                                                   |
| Run précédent                    | run `45182399473` (`d5d5113d`, dernière migration `0182`), job `137719238893`, **vert**, mesure à 13:18:09Z : RTO **4,33 s**, RPO **8,29 s** (instant T 0,10 s), 3 381 lignes, `vsBaseline` 1,51 / 1,26 (bruit du runner : sauvegarde 1,74 s, restauration 2,91 s)                                                     |

Limite inchangée : banc de CI (PostgreSQL 16 en conteneur), pas de préproduction (US-003, Q-007). Objectifs RPO / RTO PROPOSÉS, en attente du fondateur.

## 6. Renvoyé

**Avant l'ouverture des versements** (`payouts_enabled` reste `false`) : N-463 faite par US-319 (#297) ; N-464 (gains d'annulation), N-467 (calendrier), N-473 (F-L3-PRE-03), N-483 (prérequis du lot C), N-491.

**Avant l'ouverture d'un pays** : N-476 (plafond de `PHOTO_DUPLICATE`), N-492 (envoi des fichiers de l'hôte), N-495 (connecteur de l'assureur), N-500 (F-L3-DON-01), N-465 (notifications), N-120 (téléversements, en partie).

**Lot C** (porte PSP, US-603) : clé de litige du PSP (un même litige sous deux événements, `L3-donnees-sinistres.md`) ; caution `AUTHORIZED` et sa capture (RT-L3-M04) ; red team en préproduction (L3-PM-58).

**Suites de la porte** (à numéroter au BOARD par l'orchestrateur) : règles n° 1 à 6 du §5.2 du post-mortem à porter à 19 §1.9 ou à `OPERATING_RULES.md` ; registre des années virtuelles ; RT-L3-V11 (saisie du KPI) à confier à une suite d'US-311 ; RT-L3-H02, H03, H05, H06, H07, H10 à rejouer par la red team du lot 4 ; N-422 à passer FAIT (`postmortem.md` §10).

## 7. Verdict PROPOSÉ

**« Porte L3 NON FRANCHIE, en attente de #302 »** (PROPOSÉ). Deux constats **élevés** restent ouverts : **F-L3-FRA-03** (même pièce redemandée sous un autre type de frais, fenêtre de 72 h neuve) et **F-L3-PRE-04** (mêmes pixels, empreintes différentes). Leur correctif est la PR **#302**, ouverte : à la relecture (2026-11-23), tête `0f70b3a3`, 17 statuts de CI verts, revues delta en cours ; à la tête précédente `664b158f` (run `45194290492`), « qualité » et « guide d'installation » étaient en échec.

Tout le reste du critère 4 est tenu : post-mortem commité, restauration rejouée (RTO 3,03 s, RPO 6,90 s), les quatre critiques et quatre des six élevés corrigés et fusionnés, T53 et T55 verts, aucun appel `payout` avec l'interrupteur fermé. La porte pourra être proposée franchie par l'orchestrateur quand les trois points du §4 seront vrais ; cette PR ne le déclare pas. **Aucune décision du fondateur n'est demandée par cette porte.**
