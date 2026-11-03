# ADR-049 — Configuration pays : données JSON source unique, graines générées, gardes SQL, lint « aucune constante pays »

- **Statut** : PROPOSÉ (US-013, agent back-end, claude-opus-5-5, 2026-11-03). Revues architecture (migrations, `packages/db`) et sécurité (RLS, droits, migration de test) requises, sur un autre modèle que l'auteur. À reporter dans 17 §7 et §8.1.
- **Stories** : US-013 ; s'appuient dessus US-016 / US-017 (paramètres figés dans le devis), US-125 (interrupteurs à deux personnes), US-535 (écran de paramétrage). **Sources** : 17 §1.1–§1.4, §3.2, §7 ; 16 ADM-014 / ADM-031 ; ADR-019, ADR-024, ADR-033, ADR-044, ADR-046.

## Contexte

US-013 demande que tout ce qui dépend du pays soit une donnée versionnée, avec les tables `country`, `currency`, `param_definition`, `param_value`, `holiday_calendar`, `tax_line_config`, `legal_entity` et des graines PA / PY. En Bêta, ADM-014 est « SIMPLIFIÉ » : fichier de configuration versionné, sans écran, paramétrage par migration de graines. Il faut éviter deux sources (fichier et SQL) qui divergent, et prouver qu'aucune constante pays n'est codée en dur.

## Décision

1. **Source unique** : trois fichiers JSON dans `apps/api/src/modules/cfg/data/` (devises, pays, paramètres), validés fail-closed par le module CFG (`CONFIG_INVALID` qui liste tous les défauts). Les locales sont celles de `@rueda/i18n` (non recopiées).
2. **Graines générées** : `packages/db/migrations/0009_config_seed.sql` est rendue depuis ces fichiers (`seed-sql.ts`) ; un test unitaire échoue si le fichier commité diffère du rendu.
3. **Tables Bêta** (schéma `core` créé par `0003_core_schema` d'US-006, migrations `0008` et `0009`, préfixe du schéma cible, CONTRIBUTING §9) : `config_currency`, `config_country`, `config_param_definition`, `config_param_value`, `config_holiday_calendar`, `pricing_tax_line_config`, `finance_legal_entity`. RLS `ENABLE` + `FORCE`, politique `migrator_all`, **lecture seule** pour `app_api` et `app_worker`, rien pour `app_anon` ni `PUBLIC`.
4. **Gardes SQL pour tous les rôles** (triggers `SECURITY INVOKER`, à la différence des triggers I-OCC d'ADR-048 : ils ne lisent que la configuration, lisible par l'appelant) : `valid_from` absent ⇒ `platform.now()`, passé ⇒ `PARAM_RETROACTIVE` ; cohérence avec la définition (portée, type, devise du pays, clé sans objet) ; immuabilité (ni `UPDATE` hors fermeture `valid_to`, ni `DELETE`, ni `TRUNCATE`) ; écriture d'un interrupteur à autre chose que `false` refusée (`FORBIDDEN`) jusqu'à US-125. Lecture fail-closed `core.config_go_live(key, country)`.
5. **Ajouts au registre de 17 §3.2 / §7.2** (PROPOSÉS) : colonnes `optional`, `go_live_switch` (drapeau de clé protégée demandé par US-125), `not_applicable_in`, `allowed_values`, `status` sur `param_definition` ; `decision_ref`, `created_at`, `created_by` sur `param_value` ; `country_code` (unique) sur `legal_entity`. Clés renommées pour ne pas porter de devise ni d'ambiguïté : `pyg_price_step` → `price_display_step_minor`, `biometric_retention` → `biometric_retention_max_years` ; `overdue_detection_minutes / escalades` scindée (`overdue_escalation_hours`).
6. **Démarrage** : `RUEDA_ENV` ∈ {`development`, `test`, `preproduction`, `production`}, absent ou inconnu ⇒ `production`. Toujours : contrôle tzdata du runtime. En production : toutes les données obligatoires présentes (`PARAM_MISSING`), y compris entité juridique et fériés de l'année.
7. **Lint « aucune constante pays »** : jetons tirés des données (codes pays et devises, fuseaux, locales régionales, groupes fiscaux, pièces, régimes de facturation) ; règle ESLint `rueda/no-country-constants` et contrôle des littéraux SQL des migrations (liste blanche des graines générées). Tests et fixtures exemptés.
8. **Test des gardes sous un rôle de production** : la migration de test `9100_test_config_writer.sql` donne à `app_worker`, dans la base jetable principale seulement, l'écriture de `config_param_value` et `pricing_tax_line_config` ; la base de contrôle (production seule) prouve l'absence de ce droit.

## Conséquences

- Ajouter un pays = des données (et une nouvelle migration de graines), sans code ; le lint le protège aussitôt.
- La production refuse aujourd'hui de démarrer (valeurs « à fixer », entités juridiques, fériés) : c'est l'état attendu avant J-ADM-031.
- Une migration appliquée étant immuable, la prochaine modification de valeur demandera un outil de migration de **nouvelles versions** (diff des données → `INSERT` à `valid_from` futur) ; le test d'égalité de 0009 devra alors porter sur la version 1 seulement.
- US-125 remplacera le refus `FORBIDDEN` par la garde `param_value_go_live_guard` et les commandes `cmd_golive_owner`.
- Le contrôle tzdata de PostgreSQL au démarrage attend la connexion de l'API à la base.

## Alternatives écartées

- **Graines SQL écrites à la main + fichier JSON** : deux sources, divergence certaine.
- **Lecture de la base seule au démarrage** : pas de base branchée dans l'API à ce stade ; la validation des données resterait sans test unitaire.
- **Liste de jetons interdits écrite dans la règle** : serait elle-même une constante pays et oublierait tout nouveau pays.
- **Tester les gardes sous `migrator`** : interdit (CLAUDE.md point 6).
