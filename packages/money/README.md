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

## Moteur de règlement des annulations, sous-ensemble bêta (US-017)

`computeCancellationSettlement(trip, event, params)` (`src/settlement/`, exporté par `@rueda/money`) : fonction **pure et versionnée** (`CANCELLATION_ENGINE_VERSION`, recopiée dans chaque règlement) qui suit la table de décision et le pseudo-code de 08 (BR-CXL) et rend aussi les **jambes** de 08 E7. Décisions : [ADR-054](../../docs/adr/ADR-054-moteur-reglement-annulation-beta.md).

- **Entrées** : `trip` (segment, lignes en `Money`, groupes fiscaux figés avec `thirdParty`, total payé contrôlé, parts figées hôte / livraison / Extras / assureur), `event` (motif, `requestedAtMs` serveur, faits établis : `hostMessageTraced`, `checkinValidated`, `hostNoShowReportedBefore`, `additionalDriverApproved`, `evidenceValidated` + `subReason`, `hostPenaltyWaived`), `params` (paramètres pays résolus par la configuration US-013 : `noShowGraceMinutes`, `lastMinuteThresholdHours`, `freeCancelLeadHours`, `platformFundedHostCompensation`, `hostPenalty`). Aucun défaut silencieux : un fait requis absent ⇒ `SETTLEMENT_INPUT_INVALID`, un paramètre requis absent ⇒ `SETTLEMENT_CONFIG_INVALID`.
- **Motifs bêta** (`BETA_CANCELLATION_REASONS`) : `GUEST_CANCELLED`, `GUEST_NO_SHOW`, `HOST_CANCELLED_DUE_TO_GUEST`, `PLATFORM_INCOMPLETE_STEPS`, `GUEST_FRAUD_PROVEN`, `HOST_CANCELLED`, `HOST_NO_SHOW`, `PLATFORM_TRUST_SAFETY`, `HOST_ACCOUNT_CLOSED`, `PLATFORM_REVIEW_DELAY`, `PSP_FAILURE`. Tout autre motif ⇒ `SETTLEMENT_REASON_NOT_SUPPORTED`.
- **Sortie** : motif qualifié et origine, remboursement et retenue par ligne, taxe par groupe, `guestRefund`, `taxRefund`, `retained`, `retainedTax`, `hostFromGuest`, `hostCompensation` (0 sauf `true` exact, DEC-FONDATEUR-01), `hostEarnings`, `platformNet`, `hostPenalty` (hors jambes), `captureLegs`, `settledLegs`, `legVariation`, `negativeLeg`. L'équilibre `remboursement + retenu HT + taxe retenue = total payé` est vérifié à chaque appel (`SETTLEMENT_UNBALANCED`).
- **Aussi exportés** : `computeCaptureLegs`, `computeLegs`, `legVariation`, `freeUntil`, `SettlementError` (codes `SETTLEMENT_ERROR_CODES`, PROPOSÉS sauf `REJECTED_TOO_EARLY` de 08).

Tests (`test/settlement/`) : vecteurs T et TJ de la story rejoués par `replay` / `compareSettlement` / `compareLegs` sur l'export des oracles, en USD et en PYG ; T61, T62 par les contrôles des oracles ; invariants de 08 par vecteur ; propriétés fast-check en PA et PY ; entrées refusées. Aucun montant attendu n'est écrit à la main.

## Règlements persistés, versions et jambes (US-018)

`src/settlement/record.ts`, exporté par `@rueda/money`. Décisions : [ADR-057](../../docs/adr/ADR-057-reglements-persistes-versions-jambes.md).

- `buildSettlementRecord(trip, event, params, previous?)` appelle le moteur et rend la **version** à persister par `core.settlement_cmd_record` (migration 0027) : montants de l'en-tête, lignes, taxes par groupe, 4 jambes `{ keptMinor ≥ 0, advanceMinor, basisMinor, variationMinor }`, `inputsHash` et `paramSnapshotHash` (SHA-256 hexadécimal d'une sérialisation canonique, `canonicalJson`). Sans `previous` : version 1, base = jambes de capture (une jambe capturée négative ⇒ `LEG_AMOUNT_NEGATIVE`, capture refusée, TJ13 a / c). Avec `previous` : version n+1, base = jambes signées de la version n (`signedLegs`), même devise et même total payé.
- **`PLATFORM` retenue négative** (`negativeLeg`, 08 E7 règle 5) : `keptMinor = 0`, `advanceMinor` = manque avancé par Kmino, `negativeLeg = true` (revue FIN, ordres `PLANNED`) ; le remboursement n'est jamais réduit. Une autre jambe négative ⇒ `LEG_AMOUNT_NEGATIVE`.
- `inputs` : entrées canoniques (`settlementInputsCanonical`, `canonicalJson` refuse `Date`, `Map`, `Set` et instances) conservées en base ; `inputsHash` = SHA-256(`SETTLEMENT_INPUTS_HASH_PREFIX` ‖ `inputs`). Une version n+1 exige la même version du moteur, la même devise et le même total payé.
- Sous-chemin **réservé aux tests** `@rueda/money/testing` (`test/settlement/adapter.ts`) : entrées de 08 (paramètres de test, trips N, NP, J, J3) pour les preuves de `packages/db`.
- `settlementDelta(v n, v n+1)` : écart ligne par ligne et par jambe (08 E4, T36).
- `settlementRecordPayload(record)` : charge utile JSON (format 1, montants en chaînes d'entiers).
- `settlementOperationKey({ tripRef, segmentNo, version, operation, tenderId, instanceSeq, attemptNo })` : clé `…:v{version}:{opération}:{moyen}:i{n}:a{n}` de 08 E4 ; `pspIdempotencyValue(clé, limite)` : la clé, ou son SHA-256 si elle dépasse la limite du PSP ; une limite < 64 est refusée (la valeur ne dépasse jamais la limite).
- Seule dépendance nouvelle : `node:crypto` (SHA-256), module intégré de Node ; aucune E/S.

Tests (`test/settlement/record.golden.test.ts`) : TJ01 / TJ02a / TJ02b (T03, USD), TJ08a / TJ08b (T27, PYG), TJ18a, TJ18c, contrôle T36 (delta et pénalité), TJ13 a à d (N, NP refusés ; N_MAX, NP_MAX avec avance), clés de T49 / T50 ; tous les attendus viennent de l'export des oracles.

## Harnais des vecteurs dorés (US-016)

Le sous-chemin `@rueda/money/golden-vectors` (`src/golden-vectors/`), **réservé aux tests**, charge les attendus exportés par les oracles Python de `docs/specs/tools/` (T01–T68, TJ01–TJ21, TA01–TA11, en USD et en PYG) et compare un moteur (US-017, US-018) à ces attendus, sans jamais les recalculer. Il n'est pas exporté par `@rueda/money`. Voir [`src/golden-vectors/README.md`](src/golden-vectors/README.md).

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
