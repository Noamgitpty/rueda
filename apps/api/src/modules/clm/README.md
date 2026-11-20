# CLM — Claims & Disputes (`apps/api/src/modules/clm`)

**CLM — Claims & Disputes** : dommages et incidents, factures annexes, litiges, dossiers de preuve, décisions. Dépendances autorisées : TRP, STL, PAY, AUD (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 CLM --> TRP, STL).

## Responsabilité

CLM traite ce qui arrive pendant ou après un trip : déclarations de dommage et d'incident (SM-4), factures annexes (SM-5), débits de dommage conformes aux réseaux et leurs jambes (08 BR-PAY-09 bis), litiges (SM-7), dossiers de preuve exportables, décisions motivées (17 §2.2, §3.2.11). Une partie est manuelle en Bêta.

CLM ne calcule pas le règlement (STL, nouvelle version sur décision) et n'exécute aucun débit (PAY).

État réel : **dossier de preuve d'un trip** (US-308, ADR-184, migration 0164) ; **déclarations de dommage et d'incident, décisions motivées par gabarit et leur exécution par Kmino** (US-309, ADR-195, migration 0175). Les frais annexes arrivent avec US-706, les sinistres entre particuliers (vol) avec US-318 ; les débits post-trip sont ceux d'US-703 (PAY).

## Dossier de preuve (US-308)

