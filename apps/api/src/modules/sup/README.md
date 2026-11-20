# SUP — Support & back-office (`apps/api/src/modules/sup`)

**SUP — Support & back-office** : console interne, fiche 360°, files de revue, dossiers de support, actions manuelles. Dépendances autorisées : IAM, KYC, CAT, AVL, PRC, CTR, PAY, STL, PYO, TRP, CLM, MSG, NTF, REV, FIN, RISK (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 (« tous (lecture), IAM ») ; §2.1 SUP --> CLM).

## Responsabilité

SUP porte la console interne du personnel (17 §2.2, §2.14) :

- fiche 360° et files de revue (KYC, annonces, vérification d'hôte, réservations à risque, retards, écarts de rapprochement) ;
- dossiers de support et notes internes ;
- actions forcées et motivées sur un trip (`manual_action`) ;
- gestes commerciaux plafonnés par rôle, financés par la jambe `PLATFORM`.

SUP ne décide pas les règles des autres modules : une action de console appelle la commande de domaine du module concerné. L'authentification forte du staff (session élevée par TOTP, `StaffGuard`) appartient à IAM.

État réel du code :

- **US-012** : route `POST /console/actions` (`internal/console.controller.ts`, `SupConsoleModule`). L'acteur vient de la session élevée, jamais du corps.
- **US-101** (ADR-092) : cadre des actions de console.
  - `POST /console/actions` admet `evidence` (UUID des pièces) et `input` (chaînes seulement, jamais un montant). Réponses : 201 `STAFF_ACTION_RECORDED`, `STAFF_ACTION_DONE` ou `STAFF_ACTION_REQUESTED` (avec `approvalId`) ; 200 si déjà reçue (même `requestId`) ; 403 `FORBIDDEN` ou `2FA_REQUIRED` ; 409 `STAFF_ACTION_UNAVAILABLE` (commande de domaine pas encore livrée) ou `STAFF_ACTION_REFUSED` (refus du domaine, `values.reason`) ; 400.
  - `GET /console/finance/approvals` : demandes FINANCE en attente (FINANCE et ADMIN du pays, RLS `fin_read`).
  - `POST /console/finance/approvals/{id}/approve` : approbation par une seconde personne distincte ; 200 `STAFF_ACTION_DONE`, 409 `STAFF_SELF_APPROVAL` ou `STAFF_ACTION_REFUSED` ; 403 `STAFF_SELF_FORBIDDEN` quand l'approbateur, ou le demandeur (rejugé à l'approbation, US-224 N-119), est titulaire, co-hôte ou compte lié du sujet.
  - Le contexte STAFF (`app.*`) est posé dans la même instruction que la commande (`internal/staff-context.ts`), avec la portée pays des rôles de la session.
- **US-034** : routes `/console/brand/*` et `/console/content/*` de la console « Apparence / Marque » (`internal/brand-console.controller.ts`, `SupBrandConsoleModule`). La logique et les tables sont dans CFG (`BrandConsoleService`).
- Les deux modules sont montés par le seul processus API (`apps/api/src/api.module.ts`). `SupModule` reste vide.
- **US-109** (ADR-097) : files de revue, fiche 360°, notes internes, dossiers de support, pièces du staff (`internal/ops-console.controller.ts`, `internal/ops-console-store.ts`, `internal/evidence.ts`, même `SupConsoleModule`).
  - `GET /console/queues` : résumé par file (ouverts, en retard) et éléments d'une file ; le retard est signalé par la base.
  - `POST /console/queues/items/{id}/claim` (409 `STAFF_ITEM_TAKEN`) et `POST /console/queues/items/{id}/kyc` (dossier KYC par la file seulement, journalisé `READ_C3`).
  - `POST /console/users/search`, `POST /console/users/{id}/profile` (fiche 360°, journalisée `READ_C2_SUPPORT`), `POST /console/users/{id}/notes`.
  - `POST /console/cases`, `POST /console/cases/{id}/status`.
  - `POST /console/evidence` : type réel, taille, droit, antivirus, puis dépôt chiffré ; en production : 503 tant qu'US-003 et Q-019 ne sont pas livrés.
  - `POST /console/queues/items/{id}/catalog-addition` et `…/catalog-addition/resolve` (US-114, ADR-104) : demande d'ajout au catalogue d'un élément `CATALOG_ADDITION` pris en charge (variantes candidates) et décision `MERGE` / `APPROVE` / `REJECT` (409 `CATALOG_REQUEST_CLOSED`, `CATALOG_VARIANT_EXISTS` ; 422 `CATALOG_VARIANT_NOT_FOUND`, `CATALOG_ENTRY_INVALID`) ; les écritures au catalogue sont faites par les fonctions de domaine de CAT (`catalog_cmd_owner`).
  - Couverture : un OPS ou un SUPPORT sans dossier ni élément assigné reçoit 403 `STAFF_CASE_REQUIRED` ; un ADMIN lit sa portée pays. Restrictions : actions `RESTRICT_ACCOUNT` et `LIFT_RESTRICTION` de `POST /console/actions` (saisie `kind`).
