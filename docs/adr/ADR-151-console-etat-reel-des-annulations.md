# ADR-151 — Console des annulations : saisie fermée, confirmation, état réel de la demande

- **Statut** : PROPOSÉ (US-215, partie 215b, agent front-end / back-end, claude-opus-5-5, 2026-11-17). Revues exigées : celles de `check-story-reviews.mjs` (dont ux : revue design OUI pour US-215) ; `SECURITY DEFINER` et rôles sur un autre modèle que l'auteur. À reporter dans 10b (O01) et 17 §10 (lecture de la demande).
- **Complète** : ADR-148 (demande d'annulation et règlement par le travailleur `trip_lifecycle`, 0124), ADR-092 (cadre des actions de console), ADR-122 (séparation des tâches), ADR-097 (console O01).
- **Sources** : 19 US-215 ; 16 ADM-006, BKG-035 ; passation US-215 (« Raisons de refus à traduire en 215b », « Problème du formulaire générique ») ; BOARD N-228.

## Contexte

Depuis 0124, `POST /console/actions` répond 201 `STAFF_ACTION_DONE` (« C'est fait ») dès que la DEMANDE d'annulation est enregistrée ; le règlement est fait quelques secondes plus tard par le travailleur et peut finir `FIN_REVIEW` ou `FAILED`. Le formulaire générique de la console n'envoyait aucune saisie : `CANCEL_TRIP_PLATFORM` était toujours refusé (`CANCEL_REASON_REQUIRED`) et `CANCEL_TRIP_HOST` ne pouvait pas dire « à cause du voyageur ». Rien ne permettait de lire l'état d'une demande.

## Décision

1. **Formulaire propre aux trois annulations** (`apps/backoffice/app/console/cancel-view.tsx`), retiré du formulaire générique : l'agent choisit d'abord qui demande (voyageur, hôte, plateforme) ; le formulaire montre alors la seule saisie fermée de l'action (sous-motif de l'hôte, « sans faute du voyageur » par défaut ; motif de la plateforme exigé, sans présélection), le motif libre et les pièces. Aucun champ de montant.
2. **Confirmation avant envoi** : récapitulatif (voyage, action, motif choisi, motif libre, nombre de pièces) et rappel qu'une annulation réglée ne se défait pas ; « à cause du voyageur » sans pièce est signalé (requalifiée en annulation de l'hôte avec pénalité, ADR-148 point 3). Rien n'est envoyé avant la confirmation ; un `requestId` par intention (double clic reconnu par la base).
3. **État réel** : après l'envoi, la console lit `GET /console/trips/{id}/cancellation` (dernière demande du trip) et la relit toutes les 3 s, 8 fois au plus, tant qu'elle est `PENDING` ; ensuite l'agent actualise. Écrans : en attente ; réglée (porteur du coût, issue du trip, remboursement du voyageur, pénalité et compensation non nulles, variation par partie, ordres de remboursement et leur état) ; en revue FINANCE ; en échec — chacun avec la raison lisible du code garé et la suite à donner. Le message de l'envoi est « Demande enregistrée, règlement en cours », jamais « C'est fait ». Un refus de la commande (`STAFF_ACTION_REFUSED`, `values.reason`) est expliqué ; `CANCELLATION_PENDING` propose de lire la demande vivante. La lecture de l'état est aussi offerte seule (identifiant du voyage).
4. **Lecture côté base** (migration 0127, fonctions AJOUTÉES) : `core.support_staff_trip_cancellation` (iam_staff_owner, EXECUTE app_api) : session élevée par TOTP, permission `ops.platform_cancel` EN COURS dans le pays du trip (celle des trois actions), garde ADR-122, chaque refus journalisé ; trip inconnu ⇒ `FORBIDDEN` comme un trip d'un autre pays (aucun oracle d'existence). Elle appelle `core.booking_staff_trip_cancellation` (cmd_hold_owner) et `core.settlement_staff_cancellation_summary` (cmd_money_owner), toutes deux EXECUTE iam_staff_owner seulement ; aucun droit sur une table n'est accordé. Montants en unités mineures, rendus en texte (bigint exact) ; l'exposant de la devise est joint par l'API dans la même instruction (`core.config_currency`, lisible par app_api) pour l'affichage seulement.
5. **Lecture non inscrite au journal des accès** (PROPOSÉ) : le corps ne porte aucune donnée personnelle (codes, montants, identifiants techniques ; jamais l'agent demandeur) ; une relecture toutes les quelques secondes n'écrit rien. Les refus, eux, sont journalisés. À revoir si un champ personnel y est ajouté.

## Conséquences

- Matrice des routes : `GET /console/trips/{id}/cancellation` (OPS_AGENT, ADMIN ; portée pays). OpenAPI : `consoleTripCancellation`, schéma `TripCancellation`.
- Catalogue v69 : `backoffice.cancel.*` en es / en / fr / pt-BR.
- GL-28 : la ligne « lecture par la console de l'état réel » passe à **Existe**.
- Non couvert (suites) : sortie des demandes `FIN_REVIEW` (N-221, US-224c) ; envoi au PSP (US-224c) ; notification du voyageur et de l'hôte (NTF) ; N-116, N-123, N-126 (US-215c) ; compteur des essais du processeur tenu en base (N-222, seconde moitié).
