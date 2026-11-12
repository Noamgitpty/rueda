lot: L1
module: KYC

- Ajouté : décision KYC de la Bêta par l'ops (`KYC_DECISION`) : approuver, refuser ou demander une nouvelle pièce, avec quatre contrôles cochés (liveness, pièce selon le statut, liste des permis, doublons) et un motif journalisés ; jamais sa propre vérification, jamais après un retrait du consentement biométrique (US-106)
- Ajouté : mise en file KYC de tout dossier qui entre en revue manuelle, et dossier KYC de la file complété (état, motif, permis, scores, sans image) (US-106)
- Sécurité : OQ-BR-21 en défaut prudent : un permis international seul ou un permis provisoire n'est jamais approuvé (US-106)
  module: Console interne
- Ajouté : alerte de délai des files de revue (une alerte par élément en retard) et formulaire de décision KYC dans la console, en es, en, fr et pt-BR (US-106)
  module: Site
- Ajouté : messages au voyageur après une décision de l'ops (refus, nouvelle pièce demandée) sur l'écran S04, en es, en, fr et pt-BR (US-106)
