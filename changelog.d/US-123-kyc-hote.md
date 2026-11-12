lot: L1
module: KYC

- Ajouté : inscription et vérification individuelle de l'hôte (dossier, âge vérifié par le KYC, résidence vérifiée prioritaire, CGU de l'hôte), décision de l'ops `HOST_VERIFICATION_DECISION` et activation gardée en base (US-123)
- Ajouté : filtrage des sanctions de l'hôte (port `SanctionsScreener`, FAKE seulement) ; correspondance ⇒ dossier bloqué, aucune donnée de la liste copiée (US-123)
- Ajouté : profil fiscal de l'hôte (type admis par le pays, numéro chiffré par la clé du compte d'hôte, personne physique seulement) (US-123)
- Sécurité : aucun hôte activé tant que `p2p_private_hosts_enabled` ou `insurer_contract_active` du pays vaut false, sans sous-marchand ACTIVE ni avec une capacité bloquante du PSP non validée (US-123)
- Sécurité : une correspondance de sanctions n'est jamais révélée à l'hôte ; escalade en file de revue, événement interne et action de console `HOST_SCREENING_REVIEW` (US-123)
  module: Site
- Ajouté : écran A07 « Deviens hôte » (liste de tâches, profil fiscal, envoi) en es, en, fr et pt-BR (US-123)
