# Revue architecture — US-224 « durcissement argent n° 2 (N-364, N-365, N-367) » (PR n° 251) — 2026-11-18

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : d64b8a1f..781f6b63

Contexte : PR n° 251, branche `story/US-224-durcissement-argent`, SHA relu 781f6b63f1e249a71630067e0cd56487534e4c6a (merge-base d64b8a1f). Relue dans un worktree détaché ; aucune base ni conteneur démarrés (les preuves L0 se lisent, la CI fait foi).

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                    |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | INFO    | Frontières : STL (ordonnanceur, processeur des annulations) n'appelle que les commandes via `PgRefundOrders` de PAY (`index.ts`) ; aucun import interne d'un autre module ; aucune dépendance nouvelle (`dependency-graph.ts` inchangé). L'erreur de base est traduite dans `packages/db/src/errors.ts` (une entrée).      |
| 2   | INFO    | Ordre des verrous : décision claire et documentée (trip puis instance ; tableau de la passation, ADR-166 n° 7, ADR-150, commentaires de 0151, README stl / db / pay). L'ordonnanceur appelle `awaitChoice` puis `markAlerted`, et la base impose l'ordre quel que soit l'appelant (défense en profondeur) : bon compromis. |
| 3   | INFO    | Expand / contract : trois corps remplacés à signature et droits identiques ; retour arrière écrit dans l'en-tête. Migration 0151 (renumérotée après #248), catalogue v88, fixture 9933 : numérotation cohérente avec main. `schema.md` mis à jour (152 migrations, ligne 0151).                                            |
| 4   | INFO    | ADR : 166 (décisions 7 à 9, PROPOSÉ, limite barrée) et 150 complétés, aucun ADR nouveau (172 et 173 prises). Passation, changelog et READMEs à jour ; aucune modification de `docs/specs/`.                                                                                                                                |
| 5   | INFO    | N-367 est un refus fail-closed dont la réouverture est datée (module des crédits, lot C) ; aucune constante de pays.                                                                                                                                                                                                       |
| 6   | INFO    | Le BOARD n'est pas modifié par la story : statut de N-364, N-365, N-367 à mettre à jour par l'orchestrateur à la fusion.                                                                                                                                                                                                   |

Défaut bloquant : aucun.

Verdict : APPROUVÉ
