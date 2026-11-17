lot: L2
module: Paiement

- Ajouté : chaque ordre de remboursement, de réaffectation ou de versement d'un trip porte l'identifiant et la version du règlement dont il découle ; un ordre d'une version déjà remplacée est refusé (`SETTLEMENT_SUPERSEDED`) (US-224)
- Modifié : un remboursement est borné dès l'enregistrement de l'ordre, avant tout envoi au PSP, en comptant les ordres en cours : jamais plus que l'encaissé de chaque jambe (`REFUND_EXCEEDS_COLLECTED`), jamais plus que le règlement par jambe (aucun prorata) ; deux remboursements simultanés n'en enregistrent qu'un (US-224)
- Modifié : le rejeu d'une version de règlement déjà enregistrée rend le règlement existant au lieu d'une erreur (US-224)
- Modifié : un webhook de remboursement, de réaffectation, de versement ou de débit sans montant ne prouve plus l'opération (US-224)
- Ajouté : `settlementOrders` (`@rueda/money`) calcule la réaffectation et les remboursements par moyen d'un règlement, montant explicite de chaque jambe (08 E7 règles 3 et 10) ; un règlement refusé par le moteur (`REFUND_OUT_OF_RANGE`) part en revue FIN avec une alerte, sans aucun ordre (US-224)
