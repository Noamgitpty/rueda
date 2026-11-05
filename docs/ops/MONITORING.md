# Runbook — supervision et alertes (US-004)

Décision : [ADR-080](../adr/ADR-080-sauvegardes-supervision-journal-acces.md). Code : `apps/api/src/modules/bus/internal/alert-channel.ts`, `ops-monitor.ts` ; `infra/opentofu/modules/environment/monitoring.tf` ; migration 0051 (`core.ops_monitor_metrics`).

Une alerte ne contient **que des comptes et des codes** (17 §6.3) : jamais un nom, un courriel, un téléphone ni un identifiant d'objet. Pour enquêter, on lit les tables sous les rôles prévus (console, travailleurs), jamais en copiant des données dans une alerte.

## Chaîne d'une alerte

1. L'application appelle le port `AlertChannel` (contrôle `assertSafeAlert`).
2. En production, `LogAlertChannel` écrit `{"event":"ops.alert","code":…,"severity":"P1"|"P2","counts":{…},"labels":{…}}` sur la sortie d'erreur du travailleur.
3. Un filtre de métrique par sévérité (`<préfixe>/<environnement>`, `OpsAlertsP1`, `OpsAlertsP2`) alimente une alarme, qui publie sur le sujet chiffré `<préfixe>-<environnement>-alerts`.
4. Le fondateur reçoit le courriel (abonnement `alert_email`). Hors de la plage du support, le mode dégradé de 17 §6.4 s'applique.

## Alertes de l'application (travailleur `ops_monitor`, toutes les 60 s)

| Code                    | Sévérité | Déclenchement (PROPOSÉ)                                            | Premier geste                                                                                                                                                            |
| ----------------------- | -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPS_WEBHOOK_FAILING`   | P1       | ≥ 1 webhook PSP QUARANTINED / FAILED après 3 passages en échec     | étiquette `provider` ; vérifier que l'opération existe ; rejouer après correction (16 ADM-032)                                                                           |
| `OPS_PAYMENT_UNKNOWN`   | P1       | opération `UNKNOWN` depuis plus de 30 min (par pays)               | balayage `payment_intent_sweeper` / lecture PSP (lot C) ; ne jamais conclure sans lecture du PSP                                                                         |
| `OPS_OUTBOX_STALE`      | P1       | événement non publié depuis plus de 120 s                          | travailleur en marche ? relais en erreur ? (journaux `bus.metrics`)                                                                                                      |
| `OPS_P1_EVENT`          | P1       | alerte P1 écrite dans l'outbox (étiquette `event_type`)            | `booking.alert.production_oracle` : rapport C12 ; `invariant_violation`, `disposition_overdue` : ADR-065 ; `notification.sms_cap.reached` : plafond SMS du pays (US-052) |
| `OPS_WEBHOOK_SIGNATURE` | P2       | signature de webhook invalide depuis la passe précédente           | secret de webhook tourné ? tentative d'usurpation ? (compter, ne rien rejouer)                                                                                           |
| `BUS_DEAD_LETTER`       | P1       | tâche passée en lettre morte (étiquettes `consumer`, `error_code`) | lire `outbox_dead_letter` ; corriger ; rejouer (console, story à venir)                                                                                                  |

## Rapprochement de l'argent (travailleur `reconciliation`, toutes les 24 h)

| Code                       | Sévérité | Déclenchement                                                                                                                                                              | Premier geste                                                                                                                                                                                                                                                                            |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FIN_MONEY_RECONCILIATION` | P1       | au moins un écart d'un contrôle de rapprochement (règlements, remboursements, jambes, soldes par jambe), une alerte par pays (étiquette `country`, un compte par contrôle) | bogue S1 ; geler les ordres du pays concerné jusqu'à l'analyse FIN ; lire les règlements sous le rôle FINANCE ; contrôles et sources : [ADR-087](../adr/ADR-087-regression-nocturne-rapprochement-tableau-qa.md) et `apps/api/src/modules/fin/internal/money-reconciliation.ts` (US-047) |

Une jauge (trois premières lignes) n'alerte qu'au dépassement, si la valeur monte, puis toutes les 30 min tant qu'elle reste au-dessus du seuil.

## Alarmes de santé (hébergeur)

| Alarme                    | Seuil (PROPOSÉ)                          | Données absentes |
| ------------------------- | ---------------------------------------- | ---------------- |
| `…-worker-heartbeat`      | aucune ligne `bus.metrics` en 5 min      | alarme           |
| `…-api-healthy-hosts`     | aucune tâche saine pendant 3 min         | alarme           |
| `…-api-5xx`               | ≥ `api_5xx_threshold` (10) en 5 min      | normal           |
| `…-api-latency-p95`       | p95 > 0,8 s pendant 15 min (17 §6.7)     | normal           |
| `…-db-cpu`                | > 80 % pendant 15 min                    | alarme           |
| `…-db-free-storage`       | < 2 Gio                                  | alarme           |
| `…-backup-failed` (règle) | échec de sauvegarde, copie, restauration | —                |

## Vérifier la chaîne sans incident

- Code : `pnpm --filter @rueda/api exec vitest run src/modules/bus` (port, moniteur, FAKE) ; `pnpm --filter @rueda/api test:int` (`test/int/ops-monitor.int.test.ts` : webhook en échec 3 fois ⇒ alerte) ; `pnpm --filter @rueda/db test:l0` (`l0-us004-ops-monitor`).
- Infrastructure : `tofu test` dans `infra/opentofu/modules/environment`.
- Après le premier `apply` (fondateur) : `aws cloudwatch set-alarm-state --alarm-name <préfixe>-<env>-ops-alert-p2 --state-value ALARM --state-reason test` doit produire un courriel.

## Journal d'accès aux données personnelles

Chaque lecture C3 par le staff passe par `core.iam_staff_cmd_data_access` (ligne `data_access_log` + ligne chaînée `STAFF_DATA_ACCESS`). Revue hebdomadaire (17 §2.3) : lire le journal par la console (`GET /staff/audit`, rôle ADMIN du pays) et vérifier que chaque `BREAK_GLASS` a un dossier motivé.
