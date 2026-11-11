# ADR-093 — Statut de décision des paramètres pays et refus de la production « À DÉCIDER »

- **Statut** : PROPOSÉ (US-110, agent back-end, claude-opus-5-5, 2026-11-11). Revues exigées par `review-requirements.json` : code, architecture, sécurité, argent et qa, sur un autre modèle que l'auteur. Numéro fixé par l'orchestrateur (ordre de fusion : US-102 ADR-091, US-101 ADR-092, US-110 ADR-093).
- **Sources** : 19 US-110 ; 16 fiche ADM-014 / ADM-031 (valeurs « À DÉCIDER au jalon J-ADM-031 », parcours alternatif « démarrage refusé en production ») ; 17 §7.1 points 6 et 7, §7.2 (colonne « Statut / OQ ») ; 22 (défauts fail-closed) ; 08 T61 ; DEC-FONDATEUR-01, DEC-FONDATEUR-02, DEC-FONDATEUR-19. Complète ADR-049 (configuration pays en données).

## Contexte

US-013 a chargé les défauts de 17 §7.2 pour PA et PY, avec le texte libre de la colonne « Statut / OQ ». Rien ne distinguait une valeur **décidée** d'une valeur **chargée pour construire** en attendant le fondateur, un avis ou un contrat. 19 US-110 demande que chaque valeur porte son statut et sa source, et qu'un déploiement de production soit refusé tant qu'une valeur reste « À DÉCIDER », les valeurs de test restant permises en préproduction.

## Décision

