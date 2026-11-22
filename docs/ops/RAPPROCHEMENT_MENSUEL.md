# Runbook — rapprochement mensuel par jambe (bêta, procédure MANUELLE bornée)

Source : 19 US-311 critère 4 ; 16 FIN-005 (« Bêta pilote : MANUEL ») ; 22 J-ADM-031 ; ADR-194 (PROPOSÉ). Ce runbook vaut jusqu'à l'automatisation du lot 5 (US-711 quotidien, US-532 API du PSP). Il ne remplace pas le contrôle nocturne des invariants (US-047, `docs/ops/MONITORING.md`, alerte `FIN_MONEY_RECONCILIATION`).

## Qui, quand

- **Qui** : le fondateur ou le comptable, avec un rôle `FINANCE` (ou `ADMIN`) du pays, session de la console élevée par TOTP.
- **Quand** : chaque mois, pour le mois précédent, dans chaque pays ouvert ; et à tout moment pour un mois en cours (le passage reste un passage de travail tant qu'il n'est pas signé).
- **Seuil** : `reconciliation_delta_threshold_bps` du pays, fixé par le fondateur **avant l'ouverture** (J-ADM-031, `docs/team/POUR_LE_FONDATEUR.md` §3). Tant qu'il n'est pas fixé, il vaut **0** : tout écart, même d'une unité mineure, est au-delà du seuil.

## Étapes

1. **Exporter la plateforme** (journalisé) : `POST /console/reports/exports` avec `source` = `OPERATIONS` puis `LEGS`, `country`, `month` (`YYYY-MM`) et un motif. Le fichier CSV contient références du PSP, identifiants techniques, référence publique du trip et montants en unités mineures, jamais de donnée personnelle.
2. **Récupérer le relevé du PSP** du même mois (opérations et, quand le PSP le fournit, soldes par jambe). En bêta, le PSP est le `FAKE` : son export par jambe est `listLegBalances`.
3. **Enregistrer le passage** : `POST /console/reconciliation/runs` avec `country`, `month` (`YYYY-MM`, jamais un mois à venir), `kind`, un motif et un `requestId` neuf (UUID généré par la console pour ce passage).
   - **Lignes `OPERATIONS`** : une par opération du PSP qui déplace des fonds (encaissement, remboursement, débit post-trip, recouvrement, capture de caution, chargeback et son retour, libération d'une jambe), `{ reference, amountMinor, currency }` : `reference` = référence d'opération du PSP, `amountMinor` = entier en unités mineures (centimes en USD, guaraníes en PYG), `currency` = devise du pays. Les autorisations, annulations et crédits internes ne sont ni à saisir ni rapprochés.
   - **Lignes `LEGS`** : une par trip et par jambe (`HOST`, `INSURER`, `TAX_THIRD_PARTY`, `PLATFORM`), `{ tripReference, leg, currency, capturedMinor, refundedMinor, reallocatedInMinor, reallocatedOutMinor, releasedMinor }` ; `tripReference` = identifiant du trip **ou** de son hold d'origine, jamais les deux pour la même jambe.
   - **400 lignes au plus** par passage (le corps d'une requête de l'API est borné à 100 Kio). Au-delà, le volume dépasse la bêta : le rapprochement automatisé (US-711, US-532) devient préalable ; ne jamais découper un relevé en plusieurs passages, chaque passage réclamerait les lignes absentes comme manquantes.
   - La base apparie à l'unité mineure, sans tolérance. Un relevé vide (`RECON_STATEMENT_MISSING`), ou une ligne mal formée, en double, dans une autre devise, ou deux lignes pour la même jambe (`RECON_FORMAT_INVALID`) : rien n'est enregistré ; corriger le fichier et recommencer avec un **nouveau** `requestId`.
   - Renvoyer la même requête (même `requestId`, par exemple après une coupure réseau) rend le même passage (`200`), sans rien enregistrer de plus. Un relevé corrigé après coup est un **nouveau** passage : le précédent reste au registre (jamais supprimé) ; résoudre ses écarts avec le code `OTHER` et la note « relevé remplacé par le passage … », puis signer le nouveau.
4. **Lire les écarts** : `GET /console/reconciliation/runs/{runId}` (écarts en tête). Constats :
   - `OPERATION_WITHOUT_TRIP` : opération du PSP inconnue de la plateforme ou sans trip (cas « 128,40 sans trip » de 19 US-311) ;
   - `OPERATION_NOT_IN_PSP` / `LEG_NOT_IN_PSP` : ligne de la plateforme absente du relevé ;
   - `LEG_WITHOUT_TRIP` : jambe d'un trip inconnu de la plateforme ;
   - `AMOUNT` : montant différent ; pour une jambe, la composante (`CAPTURED`, `REFUNDED`, `REALLOCATED_IN`, `REALLOCATED_OUT`, `RELEASED` : un versement sans jambe libérée apparaît ici).
5. **Traiter chaque écart** : `POST /console/reconciliation/items/{itemId}/resolution` (code `TIMING`, `PSP_FEE`, `PSP_ERROR`, `PLATFORM_ERROR`, `DUPLICATE`, `OTHER` et une note sans nom ni contact). Au-delà du seuil (`exceedsThreshold`), l'écart est traité **avant `treatBy`** (5 jours ouvrés du pays) ; `treatOverdue` = `true` signale le dépassement. Un écart `PLATFORM_ERROR` ou un trip concerné ouvre un dossier FIN ; une jambe `HOST` non encore libérée reste dans le lot de versement `ON_HOLD` jusqu'à la résolution (16 FIN-005).
6. **Signer la checklist** : `POST /console/reconciliation/runs/{runId}/signature` avec les cinq points à `true` : `PSP_STATEMENT_COMPLETE`, `OPERATIONS_RECONCILED`, `LEGS_RECONCILED`, `DISCREPANCIES_EXPLAINED_OR_ESCALATED`, `THRESHOLD_REVIEWED`. La base enregistre le signataire et l'heure ; les écarts encore inexpliqués restent comptés (`unexplainedAtClose`). Un mois est clos quand ses passages `OPERATIONS` **et** `LEGS` sont signés.
7. **Vérifier l'état des mois** : `GET /console/reconciliation/runs?country=` ; et le KPI S4 (`GET /console/beta-views/exit-kpi?country=`).

## Règle des deux mois

Si les **deux derniers mois complets** ont chacun au moins un écart inexpliqué (`dailyReconciliationRequired` = `true`), le rapprochement **quotidien** (US-711) devient préalable : le fondateur décide de l'avancer avant toute nouvelle ouverture dans le pays, et le critère de sortie S4 reste non atteint.

## Ce que le runbook n'automatise pas (lot 5)

Lecture du relevé par l'API du PSP, passage quotidien, événement `finance.reconciliation.delta_exceeded`, gel automatique des commandes d'un trip en écart, alerte FIN. Ces gestes restent manuels en bêta : le dossier FIN et l'éventuel gel d'un versement sont décidés par le comptable ou le fondateur.