- **US-106** (ADR-106) : décision KYC de l'ops.
  - `KYC_DECISION` de `POST /console/actions` est liée (commande KYC `core.kyc_manual_action_decision`) : sujet = la vérification courante (`IDENTITY_VERIFICATION`), saisie `decision` et quatre contrôles cochés ; refus du domaine en 409 `STAFF_ACTION_REFUSED` avec `values.reason` (`CHECKS_REQUIRED`, `CHECKS_INCONSISTENT`, `ITEM_NOT_CLAIMED`, `NOT_IN_REVIEW`, `SELF_FORBIDDEN`, `CONSENT_WITHDRAWN`, `LICENSE_NOT_ACCEPTED`, `PRODUCTION_BLOCKED`).
  - La file KYC est alimentée par la base (entrée en `MANUAL_REVIEW`) ; le dossier KYC rend la vérification courante (`verification` : état, motif, permis, scores C3), la fiche 360° son statut SM-3.
  - Travailleur `review_sla_watch` (`apps/api/src/worker-tasks.ts`, 60 s) : retards signalés une fois par la base, alerte `OPS_REVIEW_SLA_BREACH` (P2) par file et pays ; dossier KYC en revue sans élément : remis en file, sinon alerte `OPS_KYC_REVIEW_UNQUEUED` (P1), une fois par dossier et par épisode de revue.
- **US-108** (ADR-111) : vérification de l'hôte par exception.
  - `POST /console/queues/items/{id}/host-verification` : dossier de l'hôte d'un élément `HOST_VERIFICATION` pris en charge (ADMIN : sa portée), journalisé `READ_C2_SUPPORT` avant la réponse : état, retenue de sanctions (visible du staff seulement), motifs de la revue, liste de contrôle fermée calculée par la base, source et date du filtrage, pièces de l'action de filtrage.
  - `HOST_SANCTIONS_SCREENING` de `POST /console/actions` est liée (commande KYC `core.kyc_manual_action_host_sanctions_screening`) : saisie `unList`, `ofacList`, `nationalList` ∈ {CLEAR, MATCH} ; refus 409 `STAFF_ACTION_REFUSED` (`HOST_ALREADY_SCREENED`, `HOST_VERIFICATION_NOT_READY`, `SELF_FORBIDDEN`).
  - Travailleur `review_sla_watch` : approbation automatique des dossiers d'hôte propres d'abord (`hostsApproved`, `hostsKept`, `hostsSkipped` au journal).
