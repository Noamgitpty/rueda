# AUD — Audit & Evidence store (`apps/api/src/modules/aud`)

**AUD — Audit & Evidence store** : journal d'audit chaîné, accès aux données, fichiers, clés par sujet, incidents. Dépendances autorisées : BUS seulement (socle : publie ses événements par l’outbox ; source : 17 §2.2, revue architecture US-001).

## Responsabilité

AUD garde les preuves : journal d'audit en ajout seul chaîné par SHA-256, journal d'accès aux données personnelles, métadonnées des fichiers (empreinte, rétention, gel légal), clés de données par sujet (crypto-shredding). Plus tard : demandes des personnes, registre des incidents, sous-traitants (17 §2.2).

AUD ne décide rien de métier. Il ne stocke pas les octets des fichiers (port `FileStore`) et ne détient aucune clé maîtresse (port `KeyWrapper`, KMS).

État réel : `AudModule` reste vide (US-001) ; `internal/staff-data-access.ts` porte la lecture des données personnelles par le staff (US-004, ADR-080). Le socle livré par US-009 (ADR-051) vit dans la base et dans le paquet `@rueda/db/audit` (`packages/db/src/audit/`) : `appendAuditLog`, `recordDataAccess`, `verifyAuditChain`, `SubjectKeyStore`, `seal` / `open`, `receiveFile` / `verifyFileAsset`. Détail : `packages/db/README.md`, section « Audit, clés par sujet et magasin de preuves ». Depuis US-111 (ADR-118, migrations 0089 et 0090) : registre Ley 81 (sous-traitants, traitements, règles de rétention), demandes des personnes (`HANDLE_DSR`), pseudonymisation des trips clos et journal des purges, tous en base ; garde du KYC de production consommée par KYC. **Registre des incidents de sécurité** (US-112, ADR-121) : `core.audit_security_incident` (migration 0092), une ligne par pays touché, échéances de notification d'une violation posées depuis la détection (paramètres `security_incident_*_notice_hours`, 72 h À DÉCIDER, OQ-MK-09 ; absent ⇒ immédiat) ; commandes de la console `core.security_incident_cmd_open` et `core.security_incident_cmd_step` (famille `iam_staff_owner`, EXECUTE `app_api`, TOTP) ; travailleur `security_incident_watch` (`core.security_incident_worker_watch`). Aucune route ni écran : console au lot 5. Procédure : `docs/ops/INCIDENT_RESPONSE.md`.

## Entités

| Entité (17 §3.2.13)    | En base                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `audit_log`            | table `core.audit_audit_log` (migration 0017), tête `core.audit_chain_head` (0017) |
| `data_access_log`      | table `core.audit_data_access_log` (migration 0018)                                |
| `file_asset`           | table `core.audit_file_asset` (migration 0019)                                     |
| `subject_key`          | table `core.audit_subject_key` (migration 0016), destruction 0020                  |
| `data_subject_request` | table `core.audit_data_subject_request` (migration 0090, US-111)                   |
| `security_incident`    | table `core.audit_security_incident` (migration 0092, US-112)                      |
| `subprocessor`         | table `core.audit_subprocessor` (migration 0090, US-111)                           |
| registre (16 LEG-010)  | `core.audit_processing_activity`, `core.audit_retention_rule` (0090, US-111)       |
| journal des purges     | `core.audit_retention_log` (0090, US-111, ajout seul)                              |

Droits et RLS : migrations 0021 et 0026. Les rôles applicatifs n'ont ni `UPDATE`, ni `DELETE`, ni `TRUNCATE`.

## Événements

Émis (cible 17 §4.5) : `privacy.dsr.status_changed` et `security.incident.opened`, consommés par SUP et NTF. `security.incident.opened` (`incident_id`, `country`, `kind`, `severity`, `personal_data`, `due_at`, `subjects_due_at`) est émis par la base à la déclaration (US-112) ; aucun consommateur n'est branché (l'alerte au fondateur passe par le travailleur `security_incident_watch`). `privacy.dsr.status_changed` n'est pas émis : chaque étape d'une demande est tracée par `manual_action` et l'audit chaîné ; l'événement arrivera avec son consommateur (US-536).

