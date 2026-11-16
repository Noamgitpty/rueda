lot: L2
module: Catalogue et recherche

- Ajouté : galerie de la fiche du véhicule dans l'ordre de l'hôte, photo indisponible remplacée par une vignette sans casser le reste de la fiche ; photos servies par le site depuis le bucket public (`WEB_MEDIA_URL`) (US-204)
- Ajouté : bloc de l'hôte sur la fiche (prénom, note, nombre de trips, « identité vérifiée ») et note du véhicule ou badge « Nuevo », en espagnol, anglais, français et portugais (US-204)
- Ajouté : choix des dates sur la fiche, contrôlées par la base : préavis de l'hôte non respecté ⇒ `DATES_NOTICE_TOO_SHORT`, créneau pris ⇒ `DATES_UNAVAILABLE`, sans détail de l'occupation (`GET /listings/{id}/availability`, limite par IP de la sonde) (US-204)
- Sécurité : adresse exacte du lieu de remise jamais dans la fiche publique ; servie au seul voyageur d'un trip confirmé et non terminé de ce véhicule (`GET /listings/{id}/meeting-point`, session) (US-204)
