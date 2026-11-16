# ADR-132 — Fiche du véhicule : galerie dans l'ordre de l'hôte, dates contrôlées par la base, lieu de remise exact au seul voyageur d'un trip confirmé

- **Statut** : PROPOSÉ (US-204, agents back-end et front-end, claude-opus-5-5, 2026-11-15). Revues exigées (`review-requirements.json`, story US-204) : code, sécurité, ux, qa ; RLS, rôles et `SECURITY DEFINER` sur un autre modèle que l'auteur.
- **Sources** : 19 US-204 (critères 1 à 3 ; notes techniques : « bêta : nombre de trips et bloc de l'hôte (US-317) ; dates indisponibles grisées au lot 5 (US-513) ») ; 16 LST-002, LST-003 / LST-020 (bêta SIMPLIFIÉ), LST-006 / LST-008 (LST-008 DIFFÉRÉ), LST-007 ; 08 BR-BOOK-02, BR-BOOK-03, BR-BOOK-04, BR-BOOK-05, BR-BOOK-09, BR-LIST-05 ; 10b S03, UX-65, §4.3 (`web.s03.photos`) ; 17 §2.2, §2.3 (sonde `catalog.vehicle_is_free`, RLS-15, RLS-17, point 5), §2.4 (activation de l'hôte), §3.2.3 ; 22 OQ-P2P-05 ; pré-mortem du lot 2 L2-PM-29 ; passations d'US-201 et d'US-203 ; ADR-099, ADR-101, ADR-127, ADR-130, ADR-131.

## Contexte

La fiche S03 d'US-115 / US-201 montre le prix par jour, l'essentiel du véhicule, la zone approximative et les dates reprises de la recherche. US-204 y ajoute la galerie, le bloc de l'hôte, le choix des dates sur la fiche et l'adresse exacte du lieu de remise au voyageur d'un trip confirmé. Contraintes : (a) aucune photo n'est servie aujourd'hui (stockage US-003, antivirus Q-019 : en production le dépôt répond 503) et la CSP du site n'admet que ses propres images ; (b) la disponibilité ne se lit que par la sonde RLS-17, limitée par IP ; (c) l'adresse exacte ne doit sortir ni avant `BOOKED` ni vers un autre que le voyageur (L2-PM-29) ; (d) la route du devis revient à US-208 (passation d'US-203) : la fiche n'affiche pas de total.

## Décision

1. **Base (migration `0106_catalog_listing_page`)**, trois fonctions `SECURITY DEFINER`, propriétaire `catalog_cmd_owner`, `EXECUTE` au seul `app_api`, lecture seule :
   - `core.catalog_public_gallery(annonce)` : photos **non retirées et non refusées** d'une annonce `LISTED`, dans l'ordre de l'hôte (`position`), au plus 50 ; identifiant, rang et clé du bucket public (`listing/<annonce>/<photo>`) seulement, jamais le texte libre `alt_text` ni l'auteur. Même règle que la publication (0084) : il n'existe pas de revue photo par photo (`listing_manual_review_required` = false, DEC-FONDATEUR-22) ; une photo refusée par l'ops disparaît.
   - `core.catalog_public_slot_check(annonce, début local, fin local)` : une ligne. Mêmes refus que la recherche d'US-201 (`SEARCH_DATES_INVALID`, `SEARCH_DURATION_EXCEEDED`, `SEARCH_UNAVAILABLE`), puis le **préavis du lieu** (`core.catalog_effective_notice_minutes`, borne incluse comme la pose d'un hold) ⇒ `DATES_NOTICE_TOO_SHORT` avec le préavis en minutes, puis l'hôte activable et la sonde sur [début, fin + `buffer_minutes`) ⇒ `DATES_UNAVAILABLE`, sans rien de l'occupation en cause. Fuseau du véhicule (hérité du pays), horloge `platform.now()`.
   - `core.catalog_guest_meeting_point(jeton, annonce)` : libellé, adresse, ville, zone et type du lieu du véhicule, rendus au **seul voyageur de la session** (empreinte du jeton, `core.iam_session_resolve`) qui a un trip de ce véhicule dans un état confirmé et non terminé (`BOOKED`, `CHECKIN_OPEN`, `START_WINDOW_EXPIRED`, `IN_PROGRESS`, `OVERDUE`) ; sinon aucune ligne. Jamais le point exact, le compte d'hôte ni le trip.
   - `catalog_cmd_owner` reçoit la lecture de trois colonnes de `booking_trip` (`guest_user_id`, `vehicle_id`, `status`), politique `catalog_cmd_guest_read` bornée aux mêmes états. Aucun autre droit ; `app_api` n'en reçoit aucun.
