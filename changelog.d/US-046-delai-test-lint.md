lot: L1
module: Base de données

- Corrigé : les tests unitaires de la base qui lisent toutes les migrations du dépôt (lint expand / contract, préfixes, numérotation, inventaire, schéma) ont un délai de 30 s, 60 s pour le lint expand / contract ; le délai par défaut de 5 s était dépassé sur un exécuteur de CI chargé. Assertions inchangées (US-046)
