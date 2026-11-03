# PRC — Pricing & Quotes (`apps/api/src/modules/prc`)

**PRC — Pricing & Quotes** : devis versionné, jours facturables, lignes, taxes, versions de prix du trip. Dépendances autorisées : CAT, CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 PRC --> CFG, CAT).

## Responsabilité

D'après 17 §2.2 et §2.6 : devis versionné (PRC-025), même calcul pour l'affichage, le contrat, le remboursement et les jambes ; jours facturables (une seule fonction paramétrée) ; lignes typées (trip fee, protection, extras) ; taxe par ligne et groupe « pour compte de tiers » ; instantané des paramètres (plan de l'hôte, parts de l'assureur) ; versions de prix du trip (BR-MOD-06). PRC ne calcule pas le règlement (STL) et n'encaisse rien (PAY).

État du code : **squelette, rien d'implémenté**. `PrcModule` est vide (US-001) et `internal/` ne contient qu'un `.gitkeep`. Le module arrive avec US-202 (devis versionné, jours facturables et taxes).

## Entités

Entités de 17 §3.2.5 :

| Entité               | État en base                                                                      |
| -------------------- | --------------------------------------------------------------------------------- |
| `tax_line_config`    | table `core.pricing_tax_line_config` (migration 0008, graines 0009, story US-013) |
| `quote`              | cible 17, pas encore créée                                                        |
| `quote_line`         | cible 17, pas encore créée                                                        |
| `trip_price_version` | cible 17, pas encore créée                                                        |
| `promo_code` (P1)    | cible 17, pas encore créée                                                        |

Les graines de `core.pricing_tax_line_config` sont générées depuis `apps/api/src/modules/cfg/data/` (ADR-049) : ne pas éditer la migration 0009.

## Événements

Aucun événement n'est émis ni consommé par le code aujourd'hui.

Cible (17 §2.2) : émis `pricing.quote.accepted`, `pricing.trip_price.versioned`. Ces deux événements ne figurent pas au catalogue de 17 §4.5 (producteur et consommateurs non décrits).

## Ports

Aucun port. API publique (`index.ts`) : `PrcModule` seulement.

## Commandes de test

Aucun test du module dans `apps/api` pour l'instant. Commande unitaire (vitest, sans base ; config `apps/api/vitest.config.ts`) : `pnpm --filter @rueda/api exec vitest run src/modules/prc --passWithNoTests` (sans `--passWithNoTests`, vitest sort en erreur faute de fichier de test).

La table `core.pricing_tax_line_config` est couverte côté base par `packages/db/test/int/config-country.test.ts` : `pnpm --filter @rueda/db exec vitest run --config vitest.int.config.ts test/int/config-country.test.ts`. Ce test demande PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
