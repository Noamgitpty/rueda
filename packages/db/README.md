# packages/db — base de données PostgreSQL (`@rueda/db`)

Paquet réservé par US-001. Le contenu arrive avec **US-005** : banc PostgreSQL réel, rôles `migrator`, `app_api`, `app_worker`, `app_anon`, outil de migration.

- `schemas.ts` : correspondance **code de module → schéma PostgreSQL** (`MODULE_SCHEMAS`), schémas transverses (`SHARED_SCHEMAS`) et nommage Bêta (`BETA_SCHEMA`, `betaTableName()`). Le test `schemas.test.ts` vérifie que chaque module du graphe (`apps/api/src/modules/dependency-graph.ts`) a un schéma.
- `migrations/` : migrations SQL versionnées, **additives et réversibles** (19 §1.4 point 5). Jamais deux agents sur la même migration (19 §1.5).
- `sql-clock-allowlist.json` : liste blanche de la règle d'horloge (voir CONTRIBUTING, « SQL et horloge »). Seule la migration qui définit `platform.now()` peut utiliser `clock_timestamp()`.

## Conventions (17 §2.1, §10 point 3)

- **Cible** : un schéma par module, avec les noms du SQL de 17 quand ils existent :
  - `booking` (AVL) ;
  - `catalog` (CAT) ;
  - `payment` (PAY) ;
  - `finance` (FIN) ;
  - `config` (CFG).

  Les autres noms sont PROPOSÉS : `iam`, `kyc`, `pricing`, `contract`, `settlement`, `payout`, `trip_ops`, `claim`, `messaging`, `notification`, `review`, `support`, `risk`, `audit`, `reporting`, `outbox`. Le tableau complet, avec la preuve de chaque nom, est dans `schemas.ts`.

- **Schémas transverses** (17) : `platform` (`platform.now()`, `platform.guest_hold_guard()`) et `app` (`app.org_id()`, `app.has_permission()`).
- **Bêta pilote (D1)** : schéma unique `core` (PROPOSÉ). Chaque table est préfixée par son schéma cible : `booking_checkout_hold`, `catalog_listing`, `config_currency`. Le passage au schéma par module sera un renommage mécanique, sans changement des noms d'entités.
- `now()`, `current_timestamp` et les autres horloges sont interdits dans le SQL métier : utiliser `platform.now()` (17 §1.3, ADR-030).
