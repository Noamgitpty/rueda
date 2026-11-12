lot: L1
module: Catalogue et annonces

- Ajouté : lieux de remise, véhicules et annonces de l'hôte (brouillon, tarif, soumission, suppression) par commandes de la session, plaque et VIN uniques, prix au pas du pays, zone approximative seule sur la fiche publique (US-115)
- Ajouté : réception des photos d'annonce (type réel, taille, dimensions, métadonnées EXIF retirées, antivirus fail-closed), paramètre `listing_min_photos` (US-115)
- Sécurité : clé étrangère du véhicule sur l'occupation, le hold et le trip ; gardes de blocage et de réservation sur le catalogue réel ; IDOR entre hôtes refusé par 404 (US-115)
- Sécurité : plafonds de cohérence du prix journalier et du prix du km par pays (`price_ceiling_*`, PROPOSÉS, migration 0069), borne contre le débordement du bigint ; photos nettoyées par liste blanche (rien après la fin du JPEG, MPF, fragments PNG et WebP inconnus) (US-115)
- Corrigé : changer le prix d'une annonce à distance incluse garde le prix du km ; une annonce supprimée (avec confirmation) libère son véhicule ; saisie ambiguë du prix refusée, exposant relu de l'API ; sélecteur de compte d'hôte, pays et devise affichés ; dépôt de photos fermé et taille maximale annoncés d'emblée (US-115)
- Ajouté : écrans A10 (espace de l'hôte : lieux, autos, brouillon, prix, photo, soumission) et S03 (fiche publique, zone approximative seulement), en es, en, fr et pt (US-115)
