# ADR-183 — Remise et retour du véhicule entre particuliers : conditions relues par la base, permis sans pièce, seconde validation à l'heure serveur

- **Statut** : PROPOSÉ (US-315, agent de story, rôle back-end et front-end, claude-opus-5-5, 2026-11-19). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` (code, architecture, sécurité, argent, ux, qa) ; RLS / rôles, `SECURITY DEFINER` et concurrence sur un autre modèle que l'auteur.
- **Complète** : ADR-126 (machine à états SM-1, transitions gardées et journalisées), ADR-143 (contrat signé exigé à la remise), ADR-169 / ADR-172 (caution ; la libération suit la première transition `RETURNED` du journal), ADR-179 (photos guidées, séries par côté), ADR-005 / ADR-039 (PWA en ligne, repli hors ligne au lot 5).
- **Sources** : 19 US-315 ; 16 TRP-002, VER-015, TRP-033, PRT-001 ; 08 BR-PICKUP-01, 03, 05, 08, BR-VERIF-07, BR-RETURN-01 ; 17 §2.5 (ordre des verrous), §3.2.2 (`trip_identity_check`), §3.2.10 (`trip_inspection`, `key_handover`), §7.2 (`p2p_contactless_handover_enabled`) ; 10b UX-37, UX-41, UX-42, A03, A04, S09 ; 22 OQ-P2P-05 ; pré-mortem du lot 3 (L3-PM-08 à L3-PM-14, L3-PM-32).

## Contexte

La remise et le retour se font en personne, entre l'hôte et le voyageur, au lieu déclaré par l'hôte. Les séries de photos existent (US-303) ; il manquait l'ouverture de la remise, le contrôle du permis par l'hôte, la validation de chaque partie et le passage du trip à `IN_PROGRESS` puis à `RETURNED`. Le pré-mortem du lot 3 range parmi les risques critiques une remise ouverte sans paiement prouvé ni contrat (L3-PM-08), une heure de début ou de fin venue de l'appareil (L3-PM-09) et deux validations concurrentes (L3-PM-10).

## Décision

1. **Partie de la session** : la base juge la partie par l'empreinte du jeton (titulaire du compte d'hôte, ou voyageur du trip) ; toute autre personne, trip inconnu, sens mal formé : `NOT_FOUND` (404, même réponse). Co-hôte : suite.
2. **Ouverture** (`core.trip_cmd_open_checkin`, BOOKED → CHECKIN_OPEN, motif `CHECKIN_WINDOW_OPENED`) par l'une ou l'autre partie, au plus tôt 24 h avant le début (règle commune de 08 BR-PICKUP-01, pas une constante de pays). La base relit au même instant, sous les verrous : loyer SUCCEEDED **prouvé par webhook signé** (`WEBHOOK_SIGNED` ; un `POLL` ne suffit pas) et `payment_status` CONFIRMED ; dernière version du contrat signée par le voyageur ; décision de caution présente et, si la caution est exigée, `AUTHORIZED` ; `insurer_contract_active[pays]` ; éligibilité du voyageur (`booking_guest_eligibility` : restriction, consentement, conducteur) ; conducteur principal approuvé ; hôte sans restriction, compte d'hôte actif. Une condition illisible bloque (fail-closed). La vue rend la liste ordonnée des conditions manquantes ; une restriction n'est jamais nommée à l'autre partie (`HANDOVER_BLOCKED`).
3. **Contrôle du permis** (`core.trip_cmd_identity_check`, hôte seul) : six booléens de VER-015 (`face`, `name`, `birthYear`, `valid`, `provisional`, `restrictions`) ; la base ne sert à l'hôte que le prénom, l'initiale du nom et l'année de naissance du voyageur, au départ seulement ; jamais un numéro, une pièce, une image ni une date complète. Tous cochés ⇒ `TRIP_ID_OK` ; un point non conforme ⇒ `TRIP_ID_FAILED` avec un motif de la liste, **définitif** : plus aucune validation du départ ne passe ; le refus et sa décision par l'ops appartiennent à US-307.
4. **Validation de chaque partie** (`core.trip_cmd_validate_handover`, une ligne par partie et par sens, ajout seul) : sa série de photos validée (US-303), compteur et carburant relevés par elle (au retour, compteur au moins égal à celui qu'elle a relevé au départ), remise **en personne** seulement ; au départ, les conditions du point 2 relues et, pour l'hôte, le permis contrôlé conforme. Ordre des contrôles documenté dans la migration (partie, verrous, idempotence, mode, fenêtre, relevés, série, conditions, permis).
5. **Transition à la seconde validation**, sous les verrous consultatifs du voyageur puis du véhicule (ordre global de 17 §2.5, celui de `booking_trip_lock`) : CHECKIN_OPEN ou START_WINDOW_EXPIRED → IN_PROGRESS (`CHECKIN_VALIDATED`, `checkin_validated_at` = `platform.now()`, début effectif) ; IN_PROGRESS ou OVERDUE → RETURNED (`CHECKOUT_VALIDATED`). La **fin effective** est l'heure de la première ligne `RETURNED` du journal d'état, la même source que la caution (0153) : une seule, immuable, écrite une fois. Les occupations du trip sont libérées par la même commande (I-OCC). Clés remises (`trip_ops_key_handover`, OUT par l'hôte, IN par le voyageur) à la même heure. Rejeu : `ALREADY_VALIDATED` et les heures d'origine.
6. **Politiques** : la commande pose, après la vérification de la session, le contexte de la partie (`app.actor_kind` HOST + `app.org_id`, ou GUEST + `app.actor_id`), puis le rétablit ; les politiques `cmd_trip_handover_*` de `cmd_hold_owner` n'admettent la mise à jour du trip (états de SM-1 de la remise) et des occupations (trip RETURNED) que dans ce contexte, comme les demandes de réservation (0126). La garde structurelle de 0099 (paire de la table, ligne du journal de la même transaction) reste la seule voie d'un changement d'état.
7. **Heure serveur** partout ; aucune heure reçue du client (clé inconnue refusée par l'API) ; aucune **file hors ligne** au lot 3 : base injoignable ⇒ 503 `HANDOVER_UNAVAILABLE`, l'écran dit « réessaie » (ADR-005, ADR-039 ; repli au lot 5, US-524).
8. **Remise sans rencontre** : jamais proposée (`contactlessOffered` toujours false) et refusée par la commande (`CONTACTLESS_UNAVAILABLE`) ; `p2p_contactless_handover_enabled` est lu, jamais écrit (OQ-P2P-05).
9. **Argent** : aucun montant ni écriture d'argent. L'écrivain unique de `release_at` de la jambe HOST est US-708 (S-06) ; il lit la fin effective du point 5.

## Écarts PROPOSÉS à 17

- `trip_inspection.status = VALIDATED` n'est pas utilisé : la validation de la partie est une ligne de `trip_ops_handover_validation`, la série reste SUBMITTED (US-303 inchangée).
- Relevés (`odometer_km`, `fuel_level_eighths`) portés par la validation de chaque partie plutôt que par la série ; carburant en huitièmes, recharge d'un véhicule électrique (`ev_soc_pct`) : suite.
- `trip_identity_check.evidence_file_ids` (photo-preuve d'un refus) : US-307.
- Événements `trip.checkin.validated` et `trip.checkout.completed` : non émis ; `trip.status_changed` (motifs `CHECKIN_VALIDATED`, `CHECKOUT_VALIDATED`) porte la transition. Suite avec les notifications EVT_CHECKIN_DONE / EVT_CHECKOUT_DONE.

## Options écartées

- Transition par le travailleur `trip_lifecycle` après les deux validations : l'heure de début serait celle du travailleur, pas celle de la seconde validation (critère 3).
- Ouverture automatique par une minuterie à T−24 h : aucun travailleur n'existe encore ; l'ouverture à la demande d'une partie donne le même résultat pour l'utilisateur (comme Turo, la remise s'ouvre 24 h avant) ; minuterie : suite.
- Refus définitif fondé sur une seule case décochée par erreur, réversible par l'hôte : rejeté, un refus doit passer par l'ops (US-307, 10b « validée par l'ops, jamais par l'hôte seul »).
- Lire le permis ou une image de la pièce pour l'hôte : plus lourd que Turo et contraire à la minimisation (`host_guest_v`).

## Conséquences

- Un trip réel peut aller de BOOKED à RETURNED par l'application seule ; la caution, les retards (US-305), les débits post-trip (US-703) et les versements (US-708) partent de la fin effective.
- Suites : frais de carburant et de nettoyage (critère 5, US-706) ; libération de la jambe HOST (US-708) ; refus et photo-preuve (US-307) ; co-hôte ; minuterie d'ouverture ; comparaison côte à côte des photos (US-308) ; notifications ; repli hors ligne (US-524).
- Retour arrière : voir l'en-tête de la migration 0163.
