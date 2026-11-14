# Performance de fumée et résilience — état des lieux (US-045, ADR-119)

Ce document décrit ce que la CI mesure à chaque passage, comment reproduire les chiffres, et l'état au 2026-11-14. Les cibles sont celles de 17 §6.7 (PROPOSÉES), **sans changement** ; seule la pose de C1 en autocommit est un seuil bloquant (ADR-056 point 4), les autres séries sont des **alertes** au tableau de bord QA de la nuit.

## Séries mesurées

| Série                      | Chemin critique                                                                 | Cible (17 §6.7)                        | Nature    | Test                                   |
| -------------------------- | ------------------------------------------------------------------------------- | -------------------------------------- | --------- | -------------------------------------- |
| `pose.c1.autocommit`       | 100 poses concurrentes du même créneau, verrou par véhicule, 5 courses mesurées | création de hold < 300 ms              | bloquant  | `l0-02-concurrency.test.ts`            |
| `pose.c1.transactionnelle` | même course, forme `BEGIN` / `SET LOCAL` / appel / `ROLLBACK` de 17 §2.3        | création de hold < 300 ms              | alerte    | `l0-02-concurrency.test.ts`            |
| `conversion.sequentielle`  | `core.booking_convert_payment` sous `booking_conversion`, transaction complète  | délai webhook → trip `BOOKED` < 10 s   | alerte    | `l0-us024-conversion.test.ts`          |
| `calendrier.sequentielle`  | en-tête et occupations du calendrier de l'hôte (12 blocages), sous `app_api`    | fiche véhicule < 500 ms (côté serveur) | alerte    | `l0-us119-host-calendar.test.ts`       |
| `publication.sequentielle` | `catalog_cmd_submit_listing`, annonce prête, dans la transaction annulée        | aucune cible dans 17 §6.7              | consignée | `l0-us118-listing-publication.test.ts` |

Chaque série tourne en PA (USD) et en PY (PYG), sous les rôles de production (assertion L0-05). Les séries séquentielles écartent 6 appels de chauffe et gardent 40 échantillons ; l'issue de chaque appel est vérifiée (`CONVERTED`, `LISTED`, calendrier exact). Les durées sont prises côté client (aller-retour vu de l'API). C'est une **fumée**, pas une charge : la charge au double du pic (17 §12) reste à faire avec le lot C.

## Reproduire

- Une passe : `RUEDA_PG_TESTCONTAINERS=1 RUEDA_QA_REPORT_DIR=./qa-perf pnpm test:l0` (en CI seulement dans ce projet : aucun PostgreSQL ni Docker local). Lignes `[PERF] {…}` dans le journal, un fichier `qa-perf/perf-<série>-<pays>.json` par série et par pays.
- L'historique par commit de `main`, en lecture seule :
  `node scripts/qa/perf-history.mjs fetch --out <dossier> --limit 40` puis `node scripts/qa/perf-history.mjs build --dir <dossier>` (écrit `perf-history.md` et `perf-history.json`). Le script lit l'artefact `perf-fumee` de chaque run et, pour les runs antérieurs à US-045, les lignes `[L0-02] C1 …` du job `base de données`.
- Attribution : pour chaque série, pays et modèle de processeur, `build` nomme le dernier commit sous la cible et le premier au-dessus. Il ne compare jamais deux machines : le job `guide d'installation` (docker compose) et le job `base de données` (Testcontainers) ne mesurent pas sur le même hôte.

## État au 2026-11-14 : la pose, sur les 39 derniers passages de `main`

Mesure reproduite par `perf-history.mjs` sur les runs de ci.yml du 2026-11-10 (`cc1ef72`) au 2026-11-14 (`57d2db7`) :

| Série                      | Pays | min | médiane | max | ≥ 300 ms | 5 derniers passages     | Marge au dernier passage |
| -------------------------- | ---- | --- | ------- | --- | -------- | ----------------------- | ------------------------ |
| `pose.c1.autocommit`       | PA   | 82  | 159     | 255 | 0 / 39   | 255, 169, 136, 189, 245 | 55 ms (18 %)             |
| `pose.c1.autocommit`       | PY   | 78  | 150     | 251 | 0 / 39   | 222, 173, 182, 201, 251 | 49 ms (16 %)             |
| `pose.c1.transactionnelle` | PA   | 209 | 393     | 609 | 31 / 39  | 556, 453, 408, 485, 609 | −309 ms (alerte)         |
| `pose.c1.transactionnelle` | PY   | 199 | 380     | 599 | 28 / 39  | 544, 441, 355, 475, 599 | −299 ms (alerte)         |

