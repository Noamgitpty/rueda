# ADR-163 — Créance de la règle 3 bis au `host_ledger` et annulation des trips d'un hôte défaillant

- **Statut** : PROPOSÉ (US-224 partie 224e, agent argent / back-end, claude-opus-5-5, 2026-11-18). Revues exigées : voir `check-story-reviews.mjs` (argent, RLS, rôles, `SECURITY DEFINER` et concurrence sur un autre modèle que l'auteur). À reporter dans 17 §2.9 (`host_ledger[hôte][devise]` : motif de l'avance), §3.2.8, §10 (catalogue de la console) et 16 A.8 (codes).
- **Complète** : ADR-147 (avance de Kmino, 0123 : « créance de l'hôte, recouvrement laissé à US-709 »), ADR-153 (`host_ledger` minimal, 0129), ADR-148 (annulations réglées dans la transition, 0124), ADR-124 (hôte restreint, voyageurs prévenus).
- **Sources** : 19 US-224 critères 4 et 5 ; 08 E7 règle 3 bis, E5, vecteurs TJ18a à TJ18d ; 08 BR-TRUST-09, BR-CXL-14, table de décision n° 13, vecteur T22 ; BOARD N-274, N-236.

## Contexte

- **N-274** : le critère 4 exige « une créance de 75,00 inscrite au `host_ledger` ». 224b (#202) crée l'avance (`platform_advance` `RELEASED_LEG`, `PLANNED` puis `OPEN` au report du remboursement) ; 709a (#215) a créé le `host_ledger` avec un seul motif, la pénalité de l'hôte qui annule. La créance de l'avance n'était écrite nulle part.
- **N-236** : le critère 5 exige qu'un hôte défaillant voie ses trips futurs annulés et chaque voyageur remboursé intégralement sans attendre l'hôte. La suspension (restriction, ADR-124) et l'annulation trip par trip (`CANCEL_TRIP_PLATFORM`, ADR-148) existaient ; aucune action ne couvrait « tous les trips à venir de cet hôte ».

## Décision

1. **Motif `RELEASED_LEG_ADVANCE`** du `host_ledger` (0137). Colonne `advance_id` (clé étrangère vers `settlement_platform_advance`, unique), exigée pour ce motif et interdite pour les autres ; toujours un débit. Les deux uniques d'idempotence de 0129 sont recréées sous leur nom en `UNIQUE NULLS NOT DISTINCT (…, advance_id)` : pour la pénalité (advance_id NULL) leur sens est inchangé (une par règlement, une par version) ; un même règlement peut porter plusieurs avances (une par instance SM-8, règle 10), donc une créance par avance.
2. **Montant** : `−receivable_minor` de l'avance STOCKÉE (égal à son montant par le CHECK `platform_advance_released_leg` de 0036), calculé une fois par `payment_cmd_plan_refund` à la planification (part `HOST` au-delà de ce que la jambe a encore), jamais recalculé, jamais reçu, jamais un prorata. Rattachement au règlement et à la version de l'instance de remboursement qui porte l'avance (clé étrangère composite de 0129 : même hôte, pays et devise).
3. **Moment** : quand l'avance devient effective. Déclencheur `platform_advance_receivable_posted` (AFTER UPDATE OF status, `PLANNED` → `OPEN`, cause `RELEASED_LEG`) qui appelle `core.settlement_cmd_post_advance_receivable` (`SECURITY DEFINER`, `cmd_money_owner`, aucun EXECUTE ; garde : travailleur `payment_command`, avance `OPEN` de son règlement). Le seul passage à `OPEN` est le report du remboursement (`settlement_cmd_apply_leg_movement`, 0123) : la créance est écrite dans la même instruction que ce report. Une avance `PLANNED` (décision FINANCE attendue) ou `CANCELLED` (version remplacée) n'écrit rien.
4. **Action de console `CANCEL_HOST_TRIPS`** (0138) : sujet ORGANIZATION (le compte d'hôte), permission `ops.platform_cancel` (celle des annulations à l'unité), aucune saisie, cadre d'US-101 (session TOTP, permission dans le pays du compte, garde ADR-122, idempotence, journal). Commande liée `core.booking_manual_action_cancel_host_trips` (`cmd_hold_owner`, EXECUTE `iam_staff_owner`).
5. **L'hôte est d'abord suspendu** : une restriction active de son titulaire est exigée (`HOST_NOT_RESTRICTED` sinon, rien n'est écrit). La restriction refuse déjà toute nouvelle réservation et prévient les voyageurs (ADR-124) ; ainsi aucun trip ne naît pendant l'annulation (fail-closed).
6. **Une demande par trip à venir**, identique à celle de `CANCEL_TRIP_PLATFORM` au motif `HOST_ACCOUNT_CLOSED` (motif dérivé, jamais reçu ; initiateur PLATFORM ; heure serveur) : trips dont l'état a une sortie CANCEL vers `CANCELLED_BY_PLATFORM` (même règle que l'annulation à l'unité ; jamais un trip commencé), sans demande vivante ; identifiant dérivé de l'action et du trip ; `NO_TRIP_TO_CANCEL` s'il n'y a rien. Chaque demande est réglée par le travailleur `trip_lifecycle` comme toute annulation (moteur unique, FULL, remboursement intégral, instances et ordres REFUND de Kmino dans la transaction) ; la jambe `HOST` n'est jamais versée avant le trajet (BR-PAYOUT-02) : rien n'attend l'hôte.
7. **Motif `HOST_ACCOUNT_CLOSED`** (comme Turo : compte de l'hôte fermé par la plateforme, 100 % remboursé, 0 gain quel que soit le moment, BR-CXL-14), plutôt que `HOST_CANCELLED` (qui porterait une pénalité par trip au `host_ledger`) : la sanction d'un hôte défaillant relève de BR-HP-05, décision du fondateur (`POUR_LE_FONDATEUR.md`).

## Alternatives écartées

- **Créance écrite à la planification de l'avance** (`PLANNED`) : la créance serait visible avant la décision FINANCE et avant que Kmino ait payé ; une avance `CANCELLED` exigerait une contre-passation.
- **Créance écrite par `settlement_cmd_apply_leg_movement`** (corps de 0123 recopié une fois de plus) : réécriture d'une commande d'argent de 300 lignes pour une ligne ; le déclencheur est impossible à omettre et n'ouvre aucun droit.
- **Une créance par règlement** (unique de 0129 gardée) : un remboursement en deux instances qui portent chacune une part de `HOST` (règle 10) aurait fait échouer le report du second remboursement.
- **Annulation automatique à la pose de toute restriction** : une restriction peut être temporaire (`TS_HOLD`) ; l'annulation reste une décision explicite de l'ops.
- **Bouton de la console dans cette story** : l'action est servie par la route générique `POST /console/actions` ; l'écran et ses textes en quatre langues sont une suite (aucun texte visible ici).

## Limites et conséquences (suites)

- Recouvrement de la créance (`NETTING` sur les versements de la même devise, SM-6b, prélèvement, échéancier, passage en perte à deux personnes) : US-709 / US-314 (GL-33) ; aucun versement avant le lot C.
- Avance d'une jambe `INSURER` déjà portée par un bordereau : imputation sur le bordereau suivant (US-227) ; aucune avance de ce type n'est créée aujourd'hui.
- Lecture de sa créance par l'hôte (RLS-26, N-272).
- Bouton « annuler les trips à venir » de la fiche 360° de l'hôte et textes es / en / fr / pt-BR ; proposition de véhicules similaires au voyageur (BR-TRUST-09) ; trips commencés d'un hôte défaillant (litige SM-7, reprise de E5).
- Remboursement en plusieurs moyens (TJ16c / TJ16d, N-238) : non traité ici.
