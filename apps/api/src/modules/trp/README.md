# TRP — Trip operations (`apps/api/src/modules/trp`)

**TRP — Trip operations** : check-in, check-out, inspections, hors ligne, retards et non-restitution. Dépendances autorisées : AVL, KYC, PAY, AUD (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 TRP --> AVL, AUD).

## Responsabilité

TRP gère la remise et le retour du véhicule entre particuliers (17 §2.2, §2.11) :

- ouverture du check-in à T−24 h, bloqué tant que la preuve de paiement n'est pas reçue ;
- check-in et check-out par l'hôte et le voyageur : photos guidées, compteur, carburant, clés, signature ;
- mode hors ligne : file locale, horodatage appareil et serveur, écart de plus de 2 h signalé ;
- retard (`OVERDUE` 30 min après la fin) et escalade de non-restitution ;
- refus du véhicule et liste des remises du jour de l'hôte.

TRP ne change pas lui-même l'état du trip : il demande les transitions SM-1 à AVL. La table du trip (`core.booking_trip`, migration 0004) appartient à AVL.

État réel du code : **squelette**. `internal/` est vide et `index.ts` n'exporte que `TrpModule`. Le module arrive avec US-303 (capture photo guidée), US-315 (remise et retour entre particuliers), US-305 et US-306 (retards et escalade) et US-524 (remise et retour hors ligne).

## Entités

| Entité (17 §3.2.10) | État                       |
| ------------------- | -------------------------- |
| `trip_inspection`   | cible 17, pas encore créée |
| `inspection_photo`  | cible 17, pas encore créée |
| `overdue_case`      | cible 17, pas encore créée |
| `key_handover`      | cible 17, pas encore créée |

## Événements

Aucun événement n'est encore émis par le code.

Cible (17 §4.5) :

- émis : `trip.checkin.validated`, `trip.checkout.completed`, `trip.overdue.detected` / `.escalated`, `trip.offline.clock_skew_detected`. NTF est déjà abonné à `trip.overdue.detected` (`apps/api/src/modules/ntf/internal/catalog.ts`) ; aucun producteur n'existe encore ;
- consommés : `payment.received` (PAY, déblocage du check-in), `trip.status_changed` (AVL, minuteries).

## Ports

Aucun port. L'API publique de `index.ts` se limite à `TrpModule`.

Les photos d'inspection passeront par le magasin de preuves d'AUD (`core.audit_file_asset`, migration 0019).

## Commandes de test

Le module n'a encore aucun test. Commande unitaire (sans base) :

```bash
pnpm --filter @rueda/api exec vitest run src/modules/trp --passWithNoTests
```

Aucun test d'intégration ni preuve L0 ne concerne encore TRP. Quand il y en aura, `pnpm --filter @rueda/api test:int` et `pnpm --filter @rueda/db test:l0` demanderont PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
