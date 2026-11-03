# ADR-047 — Triggers d'intégrité AVL : fonctions `SECURITY DEFINER` sous `migrator`, I-OCC à trois triggers

- **Statut** : PROPOSÉ (US-006, agent données, 2026-11-03). Revue architecture et **sécurité** (`SECURITY DEFINER`, RLS, concurrence) requises, sur un autre modèle que l'auteur. À reporter dans 17 §8.1 et dans la liste blanche RLS-15 (US-011).
- **Stories** : US-006 ; s'appuient dessus US-011 (RLS-15), US-022 à US-025. **Sources** : 17 §2.3, §2.5 (I-OCC, contraintes v3 / v4), §11 (L0-01, L0-03, L0-08) ; ADR-002, ADR-035, ADR-044.

## Contexte

17 §2.5 exige des triggers de contrainte **différés** (`trip_has_active_occupancy`, `occupancy_trip_guard`, `hold_conversion_matches_disposition`) qui relisent, au `COMMIT`, des lignes de plusieurs tables (`trip`, `vehicle_occupancy`, `checkout_hold`, `payment_disposition`, `payment_operation`).

Deux faits rendent une fonction de trigger « aux droits de l'appelant » fausse :

1. sous PostgreSQL 16, un trigger différé s'exécute sous le **rôle courant au moment du `COMMIT`**. Après une commande `cmd_*` (`SECURITY DEFINER` sous `cmd_hold_owner`, US-023), c'est `app_api`, dont la RLS ne montre que les lignes du guest. PostgreSQL 18 exécutera ces triggers sous le rôle qui a mis l'événement en file, ce qui change encore le rôle ;
2. sous RLS `FORCE`, une ligne invisible pour l'appelant fausse le contrôle : on compte 0 occupation et on refuse à tort, ou on ne voit pas une disposition et on accepte à tort.

17 §2.3 demande un propriétaire `NOLOGIN` distinct par famille de fonctions `SECURITY DEFINER`. Or `migrator` ne peut pas céder une fonction à un autre rôle sans en être membre (`ALTER FUNCTION … OWNER TO` l'exige), et l'amorçage (ADR-044) refuse toute appartenance de rôle.

## Décision

1. Les **fonctions de trigger d'intégrité** qui lisent d'autres lignes (`core.booking_assert_trip_occupancy`, `core.booking_assert_conversion_disposition`, `core.booking_assert_rent_payment_operation`) sont `SECURITY DEFINER` et ont pour propriétaire **`migrator`**, qui voit toutes les lignes par la politique `migrator_all`.
   - Leur `search_path` est figé (`pg_catalog, pg_temp`) et tous les noms sont qualifiés.
   - `EXECUTE` est retiré à `PUBLIC` et n'est accordé à personne.
   - Une fonction `RETURNS trigger` ne peut pas être appelée directement : elle ne reçoit que la ligne modifiée, n'exécute aucun SQL dynamique et n'écrit rien.
   - Elles forment la famille **`integrity_trigger`**, à inscrire dans la liste blanche RLS-15 (US-011). Le test d'intégration `avl-schema` vérifie déjà propriétaire, `search_path`, ACL et l'absence de toute autre fonction `SECURITY DEFINER` dans `core`, `app` et `platform`.
2. Le trigger terminal (`hold_terminal_status`) ne lit rien. Il reste donc aux droits de l'appelant.
3. **I-OCC** est vérifié par trois triggers différés qui partagent une même fonction :
   - `trip_has_active_occupancy`, côté trip ;
   - `occupancy_trip_guard`, sur une mise à jour ou une suppression d'une ligne `TRIP` ;
   - `occupancy_trip_ref_valid` : une ligne `TRIP` active doit désigner un trip existant **du même véhicule** (complément de 17, contre l'occupation orpheline d'une conversion avortée).

   La borne « au plus une occupation active par trip » est **structurelle** : index unique partiel `one_active_occupancy_per_trip`. Les triggers vérifient la borne basse sur l'état final de la transaction.

4. Chaque refus lève `SQLSTATE 23000` avec un **nom de contrainte stable**. La couche d'accès le traduit en code métier sans `DETAIL` (`translateDbError`, `packages/db/src/errors.ts`).
5. **Lecture au `COMMIT` sans verrou** : les états qui tiennent le créneau sont `BOOKED`, `CHECKIN_OPEN`, `START_WINDOW_EXPIRED`, `IN_PROGRESS`, `OVERDUE` et `UNRETURNED`. Dans SM-1, aucun état terminal ne revient vers eux, si bien qu'une lecture `READ COMMITTED` concurrente ne peut produire qu'un **refus de trop** (rejouable), jamais une acceptation à tort. Un `FOR SHARE` sur le trip ajouterait un risque d'interblocage avec un écrivain qui ne suit pas l'ordre global des verrous.

## Conséquences

- Écart assumé avec 17 §2.3 (« propriétaire distinct du propriétaire des tables ») pour la seule famille `integrity_trigger`, faute de moyen de céder la propriété sans appartenance de rôle. Si l'amorçage apprend un jour à créer ces fonctions sous un propriétaire `NOLOGIN` dédié (`integrity_owner`, avec `SELECT` par politiques `USING (true)`), la migration sera un `ALTER FUNCTION … OWNER TO` sans changement de corps.
- **Même obstacle pour US-023** : les commandes `cmd_*` doivent appartenir à `cmd_hold_owner`, mais `migrator` ne peut pas le leur attribuer. US-023 doit trancher (création par l'amorçage administrateur ou appartenance temporaire). Signalé dans la passation US-006.
- La montée vers PostgreSQL 18 ne change rien au résultat des contrôles.

## Alternatives écartées

- **Fonctions aux droits de l'appelant**, avec `SELECT` accordé à tous les rôles écrivains : `app_api` devrait tout voir, contraire à la RLS (17 §2.3).
- **Triggers immédiats** : I-OCC doit tolérer les états intermédiaires d'une transaction (conversion : l'occupation passe `TRIP` avant l'insertion du trip ; annulation : l'état terminal et la désactivation de l'occupation se suivent dans la transaction).
- **`FOR SHARE` sur le trip pendant le contrôle** : il ajoute des attentes au `COMMIT`, et un risque d'interblocage, sans gain de sûreté (point 5).
