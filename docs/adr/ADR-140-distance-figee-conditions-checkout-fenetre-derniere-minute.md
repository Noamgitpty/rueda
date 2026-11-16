# ADR-140 — Distance figée dans le devis, conditions du checkout (annulation gratuite, retenue hors fenêtre), fenêtre de dernière minute en paramètre du pays

- **Statut** : PROPOSÉ (US-205, partie 205b, agent back-end et front-end, claude-opus-5-5, 2026-11-16). Revues exigées : voir `check-story-reviews.mjs` (story US-205) ; argent, RLS, rôles et `SECURITY DEFINER` sur un autre modèle que l'auteur.
- **Sources** : 19 US-205 (critères 1 et 2) ; 16 LST-010, LST-012, PRC-025 ; 08 BR-CXL-01 (formulation exécutable : `freeUntil = lastMinute ? min(bookedAt + 60 min, start) : start − 24 h`), BR-CXL-06, BR-MILEAGE-01 ; 10b S03, S05, UX-54 ; 17 §3.2.5 ; ADR-125 (devis figé), ADR-133 (checkout), ADR-136 (prc.quote/3), ADR-138 (205a) ; revues de la PR #184 (constats mineurs reportés à 205b).

## Contexte

205a (ADR-138) affiche les conditions sur la fiche, mais : la distance n'était pas figée dans le devis (le checkout, le contrat et le reçu ne pouvaient pas citer « le même prix du km ») ; S05 ne disait ni jusqu'à quand l'annulation est gratuite, ni combien on perd après ; la fenêtre de dernière minute (« 1 h ») était une constante de l'API et, pour un départ à moins d'1 h, la fiche promettait une gratuité après le début du voyage, contrairement à 08 ; les revues avaient noté des points mineurs (bandeau en double, mention « protection incluse » des cartes sans condition, lecture non atomique, `/conditions` sans limite de débit).

## Décision

1. **Distance figée dans le devis** (`prc.quote/3`, compatible) : la demande du moteur porte un champ facultatif `mileage` (illimité, ou km par jour et prix du km de l'annonce) ; le devis rend `mileage` (km inclus = km par jour × jours facturables du devis, prix du km). Les documents canoniques ne portent la clé que si la demande la porte : un devis figé avant 205b se rejoue à l'identique. La base (migration `0117`) **écrit toujours** la distance de l'annonce publiée sur le devis (`pricing_quote.mileage_mode`, `included_km`, `extra_km_price_minor`, jamais celle du client) et, si les documents la portent, exige qu'elle soit exactement celle de l'annonce et du rejeu, sinon `QUOTE_MISMATCH`. Le contrat (US-211) et le reçu (US-213) liront ces colonnes.
2. **Conditions du checkout (S05)** : le devis lu rend la distance figée, l'annulation gratuite pour le départ du devis si la réservation a lieu maintenant (`core.catalog_public_terms`, même calcul que la fiche) et la **retenue hors fenêtre** : l'API rejoue le devis figé depuis ses documents (`core.pricing_checkout_terms`, voyageur de la session seulement) et applique le **moteur de règlement unique** (`computeCancellationSettlement`, `cxl-beta/1`) à une annulation volontaire juste après la fin de la fenêtre (`lateCancellationOf`, PRC) : jours retenus (1, ou ½ pour un trip de 2 jours ou moins) et montant TTC. Aucune durée ni aucun montant n'est écrit dans les textes ; devis antérieur, rejeu ou paramètres impossibles ⇒ aucune retenue affichée, renvoi à la politique publiée.
3. **Fenêtre de dernière minute en paramètre du pays** : `last_minute_free_window_minutes` (graine générée `0116`, DURATION en minutes, BLOCK, 60 PA / PY, PROPOSÉ comme Turo). La base calcule `freeUntil = min(maintenant + fenêtre, départ)` en dernière minute ; l'API rend la date et `endsAtStart` ; l'écran dit « gratuite pendant {fenêtre} après la réservation », ou « jusqu'au début du voyage ({date}) » quand le départ arrive avant. Une fenêtre qui n'est pas un nombre entier d'heures est dite en minutes (plus d'arrondi).
4. **Constats de 205a** : lecture atomique du contrôle des dates et des conditions (une requête, `LEFT JOIN LATERAL`) ; `GET /listings/{id}/conditions` limitée par IP comme les dates (sonde `availability_probe_per_minute`, 429 et `Retry-After`) ; mention « protection incluse » des cartes seulement si la base promet la couverture (`protectionOffered`, même règle que la fiche, une requête par page) ; « pas encore réservable » dit une seule fois sur la fiche (la section protection ne répète plus le bandeau du prix).
5. **Variante de 10b S03 (PROPOSÉ)** : sur la fiche, annulation, distance, protection et caution sont placées **avant** le prix et « Reservar » (10b les place après le prix), le prix restant groupé avec son bouton ; sur S05, les conditions sont entre le prix et la confirmation. Motif : le voyageur lit ses risques avant d'agir (revue ux de 205a n° 3).

## Défauts PROPOSÉS (comme Turo, `docs/team/COMME_TURO.md`)

- Au checkout : date limite d'annulation et retenue hors fenêtre en jours de location et en montant (« Después, se retiene 1 día de alquiler: {amount} », 10b UX-54) ; distance de la période et prix du km répétés au checkout.
- Fenêtre de dernière minute : 1 h après la réservation, jamais après le début du voyage ; paramètre du pays.

## Conséquences

- Le moteur d'annulation `cxl-beta/1` garde sa fenêtre de politique (60 min) : il ne lit pas encore `last_minute_free_window_minutes`. Les deux valent 60 ; changer le paramètre exige une version du moteur qui le lise (suite, US-224 / US-213). La retenue affichée ne dépend pas de la fenêtre (jours retenus et montant).
- La distance du devis n'est pas une ligne : aucun montant ni aucune jambe ne change (`prc.quote/3` inchangé pour l'argent).
- `core.catalog_public_terms` est recréée avec une colonne de plus (`last_minute_window_minutes`) ; `free_until` est désormais rendue aussi en dernière minute.

## Report dans `docs/specs/` (PR revue)

ADR-140 en 17 §8.1 ; colonnes `mileage_mode`, `included_km`, `extra_km_price_minor` de `quote` en 17 §3.2.5 ; `last_minute_free_window_minutes` en 17 §7.2 ; clés `web.s05.conditions.*`, `web.s05.cancel.retained*`, `web.listing.cancel.untilStart`, `…lastMinuteMinutes`, `…lateMinutes`, `web.listing.protection.unavailableShort` en 10b §4.3 ; variante d'ordre de S03 en 10b §4.1.
