lot: L2
module: Paiements

- Corrigé : la validité de l'autorisation transmise à l'écriture de la décision de caution ne peut plus avancer la libération au-delà de la règle ; le rail est revérifié par la base (migration 0152, US-702b, ADR-172)
- Corrigé : la libération de la caution suit le retour réel du véhicule quand il est connu (retour + 72 h) ; un retour tardif ne prolonge jamais l'autorisation (US-702b)
- Ajouté : avis au voyageur « caution bloquée par la banque jusqu'au … » quand l'annulation de l'autorisation est refusée, au lieu de « libérée », en espagnol, anglais, français et portugais du Brésil (catalogue v89, US-702b)
- Corrigé : un PSP injoignable à l'annulation n'est plus traité comme un refus (nouvel essai) ; l'alerte ops `DEPOSIT_DECISION_FAILED` n'est envoyée qu'une fois par caution et par cause (US-702b)
