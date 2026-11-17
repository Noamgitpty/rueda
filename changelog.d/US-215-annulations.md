lot: L2
module: Réservation

- Ajouté : l'ops annule un trip à la demande du voyageur, de l'hôte ou de la plateforme depuis la console (`CANCEL_TRIP_GUEST`, `CANCEL_TRIP_HOST`, `CANCEL_TRIP_PLATFORM`) ; le motif et l'initiateur viennent de l'action, jamais d'une saisie libre, et aucun montant n'est saisi (US-215)
- Ajouté : le règlement de l'annulation est calculé par le moteur unique et enregistré dans la même transaction que la transition, avec le remboursement par jambe du voyageur ; `settlement_id` est posé au journal du trip et dans `trip.status_changed` (US-215)
- Ajouté : la base refuse tout règlement qui ne correspond pas à la demande (instant, motif, départ, paramètres du pays) et tout règlement d'annulation sans ses remboursements (US-215)
- Ajouté : « à cause du voyageur » ne qualifie un no-show qu'avec une pièce jointe par l'ops ; chaque annulation dit qui en porte le coût (`cost_bearer`) (US-215)
- Ajouté : alerte `TRIP_CANCELLATION_FAILED` quand une annulation demandée ne peut pas être réglée (US-215)
