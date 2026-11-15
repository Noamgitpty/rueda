# ADR-127 — Espace hôte : lecture des trips de l'hôte (A02, A05), minimisation du voyageur, mode `REQUEST` reporté

- **Statut** : PROPOSÉ (US-219, agent auteur, claude-opus-5-5, 2026-11-15). Revues exigées : `node scripts/ci/check-story-reviews.mjs` (code, architecture, sécurité, argent, ux, qa ; voir la passation `docs/team/handoffs/US-219.md`) ; RLS, rôles et `SECURITY DEFINER` sur un autre modèle que l'auteur.
- **Sources** : 19 US-219 (critères 1 à 7, notes techniques) ; 16 HDB-001 / HDB-002 ; 17 §2.3 (`host_guest_v`, RLS-2, RLS-9, RLS-28, point 5), §2.5 (hold `REQUEST`, exigences de sécurité et d'argent) ; 08 BR-BOOK-01, E7 règle 1 ; 22 OQ-P2P-10 ; 10b §3.8 (UX-39, UX-43, UX-44), §4.3 ; pré-mortem du lot 2 (L2-PM-09, L2-PM-10, L2-PM-25, L2-PM-31, L2-PM-34, L2-PM-35) ; ADR-064 (minimisation), ADR-099 (routes de l'hôte), ADR-126 (machine à états du trip).

## Contexte

L'hôte n'avait aucune vue de ses trips : `core.booking_host_guest_v` (US-062) donnait le voyageur minimisé, mais par le contexte `app.*` que les routes de l'hôte n'utilisent pas (elles désignent l'hôte par l'empreinte de son jeton, ADR-099). US-207 a fusionné la machine à états du trip ; l'espace hôte doit **lire** les trips et n'écrire l'état que par les commandes existantes.

## Décision