Consommés (cible 17 §4.5) : `contract.document.generated` / `.signed` (CTR) et `config.param.changed` (CFG). Aucun consommateur n'est branché aujourd'hui.

## Ports

`index.ts` expose `AudModule` et, depuis US-004 (ADR-080), la porte des lectures de données personnelles par le staff : `readPersonalDataAsStaff(tx, empreinteDuJeton, demande, lecture)` et `recordStaffDataAccess`. La porte (`core.iam_staff_cmd_data_access`, migration 0051) juge session, TOTP, `kyc.read_sensitive` dans le pays du dossier (`support_case`) et le dossier lui-même, écrit `data_access_log` puis une ligne chaînée `STAFF_DATA_ACCESS` ; la lecture n'a lieu que sur GRANTED, dans la même transaction (sinon `StaffDataAccessDenied`, aucune lecture). **Toute route qui rend une donnée C3 au staff passe par elle** (US-106 en premier).

Ports du socle d'audit, dans `@rueda/db/audit` (US-009, US-020, ADR-058) :

- `KeyWrapper` (enveloppe des clés par sujet, KMS) : FAKE `FakeKeyWrapper` dans `@rueda/db/testing` ;
- `FileStore` (stockage objet, création seule) : FAKE `InMemoryFileStore` dans `@rueda/fake-adapters/files` ;
- `UploadScanner` (analyse des fichiers reçus) : FAKE `FakeUploadScanner` dans `@rueda/fake-adapters/files`.

Les FAKE sont refusés hors `RUEDA_ENV` = `development` ou `test` (`packages/fake-adapters/README.md`). Aucun adaptateur réel n'existe.

## Rétention, demandes des personnes et registre Ley 81 (US-111, ADR-118)

- **Garde du KYC de production** : `core.privacy_kyc_register_gate(pays)` ; appelée par KYC (`IdentityStore.registerGate`) avant toute ouverture : `KYC_PRODUCTION_BLOCKED_NO_REGISTER` (503) en production tant que `privacy_register_validated` du pays n'est pas `true` ou qu'aucun fournisseur KYC `CONTRACTED` n'est inscrit.
- **Travailleur `privacy_request`** (`apps/api/src/worker-tasks.ts`, toutes les heures) : pseudonymisation des trips clos sans litige à `evidence_retention_months`, retards des demandes (`PRIVACY_DSR_OVERDUE`), effacements KYC en souffrance (`PRIVACY_KYC_ERASURE_STALE`) ; `docs/ops/MONITORING.md`.
- **Demandes des personnes** : action de console `HANDLE_DSR` (saisie `kind`, `step`), formulaire dédié du back-office (ADMIN, SUPERADMIN).
- **Gabarits juridiques à valider par l'avocat** : `docs/legal/registro-tratamientos-ley81.md`, `docs/legal/politica-privacidad-borrador.md`.
- Preuves : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-us111-privacy-register.test.ts`.

## Commandes de test

- Unitaires du module : `pnpm --filter @rueda/api exec vitest run src/modules/aud` (`internal/staff-data-access.test.ts`).
- Preuves L0 de la porte (rôles de production, PA et PY) : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-us004-data-access.test.ts`.
- Unitaires du socle d'audit (sans base) : `pnpm --filter @rueda/db exec vitest run --config vitest.unit.config.ts src/audit`.
- Intégration (PostgreSQL réel) : `pnpm --filter @rueda/db exec vitest run --config vitest.int.config.ts test/int/audit-schema.test.ts`.
- Preuves L0 (rôles de production) : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-aud-01-audit-chain.test.ts test/l0/l0-aud-02-subject-key.test.ts test/l0/l0-aud-03-file-asset.test.ts`.
- Registre des incidents (US-112) : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-us112-security-incident.test.ts` ; objectifs de reprise (unitaire) : `pnpm --filter @rueda/db exec vitest run --config vitest.unit.config.ts src/restore/objectives.test.ts`.

`test:int` et `test:l0` demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».
