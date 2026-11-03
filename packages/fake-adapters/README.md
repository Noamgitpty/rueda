# packages/fake-adapters — adaptateurs FAKE (`@rueda/fake-adapters`)

Adaptateurs **FAKE** derrière les ports de 17 §5, pour les tests et le développement local (17 §6.5 ; ADR-032, ADR-056). Propriétaires : US-019 (PSP), US-020 (autres ports), US-061 (place de marché).

## Jamais en production (C19)

1. **Construction** : chaque FAKE appelle `assertFakeAllowed` ; `RUEDA_ENV` doit valoir explicitement `development` ou `test` (absent, `preproduction` ou `production` ⇒ `FakeForbiddenError`). Les suites de tests le posent dans leur `vitest.config.ts`.
2. **Image** : ce paquet n'est qu'une dépendance de **développement** (`devDependencies`) de `apps/api` ; aucun fichier de production ne l'importe (`apps/api/src/modules/pay/internal/production-isolation.test.ts`).
3. **Base et démarrage** : la base refuse tout compte PSP `FAKE` en production et l'API refuse de démarrer si elle en trouve un (migration 0027, `assertPaymentStartup`).

## `@rueda/fake-adapters/psp` — PSP simulé (US-019)

`FakePsp` imite l'API d'un **fournisseur** (vocabulaire du PSP, pas celui du port) : l'adaptateur `apps/api/src/modules/pay/testing/fake-payment-provider.ts` le traduit vers `PaymentProvider`, comme le fera le connecteur réel du lot C.

- **Déterministe** : horloge fournie par le test, identifiants séquentiels (`fk_tx_000001`, `fk_evt_000001`).
- **Contrôles** : Σ jambes = montant et jambes ≥ 0 (réaffectation : Σ = 0) ⇒ sinon `INVALID_LEGS` sans mouvement ; capacité absente ou non `VALIDATED_*` ⇒ `UNSUPPORTED` ; même clé et contenu différent ⇒ `IDEMPOTENCY_CONFLICT` ; même clé et même contenu ⇒ même résultat, sans second mouvement.
- **Mode hostile** (scénario déclaré) : réponses scriptées par opération (`TIMEOUT_BEFORE`, `TIMEOUT_AFTER_SUCCESS`, `UNREADABLE_AFTER_SUCCESS`, `UNAVAILABLE`, `DECLINE` avec `doNotRetry`, `ALREADY_CANCELLED`, `ALREADY_PAID`) ; webhooks en double, hors d'ordre, retardés, perdus par moyen, rejoués (`replayWebhook`) ; idempotence ignorée (second débit) ; ordres à durée de vie (`ORDER_TTL_SECONDS`, Yappy 300 s, `tick()`) ; lien réutilisable payé deux fois sans `SUPPORTS_SINGLE_USE_ORDER`.
- **Webhooks signés** : `fake-signature: t=<s>,v1=<HMAC-SHA256(secret, "<t>.<corps>")>` ; `verifyFakeSignature` compare en temps constant.
- **Inspection** : `calls(op)`, `totalCalls()`, `transactions()`, `movements()` (« débité une fois »).

Le FAKE prouve la logique interne, pas le comportement des vrais PSP : la porte PAY-041 (capacités validées en bac à sable) reste un critère de mise en service (17 §6.5 point 6).

## Tests

`pnpm --filter @rueda/fake-adapters test:unit` (devise de test ISO 4217 `XTS` : ce paquet ne connaît aucun pays ; les montants par pays sont rejoués par la suite de contrat de `apps/api` avec les vecteurs TJ).
