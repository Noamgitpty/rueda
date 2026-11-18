# ADR-171 — Durcissement avant l'ouverture d'un pays : hôte défaillant, reçu de l'hôte, saisies libres de la classe de valeur

- **Statut** : PROPOSÉ (US-224, suites N-354, N-342, N-313 ; agent back-end, claude-opus-5-5, 2026-11-18). Revues exigées : celles de `check-story-reviews.mjs` (US-224 : code, architecture, sécurité, argent, ux, qa) ; `SECURITY DEFINER`, rôles et action de masse sur un autre modèle que l'auteur.
- **Complète** : ADR-163 (hôte défaillant, `CANCEL_HOST_TRIPS`), ADR-124 (hôte restreint), ADR-161 (reçus et relevé des gains), ADR-159 (classe de valeur à la publication, corrigé par celui-ci).
- **Sources** : 08 BR-TRUST-09 (hôte défaillant), BR-ACC-05 (classes et seuils PROPOSÉS), BR-COHOST ; revues de #235 (sécurité n° 4, architecture n° 5), de #231 (sécurité n° 4) et de #229 (N-313) ; BOARD N-354, N-342, N-313 ; CLAUDE.md contraintes 3, 7 et 9. Migration 0147.

## Contexte

Trois réserves des revues, toutes marquées « avant l'ouverture d'un pays » :

1. **N-354** : `CANCEL_HOST_TRIPS` (0140) acceptait toute restriction active du titulaire, y compris une restriction d'argent (`UNPAID_BALANCE`, `PAYMENT_PLAN_ACTIVE`, `CHARGEBACK`). Le recouvrement d'une avance de Kmino (US-709) pourra poser une telle restriction : un seul agent pouvait alors annuler tous les trips à venir d'un hôte qui doit seulement de l'argent.
2. **N-342** : `core.booking_trip_receipt` (0137) jugeait l'hôte sur `holder_user_id` seul, alors que le relevé des gains exige le rôle `P2P_HOST` `ACTIVE` (`core.iam_host_accounts`).
3. **N-313** : la règle « jamais sous-assuré » d'ADR-159 ne valait que pour les slugs exacts de la table : « G 500 », « S 580 » donnaient `PREMIUM` (règle de la marque) au lieu de `LUXE` ; « LandCruiser », GMC (Yukon, Sierra) et des marques premium absentes donnaient le défaut du pays (`STANDARD`).

## Décision

1. **Hôte défaillant = suspendu pour la sûreté.** `CANCEL_HOST_TRIPS` exige une restriction active du titulaire d'un des genres `TS_HOLD`, `POLICY_VIOLATION`, `KYC_REVOKED` ; sinon `HOST_NOT_RESTRICTED`, rien n'est écrit. Une restriction d'argent bloque toujours les nouvelles réservations (ADR-124, inchangé). Liste fermée, la même pour tous les pays. Comme Turo : la plateforme annule les trips d'un hôte désactivé pour la confiance et la sûreté, pas pour une dette, qui se recouvre sur ses versements (`host_ledger`). La validation à deux personnes (`requires_approval`) n'est pas retenue : le cadre d'US-101 la réserve aux demandes FINANCE ; la restriction de sûreté est elle-même posée par une action de console journalisée (`RESTRICT_ACCOUNT`, permission `ops.restrict_account`, genres `TS_HOLD` et `POLICY_VIOLATION`) ou par la révocation KYC, ce qui fait deux actions distinctes et journalisées avant l'annulation (le même agent peut les porter s'il a les deux permissions : une validation à deux personnes reste une suite possible, inscrite au BOARD).
2. **Reçu de l'hôte = relevé de l'hôte.** Le reçu d'un trip est rendu à l'hôte seulement s'il est titulaire du compte avec le rôle `P2P_HOST` `ACTIVE` (`core.iam_host_accounts`), comme le relevé. Un titulaire dont l'adhésion est retirée, ou un co-hôte (`CO_HOST`), reçoit `NOT_FOUND`, la même réponse qu'un tiers. Co-hôtes : refusés (fail-closed) tant qu'aucune permission de co-hôte ne porte la lecture des gains (BR-COHOST).
3. **Saisies libres de la classe de valeur.** `core.catalog_value_class_resolve` compare la marque sans ses tirets (« MercedesBenz » = « mercedes-benz », « LandRover » = « land-rover ») et reconnaît le modèle d'une règle au début du modèle saisi, tirets facultatifs (« landcruiser » = « land-cruiser »), suivi de la fin, d'un tiret, d'un chiffre si la règle finit par une lettre (« g » ⇒ « g500 », « lx » ⇒ « lx570 ») ou d'une lettre si elle finit par un chiffre (« 740 » ⇒ « 740i »). La règle la plus précise l'emporte (modèle le plus long sans ses tirets, puis règle du pays, puis la classe la plus haute). Graine PROPOSÉE complétée, sans code pays :
   - marques de luxe : Karma, Koenigsegg, Lucid, Pagani, Rimac ;
   - marques premium : Alpina, Alpine, Denza, Hongqi, Ineos, Morgan, Rivian, Voyah, Zeekr ;
   - modèles `LUXE` : BMW Série 7 (« 7 Series », « Series 7 », 740, 750, 760, i7), Cadillac Escalade, GMC Hummer, Infiniti QX80, Lincoln Navigator ; Mercedes (écritures « Mercedes », « Mercedes-AMG », « Mercedes-Benz ») : AMG GT, Classe G et S (« G », « S », « Clase G / S », « Classe G / S », « G-Class », « S-Class »), GLS, SL ;
   - modèles `PREMIUM` : GMC Sierra et Yukon, Nissan Armada, Toyota Prado.

   Une marque ou un modèle absent de la table suit le défaut du pays : « jamais sous-assuré » vaut pour la table et ses écritures, pas pour une marque inconnue. La table se complète par migration revue (valeurs définitives selon le contrat de l'assureur, POUR_LE_FONDATEUR.md §3). Une classe déjà posée n'est jamais recalculée.

## Conséquences

- Aucun texte, aucune route ni aucun code d'erreur nouveau : `HOST_NOT_RESTRICTED` et `NOT_FOUND` / `RECEIPT_NOT_FOUND` existaient.
- `cmd_hold_owner` lit en plus la colonne `kind` de `core.iam_restriction` (liste fermée, non personnelle).
- Une saisie libre peut être classée plus haut qu'avant (jamais plus bas) ; un contrat d'assureur limité à `STANDARD` refuse alors le véhicule (`VEHICLE_NOT_COVERED`) au lieu de le sous-assurer.
- Preuves L0 sous `app_api` / `app_worker` (L0-05), en PA / USD et PY / PYG : `l0-us224e-defaulted-host` (genres d'argent refusés, genres de sûreté acceptés), `l0-us217-host-receipt` (co-hôte et adhésion retirée ⇒ `NOT_FOUND`), `l0-n83-value-class` (écritures « G 500 », « S580 », « LandCruiser », « MercedesBenz », GMC, Rivian, 740i, LX570 ; « GLA 200 » et « Golf » sans débordement). Fixture 9935.
