# Plan de reprise après sinistre (US-112)

Décision : [ADR-121](../adr/ADR-121-reprise-et-registre-des-incidents.md) (PROPOSÉ). Objectifs : [`recovery-objectives.json`](recovery-objectives.json), source unique, rejoués par l'exercice de la CI. Procédures techniques : [BACKUP_RESTORE.md](BACKUP_RESTORE.md) (restaurer, exercer), [SECRET_ROTATION.md](SECRET_ROTATION.md), [DEPLOY.md](DEPLOY.md). Incident de sécurité ou violation de données : [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md), à ouvrir **en même temps** si des données ont pu fuir ou être altérées par un tiers.

**Aucun agent n'exécute ce plan en production** : il n'a ni compte, ni accès, ni secret (OPERATING_RULES §1). Le fondateur l'exécute avec ses propres accès. Un agent prépare, lit les journaux et rédige avec lui.

## 1. Objectifs (PROPOSÉS, À DÉCIDER par le fondateur)

| Scénario (clé du fichier)                                        | RPO (perte de données au pire) | RTO (temps de reprise, heures couvertes) | Comment                                                                    | Exercé                              |
| ---------------------------------------------------------------- | ------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------- |
| Erreur récente : donnée corrompue, migration fautive (`instant`) | 15 min                         | 4 h                                      | restauration à un instant donné (journaux de transactions du service géré) | chaque PR et chaque nuit (A)        |
| Perte de l'instance ou de la zone (`latest`)                     | 15 min                         | 4 h                                      | bascule Multi-AZ ; sinon restauration au plus récent des journaux          | chaque PR et chaque nuit (B)        |
| Perte du compte ou de la région (`region`)                       | 24 h                           | 8 h                                      | copie quotidienne dans le compte de sauvegarde, autre région               | exercice cloud du fondateur (Q-009) |
| Photos, preuves, PDF (`files`)                                   | 24 h                           | 8 h                                      | versionnage des compartiments, sauvegarde quotidienne                      | exercice cloud du fondateur (Q-009) |

Exigence de 17 §6.4 : RPO 24 h, RTO 8 h ; un objectif ne la dépasse jamais (contrôle `packages/db/src/restore/objectives.ts`). **Heures couvertes** : la plage du support (SUP-020, par exemple 8 h–20 h, heure du pays). Hors plage, le mode dégradé du § 4 s'applique, réponse au mieux : le RTO court à partir du début de la plage suivante.

Les objectifs ne demandent aucune dépense de plus que les défauts déjà appliqués : journaux du service géré, Multi-AZ (coût accepté par 17 §6.4), copie hors compte (Q-008). Les choix qui coûtent restent au fondateur : compte de sauvegarde et région de la copie (Q-008), exercice cloud mensuel (Q-009).

## 2. Rôles

| Rôle                            | Qui                                        | Fait                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Détection et premier diagnostic | agent d'exploitation (agent orchestrateur) | lit l'alerte (`MONITORING.md`), les tableaux de bord et les journaux ; qualifie le scénario (§ 3) ; ouvre la note d'incident `docs/team/incidents/AAAA-MM-JJ-<code>.md` ; prépare les commandes ; ne touche jamais à la production |
| Décision et exécution           | **fondateur** (seul humain, astreinte)     | décide de restaurer, de basculer ou de rouvrir ; exécute avec ses accès ; envoie les communications                                                                                                                                |
| Responsable des données         | fondateur (ADMIN ou SUPERADMIN)            | si des données personnelles sont en cause : déclaration au registre et notifications (INCIDENT_RESPONSE.md)                                                                                                                        |
| Relecture                       | agent de revue (sécurité)                  | relit le post-mortem et les correctifs                                                                                                                                                                                             |

Contact humain unique : le fondateur (alerte par courriel du sujet des alertes ; SMS en attente, Q-008 e). Aucun autre humain n'a d'accès.

## 3. Arbre de décision