- **US-122** (ADR-122, red team du lot 1) : séparation des tâches unique dans la base (`core.support_actor_conflict`) : jamais une action de console (`POST /console/actions` : refus 409 `STAFF_ACTION_REFUSED`, `values.reason` = `SELF_FORBIDDEN`) ni un élément des files LISTING et CATALOG_ADDITION (403 `STAFF_SELF_FORBIDDEN`, `common.ops.selfForbidden`) sur un sujet qui concerne l'agent : son compte (titulaire ou membre de l'un des comptes du titulaire), sa vérification, son véhicule, son annonce, sa contestation (ou celle qui vise son véhicule), sa demande, son trip, son dossier, ou ceux d'un compte constaté lié (`LINKED`). Journalisé (`MANUAL_ACTION_REFUSED`, `STAFF_FORBIDDEN` motif `SELF`).
- **US-122, passe n° 2** (ADR-124) : la garde couvre aussi la prise d'un élément de file (`POST /console/queues/items/:id/claim`), les dossiers KYC et d'hôte (403 `STAFF_SELF_FORBIDDEN`, ADMIN compris), le constat de comptes liés et l'approbation FINANCE (`POST /console/finance/approvals/:id/approve` : 403 `FORBIDDEN`) ; un co-hôte d'une personne est partie de son compte et de sa vérification d'identité. La fiche 360° porte `hostTrips` (trips à venir des comptes d'hôte, sans le voyageur) ; la pose d'une restriction prévient chaque voyageur d'un trip à venir (`booking.trip.host_restricted`).
- **US-215c** (ADR-156, N-116, N-126) : la garde couvre enfin la fiche 360° (`POST /console/users/:id/profile`), la note interne (`…/notes`), l'ouverture d'un dossier (`POST /console/cases`) et le changement de son état (`…/cases/:id/status`) : 403 `STAFF_SELF_FORBIDDEN`, journalisé, ADMIN compris ; la porte des lectures C3 (module AUD) aussi. La levée de la dernière restriction d'un hôte prévient chaque voyageur d'un trip à venir (`booking.trip.host_restriction_lifted`) ; une seconde restriction d'une autre sorte n'envoie plus de second avis.
- **US-209b** (ADR-141, migration 0119) : réservation signalée (file `RISK_BOOKING`, élément d'une évaluation de hold).
  - `POST /console/queues/items/{id}/risk-review` : dossier d'un élément pris en charge (ADMIN : sa portée), journalisé `READ_C2_SUPPORT` avant la réponse : signaux des règles, score, état et échéance du hold, période du devis, déclaration d'entrée (statut, date [C2]) ; 409 `BOOKING_REVIEW_NOT_BOOKING` pour un élément d'une autre sorte (compte lié, US-127) ; 403 `STAFF_SELF_FORBIDDEN` (ADR-122 : une évaluation de hold concerne le voyageur et les personnes du compte d'hôte).
  - `REVIEW_FLAGGED_BOOKING` de `POST /console/actions` est liée (commande AVL `core.booking_manual_action_review_flagged`) : sujet = l'évaluation (`RISK_ASSESSMENT`), saisie `decision` ∈ {APPROVED, REJECTED}, motif journalisé ; APPROVED ⇒ `reviewed_at` et prolongation unique du hold ; REJECTED ⇒ `RELEASED` / `REVIEW_REJECTED` ; refus 409 `STAFF_ACTION_REFUSED` (`values.reason` : `ALREADY_DECIDED`, `ITEM_NOT_CLAIMED`, `HOLD_NOT_LIVE`, `HOLD_EXPIRED`, `START_PASSED`, `GUEST_INELIGIBLE`, `PAYMENT_IN_FLIGHT`, `CANCELLATION_UNAVAILABLE`, `PARAM_MISSING`, `BOOKING_UNAVAILABLE`, `NOT_FOUND`).
  - `CANCEL_TRIP_GUEST`, `CANCEL_TRIP_HOST` (saisie `subReason` facultative : `INVALID_LICENSE`, `IDENTITY_NOT_VERIFIED`, `OTHER_DRIVER_SENT`, `LICENSE_NOT_UPLOADED` ; pièce jointe = preuve validée) et `CANCEL_TRIP_PLATFORM` (saisie `platformReason` obligatoire) de `POST /console/actions` sont liées (US-215, ADR-148 ; commande `core.booking_manual_action_cancel_trip`) : 201 `STAFF_ACTION_DONE` = demande enregistrée, réglée par le travailleur `trip_lifecycle` (règlement du moteur, transition, remboursement par jambe) ; aucun montant saisi ; refus 409 `STAFF_ACTION_REFUSED` (`values.reason` : `CANCEL_REASON_REQUIRED`, `CANCELLATION_PENDING`, `TRIP_TRANSITION_FORBIDDEN`, `NOT_FOUND`, `SELF_FORBIDDEN`). Écrans de la console : 215b.
  - Console O01 (`apps/backoffice/app/console`) : bouton « ouvrir la réservation » sur l'élément pris, dossier et décision motivée (approuver, refuser, jamais pré-cochée).
