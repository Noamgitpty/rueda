lot: L2
module: Tarification et devis

- Ajouté : protection du voyageur dans chaque devis (niveaux BASICA, ESTANDAR et TOTAL ; BASICA présélectionnée et obligatoire) : prix par jour en part du prix journalier net, borné, × jours facturables, grille du pays ; prime due à l'assureur dans la jambe de l'assureur (US-226)
- Ajouté : le total des cartes de résultats et de la fiche du véhicule comprend la protection minimale du pays (US-226)
- Modifié : moteur de devis `prc.quote/3` ; la base recalcule la protection, la prime de l'assureur et la part de l'hôte selon le plan du véhicule avant de figer un devis et refuse tout écart (migration 0110) (US-226)
- Ajouté : grille des protections et parts de l'assureur de test, à décider avec le contrat de l'assureur (migration 0111) (US-226)

lot: L2
module: Réservation

- Ajouté : niveau de protection et âge déclaré du conducteur au devis du checkout ; niveaux proposés et leur prix dans le devis lu ; niveau le plus haut refusé à un conducteur trop jeune (US-226)
- Ajouté : l'écran de checkout affiche la ligne de protection du voyageur, nommée par son niveau, dans le détail du prix (US-226)
- Sécurité : aucun trip sans protection (`PROTECTION_LEVEL_REQUIRED`) ; aucune réservation sans contrat d'assureur actif dans le pays (`INSURER_CONTRACT_INACTIVE`) (US-226)

lot: L2
module: Espace hôte

- Ajouté : plan de gains par véhicule (plans vendus dans le pays, choix d'un plan), effet sur les nouveaux devis seulement ; plan ESTÁNDAR par défaut ; textes en espagnol, anglais, français et portugais (US-226)
