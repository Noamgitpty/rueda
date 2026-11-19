# ADR-175 — Points d'entrée du mode sur demande : recherche, fiche S03 et devis S05 lus par pays ; le réglage reste fermé jusqu'à GL-26

- **Statut** : PROPOSÉ (US-223, ouverture du mode, agent de story, claude-opus-5-5, 2026-11-19). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` ; RLS / rôles et `SECURITY DEFINER` sur un autre modèle que l'auteur.
- **Complète** : ADR-127 (recherche publique, 0103 : « réservation immédiate seulement »), ADR-146 (mode `REQUEST`, 0125 / 0126 : `booking_request_mode_enabled` faux dans chaque pays), ADR-152 (écrans qui suivent la pose : S05 du hold, S07, S06, A05).
- **Sources** : 19 US-223 (DoR 2 : tant que `REQUEST` n'existe pas, une annonce `instant_book = false` n'est ni proposée par la recherche ni réservable) ; 08 BR-BOOK-01 (mode au choix de l'hôte) ; 22 OQ-P2P-10 (instantanée par défaut, `REQUEST` optionnel, 4 h) ; 17 §2.5, §7.2 ; 10b S03 `web.s03.request` ; 16 NFR-07 (ce que l'hôte voit du voyageur) ; BOARD N-246, N-286, N-287, N-288 ; GL-26.

## Contexte

Après 223c (#199) et 223d (#213), tout le cycle d'une demande existe côté serveur et côté écrans, mais aucun point d'entrée ne mène à une demande : la recherche et les zones écartent les annonces sur demande (0103), la fiche S03 et le devis S05 affichent `common.checkout.requestModeUnavailable` d'après le seul `instantBook`. Ouvrir ces points d'entrée sans lire le réglage du pays proposerait des annonces que le checkout refuse (`REQUEST_MODE_UNAVAILABLE`).

## Décision

1. **Une seule source par pays : la base.** `core.catalog_request_mode_hours(pays)` (0153, SECURITY INVOKER, EXECUTE au seul `catalog_cmd_owner`) rend le délai de réponse de l'hôte si `booking_request_mode_enabled` est vrai **et** `booking_request_expiry_hours` est un entier ≥ 1, sinon `NULL`. Lecture bornée par une politique dédiée (`catalog_cmd_request_mode_read`, ces deux clés seulement) et par l'aide `core.booking_param_bool` de 0126.
2. **Recherche et zones** (`catalog_public_search`, `catalog_public_areas`, corps de 0103 recopiés) : `l.instant_book OR mode ouvert dans le pays`. Mode fermé : résultat identique à 0103. La règle du checkout (0126) reste la seule qui crée un hold `REQUEST`.
3. **Lecture publique** `core.catalog_public_request_terms(pays)` (SECURITY DEFINER, propriétaire `catalog_cmd_owner`, `search_path` figé, liste blanche RLS-15, EXECUTE au seul `app_api`) : `(request_mode_enabled, request_expiry_hours)`, rien d'autre, aucune donnée personnelle ; pays inconnu : fermé.
4. **API** (ajout seulement, compatible N-1) : `requestMode` (`RequestModeTerms` : `enabled`, `expiryHours`) dans `GET /listings/{id}` et dans le devis `GET /checkout/quotes/{id}` ; lu en fail-closed (`requestModeOf` : vrai seulement avec un délai entier ≥ 1). AVL garde sa propre lecture du type (AVL ne dépend pas de CAT).
5. **Site** : S03 « {host_name} confirma en hasta {count} horas » (10b, promu du prototype) et « Reservar » ; S05 du devis : même phrase (hôte en prénom et initiale) et bouton `web.s05.request.continue` (« Continuar con la solicitud ») : l'envoi reste le bouton « Enviar solicitud » de S05 du hold (223d), jamais deux boutons « Enviar solicitud » de suite. Mode absent, mal formé ou fermé ⇒ bandeau `requestModeUnavailable` (le site ne déduit jamais le mode de `instantBook`).
6. **Le réglage reste faux** en PA et en PY. Le passer à vrai est une ligne de GL-26, pays par pays, avec ses conditions du lot C (PSP avec `SUPPORTS_PREAUTH` / `SUPPORTS_VOID` validés, consommateur `payment_command`, notifications `booking.request.*`, limiteur des routes `/requests`, CGU relues) ; aucune migration de cette story ne change une valeur de paramètre (il n'existe pas encore de commande revue de changement de paramètre : les graines sont immuables). C'est le défaut fail-closed ; le code est prêt, la recette le prouve en transaction annulée (L0) et sur le double de l'API (e2e).
7. **Avant l'ouverture** (BOARD) : N-286 (bandeau d'A05 forgeable par `?request=ACCEPTED`) : l'issue d'une décision voyage dans un cookie httpOnly, `SameSite=Strict`, limité à `/host/trips`, d'une minute, déposé par l'action serveur après la réponse 200 de l'API ; l'URL n'est plus lue. N-288 : S06 refusée ou expirée dit que l'autorisation de la carte est annulée, sans débit (`web.s06.request.authorizationRelease`). N-287 : l'âge du voyageur reste affiché à l'hôte : 16 NFR-07 le prévoit (« prénom, photo, âge, note, statut de vérification ») ; aucun changement.

## Options écartées

- Passer `booking_request_mode_enabled` à vrai par une migration dès maintenant (N-246, « PROPOSÉ comme Turo ») : ouvrirait le mode avant les conditions de GL-26 (annulation d'autorisation non exécutée faute de consommateur, notifications absentes) et demanderait un mécanisme de changement de valeur de paramètre qui n'existe pas (graines générées et immuables).
- Déduire le mode de `instantBook` côté site : une annonce sur demande d'un pays fermé serait proposée puis refusée au checkout.
- Recopier la règle dans le module AVL du checkout : 0126 la porte déjà ; la recherche et la fiche lisent les mêmes paramètres.
- Relire l'état de la demande depuis l'API pour le bandeau d'A05 : une demande refusée ou convertie disparaît de `GET …/requests/{id}` (404) ; on ne distinguerait plus « acceptée » de « refusée ».

## Conséquences

- Production et bêta d'aujourd'hui : rien ne change (réglage faux) ; dès que GL-26 passe le réglage à vrai dans un pays, la recherche, les zones, S03 et S05 proposent les annonces sur demande de ce pays seulement.
- Le bandeau d'A05 peut réapparaître pendant une minute si l'hôte recharge la page (le cookie n'est pas effacé par un composant serveur) ; il dit toujours l'issue rendue par l'API.
- Preuves : `packages/db/test/l0/l0-us201-public-search.test.ts` (bloc US-223 : fermé / ouvert / refermé, par pays, PA et PY, rôles de production ; 42501 pour `app_worker`, `app_anon` et l'aide interne), `config-country.test.ts` (inventaire des politiques), `cat/testing/listing-page.contract.test.ts` et les contrats du checkout (OpenAPI), `apps/web/account/request-mode.test.ts`, e2e `request-mode.spec.ts` (S03 → S05 → demande, mobile-360, quatre langues).
