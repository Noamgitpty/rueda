# PYO — Payouts (`apps/api/src/modules/pyo`)

**PYO — Payouts** : comptes de versement, lots de versement, compensation des débits (P0-B). Dépendances autorisées : STL, PAY, KYC, IAM (IAM : `SessionGuard` des routes du compte de versement, ADR-180, écart assumé de 17 §2.2 à reporter ; socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 PYO --> STL).

## Responsabilité

PYO verse à l'hôte sa part (17 §2.2, §2.10) :

- compte de versement vérifié, au nom de l'hôte (**US-707**, livré : voir plus bas) ;
- lots SM-6 par compte d'hôte, devise et type, à partir des jambes `HOST` (**US-708**, livré : voir plus bas) ;
- compensation des débits du `host_ledger` (`NETTING`, SM-6b, US-709) ;
- gel (`ON_HOLD`) en cas de litige, de chargeback ou de réclamation, puis reprise (US-314).

PYO ne calcule pas la part de l'hôte (c'est STL) et ne déplace aucun fonds lui-même : il ordonne au PSP (port `PaymentProvider` de PAY). Aucun versement si `payouts_enabled[pays]` vaut `false` : la garde est en base depuis US-049 (`core.settlement_release_blocker`, migration 0054, ADR-088) et, depuis US-708, sur les lots (motif `PAYOUTS_DISABLED`, aucune émission `INITIATED`, migration 0166). Les interrupteurs sont LUS en base (`core.config_go_live`, absent ⇒ false) ; aucun n'est jamais écrit par PYO.

### Lots de versement depuis la jambe HOST (US-708, migration 0166, ADR-185)

- **Préparation** (tâche `payout_scheduler`, 60 s, travailleur `payment_command`) : chaque trip `COMPLETED` dont la fin effective est connue (première transition `RETURNED`) entre dans UN lot (unique trip, segment, jambe) par compte d'hôte, devise, type, `payout_at` et compte PSP (`core.payout_cmd_prepare_trip`).
- **Calendrier** (08 BR-PAYOUT-02, OQ-P2P-08, PROPOSÉ) : `payout_at` = 2ᵉ jour ouvré du pays après la date locale de la fin (`payout_business_day_offset`), 5ᵉ au premier versement vers le compte de versement courant (`first_payout_business_day`), à `payout_batch_local_time` (10:00) ; samedi, dimanche et fériés du pays (`config_holiday_calendar`) exclus ; calendrier absent ⇒ aucun lot (`CALENDAR_MISSING`).
- **Écrivain unique de `trip_leg_balance.release_at`** (S-06) : la préparation, une fois, jambe HOST, ≥ fin effective + 24 h ; toute autre écriture est refusée par la base.
- **Montant** : jambe HOST encore à libérer de chaque trip ; brut − dette du `host_ledger` de la devise (compensation, SM-6b) = net, jamais négatif (`ZERO_NET`).
- **Motifs de retenue** relus à la préparation, à l'échéance, avant chaque libération et avant le versement : `PAYOUTS_DISABLED`, `FUNDS_HOLDING_DISABLED`, `VARIANT_B_UNAVAILABLE`, `HOST_PAYOUT_RAIL_UNAVAILABLE`, `SUBMERCHANT_INACTIVE`, `PAYOUT_ACCOUNT_*` (US-707), `CHARGEBACK`, `DISPUTE`, `CLAIM`, `TRIP_NOT_COMPLETED` ⇒ `ON_HOLD`.
- **Variante A** : un ordre `LEG_RELEASE` par item (`release:{trip}:1:HOST:i{n}`, rang suivant après un refus reçu seulement ; la base refuse un second ordre HOST vivant, une autre clé, un autre rang ou montant), envoyé par `MoneyCommandSender` de PAY (lecture d'abord si l'issue est inconnue), reporté sur les soldes, puis `payout` du lot (`payout:{lot}:r{n}`) ; un lot déjà émis est lu avant tout renvoi. **Variante B** : retenue avant tout ordre (`funds_holding_enabled`), exécution non construite (lot C).
- **Production** : aucun connecteur PSP avant le lot C et `payouts_enabled` = `false` : les lots sont préparés et restent `ON_HOLD`, rien n'est envoyé.

