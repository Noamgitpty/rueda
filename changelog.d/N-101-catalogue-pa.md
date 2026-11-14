lot: L1
module: Catalogue et annonces

- Modifié : les marques et modèles importés de la douane (variantes sans fiche) sont proposés aux hôtes de tous les pays, au même titre que ceux d'origine : un hôte du Panama trouve les 52 marques et 643 modèles venus de la douane (migration 0095, suite d'US-113, N-101, ADR-123)
- Ajouté : lot 2 de curation de l'import de la douane, JMC Vigor rétabli, variante commune à tous les pays (migration 0096) ; rapprochements Trucker → Tracker et Sport → EcoSport confirmés sur les libellés bruts (suite d'US-113, N-101)
- Ajouté : empreinte SHA-256 du fichier source de la douane dans les données du catalogue, vérifiée par le générateur (suite d'US-113, N-101)
- Ajouté : retour arrière de l'import documenté et prouvé sous `migrator` (retrait par RETIRED, NOT NULL impossibles à rétablir tant qu'une ligne sans fiche existe) ; parcours prouvé jusqu'à l'annonce publique sur une variante sans fiche, en PA et en PY (suite d'US-113, N-101)
