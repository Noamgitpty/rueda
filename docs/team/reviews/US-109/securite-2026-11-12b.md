# Revue sécurité (seconde passe) — US-109 « Fiche 360° et files de revue » (PR n° 110) — 2026-11-12

SHA revu : 958d5b3788dd1d32c297693683c30a3d54ae136a (diff origin/main...HEAD ; correctifs 1bdf671 et 1130aec ; 6082eb6 et 958d5b3 de l’orchestrateur)
Relecteur : sécurité / claude-sonnet-5-5 (autre modèle que l’auteur claude-opus-5-5). Première passe : 137a915.
CI du SHA revu : en cours à la rédaction ; la CI fait foi pour la migration, `test:int` et `test:l0` (PostgreSQL non démarré ici).

**Verdict : APPROUVÉ**

## Bloquants

Aucun. Le majeur n° 1 de la première passe est levé ; le mineur à corriger (n° 3) l’est aussi.

## Première passe : suivi

- n° 1 (séparation des fonctions sur `RESTRICT_ACCOUNT` et `LIFT_RESTRICTION`) : corrigé dans `core.iam_manual_action_restriction` (`0064`, après `SUBJECT_NOT_FOUND`). `p_subject_id = p_actor` rend `REFUSED` / `SELF_FORBIDDEN` pour la pose et la levée ; un sujet qui détient une affectation de rôle de staff non expirée n’est accessible qu’à un ADMIN (`STAFF_SUBJECT_ADMIN_ONLY`, PROPOSÉ dans l’ADR). Les gardes précèdent le verrou et toute écriture. Le test L0 couvre PA et PY : auto-restriction OPS et ADMIN, auto-levée par le restreint, collègue par un OPS refusé, collègue par un ADMIN posé, levée par un OPS refusée, levée par l’ADMIN acceptée, état final relu par fixture.
  - Limite acceptée : un ADMIN peut restreindre un autre ADMIN (pas de niveau au-dessus en Bêta) ; l’acte est journalisé et motivé.
  - Un second compte du même humain échappe à tout contrôle de base : couvert par l’audit.
- n° 3 (pays de l’élément non recoupé) : corrigé deux fois. `support_enqueue_review` relit le pays de la personne (`ctr_account_country`) ou de l’organisation et refuse `COUNTRY_MISMATCH` ; `support_staff_kyc_dossier` refuse (`FORBIDDEN`, accès journalisé) quand le pays de l’élément diffère de celui de la personne, sans jamais rendre `CASE_REQUIRED`, qui révélerait l’existence de la personne.
- n° 2, 5, 6, 7, 8, 11 : risques résiduels acceptés, consignés dans l’ADR et au BOARD (N-53 à N-57).

## Relecture adversariale des ajouts

- `support_enqueue_review` et `support_close_review_item` : `SECURITY DEFINER`, `search_path = pg_catalog, pg_temp`, propriétaire `iam_staff_owner` (NOLOGIN), `PUBLIC` révoqué, `EXECUTE` à personne (allowlist, `schema.md`). Le test L0 vérifie `42501` pour `app_api` sur la clôture. Elles ne touchent que `support_review_queue_item` ; aucune donnée personnelle en sortie (`outcome`, `item_id`).
- RLS : toutes les tables restent `ENABLE` + `FORCE` ; la politique `iam_staff_close` est limitée à `iam_staff_owner` et son `WITH CHECK` interdit tout état vivant ou sans `decided_at`. Aucune extension de droit à un rôle applicatif ; aucun `BYPASSRLS`.
- `platform.now()` seul ; aucune constante de pays ; aucun interrupteur de mise en service touché ; aucun fichier protégé (`.github/`, `scripts/ci/`, `scripts/team/`, `review-requirements.json`) ni `docs/specs/` modifié depuis la première passe.
- Pièces : le contrôle côté client avant l’envoi n’est qu’une aide ergonomique ; le serveur reste juge (taille, type réel, droit, antivirus fail-closed), inchangé.

## Réserves non bloquantes

1. Le recoupement du pays ne vaut que pour `USER_ACCOUNT` et `ORGANIZATION` : les sujets véhicule, annonce et trajet restent sous la confiance de la commande productrice qui détient `EXECUTE`. À recouper dans les stories productrices.
2. `p_actor` des deux fonctions vient de la commande productrice et n’est pas vérifié ici : ne jamais le tirer d’une entrée de l’appelant.
3. Une restriction posée pendant un hold actif n’est pas relue au paiement ni à la conversion (suite déjà au BOARD).
