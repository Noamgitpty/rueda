# Revue architecture — US-222 « correctifs de la red team argent du lot 2, partie 222d (branche story/US-222-correctifs-argent, migration 0155, ADR-176) » (PR n° 257) — 2026-11-19, seconde passe

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : d97a1936..4c53a1ef

Contexte : seconde passe sur la tête 4c53a1ef08044ff46d3bd64fc34d1c8c5a157b55 (diff de correction 5303d408..4c53a1ef : 8 fichiers). CI du run 44485011468 verte. Le SQL exécutable de `0155_redteam_l2_money_fixes.sql` est inchangé (le diff ne touche que des lignes de commentaire, vérifié en écartant les lignes `--` : aucune différence).

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | INFO    | Reformulation de la migration, de l'ADR-176, du README de `packages/db` et du commentaire de `stl-schema.test.ts` cohérente entre elle et avec le code : politique de gel hors `payment_command`, borne HOST par le déclencheur, garde contre le dégel. Fixture 9931 dans `test-migrations/` comme les autres ; passation mise à jour pour US-709. Point 5 de la première passe levé. |
| 2   | MINEUR  | Numéro de migration `0155` encore partagé avec la PR n° 259 : la seconde fusionnée se renumérote en `0156` ; inchangé.                                                                                                                                                                                                                                                                |

Verdict : APPROUVÉ
