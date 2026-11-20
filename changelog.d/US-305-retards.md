lot: L3
module: Retards

- Ajouté : un trip non rendu passe automatiquement en retard à la fin prévue plus le délai du pays (30 minutes par défaut), à l'heure du serveur ; le voyageur et l'hôte reçoivent une seule alerte, l'ops aussi (US-305)
- Ajouté : pendant le retard, le véhicule reste réservé par tranches d'une heure (plus le tampon), sans jamais empiéter sur la réservation suivante ; si elle est touchée, elle est marquée à risque, l'hôte est prévenu en quatre langues et l'ops reçoit une alerte pour reloger le voyageur suivant (US-305)
- Sécurité : un retour validé avant l'échéance n'est jamais marqué en retard ; une minuterie rejouée ou deux travailleurs simultanés ne produisent jamais une seconde alerte ; un changement du délai ne s'applique qu'aux trips réservés ensuite ; aucun montant n'est calculé ni débité ici (frais de retard : US-703) (US-305)
