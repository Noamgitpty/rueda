lot: L2
module: Paiement

- Ajouté : paiement du hold du checkout avec le montant exact de chaque jambe (hôte, assureur, taxe pour un tiers, plateforme) lu dans le devis accepté ; réservation confirmée seulement quand un webhook signé du PSP prouve le paiement (US-223)
- Ajouté : un paiement dont le montant reçu diffère de la commande n'est jamais confirmé et déclenche une alerte (US-223)
- Modifié : un webhook sans horodatage signé, rattaché par une référence fournie par l'appelant, ou une lecture non authentifiée d'un compte réel ne prouvent plus un paiement (US-223)
- Modifié : sans en-tête d'idempotence garanti par le PSP, toute commande d'argent est lue chez le PSP avant d'être envoyée : aucun double débit (US-223)
- Ajouté : ventilation des jambes d'un paiement entre plusieurs encaissements (carte, Yappy, crédit cash, crédit promo), dans l'ordre de 08 E7 règle 10 ; un crédit ne couvre jamais que la part de la plateforme (`cascadeTenders`, `creditCap`, `TENDER_KINDS` de `@rueda/money`) (US-223)
