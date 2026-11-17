# ADR-144 — Écrans du voyageur d'une réservation signalée : état de revue du hold, S05 en revue, déclaration d'entrée

- **Statut** : PROPOSÉ (US-209, partie 209c, agent front-end, claude-opus-5-5, 2026-11-16). Revues exigées : celles de `review-requirements.json` pour US-209 (`check-story-reviews.mjs`) ; RLS, rôles et `SECURITY DEFINER` sur un autre modèle que l'auteur.
- **Sources** : 19 US-209 (critères 2 et 4) ; 16 BKG-012, BKG-014, VER-007 ; 17 §2.5 (« Revue ops avant le débit ») ; 10b S05, UX-35, UXQ-08, UXQ-12, §4.3 (`web.s05.review.title`) ; 22 UXQ-03 ; ADR-135 (209a), ADR-141 (209b), ADR-142 (paiement du hold, S05 / S06) ; BOARD N-172, N-203 ; GO_LIVE GL-17.
- **S'appuie sur** : migration 0119 (décision, prolongation unique, hold de revue échu `RELEASED` / `REVIEW_REJECTED`), route `POST /identity/entry-declaration` (209b).

## Contexte

Après 209b, l'ops décide une réservation signalée, mais le voyageur n'en voit rien : `GET /checkout/holds/{id}` ne disait pas qu'un hold était en revue, S05 (223b) affichait donc « Pagar » sur un hold en revue (le clic rendait `409 BOOKING_UNDER_REVIEW` : N-203) ; un hold refusé ouvrait S06 « Reserva expirada » ; la déclaration d'entrée n'avait aucun écran ; les refus du conducteur liés à la vérification d'identité ne menaient nulle part (UXQ-12).

## Décision

1. **État de revue lu par le voyageur** : fonction ajoutée `core.booking_checkout_review_state(token, hold)` (migration **0120**, `cmd_hold_owner`, SECURITY DEFINER, EXECUTE `app_api` seul), dérivée des colonnes du hold, sans aucune donnée de l'évaluation ni motif : `REJECTED` (hold `RELEASED` motif `REVIEW_REJECTED`), `PENDING` (`review_required` sans `reviewed_at`), `APPROVED` (revu), `NONE`. Fonction ajoutée plutôt que `booking_checkout_summary` remplacée : changer son type de retour exigerait un `DROP` (contraction). L'API la lit dans la même instruction que le récapitulatif et rend `reviewState` dans `CheckoutHold` (OpenAPI) ; état absent ou inconnu ⇒ `503` (jamais un hold présenté comme payable).
2. **S05 du hold** (`/checkout/hold/{id}`) : « Pagar » seulement si le hold est `ACTIVE` et `reviewState` vaut `NONE` ou `APPROVED` (`holdPayable`, N-203). `PENDING` : « Reserva en revisión: no se te cobró nada » (10b), **heure de la réponse** = échéance du hold de revue rendue par l'API, jamais une durée écrite (`web.s05.review.until` : « La revisamos antes de las {time}. Si no la aprobamos para entonces, liberamos el auto sin cobrarte nada. ») ; relecture automatique toutes les 30 s tant que la page est visible, jusqu'à l'échéance plus une relecture ; « Actualizar el estado » ; aide vers la déclaration d'entrée. `APPROVED` : « Reserva aprobada », fenêtre de paiement réelle (échéance prolongée par la décision) et « Pagar ». Changement d'état annoncé par la région vive persistante de S06 (`StateAnnouncer`, généralisé), focus sur le titre de la revue.
3. **Écart avec 10b UX-35, PROPOSÉ** (L2R-42) : la clé spécifiée `web.s05.review.body` (« en un máximo de {count} horas hábiles ») **n'est pas livrée** : le délai livré est calendaire (`review_hold_minutes`, ADR-141) ; le texte dit l'heure exacte lue dans l'API, ce qui reste vrai quelle que soit la valeur du paramètre pays. À trancher dans 10b par la PR de spécification.
4. **S06 d'un hold refusé** : `ENDED` avec `reviewState` = `REJECTED` ⇒ « Reserva no aprobada », « No se te cobró nada » et la recherche ; le refus et la revue non faite à temps ne sont jamais distingués pour le voyageur et aucun motif n'est montré (08 BR-VERIF-03, ADR-141).
5. **Lien vers S04 (UXQ-12)** : sur S05 (pose du hold) et au paiement, les refus `KYC_NOT_APPROVED`, `KYC_BIOMETRIC_CONSENT_MISSING`, `KYC_LICENSE_EXPIRED` ajoutent « Ir a la verificación de identidad » (`/verify-identity`) ; `AGE_CLASS_MISMATCH` n'en a pas (rien à faire sur S04).
6. **Déclaration d'entrée** (`/verify-identity/entry`, ouverte depuis S04 et depuis S05 en revue) : pays où l'on conduit (pays de la configuration lus par `GET /identity`), statut touriste ou résident (rien de pré-coché), date d'entrée (obligatoire pour un touriste, jour réel du calendrier) ; mêmes règles de forme que la route ; refus de l'API sur leur champ (date future ⇒ `KYC_ENTRY_DATE_INVALID`) ; confirmation dans une région vive, **date mise en forme par langue** (`i18n.date` à midi UTC : jour exact, aucun décalage de fuseau). La déclaration n'est jamais exigée pour réserver (mode FLAG) ; aucune lecture de la déclaration en vigueur n'est exposée au voyageur (suite).
7. **Notification du voyageur** : aucun consommateur de `booking.hold.review_decided` n'existe (NTF ne s'y abonne pas ; la charge utile ne porte pas l'identifiant du voyageur, sans donnée personnelle par construction, ADR-141) : **non livrée ici**, laissée en suite et au préalable GL-17. Les textes ne promettent aucun avis (`common.payment.underReview` ne dit plus « te avisaremos ») ; S05 se relit seule et invite à revenir.

## Conséquences

- Aucun bouton de paiement sur un hold en revue ; la base reste la garde (`hold_review_before_payment`).
- Un voyageur signalé sait que sa réservation est en revue, jusqu'à quelle heure, puis si elle est approuvée (avec l'heure limite pour payer) ou non — tant qu'il garde ou rouvre la page : sans notification, GL-17 reste ouverte.
- Catalogue v64 (la v63 est réservée à US-211) ; migration 0120 (à renuméroter à la fusion si US-211 prend 0120 avant).

## Suites

- Notification de chaque issue (approbation avec l'heure limite, refus, revue échue) : consommateur NTF de `booking.hold.review_decided` et de `booking.hold.released` (`REVIEW_REJECTED`), identifiant du voyageur à ajouter à la charge utile ou à résoudre par NTF ; `aggregate_version` à numéroter (N-202). Préalable GL-17.
- Lecture de la déclaration d'entrée en vigueur par le voyageur (aujourd'hui seule la confirmation de l'envoi est montrée) ; photo du tampon (VER-007, facultative).
- Retour de S04 vers S05 après une vérification réussie (paramètre de retour).
- Report dans `docs/specs/` (PR revue) : ADR-144 en 17 §8.1 ; `reviewState` et `core.booking_checkout_review_state` en 17 ; clés `web.s05.review.*`, `web.s06.reviewRejected.*`, `web.s04.entry.*` en 10b §4.3 ; écart UX-35 (point 3).
