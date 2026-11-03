# packages/golden-vectors — harnais des vecteurs dorés (`@rueda/golden-vectors`)

Livré par **US-016** (lot 0, story argent). Le paquet charge les **vecteurs dorés** de la spécification et compare un résultat observé (moteur de règlement US-017, jambes US-018…) aux **attendus des oracles Python**. Il ne calcule aucun montant : les attendus ne viennent jamais du code testé (CLAUDE.md, contrainte 4 ; 19 US-016).

Point d'entrée unique : `src/index.ts` (`import { … } from '@rueda/golden-vectors'`). TypeScript pur, sans dépendance d'exécution.

## D'où viennent les attendus

```
08 / 16 (tables T, TJ, TA)  ──►  oracles de docs/specs/tools/  ──►  export_golden_vectors.py  ──►  golden_vectors.json  ──►  ce paquet
```

- `docs/specs/tools/export_golden_vectors.py` charge les oracles **tels quels** (aucune ligne recopiée) :
  - T01–T48 : `independent_settlement_check.py` (`compute` et `run_execution_vectors`) ;
  - TJ01–TJ21 : `check_legs.py` (`EXPECTED`) ;
  - T49–T68 : contrôles de `check_t49plus.py`, `check_verif12_fixes.py`, `check_t66_68.py` ;
  - TA01–TA11 : `check_ta_consolidation.py` et `verif15_ta.py`.
- Chaque attendu est comparé à la valeur recopiée par l'oracle **et** aux cellules de la ligne de 08 (T01–T48, TJ). Un écart fait échouer l'export.
- En CI (job « oracles », registre `docs/specs/tools/registry.json`), le script régénère l'export et le compare **octet par octet** à `golden_vectors.json`. Une modification de 08, d'un oracle ou du JSON à la main fait échouer la CI.
- Régénérer après une révision de 08 approuvée : `cd docs/specs && python -I -X utf8 tools/export_golden_vectors.py --write`.

## Contenu de l'export (format 1)

| Bloc         | Contenu                                                                                                                                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `currencies` | devises de **test** des oracles et leur exposant (USD 2, PYG 0) : des données, pas des constantes du code                                                                                                                                                                                              |
| `settlement` | 42 vecteurs de règlement T01–T48 : trip (lignes en unités mineures, groupes de taxe, parts figées, réservation), événement (motif, horodatages relatifs à T = 0, drapeaux), attendus des colonnes de 08 et détail de l'oracle (retenu HT, taxe retenue, part du guest, compensation, motif requalifié) |
| `legs`       | 58 lignes TJ01–TJ21 (08 E7) : jambes `HOST`, `INSURER`, `TAX_THIRD_PARTY`, `PLATFORM` et total ; nature `ALLOCATION`, `VARIATION`, `REFUSED_CAPTURE` ou `CHARGEBACK_LOSS`                                                                                                                              |
| `checks`     | attentes des contrôles `check(label, obtenu, attendu)` des oracles : T28–T36, T47 (couche d'exécution) et T49–T68, TA ; valeurs typées (`bigint`, fraction, texte, booléen, listes, objets)                                                                                                            |
| `acceptance` | TA01–TA11 (16 A.8.1) : libellés des contrôles, renvois aux TJ, attentes de `verif15_ta.py` (TA04, TA07, TA09)                                                                                                                                                                                          |

Tout montant est un **`bigint` en unités mineures** ; dans le JSON, un montant est un entier écrit en texte (`"25666"`), jamais un nombre JSON. La pénalité hôte est donnée en unités majeures (colonne de 08) et en unités mineures (T62).

**Statut normatif.** `normative: false` pour T17, T18, T20 (option A de DEC-FONDATEUR-01, non décidée ; le défaut fail-closed est T61) et pour T48 / T62 en PYG (pénalité PROPOSÉE, OQ-BR-24). T55 n'a pas de variante. Un moteur ne doit asserter ces vecteurs que derrière le paramètre correspondant.

## API

- `loadGoldenVectors(path?)` : lit, valide et convertit l'export (mis en cache pour le chemin par défaut `GOLDEN_VECTORS_PATH`).
- `parseGoldenVectors(json)` : validation **fail-closed** ; clé inconnue ou manquante, montant non entier ou écrit en nombre, devise absente, identifiant en double, format inconnu ⇒ `GoldenVectorsError` (`GOLDEN_VECTORS_INVALID`).
- Accès : `settlementVectors(set, { currency, normativeOnly })`, `legVectors(set, { currency, kind, normativeOnly })`, `settlementVector(set, id)`, `legVector(set, id)` (identifiant absent ⇒ `GOLDEN_VECTOR_NOT_FOUND`), `checksFor(set, 'T54')` (rend aussi T54a, T54b).
- Comparaison exacte : `compareSettlement(vector, observed, fields?)` (par défaut les colonnes de 08, `SETTLEMENT_COLUMNS_08`), `compareLegs(vector, observed)`, `compareAmounts(...)`. Un champ absent ou qui n'est pas un `bigint` est un écart.
- `replay(vectors, engine, compare)` : rejoue un moteur sur une liste de vecteurs ; une exception du moteur est un écart, jamais un vecteur ignoré.

Exemple (US-017) :

```ts
import {
  compareSettlement,
  loadGoldenVectors,
  replay,
  settlementVectors,
} from '@rueda/golden-vectors';

const set = loadGoldenVectors();
const report = replay(
  settlementVectors(set, { normativeOnly: true }),
  (v) => toObservation(engine(toInput(v))),
  compareSettlement,
);
expect(report.mismatches).toEqual([]);
```

L'adaptateur `toInput` / `toObservation` (entrée et sortie du moteur) appartient à la story du moteur : ce paquet ne fige pas l'API du moteur.

## Règles

- Le moteur (US-017) est écrit par un **autre agent** que celui de ce harnais et de l'oracle (19 §1.5, US-016 critère 3).
- Une **variante PYG** d'un vecteur USD (`T…-PY`) n'est assertée qu'après avoir été produite par l'oracle **et reportée dans 08** par une demande de fusion sur la spécification (19 US-016 critère 2). Aucune n'est ajoutée par US-016.
- Ce paquet n'importe aucun moteur et n'est importé par aucun code de production.

## Tests

`pnpm --filter @rueda/golden-vectors test:unit` : couverture T01–T68, TJ01–TJ21, TA01–TA11 dans les deux devises ; ancrages recopiés de 08 et 16 ; équilibres de 08 sur les données (`remboursement + retenu HT + taxe retenue = total payé`, Σ jambes = total, signes des jambes) ; recoupements TJ ↔ T ; lecture fail-closed ; comparateurs (écart d'une unité détecté). Le `turbo.json` du paquet déclare l'export comme entrée des tâches pour que le cache se périme quand il change.