2. **API** : `GET /listings/{id}` ajoute `photos` (ordre de l'hôte, clés), `hostVerified` (compte d'hôte `ACTIVE` : l'activation exige l'identité vérifiée, 17 §2.4 ; le prénom n'est rendu que pour un tel compte) et `ratings` (note du véhicule et de l'hôte par REV, port `PublicListingRatings` de CAT câblé par `main.ts` ; notes en panne : 503, jamais « Nuevo » inventé). `GET /listings/{id}/availability?start=&end=` (module de la recherche) : pays de l'annonce, **limite `availability_probe_per_minute` de ce pays par IP** (même limiteur que la recherche), puis la base ; 200 créneau, 404, 409 `DATES_UNAVAILABLE`, 422 `DATES_NOTICE_TOO_SHORT` (`values.noticeHours`, arrondi supérieur) ou refus de la recherche, 429, 503. `GET /listings/{id}/meeting-point` : `SessionGuard`, 200 lieu exact ou 404 `MEETING_POINT_NOT_FOUND` sans rien révéler, jamais en cache.
3. **Photos servies par le site** : la CSP reste `img-src 'self'` ; le serveur du site relaie l'objet du bucket public par la route `/media/listing/{annonce}/{photo}` depuis `WEB_MEDIA_URL` (clé fermée de deux UUID, aucune redirection, 5 s, 10 Mio, JPEG / PNG / WebP seulement, rien d'autre de la réponse amont). Absente : 404, vignette de remplacement. En production, aucune photo n'est déposée tant qu'US-003 n'a pas livré le stockage.
4. **Site (S03)** : galerie bord à bord au balayage, légende `web.s03.photos` (10b §4.3, clé du prototype devenue officielle), photo introuvable remplacée par une vignette (composant client pour la seule détection de l'erreur ; sans JavaScript, la page reste lisible) ; en-tête avec la note du véhicule ou « Nuevo » ; bloc de l'hôte `HostCard` (prénom et monogramme, note, trips, « identité vérifiée » ; ancienneté non servie en bêta, `memberSince` devient facultatif) ; sélecteur de dates en formulaire GET vers la fiche, issue annoncée (`role="alert"` pour un refus, `role="status"` pour « disponible ») ; lieu : zone approximative, ou libellé et adresse exacte pour le voyageur d'un trip confirmé, avec « retour au même lieu ».
5. **Aucun prix nouveau** : la fiche garde le prix par jour ; le total TTC de la fiche et du checkout viendra du devis d'US-208 (même moteur que la recherche), jamais d'un calcul du site.

## Conséquences

- Les trois critères de 19 US-204 sont prouvés sur PostgreSQL sous `app_api` en PA (USD) et PY (PYG) : `packages/db/test/l0/l0-us204-listing-page.test.ts` (fixture `9979` : statut et retrait d'une photo) ; contrat HTTP `listing-page.contract.test.ts` ; e2e `listing.spec.ts` (quatre langues, 360 et 390 px) et écrans `fiche-preavis`, `fiche-lieu-exact` dans `SCREENS`.
- `catalog_cmd_owner` lit désormais trois colonnes des trips confirmés : toute nouvelle fonction sous ce propriétaire hérite de ce pouvoir et doit être revue comme telle (même mise en garde qu'ADR-101).
- La fiche et la recherche consomment deux sondes par parcours (résultats puis fiche) : la limite par IP compte les deux.

## Limites et reports

- **Consignes de rendez-vous** : la bêta montre le libellé du lieu choisi par l'hôte comme consigne ; un champ d'instructions dédié (saisi en A10 / A11) et la vue du trip après le retour jusqu'à la purge à fin + `review_window_days` reviennent à **US-514** (moins longtemps montré, jamais plus : fail-closed). Le lieu d'un trip n'est pas figé à la réservation (un seul lieu par véhicule en bêta).
- **Dates indisponibles grisées** (LST-008) : lot 5 (US-513) ; la bêta refuse simplement les dates prises.
- **Bloc de l'hôte complet** (ancienneté, langues, profil public A13, photo de l'hôte) : US-317 ; « identité vérifiée » repose sur l'activation du compte.
- **Total TTC de la fiche et bouton « Reservar »** : US-208 (route du devis du checkout).
- Flèches de la galerie sur ordinateur : défilement au clavier dans la bande focalisable seulement.
- Report dans `docs/specs/` (PR revue) : ADR-132 en 17 §8.1 ; codes `DATES_UNAVAILABLE` (409), `MEETING_POINT_NOT_FOUND` en 16 A.8.

## Alternatives écartées

- **Route publique du devis sur la fiche** : réservée à US-208 (TermsGuard, consentements) ; un total provisoire calculé à part risquerait deux chiffres.
- **URL directe du bucket dans la page** : élargir `img-src` à une autre origine ferait parler le navigateur à un tiers (adresse IP du visiteur) et dépendrait du fournisseur de stockage non choisi.
- **Adresse exacte dans `GET /listings/{id}` selon la session** : une réponse publique qui change selon le cookie se met mal en cache et mélange C0 et C2 ; la route séparée, gardée par la session et jugée en base, garde la fiche strictement C0.
- **Nouveau propriétaire NOLOGIN** pour le lieu exact : un rôle de plus pour trois colonnes ; `catalog_cmd_owner` lit déjà les lieux exacts (espace de l'hôte).
