# CFG — Country configuration (`apps/api/src/modules/cfg`)

**CFG — Country configuration** : pays, devises, fuseaux, locales, paramètres versionnés, fériés, entités juridiques. Dépendances autorisées : BUS seulement (socle : publie ses événements par l’outbox ; source : 17 §2.2, revue architecture US-001). Documentation de la configuration pays (US-013) : [`internal/README.md`](internal/README.md).

## Responsabilité

CFG fait de tout ce qui dépend du pays une **donnée versionnée** : pays, devises, fuseaux, locales, définitions et valeurs de paramètres (dont les interrupteurs de mise en service par pays), fériés, entités juridiques. Il porte aussi le socle de marque modifiable (thème, actifs, blocs de contenu). Panama (USD) et Paraguay (PYG sans décimale) existent dès le lot 0.

CFG ne contient aucune règle métier : il valide, charge et résout des valeurs, de façon fail-closed.

État réel :

- US-013 (ADR-024, ADR-033, ADR-049) : données `data/*.json`, validation, résolution des paramètres, interrupteurs, contrôles de démarrage et de tzdata. Détail : [`internal/README.md`](internal/README.md).
- US-034 (ADR-036, ADR-067) : socle de marque. Détail : [`internal/brand/README.md`](internal/brand/README.md).

## Entités

| Entité (17 §2.2, §3.2.13) | En base                                               |
| ------------------------- | ----------------------------------------------------- |
| `country`                 | table `core.config_country` (migration 0008)          |
| `currency`                | table `core.config_currency` (migration 0008)         |
| `param_definition`        | table `core.config_param_definition` (migration 0008) |
| `param_value`             | table `core.config_param_value` (migration 0008)      |
| `holiday_calendar`        | table `core.config_holiday_calendar` (migration 0008) |
| `brand_version`           | table `core.config_brand_version` (migration 0042)    |
| `brand_asset`             | table `core.config_brand_asset` (migration 0042)      |
| `content_block`           | table `core.config_content_block` (migration 0042)    |

La migration 0008 crée aussi `core.pricing_tax_line_config` (taxe par ligne, entité PRC en 17 §3.2.5) et `core.finance_legal_entity` (entité FIN en 17 §3.2.13), chargées depuis `data/countries.json`. Graines : `0009_config_seed.sql`, **générée** depuis `data/*.json` (ne pas l'éditer).

## Événements

Émis (cible 17 §4.5) : `config.param.changed`, consommé par tous les modules (invalidation de cache) et par AUD. **Il n'est pas émis aujourd'hui** : aucune commande d'écriture des paramètres n'existe encore (valeurs chargées par migration). Le socle de marque n'émet aucun événement en Bêta (`config.brand.published` est une piste, voir `internal/brand/README.md`).

Consommés : aucun.

## Ports

API publique (`index.ts`) :

- configuration pays : `CfgModule`, `CountryConfigService`, `parseCountryConfig`, `resolveParam`, `findOptionalParam`, `isGoLiveSwitchOn`, `assertNotRetroactive`, `assertProductionReady`, `findReadinessIssues`, `runStartupChecks`, `parseRuntimeEnvironment`, contrôles tzdata, `ConfigError` et les types du modèle ;
- socle de marque : `BrandModule`, `BrandReadService`, `BrandConsoleService`, `PgBrandStore`, `loadBrandParams`, erreurs et types.

Ports vers l'extérieur (socle de marque) : `BrandStore` (implémentation `PgBrandStore`) et `BrandFileStore` (stockage objet, création seule). En test : FAKE `InMemoryFileStore` (`@rueda/fake-adapters/files`). En production : `UnavailableBrandFileStore` tant qu'US-003 n'a pas livré le stockage objet. La configuration pays n'a aucun port.

## Commandes de test

- Unitaires (sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/cfg` (`parse`, `resolve`, `seed-sql`, `startup`, `brand`). `RUEDA_WRITE_CFG_SEED=1 pnpm --filter @rueda/api test:unit` régénère `0009`.
- Intégration (PostgreSQL réel) : `pnpm --filter @rueda/api exec vitest run --config vitest.int.config.ts src/modules/cfg` (`internal/brand/pg-brand-store.int.test.ts`) et `pnpm --filter @rueda/db exec vitest run --config vitest.int.config.ts test/int/config-country.test.ts`.
- Preuves L0 (rôles de production) : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-brand.test.ts`.
- Contrat HTTP (US-041, sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/cfg/internal/brand/brand.contract.test.ts` — chaque réponse de `/brand`, `/brand/content` et `/brand/assets/{id}` est confrontée à `apps/api/openapi/openapi.json`, dans chaque pays configuré.

`test:int` et `test:l0` demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».
