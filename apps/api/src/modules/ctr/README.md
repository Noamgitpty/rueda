# CTR — Contracts & Documents (`apps/api/src/modules/ctr`)

**CTR — Contracts & Documents** : gabarits juridiques, génération PDF, signature électronique, consentements, mandats. Dépendances autorisées : IAM, CFG, AUD (socle implicite : CFG, AUD, BUS ; source : 17 §2.2).

## Responsabilité

CTR gère les gabarits juridiques versionnés, la génération des PDF (contrat de location entre l'hôte et le voyageur, constancia, conditions de l'hôte), la signature électronique simple horodatée et les consentements (17 §2.2, §3.2.6). Depuis le pivot P2P, le contrat-cadre d'agence et le mandat PSP sont historiques, sans objet (`master_agreement`, `psp_mandate`).

CTR ne stocke pas les octets des fichiers (AUD, `file_asset`) et n'envoie rien lui-même (NTF).

État réel :

- **livré** : documents juridiques versionnés et consentements du voyageur (US-102, ADR-091) : CGU du voyageur, confidentialité, communications ; routes `/legal` ; garde `TermsGuard` ; port `SignatureService` (US-020, ADR-058) ;
- **pas encore** : CGU de l'hôte (US-126, genre `TOS_HOST` déjà prévu), contrat de location et signature (US-211), constancia (US-212), route de console de publication (US-101), événements.

## Entités

| Entité (17 §3.2.6)   | Table                                              | État                                                                                   |
| -------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `document_template`  | `core.contract_document_template` (migration 0059) | texte en base, version par (genre, pays, langue), `is_major`, BROUILLON si non validée |
| `consent`            | `core.contract_consent` (migration 0059)           | registre immuable ; courant = dernière ligne ; C2 chiffrées ou retenues                |
| `generated_document` | cible 17, pas encore créée                         | —                                                                                      |
| `signature`          | cible 17, pas encore créée                         | —                                                                                      |

`master_agreement` et `psp_mandate` sont historiques, sans objet. Commandes en base (`SECURITY DEFINER`, `EXECUTE` au seul `app_api`) : `core.iam_cmd_register_with_consents`, `core.ctr_consent_status`, `core.ctr_cmd_accept_documents`, `core.ctr_cmd_set_marketing`, `core.ctr_consent_history`, `core.ctr_published_documents`, `core.ctr_document_body` (propriétaire `iam_auth_owner`) ; `core.ctr_staff_cmd_publish_document` (propriétaire `iam_staff_owner`, permission `legal.publish`). Aucune inscription sans consentement : déclencheur différé `ctr_signup_consents_required` (détail : `packages/db/README.md`, section « Consentements »).

## Routes (US-102)

| Route                            | Accès   | Rôle                                                                       |
| -------------------------------- | ------- | -------------------------------------------------------------------------- |
| `GET /legal/documents`           | public  | versions en vigueur (`locale`, `country` facultatif) ; 503 si CGU absentes |
| `GET /legal/documents/{kind}`    | public  | texte en vigueur ou version passée (`version`)                             |
| `GET /legal/consents`            | session | `TERMS_CURRENT` ou `TERMS_REACCEPT_REQUIRED`, opt-in, historique           |
| `POST /legal/consents/accept`    | session | accepter les versions en vigueur ; 409 `TERMS_VERSION_CHANGED`             |
| `POST /legal/consents/marketing` | session | accord ou révocation des communications                                    |

Garde **`TermsGuard`** (`index.ts`) : à poser après `SessionGuard` sur toute route qui réserve ; 409 `TERMS_REACCEPT_REQUIRED` après une version majeure non acceptée, fail-closed.

## Événements

Émis (cible 17 §4.5) : `contract.document.generated` / `.signed`, `legal.consent.recorded`, `legal.document_template.published`. **Aucun n'est émis aujourd'hui** (US-102 écrit les consentements en base ; l'événement viendra avec son premier consommateur).

Consommé (cible 17 §4.5) : `booking.trip.booked` (AVL, déclenche le contrat et la constancia). AVL l'émet déjà (migration 0041), mais aucun consommateur CTR n'est branché.

## Ports

- `ConsentStore` (`internal/consent-store.ts`) : `PgConsentStore` en production (`postgresCtrAdapters(pool)`), `FakeConsentStore` en test (`testing/`, exclu de la compilation de production). Le titulaire est désigné par l'empreinte du jeton de session (`sessionProofOf` d'IAM).
- `SignatureService` (`internal/signature-service.port.ts`, types exportés par `index.ts` : `SignatureService`, `SignRequest`, `SignatureRecord`, `SignatureCheckResult`, `SignatureOutcome`) : `sign` (refus `INVALID_DOCUMENT_HASH`, `OTP_TOO_OLD`) et `verify` (refus `UNKNOWN_SIGNATURE`). `TIMEOUT` = issue inconnue : rejouer la même clé. Adaptateur FAKE `FakeSignatureService` (`@rueda/fake-adapters/signature`) ; implémentation interne à venir (ADR-017). L'adaptateur est injecté.

`index.ts` exporte aussi `CtrModule`, `CtrLegalModule` (monté par `api.module.ts` après `IamAuthModule`), `LEGAL_MESSAGES` et `LegalHttpError`.

## Commandes de test

- Unitaires (sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/ctr` (`internal/signature-service.port.test.ts`, `internal/terms.guard.test.ts`, contrat HTTP `testing/legal.contract.test.ts`).
- Preuves L0 (PostgreSQL, rôles de production) : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-ctr-consents.test.ts`.

`test:int` et `test:l0` demanderont PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».
