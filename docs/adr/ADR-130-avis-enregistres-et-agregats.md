# ADR-130 — Avis recueillis par l'ops (`RECORD_REVIEW` lié), agrégats, nombre de trips et note du voyageur

- **Statut** : PROPOSÉ (US-218, agent auteur, claude-opus-5-5, 2026-11-15). Revues exigées : `node scripts/ci/check-story-reviews.mjs` (code, architecture, sécurité, qa ; voir la passation `docs/team/handoffs/US-218.md`) ; RLS, rôles et `SECURITY DEFINER` sur un autre modèle que l'auteur.
- **Sources** : 19 US-218 (critères 1 et 2, notes techniques `review`, `rating_aggregate`) ; 16 REV-001 / REV-010 (bêta pilote SIMPLIFIÉ : nombre de trips et moyenne globale, badge « Nuevo » ; `REVIEW_WINDOW_CLOSED`) ; 08 BR-REVIEW-01, BR-REVIEW-03, BR-REVIEW-05 ; 17 §2.2 (REV), §3.2.12, §3.2.13 et §10 (`manual_action`, `RECORD_REVIEW`), §2.3 (`host_guest_v`) ; ADR-092 (cadre des actions de console), ADR-118 (précédent `HANDLE_DSR`), ADR-126 (état du trip), ADR-128 (`core.booking_host_trips`).

## Contexte

En bêta, les avis ne sont pas encore saisis dans l'application (US-317) : ils arrivent par e-mail et l'ops doit les rattacher au trip. 17 §10 classait `RECORD_REVIEW` en « enregistrement seul » faute de table cible ; 19 US-218 crée `review` et `rating_aggregate` et exige que l'avis soit **rattaché au trip** et compte dans l'agrégat (moyenne 4,0 et 5 trips pour 3 avis 5, 4, 3 et 2 trips non notés). US-219 sert déjà une note du voyageur, vide en attendant cette story.

## Décision

1. **`RECORD_REVIEW` devient une action d'état liée** (migration 0104, comme `HANDLE_DSR` en 0090) : même permission (`ops.review_listing_host`, OPS et ADMIN), même sujet (`TRIP`). Saisie **fermée** du cadre d'ADR-092, jamais un nombre : `authorRole` ∈ {`GUEST`, `HOST`} et `overall` ∈ {`ONE` … `FIVE`}. Le texte de l'avis n'est pas recopié (donnée C2) ; l'e-mail reste une pièce de l'action. Sous-notes absentes (bêta pilote).
2. **Commande liée** `core.review_manual_action_record_review`, `SECURITY DEFINER`, propriétaire NOLOGIN **`review_cmd_owner`** (nouveau, amorçage et `roles.ts`), `EXECUTE` au seul `iam_staff_owner`. Le cadre a jugé session, TOTP, permission, portée pays, saisie, idempotence et séparation des tâches ; la commande juge le domaine sur l'état **qui fait foi en base** : trip `COMPLETED` (écrit par les seules commandes d'US-207) ; fenêtre `review_window_days` du **pays du trip** comptée depuis la fin (le premier de la fin prévue et du retour enregistré au journal d'état) ; auteur **relu** (voyageur du trip ; titulaire du compte d'hôte du trip), jamais reçu.
3. **Une fois par partie et par trip** : UQ `(trip_id, author_user_id, subject_type)` de 17 et `INSERT … ON CONFLICT DO NOTHING` ; deux enregistrements concurrents ⇒ un seul, l'autre `REVIEW_ALREADY_RECORDED`. Voyageur ⇒ deux lignes (sujets `VEHICLE` et `HOST`, même note) ; hôte ⇒ une ligne (sujet `GUEST`). L'avis est `PUBLISHED` à l'enregistrement, `source = OPS_RECORDED`, avec l'action de console et l'agent qui l'a saisi.
4. **Agrégats** (`review_rating_aggregate`) tenus dans la **même transaction** par un upsert atomique, sujets dans un ordre fixe ; moyenne ×100 arrondie au **demi supérieur**, imposée par une contrainte (`avg = (somme × 200 + n) / (2n)`), jamais saisie. Seuls les avis publiés comptent : un trip non noté n'entre pas dans la moyenne (BR-REVIEW-05).
5. **Nombre de trips** (16 REV-010) : trips du compte d'hôte, ou du véhicule, à l'état `COMPLETED` ou `IN_DISPUTE` (réalisés), **compté à la lecture**, jamais stocké.
6. **Lecture publique** `core.review_listing_ratings(annonces)` (`review_cmd_owner`, `EXECUTE` au seul `app_api`) : par annonce `LISTED`, nombre de trips, nombre d'avis et moyenne du véhicule et de l'hôte ; ni compte, ni auteur, ni texte ; inconnue ou non publiée : absente ; 100 annonces au plus. Port REV `ListingRatingStore` exporté par `index.ts`, pour la recherche (US-201) et la fiche (US-204) ; aucune route dans cette story.
7. **Note du voyageur vue par l'hôte** (`host_guest_v`) : `core.booking_host_trips` (0101) et `core.booking_host_guest_rows` (0035) rendent la moyenne des avis des hôtes sur ce voyageur, deux décimales, nulle sans avis ou pour un compte pseudonymisé. `host_view_owner` ne lit que la moyenne des agrégats `GUEST` (politique dédiée), jamais un avis.
8. **Registres** : avis immuables (UPDATE, DELETE, TRUNCATE refusés à tout rôle, migrator compris ; erreur `review_record_immutable` → `IMMUTABLE_RECORD`) ; aucun droit des rôles applicatifs sur les deux tables ; RLS `ENABLE` + `FORCE` ; aucune constante de pays.
9. **Console** : formulaire propre (trip, auteur, note, motif, pièces), réservé à OPS et ADMIN ; refus de la commande traduits (`backoffice.review.*`, catalogue v49, es / en / fr / pt-BR). Le libellé de `backoffice.action.RECORD_REVIEW` (« modération ») est corrigé : la modération est BR-REVIEW-07 (US-527).

