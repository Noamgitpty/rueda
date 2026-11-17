lot: L2
module: Règlement et finance

- Ajouté : grand livre de l'hôte (`host_ledger`) par hôte et par devise ; la pénalité de l'hôte qui annule y est écrite comme dette de l'hôte (débit, devise du trip, rattachée au règlement et à sa version), dans la même transaction que le règlement et la transition, jamais comme jambe du paiement du voyageur (US-709)
- Ajouté : FINANCE et ADMIN du pays lisent le solde de chaque hôte par devise ; l'ops, le support, l'hôte et le voyageur n'y ont pas accès (US-709)
- Sécurité : écritures immuables, par une seule commande de la base que seul le règlement d'une annulation déclenche ; aucun droit d'écriture des rôles applicatifs (US-709)
