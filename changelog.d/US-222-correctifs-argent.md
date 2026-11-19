lot: L2
module: Paiements

- Corrigé : un devis qui porte une promotion, une option ou une livraison sans source en base n'est plus figé (QUOTE_MISMATCH) ; la route HTTP n'est pas touchée (migration 0155, US-222d, ADR-176, constat F-L2-ARG-01)
- Ajouté : une zone ou une ville publiques qui proposent un paiement hors plateforme (espèces, virement, portefeuille, commission contournée) sont refusées, avec un message en espagnol, anglais, français et portugais du Brésil (catalogue v93), et le compte d'hôte est signalé à l'ops dans la file GRAY_MARKET (US-222d, F-L2-ARG-02)
- Ajouté : le libellé ou l'adresse d'un lieu de remise qui proposent un paiement hors plateforme sont signalés à l'ops (file GRAY_MARKET) sans bloquer le lieu (US-222d, F-L2-ARG-03)
- Ajouté : un chargeback gèle la part de l'hôte du trip avant tout versement et, tant qu'il n'est pas imputé, il est signalé par le rapprochement FIN nocturne (contrôle CHARGEBACK_UNIMPUTED, US-222d, F-L2-ARG-04)
