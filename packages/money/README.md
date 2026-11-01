# packages/money — primitives monétaires (`@rueda/money`)

Livré par **US-015** (lot 0, story argent). C'est la **bibliothèque monétaire unique** du dépôt (16, fiche PRC-021) : tout calcul de montant passe par elle, sans contournement. Le paquet est en TypeScript pur, **sans dépendance d'exécution** ; seul `fast-check` est ajouté, pour les tests.

Point d'entrée unique : `src/index.ts` (`import { … } from '@rueda/money'`).

## Règles appliquées

| Règle                                                                                                                                                                                                                         | Source                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `Money{amountMinor: bigint, currency}` en unités mineures. Aucun `number` pour un montant.                                                                                                                                    | 08 BR-PRICE-14 (1), 17 §1.2, ADR-009           |
| L'exposant de la devise vient de la **configuration** (`config.currency`). Le code ne contient aucun code de devise ni aucun exposant.                                                                                        | 17 §1.2 et §3.2 (`currency`), ADR-024, ADR-033 |
| Les ratios sont des **fractions exactes** `bigint` et l'arrondi n'a lieu qu'en produisant un montant de ligne.                                                                                                                | 17 §1.2, 08 pseudo-code BR-CXL                 |
| `roundHalfUp(q) = floor(q + 1/2)` : demi-unité vers +∞, **aussi pour une valeur négative** (−2,5 → −2).                                                                                                                       | 08 pseudo-code BR-CXL                          |
| `allocHost(m, pct)` : `x = m × pct`. Le résultat vaut `floor(x)` si `frac(x) ≤ ½`, sinon `ceil(x)`. On arrondit au plus proche ; en cas d'égalité exacte, le résidu va à la plateforme. Ce n'est pas un « plus grand reste ». | 08 BR-PRICE-14 (3), vecteur T40                |
| La taxe se calcule **par ligne, puis on somme** : `Σ roundHalfUp(ligne × taux)`, jamais `roundHalfUp(taux × Σ lignes)`.                                                                                                       | 08 BR-PRICE-12, BR-PRICE-14 (2), T43           |
| Aucune opération entre devises différentes, et aucune conversion.                                                                                                                                                             | 16 PRC-021, 08 BR-PRICE-14 (5)                 |
| Un montant est **signé** : une ligne promo est négative, le net plateforme peut l'être. Un **montant d'écriture** est strictement positif : `requirePositive`.                                                                | 08 BR-PRICE-16, E4 ; 17 §3.1.5, §3.2           |
| Un montant est borné à l'intervalle **int64** de la colonne `bigint`. Au-delà, l'opération est refusée : il n'y a jamais de troncature. Les produits intermédiaires restent exacts.                                           | 17 §3.1.5                                      |
| Chemin « pilote → chaîne → `bigint` » : `parseMinor("25666")`, `parseRatio("0.07")`. Aucun `number` flottant n'intervient.                                                                                                    | 19 US-015, 17 §1.2                             |

## API

- **Devises**
  - `createCurrencyRegistry([{ code, exponent }])` : construit le registre à partir de la configuration. `get(code)` renvoie la devise, ou lève `CURRENCY_UNSUPPORTED`.
  - Une `Currency` ne s'obtient que par le registre. Une devise fabriquée à la main est refusée.
- **Construction**
  - `money(bigint, currency)` : un `number` y est refusé.
  - `moneyFromSafeInteger(number, currency)` : seul point d'entrée d'un `number`, à condition que ce soit un entier sûr.
  - `parseMinor(text, currency)` : lit un entier en unités mineures.
  - `parseMajor(text, currency)` : lit des unités majeures avec l'exposant configuré. Les décimales en trop sont refusées, jamais arrondies.
  - `zero(currency)`.
- **Sérialisation**
  - `toMinorString`.
  - `toMajorString(m, currency)` : point décimal, sans formatage local (le formatage relève de I18N-004).
  - `moneyToJSON` : `{ amountMinor: "…", currency }`.
