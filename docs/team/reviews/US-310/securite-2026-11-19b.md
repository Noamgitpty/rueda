# Revue sécurité (delta) — US-310 « aide, urgence et support » (PR n° 269) — 2026-11-19

Relecteur : revue-securite / claude-sonnet-5-5 (modèle autre que l'auteur claude-opus-5-5; revue dégradée : famille B indisponible, TECH-007)
Entrées : de747458..856109cb

Contexte : revue delta ; le rapport précédent (`securite-2026-11-19.md`, APPROUVÉ à de747458) reste valable pour tout ce qui n'a pas changé. Commits relus : 62b13f70 (retrait de la clé inutilisée `web.help.call`, texte et lien S17 vers `/trips`), 48a162ca (merge de main, #272 : CI e2e à 45 min, déjà revu sur sa propre PR, hors périmètre), 856109cb (434 références visuelles). `git diff de747458 856109cb` hors captures : catalogues i18n, annotation du paragraphe v97 de `catalogs/index.ts`, fichiers de #272 et revues déjà écrites ; aucune modification de `playwright.config.ts`, des seuils ni des specs. CI verte au SHA 856109cb (workflow ci, success).

| #   | Gravité | Constat                                                                                                                                                                                                                                                |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | INFO    | aucun changement de code serveur, migration, droit ou secret ; `.github/` et `docs/ops/CI.md` ne changent que par la fusion de #272 (revue sécurité propre sur cette PR). Le jeu de références n'ouvre aucun contournement : seuils et config intacts. |

Verdict : APPROUVÉ
