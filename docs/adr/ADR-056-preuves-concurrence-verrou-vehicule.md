# ADR-056 — Preuves de concurrence L0-02 / L0-04 : barrières consultatives, injection du verrou par véhicule, plan de 2a

- **Statut** : PROPOSÉ (US-007, agent données, 2026-11-03). Revues code, architecture et **sécurité / concurrence** requises, sur un autre modèle que l'auteur. À reporter dans 17 §8.1.
- **Stories** : US-007 ; s'appuient dessus US-022 à US-025 (commandes réelles), US-027 (rapport L0). **Sources** : 17 §2.5 (ordre global des verrous, reprise, 2a), §11 (L0-02, L0-04, C1, C16) ; ADR-048, ADR-053.

## Contexte

17 §11 exige de mesurer, sur PostgreSQL réel et sous les rôles de production :

- L0-02 : 100 poses concurrentes (C1) et ré-acquisition + pose (C16), sans puis avec le verrou consultatif par véhicule ; annulation de trip concurrente d'une pose ;
- L0-04 : le plan de l'instruction d'expiration 2a sur 10 000 holds.

`booking.cmd_place_hold` n'existe pas encore (US-023) et `cmd_hold_owner` n'a pas de fonction. Les tests doivent pourtant exercer la séquence exacte de 17 §2.5 étape 2.

## Décision

1. **Pose par fixture de test** : `test_fixture.l0_place_hold` (migration de test 9002, base principale seulement) reproduit la séquence de la commande : verrou du guest, verrou du véhicule, 2a (texte de 17), insertion. Le paramètre `p_vehicle_lock` réalise l'**injection** demandée par L0-02 : la même pose sans le verrou du véhicule. Comme les fixtures 9001 et 9300, elle est `SECURITY DEFINER` sous `migrator`. Ce n'est **pas** une fonction de production : elle n'entre pas dans la liste blanche RLS-15 (US-011), qui ne porte que sur la base de production. US-023 remplacera la fixture par la commande sous `cmd_hold_owner` et rejouera ces tests tels quels.
2. **Barrières par verrou consultatif** : un meneur tient un verrou exclusif de session ; les concurrents le demandent en mode partagé ; le départ est donné quand `pg_locks` montre tous les concurrents en attente. Les entrelacements forcés (« A tient le verrou du véhicule, B attend ») sont prouvés par une ligne non accordée de `pg_locks` pour le pid de B, jamais par un délai.
3. **Reprise** : `40P01` / `40001` ⇒ annulation complète puis rejeu, au plus 3 fois, attente aléatoire courte (17 §2.5). Le nombre de `40P01` est consigné ; avec verrou, il doit être **0**.
4. **Seuils** : avec verrou, exactement 1 hold, 0 `40P01`, p95 de pose < 300 ms. La pose est **un appel de commande en autocommit** (une instruction, comme l'API appellera `cmd_place_hold`) ; son temps va du départ commun à la réponse, rejeux compris. Premier passage CI avec `BEGIN` / contrôle d'horloge / `COMMIT` / `RESET ALL` autour de l'appel : p95 de 433 à 460 ms, dominé par les allers-retours de 100 clients sur le runner et non par le verrou (sans verrou : 532 à 562 ms). Deuxième passage, en autocommit : p95 de 489 à 553 ms avec verrou, 177 à 467 ms sans ; la différence venait de la planification de 2a par chaque connexion neuve, **sous** le verrou du véhicule. Chaque connexion de la course est donc **chauffée** avant le départ (une pose annulée sur un autre véhicule), comme une connexion d'un pool de l'API. Sans verrou, aucun seuil de temps : le nombre de `40P01` est consigné et le résultat final doit rester exact (1 hold, les autres `VEHICLE_UNAVAILABLE`).
5. **Banc** : le conteneur de CI démarre PostgreSQL 16 avec `max_connections = 200`, pour ouvrir 100 connexions directes pendant que les autres fichiers de test tournent. Sur un PostgreSQL natif plus petit, le degré est réduit à `max_connections − 30` et la valeur est consignée.
6. **Plan de 2a** : mesuré sous `app_worker` (`hold_expiry`), donc avec la RLS, sur 10 000 holds et 1 000 véhicules par pays, après `ANALYZE`. Assertions : un `BitmapOr` de deux index, un par branche de l'`OR`, et aucun nœud `Seq Scan`. Branche véhicule : `(vehicle_id, status)`. Branche guest : `(guest_user_id, status)` **ou** l'index unique partiel `one_live_hold_per_guest_vehicle (guest_user_id, vehicle_id) WHERE status IN ('ACTIVE','PAYMENT_IN_FLIGHT')`, que PostgreSQL 16 préfère parce qu'il porte déjà le filtre de statut (constat CI). L'index `checkout_hold_guest_status_idx` n'est donc pas utilisé par 2a : à réexaminer par US-023 (autres lecteurs ou suppression), sans changement ici. Le même texte SQL (`EXPIRY_2A_SQL`) sert à l'exécution et au plan.
7. **Annulation de trip** : écrite comme 17 §2.5 l'exige pour tout état terminal (verrou du guest, puis du véhicule, puis ligne `trip`), sous `trip_lifecycle`. La story qui construit l'annulation réelle reprend cet ordre.

## Conséquences

- Les mesures sont dans le journal CI (`[L0-02]`, `[L0-04]`), à reprendre dans le rapport L0 (US-027).
- Sans verrou, le nombre de `40P01` dépend de l'ordonnancement : il peut être nul sur une exécution. Le test ne l'exige pas positif, conformément à 17 §11 (« consigné »).
- Le volume de L0-04 reste dans la base jetable du banc ; il est validé (`COMMIT`) parce que le hold verrouillé doit être vu par une autre connexion.

## Alternatives écartées

- **Attentes par `pg_sleep` ou délais côté client** : non déterministes ; la preuve par `pg_locks` l'est.
- **Pose par `INSERT` direct sous un rôle applicatif** : exigerait un droit que `app_api` n'aura jamais (17 §2.3).
- **Pool de connexions pour C1** : un pool de taille inférieure à 100 mesurerait la file du pool, pas l'exclusion.
