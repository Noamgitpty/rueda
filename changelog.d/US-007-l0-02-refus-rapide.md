lot: L0
module: Disponibilité et réservation

- Modifié : une pose de hold sur un créneau déjà pris est refusée dès le verrou du véhicule, sans rien écrire, avec la même erreur qu'avant (`VEHICLE_UNAVAILABLE`, `DATES_UNAVAILABLE` au checkout) ; l'exclusion GiST reste la seule garde du créneau (US-007, N-468, ADR-199)
- Modifié : sur un créneau définitivement pris, `VEHICLE_UNAVAILABLE` passe avant la limite de holds vivants, le chevauchement des trips du voyageur et la rotation (PROPOSÉ, ADR-199) (US-007)
- Corrigé : la lecture des paramètres de pays par la pose ne se replanifie plus à chaque transaction ; son coût ne croît plus avec chaque politique ajoutée à `cmd_hold_owner` (dérive du p95 de L0-02, US-007)
