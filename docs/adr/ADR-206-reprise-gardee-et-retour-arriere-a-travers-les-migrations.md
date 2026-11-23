# ADR-206 — Reprise gardée après une restauration, et retour arrière éprouvé à travers de vraies migrations

- **Statut** : PROPOSÉ (US-402 ; agent de story, rôle donnees, claude-opus-5-5, 2026-11-23). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` (code, architecture, sécurité, qa), plus la revue **argent** demandée par l'orchestrateur : la revue argent du pré-mortem classe L4-PM-19 en critique. Les revues argent, RLS / rôles, `SECURITY DEFINER` et concurrence se font sur un autre modèle que l'auteur.
- **Complète** : ADR-082 (exercice de restauration chronométré, US-051), ADR-121 (objectifs RPO / RTO, US-112), ADR-078 et ADR-081 (déploiement réversible, expand / contract).
- **Sources** : 19 US-402 ; 16 ADM-034, ADM-035 ; 17 §6.4, §6.5 ; pré-mortem du lot 4 (`docs/team/gates/L4/premortem.md`) : L4-PM-16 à L4-PM-20, RT-L4-E01 ; 17 §2.8 et 08 E4 (clés d'idempotence déterministes, lecture avant renvoi) ; N-420 (rapprochement réel, lot C).

## Contexte

1. **L4-PM-19 (critique)** : une base restaurée à un instant T ne sait rien de ce qui a été exécuté chez le PSP après T, ni de ce qui a été envoyé. Jusqu'ici, la bascule redémarrait le travailleur aussitôt. L'outbox et les files rejouaient alors ce qui attendait à T. Les processus métier recréaient aussi ce qui avait été perdu. Le risque : un double débit, un double versement, un avis envoyé deux fois. Le cas le plus dur est une commande **exécutée au PSP après T mais absente de la base restaurée**. Seul le PSP peut la révéler.
2. **L4-PM-17** : le retour arrière répété par la CI (US-003) servait une image A et une image B **construites sur le même code**. Il n'avait jamais traversé une migration.
3. **L4-PM-16** : les mesures RTO / RPO viennent du banc de la CI. Elles ne doivent pas passer pour des mesures de production.

## Décision

1. **Garde de reprise en base (migration 0185)**. Tant que la garde est active, `core.outbox_claim_jobs` ne rend **aucune tâche**. Aucun travailleur n'émet donc rien : commandes d'argent (débits, remboursements, débits MIT, libérations de jambe), versements, avis, files périodiques, traitement des webhooks. L'outbox et les tâches restent intactes, en attente. Le corps de la fonction est inchangé par ailleurs, et elle reste SECURITY INVOKER.
   - **Détection automatique** : PostgreSQL change de ligne de temps (timeline) à chaque promotion d'une instance restaurée. La ligne de temps attendue est enregistrée par la migration, puis à chaque levée. Si la ligne de temps courante diffère de l'attendue, ou si elle est illisible, la garde est active (fail-closed).
   - **Garde explicite** : `platform.recovery_place_hold(motif)`, exécutable par `app_worker`. Elle sert pour une restauration logique, qui ne change pas la ligne de temps. Elle ne fait qu'arrêter des émissions : c'est le sens fail-closed.
   - **Levée** : `platform.recovery_release(note)`, sous `migrator` seulement, par l'outil `packages/db/src/restore/release-cli.ts`. Aucun rôle applicatif ne lève la garde, et aucun ne lit ni n'écrit ses tables. Les gardes sont en ajout seul : une garde est posée une fois et levée une fois, sans suppression ni troncature.
2. **Levée conditionnée au rapprochement et à la fenêtre d'idempotence (hypothèse H-IDEM)**. `releaseDecision` est une fonction pure, testée.
   - La levée est refusée tant que le rapprochement avec le PSP n'est pas attesté. En bêta, ce PSP est `FAKE`. La lecture réelle de chaque opération arrive au lot C (N-420).
   - Ensuite, il faut **soit** un relevé complet des opérations du PSP depuis T, rapproché, **soit** (levée − T) + 1 h < W.
   - **H-IDEM**, hypothèse PROPOSÉE : le PSP déduplique une même clé pendant au moins W = 24 h. Cette capacité est à déclarer à la porte go / no-go du PSP ; inconnue, elle vaut 0, donc refus.
   - Pourquoi cette condition : une commande perdue est recréée avec la **même** clé, parce que les clés sont déterministes (08 E4). Le PSP la reconnaît tant que la clé est dans sa fenêtre. Au-delà, seul le relevé du PSP garantit qu'il n'y aura pas de second effet.
3. **Rapprochement = lecture d'abord**. Aucune commande d'argent en vol n'est renvoyée sans lecture du PSP : c'est le chemin existant du `MoneyCommandSender` pour `UNKNOWN` / `SUBMITTED`, et pour `PENDING` sans en-tête d'idempotence validé. La vérification de la base restaurée (`restore/cli.ts`) affiche l'état de la garde et l'inventaire de ce qui attend : comptes seulement, aucune donnée personnelle, aucun montant.
4. **Retour arrière à travers de vraies migrations**. La répétition de la CI (`scripts/deploy/rehearsal.sh`, étape 6) construit l'image N−1 depuis son commit (`docs/ops/rollback-reference.json` : main avant 0184). Elle la déploie, puis déploie N, qui ajoute au moins une migration. Le retour arrière manuel ressert ensuite N−1 **sur le schéma N**, sans migration descendante. Enfin, la répétition rejoue le job de base de N (rien à appliquer) et redéploie N.
5. **Mesures nommées**. Le rapport de restauration (`docs/ops/RESTORE_REPORT.md`) dit où chaque mesure a été prise : banc de CI, conteneur PostgreSQL 16 sur un runner GitHub. Il les compare à la référence et aux objectifs PROPOSÉS. Il liste aussi ce qui n'a pas été mesuré : préproduction en nuage, copie entre comptes et entre régions, production.

## Conséquences

- Une restauration ne réémet rien tant que l'exploitation n'a pas rapproché et levé la garde. Le RTO « service rétabli » comprend donc le rapprochement : c'est voulu. Le RTO mesuré par la CI s'arrête, lui, à l'API saine.
- Une bascule Multi-AZ RDS (réplication par blocs, même ligne de temps) ne lève pas la garde. Une promotion de réplica ou une restauration la lève : la levée se fait à la main. Ce comportement est à confirmer en préproduction (EN ATTENTE).
- Pendant la garde, l'API peut servir. Une nouvelle commande initiée par l'API (paiement hébergé d'une nouvelle réservation) n'est pas un rejeu. Les réservations restent pourtant gelées tant que la reprise n'est pas close (DISASTER_RECOVERY.md §4).
- **Limites** : le relevé du PSP et le rapprochement C12 contre le PSP réel restent au lot C (N-420). W n'est qu'une hypothèse tant que le PSP n'est pas choisi. La levée en cloud suppose que l'outil tourne sous `migrator` (EN ATTENTE de la préproduction).

## Retour arrière de cette décision

Une migration corrective remet le corps de 0013 dans `core.outbox_claim_jobs`, puis supprime les fonctions et les tables `platform.recovery_*`. Aucune donnée métier n'est touchée. Il faut aussi retirer l'étape 6 de `rehearsal.sh`.
