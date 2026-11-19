lot: L2
module: Règlement et finance

- Corrigé : l'ordonnanceur des remboursements ne peut plus s'interbloquer avec une nouvelle version du règlement quand il signale un remboursement refusé par le PSP (verrou du trip pris avant celui de l'instance) (US-224)
- Corrigé : un remboursement au-delà de ce que les moyens d'origine peuvent encore rendre met la demande d'annulation en revue FIN (alerte `FIN_SETTLEMENT_REVIEW`) au lieu de l'échouer (US-224)
- Sécurité : aucun encaissement par crédit (crédit cash ou promo) n'est enregistré tant que les crédits n'existent pas (`PAYMENT_METHOD_UNAVAILABLE`) (US-224)

lot: L2
module: Console interne

- Corrigé : texte pt-BR du code garé `REFUND_RAIL_NOT_NATIVE` (US-224)
