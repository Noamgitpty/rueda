# MSG — Messaging (`apps/api/src/modules/msg`)

**MSG — Messaging** : fil par trip, masquage des coordonnées, détection du marché gris. Dépendances autorisées : IAM, AVL (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 MSG --> IAM).

## Responsabilité

D'après 17 §2.2 et §2.13 : un fil de messages par trip, ouvert après la réservation ; masquage automatique des téléphones, e-mails et liens WhatsApp ; détection des mots-clés de marché gris (`message_flag` et file ops MSG-007). Les messages servent de preuve (`hostMessageTraced` de 08) : jamais supprimés, seulement masqués (`hidden_at`). Relais WhatsApp et questions pré-réservation filtrées : P1. MSG n'envoie pas de notification (NTF).

État du code : **squelette, rien d'implémenté**. `MsgModule` est vide (US-001) et `internal/` ne contient qu'un `.gitkeep`. Le module arrive avec US-525 (messagerie par trip et marché gris) et US-316 (confidentialité, rendez-vous, rétention).

## Entités

Entités de 17 §3.2.12 ; aucune n'est encore créée en base :

| Entité           | État en base               |
| ---------------- | -------------------------- |
| `message_thread` | cible 17, pas encore créée |
| `message`        | cible 17, pas encore créée |
| `message_flag`   | cible 17, pas encore créée |

## Événements

Aucun événement n'est émis ni consommé par le code aujourd'hui.

Cible (17 §2.2, §4.5) :

- émis : `message.posted`, `message.flagged` (consommateurs : NTF, SUP pour la file marché gris, STL pour la preuve `hostMessageTraced`) ;
- consommé : `booking.trip.booked` (ouverture du fil).

## Ports

Aucun port propre. Le relais WhatsApp (P1) passera par le port `MessagingChannel` de NTF (`@rueda/fake-adapters/messaging` indique « NTF, utilisé par MSG »).

API publique (`index.ts`) : `MsgModule` seulement.

## Commandes de test

Aucun test du module pour l'instant. Commande unitaire (vitest, sans base ; config `apps/api/vitest.config.ts`) : `pnpm --filter @rueda/api exec vitest run src/modules/msg --passWithNoTests` (sans `--passWithNoTests`, vitest sort en erreur faute de fichier de test).

Pas de test d'intégration ni L0. Quand il y en aura, ils demanderont PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
