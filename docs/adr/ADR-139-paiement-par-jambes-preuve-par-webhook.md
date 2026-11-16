# ADR-139 — Paiement par jambes au checkout, preuve par webhook seulement (partie serveur 223a)

- **Statut** : PROPOSÉ (US-223, partie 223a, agent argent / back-end, claude-opus-5-5, 2026-11-16). Revues exigées (`check-story-reviews.mjs`, story US-223) : architecture, argent, code, qa, sécurité, ux ; argent, RLS, rôles, `SECURITY DEFINER` et concurrence sur un autre modèle que l'auteur.
- **Sources** : 19 US-223 ; 16 PAY-034, PAY-002, PAY-006 ; 08 E7 (règles 1, 2, 5, 10), TJ01, TJ08a, TJ09a, TJ09c, TJ10a, TJ15, TJ21 ; 17 §2.5 (étapes 3 à 7, C20), §2.8, §4.3, §4.4 ; ADR-059, ADR-065, ADR-066, ADR-088 (décision 9, « Limites »), ADR-133 ; BOARD : S-02, N-108, N-18, N-13, N-157, N-160, N-161, N-163.
- **Amende** : ADR-088 (« Limites », RC-5 : POLL et API_RESPONSE fermés pour les comptes LIVE et hors environnement non productif) ; s'appuie sur ADR-090 (montants payables, bornes du remboursement : inchangés, appliqués par US-224).
- **Migration** : `packages/db/migrations/0116_payment_checkout_legs_proof.sql` (0114 à l'origine ; renumérotée à la fusion d'US-205a, #184, qui porte 0114 et 0115).

## Contexte

US-024 a construit T1 (intention de paiement), T2 (ordre enregistré), la conversion gardée et la compensation, sur des conditions de paiement fail-closed (`booking_hold_payment_terms` sans ligne). US-208 a posé le hold du checkout et le lien hold → devis (`booking_checkout_acceptance`), US-226 la jambe `INSURER` du devis. La red team argent du lot 0 a laissé RC-5 partiellement ouverte (ADR-088) : `POLL` et `API_RESPONSE` sans preuve, rattachement d'un webhook par une référence fournie par l'appelant, horodatage signé `NULL` jugé « dans la fenêtre ». N-108 : un rejeu `PENDING` d'un PSP sans en-tête d'idempotence pouvait débiter deux fois.

## Décision

1. **Conditions de paiement = devis ENGAGÉ** : `core.booking_checkout_capture_terms` (SECURITY DEFINER, `cmd_hold_owner`) lit le devis par `booking_checkout_acceptance` ; montant = `total_minor`, jambes = colonnes `leg_*_minor` rejouées par la base (jamais `outputs` ni `inputs` : N-161), période du devis, fuseau du véhicule (sinon du pays). Aucune ligne sans checkout, devis `SUPERSEDED`, d'un autre voyageur ou pays : T1 refuse (`QUOTE_UNAVAILABLE`), la conversion compense. Chaque ordre porte donc le montant explicite de chaque jambe (08 E7 règle 1), y compris la prime due à l'assureur (`INSURER`, US-226).
2. **Commandes du voyageur par jeton de session** (`booking_cmd_checkout_pay`, `booking_cmd_checkout_record_order`, lecture `booking_checkout_payment`), même modèle que `booking_cmd_checkout` (contexte `app.actor_*` posé le temps de T1 / T2) ; compte marchand de Kmino du pays choisi en base (ACTIVE ; bac à sable seulement hors production) ; hold d'un autre voyageur ⇒ `HOLD_NOT_FOUND` ; la lecture ne rend ni jambe ni référence PSP.
3. **Preuve** (`payment_cmd_apply_operation_status`, S-02) :
   - webhook signé rattaché par la référence PSP de l'opération si elle est connue, sinon par NOTRE clé ; la référence passée par l'appelant n'est jamais un critère ; la référence enregistrée est celle de l'événement signé ;
   - horodatage signé absent ⇒ hors fenêtre (`QUARANTINED`, indicateur non effaçable) ;
   - montant ou devise reçus ≠ ordre ⇒ `MISMATCH` (rien n'est appliqué, aucun trip ; alerte, l'ops rembourse) ; un SUCCEEDED de loyer sans montant ⇒ `UNPROVEN` ;
   - `POLL` et `API_RESPONSE` terminaux sur un compte **LIVE**, ou sur un compte de bac à sable quand la base n'est pas dans un environnement non productif connu (`COALESCE(platform.deployment_env(), 'production') IN ('test', 'development', 'staging')`, même défaut que T1 et la réception) ⇒ `UNPROVEN` (aucune lecture authentifiée avant le connecteur réel ; ligne **GL-20**) ; sur un compte de bac à sable hors production, `POLL` ⇒ preuve `POLL`, `API_RESPONSE` ⇒ statut sans preuve ;
   - statut terminal déjà posé sans preuve puis webhook signé du même statut ⇒ `DUPLICATE` et preuve `WEBHOOK_SIGNED` posée ;
   - `UNPROVEN` et `MISMATCH` journalisés dans `payment_operation_event`.
4. **Rien ne bouge sans preuve** : la conversion rend `NOT_PROVEN` pour un SUCCEEDED sans `proof_type` (aucun trip, aucun `booking.trip.booked`) ; `settlement_cmd_apply_leg_movement` refuse (`leg_movement_unproven` ⇒ `PAYMENT_UNPROVEN`).
5. **Un devis, un hold, un trip** (N-160) : la conversion pose la version de prix n° 1 du trip = devis du checkout (`pricing_bind_checkout_trip`) ; `pricing_cmd_version_trip_price` refuse un devis engagé au checkout (`QUOTE_MISMATCH`) et un devis échu (`QUOTE_EXPIRED`).
6. **Travailleur** (périodes de 10 s PROPOSÉES, `WORKER_TASK_DEFAULTS`) : `webhook_ingest` (10 s, `WebhookProcessor` sans lecture du PSP : la preuve est le webhook signé) et `booking_conversion` (10 s, `core.booking_conversion_due` puis une opération par transaction ; une opération qui lève est comptée et journalisée par son SQLSTATE, sans identifiant, et ne bloque pas le lot ; `converted` ne compte que les issues `CONVERTED`) ; `payment_intent_sweeper` et `payment_command` restent non déclarés (ils appellent le PSP : lot C).
7. **N-108** : sans `SUPPORTS_IDEMPOTENCY_HEADER` validé, `MoneyCommandSender` lit toujours avant d'envoyer, `PENDING` compris ; lecture impossible ⇒ `NOT_SENT` ; ni lecture par clé ni référence ⇒ escalade ; jambes vérifiées avant tout appel, lecture comprise ; statut refusé par la base ⇒ `AWAITING_PROOF`, jamais un succès.
8. **Cascade des encaissements** (08 E7 règle 10) : `cascadeTenders` et `creditCap` dans `@rueda/money` (natif → non natif → crédit cash → crédit promo ; `HOST` → `INSURER` → `TAX_THIRD_PARTY` → `PLATFORM` ; un crédit ne touche que `PLATFORM`), prouvés sur TJ15a à d, TJ21a, b et une variante PYG produite par la fonction `cascade` de l'oracle. Aucune table `tender` : un seul encaissement par carte au checkout bêta (crédits : story à venir).

## Conséquences

- Un voyageur n'est jamais confirmé sans webhook signé rattaché ni débité deux fois par T1 (deux sessions : une opération) ou par la conversion (deux sessions : un trip).
- Un PSP réel devra signer le montant et la devise dans ses webhooks et, pour toute lecture, fournir une réponse authentifiée (GL-20) ; à défaut, un compte LIVE n'accepte que les webhooks.
- La dette des GUC `app.actor_*` de US-208 est reprise telle quelle par les deux nouvelles commandes (N-157, partie « contexte ») : à lever avec la réécriture des politiques `cmd_hold_*` sur la session.

## Suites

- 223b : routes HTTP (createHostedPayment du FAKE entre T1 et T2), S05 / S06, textes, e2e. 223c : mode `REQUEST` (N-127).
- S-02, première et deuxième phrases (ordres `REFUND`, `LEG_REALLOCATION`, `LEG_RELEASE` portant la version du règlement, bornés à l'enregistrement ; `settlement_cmd_record` qui rend le règlement existant sur un rejeu au lieu de lever `SETTLEMENT_EXISTS`) : **reportées à US-224**, qui écrit les règlements et ces ordres (aucun n'est écrit par US-223 ; modifier `settlement_cmd_record` ici, sans son appelant, serait un changement d'argent non éprouvé de bout en bout).
- N-163 (double soumission concurrente du même DEVIS au checkout) : non prouvable à deux sessions sans interrupteurs commités ; banc à décider par l'orchestrateur.
- Report dans `docs/specs/` (PR revue) : ADR-139 en 17 §8.1, issues `MISMATCH` / `NOT_PROVEN` / `QUOTE_EXPIRED` et code `PAYMENT_UNPROVEN` en 16 A.8.
