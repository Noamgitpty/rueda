lot: L2
module: Notifications

- Ajouté : la confirmation de réservation donne au voyageur le numéro du support et celui de l'assistance de l'assureur (panne ou accident), et à l'hôte le numéro du support, jamais le téléphone de l'hôte ; tant que les numéros d'un pays ne sont pas fournis, elle renvoie à la réservation dans l'appli, en es, en, fr et pt-BR (US-213)

lot: L2
module: Configuration pays (CFG)

- Ajouté : numéros du support et de l'assistance de l'assureur par pays (`assistanceContacts`, format E.164 avec l'indicatif du pays) ; la production refuse de démarrer tant qu'ils manquent (US-213)
