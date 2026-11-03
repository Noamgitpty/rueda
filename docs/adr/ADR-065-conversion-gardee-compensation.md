# ADR-065 — Conversion gardée, ré-acquisition et compensation : intention de paiement, boîte d'envoi CANCEL_ORDER, conversion sous app_worker, devis fail-closed

- **Statut** : PROPOSÉ (US-024, agent back-end, claude-opus-5-5, 2026-11-03). Revues exigées (`docs/team/review-requirements.json`) : code, architecture (`packages/db/`, migrations 0040 et 0041), **sécurité / concurrence** (RLS, `SECURITY DEFINER`, liste blanche RLS-15, verrous) et **argent** (compensation, jambes, remboursement) sur un autre modèle que l'auteur, QA. À reporter dans 17 §2.3, §2.5, §3.2.4, §3.2.7, §4.3, §8.1 et dans 16 A.8 (orchestrateur).
- **Stories** : US-024 ; s'appuient dessus US-025 (fuzz C11 et oracle C12 sous les rôles réels), US-003 (câblage des travailleurs), US-061 / US-223 (exécution des commandes et du remboursement), la story du devis (PRC) et US-115 (catalogue). **Sources** : 19 US-024 ; 16 BKG-014 ; 08 BR-BOOK-10, SM-1, EC-51 ; 17 §2.3 (rôles d'exécution des commandes), §2.5 (étapes 3 à 7, A3 à A6, plan de test C2 à C20), §2.8 (capacités), §3.2.7, §4.3, §7.2 ; ADR-035, ADR-048, ADR-053, ADR-056, ADR-059, ADR-063.

## Contexte

US-023 a construit la pose, la libération et l'expiration des holds. Il manquait tout ce qui suit l'entrée en paiement : l'intention (T1) et l'affinage (T2), la conversion gardée sur preuve de paiement, la ré-acquisition sous la contrainte d'exclusion, la compensation d'un paiement sans créneau, les deux balayages et l'annulation d'un ordre PSP. Jusqu'ici, la conversion n'existait que comme aide de test (`test/support/avl.ts`), et `cmd_start_payment` comme fixture.

Deux dépendances manquent encore au dépôt : le **devis** (module PRC : montant figé et jambes de capture) et l'**exécution** des commandes monétaires (travailleur de commandes sur le port de place de marché, US-061 ; `refund_instance`, US-223).

## Décision

