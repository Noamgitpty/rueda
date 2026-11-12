lot: L1
module: Base de données

- Tests : le test qui passe toutes les migrations du dépôt au lint expand / contract reçoit un délai explicite de 60 s (le délai par défaut de 5 s était dépassé sur un exécuteur de CI chargé), sans relâcher ses assertions (US-046)
