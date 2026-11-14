lot: L1
module: Red team

- Ajouté : passe n° 2 de la red team du lot 1, tests d'attaque exécutables (droits des personnes, téléversements, hôte défaillant, doublon d'identité, rappel KYC, entrées de console hors de la garde de séparation des tâches) et rapport des constats (US-122)

lot: L1
module: Console interne

- Corrigé : la garde unique de séparation des tâches (ADR-122) couvre toutes les entrées de la console : prise d'un élément de file, dossiers KYC et d'hôte (ADMIN compris), constat de comptes liés ; un co-hôte ne décide plus le KYC ni la restriction du titulaire ; refus `SELF_FORBIDDEN` journalisé (constats F2-C-01 à C-03, C-05, US-122, ADR-124)
- Corrigé : la fiche 360° d'un hôte liste les trips à venir de ses comptes d'hôte, sans le voyageur (constat F2-T-01, US-122)

lot: L1
module: Règlement et finance

- Corrigé : un agent FINANCE titulaire, co-hôte ou lié au compte d'une avance ne demande ni n'approuve une décision sur cette avance ; aucun montant, aucune jambe ni aucun règlement touché (constat F2-C-04, US-122, ADR-124)

lot: L1
module: Vérification d'identité et d'hôte

- Corrigé : la même personne (même nom et même date de naissance vérifiés) qu'un hôte déjà approuvé n'est plus approuvée une seconde fois, ni par l'ops ni automatiquement ; le dossier part en revue de l'ops (constat de comptes liés), sans étape de plus pour l'hôte (constat F2-A03-01, US-122, ADR-124)
- Corrigé : une demande d'effacement KYC refusée par le fournisseur est reprise (nouveau retrait, ou commande `kyc_cmd_retry_erasure` de la personne) ; aucun hold n'est posé après le retrait du consentement biométrique (constats F2-D-02, F2-D-03, US-122)

lot: L1
module: Données personnelles

- Corrigé : une demande de personne gelée (`BLOCKED_LEGAL_HOLD`) passée son échéance est signalée en retard (constat F2-D-01, US-122)

lot: L1
module: Catalogue et annonces

- Corrigé : une image qui annonce plusieurs tailles est jugée sur la plus grande ; taille d'une photo, photos d'une galerie et dépôts de pièces par minute bornés par pays (`upload_photo_max_kb` = 10 240, `upload_gallery_photos_max` = 100, `upload_documents_per_minute` = 20, PROPOSÉS ; `PHOTO_LIMIT_REACHED`, `DOCUMENT_RATE_LIMITED`) (constats F2-U-01, F2-U-02, US-122)

lot: L1
module: Notifications

- Ajouté : le voyageur d'un trip à venir est prévenu quand l'hôte est restreint (`booking.trip.host_restricted`, gabarit `EVT_TRIP_HOST_RESTRICTED`, es, en, fr, pt-BR, canaux FAKE) (constat F2-T-02, US-122)
