# ADR-120 — Portabilité : services de l'hébergeur derrière des ports, export logique et séquestre des clés

- **Statut** : PROPOSÉ (US-036, agent architecture, claude-opus-5-5, 2026-11-14). Revues exigées par `review-requirements.json` : code, architecture, sécurité (story), sur un autre modèle que l'auteur. Numéro réservé par l'orchestrateur.
- **Sources** : 19 US-036 ; 17 §6.1 (pile, « Stockage objet », « Secrets », « Hébergement »), §6.4 (sauvegardes, « Secrets et clés »), §3.1.3 points 1, 2 et 9, §3.2.13 (`subject_key`, `file_asset`) ; ADR-006 (hébergement), ADR-026 et ADR-051 (clés par sujet), ADR-078 et ADR-084 (déploiement, autorité TLS), ADR-080 et ADR-082 (sauvegardes, restauration testée) ; Q-007 (hébergeur, au fondateur) ; pré-mortem L1-PM-34 ; passation US-003 « Reste » point 3.

## Contexte

Le fondateur veut pouvoir changer d'hébergeur et récupérer toutes ses données. Trois choses lient une plateforme à un hébergeur : du code qui appelle ses services propriétaires, des données dans un format qu'il est seul à lire, et des clés de chiffrement qui ne sortent pas de son KMS. Les DEK par sujet (crypto-shredding, ADR-051) sont enveloppées par la clé maîtresse du KMS : sans procédure, changer d'hébergeur rendrait illisibles toutes les données C2 / C3 chiffrées. L'hébergeur n'est pas choisi (Q-007).

## Décision

1. **Ports, adaptateur local, alternative nommée.** Chaque service de l'hébergeur (base, stockage objet, KMS, coffre, files, courriel, antivirus, exécution des conteneurs, IaC, TLS, sauvegardes, supervision) est inventorié dans `docs/ops/PORTABILITY.md` §1 avec son port, son adaptateur local, son FAKE, le défaut PROPOSÉ et des alternatives nommées. Files et minuteries restent dans PostgreSQL (pg-boss) : aucun service de file à porter.
2. **Code neutre, prouvé.** `apps/` et `packages/` n'importent aucun SDK de fournisseur et ne contiennent aucune constante de fournisseur (hôte de service, ARN, code de région) ; `provider-neutral.test.ts` balaie les fichiers suivis et échoue sinon (témoins compris). Les adaptateurs de l'hébergeur vivent dans `infra/`, `docker/` et `scripts/deploy/`, hors du balayage, et sont inventoriés.
3. **Adaptateurs locaux** (`packages/db/src/portability/`) : `LocalKeyWrapper` (AES-256-GCM, clé maîtresse 32 octets lue dans un fichier, AAD liée au sujet et à la clé ; identifiant public = empreinte tronquée), **refusé en production** et si `RUEDA_ENV` est absente ou inconnue ; `FsFileStore` (objet = fichier, création seule par lien physique exclusif, aucune clé hors de la racine). Ce ne sont pas des FAKE : deux processus qui lisent la même clé déroulent les mêmes enveloppes, ce qui permet l'exercice inter-processus.
4. **Base : export logique standard.** `pg_dump` format custom (lisible par tout PostgreSQL 16), **sans** les données de `core.audit_subject_key` (contrôle fail-closed sur la liste de l'archive). Import par sections : `pre-data`, `data`, clés, `post-data` ; les triggers de garde et les clés étrangères de `file_asset` vers `subject_key` arrivent avec `post-data`, après les clés. Sous le rôle d'administration de l'instance (outil d'exploitation, comme `pg_dump`), jamais sous un rôle applicatif ; la base importée est vérifiée par la CLI de restauration (ADR-082 : rôles sans `BYPASSRLS`, RLS `FORCE`, L0-05, chaîne d'audit, C12, argent).
5. **Clés : séquestre du fondateur.** À l'export, chaque DEK vivante est déroulée par le KMS de l'ancien hébergeur et ré-enveloppée pour la clé **publique** de séquestre (RSA-OAEP-SHA-256, 3 072 bits au moins ; étiquette OAEP liée au sujet et à l'empreinte de la clé). La plateforme et la CI n'ont jamais la clé privée ; le fondateur la fournit le temps de l'import, qui ré-enveloppe chaque DEK par le KMS du **nouvel** hébergeur, en une transaction, table vide exigée, relecture vérifiée. Une clé détruite reste détruite. Aucune migration : l'import INSÈRE les lignes (le trigger de 0016 n'interdit que la modification), et aucune fonction `SECURITY DEFINER` n'est ajoutée.
6. **Fichiers** : chaque objet du registre `file_asset`, octet pour octet (C2 / C3 restent chiffrés), manifeste SHA-256, recopie idempotente vérifiée. Un objet sans ligne `file_asset` n'est pas exporté.
7. **Exercice en CI.** `scripts/ops/portability-drill.sh`, à la fin du job « reprise » : deux instances PostgreSQL 16, les blocs du runbook exécutés tels qu'écrits, comparaison sous les rôles de production (base, catalogue, lignes par pays, isolement PA / PY par un ADMIN de chaque pays, fichiers relus avec la clé de la cible, absence de secret et de DEK en clair dans l'export et dans la sortie).
8. **Adaptateurs réels** (KMS, stockage objet, coffre) : pas dans cette story. Ils supposent l'hébergeur (Q-007) ; l'outil refuse tout nom d'adaptateur inconnu (fail-closed) et l'API reste en `Unavailable*` (503). Ils arrivent avec le choix de l'hébergeur, avant le premier déploiement cloud (la passation d'US-003 les attribuait à US-036 : report tracé).

## Conséquences

- Changer d'hébergeur = un runbook exécutable, prouvé à chaque PR, sans dépendance au format ni au KMS de l'ancien hébergeur. Le RTO réel dépend du volume (mesure : US-112).
- L'export contient des données personnelles en clair (colonnes non chiffrées) : il se traite comme la base de production (jamais en artefact, transfert chiffré, destruction après bascule).
- Le rôle d'administration doit lire malgré la RLS (superutilisateur ou `BYPASSRLS` d'administration) ; un service géré qui ne l'offrirait pas exigerait une autre voie (à vérifier au choix de l'hébergeur).
- Le paquet d'autorité TLS de la base (ADR-084) est propre à l'hébergeur : le changer = remplacer le fichier et sa somme.
- Le job « reprise » dure plus longtemps (deux instances de plus, une préproduction peuplée de plus).

## Alternatives écartées

- **Clé maîtresse importée dans le KMS (« apportez votre clé »)** : les enveloppes d'un KMS géré restent dans son format propriétaire et ne s'ouvrent pas ailleurs, même avec la même matière de clé ; ne règle pas la portabilité.
- **Double enveloppe à la création** (KMS + séquestre stockés en base) : exige une colonne et une migration, et garde en ligne, pour toujours, une copie de chaque DEK chiffrée pour une clé hors de contrôle de la plateforme ; le séquestre à l'export suffit.
- **Commande de ré-enveloppe `SECURITY DEFINER`** (mise à jour de `subject_key` en place) : ouvrirait une modification aujourd'hui interdite par le trigger de 0016 ; l'insertion entre `data` et `post-data` évite toute nouvelle surface.
- **Copie physique (`pg_basebackup`)** : liée à la version et à l'hébergeur ; c'est l'outil de la restauration dans le même hébergeur (ADR-082), pas de la portabilité.
- **Adaptateurs AWS dès maintenant** : présumerait Q-007 ; écarté (CLAUDE.md contrainte 7).
