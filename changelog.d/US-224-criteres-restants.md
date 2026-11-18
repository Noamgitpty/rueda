lot: L2
module: Règlement et finance

- Ajouté : quand Kmino avance au voyageur la part d'un hôte déjà versé (règle 3 bis), la créance de l'hôte est inscrite à son grand livre (`host_ledger`), du montant exact de l'avance, dans la devise du trip, au moment où le remboursement est reporté ; rien n'est inscrit tant que l'avance attend la décision FINANCE (US-224)
- Ajouté : hôte défaillant : une fois l'hôte restreint, l'ops annule en une action tous ses trips à venir ; chaque voyageur est remboursé intégralement par le règlement, sans attendre l'hôte, et l'hôte ne reçoit rien pour ces trips (US-224)
- Sécurité : la créance n'est écrite que par la base, au report du remboursement, une seule fois par avance ; l'annulation des trips d'un hôte exige la permission `ops.platform_cancel`, une session élevée et la garde de séparation des tâches, et refuse un hôte non restreint (US-224)
