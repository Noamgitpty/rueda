# packages/config — configuration partagée (`@rueda/config`)

Configuration commune du monorepo : ESLint (flat config et règles `rueda/*`), contrôles hors ESLint sur le SQL et les directives, et `tsconfig` de base. Livré par US-001 (frontières de modules, horloge SQL), complété par US-013 (constantes pays) et US-017 (harnais des vecteurs dorés).

Points d'entrée (`package.json`, `exports`) : `@rueda/config/eslint`, `@rueda/config/sql-clock`, `@rueda/config/tsconfig/node.json`, `@rueda/config/tsconfig/nextjs.json`.

## Responsabilité

Faire échouer `pnpm lint` dès qu'un code enfreint une règle d'architecture du projet, et fournir les options TypeScript communes. Le paquet ne contient aucune logique métier.

## Entités

Aucune entité persistée : le paquet ne lit que des fichiers du dépôt (sources, migrations, listes blanches, données pays).

## Événements

Aucun événement de domaine : ce sont des outils de développement, exécutés au lint et en CI.

## Ports

Aucun port : aucune dépendance d'exécution de l'application. Les jetons pays sont lus dans les données CFG (`apps/api/src/modules/cfg/data/`), jamais écrits dans le code.

## Contenu

| Chemin               | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eslint/index.ts`    | `createConfig(options)` pour `eslint.config.mjs` à la racine ; greffon `rueda` ; `GLOBAL_IGNORES` ; réservation de `@rueda/money/golden-vectors` (US-016) et de `@rueda/money/testing` (US-018, posée par US-035) aux tests (`no-restricted-imports` et `no-restricted-syntax`, autorisés seulement dans `TEST_FILE_GLOBS` : `*.test.*`, `*.spec.*`, `packages/*/test/**`, `apps/*/test/**` et le harnais lui-même).                                                                                                                           |
| `eslint/rules/`      | Règles `rueda/module-boundaries` (import d'un autre module par son `index.ts` seulement, graphe de `apps/api/src/modules/dependency-graph.ts`, module inconnu refusé), `rueda/no-sql-clock` (horloge dans le SQL écrit en TypeScript), `rueda/no-country-constants` (devise, fuseau, code pays, locale régionale, taxe ou pièce dans le code) et `rueda/no-dynamic-sql` (US-049, ADR-088 : SQL construit à partir de données refusé dans `query()`, pour `APP_RUNTIME_GLOBS` hors tests et outils d'administration `DYNAMIC_SQL_ADMIN_TOOLS`). |
| `sql-clock/`         | Contrôle des fichiers `.sql` (`cli.ts`, `lint-tree.ts`, `scan.ts`) : seule `platform.now()` lit l'horloge ; liste blanche `packages/db/sql-clock-allowlist.json`.                                                                                                                                                                                                                                                                                                                                                                              |
| `country-constants/` | Contrôle des migrations SQL hors liste blanche (`packages/db/country-data-allowlist.json`), refus des commentaires ESLint qui couperaient `rueda/no-country-constants`, jetons tirés des données CFG (`tokens.ts`) et exemptions déclarées une à une avec justification (`exemptions.json`).                                                                                                                                                                                                                                                   |
| `tsconfig/`          | `base.json` (options strictes), `node.json` (`nodenext`) et `nextjs.json` (`bundler`, JSX).                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `test/`              | Tests Vitest de chaque règle, avec des fixtures volontairement fautives (`test/fixtures/`, ignorées par le lint du dépôt et jamais exécutées).                                                                                                                                                                                                                                                                                                                                                                                                 |

## Commandes de test

```bash
pnpm lint                                # ESLint, puis lint:sql, lint:country et le lint des styles
pnpm lint:sql                            # horloge dans les fichiers .sql
pnpm lint:country                        # constantes pays dans les migrations, directives ESLint
pnpm --filter @rueda/config test:unit    # tests des règles (Vitest, sans base)
```

Les tests lancent ESLint avec la configuration réelle : délai de 60 s par test (`vitest.config.ts`), car le premier chargement est lent sous Windows.
