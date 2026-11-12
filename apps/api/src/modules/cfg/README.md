# CFG — Country configuration (`apps/api/src/modules/cfg`)

**CFG — Country configuration** : pays, devises, fuseaux, locales, paramètres versionnés, fériés, entités juridiques. Dépendances autorisées : BUS seulement (socle : publie ses événements par l’outbox ; source : 17 §2.2, revue architecture US-001). Documentation de la configuration pays (US-013) : [`internal/README.md`](internal/README.md).

## Responsabilité

CFG fait de tout ce qui dépend du pays une **donnée versionnée** : pays, devises, fuseaux, locales, définitions et valeurs de paramètres (dont les interrupteurs de mise en service par pays), fériés, entités juridiques. Il porte aussi le socle de marque modifiable (thème, actifs, blocs de contenu). Panama (USD) et Paraguay (PYG sans décimale) existent dès le lot 0.

CFG ne contient aucune règle métier : il valide, charge et résout des valeurs, de façon fail-closed.

État réel :

- US-013 (ADR-024, ADR-033, ADR-049) : données `data/*.json`, validation, résolution des paramètres, interrupteurs, contrôles de démarrage et de tzdata. Détail : [`internal/README.md`](internal/README.md).
- US-034 (ADR-036, ADR-067) : socle de marque. Détail : [`internal/brand/README.md`](internal/brand/README.md).
- US-125 (ADR-101, PROPOSÉ) : interrupteurs de mise en service changés **seulement** par deux personnes distinctes (commandes en base `core.config_cmd_request_go_live_switch` / `core.config_cmd_approve_go_live_switch`, migration 0071, RLS-27) ; avertissements réglementaires versionnés par pays (`regulatoryNotices` de `data/countries.json`, textes `common.regulatory.*` du catalogue en es, en, fr et pt), servis par `GET /regulatory-notices?country=XX&audience=HOST|GUEST` (`internal/notices/`).

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
| `go_live_switch_request`  | table `core.config_go_live_switch_request` (0071)     |

La migration 0008 crée aussi `core.pricing_tax_line_config` (taxe par ligne, entité PRC en 17 §3.2.5) et `core.finance_legal_entity` (entité FIN en 17 §3.2.13), chargées depuis `data/countries.json`. Graines : `0009_config_seed.sql`, **générée** depuis `data/*.json` (ne pas l'éditer).

## Événements

Émis (cible 17 §4.5) : `config.param.changed`, consommé par tous les modules (invalidation de cache) et par AUD. Émis depuis US-125 par la seule approbation d'un interrupteur de mise en service (`core.config_cmd_approve_go_live_switch`, charge `key`, `scope`, `country`, `valid_from`), dans la transaction du changement ; les autres paramètres restent chargés par migration. Le socle de marque n'émet aucun événement en Bêta (`config.brand.published` est une piste, voir `internal/brand/README.md`).

Consommés : aucun.

## Ports

API publique (`index.ts`) :

- configuration pays : `CfgModule`, `CountryConfigService`, `parseCountryConfig`, `resolveParam`, `findOptionalParam`, `isGoLiveSwitchOn`, `assertNotRetroactive`, `assertProductionReady`, `findReadinessIssues`, `runStartupChecks`, `parseRuntimeEnvironment`, contrôles tzdata, `ConfigError` et les types du modèle ;
- avertissements réglementaires (US-125) : `RegulatoryNoticesModule`, `RegulatoryNoticesController`, `noticeMessageKey`, `NOTICE_AUDIENCES` et les types `RegulatoryNotice`, `NoticeAudience`, `RegulatoryNoticesResponse` ;
- socle de marque : `BrandModule`, `BrandReadService`, `BrandConsoleService`, `PgBrandStore`, `loadBrandParams`, erreurs et types.

Ports vers l'extérieur (socle de marque) : `BrandStore` (implémentation `PgBrandStore`) et `BrandFileStore` (stockage objet, création seule). En test : FAKE `InMemoryFileStore` (`@rueda/fake-adapters/files`). En production : `UnavailableBrandFileStore` tant qu'US-003 n'a pas livré le stockage objet. La configuration pays n'a aucun port.

## Commandes de test

- Unitaires (sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/cfg` (`parse`, `resolve`, `seed-sql`, `startup`, `brand`). `RUEDA_WRITE_CFG_SEED=1 pnpm --filter @rueda/api test:unit` régénère `0009`.
- Intégration (PostgreSQL réel) : `pnpm --filter @rueda/api exec vitest run --config vitest.int.config.ts src/modules/cfg` (`internal/brand/pg-brand-store.int.test.ts`) et `pnpm --filter @rueda/db exec vitest run --config vitest.int.config.ts test/int/config-country.test.ts`.
- Preuves L0 (rôles de production) : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-brand.test.ts` ; interrupteurs (US-125) : `test/l0/l0-us125-go-live-switches.test.ts`, RT-CONC-21 à 25 (`test/redteam/concurrence/rt-conc-03-switches-clock-queue.test.ts`) et S-04 (`test/l0/l0-us049-money-fixes.test.ts`).
- Contrat HTTP (US-041, sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/cfg/internal/brand/brand.contract.test.ts` — chaque réponse de `/brand`, `/brand/content` et `/brand/assets/{id}` est confrontée à `apps/api/openapi/openapi.json`, dans chaque pays configuré.

`test:int` et `test:l0` demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».
