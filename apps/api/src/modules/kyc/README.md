# KYC — KYC / KYB (`apps/api/src/modules/kyc`)

**KYC — KYC / KYB** : vérification du conducteur, pièces, liveness, KYB des agences, sanctions, police flotte. Dépendances autorisées : IAM, CFG, AUD (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 KYC --> IAM).

## Responsabilité

D'après 17 §2.2 et §2.4 (révision P2P) : vérification du conducteur (SM-3) et de l'hôte, qui est une personne physique ; pièces, liveness et face match par un fournisseur à parcours hébergé ; contrôle « 90 jours » du permis étranger (en mode signalement) ; contrôle du permis à la remise par l'hôte (`trip_identity_check`) ; filtrage sanctions de l'hôte. Aucune image de pièce ni selfie n'est gardée par défaut (zéro copie). Le KYB d'agence et la police flotte de la phrase ci-dessus sont historiques, sans objet depuis le pivot P2P (17 §2.4). KYC ne gère pas les comptes (IAM) ni le KYC du sous-marchand chez le PSP (PAY).

État du code : **squelette**. `KycModule` est vide (US-001). Seul le port `IdentityProvider` existe (US-020, ADR-058). Le métier arrive avec US-105 (parcours hébergé), US-106 (décision par l'ops), US-108 et US-123 (vérification de l'hôte) ; le fournisseur réel avec US-605 (lot C).

## Entités

Entités de 17 §3.2.2 ; aucune n'est encore créée en base (aucune table `core.kyc_*` dans `packages/db/migrations`) :

| Entité                      | État en base               |
| --------------------------- | -------------------------- |
| `identity_verification`     | cible 17, pas encore créée |
| `identity_document`         | cible 17, pas encore créée |
| `liveness_check`            | cible 17, pas encore créée |
| `foreign_entry_declaration` | cible 17, pas encore créée |
| `trip_identity_check`       | cible 17, pas encore créée |
| `host_verification`         | cible 17, pas encore créée |
| `sanctions_screening`       | cible 17, pas encore créée |

`beneficial_owner`, `insurance_policy` et `insurance_policy_vehicle` sont historiques, sans objet (pivot P2P). La vue `core.booking_host_guest_v` (US-062) rend un statut de vérification du voyageur à `NULL` jusqu'à l'arrivée de ces tables.

## Événements

Aucun événement n'est émis ni consommé par le code de KYC aujourd'hui. NTF est déjà abonné à `kyc.verification.status_changed` (gabarit `EVT_KYC_APPROVED`, `to` = `APPROVED`).

Cible (17 §2.2, §4.5) :

- émis : `kyc.verification.status_changed`, `kyc.trip_identity.failed`, `kyc.host_verification.decided` ;
- consommés : `iam.phone.verified` (SM-3 `PHONE_VERIFIED`), `legal.consent.recorded` (consentement biométrique préalable).

## Ports

- `IdentityProvider` (`internal/identity-provider.port.ts`, US-020, ADR-058) : `supportsDocument`, `startVerification` (session hébergée, référence opaque du sujet), `getStatus` (rapprochement si le rappel se perd), `parseWebhook` (signature et fraîcheur du rappel, corps brut). Échecs en valeurs (`OK`, `REFUSED`, `UNAVAILABLE`, `TIMEOUT`) ; pièce non prise en charge ⇒ `UNSUPPORTED_DOCUMENT` (capacité inconnue = « non ») ; pays et types de pièce sont des données de CFG.
- Adaptateur FAKE : `FakeIdentityProvider` de `@rueda/fake-adapters/identity` (tests et développement seulement, jamais en production). Fournisseur réel : lot C (US-605).

API publique (`index.ts`) : `KycModule` et les types du port (`IdentityProvider`, `IdentityOutcome`, `IdentityDecision`, `IdentityDecisionEvent`, `IdentityDocumentRef`, `IdentityWebhookVerdict`, `StartVerificationRequest`, `VerificationSession`, `VerificationStatus`).

## Commandes de test

- Unitaires (vitest, sans base ; config `apps/api/vitest.config.ts`) : `pnpm --filter @rueda/api exec vitest run src/modules/kyc`. Seul test : `internal/identity-provider.port.test.ts` (conformité du FAKE au port ; une divergence casse aussi `pnpm typecheck`).
- Intégration et L0 : aucun test propre à KYC (pas encore de table).

Les tests d'intégration et L0 demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
