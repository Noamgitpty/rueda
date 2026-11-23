lot: L3
module: Versements

- Ajouté : la part de l'hôte d'un frais annexe, d'un dommage ou d'une amende débité au voyageur est reportée sur la jambe de l'hôte du voyage, au montant exact du débit, puis versée avec le versement suivant de l'hôte, en USD et en PYG (US-319)
- Modifié : le versement d'un voyage n'inclut jamais la part d'un débit après le voyage ; celle-ci a son propre élément dans le lot suivant, retenu comme le reste tant qu'un motif de retenue est ouvert (chargeback, gel, interrupteur) et annulé si le voyageur gagne un chargeback reçu après le débit (US-319)
- Sécurité : aucun débit sans preuve du prestataire de paiement n'est reporté ; aucun fonds de tiers n'est détenu par Kmino (répartition à la source chez le prestataire) (US-319)
