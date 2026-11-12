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
  - `POST /console/finance/approvals/{id}/approve` : approbation par une seconde personne distincte ; 200 `STAFF_ACTION_DONE`, 409 `STAFF_SELF_APPROVAL` ou `STAFF_ACTION_REFUSED`.
  - Le contexte STAFF (`app.*`) est posé dans la même instruction que la commande (`internal/staff-context.ts`), avec la portée pays des rôles de la session.
- **US-034** : routes `/console/brand/*` et `/console/content/*` de la console « Apparence / Marque » (`internal/brand-console.controller.ts`, `SupBrandConsoleModule`). La logique et les tables sont dans CFG (`BrandConsoleService`).
- Les deux modules sont montés par le seul processus API (`apps/api/src/api.module.ts`). `SupModule` reste vide.
- **US-109** (ADR-097) : files de revue, fiche 360°, notes internes, dossiers de support, pièces du staff (`internal/ops-console.controller.ts`, `internal/ops-console-store.ts`, `internal/evidence.ts`, même `SupConsoleModule`).
  - `GET /console/queues` : résumé par file (ouverts, en retard) et éléments d'une file ; le retard est signalé par la base.
  - `POST /console/queues/items/{id}/claim` (409 `STAFF_ITEM_TAKEN`) et `POST /console/queues/items/{id}/kyc` (dossier KYC par la file seulement, journalisé `READ_C3`).
  - `POST /console/users/search`, `POST /console/users/{id}/profile` (fiche 360°, journalisée `READ_C2_SUPPORT`), `POST /console/users/{id}/notes`.
  - `POST /console/cases`, `POST /console/cases/{id}/status`.
  - `POST /console/evidence` : type réel, taille, droit, antivirus, puis dépôt chiffré ; en production : 503 tant qu'US-003 et Q-019 ne sont pas livrés.
  - Couverture : un OPS ou un SUPPORT sans dossier ni élément assigné reçoit 403 `STAFF_CASE_REQUIRED` ; un ADMIN lit sa portée pays. Restrictions : actions `RESTRICT_ACCOUNT` et `LIFT_RESTRICTION` de `POST /console/actions` (saisie `kind`).
- **US-106** (ADR-106) : décision KYC de l'ops.
  - `KYC_DECISION` de `POST /console/actions` est liée (commande KYC `core.kyc_manual_action_decision`) : sujet = la vérification courante (`IDENTITY_VERIFICATION`), saisie `decision` et quatre contrôles cochés ; refus du domaine en 409 `STAFF_ACTION_REFUSED` avec `values.reason` (`CHECKS_REQUIRED`, `CHECKS_INCONSISTENT`, `ITEM_NOT_CLAIMED`, `NOT_IN_REVIEW`, `SELF_FORBIDDEN`, `CONSENT_WITHDRAWN`, `LICENSE_NOT_ACCEPTED`, `PRODUCTION_BLOCKED`).
  - La file KYC est alimentée par la base (entrée en `MANUAL_REVIEW`) ; le dossier KYC rend la vérification courante (`verification` : état, motif, permis, scores C3), la fiche 360° son statut SM-3.
  - Travailleur `review_sla_watch` (`apps/api/src/worker-tasks.ts`, 60 s) : retards signalés une fois par la base, alerte `OPS_REVIEW_SLA_BREACH` (P2) par file et pays ; dossier KYC en revue sans élément : remis en file, sinon alerte `OPS_KYC_REVIEW_UNQUEUED` (P1).
- À venir : gestes commerciaux (US-533), console à rôles complets (US-534), commandes de domaine d'état liées par leurs stories (US-208, US-123, US-124…), mise en file par les commandes productrices (US-108, US-114, US-118, US-209).

## Entités

Bêta (17 §10 point 3) : schéma unique `core`, tables préfixées `support_`.

| Entité (17 §3.2.13)  | État                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| `support_case`       | table `core.support_support_case` (migration 0024), sous-ensemble des colonnes de 17 |
| `manual_action`      | table `core.support_manual_action` (migration 0034)                                  |
| `internal_note`      | table `core.support_internal_note` (migration 0064), ajout seul                      |
| `review_queue_item`  | table `core.support_review_queue_item` (migration 0064)                              |
| `commercial_gesture` | cible 17, pas encore créée                                                           |

Tables présentes en base mais absentes de 17 : `core.support_manual_action_catalog` (migration 0034, complété par 0060), catalogue fermé des codes d'action ; `core.support_manual_action_handler` (migration 0060), liaison d'une action à sa commande de domaine ; `core.support_review_queue` (migration 0064), files déclarées avec leur permission et leur paramètre de délai.

Écritures d'US-109 : files, notes et dossiers ne sont écrits que par les commandes `core.support_staff_*` et `core.support_enqueue_review` (migration 0064, `iam_staff_owner`) ; aucun rôle applicatif n'a de droit sur ces tables.

Écritures : `core.support_manual_action` n'est écrite que par la commande `core.iam_staff_cmd_manual_action` (migrations 0034 et 0060, `SECURITY DEFINER`, propriétaire `iam_staff_owner`, `EXECUTE` au seul `app_api`). Le catalogue et les liaisons ne sont écrits que par migration. Voir [`packages/db/README.md`](../../../../../packages/db/README.md), sections « RLS par acteur et par pays » et « MFA du staff et console interne ».

## Événements

Émis (US-106, par la base, travailleur `review_sla_watch`) : `support.review_queue.sla_breached` (`item_id`, `queue`, `sla_due_at`, `severity` P2), une fois par élément en retard.

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
- Pièces du staff (`internal/evidence.ts`, US-109) : `EvidenceScanner` (antivirus et type réel, même forme que `UploadScanner` d'AUD), `EvidenceVault` (clé de la personne et chiffrement, KMS), `EvidenceFileStore` (seau `PRIVATE_EVIDENCE`, création seule). Production : `UnavailableEvidenceScanner`, `UnavailableEvidenceVault`, `UnavailableEvidenceFileStore` (`unavailableEvidence`), jamais un FAKE.

Le test du contrôleur remplace ce magasin par un double en mémoire. Aucun adaptateur FAKE de `packages/fake-adapters` ne concerne SUP.

API publique de `index.ts` : `SupModule`, `SupConsoleModule` (et le type `SupConsoleOptions`), `PgManualActionStore`, le type `ManualActionStore`, `PgFinanceApprovalStore`, les types `FinanceApprovalStore` et `SqlPool`, `PgOpsConsoleStore`, `OpsStoreError`, `OPS_MESSAGES`, les types `OpsConsoleStore` et `OpsResult`, les ports et adaptateurs indisponibles des pièces (`unavailableEvidence`…), `SupBrandConsoleModule`, `SupSecurityConsoleModule`.

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

`l0-staff-console` prouve la commande `manual_action` (MFA, portée pays, journal, idempotence) ; `l0-us109-review-queues-360` prouve les files, la fiche 360°, le journal d'accès, les restrictions et les pièces d'US-109 (PA et PY, IDOR) ; `l0-us101-console-actions` prouve le cadre d'US-101 (commande liée dans la même transaction, aucun montant, pièces, FINANCE à deux personnes). Test:int des adaptateurs : `pnpm --filter @rueda/api exec vitest run --config vitest.int.config.ts src/modules/sup`. `l0-rls-actors` prouve la lecture de `support_support_case` (RLS-6). La console de marque est prouvée côté CFG (`test/l0/l0-brand.test.ts`).

Les preuves L0 demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