- **US-215b** (ADR-151, migration 0128) : état réel d'une demande d'annulation.
  - `GET /console/cancellations/{id}` : dernière demande `CANCEL_TRIP_*` du trip (action, motif demandé, initiateur, sous-motif, état `PENDING` / `SETTLED` / `FIN_REVIEW` / `FAILED`, code garé, porteur du coût, heures) et son règlement (remboursement du voyageur, pénalité et compensation de l'hôte, variation par jambe, ordres REFUND et leur état ; montants en unités mineures, texte, avec l'exposant de la devise) ; `{ cancellation: null }` sans demande. Commande `core.support_staff_trip_cancellation` : permission `ops.platform_cancel` dans le pays du trip, garde ADR-122 (403 `STAFF_SELF_FORBIDDEN`), trip inconnu ou d'un autre pays 403 `FORBIDDEN`, refus journalisés ; lecture non inscrite au journal des accès (aucune donnée personnelle, PROPOSÉ).
  - Console O01 (`apps/backoffice/app/console/cancel-view.tsx`) : formulaire propre aux trois annulations (demandeur, motif fermé, confirmation), puis état réel relu jusqu'au règlement.
- **US-224e** (ADR-163, migration 0140) : hôte défaillant (08 BR-TRUST-09).
  - `CANCEL_HOST_TRIPS` de `POST /console/actions` (sujet = le compte d'hôte, permission `ops.platform_cancel`, aucune saisie) est liée à `core.booking_manual_action_cancel_host_trips` : l'hôte doit d'abord être restreint pour la sûreté (`RESTRICT_ACCOUNT` : `TS_HOLD` ou `POLICY_VIOLATION`, ou `KYC_REVOKED` ; depuis 0148, N-354, ADR-171, une restriction d'argent `UNPAID_BALANCE`, `PAYMENT_PLAN_ACTIVE` ou `CHARGEBACK` ne suffit pas : `HOST_NOT_RESTRICTED`) ; 201 `STAFF_ACTION_DONE` = une demande `CANCEL_TRIP_PLATFORM` / `HOST_ACCOUNT_CLOSED` enregistrée par trip à venir du compte, chacune réglée par le travailleur `trip_lifecycle` (remboursement intégral, aucune pénalité) et lue par `GET /console/cancellations/{id}` ; refus 409 `STAFF_ACTION_REFUSED` (`values.reason` : `HOST_NOT_RESTRICTED`, `NO_TRIP_TO_CANCEL`, `NOT_FOUND`, `SELF_FORBIDDEN`). Bouton de la fiche 360° : suite (écran et textes).
- **US-224d** (ADR-154, migration 0130) : `GET /console/refunds/{id}` (identifiant du trip) : remboursements SM-8 du trip pour OPS_AGENT, FINANCE et ADMIN (`ops.platform_cancel` ou `finance.platform_advance` dans le pays du trip, commande `core.support_staff_trip_refunds`) : état, montant, rail, tentative, version du règlement, jambes demandées et de l'ordre envoyé, statut de l'ordre, motif de blocage, alerte FIN, avance, dates de planification et d'émission ; montants en texte avec l'exposant de la devise ; garde ADR-122 (403 `STAFF_SELF_FORBIDDEN`), trip inconnu ou d'un autre pays 403 `FORBIDDEN`, refus journalisés ; lecture non inscrite au journal des accès (aucune donnée personnelle).
- **US-306** (ADR-193, migration 0173) : vue des retards et escalade de non-restitution.
  - `GET /console/overdue` (StaffGuard ; `core.support_staff_overdue_board`) : trips OVERDUE / UNRETURNED des pays où l'agent détient `ops.force_terminate_trip` (OPS_AGENT, ADMIN), lus en direct : retard, étape du dossier, étape suivante et son heure, escalades et gabarits produits, trip suivant à risque ; trips qui concernent l'agent écartés (ADR-122) ; aucune donnée personnelle (contacts : fiche 360°) ; aucun droit dans aucun pays ⇒ 403 journalisé.
  - `ESCALATE_OVERDUE` de `POST /console/actions` est liée (commande TRP `core.trip_manual_action_escalate_overdue`) : saisie `escalationStep` ; refus 409 `STAFF_ACTION_REFUSED` (`OVERDUE_STEP_TOO_EARLY`, `OVERDUE_STEP_OUT_OF_ORDER`, `OVERDUE_STEP_REQUIRED`, `TRIP_NOT_OVERDUE`, `OVERDUE_CASE_MISSING`, `PARAM_MISSING`, `SELF_FORBIDDEN`).
  - Console O01 (`apps/backoffice/app/console/overdue-view.tsx`) : vue relue toutes les 30 s, étape suivante préparée puis confirmée avec motif ; ce que la plateforme fait et ne fait jamais est dit avant la confirmation. L'action ne figure plus dans le formulaire générique.
