# packages/fake-adapters — adaptateurs FAKE (`@rueda/fake-adapters`)

Adaptateurs **FAKE** derrière les ports de 17 §5, pour les tests et le développement local (17 §6.5, §10 ; ADR-032, ADR-058). Propriétaires : US-019 (PSP), US-020 (autres ports), US-061 (place de marché).

## Jamais en production (C19)

1. **Construction** : chaque FAKE appelle `assertFakeAllowed` (`src/guard.ts`, garde centrale) ; `RUEDA_ENV` doit valoir explicitement `development` ou `test` (absent, `preproduction` ou `production` ⇒ `FakeForbiddenError`, code `FAKE_FORBIDDEN_IN_PRODUCTION`). Les suites de tests le posent dans leur `vitest.config.ts`. `FakeKeyWrapper` (`@rueda/db/testing`) passe par la même garde.
2. **Image** : ce paquet est privé et **feuille** (aucune dépendance de production, aucun paquet de l'espace de travail) ; il n'est qu'une dépendance de **développement** (`devDependencies`) de `apps/api` et de `packages/db`. `test/production-isolation.test.ts` vérifie sur tout l'espace de travail qu'aucun `package.json` ne le déclare ailleurs et qu'aucun fichier de production ne l'importe ni ne nomme un de ses FAKE.

## Ports d'US-020

| Sous-chemin                        | FAKE                                     | Port (module propriétaire)                                          |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `@rueda/fake-adapters/identity`    | `FakeIdentityProvider`                   | `IdentityProvider` (KYC, `apps/api/src/modules/kyc`)                |
| `@rueda/fake-adapters/e-invoicing` | `FakeEInvoicingProvider`                 | `EInvoicingProvider` (FIN)                                          |
| `@rueda/fake-adapters/messaging`   | `FakeMessagingChannel` (`EMAIL`, `SMS`)  | `MessagingChannel` (NTF, utilisé par MSG)                           |
| `@rueda/fake-adapters/files`       | `InMemoryFileStore`, `FakeUploadScanner` | `FileStore`, `UploadScanner` (AUD, `@rueda/db/audit`)               |
| `@rueda/fake-adapters/signature`   | `FakeSignatureService`                   | `SignatureService` (CTR)                                            |
| `@rueda/fake-adapters/maps`        | `FakeMapTiles`                           | `MapTiles` (CAT)                                                    |
| `@rueda/fake-adapters/core`        | socle commun                             | `FakeClock`, `Script`, `FakeRuntime`, `fingerprint`, rappels signés |

- **Ports à échecs en valeurs** : `OK` (avec `replayed`), `REFUSED` (motif fermé, `IDEMPOTENCY_CONFLICT`, `UNSUPPORTED`), `UNAVAILABLE`, `TIMEOUT` (issue inconnue). Aucune classe d'exception partagée : le FAKE se conforme au port par typage structurel, sans importer le module propriétaire (pas de cycle de paquets). Le test `*.port.test.ts` de chaque module affecte le FAKE au type du port : une divergence casse `pnpm typecheck`.
- **Déterministe** : horloge virtuelle (`FakeClock`, aucun appel à l'heure système), identifiants séquentiels (`fk_idv_000001`…), codes dérivés d'une empreinte ; aucun hasard, sauf le secret de rappel que **le test** tire et fournit.
- **Cas difficiles scriptables** (`fake.runtime.script.script(op, …étapes)`, ou `fake.script` pour les fichiers) : `DELAY` (délai simulé, l'horloge avance), `UNAVAILABLE`, `TIMEOUT_BEFORE`, `TIMEOUT_AFTER` (effet produit, issue inconnue), `REFUSE` (motif), `DUPLICATE` (effet produit deux fois : message, rappel, accusé, transmission fiscale, signature) ; `setDefault` pour une panne prolongée. Tableau des effets : `src/core/runtime.ts`.
- **Idempotence** : même clé et même contenu ⇒ même réponse rejouée sans nouvel effet ; contenu différent ⇒ `IDEMPOTENCY_CONFLICT`.
- **Capacité inconnue = « non »** : pièce, régime fiscal ou canal non configuré ⇒ refus. Pièces et régimes sont des **données** passées à la construction (aucune constante pays ; les tests lisent `apps/api/src/modules/cfg/data/countries.json`).
- **Rappels** (KYC, accusés de messagerie) : signés `fake-signature: t=…,v1=HMAC-SHA256`, comparés en temps constant, fenêtre de fraîcheur ; livrés en double, en retard, perdus, dans le désordre selon le scénario (`takeDeliveries`, `takeReceipts`).

Les FAKE prouvent la logique interne, pas le comportement des vrais fournisseurs (choisis au lot C, DEC-FONDATEUR-03).

## Tests

`pnpm --filter @rueda/fake-adapters test:unit` : garde centrale (chaque FAKE, sept environnements refusés), socle, chaque port (réussite, échec, doublon, retard, refus), isolement de production.
