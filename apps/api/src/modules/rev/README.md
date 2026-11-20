# REV — Reviews (`apps/api/src/modules/rev`)

**REV — Reviews** : avis guest, avis hôte (P1), agrégats. Dépendances autorisées : AVL, IAM (`SessionGuard`), CTR (`TermsGuard` des routes `/trips/{tripId}/reviews`, ADR-190, comme MSG) (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 REV --> AVL ; écart IAM / CTR à reporter dans 17 §2.2).

## Responsabilité

REV gère les avis, comme chez Turo (17 §2.2, §2.13) :

- avis du voyageur sur le véhicule et l'hôte (note globale et 5 sous-notes) ;
- avis de l'hôte sur le voyageur (note globale et 4 sous-notes) ;
- publication quand les deux parties ont noté, ou à J+`review_window_days` (10, 08 BR-REVIEW-01, OQ-P2P-06) ;
- agrégats par véhicule, par hôte et par voyageur, et nombre de trips réalisés (16 REV-010).

REV ne modère pas les messages (MSG) et n'envoie pas encore l'invitation à noter (NTF, suite d'ADR-190).

État réel du code :

- **avis dans l'application, en double aveugle** (US-317, migration `0170_review_double_blind`, ADR-190, PROPOSÉ) : la partie du trip de la session (le voyageur, ou le **titulaire** du compte d'hôte ; un co-hôte ne note pas) note **une fois**, de la fin effective du trip (première ligne `RETURNED`, ADR-183) à la fin effective + `review_window_days` jours au fuseau du trip ; note globale 1 à 5, sous-notes facultatives à clés fermées, texte obligatoire d'au moins 25 caractères de 1 à 3 (les deux rôles), coordonnées masquées avant l'écriture (`messaging_mask_contacts` de MSG, par la porte `core.messaging_mask_text`). L'avis est **scellé** (`core.review_submission`, lu par son seul auteur) : ni la note ni le texte ne sont lisibles par l'autre partie par aucun chemin (lecture, agrégat, profil, événement, journal, erreur). Publication **simultanée** : au second enregistrement (même transaction, même instant), ou à l'échéance par le travailleur `review_publisher` ; idempotente sous le verrou consultatif du trip (deux travailleurs, un travailleur et un second enregistrement). Routes : `GET` / `POST /trips/{tripId}/reviews` (S13, A12 ; profil du voyageur servi à l'hôte), `GET /reviews/received` (avis reçus, droit d'accès Ley 81 ; A13), `GET /listings/{listingId}/host-profile` (public, LST-020 : prénom, ancienneté, trips, note, derniers avis) ;
- **avis recueillis hors de l'application** (US-218, migration `0104_review_recorded_reviews`, ADR-130) : l'ops enregistre depuis la console un avis reçu par e-mail par l'action `RECORD_REVIEW` (cadre d'US-101). Saisie fermée : `authorRole` (`GUEST` ou `HOST`) et `overall` (`ONE` à `FIVE`), jamais un nombre ni le texte de l'avis. La commande liée `core.review_manual_action_record_review` relit en base l'état du trip (`COMPLETED`), la fenêtre et l'auteur, puis écrit l'avis, une fois par partie et par trip, publié à l'enregistrement, et les agrégats. Une partie déjà notée par l'ops ne note plus dans l'application ; l'avis de l'ops compte comme « l'autre partie a noté » pour la publication simultanée ;
- **notes publiques** : `PgListingRatingStore` lit `core.review_listing_ratings` : par annonce `LISTED`, nombre de trips réalisés, nombre d'avis et moyenne du véhicule et de l'hôte, badge « Nuevo » sans avis (recherche US-201, fiche US-204) ;
- **note du voyageur vue par l'hôte** : `core.booking_host_trips` (US-219) et `core.booking_host_guest_rows` (US-062) rendent la moyenne des avis publiés des hôtes sur ce voyageur (`host_guest_v`).

## Entités

| Entité (17 §3.2.12) | Table                          | État                                                                                                                                                              |
| ------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review`            | `core.review_review`           | créée (0104), complétée (0170) : note globale, sous-notes, texte masqué, sujet (`VEHICLE`, `HOST`, `GUEST`), statut, source (`OPS_RECORDED`, `IN_APP`) ; immuable |
| `review` (scellé)   | `core.review_submission`       | créée (0170) : avis donné dans l'application avant publication ; lu par son seul auteur ; échéance figée ; une fois par partie ; immuable                         |
| `rating_aggregate`  | `core.review_rating_aggregate` | créée (0104) : nombre, somme, moyenne ×100 arrondie au demi supérieur (contrainte), avis publiés seuls ; tenu à la publication                                    |

Aucun rôle applicatif n'a de droit sur ces tables (RLS `ENABLE` + `FORCE`) : tout passe par les fonctions `SECURITY DEFINER` de `review_cmd_owner`, qui ne rendent que des colonnes fermées (prénoms seulement).

## Événements

Aucun événement n'est encore émis : la publication et les agrégats sont tenus dans la même transaction (second enregistrement ou travailleur). Le travailleur périodique `review_publisher` (60 s, `core.review_worker_publish_due`) publie les scellés échus.

Cible (17 §4.5, suite d'ADR-190) :

- émis : `review.published` (trip seulement, jamais une note ; consommateurs : NTF pour `EVT_REVIEW_PUBLISHED`, RPT, CAT) et l'invitation `EVT_REVIEW_INVITATION` à la fin effective ;
- consommés : aucun n'est listé pour REV dans 17 §4.5.

## Ports

- `ReviewStore` : avis d'un trip, enregistrement, avis reçus, profil public de l'hôte (`PgReviewStore`, sous `app_api` ; `UnavailableReviewStore`, fail-closed ⇒ 503 `REVIEWS_UNAVAILABLE`). Lecture STRICTE des vues JSON de la base (clés fermées) : toute forme inattendue refuse la réponse. Aucun journal ne porte une note ni un texte (SQLSTATE seulement).
- `ListingRatingStore` : notes publiques d'annonces (`PgListingRatingStore`, sous `app_api` ; `UnavailableListingRatingStore`, fail-closed). Au plus `LISTING_RATINGS_MAX` (100) annonces par appel ; une ligne mal formée refuse toute la réponse.

## Commandes de test

Unitaires et contrat (sans base) :

```bash
pnpm --filter @rueda/api exec vitest run src/modules/rev
```

Preuves L0 sur base réelle, sous les rôles de production, au Panama et au Paraguay : `packages/db/test/l0/l0-us218-reviews.test.ts` (fixture `9987_test_us218_review_fixtures.sql`), `packages/db/test/l0/l0-us317-reviews.test.ts` et `packages/db/test/l0/l0-us317-review-timer.test.ts` (isolé : données validées, deux connexions ; fixture `9915_test_us317_review_fixtures.sql`), par `pnpm --filter @rueda/db test:l0`. Elles demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
