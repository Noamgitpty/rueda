# CTR — Contracts & Documents (`apps/api/src/modules/ctr`)

**CTR — Contracts & Documents** : gabarits juridiques, génération PDF, signature électronique, consentements, mandats. Dépendances autorisées : IAM, CFG, AUD (socle implicite : CFG, AUD, BUS ; source : 17 §2.2).

## Responsabilité

CTR gère les gabarits juridiques versionnés, la génération des PDF (contrat de location entre l'hôte et le voyageur, constancia, conditions de l'hôte), la signature électronique simple horodatée et les consentements (17 §2.2, §3.2.6). Depuis le pivot P2P, le contrat-cadre d'agence et le mandat PSP sont historiques, sans objet (`master_agreement`, `psp_mandate`).

CTR ne stocke pas les octets des fichiers (AUD, `file_asset`) et n'envoie rien lui-même (NTF).

État réel : **squelette**. `CtrModule` est vide (US-001). Seul le port `SignatureService` existe (US-020, ADR-058). CGU et consentements arrivent avec US-102 et US-126, le contrat de location et la signature avec US-211, la constancia avec US-212.

## Entités

Toutes les entités de 17 §3.2.6 sont **cibles 17, pas encore créées** : `document_template`, `generated_document`, `signature`, `consent`. `master_agreement` et `psp_mandate` sont historiques, sans objet.

## Événements

Émis (cible 17 §4.5) : `contract.document.generated` / `.signed`, `legal.consent.recorded`, `legal.document_template.published`. **Aucun n'est émis aujourd'hui.**

Consommé (cible 17 §4.5) : `booking.trip.booked` (AVL, déclenche le contrat et la constancia). AVL l'émet déjà (migration 0041), mais aucun consommateur CTR n'est branché.

## Ports

- `SignatureService` (`internal/signature-service.port.ts`, types exportés par `index.ts` : `SignatureService`, `SignRequest`, `SignatureRecord`, `SignatureCheckResult`, `SignatureOutcome`) : `sign` (refus `INVALID_DOCUMENT_HASH`, `OTP_TOO_OLD`) et `verify` (refus `UNKNOWN_SIGNATURE`). `TIMEOUT` = issue inconnue : rejouer la même clé. Adaptateur FAKE `FakeSignatureService` (`@rueda/fake-adapters/signature`) ; implémentation interne à venir (ADR-017). L'adaptateur est injecté.

`index.ts` exporte aussi `CtrModule`.

## Commandes de test

- Unitaires (sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/ctr` (`internal/signature-service.port.test.ts`).
- Intégration et preuves L0 : aucun test du module, faute de table.

`test:int` et `test:l0` demanderont PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».
