# KYC — KYC / KYB (`apps/api/src/modules/kyc`)

**KYC — KYC / KYB** : vérification du conducteur, pièces, liveness, KYB des agences, sanctions, police flotte. Dépendances autorisées : IAM, CFG, AUD (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 KYC --> IAM).

## Responsabilité

D'après 17 §2.2 et §2.4 (révision P2P) : vérification du conducteur (SM-3) et de l'hôte, qui est une personne physique ; pièces, liveness et face match par un fournisseur à parcours hébergé ; contrôle « 90 jours » du permis étranger (en mode signalement) ; contrôle du permis à la remise par l'hôte (`trip_identity_check`) ; filtrage sanctions de l'hôte. Aucune image de pièce ni selfie n'est gardée par défaut (zéro copie). Le KYB d'agence et la police flotte de la phrase ci-dessus sont historiques, sans objet depuis le pivot P2P (17 §2.4). KYC ne gère pas les comptes (IAM) ni le KYC du sous-marchand chez le PSP (PAY).

État du code : **vérification d'identité du voyageur** (US-105, ADR-102) : consentement biométrique séparé, parcours hébergé du fournisseur (port `IdentityProvider`, FAKE seulement), décision par rappel signé, contrôle bloquant du permis pour le paiement. **Inscription et vérification individuelle de l'hôte, profil fiscal** (US-123, ADR-105) : dossier de l'hôte, faits vérifiés du KYC (date de naissance, résidence), filtrage des sanctions (port `SanctionsScreener`, FAKE seulement), profil fiscal chiffré par la clé du compte d'hôte (port `TaxIdSealer`), décision de l'ops `HOST_VERIFICATION_DECISION` et activation gardée en base. À venir : US-106 (décision KYC par l'ops), US-108 (vérification de l'hôte sur pièces, filtrage manuel), consommateur `payment_command` de l'enregistrement du sous-marchand (story à créer), US-605 (fournisseur réel, lot C). `KycModule` (US-001) reste vide ; le métier est monté par `KycIdentityModule` (processus API).

## Entités

Entités de 17 §3.2.2 (migrations `0072` et `0075`, écritures par commandes `core.kyc_*` seulement) :

| Entité                      | État en base                                                                    |
| --------------------------- | ------------------------------------------------------------------------------- |
| `identity_verification`     | `core.kyc_identity_verification` (US-105)                                       |
| `identity_document`         | `core.kyc_identity_document` (US-105 ; champs minimaux, aucune image ni numéro) |
| `liveness_check`            | `core.kyc_liveness_check` (US-105 ; scores C3, aucune image)                    |
| `foreign_entry_declaration` | cible 17, pas encore créée                                                      |
| `trip_identity_check`       | cible 17, pas encore créée                                                      |
| `host_verification`         | `core.kyc_host_verification` (US-123 ; un dossier par compte d'hôte)            |
| `sanctions_screening`       | `core.kyc_sanctions_screening` (US-123 ; aucune entrée de liste copiée)         |

Tables techniques (US-105) : `core.kyc_provider_event` (idempotence des rappels), `core.kyc_webhook_rejection` (rappels rejetés : empreinte du corps). US-123 : `core.kyc_identity_subject` (date de naissance et résidence vérifiées, C2) et `core.kyc_host_tax_profile` (profil fiscal, numéro chiffré `tax_id_enc`, FIN-008, hébergé par KYC le temps de l'inscription, PROPOSÉ). Numéro fiscal **facultatif** par défaut (ADR-115, 0085 et 0086) : exigé au dossier seulement si `host_tax_id_required_for_activation[pays]` vaut `true` ou est absent (graine `false` en PA et en PY), et avant l'activation si le PSP du sous-marchand `ACTIVE` n'a pas validé `SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID` ; un premier numéro reste admis en revue ou après l'approbation.

`beneficial_owner`, `insurance_policy` et `insurance_policy_vehicle` sont historiques, sans objet (pivot P2P). La vue `core.booking_host_guest_v` (US-062) rend un statut de vérification du voyageur à `NULL` jusqu'à l'arrivée de ces tables.

## Événements

Émis (US-123, par les commandes en base) : `kyc.host_verification.decided` (`org_id`, `verification_id`, `decision`), `iam.organization.status_changed` (`org_id`, `from`, `to`) au passage `PENDING_ACTIVATION` ou `ACTIVE`, `iam.organization.created` une fois, à la première activation (N-38).

Émis (US-105, par les commandes en base) : `kyc.verification.status_changed` (`user_id`, `from`, `to`, `reason_code`) à chaque transition SM-3 (`PHONE_VERIFIED → DOCS_SUBMITTED`, `DOCS_SUBMITTED → AUTO_CHECKS`, `AUTO_CHECKS → APPROVED | MANUAL_REVIEW`). US-106 : `MANUAL_REVIEW → APPROVED | REJECTED | MORE_INFO_REQUIRED` par la décision de l'ops (acteur OPS_AGENT ou ADMIN, motif = catégorie du premier contrôle en échec). NTF y est abonné (gabarit `EVT_KYC_APPROVED`, `to` = `APPROVED`). Aucun événement consommé : le téléphone vérifié et le consentement sont lus en base à l'ouverture.

Cible (17 §2.2, §4.5) :

- émis : `kyc.verification.status_changed`, `kyc.trip_identity.failed`, `kyc.host_verification.decided` ;
- consommés : `iam.phone.verified` (SM-3 `PHONE_VERIFIED`), `legal.consent.recorded` (consentement biométrique préalable).

## Décision de l'ops (US-106, ADR-106)

- Tout dossier qui entre en `MANUAL_REVIEW` est mis dans la file KYC de la console (US-109) par la base ; il en sort annulé si la personne retire son consentement (`RECHECK`).
- L'ops décide par l'action de console `KYC_DECISION` (SUP, `POST /console/actions`) : élément KYC pris en charge, quatre contrôles cochés (liveness, pièce selon le statut, liste des permis, doublons), motif obligatoire ; la commande liée `core.kyc_manual_action_decision` (0076) refuse sans rien écrire un dossier hors revue, un élément non pris, sa propre vérification, des contrôles incohérents, une approbation sans consentement en vigueur ou sans permis de conduire définitif valable (OQ-BR-21, défaut PROPOSÉ : IDP seul et permis provisoire jamais approuvés).
- Le voyageur ne voit qu'une catégorie (S04 : refus annoncé ; nouvelle pièce : conseil de reprise et nouvelle session).
- Le dossier KYC de la file (`POST /console/queues/items/:id/kyc`) rend la vérification courante (état, motif, champs du permis, scores C3) : c'est la seule lecture des tables KYC par le staff.

## Ports

- `IdentityProvider` (`internal/identity-provider.port.ts`, US-020, ADR-058) : `supportsDocument`, `startVerification` (session hébergée, référence opaque du sujet), `getStatus` (rapprochement si le rappel se perd), `parseWebhook` (signature et fraîcheur du rappel, corps brut). Échecs en valeurs (`OK`, `REFUSED`, `UNAVAILABLE`, `TIMEOUT`) ; pièce non prise en charge ⇒ `UNSUPPORTED_DOCUMENT` (capacité inconnue = « non ») ; pays et types de pièce sont des données de CFG.
- Adaptateur FAKE : `FakeIdentityProvider` de `@rueda/fake-adapters/identity` (tests et développement seulement, jamais en production). Fournisseur réel : lot C (US-605).

- `SanctionsScreener` (`internal/sanctions-screener.port.ts`, US-123) : `screen` (clé d'idempotence, fournisseur et session d'identité déjà vérifiée, pays) ⇒ résultat, version des listes, référence opaque. FAKE : `FakeSanctionsScreener` de `@rueda/fake-adapters/sanctions`. Aucun prestataire en production (filtrage manuel de la bêta, US-108).
- `TaxIdSealer` (`internal/tax-id-sealer.port.ts`, US-123) : chiffre le numéro fiscal par la clé du sujet `ORG:<compte d'hôte>` (enveloppe v1 de `@rueda/db/audit`). FAKE : `testing/fake-tax-id-sealer.ts`. Aucun coffre en production avant l'adaptateur KMS : 503.

Le rappel porte désormais les contrôles du fournisseur (`checks` : scores de liveness et de face match, champs minimaux de la pièce) ; l'adaptateur le lit en forme stricte et ignore tout autre champ (image, lien de selfie).

## Routes (US-123)

| Route                                                  | Accès   | Réponse                                                                                                                 |
| ------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /host/accounts/{orgId}/verification`              | session | 200 `HOST_VERIFICATION_STATE` (statuts, pièces manquantes, contrôles, types de numéro, blocages) ; 401 ; 404 ; 503      |
| `POST /host/accounts/{orgId}/verification`             | session | 200 `HOST_VERIFICATION_SUBMITTED` (filtrage par le prestataire s'il existe) ; 401 ; 403 ; 404 ; 409 ; 415 ; 503         |
| `POST /host/accounts/{orgId}/verification/tax-profile` | session | 200 `HOST_TAX_PROFILE_SAVED` (numéro chiffré avant l'écriture) ; 400 ; 401 ; 404 ; 409 ; 415 ; 422 ; 503 (aucun coffre) |

Décision de l'ops et activation : action de console `HOST_VERIFICATION_DECISION` (commande `core.kyc_manual_action_host_verification_decision`, cadre d'US-101), jamais par ces routes.

## Routes (US-105)

| Route                           | Accès   | Réponse                                                                                            |
| ------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `GET /identity`                 | session | 200 `KYC_STATE` (statut, consentement en vigueur, téléphone, pays) ; 400 ; 401 ; 503               |
| `POST /identity/consent`        | session | 200 `KYC_CONSENT_RECORDED` ; 400 ; 401 ; 403 ; 409 `KYC_CONSENT_VERSION_CHANGED` ; 415 ; 503       |
| `POST /identity/verification`   | session | 201 / 200 (reprise) adresse hébergée ; 403 `KYC_BIOMETRIC_CONSENT_MISSING` ; 409 ; 422 ; 502 ; 503 |
| `POST /kyc/webhooks/{provider}` | public  | 200 ; 401 (rejet journalisé) ; 404 (fournisseur inconnu) ; 503 — sans corps                        |

Production : aucun fournisseur tant que le registre LEG-010 n'est pas validé (OQ-MK-09) : ouverture 503 `KYC_PROVIDER_UNAVAILABLE`, rappels 404. Contrôle bloquant du paiement : `IdentityVerificationService.assertDriverEligible(preuve, fin du trip, pays du trip)` (jeton `KYC_IDENTITY_SERVICE`, module global), à poser par US-209 (`KYC_LICENSE_EXPIRED`, `KYC_NOT_APPROVED`).

API publique (`index.ts`) : `KycModule`, les types des ports (`IdentityProvider`, `SanctionsScreener`, `TaxIdSealer`), `HostVerificationService`, `PgHostVerificationStore`, `UnavailableHostVerificationStore`, `unavailableHostVerification`, `KycIdentityModule`, `postgresKycAdapters`, `IdentityVerificationService`, `KYC_IDENTITY_SERVICE`, `KYC_MESSAGES`, `KycHttpError`, `KYC_SIGNATURE_HEADER`, `PgIdentityStore`, `UnavailableIdentityStore` et leurs types.

## Commandes de test

- Unitaires (vitest, sans base ; config `apps/api/vitest.config.ts`) : `pnpm --filter @rueda/api exec vitest run src/modules/kyc` : conformité du FAKE au port, catalogue des messages (4 langues), contrat HTTP `testing/identity.contract.test.ts` (application réelle, FAKE du magasin et du fournisseur) et `testing/host-verification.contract.test.ts` (US-123 : FAKE du magasin, du filtrage et du coffre).
- L0 (PostgreSQL, rôles de production) : `packages/db/test/l0/l0-us105-identity-verification.test.ts`.
- e2e (écran S04, 360 et 390 px, 4 langues) : `apps/web/e2e/identity.spec.ts`.

Les tests d'intégration et L0 demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
