lot: L2
module: Paiement

- Ajouté : bouton « Pagar {montant} » sur la réservation gardée (S05) : le voyageur paie sur la page sécurisée du prestataire de paiement ; le site n'envoie jamais de montant, la plateforme transmet le montant exact de chaque part (hôte, assureur, taxe, plateforme) lu dans le devis accepté (US-223)
- Ajouté : écran d'attente et de résultat du paiement (S06) : « Pago en verificación » tant que la preuve n'est pas arrivée, confirmé seulement quand la réservation est née d'un paiement prouvé, refus avec « Pagar de nuevo » et l'heure jusqu'à laquelle l'auto reste gardé, réservation expirée sans débit, paiement non confirmé (numéro de réservation pour le support), remboursement intégral d'un paiement reçu après la libération de l'auto (US-223)
- Ajouté : routes `POST` et `GET /checkout/holds/{holdId}/payment` ; un seul ordre de paiement en cours par réservation, aucun second ordre pendant qu'un paiement est en cours ; refus clairs dans les quatre langues : paiement indisponible, paiement pas encore possible pour cet auto, réservation en revue, réservation expirée (US-223)
- Modifié : le message de refus de paiement ne cite plus de durée : l'heure limite vient de la réservation (US-223)
