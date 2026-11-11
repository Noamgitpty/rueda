lot: L1
module: Comptes et consentements (IAM, CTR, site)

- Ajouté : consentements versionnés CGU du voyageur, confidentialité et communications (`core.contract_consent`, registre immuable), avec version, langue et horodatage de la base ; aucune inscription sans CGU ni confidentialité, imposé par la base (US-102, ADR-091)
- Ajouté : gabarits juridiques versionnés publiables sans déploiement (`core.contract_document_template`, permission `legal.publish`) ; version 1 BROUILLON en es, en, fr et pt, à valider par le juridique (US-102, ADR-091)
- Ajouté : routes `/legal` (documents en vigueur, état et historique des consentements, réacceptation, communications) et garde `TermsGuard` : `TERMS_REACCEPT_REQUIRED` après une version majeure, avant toute réservation (US-102)
- Ajouté : écrans S15 du site (inscription, connexion, documents, réacceptation, vérification de l'e-mail) en es, en, fr et pt, sans JavaScript ; parcours e2e à 360 et 390 px (US-102)
- Modifié : `POST /auth/signup` reçoit les versions affichées, l'opt-in des communications et le pays du parcours ; 409 `TERMS_VERSION_CHANGED`, 503 `LEGAL_DOCUMENT_UNAVAILABLE` (US-102)
