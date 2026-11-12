lot: L1
module: Disponibilité et calendrier

- Ajouté : calendrier par véhicule de l'hôte (trips, holds, blocages, tampons à venir, bornes en heure locale du véhicule), blocages par jour ou par heure au pas de 30 min et levée, par commande sur la table d'occupation unique (exclusion GiST, verrou du véhicule) (US-119)
- Ajouté : préavis minimum par lieu de remise (1 h à 7 jours, défaut du pays sinon, plancher de la classe du véhicule) ; un départ dans le préavis est refusé à la pose du hold (`DATES_NOTICE_TOO_SHORT`) (US-119)
- Ajouté : sonde de disponibilité `core.catalog_vehicle_is_free` (annonce publiée seulement, période arrondie à l'heure, booléen seul), branchée à la recherche par US-201 (US-119)
- Ajouté : écran A06 (calendrier, blocages, préavis) en es, en, fr et pt (US-119)
