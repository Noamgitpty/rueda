lot: L1
module: Console interne
- Ajouté : catalogue minimal des actions de console de 17 §10 (actions d'état, actions d'enregistrement seul, décisions FINANCE), chacune avec sa permission, son type de sujet et ses clés de saisie (US-101)
- Ajouté : une action d'état appelle la commande de domaine liée à l'action dans la même transaction que `manual_action` et l'audit ; tant que sa commande n'est pas livrée, elle reste indisponible et la tentative est journalisée (US-101)
- Sécurité : l'agent ne saisit jamais un montant ; la base refuse toute clé non déclarée, toute valeur numérique et toute clé de catalogue qui nomme un montant (US-101)
- Ajouté : une action d'enregistrement seul exige un motif et au moins une pièce reçue du seau des preuves (US-101)
- Ajouté : les décisions FINANCE (bordereau, avance, passage en perte) se demandent depuis la console et ne prennent effet qu'à l'approbation d'une seconde personne distincte ; routes `GET /console/finance/approvals` et `POST /console/finance/approvals/{id}/approve` (RLS-24, US-101)
- Ajouté : écrans de la console en es, en, fr et pt-BR : actions groupées, pièces, demandes FINANCE à approuver (US-101)
