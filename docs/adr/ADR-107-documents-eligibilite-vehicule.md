# ADR-107 — Documents et éligibilité du véhicule, revue sur liste de contrôle fermée, contestation de plaque

- **Statut** : PROPOSÉ (US-124, agent back-end, claude-opus-5-5, 2026-11-12). Revues probables (`review-requirements.json`, story US-124) : code, architecture (`packages/db/`, nouvelle dérogation de forme : contrainte recréée en exclusion), **sécurité** (RLS, `SECURITY DEFINER`, pièces C2, accès de l'ops journalisés, libération d'un véhicule d'un autre hôte), UX (`Revue design : OUI`), QA ; sécurité sur un autre modèle que l'auteur.
- **Sources** : 19 US-124 (critères 1 à 4) ; 16 HST-019, HST-039 ; 08 BR-LIST-01, BR-LIST-02, BR-LIST-03 ; 17 §2.4, §3.2.3, §3.1.3 point 1, §5, §7.2 ; 22 OQ-P2P-02, OQ-BR-28, OQ-CAT-01 (g) ; ADR-097, ADR-099, ADR-104 ; BOARD N-37, N-61 ; pré-mortem L1-PM-11, L1-PM-14, L1-PM-15, L1-PM-41 à L1-PM-43.

## Décision

1. **Pièces** (`catalog_vehicle_document`, migration 0077) : TITLE, OWNER_AUTHORIZATION, PLATE_VIN_PHOTO, INSPECTION, LENDER_CONSENT, COMPULSORY_INSURANCE ; une pièce vivante par type (la suivante passe SUPERSEDED), jamais supprimée. Fichier `file_asset` du seau **privé** `DOCUMENTS`, C2, chiffré par la clé USER de l'hôte (politique `catalog_cmd_doc_insert` : `enc_subject_id = uploader_user_id`), écrit par la commande avant le dépôt. Ordre côté API (fail-closed) : taille, type réel (JPEG, PNG, HEIC, PDF), **droit jugé par la base avant l'antivirus**, antivirus (seul CLEAN du type réel libère), puis une transaction : clé, ligne, chiffrement, dépôt. Production : antivirus (ClamAV, DEC-FONDATEUR-20), coffre et stockage `Unavailable*` ⇒ 503, dépôt annoncé fermé à l'écran. Aucune route ne rend une pièce à l'hôte.
2. **Paramètres par pays** (0078, générée depuis `params.json`) : `elig_age_years_ceiling` (10), `elig_odometer_km_ceiling` (200 000, le plafond lui-même refusé : « < 200 000 km »), `elig_doc_title`, `elig_doc_plate_vin_photo`, `elig_doc_inspection` (true, true), `elig_doc_compulsory_insurance` (PA true, PY false : 16 HST-039). Tous **PROPOSÉS, À DÉCIDER** (J-ADM-031). Absents ⇒ `PARAM_MISSING` (seuils) ou pièce exigée (fail-closed) ; `vehicle_financed_requires_lender_consent` absent ⇒ true. Noms sans « vehicle … max » : la garde de DEC-FONDATEUR-19 (aucun plafond de flotte) les refuserait.
3. **Soumission du véhicule** (`catalog_cmd_submit_vehicle_eligibility`) : règles automatiques non strictes, dans l'ordre : libéré, hors catalogue (`CATALOG_ADDITION_PENDING`), âge (`VEHICLE_TOO_OLD`, années civiles du fuseau du pays), compteur et déclarations (`VEHICLE_FIELD_REQUIRED`, `VEHICLE_MILEAGE_TOO_HIGH`), titre d'un tiers sans autorisation (`VEHICLE_TITLE_MISMATCH`, motif « titre »), prenda sans consentement (`VEHICLE_LENDER_CONSENT_REQUIRED`), pièce exigée absente ou échue. Refus : ligne `REFUSED` (codes seulement) et motifs relus par l'hôte ; sinon élément de la file `LISTING` (sujet `VEHICLE`). Pendant la revue, rien ne change (`VEHICLE_UNDER_REVIEW`). La soumission d'annonce (US-115) n'est pas modifiée : la publication (US-118) lira `core.catalog_vehicle_publishable`.
4. **Revue de l'ops** : liste de contrôle **fermée** (TITLE_HOLDER, TITLE_CLEAN, PLATE_MATCH, VIN_MATCH, LIEN, INSPECTION, REGISTRY ; chaque point PASS ou FAIL, REGISTRY peut valoir NOT_CONSULTABLE en bêta) et un verdict par pièce soumise ; clé manquante ou en trop, pièce sans verdict, date impossible ⇒ `CHECKLIST_INVALID`, rien n'est écrit. Le résultat est **calculé** : titre interdit ou registre défavorable ⇒ INELIGIBLE ; tout point en échec ou règle stricte (pièces VALID non échues) ⇒ PENDING avec motifs (plaque ou VIN discordants : critère 2) ; sinon ELIGIBLE. Dossier (plaque, VIN, noms légaux du titulaire) et pièces lus par l'ops pris en charge (ADMIN : sa portée), **journalisés avant d'être rendus** (`data_access_log` READ_C2_SUPPORT puis `STAFF_DATA_ACCESS`), motif exigé.
5. **Contestation (N-61)** : l'hôte dont la plaque ou le VIN est pris par un **autre** compte du même pays ouvre une contestation avec son titre (même chaîne de dépôt) ; l'ops la lit ; **UPHOLD réservé à l'ADMIN** (PROPOSÉ) : le véhicule en cause est libéré (`released_at`, INELIGIBLE, annonces vivantes REMOVED_BY_PLATFORM, revue vivante annulée), sa plaque et son VIN redeviennent disponibles ; DISMISS motivé. Pour permettre la libération : `catalog_vehicle_plate_unique` recréée sous son nom en contrainte d'**exclusion** partielle (`WHERE released_at IS NULL`), `catalog_vehicle_vin_unique` recréé partiel ; même garantie tant qu'aucun véhicule n'est libéré. Rien n'est révélé au demandeur du compte en cause.
6. **Nom affiché au voyageur (N-37)** : premier mot du prénom légal d'un compte ACTIVE (`core.iam_host_public_first_name`, iam_auth_owner, EXECUTE à catalog_cmd_owner seul), servi par `GET /listings/{id}` (`hostFirstName`) ; jamais le nom de famille ni le nom légal complet ; plaque et VIN jamais dans la fiche publique.

## Conséquences

- Preuves L0 PA / PY sous `app_api` : `l0-us124-vehicle-documents` (critères 1 à 4 avec témoins, liste fermée, IDOR, console, contestation, N-37) ; contrats `vehicle-documents.contract`, `console.contract`.
- Nouveaux codes PROPOSÉS pour 16 A.8 (voir `errors.ts`, `ops-errors.ts`) ; à reporter dans 17 §3.2.3 (tables, colonnes) et §7.2 (paramètres `elig_*`).

## Limites et reports

- Tâche quotidienne d'expiration (16 HST-039 « annonce RESTRICTED ») non livrée : une pièce échue rend déjà le véhicule non publiable (règle stricte) ; restriction et notification `EVT_VEHICLE_DOCUMENT_EXPIRING` à une story suivante.
- Écran de console (backoffice) de la revue du véhicule et des contestations non livré : routes `/console/queues/items/{id}/vehicle…` prêtes.
- Aucun événement outbox (résultat de la revue, contestation) : l'hôte relit son état ; NTF à venir.
- Contestation limitée au pays du demandeur (VIN pris dans un autre pays : non couvert). Trips en cours d'un véhicule libéré : laissés à l'ops.
- Registres publics (Registro Público PA, DNRA PY) : consultation manuelle en bêta.
- Pièces en production : attendent US-003 (ClamAV, KMS, stockage, URL signée).

## Alternatives écartées

- **Contrôles de documents à la soumission d'annonce** : aurait cassé les témoins d'US-114, US-115, US-126 sans gain ; la publication (US-118) exige l'éligibilité.
- **Case « éligible » choisie par l'ops** : contraire à L1-PM-14 ; le résultat est calculé.
- **Nouvelle file `VEHICLE_ELIGIBILITY`** : la contrainte `review_queue_queue_valid` aurait dû être recréée ; la file `LISTING` (même permission, 16 HST-016) suffit, le sujet distingue.
