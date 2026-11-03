# AUD — Audit & Evidence store (`apps/api/src/modules/aud`)

**AUD — Audit & Evidence store** : journal d'audit chaîné, accès aux données, fichiers, clés par sujet, incidents. Dépendances autorisées : BUS seulement (socle : publie ses événements par l’outbox ; source : 17 §2.2, revue architecture US-001).

## Responsabilité

AUD garde les preuves : journal d'audit en ajout seul chaîné par SHA-256, journal d'accès aux données personnelles, métadonnées des fichiers (empreinte, rétention, gel légal), clés de données par sujet (crypto-shredding). Plus tard : demandes des personnes, registre des incidents, sous-traitants (17 §2.2).

AUD ne décide rien de métier. Il ne stocke pas les octets des fichiers (port `FileStore`) et ne détient aucune clé maîtresse (port `KeyWrapper`, KMS).

État réel : le dossier du module est un **squelette** (`AudModule` vide, `internal/` vide, US-001). Le socle livré par US-009 (ADR-051) vit dans la base et dans le paquet `@rueda/db/audit` (`packages/db/src/audit/`) : `appendAuditLog`, `recordDataAccess`, `verifyAuditChain`, `SubjectKeyStore`, `seal` / `open`, `receiveFile` / `verifyFileAsset`. Détail : `packages/db/README.md`, section « Audit, clés par sujet et magasin de preuves ». Demandes des personnes, incidents et sous-traitants arrivent avec US-111 (et US-112 pour les incidents).

## Entités

| Entité (17 §3.2.13)    | En base                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `audit_log`            | table `core.audit_audit_log` (migration 0017), tête `core.audit_chain_head` (0017) |
| `data_access_log`      | table `core.audit_data_access_log` (migration 0018)                                |
| `file_asset`           | table `core.audit_file_asset` (migration 0019)                                     |
| `subject_key`          | table `core.audit_subject_key` (migration 0016), destruction 0020                  |
| `data_subject_request` | cible 17, pas encore créée                                                         |
| `security_incident`    | cible 17, pas encore créée                                                         |
| `subprocessor`         | cible 17, pas encore créée                                                         |

Droits et RLS : migrations 0021 et 0026. Les rôles applicatifs n'ont ni `UPDATE`, ni `DELETE`, ni `TRUNCATE`.

## Événements

Émis (cible 17 §4.5) : `privacy.dsr.status_changed` et `security.incident.opened`, consommés par SUP et NTF. **Aucun n'est émis aujourd'hui** : les tables correspondantes n'existent pas.

Consommés (cible 17 §4.5) : `contract.document.generated` / `.signed` (CTR) et `config.param.changed` (CFG). Aucun consommateur n'est branché aujourd'hui.

## Ports

Le module n'expose que `AudModule` par `index.ts`.

Ports du socle d'audit, dans `@rueda/db/audit` (US-009, US-020, ADR-058) :

- `KeyWrapper` (enveloppe des clés par sujet, KMS) : FAKE `FakeKeyWrapper` dans `@rueda/db/testing` ;
- `FileStore` (stockage objet, création seule) : FAKE `InMemoryFileStore` dans `@rueda/fake-adapters/files` ;
- `UploadScanner` (analyse des fichiers reçus) : FAKE `FakeUploadScanner` dans `@rueda/fake-adapters/files`.

Les FAKE sont refusés hors `RUEDA_ENV` = `development` ou `test` (`packages/fake-adapters/README.md`). Aucun adaptateur réel n'existe.

## Commandes de test

- Unitaires du module : aucun test dans ce dossier pour l'instant. Commande : `pnpm --filter @rueda/api exec vitest run --passWithNoTests src/modules/aud`.
- Unitaires du socle d'audit (sans base) : `pnpm --filter @rueda/db exec vitest run --config vitest.unit.config.ts src/audit`.
- Intégration (PostgreSQL réel) : `pnpm --filter @rueda/db exec vitest run --config vitest.int.config.ts test/int/audit-schema.test.ts`.
- Preuves L0 (rôles de production) : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-aud-01-audit-chain.test.ts test/l0/l0-aud-02-subject-key.test.ts test/l0/l0-aud-03-file-asset.test.ts`.

`test:int` et `test:l0` demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».
