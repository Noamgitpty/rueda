lot: L2
module: Notifications

- Corrigé : la confirmation de réservation et l'annulation d'un trip partent vraiment au voyageur et à l'hôte : les destinataires (voyageur, titulaire du compte d'hôte) sont lus en base au moment de l'événement, au lieu d'être attendus dans une charge utile qui ne les portait pas (US-213)
- Ajouté : confirmation propre à l'hôte, sans aucune donnée du voyageur ; confirmation du voyageur avec l'adresse exacte et le contrat à signer dans la réservation, le permis physique à présenter et les conseils de sécurité d'une rencontre entre particuliers, sans le téléphone de l'hôte (US-213)
- Ajouté : notifications des demandes de réservation — demande reçue par l'hôte avec l'heure limite, demande refusée ou expirée pour le voyageur, réservation non confirmée après une acceptation (capture refusée ou jamais confirmée) pour le voyageur et pour l'hôte, en es, en, fr et pt-BR (US-213)
- Modifié : la référence courte d'un message est celle des écrans et du contrat (8 premiers caractères) (US-213)

lot: L2
module: Réservation

- Ajouté : écran de confirmation « ¡Reserva confirmada! » avec le numéro du trip, les pièces à présenter et les conseils de sécurité (10b S07) (US-213)
- Sécurité : lecture des parties d'une réservation réservée au seul travailleur des notifications, identifiants et codes seulement (US-213)
