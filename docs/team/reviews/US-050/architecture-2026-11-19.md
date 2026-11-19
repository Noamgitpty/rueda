# Revue architecture — US-050 « US-535a au backlog et au registre des revues » (PR n° 260) — 2026-11-19

Relecteur : architecture / claude-sonnet-5-5 (famille A, autre modèle que l'auteur claude-opus-5-5)
Entrées : d97a1936a0e2dab257ea181a8f28f0ed110c0d61..c79cb0e24f5bca908edce9fda97dca5c8479f6f7

Relecture statique du diff `origin/main...c79cb0e2` (2 fichiers : `docs/specs/19_DEVELOPMENT_BACKLOG.md`, `docs/team/review-requirements.json`) ; JSON comparé à `origin/main` par script ; `check_backlog.py` : RÉSULTAT OK ; `verif19_backlog.py` : 183 lignes avant comme après (aucune régression).

| #   | Gravité (CRITIQUE/MAJEUR/MINEUR) | Constat                                                                                                                                                                                                                                                                                    | Preuve (fichier:ligne, test)     | Décision            |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ------------------- |
| 1   | MINEUR                           | Découpage cohérent : US-535a (L2, tranche bêta OUI, 5 pts, dépendances US-110 / US-125 / US-222 de lots 1 et 2) avance la seule partie serveur ; l'écran reste dans US-535 (L5, NON). Même mécanique que US-709a / US-223e.                                                                | 19 l. 3180, 3187-3210            | OK                  |
| 2   | MINEUR                           | Mécanique reprise de 0073 vérifiée : 72 h, `ALREADY_PENDING`, `EXPIRED`, `CANCELLED`, `param_definition.go_live_switch` (0008) et déclencheur `param_value_go_live_guard` existent ; 0155 (garde `support_staff_conflict`, PR n° 259) pas encore fusionnée, ce que « Bloqué par » déclare. | 0073 l. 27, 71, 524 ; 0008 l. 74 | OK                  |
| 3   | MINEUR                           | Écart à documenter par l'ADR de la story : 0073 fait approuver un interrupteur par un SUPERADMIN seul, alors qu'ici l'approbateur est ADMIN ou SUPERADMIN avec `config.param_write` (17 §2.3 l. 356). Défaut cohérent avec la matrice, mais à inscrire explicitement dans 17 §2.3.         | 19 l. 3194 ; 17 l. 356, 586      | Suivi dans la story |
| 4   | MINEUR                           | Les 5 pts ne sont pas comptés en §7 : acceptable, car les contrôles ne lisent que les titres `####` à trois chiffres et la note de découpage l'énonce ; le total L2 du BOARD (140 pts) est à rappeler comme hors tranche.                                                                  | 19 l. 3187                       | Accepté             |

Verdict : APPROUVÉ
