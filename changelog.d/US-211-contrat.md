lot: L2
module: Réservation

- Ajouté : chaque trip confirmé reçoit un contrat de location entre l'hôte et le voyageur, généré à partir du devis payé (prix, protection et franchise, caution, distance incluse, somme retenue en cas d'annulation tardive, tolérance de retard, interdiction de sortir du pays) ; la plateforme y figure comme intermédiaire, jamais comme loueur ; texte en espagnol qui fait foi avec une traduction de courtoisie en anglais, français ou portugais ; modèle BROUILLON à faire valider par l'avocat (migration 0122) (US-211)
- Ajouté : le voyageur signe électroniquement la dernière version du contrat (heure du serveur, empreinte du document, sceau) ; un document modifié est refusé (`CONTRACT_HASH_MISMATCH`) ; une nouvelle version remplace l'ancienne, qui reste consultable (US-211)
- Modifié : la remise du véhicule est refusée tant que le voyageur n'a pas signé la dernière version du contrat (`CONTRACT_NOT_SIGNED`) (US-211)
- Sécurité : le contrat ne montre que le prénom et l'initiale du nom du voyageur, jamais un numéro de pièce ; les données nominatives sont tenues hors du registre immuable pour rester pseudonymisables (US-211)
