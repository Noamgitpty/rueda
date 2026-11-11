# ADR-097 — Files de revue avec délais, fiche 360° journalisée, notes, dossiers, pièces du staff et restrictions de compte

- **Statut** : PROPOSÉ (US-109, agent full-stack, claude-opus-5-5, 2026-11-11). Revues exigées : code, architecture (`packages/db/`), **sécurité** (RLS, rôles, `SECURITY DEFINER`, données C2 / C3, fichiers ; autre modèle que l'auteur), UX (`Revue design : OUI`), qa.
- **Sources** : 19 US-109 (critères d'acceptation) ; 16 ADM-005 (fiche 360°), ADM-029 (files de revue), ADM-032 (journal d'accès) ; 08 BR-ACC-10, BR-VERIF-09 ; 17 §2.3 (OPS / SUPPORT : objets couverts par un `support_case` ou un `review_queue_item` assigné ; ADMIN : tout, journalisé ; C3 seulement par `kyc.read_sensitive`), §3.2.1 (`restriction`), §3.2.13 (`support_case`, `internal_note`, `review_queue_item`, `data_access_log`, `file_asset`), §5 (antivirus), §7.2 (délais), §10 (catalogue des actions) ; 10b écran O01 ; pré-mortem du lot 1 L1-PM-08, L1-PM-33, L1-PM-41 à L1-PM-43 ; reports d'US-101 (ADR-092 : `internal_note`, écriture de `support_case`, téléversement des pièces par le staff).

## Contexte

Le cadre des actions de console (ADR-092) exige des pièces pour les actions d'enregistrement seul, mais aucune route ne permettait au staff d'en déposer. Il n'existait ni file de revue, ni fiche d'une personne, ni note interne, ni commande d'écriture des dossiers de support, ni restriction manuelle d'un compte. La porte d'accès aux données personnelles d'US-004 (`iam_staff_cmd_data_access`) ne couvre que les dossiers de support et les accès `READ_C3` / `BREAK_GLASS`. Le KYC lui-même n'existe pas encore (US-105) : le « dossier KYC » de la Bêta est l'identité déclarée de la personne.

## Décision

1. **Files de revue déclarées** (migration 0064). `support_review_queue` déclare chaque file avec sa permission et le paramètre de délai du pays (17 §7.2). Cinq files sont déclarées : `KYC` et `RISK_BOOKING` (`kyc.decide`), `HOST_VERIFICATION`, `LISTING` et `CATALOG_ADDITION` (`ops.review_listing_host`). Les files sans paramètre de délai (`OVERDUE`, `GRAY_MARKET`, `LEG_RECONCILIATION`) sont ajoutées par leur story.
   - La mise en file `core.support_enqueue_review` et la clôture `core.support_close_review_item` (`DONE` ou `CANCELLED`, décision et `decided_at` posées par la base) sont `SECURITY DEFINER`, propriété d'`iam_staff_owner`, `search_path` figé, `EXECUTE` à aucun rôle : chaque story productrice accorde seulement `EXECUTE` au propriétaire NOLOGIN de sa commande (revue architecture, n° 1). La preuve L0 passe par une sonde de ce genre (`cmd_golive_owner`, fixture 9990). L'échéance est posée par la base, `platform.now()` plus le délai du pays, avec `created_at` et l'échéance lus sur le même instant ; paramètre absent : `PARAM_MISSING` (fail-closed). Le pays d'un sujet qui a une table (`USER_ACCOUNT`, `ORGANIZATION`) est relu en base et doit être celui reçu, sinon `COUNTRY_MISMATCH` (revue sécurité, n° 3). Un seul élément vivant par sujet et par file.
   - Un élément ouvert dont l'échéance est passée est **signalé** (`overdue`), calculé par la base à chaque lecture, en tête de file et compté au résumé (critère 3).
   - Les heures ouvrées des paramètres sont comptées en heures pleines (PROPOSÉ) : l'échéance tombe plus tôt, jamais plus tard. Le calendrier ouvré viendra avec la story des SLA complets.
2. **Aucune lecture directe.** `app_api`, `app_worker` et `app_anon` n'ont aucun droit sur `support_review_queue`, `support_review_queue_item` et `support_internal_note` (matrice d'US-043). Tout passe par des commandes `SECURITY DEFINER` (propriétaire `iam_staff_owner`, `EXECUTE` au seul `app_api`). Chacune relit la session désignée par l'empreinte du jeton, le TOTP, la permission **en cours** dans le pays du sujet (relu en base) et la couverture. Les commandes `core.support_staff_*` sont : `queues`, `claim_item`, `kyc_dossier`, `find_user`, `profile`, `add_note`, `open_case`, `set_case_status`, `evidence_permitted` et `record_evidence`. Chaque refus est journalisé (`STAFF_FORBIDDEN` ou `STAFF_ACCESS_DENIED`).
3. **Couverture (17 §2.3)**. Un OPS ou un SUPPORT ne lit ou n'annote la fiche d'une personne que si un dossier ouvert (`support_case`, demandeur = la personne) ou un élément de file ouvert (sujet = la personne ou son compte d'hôte) lui est **assigné**. Un ADMIN lit toute personne de sa portée pays. FINANCE et SUPERADMIN ne lisent rien (fail-closed, PROPOSÉ). Une permission détenue sans couverture rend `CASE_REQUIRED` (HTTP 403 `STAFF_CASE_REQUIRED`), distinct de `FORBIDDEN`. Le pays d'une personne est celui de son compte (`ctr_account_country`, comme le type de sujet `USER_ACCOUNT` d'ADR-096).
4. **Journal avant la donnée**. Chaque consultation écrit, dans la même instruction et avant de rendre quoi que ce soit, une ligne `data_access_log` puis une ligne chaînée `STAFF_DATA_ACCESS` :
   - fiche 360° : `READ_C2_SUPPORT`, champ `user_account.profile_360` ;
   - recherche par e-mail : `READ_C2_SUPPORT`, champ `user_account.email` ;
   - dossier KYC : `READ_C3`, champ `kyc_dossier`.

   `case_ref` porte le dossier (`case:<id>`) ou l'élément (`item:<id>`) qui justifie l'accès. Le motif (`purpose`, 10 à 500 caractères) est exigé et journalisé : ces lectures sont des `POST`.

5. **Dossier KYC par la file seulement (L1-PM-08)**. Il n'est lisible que par un élément de la file `KYC`, ouvert et **assigné à l'acteur** (ADMIN : tout élément de sa portée), avec `kyc.read_sensitive`. La fiche 360° ne montre que le statut KYC, jamais une pièce ni la date de naissance (16 ADM-005 « sans images »). Bêta : le dossier rend l'identité déclarée ; US-105 y ajoutera la vérification. Le pays de l'élément est recoupé avec celui de la personne : un écart rend `FORBIDDEN`.
6. **Notes internes** : `support_internal_note`, en ajout seul (déclencheurs de refus), jamais visible des clients. Le texte n'entre pas au journal, seulement la référence de la note. Idempotence par `request_id`.
7. **Dossiers de support** : ouverture assignée à l'acteur, dans le pays du demandeur, jamais un bris de glace (procédure hors application, ADR-062). Le changement d'état (`PENDING`, `RESOLVED`, `CLOSED`) est réservé à l'assigné ou à un ADMIN du pays.
8. **Restrictions** : actions de console `RESTRICT_ACCOUNT` et `LIFT_RESTRICTION` (cadre d'ADR-092, sujet `USER_ACCOUNT`, permission `ops.restrict_account`, saisie `kind` ∈ {`TS_HOLD`, `POLICY_VIOLATION`}, motif obligatoire). Le gestionnaire IAM est `core.iam_manual_action_restriction` (`SECURITY DEFINER`, propriétaire `iam_auth_owner`, `EXECUTE` à `iam_staff_owner` seul). Il n'y a qu'une restriction active par personne et par type ; la levée est motivée. Les restrictions liées aux dettes et aux litiges (`UNPAID_BALANCE`, `CHARGEBACK`…) appartiennent à leurs stories (politiques d'`iam_auth_owner` limitées aux types manuels). **Séparation des fonctions** (revue sécurité, n° 1 ; PROPOSÉ) : le gestionnaire refuse la pose comme la levée quand l'acteur est le sujet (`SELF_FORBIDDEN`). Il ne laisse viser un membre du staff (rôle en cours) que par un ADMIN (`STAFF_SUBJECT_ADMIN_ONLY` sinon). Choix fait plutôt qu'un refus total : un agent fautif doit pouvoir être restreint sans attendre une story ; l'ADMIN est le rôle qui gère déjà les comptes du staff (suspension, réinitialisation TOTP, ADR-062), et ce geste reste motivé et journalisé. Le refus total a été écarté, car il obligerait à passer par la base pour restreindre un agent.
9. **Réservation** : `core.booking_cmd_place_hold` (corps de 0056 recopié) refuse un voyageur restreint (`hold_account_restricted` → `ACCOUNT_RESTRICTED`, critère 1) et le véhicule d'un titulaire restreint (`hold_host_not_active` → `HOST_NOT_ACTIVATED`, L1-PM-33). La fiche montre alors ses comptes d'hôte « fermés à la réservation ».
10. **Pièces du staff** (L1-PM-41 à L1-PM-43), dans cet ordre, sans jamais déposer un fichier refusé :
    - taille de 1 octet à 64 Kio (PROPOSÉ : le corps JSON de l'API est borné à 100 Kio ; les gros fichiers passeront par une URL de dépôt signée, US-003) ;
    - type **réel** lu sur les octets, dans une liste blanche (JPEG, PNG, HEIC, PDF) : SVG, HTML et texte sont refusés, et le type déclaré doit être le type réel. **Seul le préfixe des octets est lu** : un polyglotte (PDF avec script, JPEG suivi de HTML, tout conteneur HEIF de marque `mif1`) passe ce contrôle et repose sur l'antivirus et sur la règle de service des fichiers (jamais servis sur l'origine de l'application, US-003) ;
    - droit `evidence.upload` jugé par la base **avant** toute analyse ;
    - antivirus (port `EvidenceScanner`) : seul `CLEAN` libère ; une panne ou un délai rend la route indisponible ;
    - dans une transaction : clé de la personne (port `EvidenceVault`), ligne `file_asset` (seau `PRIVATE_EVIDENCE`, C2, chiffrée par la clé de la personne, `STAFF_UPLOAD`), chiffrement, dépôt en création seule (port `EvidenceFileStore`) ; tout échec annule. **Le dépôt part avant le `COMMIT`** : un `COMMIT` en échec laisse un objet orphelin, sans ligne, que le rejeu du même `requestId` heurte (`CONFLICT`, rendu 503). Le nettoyage des orphelins est repris par US-003.

    En production, antivirus, coffre et stockage sont des adaptateurs `Unavailable*` : 503, jamais un FAKE. Q-019 est tranchée par **DEC-FONDATEUR-20** : ClamAV, et des signatures périmées valent un refus. L'adaptateur réel, avec la correspondance « signatures périmées » vers `UNAVAILABLE`, est posé par US-003.

## Conséquences

- Critères 1 à 3 de 19 US-109 prouvés en L0, en PA (USD) et en PY (PYG), sous `app_api`, avec des tests IDOR entre pays (`l0-us109-review-queues-360`). La matrice des routes est prouvée de bout en bout par `route-matrix.int`.
- Nouvelles permissions PROPOSÉES (à reporter dans 17 §2.3) :
  - `support.read_profile`, `support.write_note` et `support.case_write` : SUPPORT, OPS, ADMIN ;
  - `ops.restrict_account` : OPS, ADMIN ;
  - `evidence.upload` : SUPPORT, OPS, ADMIN.
- Nouvelles actions au catalogue de 17 §10 (`RESTRICT_ACCOUNT`, `LIFT_RESTRICTION`) et nouveaux codes PROPOSÉS pour 16 A.8 : `ACCOUNT_RESTRICTED` (déjà nommé par 19 US-109), `STAFF_CASE_REQUIRED`, `STAFF_ITEM_TAKEN`, `STAFF_USER_NOT_FOUND`, `EVIDENCE_REJECTED`, `EVIDENCE_UNAVAILABLE`.
- `iam_staff_owner` lit désormais des colonnes C2 du compte (contact, noms) : seules ses commandes y accèdent, après journalisation.
- Aucun événement n'est encore émis (`iam.restriction.applied` / `.lifted`, `support.review_queue.sla_breached`) : l'outbox et les notifications (`EVT_ACCOUNT_RESTRICTED`) viendront avec NTF ; le signalement du retard est aujourd'hui une lecture.

## Limites

- Le délai d'une file compte les heures ouvrées en heures pleines.
- Le dossier KYC est l'identité déclarée tant qu'US-105 n'a pas livré la vérification.
- Le refus d'un fichier par l'antivirus n'est pas journalisé (aucune écriture en base) ; l'agent voit le refus.
- Les pièces en production attendent US-003 (KMS, stockage objet, adaptateur ClamAV de DEC-FONDATEUR-20).
- Une restriction posée pendant un hold déjà actif n'est relue ni au démarrage du paiement ni à la conversion (suite du BOARD).
- `iam_staff_owner` lit les colonnes C2 de toutes les personnes ; seules ses commandes journalisées le font aujourd'hui (suite du BOARD : propriétaire dédié ou inventaire testé).
- La couverture est auto-attribuable : `support.case_write` ouvre un dossier assigné à soi (risque détectif, journalisé ; suite du BOARD : alerte sur le volume de dossiers par agent).
- Deux portes mènent à `READ_C3` : `iam_staff_cmd_data_access` (dossiers de support, 0051) et le dossier KYC de la file ; à unifier par US-105.

## Alternatives écartées

- **Étendre `app.staff_case_covers` et ouvrir des lectures RLS à `app_api`** : chaque lecture de données personnelles devait être journalisée avant d'être rendue, ce qu'une politique RLS ne garantit pas. Les commandes `SECURITY DEFINER` journalisent puis lisent dans la même instruction (même choix qu'ADR-080).
- **Restriction par une commande IAM hors du cadre des actions** : 17 §1.8 D7 et ADR-092 veulent que chaque opération manuelle soit une action de console journalisée.
- **Téléversement brut (`application/octet-stream`)** : la parade CSRF de l'API n'admet que du JSON pour les écritures (ADR-052). Le corps base64 reste borné par la limite JSON en Bêta.
