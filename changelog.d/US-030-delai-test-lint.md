lot: L1
module: Design

- Corrigé : les tests de `@rueda/design-tokens`, dont le lint des styles qui parcourt tout le dépôt, ont un délai de 30 s ; le délai par défaut de 5 s était dépassé sur un exécuteur de CI chargé. Assertions inchangées (US-030)