1. **Vocabulaire fermé** `decision` ∈ {`DECIDED`, `PROPOSED`, `TO_DECIDE`} et `decisionRef` (texte non vide : la décision ou la question ouverte), **obligatoires** sur chaque clé de `params.json` (sinon `CONFIG_INVALID`). Chaque valeur en hérite, avec la source de la clé (`ParamValue.decision`, `decisionRef`, `source`). Les taux de taxe ont le leur, par pays (`countries.json`, `taxDecision`).
2. **Règle d'attribution** (reproductible, testée par `defaults.test.ts`) :
   - `DECIDED` : « décidé » dans 17 §7.2, et les quatre interrupteurs de mise en service, dont la valeur `false` en production est décidée (17 §0.1 ; leur passage relève d'US-125, jamais du statut). Un interrupteur non `DECIDED` est refusé.
   - `TO_DECIDE` : toute clé dont 17 §7.2 cite une question ouverte (OQ, UXQ, DEC-FONDATEUR-01, J-ADM-031 / ADM-031, contrat d'assureur, « à fixer ») **dans la colonne « Statut / OQ » ou dans la colonne « Source »**, toute valeur de la liste de 16 ADM-031, le rail du PSP (lot C) et les taux de taxe (OQ-BR-14, OQ-MK-06). La règle de la colonne « Source » s'applique sans exception hors des interrupteurs : elle fait passer `p2p_host_requires_tax_id` (OQ-PAY-09, OQ-P2P-07) et `booking_request_expiry_hours` (OQ-P2P-10), que 17 dit PROPOSÉ, à `TO_DECIDE`. Les **interrupteurs** sont la seule exception : leur colonne « Source » cite les OQ qui en conditionnent le passage à `true` (OQ-BR-35, OQ-P2P-03, OQ-MK-02…), alors que leur valeur `false` est décidée.
   - `PROPOSED` : défaut de l'équipe, technique ou « comme Turo », qui n'attend ni le fondateur, ni un avis, ni un contrat.
   - **Écarts tranchés vers le statut prudent `TO_DECIDE`**, à reporter dans 17 §7.2 :
     - 17 « décidé », 16 ADM-031 « À DÉCIDER » : `max_trip_days`, `review_window_days` ;
     - 17 « décidé », mais liée à `grace_minutes` tant qu'OQ-BR-04 est ouverte (défaut de 22) : `overdue_detection_minutes` ;
     - 17 « PROPOSÉ », 16 ADM-031 « À DÉCIDER » (sept clés) : `host_min_age_years`, `host_default_plan`, `guest_protection_min_level`, `self_booking_forbidden`, `p2p_default_booking_mode`, `platform_reserve_minor`, `host_advance_cap_minor`. C'est cohérent avec l'en-tête de 17 §7.2 (« valeurs = défauts PROPOSÉS, À DÉCIDER au jalon J-ADM-031 ») ;
     - 17 « PROPOSÉ », OQ ouverte en colonne « Source » : `p2p_host_requires_tax_id`, `booking_request_expiry_hours`.
   - La liste attendue exacte des 59 clés `TO_DECIDE`, chacune avec sa source, est épinglée dans `defaults.test.ts` : toute différence, dans un sens ou dans l'autre, fait échouer le test.
3. **Refus de production** (`findReadinessIssues`, `assertProductionReady`, appelés au démarrage du processus API (`apps/api/src/main.ts`) et du travailleur pg-boss (`apps/api/src/worker.ts`), les deux processus d'`apps/api` qui chargent `CfgModule` par `AppModule`, quand `RUEDA_ENV` vaut `production`, est absent ou inconnu) : chaque valeur **en vigueur** à l'instant contrôlé et `TO_DECIDE` donne `PARAM_UNDECIDED` (une ligne par pays et par clé, avec sa question), les taxes à décider `TAX_UNDECIDED`. Le code levé est `PARAM_MISSING` s'il manque aussi une donnée obligatoire, sinon `PARAM_UNDECIDED` (code PROPOSÉ, à reporter en 16 A.8). La préproduction, le développement et les tests ne font pas ce contrôle. Une valeur fermée ou pas encore en vigueur ne compte pas : la décision du fondateur se publie comme une **nouvelle version** `DECIDED` (`valid_from` futur, jamais rétroactive).
4. **Une absence n'est pas une valeur** : `platform_funded_host_compensation` reste **absent** (DEC-FONDATEUR-01 ouverte), donc `false` par `fail_mode` (16 ADM-014 : son absence ne bloque pas le démarrage) ; T61 rejoué avec la valeur résolue de PA et de PY donne une compensation nulle.
5. **Source unique bêta** : le statut vit dans le fichier versionné (16 ADM-014 « SIMPLIFIÉ ») et ne change pas les graines. 0009 et 0046 restent rendues à l'identique (ADR-044) ; aucune migration. Le miroir du statut en base est confié à l'écran de paramétrage (US-535), qui en aura besoin pour écrire une valeur.
6. **Aucun plafond de véhicules par hôte** (DEC-FONDATEUR-19) : aucune clé de ce type, et un test refuse d'en ajouter une.

## Conséquences

- Aujourd'hui la production refuse de démarrer pour des raisons cumulées : 34 données absentes (valeurs « à fixer », entités juridiques, fériés), puis 59 clés `TO_DECIDE`, dont 42 valeurs en vigueur au PA et 36 au PY, et les 2 taux de taxe. Le message les liste toutes, ce qui donne au fondateur la liste de J-ADM-031.
- Décider une valeur = changer `decision` en `DECIDED` et `decisionRef` en référence de la décision, dans une nouvelle version de la valeur. Le fondateur décide ; l'agent ne le fait jamais à sa place.
- Le déploiement ECS échoue sur le démarrage refusé (coupe-circuit, retour arrière automatique, `docs/ops/DEPLOY.md`). Le job de base du déploiement ne lit pas le statut, faute de miroir en base (point 5). La liste de contrôle de mise en service porte la ligne GL-14 (aucune valeur À DÉCIDER en vigueur dans un pays mis en service).
- Une valeur `TO_DECIDE` à `valid_from` futur n'est pas vue par un démarrage antérieur à son entrée en vigueur. Sans objet tant que le fichier ne porte que des valeurs sans `valid_from` ; à traiter avec le miroir en base (US-535, suite N-22 du BOARD).

## Alternatives écartées

- **Statut en base dès maintenant** (colonne de `config_param_value` ou table jointe) : exige de suspendre la garde d'immuabilité pour annoter les graines déjà appliquées, ou une table de plus sous RLS, pour un lecteur qui n'existe pas encore en bêta. Reporté à US-535.
- **Statut déduit du texte libre** par expression régulière : fragile ; le texte reste rendu dans 0009, le statut normalisé est explicite et contrôlé par un test de cohérence avec ce texte.
- **Refuser aussi les valeurs `PROPOSED`** : bloquerait la production sur des réglages techniques (balayages, délais, limites de débit) que personne n'a à trancher.
