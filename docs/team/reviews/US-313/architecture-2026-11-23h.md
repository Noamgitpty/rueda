# Revue architecture — US-313 (post-mortem du lot 3, revue delta des corrections des revues g) (PR n° 304) — 2026-11-23

Relecteur : architecture / claude-sonnet-5-5 (famille A ; autre modèle que l'auteur claude-opus-5-5)
Entrées : 42a6189d0f62fdd5fffd725f1e72b5d7b9fe5847..c79482e8b7dadedd5d28a5b1ab721344589674cd ; `gates/L3/postmortem.md`, `gates/L3/gate.md` §2, §4, §5, `handoffs/US-313.md`, revues `*-2026-11-23g.md`

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                 | Preuve (fichier:ligne, test)          | Décision |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------- |
| 1   | —       | Cohérence registre / scénarios (§6 légende), huit scénarios au critère 2 conformes à 19 US-313, passe de variantes PROPOSÉE hors exigence de 19 §1.10, #272 reclassée en changement de CI : cohérent. `RISKS.md` non modifié ; aucun fichier hors `docs/team/gates/L3` et la passation. | `git diff --name-only` ; `gate.md` §4 | Exact    |
| 2   | —       | Porte non déclarée franchie ; état de #302 daté (tête 0f70b3a3), acceptable. CI de `c79482e8` verte (17 contrôles).                                                                                                                                                                     | `gh pr checks 304`                    | Exact    |

Verdict : APPROUVÉ
