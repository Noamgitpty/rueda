# ADR-199 — Pose d'un hold : refus rapide sous le verrou du véhicule et paramètres de pays en plan gardé

- **Statut** : PROPOSÉ (suite d'US-007, N-468, agent backend, claude-opus-5-5, 2026-11-22). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` ; **concurrence**, RLS / rôles sur un autre modèle que l'auteur.
- **Complète** : ADR-056 (preuves L0-02, point 4 : pistes de la révision de 17 §2.5), ADR-063 (commandes de hold), ADR-119 (performance de fumée, historique par processeur).
- **Sources** : 17 §2.5 étape 2 (0, 2a à 2d), §6.7 (« création de hold p95 < 300 ms ; 100 requêtes concurrentes ⇒ 1 succès exact »), §11 L0-02 (C1) ; migration 0179.

## Contexte

Le seuil de L0-02 (p95 de pose < 300 ms, 100 poses concurrentes du même créneau, 17 §2.5 C1, §6.7, §11) est une exigence bloquante. Il n'était plus tenu sur tous les exécuteurs : run 45060424809 sur `main` (be5e1026, AMD EPYC 7763), p95 de 304 ms en PA. La mesure elle-même a été revue (40 courses, 4 000 poses, chauffe des plans, L0-02 seul dans son groupe) : elle est saine.

Deux coûts s'additionnent :

1. **Une dérive à processeur égal.** Elle est relevée dans l'historique d'US-045 (artefacts `perf-fumee` des runs de `main`, 2026-11-14 au 2026-11-22, `scripts/qa/perf-history.mjs`) et dans les lignes `[PERF]` des runs de PR du 2026-11-22. Le tableau donne la médiane du p95 de C1 en autocommit (PA et PY, en ms), puis la médiane de la détention du verrou par une pose perdante en forme transactionnelle (p50, en ms), et entre parenthèses le nombre de runs. Les fenêtres sont définies par la dernière migration présente au commit mesuré.

   | Processeur    | ≤ 0121         | 0122–0143      | 0144–0157     | 0158–0170     | 0171–0176         |
   | ------------- | -------------- | -------------- | ------------- | ------------- | ----------------- |
   | AMD EPYC 7763 | 217 / 5,1 (18) | 234 / 5,6 (2)  | 239 / 5,9 (6) | 271 / 6,2 (4) | 267 / 6,4 (8)     |
   | AMD EPYC 9V74 | 162 / 3,9 (11) | 174 / 4,3 (17) | 191 / 4,6 (5) | 194 / 4,9 (7) | 201 / 5,0 (18 PR) |
   | AMD EPYC 9V45 | 128 / 3,0 (5)  | 129 / 3,2 (6)  | 136 / 3,2 (5) | 150 / 3,5 (1) | 144 / 3,7 (12 PR) |
   | Intel 6975P-C | 144 / 3,4 (3)  | 152 / 3,7 (6)  | 173 / 4,0 (4) | 190 / 4,3 (2) | 174 / 4,3 (9 PR)  |
   | Intel 8573C   | 184 / 4,4 (4)  | 203 / — (1)    | 232 / 5,3 (3) | 232 / 5,6 (2) | 250 / 6,1 (1)     |

   La dérive n'a pas de marche unique. Elle avance par petits pas, à chaque fusion qui ajoute ou élargit une politique de lecture de `core.config_param_value` pour `cmd_hold_owner` : 0112 (`cmd_hold_risk_read`), 0122 (`cmd_hold_contract_param_read`), 0124 (`cmd_hold_cancel_read`, US-215, première marche nette : 3,9 → 4,3 ms sur 9V74), 0126 (`cmd_hold_request_param_read`), 0144 (`cmd_hold_meeting_read`), 0146 (`cmd_hold_deposit_read`, élargie par 0150 et 0153), 0158 (`cmd_hold_inspection_param_read`, élargie par 0163), 0168 (`cmd_hold_overdue_param_read`, élargie par 0173), 0171 (`cmd_hold_cancel_read` élargie), 0175 (`cmd_hold_claim_param_read`). Les migrations 0162 à 0176 n'ajoutent **aucun** déclencheur, aucune contrainte et aucun index aux tables du chemin de pose (occupation, hold, outbox, audit). Les politiques ajoutées à l'occupation (0163 `cmd_trip_handover_occ_upd`, 0168 `cmd_trip_overdue_occ_upd`) et à l'outbox (0162, 0166, 0168, 0173) ne s'évaluent pas pour une pose perdante : l'outbox n'est écrite que par la gagnante, et la mise à jour de l'occupation par 2a ne touche aucune ligne dans C1. Les séries séquentielles non disputées (calendrier, publication) restent stables sur la même période et les mêmes processeurs : l'exécuteur et le volume de données du banc ne sont pas en cause.

   **Mécanisme.** `core.booking_param_int` et `core.booking_param_text` (0037) sont des fonctions SQL à clause `SET search_path`. PostgreSQL n'intègre jamais une telle fonction à la requête appelante. En version 16, il en analyse, réécrit (RLS comprise) et **planifie** le corps à chaque transaction, pour chaque site d'appel : l'état d'exécution des expressions simples de PL/pgSQL, qui porte le cache de la fonction SQL, est refait à chaque transaction. La pose lit huit ou neuf paramètres, donc planifie huit ou neuf fois par pose. Chaque planification porte le OU de toutes les politiques permissives de `cmd_hold_owner` sur la table : dix politiques et une cinquantaine de clés au 2026-11-22, contre une au lot 1. Elle estime chaque terme et essaie un chemin bitmap par branche. Ce coût précède le verrou en autocommit, mais les 100 poses le paient ensemble sur les 4 cœurs de l'exécuteur, en même temps que la file du verrou. En forme transactionnelle, la fixture mesurée (`l0_cmd_place_hold_timed`) prend le verrou avant d'appeler la commande : la détention mesure donc la commande entière, d'où une dérive plus nette (+25 %). Mesure directe du coût de planification selon le nombre de politiques : section « Mesures ».

2. **Le travail des perdantes sous le verrou.** Chaque pose perdante fait sous le verrou du véhicule tout le travail d'une gagnante (2a, garde entre hôtes, rotation, insertion de l'occupation dans sept index, dont deux contrôles d'exclusion GiST) avant de recevoir `23P01`. La file de C1 paie ce travail 99 fois. C'est la première piste de révision d'ADR-056 point 4.

## Décision

1. **Refus rapide** (0179, `core.booking_place_hold_kind`). Juste après les verrous du voyageur puis du véhicule, et avant 2a, la commande lit l'occupation active du véhicule qui chevauche la période occupée (`vehicle_id`, `active`, `period &&`, index partiel de `vehicle_occupancy_no_overlap`). Si l'occupation en conflit est **définitive**, c'est-à-dire si 2a ne peut pas la libérer, la pose est refusée aussitôt. Est définitive une occupation autre que `HOLD`, ou un `HOLD` dont le hold n'est pas à la fois `ACTIVE` / `PAYMENT_IN_FLIGHT` et échu à `platform.now()`. Le refus porte **la même erreur que la contrainte** : SQLSTATE `23P01`, contrainte `vehicle_occupancy_no_overlap`, traduite `VEHICLE_UNAVAILABLE` (17 §2.5 2d ; `DATES_UNAVAILABLE` au checkout). Il ne porte pas de `DETAIL` (M9) et n'écrit **rien**.
   - **Ce n'est qu'un court-circuit.** Il ne refuse que ce que l'insertion de 2c aurait refusé : la ligne en conflit est vue sous le verrou du véhicule, et 2a ne peut pas l'expirer. Dans tous les autres cas (créneau libre, ou conflit avec un hold échu, même protégé par un paiement en cours), la pose suit le chemin inchangé : 2a, 2b, 2c. L'exclusion GiST `vehicle_occupancy_no_overlap` reste **la seule garde** de l'unicité du créneau, y compris si le refus rapide manque un conflit (niveau d'isolement plus strict, désactivation concurrente hors verrou du véhicule par le volet voyageur de 2a). Le test « hold en paiement protégé » le prouve : l'insertion y échoue sur l'index lui-même (`23P01` avec le `DETAIL` de PostgreSQL, que l'API ne renvoie jamais).
   - **Inchangés** : l'ordre global des verrous (guest puis véhicule), le texte de 2a (`EXPIRY_2A_SQL`, égalité vérifiée par `expiry-2a.test.ts` sur 0179), la conversion gardée, `platform.now()`, la forme d'appel (une instruction en autocommit) et les codes d'erreur.
   - **Simultanéité.** Le refus rapide est une lecture faite sous le verrou du véhicule. Il ne prend aucun verrou de ligne et ne peut créer ni attente ni cycle. Avec 100 poses, la première obtient le verrou, ne voit aucun conflit et insère. Les 99 suivantes voient sa ligne, validée avant la libération du verrou, et sont refusées sans écrire. Les assertions de C1 sont inchangées : exactement 1 hold, 99 `VEHICLE_UNAVAILABLE`, 0 `40P01`, 0 rejeu.
2. **Paramètres de pays en plan gardé** (0179). `core.booking_param_int` et `core.booking_param_text` passent en PL/pgSQL. Requête, attributs (`STABLE`, `SECURITY INVOKER`, search_path figé), propriétaire et droits sont les mêmes. Le plan est gardé par la session au lieu d'être refait à chaque transaction. PostgreSQL le revalide à tout changement de politique ou de table, et le refait si le rôle courant change : la RLS du rôle appelant (`cmd_hold_owner`, `app_worker`) s'applique comme avant. Le résultat est identique, NULL compris : aucune ligne donne NULL. Le coût de la pose ne dépend plus du nombre de politiques ajoutées par les stories suivantes.
3. **Ordre des refus** (PROPOSÉ, comme Turo : le voyageur apprend d'abord que les dates ne sont pas libres). Sur un créneau **définitivement** pris, `VEHICLE_UNAVAILABLE` passe désormais avant les refus de 2b : limite de holds vivants (`HOLD_LIMIT_REACHED`), chevauchement des trips du voyageur (`GUEST_OVERLAP`) et rotation (`HOLD_RATE_LIMITED`). Avant, ces refus passaient les premiers. Les contrôles faits **avant** le verrou gardent leur priorité : auto-réservation, restrictions, consentement biométrique, paramètres, préavis, durée. Rien n'est écrit dans un cas comme dans l'autre : la pose refusée était déjà annulée en entier. Aucune information nouvelle n'est révélée : l'indisponibilité du créneau est publique (calendrier de l'annonce), et la limite du voyageur lui sera opposée sur un créneau libre.
4. **Code de test sur le chemin mesuré.**
   - Le déclencheur de test `us115_catalog_relay` (9985, `BEFORE INSERT` sur l'occupation et le hold) ne s'exécute plus que pour la gagnante : les perdantes n'insèrent plus rien.
   - La version de test de `core.booking_vehicle_party` (9750) s'exécute avant le verrou et coûte un peu plus que la version de production : trois branches au lieu d'une jointure. Elle rend donc la mesure **pessimiste**, jamais optimiste. Elle reste en place, car la remplacer par une version mise en cache rendrait le banc plus rapide que la production.
   - Ce que ces deux fixtures prouvent ailleurs ne change pas : les véhicules historiques des fixtures restent inscrits au catalogue par le relais, à toute insertion réussie ; le registre de test sert à toutes les poses.
   - L0-02 n'est pas modifié : seuil de 300 ms, degré 100, 40 courses mesurées, « exactement 1 hold » et « 0 `40P01` » sont inchangés.

## Mesures

**Coût de planification d'une lecture de paramètre** (diagnostic temporaire, run 45074060780, job « base de données », EPYC 7763, PostgreSQL 16.16). On mesure 300 `EXPLAIN (ANALYZE, SUMMARY)` du corps de `booking_param_int`, avec le OU des _k_ premières politiques de `cmd_hold_owner` sur `config_param_value`, dans l'ordre de création. Le tableau donne la médiane du temps de planification :

| _k_ | politique ajoutée                | planification p50 (ms) |
| --- | -------------------------------- | ---------------------- |
| 0   | aucune                           | 0,081                  |
| 1   | `cmd_hold_read`                  | 0,174                  |
| 2   | `cmd_hold_risk_read` (0112)      | 0,193                  |
| 4   | `cmd_hold_cancel_read` (0124)    | 0,230                  |
| 6   | `cmd_hold_meeting_read` (0144)   | 0,251                  |
| 7   | `cmd_hold_deposit_read` (0146)   | 0,300                  |
| 8   | `cmd_hold_inspection_param_read` | 0,323                  |
| 9   | `cmd_hold_overdue_param_read`    | 0,342                  |
| 10  | `cmd_hold_claim_param_read`      | 0,351                  |

De 2 politiques (état du 2026-11-16) à 10 (2026-11-22), chaque lecture coûte 0,16 ms de plus. La pose en fait neuf, soit environ 1,4 ms de plus par pose. C'est la dérive observée sur la même machine : la détention passe de 5,1 à 6,4 ms (+1,3 ms) sur EPYC 7763.

**L0-02 après 0179** (PR #295, job « base de données », lignes `[PERF]`). Le tableau donne le p95 en ms, PA / PY ; la référence est la médiane avant correctif sur le même processeur (fenêtre 0171–0176) :

| Run         | Processeur    | autocommit p95 | référence | transactionnelle p95 | détention p50 (perdante) |
| ----------- | ------------- | -------------- | --------- | -------------------- | ------------------------ |
| 45072316133 | AMD EPYC 9V74 | 92 / 90        | 201       | 206 / 228            | 2,2 / 2,2 (avant : 5,0)  |
| 45074060780 | AMD EPYC 7763 | 98 / 92        | 261 – 267 | 218 / 235            | 2,2 / 2,2 (avant : 6,4)  |

Le p95 en autocommit baisse de 55 à 65 %. Sur le processeur le plus lent, il passe de 304 ms (échec sur `main`, be5e1026) à 98 ms. La forme transactionnelle repasse sous 300 ms, alors qu'elle était à 614–700 ms. Toutes les courses restent exactes (1 hold, 99 `VEHICLE_UNAVAILABLE`, 0 `40P01`, 0 rejeu), et les 3 069 à 3 070 tests L0 du job passent.

## Conséquences

- **Production** : une pose sur un créneau pris ne coûte plus qu'une lecture sous le verrou, au lieu d'une pose complète annulée. Elle ne laisse aucun tuple mort dans les sept index de l'occupation. La lecture des paramètres ne grossit plus à chaque politique ajoutée.
- **Révision de 17 §2.5** : ADR-056 point 4 l'annonçait comme « refus rapide sans tenir le verrou ». La décision retenue est plus étroite : la lecture se fait sous le verrou, qui est rendu par la fin de la transaction, comme avant. Rien ne change dans la séquence 2a → 2d de la spécification, sauf l'ordre des refus du point 3. La passation propose le texte d'une PR de spécification (17 §2.5 étape 2 et 16 BKG-014) ; `docs/specs/` n'est pas modifié ici.
- **Suites** (BOARD) :
  - les autres fonctions SQL à clause `SET` du chemin de pose sont toujours re-planifiées à chaque transaction : `app.actor_kind()`, `app.actor_id()` dans chaque politique, `core.kyc_consent_withdrawn`, `core.booking_vehicle_party`, `platform.guest_hold_guard`, `platform.now()`. Ce coût est constant, il ne dérive pas, mais un relevé est utile ; toute modification des fonctions de politique demande une revue sécurité ;
  - banc de référence du seuil : voir la passation (PR de spécification proposée).

## Alternatives écartées

- **Relever le seuil, réduire le degré ou écarter des poses** : interdit (17 §6.7, §11).
- **Refus rapide avant 2a, sans condition sur le hold** : un hold échu non balayé ferait refuser une pose que 2a aurait rendue possible. C'est un faux refus, refusé (C9 / RLS-14).
- **Bloc `EXCEPTION` dans la commande, qui rendrait un code métier** (seconde piste d'ADR-056 point 4) : chaque pose paierait une sous-transaction, et la perdante ferait toujours tout le travail sous le verrou. Le gain ne porte que sur la forme transactionnelle.
- **`plan_cache_mode = force_generic_plan` sur les fonctions SQL** : sans effet en version 16. Les fonctions SQL n'y passent pas par le cache de plans.
- **Supprimer les politiques de `cmd_hold_owner` sur `config_param_value` ou les fusionner** : chacune borne les clés lues par une commande (moindre privilège, revue sécurité). On ne l'affaiblit pas pour gagner du temps.
