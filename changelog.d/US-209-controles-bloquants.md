lot: L2
module: Réservation

- Ajouté : contrôles bloquants du conducteur au checkout, avec un code stable et un message en espagnol, anglais, français et portugais : vérification d'identité non approuvée, consentement biométrique absent ou retiré, permis échu avant la fin du trip, âge minimum de la classe du véhicule non atteint au début du trip (US-209)
- Ajouté : règles de risque de la bêta déclarées et expliquées (permis étranger au-delà de 90 jours après l'entrée, compte de moins de 24 h, départ dans moins de 3 h, classe Premium ou Luxe) ; une réservation signalée passe en revue avant tout débit, jamais refusée, et entre dans la file de revue de l'ops (US-209)
- Ajouté : déclaration du statut et de la date d'entrée du voyageur dans le pays, pour le contrôle des 90 jours du permis étranger ; la revue du permis étranger est un réglage par pays, désactivé au Panama et au Paraguay (US-209)
- Modifié : un consentement biométrique retiré rend toujours le même refus au checkout, au paiement et à la conversion ; l'écran de checkout affiche le message propre à chaque refus du conducteur (US-209)
- Sécurité : les mêmes contrôles du voyageur sont relus au démarrage du paiement et à la conversion (restriction, consentement, conducteur) : aucun paiement ni trip pour un voyageur devenu inéligible (US-209)