- **US-310** (ADR-182, migration 0162) : aide et urgence pendant le trip (`internal/help/`, `SupHelpModule`, monté par le seul processus API).
  - `GET /help?country=` (public, cache court) : aide du pays lue de la configuration (`help` et `assistanceContacts` de CFG) : numéro d'urgence, autorité de circulation (`common.help.authority.<id>`), numéros du support et de l'assistance de l'assureur ou `null`, plage publiée ou `null` (SUP-020) ; jamais la référence du planning ; 400 `REQUEST_INVALID`.
  - `GET /trips/{tripId}/help` et `POST /trips/{tripId}/help-requests` (`SessionGuard`, `TermsGuard`) : rôle de la session dans le trip (voyageur ou titulaire du compte d'hôte, jugé par `core.support_trip_help_context`) et aide du pays du trip ; demande d'aide à motif fermé (`ACCIDENT`, `BREAKDOWN`, `HANDOVER`, `SAFETY`, `OTHER`), identifiant de la demande obligatoire, aucun texte libre : 201 `OPENED`, 200 `DUPLICATE` / `EXISTS`, 404 `TRIP_NOT_FOUND` (autrui, inconnu, mal formé : même réponse), 503 `HELP_UNAVAILABLE`. Commande `core.support_cmd_open_help_request` : dossier `IN_APP`, hors plage jugé par la base (horloge, fuseau du pays, plage transmise depuis la configuration), événement `support.help_request.received`.
  - `GET /console/help-requests?country=&limit=` (StaffGuard, `support.case_write`) : demandes vivantes sans donnée personnelle et M6 des 28 derniers jours par pays (`core.support_staff_help_requests`). Prise d'une demande non assignée et première réponse (`first_response_at`) par `POST /console/cases/{id}/status` (`core.support_staff_set_case_status` remplacée en 0162 ; garde ADR-122 inchangée) ; `RESOLVED` pose `resolved_at`.
- **US-308** (ADR-184, migration 0164) : dossier de preuve d'un trip, `SupEvidenceBundleModule` (contrôleur `evidence-bundle.controller.ts`, service de CLM) : `POST /console/evidence-bundles` (201 dossier scellé, 200 rejeu ; `evidence.export` dans le pays du dossier de support OUVERT de ce trip assigné à l'agent, motif journalisé BULK_EXPORT, 403 `STAFF_CASE_REQUIRED` / `STAFF_SELF_FORBIDDEN`), `GET /console/evidence-bundles/{bundleId}` (état pour le demandeur seulement, EXPIRED calculé), `POST /console/evidence-bundles/{bundleId}/download` (archive ZIP déchiffrée et revérifiée, 409 `EVIDENCE_EXPORT_NOT_READY` / `EVIDENCE_EXPORT_FAILED`, 410 `EVIDENCE_EXPORT_EXPIRED`) ; production : 503 `EVIDENCE_EXPORT_UNAVAILABLE` (coffre et stockage non livrés). `ctrEvidenceContractRenderer` : rendu du contrat (CTR) pour le travailleur de CLM, sans dépendance CLM → CTR.
- À venir : gestes commerciaux (US-533), console à rôles complets (US-534), commandes de domaine d'état liées par leurs stories (US-208, US-124…), mise en file par les commandes productrices (US-114, US-118, US-209), notification de l'ADMIN sur `kyc.host_screening.flagged`.

