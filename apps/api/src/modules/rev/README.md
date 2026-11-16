# REV — Reviews (`apps/api/src/modules/rev`)

**REV — Reviews** : avis guest, avis hôte (P1), agrégats. Dépendances autorisées : AVL (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 REV --> AVL).

## Responsabilité

REV gère les avis, comme chez Turo (17 §2.2, §2.13) :

- avis du voyageur sur le véhicule et l'hôte (note globale et 5 sous-notes) ;
- avis de l'hôte sur le voyageur ;
- publication quand les deux parties ont noté, ou à J+`review_window_days` (10, 08 BR-REVIEW-01) ;
- agrégats par véhicule et par hôte, et nombre de trips réalisés (16 REV-010).

Un avis exige un trip `COMPLETED`. REV ne modère pas les messages (MSG) et n'envoie pas l'invitation à noter (NTF).

État réel du code (US-218, migration `0104_review_recorded_reviews`, ADR-130, PROPOSÉ) :

- **avis recueillis hors de l'application** : l'ops enregistre depuis la console un avis reçu par e-mail par l'action `RECORD_REVIEW` (cadre d'US-101). Saisie fermée : `authorRole` (`GUEST` ou `HOST`) et `overall` (`ONE` à `FIVE`), jamais un nombre ni le texte de l'avis (l'e-mail reste une pièce de l'action). La commande liée `core.review_manual_action_record_review` (propriétaire `review_cmd_owner`) relit en base l'état du trip (`COMPLETED`), la fenêtre (`review_window_days` du pays, depuis la fin prévue ou le retour enregistré) et l'auteur (voyageur du trip, ou titulaire du compte d'hôte), puis écrit l'avis, une fois par partie et par trip, et les agrégats dans la même transaction. L'avis est publié à l'enregistrement ; la publication en double aveugle (REV-004) arrive avec US-317 ;
- **notes publiques** : `PgListingRatingStore` (exporté par `index.ts`) lit `core.review_listing_ratings` : par annonce `LISTED`, nombre de trips réalisés, nombre d'avis et moyenne du véhicule et de l'hôte, badge « Nuevo » sans avis. Aucune route encore : la recherche (US-201) et la fiche (US-204) le consomment ;
- **note du voyageur vue par l'hôte** : `core.booking_host_trips` (US-219) et `core.booking_host_guest_rows` (US-062) rendent la moyenne des avis des hôtes sur ce voyageur (`host_guest_v`).

Aucun code de l'API n'écrit un avis : l'écriture passe par la console (SUP), qui appelle la base.

## Entités

| Entité (17 §3.2.12) | Table                          | État                                                                                                    |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `review`            | `core.review_review`           | créée (0104) : note globale, sujet (`VEHICLE`, `HOST`, `GUEST`), statut, source ; immuable ; sans texte |
| `rating_aggregate`  | `core.review_rating_aggregate` | créée (0104) : nombre, somme, moyenne ×100 arrondie au demi supérieur (contrainte), avis publiés seuls  |

Aucun rôle applicatif n'a de droit sur ces tables (RLS `ENABLE` + `FORCE`).

## Événements

Aucun événement n'est encore émis par le code : les agrégats sont tenus dans la transaction de l'enregistrement.

Cible (17 §4.5) :

- émis : `review.published` (consommateurs : RPT pour les agrégats, CAT), avec la publication en double aveugle d'US-317 ;
- consommés : aucun n'est listé pour REV dans 17 §4.5. La minuterie `review_window_days` est une tâche durable (`scheduled_job`, 17 §2.11).

## Ports

- `ListingRatingStore` : notes publiques d'annonces (`PgListingRatingStore`, sous `app_api` ; `UnavailableListingRatingStore`, fail-closed). Au plus `LISTING_RATINGS_MAX` (100) annonces par appel ; une ligne mal formée refuse toute la réponse.

## Commandes de test

Unitaires (sans base) :

```bash
pnpm --filter @rueda/api exec vitest run src/modules/rev
```

Preuves L0 sur base réelle, sous les rôles de production, au Panama et au Paraguay : `packages/db/test/l0/l0-us218-reviews.test.ts` (fixture `9987_test_us218_review_fixtures.sql`), par `pnpm --filter @rueda/db test:l0`. Elles demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
