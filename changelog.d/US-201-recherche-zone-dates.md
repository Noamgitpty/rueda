lot: L2
module: Catalogue et recherche

- Ajouté : recherche publique par zone, lieu de remise, dates et heures (`GET /search`, `GET /search/areas`) : annonces publiées d'hôtes activables seulement, zone approximative, jamais l'adresse exacte ; heures du lieu au pas de 30 min, fuseau du pays ; refus `SEARCH_DATES_INVALID`, `SEARCH_LOCATION_REQUIRED`, `SEARCH_DURATION_EXCEEDED` (US-201)
- Ajouté : écran S01 avec la recherche, liste des voitures disponibles et dates reprises sur la fiche, en espagnol, anglais, français et portugais (US-201)
- Sécurité : sonde de disponibilité limitée par IP (`availability_probe_per_minute`) et lue uniquement par `catalog_vehicle_is_free`, période arrondie à l'heure (US-201)
- Ajouté : parcours e2e S01 → résultats → fiche avec dates → retour, et balayage axe-core et captures des écrans de recherche (liste, aucun résultat, refus, indisponible) et de la fiche avec dates, dans les quatre langues (US-201)
- Modifié : heure locale affichée avec le nom de la ville au lieu de l'identifiant du fuseau ; état « aucune voiture » plus neutre (US-201)
