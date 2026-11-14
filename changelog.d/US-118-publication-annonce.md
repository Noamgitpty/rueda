lot: L1
module: Catalogue et annonces

- Ajouté : publication immédiate d'une annonce dès que les contrôles automatiques passent (photos, zone sans adresse exacte, CGU de l'hôte, compte activé, pays ouvert, véhicule publiable, contrat d'assureur actif), sans revue systématique de l'ops (US-118)
- Ajouté : retrait d'une annonce par l'hôte et remise en ligne ; retrait et suppression refusés tant qu'un trip est à venir (US-118)
- Ajouté : revue de l'ops seulement si le pays l'exige (`listing_manual_review_required`, false par défaut) : approbation qui revérifie les contrôles, refus motivé (US-118)
- Ajouté : filtre automatique de la zone affichée du lieu de remise, qui refuse une adresse exacte (rue et numéro, angle de rues) avec un message dédié (US-118)
- Modifié : un véhicule hors catalogue ne bloque plus l'annonce ; la demande d'ajout au catalogue suit son cours (US-118)
