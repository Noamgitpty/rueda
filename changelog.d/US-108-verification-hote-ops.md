lot: L1
module: KYC

- Ajouté : vérification de l'hôte par exception, comme Turo (consigne du fondateur du 2026-11-12) : un dossier complet et sans signal est approuvé automatiquement par le travailleur après un délai uniforme (`host_review_auto_delay_minutes`, 24 h, PROPOSÉ), sans revue de l'ops ; aucune approbation automatique d'un compte restreint, fermé ou banni ; l'ops n'intervient que sur une retenue de sanctions ou si `host_review_manual_required` le demande (défaut false) ; aucune pièce de plus pour l'hôte (US-108)
- Ajouté : filtrage manuel des sanctions par l'ops (`HOST_SANCTIONS_SCREENING`) : listes de l'ONU, OFAC et nationale, résultat par liste, source, date et relecteur au dossier ; une correspondance est retenue et transmise à un ADMIN, sans que l'hôte le sache (US-108)
- Sécurité : contrat de l'assureur partenaire et couverture du véhicule à la soumission d'une annonce : véhicule hors critères refusé (`VEHICLE_NOT_COVERED`) ; sans contrat en vigueur, jamais couvert (`INSURER_CONTRACT_INACTIVE`, fail-closed) ; codes 422 et textes en es, en, fr et pt-BR (US-108)
  module: Console interne
- Ajouté : dossier de l'hôte signalé dans la console : liste de contrôle fermée calculée par la base, retenue de sanctions visible du staff, source et date du filtrage, filtrage manuel des trois listes, lecture journalisée, en es, en, fr et pt-BR (US-108)
