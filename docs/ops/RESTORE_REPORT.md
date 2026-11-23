# Rapport de restauration et de retour arrière (US-402, ADM-034 / ADM-035)

> Critère d'US-402 : « un rapport de restauration avec RPO et RTO mesurés existe et un retour arrière a été exécuté au moins une fois ». Ce rapport dit **où** chaque preuve a été produite (L4-PM-16). Il sépare ce qui est prouvé sur le banc de la CI de ce qui reste **EN ATTENTE** d'une préproduction, d'un compte en nuage ou d'une décision du fondateur. Rien n'est simulé ici en le donnant pour fait.

## 1. Environnement mesuré

| Preuve                     | Où                                                                                                                                                                                     | Ce que ce n'est PAS                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Restauration chronométrée  | job CI « reprise — restauration chronométrée » : PostgreSQL 16 en conteneur sur un runner GitHub (`ubuntu-latest`), journaux archivés localement, quelques milliers de lignes PA et PY | ni RDS, ni AWS Backup, ni le volume de la production ; aucune copie entre comptes ni entre régions |
| Garde de reprise (ADR-206) | même job : instance restaurée (nouvelle ligne de temps) ; tests d'intégration sous les rôles de production                                                                             | aucun PSP réel : rapprochement contre `FAKE` seulement                                             |
| Retour arrière             | job CI « déploiement local » : image de production, préproduction locale (`infra/local/compose.yaml`)                                                                                  | ni ECS, ni l'environnement GitHub `production`                                                     |

## 2. RPO et RTO mesurés, répétés, comparés à la référence

Référence (`docs/ops/restore-drill-baseline.json`, US-051) : RTO 2,87 s, RPO 6,57 s. Seuil de régression de l'exercice : 10 × la référence + 60 s. Objectifs PROPOSÉS (`recovery-objectives.json`, US-112, ADM-035 **À DÉCIDER** par le fondateur) : RPO ≤ 15 min et RTO ≤ 4 h pour les scénarios `instant` et `latest`. Exigence de 17 §6.4 : RPO 24 h, RTO 8 h.

Mesures relevées dans les journaux des six derniers runs verts de `main` (job « reprise », rapport JSON imprimé), le 2026-11-23 :

| Run CI      | Commit     | A : instant T, RPO | A : RTO | B : perte de l'instance, RPO | B : RTO | Comparaison                                 |
| ----------- | ---------- | ------------------ | ------- | ---------------------------- | ------- | ------------------------------------------- |
| 45196021804 | `ed16b711` | 0,18 s             | 3,03 s  | 6,90 s                       | 3,02 s  | objectifs tenus ; RTO ≤ 1,06 × la référence |
| 45223483538 | `5da56c99` | 0,17 s             | 4,03 s  | 7,88 s                       | 2,96 s  | objectifs tenus ; RTO ≤ 1,41 × la référence |
| 45227836268 | `1f69954f` | 0,17 s             | 4,05 s  | 7,91 s                       | 3,02 s  | objectifs tenus ; RTO ≤ 1,42 × la référence |
| 45246520917 | `a7d47bd9` | 0,17 s             | 4,59 s  | 8,50 s                       | 4,10 s  | objectifs tenus ; RTO ≤ 1,60 × la référence |
| 45251267284 | `9f090566` | 0,05 s             | 2,70 s  | 6,47 s                       | 2,64 s  | objectifs tenus ; RTO ≤ 0,95 × la référence |
| 45252463172 | `8f54e2ad` | 0,12 s             | 4,41 s  | 8,38 s                       | 3,90 s  | objectifs tenus ; RTO ≤ 1,54 × la référence |

Lecture : le RPO du scénario B reste borné par `archive_timeout` (30 s). Le RTO varie de 2,6 à 4,6 s selon le runner, très loin du seuil de régression (88,7 s). Ces durées mesurent la **procédure** sur une petite base. Elles ne disent rien du volume ni du réseau de la production.

## 3. Une restauration ne rejoue rien (L4-PM-19, RT-L4-E01)

