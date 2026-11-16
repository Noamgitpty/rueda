lot: L2
module: Réservation

- Ajouté : devis figé du checkout pour le voyageur de la session (`POST /checkout/quotes`, `GET /checkout/quotes/{id}`) : lignes, taxes et total rejoués par la base, durée de validité de 30 min (`quote_validity_minutes`, `QUOTE_EXPIRED`), documents à accepter (US-208)
- Ajouté : checkout en une transaction (`POST /checkout/quotes/{id}/hold`) : boîte manuelle confirmée, conducteur titulaire du compte, CGU, politique d'annulation et texte géographique acceptés et enregistrés par version, puis pose du hold CHECKOUT ; aucun paiement (US-208)
- Ajouté : récapitulatif du hold avec la version exacte de chaque document accepté (`GET /checkout/holds/{id}`) et textes des refus en espagnol, anglais, français et portugais (US-208)
- Ajouté : total TTC du créneau choisi sur la fiche (`GET /listings/{id}/availability`, même devis provisoire que la recherche) (US-208)
- Sécurité : annonce sur demande jamais réservée en mode immédiat ; lignes que la base ne recalcule pas refusées à l'engagement du prix ; gels du devis bornés en taille et en débit par voyageur (US-208)
- Sécurité : garde des CGU contrôlée sur les routes réellement montées, par identité de la garde (alias, classe de base, décorateurs composés) (US-208)
