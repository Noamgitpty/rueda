lot: L1
module: Légal et données personnelles

- Ajouté : registre Ley 81 en base (sous-traitants, traitements, règles de rétention par pays) et gabarits du registre et de la politique de confidentialité à valider par l'avocat (US-111)
- Ajouté : KYC de production refusé tant que le registre du pays n'est pas validé (`KYC_PRODUCTION_BLOCKED_NO_REGISTER`) (US-111)
- Ajouté : pseudonymisation des trips clos sans litige à l'échéance `evidence_retention_months`, purge journalisée, par le travailleur `privacy_request` (US-111)
- Modifié : `HANDLE_DSR` suit chaque demande de personne (type, étape, échéance légale, retard signalé) ; formulaire dédié du back-office en es, en, fr et pt-BR (US-111)
- Ajouté : alerte des demandes d'effacement KYC en attente ou en échec (US-111)
