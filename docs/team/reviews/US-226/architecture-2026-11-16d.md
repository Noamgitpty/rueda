# Revue architecture — US-226 « écrans des protections et plans de gains » (PR n° 183, revue finale) — 2026-11-16

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : 76789a80..f438d89b

Contexte : CATALOG_VERSION, GL-18, ADR-137, documentation de fin de story, fusion de main (conflits résolus) ; diff 76789a80..f438d89b.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                      |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | INFO    | **Catalogue** : main est en version 56 (US-209a) ; la branche est en **57**, commentaire de version 57 placé après celui de la 56, attribution « 56 réservée à US-209a » corrigée dans le commentaire et le handoff. Aucun trou ni doublon ; les quatre langues partagent `CATALOG_VERSION`.                 |
| 2   | INFO    | **GL-17 / GL-18** : GL-17 reste la ligne d'US-209b (ADR-135) et celle d'US-226 est renumérotée **GL-18** ; toutes les références d'US-226 (ADR-137, README du site, POUR_LE_FONDATEUR, handoff) pointent GL-18, celles d'US-209 pointent GL-17. Aucune référence croisée résiduelle.                         |
| 3   | INFO    | **ADR-137** (PROPOSÉ) à jour (suites, GL-18) ; COMME_TURO.md : trois entrées US-226 conservées et trois entrées d'US-209 de main, sans perte ; changelog.d, README du site, handoff avec la section « Revues de la PR #183 » : DoD documentaire complète, textes en es / en / fr / pt-BR dans la même story. |
| 4   | INFO    | Découpage : `protectionChoiceOf` est dans `account/checkout.ts` (logique pure) ; aucun import de l'intérieur d'un autre module ; aucune migration, aucun changement de schéma ni de rôles pour 226b. `.github/`, `scripts/ci/`, `scripts/team/` et `review-requirements.json` non touchés.                   |
| 5   | MINEUR  | `docs/specs/` non mis à jour (ADR-136 et ADR-137 en 17 §8.1) : déjà tracé en suite du handoff, doit passer par une demande de fusion revue.                                                                                                                                                                  |
| 6   | MINEUR  | Le handoff écrit « âge facultatif (16 à 99) » ; la lecture de la réponse admet 0 à 150 : à dire en une phrase dans l'ADR à sa prochaine édition.                                                                                                                                                             |

Verdict : APPROUVÉ
