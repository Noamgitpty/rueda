# Revue architecture (seconde passe) — US-109 « Fiche 360° et files de revue » (PR n° 110) — 2026-11-12

SHA revu : 958d5b3788dd1d32c297693683c30a3d54ae136a (diff origin/main...HEAD ; correctifs 1bdf671 et 1130aec ; 6082eb6 et 958d5b3 de l’orchestrateur)
Relecteur : architecture / claude-sonnet-5-5 (autre modèle que l’auteur claude-opus-5-5). Première passe : 137a915.
CI du SHA revu : en cours à la rédaction ; la CI fait foi pour la migration, `test:int` et `test:l0` (PostgreSQL non démarré ici).

**Verdict : APPROUVÉ**

## Bloquants

Aucun. Le bloquant n° 1 de la première passe est levé.

## Première passe : suivi

- n° 1 (mise en file inutilisable par les stories productrices) : corrigé.
  - `core.support_enqueue_review` est maintenant `SECURITY DEFINER`, propriétaire `iam_staff_owner`, `search_path` figé, `REVOKE ALL FROM PUBLIC`, `EXECUTE` à aucun rôle (`0064` section 10.0 ; allowlist `execute: []`). Chaque story productrice n’a plus qu’à accorder `EXECUTE` à son propriétaire NOLOGIN : la matrice des droits ne se disperse plus.
  - Chemin de clôture ajouté : `core.support_close_review_item` (`DONE` ou `CANCELLED`, décision et `decided_at` posées par la base), avec `GRANT UPDATE (decision, decided_at)` et la politique `iam_staff_close`, qui respecte la contrainte `review_queue_item_decided`.
  - Pays de l’appelant recoupé (`COUNTRY_MISMATCH`) pour un sujet `USER_ACCOUNT` ou `ORGANIZATION`.
  - Preuve : `9990_test_us109_review_queue_fixtures.sql` appelle désormais les deux fonctions depuis une commande dont le propriétaire `cmd_golive_owner` n’a reçu que `EXECUTE` : le cas de production, et non plus `migrator`.
- n° 5 (ADR périmé) : corrigé (DEC-FONDATEUR-20, préfixe des octets seul, dépôt avant le `COMMIT`, correspondance « signatures périmées » reportée à US-003). Les risques résiduels sont consignés dans l’ADR et au BOARD (N-53 à N-57).
- n° 6, 7 : acceptés, inchangés. La concentration sur `iam_staff_owner` croît légèrement (deux fonctions, deux droits colonne), dans la marge acceptée.

## Relecture adversariale

- Expand-only respecté (la version INVOKER est remplacée dans la même migration, non encore fusionnée : pas de contraction). Le bloc de retour arrière de `0064` cite `support_close_review_item`.
- Politiques UPDATE permissives sur `support_review_queue_item` (`iam_staff_update` et `iam_staff_close`) : leurs `WITH CHECK` sont disjoints (états vivants contre états terminaux) ; la clôture n’est possible que par une fonction de `iam_staff_owner`, jamais par un rôle applicatif (test `42501` ajouté).
- Frontières de modules inchangées ; `schema.md` recopié du job base de données (386 politiques, 92 `SECURITY DEFINER`).
- Les reports à l’orchestrateur de la passation restent à faire (17 §2.3, §3.2.13, §10, 16 A.8, 10b §4.3, écart de la clé `backoffice.o01.empty`).

## Réserves non bloquantes

1. `p_actor` de `support_close_review_item` est écrit tel quel dans `updated_by` : la commande productrice doit passer l’acteur vérifié (à rappeler dans US-106, 108, 114, 118 et 209).
2. `support_close_review_item` ne vérifie ni la file ni le sujet : la commande productrice doit clore l’élément qu’elle a tranché (id reçu d’un `CREATED` ou `EXISTS`). À documenter dans le README SUP à la première consommation.
3. `iam_staff_owner` : prévoir un propriétaire dédié aux colonnes C2 avant US-105 (inchangé).
