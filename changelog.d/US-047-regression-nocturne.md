lot: L0
module: Finance (rapprochement)

- Ajouté : contrôles de rapprochement de l'argent, tâche nocturne du travailleur `reconciliation` en lecture seule (4 jambes, aucune jambe négative, Σ jambes = retenu TTC, HOST = `hostFromGuest`, équilibre du remboursement, Σ variations = − remboursement, chaîne des versions, soldes par jambe) ; alerte P1 `FIN_MONEY_RECONCILIATION` par pays, comptes seulement (US-047)

lot: L0
module: Équipe et CI

- Ajouté : parcours doré de règlement dans chaque pays configuré, suivi du rapprochement et de l'oracle C12, sur chaque PR (`test:int`) et chaque nuit (job `rapprochement`) (US-047)
- Ajouté : tableau de bord QA de la nuit (job `tableau-de-bord-qa`, `scripts/qa/nightly-dashboard.mjs`) : verdict par famille, bogues avec leur scénario rejouable, versement au tableau des stories par l'orchestrateur (US-047)
