# ADR-198 — Sinistres entre particuliers : vol présumé à T+24 h, incident du voyageur depuis S17, amendes, péages et fourrière refacturés par débit séparé

- **Statut** : PROPOSÉ (US-318, agent de story, rôle back-end, claude-opus-5-5, 2026-11-22). Revues exigées : code, architecture, sécurité, argent, ux, qa (`docs/team/review-requirements.json`) ; argent, RLS / rôles, `SECURITY DEFINER` et concurrence sur un autre modèle que l'auteur.
- **Complète** : ADR-179 (photos guidées, chaîne réutilisée), ADR-182 (aide et urgence, S17), ADR-189 (débits post-trip MIT), ADR-192 (versements retenus), ADR-193 (escalade de non-restitution), ADR-195 (sinistres et décisions).
- **Sources** : 19 US-318 (critères 1 à 3) ; 16 TRP-038, ADM-022, CLM-002 ; 08 BR-RETURN-04, BR-DAMAGE-01, BR-TT-01 à BR-TT-05, BR-PROT-05, BR-PRICE-15, BR-REIMB-04 ; 22 OQ-BR-17, OQ-BR-19 ; NOUVELLE-18 de l'analyse pivot (`docs/team/impact/2026-11-02-pivot-p2p.md` §e.5) ; pré-mortem du lot 3 L3-PM-17 ; DEC-FONDATEUR-22 (« jamais plus lourd que Turo »).

## Contexte

US-306 escalade un trip non rendu jusqu'à T+24 h (plainte pré-remplie remise à l'hôte) mais laisse le vol lui-même, la déclaration à l'assureur et le gel de la jambe HOST à US-318 (ADR-193 point 8). US-309 enregistre les dommages et incidents depuis la console ; le voyageur n'a pas de déclaration propre depuis S17. Les amendes, péages et fourrières reçus par l'hôte après le trip n'ont aucun parcours.

## Décision

