# CLM — Claims & Disputes (`apps/api/src/modules/clm`)

**CLM — Claims & Disputes** : dommages et incidents, factures annexes, litiges, dossiers de preuve, décisions. Dépendances autorisées : TRP, STL, PAY, AUD (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 CLM --> TRP, STL).

## Responsabilité

CLM traite ce qui arrive pendant ou après un trip : déclarations de dommage et d'incident (SM-4), factures annexes (SM-5), débits de dommage conformes aux réseaux et leurs jambes (08 BR-PAY-09 bis), litiges (SM-7), dossiers de preuve exportables, décisions motivées (17 §2.2, §3.2.11). Une partie est manuelle en Bêta.

CLM ne calcule pas le règlement (STL, nouvelle version sur décision) et n'exécute aucun débit (PAY).

État réel : **dossier de preuve d'un trip** (US-308, ADR-184, migration 0165). Les dommages, incidents et décisions arrivent avec US-309 et US-528, les sinistres entre particuliers avec US-318, les débits post-trip avec US-703.

## Dossier de preuve (US-308)

- **Demande** (console, OPS) : `core.support_staff_request_evidence_bundle` juge la session élevée, `evidence.export` (OPS_AGENT, ADMIN) dans le pays du dossier de support OUVERT de ce trip assigné à l'agent, la garde ADR-122 ; scelle le manifeste construit par la base (`core.claim_evidence_manifest`) ; journalise (BULK_EXPORT, motif, audit chaîné). L'API prépare dans la même transaction la clé USER du demandeur (elle chiffrera l'archive).
- **Manifeste** (`clm.evidence/1`, C1) : trip, contrat (versions, SHA-256, signature, IP « NOT_RECORDED »), CGU acceptées avant la réservation, séries de photos des deux côtés (empreinte de `file_asset`, heure serveur, reprises), journal d'état, fil de messages (empreinte et comptes), fichiers de l'archive, pièces absentes. `manifest_sha256` = SHA-256 de `manifest::text`, écrit à l'octet dans `manifest.json`.
- **Archive** (`EvidenceBundler`, travailleur `evidence_verifier`) : chaque photo relue, déchiffrée, empreinte recalculée (`readFileAsset`) ; contrat rendu de nouveau (port `EvidenceContractRenderer`, adaptateur `ctrEvidenceContractRenderer` de SUP) ; fil relu par la base ; un écart ⇒ constat FAILED (`failure_code`, `findings`) ; sinon ZIP déterministe (`buildZip`, STORE), chiffré par la clé du demandeur, déposé en création seule, READY, lien de 168 h.
- **Téléchargement** (`EvidenceBundleService.download`) : demandeur seulement, avant l'échéance ; l'API déchiffre et recalcule le SHA-256 avant de servir ; sinon `EVIDENCE_EXPORT_FAILED`, rien n'est servi.
- Routes de la console (module SUP, `SupEvidenceBundleModule`) : `POST /console/trips/{tripId}/evidence-bundles`, `GET /console/evidence-bundles/{bundleId}`, `POST /console/evidence-bundles/{bundleId}/download`.
- Production (bêta) : coffre KMS et stockage à verrou objet non livrés : routes 503 `EVIDENCE_EXPORT_UNAVAILABLE` ; le travailleur n'est pas déclaré dans `worker-tasks.ts` (aucun stockage réel, Q-007).

## Entités

- `evidence_bundle` (17 §3.2.11) : **créée** — `core.claim_evidence_bundle` (classe A, immuable : REQUESTED → READY ou FAILED, EXPIRED calculé ; aucun droit applicatif ; commandes sous `cmd_hold_owner`, portes sous `iam_staff_owner`).
- Cibles 17, pas encore créées : `claim`, `incident_report`, `incidental_invoice`, `damage_charge`, `dispute`, `decision`.

## Événements

Émis (cible 17 §4.5) : `claim.status_changed`, `invoice.status_changed`, `dispute.opened` / `.decided`, `evidence.bundle.generated`. **Aucun n'est émis aujourd'hui** (le demandeur lit l'état de son dossier ; l'alerte d'un constat est une suite).

Consommés (cible 17 §4.5) : `settlement.computed` (STL), `payment.chargeback.opened` / `.closed` et `deposit.decision.executed` (PAY), `trip.checkin.validated` (TRP, photos de départ). Aucun consommateur n'est branché.

## Ports

- `EvidenceBundleStore` (adaptateur `PgEvidenceBundleStore`, fonctions `core.support_staff_*_evidence_bundle` sous app_api).
- `EvidenceExportVault` (clé USER du demandeur ; `UnavailableEvidenceExportVault` en production) et `EvidenceExportFiles` (`UnavailableEvidenceExportFiles` en production).
- Travailleur : `EvidenceFileReader` (lecture vérifiée), `EvidenceArchiveSealer` (clé du demandeur), `EvidenceArchiveStore` (création seule), `EvidenceContractRenderer`, `WorkerTransactions` de BUS.
- Adaptateurs de TEST (`testing/audit-evidence-adapters.ts`, hors de l'image de production : `@rueda/db` y est une dépendance de développement) : `auditEvidenceAdapters` (`readFileAsset`, `seal`, `InMemoryFileStore`) et `subjectKeyExportVault` (`SubjectKeyStore` sur `FakeKeyWrapper`) ; KMS et stockage réels au lot C.

## Commandes de test

- Unitaires : `pnpm --filter @rueda/api exec vitest run src/modules/clm` (archive ZIP contre un lecteur et une table CRC-32 indépendants ; travailleur : READY, constats d'empreinte, objet absent, contrat différent, fil purgé, scellé rompu, plafond, panne passagère). Contrat HTTP : `src/testing/contract/console.contract.test.ts`.
- Preuve L0 (rôles de production, PA / USD et PY / PYG) : `packages/db/test/l0/l0-us308-evidence-bundle.test.ts` (manifeste et empreintes recalculées, accès et refus journalisés, scellé, lien de 168 h, objet remplacé ⇒ constat, RLS).

`test:int` et `test:l0` demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».
