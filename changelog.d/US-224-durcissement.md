lot: L2
module: Console interne

- Sécurité : l'action de console `CANCEL_HOST_TRIPS` n'annule les trips à venir d'un hôte que s'il est suspendu pour la sûreté (`TS_HOLD`, `POLICY_VIOLATION`, `KYC_REVOKED`) ; une restriction d'argent (`UNPAID_BALANCE`, `PAYMENT_PLAN_ACTIVE`, `CHARGEBACK`) est refusée (`HOST_NOT_RESTRICTED`) (US-224)

lot: L2
module: Règlement et finance

- Sécurité : le reçu d'un trip n'est rendu à l'hôte que s'il est titulaire du compte avec le rôle `P2P_HOST` actif, comme le relevé des gains ; co-hôte ou adhésion retirée ⇒ 404 `RECEIPT_NOT_FOUND` (US-224, suite d'US-217)

lot: L2
module: Catalogue et annonces

- Corrigé : la classe de valeur d'un véhicule saisi hors catalogue reconnaît les écritures courantes (« G 500 », « S580 », « LandCruiser », « MercedesBenz », « 740i ») et les marques et modèles ajoutés (GMC Yukon et Sierra, Rivian, Lucid, etc.) : jamais une classe plus basse que la règle (US-224, suite d'US-113)
