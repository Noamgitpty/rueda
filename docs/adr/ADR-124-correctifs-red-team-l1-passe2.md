# ADR-124 — Correctifs de la passe n° 2 de la red team du lot 1 : garde unique sur toute la console, doublon d'identité d'hôte, droits des personnes, plafonds de téléversement, hôte défaillant

- **Statut** : PROPOSÉ (US-122, agent dev-correctifs, claude-opus-5-5, 2026-11-14). Amende ADR-122 (garde unique de séparation des tâches), ADR-092 (cadre des actions de console), ADR-097 (files et fiche 360°), ADR-110 (comptes liés), ADR-111 (vérification de l'hôte par exception), ADR-102 (vérification d'identité), ADR-118 (registre Ley 81), ADR-099 et ADR-107 (photos et pièces), ADR-061 (catalogue des notifications). Migration 0097, graine générée 0098.
- **Sources** : rapport de la red team `docs/team/redteam/L1-passe2.md` (F2-C-01 à C-05, F2-A03-01, F2-D-01 à D-03, F2-U-01, F2-U-02, F2-T-01, F2-T-02) ; 17 §2.3 (« un agent ne décide pas sur son propre dossier », RLS-24), §5, §10 ; 16 ADM-001, ADM-005, VER-004, LEG-009, HST-012 ; 08 BR-ACC-06, BR-TRUST-09, BR-CXL-12 ; DEC-FONDATEUR-19 et 22 ; revues d'US-122 (architecture n° 3, sécurité n° 3).

## Contexte

La passe n° 2 a trouvé treize constats. Cinq portent sur la garde d'ADR-122 : des entrées de la console ne l'appelaient pas, et elle ignorait le co-hôte d'une personne. ADR-122 disait « quelle que soit l'action » : c'était faux. Les huit autres touchent le doublon d'identité d'un hôte, les droits des personnes, les téléversements et l'hôte défaillant.

## Décision