- **Arithmétique**
  - `add`, `subtract`, `negate`, `sum(currency, list)`, `multiplyByInteger`.
  - Comparaisons : `compare`, `equals`, `max`, `min`, `isZero`, `isNegative`, `isPositive`, `requirePositive`.
- **Fractions**
  - `ratio(num, den)` : composants `bigint`.
  - `parseRatio("0.07" | "3/4")`.
  - `multiplyRatios`, `compareRatios`, `ratioToString`.
  - `ratioOf(part, whole)` : fraction formée de deux montants de même devise.
- **Arrondis** (les seuls du dépôt)
  - `roundHalfUp(ratio) → bigint`.
  - `multiplyRoundHalfUp(m, ratio)` = `roundHalfUp(m × ratio)` : retenue `P × j / days`, taxe d'une ligne, commission, prorata.
  - `taxByLine(currency, lines, rate)`.
  - `allocHost(m, pct)` : `pct` doit être dans [0 ; 1].
  - `splitHostPlatform(m, pct)` → `{ host, platform }` : la plateforme prend le complément.

## Codes d'erreur (`MoneyError.code`, stables, sans préfixe)

| Code                      | Statut                 | Cas                                                                         |
| ------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `MONEY_CURRENCY_MISMATCH` | référence (16 PRC-021) | opération entre deux devises                                                |
| `CURRENCY_UNSUPPORTED`    | référence (16 PRC-021) | devise non configurée ou fabriquée hors registre                            |
| `CURRENCY_CONFIG_INVALID` | PROPOSÉ                | code non ISO, exposant invalide, doublon                                    |
| `MONEY_INVALID_AMOUNT`    | PROPOSÉ                | `number` non entier sûr, chaîne mal formée, trop de décimales, faux `Money` |
| `MONEY_OUT_OF_RANGE`      | PROPOSÉ                | résultat hors de l'intervalle int64                                         |
| `MONEY_NOT_POSITIVE`      | PROPOSÉ                | montant d'écriture ≤ 0                                                      |
| `RATIO_INVALID`           | PROPOSÉ                | dénominateur nul, composant non `bigint`, chaîne illisible                  |
| `SHARE_OUT_OF_RANGE`      | PROPOSÉ                | part `allocHost` hors de [0 ; 1]                                            |

Les codes PROPOSÉS sont à reporter au catalogue de 16 A.8 par une demande de fusion sur `docs/specs/`.

## Tests

`pnpm --filter @rueda/money test:unit` lance Vitest et fast-check, en variantes **PA (USD, exposant 2)** et **PY (PYG, exposant 0)**. Les devises de test sont dans `test/fixtures.ts`.

- `test/vectors.test.ts` rejoue **T40, T42 et T43** (08) ainsi que **TA06** (16 A.8.1), étape par étape. Les valeurs attendues sont recopiées de 08 et de 16, puis confirmées par `independent_settlement_check.py`, `verif11_settlement.py` et `verif15_ta.py` (`python -I -X utf8`, depuis `docs/specs/tools/`).
- `test/properties.test.ts` vérifie les propriétés suivantes :
  - part hôte + part plateforme = total ;
  - l'écart de `allocHost` est ≤ ½ par ligne et ≤ 1,5 sur trois lignes, et une égalité exacte va à floor ;
  - l'écart de `roundHalfUp` est dans ]−½ ; ½] ; l'arrondi est symétrique hors égalité, et une égalité va vers +∞ ;
  - l'écart entre la taxe par ligne et la taxe agrégée est borné ;
  - aucun débordement : l'arithmétique est exacte sur tout int64, et un résultat hors bornes est refusé explicitement.
- Les autres fichiers couvrent la construction, les refus et les vecteurs d'arrondi cités dans 08 (T09, T35, T55).

Ces tests ne sont pas un oracle. Le moteur de règlement (US-016) se compare aux scripts Python de `docs/specs/tools/`.