### Compte de versement de l'hôte (US-707, migrations 0159 et 0160, ADR-180)

- **Au nom de l'hôte, personne physique** : le titulaire déclaré (prénoms, noms) est rapproché en base du nom légal vérifié par le KYC (règle tolérante d'ADR-117) ; la cédula / le RUC du titulaire est comparé par le coffre (port `PayoutAccountVault`) au numéro fiscal chiffré de l'hôte. Discordant ⇒ 422 `PAYOUT_HOLDER_MISMATCH`, rien n'est écrit. Sans numéro fiscal enregistré ⇒ 409 `HOST_TAX_ID_REQUIRED` : au Paraguay, seul le RUC est admis, un hôte sans RUC n'a pas de compte et reste non activable (OQ-P2P-07, OQ-PAY-09, fail-closed).
- **Titulaire seulement** : `payout.manage_account` (matrice 17 §2.3, P2P_HOST seulement) ; un co-hôte ou un autre hôte reçoit 404 comme pour un compte inconnu.
- **Rails du pays** : `payout_account_rails[pays]` (JSON, unité `payout_rails` validée par CFG ; graine 0160 : virement bancaire au PA, virement et portefeuilles au PY, PROPOSÉ) ; absent ⇒ 503 `HOST_PAYOUT_RAIL_UNAVAILABLE`.
- **Données C2 / C3** : numéro de compte chiffré par la clé du compte d'hôte avant l'écriture (`account_number_enc`, crypto-shredding) ; seuls ses 4 derniers caractères sont en clair, pour l'affichage masqué ; la pièce du titulaire n'est pas recopiée (seul son type). Aucun numéro dans les réponses, l'audit, les événements ni les journaux.
- **Vérification par le PSP** (port `PayoutAccountVerifier`, FAKE seulement avant le lot C) : `PENDING` → `VERIFIED` ou `REJECTED` (motif fermé). Sans prestataire, le compte reste `PENDING`.
- **Changement de compte** d'un hôte qui a déjà eu un compte vérifié : l'ancien passe `REPLACED`, le nouveau porte `change_hold_until` = maintenant + `payout_account_change_hold_h[pays]` (48 h ; absente ⇒ sans fin). La garde `core.payout_payout_account_hold(org, devise, prévu le)` (EXECUTE `app_worker`) rend les motifs de retenue d'un versement : `PAYOUT_ACCOUNT_MISSING`, `PAYOUT_ACCOUNT_UNVERIFIED`, `PAYOUT_ACCOUNT_CHANGE_HOLD` ; les lots d'US-708 la liront pour passer `ON_HOLD`.
- **Production** : `postgresPyoAdapters(pool)` ; aucun coffre (KMS) ni prestataire avant le lot C : l'état reste lisible, l'enregistrement rend 503 `PAYOUT_VAULT_UNAVAILABLE`.

## Entités