Lecture :

1. **Seuil bloquant tenu sur `main`**, mais la marge fond : les cinq derniers passages (13 et 14 novembre) sont les plus hauts de la série en autocommit (jusqu'à 255 ms) et en forme transactionnelle (jusqu'à 609 ms). Sur des PR de la même semaine, l'autocommit a franchi 300 ms deux fois (310 puis 305 ms) ; la cause, une garde d'auto-réservation sans index, est corrigée par US-103 (PR #138, trois index ; pire cas ensuite 263 ms). Les passages de `main` ne montrent que ce qui a été fusionné vert.
2. **Deux régimes de machine.** À code proche, le p95 autocommit alterne entre ≈ 80 à 110 ms et ≈ 150 à 250 ms (par exemple `d0f1060` 83 ms puis `594e74b` 174 ms, onze minutes plus tard). Les runners GitHub ne sont pas homogènes. Les mesures d'avant US-045 n'ont pas d'empreinte de machine ; depuis US-045, chaque rapport porte le modèle de processeur et le nombre de cœurs, et l'historique ne compare que des mesures de la même machine.
3. **Forme transactionnelle : alerte permanente** (N-16) au-dessus de 300 ms dans 59 passages sur 78 ; elle suit le même régime de machine. La révision de 17 §2.5 est ouverte (note sous le plan de test), le seuil est inchangé.
4. Conversion, calendrier et publication, mesurés pour la première fois par la PR d'US-045 (#141, deux runs, deux machines) : p95 de 9 à 12 ms (conversion, cible 10 s), 5 à 7 ms (calendrier, cible 500 ms), 6 à 8 ms (publication, sans cible). Marge supérieure à 98 % : ces chemins ne sont pas le goulot ; la pose l'est. Détail dans la passation [`docs/team/handoffs/US-045.md`](../team/handoffs/US-045.md).

## Résilience face aux FAKE hostiles

Les FAKE (ADR-032) savent répondre lentement, en erreur, en double, hors d'ordre ou en dépassant le délai. Les tests `resilience-*.test.ts` d'`apps/api` les branchent sur les **vrais consommateurs** :

| Port      | Consommateur                                                     | Cas prouvés                                                                                                                                                                                 | Fichier                                                                                                                  |
| --------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PSP       | `WebhookIngestService`, `WebhookProcessor`, `MoneyCommandSender` | tempête de webhooks (doublons, ordre inversé, retard, rejeux tardifs) ; `LOOKUP` en panne ou en délai dépassé ; PSP qui ignore l'idempotence ; panne prolongée puis reprise                 | `pay/testing/resilience-psp.test.ts`                                                                                     |
| KYC       | `IdentityVerificationService`                                    | délai dépassé avant et après l'effet, retard, panne prolongée à l'ouverture ; rappel retardé, périmé, perdu, hors d'ordre, doublon tardif ; effacement en panne                             | `kyc/testing/resilience-kyc.test.ts`                                                                                     |
| SMS       | `NotificationSender`, `OtpSender`                                | délai dépassé avant et après l'envoi, doublon du fournisseur, retard, panne prolongée (réessais, plafond compté une fois, repli e-mail) ; code OTP jamais envoyé deux fois                  | `ntf/internal/resilience-sms.test.ts`, `iam/internal/phone/resilience-otp.test.ts`                                       |
| Antivirus | `HostListingsService.addPhoto`, `VehicleDocumentsService`        | panne, délai dépassé, verdict infecté, marqueur de maliciel, retard, doublon, panne prolongée : rien n'est stocké ni libéré tant que le verdict n'est pas sain ; un seul dépôt à la reprise | `cat/internal/host-listings/resilience-antivirus.test.ts`, `cat/internal/vehicle-documents/resilience-antivirus.test.ts` |

Le travailleur arrêté est couvert par C17 (`disposition_sweeper`, `l0-us024-conversion.test.ts`) ; « jamais de FAKE en production » par C19 (garde `assertFakeAllowed`, isolement de l'image, démarrage de PAY, garde de la base). Les constats qui ne sont pas des défauts du code testé sont versés aux suites (passation US-045).

## Horloge réelle (L0-06)

`l0-06-real-clock.test.ts` rejoue C2, C5, C15 (a) et C15 (c) sur `platform.now()` réel (aucun `app.virtual_now`, vérifié dans chaque transaction) et retrouve les issues de la passe virtuelle. Les holds échoient en temps réel pendant une fenêtre courte où `hold_ttl_minutes` vaut 1 min (fixture de test 9962) ; le test attend l'échéance, environ une minute par pays.