1. **Une lecture en base, et rien d'autre** : migration 0100, `core.booking_host_trips(jeton, compte, onglet, véhicule, du, au, trip, limite)`, `SECURITY DEFINER` sous `host_view_owner` (le propriétaire des vues minimisées de l'hôte, US-062), `EXECUTE` au seul `app_api`. Aucune table ni écriture. L'hôte est celui de la **session** ; le compte doit être l'un de ses comptes **titulaires** (`core.iam_host_accounts`) : sinon une seule ligne `FORBIDDEN`, aucun trip. Droits ajoutés à `host_view_owner` : colonnes d'affichage du trip, `conversion_operation_id` du hold, `(operation_id, leg, amount_minor)` des jambes, `(user_id, status, is_current, expires_at)` de la vérification d'identité, chacun avec une politique `host_view_read` (`USING (true)` : le filtre est dans la fonction, comme 0035).
2. **Minimisation** (17 `host_guest_v`, NOUVELLE-16) : du voyageur, le prénom, l'âge (années révolues à la date locale du trip), la note (nulle : `rating_aggregate` arrive avec US-218) et un booléen « identité vérifiée » (vérification courante `APPROVED`, non échue). Jamais l'identifiant, le nom, le contact, le permis ni une pièce ; compte pseudonymisé : ni prénom ni âge.
3. **Gains estimés** : montant **explicite** de la jambe `HOST` de l'opération qui a converti le hold (08 E7 règle 1), relu tel quel, jamais recalculé ni au prorata ; nul pour un trip annulé (le règlement d'une annulation fait foi : US-314, US-541). Titulaire seulement (RLS-28). L'API sert l'exposant de la devise du pays ; le site formate le `bigint` (PYG sans décimale).
4. **Onglets et ordre** (16 HDB-002, UX-39) : `UPCOMING` (BOOKED, CHECKIN_OPEN, début le plus proche d'abord : prochaines remises en tête), `IN_PROGRESS` (START_WINDOW_EXPIRED, IN_PROGRESS, OVERDUE, UNRETURNED ; fin la plus proche d'abord : prochains retours), `DONE` et `CANCELLED` (les plus récents d'abord). Filtres : véhicule ; dates locales du trip (chevauchement) ; 200 lignes au plus.
5. **Routes** (module CAT, espace hôte de 16 HDB) : `GET /host/accounts/{orgId}/trips` et `GET /host/accounts/{orgId}/trips/{tripId}`, gardées par `SessionGuard` puis `TermsGuard` (le segment `trips` en fait une route de réservation, US-102, N-43). Compte d'un autre hôte : 404 `HOST_ACCOUNT_NOT_FOUND` ; trip d'un autre hôte ou inconnu : 404 `TRIP_NOT_FOUND` (rien n'est révélé, 17 §2.3 point 5). Codes PROPOSÉS : `TRIP_NOT_FOUND`, `HOST_TRIPS_UNAVAILABLE` (503, fail-closed). Le véhicule et le lieu de remise sont joints par les lectures d'US-115.
6. **Écart assumé de 17 §2.2 : CAT → CTR** (`TermsGuard`), inscrit dans `dependency-graph.ts` et `SPEC_GAPS` (`docs-sync.test.ts`), à reporter dans 17 §2.2 par une demande de fusion revue. Alternative écartée : servir les routes depuis AVL, qui ne dépend pas d'IAM (`SessionGuard`) dans 17 ; renommer le chemin pour échapper au détecteur de `TermsGuard` serait un contournement.
7. **Écrans** : A02 (bloc « prochaines remises » et « prochains retours » de `/host`, trois trips chacun, lien vers A05) ; A05 `/host/trips` (onglets, filtres, cartes) et `/host/trips/{tripId}` (détail) ; lecture seule, jetons de thème, mobile d'abord, quatre langues (catalogue v44).

## Défauts PROPOSÉS

- Âge et vérification calculés comme `host_guest_v` ; note nulle jusqu'aux avis.
- Le lieu de remise affiché est le lieu **actuel** du véhicule (aucun lieu figé au trip en bêta).
- Aucun statut SM-1 détaillé n'est affiché : l'onglet du trip sert de statut (les clés par état arrivent avec les actions de remise et de retour, US-315).
- La salutation `web.a02.greeting` et les gains du mois (`web.a02.earnings.title`) ne sont pas livrés : prénom de l'hôte non servi par la session, gains du mois définis par US-314.

## Mode `REQUEST` (critères 4 à 6 de 19 US-219) : reporté, fail-closed

Le mode `REQUEST` exige l'autorisation à l'envoi (`createHostedPayment` en capture `MANUAL`), la **capture par jambes** à l'acceptation et le `VOID` total au refus ou à l'expiration (17 §2.5, exigences d'argent (a) à (c)) : ce sont les commandes de paiement d'US-223 (avec US-209), non fusionnées. Construire ici `cmd_accept_booking_request` sans capture laisserait un hold `PAYMENT_IN_FLIGHT` sans ordre ; écrire les ordres `CAPTURE` / `VOID` reviendrait à livrer US-223 dans US-219. Décision PROPOSÉE : le cycle du hold `REQUEST` (statut `AWAITING_HOST`, `request_respond_by`, trois commandes, tâche d'expiration, deltas SQL de 17 §2.5) est construit **avec** US-223, dans la même PR ou juste après, et revu par la sécurité et l'argent ensemble. Critère 7 (annonce aéroport ⇒ `REQUEST_MODE_NOT_ALLOWED`, l'annonce reste `INSTANT`) : déjà tenu par `core.catalog_cmd_create_listing` (0067, US-115) et prouvé par `l0-us115-host-listings` ; aucune commande ne change le mode d'une annonce existante.

Risque connu (hors de ce diff, à trancher avec US-223) : une annonce créée par l'API avec `instantBook = false` (le site ne le propose pas) est aujourd'hui réservée comme `INSTANT`, faute de hold `REQUEST`.

## Conséquences et limites

- Aucune écriture : les actions d'A05 (remise, retour, écrire, annuler, no-show) arrivent avec leurs stories (US-315, US-520, US-213) et passent par les commandes d'US-207.
- `host_view_owner` lit désormais des colonnes de quatre tables de plus ; toute nouvelle fonction de ce propriétaire doit filtrer elle-même (politiques `USING (true)`).
- N-117 (membres `INVITED` comptés comme parties de la console) : tranché à la DoR, **conservé** (fail-closed) ; voir la passation.
