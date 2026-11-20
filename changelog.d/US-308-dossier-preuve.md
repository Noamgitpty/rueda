lot: L3
module: Preuves et litiges

- Ajouté : l'ops demande depuis la console le dossier de preuve d'un trip (assureur partenaire, litige, chargeback, ACODECO) ; la base scelle un manifeste qui liste chaque fichier avec son SHA-256 : contrat et signature, versions des conditions acceptées, photos de départ et de retour des deux parties avec l'heure du serveur, fil de messages, journal du trip, et les pièces absentes (US-308)
- Ajouté : l'archive ZIP est générée après le recalcul de chaque empreinte sur les octets stockés ; un écart, un fichier absent ou un contrat qui ne se rend plus à l'identique devient un constat et rien n'est remis (`EVIDENCE_EXPORT_FAILED`) ; lien valable 7 jours (US-308)
- Sécurité : export réservé à l'ops du dossier de support ouvert du trip (permission `evidence.export`), jamais à un hôte, un voyageur ni un co-hôte ; chaque demande, chaque téléchargement et chaque refus sont journalisés avec leur motif ; seul le demandeur ouvre l'archive (chiffrée par sa clé) ; ni pièce d'identité, ni permis, ni nom dans le manifeste (US-308)
- Sécurité : en production, les routes du dossier répondent 503 tant que le coffre et le stockage à verrou objet ne sont pas branchés (US-308)
