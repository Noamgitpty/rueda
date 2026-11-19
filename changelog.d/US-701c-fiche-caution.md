lot: L2
module: Paiements

- Modifié : la fiche du véhicule et les cartes de la recherche annoncent la caution par la même décision que le paiement (`deposit_amount` du pays et de la classe, US-701c, ADR-173) : montant si le pays ou la classe l'impose, sinon mention générique ; elles ne lisent plus l'ancienne politique de caution, vide en production
- Ajouté : « caution non disponible » sur la fiche et les cartes quand la classe impose une caution dont le montant n'est pas encore fixé (LUXE aujourd'hui), avec le texte que la page de paiement affichera, en espagnol, anglais, français et portugais du Brésil (US-701c)
- Ajouté : statut de la caution (`depositStatus`) dans les cartes de `GET /search` et dans `GET /listings/{id}/conditions` ; ni la classe ni un déclencheur ne sont rendus (US-701c)
- Ajouté : lecture de la base de la caution (pays, devise, classe du catalogue) réservée à l'API (migration 0150, US-701c)
