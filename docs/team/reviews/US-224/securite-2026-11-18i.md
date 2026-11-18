# Revue securite — US-224 « durcissement avant ouverture d'un pays (N-354, N-342, N-313) » (PR n° 247, delta après fusion de main et renumérotation 0147 → 0148) — 2026-11-18

Relecteur : revue-securite / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5; revue dégradée : famille B indisponible, TECH-007)
Entrées : 6b0fc3e5..8474b1cf97b1e7924ac3b396ab280f9f1f4c2b66

Contexte : seconde passe après la fusion de `origin/main` (#244, US-212b, migration 0147) dans la branche et la renumérotation du durcissement en 0148. Revue 2026-11-18h (APPROUVÉ au SHA f4020a39) inchangée sur le fond. Comparaison `git diff 6090e0ed 8474b1cf` limitée aux fichiers propres à la PR.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                       |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | INFO    | Migration renommée 0147 → 0148 : le diff du fichier se réduit à la ligne d'en-tête (« 0147 » → « 0148 ») ; corps SQL identique à la version relue (fonctions, GRANT, graine).                                                                                                                                                                 |
| 2   | INFO    | Fixture 9935, trois L0, ADR-159, ADR-171, README avl / cat / sup, passation US-224 : identiques à la version relue après remplacement de 0147 par 0148 (la passation ajoute en plus la mention de la fusion de #244 dans la note de renumérotation).                                                                                          |
| 3   | INFO    | Conflits : `schema.md` = main plus deux lignes (compte « 149 migrations », ligne 0148) ; `packages/db/README.md` = section US-212b de main conservée, section du durcissement ajoutée.                                                                                                                                                        |
| 4   | INFO    | La migration 0147 de #244 (`ctr_constancia_frozen_host_checkout_host`) ne redéfinit ni `booking_trip_receipt`, ni `booking_manual_action_cancel_host_trips`, ni `catalog_value_class_resolve` : aucun écrasement entre les deux migrations. Les apports de main (allowlist SECURITY DEFINER, i18n, e2e, fixture 9938) sont étrangers à la PR. |

Verdict : APPROUVÉ
