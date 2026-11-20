lot: L3
module: Paiements

- Ajouté : au paiement, une case séparée et non cochée d'avance pour accepter les débits après le voyage sur la carte (frais du voyage, franchise, dommages), en es, en, fr et pt-BR ; sans elle, pas de paiement (US-703)
- Ajouté : rappel de ce consentement au voyageur quand il valide la remise du véhicule (US-703)
- Ajouté : débits après le voyage sur la carte enregistrée, une seule opération par débit avec le montant de chaque part, après le préavis du réseau (Visa : 20 jours pour un dommage ; Mastercard et Amex : accord écrit), en trois essais au plus (J0, J+3, J+7) ; sinon une dette qui bloque les nouvelles réservations, levée au paiement (US-703)
- Ajouté : paiements partiels d'une dette répartis entre les parts sans jamais retirer une part déjà payée (US-703)
- Sécurité : seul un jeton du prestataire de paiement est gardé, jamais un numéro de carte ; aucun débit hors d'une tentative planifiée par la base ; aucun débit réel avant le branchement d'un prestataire de paiement (US-703)
