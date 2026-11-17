lot: L2
module: Réservation

- Ajouté : réservation sur demande, côté serveur : quand l'hôte a choisi de répondre aux demandes, le voyageur autorise le paiement en envoyant sa demande ; rien n'est débité tant que l'hôte n'a pas accepté (US-223)
- Ajouté : l'hôte accepte ou refuse une demande dans les 4 heures ; à l'acceptation, le paiement est débité avec le montant exact de chaque part (hôte, assureur, taxe, plateforme) du devis accepté ; un refus ou une absence de réponse annule l'autorisation et libère l'auto (US-223)
- Ajouté : messages clairs pour l'hôte dans les quatre langues : demande introuvable, demande expirée, demande déjà traitée, voyageur qui ne peut plus réserver, montant non confirmé ; aucun débit dans chaque cas (US-223)
- Ajouté : alerte au support quand l'annulation d'une autorisation n'est pas confirmée après 30 minutes (US-223)
- Modifié : le mode sur demande reste fermé dans chaque pays tant que ses écrans ne sont pas livrés : une annonce sur demande n'est jamais réservée comme une réservation immédiate (US-223)