1. **L'API répond-elle ?** Non : instance, zone ou région (§ 3.2, § 3.3). Oui : suite.
2. **Des données sont-elles fausses ou perdues ?** (oracle C12, invariants d'argent, alerte `FIN_MONEY_RECONCILIATION`, signalement) Oui : erreur récente (§ 3.1). Non : incident applicatif, correction par déploiement (DEPLOY.md), pas de restauration.
3. **Un tiers a-t-il pu lire, copier ou modifier des données ?** Oui : ouvrir **aussi** INCIDENT_RESPONSE.md (registre, délai de 72 h PROPOSÉ).

### 3.1 Erreur récente (`instant`)

Fermer d'abord les écritures fautives (déploiement précédent, `DEPLOY.md` « retour arrière »), puis restaurer à l'instant juste avant l'erreur dans une **nouvelle** instance, vérifier, basculer : [BACKUP_RESTORE.md « Erreur récente »](BACKUP_RESTORE.md). Les écritures légitimes d'après l'instant choisi sont perdues : en dresser la liste depuis l'ancienne instance (gardée, en lecture seule) avant de la détruire, et les rejouer par les commandes, jamais par une écriture directe.

### 3.2 Perte de l'instance ou de la zone (`latest`)

La bascule Multi-AZ est automatique (quelques minutes) : surveiller les alarmes, vérifier (`node packages/db/src/restore/cli.ts`), noter l'incident. Sans bascule : restaurer au plus récent des journaux, vérifier, basculer (même runbook).

### 3.3 Perte du compte ou de la région (`region`)

[BACKUP_RESTORE.md « Perte du compte ou de la région »](BACKUP_RESTORE.md) : point le plus récent du coffre de copie, environnement recréé depuis le dépôt, secrets re-saisis (SECRET_ROTATION.md), même empreinte d'image. Jusqu'à 24 h de données perdues : paiements et réservations de cet intervalle à rapprocher avec le PSP (rapprochement nocturne, une fois le PSP réel branché au lot C).

## 4. Ordre de reprise et mode dégradé

1. **Geler** : aucune nouvelle réservation tant que la base, l'outbox ou les webhooks sont en panne depuis plus de 30 min (mode dégradé de 17 §6.4) ; les holds en cours expirent d'eux-mêmes. Les interrupteurs de mise en service (`payouts_enabled`, etc.) ne se touchent jamais pendant une reprise : ils changent par la seule commande à deux personnes (17 v6).
2. **Base** : restaurer, puis `restore/cli.ts` : rôles, RLS ENABLE + FORCE, migrations, environnement déclaré, L0-05, chaîne d'audit, oracle C12, invariants d'argent, occupations. Code 1 : ne pas basculer.
3. **Secrets** : vérifier ceux du nouvel environnement ; en cas de doute de compromission, tourner (SECRET_ROTATION.md) **avant** la réouverture.
4. **Application** : bascule (`PGHOST`, nouvelle révision), API puis travailleur ; surveiller les alarmes 30 min.
5. **Fichiers** : restaurer les compartiments si touchés ; empreintes vérifiées (`verifyFileAsset`).
6. **Rouvrir** les réservations ; rapprocher l'argent (travailleur `reconciliation`, puis le PSP au lot C).
7. **Mesurer** RPO (instant restauré → dernière écriture rendue) et RTO (début → API saine), les consigner dans la note d'incident et dans BACKUP_RESTORE.md « Mesures ».

## 5. Communication (gabarits, quatre langues)

Messages courts, sans donnée personnelle, envoyés par le fondateur (page d'état, courriel, WhatsApp selon les canaux ouverts). Textes : [`docs/legal/notificacion-violacion-datos-borrador.md`](../legal/notificacion-violacion-datos-borrador.md) § « Interruption de service » (es, en, fr, pt-BR). Ordre : voyageurs et hôtes ayant un trajet dans les 48 h (remise ou retour), puis tous. Rappel utile : la remise et le retour se font entre personnes ; un trajet en cours continue, l'hôte et le voyageur gardent leurs coordonnées du trajet.

## 6. Retour au service et rapport

Note d'incident `docs/team/incidents/AAAA-MM-JJ-<code>.md` : chronologie (UTC), scénario, RPO et RTO mesurés contre les objectifs, données perdues ou rejouées, communications, causes, actions. Post-mortem par incident (17 §10) relu par l'agent de sécurité ; actions en stories.

## 7. Exercices

- **Local**, à chaque PR et chaque nuit (job « reprise ») : scénarios A et B, échec au-delà de l'objectif du scénario ou de dix fois la référence (ADR-082).
- **Cloud**, chaque mois et avant l'ouverture, par le fondateur (Q-009) : scénario `region` ; rapport dans `docs/team/incidents/`.
- **Revue du plan** : à chaque porte de lot et après chaque incident réel.