## Défauts PROPOSÉS

- Issues de la commande : `REVIEW_INPUT_REQUIRED`, `REVIEW_TRIP_NOT_COMPLETED`, `REVIEW_WINDOW_UNKNOWN` (paramètre absent ou mal formé : refus, fail-closed), `REVIEW_AUTHOR_UNKNOWN`, `REVIEW_ALREADY_RECORDED` ; `REVIEW_WINDOW_CLOSED` vient de 16.
- Fenêtre appliquée à l'enregistrement par l'ops (l'instant de l'e-mail n'est pas attesté) ; fin = premier de la fin prévue et du retour.
- Publication immédiate (pas de double aveugle avant US-317) ; seuls des agrégats sont exposés, jamais un avis isolé.
- Pièce facultative pour `RECORD_REVIEW` (le cadre ne l'exige que pour les actions d'enregistrement seul) ; l'interface la demande.
- `IN_DISPUTE` compte comme trip réalisé.
- Comme Turo (`docs/team/COMME_TURO.md`) : note de 1 à 5 par chaque partie, moyenne sur les seuls trips notés, nombre de trips affiché à côté, « Nuevo » sans avis.

## Conséquences et limites

- BR-REVIEW-04 (texte d'au moins 25 caractères dès 3★) ne s'applique pas ici : aucun texte n'est saisi ; il vaudra pour le formulaire d'US-317.
- Aucun événement `review.published` n'est émis (17 §4.5) : il arrive avec la publication en double aveugle d'US-317 ; les agrégats n'en dépendent pas.
- Une fin d'état `POST_TRIP` plus longue que la fenêtre empêche tout avis (le trip n'est `COMPLETED` qu'après) : à revoir avec US-317 si les fenêtres opérationnelles dépassent `review_window_days`.
- `review_cmd_owner` lit des colonnes de `booking_trip`, `booking_trip_state_log`, `iam_organization`, `catalog_listing` (LISTED) et `config_param_value` (`review_window_days`) ; toute nouvelle fonction de ce propriétaire filtre elle-même.
- L'effacement d'une personne (DSR) ne supprime pas ses avis (registre immuable) : l'auteur reste un identifiant, sans nom ni texte ; à traiter avec US-536.