| Entité (17 §3.2.9) | État                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `payout_account`   | `core.payout_payout_account` (US-707, 0159 ; écarts PROPOSÉS : pas d'`account_bidx`, type de pièce)   |
| `payout_batch`     | `core.payout_payout_batch` (US-708, 0166 ; écarts PROPOSÉS : variante, compte PSP, premier versement) |
| `payout_item`      | `core.payout_payout_item` (US-708, 0166 ; un trip, un lot ; ordre `LEG_RELEASE` de rang n)            |

17 §3.2.9 liste aussi `finance_approval` (table `core.settlement_finance_approval`, migration 0036, possédée par STL) et `tax_remittance` (module FIN).

## Événements

Aucun événement n'est encore émis (`payout.batch.status_changed` : suite, avec l'écran des gains d'US-314) : l'enregistrement et la vérification du compte sont consignés à l'audit (`PAYOUT_ACCOUNT_REGISTERED`, `PAYOUT_ACCOUNT_VERIFICATION_RECORDED`, sans aucun numéro). La notification du changement de compte à l'hôte (10b UX-43) reste à faire (suite d'US-707).

Cible (17 §4.5) :

- émis : `payout.batch.status_changed`. NTF y est déjà abonné (`apps/api/src/modules/ntf/internal/catalog.ts`) ; aucun producteur n'existe encore ;
- consommés : `settlement.legs.posted` / `.released` / `.reallocated` (STL), `host_ledger.state_changed` (STL), `trip.status_changed` (AVL), `payment.chargeback.opened` / `.closed` (PAY), `claim.status_changed` et `dispute.opened` / `.decided` (CLM).

## Ports

- `PayoutAccountVault` (`internal/payout-account-vault.port.ts`, US-707) : `sealAccountNumber` (enveloppe v1 de `@rueda/db/audit`, clé du sujet `ORG:<compte d'hôte>`), `matchesTaxId` (comparaison à temps constant de la pièce déclarée au numéro fiscal chiffré de l'hôte). FAKE : `testing/fake-payout-account-vault.ts`. Aucun coffre en production avant l'adaptateur KMS : 503.
- `PayoutAccountVerifier` (`internal/payout-account-verifier.port.ts`, US-707) : vérification du compte par le PSP (clé `payout-account:{accountId}`) ; issues `VERIFIED`, `REJECTED` (`HOLDER_MISMATCH`, `TAX_ID_MISMATCH`, `ACCOUNT_INVALID`), `UNAVAILABLE`. FAKE : `testing/fake-payout-account-verifier.ts`. Au lot C, l'adaptateur du PSP réel l'implémente avec le port `PaymentProvider` de PAY.

Le versement passe par le port `PaymentProvider` de PAY (`apps/api/src/modules/pay/internal/port.ts` : `releaseLeg`, `payout` depuis US-708 ; `adjustPayout` : US-314 / US-709), par le registre des connecteurs (`PRODUCTION_PAYMENT_CONNECTORS` : aucun avant le lot C). Stockage des lots : `PayoutBatchStore` (`internal/payout-batch-store.ts`), adaptateur `PgPayoutBatchStore`. Son adaptateur FAKE est le PSP simulé de `packages/fake-adapters` (sous-chemin `psp`, US-061). Voir [`packages/fake-adapters/README.md`](../../../../../packages/fake-adapters/README.md).

### Routes (US-707)

| Route                                        | Accès   | Réponse                                                                                                                                                                                                                                              |
| -------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /host/accounts/{orgId}/payout-account`  | session | 200 `PAYOUT_ACCOUNT_STATE` (rails du pays, type du numéro fiscal, compte masqué) ; 401 ; 403 `PAYOUT_MANAGE_FORBIDDEN` ; 404 ; 503                                                                                                                   |
| `POST /host/accounts/{orgId}/payout-account` | session | 200 `PAYOUT_ACCOUNT_SAVED` ; 400 ; 401 ; 403 `PAYOUT_MANAGE_FORBIDDEN`, `HOST_KYC_REQUIRED` ; 404 ; 409 `HOST_TAX_ID_REQUIRED` ; 415 ; 422 `PAYOUT_ACCOUNT_INVALID`, `PAYOUT_RAIL_UNSUPPORTED`, `PAYOUT_HOLDER_MISMATCH` ; 503 (coffre, base, rails) |

API publique (`index.ts`) : `PyoModule`, `PyoPayoutModule`, `unavailablePyoOptions`, `postgresPyoAdapters`, `PgPayoutAccountStore`, `UnavailablePayoutAccountStore`, `PayoutAccountService`, `PYO_MESSAGES`, `PyoHttpError`, `PayoutScheduler`, `registerPayoutScheduler`, `PgPayoutBatchStore`, les constantes `PAYOUT_SCHEDULER_*` et les types des ports et des magasins.

## Commandes de test

- Unitaires et contrat HTTP (sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/pyo` (application réelle, FAKE du magasin, du coffre et du PSP, réponses confrontées à `apps/api/openapi/openapi.json`, PA et PY).
- L0 (PostgreSQL, rôles de production `app_api` et `app_worker`, PA / USD et PY / PYG) : `packages/db/test/l0/l0-us707-payout-account.test.ts` (fixtures 9927) ; `l0-us708-payout-batches.test.ts` et `l0-us708-payout-race.test.ts` (fixtures 9921, deux connexions).
- Ordonnanceur des versements sur le PSP FAKE (compteurs d'appels) : `src/modules/pyo/testing/payout-scheduler.test.ts`.
- e2e (écran du compte de versement, 360 px, 4 langues) : `apps/web/e2e/host-payout-account.spec.ts`.

Les tests d'intégration et L0 demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
