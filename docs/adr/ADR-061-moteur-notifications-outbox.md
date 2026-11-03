# ADR-061 — Moteur de notifications : catalogue en code, envoi par l'outbox, repli et coordonnées par IAM

- **Statut** : PROPOSÉ (US-021, agent back-end, claude-opus-5-5, 2026-11-03). Revues code, architecture, QA et **sécurité** (fonction `SECURITY DEFINER`, droits d'`app_worker`, RLS) requises, sur un autre modèle que l'auteur. À reporter dans 17 §2.13, §3.2.12, §4.5 et §8.1.
- **Stories** : US-021 ; s'appuie sur US-008 (ADR-050), US-010 (ADR-052), US-013 (ADR-049), US-014, US-020 (ADR-058). **Sources** : 16 NTF-001, A.8.2 ; 17 §1.4, §2.2, §2.3, §2.5 (VERIF_17-A5), §2.13, §3.2.12, §4.5 ; 10b §3.9, §3.13 ; 08 BR-NOTIF ; DEC-FONDATEUR-17.

## Contexte

US-021 doit prévenir chaque destinataire, dans sa langue, sans doublon par destinataire et canal, avec repli sur l'autre canal et l'événement `notification.fallback.triggered` en cas d'échec. Contraintes :

- aucun effet externe dans une transaction rejouable (17 §2.5) : un gestionnaire du module BUS n'appelle rien de non idempotent ;
- NTF ne dépend que de CFG (17 §2.2) ; IAM dépend de NTF ; `app_worker` n'a **aucun** droit sur les tables IAM (US-010, US-011, testé) ;
- aucun fournisseur réel (FAKE d'US-020 seulement) ; aucun secret ; aucune donnée personnelle dans les journaux ;
- trois langues livrées ensemble (DEC-FONDATEUR-17) ; aucune constante pays.

## Décision

1. **Deux travailleurs sur le module BUS.** `ntf_dispatcher` (consommateur) résout règles → destinataires → canaux et écrit une ligne `notification_dispatch` par (événement, destinataire, canal) avec `ON CONFLICT DO NOTHING` sur l'unicité de 17 §3.2.12, puis programme une tâche `ntf_sender` par envoi créé, le tout dans la transaction du reçu. `ntf_sender` (minuterie, **une tâche par tentative**, clé `dispatch_id:n`) fait l'appel externe. Le rejeu d'un événement, même hors du reçu `inbox_receipt`, ne crée donc aucun doublon (critère 2).
2. **Idempotence de l'envoi.** La clé passée au port est `ntf:<dispatch_id>`, la même à chaque tentative. L'appel a lieu dans la transaction de la tâche, la ligne étant verrouillée (`FOR UPDATE`, statut `QUEUED`) ; si le COMMIT échoue après un envoi réussi, la tâche rejouée renvoie la même clé et le fournisseur rend le premier résultat (`replayed`, ADR-058). Une tâche rejouée sur un envoi déjà terminal ne fait rien.
3. **Réessais et repli.** `UNAVAILABLE` et `TIMEOUT` ⇒ nouvelle tentative différée de 60 s × 2^(n−1) (PROPOSÉ), au plus **3** tentatives (17 §2.13, contrainte `attempts BETWEEN 0 AND 3`). Refus, coordonnée absente ou non vérifiée, gabarit irrendable, canal sans adaptateur (capacité inconnue = « non ») ou tentatives épuisées ⇒ échec définitif : repli sur le canal de repli du gabarit (nouvel envoi `fallback_of`, même unicité ; un repli ne se replie pas) et `notification.fallback.triggered` ; sans repli, `FAILED` et `notification.dispatch.failed`. Charge utile : `dispatch_id`, `channel`, `fallback_channel`, `fallback_dispatch_id`, `reason` (code court) ; `causation_id` = événement d'origine.
4. **Catalogue en code, textes dans `@rueda/i18n`.** `notification_template` et `notification_rule` de 17 §3.2.12 sont, pour la bêta, un catalogue TypeScript typé (`ntf/internal/catalog.ts`) : gabarit = variables typées (10b UX-59) + canaux avec repli ; règle = type d'événement + condition + destinataires. Les textes sont des clés `ntf.<slug>.<canal>.<partie>` des catalogues es, en et fr (une clé manquante casse `pnpm typecheck`) ; `CATALOG_VERSION` est enregistrée avec chaque envoi (`template_version`, 10b UX-62). Les tables viendront avec l'édition des gabarits par l'ADMIN (et WhatsApp, US-526). Catalogue réduit de la bêta (16 NTF-001) : compte vérifié, réservation confirmée, annulée, retard, versement envoyé, versement retenu. Canaux : e-mail d'abord pour les confirmations et documents, SMS d'abord pour le retard (10b §3.9).
5. **Langue du destinataire.** Locale préférée du compte si elle est active dans le pays de l'événement ; sinon une locale active du pays de la même langue (`matchLocale`) ; sinon la locale par défaut du pays (CFG). Instants affichés au fuseau du pays, montants par `formatMoney` avec l'exposant de CFG.
6. **Rendu fail-closed.** Variable manquante ou motif résiduel (`{…}`, `%s`, `undefined`, `null`, `NaN`) ⇒ `TEMPLATE_VARIABLE_MISSING`, l'envoi échoue (puis repli) ; contrôlé en CI pour chaque gabarit × locale active × canal, avec des jeux réalistes ; titres ≤ 60 caractères, SMS ≤ 3 segments sur l'encodage réel (PROPOSÉ, 10b UX-61).
7. **Coordonnées par IAM, sans droit de table.** Port `RecipientDirectory` déclaré par NTF ; adaptateur `postgresNotificationContacts` exporté par IAM (IAM → NTF, sens autorisé) qui appelle `core.iam_notification_contact(uuid)` (migration 0030) : `SECURITY DEFINER`, propriétaire `iam_auth_owner` (famille existante, qui lit déjà `iam_user_account`, aucun droit de table ajouté), `search_path` figé, EXECUTE au seul `app_worker`, **zéro ligne** hors du contexte `WORKER` / `ntf_sender` ; rend l'adresse et le numéro **seulement s'ils sont vérifiés**, la langue et le prénom (nom d'affichage, sinon prénom légal) d'un compte `ACTIVE` ou `RESTRICTED` non pseudonymisé. Ajoutée à la liste blanche RLS-15.
8. **Journal d'envoi sans contenu.** `core.ntf_notification_dispatch` (migration 0029) : RLS ENABLE + FORCE ; app_worker seulement (création par `ntf_dispatcher` ou, pour un repli, `ntf_sender` ; avancement par `ntf_sender` depuis `QUEUED` seulement) ; colonnes bornées par GRANT ; ni adresse, ni numéro, ni prénom, ni texte ; empreinte SHA-256 du texte rendu ; `last_error` limité à un code court par contrainte. Écarts à 17 §3.2.12 : colonnes `event_type`, `country_code`, `correlation_id`, `recipient_role`, `variables`, `locale`, `last_error`, `fallback_of`.
9. **Contrat de charge utile.** Les producteurs ajoutent les identifiants des destinataires (`guest_user_id`, `host_user_id`, `user_id`) et les champs non sensibles listés dans `ntf/internal/README.md`. Un champ absent est une erreur de contrat : la tâche part en lettre morte avec alerte, jamais un message incomplet.

## Alternatives écartées

- **Droit `SELECT` d'`app_worker` sur des colonnes d'`iam_user_account`** : plus simple, mais ouvre les coordonnées de tous les comptes à tout travailleur nommé capable de poser son contexte, et contredit les invariants testés d'US-010 / US-011 (« aucune colonne IAM pour app_worker »).
- **Coordonnées copiées dans la charge utile ou dans `notification_dispatch`** : données C2 dans l'outbox (interdit, 17 §4.1) ou dupliquées dans un journal conservé 13 mois.
- **Envoi dans le consommateur, réessais par le `JobRunner`** : l'appel externe aurait lieu dans la transaction du reçu, et les 5 tentatives du BUS (17 §4.2) ne sont pas les 3 réessais de 17 §2.13 ; le compteur `attempts` de l'envoi ne survivrait pas au ROLLBACK.
- **Tables `notification_template` / `notification_rule` dès maintenant** : aucune édition ADMIN dans cette story ; une table recopierait les textes de `@rueda/i18n` et perdrait le contrôle de parité au typecheck.

## Conséquences

- `apps/api/tsconfig.build.json` passe `allowImportingTsExtensions` et `rewriteRelativeImportExtensions` : l'API compilée importe `@rueda/i18n` (sources `.ts`), chargé à l'exécution par Node 26 (suppression des types) ; vérifié par `pnpm build` puis import du module compilé.
- Ajouter un gabarit = clés es / en / fr + entrée `TEMPLATES` + règle ; les tests de parité et de rendu le couvrent sans test nouveau.
- Les accusés de remise (`DELIVERED`, `BOUNCED`), les préférences (`notification_preference`, marketing seulement), la limitation de débit, les rappels J−1 / H−2, la purge à 13 mois et le câblage de `worker.ts` (US-003) restent à faire.
- Un fournisseur réel (lot C) implémente le même port ; la garde C19 garantit qu'aucun FAKE n'est actif en production.

## Reports à faire (orchestrateur)

17 §2.13 (3 tentatives par envoi, une tâche par tentative, repli sans second repli), §3.2.12 (catalogue en code pour la bêta ; colonnes ajoutées à `notification_dispatch`), §4.5 (contrat de charge utile des événements consommés par NTF ; charge utile de `notification.*`), §8.1 (ADR-061) ; 10b §4.3 (clés `ntf.*` en es, en, fr, PROPOSÉES) ; 17 §1.4 (locale `fr` des notifications, déjà signalée par US-014).
