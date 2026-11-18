lot: L2
module: Règlement et finance

- Ajouté : registre de la prime due à l'assureur partenaire, trip par trip : chaque paiement encaissé et chaque règlement y portent la part de l'assureur telle qu'enregistrée, dans la même opération, jamais recalculée (US-227)
- Ajouté : bordereau mensuel de l'assureur préparé chaque jour pour le mois clos (voyages terminés seulement, jamais une ligne gelée par une contestation de paiement) et émis seulement par deux personnes FINANCE distinctes ; aucun paiement à l'assureur pendant la bêta (US-227)
- Ajouté : le contrôle de nuit de l'argent vérifie que le registre de l'assureur retrouve exactement la part de l'assureur des paiements et des règlements, et qu'aucun bordereau ne porte plus que la prime due (US-227)
- Sécurité : registre immuable, écrit par la seule base ; lecture par FINANCE et ADMIN du pays ; un remboursement qui toucherait une prime déjà portée par un bordereau émis est arrêté pour revue FINANCE (US-227)
