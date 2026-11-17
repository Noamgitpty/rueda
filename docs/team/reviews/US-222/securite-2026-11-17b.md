# Revue securite — US-222 « report dans docs/specs/ des ADR-142, 143, 145, 147, 148 (quatrième série, branche story/US-222-specs-reports-l2d) » (PR n° 208) — 2026-11-17, seconde passe

Relecteur : revue-securite / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5 ; revue dégradée : famille B indisponible, TECH-007)
Entrées : 8fca55f1..290c662b

Contexte : seconde passe sur la tête 290c662b (diff de correction 8fca55f1..290c662b, diff complet origin/main...290c662b). `python -I -X utf8 scripts/ci/check-spec-tools.py --specs docs/specs` : RÉSULTAT OK (sortie régénérée de `verif18_crossref` restaurée, non commitée). CI de la PR verte hors « pnpm audit » (avis picomatch, PR #221, sans lien). Chemins protégés, 08 et `docs/specs/tools` non touchés.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | INFO    | 17 §2.3 : signature réservée au voyageur (autre personne ⇒ `NOT_FOUND`), lecture voyageur ou hôte, `EXECUTE` inchangés ; IP et user-agent non enregistrés en bêta (`c2_withheld`) : conforme à 0122 et ADR-143. Refus `409 STAFF_ACTION_REFUSED` / `403 STAFF_SELF_FORBIDDEN` : séparation décrite exactement (garde ADR-122 et journal `MANUAL_ACTION_REFUSED` inchangés). |
| 2   | INFO    | ADR-153 : lecture du `host_ledger` FINANCE / ADMIN du pays seulement, commande sans `EXECUTE` applicatif : fidèlement décrit. Aucun secret, aucun chemin protégé touché.                                                                                                                                                                                                    |
| 3   | INFO    | Aucun nouveau défaut introduit par le diff de correction. Aucune décision du fondateur prise (`host_advance_cap_minor`, OTP de signature GL-23, DEC-FONDATEUR-01 restent PROPOSÉ ou à décider).                                                                                                                                                                             |

Verdict : APPROUVÉ
