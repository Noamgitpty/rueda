# CTR — Contracts & Documents (`apps/api/src/modules/ctr`)

**CTR — Contracts & Documents** : gabarits juridiques, génération PDF, signature électronique, consentements, mandats. Dépendances autorisées : IAM, CFG, AUD (socle implicite : CFG, AUD, BUS ; source : 17 §2.2).

## Responsabilité

CTR gère les gabarits juridiques versionnés, la génération des PDF (contrat de location entre l'hôte et le voyageur, constancia, conditions de l'hôte), la signature électronique simple horodatée et les consentements (17 §2.2, §3.2.6). Depuis le pivot P2P, le contrat-cadre d'agence et le mandat PSP sont historiques, sans objet (`master_agreement`, `psp_mandate`).

CTR ne stocke pas les octets des fichiers (AUD, `file_asset`) et n'envoie rien lui-même (NTF).

État réel :

- **livré** : documents juridiques versionnés et consentements du voyageur (US-102, ADR-091) : CGU du voyageur, confidentialité, communications ; routes `/legal` ; garde `TermsGuard` ; port `SignatureService` (US-020, ADR-058) ; **CGU de l'hôte** (US-126, ADR-100) : genre `TOS_HOST`, routes `/host/accounts/{orgId}/terms`, garde `TERMS_REACCEPT_REQUIRED` dans la commande de soumission d'une annonce (migration 0070) ;
- **checkout** (US-208, ADR-133) : genre `GEO_TERMS` (texte géographique) et graines BROUILLON de `CANCELLATION_POLICY` et `GEO_TERMS` ; consentements `CHECKOUT` écrits par `core.ctr_checkout_terms` (EXECUTE `cmd_hold_owner`) dans la commande de checkout d'AVL ; `core.ctr_account_country` ignore ces acceptations ; contrôle à l'exécution de `TermsGuard` (`internal/terms-guard-runtime.test.ts`, N-43) ;
- **contrat de location hôte–voyageur** (US-211 partie 211a, ADR-143) : gabarit `RENTAL_CONTRACT` BROUILLON (0122), texte du contrat (`buildContractBody`, libellés `ctr.contract.*` du catalogue v65, figés dans le document), PDF déterministe `ctr.pdf/1` (`renderContractPdf`, Courier WinAnsi, aucune date ni compression), empreinte et vérification (`contractSha256`, `verifyContractPdf` ⇒ `CONTRACT_HASH_MISMATCH`), lecture stricte des faits de la base (`parseContractFacts`). Fonctions pures exportées par `index.ts` ; la génération (faits du devis figé, retenue du moteur de règlement de PRC) est le travailleur `booking_contract` d'AVL ; tables et commandes de 0122 (propriétaire `cmd_hold_owner`) ;
- **pas encore** : garde des CGU de l'hôte à la confirmation d'une réservation (lot 2), routes et écrans du contrat (211b), constancia (US-212), route de console de publication (US-101), événements de consentement.

## Entités

| Entité (17 §3.2.6)   | Table                                                                                | État                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `document_template`  | `core.contract_document_template` (migration 0059)                                   | texte en base, version par (genre, pays, langue), `is_major`, BROUILLON si non validée ; `TOS_HOST` depuis 0070 |
| `consent`            | `core.contract_consent` (migration 0059)                                             | registre immuable ; courant = dernière ligne ; C2 chiffrées ou retenues                                         |
| `generated_document` | `core.contract_generated_document` + `core.contract_document_party` (migration 0122) | versions immuables (empreinte, faits non nominatifs) ; partie nominative pseudonymisable (US-211)               |
| `signature`          | `core.contract_signature` (migration 0122)                                           | signature du voyageur, heure serveur, sceau ; C2 retenues (US-211)                                              |

`master_agreement` et `psp_mandate` sont historiques, sans objet. Commandes en base (`SECURITY DEFINER`, `EXECUTE` au seul `app_api`) : `core.iam_cmd_register_with_consents`, `core.ctr_consent_status`, `core.ctr_cmd_accept_documents`, `core.ctr_cmd_set_marketing`, `core.ctr_consent_history`, `core.ctr_published_documents`, `core.ctr_document_body` (propriétaire `iam_auth_owner`) ; `core.ctr_staff_cmd_publish_document` (propriétaire `iam_staff_owner`, permission `legal.publish`). Aucune inscription sans consentement : déclencheur différé `ctr_signup_consents_required` (détail : `packages/db/README.md`, section « Consentements »).

