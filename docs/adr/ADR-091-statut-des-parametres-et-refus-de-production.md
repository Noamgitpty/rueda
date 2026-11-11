# ADR-091 — Statut de décision des paramètres pays et refus de la production « À DÉCIDER »

- **Statut** : PROPOSÉ (US-110, agent back-end, claude-opus-5-5, 2026-11-11). Revues exigées par `review-requirements.json` : code, architecture, sécurité, argent et qa, sur un autre modèle que l'auteur. Numéro pris sur `main` au moment du push : il peut changer (US-101 et US-102 prennent aussi ADR-091).
- **Sources** : 19 US-110 ; 16 fiche ADM-014 / ADM-031 (valeurs « À DÉCIDER au jalon J-ADM-031 », parcours alternatif « démarrage refusé en production ») ; 17 §7.1 points 6 et 7, §7.2 (colonne « Statut / OQ ») ; 22 (défauts fail-closed) ; 08 T61 ; DEC-FONDATEUR-01, DEC-FONDATEUR-02, DEC-FONDATEUR-19. Complète ADR-049 (configuration pays en données).

## Contexte

US-013 a chargé les défauts de 17 §7.2 pour PA et PY, avec le texte libre de la colonne « Statut / OQ ». Rien ne distinguait une valeur **décidée** d'une valeur **chargée pour construire** en attendant le fondateur, un avis ou un contrat. 19 US-110 demande que chaque valeur porte son statut et sa source, et qu'un déploiement de production soit refusé tant qu'une valeur reste « À DÉCIDER », les valeurs de test restant permises en préproduction.

## Décision

1. **Vocabulaire fermé** `decision` ∈ {`DECIDED`, `PROPOSED`, `TO_DECIDE`} et `decisionRef` (texte non vide : la décision ou la question ouverte), **obligatoires** sur chaque clé de `params.json` (sinon `CONFIG_INVALID`). Chaque valeur en hérite, avec la source de la clé (`ParamValue.decision`, `decisionRef`, `source`). Les taux de taxe ont le leur, par pays (`countries.json`, `taxDecision`).
2. **Règle d'attribution** (reproductible, testée par `defaults.test.ts`) :
   - `DECIDED` : « décidé » dans 17 §7.2, et les quatre interrupteurs de mise en service, dont la valeur `false` en production est décidée (17 §0.1 ; leur passage relève d'US-125, jamais du statut). Un interrupteur non `DECIDED` est refusé.
   - `TO_DECIDE` : toute clé dont 17 §7.2 cite une question ouverte (OQ, UXQ, DEC-FONDATEUR-01, J-ADM-031 / ADM-031, contrat d'assureur, « à fixer »), toute valeur de la liste de 16 ADM-031, le rail du PSP (lot C) et les taux de taxe (OQ-BR-14, OQ-MK-06).
   - `PROPOSED` : défaut de l'équipe, technique ou « comme Turo », qui n'attend ni le fondateur, ni un avis, ni un contrat.
   - **Écart fail-closed** : là où 17 §7.2 dit « décidé » et 16 ADM-031 « À DÉCIDER » (`max_trip_days`, `review_window_days`), et pour `overdue_detection_minutes` (liée à `grace_minutes` tant qu'OQ-BR-04 est ouverte), le statut le plus prudent l'emporte : `TO_DECIDE`. À reporter dans 17 §7.2.
3. **Refus de production** (`findReadinessIssues`, `assertProductionReady`, appelés au démarrage de l'API et du travailleur quand `RUEDA_ENV` vaut `production`, est absent ou inconnu) : chaque valeur **en vigueur** à l'instant contrôlé et `TO_DECIDE` donne `PARAM_UNDECIDED` (une ligne par pays et par clé, avec sa question), les taxes à décider `TAX_UNDECIDED`. Le code levé est `PARAM_MISSING` s'il manque aussi une donnée obligatoire, sinon `PARAM_UNDECIDED` (code PROPOSÉ, à reporter en 16 A.8). La préproduction, le développement et les tests ne font pas ce contrôle. Une valeur fermée ou pas encore en vigueur ne compte pas : la décision du fondateur se publie comme une **nouvelle version** `DECIDED` (`valid_from` futur, jamais rétroactive).
4. **Une absence n'est pas une valeur** : `platform_funded_host_compensation` reste **absent** (DEC-FONDATEUR-01 ouverte), donc `false` par `fail_mode` (16 ADM-014 : son absence ne bloque pas le démarrage) ; T61 rejoué avec la valeur résolue de PA et de PY donne une compensation nulle.
5. **Source unique bêta** : le statut vit dans le fichier versionné (16 ADM-014 « SIMPLIFIÉ ») et ne change pas les graines. 0009 et 0046 restent rendues à l'identique (ADR-044) ; aucune migration. Le miroir du statut en base est confié à l'écran de paramétrage (US-535), qui en aura besoin pour écrire une valeur.
6. **Aucun plafond de véhicules par hôte** (DEC-FONDATEUR-19) : aucune clé de ce type, et un test refuse d'en ajouter une.

## Conséquences

- Aujourd'hui la production refuse de démarrer pour des raisons cumulées : 34 données absentes (valeurs « à fixer », entités juridiques, fériés), puis 57 clés `TO_DECIDE`, dont 40 valeurs en vigueur au PA et 34 au PY, et les 2 taux de taxe. Le message les liste toutes, ce qui donne au fondateur la liste de J-ADM-031.
- Décider une valeur = changer `decision` en `DECIDED` et `decisionRef` en référence de la décision, dans une nouvelle version de la valeur. Le fondateur décide ; l'agent ne le fait jamais à sa place.
- Le déploiement ECS échoue sur le démarrage refusé (coupe-circuit, retour arrière automatique, `docs/ops/DEPLOY.md`). Le job de base du déploiement ne lit pas le statut, faute de miroir en base (point 5).

## Alternatives écartées

- **Statut en base dès maintenant** (colonne de `config_param_value` ou table jointe) : exige de suspendre la garde d'immuabilité pour annoter les graines déjà appliquées, ou une table de plus sous RLS, pour un lecteur qui n'existe pas encore en bêta. Reporté à US-535.
- **Statut déduit du texte libre** par expression régulière : fragile ; le texte reste rendu dans 0009, le statut normalisé est explicite et contrôlé par un test de cohérence avec ce texte.
- **Refuser aussi les valeurs `PROPOSED`** : bloquerait la production sur des réglages techniques (balayages, délais, limites de débit) que personne n'a à trancher.
