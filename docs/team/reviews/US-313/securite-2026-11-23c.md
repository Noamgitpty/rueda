# Revue securite (delta 2) — US-313 (suite de la red team du lot 3) (PR n° 296) — 2026-11-23

Relecteur : securite / claude-opus-5-5 (famille A ; autre modèle que l'auteur claude-sonnet-5-5)
Entrées : 42dfead1ab064c9f2d84319cb07297d7046a8da4..578cff39b8a516d9cffcfcb4bc856798a7b8e391 (`git diff`, `git diff -w`) ; cahier des charges : `securite-2026-11-23b.md` et `architecture-2026-11-23b.md` ; CI du run 45114932514 ; revue dégradée : famille B indisponible, TECH-007

**Delta.** Le delta est documentaire, sauf deux changements de test :

- **FRA-01** (`rt-l3-05-frais-annexes.test.ts:219-220`) : ajout d'un témoin de population, `toContain('CANCELLED_BY_HOST')`, avant le filtre `AWAITING_GUEST` ;
- **V08** (`rt-l3-07-chargeback-concurrence.test.ts:179, 195, 201`) : B est mémorisé dans `pendingB`, puis attendu par `Promise.allSettled` dans le `finally`, après `goA()`.

Aucune attaque, aucun montant et aucun oracle ne change, pas plus qu'un rôle, un interrupteur ou une migration.

**Ce que j'avais approuvé ne change pas.** Le delta ne touche ni `rt-l3-08` (D05, D06, inventaire des GRANT) ni les droits jugés par `rt-l3-06` et `rt-l3-07`. Les tests tournent toujours sous `app_worker` et `app_api`, et aucun interrupteur n'est écrit.

Le correctif de V08 ferme le n° 3 précédent : si `waitBlocked` expire, A est libéré, puis B est attendu, et seulement ensuite sa connexion est rendue. Le résultat d'erreur de B est déjà capturé par le `.then(…, …)`, donc `allSettled` ne masque rien.

La correction de NS02 rend l'index de porte exact : le versement `ON_HOLD` est déclaré non prouvé, à jouer avant la porte.

**CI au SHA 578cff39b8a516d9cffcfcb4bc856798a7b8e391** : le job « base de données » est vert, avec `3165 passed | 16 expected fail | 2 skipped`. Les 16 échecs attendus sont les 14 `it.fails` de la passe et les 2 de F-L3-PRE-03. `rt-l3-05` (20 tests), `rt-l3-06` (24), `rt-l3-07` (6) et `rt-l3-08` (14) sont verts. Les jobs « guide d'installation » et e2e sont également verts.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                           | Preuve (fichier:ligne, test)                                                      | Décision                                                                                       |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | MINEUR  | **Chemin d'échec de V08 : A n'est pas attendu dans le `finally`.** Si `waitBlocked` lève une erreur, `goA()` libère A, mais l'exception remonte sans attendre `a`. La connexion de A peut donc être rendue pendant son `COMMIT`. C'est sans effet sur un chemin vert, et le chemin d'échec rougit de toute façon. | `rt-l3-07-chargeback-concurrence.test.ts:198-202`                                 | Non bloquant. Ajouter `a` à l'attente du `finally` (`allSettled`) dans la passe de correctifs. |
| 2   | MINEUR  | **Reconduits** : les n° 1 (témoin de D06 lâche) et 2 (liste des commandes de travailleur jugées pour `app_api`) de `securite-2026-11-23b.md`, ainsi que la règle « lecture par trip » des données committées.                                                                                                     | `rt-l3-08-donnees.test.ts:338, 427, 433-436` ; `rt-l3-06-sinistres.test.ts:14-18` | Non bloquant. À reprendre dans la passe de correctifs.                                         |

Verdict : APPROUVÉ