## Entités

Bêta (17 §10 point 3) : schéma unique `core`, tables préfixées `support_`.

| Entité (17 §3.2.13)  | État                                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `support_case`       | table `core.support_support_case` (migration 0024), sous-ensemble des colonnes de 17 ; colonnes de la demande d'aide (`help_topic`, `requester_role`, `off_hours`, `first_response_at`, `resolved_at`) ajoutées par 0162 (US-310) |
| `manual_action`      | table `core.support_manual_action` (migration 0034)                                                                                                                                                                               |
| `internal_note`      | table `core.support_internal_note` (migration 0064), ajout seul                                                                                                                                                                   |
| `review_queue_item`  | table `core.support_review_queue_item` (migration 0064)                                                                                                                                                                           |
| `commercial_gesture` | cible 17, pas encore créée                                                                                                                                                                                                        |

Tables présentes en base mais absentes de 17 : `core.support_manual_action_catalog` (migration 0034, complété par 0060), catalogue fermé des codes d'action ; `core.support_manual_action_handler` (migration 0060), liaison d'une action à sa commande de domaine ; `core.support_review_queue` (migration 0064), files déclarées avec leur permission et leur paramètre de délai.

Écritures d'US-109 : files, notes et dossiers ne sont écrits que par les commandes `core.support_staff_*` et `core.support_enqueue_review` (migration 0064, `iam_staff_owner`) ; aucun rôle applicatif n'a de droit sur ces tables.

Écritures : `core.support_manual_action` n'est écrite que par la commande `core.iam_staff_cmd_manual_action` (migrations 0034 et 0060, `SECURITY DEFINER`, propriétaire `iam_staff_owner`, `EXECUTE` au seul `app_api`). Le catalogue et les liaisons ne sont écrits que par migration. Voir [`packages/db/README.md`](../../../../../packages/db/README.md), sections « RLS par acteur et par pays » et « MFA du staff et console interne ».

## Événements

Émis (US-106, par la base, travailleur `review_sla_watch`) : `support.review_queue.sla_breached` (`item_id`, `queue`, `sla_due_at`, `severity` P2), une fois par élément en retard.

