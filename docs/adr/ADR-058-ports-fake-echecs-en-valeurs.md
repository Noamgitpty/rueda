# ADR-058 — Ports d'intégration à échecs en valeurs, FAKE dans un paquet feuille, garde centrale

- **Statut** : PROPOSÉ (US-020, agent integrations, 2026-11-03). Revues code, architecture et sécurité requises, sur un autre modèle que l'auteur. À reporter dans 17 §5 et §8.1.
- **Stories** : US-020 ; s'appuient dessus US-021 (notifications), la story KYC, CTR (contrats), FIN (facture), CAT (carte), US-045 (résilience). **Sources** : 17 §5, §6.5, §10 ; ADR-007, ADR-017, ADR-032 ; C19 ; revues US-009 (architecture constat 2, sécurité constat 11).

## Contexte

US-020 livre les ports `IdentityProvider`, `EInvoicingProvider`, `MessagingChannel`, `FileStore`, `UploadScanner`, `SignatureService` et `MapTiles`, chacun avec un FAKE qui couvre réussite, échec, doublon et retard, et la garantie qu'aucun FAKE n'entre dans l'image de production. Contraintes :

- le port appartient au module propriétaire (`apps/api/src/modules/<x>`, ou `@rueda/db/audit` pour AUD) ;
- les FAKE vivent dans `packages/fake-adapters`, paquet séparé exclu de l'image (17 §10) ;
- `apps/api` et `packages/db` dépendent de `@rueda/fake-adapters` pour leurs tests. Si ce paquet importait `@rueda/db` ou `apps/api` pour y prendre les types et classes d'erreur, Turborepo refuserait le graphe (**cycle** `@rueda/db` ↔ `@rueda/fake-adapters`, constaté par `turbo run typecheck --dry`).

## Décision

1. **Échecs en valeurs.** Chaque méthode de port rend une union discriminée : `OK { value, replayed }`, `REFUSED { reason }` (motifs fermés par port, plus `IDEMPOTENCY_CONFLICT` et `UNSUPPORTED`), `UNAVAILABLE` (rien n'a été fait), `TIMEOUT` (**issue inconnue** : rejouer la même clé ou interroger l'état). Les rappels rendent `ACCEPTED` ou `REJECTED` (`BAD_SIGNATURE`, `STALE`, `MALFORMED`). `FileStore` et `UploadScanner` suivent la même idée avec leurs statuts (`STORED`, `CONFLICT`, `FOUND`, `NOT_FOUND`, `SCANNED`…). Aucune classe d'exception n'est partagée entre un port et son FAKE.
2. **Paquet feuille, conformance structurelle.** `@rueda/fake-adapters` n'importe aucun paquet de l'espace de travail. Chaque FAKE déclare ses propres types, de même forme que le port ; le module propriétaire porte un test `*.port.test.ts` qui affecte le FAKE au type du port : toute divergence casse `pnpm typecheck`. Le prix est une double déclaration des types, contrôlée par le compilateur.
3. **Socle commun** (`src/core`) : `FakeClock` (horloge virtuelle, délais sans attente réelle), `Script` (file d'étapes par opération : `OK`, `DELAY`, `UNAVAILABLE`, `TIMEOUT_BEFORE`, `TIMEOUT_AFTER`, `REFUSE`, `DUPLICATE` ; `setDefault` pour une panne prolongée), `FakeRuntime` (même sémantique pour tous les ports, idempotence par empreinte canonique), rappels signés HMAC-SHA256 comparés en temps constant. Déterminisme : aucun hasard ni heure système dans les FAKE ; les secrets de rappel sont fournis par le test.
4. **Garde centrale C19.** `assertFakeAllowed` (fichier `src/guard.ts`, partagé avec US-019) exige `RUEDA_ENV` = `development` ou `test` **explicitement** ; tout le reste est refusé (fail-closed). Tous les FAKE d'US-020 l'appellent à la construction ; `FakeKeyWrapper` (`@rueda/db/testing`) aussi, au lieu de l'ancien test `NODE_ENV !== 'production'` (revue sécurité US-009, constat 11).
5. **Image sans FAKE.** Le paquet est privé, sans dépendance de production ; `test/production-isolation.test.ts` vérifie sur tout l'espace de travail qu'il n'apparaît qu'en `devDependencies` et qu'aucun fichier de production (hors tests et `testing/`) ne l'importe ni ne nomme un de ses FAKE.
6. **Déplacement d'US-009.** `InMemoryFileStore` quitte `@rueda/db/testing` pour `@rueda/fake-adapters/files`. Le port `FileStore` passe aux échecs en valeurs : `put` rend `CONFLICT` (création seule inchangée) et `receiveFile` lève toujours `FileStoreConflictError` ; `UNAVAILABLE` / `TIMEOUT` ⇒ `FileAssetError` (la transaction de l'appelant s'annule) ; `verifyFileAsset` rend `UNREADABLE OBJECT_MISSING` pour un objet perdu et lève `FileAssetError` sur panne (pas de verdict). `FakeKeyWrapper` **reste** dans `@rueda/db/testing` : le port `KeyWrapper` signale ses refus par des classes d'erreur reconnues par `instanceof` dans `subject-keys.ts` (code de sécurité revu) ; le déplacer imposerait soit un cycle, soit une réécriture du port, hors périmètre d'US-020 (KMS : US-003).
7. **Données pays.** Pièces d'identité, régimes fiscaux et devises sont des paramètres de construction des FAKE ; les tests les lisent dans la configuration pays (`countries.json`) et rejouent chaque pays configuré. Le module CTR porte la borne « OTP ≤ 10 min » de 17 §2.7 ; le FAKE la reçoit en option.

## Conséquences

- Les modules consommateurs écrivent des `switch` exhaustifs sur `status` ; `TIMEOUT` n'est jamais traité comme un échec définitif (rejeu de la même clé), ce que les FAKE exercent (`TIMEOUT_AFTER`).
- `FileStore.put` avec `DUPLICATE` rend `CONFLICT` alors que l'objet de l'appelant est en place, et `TIMEOUT` peut laisser un objet orphelin : l'adaptateur réel (US-003) prévoit un nettoyage des orphelins ; un rejeu de `receiveFile` utilise une nouvelle clé de stockage.
- Les signatures de rappel des FAKE d'US-019 (`src/psp/signature.ts`) et d'US-020 (`src/core/webhook.ts`) ont le même format mais deux fichiers : à fusionner quand les deux stories seront dans `main`.
- Les adaptateurs réels (lot C) implémentent les mêmes unions ; un fournisseur qui lève une exception est enveloppé par son adaptateur.

## Reports à faire (orchestrateur)

17 §5 (colonne « Port » : ports d'US-020, échecs en valeurs, `UploadScanner` dans AUD), 17 §8.1 (ADR-058), ADR-051 (emplacement du FAKE `FileStore` et garde `RUEDA_ENV`).
