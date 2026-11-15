# Revue securite — US-222 « recalage des spécifications du lot 2 » (PR n° 166) — 2026-11-15

Relecteur : revue-securite / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5 ; revue dégradée : famille B indisponible, TECH-007)
Entrées : 734248df99cc895b56191053fd316be73a2afeb2..825b9b61e5f4fa89b46294667a48d87b3535a679

Contexte : lecture statique. Le diff ne touche aucun fichier sous `.github/`, `scripts/ci/`, `scripts/team/` ni `docs/team/review-requirements.json`. `docs/specs/tools/registry.json` : seuls un commentaire et deux comptes changent (42 vers 49 vecteurs, ligne attendue « exportés : 49 »), aucun motif `require` ou `forbid` relâché ou supprimé ; `check-spec-tools.py` : OK.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                          |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MINEUR  | `registry.json` : resserrement seulement (le compte exact passe de 42 à 49 ; la regex de couverture et le motif interdit `ÉCART` sont intacts).                                                                                                                                                                                  |
| 2   | MINEUR  | 17 §3.2.5 « État livré » vérifié contre la migration 0100 : RLS `ENABLE` + `FORCE`, `REVOKE ALL` à `PUBLIC`, aucun droit des rôles applicatifs sur les tables, deux commandes `SECURITY DEFINER` de `cmd_money_owner`, `EXECUTE` à `app_api`. Rien n'est affaibli ; la spécification décrit le livré.                            |
| 3   | MINEUR  | 17 §4.5 : `booking.trip.host_restricted` ne porte que `trip_id`, `guest_user_id` et `org_id` (migration 0097), jamais le motif, comme annoncé. `iam.restriction.applied` non émis : écart documenté, aucun contrôle bloquant perdu (la restriction est lue en base).                                                             |
| 4   | MINEUR  | 16 A.8 : `DOCUMENT_RATE_LIMITED` et `PHOTO_LIMIT_REACHED` (409), `HOST_IDENTITY_DUPLICATE` (dossier laissé à l'ops, pas de fuite) et `TRIP_NOT_FOUND` (trip inconnu ou d'un autre hôte, même réponse) sont conformes au code. Les paramètres `upload_*` échouent fermé (absent, refus). Interrupteurs à `false`, aucun PSP réel. |

Verdict : APPROUVÉ
