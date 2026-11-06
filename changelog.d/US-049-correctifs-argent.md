lot: L0
module: Argent (règlement, paiements)

- Corrigé : un règlement dont les montants ne correspondent pas à ses entrées est refusé en base ; la base rejoue elle-même le calcul du moteur `cxl-beta/1` à partir des entrées enregistrées et compare chaque montant, chaque ligne et chaque jambe, et une requalification doit porter sur le même devis que la version qu'elle remplace (migration 0054, RC-1) (US-049)
- Corrigé : un remboursement exige un règlement du trajet et ne dépasse jamais, jambe par jambe, ce que la chaîne de versions du règlement rend au voyageur ; un second remboursement ou une ventilation au prorata est refusé (RC-2) (US-049)
- Corrigé : le versement d'une jambe à l'hôte ou à l'assureur est refusé dès l'enregistrement de l'ordre tant que le trajet n'est pas terminé, que la date de versement n'est pas atteinte, que l'hôte n'est pas un sous-marchand actif ou que l'interrupteur `payouts_enabled` (ou `insurer_contract_active`) du pays vaut false ; `funds_holding_enabled` est lu pour tout compte qui ne partage pas à la source (RC-3) (US-049)
- Corrigé : un webhook signé mais arrivé hors de la fenêtre de ± 5 min (mis en quarantaine) n'est plus jamais cru sur parole ; il ne paie une opération qu'après lecture de son état chez le PSP, sinon il est mis en échec avec une alerte (RT-CONC-53) (US-049)
- Corrigé : un faux webhook rejoué reçoit 401 à chaque envoi, jamais 200 (RT-CONC-58) (US-049)