## Routes (US-102)

| Route                            | Accès   | Rôle                                                                                                                                                                      |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /legal/documents`           | public  | versions en vigueur (`locale`, `country` facultatif) ; 503 si CGU absentes                                                                                                |
| `GET /legal/documents/{kind}`    | public  | texte en vigueur ou version passée (`version`) ; genres de `SERVED_DOCUMENT_KINDS`, dont `CANCELLATION_POLICY` et `GEO_TERMS` (checkout, US-208, 0109) ; non publié ⇒ 404 |
| `GET /legal/consents`            | session | `TERMS_CURRENT` ou `TERMS_REACCEPT_REQUIRED`, opt-in, historique                                                                                                          |
| `POST /legal/consents/accept`    | session | accepter les versions en vigueur ; 409 `TERMS_VERSION_CHANGED`                                                                                                            |
| `POST /legal/consents/marketing` | session | accord ou révocation des communications                                                                                                                                   |

Garde **`TermsGuard`** (`index.ts`) : à poser après `SessionGuard` sur toute route qui réserve ; 409 `TERMS_REACCEPT_REQUIRED` après une version majeure non acceptée, fail-closed.

## Routes des CGU de l'hôte (US-126)

| Route                                      | Accès   | Rôle                                                                                         |
| ------------------------------------------ | ------- | -------------------------------------------------------------------------------------------- |
| `GET /host/accounts/{orgId}/terms`         | session | version en vigueur dans le pays du compte d'hôte (date, langue, BROUILLON), version acceptée |
| `POST /host/accounts/{orgId}/terms/accept` | session | accepter la version affichée ; 409 `TERMS_VERSION_CHANGED` ; 404 compte d'un autre           |

Commandes en base (`iam_auth_owner`) : `core.ctr_host_terms`, `core.ctr_cmd_accept_host_terms` (EXECUTE `app_api`), `core.ctr_host_terms_required` (EXECUTE `catalog_cmd_owner` : garde de `core.catalog_cmd_submit_listing`, 409 `TERMS_REACCEPT_REQUIRED`).

## Événements

Émis (cible 17 §4.5) : `contract.document.generated` (version enregistrée, acteur SYSTEM) et `contract.document.signed` (signature du voyageur) depuis US-211 (0122) ; `legal.consent.recorded` et `legal.document_template.published` : pas encore.

Consommé (cible 17 §4.5) : `booking.trip.booked` par le travailleur `booking_contract` (AVL, US-211) : génération du contrat ; la constancia viendra avec US-212.

## Ports

- `ConsentStore` (`internal/consent-store.ts`) : `PgConsentStore` en production (`postgresCtrAdapters(pool)`), `FakeConsentStore` en test (`testing/`, exclu de la compilation de production). Le titulaire est désigné par l'empreinte du jeton de session (`sessionProofOf` d'IAM).
- `SignatureService` (`internal/signature-service.port.ts`, types exportés par `index.ts` : `SignatureService`, `SignRequest`, `SignatureRecord`, `SignatureCheckResult`, `SignatureOutcome`) : `sign` (refus `INVALID_DOCUMENT_HASH`, `OTP_TOO_OLD`) et `verify` (refus `UNKNOWN_SIGNATURE`). `TIMEOUT` = issue inconnue : rejouer la même clé. Adaptateur FAKE `FakeSignatureService` (`@rueda/fake-adapters/signature`) ; implémentation interne à venir (ADR-017). L'adaptateur est injecté.

`index.ts` exporte aussi `CtrModule`, `CtrLegalModule` (monté par `api.module.ts` après `IamAuthModule`), `LEGAL_MESSAGES` et `LegalHttpError`.

## Commandes de test

- Unitaires (sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/ctr` (`internal/signature-service.port.test.ts`, `internal/terms.guard.test.ts`, `internal/contract/rental-contract.test.ts` (contrat, PDF, empreinte de référence), contrats HTTP `testing/legal.contract.test.ts` et `testing/host-terms.contract.test.ts`).
- Preuves L0 (PostgreSQL, rôles de production) : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-ctr-consents.test.ts test/l0/l0-us126-host-terms.test.ts test/l0/l0-us211-rental-contract.test.ts`.

`test:int` et `test:l0` demanderont PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».
