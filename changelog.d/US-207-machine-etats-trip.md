lot: L2
module: Réservation

- Ajouté : machine à états du trip en base : seules les transitions de SM-1 sont permises, chacune journalisée avec son événement `trip.status_changed` dans la même transaction (US-207)
- Ajouté : annulation et no-show qualifiés selon le motif, jamais selon l'initiateur ; une annulation du voyageur reçue après l'heure limite d'attente sans retrait devient un no-show du voyageur (US-207)
- Ajouté : segment, conducteur principal et journal d'état créés à la naissance de chaque trip (US-207)
- Sécurité : l'état d'un trip ne s'écrit plus que par commande ; aucune annulation d'un trip en cours (US-207)
- Ajouté : messages de refus en es, en, fr et pt-BR (US-207)
