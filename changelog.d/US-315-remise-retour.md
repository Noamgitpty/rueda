lot: L3
module: Remise et retour

- Ajouté : l'hôte et le voyageur ouvrent la remise au plus tôt 24 h avant le début ; elle reste bloquée, avec la cause affichée, tant que le paiement n'est pas prouvé par webhook signé, que le contrat n'est pas signé, que la caution exigée n'est pas autorisée ou que le contrat d'assureur du pays n'est pas actif (US-315)
- Ajouté : à la remise, l'hôte contrôle le permis présenté en six points (photo, prénom et initiale, année de naissance, validité, non provisoire, restrictions) en ne voyant que le prénom, l'initiale du nom et l'année de naissance du voyageur ; un point non conforme arrête la remise (US-315)
- Ajouté : chaque partie relève le compteur et le carburant et valide ; la seconde validation fait passer le trip en cours (remise) ou rendu (retour) à l'heure du serveur, libère le créneau au retour et enregistre les clés remises en personne (US-315)
- Ajouté : écrans A03 / A04 de l'hôte et S09 du voyageur, en quatre langues, avec un lien depuis le détail du trip (US-315)
- Sécurité : aucune heure de l'appareil n'est acceptée ; une validation rejouée rend l'heure d'origine ; deux validations simultanées s'exécutent l'une après l'autre (une seule transition) ; la remise sans rencontre n'est jamais proposée ni acceptée ; sans réseau, rien n'est mis en file (US-315)
