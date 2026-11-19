lot: L3
module: Support

- Ajouté : lien « Ayuda » dans l'en-tête de chaque écran, vers l'écran d'aide et d'urgence (S17) : numéro d'urgence du pays, autorité de circulation à prévenir après un accident, assistance de l'assureur partenaire et support de Kmino, lus de la configuration du pays ; tant qu'un numéro n'est pas fourni, l'écran renvoie à l'aide dans l'appli, sans jamais inventer de numéro, en es, en, fr et pt-BR (US-310)
- Ajouté : aide depuis le trip, pour le voyageur et pour l'hôte : numéros du pays du trip et demande d'aide à motif fermé (accident, panne, remise ou retour, sécurité, autre), enregistrée côté support sans texte libre ni téléphone ; jamais le téléphone de l'autre personne (US-310)
- Ajouté : console — demandes d'aide en cours sans donnée personnelle, prise en charge par la première réponse d'un agent et délai de première réponse mesuré sur 28 jours (M6) (US-310)
- Sécurité : la demande est jugée par la base pour la personne de la session ; un trip d'une autre personne rend la même réponse qu'un trip inconnu ; un agent ne prend jamais sa propre demande (US-310)

lot: L3
module: Notifications

- Ajouté : réponse automatique à une demande d'aide reçue hors de la plage du support, dans la langue du compte, avec les numéros du support et de l'assistance de l'assureur (le support seul pour l'hôte), sans délai promis (US-310)

lot: L3
module: Configuration pays

- Ajouté : aide et urgence de chaque pays (numéro d'urgence, autorité de circulation, plage du support) ; la production refuse de démarrer tant qu'aucune plage validée par un planning de présence n'est inscrite (SUP-020) (US-310)