- **Demande** (console, OPS) : `core.support_staff_request_evidence_bundle` juge la session élevée, `evidence.export` (OPS_AGENT, ADMIN) dans le pays du dossier de support OUVERT de ce trip assigné à l'agent, la garde ADR-122 ; scelle le manifeste construit par la base (`core.claim_evidence_manifest`) ; journalise (BULK_EXPORT, motif, audit chaîné). L'API prépare dans la même transaction la clé USER du demandeur (elle chiffrera l'archive).
- **Manifeste** (`clm.evidence/1`, C1) : trip, contrat (versions, SHA-256, signature, IP « NOT_RECORDED »), CGU acceptées avant la réservation, séries de photos des deux côtés (empreinte de `file_asset`, heure serveur, reprises), journal d'état, fil de messages (empreinte et comptes), fichiers de l'archive, pièces absentes. `manifest_sha256` = SHA-256 de `manifest::text`, écrit à l'octet dans `manifest.json`.
- **Archive** (`EvidenceBundler`, travailleur `evidence_verifier`) : chaque photo relue, déchiffrée, empreinte recalculée (`readFileAsset`) ; contrat rendu de nouveau (port `EvidenceContractRenderer`, adaptateur `ctrEvidenceContractRenderer` de SUP) ; fil relu par la base ; un écart ⇒ constat FAILED (`failure_code`, `findings`) ; sinon ZIP déterministe (`buildZip`, STORE), chiffré par la clé du demandeur, déposé en création seule, READY, lien de 168 h.
- **Téléchargement** (`EvidenceBundleService.download`) : demandeur seulement, avant l'échéance ; l'API déchiffre et recalcule le SHA-256 avant de servir ; sinon `EVIDENCE_EXPORT_FAILED`, rien n'est servi.
- Routes de la console (module SUP, `SupEvidenceBundleModule`) : `POST /console/evidence-bundles`, `GET /console/evidence-bundles/{bundleId}`, `POST /console/evidence-bundles/{bundleId}/download`.
- Production (bêta) : coffre KMS et stockage à verrou objet non livrés : routes 503 `EVIDENCE_EXPORT_UNAVAILABLE` ; le travailleur n'est pas déclaré dans `worker-tasks.ts` (aucun stockage réel, Q-007).

## Dommages, incidents et décisions (US-309)

- **Déclaration** (console, OPS / ADMIN, `claim.declare`) : `core.support_staff_record_claim` juge la session élevée, le dossier de support CLAIM ouvert de ce trip assigné à l'agent (ADMIN : tout dossier de son pays), la garde ADR-122 ; `core.claim_cmd_record_claim` relit le déclarant (titulaire ou voyageur), juge le délai `max(fin prévue, retour) + claim_declaration_window_h` à l'heure de la base (`CLAIM_DEADLINE_PASSED`), une déclaration vivante par (trip, déclarant, nature). Refus journalisés.
- **Gel** : tant qu'une déclaration du trip n'a pas de décision exécutée, le lot de versement de l'hôte est ON_HOLD (motif `CLAIM` de `core.payout_batch_hold_reasons`), quel que soit le déclarant.
- **Décision** (`dispute.decide`) : `core.support_staff_issue_decision` puis `core.claim_cmd_issue_decision` : aperçu (rien n'est écrit) ou enregistrement ; faits exigés (`DECISION_RATIONALE_REQUIRED`), jamais « définitive » (`DECISION_FINALITY_FORBIDDEN`) ; lignes ⇒ jambes explicites, parking de récupération (BR-TT-05) et frais non imputable (BR-FUEL-03) exclus ; Σ ≠ montant ⇒ `LEG_SUM_MISMATCH` ; retenue sans photos de départ et de retour ⇒ `CLAIM_DECISION_WITHOUT_EVIDENCE` ; plafond de la franchise acceptée au contrat signé ; tout débit réservé à ADMIN.
- **Exécution** (`ClaimDecisionExecutor`, tâche `claim_decision_executor`, 60 s, sous `payment_command`) : `core.claim_cmd_execute_decision` notifie le débit séparé d'US-703 (DAMAGE / DAMAGE_SEPARATE, jambes explicites, jamais la caution), écrit la franchise de l'hôte au host_ledger (`CLAIM_HOST_DEDUCTIBLE`) et journalise la déclaration à l'assureur ; port `InsurerClaimsPort` (FAKE `FakeInsurerClaims` de `@rueda/fake-adapters/insurer` en tests ; aucun en production) appelé seulement si `insurer_contract_active[pays]`.
- Routes de la console (module SUP, `SupClaimsModule`) : `POST /console/claims`, `GET /console/claims/{claimId}`, `POST /console/claims/{claimId}/decision` ; écran A09 dans `apps/backoffice` (`claim-view.tsx`).

## Entités

- `evidence_bundle` (17 §3.2.11) : **créée** — `core.claim_evidence_bundle` (classe A, immuable : REQUESTED → READY ou FAILED, EXPIRED calculé ; aucun droit applicatif ; commandes sous `cmd_hold_owner`, portes sous `iam_staff_owner`).
- `claim` / `incident_report` (17 §2.2) : **créée** — `core.claim_damage_claim` (classe A ; REPORTED → DECIDED). `decision` (17 §3.2.11) : **créée** — `core.claim_decision` (classe A ; exécution PENDING → DONE ou BLOCKED) ; déclaration à l'assureur `core.claim_insurer_declaration` (PENDING → SENT). Aucun droit applicatif ; commandes sous `cmd_money_owner`, portes sous `iam_staff_owner`, faits du trip sous `cmd_hold_owner`.
- Cibles 17, pas encore créées : `incidental_invoice` (US-706), `damage_charge` (le débit est `payment_post_trip_charge` d'US-703), `dispute`.

## Événements

Émis (cible 17 §4.5) : `claim.status_changed`, `invoice.status_changed`, `dispute.opened` / `.decided`, `evidence.bundle.generated`. **Aucun n'est émis aujourd'hui** (le demandeur lit l'état de son dossier ; l'alerte d'un constat est une suite).

Consommés (cible 17 §4.5) : `settlement.computed` (STL), `payment.chargeback.opened` / `.closed` et `deposit.decision.executed` (PAY), `trip.checkin.validated` (TRP, photos de départ) (non émis : `trip.status_changed` porte la transition, motifs `CHECKIN_VALIDATED` et `CHECKOUT_VALIDATED`, US-315, ADR-183). Aucun consommateur n'est branché.

## Ports

- `EvidenceBundleStore` (adaptateur `PgEvidenceBundleStore`, fonctions `core.support_staff_*_evidence_bundle` sous app_api).
- `ClaimStore` (adaptateur `PgClaimStore`, portes `core.support_staff_record_claim`, `core.support_staff_claim`, `core.support_staff_issue_decision` sous app_api ; `UNAVAILABLE_CLAIM_STORE` : 503) ; `InsurerClaimsPort` (assureur partenaire, travailleur).
- `EvidenceExportVault` (clé USER du demandeur ; `UnavailableEvidenceExportVault` en production) et `EvidenceExportFiles` (`UnavailableEvidenceExportFiles` en production).
- Travailleur : `EvidenceFileReader` (lecture vérifiée), `EvidenceArchiveSealer` (clé du demandeur), `EvidenceArchiveStore` (création seule), `EvidenceContractRenderer`, `WorkerTransactions` de BUS.
- Adaptateurs de TEST (`testing/audit-evidence-adapters.ts`, hors de l'image de production : `@rueda/db` y est une dépendance de développement) : `auditEvidenceAdapters` (`readFileAsset`, `seal`, `InMemoryFileStore`) et `subjectKeyExportVault` (`SubjectKeyStore` sur `FakeKeyWrapper`) ; KMS et stockage réels au lot C.

## Commandes de test

- Unitaires : `pnpm --filter @rueda/api exec vitest run src/modules/clm` (archive ZIP contre un lecteur et une table CRC-32 indépendants ; travailleur : READY, constats d'empreinte, objet absent, contrat différent, fil purgé, scellé rompu, plafond, panne passagère). Contrat HTTP : `src/testing/contract/console.contract.test.ts`.
- Unitaires US-309 : `pnpm --filter @rueda/api exec vitest run src/modules/clm/internal/claims` (travailleur contre le FAKE de l'assureur) ; contrat HTTP : `src/testing/contract/console.contract.test.ts`. Preuve L0 : `packages/db/test/l0/l0-us309-claims.test.ts`.
- Preuve L0 (rôles de production, PA / USD et PY / PYG) : `packages/db/test/l0/l0-us308-evidence-bundle.test.ts` (manifeste et empreintes recalculées, accès et refus journalisés, scellé, lien de 168 h, objet remplacé ⇒ constat, RLS).

`test:int` et `test:l0` demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».
