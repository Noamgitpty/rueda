lot: L2
module: Réservation

- Ajouté : le voyageur lit son contrat de location dans l'application (résumé en tête, texte complet dans sa langue et en espagnol qui fait foi, PDF) et le signe par une case et un bouton ; l'heure du serveur et le sceau s'affichent une fois signé ; le lien « Leer y firmar el contrato » apparaît sur l'écran de paiement confirmé (US-211)
- Ajouté : l'hôte lit le contrat du trip depuis le détail de la réservation et voit si le voyageur l'a signé (sans signature, pas de remise) (US-211)
- Ajouté : routes `/trips/{id}/contract` (lecture, PDF rendu de nouveau et servi seulement s'il redonne l'empreinte enregistrée, signature) ; le contrat d'une autre personne répond comme un contrat inconnu (US-211)
- Modifié : les nouveaux contrats nomment le pays et l'heure locale au lieu du fuseau, impriment le bandeau BROUILLON en tête et sortent le nom du voyageur du bloc de signature ; une retenue d'annulation sans libellé connu fait échouer la génération (US-211)
- Sécurité : un PDF signé présenté se vérifie par un nouveau rendu (un octet modifié ⇒ `CONTRACT_HASH_MISMATCH`) ; deux signatures simultanées n'en écrivent qu'une, et une signature pendant une régénération est refusée (US-211)
