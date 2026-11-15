# Revue securite — US-222 « recalage des spécifications du lot 2 » (PR n° 166) — 2026-11-15

Relecteur : revue-securite / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5; revue dégradée : famille B indisponible, TECH-007)
Entrées : 734248df99cc895b56191053fd316be73a2afeb2..19ab6fcaca880446aac9b5e57071682b80e6decf

Contexte : delta `c1f3e12c..19ab6fca`. `registry.json` : une seule ligne modifiée ; aucun fichier de `.github/`, `scripts/ci/`, `scripts/team/` ni `review-requirements.json` touché ; `check-spec-tools.py` : OK (12 outils).

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MINEUR  | Motif de `registry.json` : `^ECARTS sur T01-T48 : 0$` devient `^ECARTS sur T01-T48 et T74-T80 : 0$`. Il reste ancré (début et fin de ligne) et exige toujours **0 écart** ; l'oracle imprime cette ligne avec le cumul `bad` de tous les vecteurs, T74 à T80 compris. Les motifs interdits (`ECART`) et les comptes (49 et 58) sont inchangés : rien n'est relâché. |
| 2   | MINEUR  | Aucun changement de RLS, de rôle, de droit ni d'interrupteur ; les autres fichiers du delta sont de la documentation et un commentaire de test.                                                                                                                                                                                                                     |

Verdict : APPROUVÉ
