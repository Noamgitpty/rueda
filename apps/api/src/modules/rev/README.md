# REV — Reviews (`apps/api/src/modules/rev`)

**REV — Reviews** : avis guest, avis hôte (P1), agrégats. Dépendances autorisées : AVL (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 REV --> AVL).

## Responsabilité

REV gère les avis, comme chez Turo (17 §2.2, §2.13) :

- avis du voyageur sur le véhicule et l'hôte (note globale et 5 sous-notes) ;
- avis de l'hôte sur le voyageur ;
- publication quand les deux parties ont noté, ou à J+`review_window_days` (10, 08 BR-REVIEW-01) ;
- agrégats par véhicule et par hôte.

Un avis exige un trip `COMPLETED`. REV ne modère pas les messages (MSG) et n'envoie pas l'invitation à noter (NTF).

État réel du code : **squelette**. `internal/` est vide et `index.ts` n'exporte que `RevModule`. Le module arrive avec US-218 (avis collectés et nombre de trips), US-317 (avis réciproques en double aveugle) et US-527 (avis complets). La vue `core.booking_host_guest_v` (US-062) rend déjà une note du voyageur, `NULL` jusqu'à la story des avis.

## Entités

| Entité (17 §3.2.12) | État                       |
| ------------------- | -------------------------- |
| `review`            | cible 17, pas encore créée |
| `rating_aggregate`  | cible 17, pas encore créée |

## Événements

Aucun événement n'est encore émis par le code.

Cible (17 §4.5) :

- émis : `review.published` (consommateurs : RPT pour les agrégats, CAT) ;
- consommés : aucun n'est listé pour REV dans 17 §4.5. La minuterie `review_window_days` est une tâche durable (`scheduled_job`, 17 §2.11).

## Ports

Aucun port. L'API publique de `index.ts` se limite à `RevModule`.

## Commandes de test

Le module n'a encore aucun test. Commande unitaire (sans base) :

```bash
pnpm --filter @rueda/api exec vitest run src/modules/rev --passWithNoTests
```

Aucun test d'intégration ni preuve L0 ne concerne encore REV. Quand il y en aura, `pnpm --filter @rueda/api test:int` et `pnpm --filter @rueda/db test:l0` demanderont PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
