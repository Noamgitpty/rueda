# PRC — Pricing & Quotes (`apps/api/src/modules/prc`)

**PRC — Pricing & Quotes** : devis versionné, jours facturables, lignes, taxes, versions de prix du trip. Dépendances autorisées : CAT, CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 PRC --> CFG, CAT).

## Responsabilité

D'après 17 §2.2 et §2.6 : devis versionné (PRC-025), même calcul pour l'affichage, le contrat, le remboursement et les jambes ; jours facturables (une seule fonction paramétrée) ; lignes typées (trip fee, protection, extras) ; taxe par ligne et groupe « pour compte de tiers » ; instantané des paramètres (plan de l'hôte, parts de l'assureur) ; versions de prix du trip (BR-MOD-06). PRC ne calcule pas le règlement (STL) et n'encaisse rien (PAY).

État du code (US-202, ADR-125) : **moteur de devis pur et versionné** (`prc.quote/1`, `internal/quote/`), sans persistance. Les tables `quote`, `quote_line`, `trip_price_version` et la route du devis ne sont **pas** livrées : `packages/db/` et `packages/i18n/` ne sont pas ouverts à US-202 dans `docs/team/review-requirements.json` (voir `docs/team/handoffs/US-202.md`).

| Fichier (`internal/quote/`) | Rôle                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `billable-days.ts`          | `billableDays(début, fin, grace_minutes)` = max(1, ceil((fin − début − tolérance) / 24 h)) : **la** fonction des jours facturables (17 §2.6, TA07), sur des instants, sans fuseau                                                                                                                                                          |
| `engine.ts`                 | `computeQuote` (prix journalier × jours facturables) et `assembleQuote` (lignes déjà chiffrées) : taxe **par ligne** (`multiplyRoundHalfUp` de `@rueda/money`), somme par groupe fiscal, total TTC, jambes de la capture du total (`computeCaptureLegs`, 08 E7) ; `quoteSettlementTrip` donne au moteur de règlement le trip tiré du devis |
| `params.ts`                 | `resolveQuoteParams(config, { country, at, hostPlan?, protectionLevel? })` : instantané des paramètres du pays lus de CFG (devise, `grace_minutes`, `max_trip_days`, `tax_line_config`, `host_share_pct[plan]`, parts de livraison et d'Extras, parts de l'assureur si le contrat les fixe)                                                |
| `frozen.ts`                 | `freezeQuote` / `replayFrozenQuote` : entrées et instantané canoniques avec empreinte SHA-256, sorties canoniques ; le rejeu recalcule depuis les seules entrées figées et exige des sorties identiques                                                                                                                                    |
| `quote.service.ts`          | `QuoteService` (exporté par `PrcModule`) : instantané CFG + moteur, pour US-203, US-208, US-226                                                                                                                                                                                                                                            |
| `errors.ts`                 | `QuoteError` : `QUOTE_UNAVAILABLE`, `TAX_CONFIG_MISSING`, `LEG_AMOUNT_NEGATIVE` (16) ; `QUOTE_INPUT_INVALID`, `QUOTE_REPLAY_MISMATCH` (PROPOSÉS)                                                                                                                                                                                           |

Règles tenues :

- argent : `Money` (`bigint` en unités mineures) ; aucun arrondi local, seuls `multiplyRoundHalfUp`, `allocHost` (via le moteur de règlement) et `sum` de `@rueda/money` ;
- aucune constante de pays : tout vient de `QuoteParams`, lu de CFG ; les tests lisent pays et devises des données ;
- aucune horloge : l'appelant passe l'instant serveur (`platform.now()`) dans `quotedAtMs` et `at` ;
- fail-closed : ligne non nulle sans règle fiscale ou groupe incohérent ⇒ `TAX_CONFIG_MISSING` ; paramètre absent, durée > `max_trip_days`, protection ou assistance sans part d'assureur figée, part hors de [0 ; 1] ⇒ `QUOTE_UNAVAILABLE` ; jambe négative (promotion trop forte) ⇒ `LEG_AMOUNT_NEGATIVE` ; `TRIP_PRICE` fourni par l'appelant, montant d'une autre devise, ligne négative hors promotion ⇒ `QUOTE_INPUT_INVALID` ;
- taxe d'un groupe `third_party` = `true` ⇒ jambe `TAX_THIRD_PARTY` ; défaut `false` ⇒ dans `PLATFORM` (BR-PRICE-12).

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

Aucun port. API publique (`index.ts`) : `PrcModule`, `QuoteService`, `billableDays`, `computeQuote`, `assembleQuote`, `quoteSettlementTrip`, `freezeQuote`, `replayFrozenQuote`, `resolveQuoteParams`, `QuoteError` et leurs types.

Paramètres lus (17 §7.2, aucun créé) : `grace_minutes`, `max_trip_days`, `host_default_plan`, `host_share_pct`, `delivery_share_pct`, `extras_share_pct`, `insurer_premium_share`, `insurer_roadside_share` ; `tax_line_config` du pays (`countries.json`, `taxLines`).

## Commandes de test

Commande unitaire (vitest, sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/prc`. Attendus : export des oracles Python (`docs/specs/tools/golden_vectors.json` par `@rueda/money/golden-vectors` ; trips de test de 08 E7 par `@rueda/money/testing`) et `verif15_ta.py` (TA01, TA07), jamais le code testé ; chaque cas tourne avec une devise à exposant 2 et une à exposant 0. Soutien commun : `apps/api/test/support/quote.ts`.

La table `core.pricing_tax_line_config` est couverte côté base par `packages/db/test/int/config-country.test.ts` : `pnpm --filter @rueda/db exec vitest run --config vitest.int.config.ts test/int/config-country.test.ts`. Ce test demande PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
