lot: L2
module: Paiement

- Ajouté : les remboursements planifiés sont envoyés par Kmino au PSP sans intervention de l'ops, toutes les dix secondes, avec le montant exact de chaque jambe ; aucun remboursement n'est autorisé tant qu'aucun connecteur du PSP n'existe (FAKE en test seulement, aucun en production avant le lot C) (US-224)
- Ajouté : un remboursement suit désormais son ordre au PSP : envoyé, confirmé par la preuve signée, en échec ; un remboursement confirmé est reporté sur les soldes des jambes ; une nouvelle version du règlement remplace aussi un remboursement en échec (US-224)
- Ajouté : alertes FIN (une fois par état) quand un remboursement attend une décision FINANCE sur l'avance de Kmino, échoue au PSP ou ne peut pas être envoyé (US-224)
- Sécurité : un ordre de remboursement est relu et verrouillé pendant tout l'appel au PSP ; un ordre jamais envoyé d'une version remplacée ne part pas sans revue FIN (US-224)
