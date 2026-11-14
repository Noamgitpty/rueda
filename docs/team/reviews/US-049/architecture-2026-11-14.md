# Revue architecture — US-049 « délai des tests de @rueda/money » (PR n° 151) — 2026-11-14

Relecteur : architecture / claude-sonnet-5-5 (famille A, autre modèle que l'auteur claude-opus-5-5)
Entrées : e53b0662128e444081a6b1f0bd5f801038f13098..b1d42aad7ab3f843c15fe8a14b6439b810f7f99f

Relecture du diff `origin/main...b1d42aad7ab3f843c15fe8a14b6439b810f7f99f` (2 fichiers : `packages/money/vitest.config.ts`, `changelog.d/US-049-delai-tests-money.md`) ; comparaison avec les configurations Vitest des autres paquets.

| #   | Gravité (CRITIQUE/MAJEUR/MINEUR) | Constat                                                                                                                                                                                                                                                         |
| --- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MINEUR                           | Changement limité à la configuration d'un seul paquet : aucune frontière de module, aucun import, aucune API publique (`index.ts`) ni dépendance n'est touché ; le `include` du paquet est inchangé.                                                           |
| 2   | MINEUR                           | Cohérent avec `packages/db/vitest.unit.config.ts` et `packages/design-tokens/vitest.config.ts` : même clé `test.testTimeout`, même valeur 30_000, commentaire citant le run fautif. Une valeur par paquet, locale à la configuration, sans constante partagée à factoriser. |
| 3   | MINEUR                           | Aucune constante propre à un pays ni règle métier ajoutée (contrainte 3) ; la configuration de mutation du paquet est distincte et inchangée. Fragment de CHANGELOG conforme (lot L1, module Argent).                                                              |

Verdict : APPROUVÉ
