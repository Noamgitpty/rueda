# Revue securite — US-209 « contrôles bloquants et revue de chaque réservation (partie serveur) » (PR n° 177, revue finale) — 2026-11-16

Relecteur : revue-securite / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5 ; revue dégradée : famille B indisponible, TECH-007)
Entrées : efd1fa70..301fef60

Contexte : `git diff --stat 8aa6cb30..301fef60` vérifié : cinq fichiers de documentation (ADR-135 décision 3, `GO_LIVE_CHECKLIST.md` GL-17, `COMME_TURO.md`, `POUR_LE_FONDATEUR.md` §4.1 ter, passation), aucune migration, aucun code, aucun test, aucune allowlist, aucun fichier de `.github/`, `scripts/ci/`, `scripts/team/` ni `review-requirements.json`. Le verdict du 2ᵉ passage (APPROUVÉ à 8aa6cb30) tient : droits (`EXECUTE` au seul `cmd_hold_owner` pour `kyc_checkout_driver`, politique de lecture de la configuration bornée à deux clés, sonde de test dans `test-migrations`), RLS et fail-closed inchangés. CI verte à 301fef60 (non rejouée).

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MINEUR  | Aucun constat bloquant du 2ᵉ passage n'était ouvert ; le delta est documentaire et ne modifie aucune surface d'attaque. Les textes ne promettent plus un journal du signal du permis étranger (jeté quand le réglage vaut `false`) ni une déclaration d'entrée disponible : ils décrivent un état plus restrictif en données collectées, dans le sens de la minimisation. |
| 2   | MINEUR  | GL-17 ajoute à la mise en service la vérification en production de `foreign_license_review_enabled` à `false` tant que 209b n'est pas fusionnée : cohérent avec la règle des interrupteurs par pays (valeur absente ⇒ revue, jamais l'inverse).                                                                                                                           |

Verdict : APPROUVÉ
