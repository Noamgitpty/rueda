lot: L2
module: Réservation

- Ajouté : décision motivée de l'équipe sur une réservation signalée, depuis la console : approuver laisse le voyageur payer (une seule prolongation du délai de paiement), refuser libère les dates sans aucun débit ; motif et auteur gardés au journal (US-209)
- Ajouté : dossier de la réservation signalée dans la console, lecture journalisée : signaux des règles, score, échéance, période et déclaration d'entrée du voyageur (US-209)
- Ajouté : déclaration du statut et de la date d'entrée du voyageur à permis étranger (route de l'API ; l'écran arrive avec la suite de la story), au plus cinq déclarations par heure (US-209)
- Modifié : une réservation en revue qui n'est pas décidée à temps est libérée comme un refus, sans débit, au lieu d'expirer ; son élément de file est clos (US-209)
- Sécurité : la séparation des tâches de la console reconnaît la réservation signalée : un membre de l'équipe ne prend, ne lit ni ne décide jamais une réservation qui le concerne (voyageur ou personne du compte de l'hôte) (US-209)