Émis (US-310, par la commande de la demande d'aide, 0162 ; PROPOSÉ, à reporter dans 17 §4.5) : `support.help_request.received` (`case_id`, `trip_id`, `requester_user_id`, `requester_role`, `topic`, `off_hours`, `auto_reply` ∈ GUEST, HOST, NONE), consommé par NTF (réponse automatique hors plage).

Cible :

- émis (17 §4.5) : `support.commercial_gesture.issued` ;
- émis (17 §2.2, noms différents) : `support.case.status_changed`, `ops.gesture.granted` ;
- consommés (17 §4.5) : `risk.review.required` / `.decided`, `trip.overdue.detected` / `.escalated`, `trip.offline.clock_skew_detected`, `host_ledger.state_changed`, `booking.hold.compensation_required`, `booking.hold.compensated` / `.release_deferred`, `booking.payment.late_ignored`, `booking.ical.*`, `payment.disposition.repair_alert`, `refund.instance.status_changed`, `evidence.bundle.generated`, `message.posted` / `.flagged`, `notification.dispatch.failed` / `.fallback.triggered`, `fiscal.document.status_changed`, `finance.reconciliation.delta_exceeded`, `catalog.vehicle_document.expiring`, `iam.organization.*`, `privacy.dsr.status_changed`, `security.incident.opened`.

## Ports

Port interne, exporté par `index.ts` :

- `ManualActionStore` (`internal/manual-action-store.ts`) : `record(acteur, input)` rend l'issue de la commande (`AUTH_REQUIRED`, `MFA_REQUIRED`, `FORBIDDEN`, `UNAVAILABLE`, `REFUSED`, `RECORDED`, `DONE`, `REQUESTED`, `DUPLICATE`), la référence du domaine et le détail ;
- adaptateur PostgreSQL `PgManualActionStore`, qui appelle `core.iam_staff_cmd_manual_action` en autocommit, contexte STAFF posé dans l'instruction ;
- `FinanceApprovalStore` (`internal/finance-approval-store.ts`) : `pending(acteur, limite)` et `approve(acteur, demande)` ; adaptateur `PgFinanceApprovalStore` (lecture en transaction courte sous la RLS, approbation en une instruction).
- `OpsConsoleStore` (`internal/ops-console-store.ts`, US-109) : une méthode par commande `core.support_staff_*` ; adaptateur `PgOpsConsoleStore` (une instruction en autocommit, sauf l'enregistrement d'une pièce, fait dans la transaction du téléversement).
- `HelpStore` (`internal/help/help-store.ts`, US-310) : `context`, `open`, `staffRequests` ; adaptateur `PgHelpStore` (une instruction par appel, en autocommit) ; sans magasin : `UnavailableHelpStore` (503).
- Pièces du staff (`internal/evidence.ts`, US-109) : `EvidenceScanner` (antivirus et type réel, même forme que `UploadScanner` d'AUD), `EvidenceVault` (clé de la personne et chiffrement, KMS), `EvidenceFileStore` (seau `PRIVATE_EVIDENCE`, création seule). Production : `UnavailableEvidenceScanner`, `UnavailableEvidenceVault`, `UnavailableEvidenceFileStore` (`unavailableEvidence`), jamais un FAKE.

Le test du contrôleur remplace ce magasin par un double en mémoire. Aucun adaptateur FAKE de `packages/fake-adapters` ne concerne SUP.

API publique de `index.ts` : `SupModule`, `SupConsoleModule` (et le type `SupConsoleOptions`), `PgManualActionStore`, le type `ManualActionStore`, `PgFinanceApprovalStore`, les types `FinanceApprovalStore` et `SqlPool`, `PgOpsConsoleStore`, `OpsStoreError`, `OPS_MESSAGES`, les types `OpsConsoleStore` et `OpsResult`, les ports et adaptateurs indisponibles des pièces (`unavailableEvidence`…), `SupBrandConsoleModule`, `SupSecurityConsoleModule` ; aide et urgence (US-310) : `SupHelpModule`, `PgHelpStore`, `UnavailableHelpStore`, `HelpStoreError`, `HELP_TOPICS`, `HELP_MESSAGES`, `helpViewOf`, `authorityMessageKey` et les types `HelpStore`, `HelpTopic`, `HelpRole`, `HelpHours`, `HelpContextRow`, `HelpOpenRow`, `HelpStaffResult`, `HelpCountryView`.

## Commandes de test

Unitaires (sans base ; `internal/console.controller.test.ts`, route `POST /console/actions` sur HTTP) :

```bash
pnpm --filter @rueda/api exec vitest run src/modules/sup
```

Preuves L0 en base (sous les rôles de production) :

```bash
pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-staff-console.test.ts
pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-rls-actors.test.ts
```

`l0-us310-help-request` prouve la demande d'aide d'US-310 (PA et PY : parties, IDOR, idempotence, demande vivante, plage au fuseau du pays, événement minimisé, prise, M6, séparation des tâches) ; contrat HTTP : `testing/help.contract.test.ts`. `l0-staff-console` prouve la commande `manual_action` (MFA, portée pays, journal, idempotence) ; `l0-us109-review-queues-360` prouve les files, la fiche 360°, le journal d'accès, les restrictions et les pièces d'US-109 (PA et PY, IDOR) ; `l0-us101-console-actions` prouve le cadre d'US-101 (commande liée dans la même transaction, aucun montant, pièces, FINANCE à deux personnes). Test:int des adaptateurs : `pnpm --filter @rueda/api exec vitest run --config vitest.int.config.ts src/modules/sup`. `l0-rls-actors` prouve la lecture de `support_support_case` (RLS-6). La console de marque est prouvée côté CFG (`test/l0/l0-brand.test.ts`).

Les preuves L0 demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
