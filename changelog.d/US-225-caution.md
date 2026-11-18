lot: L2
module: Paiements

- Ajouté : paramètres des déclencheurs de la caution « comme Turo » par pays, aucune caution par défaut (pays faux, classe LUXE seulement, aucune classe pour l'âge, contrôle de risque non déployé), avec l'avance de ré-autorisation et le délai de notification des frais (migration 0141, US-225, ADR-164)
- Ajouté : décision de la caution au checkout avant tout paiement — sans déclencheur aucun rail n'est évalué ; caution exigée sans montant refusée (`PARAM_MISSING`) ; aucun rail valide refusé avec le nombre de jours possibles (`DEPOSIT_RAIL_UNAVAILABLE`) ; rail choisi par configuration, « débit puis remboursement » fermé tant que la détention de fonds est fermée (US-225)
- Ajouté : décision de libération de la caution avec des commandes au montant explicite — capture des frais puis annulation du reste (T57), annulation puis débit séparé sans capture partielle (T58) — et exécution par le port de paiement, sur le PSP simulé seulement ; ré-autorisation refusée signalée à l'ops sans débit (US-225)
- Ajouté : textes du refus de la caution avant le paiement en espagnol, anglais, français et portugais du Brésil (catalogue v78, US-225)
- Modifié : le PSP simulé accepte l'annulation du reste d'une autorisation après une capture partielle (08 E3, US-225)
