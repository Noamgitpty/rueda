lot: L1
module: Catalogue et annonces

- Ajouté : file d'ajout au catalogue véhicules : un véhicule saisi hors catalogue ouvre une demande et un élément de la file `CATALOG_ADDITION` (délai du pays) ; son annonce reste en brouillon (`CATALOG_ADDITION_PENDING`) tant qu'il n'est pas rattaché à une variante (US-114)
- Ajouté : décision de l'ops dans la console O01 : rapprochement d'une variante existante, création d'une variante sous licence (source `HOST_REQUEST`) ou refus motivé ; le véhicule reçoit sa variante, l'hôte est notifié (e-mail, puis SMS) (US-114)
- Ajouté : statut de la demande, échéance, motif d'un refus et nouvelle demande dans l'espace de l'hôte (A10), en es, en, fr et pt-BR (US-114)
- Sécurité : commandes de la console (TOTP, permission de la file dans le pays de l'élément, élément pris en charge, refus journalisés) séparées des fonctions de domaine du catalogue ; aucun droit applicatif sur les demandes (US-114)
- Sécurité : au plus trois refus par véhicule, aucune nouvelle demande après un refus « véhicule non admis » ; une variante commune n'est jamais doublée (US-114)