1. **Devis fail-closed.** `core.booking_hold_payment_terms(hold)` rend le devis accepté du hold (montant, devise, jambes de capture, période commerciale, fuseau). Sans module PRC, elle ne rend **aucune ligne** : T1 refuse (`QUOTE_UNAVAILABLE`) et aucun débit n'est jamais demandé. C'est le même principe que `core.booking_vehicle_party` (ADR-063) ; la base de test la remplace par un registre (9800). La conversion compare la preuve à ce même devis (17 §2.5, étape 4.2 et 2 bis (iv)) : montant, devise, **quatre jambes égales une à une**, pays, période (début = début de l'occupation, fin dans l'occupation). Tout écart donne une compensation `ELIGIBILITY_CHANGED`.
2. **T1 et T2 sous `cmd_hold_owner`** (17 §2.3, tableau « Rôles d'exécution des commandes ») : `core.booking_cmd_start_payment(hold, compte PSP, moyen)` et `core.booking_cmd_record_order(hold, opération, référence, expiration)`, `SECURITY DEFINER`, `EXECUTE` au seul `app_api`, voyageur = `app.actor_id()`, liste blanche RLS-15.
   - **Capacités bloquantes** (report d'US-061, ADR-066) : T1 appelle `core.payment_missing_blocking_capabilities(fournisseur, pays, collection_mode)` ; une seule manque ⇒ `HOST_PAYOUT_RAIL_UNAVAILABLE`, aucun paiement.
   - Le montant et les jambes ne viennent **jamais** d'un paramètre : T1 les lit dans le devis. L'API choisit le compte marchand (configuration serveur) et le moyen ; la commande exige un compte `ACTIVE` du pays du hold, jamais un `FAKE` en production (C19).
   - T1 suit 17 §2.5 étape 3a : verrous voyageur → véhicule → hold ; `UPDATE … WHERE status = 'ACTIVE' AND expires_at > now` ; borne provisoire `min(now + psp_call_timeout_s + ORDER_TTL_SECONDS + payment_in_flight_margin_s, base + hold_max_total_minutes)`, la base étant `created_at` (`reviewed_at` pour un hold de revue). Un TTL d'ordre inconnu prend la borne de 20 min. L'opération `CAPTURE` (capture `AUTO`) est `PENDING`, avec la clé `hold:{hold}:CAPTURE:a{n}` (n = refus reçus + 1) et ses quatre jambes. Événement `booking.hold.payment_in_flight`.
   - **Double clic** (VERIF_17-B1) : un hold déjà en vol rend l'ordre existant (`EXISTING_ORDER`, même clé) ; sans ordre connu, `RETRY_SAME_KEY` si `SUPPORTS_LOOKUP_BY_MERCHANT_REF` est validé, sinon `VERIFYING`. Jamais un second ordre sans lecture.
   - **PROPOSÉ, plus strict que 17** : T1 refuse aussi un hold dont le début prévu est passé (`START_PASSED`, tolérance `conversion_start_tolerance_minutes`), plutôt que de débiter puis de rembourser. La conversion garde le contrôle 2 bis (i) pour le paiement déjà en vol (C20).
   - T2 enregistre l'ordre (`PENDING → SUBMITTED`, référence PSP, `payment_operation_event`), sans jamais rétrograder une opération `SUCCEEDED` (C15 bis (h)). Elle affine la borne vers le bas seulement. Si le hold est `EXPIRED` ou `RELEASED`, elle écrit `CANCEL_ORDER` quand `SUPPORTS_ORDER_CANCEL` est validé.
3. **Boîte d'envoi `core.payment_payment_command`**, réduite à `CANCEL_ORDER` : la clé `hold:{hold}:CANCEL:{opération}:a1` (contrôlée par `CHECK`) est `UNIQUE` et toute insertion fait `ON CONFLICT DO NOTHING`. Quel que soit le nombre de rejeux d'une transaction, il existe **une** commande, donc un seul `cancelOrder` (C16). Aucune transaction de cette story n'appelle un PSP : la commande est exécutée après le `COMMIT` par le travailleur `payment_command` (US-061).
   - `core.booking_cmd_release_own_hold` (0037) est remplacée à l'identique, plus l'écriture de `CANCEL_ORDER` pour chaque ordre vivant connu quand la capacité est validée (étape 6, temps 1).
   - `core.booking_release_cancelled_holds(lot)` (temps 2, `hold_expiry`, `SKIP LOCKED`) libère un hold dont toutes les annulations sont `DONE`, sans opération `SUCCEEDED` non disposée. Sans confirmation, la tâche d'expiration le libère à la borne + `sweep_grace_s`, comme sans la capacité : l'annulation ne fait qu'avancer la libération, elle n'est jamais nécessaire à la sûreté.
4. **Conversion sous `app_worker`, en `SECURITY INVOKER`** (17 §2.3 : « `app_worker`, une politique explicite par travailleur ») : `core.booking_convert_payment(opération)` n'est exécutable que par les travailleurs `booking_conversion`, `disposition_sweeper` et `payment_intent_sweeper` (contrôle dans le corps, et politiques de 0007). Elle suit l'esquisse de 17 §2.5 étape 4 :
   - verrous voyageur puis véhicule ; rejeu exact par `payment_disposition` (une preuve tardive d'une opération déjà compensée émet `booking.payment.late_ignored`) ;
   - verrou du hold **sans** prédicat de statut ; un hold `CONVERTED` donne `DUPLICATE_PAYMENT`, un hold `COMPENSATED` donne `LATE_PAYMENT_AFTER_COMPENSATION` ;
   - contrôles de preuve et 2 bis, avec les motifs `ELIGIBILITY_CHANGED` et `START_PASSED` ;
   - hold `EXPIRED` / `RELEASED` : d'abord **2a, partie véhicule** (texte unique `EXPIRY_2A_SQL`, vérifié par `expiry-2a.test.ts`), puis ré-acquisition dans un bloc `BEGIN … EXCEPTION` (sous-transaction = `SAVEPOINT`) qui couvre l'occupation, le trip, `guest_occupancy`, la disposition et le statut du hold ;
   - `23P01` sur `guest_no_overlap` ⇒ `GUEST_OVERLAP` ; sur `vehicle_occupancy_no_overlap` ⇒ résolution **A4** lue sous le verrou du véhicule : occupation d'un tiers, d'un blocage ou d'un tampon ⇒ `SLOT_LOST_AFTER_EXPIRY` / `_RELEASE` ; hold payé ou trip du même voyageur ⇒ `DUPLICATE_PAYMENT` ; seulement des holds vivants **non payés** du même voyageur ⇒ supplantés (`RELEASED`, `SUPERSEDED_BY_PAID_HOLD`, `CANCEL_ORDER` de leurs ordres vivants), puis **une** nouvelle tentative ;
   - occupation absente ou déjà `TRIP` ⇒ `INVARIANT_VIOLATION` et alerte P1 (`booking.alert.invariant_violation`).
   - « Priorité au payeur » (`reacquire_preempts_unpaid_hold`, M13) : non retenue, **non construite** ; la valeur du paramètre est ignorée.
5. **Bloc C et action par capacité** : `core.booking_open_compensation(hold, opération, motif)` écrit dans la même transaction `hold_compensation` (`OPEN`), la disposition `COMPENSATION` (clé primaire = XOR), le hold `COMPENSATED` (sauf s'il est déjà `CONVERTED` ou `COMPENSATED`), l'occupation `HOLD` inactive (jamais une ligne `TRIP`), `booking.hold.compensated` et `booking.hold.compensation_required` (montant de l'opération, devise). L'action vient de la capacité **validée** du PSP et du moyen, en fail-closed :
   - une autorisation seule donne `VOID` (`SUPPORTS_VOID`), sinon `LET_EXPIRE` ;
   - un débit capturé donne `REFUND_API` (`SUPPORTS_REFUND`), sinon `BANK_TRANSFER_REFUND` (virement ordonné par Kmino et exécuté par le PSP).
     La branche « compensation par un tiers » est retirée (révision P2P, analyse pivot §d).
6. **Éligibilité par une seule fonction `SECURITY DEFINER`** : `core.booking_conversion_eligibility(hold)` (`cmd_hold_owner`, `EXECUTE` au seul `app_worker`, travailleurs de conversion seulement) rend un code (`ELIGIBLE`, `VEHICLE_NOT_LISTED`, `HOST_NOT_ACTIVE`, `SELF_BOOKING`). `cmd_hold_owner` lit déjà le compte d'hôte et le catalogue : la fonction évite d'ouvrir `iam_organization` aux travailleurs.
7. **Refus reçu** (étape 3e) : `core.booking_record_payment_failure(opération)` remet le hold en `ACTIVE` (borne à `NULL`, `payment_attempts + 1`) s'il n'est pas échu et qu'il reste une tentative ; sinon il passe `RELEASED` (`PAYMENT_DECLINED`). Il n'agit que sur la tentative en cours, et seulement si aucune autre opération du hold n'est payable ou en attente de disposition.
8. **Balayages** (fonctions appelées par le travailleur, une opération par transaction, même ordre de verrous que la conversion) :
   - `payment_intent_sweeper` : `core.booking_intents_due(lot)` rend les ordres à lire dès borne − `sweep_lead_s`. Le travailleur lit le PSP hors transaction et applique le statut (`payment_cmd_apply_operation_status`, travailleur de commandes). Puis `core.booking_record_poll(opération)` écrit `last_polled_at` **et** convertit, ou traite le refus, dans la même transaction, sous les verrous (A3) ;
   - `disposition_sweeper` : `core.booking_disposition_candidates(lot)` rend les opérations `SUCCEEDED` sans disposition depuis `disposition_repair_after_minutes`. L'instant de référence est le premier `payment_operation_event` `SUCCEEDED` appliqué, à défaut `updated_at`. `core.booking_disposition_repair(opération)` rejoue l'étape 4 dans un bloc. Un échec est compté dans `core.booking_disposition_repair_log` (SQLSTATE et contrainte seulement), et une alerte P1 unique (`booking.payment.disposition_overdue`) part à `disposition_alert_minutes`. Si le paramètre est absent, l'alerte part tout de suite (fail-closed).
9. **Lecture des capacités** (`core.payment_capability_value`) : version en vigueur de la portée **la plus précise présente** (moyen, sinon `*`), comptée seulement si `VALIDATED_*`. Une ligne du moyen non validée l'emporte sur `*` (« `SUPPORTS_REFUND[YAPPY]` non validé », 17 §2.5 étape 5). C'est plus strict que le repli de `pay/internal/capabilities.ts`, qui saute aux lignes validées : écart PROPOSÉ, à réconcilier côté TypeScript.
10. **Codes PROPOSÉS** (16 A.8, à reporter) : `HOLD_EXPIRED`, `QUOTE_UNAVAILABLE` (nom de 16 SRC), `START_PASSED`, `PAYMENT_ATTEMPTS_EXHAUSTED`, `PAYMENT_METHOD_UNAVAILABLE`. Des contraintes existantes sont réutilisées : `PSP_ACCOUNT_INACTIVE`, `FAKE_FORBIDDEN_IN_PRODUCTION`, `BOOKING_UNDER_REVIEW`, `FORBIDDEN`.

## Conséquences

- Les preuves L0 (`test/l0/l0-us024-conversion.test.ts`, PA et PY) tournent **seules**, dans le second groupe de `vitest.l0.config.ts`, après tous les autres fichiers. La tâche d'expiration et les balayages portent sur toute la base, et ne doivent toucher aucun hold d'un fichier en cours. Chaque test vit dans sa propre période virtuelle (2041 et après) ; les capacités du `FAKE` y sont ouvertes puis refermées par une version datée.
- En production, rien ne change tant que PRC, le catalogue (US-115) et les travailleurs (US-003) manquent : aucune pose, aucune intention de paiement possible.
- `cmd_hold_owner` reçoit de nouveaux droits, au plus juste :
  - insertion d'une opération de loyer `PENDING` et de ses jambes pour un hold en vol du voyageur ;
  - passage `PENDING → SUBMITTED` ;
  - événement `API_RESPONSE` ;
  - lecture des comptes PSP, des capacités et de quatre paramètres ;
  - écriture de `CANCEL_ORDER`.
    Chaque droit est borné par une politique par commande SQL, sans `DELETE`.
- `app_worker` reçoit :
  - `UPDATE (payment_attempts, payment_in_flight_until)` du hold ;
  - la lecture des jambes (travailleurs de conversion) et des événements d'opération (`disposition_sweeper`) ;
  - la boîte d'envoi et le journal d'essais.

## Limites et reports

- **Jambes après la conversion** : `core.settlement_cmd_apply_leg_movement` (US-061, seul écrivain de `trip_leg_balance`) exige une opération rattachée à un trip. La conversion laisse `payment_operation.trip_id` nul (17 §2.5, F5) et ne touche à aucune jambe ni à aucun solde ; le rattachement (`payment_operation_link`) puis le report de la capture sur les soldes appartiennent à US-223. La compensation ne déplace aucune jambe : le remboursement (jambes de l'opération, en entier) est créé par US-223.

- **Devis (PRC)** : remplacer le corps de `core.booking_hold_payment_terms` (devis `ACCEPTED`, montant figé, jambes de capture, fuseau du lieu de remise). Lier `checkout_hold.quote_id`.
- **US-061** : consommateur de `payment_command` (`cancelOrder`, réponse « déjà payé » routée vers l'étape 4, `getOperation` avant tout renvoi), et passage `DONE`.
- **US-223** : `refund_instance` (origine `HOLD_COMPENSATION`, plafond = montant de l'opération − déjà engagé, jambes de l'opération débitées en entier) et commandes `VOID` / `REFUND` ; `tender`, `trip_segment` et `payment_operation_link` créés à la conversion (17 §2.5 étape 4.4), absents du schéma.
- **US-003** : câblage des travailleurs `booking_conversion` (après `webhook_ingest`), `payment_intent_sweeper` et `disposition_sweeper` (toutes les `disposition_sweeper_period_s`), et `hold_expiry` (expiration et temps 2), avec la reprise `40P01` / `40001` (au plus 3).
- **Revue ops** (ADM-029) : travailleur d'approbation (`reviewed_at`, prolongation unique) et de refus (`REVIEW_REJECTED`), aujourd'hui simulé par la fixture `us024_approve_review`.
- **Contrôles BKG-012 rejoués à la conversion** (KYC, restriction, `HOST_BLOCKED_GUEST`, interrupteurs du pays) : stories KYC, risque et US-125 ; seuls le catalogue, l'hôte `ACTIVE` et l'auto-réservation sont rejoués ici.
- **Rapprochement nocturne** (`listTransactions`, `ORPHAN_PAYMENT`) : story du rapprochement.
- **Garde de durée** (`hold_ttl ≥ ORDER_TTL_SECONDS + marge`, moyen non proposé sinon) : offre de moyens côté API.
- **L0-01 à L0-03** gardent l'aide de conversion de test (preuves structurelles du schéma) ; US-025 rejoue le fuzz C11 avec la conversion réelle.
- **L0-10** : les hypothèses de PSP (marge, TTL Yappy de 300 s, annulation) restent non mesurées et sont simulées par le `FAKE` (OQ-ARCH-01, défaut `payment_in_flight_margin_s` 120 s et `sweep_grace_s` 60 s).

## Alternatives écartées

- **Montant et jambes passés par l'API à T1** : une API compromise ou boguée choisirait le montant débité. Le devis, même absent, fait foi en base.
- **Conversion en `SECURITY DEFINER` sous un nouveau propriétaire** : 17 §2.3 place la conversion sous `app_worker`, avec des politiques par travailleur déjà posées en 0007. Un propriétaire de plus élargirait la liste blanche sans gain.
- **Balayage de plusieurs opérations dans une seule transaction** : les verrous consultatifs de plusieurs voyageurs et véhicules s'y accumuleraient, hors de l'ordre global (risque de `40P01`). Le choix retenu est une opération par transaction.
- **Ouvrir `iam_organization` aux travailleurs** pour l'éligibilité : la lecture passe par `cmd_hold_owner`, qui la détient déjà.