1. **Garde unique sur toutes les entrées (F2-C-01 à C-04)**. `core.support_actor_conflict` (ADR-122) est appelée aussi par :
   - la prise d'un élément de file, dans **toutes** les files (`support_staff_claim_item`) ;
   - la lecture du dossier KYC (`support_staff_kyc_dossier`) et du dossier d'hôte (`support_staff_host_dossier`), y compris pour un ADMIN ;
   - le constat de comptes liés (`risk_staff_decide_account_link`), sur chacun des deux comptes ;
   - les deux actions FINANCE à deux personnes, **à la demande et à l'approbation** (`settlement_cmd_request_finance_action`, `settlement_cmd_approve_finance_action`). Elles appellent la même garde par `core.support_staff_conflict` (SECURITY DEFINER sous `iam_staff_owner`, EXECUTE au seul `cmd_money_owner`). Aucun montant, aucune jambe ni aucun règlement n'est lu ou changé.

   L'issue est `SELF_FORBIDDEN`, journalisée (`STAFF_FORBIDDEN` avec `reason` = `SELF`, ou `FINANCE_SELF_APPROVAL_DENIED`). L'API rend 403 (`STAFF_SELF_FORBIDDEN` pour la console, `FORBIDDEN` pour l'approbation FINANCE). Avec la commande de console et les files LISTING et CATALOG_ADDITION d'ADR-122, **toute** entrée de la console qui prend, lit ou décide un sujet passe par cette garde : la formule « quelle que soit l'action » d'ADR-122 devient vraie.

2. **Asymétrie (F2-C-05)**. Pour `USER_ACCOUNT` et `IDENTITY_VERIFICATION`, les personnes du sujet sont la personne, plus le titulaire et les membres ACTIVE ou INVITED de **tous les comptes d'hôte dont elle est titulaire ou membre** (`core.support_person_people`). Le co-hôte d'une personne ne décide donc ni son KYC ni sa restriction. `RISK_ASSESSMENT` (file RISK_BOOKING) est jugé : compte d'hôte de l'évaluation et sa personne ou son trip. Un sujet d'une autre sorte est un conflit présumé (fail-closed).
3. **Doublon d'identité d'hôte (F2-A03-01), comme Turo**. Aucun document ni aucune étape de plus pour l'hôte honnête (DEC-FONDATEUR-22). `core.kyc_host_identity_duplicate` dit si le titulaire est la même personne qu'un **autre titulaire déjà approuvé comme hôte**. Le jugement reprend celui du signal `SAME_IDENTITY` (US-103, ADR-122) : même date de naissance vérifiée, et sacs de mots du nom inclus. Un constat `NOT_LINKED` de l'ops entre les deux personnes écarte le doublon.
   - Le second dossier n'est **jamais approuvé** :
     - ni par l'ops : refus `HOST_IDENTITY_DUPLICATE`, le dossier reste dans la file HOST_VERIFICATION ;
     - ni par le travailleur : issue `DUPLICATE_IDENTITY`, dossier laissé à l'ops.
   - Le dossier n'est **pas refusé** : il part en revue de l'ops, qui tranche par le constat de comptes liés (US-127). `NOT_LINKED` (deux personnes) libère l'approbation. `LINKED` (même personne) la ferme : l'ops refuse alors le dossier (BR-ACC-06).
   - Les approbations d'hôte sont sérialisées par un verrou consultatif. Deux dossiers jumeaux approuvés en même temps ne passent pas tous les deux.
   - Le hachage du numéro de permis reste au connecteur KYC réel (lot C, ADR-122) : le fournisseur `FAKE` n'en rend aucun.
4. **Droits des personnes**.
   - **F2-D-01** : une demande en `BLOCKED_LEGAL_HOLD` passée son échéance est signalée en retard comme les autres (`privacy_worker_dsr_overdue`). Un gel ne rend jamais une demande invisible.
   - **F2-D-02** : une demande d'effacement refusée par le fournisseur (`FAILED`) est reprise :
     - par un nouveau retrait du consentement, qui la remet à traiter ;
     - ou par `core.kyc_cmd_retry_erasure`, commande de la personne de la session (`FAILED` vers `PENDING`, journalisée `KYC_ERASURE_RETRIED`).

     Une seule personne suffit : aucun argent, aucune décision sur autrui (17 §10). Le compteur `privacy_worker_stale_kyc_erasures` continue de les signaler.

   - **F2-D-03** : aucun hold n'est posé quand la vérification courante est en `RECHECK` pour `CONSENT_WITHDRAWN` (contrainte `hold_kyc_consent_withdrawn`, code `FORBIDDEN` ; 16 VER-004). Le contrôle complet de l'éligibilité du conducteur à la pose reste à US-209.
5. **Téléversements**.
   - **F2-U-01** : l'analyse des en-têtes retient la **plus grande** taille annoncée, quel que soit son rang (plusieurs SOF JPEG ou IHDR PNG). Une taille démesurée annoncée en premier ne se cache plus derrière une seconde (`photo-ingest.ts`).
   - **F2-U-02** : plafonds par pays, en défense en profondeur derrière l'API. Graine 0098, valeurs PROPOSÉES, comme Turo : le moins limitant raisonnable.

     | Paramètre                     | Valeur PA et PY | Issue au-delà                      |
     | ----------------------------- | --------------- | ---------------------------------- |
     | `upload_photo_max_kb`         | 10 240 (10 Mio) | `PHOTO_FORMAT` (la borne de l'API) |
     | `upload_gallery_photos_max`   | 100 par annonce | `PHOTO_LIMIT_REACHED` (409)        |
     | `upload_documents_per_minute` | 20 par véhicule | `DOCUMENT_RATE_LIMITED` (409)      |
     - La galerie compte les photos non refusées. Ce n'est ni un plafond d'annonces ni un plafond de véhicules (DEC-FONDATEUR-19), et les clés évitent les mots d'une flotte.
     - Les dépôts sont comptés sur une minute glissante, sous un verrou du véhicule.
     - Une valeur absente ou mal formée vaut refus.
6. **Hôte défaillant (08 BR-TRUST-09)**.
   - **F2-T-01** : la fiche 360° (`support_staff_profile`) porte `hostTrips`. Ce sont les trips à venir (`BOOKED`, `CHECKIN_OPEN`) des comptes d'hôte de la personne, dans le pays de la fiche, sans le voyageur (RT-L1-D03).
   - **F2-T-02** : la pose d'une restriction (`RESTRICT_ACCOUNT`) émet `booking.trip.host_restricted` pour chaque trip à venir des comptes d'hôte de la personne. La charge porte `trip_id`, `guest_user_id` et `org_id`, jamais le motif. L'événement est émis par `core.booking_notify_host_restricted` (module BKG) et rendu par le gabarit NTF `EVT_TRIP_HOST_RESTRICTED` (e-mail puis SMS, message de trip). Les textes `ntf.tripHostRestricted.*` sont livrés en es, en, fr et pt-BR (catalogue v41). Le texte annonce le remboursement intégral si le trip est annulé (BR-CXL-12, T22). Les canaux restent en `FAKE`.

## Conséquences

- La séparation des tâches n'a plus d'exception connue dans la console. Une story qui ajoute une entrée de console, ou un type de sujet, appelle la garde et ajoute sa branche dans `core.support_subject_parties`.
- Un co-hôte ne prend plus le KYC, la restriction ni le dossier du titulaire. Le sujet est confié à un autre agent : c'est voulu (17 §2.3).
- Deux comptes d'hôte de la même personne ne sont plus approuvés tous les deux. Un homonyme partiel né le même jour attend le constat `NOT_LINKED` de l'ops : c'est un faux positif rare et réversible, et le dossier n'est pas refusé.
- Les preuves d'US-108 et d'US-123, dont les dossiers validés restent en base pendant la série, donnent une date de naissance propre à chaque hôte : ce sont des personnes distinctes.
- Renvois à reporter :
  - 17 §2.3 : garde sur toutes les entrées, asymétrie ;
  - 17 §4.5 : `booking.trip.host_restricted` ;
  - 16 A.8 : `HOST_IDENTITY_DUPLICATE`, `PHOTO_LIMIT_REACHED`, `DOCUMENT_RATE_LIMITED` ;
  - 17 §7.2 : les trois paramètres `upload_*`.

## Retour arrière

Voir l'en-tête de la migration 0097 (définitions à réappliquer, fonctions et politiques à supprimer) et celui de la graine 0098. Pour F2-U-01, version précédente de `photo-ingest.ts` (dernière taille annoncée).