- **Restauration réelle** (`packages/db/test/drill/restore-drill.test.ts`, étape 3). Une tâche est due avant T. Après la restauration à T, la ligne de temps change, la garde est active et le rapport de vérification le dit. Le travailleur démarré par la bascule ne réclame **aucune** tâche : nombre de tâches touchées inchangé, tâche de l'exercice non réclamée. La levée par le runbook (`exercice-levee`) remet la ligne de temps attendue, et la tâche est alors réclamée une fois. Le scénario B (au plus récent) donne lui aussi une garde active.
- **Débits, en PA (USD) et en PY (PYG)** (`apps/api/test/int/us402-reprise-sans-rejeu.int.test.ts`). A est enregistrée avant T et envoyée après T ; B est enregistrée et exécutée après T, donc absente de la base restaurée. Après la restauration (émulée par un point de sauvegarde annulé), rien n'est réclamé. Le rapprochement retrouve A au PSP par notre clé, sans second débit. B est recréée avec sa clé déterministe : retrouvée par lecture, ou dédupliquée par le PSP dans sa fenêtre. Le PSP n'a que deux effets, aux jambes explicites.
- **Fenêtre d'idempotence bornée** (`packages/db/src/restore/recovery.test.ts`) : levée refusée sans rapprochement attesté, refusée si W est inconnue, refusée si (levée − T) + 1 h ≥ W (hypothèse W = 24 h) sauf avec un relevé complet du PSP.
- **Garde en base** (`packages/db/test/int/us402-recovery-hold.test.ts`) : garde posée ⇒ aucune tâche réclamée, même due. Seul `app_worker` pose une garde ; aucun rôle applicatif ne la lève.

## 4. Retour arrière exécuté

- **Version défectueuse** : retour arrière automatique. **Version saine** : retour arrière manuel (US-003, étapes 3 et 4 de `rehearsal.sh`, à chaque push).
- **À travers de vraies migrations** (étape 6, US-402, L4-PM-17). L'image N−1 est `5da56c99` (main avant 0184, dernière migration du lot 3). Elle est déployée, puis N, qui ajoute 0184 et 0185. Le retour arrière manuel ressert N−1 **sur le schéma N**, sans migration descendante : API saine, travailleur en marche, journal `ROLLBACK SUCCEEDED`. Puis N est redéployée.
- **Migrations de contraction** : `pnpm lint:sql` refuse toute contraction non justifiée (`packages/db/expand-contract-allowlist.json`, 39 dérogations, toutes « la version N est inchangée »). Le test `l0-us046-migrations` applique chaque migration sur une base peuplée.

## 5. EN ATTENTE (fondateur / exploitation) — non fait, non simulé

| Élément                                                                                                         | Pourquoi ce n'est pas faisable ici                                                  | Qui                                  |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| Restauration en préproduction cloud (RDS, AWS Backup), volume représentatif, mesure RPO / RTO réelle            | aucun compte en nuage ; amorçage par le fondateur (BACKUP_RESTORE.md)               | fondateur (Q-009), puis exploitation |
| Restauration de la copie **entre comptes et entre régions**                                                     | compte de copie et seconde région non créés                                         | fondateur (Q-008, Q-009)             |
| Retour arrière dans l'environnement GitHub `production` (ECS, porte d'approbation ADR-084)                      | aucune production ; accord du fondateur requis                                      | fondateur, puis orchestrateur        |
| Objectifs RPO / RTO (ADM-035)                                                                                   | décision du fondateur (POUR_LE_FONDATEUR.md §3) ; restent PROPOSÉS                  | fondateur                            |
| Fenêtre d'idempotence W du PSP (H-IDEM) et relevé des opérations depuis T                                       | PSP non choisi ; porte go / no-go ; rapprochement réel N-420                        | fondateur (contrat PSP), lot C       |
| Ligne de temps sur RDS : bascule Multi-AZ sans changement, restauration avec changement ; levée sous `migrator` | vérifiable seulement sur RDS                                                        | exploitation, en préproduction       |
| Fichiers de preuve : recompter les empreintes et les objets après restauration (L4-PM-18)                       | stockage réel non ouvert (verrou objet, L3-PM-04) ; la base seule est restaurée ici | US-405 / exploitation                |
