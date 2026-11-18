# ADR-158 — Numéro de châssis libre borné : règle retenue, clé de contrôle non exigée (suite N-99)

- **Statut** : PROPOSÉ (suite N-99 d'US-124, agent back-end, claude-opus-5-5, 2026-11-18). Complète ADR-113, sans le modifier.
- **Sources** : BOARD N-99 (revues de la PR #127) ; revues de la seconde passe d'US-124 (code n° 6, qa n° 3 à 5, ux n° 3) ; ADR-107, ADR-113 ; 16 HST-006 (P1) et 10b FO7 ; ISO 3779 ; DEC-FONDATEUR-22 (« jamais plus lourd que Turo »).

## Contexte

N-99 demandait d'accepter un numéro de châssis libre borné à la place du VIN ISO 3779 imposé dès 1981 en dur dans le SQL. La migration 0083 (ADR-113, fusionnée) l'a déjà fait. Trois points restaient ouverts : la **clé de contrôle** (faut-il la vérifier quand le numéro a 17 caractères, selon le pays ou l'année ?), les **preuves** sur des châssis japonais réels et sur les bornes, et la **mutation** de la règle d'engagement, que la passation d'US-124 n'avait faite que sur la règle « titre » (pièce désactivée par défaut depuis DEC-FONDATEUR-22).

## Décision

1. **Règle inchangée** (0083, `core.catalog_vin_kind`) : après normalisation (majuscules, sans espace ni tiret), un numéro est accepté s'il compte **5 à 16 lettres ou chiffres** (numéro non ISO : châssis japonais `K11-123456` à `ZVW30-1234567`, I, O et Q admis) ou **17 caractères de l'alphabet ISO 3779** (sans I, O ni Q). Unicité et contestation N-61 communes aux deux formats. Refus dédié `VEHICLE_VIN_INVALID` (es, en, fr, pt-BR, catalogue v31). **Aucune migration** dans cette suite.
2. **Clé de contrôle (position 9) jamais vérifiée** : 08, 16 et 17 ne l'exigent pour aucun pays ; elle n'est obligatoire qu'en Amérique du Nord (49 CFR 565), et des véhicules importés d'autres marchés ne la respectent pas. La règle ne diffère donc pas entre le Panama et le Paraguay : **aucun paramètre pays n'est créé**. Un futur pays qui l'exigerait ajouterait un paramètre (défaut `false`, le moins restrictif) et une nouvelle migration.
3. **Écart avec les specs** : 16 HST-006 (P1) et 10b FO7 décrivent le parcours de Turo aux États-Unis (« VIN 17 caractères, case plus ancien que 1981 »). Ce parcours est plus lourd que Turo pour PA / PY (DEC-FONDATEUR-22) ; une demande de fusion de specs doit les aligner sur ADR-113 / ADR-158 (suite).
4. **Preuves ajoutées** (`l0-us124-chassis-attestation`, PA en USD et PY en PYG, sous `app_api`) : châssis japonais de 9 à 12 caractères ; borne haute de 16 caractères ; clé de contrôle fausse acceptée (oracle de la norme calculé dans le test) ; ancienne signature de la déclaration (format refusé, rien n'est écrit) ; engagement retiré à une nouvelle déclaration (non éligible, historique conservé).

## Conséquences

- Risques acceptés d'ADR-113 inchangés : VIN ISO tronqué à 16 caractères lu comme non ISO ; numéro non ISO court qui occupe l'espace global d'unicité ; numéro enregistré non corrigeable par l'hôte (support).
- Suites : PR de specs pour 16 HST-006 et 10b FO7 ; parcours de correction d'un numéro mal saisi ; cas d'un véhicule sur variante de la douane (sans fiche) avec numéro non ISO en PY.
