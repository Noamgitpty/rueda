lot: L2
module: Paiements

- Ajouté : décision automatique de la caution à l'heure de décision (fin + 72 h, 70 h dans le cas T57), par la tâche de la caution du travailleur : annulation de l'autorisation, capture des seuls frais annexes annoncés si le PSP le permet, débit séparé sinon ; jamais suspendue par une réclamation (migration 0150, US-702, ADR-172)
- Ajouté : état final de la caution enregistré une fois (capturé, libéré, heure) et événement `deposit.decision.executed` ; une autorisation expirée n'est jamais capturée (US-702)
- Ajouté : avis au voyageur « caution libérée » ou « frais capturés, reste libéré » par e-mail puis SMS, en espagnol, anglais, français et portugais du Brésil (catalogue v87, US-702)
- Ajouté : alertes ops `DEPOSIT_DECISION_FAILED` et `DEPOSIT_FEES_UNCOLLECTED` (US-702)
- Modifié : le fournisseur et l'échéancier de la caution sont recalculés par la base à l'écriture de la décision, au lieu d'être repris de l'API (US-702, suite des revues d'US-701)
- Modifié : la sortie de la page de paiement quand la caution est impossible mène à la recherche (US-702)