1. **Vol présumé** (critère 1). Quand le dossier de retard (`trip_ops_overdue_case`) est à l'étape T24H et que le trip est encore OVERDUE (ou UNRETURNED), le travailleur `payment_command` ouvre `core.claim_theft_case` (SM-4 THEFT_INVESTIGATION, un par trip, sous le verrou du trip) et y journalise la déclaration à l'assureur partenaire (PENDING). Elle n'est envoyée par `InsurerClaimsPort` (kind THEFT, aucune donnée nominative) que si `insurer_contract_active[pays]` est vrai, lu en base et relu sous le verrou à l'enregistrement de l'envoi ; production : aucun port avant le lot C. Le lot de versement de l'hôte de ce trip est retenu : troisième source du bloc `CLAIM` de `core.payout_batch_hold_reasons` (corps de 0175 recopié). Retour du véhicule (trip sorti d'OVERDUE / UNRETURNED / VEHICLE_LOST) : dossier clos RETURNED, déclaration non envoyée retirée (WITHDRAWN), retenue levée. Ouverture et clôture par le travailleur (≤ 60 s) : entre l'escalade et l'ouverture, le trip non COMPLETED est déjà retenu (`TRIP_NOT_COMPLETED`), aucune fenêtre ouverte.
2. **Rien sur le véhicule** (OQ-BR-17, défaut) : la plateforme ne dépose aucune plainte, ne récupère ni ne coupe aucun véhicule ; le trip garde le statut de la machine à états (UNRETURNED toujours non posé, ADR-193 point 8 : un trip UNRETURNED ne pourrait plus être rendu).
3. **Incident du voyageur** (critère 2). S17 donne d'abord les numéros du pays du trip (urgence, autorité, assistance routière de l'assureur : donnée de pays d'ADR-174 / ADR-182, jamais une constante). Après la demande d'aide ACCIDENT ou BREAKDOWN (0162), le voyageur photographie par la chaîne d'US-303 sans la dupliquer : nouvelle série `INCIDENT` de `trip_ops_inspection` (contrainte `trip_inspection_kind_valid` recréée, `core.trip_inspection_party` élargie : voyageur seul, trip IN_PROGRESS / OVERDUE ; jetons de capture, empreinte, heure serveur, file_asset C2 inchangés ; angles `DAMAGE_nn` seulement, contrôle de l'API ; jamais validée par `submit`). `core.claim_cmd_report_incident` ouvre `core.claim_incident_report` : demande d'aide vivante de cette personne sur ce trip, au moins une photo, deux réponses fermées (tiers, police), heure de la base, un incident par demande d'aide, rejeu idempotent. Aucun texte libre (comme ADR-182). Le gel du versement suit l'instruction par l'ops (US-309 : dossier CLAIM, déclaration), pas la seule déclaration du voyageur.
4. **Amendes, péages, fourrière** (critère 3 ; 08 BR-TT-02 à 04). Le titulaire du compte d'hôte (jamais un co-hôte) photographie la pièce dans sa série `TRAFFIC` (ouverte après le retour), puis `core.claim_cmd_declare_traffic_charge` : fait dans [début effectif (remise validée, sinon début prévu), fin effective (premier retour)], déclaration au plus tard à fin effective + `traffic_charge_deadline_days` (120 j, 08 [NOUS] ; borne incluse, + 1 ms refusée `TRAFFIC_CHARGE_DEADLINE_PASSED`, heure de la base lue après les verrous), une pièce par refacturation ; paramètres absents ⇒ refus. Frais de gestion `traffic_charge_admin_fee_bps` (500 = 5 %, 08 BR-PRICE-15 [NOUS]) à la charge du voyageur (BR-REIMB-04) : jambes explicites HOST = montant (100 %), PLATFORM = roundHalfUp(montant × bps / 10 000), INSURER = TAX_THIRD_PARTY = 0 (frais toutes taxes de la plateforme comprises, comme le trip fee dont la taxe n'est pas collectée pour un tiers). Fonction pure versionnée `trafficChargeLegs` (`@rueda/money`, `BR-TT-US318`), jumelle SQL `core.claim_traffic_charge_legs` ; contrainte de forme sur la table. Exécution par Kmino (travailleur) : débit séparé d'US-703 (`payment_cmd_notify_post_trip_charge`, but INCIDENTAL, motif DELAYED_CHARGES, origine TRAFFIC_CHARGE, moyen = carte du loyer prouvée, jamais la caution) ; préavis, délais des réseaux et dette restent ceux d'US-703. Sans carte du loyer : BLOCKED `NO_CARD_TENDER`.
5. **Refacturation sans transfert** (OQ-BR-19, défaut) : la plateforme ne transfère jamais l'amende au conducteur ni ne déclare le conducteur à l'autorité ; parking de récupération non refacturable (BR-TT-05 : aucune catégorie) ; fourrière : frais réels payés par l'hôte refacturés, aucun forfait (la plateforme ne récupère rien).
6. **Droits** : trois tables sans droit applicatif (ENABLE + FORCE, `migrator_all`, garde `claim_p2p_guard`) ; commandes des parties sous `cmd_hold_owner` (EXECUTE `app_api`), personne jugée par l'empreinte du jeton de session ; travailleur sous `cmd_money_owner` (EXECUTE `app_worker`, `payment_command` exigé). Lectures ajoutées au plus juste (voir `packages/db/README.md`).
7. **Écrans** : `/trips/{tripId}/incident` (voyageur, depuis S17) et `/host/trips/{tripId}/claims` (hôte : dossier de vol et déclaration à l'assureur, délai, frais en pourcentage, pièces, refacturations ; montants rendus par l'API, aucun calcul d'argent dans le site) ; quatre langues ; le courriel de la plainte et la console des retards annoncent désormais la retenue du versement pendant le vol présumé.

## Écarts PROPOSÉS

- 16 TRP-038 « versement de l'hôte non bloqué par la procédure » contre 19 US-318 « jambe HOST gelée » : 19 suivi (gel au vol présumé seulement, levé au retour) ; à reporter dans 16.
- Gel par le motif `CLAIM` du lot (comme US-309, US-314), pas par `settlement_trip_leg_balance.frozen` : un gel de solde ne se lève jamais hors chargeback (garde de 0167) et piégerait l'hôte au retour du véhicule.
- `incident_report` de 17 §2.2 : `claim_incident_report` (voyageur) à côté de `claim_damage_claim` (console) ; `overdue_case.police_report_ref` (numéro de plainte) toujours absent.
- CLM → IAM, CTR (gardes des routes du trip), comme TRP, MSG, REV : à reporter dans 17 §2.2.

## Options écartées

- Ouvrir le vol dans la transaction de l'escalade (0173) : recopier la commande de la console et donner à `cmd_hold_owner` des droits d'argent ; le travailleur suffit (aucune fenêtre, point 1).
- Nouvelle chaîne de téléversement pour les pièces et les photos d'incident : interdit (chaîne d'US-303, correctifs d'empreinte et d'EXIF en cours) ; les séries libres la réutilisent telle quelle.
- Frais de gestion forfaitaires ou plafonnés d'office : Turo prend un pourcentage sans plafond ; plafond renvoyé au fondateur.
- Débit immédiat sans préavis : contraire aux règles des réseaux d'US-703.

