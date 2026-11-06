lot: L0
module: Argent (`@rueda/money`)

- Corrigé : le moteur de règlement refuse un trip dont les promos dépassent le prix du véhicule (`PROMO_EXCEEDS_TRIP_PRICE`), dont une ligne a le mauvais signe (`LINE_SIGN_INVALID`) ou dont le total payé est ≤ 0 (`TOTAL_PAID_NOT_POSITIVE`) ; garde `assertPayableAmounts` exportée pour le devis (US-042, ADR-090)
- Corrigé : un remboursement hors de [0 ; total payé] ou une taxe remboursée hors de [0 ; taxe payée] est refusé (`REFUND_OUT_OF_RANGE`) au lieu d'être émis, avec un contexte d'alerte FIN dans `SettlementError.details` (US-042, ADR-090)
- Corrigé : une taxe payée de groupe négative est refusée à l'entrée (`TAX_PAID_NEGATIVE`) (US-042, ADR-090)
- Corrigé : générateurs des propriétés alignés sur 08 et régressions déterministes des graines -1390209851, -1970700454 et -1546341607, en USD et en PYG (US-042)
