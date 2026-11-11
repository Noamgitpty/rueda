lot: L1
module: Catalogue et annonces

- Ajouté : lieux de remise, véhicules et annonces de l'hôte (brouillon, tarif, soumission, suppression) par commandes de la session, plaque et VIN uniques, prix au pas du pays, zone approximative seule sur la fiche publique (US-115)
- Ajouté : réception des photos d'annonce (type réel, taille, dimensions, métadonnées EXIF retirées, antivirus fail-closed), paramètre `listing_min_photos` (US-115)
- Sécurité : clé étrangère du véhicule sur l'occupation, le hold et le trip ; gardes de blocage et de réservation sur le catalogue réel ; IDOR entre hôtes refusé par 404 (US-115)
