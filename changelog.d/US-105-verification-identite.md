lot: L1
module: KYC

- Ajouté : vérification d'identité par parcours hébergé du fournisseur (FAKE seulement), consentement biométrique séparé et versionné, décision par rappel signé idempotente, aucune image gardée (US-105)
- Ajouté : contrôle bloquant du permis pour le paiement (`KYC_LICENSE_EXPIRED`) à poser par US-209 (US-105)
- Sécurité : rappels rejetés journalisés (empreinte du corps), KYC de production fermé tant que le registre n'est pas validé (US-105)
  module: Site
- Ajouté : écran S04 « Vérifie ton identité » en es, en, fr et pt-BR (US-105)
