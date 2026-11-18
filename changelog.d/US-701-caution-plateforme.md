lot: L2
module: Paiements

- Ajouté : décision de la caution figée une fois par réservation avant le paiement (migration 0146, US-701, ADR-169) ; la base revérifie le montant du pays et de la classe, refuse « aucune caution » sur une classe qui en exige une et ferme le « débit puis remboursement » tant que la détention de fonds est fermée
- Ajouté : la page de paiement affiche la caution avant de payer — aucune caution, montant, blocage temporaire et date de libération au plus tard, ou réservation impossible avec les jours possibles et un lien vers la recherche ; aucun bouton « Payer » quand la caution est impossible (US-701)
- Ajouté : refus du paiement quand la caution est impossible pour ces dates ou que son montant n'est pas fixé, avant tout ordre au PSP (409, US-701)
- Ajouté : ré-autorisation de la caution avant son expiration par une tâche du travailleur ; refusée, la décision est avancée avant l'expiration et le trip est signalé à l'ops sans débit (US-701)
- Ajouté : textes « aucune caution » et refus du paiement en espagnol, anglais, français et portugais du Brésil (catalogue v85, US-701)
- Modifié : clés d'idempotence des opérations de caution alignées sur la variante « hors règlement » de 08 E4 (US-701)
- Corrigé : une ré-autorisation en cours ou d'issue inconnue n'est plus prise pour une ré-autorisation acceptée (US-701, suite des revues d'US-225)