## Reprise après les revues (2026-11-22)

- **Récapitulatif avant l'envoi** (ux n° 1) : `POST /trips/{tripId}/traffic-charges/preview` → `core.claim_cmd_declare_traffic_charge(…, p_preview => true)` : mêmes contrôles, récapitulatif calculé par la base (montant, frais, total refacturé, jambes), rien n'est écrit ni l'identifiant de requête consommé ; l'hôte confirme ensuite (même corps, même identifiant).
- **Travailleur** (code n° 1 à 3) : chaque erreur de la base est journalisée par son SQLSTATE et alertée (`CLAIM_P2P_FAILED`, P1, étape et SQLSTATE) ; refacturation repoussée de 15 min au plus 5 fois, puis BLOCKED `RETRY_EXHAUSTED` (colonne `failed_attempts`), alertée `CLAIM_TRAFFIC_BLOCKED` comme `NO_CARD_TENDER` ; les passes d'US-309 et d'US-318 sont isolées.
- **Déclaration de vol** (argent n° 11, sécurité n° 6) : verrou et interrupteur relus AVANT l'appel au port (`core.claim_cmd_lock_theft_declaration`), appel et enregistrement dans la même transaction.
- **Échéance** (argent n° 7) : jours ajoutés en UTC, quel que soit le fuseau de la session.
- **Preuves** : parité SQL / oracle sur tous les cas (`traffic_fee_oracle.py`), état des refacturations lu par objet, courses à deux connexions (`l0-us318-claims-race`).
- **Écrans** (ux n° 2 à 7) : étapes de la plainte pré-remplie, consigne « ne continuez pas à rouler » en tête, renvoi à l'urgence et à l'autorité du pays si le numéro de l'assureur manque, envoi de l'incident impossible sans photo, date et heure au format de la langue.
- **Taxe sur les frais de gestion** (argent n° 4) : frais « toutes taxes comprises » gardés (PROPOSÉ, fail-closed) ; « TTC » ou « en sus » (ITBMS 7 % PA, IVA 10 % PY, taxe de Kmino dans PLATFORM / `tax_payable`) est à trancher par le fondateur avant l'ouverture d'un pays (OQ-BR-14, POUR_LE_FONDATEUR §7.14).

## Suites

- Jambe HOST d'une refacturation TRAFFIC reportée dans les versements : ticket commun avec INCIDENTAL et DAMAGE (US-703 ne reporte un mouvement de jambe que pour RENT_SHORTFALL et NO_SHOW_RETENTION ; argent n° 8).
- Contestation de la refacturation par le voyageur, avec notification (`EVT_POST_TRIP_CHARGE_*`), avant l'ouverture au public (comme Turo).
- Plafond de plausibilité du montant déclaré (argent n° 9).
- Délais des réseaux (Mastercard 30 j depuis le préavis, Visa / AMEX 90 j depuis le retour, 0169) plus courts que les 120 j de déclaration : une refacturation tardive devient une dette (comportement fail-closed d'US-703), à documenter pour l'hôte.

Passage UNRETURNED et retour d'un trip UNRETURNED ; frais de 500 $ d'un véhicule déclaré volé et protection du voyageur annulée (08 BR-RETURN-04) ; numéro de plainte saisi par l'hôte ; statut de la déclaration à l'assureur dans la vue des retards (ADM-022) ; contestation d'une refacturation par le voyageur (BR-REIMB-02 / 03) et notification `EVT_POST_TRIP_CHARGE_*` ; vue de l'incident dans la console ; refacturation des péages liés à un compte Panapass (BR-TT-01) ; références visuelles des nouveaux écrans reprises de l'artefact `regression-visuelle`.

## Conséquences

- Preuves : `packages/db/test/l0/l0-us318-p2p-claims.test.ts` (PA / USD et PY / PYG, rôles de production) ; `packages/money/test/settlement/traffic-charge.test.ts` ; `apps/api/src/modules/clm/internal/p2p/*.test.ts` ; `apps/api/src/modules/clm/testing/trip-claims.contract.test.ts` ; e2e `apps/web/e2e/trip-incident.spec.ts`, `host-traffic-charges.spec.ts`.
- Retour arrière : voir l'en-tête de la migration 0178.
