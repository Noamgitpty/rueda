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
3. **Reprise** : `40P01` / `40001` ⇒ annulation complète puis rejeu, au plus 3 fois, attente aléatoire courte (17 §2.5). Le nombre de `40P01` est consigné ; avec verrou, il doit être **0**. Le chemin de rejeu est exercé à chaque passage par un interblocage **déterministe** (A : guest puis véhicule, ordre de 17 ; B : véhicule puis guest, ordre inversé ; cycle forcé par `pg_locks`) : un `40P01` réel en ≈ `deadlock_timeout`, rejoué, les deux transactions aboutissent. `withReplay` et `percentile` ont aussi des tests unitaires.
4. **Seuils et forme d'appel.** Avec verrou : exactement 1 hold, 0 `40P01`, p95 de pose < 300 ms. Sans verrou : aucun seuil de temps ; le nombre de `40P01` est consigné et le résultat final doit rester exact (1 hold, les autres `VEHICLE_UNAVAILABLE`). Les connexions sont **chauffées** avant le départ (une pose annulée sur un autre véhicule), comme celles d'un pool de l'API : sans cela, chaque connexion neuve planifie 2a **sous** le verrou du véhicule (passages CI 1 et 2 : p95 de 433 à 553 ms).
   - **Hypothèse « un appel = une instruction »** : le seuil bloquant de 300 ms porte sur la pose en **autocommit**, où l'erreur `23P01` termine la transaction sur le serveur et rend aussitôt le verrou du véhicule. C'est la condition de validité du seuil.
   - **Forme transactionnelle de 17 §2.3** (`BEGIN`, contexte `app.*` par `SET LOCAL`, appel, `COMMIT` / `ROLLBACK`) : une pose perdante garde le verrou du véhicule jusqu'au `ROLLBACK` du client, donc la détention dépend de la latence du client. Une **seconde série C1** la mesure, **sans seuil bloquant** : p95 et détention du verrou **côté serveur** (fixture `l0_place_hold_timed` : instants d'obtention du verrou et de fin de commande ; détention(i) = obtention(i + 1) − obtention(i), le verrou passant au suivant dès qu'il est rendu). Run CI 41620722748 : p95 de pose 228 ms (PA) et 189 ms (PY) ; détention par une pose perdante p50 1,8 à 1,9 ms, p95 5,1 à 5,4 ms, dont commande p95 4,1 à 4,5 ms et aller-retour client jusqu'au `ROLLBACK` p95 1,0 à 1,6 ms. Au même passage, en autocommit : p95 134 et 176 ms.
   - **Conséquences** : chaque perdante coûte, dans la file, la commande **plus** un aller-retour client ; avec 100 poses, la détention cumulée atteint environ 250 ms. Le seuil tient aujourd'hui dans les deux formes, avec une marge réduite en forme transactionnelle. La révision de 17 §2.5 est saisie (17 §11) si le p95 transactionnel dépasse **300 ms**, ou si la latence client s'allonge (API éloignée de la base, pool saturé). Deux pistes : refuser vite une pose perdante sans tenir le verrou (contrôle d'occupation sous le verrou, puis libération avant toute erreur), ou un bloc `EXCEPTION` dans la commande qui renvoie un code métier au lieu de lever, pour que le client fasse `COMMIT` sans attente.
   - **Forme d'appel imposée à US-012 et US-023 (DoR)** : `cmd_place_hold` est appelée dans une transaction **courte** : `BEGIN`, contexte `SET LOCAL`, **un seul** appel de commande, `COMMIT`, et `ROLLBACK` **immédiat** sur erreur, sans autre aller-retour ni traitement applicatif entre l'appel et la fin de transaction. Les connexions sont directes, d'un pool chaud, sans pooler en mode transaction. US-023 rejoue les deux séries C1 sous `cmd_hold_owner` et mesure le plan de 2a sous sa politique.
5. **Banc et budget de connexions** (révisé le 2026-11-03, voir « Budget de connexions du banc ») : le conteneur de CI démarre PostgreSQL 16 avec `max_connections = 200`. L0-02 tourne **seul**, après tous les autres fichiers L0. Le degré est calculé à partir des créneaux **mesurés** au départ de chaque course, plafonné à 100. Une connexion refusée fait échouer la course **aussitôt**. En CI (`CI` défini), le degré doit valoir exactement 100.
6. **Plan de 2a** : mesuré sous `app_worker` (`hold_expiry`), donc avec la RLS, sur 10 000 holds et 1 000 véhicules par pays, après `ANALYZE`. Assertions : un `BitmapOr` de deux index, un par branche de l'`OR`, et aucun nœud `Seq Scan`. Branche véhicule : `(vehicle_id, status)`. Branche guest : `(guest_user_id, status)` **ou** l'index unique partiel `one_live_hold_per_guest_vehicle (guest_user_id, vehicle_id) WHERE status IN ('ACTIVE','PAYMENT_IN_FLIGHT')`, que PostgreSQL 16 préfère parce qu'il porte déjà le filtre de statut (constat CI). L'index `checkout_hold_guest_status_idx` n'est donc pas utilisé par 2a : à réexaminer par US-023 (autres lecteurs ou suppression), sans changement ici. Le même texte SQL (`EXPIRY_2A_SQL`, `test/support/expiry-2a.ts`) sert à l'exécution, au plan et à la fixture de pose ; un test unitaire vérifie l'égalité.
7. **Annulation de trip** : écrite comme 17 §2.5 l'exige pour tout état terminal (verrou du guest, puis du véhicule, puis ligne `trip`), sous `trip_lifecycle`. La story qui construit l'annulation réelle reprend cet ordre.

### Budget de connexions du banc (2026-11-03)

**Constat.** L0-02 ouvrait ses 100 connexions pendant que les autres fichiers L0 tournaient en parallèle. Il supposait qu'ils n'utilisaient pas plus de 30 connexions (`RESERVED_CONNECTIONS`). Avec 21 fichiers L0, ce budget était parfois dépassé (`53300`, « remaining connection slots are reserved for roles with the SUPERUSER attribute »). Quand une connexion était refusée, celles qui avaient abouti n'étaient pas fermées et faisaient échouer les cas suivants en cascade, jusqu'au délai de 240 s. L'échec était intermittent et bloquait des PR.

**Choix.** Trois mesures complémentaires :

1. **Isolement**, qui supprime la cause : `vitest.l0.config.ts` déclare deux projets sur un **seul** banc, avec le `globalSetup` de la racine exécuté une fois. Le projet `l0` contient tous les fichiers sauf L0-02 et garde le parallélisme (`sequence.groupOrder: 0`). Le projet `l0-concurrence` contient L0-02, un fichier à la fois (`fileParallelism: false`, `sequence.groupOrder: 1`). Vitest exécute les groupes dans l'ordre : L0-02 ne démarre qu'après la fin des autres fichiers. Aucune concurrence externe ne vient donc fausser la mesure du p95. L0-04 reste dans le premier groupe : il n'ouvre que 3 connexions.
2. **Budget mesuré**, qui remplace la constante : au départ de chaque course, `max_connections − superuser_reserved_connections − reserved_connections − sessions de pg_stat_activity − 5`, plafonné à 100. Le résultat est consigné (`[L0-02] budget de connexions`). Les sessions dont `app_api` ne voit pas le type sont comptées, ce qui reste prudent.
3. **Échec immédiat** : les connexions des poses sont ouvertes par `connectMany`, avec `Promise.allSettled`. Au premier refus, toutes les connexions ouvertes sont fermées et le test échoue en quelques secondes, avec le SQLSTATE. La cascade disparaît.

**Constat complémentaire (PR #51, run 41649044052, passage 4).** Même avec L0-02 isolé et 190 créneaux libres, la course « C1 sans verrou PY » est restée bloquée jusqu'au délai de 240 s. Le même motif apparaît dans un échec antérieur (run 41640254708). Le refus `53300` en était une **conséquence** : les 101 connexions de la course bloquée restaient ouvertes. Une quatrième mesure a donc été ajoutée :

4. **Course bornée** : chaque connexion de pose reçoit `statement_timeout = 60 s`. Une pose bloquée finit en `57014` bien avant `LONG`, le `finally` ferme toujours les connexions, et le test échoue avec une issue explicite au lieu d'une cascade. À 30 s, l'état des sessions encore actives est consigné (`[L0-02] course bloquée` : `wait_event`, verrous non accordés, `pg_blocking_pids`). La cause du blocage reste **à établir** à partir de ce diagnostic, et un blocage réel n'est jamais masqué : aucun rejeu automatique de la course.

**Écartés.** Relever `max_connections` (300 ou plus) ne fait que reculer le seuil : chaque nouveau fichier L0 consomme de la marge. Une seconde invocation de vitest, ou un séquencement dans turbo, démarrerait un second conteneur et un second banc, et un échec du premier lot masquerait L0-02 (`&&`). Exécuter tous les fichiers L0 en série allongerait la CI sans bénéfice. La preuve n'est pas affaiblie : le degré exigé en CI reste exactement 100, et le banc reste à 200 connexions.

## Conséquences

- Les mesures sont dans le journal CI (`[L0-02]`, `[L0-04]`), à reprendre dans le rapport L0 (US-027).
- Sans verrou, le nombre de `40P01` dépend de l'ordonnancement : il peut être nul sur une exécution. Le test ne l'exige pas positif, conformément à 17 §11 (« consigné »).
- Le volume de L0-04 reste dans la base jetable du banc ; il est validé (`COMMIT`) parce que le hold verrouillé doit être vu par une autre connexion.

## Alternatives écartées

- **Attentes par `pg_sleep` ou délais côté client** : non déterministes ; la preuve par `pg_locks` l'est.
- **Pose par `INSERT` direct sous un rôle applicatif** : exigerait un droit que `app_api` n'aura jamais (17 §2.3).
- **Pool de connexions pour C1** : un pool de taille inférieure à 100 mesurerait la file du pool, pas l'exclusion.
